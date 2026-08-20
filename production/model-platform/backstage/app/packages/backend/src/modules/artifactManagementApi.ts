import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import Router from 'express-promise-router';
import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

type ArtifactManagementConfig = {
  enabled: boolean;
  artifactKeeperBaseUrl: string;
  /** @visibility secret */
  provisionToken: string;
  allowedInitiators: string[];
  allowedRepositoryPrefixes: string[];
  allowedFormats: string[];
  maxQuotaBytes: number;
  tokenMaxTtlDays: number;
  allowOneTimeTokenReveal: boolean;
  publishEventListenerUrl: string;
  publishNamespace: string;
};

type JsonObject = Record<string, unknown>;
type KubernetesObject = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  spec?: JsonObject;
  status?: JsonObject;
};
type KubernetesList = { items?: KubernetesObject[] };

const repositoryKeyPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const artifactPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,511}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

function optionalBoolean(
  section: Config,
  key: string,
  fallback: boolean,
): boolean {
  return section.getOptionalBoolean(key) ?? fallback;
}

function readArtifactManagementConfig(config: Config): ArtifactManagementConfig {
  const section = config.getOptionalConfig('modelPlatform.artifactManagement');
  if (!section) {
    return {
      enabled: false,
      artifactKeeperBaseUrl: '',
      provisionToken: '',
      allowedInitiators: [],
      allowedRepositoryPrefixes: ['platform-', 'model-'],
      allowedFormats: ['generic', 'huggingface', 'docker'],
      maxQuotaBytes: 500 * 1024 ** 3,
      tokenMaxTtlDays: 30,
      allowOneTimeTokenReveal: false,
      publishEventListenerUrl: '',
      publishNamespace: 'artifact-publish',
    };
  }
  const artifactKeeperBaseUrl = optionalString(
    section,
    'artifactKeeperBaseUrl',
    '',
  ).replace(/\/$/, '');
  const provisionToken = optionalString(section, 'provisionToken', '');
  return {
    enabled:
      optionalBoolean(section, 'enabled', false) &&
      artifactKeeperBaseUrl.length > 0 &&
      provisionToken.length > 0,
    artifactKeeperBaseUrl,
    provisionToken,
    allowedInitiators: optionalStringArray(section, 'allowedInitiators', [
      'user:default/gitadmin',
    ]),
    allowedRepositoryPrefixes: optionalStringArray(
      section,
      'allowedRepositoryPrefixes',
      ['platform-', 'model-'],
    ),
    allowedFormats: optionalStringArray(section, 'allowedFormats', [
      'generic',
      'huggingface',
      'docker',
    ]),
    maxQuotaBytes: optionalNumber(
      section,
      'maxQuotaBytes',
      500 * 1024 ** 3,
    ),
    tokenMaxTtlDays: optionalNumber(section, 'tokenMaxTtlDays', 30),
    allowOneTimeTokenReveal: optionalBoolean(
      section,
      'allowOneTimeTokenReveal',
      false,
    ),
    publishEventListenerUrl: optionalString(
      section,
      'publishEventListenerUrl',
      '',
    ),
    publishNamespace: optionalString(
      section,
      'publishNamespace',
      'artifact-publish',
    ),
  };
}

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function artifactKeeperRequest<T>(options: {
  config: ArtifactManagementConfig;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  acceptedStatuses?: number[];
}): Promise<{ status: number; value?: T }> {
  if (!options.config.enabled) {
    throw new Error('Artifact Keeper management is not enabled');
  }
  const response = await fetch(
    `${options.config.artifactKeeperBaseUrl}${options.path}`,
    {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.config.provisionToken}`,
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const accepted = options.acceptedStatuses ?? [200];
  if (!accepted.includes(response.status)) {
    throw new Error(
      `Artifact Keeper API ${options.method ?? 'GET'} ${options.path} returned HTTP ${response.status}`,
    );
  }
  if (response.status === 204) return { status: response.status };
  let value: T | undefined;
  try {
    value = (await response.json()) as T;
  } catch {
    value = undefined;
  }
  return { status: response.status, value };
}

function repositoryAllowed(
  key: string,
  prefixes: string[],
): boolean {
  return prefixes.some(prefix => key.startsWith(prefix));
}

function publicRepository(value: unknown): JsonObject {
  const object = (value ?? {}) as JsonObject;
  const allowedKeys = [
    'id',
    'key',
    'name',
    'format',
    'repo_type',
    'description',
    'quota_bytes',
    'storage_quota_bytes',
    'size_bytes',
    'used_bytes',
    'created_at',
    'updated_at',
  ];
  return Object.fromEntries(
    allowedKeys
      .filter(key => object[key] !== undefined)
      .map(key => [key, object[key]]),
  );
}

function normalizeRepositories(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(publicRepository);
  const object = (value ?? {}) as JsonObject;
  for (const key of ['items', 'repositories', 'data']) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).map(publicRepository);
    }
  }
  return [];
}

function requireJsonObject(request: Request): JsonObject {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new Error('request body must be a JSON object');
  }
  return request.body as JsonObject;
}

function stringField(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function numberField(body: JsonObject, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

function sendError(response: Response, error: unknown, status = 400) {
  response.status(status).json({
    error: error instanceof Error ? error.message : 'request failed',
  });
}

async function kubernetesGet<T>(path: string, text = false): Promise<T> {
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
          Accept: text ? 'text/plain' : 'application/json',
          Authorization: `Bearer ${token.trim()}`,
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode !== 200) {
            reject(new Error(`Kubernetes API returned HTTP ${response.statusCode}`));
            return;
          }
          if (text) {
            resolve(body as T);
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
    request.setTimeout(30_000, () => request.destroy(new Error('Kubernetes API timeout')));
    request.end();
  });
}

function publicPipelineRun(object: KubernetesObject): JsonObject {
  const status = object.status ?? {};
  const conditions = Array.isArray(status.conditions)
    ? (status.conditions as JsonObject[]).map(condition => ({
        type: condition.type,
        status: condition.status,
        reason: condition.reason,
        message: condition.message,
      }))
    : [];
  return {
    name: object.metadata?.name,
    namespace: object.metadata?.namespace,
    createdAt: object.metadata?.creationTimestamp,
    labels: object.metadata?.labels,
    pipelineSpec: object.spec?.pipelineSpec,
    status: {
      conditions,
      startTime: status.startTime,
      completionTime: status.completionTime,
      childReferences: status.childReferences,
      results: status.results,
    },
  };
}

function namespacePath(namespace: string, resource: string): string {
  return `/apis/tekton.dev/v1/namespaces/${encodeURIComponent(namespace)}/${resource}`;
}

function listPath(namespace: string, resource: string, label?: string): string {
  const base = namespacePath(namespace, resource);
  return label ? `${base}?labelSelector=${encodeURIComponent(label)}` : base;
}

async function loadPipelineRuns(namespace: string) {
  const response = await kubernetesGet<KubernetesList>(
    listPath(namespace, 'pipelineruns', 'app.kubernetes.io/part-of=model-platform-artifact-publish'),
  );
  return {
    namespace,
    observedAt: new Date().toISOString(),
    items: (response.items ?? []).map(publicPipelineRun),
  };
}

async function loadPipelineRun(namespace: string, name: string) {
  const pipelineRun = await kubernetesGet<KubernetesObject>(
    `${namespacePath(namespace, 'pipelineruns')}/${encodedPathSegment(name)}`,
  );
  const taskRuns = await kubernetesGet<KubernetesList>(
    listPath(namespace, 'taskruns', `tekton.dev/pipelineRun=${name}`),
  );
  return {
    pipelineRun: publicPipelineRun(pipelineRun),
    taskRuns: (taskRuns.items ?? []).map(publicPipelineRun),
  };
}

async function loadTaskRunLog(namespace: string, taskRun: string, tailLines: number) {
  const pods = await kubernetesGet<KubernetesList>(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${encodeURIComponent(`tekton.dev/taskRun=${taskRun}`)}`,
  );
  const pod = pods.items?.[0];
  if (!pod?.metadata?.name) return { taskRun, pod: undefined, log: '' };
  const logPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodedPathSegment(pod.metadata.name)}/log?tailLines=${tailLines}`;
  const log = await kubernetesGet<string>(logPath, true);
  return { taskRun, pod: pod.metadata.name, log };
}

export default createBackendPlugin({
  pluginId: 'artifact-management',
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
        const management = readArtifactManagementConfig(config);

        async function authorize(request: Request) {
          const credentials = await httpAuth.credentials(request, {
            allow: ['user'],
          });
          const userEntityRef = credentials.principal.userEntityRef;
          if (
            management.allowedInitiators.length > 0 &&
            !management.allowedInitiators.includes(userEntityRef)
          ) {
            throw new Error(`Backstage user ${userEntityRef} is not allowed`);
          }
          return userEntityRef;
        }

        router.get('/repositories', async (request, response) => {
          try {
            await authorize(request);
            if (!management.enabled) {
              response.json({
                enabled: false,
                tokenRevealAvailable: false,
                allowedFormats: management.allowedFormats,
                maxQuotaBytes: management.maxQuotaBytes,
                repositories: [],
              });
              return;
            }
            const result = await artifactKeeperRequest<unknown>({
              config: management,
              path: '/api/v1/repositories',
            });
            response.json({
              enabled: management.enabled,
              tokenRevealAvailable:
                management.enabled && management.allowOneTimeTokenReveal,
              allowedFormats: management.allowedFormats,
              maxQuotaBytes: management.maxQuotaBytes,
              repositories: normalizeRepositories(result.value),
            });
          } catch (error) {
            sendError(response, error, management.enabled ? 502 : 503);
          }
        });

        router.post('/repositories', async (request, response) => {
          try {
            const actor = await authorize(request);
            const body = requireJsonObject(request);
            const key = stringField(body, 'key');
            const name = stringField(body, 'name');
            const format = stringField(body, 'format');
            const description =
              typeof body.description === 'string' ? body.description.slice(0, 256) : null;
            const quotaBytes = numberField(body, 'quotaBytes');
            if (!repositoryKeyPattern.test(key)) throw new Error('key is not a valid repository key');
            if (!repositoryAllowed(key, management.allowedRepositoryPrefixes)) {
              throw new Error('repository key is outside the Backstage allow-list');
            }
            if (!management.allowedFormats.includes(format)) {
              throw new Error('repository format is not allowed');
            }
            if (quotaBytes !== undefined && quotaBytes > management.maxQuotaBytes) {
              throw new Error('repository quota exceeds the configured limit');
            }
            const result = await artifactKeeperRequest<JsonObject>({
              config: management,
              method: 'POST',
              path: '/api/v1/repositories',
              acceptedStatuses: [200, 201],
              body: {
                key,
                name,
                format,
                repo_type: 'local',
                description,
                quota_bytes: quotaBytes ?? null,
                allow_anonymous_access: false,
              },
            });
            logger.info(`Artifact repository ${key} created by ${actor}`);
            response.status(201).json(publicRepository(result.value));
          } catch (error) {
            sendError(response, error, management.enabled ? 400 : 503);
          }
        });

        router.post('/tokens', async (request, response) => {
          try {
            const actor = await authorize(request);
            if (!management.allowOneTimeTokenReveal) {
              throw new Error(
                'one-time Token reveal is disabled until Backstage is behind HTTPS and an explicit policy enables it',
              );
            }
            const forwardedProtocol = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
            if (!request.secure && forwardedProtocol !== 'https') {
              throw new Error('Token reveal requires an HTTPS request');
            }
            const body = requireJsonObject(request);
            const repositoryKey = stringField(body, 'repositoryKey');
            const name = stringField(body, 'name');
            const permission = stringField(body, 'permission');
            const ttlDays = numberField(body, 'ttlDays') ?? management.tokenMaxTtlDays;
            if (!repositoryKeyPattern.test(repositoryKey)) throw new Error('repositoryKey is invalid');
            if (!repositoryAllowed(repositoryKey, management.allowedRepositoryPrefixes)) {
              throw new Error('repository is outside the Backstage allow-list');
            }
            if (!['read', 'write'].includes(permission)) {
              throw new Error('permission must be read or write; delete/admin are unavailable');
            }
            if (ttlDays < 1 || ttlDays > management.tokenMaxTtlDays) {
              throw new Error('ttlDays is outside the configured limit');
            }
            const scopes = permission === 'write' ? ['read', 'write'] : ['read'];
            const result = await artifactKeeperRequest<JsonObject>({
              config: management,
              method: 'POST',
              path: `/api/v1/repositories/${encodedPathSegment(repositoryKey)}/tokens`,
              acceptedStatuses: [200, 201],
              body: {
                name: name.slice(0, 128),
                description: `Backstage-created ${permission} token by ${actor}`,
                scopes,
                expires_in_days: ttlDays,
              },
            });
            const token = typeof result.value?.token === 'string' ? result.value.token : undefined;
            if (!token) throw new Error('Artifact Keeper did not return a one-time token value');
            logger.info(`Artifact token ${String(result.value?.id ?? 'unknown')} created for ${repositoryKey} by ${actor}`);
            response.status(201).json({
              id: result.value?.id,
              name: result.value?.name ?? name,
              repositoryKey,
              expiresInDays: ttlDays,
              token,
              warning: 'This value is shown once. Store it in a secret manager immediately.',
            });
          } catch (error) {
            sendError(response, error, management.enabled ? 400 : 503);
          }
        });

        router.get('/publish-runs', async (request, response) => {
          try {
            await authorize(request);
            response.json(await loadPipelineRuns(management.publishNamespace));
          } catch (error) {
            sendError(response, error, 503);
          }
        });

        router.get('/publish-runs/:name', async (request, response) => {
          try {
            await authorize(request);
            if (!repositoryKeyPattern.test(request.params.name)) throw new Error('invalid PipelineRun name');
            response.json(await loadPipelineRun(management.publishNamespace, request.params.name));
          } catch (error) {
            sendError(response, error, 503);
          }
        });

        router.get('/publish-runs/:taskRun/logs', async (request, response) => {
          try {
            await authorize(request);
            if (!repositoryKeyPattern.test(request.params.taskRun)) throw new Error('invalid TaskRun name');
            const rawTail = Number(request.query.tailLines ?? 200);
            const tailLines = Number.isSafeInteger(rawTail) ? Math.min(Math.max(rawTail, 1), 1000) : 200;
            response.json(await loadTaskRunLog(management.publishNamespace, request.params.taskRun, tailLines));
          } catch (error) {
            sendError(response, error, 503);
          }
        });

        router.post('/publish-runs', async (request, response) => {
          try {
            const actor = await authorize(request);
            if (!management.publishEventListenerUrl) {
              throw new Error('Tekton artifact publish EventListener is not configured');
            }
            const body = requireJsonObject(request);
            const repositoryKey = stringField(body, 'repositoryKey');
            const artifactPath = stringField(body, 'artifactPath');
            const sourceRef = stringField(body, 'sourceRef');
            const checksumSha256 = stringField(body, 'checksumSha256');
            const totalSize = numberField(body, 'totalSize');
            const idempotencyKey = stringField(body, 'idempotencyKey');
            if (!repositoryKeyPattern.test(repositoryKey) || !repositoryAllowed(repositoryKey, management.allowedRepositoryPrefixes)) {
              throw new Error('repositoryKey is outside the allow-list');
            }
            if (!artifactPathPattern.test(artifactPath) || artifactPath.includes('..')) {
              throw new Error('artifactPath is invalid');
            }
            if (!sha256Pattern.test(checksumSha256)) throw new Error('checksumSha256 must be lowercase SHA256');
            if (totalSize === undefined || totalSize < 1 || totalSize > management.maxQuotaBytes) {
              throw new Error('totalSize is outside the configured limit');
            }
            if (!idempotencyPattern.test(idempotencyKey)) throw new Error('idempotencyKey is invalid');
            if (!sourceRef.startsWith('staging://')) throw new Error('sourceRef must use the controlled staging:// scheme');
            const eventResponse = await fetch(management.publishEventListenerUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Backstage-Actor': actor,
                'X-Idempotency-Key': idempotencyKey,
              },
              body: JSON.stringify({
                repository_key: repositoryKey,
                artifact_path: artifactPath,
                source_ref: sourceRef,
                checksum_sha256: checksumSha256,
                total_size: totalSize,
                idempotency_key: idempotencyKey,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (![200, 201, 202].includes(eventResponse.status)) {
              throw new Error(`Tekton EventListener returned HTTP ${eventResponse.status}`);
            }
            let eventBody: unknown;
            try {
              eventBody = await eventResponse.json();
            } catch {
              eventBody = undefined;
            }
            response.status(202).json({ accepted: true, event: eventBody });
          } catch (error) {
            sendError(response, error, 400);
          }
        });

        http.use(router);
      },
    });
  },
});
