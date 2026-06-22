#!/usr/bin/env bash
# Entera PDF - Upstream Stirling-PDF senkronizasyonu
# Fork modeli: Entera-PDF reposunda Stirling upstream'i merge eder.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/Stirling-Tools/Stirling-PDF.git}"
CUSTOM_BRANCH="${CUSTOM_BRANCH:-entera-custom}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"

echo "=== Entera PDF Upstream Sync ==="
echo "Upstream: ${UPSTREAM_URL}"
echo "Branch:   ${CUSTOM_BRANCH} <- ${UPSTREAM_BRANCH}"
echo ""

cd "${ROOT_DIR}"

# Git repo kontrolü
if ! git rev-parse --git-dir &>/dev/null; then
  echo "Git repo başlatılıyor..."
  git init
fi

# Upstream remote ekle
if ! git remote get-url upstream &>/dev/null 2>&1; then
  echo "Upstream remote ekleniyor..."
  git remote add upstream "${UPSTREAM_URL}"
else
  echo "Upstream remote mevcut: $(git remote get-url upstream)"
fi

git fetch upstream

# Custom branch oluştur veya checkout
if git show-ref --verify --quiet "refs/heads/${CUSTOM_BRANCH}"; then
  git checkout "${CUSTOM_BRANCH}"
else
  git checkout -b "${CUSTOM_BRANCH}"
fi

echo ""
echo "Upstream merge başlatılıyor..."
if git merge "upstream/${UPSTREAM_BRANCH}" -m "chore: merge upstream/${UPSTREAM_BRANCH}"; then
  echo ""
  echo "Merge başarılı."
else
  echo ""
  echo "Merge conflict oluştu. Çözüm:"
  echo "  1. Sadece custom katman dosyalarını koruyun: branding/, config/, docker/, scripts/, docs/"
  echo "  2. Upstream değişikliklerini Stirling core dosyalarında kabul edin"
  echo "  3. git add . && git merge --continue"
  exit 1
fi

echo ""
echo "Sonraki adımlar:"
echo "  1. Yeni Stirling sürümünü .env içinde STIRLING_VERSION olarak güncelleyin"
echo "  2. VERSION dosyasını güncelleyin (örn. 1.1.0-stirling-0.47.0)"
echo "  3. ./scripts/sync-tools-config.sh"
echo "  4. ./scripts/update.sh"
