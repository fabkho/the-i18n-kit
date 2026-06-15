# Build stage
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/tsconfig.json packages/cli/tsdown.config.ts ./packages/cli/
COPY packages/cli/src/ ./packages/cli/src/
COPY packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/tsdown.config.ts ./packages/mcp/
COPY packages/mcp/src/ ./packages/mcp/src/
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter the-i18n-mcp deploy --legacy /app/prod

# Runtime stage
FROM node:22-alpine
COPY --from=build /app/prod /app
WORKDIR /app
ENV I18N_PROJECT_DIR=/project
ENTRYPOINT ["node", "dist/index.js"]
