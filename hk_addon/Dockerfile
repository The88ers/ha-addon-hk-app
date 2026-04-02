# https://developers.home-assistant.io/docs/apps/configuration#app-dockerfile
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.23
FROM ${BUILD_FROM}

ARG TEMPIO_VERSION=2021.09.0
ARG TARGETARCH
RUN \
    if [ -z "${TARGETARCH}" ]; then \
        echo "TARGETARCH is not set, please use Docker BuildKit for the build." && exit 1; \
    fi \
    && case "${TARGETARCH}" in \
        amd64) tempio_arch="amd64" ;; \
        arm64) tempio_arch="aarch64" ;; \
        *) echo "Unsupported TARGETARCH: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -sSLf -o /usr/bin/tempio \
        "https://github.com/home-assistant/tempio/releases/download/${TEMPIO_VERSION}/tempio_${tempio_arch}" \
    && chmod a+x /usr/bin/tempio

RUN apk add --no-cache \
        nodejs \
        npm \
        tzdata

ENV TZ=Europe/Berlin

WORKDIR /app
COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY app/ ./

COPY rootfs /
RUN chmod a+x /etc/services.d/hk-addon/run

LABEL \
    io.hass.type="addon" \
    org.opencontainers.image.title="HK Addon" \
    org.opencontainers.image.description="Hühnerklappe – Web-UI und Scheduler für Home Assistant" \
    org.opencontainers.image.source="https://github.com/The88ers/ha-addon-hk-app" \
    org.opencontainers.image.licenses="Apache License 2.0"
