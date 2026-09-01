FROM docker.1ms.run/library/node@sha256:f2925910482dc53394bc0034c5f4abffcd01de400794c050ca343fe0d733b486 AS build

ENV PYTHON=/usr/bin/python3

# server-00 reaches the Debian mirror substantially faster than deb.debian.org.
# Package authenticity is still enforced by Debian's signed repository metadata.
RUN sed -i 's|http://deb.debian.org/debian|http://repo.huaweicloud.com/debian|g' \
    /etc/apt/sources.list.d/debian.sources

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml backstage.json package.json tsconfig.json yarn.lock ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node app-config*.yaml ./

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    node .yarn/releases/yarn-4.13.0.cjs install --immutable
RUN node .yarn/releases/yarn-4.13.0.cjs tsc && \
    node .yarn/releases/yarn-4.13.0.cjs build:backend

FROM docker.1ms.run/library/node@sha256:f2925910482dc53394bc0034c5f4abffcd01de400794c050ca343fe0d733b486

ARG SOURCE_REPOSITORY="https://github.com/Re1lya/Material"
ARG SOURCE_REVISION="unknown"
ARG RELEASE_VERSION="development"

LABEL org.opencontainers.image.source="${SOURCE_REPOSITORY}" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"

# Set Python interpreter for `node-gyp` to use
ENV PYTHON=/usr/bin/python3

RUN sed -i 's|http://deb.debian.org/debian|http://repo.huaweicloud.com/debian|g' \
    /etc/apt/sources.list.d/debian.sources

# Install isolate-vm dependencies, these are needed by the @backstage/plugin-scaffolder-backend.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential && \
    rm -rf /var/lib/apt/lists/*

# From here on we use the least-privileged `node` user to run the backend.
USER node

# This should create the app dir as `node`.
# If it is instead created as `root` then the `tar` command below will fail: `can't create directory 'packages/': Permission denied`.
# If this occurs, then ensure BuildKit is enabled (`DOCKER_BUILDKIT=1`) so the app dir is correctly created as `node`.
WORKDIR /app

# Copy files needed by Yarn
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml ./
COPY --chown=node:node backstage.json ./

# This switches many Node.js dependencies to production mode.
ENV NODE_ENV=production

# This disables node snapshot for Node 20 to work with the Scaffolder
ENV NODE_OPTIONS="--no-node-snapshot"

# Copy repo skeleton first, to avoid unnecessary docker cache invalidation.
# The skeleton contains the package.json of each package in the monorepo,
# and along with yarn.lock and the root package.json, that's enough to run yarn install.
COPY --chown=node:node --from=build /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    node .yarn/releases/yarn-4.13.0.cjs workspaces focus --all --production && \
    node .yarn/releases/yarn-4.13.0.cjs cache clean --all

COPY --chown=node:node catalog ./catalog

# Then copy the rest of the backend bundle, along with any other files we might want.
COPY --chown=node:node --from=build /app/packages/backend/dist/bundle.tar.gz ./
COPY --chown=node:node app-config*.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
