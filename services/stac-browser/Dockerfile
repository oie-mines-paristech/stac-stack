FROM node:lts-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Full build (node_modules + src) for dev-mode serving via vue-cli-service.
FROM build AS dev

COPY --from=build /app/docker/serve.js /usr/local/bin/serve.js
COPY config.schema.json /etc/stac/config.schema.json

EXPOSE 8081

ENTRYPOINT ["node", "/usr/local/bin/serve.js"]

FROM node:lts-alpine

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/docker/serve.js /usr/local/bin/serve.js
COPY config.schema.json /etc/stac/config.schema.json

EXPOSE 8081

ENTRYPOINT ["node", "/usr/local/bin/serve.js"]