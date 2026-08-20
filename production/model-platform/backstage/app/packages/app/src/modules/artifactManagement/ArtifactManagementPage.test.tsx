import { screen, waitFor } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { ArtifactManagementPage } from './ArtifactManagementPage';

const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

describe('ArtifactManagementPage', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps the page read-only when the management feature is disabled', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/repositories')) {
        return jsonResponse({
          enabled: false,
          tokenRevealAvailable: false,
          allowedFormats: ['generic'],
          repositories: [],
        });
      }
      return jsonResponse({ items: [] });
    }) as typeof fetch;

    renderInTestApp(<ArtifactManagementPage />);

    await waitFor(() =>
      expect(screen.getByText('Artifact & CI management')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Management is not enabled in the backend config.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create repository' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Create one-time Token' }),
    ).toBeDisabled();
  });
});
