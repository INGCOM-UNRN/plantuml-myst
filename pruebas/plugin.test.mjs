// Pruebas del plugin y del script de pre-renderizado. Necesitan PlantUML: PLANTUML_JAR, o el
// comando plantuml en el PATH (scripts/instalar-plantuml.sh).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import plugin, { esParaDibujar, preparar, prepararFuente, dibujarLote, transformarArbol, estadisticas, clave, textoAlternativo } from "../src/plantuml-myst.mjs";
import { extraerDiagramas } from "../scripts/prerenderizar.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// Un bloque con valla, como lo deja mystmd (con posición en el archivo).
const bloque = (lang, value, line = 1) => ({ type: "code", lang, value, position: { start: { line, column: 1 } } });
const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "plantuml-myst-"));

beforeEach(() => {
  process.env.PLANTUML_MYST_CACHE = temporal();
  delete process.env.PLANTUML_MYST_TEMA;
  delete process.env.PLANTUML_MYST_SALIDA;
  delete process.env.PLANTUML_MYST_CONFIG;
  Object.assign(estadisticas, { ejecuciones: 0, dibujados: 0, cache: 0 });
});

function vfileEn(dir, nombre = "pagina.md") {
  const mensajes = [];
  return {
    path: path.join(dir, nombre),
    mensajes,
    message(texto, posicion, origen) {
      const m = { texto, posicion, origen };
      mensajes.push(m);
      return m;
    },
  };
}

test("preparar agrega @startuml, el theme y traduce las líneas", () => {
  assert.equal(prepararFuente("A -> B"), "@startuml\nA -> B\n@enduml\n");
  const p = preparar("\n\nA -> B\nmal", { theme: "plain" });
  assert.equal(p.fuente, "@startuml\n!theme plain\nA -> B\nmal\n@enduml\n");
  assert.equal(p.linea(4), 4); // "mal": línea 4 del texto original (con 2 líneas en blanco)
  const q = preparar("@startmindmap\n* a\n@endmindmap", { theme: "mars" });
  assert.equal(q.fuente, "@startmindmap\n!theme mars\n* a\n@endmindmap\n");
  assert.equal(q.linea(3), 2);
  process.env.PLANTUML_MYST_TEMA = "cerulean";
  assert.match(prepararFuente("A -> B"), /!theme cerulean/);
  assert.match(prepararFuente("A -> B", { theme: "plain" }), /!theme plain/);
});

test("la configuración común se antepone a cada diagrama", () => {
  const dir = temporal();
  fs.writeFileSync(path.join(dir, "comun.puml"), "skinparam monochrome true\n");
  process.env.PLANTUML_MYST_CONFIG = path.join(dir, "comun.puml");
  assert.equal(prepararFuente("A -> B"), "@startuml\nskinparam monochrome true\nA -> B\n@enduml\n");
});

test("extraerDiagramas encuentra bloques y directivas", () => {
  const md = [
    "```plantuml", "A -> B", "```",
    "```python", "x = 1", "```",
    "~~~~puml", "C -> D", "~~~~",
    ":::{plantuml}", ":caption: Algo", ":theme: plain", "", "E -> F", ":::",
    "```{uml} diagramas/x.puml", ":label: fig-x", "```",
    "```{plantuml}", "---", "theme: mars", "width: 50%", "---", "G -> H", "```",
    "- un ítem", "  ```plantuml", "  I -> J", "  ```",
  ].join("\n");
  const d = extraerDiagramas(md);
  assert.deepEqual(
    d.map(({ texto, theme, arg }) => [texto.trim(), theme, arg]),
    [
      ["A -> B", undefined, undefined],
      ["C -> D", undefined, undefined],
      ["E -> F", "plain", undefined],
      ["", undefined, "diagramas/x.puml"],
      ["G -> H", "mars", undefined],
      ["I -> J", undefined, undefined],
    ],
  );
  assert.equal(d[0].linea, 1);
});

test("dibujarLote: una ejecución por lote, errores con línea, caché", () => {
  const dir = temporal();
  const ok = prepararFuente("Alice -> Bob : hola");
  const mal = prepararFuente("class A\nA <|-- B\nesto ->>> mal");
  const [a, b, c] = dibujarLote([
    { fuente: ok, dir },
    { fuente: mal, dir },
    { fuente: ok, dir },
  ]);
  assert.match(a.svg, /<svg[\s\S]*Alice/);
  assert.equal(c.svg, a.svg);
  assert.ok(b.error);
  assert.equal(b.linea, 4); // en la fuente preparada (con @startuml)
  assert.equal(estadisticas.ejecuciones, 1);
  dibujarLote([{ fuente: ok, dir }]);
  assert.equal(estadisticas.ejecuciones, 1, "el segundo pedido sale de la caché");
  assert.equal(estadisticas.cache, 1);
});

test("los !include relativos se resuelven y forman parte de la clave", () => {
  const dir = temporal();
  fs.writeFileSync(path.join(dir, "estilo.iuml"), "skinparam backgroundColor #FFEEDD\n");
  const fuente = prepararFuente("!include estilo.iuml\nA -> B");
  const antes = clave(fuente, dir);
  const [r] = dibujarLote([{ fuente, dir }]);
  assert.ok(r.svg, r.error);
  assert.match(r.svg, /FFEEDD/i);
  fs.writeFileSync(path.join(dir, "estilo.iuml"), "skinparam backgroundColor #DDEEFF\n");
  assert.notEqual(clave(fuente, dir), antes, "cambiar el archivo incluido cambia la clave");
});

test("transformarArbol: imágenes, error fatal y opciones de la directiva", () => {
  const dir = temporal();
  const directiva = plugin.directives[0];
  const [figura] = directiva.run(
    { body: "title Saludo\nA -> B", options: { caption: "Un saludo", label: "Fig Uno", width: "50%", class: "borde" } },
    vfileEn(dir),
  );
  assert.equal(figura.kind, "figure");
  assert.equal(figura.identifier, "fig-uno");
  const arbol = {
    type: "root",
    children: [
      { type: "block", children: [bloque("plantuml", "A -> B"), bloque("python", "x")] },
      bloque("puml", "class A\nA <|-- B\n\nmal ->>> mal", 7),
      figura,
    ],
  };
  const vfile = vfileEn(dir);
  assert.equal(transformarArbol(arbol, vfile), 3);
  assert.equal(estadisticas.ejecuciones, 1);
  const [img, python] = arbol.children[0].children;
  assert.equal(img.type, "image");
  assert.match(img.url, /^data:image\/svg\+xml;base64,/);
  assert.equal(img.alt, "Diagrama UML");
  assert.equal(python.type, "code");
  const error = arbol.children[1];
  assert.equal(error.type, "admonition");
  assert.match(error.children[1].children[0].value, /línea 4 del diagrama/);
  assert.equal(vfile.mensajes.length, 1);
  assert.equal(vfile.mensajes[0].fatal, true);
  const imgFigura = arbol.children[2].children[0];
  assert.equal(imgFigura.type, "image");
  assert.equal(imgFigura.width, "50%");
  assert.equal(imgFigura.class, "borde");
  assert.equal(imgFigura.alt, "Diagrama UML: Saludo");
  assert.equal(arbol.children[2].children[1].type, "caption");
});

test("la directiva con archivo resuelve los !include desde el archivo", () => {
  const dir = temporal();
  fs.mkdirSync(path.join(dir, "uml"));
  fs.writeFileSync(path.join(dir, "uml", "estilo.iuml"), "skinparam backgroundColor #ABCDEF\n");
  fs.writeFileSync(path.join(dir, "uml", "d.puml"), "@startuml\n!include estilo.iuml\nA -> B\n@enduml\n");
  const vfile = vfileEn(dir);
  const nodos = plugin.directives[0].run({ arg: "uml/d.puml", options: {} }, vfile);
  const arbol = { type: "root", children: nodos };
  transformarArbol(arbol, vfile);
  assert.equal(arbol.children[0].type, "image", JSON.stringify(vfile.mensajes));
  assert.match(Buffer.from(arbol.children[0].url.split(",")[1], "base64").toString(), /ABCDEF/i);
  const falta = plugin.directives[0].run({ arg: "no-existe.puml", options: {} }, vfile);
  assert.equal(falta[0].type, "admonition");
});

test("PLANTUML_MYST_SALIDA=diagramas escribe los SVG al lado de la página", () => {
  const dir = temporal();
  process.env.PLANTUML_MYST_SALIDA = "diagramas";
  const arbol = { type: "root", children: [bloque("plantuml", "A -> B")] };
  transformarArbol(arbol, vfileEn(dir));
  const url = arbol.children[0].url;
  assert.match(url, /^diagramas\/plantuml-[0-9a-f]{20}\.svg$/);
  assert.ok(fs.existsSync(path.join(dir, url)));
});

test("sin PlantUML, el error explica cómo instalarlo", () => {
  const jar = process.env.PLANTUML_JAR;
  const cmd = process.env.PLANTUML;
  delete process.env.PLANTUML_JAR;
  process.env.PLANTUML = "/no/existe/plantuml";
  try {
    const [r] = dibujarLote([{ fuente: prepararFuente("A -> B"), dir: temporal() }]);
    assert.match(r.error, /instalar-plantuml\.sh/);
  } finally {
    if (jar) process.env.PLANTUML_JAR = jar;
    if (cmd) process.env.PLANTUML = cmd;
    else delete process.env.PLANTUML;
  }
});

test("los bloques de {code} plantuml se dejan como código", () => {
  const dir = temporal();
  const md = ["# Guía", "", "```plantuml", "A -> B", "```", "", "```{code} plantuml", ":caption: x", "A -> C", "```", ""].join("\n");
  fs.writeFileSync(path.join(dir, "guia.md"), md);
  const lineas = md.split("\n");
  assert.equal(esParaDibujar(bloque("plantuml", "A -> B", 3), lineas), true);
  assert.equal(esParaDibujar(bloque("plantuml", "A -> C", 7), lineas), false, "{code} con posición");
  assert.equal(esParaDibujar({ type: "code", lang: "plantuml", value: "A -> C" }, lineas), false, "{code} sin posición");
  assert.equal(esParaDibujar({ type: "code", lang: "plantuml", value: "x", plantuml: {} }, lineas), true, "directiva {plantuml}");
  const arbol = {
    type: "root",
    children: [bloque("plantuml", "A -> B", 3), { type: "container", kind: "code", children: [{ type: "code", lang: "plantuml", value: "A -> C" }] }],
  };
  assert.equal(transformarArbol(arbol, vfileEn(dir, "guia.md")), 1);
  assert.equal(arbol.children[0].type, "image");
  assert.equal(arbol.children[1].children[0].type, "code");
});

test("textoAlternativo usa el título o el tipo", () => {
  assert.equal(textoAlternativo("@startuml\ntitle Hola\n@enduml"), "Diagrama UML: Hola");
  assert.equal(textoAlternativo("@startgantt\n@endgantt"), "Diagrama Gantt");
});

test("prerenderizar.mjs llena la caché y --estricto falla con errores", () => {
  const dir = temporal();
  fs.writeFileSync(path.join(dir, "myst.yml"), "version: 1\n");
  fs.writeFileSync(path.join(dir, "a.md"), "# A\n\n```plantuml\nA -> B\n```\n");
  const correr = (...args) =>
    spawnSync(process.execPath, [path.join(RAIZ, "scripts/prerenderizar.mjs"), ...args, dir], { encoding: "utf8", env: { ...process.env, PLANTUML_MYST_CACHE: "" } });
  let p = correr("--estricto");
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /1 diagramas — 1 dibujados/);
  assert.equal(fs.readdirSync(path.join(dir, "_build/plantuml")).filter((f) => f.endsWith(".svg")).length, 1);
  fs.writeFileSync(path.join(dir, "b.md"), "# B\n\ntexto\n\n:::{plantuml}\n:caption: x\nclass A\nA ->>> mal\n:::\n");
  p = correr("--estricto");
  assert.equal(p.status, 1);
  assert.match(p.stderr, /b\.md:5: .*línea 2 del diagrama/);
  assert.equal(correr().status, 0, "sin --estricto sólo informa");
});
