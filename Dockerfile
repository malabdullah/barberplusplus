FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6

# Apply the pinned distribution's available security updates at build time.
# The resulting image is scanned and deployed by immutable digest, never rebuilt
# between acceptance and production. Exact APK contents are recorded in the image.
USER root
RUN apk upgrade --no-cache && apk info -vv > /opt/apk-manifest.txt
USER 101

ARG APP_RELEASE=unknown
ENV APP_RELEASE=$APP_RELEASE

COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html
COPY docker/runtime-config.js.template /opt/barber/runtime-config.js.template
COPY docker/nginx.conf.template /opt/barber/nginx.conf.template
COPY docker/20-configure-runtime.sh /docker-entrypoint.d/20-configure-runtime.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
