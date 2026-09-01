import type { Deployment, DeploymentStatus } from './types';

export const pipelineStages = [
  'Request',
  'Git PR',
  'Tekton',
  'Argo',
  'Crossplane',
  'RayCluster',
  'Model load',
  'Healthy',
];

export function normalizeDeploymentStatus(
  deployment: Partial<Deployment>,
): DeploymentStatus {
  const failed = deployment.conditions?.some(
    condition =>
      ['Synced', 'Ready'].includes(condition.type ?? '') &&
      condition.status === 'False',
  );
  if (failed) return 'Failed';
  if (deployment.status) return deployment.status;
  if (deployment.desiredState === 'Stopped') return 'Stopped';
  if (deployment.desiredState === 'Running') return 'Pending';
  return 'Unknown';
}

export function statusTone(status: DeploymentStatus) {
  if (status === 'Running') return 'primary' as const;
  if (status === 'Failed') return 'secondary' as const;
  return 'default' as const;
}

export function actionState(deployment: Deployment) {
  return {
    canStart: deployment.status === 'Stopped',
    canStop: deployment.status === 'Running',
    transitional: ['Pending', 'Validating', 'Deploying', 'Stopping'].includes(
      deployment.status,
    ),
  };
}

export function failureReason(deployment: Deployment) {
  if (deployment.status !== 'Failed') return undefined;
  if (deployment.tekton?.status === 'False') {
    return (
      deployment.tekton.failedTask ??
      deployment.tekton.reason ??
      'Tekton policy validation failed'
    );
  }
  const failed = deployment.conditions?.find(
    condition =>
      ['Synced', 'Ready'].includes(condition.type ?? '') &&
      condition.status === 'False',
  );
  return failed?.message ?? failed?.reason;
}

export function stageState(deployment: Deployment, index: number) {
  const current = deployment.phaseIndex ?? -1;
  if (deployment.status === 'Failed' && index === current) return 'failed';
  if (deployment.status === 'Running' || index < current) return 'done';
  if (index === current) return 'active';
  return 'waiting';
}
