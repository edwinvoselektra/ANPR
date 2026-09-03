FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/anpr-worker/package.json apps/anpr-worker/package.json
COPY apps/video-worker/package.json apps/video-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps/web apps/web
COPY packages/shared packages/shared

FROM base AS development
RUN npm run build -w @anpr/shared
EXPOSE 3000

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @anpr/shared
RUN npm run build -w @anpr/web

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
