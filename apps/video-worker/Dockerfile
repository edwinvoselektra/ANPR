FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/anpr-worker/package.json apps/anpr-worker/package.json
COPY apps/video-worker/package.json apps/video-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps/video-worker apps/video-worker
COPY packages packages

FROM base AS development
RUN npm run build -w @anpr/shared
RUN npm run db:generate
EXPOSE 4100

FROM development AS build
RUN npm run build -w @anpr/video-worker

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/video-worker/dist ./apps/video-worker/dist
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/video-worker/package.json ./apps/video-worker/package.json
USER node
EXPOSE 4100
CMD ["node", "apps/video-worker/dist/index.js"]
