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
ARG OPSTAGE_VERSION=dev
ARG OPSTAGE_COMMIT=unknown
ARG OPSTAGE_BUILD_TIME=unknown
LABEL org.opencontainers.image.title="Opstage CE" \
      org.opencontainers.image.description="Lightweight self-hosted control plane for Capsule Services." \
      org.opencontainers.image.vendor="Xtrape Capsule contributors" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.url="https://xtrape-com.github.io/xtrape-capsule-site/" \
      org.opencontainers.image.documentation="https://xtrape-com.github.io/xtrape-capsule-site/opstage-ce/overview" \
      org.opencontainers.image.source="https://github.com/xtrape-com/xtrape-capsule-ce" \
      org.opencontainers.image.version="${OPSTAGE_VERSION}" \
      org.opencontainers.image.revision="${OPSTAGE_COMMIT}" \
      org.opencontainers.image.created="${OPSTAGE_BUILD_TIME}"
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
    OPSTAGE_STATIC_DIR=/app/apps/opstage-ui/dist \
    OPSTAGE_VERSION=${OPSTAGE_VERSION} \
    OPSTAGE_COMMIT=${OPSTAGE_COMMIT} \
    OPSTAGE_BUILD_TIME=${OPSTAGE_BUILD_TIME}
COPY --from=build --chown=opstage:opstage /app /app
USER opstage
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/opstage-backend/dist/main.js"]
