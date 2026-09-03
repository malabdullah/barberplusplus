FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine3.24@sha256:45ce1e2e699234253d1def7baa96218a5d00b498d1ba0cbb1a17b6bdf73d1351

ARG APP_RELEASE=unknown
ENV APP_RELEASE=$APP_RELEASE

COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html
COPY docker/runtime-config.js.template /opt/barber/runtime-config.js.template
COPY docker/nginx.conf.template /opt/barber/nginx.conf.template
COPY docker/20-configure-runtime.sh /docker-entrypoint.d/20-configure-runtime.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
