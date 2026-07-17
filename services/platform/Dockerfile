FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

ARG SECURIPDF_VERSION=unknown
ARG SECURIPDF_BUILT_AT=
ARG STIRLING_VERSION=unknown

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# endesive pykcs11 (g++/swig) ister; platform yalnızca cms imza kullanır — HSM paketi atlanır.
RUN grep -v '^endesive==' requirements.txt > /tmp/requirements-no-endesive.txt \
    && pip install --no-cache-dir -r /tmp/requirements-no-endesive.txt \
    && pip install --no-cache-dir --no-deps endesive==2.19.3

COPY app ./app
COPY --from=frontend /frontend/dist ./app/static/app/react

RUN printf '%s\n' "${SECURIPDF_VERSION}" > /app/VERSION \
    && printf '{"version":"%s","stirling_version":"%s","built_at":"%s"}\n' \
         "${SECURIPDF_VERSION}" "${STIRLING_VERSION}" "${SECURIPDF_BUILT_AT}" > /app/RELEASE.json

ENV PYTHONUNBUFFERED=1
ENV PLATFORM_CONFIG=/config/platform.yml
ENV VAULT_CONFIG=/config/vault.yml
ENV LICENSE_CONFIG=/config/license.yml
ENV SECURITY_CONFIG=/config/security.yml

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
