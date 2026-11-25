#!/usr/bin/env bash
# Instala PlantUML (el .jar oficial de github.com/plantuml/plantuml) y un comando `plantuml`.
# Verifica el SHA-256 que GitHub publica para el archivo. Lo usa también la action.
#
#   scripts/instalar-plantuml.sh [--dir DIR] [--bin DIR] [VERSION]
#
#   VERSION   p. ej. 1.2026.10, o "latest" (por omisión, la versión fijada abajo).
#   --dir     dónde guardar el .jar (por omisión ~/.local/share/plantuml).
#   --bin     dónde crear el comando plantuml (por omisión ~/.local/bin).
#
# Necesita curl, node (para leer la API de GitHub) y Java 11 o más para ejecutarlo; Graphviz
# (dot) para los diagramas de clases, componentes, etc. Si GH_TOKEN o GITHUB_TOKEN están
# definidos, se usan para la API de GitHub (evita el límite de consultas anónimas).
set -euo pipefail

VERSION_FIJADA="1.2026.10"
version="$VERSION_FIJADA"
dir="${XDG_DATA_HOME:-$HOME/.local/share}/plantuml"
bin="$HOME/.local/bin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    --bin) bin="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "opción desconocida: $1" >&2; exit 2 ;;
    *) version="${1#v}"; shift ;;
  esac
done

api() {
  local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -n "$token" ]; then
    curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "https://api.github.com/$1"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/$1"
  fi
}

if [ "$version" = "latest" ]; then
  release=$(api repos/plantuml/plantuml/releases/latest)
else
  release=$(api "repos/plantuml/plantuml/releases/tags/v$version")
fi
read -r version url digest < <(node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const v = r.tag_name.replace(/^v/, "");
  const a = r.assets.find((a) => a.name === `plantuml-${v}.jar`);
  if (!a) { console.error(`el release ${r.tag_name} no tiene plantuml-${v}.jar`); process.exit(1); }
  console.log(v, a.browser_download_url, (a.digest || "").replace(/^sha256:/, "") || "-");
' <<<"$release")

jar="$dir/plantuml-$version.jar"
mkdir -p "$dir" "$bin"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
if [ -f "$jar" ] && { [ "$digest" = "-" ] || [ "$(sha "$jar")" = "$digest" ]; }; then
  echo "PlantUML $version ya estaba en $jar"
else
  echo "Descargando PlantUML $version…"
  curl -fsSL -o "$jar.tmp" "$url"
  if [ "$digest" = "-" ]; then
    echo "aviso: GitHub no publica el SHA-256 de este archivo; no se pudo verificar" >&2
  elif [ "$(sha "$jar.tmp")" != "$digest" ]; then
    rm -f "$jar.tmp"
    echo "error: el SHA-256 de plantuml-$version.jar no coincide con el publicado" >&2
    exit 1
  fi
  mv "$jar.tmp" "$jar"
fi

# El comando plantuml: se crea o se actualiza sólo si no existe o si lo creó este script.
cmd="$bin/plantuml"
if [ -e "$cmd" ] && ! grep -q "plantuml-myst" "$cmd" 2>/dev/null; then
  echo "aviso: $cmd ya existe y no lo creó este script; no se modifica" >&2
else
  cat > "$cmd" <<EOF
#!/usr/bin/env bash
# Creado por plantuml-myst/scripts/instalar-plantuml.sh
exec java \${PLANTUML_JAVA_OPTS:--Djava.awt.headless=true} -jar "$jar" "\$@"
EOF
  chmod +x "$cmd"
fi

command -v java >/dev/null || echo "aviso: no se encontró java; PlantUML necesita Java 11 o más" >&2
command -v dot >/dev/null || echo "aviso: no se encontró Graphviz (dot); los diagramas de clases y de componentes lo necesitan" >&2
case ":$PATH:" in *":$bin:"*) ;; *) echo "aviso: $bin no está en el PATH" >&2 ;; esac

echo "PLANTUML_JAR=$jar"
echo "PLANTUML_VERSION=$version"
