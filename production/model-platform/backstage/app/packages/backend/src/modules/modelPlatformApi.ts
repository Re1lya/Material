import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import Router from 'express-promise-router';
import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { parse } from 'yaml';

type GiteaConfig = {
  apiBaseUrl: string;
  owner: string;
  repository: string;
  baseBranch: string;
  token: string;
  allowedModelVersions: string[];
  allowedRuntimeProfiles: string[];
};

type CatalogDocument = {
  kind?: string;
  metadata?: { name?: string };
  spec?: Record<string, any>;
};

type GiteaContentFile = {
  type?: string;
  path?: string;
  encoding?: string;
  content?: string;
};

type KubernetesObject = {
  metadata?: {
    name?: string;
    namespace?: string;
    generation?: number;
    labels?: Record<string, string>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
  data?: Record<string, string>;
};

type KubernetesList = { items?: KubernetesObject[] };

function readGiteaConfig(config: Config): GiteaConfig {
  const section = config.getConfig('modelPlatform.gitea');
  return {
    apiBaseUrl: section.getString('apiBaseUrl').replace(/\/$/, ''),
    owner: section.getString('owner'),
    repository: section.getString('repository'),
    baseBranch: section.getString('baseBranch'),
    token: section.getString('token'),
    allowedModelVersions: section.getStringArray('allowedModelVersions'),
    allowedRuntimeProfiles: section.getStringArray('allowedRuntimeProfiles'),
  };
}

function encodeRepositoryPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function giteaRequest<T>(
  gitea: GiteaConfig,
  path: string,
): Promise<{ status: number; value?: T }> {
  const response = await fetch(`${gitea.apiBaseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `token ${gitea.token}`,
    },
  });
  if (![200, 404].includes(response.status)) {
    throw new Error(`Gitea catalog request returned HTTP ${response.status}`);
  }
  if (response.status === 404) {
    return { status: 404 };
  }
  return { status: response.status, value: (await response.json()) as T };
}

async function readCatalogDocument(
  gitea: GiteaConfig,
  repositoryPrefix: string,
  name: string,
  expectedKind: string,
): Promise<CatalogDocument> {
  const path = `${repositoryPrefix}/contents/environments/production/catalog/${encodeRepositoryPath(
    `${name}.yaml`,
  )}?ref=${encodeURIComponent(gitea.baseBranch)}`;
  const response = await giteaRequest<GiteaContentFile>(gitea, path);
  if (response.status !== 200 || !response.value?.content) {
    throw new Error(
      `Catalog entry ${name} is not available on ${gitea.baseBranch}`,
    );
  }
  if (response.value.encoding !== 'base64') {
    throw new Error(`Catalog entry ${name} is not base64 encoded`);
  }
  const document = parse(
    Buffer.from(response.value.content, 'base64').toString('utf8'),
  ) as CatalogDocument | undefined;
  if (
    !document ||
    document.kind !== expectedKind ||
    document.metadata?.name !== name ||
    !document.spec
  ) {
    throw new Error(`Catalog entry ${name} does not match ${expectedKind}`);
  }
  return document;
}

function lastModelName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId;
}

function runtimeHardware(profile: Record<string, any>): string {
  const chip =
    profile.placement?.nodeSelector?.['node.kubernetes.io/npu.chip.name'];
  return chip ? `Ascend ${chip}` : 'Accelerator profile';
}

function runtimeServingParameters(runtime: Record<string, any>) {
  try {
    const config = parse(String(runtime.serveConfigV2 ?? '')) as any;
    const application = config?.applications?.[0];
    const llmConfig = application?.args?.llm_configs?.[0] ?? {};
    const engine = llmConfig.engine_kwargs ?? {};
    const deployment = llmConfig.deployment_config ?? {};
    return {
      tensorParallelSize: engine.tensor_parallel_size,
      dataParallelSize: engine.data_parallel_size,
      pipelineParallelSize: engine.pipeline_parallel_size,
      maxModelLen: engine.max_model_len,
      maxNumSeqs: engine.max_num_seqs,
      maxNumBatchedTokens: engine.max_num_batched_tokens,
      gpuMemoryUtilization: engine.gpu_memory_utilization,
      prefixCaching: engine.enable_prefix_caching,
      mtpTokens: engine.speculative_config?.num_speculative_tokens,
      compilationMode: engine.compilation_config?.cudagraph_mode,
      maxOngoingRequests: deployment.max_ongoing_requests,
    };
  } catch {
    return undefined;
  }
}

async function loadCatalog(config: Config) {
  const gitea = readGiteaConfig(config);
  const repositoryPrefix = `/api/v1/repos/${encodeURIComponent(
    gitea.owner,
  )}/${encodeURIComponent(gitea.repository)}`;
  const models = await Promise.all(
    gitea.allowedModelVersions.map(async modelVersionRef => {
      const modelVersion = await readCatalogDocument(
        gitea,
        repositoryPrefix,
        modelVersionRef,
        'ModelVersion',
      );
      const spec = modelVersion.spec ?? {};
      const artifact = spec.artifact ?? {};
      const format = spec.format ?? {};
      const quantization = String(
        format.quantization ?? spec.quantization?.target ?? '',
      ).toUpperCase();
      const profileRefs = (spec.compatibility?.runtimeProfiles ?? []).filter(
        (profile: string) => gitea.allowedRuntimeProfiles.includes(profile),
      );
      const variants = await Promise.all(
        profileRefs.map(async (profileRef: string) => {
          const profileDocument = await readCatalogDocument(
            gitea,
            repositoryPrefix,
            profileRef,
            'ModelRuntimeProfile',
          );
          const profile = profileDocument.spec ?? {};
          const runtime = profile.runtime ?? {};
          const placement = profile.placement ?? {};
          const nodeSelector = placement.nodeSelector ?? {};
          const resources = profile.resources?.requests ?? {};
          const cardIds = placement.certifiedPhysicalIds
            ? String(placement.certifiedPhysicalIds)
                .split(',')
                .map((id: string) => id.trim())
                .filter(Boolean)
            : [];
          const hardware = runtimeHardware(profile);
          return {
            id: profileRef,
            title: `${quantization || 'Serving'} / ${
              profile.workload?.kind ?? 'Runtime'
            } / ${hardware}`,
            hardware,
            node: nodeSelector['kubernetes.io/hostname'] ?? 'profile-managed',
            accelerator:
              nodeSelector['node.kubernetes.io/npu.chip.name'] ?? 'accelerator',
            cardIds,
            image: runtime.image,
            modelPath: runtime.modelPath,
            modelName: runtime.modelName,
            healthPath: profile.probes?.healthPath ?? '/health',
            inferencePath:
              profile.probes?.inferencePath ?? '/v1/chat/completions',
            npuPerWorker:
              runtime.npuPerWorker ?? resources['huawei.com/Ascend910'] ?? 0,
            workerReplicas:
              runtime.workerReplicas ?? profile.workload?.replicas ?? 0,
            serving: runtimeServingParameters(runtime),
          };
        }),
      );
      const modelName = lastModelName(String(spec.modelId ?? modelVersionRef));
      return {
        id: modelVersionRef,
        title: `${modelName} ${quantization}`.trim(),
        provider: String(spec.modelId ?? '').split('/')[0] || 'Model platform',
        description: `Verified ${
          spec.source?.type ?? 'Artifact Keeper'
        } artifact from the committed ModelVersion catalog.`,
        modelId: spec.modelId,
        revision: String(spec.revision),
        repository: artifact.repository,
        artifactPath: artifact.path,
        fileCount: artifact.fileCount,
        sizeBytes: artifact.sizeBytes,
        format: `${format.family ?? 'model'} / ${format.weights ?? 'weights'}`,
        quantization,
        manifestDigest: artifact.manifestDigest,
        variants,
      };
    }),
  );
  return { source: 'gitea', revision: gitea.baseBranch, models };
}

async function kubernetesGet<T>(path: string): Promise<T> {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  const [token, ca] = await Promise.all([
    readFile(tokenPath, 'utf8'),
    readFile(caPath),
  ]);
  const hostname =
    process.env.KUBERNETES_SERVICE_HOST ?? 'kubernetes.default.svc';
  const port = Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443');
  return new Promise<T>((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname,
        port,
        path,
        method: 'GET',
        ca,
        servername: 'kubernetes.default.svc',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token.trim()}`,
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) {
            reject(
              new Error(`Kubernetes API returned HTTP ${response.statusCode}`),
            );
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Kubernetes API returned invalid JSON'));
          }
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function deploymentSummary(object: KubernetesObject) {
  const status = object.status ?? {};
  const conditions = Array.isArray(status.conditions)
    ? status.conditions.map((condition: Record<string, any>) => ({
        type: condition.type,
        status: condition.status,
        reason: condition.reason,
        message: condition.message,
      }))
    : [];
  return {
    name: object.metadata?.name,
    namespace: object.metadata?.namespace,
    generation: object.metadata?.generation,
    desiredState: object.spec?.desiredState,
    modelVersionRef: object.spec?.modelVersionRef,
    runtimeProfileRef: object.spec?.runtimeProfileRef,
    compositionRef: object.spec?.compositionRef?.name,
    phase: status.phase,
    conditions,
  };
}

function resourceSummary(object: KubernetesObject) {
  const status = object.status ?? {};
  return {
    name: object.metadata?.name,
    namespace: object.metadata?.namespace,
    labels: object.metadata?.labels,
    phase: status.phase,
    ready: status.readyReplicas ?? status.ready,
    active: status.active,
    succeeded: status.succeeded,
    failed: status.failed,
    conditions: Array.isArray(status.conditions)
      ? status.conditions.map((condition: Record<string, any>) => ({
          type: condition.type,
          status: condition.status,
          reason: condition.reason,
          message: condition.message,
        }))
      : [],
  };
}

async function loadDeployments() {
  const namespace = 'model-serving';
  const paths = {
    modeldeployments: `/apis/platform.example.com/v1alpha1/namespaces/${namespace}/modeldeployments`,
    configmaps: `/api/v1/namespaces/${namespace}/configmaps`,
    pvcs: `/api/v1/namespaces/${namespace}/persistentvolumeclaims`,
    jobs: `/apis/batch/v1/namespaces/${namespace}/jobs`,
    services: `/api/v1/namespaces/${namespace}/services`,
    deployments: `/apis/apps/v1/namespaces/${namespace}/deployments`,
    rayservices: `/apis/ray.io/v1/namespaces/${namespace}/rayservices`,
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      try {
        return [key, await kubernetesGet<KubernetesList>(path)] as const;
      } catch (error) {
        if (key === 'rayservices') {
          return [key, { items: [] }] as const;
        }
        throw error;
      }
    }),
  );
  const lists = Object.fromEntries(entries) as Record<string, KubernetesList>;
  const objects = (key: string) => lists[key]?.items ?? [];
  const deployments = objects('modeldeployments').map(deploymentSummary);
  return {
    namespace,
    observedAt: new Date().toISOString(),
    deployments,
    resources: {
      configmaps: objects('configmaps')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
      pvcs: objects('pvcs')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
      jobs: objects('jobs')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
      services: objects('services')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
      deployments: objects('deployments')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
      rayservices: objects('rayservices')
        .filter(
          object =>
            object.metadata?.labels?.['app.kubernetes.io/part-of'] ===
            'model-platform',
        )
        .map(resourceSummary),
    },
  };
}

function sendError(response: Response, error: unknown, status: number) {
  response.status(status).json({
    error:
      error instanceof Error ? error.message : 'model platform request failed',
  });
}

export default createBackendPlugin({
  pluginId: 'model-platform',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        http: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ config, http, logger }) {
        const router = Router();
        router.get(
          '/catalog',
          async (_request: Request, response: Response) => {
            try {
              response.json(await loadCatalog(config));
            } catch (error) {
              logger.warn(`Model catalog read failed: ${String(error)}`);
              sendError(response, error, 502);
            }
          },
        );
        router.get(
          '/deployments',
          async (_request: Request, response: Response) => {
            try {
              response.json(await loadDeployments());
            } catch (error) {
              logger.warn(
                `Model deployment status read failed: ${String(error)}`,
              );
              sendError(response, error, 503);
            }
          },
        );
        // Catalog and status contain no credentials or write capability. Keeping
        // them readable lets the recipe page render before an OIDC session is
        // established; the Scaffolder write action remains authenticated.
        http.addAuthPolicy({ allow: 'unauthenticated', path: '/catalog' });
        http.addAuthPolicy({ allow: 'unauthenticated', path: '/deployments' });
        http.use(router);
      },
    });
  },
});
