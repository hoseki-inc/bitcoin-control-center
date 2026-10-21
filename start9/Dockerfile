FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ARG TARGETARCH
ENV NODE_VERSION=22.23.4
ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production

WORKDIR /app

# Install runtime utilities needed by Start9 scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl bash ca-certificates tini \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' \
    && rm -rf /var/lib/apt/lists/*

# The official 22.23.4 multi-arch image is not yet published. Upgrade the pinned
# base before running npm or Sentinel; replace this step with a patched image
# digest once available. Hashes: https://nodejs.org/dist/v22.23.4/SHASUMS256.txt
# This release blocks the compromised eMudhra keys in Node's own TLS stack.
RUN case "$TARGETARCH" in \
      amd64) NODE_ARCH=x64; NODE_SHA256=b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406 ;; \
      arm64) NODE_ARCH=arm64; NODE_SHA256=f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl -fsSLo /tmp/node.tar.gz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" && \
    echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 --no-same-owner && \
    rm /tmp/node.tar.gz && \
    test "$(node --version)" = "v${NODE_VERSION}"

# Install and verify the pinned yq release used to read StartOS config.
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

# Copy the Start9 entrypoint
COPY start9/docker_entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker_entrypoint.sh

STOPSIGNAL SIGINT

ENTRYPOINT ["docker_entrypoint.sh"]
