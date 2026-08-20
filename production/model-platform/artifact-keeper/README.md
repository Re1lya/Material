# Artifact Keeper Helm source

This directory contains the Helm chart source synchronized from the authorized
`server-00` checkout on 2026-08-20.

| Item | Value |
|---|---|
| Source checkout | `/home/admin/artifact-keeper-iac` on `server-00` |
| Source branch | `main` |
| Source commit | `66faeeb` |
| Chart | `artifact-keeper` `1.7.5` |
| Application version | `1.6.0` |
| Chart source | `helm/artifact-keeper/` |
| Local values snapshot | `helm/values-poc.yaml` |

The source checkout had two uncommitted template changes when it was copied:
`templates/backend-deployment.yaml` and
`templates/opensearch-deployment.yaml`. They are intentionally preserved in
this snapshot. The remote `.git` directory and unrelated repository scripts
were not copied.

`values.yaml`, `values-production.yaml`, and the smoke/CI values are chart
examples or configuration templates. They do not contain the production
credentials used by the running release. Production secrets must continue to
be supplied interactively or through the approved external-secret mechanism;
do not commit rendered Secrets or real tokens here.

This synchronization is source control only. It does not change the live
`artifact-keeper` Helm release or any Kubernetes object. Validate any future
change with `helm lint`/`helm template`, server-side dry-run, and the scoped
production release procedure in `AGENTS.md` before applying it.
