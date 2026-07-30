FROM node:20-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

EXPOSE 3000

# Push the schema (idempotent; TiDB patcher runs first), then boot the server.
CMD ["sh", "-c", "pnpm run db:push && NODE_ENV=production node dist/boot.js"]
