import { failureReason, normalizeDeploymentStatus } from './status';

describe('normalizeDeploymentStatus', () => {
  it('uses Unknown when there is no trustworthy state', () => {
    expect(normalizeDeploymentStatus({})).toBe('Unknown');
    expect(normalizeDeploymentStatus({ desiredState: 'Running' })).toBe(
      'Pending',
    );
  });

  it('only treats core Crossplane conditions as terminal failure', () => {
    expect(
      normalizeDeploymentStatus({
        desiredState: 'Stopped',
        conditions: [{ type: 'Other', status: 'False' }],
      }),
    ).toBe('Stopped');
    expect(
      normalizeDeploymentStatus({
        desiredState: 'Stopped',
        conditions: [{ type: 'Ready', status: 'False' }],
      }),
    ).toBe('Failed');
  });
});

describe('failureReason', () => {
  it('does not surface a failed historical request on a healthy live state', () => {
    expect(
      failureReason({
        name: 'qwen38-27b',
        status: 'Stopped',
        tekton: { status: 'False', failedTask: 'validate-request' },
      }),
    ).toBeUndefined();
  });
});
