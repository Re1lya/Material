import { fireEvent, screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { ModelDeploymentsPage } from './ModelDeploymentsPage';

const originalFetch = globalThis.fetch;

const response = {
  observedAt: '2026-09-01T00:00:00Z',
  deployments: [
    {
      name: 'qwen-running',
      status: 'Running',
      phase: 'Healthy',
      phaseIndex: 7,
      desiredState: 'Running',
      modelVersionRef: 'qwen3.8-27b-w8a8',
      runtimeProfileRef: 'qwen38-tp2',
      git: { pullRequest: 28, state: 'merged' },
      tekton: { pipelineRun: 'validation-abc', status: 'True' },
      argo: { sync: 'Synced', health: 'Healthy' },
      crossplane: { synced: true, ready: true },
      ray: { requestedWorkers: 1, readyWorkers: 1, clusters: ['qwen-abc'] },
      npu: { requested: 2, actualDevices: ['Ascend910-14', 'Ascend910-15'] },
      serve: {
        modelStatus: 'Healthy',
        serviceStatus: 'Ready',
        gatewayStatus: 'NotConfigured',
        endpoint: 'http://qwen-running.model-serving.svc.cluster.local',
      },
      recentEvents: [{ reason: 'Healthy', message: 'Serve is ready' }],
    },
    {
      name: 'qwen-stopped',
      status: 'Stopped',
      phase: 'Stopped',
      phaseIndex: -1,
      desiredState: 'Stopped',
      modelVersionRef: 'qwen3.8-27b-w8a8',
      runtimeProfileRef: 'qwen38-tp2',
      ray: {
        requestedWorkers: 0,
        readyWorkers: 0,
        clusters: ['qwen-stopped-abc'],
      },
      npu: { requested: 0, actualDevices: [] },
      serve: {
        modelStatus: 'Unknown',
        serviceStatus: 'Missing',
        gatewayStatus: 'NotConfigured',
        endpoint: null,
      },
    },
    {
      name: 'unknown-deployment',
      status: 'Unknown',
      phase: 'Unknown',
      phaseIndex: -1,
      modelVersionRef: 'unknown-model',
      unavailable: { tekton: 'HTTP 403' },
    },
  ],
};

function mockResponse(payload = response) {
  globalThis.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as typeof fetch;
}

describe('ModelDeploymentsPage', () => {
  beforeEach(() => mockResponse());

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('renders deployment cards and switches the details selection', async () => {
    renderInTestApp(<ModelDeploymentsPage />);
    expect(
      await screen.findByText('Deployment details · qwen-running'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Deployment qwen-stopped' }),
    );
    expect(
      screen.getByText('Deployment details · qwen-stopped'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start inference' }),
    ).toHaveAttribute('href', expect.stringContaining('start-model-inference'));
  });

  it('shows Stop for Running and links New deployment to model recipes', async () => {
    renderInTestApp(<ModelDeploymentsPage />);
    await screen.findByText('Deployment details · qwen-running');
    expect(
      screen.getByRole('link', { name: 'Stop inference' }),
    ).toHaveAttribute('href', expect.stringContaining('stop-model-inference'));
    expect(
      screen.getByRole('link', { name: 'New deployment' }),
    ).toHaveAttribute('href', '/model-recipes');
  });

  it('filters deployments by search and status', async () => {
    renderInTestApp(<ModelDeploymentsPage />);
    await screen.findByText('Deployment details · qwen-running');
    fireEvent.change(screen.getByLabelText('Search deployment or model'), {
      target: { value: 'stopped' },
    });
    expect(screen.getByText('qwen-stopped')).toBeInTheDocument();
    expect(screen.queryByText('qwen-running')).not.toBeInTheDocument();
  });

  it('does not promote Unknown to success and displays unavailable modules', async () => {
    renderInTestApp(<ModelDeploymentsPage />);
    await screen.findByText('Deployment details · qwen-running');
    fireEvent.click(
      screen.getByRole('button', { name: 'Deployment unknown-deployment' }),
    );
    expect(screen.getAllByText('Unknown status').length).toBeGreaterThan(0);
    expect(
      screen.getByText('tekton unavailable: HTTP 403'),
    ).toBeInTheDocument();
  });
});
