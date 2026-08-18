import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { KccPretrainingPage } from './KccPretrainingPage';

describe('KccPretrainingPage', () => {
  it('shows the release handoff without creating a workload', () => {
    renderInTestApp(<KccPretrainingPage />);

    expect(screen.getByText('KCC Pretraining')).toBeInTheDocument();
    expect(screen.getByText('ModelScope revision')).toBeInTheDocument();
    expect(screen.getByText(/不会创建 importer Job/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '查看部署 Recipe' }),
    ).toHaveAttribute('href', '/model-recipes');
  });
});
