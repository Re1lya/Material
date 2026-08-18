import { Config } from '@backstage/config';
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import { stringify } from 'yaml';

type DeploymentRequest = {
  deploymentName: string;
  projectRef: string;
  modelVersionRef: string;
  runtimeProfileRef: string;
  visibility: 'internal' | 'private';
  requestedTensorParallelSize: number;
  requestedPipelineParallelSize: number;
  requestedReplicas: number;
  priority: 'low' | 'normal' | 'high';
};

type GiteaConfig = {
  apiBaseUrl: string;
  owner: string;
  repository: string;
  baseBranch: string;
  token: string;
  allowedInitiators: string[];
  allowedModelVersions: string[];
  allowedRuntimeProfiles: string[];
};

type GiteaPullRequest = {
  number: number;
  html_url: string;
  head: {
    sha: string;
  };
};

type GiteaFileWrite = {
  commit: {
    sha: string;
  };
};

const dnsLabel = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

function readGiteaConfig(config: Config): GiteaConfig {
  const section = config.getConfig('modelPlatform.gitea');
  const apiBaseUrl = section.getString('apiBaseUrl').replace(/\/$/, '');
  const parsedUrl = new URL(apiBaseUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('modelPlatform.gitea.apiBaseUrl must use HTTP or HTTPS');
  }

  return {
    apiBaseUrl,
    owner: section.getString('owner'),
    repository: section.getString('repository'),
    baseBranch: section.getString('baseBranch'),
    token: section.getString('token'),
    allowedInitiators: section.getStringArray('allowedInitiators'),
    allowedModelVersions: section.getStringArray('allowedModelVersions'),
    allowedRuntimeProfiles: section.getStringArray('allowedRuntimeProfiles'),
  };
}

function encodeRepositoryPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function giteaRequest<T>(options: {
  config: GiteaConfig;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  acceptedStatuses?: number[];
  signal?: AbortSignal;
}): Promise<{ status: number; value?: T }> {
  const response = await fetch(`${options.config.apiBaseUrl}${options.path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `token ${options.config.token}`,
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const accepted = options.acceptedStatuses ?? [200];
  if (!accepted.includes(response.status)) {
    // Do not include response bodies: Gitea errors may echo sensitive input.
    throw new Error(
      `Gitea API ${options.method ?? 'GET'} ${options.path} returned HTTP ${
        response.status
      }`,
    );
  }

  if (response.status === 204 || response.status === 404) {
    return { status: response.status };
  }
  return { status: response.status, value: (await response.json()) as T };
}

function createDeploymentRequestAction(config: Config) {
  const gitea = readGiteaConfig(config);
  const repositoryPrefix = `/api/v1/repos/${encodeURIComponent(
    gitea.owner,
  )}/${encodeURIComponent(gitea.repository)}`;

  return createTemplateAction({
    id: 'model-platform:gitea-create-deployment-pr',
    description:
      'Create a constrained, stopped GitOps ModelDeployment request in one fixed Gitea repository and open a PR.',
    supportsDryRun: false,
    schema: {
      input: {
        deploymentName: z => z.string().min(1).max(63).regex(dnsLabel),
        projectRef: z => z.string().min(1).max(63).regex(dnsLabel),
        modelVersionRef: z => z.string().min(1).max(253),
        runtimeProfileRef: z => z.string().min(1).max(253),
        visibility: z => z.enum(['internal', 'private']),
        requestedTensorParallelSize: z => z.number().int().min(1).max(16),
        requestedPipelineParallelSize: z => z.number().int().min(1).max(4),
        requestedReplicas: z => z.number().int().min(0).max(4),
        priority: z => z.enum(['low', 'normal', 'high']),
      },
      output: {
        pullRequestUrl: z => z.string().url(),
        pullRequestNumber: z => z.number().int().positive(),
        branch: z => z.string(),
        manifestPath: z => z.string(),
        executionMode: z => z.string(),
        effectiveTensorParallelSize: z => z.number().int(),
        effectiveReplicas: z => z.number().int(),
      },
    },
    async handler(ctx) {
      const input = ctx.input as DeploymentRequest;
      const initiator = ctx.user?.ref;
      if (!initiator || !gitea.allowedInitiators.includes(initiator)) {
        throw new Error(
          'Current Backstage identity is not approved to request deployments',
        );
      }
      if (!gitea.allowedModelVersions.includes(input.modelVersionRef)) {
        throw new Error(
          'modelVersionRef is outside the approved catalog allow-list',
        );
      }
      if (!gitea.allowedRuntimeProfiles.includes(input.runtimeProfileRef)) {
        throw new Error(
          'runtimeProfileRef is outside the approved runtime allow-list',
        );
      }

      const manifestPath = `environments/production/modeldeployments/${input.deploymentName}.yaml`;
      const contentPath = `${repositoryPrefix}/contents/${encodeRepositoryPath(
        manifestPath,
      )}`;
      const existing = await giteaRequest({
        config: gitea,
        path: `${contentPath}?ref=${encodeURIComponent(gitea.baseBranch)}`,
        acceptedStatuses: [200, 404],
        signal: ctx.signal,
      });
      if (existing.status === 200) {
        throw new Error(
          `A deployment request named ${input.deploymentName} already exists on ${gitea.baseBranch}`,
        );
      }

      const branchSuffix = ctx.task.id
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 12);
      const branch = `backstage/modeldeployment-${input.deploymentName}-${branchSuffix}`;
      const manifest = {
        apiVersion: 'platform.example.com/v1alpha1',
        kind: 'ModelDeployment',
        metadata: {
          name: input.deploymentName,
          namespace: 'model-serving',
          labels: {
            'app.kubernetes.io/part-of': 'model-platform',
            'app.kubernetes.io/managed-by': 'argocd',
            'platform.example.com/requested-by': initiator
              .replace(/^user:[^/]+\//, '')
              .replace(/[^A-Za-z0-9_.-]/g, '-'),
          },
          annotations: {
            'platform.example.com/request-mode': 'declarative-stopped',
            'platform.example.com/requested-tensor-parallel-size': String(
              input.requestedTensorParallelSize,
            ),
            'platform.example.com/requested-pipeline-parallel-size': String(
              input.requestedPipelineParallelSize,
            ),
            'platform.example.com/requested-replicas': String(
              input.requestedReplicas,
            ),
            'platform.example.com/requested-priority': input.priority,
            'platform.example.com/effective-runtime-profile':
              input.runtimeProfileRef,
            'platform.example.com/effective-tensor-parallel-size': '0',
            'platform.example.com/effective-replicas': '0',
            'platform.example.com/effective-npu-per-replica': '0',
          },
        },
        spec: {
          projectRef: input.projectRef,
          modelVersionRef: input.modelVersionRef,
          runtimeProfileRef: input.runtimeProfileRef,
          desiredState: 'Stopped',
          placement: {
            acceleratorPool: 'control-plane-only',
          },
          access: {
            visibility: input.visibility,
          },
        },
      };
      const yaml = stringify(manifest, { lineWidth: 0 });

      const pullRequest = await ctx.checkpoint({
        key: `gitea-pr.${manifestPath}`,
        fn: async () => {
          const fileWrite = await giteaRequest<GiteaFileWrite>({
            config: gitea,
            path: contentPath,
            method: 'POST',
            acceptedStatuses: [201],
            body: {
              branch: gitea.baseBranch,
              new_branch: branch,
              content: Buffer.from(yaml, 'utf8').toString('base64'),
              message: `request stopped model deployment ${input.deploymentName}`,
            },
            signal: ctx.signal,
          });

          const created = await giteaRequest<GiteaPullRequest>({
            config: gitea,
            path: `${repositoryPrefix}/pulls`,
            method: 'POST',
            acceptedStatuses: [201],
            body: {
              base: gitea.baseBranch,
              head: branch,
              title: `ModelDeployment: ${input.deploymentName}`,
              body: [
                'Created by the constrained Backstage model-deployment template.',
                '',
                '- Desired state: `Stopped`',
                '- Accelerator pool: `control-plane-only`',
                '- Execution mode: `declarative-stopped`',
                `- Requested TP/PP/replicas: ${input.requestedTensorParallelSize}/${input.requestedPipelineParallelSize}/${input.requestedReplicas}`,
                `- Runtime profile: ${input.runtimeProfileRef}`,
                '- Runtime/NPU creation: remains stopped until a reviewed Argo CD sync',
                '',
                'Merge only after the Tekton validation status succeeds and a human reviews the diff.',
              ].join('\n'),
            },
            signal: ctx.signal,
          });
          if (!created.value) {
            throw new Error('Gitea returned no pull request object');
          }
          const headSha =
            created.value.head?.sha ?? fileWrite.value?.commit.sha;
          try {
            if (!headSha) {
              throw new Error('Gitea returned no head commit SHA');
            }
            await giteaRequest({
              config: gitea,
              path: `${repositoryPrefix}/statuses/${encodeURIComponent(
                headSha,
              )}`,
              method: 'POST',
              acceptedStatuses: [201],
              body: {
                state: 'pending',
                context: 'tekton/model-platform-policy',
                description: 'Waiting for Tekton policy validation',
              },
              signal: ctx.signal,
            });
          } catch {
            // The PR is still valid if a transient status write fails. Tekton's
            // final task will publish success/failure using a separate token.
            ctx.logger.warn(
              `PR #${created.value.number} was created, but pending status publication failed`,
            );
          }
          return {
            number: created.value.number,
            url: created.value.html_url,
          };
        },
      });

      if (!pullRequest) {
        throw new Error('Backstage checkpoint returned no pull request result');
      }
      ctx.logger.info(
        `Created constrained ModelDeployment PR #${pullRequest.number} for ${input.deploymentName}`,
      );
      ctx.output('pullRequestUrl', pullRequest.url);
      ctx.output('pullRequestNumber', pullRequest.number);
      ctx.output('branch', branch);
      ctx.output('manifestPath', manifestPath);
      ctx.output('executionMode', 'declarative-stopped');
      ctx.output('effectiveTensorParallelSize', 0);
      ctx.output('effectiveReplicas', 0);
    },
  });
}

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'model-platform-gitea-deployment-request',
  register(registration) {
    registration.registerInit({
      deps: {
        config: coreServices.rootConfig,
        scaffolderActions: scaffolderActionsExtensionPoint,
      },
      async init({ config, scaffolderActions }) {
        scaffolderActions.addActions(createDeploymentRequestAction(config));
      },
    });
  },
});
