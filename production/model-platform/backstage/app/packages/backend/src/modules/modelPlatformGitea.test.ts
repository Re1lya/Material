import { ConfigReader } from '@backstage/config';
import { parse } from 'yaml';
import {
  createStartInferenceAction,
  createStopInferenceAction,
  renderServingRuntime,
} from './modelPlatformGitea';

const originalFetch = globalThis.fetch;

const config = new ConfigReader({
  modelPlatform: {
    gitea: {
      apiBaseUrl: 'http://gitea.example.test/api/v1',
      owner: 'gitadmin',
      repository: 'model-platform-config',
      baseBranch: 'main',
      token: 'test-token-with-sufficient-length',
      allowedInitiators: ['user:default/gitadmin'],
      allowedModelVersions: ['qwen3.8-27b-w8a8'],
      allowedRuntimeProfiles: ['qwen38-w8a8-ray-ascend-910b3-tp2-v1'],
      artifactKeeperBaseUrl: 'http://artifact-keeper.example.test',
      stoppedCompositionRef: 'modeldeployment-stopped-v2',
      runningCompositionRef: 'modeldeployment-qwen38-ray-v2',
    },
  },
});

function manifest(state: 'Stopped' | 'Running') {
  const running = state === 'Running';
  return {
    apiVersion: 'platform.example.com/v1alpha1',
    kind: 'ModelDeployment',
    metadata: {
      name: 'qwen38-27b',
      namespace: 'model-serving',
      labels: {
        'platform.example.com/requested-by': running
          ? 'gitadmin'
          : 'platform-team',
      },
      annotations: {
        'platform.example.com/request-mode': running
          ? 'declarative-running'
          : 'declarative-stopped',
        'platform.example.com/effective-tensor-parallel-size': running
          ? '2'
          : '0',
        'platform.example.com/effective-replicas': running ? '1' : '0',
        'platform.example.com/effective-npu-per-replica': running ? '2' : '0',
        ...(running
          ? {
              'platform.example.com/requested-start-id': 'start-existing',
              'platform.example.com/requested-start-reason': 'test start',
            }
          : {}),
      },
    },
    spec: {
      runtimeProfileRef: 'qwen38-w8a8-ray-ascend-910b3-tp2-v1',
      compositionRef: {
        name: running
          ? 'modeldeployment-qwen38-ray-v2'
          : 'modeldeployment-stopped-v2',
      },
      crossplane: {
        compositionRef: {
          name: running
            ? 'modeldeployment-qwen38-ray-v2'
            : 'modeldeployment-stopped-v2',
        },
        compositionUpdatePolicy: 'Automatic',
      },
      desiredState: state,
      runtime: {
        npuPerWorker: 2,
        workerReplicas: running ? 1 : 0,
        serving: {
          tensorParallelSize: 2,
          dataParallelSize: 1,
          pipelineParallelSize: 1,
          requestedReplicas: 1,
        },
      },
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function actionContext(input: Record<string, unknown>, taskId: string) {
  const outputs = new Map<string, unknown>();
  return {
    input,
    user: { ref: 'user:default/gitadmin' },
    task: { id: taskId },
    checkpoint: jest.fn(
      async ({ fn }: { fn: () => Promise<unknown> }) => await fn(),
    ),
    output: jest.fn((name: string, value: unknown) => outputs.set(name, value)),
    logger: { info: jest.fn(), warn: jest.fn() },
    signal: undefined,
    outputs,
  };
}

describe('model platform inference lifecycle actions', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('derives structured serving and serveConfigV2 from the same approved input', () => {
    const runtime = {
      npuPerWorker: 2,
      serveConfigV2: `applications:
  - args:
      llm_configs:
        - deployment_config: {}
          engine_kwargs:
            speculative_config: {}
`,
    } as never;
    const rendered = renderServingRuntime(runtime, {
      requestedTensorParallelSize: 2,
      requestedDataParallelSize: 2,
      requestedPipelineParallelSize: 1,
      requestedReplicas: 2,
      requestedMaxModelLen: 16384,
      requestedMaxNumSeqs: 32,
      requestedMaxNumBatchedTokens: 4096,
      requestedGpuMemoryUtilization: 0.85,
      requestedPrefixCaching: false,
      requestedMtpTokens: 1,
      requestedMaxOngoingRequests: 32,
    });
    const serveConfig = parse(rendered.serveConfigV2) as Record<string, any>;
    const llm = serveConfig.applications[0].args.llm_configs[0];
    expect(rendered.serving).toMatchObject({
      tensorParallelSize: 2,
      dataParallelSize: 2,
      requestedReplicas: 2,
      maxOngoingRequests: 32,
    });
    expect(llm.deployment_config).toMatchObject({
      num_replicas: 2,
      max_ongoing_requests: 32,
    });
    expect(llm.engine_kwargs).toMatchObject({
      tensor_parallel_size: 2,
      data_parallel_size: 2,
      max_model_len: 16384,
      enable_prefix_caching: false,
    });
  });

  it('rejects a serving value outside the certified allow-list', () => {
    const runtime = {
      npuPerWorker: 2,
      serveConfigV2: 'applications: []',
    } as never;
    expect(() =>
      renderServingRuntime(runtime, {
        requestedTensorParallelSize: 2,
        requestedDataParallelSize: 1,
        requestedPipelineParallelSize: 1,
        requestedReplicas: 1,
        requestedMaxModelLen: 8192,
        requestedMaxNumSeqs: 16,
        requestedMaxNumBatchedTokens: 2048,
        requestedGpuMemoryUtilization: 0.8,
        requestedPrefixCaching: true,
        requestedMtpTokens: 0,
        requestedMaxOngoingRequests: 17,
      }),
    ).toThrow('outside the certified allow-list');
  });

  it('updates an existing stopped manifest with PUT and its current SHA', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          type: 'file',
          path: 'environments/production/modeldeployments/qwen38-27b.yaml',
          sha: 'base-file-sha',
          encoding: 'base64',
          content: Buffer.from(JSON.stringify(manifest('Stopped'))).toString(
            'base64',
          ),
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ commit: { sha: 'start-head-sha' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            number: 25,
            html_url: 'http://gitea.example.test/pulls/25',
            head: { sha: 'start-head-sha' },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    const context = actionContext(
      { deploymentName: 'qwen38-27b', startReason: 'acceptance' },
      'task-start-01',
    );
    await createStartInferenceAction(config).handler(context as never);

    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'PUT' });
    const writeBody = JSON.parse(
      String((fetchMock.mock.calls[2][1] as RequestInit).body),
    );
    expect(writeBody).toMatchObject({
      branch: 'main',
      new_branch: 'backstage/modeldeployment-running-qwen38-27b',
      sha: 'base-file-sha',
    });
    const updated = parse(
      Buffer.from(writeBody.content, 'base64').toString('utf8'),
    ) as Record<string, any>;
    expect(updated.spec).toMatchObject({
      desiredState: 'Running',
      compositionRef: { name: 'modeldeployment-qwen38-ray-v2' },
      crossplane: {
        compositionRef: { name: 'modeldeployment-qwen38-ray-v2' },
      },
      runtime: { workerReplicas: 1 },
    });
    expect(updated.metadata.annotations).toMatchObject({
      'platform.example.com/request-mode': 'declarative-running',
      'platform.example.com/effective-npu-per-replica': '2',
    });
    expect(context.outputs.get('executionMode')).toBe('declarative-running');
  });

  it('creates a constrained Running to Stopped update and removes start metadata', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          type: 'file',
          path: 'environments/production/modeldeployments/qwen38-27b.yaml',
          sha: 'running-file-sha',
          encoding: 'base64',
          content: Buffer.from(JSON.stringify(manifest('Running'))).toString(
            'base64',
          ),
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'stop-head-sha' } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            number: 26,
            html_url: 'http://gitea.example.test/pulls/26',
            head: { sha: 'stop-head-sha' },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, 201));
    globalThis.fetch = fetchMock as typeof fetch;

    const context = actionContext(
      { deploymentName: 'qwen38-27b', stopReason: 'maintenance' },
      'task-stop-01',
    );
    await createStopInferenceAction(config).handler(context as never);

    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'PUT' });
    const writeBody = JSON.parse(
      String((fetchMock.mock.calls[2][1] as RequestInit).body),
    );
    expect(writeBody).toMatchObject({
      branch: 'main',
      new_branch: 'backstage/modeldeployment-stopping-qwen38-27b',
      sha: 'running-file-sha',
    });
    const updated = parse(
      Buffer.from(writeBody.content, 'base64').toString('utf8'),
    ) as Record<string, any>;
    expect(updated.spec).toMatchObject({
      desiredState: 'Stopped',
      compositionRef: { name: 'modeldeployment-stopped-v2' },
      crossplane: {
        compositionRef: { name: 'modeldeployment-stopped-v2' },
      },
      runtime: { workerReplicas: 0 },
    });
    expect(updated.metadata.annotations).toMatchObject({
      'platform.example.com/request-mode': 'declarative-stopped',
      'platform.example.com/effective-tensor-parallel-size': '0',
      'platform.example.com/effective-replicas': '0',
      'platform.example.com/effective-npu-per-replica': '0',
    });
    expect(
      updated.metadata.annotations['platform.example.com/requested-start-id'],
    ).toBeUndefined();
    expect(context.outputs.get('executionMode')).toBe('declarative-stopped');
  });
});
