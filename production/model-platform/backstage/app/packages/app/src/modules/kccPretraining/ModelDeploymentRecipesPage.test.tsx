import { fireEvent, screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { ModelDeploymentRecipesPage } from './ModelDeploymentRecipesPage';

describe('ModelDeploymentRecipesPage', () => {
  it('shows the verified Artifact Keeper model catalog', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    expect(screen.getByText('Model deployment recipes')).toBeInTheDocument();
    expect(screen.getByText('Qwen3.6-27B W8A8')).toBeInTheDocument();
    expect(
      screen.getByText('Gitea ModelVersion catalog · read-only'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Stopped XR first; no direct NPU allocation'),
    ).toBeInTheDocument();
  });

  it('opens a recipe and links to the reviewed Gitea request template', () => {
    renderInTestApp(<ModelDeploymentRecipesPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }));

    expect(screen.getByText('Hardware and variant')).toBeInTheDocument();
    expect(screen.getAllByText('Qwen3.6-27B W8A8')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: 'Create Gitea deployment request' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('link', { name: 'Create Gitea deployment request' }),
    ).toHaveAttribute(
      'href',
      '/create/templates/default/request-model-deployment',
    );
    expect(
      screen.getByText(/Tekton validates the catalog references/),
    ).toBeInTheDocument();
  });
});
