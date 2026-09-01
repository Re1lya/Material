import {
  aggregateDeployment,
  type PlatformObject,
} from './modelPlatformStatus';

const deployment = (state = 'Running'): PlatformObject => ({
  metadata: {
    name: 'qwen38-27b',
    namespace: 'model-serving',
    uid: 'deployment-uid',
    labels: {
      'platform.example.com/requested-by': 'gitadmin',
    },
    annotations: {
      'platform.example.com/request-mode':
        state === 'Running' ? 'declarative-running' : 'declarative-stopped',
      'platform.example.com/requested-start-id': 'start-test',
    },
  },
  spec: {
    desiredState: state,
    modelVersionRef: 'qwen3.8-27b-w8a8',
    runtimeProfileRef: 'qwen38-tp2',
    compositionRef: { name: 'modeldeployment-qwen38-ray-v1alpha1' },
    runtime: { workerReplicas: state === 'Running' ? 1 : 0, npuPerWorker: 2 },
  },
  status: {
    conditions: [
      { type: 'Synced', status: 'True' },
      { type: 'Ready', status: 'True' },
    ],
  },
});

const labelled = (name: string, uid: string): PlatformObject => ({
  metadata: {
    name,
    uid,
    labels: {
      'app.kubernetes.io/part-of': 'model-platform',
      'platform.example.com/deployment': 'qwen38-27b',
    },
  },
});

function aggregate(overrides: Record<string, unknown> = {}) {
  const rayservice = labelled('qwen38-27b', 'rayservice-uid');
  rayservice.status = {
    pendingServiceStatus: {
      rayClusterName: 'qwen38-27b-abcde',
      applicationStatuses: { default: { status: 'RUNNING' } },
    },
  };
  const cluster = labelled('qwen38-27b-abcde', 'cluster-uid');
  const pod = labelled('qwen38-27b-abcde-worker-worker-x', 'pod-uid');
  pod.metadata!.labels!['ray.io/node-type'] = 'worker';
  pod.metadata!.annotations = {
    'huawei.com/AscendReal': 'Ascend910-14,Ascend910-15',
  };
  pod.status = { containerStatuses: [{ ready: true }] };
  return aggregateDeployment({
    deployment: deployment(),
    rayservices: [rayservice],
    rayclusters: [cluster],
    pods: [pod],
    services: [],
    events: [],
    pulls: [
      {
        number: 27,
        state: 'open',
        updated_at: '2026-09-01T00:00:00Z',
        head: {
          ref: 'backstage/modeldeployment-running-qwen38-27b',
          sha: 'correct-sha',
        },
      },
      {
        number: 99,
        state: 'open',
        updated_at: '2026-09-01T01:00:00Z',
        head: {
          ref: 'backstage/modeldeployment-running-other-model',
          sha: 'other-sha',
        },
      },
    ],
    pipelineRuns: [
      {
        metadata: {
          name: 'correct-run',
          creationTimestamp: '2026-09-01T00:01:00Z',
        },
        spec: {
          params: [
            {
              name: 'pull-request-head-ref',
              value: 'backstage/modeldeployment-running-qwen38-27b',
            },
            { name: 'revision', value: 'correct-sha' },
          ],
        },
        status: { conditions: [{ status: 'Unknown', reason: 'Running' }] },
      },
      {
        metadata: {
          name: 'unrelated-newer-run',
          creationTimestamp: '2026-09-01T01:01:00Z',
        },
        spec: {
          params: [
            {
              name: 'pull-request-head-ref',
              value: 'backstage/modeldeployment-running-other-model',
            },
          ],
        },
        status: { conditions: [{ status: 'True', reason: 'Succeeded' }] },
      },
    ],
    taskRuns: [],
    argo: {
      status: {
        sync: { status: 'Synced', revision: 'main-sha' },
        health: { status: 'Healthy' },
      },
    },
    ...overrides,
  } as any);
}

describe('model platform deployment aggregation', () => {
  it('associates Tekton by the exact lifecycle branch instead of newest run', () => {
    const result = aggregate();
    expect(result.tekton.pipelineRun).toBe('correct-run');
    expect(result.status).toBe('Validating');
    expect(result.phase).toBe('Tekton');
  });

  it('keeps model health separate from a missing stable serve service', () => {
    const result = aggregate({
      pulls: [{ number: 27, state: 'closed', merged: true }],
      pipelineRuns: [],
    });
    expect(result.serve.modelStatus).toBe('Healthy');
    expect(result.serve.serviceStatus).toBe('Missing');
    expect(result.serve.endpoint).toBeNull();
    expect(result.status).toBe('Deploying');
  });

  it('does not publish an endpoint until both stable and KubeRay services exist', () => {
    const serveService = labelled('qwen38-27b-serve-svc', 'serve-service-uid');
    serveService.spec = { ports: [{ name: 'serve', port: 8000 }] };
    const result = aggregate({
      pulls: [{ number: 27, state: 'closed', merged: true }],
      pipelineRuns: [],
      services: [serveService],
    });
    expect(result.serve.modelStatus).toBe('Healthy');
    expect(result.serve.serviceStatus).toBe('Pending');
    expect(result.serve.endpoint).toBeNull();
    expect(result.status).toBe('Deploying');
  });

  it('filters events to related object identities', () => {
    const result = aggregate({
      events: [
        {
          involvedObject: { uid: 'pod-uid', name: 'worker', kind: 'Pod' },
          reason: 'Scheduled',
          message: 'related',
          lastTimestamp: '2026-09-01T00:00:00Z',
        },
        {
          involvedObject: { uid: 'other-uid', name: 'other', kind: 'Pod' },
          reason: 'Unrelated',
          message: 'must not leak into deployment',
          lastTimestamp: '2026-09-01T01:00:00Z',
        },
      ],
    });
    expect(result.recentEvents).toHaveLength(1);
    expect(result.recentEvents[0].reason).toBe('Scheduled');
  });

  it('reports Stopping while stopped intent still has a ready worker', () => {
    const result = aggregate({ deployment: deployment('Stopped'), pulls: [] });
    expect(result.status).toBe('Stopping');
  });

  it('does not mark the live deployment failed for a closed unmerged request', () => {
    const result = aggregate({
      deployment: deployment('Stopped'),
      pods: [],
      pulls: [
        {
          number: 27,
          state: 'closed',
          merged: false,
          head: {
            ref: 'backstage/modeldeployment-running-qwen38-27b',
            sha: 'failed-sha',
          },
        },
      ],
      pipelineRuns: [
        {
          metadata: { name: 'failed-negative-gate' },
          spec: { params: [{ name: 'revision', value: 'failed-sha' }] },
          status: { conditions: [{ status: 'False', reason: 'Failed' }] },
        },
      ],
    });
    expect(result.status).toBe('Stopped');
    expect(result.tekton.status).toBe('False');
  });
});
