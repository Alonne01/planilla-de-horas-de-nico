# Ausencias y vacaciones en la planilla: fecha correcta, pendientes visibles

Fecha: 2026-07-27
Rama: `anvil/ui-improvements`

Un operador pidió una falta justificada para el 31/07 y un certificado médico
para el 28–29/07. En la planilla, la falta aprobada aparece pintada **el 30/07**,
y el certificado en revisión **no aparece en ningún lado**. Lo que el operador
espera: ver marcados los días que pidió aunque estén en revisión, poder escribir
en ellos mientras no estén aprobados, y que al aprobarse el día quede bloqueado
pisando lo que hubiera cargado.

## Problemas

### 1. El día bloqueado cae un día antes

Verificado en la base con los datos del reporte:

| Dato | Valor guardado |
|---|---|
| `Ausencia.fechaInicio` (falta justificada) | `2026-07-31T03:00:00.000Z` |
| `RegistroHoras.fecha` inyectado al aprobarla | `2026-07-31T00:00:00.000Z` |

Los dos dicen "31 de julio", pero bajo convenciones distintas: la ausencia guarda
medianoche **argentina** (el front manda hora local), y el día bloqueado guarda
medianoche **UTC** (`buildDaysBetween`, `ausencia-calendar.utils.ts:209`).

El calendario de la planilla arma su índice con
`map[dateKey(new Date(r.fecha))]` (`PlanillaDetailPage.tsx:338`), y `dateKey`
lee los componentes **locales** de la fecha (`planillaHelpers.ts:5`). En
Argentina (UTC−3), `2026-07-31T00:00:00Z` es el 30/07 a las 21:00 → la ausencia
se pinta el 30.

### 2. Conviven tres convenciones para representar "un día"

En la misma columna `RegistroHoras.fecha`:

- **`15:00Z`** — horas cargadas por el operador. El front manda mediodía local
  (`PlanillaDetailPage.tsx:876` y `:623`) y el backend guarda ese instante tal
  cual (`planillas.routes.ts:1014` y `:1104`).
- **`00:00Z`** — días inyectados por ausencia/vacación aprobada.
- **`03:00Z`** — `Ausencia.fechaInicio/Fin`, `Vacacion.fechaInicio/Fin`,
  `Planilla.periodoInicio/Fin` cuando se crean desde el front.

Conteo actual en la base: 33 registros de horas (todos `00:00Z`, vienen del
seed), 42 ausencias (35 en `00:00Z` + 7 en `03:00Z`), 18 vacaciones (17 + 1),
24 planillas (22 + 2).

Consecuencias:

- **El índice único `@@unique([planillaId, fecha])` compara timestamps**, no
  días. Un día con horas cargadas desde el front (`15:00Z`) no colisiona con el
  bloqueo que inyecta la aprobación (`00:00Z`): en vez de pisarlo, se crea una
  **segunda fila para el mismo día calendario**. El "pisar" pedido no es
  implementable sin unificar esto primero.
- **El primer día del período se pierde.** `inyectarDiasBloqueados` filtra
  `day >= p.periodoInicio` (`ausencia-calendar.utils.ts:43`): con
  `day = 2026-07-16T00:00Z` y `periodoInicio = 2026-07-16T03:00Z`, el día queda
  afuera. Lo mismo en el recorte del backfill (`clampDate`, `:218`).
- **`POST /planillas/:id/marcar-dia`** busca el registro por
  `planillaId_fecha` con la fecha que le llegó del front, pero
  `inyectarDiasBloqueados` la normaliza a UTC: la guardia de "día ya bloqueado"
  (`planillas.routes.ts:1458`) y la relectura final (`:1549`) pueden mirar una
  fila distinta de la que se escribió.

### 3. Las solicitudes en revisión no existen para la planilla

La planilla sólo conoce lo que está materializado como `RegistroHoras`, y eso se
crea recién al aprobar (`inyectarDiasBloqueados`). Una ausencia o vacación
`PENDIENTE`/`EN_REVISION` es invisible en el calendario: el operador no tiene
forma de saber qué días ya pidió. El calendario de equipo sí las muestra
(`vacaciones.routes.ts:131` y `:150` traen los tres estados), la planilla no.

## Decisiones tomadas

| Decisión | Resuelto |
|---|---|
| Día con solicitud en revisión | Marca visual + aviso al abrir el día. Se puede escribir sin fricción extra. |
| Aprobación con horas ya cargadas | Pisa **sólo** si la planilla es editable. Si no, no toca nada y avisa que hay que rechazarla y reenviarla. |
| Alcance de la corrección de fechas | Unificación **global** de todas las fechas-día del sistema. |
| Día en revisión al enviar la planilla | **Sigue contando como faltante**. |
| Borrar y recrear la planilla | Los días aprobados se reponen. Las marcas manuales del plan B siguen cancelándose. |

## Diseño

### A. Una sola convención de fecha-día

**La regla:** toda fecha que representa un *día* (no un instante) se guarda como
**medianoche UTC del día calendario argentino**. Es la convención que ya usan
`claveFecha()` y `hoyLocalEmpresa()` (`contexto-dia.utils.ts:76` y `:112`), y
donde ya está la mayoría de los datos.

**Columnas alcanzadas** (fechas-día):

- `registros_horas.fecha`
- `ausencias.fecha_inicio` / `fecha_fin`
- `vacaciones.fecha_inicio` / `fecha_fin`
- `planillas.periodo_inicio` / `periodo_fin`
- `usuarios_diagramas.fecha_inicio` / `fecha_fin`
- `usuarios.fecha_nacimiento` / `fecha_ingreso` / `fecha_fin_prueba` / `fecha_egreso`
- `exportaciones.periodo_inicio` / `periodo_fin`
- `proyectos.fecha_inicio` / `fecha_fin`
- `empleado_capacitaciones.fecha_realizacion` / `fecha_vencimiento`
- `sesiones_capacitacion.fecha` (la hora va aparte, en `hora_inicio`/`hora_fin`)
- `solicitudes_cambio_diagrama.fecha_efectiva`
- `wentop_tarjetas.fecha_reporte` / `fecha_cierre`

**Columnas NO alcanzadas** (instantes reales, se dejan como están):
`created_at`, `updated_at`, `expires_at`, `enviada_at`, `aprobada_at`,
`cerrada_at`, `leido_at`, `respondido_at`, `actualizado_at`, `creado_at`, y
`registros_horas.entrada_turno1/2` y `salida_turno1/2` (son horas del día).
`feriados_nacionales.fecha` ya es un `String` `YYYY-MM-DD`: no se toca.

**Backend — normalizar en el borde de entrada.** Junto a `fechaFlexible`
(`zod.utils.ts:11`, que devuelve el string crudo y deja que cada handler haga
`new Date(...)`) se agrega `fechaDia`, que valida igual pero **transforma a un
`Date` ya normalizado**. Los endpoints que reciben fechas-día pasan a usarlo, así
que da lo mismo si el cliente manda `"2026-07-31"`, `"2026-07-31T00:00:00-03:00"`
o un ISO con hora: siempre sale `2026-07-31T00:00:00Z`.

Se suman a `contexto-dia.utils.ts` los helpers de comparación que faltan, para
que ningún filtro vuelva a comparar timestamps:

```ts
export function diaDesdeEntrada(valor: string | Date): Date  // → medianoche UTC del día AR
export function mismoDia(a: Date, b: Date): boolean
export function dentroDelRango(dia: Date, desde: Date, hasta: Date): boolean
```

`buildDaysBetween` y `clampDate` (`ausencia-calendar.utils.ts`) pasan a apoyarse
en ellos en vez de tener su propia normalización.

**Front — nunca construir un `Date` local desde una fecha-día.** La clave de día
sale del string, como ya hace `ymd()` en `calendario/shared.ts:92`. Se promueve
ese helper a un módulo compartido (`utils/fechaDia.ts`) con `diaKey(iso)` y
`fmtDia(iso)`, y se reemplazan los `new Date(fecha)` sobre fechas-día. Al enviar
se manda `"YYYY-MM-DD"` en lugar del `toISOString()` de mediodía local.

Archivos del front a barrer (los que hoy hacen `new Date(...)` sobre una
fecha-día): `PlanillaDetailPage.tsx`, `AusenciasPage.tsx`, `VacacionesPage.tsx`,
`MisSolicitudesPage.tsx`, `AprobacionesPage.tsx`, `EquipoPage.tsx`,
`CapacitacionesPage.tsx`, `admin/UsuariosPage.tsx`,
`admin/VacacionSaldosPage.tsx`, `calendario/CalendarioCompacto.tsx`,
`calendario/shared.ts`.

**Migración de datos.** Una migración Prisma que, por cada columna de la lista,
normaliza **sólo las filas cuya hora UTC no sea `00:00`**, tomando su día
calendario argentino:

```sql
UPDATE ausencias
   SET fecha_inicio = date_trunc('day', fecha_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires')
 WHERE fecha_inicio::time <> '00:00:00';
```

Las filas que ya están en `00:00Z` **no se tocan**: bajo la convención destino ya
representan el día correcto, y aplicarles la regla las correría un día atrás.

Verificado antes de escribir el spec: no hay ningún `(planilla_id, día)` con más
de una fila, así que el colapso al normalizar `registros_horas` no viola el
índice único. La migración va precedida de `pg_dump`.

### B. Las solicitudes en revisión se ven en la planilla

**Backend.** `GET /planillas/:id` suma `solicitudesPendientes`: ausencias y
vacaciones **del dueño de la planilla** con estado `PENDIENTE` o `EN_REVISION`
que solapan el período.

```ts
solicitudesPendientes: Array<{
  id: string;
  clase: 'AUSENCIA' | 'VACACION';
  tipo: string;          // AusenciaTipo, o 'VACACION'
  estado: string;        // PENDIENTE | EN_REVISION
  fechaInicio: string;
  fechaFin: string;
  descripcion: string | null;   // Ausencia.descripcion, o Vacacion.motivo
}>
```

Quedan afuera las marcas manuales del plan B (`cargaManual: true`): esas ya
bloquean el día por diseño propio y aparecen como `RegistroHoras.marcaManual`.

**Front.** El calendario expande los rangos a claves de día
(`pendientesPorDia: Record<string, Pendiente>`). La celda con pedido en revisión
se pinta con el color atenuado del tipo, **borde punteado** y etiqueta
`Cert. Méd. · en revisión` — distinta del día bloqueado, que conserva su candado
y relleno pleno. La etiqueta corta del tipo sale de las que ya existen
(`TIPO_LABEL` en `calendario/shared.ts:70`). Prioridad de pintado:
bloqueado > pendiente > franco/feriado.

**Al abrir el día**, un cartel informativo arriba del diálogo: *"Tenés un
certificado médico en revisión para este día. Si se aprueba, lo que cargues acá
se va a reemplazar."* El día se edita y se guarda normalmente: sin confirmación
extra ni bloqueo.

**Al enviar la planilla**, un día con pedido en revisión **sigue contando como
faltante** (`planillas.routes.ts:386` en adelante, sin cambios de fondo). La
respuesta marca cuáles de los días faltantes tienen un pedido pendiente, para que
el front pueda explicar por qué se los sigue pidiendo.

### C. Al aprobar, se pisa o se avisa

`inyectarDiasBloqueados` pasa a resolver el día por clave calendario y, para cada
día del rango:

- **Planilla en `BORRADOR` o `RECHAZADA`** → el upsert pisa el registro
  existente: horarios en `null`, horas en cero, `bloqueado: true` con el motivo.
  Después, `recalcularTotalesPlanilla`. Si el día **tenía horas cargadas**, se
  notifica al operador qué se reemplazó.
- **Planilla en `ENVIADA`, `EN_REVISION` o `APROBADA`** → **no se toca nada**. La
  solicitud queda aprobada igual, el día se acumula en una lista de "no
  aplicados", y se notifica **al dueño de la planilla y a quien aprobó la
  solicitud**: *"La ausencia del 31/07 se aprobó, pero la planilla del período ya
  está enviada. Hay que rechazarla y reenviarla para que el día se aplique."*
  Queda registrado en auditoría.
- **Sin planilla para ese día** → como hoy: se aplica sola cuando la planilla se
  crea (parte D).

La función devuelve el detalle de lo aplicado y lo omitido, para que los
llamadores (`ausencias.routes.ts`, `vacaciones.routes.ts`,
`planillas.routes.ts:1533`) emitan las notificaciones correspondientes.

### D. Borrar y recrear la planilla repone los días

- **Aprobadas** → `backfillAusenciasEnPlanilla` (ya invocado en
  `planillas.routes.ts:245`) las vuelve a materializar. Con la parte A el recorte
  del período compara por día calendario, así que deja de perder los días en el
  borde.
- **En revisión** → reaparecen solas: la marca no se persiste, se calcula al
  vuelo desde la solicitud en cada `GET /planillas/:id`.
- **Reparación del caso C.** Si una ausencia se aprobó con la planilla ya
  enviada, rechazarla o borrarla y rehacerla mete el día solo, sin intervención
  de RRHH.
- **Las marcas manuales del plan B no vuelven**: al borrar la planilla se
  cancelan a propósito, devolviendo el saldo de compensatorio y borrando el
  certificado adjunto (`limpiarMarcasManuales`, `planillas.routes.ts:1393`).
  Comportamiento actual, se mantiene.

## Orden de implementación

Las partes no son independientes: **C depende de A** (sin el índice único
funcionando por día, el "pisar" crea filas duplicadas). El orden es:

1. **Parte A** — helpers, normalización en el borde, barrido del front,
   migración. Se puede verificar sola: el día aprobado ya cae en la fecha
   correcta, que es la mitad del reporte original.
2. **Parte B** — `solicitudesPendientes` y el pintado. No depende de C.
3. **Partes C y D** — el pisado condicionado al estado, las notificaciones y el
   backfill.

## Testing

**Unitarios (helpers de fecha).** `diaDesdeEntrada` con `"YYYY-MM-DD"`, ISO con
`Z`, ISO con `-03:00` y `Date` crudo; el caso de las 21:00–24:00 argentinas (el
UTC ya rodó al día siguiente); `mismoDia`/`dentroDelRango` en los bordes.

**Integración (API).**
- Ausencia aprobada para el 31/07 → el `RegistroHoras` queda en
  `2026-07-31T00:00:00Z` y el `GET` lo devuelve en el día 31 (regresión directa
  del bug reportado).
- Ausencia en el **primer** y en el **último** día del período → se inyecta.
- Día con horas cargadas + ausencia aprobada, planilla en `BORRADOR` → una sola
  fila para ese día, bloqueada, con horas en cero y totales recalculados.
- Lo mismo con planilla `ENVIADA` → el registro con horas queda intacto y la
  respuesta reporta el día como no aplicado.
- `GET /planillas/:id` devuelve `solicitudesPendientes` con la ausencia
  `PENDIENTE` y no incluye las `cargaManual`.
- Envío con un día en revisión sin cargar → sigue apareciendo en `diasFaltantes`.
- Aprobar ausencia → borrar planilla → recrear → el día vuelve bloqueado y en la
  fecha correcta.

**Migración.** Antes/después sobre una copia de la base: ninguna fecha-día cambia
de día calendario, y las que estaban en `03:00Z` o `15:00Z` terminan en `00:00Z`.

**Manual.** Reproducir el escenario del reporte con el operador de prueba:
falta justificada el 31 (aprobada) + certificado médico 28–29 (pendiente), y
verificar el pintado de los tres días.

## Fuera de alcance

- Rechazar una solicitud ya aprobada no desbloquea los días (comportamiento
  actual, no se toca).
- Los cambios de diagrama pendientes no se marcan en el calendario: no bloquean
  días.
- La zona horaria sigue siendo Argentina fija (UTC−3, sin horario de verano),
  como ya documenta `contexto-dia.utils.ts:80`. Multi-huso por empresa no entra
  acá.
