# Platform-neutral runtime image for the Umbrel package. umbrel/build.sh builds
# Sentinel and the web app first, then builds this image from the repository root.
FROM node:22.23.4-bookworm-slim@sha256:5991875dfb80938dd8a6ba3fe3e96fd04929e70792762b3319d8caadbbe229bc

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3400 \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' \
    && rm -rf /var/lib/apt/lists/*

# Node 22.23.4 blocks the compromised eMudhra keys in its own TLS stack.
RUN test "$(node --version)" = "v22.23.4"

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
