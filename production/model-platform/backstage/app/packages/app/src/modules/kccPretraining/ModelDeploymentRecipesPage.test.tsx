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

  it('opens a product deployment configurator and preserves the safe request contract', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    fireEvent.click(screen.getByText('Configure model'));

    expect(screen.getAllByText('Hardware').length).toBeGreaterThan(0);
    expect(screen.getByText('Parallel strategy')).toBeInTheDocument();
    expect(screen.getByText('Context length')).toBeInTheDocument();
    expect(
      screen.getAllByText('Qwen3.8-27B W8A8').length,
    ).toBeGreaterThanOrEqual(2);
    const requestLink = screen.getAllByRole('link', {
      name: 'Deploy model',
    })[0];
    expect(requestLink).toBeEnabled();
    const formData = new URLSearchParams(
      (requestLink.getAttribute('href') ?? '').split('?')[1],
    ).get('formData');
    expect(JSON.parse(formData ?? '{}')).toMatchObject({
      deploymentName: 'qwen38-27b',
      modelVersionRef: 'qwen3.8-27b-w8a8',
      runtimeProfileRef: 'qwen38-w8a8-ray-ascend-910b3-tp2-v1',
      requestedTensorParallelSize: 2,
      requestedDataParallelSize: 1,
      requestedReplicas: 1,
      requestedMaxModelLen: 32768,
      requestedMaxNumSeqs: 64,
      requestedMaxNumBatchedTokens: 8192,
      requestedGpuMemoryUtilization: 0.9,
      requestedPrefixCaching: true,
      requestedMtpTokens: 3,
    });
  });
});
