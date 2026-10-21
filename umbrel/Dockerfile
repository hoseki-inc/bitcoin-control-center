# Platform-neutral runtime image for the Umbrel package. umbrel/build.sh builds
# Sentinel and the web app first, then builds this image from the repository root.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ARG TARGETARCH
ENV NODE_VERSION=22.23.4
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3400 \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tini \
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

# api-sentinel is bundled by esbuild — only the externals listed in
# apps/api-sentinel/src/scripts/build.ts need to be in node_modules. The StartOS
# image installs the same pinned runtime dependencies.
COPY start9/runtime/package.json start9/runtime/package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY apps/api-sentinel/dist ./dist
COPY apps/api-sentinel/assets ./assets
COPY apps/control-center/dist ./public

# The node user is UID/GID 1000, which owns Umbrel app data directories.
RUN mkdir /data && chown node:node /data
USER node

EXPOSE 3400

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "/app/dist/cli.js"]
