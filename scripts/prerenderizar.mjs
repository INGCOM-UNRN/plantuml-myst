#!/usr/bin/env node
// Dibuja de una vez todos los diagramas de PlantUML de un proyecto MyST y los deja en la caché
// del plugin, para que `myst build` / `myst start` no tengan que ejecutar PlantUML página por
// página. También sirve para verificar los diagramas sin construir el sitio (--estricto).
//
//   node scripts/prerenderizar.mjs [--estricto] [--cache DIR] [PROYECTO]
//
// PROYECTO es el directorio con myst.yml (por omisión, el actual). La caché por omisión es
// PROYECTO/_build/plantuml, la misma que usa el plugin al construir desde PROYECTO.
// Encuentra los bloques ```plantuml / ```puml y las directivas {plantuml} / {uml} (con ``` o
// :::), también con el diagrama en un archivo, en todos los .md del proyecto.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IGNORAR = new Set(["_build", "node_modules", ".git", ".venv", "venv", "__pycache__"]);

/** Los .md de un directorio, recursivamente. */
export function archivosMarkdown(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name) || e.name.startsWith(".")) continue;
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosMarkdown(ruta));
    else if (/\.md$/i.test(e.name)) salida.push(ruta);
  }
  return salida.sort();
}

/**
 * Los diagramas de un texto MyST: [{linea, texto, theme, arg}]. `linea` es la del inicio del
 * bloque (desde 1); `arg`, el archivo de la directiva si lo tiene (entonces `texto` es "").
 */
export function extraerDiagramas(markdown) {
  const lineas = markdown.replace(/\r/g, "").split("\n");
  const diagramas = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(\s*)(`{3,}|~{3,}|:{3,})\s*(\{(plantuml|uml)\}|plantuml|puml)(?:\s+(.*?))?\s*$/);
    if (!m) continue;
    const [, sangria, valla, , directiva, resto] = m;
    if (valla[0] === ":" && !directiva) continue; // ::: sólo abre directivas
    const cierre = new RegExp(`^\\s*${valla[0] === "`" ? "`" : valla[0] === "~" ? "~" : ":"}{${valla.length},}\\s*$`);
    let j = i + 1;
    const cuerpo = [];
    while (j < lineas.length && !cierre.test(lineas[j])) {
      cuerpo.push(lineas[j].startsWith(sangria) ? lineas[j].slice(sangria.length) : lineas[j].trimStart());
      j++;
    }
    const diagrama = { linea: i + 1, texto: "", theme: undefined, arg: undefined };
    if (directiva) {
      // Opciones: líneas :clave: valor al principio, o un bloque YAML entre ---.
      let k = 0;
      if (cuerpo[0]?.trim() === "---") {
        k = 1;
        while (k < cuerpo.length && cuerpo[k].trim() !== "---") {
          const o = cuerpo[k].match(/^\s*(\w+)\s*:\s*(.*?)\s*$/);
          if (o && o[1] === "theme") diagrama.theme = o[2].replace(/^["']|["']$/g, "");
          k++;
        }
        k++;
      } else {
        while (k < cuerpo.length && /^\s*:\w+:/.test(cuerpo[k])) {
          const o = cuerpo[k].match(/^\s*:(\w+):\s*(.*?)\s*$/);
          if (o[1] === "theme") diagrama.theme = o[2];
          k++;
        }
      }
      diagrama.texto = cuerpo.slice(k).join("\n");
      if (resto) diagrama.arg = resto.trim();
    } else {
      diagrama.texto = cuerpo.join("\n");
    }
    diagramas.push(diagrama);
    i = j;
  }
  return diagramas;
}

async function principal(argv) {
  let estricto = false;
  let cache;
  let proyecto = ".";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--estricto") estricto = true;
    else if (a === "--cache") cache = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("uso: prerenderizar.mjs [--estricto] [--cache DIR] [PROYECTO]");
      return 0;
    } else proyecto = a;
  }
  proyecto = path.resolve(proyecto);
  process.env.PLANTUML_MYST_CACHE = path.resolve(cache || process.env.PLANTUML_MYST_CACHE || path.join(proyecto, "_build", "plantuml"));
  // El plugin resuelve las rutas relativas (config, caché) desde el directorio del proyecto.
  process.chdir(proyecto);
  const plugin = await import(pathToFileURL(process.env.PLANTUML_MYST_PLUGIN || fileURLToPath(new URL("../src/plantuml-myst.mjs", import.meta.url))).href);

  const items = [];
  const origen = [];
  const problemas = [];
  for (const archivo of archivosMarkdown(proyecto)) {
    const dir = path.dirname(archivo);
    for (const d of extraerDiagramas(fs.readFileSync(archivo, "utf8"))) {
      const donde = `${path.relative(proyecto, archivo)}:${d.linea}`;
      let texto = d.texto;
      let dirDiagrama = dir;
      if (d.arg) {
        const ruta = path.resolve(dir, d.arg);
        dirDiagrama = path.dirname(ruta);
        try {
          texto = fs.readFileSync(ruta, "utf8");
        } catch (e) {
          problemas.push(`${donde}: no se pudo leer ${d.arg}: ${e.message}`);
          continue;
        }
      }
      const p = plugin.preparar(texto, { theme: d.theme });
      items.push({ fuente: p.fuente, dir: dirDiagrama });
      origen.push({ donde, linea: p.linea });
    }
  }
  const inicio = Date.now();
  const resultados = plugin.dibujarLote(items);
  resultados.forEach((r, i) => {
    if (!r.error) return;
    const l = r.linea ? origen[i].linea(r.linea) : null;
    problemas.push(`${origen[i].donde}: ${r.error}${l ? ` (línea ${l} del diagrama)` : ""}`);
  });
  const e = plugin.estadisticas;
  console.log(
    `plantuml-myst: ${items.length} diagramas — ${e.dibujados} dibujados, ${e.cache} en caché, ` +
      `${e.ejecuciones} ejecuciones de PlantUML, ${((Date.now() - inicio) / 1000).toFixed(1)} s ` +
      `(caché: ${path.relative(proyecto, process.env.PLANTUML_MYST_CACHE) || "."})`,
  );
  for (const p of problemas) console.error(`✗ ${p}`);
  return problemas.length && estricto ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`plantuml-myst: ${e.message}`);
      process.exit(2);
    },
  );
}
