#!/usr/bin/env bash
# Construye el sitio de ejemplo con mystmd y verifica que el plugin haya dibujado todo:
# ningún bloque plantuml/puml sin dibujar, cada figura con su etiqueta, ninguna advertencia
# de PlantUML, y que el build haya usado los diagramas que dejó scripts/prerenderizar.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p salida
cd ejemplo
rm -rf _build/site _build/cache _build/plantuml
node ../scripts/prerenderizar.mjs --estricto .
antes=$(ls _build/plantuml/*.svg | wc -l)
myst build --site --strict 2>&1 | tee ../salida/myst.log
despues=$(ls _build/plantuml/*.svg | wc -l)
python3 - <<'PY'
import glob, json, os, sys
paginas = glob.glob("_build/site/content/*.json")
assert paginas, "no se generó el contenido del sitio"
imagenes, etiquetas, errores = 0, set(), []
def recorrer(n, pagina):
    global imagenes
    t = n.get("type")
    if t == "code" and n.get("lang") in ("plantuml", "puml"):
        errores.append(f"{pagina}: bloque {n.get('lang')} sin dibujar")
    if t == "mystDirective" or (t == "admonition" and n.get("kind") == "danger"):
        errores.append(f"{pagina}: {t} sin procesar o con error")
    if t == "container" and n.get("kind") == "figure" and n.get("label"):
        etiquetas.add(n["label"])
    if t == "image":
        imagenes += 1
        url = n.get("url", "")
        if not os.path.exists("_build/site/public" + url):
            errores.append(f"{pagina}: falta la imagen {url}")
    for c in n.get("children", []):
        recorrer(c, pagina)
for p in paginas:
    recorrer(json.load(open(p))["mdast"], os.path.basename(p))
print(f"páginas: {len(paginas)}, diagramas: {imagenes}, figuras: {sorted(etiquetas)}")
if imagenes < 5:
    errores.append(f"se esperaban al menos 5 diagramas, hay {imagenes}")
for e in ("fig-clases", "fig-estados"):
    if e not in etiquetas:
        errores.append(f"falta la figura {e}")
if errores:
    print("\n".join(errores)); sys.exit(1)
PY
if grep -v "🔌" ../salida/myst.log | grep -qi "plantuml"; then echo "✗ advertencias de PlantUML en el build"; exit 1; fi
if [ "$antes" != "$despues" ]; then echo "✗ el build dibujó diagramas que el pre-renderizado no encontró ($antes → $despues)"; exit 1; fi
echo "✓ sitio de ejemplo ($despues diagramas, todos desde la caché del pre-renderizado)"
