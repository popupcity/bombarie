# syntax=docker/dockerfile:1
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 BOMBARIE_ROOT=/data BOMBARIE_TOKENS=/config/tokens.json BOMBARIE_APPS=/config/apps.json
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data /config && chown node:node /data /config
USER node
VOLUME ["/data", "/config"]
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4321/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
