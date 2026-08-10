# Production Gitea

This directory defines the single-node Gitea production baseline for the
`server-00` K3s cluster.

- Helm chart: `gitea` 12.6.0, application 1.26.1.
- Gitea and PostgreSQL images are mirrored into the local registry and pinned
  to the verified `linux/amd64` manifest digests in `values-production.yaml`.
- Gitea and its standalone PostgreSQL are fixed to `server-00`; they do not
  schedule on NPU nodes.
- Gitea uses a retained 100Gi local PV and PostgreSQL uses a retained 20Gi
  local PV under `/mnt/data/model-platform/gitea/`.
- Valkey and PostgreSQL HA are intentionally disabled because this is a
  single-host deployment. Sessions use PostgreSQL and the internal queue uses
  Gitea's level queue.
- HTTP is temporarily exposed on the trusted internal network at
  `http://110.120.0.3:30081/`. SSH and public registration are disabled.

The following Secrets are provisioned out of band and must never be committed:

- `gitea-admin-credentials`: keys `username` and `password`.
- `gitea-postgresql-auth`: keys `postgres-password`, `password`, and
  `replication-password`.

The PV reclaim policy is `Retain`. Removing the Helm release does not remove
the repository or database data. Local PV capacity records scheduling capacity
but does not enforce an ext4 filesystem quota.
