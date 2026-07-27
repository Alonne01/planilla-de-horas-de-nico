# Vigencia del diagrama por día

Fecha: 2026-07-26
Rama: `anvil/ui-improvements`

Un cambio de diagrama aprobado a mitad de período tiene que partir el período en
dos: hasta la fecha de inicio rige el diagrama viejo, desde ahí el nuevo, con los
francos que cada uno implica. Hoy el sistema aplica **un solo diagrama a todo el
período** en casi todos lados, y además pierde el diagrama viejo apenas se aprueba
el cambio.

Independiente de
`2026-07-26-solicitudes-visibilidad-design.md`: se pueden implementar en
cualquier orden.

## Problemas

1. **El histórico se pierde.** `esFrancoPorDiagrama()`
   (`contexto-dia.utils.ts:206`) filtra por `activo: true`. Al aprobar el cambio,
   la asignación vieja queda en `activo: false`, así que para cualquier día
   anterior a la fecha efectiva no encuentra diagrama y devuelve "no es franco".
   Editar o recalcular un día de la primera mitad le borra el recargo del 100%
   por franco trabajado. Es el único de los cuatro que toca plata ya liquidada.
2. **El calendario de la planilla miente.** `PlanillaDetailPage.tsx:512` usa la
   asignación activa (`/usuarios/:id` → `diagramaActual` +
   `diagramaFechaInicio`) para todo el período: después del cambio pinta los
   francos del diagrama nuevo también en la primera mitad.
3. **La validación al enviar usa el diagrama equivocado.**
   `planillas.routes.ts:445` toma la asignación activa y con ella decide qué días
   se pueden dejar vacíos. Reclama días que eran franco, o deja pasar días
   laborables sin cargar.
4. **El calendario de equipo** (`CalendarioDetallado`) pinta el año entero con el
   diagrama actual del empleado.
5. **La fecha efectiva no se pide.** `CambiosDiagramaPage.tsx:113` manda sólo
   `usuarioId`, `diagramaNuevoId` y `motivo`; el schema la tiene opcional
   (`cambios-diagrama.routes.ts:50`). Todas las solicitudes se crean con
   `fechaEfectiva: null` y se aplican desde el instante de la aprobación.

Lo único que hoy corta bien es el cálculo del recargo al guardar un día:
`contextoDelDia()` resuelve por fecha. La corrección consiste en que todo lo
demás mire lo mismo.

## Diseño

### A. La vigencia se resuelve por fecha, no por `activo`

`UsuarioDiagrama` ya tiene `fechaInicio` y `fechaFin`: es un historial y hay que
leerlo como tal. El diagrama de un día es la asignación con

```
fechaInicio <= día  AND  (fechaFin IS NULL OR fechaFin >= día)
```

y, si hay más de una, la de `fechaInicio` mayor. **`activo` deja de participar
del cálculo**; queda como "cuál es la asignación corriente" para los listados que
muestran el nombre del diagrama.

Nuevo módulo `apps/api/src/utils/diagrama-vigencia.utils.ts`:

```ts
export type TramoDiagrama = {
  diagrama: { id, nombre, tipo, diasTrabajo, diasDescanso, diasSemana };
  fechaInicio: Date;
  fechaFin: Date | null;
};

export async function tramosDeUsuario(usuarioId, desde, hasta): Promise<TramoDiagrama[]>
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null
export function esFrancoEnFecha(tramos: TramoDiagrama[], fecha: Date): boolean
```

`esFrancoEnFecha` aplica `esDiaFrancoSegunDiagrama()` con el **`fechaInicio` del
tramo**, no con el de la asignación corriente: en un rotativo el ciclo 7×7 se
cuenta desde que arranca ese tramo, y usar otro ancla corre todos los francos.

`esFrancoPorDiagrama(usuarioId, fecha)` se reescribe sobre lo anterior sin
cambiar su firma, así `contextoDelDia()` y el recargo del 100% siguen
funcionando igual y quedan reparados hacia atrás.

**Cierre sin solape.** Al aplicar un cambio, la asignación vieja se cierra con
`fechaEfectiva − 1 día` (hoy se cierra con `fechaEfectiva`, así que el día del
corte queda cubierto por las dos). El desempate por `fechaInicio` descendente se
conserva igual, como red para los datos que ya tienen el solape.

`PUT /usuarios/:id/diagrama` (`usuarios.routes.ts:538`) tiene el defecto
inverso: cierra la vieja con la fecha de **hoy** aunque la nueva arranque otro
día, dejando un hueco sin diagrama entre ambas. Se cierra con
`fechaInicio de la nueva − 1 día`.

### B. La planilla trabaja con tramos

`GET /planillas/:id` agrega:

```ts
tramosDiagrama: Array<{
  diagrama: { id, nombre, tipo, diasTrabajo, diasDescanso, diasSemana };
  fechaInicio: string;
  fechaFin: string | null;
}>
```

Son los tramos que solapan `[periodoInicio, periodoFin]`, en orden. El front
reemplaza `esDiaFranco(día, diagramaActual, fechaInicioDiagrama)` por un
`francoDelDia(día, tramos)` en `planillaHelpers.ts` —el espejo exacto de
`esFrancoEnFecha` del backend— y deja de consultar `/usuarios/:id` para esto.

Cuando hay más de un tramo, el calendario marca el día del corte con una
etiqueta ("desde acá: 7×7"), para que se entienda por qué cambian los francos a
mitad de mes en vez de parecer un error.

`POST /planillas/:id/enviar` usa `tramosDeUsuario()` en lugar de la asignación
activa para decidir qué días pueden quedar sin cargar.

### C. Vencimiento de la solicitud

`fechaEfectiva` pasa a **obligatoria y estrictamente futura** al crear la
solicitud, y el formulario suma el campo (hoy no existe).

**Vence al empezar el día de inicio.** Si la fecha efectiva es el 01/08, el
último momento para completar la aprobación es el 31/07; el 01/08 la solicitud ya
no se puede aplicar. Al vencer pasa a `RECHAZADA` con
`obsRechazo: 'Vencida: la fecha de inicio pasó sin completarse la aprobación'` y
se notifica al solicitante y al empleado, para que pidan una nueva con otra
fecha. No se usa un estado nuevo: `RECHAZADA` + motivo evita tocar el enum y
todas las pantallas que lo interpretan.

Dos capas, a propósito:

- **Guardia al aprobar**: antes de aplicar el cambio se verifica que
  `fechaEfectiva` siga siendo futura. Si no, no se aplica y la solicitud queda
  vencida. Esto es lo que garantiza que nunca se aplique un cambio retroactivo,
  aunque el barrido no haya corrido.
- **Barrido diario**: un timer con el patrón de `backup.service.ts`
  (`setInterval` + wrapper que atrapa el rechazo) marca vencidas las
  `PENDIENTE`/`EN_REVISION` cuya fecha efectiva ya llegó y manda los avisos. Sin
  esto el solicitante se entera recién cuando alguien intenta firmar.

Compatibilidad: las solicitudes viejas con `fechaEfectiva: null` se siguen
aplicando desde la aprobación y el barrido no las toca.

### D. Recálculo al aprobar

Aplicar el cambio no alcanza: los días ya cargados posteriores a la fecha
efectiva tienen `esFrancoTrabajado` derivado del diagrama viejo.

Al aplicar se recalculan los registros con `fecha >= fechaEfectiva` de las
planillas del empleado en estado `BORRADOR` o `RECHAZADA`, con la misma función
que deriva el contexto al guardar un día —`calcularConContexto()`, hoy privada en
`planillas.routes.ts:47`, que se extrae a utils— y después
`recalcularTotalesPlanilla()`.

Las planillas `ENVIADA`, `EN_REVISION`, `APROBADA` y `CERRADA` **no se tocan**:
esas horas ya se firmaron. En su lugar se notifica a RRHH con empleado, períodos
y cantidad de días afectados, para que decidan a mano.

### E. Calendario de equipo y export

`GET /vacaciones/gantt` devuelve `tramos: TramoDiagrama[]` por empleado en lugar
de un `diagrama` único; `CalendarioDetallado` pinta las bandas de descanso
recorriendo los tramos. El subtítulo del turno (`turnoSubtitle`) describe el
tramo vigente hoy y, si hay más de uno en el año, lo aclara.

El encabezado del Excel y del PDF pasa de `Diagrama: X` a
`Diagrama: L-V hasta 31/07 · 7×7 desde 01/08` cuando el período tiene corte.

## Alcance

Dentro:

- `apps/api/src/utils/diagrama-vigencia.utils.ts` (nuevo).
- `apps/api/src/utils/contexto-dia.utils.ts` — `esFrancoPorDiagrama` reescrita.
- `apps/api/src/routes/cambios-diagrama.routes.ts` — fecha obligatoria y futura,
  guardia de vencimiento, cierre sin solape, recálculo, notificaciones.
- `apps/api/src/routes/usuarios.routes.ts` — cierre sin hueco en la asignación
  manual.
- `apps/api/src/routes/planillas.routes.ts` — `tramosDiagrama` en el detalle,
  tramos en la validación de envío, `calcularConContexto` extraída.
- `apps/api/src/routes/vacaciones.routes.ts` — tramos en el gantt.
- `apps/api/src/routes/export.routes.ts` — encabezado con corte.
- Barrido de vencidas (servicio nuevo + arranque junto al de backups).
- `apps/web/src/utils/planillaHelpers.ts` — `francoDelDia` sobre tramos.
- `apps/web/src/pages/planillas/PlanillaDetailPage.tsx` — tramos y marca del
  corte.
- `apps/web/src/pages/CambiosDiagramaPage.tsx` — campo de fecha de inicio.
- `apps/web/src/components/calendario/CalendarioDetallado.tsx` y `shared.ts`.

Fuera:

- El modelo de datos: `UsuarioDiagrama` ya tiene lo necesario, no hay migración.
- Estados nuevos en el enum de la solicitud.
- Cualquier cambio en cómo se calculan las horas de un día (sólo cambia de dónde
  sale el flag de franco).
- Reglas de anticipación mínima para pedir un cambio: es política de la empresa y
  nadie la pidió.

## Verificación

Backend (`apps/api/tests/`):

- Un usuario con dos tramos (L-V hasta el 31/07, 7×7 desde el 01/08): los francos
  del 20/07 salen del primero y los del 05/08 del segundo, tanto en
  `esFrancoPorDiagrama` como en `tramosDeUsuario`.
- El día del corte pertenece al tramo nuevo, con y sin solape en los datos.
- Un día franco trabajado **anterior** al cambio conserva el recargo del 100% al
  recalcularse después de aprobado el cambio (la regresión del problema 1).
- La validación de `/enviar` no reclama un día que era franco en su tramo.
- Crear una solicitud sin `fechaEfectiva`, o con una fecha pasada o de hoy,
  responde 400.
- Aprobar una solicitud cuya fecha efectiva ya llegó la deja `RECHAZADA` y no
  crea asignación.
- El barrido marca vencidas las pendientes con la fecha cumplida y no toca las
  que tienen `fechaEfectiva: null`.
- Al aplicar un cambio, un registro posterior a la fecha efectiva en una planilla
  BORRADOR queda recalculado; uno en una planilla APROBADA queda intacto y genera
  la notificación a RRHH.

Front:

- Tests de `francoDelDia`: sin tramos, un tramo, dos tramos con corte a mitad de
  período, y un rotativo cuyo ciclo arranca dentro del período.
- Prueba manual: aprobar un cambio con fecha a mitad de un período cargado y
  verificar que el calendario parte los francos en el día correcto y que el
  Excel muestra los dos diagramas.
