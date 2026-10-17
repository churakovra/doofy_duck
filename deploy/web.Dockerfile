FROM node:26.11.1-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/game-sim/package.json packages/game-sim/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29.3-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/web /usr/share/nginx/html
EXPOSE 80
