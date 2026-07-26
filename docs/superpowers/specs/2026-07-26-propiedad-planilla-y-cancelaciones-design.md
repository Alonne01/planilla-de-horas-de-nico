# Propiedad de la planilla, cancelación de solicitudes y visibilidad por nivel

Fecha: 2026-07-26
Rama: `anvil/ui-improvements`
Reemplaza parcialmente: `2026-07-21-marca-manual-dias-planilla-design.md`

## Problema

Tres defectos con una raíz común: no está definido quién es dueño de qué.

1. **Marcas manuales imborrables.** Cuando un superior marca un día (plan B), la
   `Ausencia` nace `APROBADA`. En `PlanillaDetailPage.tsx` el botón "Quitar marca"
   (dueño) y el par Validar/Rechazar (superior) exigen los dos `estado === 'PENDIENTE'`,
   así que no aparece ninguno: el día queda bloqueado para siempre. El backend sí
   dejaría al superior sacarla — falta el botón. Y el dueño solo puede quitar marcas
   `PENDIENTE` con la planilla en `BORRADOR`/`RECHAZADA`.

2. **Solicitudes sin salida.** Una vez enviada una solicitud, el dueño no puede
   deshacerla. Lo único que existe es `POST /ausencias/:id/revocar`, y solo para
   `FRANCO_COMPENSATORIO` con fecha futura. Si mandaste la planilla con un error,
   hay que esperar a que alguien la rechace.

3. **Planillas ajenas a la vista de cualquiera.** `getFlowVisibleUserIds` le da a
   todo aprobador el sector entero sin mirar niveles: un supervisor ve las planillas
   de otros supervisores y hasta la de su gerente si comparten sector.

## Principio rector

**La planilla es del dueño.** Nadie más edita su contenido — ni el supervisor ni
RRHH ni ADMIN. Los aprobadores solo hacen avanzar o rechazar el documento; si algo
está mal, lo rechazan y lo corrige el dueño.

Una planilla enviada está congelada: no la toca ni el dueño. Vuelve a ser editable
cuando la cadena la rechaza, o cuando el dueño la cancela antes de la primera firma.

## Parte 1 — Marcas manuales (plan B)

### Modelo

La marca sigue siendo una `Ausencia` con `cargaManual=true` y `planillaId`, fuera del
circuito de aprobación (`flujoId: null`), con el `RegistroHoras` del día ligado por
`marcaManualId`. **Las marcas viajan con la planilla**: se aprueban cuando se aprueba
la planilla que las contiene.

### Cambios en el API

| Endpoint | Cambio |
|---|---|
| `POST /planillas/:id/marcar-dia` | Solo el dueño (se elimina la rama `isManager` y el `autoValidada`). Estados permitidos: `BORRADOR`, `RECHAZADA`. La marca nace siempre `PENDIENTE`. |
| `DELETE /planillas/:id/marcas/:ausenciaId` | Solo el dueño, en `BORRADOR`/`RECHAZADA`. **Deja de exigir que la marca esté `PENDIENTE`.** Elimina la fila `Ausencia` (y su historial), borra el `RegistroHoras` ligado y devuelve el saldo compensatorio según el estado que tenía la marca. |
| `POST /planillas/:id/marcas/:ausenciaId/validar` | Se elimina. |
| `POST /planillas/:id/marcas/validar-todo` | Se elimina. |
| `POST /planillas/:id/avanzar` | Se elimina el gate de "marcas sin validar". Cuando `nuevoEstado === 'APROBADA'`, dentro de la misma transacción todas las marcas `PENDIENTE` de la planilla pasan a `APROBADA` (`aprobada: true`, `aprobadaPorId`, `aprobadaAt`), con su fila de `AusenciaHistorial`, y las de tipo `FRANCO_COMPENSATORIO` mueven el saldo de `compensatoriosPendientes` a `compensatoriosUsados`. |
| `PATCH /planillas/:id/registros/:rid/compensatorio` | Pasa a ser del dueño: se reemplaza `requireLevel(LEVEL_SUPERVISOR)` + `canManageUser` por "el actor es el dueño", y se acota a `BORRADOR`/`RECHAZADA`. |

`POST/PUT/DELETE /planillas/:id/registros` ya filtran por `usuarioId: req.user.userId`:
no cambian.

Al rechazar la planilla las marcas quedan `PENDIENTE` y vuelven a ser editables, porque
la planilla vuelve a `RECHAZADA`. No hace falta tocar `POST /:id/rechazar`.

`limpiarMarcasManuales` (borrado de planilla) no cambia.

### Cambios en el front

En `PlanillaDetailPage.tsx`:

- Se elimina `canMarkAsManager` y todo el bloque Validar / Rechazar / "Validar todo".
- El botón "Quitar marca" se muestra con `isOwner && canEdit`, **sin** condicionar al
  estado de la marca. Texto de confirmación: quitar el día también cancela la solicitud.
- El badge "sin validar" pasa a decir **"a aprobar con la planilla"**: describe lo que
  realmente va a pasar en lugar de sugerir una acción pendiente de alguien.
- El aprobador ve los días marcados al abrir la planilla, en modo lectura.

### Saldo compensatorio

El decremento al borrar depende del estado de la marca: `APROBADA` → `compensatoriosUsados--`,
`PENDIENTE` → `compensatoriosPendientes--`. Es la misma tabla de casos que ya usa
`limpiarMarcasManuales`; se extrae a un helper compartido para no tener la regla escrita
en tres lugares.

No hay doble conteo con el bloque de `avanzar` que acumula por `esFrancoCompensatorio`:
`inyectarDiasBloqueados` no setea esa columna en los días de marca manual.

El año del saldo se sigue tomando con `getFullYear()` local, alineado con el resto del
sistema de saldos (decisión heredada del spec anterior, sigue vigente).

## Parte 2 — Cancelación de solicitudes por el dueño

### Regla

El dueño cancela su solicitud **mientras nadie la haya firmado**. Una firma intermedia
la traba: a partir de ahí solo se sale por rechazo de la cadena.

En estados, "sin firmar" es:

- `Planilla` → `ENVIADA`
- `Vacacion`, `Ausencia` → `PENDIENTE`
- `SolicitudCambioDiagrama` → `PENDIENTE`

`EN_REVISION` ya implica al menos una firma, y por eso queda excluido.

### Endpoint

`POST /mis-solicitudes/:tipo/:id/cancelar`, con `:tipo` en `planilla | vacacion | ausencia | cambio-diagrama`.
Un solo endpoint porque la UI es una sola lista unificada; el despacho por tipo vive en
un `switch` con una función por tipo, cada una responsable de su limpieza.

Guardas comunes: el documento existe, es de la empresa del actor, el actor es el dueño
(`usuarioId` / `solicitanteId`), y el estado es el de "sin firmar". Se verifica además
que no exista historial de aprobación posterior al envío — el estado solo no alcanza si
en el futuro aparece un circuito de un solo paso que no cambie a `EN_REVISION`.

### Efectos por tipo

- **Planilla** → vuelve a `BORRADOR`: `pasoActual: 0`, `enviadaAt: null`, `circuitoSnapshot: null`,
  fila en `PlanillaHistorial`. Los registros y las marcas se conservan tal cual. El dueño
  corrige y reenvía.
- **Ausencia** → `CANCELADA`. Se liberan los días bloqueados que había inyectado y se
  devuelve el saldo compensatorio si era del tipo que reserva.
- **Vacacion** → `CANCELADA`. Se liberan los días bloqueados y se devuelven los días al saldo.
- **SolicitudCambioDiagrama** → se reusa la lógica del `DELETE` que ya existe en
  `cambios-diagrama.routes.ts` (borrado físico), llamada desde el nuevo endpoint. La ruta
  vieja queda como alias para no romper el front actual.

Las marcas manuales (`cargaManual=true`) **no** se cancelan por acá: se borran desde la
planilla, que es donde viven. `GET /mis-solicitudes` deja de listarlas como solicitudes
independientes — hoy aparecen como Ausencias `PENDIENTE` sin circuito que nadie puede
aprobar desde la bandeja. Pasan a mostrarse como parte de la planilla que las contiene.

### Migración

Se agrega `CANCELADA` a los enums `AusenciaEstado` y `VacacionEstado`. Sin backfill: las
filas viejas de `revocar` quedan como `RECHAZADA` con su `obsRechazo`.

`POST /ausencias/:id/revocar` **se conserva con su semántica propia** y no se pliega
sobre el nuevo endpoint: revocar actúa sobre un compensatorio ya `APROBADA` cuya fecha
todavía no pasó, que es justo lo que la cancelación no permite. Son dos operaciones
distintas — retirar una solicitud sin firmar vs. devolver un beneficio ya otorgado.
Lo único que se unifica es el resultado: `revocar` pasa a dejar la ausencia en
`CANCELADA` en vez de `RECHAZADA`, para que el dueño no vea su propia devolución como
un rechazo.

### Front

En `MisSolicitudesPage.tsx`, botón "Cancelar" en las tarjetas cancelables, con
confirmación. El estado `CANCELADA` se pinta distinto de `RECHAZADA`.

## Parte 3 — Visibilidad de planillas

### Regla

Para ver la planilla de otro hacen falta las dos cosas:

1. Ser aprobador — el rol del actor figura en algún paso de un flujo activo del tipo
   de documento (lo que `getFlowVisibleUserIds` ya resuelve).
2. Que el dueño tenga **nivel estrictamente menor** al del actor.

**Excepción:** el jefe directo (el actor es `supervisorId` o `coordinadorId` del dueño)
ve siempre, aunque compartan nivel. Sin esto, dos coordinadores donde uno manda al otro
dejarían de verse y el circuito podría quedar sin quién firme.

RRHH/ADMIN (nivel ≥ 90) mantienen la vista de toda la empresa.

### Implementación

En `visibility.utils.ts`, un filtro final sobre el set de ids: se traen los candidatos con
`rol: { select: { nivel: true } }`, `supervisorId` y `coordinadorId`, y sobrevive el que
cumple `nivel < actorNivel || esJefeDirecto`. El propio actor siempre queda incluido.

Se aplica igual al fallback `legacyVisibility`, si no las empresas sin flujos configurados
se quedan con el agujero.

El cambio se propaga a los cuatro llamadores (`planillas.routes.ts` ×3 incluido
`assertPlanillaAccess`, y `aprobaciones.routes.ts` para la bandeja), que es lo buscado:
un aprobador no debería tener en su bandeja documentos de pares o superiores.

La rama de `GET /planillas/:id` que habilita al aprobador responsable del paso actual
(`isResponsibleApprover` sobre el circuito congelado) se conserva: ese acceso ya está
justificado por el circuito del documento.

### Consecuencia asumida

Un rol aprobador cuyo circuito lo mande a firmar documentos de su mismo nivel dejará de
verlos. Es intencional: si eso pasa, el circuito está mal armado y hay que corregirlo en
Admin → Flujos, no abrirle la visibilidad a todo el sector.

## Testing

Suites nuevas en `apps/api/tests/`:

**Marcas manuales**
- El dueño borra una marca `APROBADA` → se va la `Ausencia`, se va el `RegistroHoras`, vuelve el saldo.
- Un supervisor no puede marcar ni borrar en planilla ajena (403), tampoco RRHH ni ADMIN.
- Marcar o borrar con la planilla `ENVIADA`/`EN_REVISION`/`APROBADA` → 400.
- Aprobar la planilla deja sus marcas `PENDIENTE` en `APROBADA` y mueve el saldo compensatorio una sola vez.
- Rechazar la planilla deja las marcas editables de nuevo.

**Cancelación**
- El dueño cancela su planilla `ENVIADA` → vuelve a `BORRADOR` con los registros intactos.
- Con una firma encima (`EN_REVISION`) → 400.
- Otro usuario intentando cancelar → 403.
- Cancelar una vacación devuelve los días y libera los bloqueos en la planilla.

**Visibilidad**
- Supervisor A no ve la planilla de supervisor B del mismo sector (403 en `GET /:id`, ausente en `GET /`).
- Supervisor no ve la de su gerente.
- Coordinador jefe directo de otro coordinador sí la ve.
- RRHH sigue viendo todo.
- La bandeja de aprobaciones no trae documentos de pares.

Los tests corren contra el server en `:4000` (ver `entorno-tests-gotchas`).

## Fuera de alcance

- Rehacer el sistema de saldos para que use UTC en el año (borde real de 1-ene, arrastrado del spec anterior).
- La inyección del día bloqueado sigue fuera de la transacción de `marcar-dia`, igual que el flujo formal.
- Cancelar solicitudes ya firmadas: sale por rechazo de la cadena o por RRHH.
