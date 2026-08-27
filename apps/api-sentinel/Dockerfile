# Stage 1: Install and compile native dependencies
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /deps
COPY apps/api-sentinel/package.docker.json ./package.json
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --no-frozen-lockfile

# Stage 2: Final runtime image
FROM node:22-alpine

ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production

WORKDIR /app

# Install runtime utilities needed by Start9 scripts
RUN apk add --no-cache curl bash ca-certificates tini yq

# Copy pre-built node_modules from deps stage (no build tools in final image)
COPY --from=deps /deps/node_modules ./node_modules

# Copy api-sentinel build output + assets
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
