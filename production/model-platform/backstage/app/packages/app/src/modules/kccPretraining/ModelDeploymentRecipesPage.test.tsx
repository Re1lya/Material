import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { ModelDeploymentRecipesPage } from './ModelDeploymentRecipesPage';

const originalFetch = globalThis.fetch;

describe('ModelDeploymentRecipesPage', () => {
  beforeEach(() => {
    // Keep the page on its deterministic release fallback in unit tests. The
    // real Gitea/Kubernetes fetches are covered by the backend build and are
    // exercised only in an integrated Backstage pod.
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows the verified Artifact Keeper model catalog', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    expect(screen.getByText('Model recipes')).toBeInTheDocument();
    expect(screen.getByText('Available models')).toBeInTheDocument();
    expect(screen.getByText('Qwen3.8-27B W8A8')).toBeInTheDocument();
    expect(screen.getByText('W8A8')).toBeInTheDocument();
    expect(screen.getByText('Configure model')).toBeInTheDocument();
  });

  it('opens the fixed-instance configurator without exposing legacy GitOps lifecycle links', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    fireEvent.click(screen.getByText('Configure model'));

    expect(screen.getAllByText('Hardware').length).toBeGreaterThan(0);
    expect(screen.getByText('Parallel strategy')).toBeInTheDocument();
    expect(screen.getByText('Context length')).toBeInTheDocument();
    expect(
      screen.getAllByText('Qwen3.8-27B W8A8').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue('qwen38-27b')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
    expect(screen.queryByText('Legacy GitOps fallback')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Start inference|Stop inference/ })).not.toBeInTheDocument();
  });

  it('starts an existing stopped deployment through Direct Operations', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            observedAt: '2026-08-31T00:00:00Z',
            deployments: [
              {
                name: 'qwen38-27b',
                desiredState: 'Stopped',
                modelVersionRef: 'qwen3.8-27b-w8a8',
              },
            ],
            resources: {},
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ configurations: [{
          configVersion: 3,
          modelVersionRef: 'qwen3.8-27b-w8a8',
          runtimeProfileRef: 'qwen38-w8a8-ray-ascend-910b3-tp2-v1',
          tensorParallelSize: 2,
          dataParallelSize: 1,
          pipelineParallelSize: 1,
          requestedReplicas: 1,
          maxModelLen: 32768,
          maxNumSeqs: 64,
          maxNumBatchedTokens: 8192,
          gpuMemoryUtilization: 0.9,
          prefixCaching: true,
          mtpTokens: 3,
          maxOngoingRequests: 64,
        }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestId: 'start-1', phase: 'Reconciling' }), { status: 202 }),
      ) as typeof fetch;

    renderInTestApp(<ModelDeploymentRecipesPage />);
    fireEvent.click(screen.getByText('Configure model'));
    await screen.findByText('Stopped');

    const startButtons = await screen.findAllByRole('button', {
      name: 'Start saved v3',
    });
    fireEvent.click(startButtons[0]);
    expect(await screen.findByText(/Start request start-1 is Reconciling/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model-deployment-operations/deployments/qwen38-27b/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('stops an existing running deployment through Direct Operations', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            observedAt: '2026-08-31T00:00:00Z',
            deployments: [
              {
                name: 'qwen38-27b',
                desiredState: 'Running',
                modelVersionRef: 'qwen3.8-27b-w8a8',
              },
            ],
            resources: {},
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ configurations: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestId: 'stop-1', phase: 'Reconciling' }), { status: 202 }),
      ) as typeof fetch;

    renderInTestApp(<ModelDeploymentRecipesPage />);
    fireEvent.click(screen.getByText('Configure model'));
    await screen.findByText('Running');

    const stopButtons = await screen.findAllByRole('button', {
      name: 'Stop',
    });
    fireEvent.click(stopButtons[0]);
    expect(await screen.findByText(/Stop request stop-1 is Reconciling/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model-deployment-operations/deployments/qwen38-27b/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
