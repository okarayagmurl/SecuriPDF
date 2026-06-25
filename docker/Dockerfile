# syntax=docker/dockerfile:1
# Entera PDF - İnce sarmalayıcı katman
# Upstream Stirling-PDF image'ını genişletir; core kod değiştirilmez.

ARG STIRLING_VERSION=2.13.1
ARG STIRLING_IMAGE=docker.stirlingpdf.com/stirlingtools/stirling-pdf

FROM ${STIRLING_IMAGE}:${STIRLING_VERSION}-fat AS base

FROM eclipse-temurin:21-jdk-alpine AS locale-patcher
ARG STIRLING_VERSION
COPY branding/locale/messages_tr_TR.properties /tmp/messages_tr_TR.properties
COPY --from=base /app/app.jar /app.jar
RUN mkdir -p /tmp/locale-patch/BOOT-INF/classes \
    && cp /tmp/messages_tr_TR.properties /tmp/locale-patch/BOOT-INF/classes/messages_tr_TR.properties \
    && jar uf /app.jar -C /tmp/locale-patch BOOT-INF/classes/messages_tr_TR.properties

FROM base

ARG STIRLING_VERSION

LABEL org.opencontainers.image.title="Entera PDF"
LABEL org.opencontainers.image.description="Kurumsal PDF platformu - Stirling-PDF tabanlı"
LABEL org.opencontainers.image.vendor="Entera"
LABEL io.entera.stirling-version="${STIRLING_VERSION}"

# Branding dosyalarini image'a gom (volume mount ile override edilebilir)
COPY branding/static/ /customFiles/static/
COPY branding/templates/ /customFiles/templates/
COPY --from=locale-patcher /app.jar /app/app.jar

# USER değiştirmeyin — upstream entrypoint volume izinlerini root olarak ayarlar

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -sf -o /dev/null http://localhost:8080/ || exit 1
