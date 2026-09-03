import { createServer } from 'node:http';
import {
  expireModelProbeForTests,
  probeModelOnce,
  resetModelProbeCacheForTests,
} from './modelPlatformApi';

describe('model probe cache', () => {
  afterEach(() => resetModelProbeCacheForTests());

  it('retries a failed generation probe after expiry and records recovery', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        requests === 1
          ? JSON.stringify({ data: [] })
          : JSON.stringify({ data: [{ id: 'qwen3.8-27b-w8a8' }] }),
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const deployment = {
      namespace: 'model-serving',
      name: 'qwen38-v2-smoke',
      generation: 12,
      expectedModelName: 'qwen3.8-27b-w8a8',
      serve: { endpoint: `http://127.0.0.1:${port}` },
    };
    try {
      expect((await probeModelOnce(deployment)).ok).toBe(false);
      expect(requests).toBe(1);
      expireModelProbeForTests('model-serving/qwen38-v2-smoke/12');
      expect((await probeModelOnce(deployment)).ok).toBe(true);
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
