# Model Platform Backstage app

This is the repository-owned minimum portal for the production model platform.
It is based on Backstage 1.53.0 and intentionally contains only GitHub login,
catalog, Scaffolder infrastructure with no write template, PostgreSQL search,
Kubernetes read-only views and user settings.

Local validation uses Node 24 and the committed Yarn release:

```bash
node .yarn/releases/yarn-4.13.0.cjs install --immutable
node .yarn/releases/yarn-4.13.0.cjs tsc
node .yarn/releases/yarn-4.13.0.cjs backstage-cli config:check \
  --config app-config.yaml --config app-config.production.yaml
node .yarn/releases/yarn-4.13.0.cjs build:backend
```

Before an image build, confirm that the inferred `re1lya` User entity in
`catalog/entities.yaml` matches the approved GitHub login. Runtime credentials
are supplied only through the `backstage-secrets` Kubernetes Secret. See the
parent `release-runbook.md`; a successful local build is not production
deployment evidence.
