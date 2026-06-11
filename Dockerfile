FROM node:22-alpine
WORKDIR /app
COPY packages/mcp/dist/ ./dist/
COPY packages/mcp/package.json ./
COPY packages/cli/dist/ ./node_modules/the-i18n-cli/dist/
COPY packages/cli/package.json ./node_modules/the-i18n-cli/package.json
COPY node_modules/zod ./node_modules/zod
COPY node_modules/@modelcontextprotocol ./node_modules/@modelcontextprotocol
ENV I18N_PROJECT_DIR=/project
ENTRYPOINT ["node", "dist/index.js"]
