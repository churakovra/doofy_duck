FROM node:26.11.1-alpine AS build
WORKDIR /src
ENV VITE_DD_DEV_AUTH_ENABLED=false
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/game-sim/package.json packages/game-sim/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages/game-sim packages/game-sim
COPY apps/web apps/web
RUN npm run build

FROM caddy:2.10.2-alpine
COPY --from=build /src/dist/web /srv/game
