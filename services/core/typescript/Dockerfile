FROM node:26.11.1-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/game-sim/package.json packages/game-sim/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages/game-sim packages/game-sim
COPY services/core/typescript services/core/typescript
COPY services/core/backend/migrations services/core/backend/migrations
RUN npm run build:core:typescript
RUN npm prune --omit=dev

FROM node:26.11.1-alpine
WORKDIR /src
ENV NODE_ENV=production
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/game-sim/package.json ./packages/game-sim/package.json
COPY --from=build /src/packages/game-sim/dist ./packages/game-sim/dist
COPY --from=build /src/services/core/typescript/dist ./services/core/typescript/dist
COPY --from=build /src/services/core/backend/migrations ./services/core/backend/migrations
USER node
EXPOSE 8080
CMD ["node", "services/core/typescript/dist/main.js"]
