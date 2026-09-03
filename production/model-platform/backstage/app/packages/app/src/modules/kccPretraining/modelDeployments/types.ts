export type DeploymentStatus =
  | 'Pending'
  | 'Validating'
  | 'Deploying'
  | 'Running'
  | 'Stopping'
  | 'Stopped'
  | 'Failed'
  | 'Unknown';

export type DeploymentEvent = {
  type?: string;
  reason?: string;
  message?: string;
  time?: string;
  count?: number;
  involvedObject?: { name?: string; kind?: string };
};

export type Deployment = {
  name: string;
  namespace?: string;
  desiredState?: string;
  status: DeploymentStatus;
  phase?: string;
  phaseIndex?: number;
  modelVersionRef?: string;
  runtimeProfileRef?: string;
  compositionRef?: string;
  requestedBy?: string;
  requestId?: string;
  observedAt?: string;
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
  }>;
  timeline?: Array<{
    name: string;
    startedAt?: string;
    completedAt?: string;
    durationSeconds?: number;
  }>;
  git?: {
    available?: boolean;
    pullRequest?: number;
    state?: string;
    url?: string;
    branch?: string;
    revision?: string;
  };
  tekton?: {
    available?: boolean;
    pipelineRun?: string;
    status?: string;
    reason?: string;
    currentTask?: string;
    failedTask?: string;
  };
  argo?: {
    available?: boolean;
    revision?: string;
    sync?: string;
    health?: string;
    operationPhase?: string;
    message?: string;
  };
  crossplane?: {
    synced?: boolean;
    ready?: boolean;
    reason?: string;
    message?: string;
  };
  ray?: {
    service?: string;
    activeCluster?: string;
    pendingCluster?: string;
    clusters?: string[];
    requestedWorkers?: number;
    readyWorkers?: number;
  };
  npu?: { requested?: number; actualDevices?: string[] };
  serve?: {
    modelStatus?: string;
    serviceStatus?: string;
    gatewayStatus?: string;
    stableService?: string;
    serveService?: string;
    endpoint?: string | null;
    readyEndpoint?: boolean;
    probeEligible?: boolean;
    modelProbe?: { attemptedAt: string; ok: boolean; message?: string };
  };
  recentEvents?: DeploymentEvent[];
  unavailable?: Record<string, string>;
};

export type DeploymentsResponse = {
  observedAt?: string;
  deployments?: Deployment[];
  unavailable?: Record<string, string>;
};
