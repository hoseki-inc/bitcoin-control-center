# Platform-neutral runtime image for the Umbrel package. umbrel/build.sh builds
# Sentinel and the web app first, then builds this image from the repository root.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3400 \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

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
