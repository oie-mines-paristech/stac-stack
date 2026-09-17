# Pinned by digest (node:lts-alpine = v24 at pin time). Re-pin on bump: bump the
# tag, then docker inspect --format '{{index .RepoDigests 0}}' node:lts-alpine.
FROM node:lts-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS build

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

FROM node:lts-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/docker/serve.js /usr/local/bin/serve.js
COPY config.schema.json /etc/stac/config.schema.json

EXPOSE 8081

ENTRYPOINT ["node", "/usr/local/bin/serve.js"]