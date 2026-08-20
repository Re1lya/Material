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

    expect(screen.getByText('Model deployment recipes')).toBeInTheDocument();
    expect(screen.getByText('Qwen3.8-27B W8A8')).toBeInTheDocument();
    expect(
      screen.getByText(/Gitea ModelVersion catalog · (live|fallback)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Stopped XR first; no direct NPU allocation'),
    ).toBeInTheDocument();
  });

  it('opens a recipe and links to the reviewed Gitea request template', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }));

    expect(screen.getByText('Hardware and variant')).toBeInTheDocument();
    expect(screen.getAllByText('Qwen3.8-27B W8A8')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'Create Gitea deployment request' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('link', { name: 'Create Gitea deployment request' }),
    ).toHaveAttribute(
      'href',
      '/create/templates/default/request-model-deployment?formData=%7B%22deploymentName%22%3A%22qwen38-27b-demo%22%2C%22projectRef%22%3A%22model-serving%22%2C%22modelVersionRef%22%3A%22qwen3.8-27b-w8a8%22%2C%22runtimeProfileRef%22%3A%22qwen38-w8a8-ray-ascend-910b3-v1%22%2C%22visibility%22%3A%22internal%22%2C%22requestedTensorParallelSize%22%3A8%2C%22requestedPipelineParallelSize%22%3A1%2C%22requestedReplicas%22%3A1%2C%22priority%22%3A%22normal%22%7D',
    );
    expect(
      screen.getByText(/Tekton validates the catalog references/),
    ).toBeInTheDocument();
  });
});
