FROM node:26-bookworm-slim AS build
WORKDIR /app
# Bun installs the workspace; Node builds and runs the app.
COPY --from=oven/bun:1.4.5-slim /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui-web/package.json ./packages/ui-web/
COPY packages/design-tokens/package.json ./packages/design-tokens/
# The root brings TypeScript, which the web build finds by walking up from apps/web.
RUN bun install --frozen-lockfile --ignore-scripts --filter forwend-monorepo \
  --filter @forwend/web --filter @forwend/ui-web --filter @forwend/design-tokens
COPY tsconfig.base.json ./
COPY apps/web/ ./apps/web/
COPY packages/ui-web/ ./packages/ui-web/
COPY packages/design-tokens/ ./packages/design-tokens/
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_WALLET_MFA
ENV NEXT_PUBLIC_WALLET_MFA=$NEXT_PUBLIC_WALLET_MFA
ENV API_URL=http://api:8080
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd apps/web build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# src/proxy.ts asks the api at run time whether a page may frame /embed (R-168).
ENV API_URL=http://api:8080
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
