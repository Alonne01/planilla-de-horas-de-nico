# Marca manual de días en la planilla (plan B) — Diseño

**Fecha:** 2026-07-21
**Estado:** Aprobado (pendiente revisión final del spec)

## Problema

Hoy los días de ausencia (certificado médico, falta justificada, falta
injustificada, licencia especial) y de franco compensatorio solo llegan a la
planilla a través del **flujo formal**: se solicita una `Ausencia`, alguien la
aprueba, y recién ahí `inyectarDiasBloqueados()` escribe el `RegistroHoras`
bloqueado en la planilla.

En la práctica ese flujo se olvida: no se solicita, o se solicita y no se
aprueba a tiempo. El día queda vacío o mal cargado en la planilla, aunque todos
saben qué pasó. Falta un **plan B**: poder colocar el día directamente sobre la
planilla, de manera manual, y que igual quede plasmado como corresponde.

Estado actual relevante:
- El empleado (dueño de la planilla) **no puede** marcar ningún tipo de ausencia
  sobre su planilla; solo carga horas o el check `esFrancoCompensatorio`.
- Un supervisor+ puede marcar un compensatorio directo con
  `PATCH /planillas/:id/registros/:rid/compensatorio`, pero es solo para
  compensatorio, solo supervisor+, y **no** valida saldo disponible.
- Analytics y export leen registros de `Ausencia`, así que un día que solo viva
  como `RegistroHoras` sería invisible en reportes.
- El cálculo salarial fue removido: `descuentaSueldo`/`porcentajeDescuento` ya no
  tienen efecto automático (se conservan como metadato).

## Decisiones tomadas

1. **Quién marca:** ambos. El **dueño** de la planilla marca sobre su propia
   planilla y la marca nace **"sin validar"**. Quien lo **gestiona**
   (supervisor/coordinador/RRHH, según `canManageUser`) también puede marcar, y
   su marca nace **auto-validada**.
2. **Tipos marcables:** los 5 — `CERTIFICADO_MEDICO`, `FALTA_JUSTIFICADA`,
   `FALTA_INJUSTIFICADA`, `LICENCIA_ESPECIAL`, `FRANCO_COMPENSATORIO`. El
   certificado médico marcado a mano queda sin archivo adjunto (se puede adjuntar
   después con el endpoint existente `POST /ausencias/:id/archivo`).
3. **Validación:** día por día. El superior confirma o rechaza cada día marcado,
   con un botón adicional **"Aprobar todas las marcas"** para confirmarlas en
   lote. Las marcas sin validar **frenan la aprobación** de la planilla.
4. **Punto de bloqueo:** el bloqueo cae en **la aprobación del superior**
   (`POST /planillas/:id/avanzar`). El **envío del empleado**
   (`POST /planillas/:id/enviar`) **no** se bloquea: el empleado envía con marcas
   sin validar, y el superior las valida durante la revisión.
5. **Saldo de compensatorios:** al marcar un día como `FRANCO_COMPENSATORIO` se
   **exige saldo disponible** (`acumulados − usados − pendientes`). Si no alcanza,
   no deja marcar. Nunca queda en negativo.
6. **Enfoque (Opción B):** la marca manual **crea una `Ausencia` real** con
   provenance `cargaManual=true`, ligada a la planilla, y reusa el mecanismo de
   inyección existente. Así produce el mismo resultado que el flujo formal
   (aparece en reportes, calendario, saldos), solo que cargado a mano. Se
   descartó la Opción A (solo `RegistroHoras`) porque dejaría las marcas manuales
   fuera de analytics/export/calendario.

## Concepto

Una **marca manual** es una `Ausencia` de un día cargada directo desde la
planilla, sin flujo de solicitud/aprobación (`flujoId = null`). Nace ligada a la
planilla (`planillaId`) con `cargaManual = true`, y **se plasma en el acto**
inyectando el `RegistroHoras` bloqueado del día (horas en cero). "Validar" una
marca = aprobar esa ausencia manual (`estado → APROBADA`).

La **fuente única de verdad** del estado de validación es `Ausencia.estado`:
- `PENDIENTE` → sin validar.
- `APROBADA` → validada.
- `RECHAZADA` → rechazada (el día se des-inyecta).

## Modelo de datos (1 migración)

### `Ausencia`
```prisma
cargaManual Boolean @default(false) @map("carga_manual")
// back-relation:
registrosMarcados RegistroHoras[] @relation("registro_marca_manual")
```
- `cargaManual` distingue las marcas plan-B del flujo formal.
- Se reusan campos existentes: `planillaId` (planilla donde se marcó),
  `cargadaPorId` (quién marcó), `aprobadaPorId`/`aprobadaAt` (quién/ cuándo
  validó).

### `RegistroHoras`
```prisma
marcaManualId String?   @map("marca_manual_id")
marcaManual   Ausencia? @relation("registro_marca_manual", fields: [marcaManualId], references: [id], onDelete: SetNull)
```
- Liga el día bloqueado a la ausencia manual que lo generó. Permite que el GET de
  la planilla muestre "sin validar" leyendo `reg.marcaManual.estado`, **sin
  duplicar el estado**. Es `null` para días normales y para inyecciones del flujo
  formal (comportamiento actual intacto).

No se agregan flags de estado denormalizados en `RegistroHoras`: el estado vive
solo en `Ausencia`.

## Flujo detallado

### 1. Marcar un día
`POST /planillas/:id/marcar-dia` — body `{ fecha, tipo, descripcion? }`

- **Auth:** el actor es el dueño de la planilla, **o** puede gestionar al dueño
  (`canManageUser`). Reutiliza el helper `canManageUser` (hoy en
  `ausencias.routes.ts`; se extrae a un util compartido para no duplicarlo).
- **Estado de la planilla permitido:**
  - Dueño: `BORRADOR` o `RECHAZADA`.
  - Superior: `BORRADOR`, `RECHAZADA`, `ENVIADA` o `EN_REVISION` (puede marcar
    durante la revisión).
  - Nunca `APROBADA` ni `CERRADA`.
- **`fecha` dentro del período** de la planilla (`periodoInicio..periodoFin`).
- **Compensatorio:** dentro de una transacción serializable, verifica
  `disponible = acumulados − usados − pendientes ≥ 1`. Si no, `400`
  (`SALDO_COMPENSATORIO_INSUFICIENTE`) y no marca. Si alcanza, reserva
  `compensatoriosPendientes += 1` (igual que el flujo formal).
- **Crea la `Ausencia`:** `usuarioId = dueño`, `cargadaPorId = actor`,
  `planillaId`, `cargaManual = true`, `tipo`, `fechaInicio = fechaFin = fecha`,
  `diasAusencia = 1`, `flujoId = null`, `descripcion`,
  `descuentaSueldo = (tipo === FALTA_INJUSTIFICADA)`.
  - Dueño marca → `estado = PENDIENTE`, `requiereAprobacion = true`,
    `aprobada = false`.
  - Superior marca → `estado = APROBADA`, `aprobada = true`,
    `aprobadaPorId = actor`, `aprobadaAt = now`. Si es compensatorio, además
    convierte saldo `pendientes → usados` (ver §2, misma lógica).
- **Inyecta el `RegistroHoras`** del día (aunque esté `PENDIENTE`): `bloqueado =
  true`, `motivoBloqueo = tipo`, horas en cero, turnos en null,
  `marcaManualId = ausencia.id`. Para compensatorio se deja
  `esFrancoCompensatorio = false` (el saldo lo maneja el ciclo de la ausencia, no
  la aprobación de la planilla — evita doble conteo).
- Crea `AusenciaHistorial` + `AuditoriaLog`.
- **Si el día ya tenía horas cargadas:** se reemplaza (se ponen en cero). El
  frontend confirma antes de enviar (ver §Frontend).
- **Si el día ya tiene una marca manual previa** (registro con `marcaManualId`):
  se rechaza con `409` y un mensaje claro; primero hay que quitar/rechazar la
  marca anterior. (Un día = una marca.)
- Devuelve el `RegistroHoras` actualizado con `marcaManual` incluido.

### 2. Validar marcas
`POST /planillas/:id/marcas/:ausenciaId/validar` (una)
`POST /planillas/:id/marcas/validar-todo` (todas las `PENDIENTE` de la planilla)

- **Auth:** el actor puede gestionar al dueño (`canManageUser`) y **no** es el
  dueño (nadie valida su propia marca).
- La ausencia debe ser `cargaManual = true`, pertenecer a esta planilla y estar
  `PENDIENTE`.
- Pasa a `APROBADA` (`aprobadaPorId`, `aprobadaAt`). Si es `FRANCO_COMPENSATORIO`:
  dentro de transacción, `compensatoriosPendientes -= 1`, `compensatoriosUsados
  += 1`.
- `validar-todo` aplica lo anterior a todas las marcas `PENDIENTE` de la planilla
  en una transacción.
- `AusenciaHistorial` + `AuditoriaLog` por cada validación.

### 3. Quitar / rechazar una marca
`DELETE /planillas/:id/marcas/:ausenciaId`

- **Dueño**: puede quitar su propia marca mientras esté `PENDIENTE` y la planilla
  editable (`BORRADOR`/`RECHAZADA`). Al ser una corrección de algo aún no
  validado, **elimina la fila `Ausencia`** por completo, des-inyecta el día
  (limpia el `RegistroHoras`: `bloqueado = false`, `motivoBloqueo = null`,
  `marcaManualId = null`) y libera el saldo comp. reservado (`pendientes -= 1`).
- **Superior** (`canManageUser`, no dueño): rechaza la marca dejándola en
  `estado = RECHAZADA` (se conserva la fila para la traza), con el mismo efecto de
  des-inyección y liberación de saldo. Aplica también sobre marcas ya `APROBADA`
  (revierte `usados -= 1`).
- Si el compensatorio ya estaba validado (`APROBADA` → estaba en `usados`), al
  rechazar se revierte `usados -= 1`; si estaba `PENDIENTE`, `pendientes -= 1`.

### 4. Gating en la aprobación
En `POST /planillas/:id/avanzar`, antes de avanzar de paso: si existe alguna
`Ausencia` con `planillaId = :id`, `cargaManual = true` y
`estado ∉ {APROBADA, RECHAZADA}` → `400` con
`{ error, marcasPendientes: N }`. El mensaje indica cuántas marcas faltan validar.

`POST /planillas/:id/enviar` **no** se toca: el empleado envía con marcas
`PENDIENTE`.

## Endpoints (resumen)

Todos en el router de planillas (`planillas.routes.ts`), porque la acción nace en
el contexto de la planilla:

| Método | Ruta | Quién | Efecto |
|---|---|---|---|
| POST | `/planillas/:id/marcar-dia` | dueño o gestor | crea ausencia manual + inyecta día |
| POST | `/planillas/:id/marcas/:ausenciaId/validar` | gestor (no dueño) | ausencia → APROBADA (+ saldo si comp.) |
| POST | `/planillas/:id/marcas/validar-todo` | gestor (no dueño) | valida todas las PENDIENTE |
| DELETE | `/planillas/:id/marcas/:ausenciaId` | dueño (propia PENDIENTE) o gestor | des-inyecta + libera saldo |
| POST | `/planillas/:id/avanzar` (mod.) | gestor | 400 si hay marcas sin validar |

`canManageUser` se extrae de `ausencias.routes.ts` a un util compartido
(p. ej. `utils/user-scope.utils.ts`) y se reusa en ambos routers.

## Frontend (`PlanillaDetailPage.tsx`)

- **Día no bloqueado + editable por el que mira** → acción **"Marcar día
  especial"** (menú con los 5 tipos). Disponible al dueño (BORRADOR/RECHAZADA) y a
  gestores (también ENVIADA/EN_REVISION). Si el día tenía horas cargadas, confirma
  ("Este día tiene horas, se reemplazarán") antes de llamar al endpoint.
- **Día con marca `PENDIENTE`** → etiqueta del tipo (reusa el mapa de labels
  existente) + chip ámbar **"Sin validar"**. El dueño ve **"Quitar"**.
- **Día con marca `APROBADA`** → se muestra como día bloqueado normal (como hoy),
  con una marca sutil de validado.
- **Vista de aprobador** (quien puede gestionar, mirando una planilla en
  ENVIADA/EN_REVISION) → botón **"Validar"/"Rechazar"** por día marcado + botón
  global **"Aprobar todas las marcas (N)"** en el encabezado de revisión. El botón
  de aprobar la planilla queda **deshabilitado** con tooltip
  ("Validá las N marcas manuales primero") mientras haya marcas sin validar.
- Error de saldo insuficiente (compensatorio) → toast con el mensaje del API.

El GET `/planillas/:id` incluye en cada `registro` el objeto `marcaManual`
(`{ id, estado, tipo, cargadaPorId, aprobadaPorId }`) cuando existe.

## Trazabilidad

- `AusenciaHistorial` registra creación, validación y rechazo de cada marca.
- `AuditoriaLog` (entidad `Ausencia`) registra marcar/validar/rechazar con
  descripción legible (p. ej. "Marca manual FALTA_JUSTIFICADA 2026-07-15 por
  Juan Pérez").

## Casos borde

- **Día feriado o franco (descanso):** se permite marcar (no está prohibido);
  queda a criterio de quien carga.
- **Planilla inexistente para el período:** la acción nace desde la planilla, así
  que siempre existe. Para marcar sin planilla abierta ya está el flujo formal
  `POST /ausencias` (que back-fillea al crear la planilla).
- **Interacción con `backfillAusenciasEnPlanilla`:** las marcas se crean sobre una
  planilla existente, sin conflicto de backfill. Si una planilla se borra y se
  recrea, el backfill re-inyecta las ausencias `APROBADA` del período (incluidas
  las manuales), aunque sin re-setear `marcaManualId`. Mejora opcional: que el
  backfill setee `marcaManualId` para ausencias `cargaManual`. No bloqueante.
- **Concurrencia de saldo comp.:** marcar/validar/rechazar compensatorio usan
  transacción serializable con manejo de `P2034` (retry 409), igual que el flujo
  formal existente.

## Qué NO entra (YAGNI)

- Marcar un **rango** de días de una: v1 es un día por marca (la UI es por celda).
- Reescribir el `PATCH .../compensatorio` de supervisor existente: se deja como
  está; la marca manual es el camino nuevo y completo.
- Adjuntar certificado en el mismo paso de marcar: se usa el endpoint de archivo
  existente después.
- Cambiar cómo analytics filtra ausencias por estado (fuera de alcance).
