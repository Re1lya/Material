import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mockApis, renderInTestApp } from '@backstage/frontend-test-utils';
import { DataPipelinePage } from './DataPipelinePage';

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

describe('DataPipelinePage', () => {
  it('keeps execution disabled until the K12 release and CPU runtime are ready', async () => {
    const fetchApi = mockApis.fetch({
      baseImplementation: async () =>
        jsonResponse({
          enabled: true,
          foundation: {
            phase: 'not-deployed',
            message: 'The new CPU-only Dagster foundation has not been deployed.',
          },
          runtime: { phase: 'unavailable', message: 'CPU Ray is not Ready.' },
          dagster: { phase: 'not-configured' },
          execution: { mode: 'dagster-allowlisted-k12-stage1' },
        }),
      injectIdentityAuth: { token: 'test-user-token' },
    });

    renderInTestApp(<DataPipelinePage />, {
      apis: [fetchApi, mockApis.identity({ token: 'test-user-token' })],
    });

    await waitFor(() =>
      expect(screen.getByText('K12 Data Pipeline')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('The new CPU-only Dagster foundation has not been deployed.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Launch controlled K12 CPU run' }),
    ).toBeDisabled();
  });

  it('forwards the signed-in Backstage credential to the status API', async () => {
    const requestHeaders: string[] = [];
    const fetchApi = mockApis.fetch({
      baseImplementation: async (input, init) => {
        const headers =
          input instanceof Request ? input.headers : new Headers(init?.headers);
        requestHeaders.push(headers.get('Authorization') ?? '');
        return jsonResponse({
          enabled: false,
          foundation: { phase: 'not-deployed' },
          runtime: { phase: 'unavailable' },
          dagster: { phase: 'not-configured' },
        });
      },
      injectIdentityAuth: { token: 'test-user-token' },
    });

    renderInTestApp(<DataPipelinePage />, {
      apis: [fetchApi, mockApis.identity({ token: 'test-user-token' })],
    });

    await waitFor(() => expect(requestHeaders).toContain('Bearer test-user-token'));
  });

  it('launches only the allow-listed K12 Stage 1 profile', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchApi = mockApis.fetch({
      baseImplementation: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = input instanceof Request ? input.method : init?.method ?? 'GET';
        const body =
          input instanceof Request
            ? await input.clone().text()
            : (init?.body as string | undefined);
        requests.push({ url, method, body });
        if (method === 'POST') {
          return jsonResponse({
            runId: 'run-123',
            jobName: 'cleanjopbstage1_10',
            outputPrefix: 's3://k12-cleaned-corpus/stage1/platform-smoke/backstage-stage1-sample',
          });
        }
        if (url.endsWith('/runs')) return jsonResponse({ items: [] });
        return jsonResponse({
          enabled: true,
          foundation: { phase: 'ready', message: 'K12 Dagster Ready.' },
          runtime: { phase: 'ready', message: 'CPU Ray Ready.' },
          dagster: { phase: 'ready', message: 'Dagster API Ready.' },
          execution: {
            jobName: 'cleanjopbstage1_10',
            profileName: 'k12-stage1-clean-v1',
          },
        });
      },
      injectIdentityAuth: { token: 'test-user-token' },
    });

    renderInTestApp(<DataPipelinePage />, {
      apis: [fetchApi, mockApis.identity({ token: 'test-user-token' })],
    });

    const button = await screen.findByRole('button', {
      name: 'Launch controlled K12 CPU run',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/run-123/)).toBeInTheDocument());
    const launch = requests.find(request => request.method === 'POST');
    expect(launch?.url).toMatch(/\/api\/data-pipeline\/runs$/);
    expect(JSON.parse(launch?.body ?? '{}')).toEqual({
      requestName: 'backstage-stage1-sample',
      manifestRef:
        's3://k12-cleaned-corpus/cpu-smoke/manifests/stage1_test_10.json',
      profile: 'k12-stage1-clean-v1',
    });
  });
});
