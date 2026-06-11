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

# Runtime stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/mcp/dist/ ./dist/
COPY --from=build /app/packages/mcp/package.json ./
COPY --from=build /app/packages/cli/dist/ ./node_modules/the-i18n-cli/dist/
COPY --from=build /app/packages/cli/package.json ./node_modules/the-i18n-cli/package.json
COPY --from=build /app/node_modules/zod ./node_modules/zod
COPY --from=build /app/node_modules/@modelcontextprotocol ./node_modules/@modelcontextprotocol
ENV I18N_PROJECT_DIR=/project
ENTRYPOINT ["node", "dist/index.js"]
