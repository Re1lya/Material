import type { DeploymentsResponse } from './types';

export async function fetchDeployments(signal?: AbortSignal) {
  const response = await fetch('/api/model-platform/deployments', { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as DeploymentsResponse;
}
