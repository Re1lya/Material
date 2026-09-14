# Direct Operations pre-release rollback snapshot

This directory is the read-only production snapshot taken immediately before
the 2026-09-14 Direct Operations release work.

Primary Backstage rollback image:

`110.120.0.3:30670/container-images/platform/kcc-backstage:0.6.1-personal-wandb-c937370@sha256:0468a270b484b441a62677f430e3ba70a5aece4cb2974c914e27abf6de68a703`

The digest was pulled successfully from Artifact Keeper when this snapshot was
created. `qwen38-27b` was Stopped and `model-serving` contained zero Pods.

Fast Backstage rollback:

```bash
sudo k3s kubectl -n backstage set image deployment/backstage \
  backstage=110.120.0.3:30670/container-images/platform/kcc-backstage@sha256:0468a270b484b441a62677f430e3ba70a5aece4cb2974c914e27abf6de68a703
sudo k3s kubectl -n backstage rollout status deployment/backstage --timeout=5m
```

Before restoring any full raw YAML, remove server-generated fields such as
`status`, `resourceVersion`, `uid`, `creationTimestamp`, and `managedFields`.
Prefer a narrow image rollback or an exact reviewed metadata/spec patch over
blindly applying an entire captured object.

The PostgreSQL migration is additive. Rolling Backstage back does not require
dropping its tables; keep Direct Operations disabled. If instance ownership
has already moved away from Argo, restore the reviewed instance manifest and
the saved Argo tracking metadata separately.

Verify the evidence files from this directory with:

```bash
sha256sum -c SHA256SUMS
```
