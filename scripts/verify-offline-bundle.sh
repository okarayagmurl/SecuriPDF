#!/usr/bin/env bash
# Offline paket hazirlik dogrulamasi — build sonrasi calistirin.
# Kullanim: bash scripts/verify-offline-bundle.sh
#           bash scripts/verify-offline-bundle.sh --dist /home/spfadm/SecuriPDF/dist
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST="${ROOT_DIR}/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist) DIST="$2"; shift 2 ;;
    -h|--help) echo "Kullanim: $0 [--dist DIR]"; exit 0 ;;
    *) echo "Bilinmeyen: $1" >&2; exit 1 ;;
  esac
done

VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION" 2>/dev/null || true)"
PREV="$(grep -E '^PREV_VERSION=' "${SCRIPT_DIR}/build-offline-bundle.sh" | head -1 | sed -n 's/.*PREV_VERSION:-//;s/}.*//p' || true)"
# Fallback: script icindeki default
PREV="${PREV_VERSION:-1.2.0-stirling-2.14.3}"

echo "=== SecuriPDF offline paket dogrulama ==="
echo "Repo: ${ROOT_DIR}"
echo "VERSION: ${VERSION}"
echo "DIST: ${DIST}"
echo ""

fail=0
ok() { echo "[OK] $*"; }
bad() { echo "[FAIL] $*"; fail=1; }
warn() { echo "[WARN] $*"; }

[[ -n "${VERSION}" ]] || bad "VERSION dosyasi bos"
[[ -d "${DIST}" ]] || bad "dist/ yok — once bash scripts/build-offline-bundle.sh"

FULL_TGZ="${DIST}/securipdf-${VERSION}-offline.tar.gz"
FULL_DIR="${DIST}/securipdf-${VERSION}-offline"
DELTA_GLOB="${DIST}/securipdf-*_to_${VERSION}-delta.tar.gz"

if [[ -f "${FULL_TGZ}" ]]; then
  ok "Full paket: ${FULL_TGZ} ($(du -h "${FULL_TGZ}" | cut -f1))"
else
  bad "Full paket yok: ${FULL_TGZ}"
fi

if [[ -f "${FULL_TGZ}.sha256" ]]; then
  ok "Full sha256 dosyasi var"
  if command -v sha256sum &>/dev/null; then
    (cd "${DIST}" && sha256sum -c "securipdf-${VERSION}-offline.tar.gz.sha256") && ok "Full sha256 dogrulandi" || bad "Full sha256 uyusmuyor"
  fi
else
  warn "Full .sha256 yok"
fi

if [[ -d "${FULL_DIR}" ]]; then
  for need in MANIFEST.json images/securipdf-images.tar docker/docker-compose.yml \
    docker/docker-compose.auth.yml docker/docker-compose.offline.yml \
    scripts/upgrade-offline-stack.sh scripts/securipdf-updater/updater.py \
    scripts/securipdf-updater/diag_page.py scripts/securipdf-updater/install-updater.sh \
    installer/install.sh config/license-packages.yml; do
    if [[ -e "${FULL_DIR}/${need}" ]]; then
      ok "icerik: ${need}"
    else
      bad "eksik: ${need}"
    fi
  done
  if [[ -f "${FULL_DIR}/MANIFEST.json" ]]; then
    kind="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("package_kind","?"))' "${FULL_DIR}/MANIFEST.json" 2>/dev/null || echo "?")"
    ver="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "${FULL_DIR}/MANIFEST.json" 2>/dev/null || true)"
    [[ "${kind}" == "full" ]] && ok "MANIFEST.package_kind=full" || bad "MANIFEST.package_kind=${kind} (full beklenir)"
    [[ "${ver}" == "${VERSION}" ]] && ok "MANIFEST.version=${ver}" || bad "MANIFEST.version=${ver} != VERSION"
    # diag + license demo
    python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); assert m.get("diag_url")' "${FULL_DIR}/MANIFEST.json" 2>/dev/null \
      && ok "MANIFEST.diag_url var" || warn "MANIFEST.diag_url yok (eski paket?)"
  fi
  deb_n=0
  [[ -d "${FULL_DIR}/offline/debs" ]] && deb_n=$(find "${FULL_DIR}/offline/debs" -name '*.deb' 2>/dev/null | wc -l)
  if [[ "${deb_n}" -gt 0 ]]; then
    ok "offline/debs: ${deb_n} dosya"
  else
    warn "offline/debs bos — musteri Docker onceden kurulu olmali"
  fi
else
  warn "Acik full dizin yok (${FULL_DIR}) — sadece tar.gz varsa extract edin: tar tzf ..."
fi

delta_found=0
shopt -s nullglob
for d in ${DIST}/securipdf-*_to_${VERSION}-delta.tar.gz; do
  delta_found=1
  ok "Delta paket: ${d} ($(du -h "${d}" | cut -f1))"
  [[ -f "${d}.sha256" ]] && ok "Delta sha256 var" || warn "Delta sha256 yok"
done
shopt -u nullglob
if [[ "${delta_found}" -eq 0 ]]; then
  bad "Delta paket yok (beklenen: securipdf-<from>_to_${VERSION}-delta.tar.gz)"
  echo "  Cozum: bash scripts/build-offline-delta.sh --from ${PREV}"
  echo "  veya full build'i yeniden calistirin (delta otomatik)."
fi

# Repo guncellik
if [[ -d "${ROOT_DIR}/.git" ]]; then
  branch="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
  head="$(git -C "${ROOT_DIR}" log -1 --oneline 2>/dev/null || echo "?")"
  ok "git ${branch} @ ${head}"
  if git -C "${ROOT_DIR}" status --porcelain 2>/dev/null | grep -q .; then
    warn "Calisma agacinda commit edilmemis degisiklik var"
  fi
fi

# Docker image'lar (build makinesi)
if command -v docker &>/dev/null && docker info &>/dev/null; then
  for img in "entera-pdf:${VERSION}" "securipdf-platform:${VERSION}"; do
    if docker image inspect "${img}" &>/dev/null; then
      ok "docker image: ${img}"
    else
      warn "docker image yok (henuz build edilmedi?): ${img}"
    fi
  done
else
  warn "Docker erisilemiyor — image kontrolu atlandi"
fi

echo ""
if [[ "${fail}" -eq 0 ]]; then
  echo "SONUC: HAZIR — full + delta indirilebilir / temiz kurulum icin kullanilabilir."
  exit 0
else
  echo "SONUC: EKSIK VAR — yukardaki FAIL satirlarini giderin."
  exit 1
fi
