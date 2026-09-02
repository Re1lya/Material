import { Config } from '@backstage/config';
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import { parse, stringify } from 'yaml';

type DeploymentRequest = {
  deploymentName: string;
  projectRef: string;
  modelVersionRef: string;
  runtimeProfileRef: string;
  visibility: 'internal' | 'private';
  requestedTensorParallelSize: number;
  requestedDataParallelSize: number;
  requestedPipelineParallelSize: number;
  requestedReplicas: number;
  requestedMaxModelLen: number;
  requestedMaxNumSeqs: number;
  requestedMaxNumBatchedTokens: number;
  requestedGpuMemoryUtilization: number;
  requestedPrefixCaching: boolean;
  requestedMtpTokens: number;
  requestedMaxOngoingRequests: number;
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
  artifactKeeperBaseUrl: string;
  stoppedCompositionRef: string;
  runningCompositionRef: string;
};

type ServingConfig = {
  tensorParallelSize: number;
  dataParallelSize: number;
  pipelineParallelSize: number;
  requestedReplicas: number;
  maxModelLen: number;
  maxNumSeqs: number;
  maxNumBatchedTokens: number;
  gpuMemoryUtilization: number;
  prefixCaching: boolean;
  mtpTokens: number;
  maxOngoingRequests: number;
};

type GiteaContentFile = {
  type: string;
  path: string;
  sha?: string;
  encoding?: string;
  content?: string;
};

type CatalogDocument = {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string };
  spec?: Record<string, any>;
};

type DeploymentContract = {
  artifact: {
    modelId: string;
    revision: string;
    repository: string;
    path: string;
    manifestDigest: string;
  };
  runtime: {
    image: string;
    rayVersion: string;
    modelPath: string;
    modelName: string;
    serveConfigV2: string;
    serving: ServingConfig;
    headCPU: string;
    headMemory: string;
    workerCPU: string;
    workerMemory: string;
    npuPerWorker: number;
    workerReplicas: number;
  };
  cache: {
    revision: string;
    image: string;
    baseURL: string;
    readerSecret: string;
    storageClassName: string;
    size: string;
  };
  compositionRef: { name: string };
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
    artifactKeeperBaseUrl: section
      .getString('artifactKeeperBaseUrl')
      .replace(/\/$/, ''),
    stoppedCompositionRef: section.getString('stoppedCompositionRef'),
    runningCompositionRef: section.getString('runningCompositionRef'),
  };
}

/**
 * Derive the only two serving representations from one allow-listed input.
 * The structured object is the source of truth; serveConfigV2 is rendered from
 * the certified RuntimeProfile template so the two cannot drift independently.
 */
export function renderServingRuntime(
  runtime: DeploymentContract['runtime'],
  input: Pick<
    DeploymentRequest,
    | 'requestedTensorParallelSize'
    | 'requestedDataParallelSize'
    | 'requestedPipelineParallelSize'
    | 'requestedReplicas'
    | 'requestedMaxModelLen'
    | 'requestedMaxNumSeqs'
    | 'requestedMaxNumBatchedTokens'
    | 'requestedGpuMemoryUtilization'
    | 'requestedPrefixCaching'
    | 'requestedMtpTokens'
    | 'requestedMaxOngoingRequests'
  >,
) {
  const serving: ServingConfig = {
    tensorParallelSize: input.requestedTensorParallelSize,
    dataParallelSize: input.requestedDataParallelSize,
    pipelineParallelSize: input.requestedPipelineParallelSize,
    requestedReplicas: input.requestedReplicas,
    maxModelLen: input.requestedMaxModelLen,
    maxNumSeqs: input.requestedMaxNumSeqs,
    maxNumBatchedTokens: input.requestedMaxNumBatchedTokens,
    gpuMemoryUtilization: input.requestedGpuMemoryUtilization,
    prefixCaching: input.requestedPrefixCaching,
    mtpTokens: input.requestedMtpTokens,
    maxOngoingRequests: input.requestedMaxOngoingRequests,
  };
  if (
    serving.tensorParallelSize * serving.pipelineParallelSize >
      runtime.npuPerWorker ||
    serving.dataParallelSize > serving.requestedReplicas
  ) {
    throw new Error(
      'Requested parallelism is outside the certified runtime profile capacity',
    );
  }

  let config: Record<string, any>;
  try {
    config = parse(runtime.serveConfigV2) as Record<string, any>;
  } catch {
    throw new Error('RuntimeProfile serveConfigV2 is not valid YAML');
  }
  const llmConfig = config?.applications?.[0]?.args?.llm_configs?.[0];
  if (!llmConfig || typeof llmConfig !== 'object') {
    throw new Error('RuntimeProfile serveConfigV2 has no Ray Serve LLM config');
  }
  llmConfig.deployment_config = {
    ...(llmConfig.deployment_config ?? {}),
    num_replicas: serving.requestedReplicas,
    max_ongoing_requests: serving.maxOngoingRequests,
  };
  llmConfig.engine_kwargs = {
    ...(llmConfig.engine_kwargs ?? {}),
    tensor_parallel_size: serving.tensorParallelSize,
    data_parallel_size: serving.dataParallelSize,
    pipeline_parallel_size: serving.pipelineParallelSize,
    max_model_len: serving.maxModelLen,
    max_num_seqs: serving.maxNumSeqs,
    max_num_batched_tokens: serving.maxNumBatchedTokens,
    gpu_memory_utilization: serving.gpuMemoryUtilization,
    enable_prefix_caching: serving.prefixCaching,
    speculative_config: {
      ...(llmConfig.engine_kwargs?.speculative_config ?? {}),
      num_speculative_tokens: serving.mtpTokens,
    },
  };
  return {
    ...runtime,
    serving,
    serveConfigV2: stringify(config, { lineWidth: 0 }),
  };
}

function encodeRepositoryPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function giteaRequest<T>(options: {
  config: GiteaConfig;
  path: string;
  method?: 'GET' | 'POST' | 'PUT';
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

async function readCatalogDocument(
  gitea: GiteaConfig,
  repositoryPrefix: string,
  ref: string,
  name: string,
  expectedKind: string,
  signal?: AbortSignal,
): Promise<CatalogDocument> {
  const path = `${repositoryPrefix}/contents/environments/production/catalog/${encodeRepositoryPath(
    `${name}.yaml`,
  )}?ref=${encodeURIComponent(ref)}`;
  const response = await giteaRequest<GiteaContentFile>({
    config: gitea,
    path,
    acceptedStatuses: [200],
    signal,
  });
  const file = response.value;
  if (!file?.content || file.encoding !== 'base64') {
    throw new Error(`Catalog file ${name}.yaml did not contain base64 content`);
  }
  let document: CatalogDocument | undefined;
  try {
    document = parse(Buffer.from(file.content, 'base64').toString('utf8')) as
      | CatalogDocument
      | undefined;
  } catch {
    throw new Error(`Catalog file ${name}.yaml is not valid YAML`);
  }
  if (
    !document ||
    document.kind !== expectedKind ||
    document.metadata?.name !== name ||
    !document.spec
  ) {
    throw new Error(`Catalog file ${name}.yaml does not match ${expectedKind}`);
  }
  return document;
}

async function loadDeploymentContract(
  gitea: GiteaConfig,
  repositoryPrefix: string,
  modelVersionRef: string,
  runtimeProfileRef: string,
  signal?: AbortSignal,
): Promise<DeploymentContract> {
  const [modelVersion, runtimeProfile] = await Promise.all([
    readCatalogDocument(
      gitea,
      repositoryPrefix,
      gitea.baseBranch,
      modelVersionRef,
      'ModelVersion',
      signal,
    ),
    readCatalogDocument(
      gitea,
      repositoryPrefix,
      gitea.baseBranch,
      runtimeProfileRef,
      'ModelRuntimeProfile',
      signal,
    ),
  ]);
  const modelSpec = modelVersion.spec ?? {};
  const profileSpec = runtimeProfile.spec ?? {};
  const artifact = modelSpec.artifact as DeploymentContract['artifact'];
  const profileRuntime = (profileSpec.runtime ?? {}) as Record<string, any>;
  const profileResources = (profileSpec.resources ?? {}) as Record<string, any>;
  const profileRequests = (profileResources.requests ?? {}) as Record<
    string,
    any
  >;
  const profileCache = (profileRuntime.cache ?? {}) as Record<string, any>;

  const compatibleProfiles = (modelSpec.compatibility?.runtimeProfiles ??
    []) as string[];
  if (!compatibleProfiles.includes(runtimeProfileRef)) {
    throw new Error(
      `Runtime profile ${runtimeProfileRef} is not compatible with ${modelVersionRef}`,
    );
  }
  if (
    !artifact ||
    typeof artifact.modelId !== 'string' ||
    typeof artifact.revision !== 'string' ||
    typeof artifact.repository !== 'string' ||
    typeof artifact.path !== 'string' ||
    typeof artifact.manifestDigest !== 'string'
  ) {
    throw new Error(
      `ModelVersion ${modelVersionRef} has an incomplete artifact`,
    );
  }
  const runtime = {
    image: profileRuntime.image,
    rayVersion: profileRuntime.rayVersion,
    modelPath: profileRuntime.modelPath,
    modelName: profileRuntime.modelName,
    serveConfigV2: profileRuntime.serveConfigV2,
    serving: profileRuntime.serving,
    headCPU: profileRuntime.headCPU ?? '2',
    headMemory: profileRuntime.headMemory ?? '8Gi',
    workerCPU: profileRuntime.workerCPU ?? profileRequests.cpu,
    workerMemory: profileRuntime.workerMemory ?? profileRequests.memory,
    npuPerWorker: profileRuntime.npuPerWorker,
    workerReplicas: profileRuntime.workerReplicas ?? 0,
  };
  if (
    Object.values(runtime).some(value => value === undefined || value === null)
  ) {
    throw new Error(
      `Runtime profile ${runtimeProfileRef} is missing a Ray serving contract`,
    );
  }
  const cache = {
    revision: profileCache.revision,
    image: profileCache.image,
    baseURL: gitea.artifactKeeperBaseUrl,
    readerSecret: profileCache.readerSecret,
    storageClassName: profileCache.storageClassName,
    size: profileCache.size,
  };
  if (
    Object.values(cache).some(value => value === undefined || value === null)
  ) {
    throw new Error(
      `Runtime profile ${runtimeProfileRef} is missing its model cache contract`,
    );
  }
  return {
    artifact,
    runtime,
    cache,
    compositionRef: { name: gitea.stoppedCompositionRef },
  };
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
        deploymentName: z => z.string().min(1).max(40).regex(dnsLabel),
        projectRef: z => z.string().min(1).max(63).regex(dnsLabel),
        modelVersionRef: z => z.string().min(1).max(253),
        runtimeProfileRef: z => z.string().min(1).max(253),
        visibility: z => z.enum(['internal', 'private']),
        requestedTensorParallelSize: z => z.number().int().min(1).max(16),
        requestedDataParallelSize: z => z.number().int().min(1).max(4),
        requestedPipelineParallelSize: z => z.number().int().min(1).max(4),
        requestedReplicas: z => z.number().int().min(0).max(4),
        requestedMaxModelLen: z => z.number().int().min(1024).max(131072),
        requestedMaxNumSeqs: z => z.number().int().min(1).max(1024),
        requestedMaxNumBatchedTokens: z => z.number().int().min(256).max(65536),
        requestedGpuMemoryUtilization: z => z.number().min(0.5).max(0.98),
        requestedPrefixCaching: z => z.boolean(),
        requestedMtpTokens: z => z.number().int().min(0).max(8),
        requestedMaxOngoingRequests: z => z.number().int().min(1).max(1024),
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

      const contract = await loadDeploymentContract(
        gitea,
        repositoryPrefix,
        input.modelVersionRef,
        input.runtimeProfileRef,
        ctx.signal,
      );
      const runtime = renderServingRuntime(contract.runtime, input);

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
            'platform.example.com/requested-data-parallel-size': String(
              input.requestedDataParallelSize,
            ),
            'platform.example.com/requested-pipeline-parallel-size': String(
              input.requestedPipelineParallelSize,
            ),
            'platform.example.com/requested-replicas': String(
              input.requestedReplicas,
            ),
            'platform.example.com/requested-max-model-len': String(
              input.requestedMaxModelLen,
            ),
            'platform.example.com/requested-max-num-seqs': String(
              input.requestedMaxNumSeqs,
            ),
            'platform.example.com/requested-max-num-batched-tokens': String(
              input.requestedMaxNumBatchedTokens,
            ),
            'platform.example.com/requested-gpu-memory-utilization': String(
              input.requestedGpuMemoryUtilization,
            ),
            'platform.example.com/requested-prefix-caching': String(
              input.requestedPrefixCaching,
            ),
            'platform.example.com/requested-mtp-tokens': String(
              input.requestedMtpTokens,
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
          crossplane: {
            compositionRef: contract.compositionRef,
            compositionUpdatePolicy: 'Automatic',
          },
          projectRef: input.projectRef,
          modelVersionRef: input.modelVersionRef,
          runtimeProfileRef: input.runtimeProfileRef,
          compositionRef: contract.compositionRef,
          desiredState: 'Stopped',
          placement: {
            acceleratorPool: 'control-plane-only',
          },
          access: {
            visibility: input.visibility,
          },
          artifact: contract.artifact,
          runtime,
          cache: contract.cache,
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
                `- Requested TP/DP/PP/replicas: ${input.requestedTensorParallelSize}/${input.requestedDataParallelSize}/${input.requestedPipelineParallelSize}/${input.requestedReplicas}`,
                `- Context/concurrency/batch: ${input.requestedMaxModelLen}/${input.requestedMaxNumSeqs}/${input.requestedMaxNumBatchedTokens}`,
                `- Memory/prefix cache/MTP/max ongoing: ${input.requestedGpuMemoryUtilization}/${input.requestedPrefixCaching}/${input.requestedMtpTokens}/${input.requestedMaxOngoingRequests}`,
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

export function createStartInferenceAction(config: Config) {
  const gitea = readGiteaConfig(config);
  const repositoryPrefix = `/api/v1/repos/${encodeURIComponent(
    gitea.owner,
  )}/${encodeURIComponent(gitea.repository)}`;

  return createTemplateAction({
    id: 'model-platform:gitea-start-inference-pr',
    description:
      'Open a constrained Running update for an existing stopped ModelDeployment. The request stays unmerged unless the Tekton capacity gate opens an approved running window.',
    supportsDryRun: false,
    schema: {
      input: {
        deploymentName: z => z.string().min(1).max(40).regex(dnsLabel),
        startReason: z => z.string().min(1).max(512).optional(),
      },
      output: {
        pullRequestUrl: z => z.string().url(),
        pullRequestNumber: z => z.number().int().positive(),
        branch: z => z.string(),
        manifestPath: z => z.string(),
        startRequestId: z => z.string(),
        executionMode: z => z.string(),
      },
    },
    async handler(ctx) {
      const input = ctx.input as {
        deploymentName: string;
        startReason?: string;
      };
      const initiator = ctx.user?.ref;
      if (!initiator || !gitea.allowedInitiators.includes(initiator)) {
        throw new Error(
          'Current Backstage identity is not approved to start inference',
        );
      }

      const manifestPath = `environments/production/modeldeployments/${input.deploymentName}.yaml`;
      const contentPath = `${repositoryPrefix}/contents/${encodeRepositoryPath(
        manifestPath,
      )}`;
      const existing = await giteaRequest<GiteaContentFile>({
        config: gitea,
        path: `${contentPath}?ref=${encodeURIComponent(gitea.baseBranch)}`,
        acceptedStatuses: [200, 404],
        signal: ctx.signal,
      });
      if (
        existing.status !== 200 ||
        !existing.value?.content ||
        !existing.value.sha
      ) {
        throw new Error(
          `Deployment request ${input.deploymentName} does not exist on ${gitea.baseBranch}; only an existing stopped deployment can be started`,
        );
      }
      const existingFile = existing.value;
      let document;
      try {
        document = parse(
          Buffer.from(existingFile.content!, 'base64').toString('utf8'),
        ) as Record<string, any>;
      } catch {
        throw new Error('Existing deployment request is not valid YAML');
      }

      const prefix = 'platform.example.com/';
      const annotations = document.metadata?.annotations ?? {};
      const spec = document.spec ?? {};
      if (
        annotations[`${prefix}request-mode`] !== 'declarative-stopped' ||
        spec.desiredState !== 'Stopped' ||
        spec.runtime?.workerReplicas !== 0
      ) {
        throw new Error(
          'Only a declarative-stopped request with workerReplicas=0 can be started',
        );
      }
      if (
        spec.compositionRef?.name !== gitea.stoppedCompositionRef ||
        spec.crossplane?.compositionRef?.name !== gitea.stoppedCompositionRef
      ) {
        throw new Error(
          'Only a request bound to the certified stopped composition can be started',
        );
      }
      const profileRef = spec.runtimeProfileRef as string;
      if (!gitea.allowedRuntimeProfiles.includes(profileRef)) {
        throw new Error(
          'runtimeProfileRef is outside the approved runtime allow-list',
        );
      }

      const startRequestId = `start-${ctx.task.id
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56)}`;

      const branch = `backstage/modeldeployment-running-${input.deploymentName}`;
      const openPulls = await giteaRequest<
        { number: number; head?: { ref?: string } }[]
      >({
        config: gitea,
        path: `${repositoryPrefix}/pulls?state=open`,
        acceptedStatuses: [200],
        signal: ctx.signal,
      });
      const clash = (openPulls.value ?? []).find(
        pull => pull.head?.ref === branch,
      );
      if (clash) {
        throw new Error(
          `A start-inference request for ${input.deploymentName} is already open as PR #${clash.number}`,
        );
      }

      annotations[`${prefix}request-mode`] = 'declarative-running';
      annotations[`${prefix}requested-start-id`] = startRequestId;
      if (input.startReason) {
        annotations[`${prefix}requested-start-reason`] = input.startReason;
      }
      // Record the allow-listed starter as the effective requested-by owner.
      document.metadata.labels[`${prefix}requested-by`] = initiator
        .replace(/^user:[^/]+\//, '')
        .replace(/[^A-Za-z0-9_.-]/g, '-');
      const npuPerWorker = spec.runtime?.npuPerWorker;
      const serving = spec.runtime?.serving as Partial<ServingConfig> | undefined;
      const requestedReplicas = serving?.requestedReplicas;
      if (typeof npuPerWorker !== 'number' || npuPerWorker <= 0) {
        throw new Error(
          'runtime npuPerWorker is missing; refusing to generate a running request',
        );
      }
      if (
        !Number.isInteger(requestedReplicas) ||
        requestedReplicas === undefined ||
        requestedReplicas < 1 ||
        requestedReplicas > 4
      ) {
        throw new Error(
          'runtime.serving.requestedReplicas must be an approved value before Start',
        );
      }
      annotations[`${prefix}effective-tensor-parallel-size`] =
        String(serving?.tensorParallelSize);
      annotations[`${prefix}effective-replicas`] = String(requestedReplicas);
      annotations[`${prefix}effective-npu-per-replica`] = String(npuPerWorker);
      spec.desiredState = 'Running';
      spec.runtime.workerReplicas = requestedReplicas;
      spec.compositionRef = { name: gitea.runningCompositionRef };
      spec.crossplane.compositionRef = { name: gitea.runningCompositionRef };

      const yaml = stringify(document, { lineWidth: 0 });

      const pullRequest = await ctx.checkpoint({
        key: `gitea-pr.${manifestPath}`,
        fn: async () => {
          const fileWrite = await giteaRequest<GiteaFileWrite>({
            config: gitea,
            path: contentPath,
            method: 'PUT',
            acceptedStatuses: [200, 201],
            body: {
              branch: gitea.baseBranch,
              new_branch: branch,
              sha: existingFile.sha,
              content: Buffer.from(yaml, 'utf8').toString('base64'),
              message: `request start inference ${input.deploymentName} (${startRequestId})`,
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
              title: `ModelDeployment Running: ${input.deploymentName}`,
              body: [
                'Created by the constrained Backstage start-inference action.',
                '',
                `- Start request ID: \`${startRequestId}\``,
                `- Requested-by: \`${initiator}\``,
                '- Desired state change: `Stopped` -> `Running`',
                `- workerReplicas change: \`0\` -> \`${requestedReplicas}\` (${npuPerWorker} NPU per worker)`,
                `- Runtime profile: ${profileRef}`,
                '- The Tekton capacity gate must pass inside an approved running window before this PR can merge.',
                '',
                'Stop requests always take priority over new starts.',
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
                description: 'Waiting for Tekton running gate validation',
              },
              signal: ctx.signal,
            });
          } catch {
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
        `Created start-inference PR #${pullRequest.number} for ${input.deploymentName} (${startRequestId})`,
      );
      ctx.output('pullRequestUrl', pullRequest.url);
      ctx.output('pullRequestNumber', pullRequest.number);
      ctx.output('branch', branch);
      ctx.output('manifestPath', manifestPath);
      ctx.output('startRequestId', startRequestId);
      ctx.output('executionMode', 'declarative-running');
    },
  });
}

export function createStopInferenceAction(config: Config) {
  const gitea = readGiteaConfig(config);
  const repositoryPrefix = `/api/v1/repos/${encodeURIComponent(
    gitea.owner,
  )}/${encodeURIComponent(gitea.repository)}`;

  return createTemplateAction({
    id: 'model-platform:gitea-stop-inference-pr',
    description:
      'Open a constrained Stop update for an existing Running ModelDeployment. Stop requests require no NPU capacity window and take priority over new starts.',
    supportsDryRun: false,
    schema: {
      input: {
        deploymentName: z => z.string().min(1).max(40).regex(dnsLabel),
        stopReason: z => z.string().min(1).max(512).optional(),
      },
      output: {
        pullRequestUrl: z => z.string().url(),
        pullRequestNumber: z => z.number().int().positive(),
        branch: z => z.string(),
        manifestPath: z => z.string(),
        stopRequestId: z => z.string(),
        executionMode: z => z.string(),
      },
    },
    async handler(ctx) {
      const input = ctx.input as {
        deploymentName: string;
        stopReason?: string;
      };
      const initiator = ctx.user?.ref;
      if (!initiator || !gitea.allowedInitiators.includes(initiator)) {
        throw new Error(
          'Current Backstage identity is not approved to stop inference',
        );
      }

      const manifestPath = `environments/production/modeldeployments/${input.deploymentName}.yaml`;
      const contentPath = `${repositoryPrefix}/contents/${encodeRepositoryPath(
        manifestPath,
      )}`;
      const existing = await giteaRequest<GiteaContentFile>({
        config: gitea,
        path: `${contentPath}?ref=${encodeURIComponent(gitea.baseBranch)}`,
        acceptedStatuses: [200, 404],
        signal: ctx.signal,
      });
      if (
        existing.status !== 200 ||
        !existing.value?.content ||
        !existing.value.sha
      ) {
        throw new Error(
          `Deployment request ${input.deploymentName} does not exist on ${gitea.baseBranch}; only an existing running deployment can be stopped`,
        );
      }
      const existingFile = existing.value;

      let document;
      try {
        document = parse(
          Buffer.from(existingFile.content!, 'base64').toString('utf8'),
        ) as Record<string, any>;
      } catch {
        throw new Error('Existing deployment request is not valid YAML');
      }

      const prefix = 'platform.example.com/';
      const annotations = document.metadata?.annotations ?? {};
      const spec = document.spec ?? {};
      if (
        annotations[`${prefix}request-mode`] !== 'declarative-running' ||
        spec.desiredState !== 'Running' ||
        spec.runtime?.workerReplicas !== 1
      ) {
        throw new Error(
          'Only a declarative-running request with workerReplicas=1 can be stopped',
        );
      }
      if (
        spec.compositionRef?.name !== gitea.runningCompositionRef ||
        spec.crossplane?.compositionRef?.name !== gitea.runningCompositionRef
      ) {
        throw new Error(
          'Only a request bound to the certified Ray runtime composition can be stopped',
        );
      }
      const profileRef = spec.runtimeProfileRef as string;
      if (!gitea.allowedRuntimeProfiles.includes(profileRef)) {
        throw new Error(
          'runtimeProfileRef is outside the approved runtime allow-list',
        );
      }

      const stopRequestId = `stop-${ctx.task.id
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 57)}`;
      const branch = `backstage/modeldeployment-stopping-${input.deploymentName}`;
      const openPulls = await giteaRequest<
        { number: number; head?: { ref?: string } }[]
      >({
        config: gitea,
        path: `${repositoryPrefix}/pulls?state=open`,
        acceptedStatuses: [200],
        signal: ctx.signal,
      });
      const clash = (openPulls.value ?? []).find(
        pull => pull.head?.ref === branch,
      );
      if (clash) {
        throw new Error(
          `A stop-inference request for ${input.deploymentName} is already open as PR #${clash.number}`,
        );
      }

      annotations[`${prefix}request-mode`] = 'declarative-stopped';
      annotations[`${prefix}effective-tensor-parallel-size`] = '0';
      annotations[`${prefix}effective-replicas`] = '0';
      annotations[`${prefix}effective-npu-per-replica`] = '0';
      delete annotations[`${prefix}requested-start-id`];
      delete annotations[`${prefix}requested-start-reason`];
      document.metadata.labels[`${prefix}requested-by`] = initiator
        .replace(/^user:[^/]+\//, '')
        .replace(/[^A-Za-z0-9_.-]/g, '-');
      spec.desiredState = 'Stopped';
      spec.runtime.workerReplicas = 0;
      spec.compositionRef = { name: gitea.stoppedCompositionRef };
      spec.crossplane.compositionRef = {
        name: gitea.stoppedCompositionRef,
      };

      const yaml = stringify(document, { lineWidth: 0 });
      const pullRequest = await ctx.checkpoint({
        key: `gitea-stop-pr.${manifestPath}`,
        fn: async () => {
          const fileWrite = await giteaRequest<GiteaFileWrite>({
            config: gitea,
            path: contentPath,
            method: 'PUT',
            acceptedStatuses: [200, 201],
            body: {
              branch: gitea.baseBranch,
              new_branch: branch,
              sha: existingFile.sha,
              content: Buffer.from(yaml, 'utf8').toString('base64'),
              message: `request stop inference ${input.deploymentName} (${stopRequestId})`,
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
              title: `ModelDeployment Stop: ${input.deploymentName}`,
              body: [
                'Created by the constrained Backstage stop-inference action.',
                '',
                `- Stop request ID: \`${stopRequestId}\``,
                `- Requested-by: \`${initiator}\``,
                '- Desired state change: `Running` -> `Stopped`',
                '- workerReplicas change: `1` -> `0`',
                `- Stop reason: ${input.stopReason ?? 'not supplied'}`,
                '- Stop requests bypass the Running capacity window and take priority over new starts.',
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
                description: 'Waiting for Tekton stop validation',
              },
              signal: ctx.signal,
            });
          } catch {
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
        `Created stop-inference PR #${pullRequest.number} for ${input.deploymentName} (${stopRequestId})`,
      );
      ctx.output('pullRequestUrl', pullRequest.url);
      ctx.output('pullRequestNumber', pullRequest.number);
      ctx.output('branch', branch);
      ctx.output('manifestPath', manifestPath);
      ctx.output('stopRequestId', stopRequestId);
      ctx.output('executionMode', 'declarative-stopped');
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
        scaffolderActions.addActions(createStartInferenceAction(config));
        scaffolderActions.addActions(createStopInferenceAction(config));
      },
    });
  },
});
