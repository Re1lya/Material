import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import Router from 'express-promise-router';
import { json, type Request, type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

type DataPipelineConfig = {
  enabled: boolean;
  namespace: string;
  deploymentName: string;
  rayClusterName: string;
  dagsterBaseUrl: string;
  allowedInitiators: string[];
  jobName: string;
  profileName: string;
  manifestBucket: string;
  manifestPrefix: string;
  sourceBucket: string;
  sourcePrefix: string;
  outputBucket: string;
  outputPrefix: string;
  documentCount: number;
  maxDocumentInflight: number;
  stage1Version: string;
  image: string;
  sourceCommit: string;
};

type KubernetesObject = { status?: Record<string, unknown> };
type DagsterRun = {
  runId?: string;
  pipelineName?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
};
type RepositoryNode = {
  name?: string;
  location?: { name?: string };
  pipelines?: Array<{ name?: string }>;
};
type JsonObject = Record<string, unknown>;

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const safeS3Key = /^[A-Za-z0-9][A-Za-z0-9._/@+=:-]*$/;

function optionalString(section: Config, key: string, fallback: string): string {
  return section.getOptionalString(key) ?? fallback;
}

function optionalStringArray(
  section: Config,
  key: string,
  fallback: string[],
): string[] {
  return section.getOptionalStringArray(key) ?? fallback;
}

function optionalNumber(section: Config, key: string, fallback: number): number {
  return section.getOptionalNumber(key) ?? fallback;
}

function readConfig(config: Config): DataPipelineConfig {
  const section = config.getOptionalConfig('modelPlatform.dataPipeline');
  if (!section) {
    return {
      enabled: false,
      namespace: 'k12',
      deploymentName: 'k12-platform-cpu-k12-clean-qa-pipeline-dagster',
      rayClusterName: 'k12-platform-cpu-k12-clean-qa-pipeline-k12-clean-qa',
      dagsterBaseUrl: '',
      allowedInitiators: [],
      jobName: 'cleanjopbstage1_10',
      profileName: 'k12-stage1-clean-v1',
      manifestBucket: 'k12-cleaned-corpus',
      manifestPrefix: 'cpu-smoke/manifests/',
      sourceBucket: 'k12-mineru-output',
      sourcePrefix: 'full-output/mineru34-hybrid-a3-full-20260722T104600Z',
      outputBucket: 'k12-cleaned-corpus',
      outputPrefix: 'stage1/platform-smoke/',
      documentCount: 10,
      maxDocumentInflight: 8,
      stage1Version: 'stage1-v1.0.2',
      image: '',
      sourceCommit: '',
    };
  }
  const dagsterBaseUrl = optionalString(section, 'dagsterBaseUrl', '').replace(
    /\/$/,
    '',
  );
  return {
    enabled:
      section.getOptionalBoolean('enabled') === true &&
      dagsterBaseUrl.length > 0,
    namespace: optionalString(section, 'namespace', 'k12'),
    deploymentName: optionalString(
      section,
      'deploymentName',
      'k12-platform-cpu-k12-clean-qa-pipeline-dagster',
    ),
    rayClusterName: optionalString(
      section,
      'rayClusterName',
      'k12-platform-cpu-k12-clean-qa-pipeline-k12-clean-qa',
    ),
    dagsterBaseUrl,
    allowedInitiators: optionalStringArray(section, 'allowedInitiators', [
      'user:default/gitadmin',
    ]),
    jobName: optionalString(section, 'jobName', 'cleanjopbstage1_10'),
    profileName: optionalString(section, 'profileName', 'k12-stage1-clean-v1'),
    manifestBucket: optionalString(
      section,
      'manifestBucket',
      'k12-cleaned-corpus',
    ),
    manifestPrefix: optionalString(
      section,
      'manifestPrefix',
      'cpu-smoke/manifests/',
    ),
    sourceBucket: optionalString(
      section,
      'sourceBucket',
      'k12-mineru-output',
    ),
    sourcePrefix: optionalString(
      section,
      'sourcePrefix',
      'full-output/mineru34-hybrid-a3-full-20260722T104600Z',
    ),
    outputBucket: optionalString(
      section,
      'outputBucket',
      'k12-cleaned-corpus',
    ),
    outputPrefix: optionalString(
      section,
      'outputPrefix',
      'stage1/platform-smoke/',
    ),
    documentCount: optionalNumber(section, 'documentCount', 10),
    maxDocumentInflight: optionalNumber(section, 'maxDocumentInflight', 8),
    stage1Version: optionalString(
      section,
      'stage1Version',
      'stage1-v1.0.2',
    ),
    image: optionalString(section, 'image', ''),
    sourceCommit: optionalString(section, 'sourceCommit', ''),
  };
}

function requireBody(request: Request): JsonObject {
  if (
    !request.body ||
    typeof request.body !== 'object' ||
    Array.isArray(request.body)
  ) {
    throw new Error('request body must be a JSON object');
  }
  return request.body as JsonObject;
}

function requiredString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function sendError(response: Response, error: unknown, status = 400) {
  response.status(status).json({
    error:
      error instanceof Error ? error.message : 'data pipeline request failed',
  });
}

async function kubernetesGet<T>(path: string): Promise<T> {
  const [token, ca] = await Promise.all([
    readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8'),
    readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),
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
          if (response.statusCode !== 200) {
            reject(
              new Error(`Kubernetes API returned HTTP ${response.statusCode}`),
            );
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch {
            reject(new Error('Kubernetes API returned invalid JSON'));
          }
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(15_000, () =>
      request.destroy(new Error('Kubernetes API timeout')),
    );
    request.end();
  });
}

async function deploymentReady(config: DataPipelineConfig) {
  try {
    const deployment = await kubernetesGet<KubernetesObject>(
      `/apis/apps/v1/namespaces/${encodeURIComponent(
        config.namespace,
      )}/deployments/${encodeURIComponent(config.deploymentName)}`,
    );
    const available = Number(deployment.status?.availableReplicas ?? 0);
    return available >= 1
      ? {
          phase: 'ready' as const,
          message: 'Platform-managed K12 Dagster release is Ready.',
        }
      : {
          phase: 'unavailable' as const,
          message: 'K12 Dagster Deployment exists but is not Available.',
        };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Kubernetes status unavailable';
    return detail.includes('HTTP 404')
      ? {
          phase: 'not-deployed' as const,
          message: 'Platform-managed K12 Dagster release is not deployed.',
        }
      : {
          phase: 'unavailable' as const,
          message: 'K12 Dagster Deployment status cannot be read.',
        };
  }
}

async function rayRuntimeReady(config: DataPipelineConfig) {
  try {
    const cluster = await kubernetesGet<KubernetesObject>(
      `/apis/ray.io/v1/namespaces/${encodeURIComponent(
        config.namespace,
      )}/rayclusters/${encodeURIComponent(config.rayClusterName)}`,
    );
    const state = String(cluster.status?.state ?? '').toLowerCase();
    const readyWorkers = Number(cluster.status?.readyWorkerReplicas ?? 0);
    return state === 'ready' && readyWorkers >= 1
      ? {
          phase: 'ready' as const,
          message: `CPU Ray runtime is Ready with ${readyWorkers} worker.`,
        }
      : {
          phase: 'unavailable' as const,
          message: `CPU Ray runtime is not Ready (state=${state || 'unknown'}, workers=${readyWorkers}).`,
        };
  } catch {
    return {
      phase: 'unavailable' as const,
      message: 'CPU Ray runtime status cannot be read.',
    };
  }
}

async function dagsterGraphql<T>(
  config: DataPipelineConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!config.dagsterBaseUrl) {
    throw new Error('Dagster endpoint is not configured');
  }
  const response = await fetch(`${config.dagsterBaseUrl}/graphql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Dagster GraphQL returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    throw new Error(
      body.errors.map(error => error.message ?? 'GraphQL error').join('; '),
    );
  }
  if (!body.data) throw new Error('Dagster GraphQL returned no data');
  return body.data;
}

async function dagsterReachable(config: DataPipelineConfig) {
  if (!config.dagsterBaseUrl) {
    return {
      phase: 'not-configured' as const,
      message: 'Dagster endpoint is not configured.',
    };
  }
  try {
    const response = await fetch(`${config.dagsterBaseUrl}/server_info`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Dagster returned HTTP ${response.status}`);
    return {
      phase: 'ready' as const,
      message: 'K12 Dagster API is reachable.',
      url: config.dagsterBaseUrl,
    };
  } catch {
    return {
      phase: 'unavailable' as const,
      message: 'K12 Dagster API is not reachable.',
      url: config.dagsterBaseUrl,
    };
  }
}

async function dagsterRuns(config: DataPipelineConfig): Promise<DagsterRun[]> {
  const data = await dagsterGraphql<{
    runsOrError?: { results?: DagsterRun[] };
  }>(
    config,
    '{ runsOrError(limit: 40) { __typename ... on Runs { results { runId pipelineName status startTime endTime } } } }',
  );
  return (data.runsOrError?.results ?? [])
    .filter(run => run.pipelineName === config.jobName)
    .slice(0, 20);
}

async function dagsterSelector(config: DataPipelineConfig) {
  const data = await dagsterGraphql<{
    repositoriesOrError?: {
      nodes?: RepositoryNode[];
      message?: string;
    };
  }>(
    config,
    `query K12Repositories {
      repositoriesOrError {
        __typename
        ... on RepositoryConnection {
          nodes { name location { name } pipelines { name } }
        }
        ... on PythonError { message }
      }
    }`,
  );
  const result = data.repositoriesOrError;
  const repository = result?.nodes?.find(node =>
    node.pipelines?.some(pipeline => pipeline.name === config.jobName),
  );
  if (!repository?.name || !repository.location?.name) {
    throw new Error(
      result?.message ?? `Dagster job ${config.jobName} is not available`,
    );
  }
  return {
    pipelineName: config.jobName,
    repositoryName: repository.name,
    repositoryLocationName: repository.location.name,
  };
}

function manifestKey(config: DataPipelineConfig, manifestRef: string): string {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(manifestRef);
  if (!match) throw new Error('manifestRef must be an s3:// URI');
  const [, bucket, key] = match;
  if (bucket !== config.manifestBucket) {
    throw new Error(`manifestRef bucket must be ${config.manifestBucket}`);
  }
  if (
    !key.startsWith(config.manifestPrefix) ||
    key.includes('..') ||
    !safeS3Key.test(key)
  ) {
    throw new Error(
      `manifestRef must stay inside s3://${config.manifestBucket}/${config.manifestPrefix}`,
    );
  }
  return key;
}

async function launchDagsterRun(
  config: DataPipelineConfig,
  requestedBy: string,
  requestName: string,
  manifestRef: string,
) {
  const selector = await dagsterSelector(config);
  const selectionManifestKey = manifestKey(config, manifestRef);
  const outputPrefix = `${config.outputPrefix}${requestName}`;
  const runConfigData = {
    ops: {
      resolve_source_manifest: {
        config: {
          source_bucket: config.sourceBucket,
          source_prefix: config.sourcePrefix,
          output_bucket: config.outputBucket,
          output_prefix: outputPrefix,
          selection_manifest_key: selectionManifestKey,
          count: config.documentCount,
          resume: true,
          cpu_workers: config.maxDocumentInflight,
          max_document_inflight: config.maxDocumentInflight,
          stage1_version: config.stage1Version,
          automated_validation: false,
          dry_run: false,
        },
      },
    },
  };
  const data = await dagsterGraphql<{
    launchRun?: {
      __typename?: string;
      run?: { runId?: string; status?: string; pipelineName?: string };
      message?: string;
    };
  }>(
    config,
    `mutation LaunchK12Run($executionParams: ExecutionParams!) {
      launchRun(executionParams: $executionParams) {
        __typename
        ... on LaunchRunSuccess { run { runId status pipelineName } }
        ... on PythonError { message }
      }
    }`,
    {
      executionParams: {
        selector,
        runConfigData,
        mode: 'default',
        executionMetadata: {
          tags: [
            { key: 'backstage/request-name', value: requestName },
            { key: 'backstage/requested-by', value: requestedBy },
            { key: 'model-platform/profile', value: config.profileName },
            { key: 'model-platform/npu-enabled', value: 'false' },
            { key: 'model-platform/output-prefix', value: outputPrefix },
          ],
        },
      },
    },
  );
  const result = data.launchRun;
  if (result?.__typename !== 'LaunchRunSuccess' || !result.run?.runId) {
    throw new Error(
      result?.message ??
        `Dagster launch returned ${result?.__typename ?? 'no result'}`,
    );
  }
  return {
    runId: result.run.runId,
    status: result.run.status,
    jobName: result.run.pipelineName ?? config.jobName,
    outputPrefix: `s3://${config.outputBucket}/${outputPrefix}`,
  };
}

export default createBackendPlugin({
  pluginId: 'data-pipeline',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        http: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        logger: coreServices.logger,
      },
      async init({ config, http, httpAuth, logger }) {
        const router = Router();
        router.use(json({ limit: '32kb' }));
        const pipeline = readConfig(config);
        async function actor(request: Request) {
          const credentials = await httpAuth.credentials(request, {
            allow: ['user'],
          });
          const user = credentials.principal.userEntityRef;
          if (!pipeline.allowedInitiators.includes(user)) {
            throw new Error(`Backstage user ${user} is not allowed`);
          }
          return user;
        }

        router.get('/status', async (request, response) => {
          try {
            await actor(request);
            const [foundation, runtime] = await Promise.all([
              deploymentReady(pipeline),
              rayRuntimeReady(pipeline),
            ]);
            const dagster =
              foundation.phase === 'ready'
                ? await dagsterReachable(pipeline)
                : {
                    phase: 'not-configured' as const,
                    message: 'Dagster is queried after the K12 release is Ready.',
                  };
            response.json({
              enabled: pipeline.enabled,
              namespace: pipeline.namespace,
              release: {
                image: pipeline.image || undefined,
                sourceCommit: pipeline.sourceCommit || undefined,
              },
              foundation,
              runtime,
              dagster,
              execution: {
                mode: 'dagster-allowlisted-k12-stage1',
                jobName: pipeline.jobName,
                profileName: pipeline.profileName,
                manifestPrefix: `s3://${pipeline.manifestBucket}/${pipeline.manifestPrefix}`,
                outputPrefix: `s3://${pipeline.outputBucket}/${pipeline.outputPrefix}`,
                message: pipeline.enabled
                  ? `Launches only ${pipeline.jobName}; Ray/NPU parameters are not accepted.`
                  : 'K12 run launch is disabled by Backstage configuration.',
              },
            });
          } catch (error) {
            sendError(response, error, 503);
          }
        });

        router.get('/runs', async (request, response) => {
          try {
            await actor(request);
            response.json({ items: await dagsterRuns(pipeline) });
          } catch (error) {
            sendError(response, error, 503);
          }
        });

        router.post('/runs', async (request, response) => {
          try {
            const requestedBy = await actor(request);
            if (!pipeline.enabled) throw new Error('K12 run launch is disabled');
            const [foundation, runtime, dagster] = await Promise.all([
              deploymentReady(pipeline),
              rayRuntimeReady(pipeline),
              dagsterReachable(pipeline),
            ]);
            if (foundation.phase !== 'ready') {
              throw new Error('K12 Dagster release is not Ready');
            }
            if (runtime.phase !== 'ready') {
              throw new Error('K12 CPU Ray runtime is not Ready');
            }
            if (dagster.phase !== 'ready') {
              throw new Error('K12 Dagster API is not Ready');
            }
            const body = requireBody(request);
            const requestName = requiredString(body, 'requestName');
            const manifestRef = requiredString(body, 'manifestRef');
            const profile = requiredString(body, 'profile');
            if (!dnsLabel.test(requestName)) {
              throw new Error('requestName must be a DNS label');
            }
            if (profile !== pipeline.profileName) {
              throw new Error(`only ${pipeline.profileName} is allowed`);
            }
            const run = await launchDagsterRun(
              pipeline,
              requestedBy,
              requestName,
              manifestRef,
            );
            logger.info(
              `Launched ${run.jobName} run ${run.runId} for ${requestName} by ${requestedBy}`,
            );
            response.status(201).json(run);
          } catch (error) {
            sendError(response, error, 400);
          }
        });
        http.use(router);
      },
    });
  },
});
