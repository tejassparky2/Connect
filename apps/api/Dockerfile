# syntax=docker/dockerfile:1
# Build from repo root:  docker build -f apps/api/Dockerfile -t mohalla-api .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w apps/api && npm prune --omit=dev -w apps/api

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
RUN mkdir -p uploads && chown -R node:node /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. (For multi-replica deploys run migrations as a separate release step.)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
