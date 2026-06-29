FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine AS deps

WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack pnpm install --frozen-lockfile

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack pnpm next build

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5001
ENV DEPLOY_RUN_PORT=5001

RUN corepack enable
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/resources ./resources
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts /app/postcss.config.mjs /app/tsconfig.json ./

EXPOSE 5001
CMD ["./scripts/production-server.sh"]
