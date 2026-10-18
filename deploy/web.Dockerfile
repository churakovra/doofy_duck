FROM node:26.11.1-alpine AS build
WORKDIR /src
ARG DD_LOCAL_DEV_AUTH=false
ARG DD_LOCAL_DEV_USER_ID=100000001
ENV VITE_DD_DEV_AUTH_ENABLED=$DD_LOCAL_DEV_AUTH
ENV VITE_DD_DEV_USER_ID=$DD_LOCAL_DEV_USER_ID
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
