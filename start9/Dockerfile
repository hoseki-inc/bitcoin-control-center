# Download and verify the pinned yq release used to read StartOS config. Only
# the stage for the target architecture is built.
ARG YQ_VERSION=v4.53.2

FROM scratch AS yq-amd64
ARG YQ_VERSION
ADD --checksum=sha256:d56bf5c6819e8e696340c312bd70f849dc1678a7cda9c2ad63eebd906371d56b --chmod=755 \
    https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64 /yq

FROM scratch AS yq-arm64
ARG YQ_VERSION
ADD --checksum=sha256:03061b2a50c7a498de2bbb92d7cb078ce433011f085a4994117c2726be4106ea --chmod=755 \
    https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_arm64 /yq

FROM yq-${TARGETARCH} AS yq

FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567

ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production

WORKDIR /app

# Install runtime utilities needed by Start9 scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=yq /yq /usr/local/bin/yq

# api-sentinel is bundled by esbuild — only the externals listed in
# apps/api-sentinel/src/scripts/build.ts need to be in node_modules.
COPY start9/runtime/package.json start9/runtime/package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Copy api-sentinel bundled build output + assets
COPY apps/api-sentinel/dist ./dist
COPY apps/api-sentinel/assets ./assets

# Copy the Control Center static build (served by Fastify)
COPY apps/control-center/dist ./public

# Copy the Start9 entrypoint
COPY start9/docker_entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker_entrypoint.sh

STOPSIGNAL SIGINT

ENTRYPOINT ["docker_entrypoint.sh"]
