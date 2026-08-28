import { screen, waitFor } from '@testing-library/react';
import { mockApis, renderInTestApp } from '@backstage/frontend-test-utils';
import { ArtifactManagementPage } from './ArtifactManagementPage';

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

function errorResponse(status: number, value: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => value,
  } as Response;
}

describe('ArtifactManagementPage', () => {
  it('keeps the page read-only when the management feature is disabled', async () => {
    const fetchApi = mockApis.fetch({
      baseImplementation: async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/repositories')) {
          return jsonResponse({
            enabled: false,
            tokenRevealAvailable: false,
            allowedFormats: ['generic'],
            repositories: [],
          });
        }
        return jsonResponse({ items: [] });
      },
      injectIdentityAuth: { token: 'test-user-token' },
    });

    renderInTestApp(<ArtifactManagementPage />, {
      apis: [fetchApi, mockApis.identity({ token: 'test-user-token' })],
    });

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

  it('shows a useful sign-in message when the backend rejects missing credentials', async () => {
    const fetchApi = mockApis.fetch({
      baseImplementation: async () =>
        errorResponse(401, {
          error: { message: 'Missing credentials' },
        }),
    });

    renderInTestApp(<ArtifactManagementPage />, { apis: [fetchApi] });

    await waitFor(() =>
      expect(
        screen.getByText('登录会话不可用。请重新登录 Backstage 后重试。'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });

  it('forwards the Backstage identity credential to the management API', async () => {
    const requestHeaders: string[] = [];
    const fetchApi = mockApis.fetch({
      baseImplementation: async (input, init) => {
        const headers =
          input instanceof Request ? input.headers : new Headers(init?.headers);
        requestHeaders.push(headers.get('Authorization') ?? '');
        return jsonResponse({
          enabled: false,
          tokenRevealAvailable: false,
          allowedFormats: ['generic'],
          repositories: [],
        });
      },
      injectIdentityAuth: { token: 'test-user-token' },
    });

    renderInTestApp(<ArtifactManagementPage />, {
      apis: [fetchApi, mockApis.identity({ token: 'test-user-token' })],
    });

    await waitFor(() => expect(requestHeaders).toContain('Bearer test-user-token'));
  });
});
