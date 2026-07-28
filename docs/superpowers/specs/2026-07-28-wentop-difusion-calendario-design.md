# Analytics por sector, difusión segmentada, zoom del calendario y seguimiento WENTOP

**Fecha:** 2026-07-28
**Estado:** diseño aprobado, pendiente de plan de implementación

Cuatro funcionalidades independientes que comparten una idea: **el sector como unidad de
alcance**. Se entregan de a una, en el orden de este documento (de menor a mayor riesgo),
y cada una se puede frenar sin dejar las otras a medias.

---

## Qué ya existe (y por eso no se rehace)

Antes de diseñar nada conviene fijar el punto de partida, porque casi todo lo pedido ya
está construido a medias:

| Pedido | Lo que ya hay | Lo que falta de verdad |
|---|---|---|
| Analytics WENTOP por sector | `buildVisibilityWhere` (wentop.routes.ts:126) ya limita a: sector propio + sectores donde sos gestor + tus propias tarjetas. RRHH (nivel ≥ 90) y el rol `CMASS` ya ven todo. | El **filtro por sector** para quien ve varios, y el rango de fechas. |
| Personal de seguimiento por sector | La tabla `wentop_gestores` y la pestaña "Gestores" (la configura RRHH). El gestor ya ve todas las tarjetas de sus sectores, con filtros por estado/tipo/sector/fechas. | La **vista tabla** (hoy es una grilla con tope de 500 sin paginado) y el **Excel con fotos**. |
| Difusión segmentada por diagrama | `turnoKey` (apps/web/src/utils/turnos.ts) ya agrupa por patrón de descanso y fase del ciclo — exactamente "los que arrancan el jueves 30" y "los de lunes a viernes". Se usa en el filtro del calendario detallado. | Portarlo al backend, bajar el nivel mínimo de `POST /mensajes` y acotar el alcance. |
| Adjuntos y confirmación en los mensajes | Un adjunto por mensaje (`archivoUrl`) y `leido`/`leidoAt`, que se marca solo al abrir. | Varios adjuntos con imagen embebida, y un acuse **explícito** distinto del leído. |
| Zoom del calendario de equipo | Nada. Las dos vistas están cableadas a 12 meses de un año. | Todo. |

---

## Decisiones tomadas

Lo que cambiaba el tamaño del trabajo, ya resuelto:

1. **Fotos en el Excel → miniaturas con `jimp`.** JavaScript puro, sin dependencias
   nativas, así que la imagen Docker no cambia. Miniaturas cacheadas en disco.
2. **Alcance de la difusión → todos los activos del alcance.** Sin discriminar por nivel
   (salvo el propio remitente). Un coordinador le puede avisar algo a otro coordinador
   del sector. Quien es transversal —RRHH, CMASS, un rol de nivel ≥ 70 sin sector como el
   gerente general— elige en cada mensaje entre toda la empresa y un sector.
3. **Las difusiones llevan adjuntos y pueden pedir confirmación de recepción.** Hasta 4
   archivos por mensaje (imágenes embebidas, PDF como enlace) y un acuse explícito, que es
   distinto del "leído" automático que ya existe.
4. **Vista del gestor → tabla paginada y ordenable.** La grilla de tarjetas queda como
   está para el resto de la gente.
5. **Entrega → un spec, implementación por partes.**

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

## Parte 3 — Difusión de Coordinador, Gerente y CMASS

### Alcance: dos, no una regla por rol

`POST /mensajes` baja de `requireLevel(90)` a `requireLevel(70)`. En vez de una tabla de
excepciones por rol, cada remitente tiene un **alcance máximo**, y todo lo demás se deriva
de ahí:

```ts
// apps/api/src/utils/difusion.utils.ts (nuevo)
export type AlcanceDifusion = 'EMPRESA' | 'SECTOR' | 'NINGUNO';

export function alcanceDeDifusion(u: { rol: string; rolNivel: number; sectorId: string | null }): AlcanceDifusion {
  if (u.rolNivel >= 90) return 'EMPRESA';            // RRHH / ADMIN
  if (u.rol === 'CMASS') return 'EMPRESA';           // seguridad: comunica a toda la planta
  if (u.rolNivel >= 70 && !u.sectorId) return 'EMPRESA';  // gerente general y demás roles transversales
  if (u.rolNivel >= 70) return 'SECTOR';
  return 'NINGUNO';
}
```

**Un rol de nivel ≥ 70 sin sector asignado es transversal**, no un usuario mal configurado.
Es la misma convención que ya usan los circuitos de aprobación (un GERENTE sin sector
aprueba para toda la empresa), y es el caso del gerente general: no tiene sector *porque*
su alcance es la compañía entera.

| Alcance | Quién | `destinoTipo` permitidos | Destinatarios |
|---|---|---|---|
| `EMPRESA` | RRHH/ADMIN (≥90) · CMASS · cualquier rol ≥70 sin sector | `TODOS`, `SECTOR` (cualquiera), `TURNO`, `USUARIO`, `ROL` (sólo ≥90) | lo que elija, dentro de su empresa |
| `SECTOR` | COORDINADOR, GERENTE de sector y demás roles ≥70 con sector | `SECTOR` (sólo el propio), `TURNO`, `USUARIO` | siempre intersectado con `sectorId = remitente.sectorId` |
| `NINGUNO` | nivel < 70 | ninguno | 403 |

Con alcance `EMPRESA` el usuario **elige en cada mensaje**: toda la empresa, un sector, un
turno (de toda la empresa o del sector que eligió), o personas sueltas. Es lo que se pidió
para CMASS ("a su sector o a toda la empresa, según lo que decida"), y de paso queda
uniforme: poder elegir *cualquier* sector es un superconjunto de poder elegir el propio, y
no hace falta una regla aparte para distinguirlos.

`ROL` queda reservado a nivel ≥ 90: es la única segmentación que atraviesa la jerarquía
(«todos los supervisores de la empresa») y no tiene lectura natural para CMASS ni para un
gerente general.

Con alcance `SECTOR`, `TODOS` y `ROL` quedan fuera porque no se traducen a "mi sector" sin
ambigüedad; `SECTOR` con el sector propio dice lo mismo sin dejar dudas en la auditoría.

En los tres casos la resolución termina con `activo: true` y sin el remitente, como hoy.

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
GET /mensajes/grupos-difusion?sectorId=<opcional>
→ {
    alcance: 'EMPRESA' | 'SECTOR',
    sectorPropio: { id, nombre } | null,
    sectores: [{ id, nombre }],        // vacío si el alcance es SECTOR
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

El `sectorId` opcional sólo lo usa quien tiene alcance `EMPRESA`: acota los turnos al
sector que está por elegir, para que el conteo que ve sea el que realmente va a recibir el
mensaje. Sin él, los turnos son de toda la empresa. Con alcance `SECTOR` el parámetro se
ignora (el sector siempre es el propio).

### Resolución de destinatarios

Para `destinoTipo: 'TURNO'`, el servidor **recalcula** el grupo en el momento del envío a
partir de `destinoValor` (la clave) y `destinoSectorId`; nunca confía en una lista de IDs
mandada por el cliente. Si el grupo quedó vacío (alguien cambió de diagrama entre que se
abrió el formulario y se envió), responde 400 con el conteo en cero, igual que hoy.

`destinoSectorId` es una **columna nueva** en `mensajes`: sin ella, un turno acotado a un
sector y el mismo turno a nivel empresa se guardan idénticos, y el historial de un
comunicado deja de decir a quién se mandó. `null` significa "toda la empresa".

### Adjuntos: archivo e imagen

Hoy `Mensaje` y `MensajeRespuesta` tienen un solo par de columnas `archivoUrl`/`archivoNombre`,
o sea **un adjunto y nada más**. Se reemplazan por una tabla:

```prisma
model MensajeAdjunto {
  id           String   @id @default(uuid())
  mensajeId    String?  @map("mensaje_id")
  respuestaId  String?  @map("respuesta_id")
  url          String
  nombre       String
  tipo         String   // 'IMAGEN' | 'ARCHIVO'
  tamanioBytes Int      @map("tamanio_bytes")
  createdAt    DateTime @default(now()) @map("created_at")
  // CHECK en la migración: exactamente uno de mensajeId / respuestaId
}
```

`tipo` se deriva del mimetype que ya valida `upload.middleware.ts` (que hoy admite jpg,
png, gif, webp y pdf): las imágenes se muestran embebidas en el cuerpo del mensaje, el PDF
como un enlace de descarga. Guardarlo como columna y no recalcularlo desde la extensión
evita que renombrar un archivo cambie cómo se renderiza un mensaje ya enviado.

**Hasta 4 adjuntos por mensaje** (`upload.array('adjuntos', 4)`), mezclando tipos. El
pedido fue "un archivo y una imagen"; un único selector múltiple con un tope es menos
código que dos selectores con validaciones distintas, y no deja al usuario trabado cuando
son dos fotos. Siguen valiendo los límites que ya existen: 5 MB por archivo
(`MAX_BYTES_POR_ARCHIVO`) y 60 subidas por hora por usuario (`uploadLimiter`).

Si la creación del mensaje falla después de que multer escribió los archivos, hay que
llamar a `descartarArchivos(files)` en **cada** rama de rechazo — es la trampa que ya está
documentada en la memoria `limites-carga-archivos`.

### Confirmación de recepción

`leido` ya existe, pero es **automático**: se marca solo al abrir el mensaje. Para un
comunicado que después hay que poder mostrar ("se le informó y lo confirmó"), eso no sirve;
hace falta un acto explícito. Son dos cosas distintas y conviven:

```prisma
model Mensaje              { requiereConfirmacion Boolean   @default(false) }
model MensajeDestinatario  { confirmadoAt         DateTime? }
```

- El remitente marca "pedir confirmación de recepción" al redactar.
- Quien lo recibe ve un cartel fijo arriba del mensaje con el botón **Confirmar recepción**,
  y en la bandeja el mensaje queda con un distintivo hasta que lo confirme. No bloquea la
  aplicación: un cartel que no se puede cerrar se termina confirmando sin leer, que es
  justo lo contrario de lo que el registro pretende probar.
- `POST /mensajes/:id/confirmar` — sólo un destinatario, idempotente (confirmar dos veces
  no mueve la fecha original).
- `GET /mensajes/:id` ya le devuelve la lista de destinatarios al remitente y a RRHH; suma
  `confirmadoAt` y el nombre, para mostrar "12 de 34 confirmaron" y quiénes faltan.
- `GET /mensajes/no-leidos` pasa a devolver `{ count, pendientesConfirmacion }`, que es lo
  que necesita el badge del menú.

### Migración

`20260728_difusion_adjuntos_confirmacion`:

1. Crea `mensaje_adjuntos` con el CHECK de exclusividad.
2. Copia las filas existentes de `mensajes.archivo_url` y `mensaje_respuestas.archivo_url`
   (hoy: **3 y 3**, respectivamente), con `tipo` derivado de la extensión y `tamanio_bytes`
   en 0 para las históricas (el archivo original puede ya no estar en disco).
3. Elimina `archivo_url` y `archivo_nombre` de las dos tablas.
4. Agrega `mensajes.destino_sector_id`, `mensajes.requiere_confirmacion` y
   `mensaje_destinatarios.confirmado_at`.

El paso 3 es el único destructivo, y por eso va después del backfill en la misma migración:
partirlo en dos deja una ventana donde el dato vive en dos lados.

### Archivos

- **Crear:** `apps/api/src/utils/turnos.utils.ts` + `apps/api/tests/turnos.test.ts`
  (sumarlo a `test:unit`).
- **Crear:** `apps/api/src/utils/difusion.utils.ts` (`alcanceDeDifusion`, resolución de
  destinatarios) + casos en el mismo test.
- **Crear:** migración `20260728_difusion_adjuntos_confirmacion`.
- **Modificar:** `apps/api/prisma/schema.prisma` — `MensajeAdjunto`, `destinoSectorId`,
  `requiereConfirmacion`, `confirmadoAt`; baja de `archivoUrl`/`archivoNombre`.
- **Modificar:** `apps/api/src/routes/mensajes.routes.ts` — niveles, alcance, `TURNO`,
  `GET /grupos-difusion`, adjuntos múltiples, `POST /:id/confirmar`, `no-leidos`.
- **Modificar:** `apps/web/src/pages/MensajesPage.tsx` — `isRRHH` → `puedeDifundir`
  (nivel ≥ 70), opciones de destino según `grupos-difusion`, selector de turno con
  etiqueta y conteo, selector de sector para alcance `EMPRESA`, adjuntos múltiples con
  vista previa de imágenes, cartel y botón de confirmación, tablero de confirmaciones
  para el remitente.
- **Modificar:** `apps/api/tests/qa/mensajes.qa.ts` — coordinador difunde a su sector;
  coordinador no puede `TODOS` ni `ROL` (403); coordinador no alcanza a nadie de otro
  sector aunque mande IDs explícitos; difusión por turno llega sólo a ese grupo;
  operador sigue sin poder enviar (403); CMASS difunde a toda la empresa y también a un
  sector; gerente sin sector difunde a un sector que no es el suyo; mensaje con dos
  adjuntos (imagen + PDF) los devuelve tipados; confirmar recepción es idempotente y sólo
  lo puede hacer un destinatario; el remitente ve quién confirmó y quién no.

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
| La migración de adjuntos borra `archivo_url` | Backfill y borrado en la misma migración; son 6 filas en total y `pg_dump` antes, como siempre |
| Un rol nuevo de nivel ≥ 70 sin sector queda difundiendo a toda la empresa sin que nadie lo haya decidido | Es la misma convención que ya rige los circuitos de aprobación; la pantalla de roles muestra el nivel al crearlos |

## Fuera de alcance

- Notificaciones push de la difusión (el sistema es *polling*, no push — ver la memoria
  `pwa-offline-limites`).
- Programar una difusión para más adelante.
- Exportar las fotos a PDF (sólo Excel).
- Mover la configuración de gestores al panel de administración: ya la restringe RRHH,
  cambiarla de lugar es cosmético y rompe la costumbre de quien la usa hoy.
