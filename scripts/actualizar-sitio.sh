#!/usr/bin/env bash
# Actualiza la copia del plugin (plugins/plantuml-myst.mjs) en uno o más sitios MyST, la prueba
# construyendo cada sitio y, si se pide, hace el commit. Nunca hace push.
#
#   scripts/actualizar-sitio.sh [--release TAG] [--commit] [--sin-probar] SITIO...
#
#   SITIO          directorio con el myst.yml del sitio.
#   --release TAG  usa el release TAG de GitHub (o "latest") y verifica su SHA256SUMS.
#                  Sin --release, usa src/plantuml-myst.mjs de este repositorio.
#   --commit       hace el commit de plugins/plantuml-myst.mjs en cada sitio (sólo ese archivo).
#   --sin-probar   no construye el sitio con `myst build --site` para probarlo (la prueba
#                  necesita PlantUML: scripts/instalar-plantuml.sh).
#
# Si la prueba falla, el sitio vuelve a la copia anterior del plugin.
set -euo pipefail

# ── Lo único que cambia entre plantuml-myst y dibu-myst ──────────────────────────────────
REPO="INGCOM-UNRN/plantuml-myst"
ARCHIVO="plantuml-myst.mjs"
ERRORES='PlantUML: |plantuml-myst:'          # mensajes del plugin en el log de myst
plugin_local() { echo "$PWD/src/$ARCHIVO"; }
# ─────────────────────────────────────────────────────────────────────────────────────────

release="" commit=false probar=true sitios=()
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release="${2:?falta el tag}"; shift 2 ;;
    --commit) commit=true; shift ;;
    --sin-probar) probar=false; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "opción desconocida: $1" >&2; exit 2 ;;
    *) [ -d "$1" ] || { echo "no existe el directorio $1" >&2; exit 2; }
       sitios+=("$(cd "$1" && pwd)"); shift ;;
  esac
done
[ ${#sitios[@]} -gt 0 ] || { echo "uso: $0 [--release TAG] [--commit] [--sin-probar] SITIO..." >&2; exit 2; }
cd "$(dirname "$0")/.."
if $probar && ! command -v myst > /dev/null; then
  echo "error: no se encontró myst (npm install -g mystmd), o usá --sin-probar" >&2; exit 2
fi

describir() {
  local v m
  v=$(sed -n 's/^export const VERSION = "\(.*\)";/\1/p' "$1")
  m=$(sed -n 's/^export const MOTOR = "\(.*\)";/\1/p' "$1")
  echo "${v:-?}${m:+ (dibu $m)}"
}

# 1. El plugin nuevo.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ -n "$release" ]; then
  if [ "$release" = "latest" ]; then base="https://github.com/$REPO/releases/latest/download"
  else base="https://github.com/$REPO/releases/download/$release"; fi
  echo "· descargando $ARCHIVO de $base"
  curl -fsSL -o "$tmp/$ARCHIVO" "$base/$ARCHIVO"
  curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
  (cd "$tmp" && grep " $ARCHIVO\$" SHA256SUMS | sha256sum -c --quiet -) || { echo "error: el SHA-256 no coincide" >&2; exit 1; }
  nuevo="$tmp/$ARCHIVO"
  origen="release $release"
else
  echo "· plugin desde $(git rev-parse --short HEAD 2>/dev/null || echo '?') de $REPO"
  nuevo=$(plugin_local)
  origen="$(basename "$PWD") $(git rev-parse --short HEAD 2>/dev/null || echo '?')$(git diff --quiet 2>/dev/null || echo '-modificado')"
fi
version=$(describir "$nuevo")
echo "· $ARCHIVO $version"

# 2. Cada sitio.
fallas=0
for sitio in "${sitios[@]}"; do
  echo
  echo "== $sitio"
  destino="$sitio/plugins/$ARCHIVO"
  if [ ! -f "$sitio/myst.yml" ]; then echo "✗ no hay myst.yml"; fallas=$((fallas + 1)); continue; fi
  if ! grep -qE "^\s*-\s*['\"]?(\./)?plugins/$ARCHIVO['\"]?\s*$" "$sitio/myst.yml"; then
    echo "✗ el myst.yml no carga plugins/$ARCHIVO. Agregalo en project.plugins:"
    echo "    project:"
    echo "      plugins:"
    echo "        - plugins/$ARCHIVO"
    fallas=$((fallas + 1)); continue
  fi
  if [ -f "$destino" ] && cmp -s "$nuevo" "$destino"; then
    echo "✓ ya tiene $ARCHIVO $version"; continue
  fi
  anterior="nada"
  if [ -f "$destino" ]; then anterior=$(describir "$destino"); cp "$destino" "$tmp/anterior.mjs"; fi
  mkdir -p "$sitio/plugins"
  cp "$nuevo" "$destino"
  echo "· $anterior → $version"

  if $probar; then
    echo "· myst build --site"
    log="$tmp/myst.log"
    problema=""
    if ! (cd "$sitio" && myst build --site > "$log" 2>&1); then
      problema="myst terminó con error (puede no deberse al plugin: revisá el log)"
    elif ! grep -q "🔌.*plugins/$ARCHIVO" "$log"; then
      problema="myst no cargó plugins/$ARCHIVO"
    elif grep -v "🔌" "$log" | grep -qE "$ERRORES|plugins/$ARCHIVO"; then
      problema="el plugin informó errores"
    fi
    if [ -z "$problema" ]; then
      echo "✓ el sitio se construye y el plugin cargó sin errores"
    else
      echo "✗ $problema; se restaura la copia anterior. Del log:"
      grep -E "🔌|⛔|$ERRORES|plugins/$ARCHIVO" "$log" | tail -15 || tail -15 "$log"
      cp "$log" "$sitio/_build/actualizar-plugin.log" 2>/dev/null && echo "  (log completo: $sitio/_build/actualizar-plugin.log)"
      if [ -f "$tmp/anterior.mjs" ]; then cp "$tmp/anterior.mjs" "$destino"; else rm -f "$destino"; fi
      fallas=$((fallas + 1)); continue
    fi
  fi

  if $commit; then
    git -C "$sitio" add -- "plugins/$ARCHIVO"
    git -C "$sitio" commit -q -m "build(myst): actualizar ${ARCHIVO%.mjs} a $version" \
      -m "Copia de plugins/$ARCHIVO tomada de $origen." -- "plugins/$ARCHIVO"
    echo "✓ commit $(git -C "$sitio" log -1 --format=%h) (sin push)"
  fi
done
exit $((fallas > 0))
