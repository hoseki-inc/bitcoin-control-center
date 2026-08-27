FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production

WORKDIR /app

# Install runtime utilities needed by Start9 scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl bash ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Install and verify the pinned yq release used to read StartOS config.
ARG TARGETARCH
ARG YQ_VERSION=v4.53.2
RUN case "$TARGETARCH" in \
      amd64) YQ_SHA256="d56bf5c6819e8e696340c312bd70f849dc1678a7cda9c2ad63eebd906371d56b" ;; \
      arm64) YQ_SHA256="03061b2a50c7a498de2bbb92d7cb078ce433011f085a4994117c2726be4106ea" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl -fsSLo /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${TARGETARCH}" && \
    echo "${YQ_SHA256}  /usr/local/bin/yq" | sha256sum -c - && \
    chmod +x /usr/local/bin/yq

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

# Copy Start9 scripts
COPY start9/docker_entrypoint.sh /usr/local/bin/
COPY start9/check-api.sh /usr/local/bin/
COPY start9/backup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker_entrypoint.sh /usr/local/bin/check-api.sh /usr/local/bin/backup.sh

STOPSIGNAL SIGINT

ENTRYPOINT ["docker_entrypoint.sh"]
