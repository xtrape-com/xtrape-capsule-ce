FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite-libs && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY deploy ./deploy
RUN pnpm install --frozen-lockfile && pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache dumb-init sqlite-libs \
  && addgroup -S opstage \
  && adduser -S opstage -G opstage \
  && mkdir -p /app/data \
  && chown -R opstage:opstage /app
ENV NODE_ENV=production \
    OPSTAGE_HOST=0.0.0.0 \
    OPSTAGE_PORT=8080 \
    DATABASE_URL=file:/app/data/opstage.db \
    OPSTAGE_STATIC_DIR=/app/apps/opstage-ui/dist
COPY --from=build --chown=opstage:opstage /app /app
USER opstage
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/opstage-backend/dist/main.js"]
