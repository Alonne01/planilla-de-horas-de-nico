# Solicitudes: canceladas, marca de "solicitado" y adjuntos

Fecha: 2026-07-26
Rama: `anvil/ui-improvements`

Cuatro correcciones sobre el circuito de solicitudes, detectadas probando la app.
Comparten un hilo: **lo que el usuario ya pidió tiene que verse, y lo que ya no
está en juego no tiene que aparentar que sí**.

## Problemas

1. Una solicitud **cancelada** sigue mostrando la cadena de revisión con el paso 1
   en ámbar ("Revisión Supervisor" en curso). Da a entender que alguien la está
   mirando, cuando ya salió del circuito.
2. Solicitar una ausencia o una vacación **no deja ninguna marca en el calendario
   de la planilla**. El día sigue vacío, igual que si no se hubiera pedido nada.
3. Aun cuando se marque, el usuario **tiene que poder cargar su horario normal**
   en esos días: mientras no esté aprobada, el día es un día de trabajo.
4. Un aprobador de la cadena **no puede ver el certificado** que el operador
   adjuntó a su propia solicitud después de enviarla.

## Estado actual (verificado en el código)

- `MisSolicitudesPage.tsx:152` pinta `ApprovalProgressBar` con la sola condición
  de que haya pasos. `ApprovalProgressBar` conoce `RECHAZADA` y `APROBADA`;
  `CANCELADA` cae en el caso por defecto y el paso actual queda ámbar animado.
- El día de la planilla se marca **sólo al aprobar**: `inyectarDiasBloqueados()`
  se llama desde `/ausencias/:id/avanzar` (`ausencias.routes.ts:921`), desde el
  equivalente de vacaciones y desde el backfill al crear una planilla
  (`backfillAusenciasEnPlanilla`, que filtra `estado: 'APROBADA'`). Una solicitud
  en `PENDIENTE` no deja huella en `GET /planillas/:id`.
- Excepción existente que no se toca: un certificado médico **cargado por un
  superior** (`POST /ausencias`) nace `APROBADA` y bloquea el día en el acto.
- `GET /aprobaciones` trae las ausencias con `include`, así que ya serializa
  todos los escalares —`archivoUrl` incluido—. `puedeVerUpload()`
  (`upload-access.utils.ts:161`) autoriza al aprobador por la rama `ausencia`
  vía `getFlowVisibleUserIds(..., 'AUSENCIA')`. El adjunto falta sólo en la UI.

## Diseño

### 1. Canceladas sin cadena y atenuadas

El guard vive **dentro de `ApprovalProgressBar`**: si `estado === 'CANCELADA'`
devuelve `null`. Un solo cambio cubre Mis Solicitudes, Vacaciones y el historial
de Aprobaciones, y ninguna pantalla futura puede olvidarse de la regla.

El atenuado es de cada tarjeta, porque el contenedor lo define cada página:
`opacity-60`, borde y fondo neutros (`border-border/50 bg-card/40`) y sin
`hover:border-primary/30`. El badge `CANCELADA` ya es gris y queda como está.

El bloque expandible "Ver detalle" se mantiene: el historial dice quién y cuándo,
y eso sigue siendo información válida de una solicitud retirada.

`AusenciasPage` dibuja su propia barra inline en vez de usar el componente; se le
aplica el mismo criterio a mano.

### 2. Marca de "solicitado" en el calendario de la planilla

**Backend** — `GET /planillas/:id` agrega un campo:

```ts
solicitudesPendientes: Array<{
  id: string;
  clase: 'AUSENCIA' | 'VACACION';
  tipo: string;          // AusenciaTipo, o 'VACACION'
  estado: string;        // PENDIENTE | EN_REVISION
  fechaInicio: string;
  fechaFin: string;
  etiqueta: string;      // "Cert. médico", "Vacaciones", …
}>
```

Son las ausencias y vacaciones **del dueño de la planilla**, en estado
`PENDIENTE` o `EN_REVISION`, cuyo rango solapa `[periodoInicio, periodoFin]`.
Quedan afuera las `BORRADOR` (nadie las envió todavía), las `RECHAZADA`, las
`CANCELADA` y las `APROBADA` (esas ya bloquean el día por la vía existente).

**No se escribe nada en `RegistroHoras`.** Es la decisión central del diseño:
una marca persistida habría que limpiarla al cancelar, al rechazar y al editar
fechas, y ensuciaría los totales y la validación de días faltantes. Al derivarla
en lectura, cancelar la solicitud borra la marca sin código de limpieza.

**Front** — `PlanillaDetailPage` expande los rangos a un `Map<fechaKey, solicitud>`
acotado al período, con un helper puro y testeable (`solicitudesPorDia`). En la
celda:

- badge `SOLIC.` ámbar en la fila de badges, junto a `FER` / `C` / `B`;
- borde punteado ámbar tenue, distinto del día bloqueado (violeta sólido con
  candado), para que se lea "pedido" y no "cerrado";
- si el día no tiene datos, la etiqueta corta ("Vac. solicitada", "Cert. médico
  solicitado") ocupa el lugar del "+ agregar".

El helper usa `dateKey` y las fechas se recortan al período con el mismo criterio
UTC que `buildDaysBetween` (ver `ausencia-calendar.utils.ts:202`): construir días
en hora local corre la fecha en un servidor con TZ negativa.

### 3. El día sigue editable

Se desprende del punto anterior: la celda no tiene `bloqueado`, así que abre el
editor normal y guarda como cualquier otro día. No hace falta ninguna excepción
en la lógica de guardado.

En el modal del día, aviso ámbar **no bloqueante** arriba del formulario:

> Tenés una solicitud de *{etiqueta}* para este día, pendiente de aprobación.
> Podés cargar tu horario normal; si te la aprueban, las horas de este día se
> reemplazan por la ausencia.

La contracara, en Aprobaciones: `GET /aprobaciones` devuelve `diasConHoras` por
cada ausencia y vacación pendiente — cuántos días del rango ya tienen un
`RegistroHoras` con `horasTrabajadas > 0`. Se resuelve con **una** consulta
agregada para todos los pendientes de la respuesta (no una por tarjeta), acotada
al rango mínimo/máximo de fechas, y se cuenta en memoria.

Cuando `diasConHoras > 0`, la tarjeta expandida y el diálogo de confirmación
muestran:

> ⚠ {n} de esos días tienen horas cargadas en la planilla. Al aprobar se
> reemplazan por la ausencia.

Aprobar sigue poniendo el día en cero: es el comportamiento actual y se conserva
deliberadamente. Lo que cambia es que deja de ser una sorpresa para las dos
partes.

### 4. Adjunto visible para el aprobador

Cambio de UI solamente. Se agrega `archivoUrl?: string | null` a la interfaz
`AusenciaItem` de `AprobacionesPage` y, en la tarjeta expandida —tanto en
pendientes como en historial—, un enlace "Ver certificado" con `getUploadUrl()`,
replicando el patrón ya usado en `PlanillaDetailPage.tsx:1453`.

Se verifica contra la API real que el campo llega y que el archivo abre con la
sesión del aprobador. Si diera 403, el problema estaría en
`getFlowVisibleUserIds` y no en la vista: la bandeja arma `approvableUserIds` con
esa misma función, así que ambos criterios deberían coincidir; un desacuerdo es
un bug aparte y se reporta, no se parchea desde el front.

## Alcance

Dentro:

- `apps/web/src/components/ui/ApprovalProgressBar.tsx` — guard de `CANCELADA`.
- `apps/web/src/pages/MisSolicitudesPage.tsx`, `vacaciones/VacacionesPage.tsx`,
  `ausencias/AusenciasPage.tsx`, `aprobaciones/AprobacionesPage.tsx` — atenuado
  de canceladas.
- `apps/api/src/routes/planillas.routes.ts` — `solicitudesPendientes` en
  `GET /:id`.
- `apps/api/src/routes/aprobaciones.routes.ts` — `diasConHoras`.
- `apps/web/src/pages/planillas/PlanillaDetailPage.tsx` — badge, borde, etiqueta
  y aviso del modal.
- `apps/web/src/utils/` — helper `solicitudesPorDia` + test.
- `apps/web/src/pages/aprobaciones/AprobacionesPage.tsx` — aviso de horas
  cargadas y enlace al certificado.

Fuera:

- La regla de qué pisa qué al aprobar (se conserva).
- El certificado médico cargado por un superior, que sigue naciendo aprobado.
- Los cambios de diagrama: no marcan días en la planilla.
- Cualquier cambio en el circuito de aprobación o en la visibilidad por nivel.

## Verificación

Backend (`apps/api/tests/qa/`):

- `GET /planillas/:id` devuelve la ausencia pendiente que solapa el período, y el
  `RegistroHoras` de esos días sigue sin `bloqueado`.
- Una ausencia cancelada, rechazada o en borrador no aparece en
  `solicitudesPendientes`.
- Un día con horas cargadas dentro del rango pendiente se cuenta en
  `diasConHoras`; uno en cero, no.
- El dueño puede guardar horas en un día con solicitud pendiente (200, no 4xx).

Front:

- Test unitario de `solicitudesPorDia`: rango que arranca antes del período,
  rango que termina después, y un día con dos solicitudes solapadas.
- Prueba manual con la app corriendo: solicitar una ausencia, ver el badge, cargar
  horas en ese día, aprobar desde el otro rol y confirmar que el aviso apareció y
  que el día quedó bloqueado en cero.
- Prueba manual del adjunto: subir el certificado como operador tras enviar la
  solicitud y abrirlo como supervisor desde Aprobaciones.
