# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_ZARR_PROXY=./proxy/
RUN npm run build

FROM alpine:3.20 AS export
COPY --from=build /app/dist /dist
VOLUME /out
CMD ["sh", "-c", "cp -a /dist/. /out/"]
