# Analytics por sector, difusión segmentada, zoom del calendario y seguimiento WENTOP

**Fecha:** 2026-07-28
**Estado:** diseño aprobado, pendiente de plan de implementación

Cuatro funcionalidades independientes que comparten una idea: **el sector como unidad de
alcance**. Se entregan de a una, en el orden de este documento (de menor a mayor riesgo),
y cada una se puede frenar sin dejar las otras a medias.

---

## Qué ya existe (y por eso no se rehace)

Antes de diseñar nada conviene fijar el punto de partida, porque tres de los cuatro
pedidos ya están construidos a medias:

| Pedido | Lo que ya hay | Lo que falta de verdad |
|---|---|---|
| Analytics WENTOP por sector | `buildVisibilityWhere` (wentop.routes.ts:126) ya limita a: sector propio + sectores donde sos gestor + tus propias tarjetas. RRHH (nivel ≥ 90) y el rol `CMASS` ya ven todo. | El **filtro por sector** para quien ve varios, y el rango de fechas. |
| Personal de seguimiento por sector | La tabla `wentop_gestores` y la pestaña "Gestores" (la configura RRHH). El gestor ya ve todas las tarjetas de sus sectores, con filtros por estado/tipo/sector/fechas. | La **vista tabla** (hoy es una grilla con tope de 500 sin paginado) y el **Excel con fotos**. |
| Difusión segmentada por diagrama | `turnoKey` (apps/web/src/utils/turnos.ts) ya agrupa por patrón de descanso y fase del ciclo — exactamente "los que arrancan el jueves 30" y "los de lunes a viernes". Se usa en el filtro del calendario detallado. | Portarlo al backend, bajar el nivel mínimo de `POST /mensajes` y acotar el alcance. |
| Zoom del calendario de equipo | Nada. Las dos vistas están cableadas a 12 meses de un año. | Todo. |

---

## Decisiones tomadas

Cuatro preguntas que cambiaban el tamaño del trabajo, ya resueltas:

1. **Fotos en el Excel → miniaturas con `jimp`.** JavaScript puro, sin dependencias
   nativas, así que la imagen Docker no cambia. Miniaturas cacheadas en disco.
2. **Alcance de la difusión → todos los activos del sector.** Sin discriminar por nivel
   (salvo el propio remitente). Un coordinador le puede avisar algo a otro coordinador
   del sector.
3. **Vista del gestor → tabla paginada y ordenable.** La grilla de tarjetas queda como
   está para el resto de la gente.
4. **Entrega → un spec, implementación por partes.**

---

## Parte 1 — Zoom del calendario de equipo

### El problema

`CalendarioEquipoPage` pide siempre un año entero (`GET /vacaciones/gantt?anio=&todos=1`)
y las dos vistas dibujan 12 meses. En la vista anual, un mes mide ~8 % del ancho: dos
vacaciones que se pisan tres días son dos barras pegadas de dos píxeles.

### El diseño: la ventana reemplaza al año

Hoy toda la aritmética del calendario está expresada en **día-del-año**:
`monthOffsets(anio)`, `blockDoyRange(..., year, ...)`, `computeOverlapPeaks(emp, anio)`.
El cambio central es reemplazar ese eje por una **ventana**: una lista ordenada de meses
`{ anio, mes }`, de 1, 3 o 12 entradas.

```ts
// apps/web/src/components/calendario/ventana.ts (nuevo)
export interface MesVentana { anio: number; mes: number }   // mes 1-12
export interface Ventana {
  meses: MesVentana[];
  offset: number[];      // día-índice donde arranca cada mes
  totalDias: number;
}
export function ventanaDeMeses(anioAncla: number, mesAncla: number, cantidad: number): Ventana
export function ventanaAnual(anio: number): Ventana            // = ventanaDeMeses(anio, 1, 12)
export function rangoEnVentana(fechaInicio: string, fechaFin: string, v: Ventana): [number, number] | null
```

El modo "Año" pasa a ser `ventanaDeMeses(anio, 1, 12)`, así que la vista actual no cambia
de comportamiento: es el mismo cálculo con otro nombre.

**Por qué una lista de meses y no un par de fechas:** las dos vistas dibujan columnas por
mes (la compacta con anchos proporcionales a los días del mes, la detallada con una celda
por mes). Una ventana que ya viene desglosada en meses es lo que las dos necesitan, y
mantiene el manejo de años bisiestos en un solo lugar.

### Los tres modos

| Modo | Ventana | Flechas |
|---|---|---|
| Año | 12 meses del año elegido | ± 1 año (como hoy) |
| Trimestre | mes ancla + 2 siguientes | ± 1 mes |
| Mes | sólo el mes ancla | ± 1 mes |

El ancla arranca en el mes actual. El modo se guarda en `localStorage` junto al de
vista (`calendario-equipo-modo`), con clave `calendario-equipo-ventana`.

### Cruce de año

Noviembre + 2 = enero del año siguiente, y es justo cuando más falta hace verlo. La página
pide **un `gantt` por cada año distinto que toque la ventana** (uno o dos) con
`useQueries`, y fusiona: los empleados se unen por `id` y se concatenan los bloques.

```ts
const anios = [...new Set(ventana.meses.map((m) => m.anio))];   // 1 o 2
```

Un bloque que cruza el 31 de diciembre aparece en las dos respuestas; se deduplica por
`id` de bloque al fusionar. Los `tramos` de diagrama también se concatenan y se deduplican
por `diagrama.id + fechaInicio`.

### Solapes

`computeOverlapPeaks` y `overlappingEmployeeIds` pasan a recibir la ventana. **Los picos se
calculan sólo sobre lo visible**: al hacer zoom a un mes, el badge de solape cuenta la
gente que se pisa *en ese mes*, no en todo el año. Es el comportamiento correcto para lo
que el zoom sirve, pero es un cambio observable y va documentado en el código.

### Archivos

- **Crear:** `apps/web/src/components/calendario/ventana.ts`
- **Crear:** `apps/web/src/components/calendario/ventana.test.ts` — casos: ventana anual
  idéntica a `monthOffsets`, año bisiesto, ventana que cruza diciembre, bloque que arranca
  antes y termina después de la ventana, bloque enteramente fuera (`null`).
- **Modificar:** `shared.ts` (reescribir `monthOffsets`/`blockDoyRange`/`computeOverlapPeaks`/
  `overlappingEmployeeIds` sobre `Ventana`; `fetchCalendar` sin cambios),
  `CalendarioEquipoPage.tsx` (selector de modo, `useQueries`, fusión),
  `CalendarioCompacto.tsx` y `CalendarioDetallado.tsx` (reciben `ventana` en vez de `anio`).
- **Modificar:** `apps/web/package.json` → sumar `ventana.test.ts` a `test:unit`.

Sin cambios de API.

---

## Parte 2 — Analytics WENTOP por sector

### Lo que cambia en el backend

`GET /wentop/analytics` acepta `sectorId`, `desde` y `hasta`.

**Autorización del filtro:** se calcula la lista de sectores que el llamador puede ver.
Si manda un `sectorId` que no está en esa lista → **403**, no un resultado vacío (un tablero
en cero es indistinguible de "no tenés permiso", y eso se transforma en un reporte de bug).

**Un cambio de criterio, a propósito:** el analytics deja de usar la rama `creadorId` de
`buildVisibilityWhere`. Esa rama existe para que siempre puedas encontrar *tu* tarjeta en
el listado, aunque la hayas cargado sobre otro sector; pero en un tablero que dice "sector
X" mete tarjetas de otros sectores y los números dejan de cuadrar con los del gestor de X.
Se agrega `buildAnalyticsWhere`, hermana de `buildVisibilityWhere` y sin esa rama, con el
comentario que explica por qué son dos y no una.

### El bug que aparece de paso

`WentopPage` pide los sectores a `GET /analytics/sectores`, que exige nivel ≥ 70
(COORDINADOR). Para un operador esa query da **403** y la lista queda vacía — no sólo se
queda sin filtro: **el formulario de alta tampoco le deja elegir el sector de observación**,
porque el mismo array alimenta el `<select>` del paso 1 del asistente.

Se agrega `GET /wentop/sectores` (sólo autenticación, devuelve los sectores activos de la
empresa: `id` y `nombre`, que no es información sensible — ya viajan en cada tarjeta) y
`WentopPage` pasa a usarlo. Es un arreglo chico y necesario: sin él, "cada persona del
sector ve los analytics de su sector" no se puede ni etiquetar en pantalla.

### Lo que cambia en el front

`AnalyticsTab` deja de ser un componente sin props:

- Pide `GET /wentop/mi-alcance` → `{ global: boolean; sectores: {id, nombre}[] }`.
- Si `sectores.length > 1` o `global`, muestra el `<select>` de sector (con "Todos los
  sectores" sólo si `global`). Con un solo sector muestra el nombre como subtítulo, sin
  selector: un operador no necesita elegir entre una opción.
- Rango de fechas con los mismos dos `<input type="date">` que ya usa la pestaña Tarjetas.

### Archivos

- **Modificar:** `apps/api/src/routes/wentop.routes.ts` — `buildAnalyticsWhere`,
  `sectoresVisibles(user)`, params de `/analytics`, `GET /wentop/sectores`,
  `GET /wentop/mi-alcance`.
- **Modificar:** `apps/web/src/pages/WentopPage.tsx` — `AnalyticsTab`, origen de `sectores`.
- **Crear:** casos en `apps/api/tests/qa/wentop.qa.ts` — operador ve sólo su sector; gestor
  de dos sectores ve los dos y puede filtrar entre ellos; `sectorId` ajeno → 403; RRHH y
  CMASS ven todo; el rango de fechas recorta.

---

## Parte 3 — Difusión de Coordinador y Gerente

### Alcance

`POST /mensajes` baja de `requireLevel(90)` a `requireLevel(70)`, con las reglas por nivel
resueltas **en el servidor** (el front sólo muestra lo que el servidor permite):

| Nivel | `destinoTipo` permitidos | Destinatarios |
|---|---|---|
| ≥ 90 (RRHH/ADMIN) | `TODOS`, `SECTOR`, `ROL`, `USUARIO`, `TURNO` | como hoy |
| 70–89 (COORDINADOR/GERENTE/CMASS) | `SECTOR` (sólo el propio), `TURNO`, `USUARIO` | siempre intersectado con `sectorId = remitente.sectorId`, `activo: true`, sin el remitente |
| < 70 | ninguno | 403 |

`TODOS` y `ROL` quedan fuera para 70–89: no se traducen a "mi sector" sin ambigüedad, y
`SECTOR` con el sector propio dice exactamente lo mismo sin dejar dudas en la auditoría.

**Limitación conocida:** un GERENTE **sin sector asignado** (que en los circuitos de
aprobación es transversal) no tiene a quién difundir y recibe
`400 — "No tenés un sector asignado: pedile a RRHH que te asigne uno para poder difundir"`.
Se ofreció la variante "gerente sin sector elige cualquier sector" y no se eligió; si
aparece el caso real, es una regla más en la tabla de arriba.

`GET /mensajes/enviados` también baja a nivel 70 (ya filtra por `remitenteId`, así que no
expone nada de otro).

### Segmentar por diagrama: `destinoTipo: 'TURNO'`

La clave de turno se porta del front al backend, **sin cambiar el criterio**: dos personas
comparten turno si comparten patrón de descanso.

```ts
// apps/api/src/utils/turnos.utils.ts (nuevo) — espejo de apps/web/src/utils/turnos.ts
export function turnoKey(tramo: TramoDiagrama | null): string
  // ROTATIVO     → `R|<diasTrabajo>|<diasDescanso>|<fase>`   fase = fechaInicio mod ciclo
  // FIJO_SEMANA  → `F|<diasSemana ordenados>`
  // sin diagrama → `SIN`

export function etiquetaTurno(tramo: TramoDiagrama, hoy: Date): {
  etiqueta: string;        // "Rotativo 14×7 — arrancan el jue 30/07"
  proximoInicio: string | null;  // clave de día, null para FIJO_SEMANA
}
```

El próximo inicio de ciclo es aritmética de días, sobre claves de día en UTC como manda la
convención (`fecha-dia.utils.ts`): el primer día `d ≥ hoy` tal que
`(diaEpoch(d) − diaEpoch(tramo.fechaInicio)) mod ciclo === 0`. Para `FIJO_SEMANA` no hay
ciclo: la etiqueta es "Lunes a viernes" derivada de `diasSemana`.

**Duplicación deliberada:** la copia del front sigue viva porque alimenta el filtro del
calendario detallado, que trabaja con datos ya cargados en memoria. La copia del backend es
la **autoridad** para resolver destinatarios. Las dos llevan un comentario que apunta a la
otra, y la del backend un test unitario con los mismos casos que
`apps/web/src/utils/turnos.test.ts`.

El turno se evalúa sobre el **tramo vigente hoy** (`tramoDelDia`), no sobre el diagrama
histórico: si alguien cambió de diagrama la semana pasada, la difusión le llega con su
grupo nuevo.

### Endpoint nuevo: los grupos que puedo difundir

```
GET /mensajes/grupos-difusion
→ {
    alcance: 'EMPRESA' | 'SECTOR',
    sector: { id, nombre } | null,
    turnos: [{
      clave: 'R|14|7|3',
      etiqueta: 'Rotativo 14×7 — arrancan el jue 30/07',
      cantidad: 12,
      proximoInicio: '2026-07-30'
    }]
  }
```

Los turnos se calculan sobre los usuarios activos del alcance, agrupando por `turnoKey`,
ordenados por cantidad descendente. Los `SIN` (sin diagrama vigente) se muestran aparte,
como "Sin diagrama asignado", porque son gente que igual puede necesitar el comunicado.

### Resolución de destinatarios

Para `destinoTipo: 'TURNO'`, el servidor **recalcula** el grupo en el momento del envío a
partir de `destinoValor` (la clave); nunca confía en una lista de IDs mandada por el
cliente. Si el grupo quedó vacío (alguien cambió de diagrama entre que se abrió el
formulario y se envió), responde 400 con el conteo en cero, igual que hoy.

### Archivos

- **Crear:** `apps/api/src/utils/turnos.utils.ts` + `apps/api/tests/turnos.test.ts`
  (sumarlo a `test:unit`).
- **Modificar:** `apps/api/src/routes/mensajes.routes.ts` — niveles, `alcanceDelRemitente()`,
  `TURNO`, `GET /grupos-difusion`.
- **Modificar:** `apps/web/src/pages/MensajesPage.tsx` — `isRRHH` → `puedeDifundir`
  (nivel ≥ 70), opciones de destino según `grupos-difusion`, selector de turno con
  etiqueta y conteo.
- **Modificar:** `apps/api/tests/qa/mensajes.qa.ts` — coordinador difunde a su sector;
  coordinador no puede `TODOS` ni `ROL` (403); coordinador no alcanza a nadie de otro
  sector aunque mande IDs explícitos; difusión por turno llega sólo a ese grupo;
  operador sigue sin poder enviar (403).

---

## Parte 4 — Seguimiento WENTOP: tabla y Excel con fotos

### Tabla paginada

`GET /wentop` gana `page`, `limit` (tope 100), `orden`
(`fechaReporte|estado|tipoTarjeta|sector|creador`) y `dir` (`asc|desc`), y **cambia la
forma de la respuesta**:

```jsonc
// antes: WentopTarjeta[]
{ "tarjetas": [...], "total": 342, "page": 1, "pages": 4 }
```

Es un cambio incompatible, pero el endpoint tiene un solo consumidor (`WentopPage`) y una
suite (`wentop.qa.ts`); las dos se actualizan en el mismo commit. Devolver a veces un
array y a veces un objeto según los parámetros sería peor: cualquiera que lo lea después
tiene que adivinar cuál de las dos formas le toca.

El tope duro de 500 (`MAX_TARJETAS_LISTADO`) desaparece: con paginado real ya no hace
falta, y era justamente el que impedía "ver TODAS las tarjetas del sector".

En el front, la pestaña Tarjetas gana un toggle **Grilla / Tabla** (mismo patrón que el
Compacto/Detallado del calendario, guardado en `localStorage`). La tabla muestra: fecha,
tipo, estado, sector de observación, creador, cantidad de fotos, y abre el mismo modal de
detalle al hacer clic.

### Excel con fotos

```
GET /wentop/export.xlsx?estado=&tipoTarjeta=&sectorId=&desde=&hasta=
```

Mismos filtros y **mismo alcance de visibilidad** que el listado. Pueden descargarlo:
gestores (de los sectores donde lo son), el rol `CMASS` y nivel ≥ 70. Un operador no: el
Excel junta las descripciones de todas las tarjetas del sector en un solo archivo
descargable, que es un salto cualitativo respecto de verlas de a una en pantalla.

**Columnas:** N° · Fecha de reporte · Estado · Tipo · Sector de observación · ¿Tercero? ·
Cliente · Lugar/Pozo/Locación · Creador · Legajo · Calidad · Medioambiente · Seguridad y
Salud · Descripción · Acciones inmediatas · Recomendaciones · Justificación de apertura ·
Acción de cierre · Fecha de cierre · **Foto 1 … Foto N**.

`N` = el máximo de fotos que tenga alguna tarjeta del export (0 a 10). Si ninguna tiene
fotos, no se agregan columnas.

**Las celdas de foto son cuadradas.** Es la solución al pedido: una tarjeta trae fotos
apaisadas (16:9) y verticales (9:16), y cualquier celda rectangular deforma una de las dos
o desperdicia media planilla. Con la celda cuadrada, cada foto se escala para **entrar**
en el cuadrado conservando su proporción y se centra:

```
lado = 140 px  →  ancho de columna ≈ 20 caracteres, alto de fila = 105 pt
16:9 → 140 × 79 px, centrada verticalmente
9:16 → 79 × 140 px, centrada horizontalmente
```

El centrado se hace con `tl` fraccionario de ExcelJS (`{ col: c + 0.18, row: r + 0.02 }`),
calculado a partir de la relación de aspecto real de cada imagen. Con varias fotos, cada
una ocupa la columna siguiente — "se van sumando a las celdas de al lado", como se pidió.

El alto de fila es el mayor entre el que necesitan las fotos (105 pt) y el del texto; las
columnas de texto largo van con `wrapText` y ancho fijo.

### Miniaturas: `jimp` en un worker thread

Una foto puede pesar 5 MB y una tarjeta llevar 10. Incrustar los originales de 300 tarjetas
daría un archivo de varios GB, así que se incrustan **miniaturas**: lado mayor 600 px,
JPEG calidad 70, ~40–60 KB cada una.

```ts
import { Jimp } from 'jimp';
const img = await Jimp.read(rutaOriginal);
img.scaleToFit({ w: 600, h: 600 });          // conserva la proporción
const buf = await img.getBuffer('image/jpeg', { quality: 70 });
```

**`jimp` es JavaScript puro y por eso bloquea el event loop.** Decodificar un JPEG de 5 MB
cuesta entre 300 y 600 ms; 300 fotos son varios minutos con la API entera congelada — no
sólo lenta: sin responder ni el `/health`. Por eso el redimensionado va en un
**worker thread dedicado** con una cola simple
(`apps/api/src/utils/miniaturas.worker.ts` + `miniaturas.service.ts`). El proceso principal
manda ruta y destino, y espera la respuesta sin bloquearse.

**Caché en disco:** la miniatura se guarda en `uploads/thumbs/<nombre>.jpg`. Los archivos
subidos son inmutables, así que no hace falta invalidar nada; sí borrarla cuando se borra
la foto (`DELETE /wentop/:id/fotos/:fotoId`) o la tarjeta entera, junto al original.

**Calentamiento:** `POST /wentop/:id/fotos` encola la miniatura *después* de responder 201
(sin `await`), así las fotos nuevas ya están listas cuando alguien exporta. El export
genera al vuelo sólo lo que falte — el arrastre histórico se paga una vez.

**Si una foto falla** (archivo borrado del disco, formato corrupto): la celda queda vacía
con el texto "foto no disponible" y el export sigue. Un archivo perdido no puede tumbar la
descarga entera.

### Archivos

- **Crear:** `apps/api/src/utils/miniaturas.service.ts`, `apps/api/src/utils/miniaturas.worker.ts`
- **Crear:** `apps/api/src/utils/wentop-export.utils.ts` — armado del workbook (separado de
  las rutas: son ~250 líneas de layout y `wentop.routes.ts` ya tiene 820).
- **Modificar:** `apps/api/package.json` — dependencia `jimp@^1.6.1`; sumar el test.
- **Modificar:** `apps/api/src/routes/wentop.routes.ts` — paginado, orden,
  `GET /export.xlsx`, borrado de miniaturas, encolado en el alta de fotos.
- **Modificar:** `apps/web/src/pages/WentopPage.tsx` — toggle Grilla/Tabla, componente de
  tabla, botón de descarga.
- **Modificar:** `apps/api/tests/qa/wentop.qa.ts` — nueva forma de la respuesta, paginado,
  orden, permisos del export, `.xlsx` bien formado con y sin fotos.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| `jimp` bloquea el event loop y tumba la API durante un export grande | Worker thread dedicado + caché en disco + calentamiento en el alta |
| Excel de varios GB | Miniaturas de 600 px; el peso queda en decenas de MB |
| `turnoKey` duplicado front/back que se desincroniza | El backend es la autoridad; comentarios cruzados y test unitario espejo |
| Cambio de forma en `GET /wentop` | Un solo consumidor y una sola suite, actualizados en el mismo commit |
| El zoom cambia el conteo de solapes (pasa a ser por ventana) | Es el comportamiento correcto para lo que el zoom sirve; documentado en el código |
| Gerente sin sector se queda sin difusión | Error explícito que dice qué pedirle a RRHH |

## Fuera de alcance

- Notificaciones push de la difusión (el sistema es *polling*, no push — ver la memoria
  `pwa-offline-limites`).
- Programar una difusión para más adelante.
- Exportar las fotos a PDF (sólo Excel).
- Mover la configuración de gestores al panel de administración: ya la restringe RRHH,
  cambiarla de lugar es cosmético y rompe la costumbre de quien la usa hoy.
