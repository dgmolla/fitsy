FROM node:22-bookworm-slim AS dependencies
WORKDIR /source
COPY package-lock.json ./package-lock.json
COPY scripts/pipeline-v2/cloud/runtime-manifest.mjs ./scripts/pipeline-v2/cloud/runtime-manifest.mjs
RUN node scripts/pipeline-v2/cloud/runtime-manifest.mjs /dependencies
WORKDIR /dependencies
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY --from=dependencies /dependencies/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY apps/api/services ./apps/api/services
COPY packages/shared/src ./packages/shared/src
COPY prisma ./prisma
RUN node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma
ARG SOURCE_REVISION=uncommitted
RUN SOURCE_REVISION=$SOURCE_REVISION node scripts/pipeline-v2/cloud/build.mjs /worker

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
ENV NODE_ENV=production PORT=8080
COPY --from=build --chown=node:node /worker/*.cjs /worker/source.json ./
COPY --from=build --chown=node:node /source/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=node:node /source/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "pipeline-cloud-worker.cjs"]
