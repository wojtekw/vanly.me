FROM node:24-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 UV_USE_IO_URING=0
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_OWNER_ORIGIN=https://owner.uat.vanly.me
ARG NEXT_PUBLIC_ADMIN_ORIGIN=https://admin.uat.vanly.me
ENV NEXT_PUBLIC_OWNER_ORIGIN=$NEXT_PUBLIC_OWNER_ORIGIN NEXT_PUBLIC_ADMIN_ORIGIN=$NEXT_PUBLIC_ADMIN_ORIGIN
RUN pnpm install --frozen-lockfile --prod=false && \
    pnpm --filter @vanly/api build && \
    pnpm --filter @vanly/frontoffice build && \
    pnpm --filter @vanly/owner build && \
    pnpm --filter @vanly/admin build
RUN mkdir -p /app/.local/uploads && chown -R node:node /app/.local
USER node
CMD ["node", "apps/api/dist/main.js"]
