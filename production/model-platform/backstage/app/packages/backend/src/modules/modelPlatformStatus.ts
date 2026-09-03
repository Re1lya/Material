export type PlatformObject = {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    generation?: number;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  involvedObject?: {
    uid?: string;
    name?: string;
    kind?: string;
    namespace?: string;
  };
  spec?: Record<string, any>;
  endpoints?: Array<Record<string, any>>;
  status?: Record<string, any>;
  data?: Record<string, string>;
  type?: string;
  reason?: string;
  message?: string;
  eventTime?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  count?: number;
};

export type GiteaPull = {
  number?: number;
  state?: string;
  merged?: boolean;
  merged_at?: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
};

type AggregationInput = {
  deployment: PlatformObject;
  rayservices: PlatformObject[];
  rayclusters: PlatformObject[];
  pods: PlatformObject[];
  services: PlatformObject[];
  endpointSlices?: PlatformObject[];
  events: PlatformObject[];
  pipelineRuns: PlatformObject[];
  taskRuns: PlatformObject[];
  pulls: GiteaPull[];
  argo?: PlatformObject;
  modelProbe?: { attemptedAt: string; ok: boolean; message?: string };
  unavailable?: Record<string, string>;
};

const deploymentLabel = 'platform.example.com/deployment';

function conditions(object: PlatformObject) {
  const values = object.status?.conditions;
  return Array.isArray(values)
    ? values.map((entry: Record<string, any>) => ({
        type: entry.type,
        status: entry.status,
        reason: entry.reason,
        message: entry.message,
      }))
    : [];
}

function condition(object: PlatformObject, type: string) {
  return conditions(object).find(value => value.type === type);
}

function labels(object: PlatformObject) {
  return object.metadata?.labels ?? {};
}

function annotations(object: PlatformObject) {
  return object.metadata?.annotations ?? {};
}

function belongsTo(object: PlatformObject, deployment: string) {
  return (
    labels(object)[deploymentLabel] === deployment ||
    labels(object)['crossplane.io/composite'] === deployment ||
    object.metadata?.name?.startsWith(`${deployment}-`) === true
  );
}

function tektonParam(run: PlatformObject, name: string) {
  const params = run.spec?.params;
  if (!Array.isArray(params)) return undefined;
  const entry = params.find((item: Record<string, any>) => item.name === name);
  return entry?.value;
}

function lifecyclePull(pull: GiteaPull, deployment: string) {
  const ref = pull.head?.ref ?? '';
  return [
    `backstage/modeldeployment-running-${deployment}`,
    `backstage/modeldeployment-stopping-${deployment}`,
    `backstage/modeldeployment-updating-${deployment}`,
  ].includes(ref);
}

function newest<T>(items: T[], timestamp: (item: T) => string | undefined) {
  return [...items].sort((left, right) =>
    String(timestamp(right) ?? '').localeCompare(String(timestamp(left) ?? '')),
  )[0];
}

function pipelineCondition(run?: PlatformObject) {
  const values = run?.status?.conditions;
  return Array.isArray(values) ? values[0] : undefined;
}

function durationSeconds(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function timelineEntry(name: string, startedAt?: string, completedAt?: string) {
  return {
    name,
    startedAt,
    completedAt,
    durationSeconds: durationSeconds(startedAt, completedAt),
  };
}

function actualDevices(pods: PlatformObject[]) {
  const devices = new Set<string>();
  pods.forEach(pod => {
    const podAnnotations = annotations(pod);
    const value =
      podAnnotations['huawei.com/AscendReal'] ??
      podAnnotations['huawei.com/Ascend910'];
    String(value ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => devices.add(item));
  });
  return [...devices];
}

function applicationState(rayservice?: PlatformObject) {
  const statuses = [
    rayservice?.status?.activeServiceStatus?.applicationStatuses,
    rayservice?.status?.pendingServiceStatus?.applicationStatuses,
  ];
  for (const applications of statuses) {
    if (!applications || typeof applications !== 'object') continue;
    const values = Object.values(applications) as Record<string, any>[];
    if (values.some(value => value.status === 'RUNNING')) return 'Healthy';
    if (values.some(value => value.status === 'DEPLOY_FAILED')) return 'Failed';
    if (values.some(value => value.status === 'DEPLOYING')) return 'Deploying';
  }
  return 'Unknown';
}

function normalizedPhase(input: {
  desiredState?: string;
  synced?: string;
  ready?: string;
  pull?: GiteaPull;
  pipelineStatus?: string;
  argoSync?: string;
  rayclusters: PlatformObject[];
  modelStatus: string;
  serviceStatus: string;
  readyEndpoint: boolean;
  modelProbeOk?: boolean;
  actualWorkerReplicas: number;
}) {
  const { desiredState, synced, ready, pull, pipelineStatus } = input;
  if (pull?.state === 'open') {
    if (pipelineStatus === 'False') {
      return { status: 'Failed', phase: 'Tekton', phaseIndex: 2 };
    }
    if (pipelineStatus === 'Unknown') {
      return { status: 'Validating', phase: 'Tekton', phaseIndex: 2 };
    }
    return { status: 'Pending', phase: 'Git PR', phaseIndex: 1 };
  }
  if (synced === 'False' || ready === 'False') {
    return { status: 'Failed', phase: 'Crossplane', phaseIndex: 4 };
  }
  if (input.argoSync && input.argoSync !== 'Synced') {
    return { status: 'Deploying', phase: 'Argo', phaseIndex: 3 };
  }
  if (desiredState === 'Stopped') {
    if (input.actualWorkerReplicas > 0) {
      return { status: 'Stopping', phase: 'RayCluster', phaseIndex: 5 };
    }
    return { status: 'Stopped', phase: 'Stopped', phaseIndex: 5 };
  }
  if (desiredState !== 'Running') {
    return { status: 'Unknown', phase: 'Unknown', phaseIndex: -1 };
  }
  if (input.rayclusters.length === 0 || input.actualWorkerReplicas === 0) {
    return { status: 'Deploying', phase: 'RayCluster', phaseIndex: 5 };
  }
  if (input.modelStatus === 'Failed') {
    return { status: 'Failed', phase: 'Model load', phaseIndex: 6 };
  }
  if (input.modelStatus !== 'Healthy') {
    return { status: 'Deploying', phase: 'Model load', phaseIndex: 6 };
  }
  if (input.serviceStatus !== 'Ready' || !input.readyEndpoint) {
    return { status: 'Deploying', phase: 'Service pending', phaseIndex: 7 };
  }
  if (input.modelProbeOk) {
    return { status: 'Running', phase: 'Healthy', phaseIndex: 7 };
  }
  // Never infer model readiness from Pods, Ray, or Service objects alone.
  return { status: 'Deploying', phase: 'Serving pending', phaseIndex: 7 };
}

export function aggregateDeployment(input: AggregationInput) {
  const deployment = input.deployment;
  const name = deployment.metadata?.name ?? 'unknown';
  const relatedRayservices = input.rayservices.filter(item =>
    belongsTo(item, name),
  );
  const relatedRayclusters = input.rayclusters.filter(item =>
    belongsTo(item, name),
  );
  const relatedPods = input.pods.filter(item => belongsTo(item, name));
  const relatedServices = input.services.filter(
    item => belongsTo(item, name) || item.metadata?.name === name,
  );
  const rayservice = relatedRayservices[0];
  const pull = newest(
    input.pulls.filter(item => lifecyclePull(item, name)),
    item => item.updated_at ?? item.created_at,
  );
  const runs = input.pipelineRuns.filter(run => {
    const branch = tektonParam(run, 'pull-request-head-ref');
    const revision = tektonParam(run, 'revision');
    const pullNumber = tektonParam(run, 'pull-request-number');
    return (
      branch === pull?.head?.ref ||
      revision === pull?.head?.sha ||
      (pull?.number !== undefined && String(pull.number) === String(pullNumber))
    );
  });
  const pipelineRun = newest(runs, item => item.metadata?.creationTimestamp);
  const pipeline = pipelineCondition(pipelineRun);
  const taskRuns = input.taskRuns.filter(
    item =>
      labels(item)['tekton.dev/pipelineRun'] === pipelineRun?.metadata?.name,
  );
  const failedTask = taskRuns.find(
    item => pipelineCondition(item)?.status === 'False',
  );
  const runningTask = taskRuns.find(
    item => pipelineCondition(item)?.status === 'Unknown',
  );

  const relatedUids = new Set(
    [deployment, ...relatedRayservices, ...relatedRayclusters, ...relatedPods]
      .map(item => item.metadata?.uid)
      .filter(Boolean),
  );
  const relatedNames = new Set(
    [deployment, ...relatedRayservices, ...relatedRayclusters, ...relatedPods]
      .map(item => item.metadata?.name)
      .filter(Boolean),
  );
  const events = input.events
    .filter(
      event =>
        relatedUids.has(event.involvedObject?.uid) ||
        relatedNames.has(event.involvedObject?.name),
    )
    .sort((left, right) =>
      String(
        right.eventTime ??
          right.lastTimestamp ??
          right.metadata?.creationTimestamp,
      ).localeCompare(
        String(
          left.eventTime ??
            left.lastTimestamp ??
            left.metadata?.creationTimestamp,
        ),
      ),
    )
    .slice(0, 12)
    .map(event => ({
      type: event.type,
      reason: event.reason,
      message: event.message,
      count: event.count,
      time:
        event.eventTime ??
        event.lastTimestamp ??
        event.metadata?.creationTimestamp,
      involvedObject: event.involvedObject,
    }));

  const workerPods = relatedPods.filter(
    pod => labels(pod)['ray.io/node-type'] === 'worker',
  );
  const readyWorkers = workerPods.filter(pod =>
    (pod.status?.containerStatuses ?? []).some(
      (container: Record<string, any>) => container.ready === true,
    ),
  ).length;
  const requestedWorkers = Number(
    deployment.spec?.runtime?.workerReplicas ?? 0,
  );
  const modelStatus = applicationState(rayservice);
  const serveService = relatedServices.find(
    service => service.metadata?.name === `${name}-serve-svc`,
  );
  const stableService = relatedServices.find(
    service => service.metadata?.name === name,
  );
  const servePorts = Array.isArray(serveService?.spec?.ports)
    ? serveService?.spec?.ports
    : [];
  let serviceStatus = 'Missing';
  if (
    stableService &&
    serveService &&
    servePorts.some(
      (port: Record<string, any>) =>
        port.name === 'serve' || String(port.name ?? '').startsWith('serve-'),
    )
  ) {
    serviceStatus = 'Ready';
  } else if (stableService || serveService) {
    serviceStatus = 'Pending';
  }
  const readyEndpoint = (input.endpointSlices ?? []).some(slice => {
    const serviceName = labels(slice)['kubernetes.io/service-name'];
    if (serviceName !== serveService?.metadata?.name) return false;
    const endpoints = slice.endpoints;
    return Array.isArray(endpoints) && endpoints.some(
      (endpoint: Record<string, any>) => endpoint.conditions?.ready === true,
    );
  });
  const argo = input.argo?.status ?? {};
  const synced = condition(deployment, 'Synced');
  const ready = condition(deployment, 'Ready');
  const normalized = normalizedPhase({
    desiredState: deployment.spec?.desiredState,
    synced: synced?.status,
    ready: ready?.status,
    pull,
    pipelineStatus: pipeline?.status,
    argoSync: argo.sync?.status,
    rayclusters: relatedRayclusters,
    modelStatus,
    serviceStatus,
    readyEndpoint,
    modelProbeOk: input.modelProbe?.ok,
    actualWorkerReplicas: workerPods.length,
  });
  const podReadyAt = newest(workerPods, pod => {
    const values = pod.status?.conditions;
    const ready = Array.isArray(values)
      ? values.find((item: Record<string, any>) => item.type === 'Ready' && item.status === 'True')
      : undefined;
    return ready?.lastTransitionTime;
  });
  const timeline = [
    timelineEntry('Request', pull?.created_at),
    timelineEntry('Git PR', pull?.created_at, pull?.merged_at ?? pull?.updated_at),
    timelineEntry('Tekton', pipelineRun?.status?.startTime, pipelineRun?.status?.completionTime),
    timelineEntry('Argo', argo.operationState?.startedAt, argo.operationState?.finishedAt),
    timelineEntry('Crossplane', deployment.metadata?.creationTimestamp),
    timelineEntry('RayCluster', newest(relatedRayclusters, item => item.metadata?.creationTimestamp)?.metadata?.creationTimestamp),
    timelineEntry('Pod Ready', podReadyAt?.status?.conditions?.find((item: Record<string, any>) => item.type === 'Ready' && item.status === 'True')?.lastTransitionTime),
    timelineEntry('Model loading', rayservice?.metadata?.creationTimestamp),
    timelineEntry('First /v1/models', input.modelProbe?.attemptedAt, input.modelProbe?.ok ? input.modelProbe.attemptedAt : undefined),
  ];

  return {
    name,
    namespace: deployment.metadata?.namespace,
    generation: deployment.metadata?.generation,
    observedAt: new Date().toISOString(),
    desiredState: deployment.spec?.desiredState,
    status: normalized.status,
    phase: normalized.phase,
    phaseIndex: normalized.phaseIndex,
    modelVersionRef: deployment.spec?.modelVersionRef,
    expectedModelName: deployment.spec?.runtime?.modelName,
    runtimeProfileRef: deployment.spec?.runtimeProfileRef,
    compositionRef: deployment.spec?.compositionRef?.name,
    requestedBy: labels(deployment)['platform.example.com/requested-by'],
    requestMode: annotations(deployment)['platform.example.com/request-mode'],
    requestId:
      annotations(deployment)['platform.example.com/requested-update-id'] ??
      annotations(deployment)['platform.example.com/requested-start-id'],
    conditions: conditions(deployment),
    timeline,
    git: pull
      ? {
          available: true,
          pullRequest: pull.number,
          state: pull.merged ? 'merged' : pull.state,
          url: pull.html_url,
          branch: pull.head?.ref,
          revision: pull.head?.sha,
        }
      : { available: input.unavailable?.gitea === undefined },
    tekton: pipelineRun
      ? {
          available: true,
          pipelineRun: pipelineRun.metadata?.name,
          status: pipeline?.status,
          reason: pipeline?.reason,
          currentTask: labels(runningTask ?? failedTask ?? {})[
            'tekton.dev/pipelineTask'
          ],
          failedTask: labels(failedTask ?? {})['tekton.dev/pipelineTask'],
          startTime: pipelineRun.status?.startTime,
          completionTime: pipelineRun.status?.completionTime,
        }
      : { available: input.unavailable?.tekton === undefined },
    argo: input.argo
      ? {
          available: true,
          revision: argo.sync?.revision,
          sync: argo.sync?.status,
          health: argo.health?.status,
          operationPhase: argo.operationState?.phase,
          message: argo.operationState?.message,
        }
      : { available: false },
    crossplane: {
      synced: synced?.status === 'True',
      ready: ready?.status === 'True',
      reason: ready?.reason ?? synced?.reason,
      message: ready?.message ?? synced?.message,
    },
    ray: {
      service: rayservice?.metadata?.name,
      activeCluster: rayservice?.status?.activeServiceStatus?.rayClusterName,
      pendingCluster: rayservice?.status?.pendingServiceStatus?.rayClusterName,
      clusters: relatedRayclusters.map(item => item.metadata?.name),
      requestedWorkers,
      readyWorkers,
    },
    npu: {
      requested:
        Number(deployment.spec?.runtime?.npuPerWorker ?? 0) * requestedWorkers,
      actualDevices: actualDevices(workerPods),
    },
    serve: {
      modelStatus,
      serviceStatus,
      gatewayStatus: 'NotConfigured',
      stableService: stableService?.metadata?.name,
      serveService: serveService?.metadata?.name,
      readyEndpoint,
      endpoint:
        serviceStatus === 'Ready'
          ? `http://${name}.${deployment.metadata?.namespace}.svc.cluster.local`
          : null,
      modelProbe: input.modelProbe,
      probeEligible:
        deployment.spec?.desiredState === 'Running' &&
        readyWorkers === requestedWorkers &&
        requestedWorkers > 0 &&
        modelStatus === 'Healthy' &&
        serviceStatus === 'Ready' &&
        readyEndpoint,
    },
    recentEvents: events,
    unavailable: input.unavailable ?? {},
  };
}
