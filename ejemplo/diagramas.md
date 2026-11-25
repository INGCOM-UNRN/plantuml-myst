# La directiva `{plantuml}`

La directiva acepta un epígrafe, una etiqueta para referenciarla, un ancho y un theme de
PlantUML. Con `:caption:` o `:label:` el diagrama es una figura numerada, como
[](#fig-clases).

:::{plantuml}
:caption: Jerarquía de figuras geométricas.
:label: fig-clases
:width: 70%
abstract class Figura {
  + area() : double
  + perimetro() : double
}
class Circulo {
  - radio : double
}
class Rectangulo {
  - ancho : double
  - alto : double
}
Figura <|-- Circulo
Figura <|-- Rectangulo
:::

## Un diagrama en un archivo

El argumento de la directiva es un archivo `.puml`, relativo a la página. Los `!include`
relativos también se resuelven desde la página, y si cambia un archivo incluido el
diagrama se vuelve a dibujar.

```{plantuml} diagramas/estados.puml
:caption: Estados de un proceso.
:label: fig-estados
```

La [](#fig-estados) usa los estilos de `diagramas/estilo.iuml`.

## Con un theme

```{uml}
:theme: plain
:align: left
start
:leer n;
if (n > 0?) then (sí)
  :imprimir "positivo";
else (no)
  :imprimir "no positivo";
endif
stop
```
