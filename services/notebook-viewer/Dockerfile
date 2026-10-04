# Pinned by digest; re-pin with scripts/repin-digests.sh.
# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN npm run build

# Dev (`make dev-up` sets `target: dev`): see zarr-viewer/Dockerfile.
FROM build AS dev
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

# Runtime: entrypoint.sh only copies dist/ into the /out volume, so nothing else
# ships. Keeping node_modules out removed 33 HIGH findings (the devDependency
# esbuild binary alone carried 22 Go stdlib CVEs) for a static file server.
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]