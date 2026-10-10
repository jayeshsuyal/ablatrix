FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# npm can silently omit an optional native package after a failed download.
# Retry the locked install once using its cache; the build still fails if unavailable.
RUN node --input-type=module -e "await import('rolldown');" || npm ci --prefer-offline --include=optional --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY server ./server
COPY web ./web
COPY sapiom-agent ./sapiom-agent
COPY scripts ./scripts
COPY data ./data
COPY configs ./configs
COPY docs/evidence ./docs/evidence
RUN npm run build

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS demo
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The server runs TypeScript through the pinned tsx runtime; tsc is a check, not a server compiler.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/data ./data
COPY --from=build /app/configs ./configs
COPY --from=build /app/docs ./docs
RUN mkdir /data && chown node:node /data
USER node
ARG BUILD_COMMIT=unknown
ENV ABLATRIX_BUILD_COMMIT=$BUILD_COMMIT
ENV NODE_ENV=production ABLATRIX_HOSTED_DEMO=1 ABLATRIX_DATA_DIR=/data PORT=4173
EXPOSE 4173
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "const s=require('node:net').connect(4173,'127.0.0.1');s.setTimeout(2000);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));"]
ENTRYPOINT ["sh", "/app/scripts/demo-entrypoint.sh"]
CMD ["node", "--import", "tsx", "server/index.ts"]
