# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# shown in the header; CI passes the release tag (empty = the version in package.json)
ARG APP_VERSION=""
RUN APP_VERSION="$APP_VERSION" npm run build

# ---- runtime: static files + reverse proxy to IoT Open, non-root on :8080 ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV LYNX_URL=https://lynx.iotopen.se \
    ALLOWED_LYNX_HOSTS=lynx.iotopen.se \
    ALLOW_INSECURE_LYNX_URL=false \
    APP_TITLE="Dashboard" \
    BASE_PATH="" \
    LIVE_UPDATES=true \
    CUSTOM_SERVERS=true \
    API_MODE=proxy
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/snippets/ /etc/nginx/snippets/
# runs before the template is rendered; the container refuses to start on a suspicious LYNX_URL
COPY --chmod=0755 nginx/entrypoint/05-validate-lynx-url.sh /docker-entrypoint.d/05-validate-lynx-url.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
