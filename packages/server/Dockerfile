FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache openssl
RUN npm install -g pnpm@10.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/setup scripts/setup
COPY patches patches
COPY packages/server/package.json packages/server/package.json
COPY packages/server/prisma packages/server/prisma
COPY packages/client/package.json packages/client/package.json

RUN LEFTHOOK=0 pnpm install --filter ocean-wave-server --filter ocean-wave-client --frozen-lockfile

COPY packages/server packages/server
COPY packages/client packages/client

RUN pnpm --filter ocean-wave-client build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl
RUN npm install -g pnpm@10.25.0

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/client/package.json ./packages/client/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist

WORKDIR /app/packages/server

EXPOSE 44100

RUN ln -s /app/packages/server/prisma/data /data
RUN ln -s /app/packages/server/cache /cache
RUN ln -s /app/packages/server/music /music

ENTRYPOINT ["pnpm"]
CMD ["start"]
