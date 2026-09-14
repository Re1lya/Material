# Training Backstage source recovery — 2026-09-14

## Outcome

The training UI and training API changes that existed only in the running
Backstage image have been recovered into reviewable Gitea branches. The
recovery was merged onto the current repository `main` baseline, so it does
not discard newer Model Deployment, Direct Operations, Artifact Management,
or K12 Data Pipeline work.

No Kubernetes object, Backstage Deployment, Running Window, NPU workload, or
database was changed during this recovery.

## Immutable production evidence

- Production image at recovery time:
  `110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.1-personal-wandb-c937370@sha256:0468a270b484b441a62677f430e3ba70a5aece4cb2974c914e27abf6de68a703`
- OCI architecture: `amd64`
- OCI revision label: short revision `c937370`; that revision was not present
  in any reachable Gitea branch.
- Extracted evidence archive SHA-256:
  `db8247cb20d46f0b2f2c6222b329ccd26203a1622e40409eb2c68bf394ecb145`
- The production frontend contained 357 source maps. The recovered
  `KccPretrainingPage.tsx` came from embedded `sourcesContent`, not from
  de-minification.

## Recovered Backstage source

Repository: `gitadmin/platform-backstage`

- Branch: `recovery/production-c937370`
- Commit: `230dd6246f2df96657d1d4d737ec8f7842284141`
- Base: current Gitea `main` commit `b73365e68518d69f98e2b607378994f9bfb0e1a6`
- Pull request creation URL:
  `http://110.120.0.3:30081/gitadmin/platform-backstage/pulls/new/recovery/production-c937370`

Recovered behavior:

- personal W&B fields in the training request dialog;
- per-request immutable W&B Secret creation with owner reference;
- safe two-step start: create the request stopped, create the Secret, then
  patch the request to Running;
- protection of `WANDB_API_KEY` from generic environment overrides;
- real data/checkpoint/output path display in training details;
- runtime path mapping for shared workspace paths and node-local
  `/mnt/models` paths.

The recovered frontend source SHA-256 is
`8749084a81a873e73e264a7a6dd208df3225cea7f64f4b844396d687deff33ca`.

The reconstructed `trainingPlatformApi.ts`, compiled with the same TypeScript
options used by the image build, is byte-for-byte identical to the production
container file. Both compiled files have SHA-256
`b94fe99ff95d6e704e6abe81294082d9fa234139ec3a397cc0facc128855bc81`.

Production-era Model Deployment files were deliberately not copied over the
newer Gitea `main` implementations. Files proven identical between the image
and `main` were also left unchanged.

## Recovered configuration source

Repository: `gitadmin/model-platform-config`

- Branch: `recovery/production-training-c937370`
- Commit: `659f19ed53b8f8a7ed5d1a666e26e0a760fcf999`
- Base: current Gitea `main` commit `6085fb9e891a065bfd2e74290680e4177ad4237a`
- Pull request creation URL:
  `http://110.120.0.3:30081/gitadmin/model-platform-config/pulls/new/recovery/production-training-c937370`

Recovered live drift:

- Backstage `secrets/create` permission in `kcc-training`;
- `spec.training.wandbSecretRef` in the TrainingRequest XRD;
- `spec.dependsOn`, its immutability/self-reference validation, and the
  `Queued` phase in the TrainingRequest XRD;
- the `spec.dependsOn` patch in the TrainingRequest Composition.

After recovery, the source XRD and Composition match their live
`kubectl.kubernetes.io/last-applied-configuration` specifications. The RBAC,
XRD, and Composition all passed Kubernetes server-side dry-run.

## Verification

- Backstage backend tests: 24/24 passed.
- Backstage app tests: 16/16 passed.
- Added recovery unit tests cover runtime path selection, W&B validation,
  immutable owner-bound Secret generation, and absence of plaintext API keys
  in the generated Secret JSON.
- Backstage backend/app build passed.
- Repository-wide lint commands remain unsuitable because they scan generated
  `dist` and migration directories without ESLint configuration; this is an
  existing tooling issue, not a recovered-source failure.

## Integration candidate image

The candidate is built from the current production image digest and overlays
the recovered source plus the current repository `main` code:

`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.13-training-source-recovery-230dd62@sha256:1a2c34af28d36c896e47542974afa4a78276278078a8b137c4bf79e382067d2c`

- architecture: `amd64`;
- OCI revision: `230dd6246f2df96657d1d4d737ec8f7842284141`;
- candidate training API compiled SHA-256 equals the production evidence hash;
- image contract check confirmed training UI text, training API registration,
  K12 Data Pipeline backend, and Direct Operations module presence.

This is an integration candidate, not an automatically approved production
rollout. Because the branch is based on current `main`, deploying it also
introduces the pending Direct Operations code and therefore still requires
that feature's RBAC, NetworkPolicy, database migration, rollout, and rollback
gates. It must not be treated as a training-only hotfix image.

## Recommended continuation

1. Review and merge both recovery branches without squashing away provenance.
2. Keep the current production image digest as the rollback point.
3. Rebase future inference/data-pipeline work on the recovered Backstage main,
   rather than on the opaque production image.
4. Before any rollout, rerun the complete Backstage tests/build, configuration
   validation, server-side dry-run, and the Direct Operations release gates.
5. Run training creation/W&B smoke only in a separately approved window; do
   not use an NPU training run merely to validate source recovery.

