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
ARG RAR_VERSION=712

LABEL org.opencontainers.image.title="Entera PDF"
LABEL org.opencontainers.image.description="Kurumsal PDF platformu - Stirling-PDF tabanlı"
LABEL org.opencontainers.image.vendor="Entera"
LABEL io.entera.stirling-version="${STIRLING_VERSION}"

# Branding dosyalarini image'a gom (volume mount ile override edilebilir)
COPY branding/static/ /customFiles/static/
COPY branding/templates/ /customFiles/templates/
COPY --from=locale-patcher /app.jar /app/app.jar

# PDF→CBR: Stirling "rar" grubu (lisans nedeniyle resmi image'da yok). RARLAB trial binary.
# CBR→PDF Junrar (Java) kullanır; unrar gerekmez. Yalnızca x86_64.
USER root
RUN set -eux; \
    arch="$(uname -m)"; \
    if [ "$arch" = "x86_64" ] || [ "$arch" = "amd64" ]; then \
      mkdir -p /tmp/rarlab /usr/local/bin; \
      if command -v curl >/dev/null 2>&1; then \
        curl -fsSL -o /tmp/rarlab/rarlinux.tar.gz "https://www.rarlab.com/rar/rarlinux-x64-${RAR_VERSION}.tar.gz"; \
      elif command -v wget >/dev/null 2>&1; then \
        wget -qO /tmp/rarlab/rarlinux.tar.gz "https://www.rarlab.com/rar/rarlinux-x64-${RAR_VERSION}.tar.gz"; \
      else \
        (apt-get update && apt-get install -y --no-install-recommends curl ca-certificates wget) || true; \
        curl -fsSL -o /tmp/rarlab/rarlinux.tar.gz "https://www.rarlab.com/rar/rarlinux-x64-${RAR_VERSION}.tar.gz"; \
      fi; \
      tar -xzf /tmp/rarlab/rarlinux.tar.gz -C /tmp/rarlab; \
      install -m 755 /tmp/rarlab/rar/rar /usr/local/bin/rar; \
      ln -sf /usr/local/bin/rar /usr/bin/rar; \
      rm -rf /tmp/rarlab; \
      rar 2>&1 | head -n 2 || true; \
    else \
      echo "WARN: rar binary skipped on arch=$arch (PDF→CBR disabled until rar is provided)"; \
    fi
# USER değiştirmeyin — upstream entrypoint volume izinlerini root olarak ayarlar

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -sf -o /dev/null http://localhost:8080/ || exit 1
