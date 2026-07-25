# Informe de simulación de uso — bugs detectados

**App:** Planilla de Horas (WENLEN) · API Express+Prisma en `:4000` · **Fecha:** 2026-07-24
**Método:** 15 guiones de uso real en paralelo (operadores, supervisores, coordinadores, CMASS, RRHH, gerente, admin) vía HTTP contra la API viva, con `DEBUG_AUTH` activo. Cada hallazgo pasó (cuando alcanzó el tiempo) por un verificador adversarial independiente.

## Resumen

| Severidad | Distintos |
|---|---|
| 🔴 Crítica | 8 |
| 🟠 Alta | 50 |
| 🟡 Media | 94 |
| ⚪ Baja | 32 |
| **Total distintos** | **184** (de 185 hallazgos crudos tras deduplicar) |

### Estado de verificación
- **13 hallazgos** (vacaciones y WENTOP) pasaron por un verificador adversarial independiente que los **re-ejecutó y confirmó** (13/13 CONFIRMADO). Marcados con ✅.
- **1 hallazgo insignia** (autorización en `avanzar` sin flujo) lo **confirmé manualmente** leyendo el código y comprobando su alcance. Marcado con ✅.
- El resto está **reportado pero sin verificación independiente**: el límite de sesión cortó la fase de verificación. Tratarlos como *candidatos de alta credibilidad* (el 100% de lo que sí se verificó resultó real), no como confirmados.

### Cobertura
- **Corridos (15/19):** ciclo de planilla, cálculo de horas, vacaciones, ausencias, social (mensajes/notif/capac), WENTOP, aprobaciones (supervisor), marca manual, calendario+diagrama, flujos (coordinador), CMASS/HSE, cierre+export, personas+auditoría (RRHH), config (admin), analytics (gerente).
- **NO corridos (4/19)** — cortados por el límite de sesión, son huecos de cobertura a re-lanzar: **`seguridad-authz`** (barrido dedicado de IDOR/escalada), **`concurrencia-estados`** (carreras y doble-acción), **`ui-contrato-core`** y **`ui-contrato-admin`** (auditoría de contrato front↔API). Aun así, varios guiones ya arrojaron hallazgos de IDOR y de contrato de UI de paso.

---

## PLANILLAS — 49 (5 critica, 20 alta, 17 media, 7 baja)

> Nota: las 5 críticas de PLANILLAS/APROBACIONES sobre `avanzar` sin flujo son **una misma causa raíz** en `planillas.routes.ts:514` (`if (pasoActual > totalPasos || totalPasos === 0)` marca APROBADA sin llamar a `isResponsibleApprover`). Alcanzable con los **31 usuarios activos sin sector** (planilla nace `flujoId=null`) o si un admin deja un flujo sin pasos.

### 🔴 CRITICA — Planilla sin flujo: POST /planillas/:id/avanzar no valida NADA — cualquier usuario nivel>=60 (incluido el propio dueño) la aprueba solo
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** COORDINADOR (reproducido también con SUPERVISOR de otro sector y con el propio dueño)
- **Esperado:** 403. Sin flujo definido la planilla no debería poder aprobarla cualquiera: como mínimo el mismo criterio que vacaciones/ausencias (nivel>=90 y nunca el propio dueño), o un 400 indicando que falta configurar el flujo.
- **Obtenido:** 200 con estado=APROBADA y aprobadaPorId = el id del que llamó, sin ninguna verificación de rol, sector, jerarquía ni de auto-aprobación.
- **Repro:** 1) Login maria.rodriguez@demo.com (RRHH, sectorId=null → ninguna asignación de flujo PLANILLA le aplica; no existe asignación global sectorId=null+usuarioId=null en la empresa). 2) POST /planillas {"periodoInicio":"2128-11-03T00:00:00.000Z","periodoFin":"2128-11-03T00:00:00.000Z"} → 201 con flujoId:null. 3) POST /planillas/:id/registros {"fecha":"2128-11-03T00:00:00.000Z","entradaTurno1":"2128-11-03T08:00:00.000Z","salidaTurno1":"2128-11-03T16:00:00.000Z","lugarTrabajo":"BASE"} → 201. 4) POST /planillas/:id/enviar → 200 estado=ENVIADA pasoActual=1. 5) Login juancarlos.herrera@demo.com (COORDINADOR, nivel 70, sector Cabezales — no es supervisor ni coordinador de maria, ni comparte sector, ni 
- **Evidencia:** HTTP 200 — coordinador aprobando planilla ajena: {"id":"d10d8777-62d2-47bb-b444-0eaabfaa3439","usuarioId":"a0ff3d61-d7ef-4d7a-8a5d-74a9ebb4faef","flujoId":null,"estado":"APROBADA","pasoActual":1,"aprobadaPorId":"6705de17-cdab-4c73-8d0a-7128c7d61345"} (6705de17=juancarlos.herrera). HTTP 200 — auto-ap

### 🔴 CRITICA — PATCH compensatorio deja compensatoriosPendientes en NEGATIVO: descuenta saldo de días que nunca fueron compensatorios (y con body vacío)
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR
- **Esperado:** Sin cambio de saldo (400/409 o no-op): el día no era compensatorio, no hay nada que revocar. El contador nunca debería quedar por debajo de 0, y un body sin `activar` debería ser rechazado con 400 en vez de interpretarse como desactivar.
- **Obtenido:** 200 en ambas llamadas y compensatoriosPendientes queda en -1 y luego -2. Además el saldo corrompido NO es reparable por RRHH: PUT /vacacion-saldos/:id sólo acepta compensatoriosAcumulados/compensatoriosUsados, no compensatoriosPendientes.
- **Repro:** 1) Login alberto.ojeda@demo.com (SUPERVISOR de Intendencia) y raul.carrizo@demo.com (su operador). 2) Como raul: POST /planillas {periodoInicio:'2026-12-28', periodoFin:'2026-12-28'} (usar un día de 2026 libre; el año del saldo sale de la fecha del registro y raul ya tiene fila en vacacion_saldos para anio=2026). 3) Como raul: POST /planillas/{pid}/registros {fecha:'2026-12-28', lugarTrabajo:'BASE', entradaTurno1:'2026-12-28T08:00:00.000Z', salidaTurno1:'2026-12-28T17:00:00.000Z'} → 201, el día NO es compensatorio (esFrancoCompensatorio=false). 4) Verificar en DB: vacacion_saldos(usuarioId=raul, anio=2026).compensatoriosPendientes = 0. 5) Como alberto: PATCH /planillas/{pid}/registros/{rid}/
- **Evidencia:** fecha 2026-12-31 | saldo antes: acum=0 pend=0 usados=0 PATCH {activar:false} sobre día normal (pend=0) → 200; saldo: acum=0 pend=-1 usados=0 PATCH con body vacío {} → 200; saldo: acum=0 pend=-2 usados=0

### 🔴 CRITICA — PATCH compensatorio modifica una planilla CERRADA y deja los totales descuadrados (el propio Excel de cierre se contradice)
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** RRHH (y cualquier rol nivel>=60)
- **Esperado:** 400 'la planilla está CERRADA' (inmutabilidad del período cerrado). Y si se permitiera, los totales de la planilla deberían recalcularse para seguir cuadrando con los registros.
- **Obtenido:** 200: el registro queda bloqueado con entrada/salida en null y 0h, pero planilla.totalHorasNormales sigue con el valor viejo. El período cerrado queda con un total que no corresponde a ningún detalle.
- **Repro:** 1) Login OPERADOR emanuel.rojas@demo.com (pass Test1234!). POST /planillas {periodoInicio:'2029-03-21T00:00:00.000Z', periodoFin:'2029-03-23T00:00:00.000Z'}. 2) POST /planillas/:id/registros x3 (21: BASE 08-17 -> 8h normales; 22: CAMPO 06-18 maneja true horasViajeInput 3 -> 8+4, viaje 3; 23: BASE 08-12 -> 4h). 3) POST /planillas/:id/enviar. 4) Login maria.rodriguez@demo.com (RRHH) y POST /planillas/:id/avanzar -> APROBADA. 5) POST /planillas/:id/cerrar -> CERRADA. 6) Con el MISMO token RRHH: PATCH /planillas/:id/registros/<id del registro del 21>/compensatorio body {"activar":true}. 7) GET /planillas/:id y comparar planilla.totalHorasNormales contra la suma de registros[].horasNormales. 8) P
- **Evidencia:** PATCH -> HTTP 200 {"id":"9e5173ae-...","planillaId":"baaf30e3-3d95-4bea-b9cb-a3cc19ced885","esFrancoCompensatorio":true,"bloqueado":true,"entradaTurno1":null,"horasNormales":"0"}. GET /planillas/baaf30e3-... -> estado=CERRADA, planilla.totales={nor:20,e50:4,e100:0} pero suma de registros={nor:12,e50

### 🔴 CRITICA — POST /planillas/:id/avanzar no valida al aprobador cuando la planilla no tiene flujo: cualquier SUPERVISOR aprueba planillas de otro sector
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** SUPERVISOR
- **Esperado:** 403 — un supervisor ajeno al dueño (otro sector, sin relación jerárquica) no debe poder aprobar la planilla; si no hay flujo, debería exigirse al menos nivel RRHH y bloquearse la auto/ajena aprobación, como sí hace POST /vacaciones/:id/avanzar y POST /ausencias/:id/avanzar.
- **Obtenido:** 200 con la planilla en estado APROBADA y aprobadaPorId = el supervisor ajeno. Contradicción evidente: el mismo usuario recibe 403 al hacer GET de esa planilla pero 200 al aprobarla.
- **Repro:** 1) Login admin@wenlen.com (POST /auth/login {email, password:'Test1234!'}; DEBUG_AUTH acepta cualquier password). 2) Crear un operador SIN sector (así ninguna FlujoAsignacion aplica; equivale a cualquier operador de un sector sin asignación PLANILLA — al inicio de la corrida 'Logística y Transporte', 'CMASS' y 'Testing' estaban en esa situación):    POST /usuarios {"nombre":"SIM","apellido":"noflow","email":"sim-noflow-<ts>@demo.com","password":"Test1234!","rol":"OPERADOR","fechaIngreso":"2020-01-01T00:00:00.000Z"} → 201. 3) Login con ese usuario. POST /planillas {"periodoInicio":"2471-04-02T00:00:00.000Z","periodoFin":"2471-04-02T00:00:00.000Z"} → 201; verificar que la respuesta trae flujoI
- **Evidencia:** GET /planillas/86c5a2de-f0ad-4154-a583-f7eebf0a5b44 (token ricardo.vargas) → 403 {"error":"Sin permisos"} POST /planillas/86c5a2de-f0ad-4154-a583-f7eebf0a5b44/avanzar {"comentario":"sim-sup-aprobaciones-... sin flujo"} → 200 {"estado":"APROBADA","pasoActual":1,"aprobadaPorId":"476d3df6-f470-46f8-abf

### 🔴 CRITICA — Auto-aprobación: un SUPERVISOR aprueba su propia planilla cuando ésta no tiene flujo asignado
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** SUPERVISOR
- **Esperado:** 403 — nadie puede aprobar su propio documento (isResponsibleApprover() ya contempla `owner.id === approverId → false`, pero nunca se lo llama en esta rama); además, sin flujo debería exigirse nivel RRHH+.
- **Obtenido:** 200: la planilla propia queda APROBADA con aprobadaPorId igual al dueño. Un supervisor puede auto-aprobarse sus propias horas extra.
- **Repro:** 1) Login admin@wenlen.com. 2) POST /usuarios {"nombre":"SIM","apellido":"supnoflow","email":"sim-supnoflow-<ts>@demo.com","password":"Test1234!","rol":"SUPERVISOR","fechaIngreso":"2020-01-01T00:00:00.000Z"} (sin sectorId) → 201. 3) Login con ese SUPERVISOR (rolNivel 60). 4) POST /planillas {"periodoInicio":"2471-04-03T00:00:00.000Z","periodoFin":"2471-04-03T00:00:00.000Z"} → 201, flujoId: null. 5) POST /planillas/<pid>/registros {"fecha":"2471-04-03T00:00:00.000Z","entradaTurno1":"2471-04-03T08:00:00.000Z","salidaTurno1":"2471-04-03T17:00:00.000Z","lugarTrabajo":"BASE"} → 201. 6) POST /planillas/<pid>/enviar {} → 200 ENVIADA paso 1. 7) Con SU PROPIO token: POST /planillas/<pid>/avanzar {"com
- **Evidencia:** POST /planillas/bbc9abbf-8baa-452d-909b-d34efa9d6fda/avanzar {"comentario":"sim-sup-aprobaciones-... auto"} (token del propio dueño, rol SUPERVISOR nivel 60) → 200 {"estado":"APROBADA","aprobadaPorId":"e4ed2f64-76e6-4ec0-ae12-5ecaa3cea54e","usuarioId":"e4ed2f64-76e6-4ec0-ae12-5ecaa3cea54e"}

### 🟠 ALTA — PUT de un registro cambiando `fecha` a un día ya ocupado devuelve 500 en vez de 409
- **Endpoint:** `PUT /planillas/:id/registros/:rid` · **Rol:** OPERADOR
- **Esperado:** 409 con mensaje 'Ya existe un registro para esa fecha' (mismo contrato que POST /planillas/:id/registros).
- **Obtenido:** 500 Error interno. El frontend no puede distinguir un conflicto de un fallo del servidor.
- **Repro:** 1) POST /auth/login {email:'facundo.garcia@demo.com',password:'Test1234!'} → accessToken. 2) POST /planillas con body {} → 201, guardá id (período 2026-07-21..2026-08-20). 3) POST /planillas/{id}/registros {"fecha":"2026-07-21","entradaTurno1":"2026-07-21T08:00:00.000Z","salidaTurno1":"2026-07-21T17:00:00.000Z","lugarTrabajo":"BASE"} → 201, guardá rid1. 4) POST /planillas/{id}/registros {"fecha":"2026-07-22","entradaTurno1":"2026-07-22T06:00:00.000Z","salidaTurno1":"2026-07-22T18:00:00.000Z","lugarTrabajo":"CAMPO"} → 201. 5) PUT /planillas/{id}/registros/{rid1} {"fecha":"2026-07-22","entradaTurno1":"2026-07-22T08:00:00.000Z","salidaTurno1":"2026-07-22T12:00:00.000Z","lugarTrabajo":"BASE"} → 
- **Evidencia:** HTTP 500 {"error":"Error interno"}

### 🟠 ALTA — POST de registro con `fecha` no parseable devuelve 500 (el schema usa z.string() sin validar formato)
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** 400 'Datos inválidos' con details del campo fecha (igual que POST /planillas, que sí usa fechaFlexible y responde 400 ante 'not-a-date').
- **Obtenido:** 500 Error interno.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id. 3) POST /planillas/{id}/registros {"fecha":"ayer","lugarTrabajo":"BASE"} → observar el status. Causa: createRegistroSchema declara `fecha: z.string()` (planillas.routes.ts:51) mientras el resto del archivo usa `fechaFlexible`; zod deja pasar cualquier string, `new Date('ayer')` da Invalid Date y Prisma explota. Mismo efecto con "2026-13-45" o "".
- **Evidencia:** HTTP 500 {"error":"Error interno"}

### 🟠 ALTA — Se pueden cargar DOS registros para el mismo día calendario si `fecha` lleva otra hora; el día se cuenta doble en los totales
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** 409 'Ya existe un registro para esa fecha' — un día de la planilla debe tener un único registro; la fecha debería normalizarse a medianoche antes de guardar.
- **Obtenido:** 201. Quedan dos registros para el 22/07; totalDiasBase pasa a 3 habiendo sólo 2 días BASE distintos y las horas del día se suman dos veces.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id. 3) POST /planillas/{id}/registros {"fecha":"2026-07-22","entradaTurno1":"2026-07-22T06:00:00.000Z","salidaTurno1":"2026-07-22T18:00:00.000Z","lugarTrabajo":"CAMPO"} → 201. 4) Repetir la misma fecha exacta → 409 (correcto). 5) POST /planillas/{id}/registros {"fecha":"2026-07-22T12:00:00.000Z","entradaTurno1":"2026-07-22T08:00:00.000Z","salidaTurno1":"2026-07-22T16:00:00.000Z","lugarTrabajo":"BASE"} → 201. 6) GET /planillas/{id}: el 22/07 aparece dos veces en registros[] (una como CAMPO y otra como BASE) y los contadores de días suman las dos. El unique de la tabla es (planillaId, fecha) sobre el timestamp exacto, y
- **Evidencia:** HTTP 201 {"id":"4c0d52e6-...","fecha":"2026-07-22T12:00:00.000Z","lugarTrabajo":"BASE",...} y luego GET /planillas/:id → 2 registros con fecha 2026-07-22, totalDiasBase=3, totalDiasCampo=2, totalHorasNormales=28

### 🟠 ALTA — Se aceptan registros con fecha FUERA del período de la planilla y sus horas entran en los totales
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** 400 'La fecha está fuera del período de la planilla' (mismo criterio que marcar-dia).
- **Obtenido:** 201; el registro queda guardado y suma a los totales del mes equivocado.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id, periodoInicio 2026-07-21 / periodoFin 2026-08-20. 3) POST /planillas/{id}/registros {"fecha":"2026-06-11","entradaTurno1":"2026-06-11T08:00:00.000Z","salidaTurno1":"2026-06-11T20:00:00.000Z","lugarTrabajo":"BASE"} → 201. 4) GET /planillas/{id}: totalHorasNormales y totalHorasExtra50 incluyen las 11h del 11/06. No hay ninguna validación de rango en el handler (a diferencia de POST /planillas/:id/marcar-dia, que sí valida 'La fecha está fuera del período de la planilla'). Además el operador puede crear después la planilla del período de junio y cargar el mismo día ahí: el día queda liquidado dos veces y /analytics/u
- **Evidencia:** HTTP 201 {"id":"219d39d3-...","planillaId":"3e551c5b-...","fecha":"2026-06-11T00:00:00.000Z","horasTrabajadas":"11"...}; GET /planillas/:id → totalHorasNormales=28, totalHorasExtra50=7 en una planilla cuyo período es 2026-07-21..2026-08-20

### 🟠 ALTA — El operador se auto-otorga francos compensatorios por POST /registros salteando el control de saldo que sí aplica marcar-dia
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** Coherencia entre ambos caminos: declarar un franco compensatorio desde el registro debería validar saldo disponible y quedar sujeto a validación del superior, o directamente no ser un campo escribible por el operador (como el toggle PATCH /:id/registros/:rid/compensatorio, que es SUPERVISOR+).
- **Obtenido:** marcar-dia → 400 por saldo; POST /registros con esFrancoCompensatorio:true → 201 sin ningún control.
- **Repro:** Usuario con saldo de compensatorios en 0 (facundo.garcia@demo.com, VacacionSaldo 2026: acumulados 0 / usados 0 / pendientes 0). 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id. 3) Camino A: POST /planillas/{id}/marcar-dia {"fecha":"2026-07-30","tipo":"FRANCO_COMPENSATORIO","descripcion":"x"} → 400 'Saldo de compensatorios insuficiente. Disponible: 0 días'. 4) Camino B (mismo día, mismo hecho de negocio): POST /planillas/{id}/registros {"fecha":"2026-07-30","lugarTrabajo":"FRANCO","esFrancoCompensatorio":true} → 201, sin control de saldo y sin quedar PENDIENTE de validación de un superior. Lo mismo pasa con {"esFrancoTrabajado":true}, que es el que acredita compe
- **Evidencia:** marcar-dia: HTTP 400 {"error":"Saldo de compensatorios insuficiente. Disponible: 0 días"} | registros: HTTP 201 {"id":"f312cd04-...","fecha":"2026-07-30T00:00:00.000Z","lugarTrabajo":"FRANCO","esFrancoCompensatorio":true,...}

### 🟠 ALTA — El primer día del período (día 21) nunca se puede marcar a mano: 'fecha fuera del período' por desfase de huso horario
- **Endpoint:** `POST /planillas/:id/marcar-dia` · **Rol:** OPERADOR
- **Esperado:** 201 con el día marcado y bloqueado — el 21 es el primer día del período de la planilla.
- **Obtenido:** 400 'La fecha está fuera del período de la planilla'. El operador no tiene forma de marcar una falta/licencia el día 21 de ningún mes.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas con body {} (sin periodoInicio/periodoFin, que es como lo crea la app) → 201. La respuesta trae periodoInicio="2026-07-21T03:00:00.000Z" (getPeriodoActual usa `new Date(anio, mes, dia)` = medianoche LOCAL, servidor en UTC-3). 3) POST /planillas/{id}/marcar-dia {"fecha":"2026-07-21","tipo":"FALTA_JUSTIFICADA","descripcion":"x"} → observar. El handler hace `new Date('2026-07-21')` = 2026-07-21T00:00:00Z y compara contra periodoInicio 03:00Z, así que el día 21 siempre cae 'antes' del inicio. Afecta a todos los períodos creados sin fechas explícitas y a cualquier huso al oeste de UTC. El último día (20) no se ve afectado.
- **Evidencia:** HTTP 400 {"error":"La fecha está fuera del período de la planilla"} para fecha=2026-07-21 sobre una planilla con periodoInicio="2026-07-21T03:00:00.000Z" y periodoFin="2026-08-20T03:00:00.000Z"

### 🟠 ALTA — El motor no consulta el calendario de feriados: acepta esFeriado/esFrancoTrabajado del cliente y no aplica el feriado real
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** El feriado de empresa 2026-10-12 debe liquidarse al 100% (9h a extra100) aunque el cliente no mande el flag; y un día hábil común no debe poder liquidarse al 100% sólo porque el cliente manda esFeriado:true / esFrancoTrabajado:true (el servidor debería derivarlo del calendario y del diagrama).
- **Obtenido:** Feriado real 2026-10-12: horasNormales=8, extra50=1, extra100=0 (se paga como día común; se pierden 9h al 100%). Martes hábil 2026-10-13 con esFeriado:true: extra100=9, normales=0. Miércoles 2026-10-07 con esFrancoTrabajado:true: extra100=9. El operador se autoliquida el multiplicador.
- **Repro:** 1) POST /auth/login {email:'nicolas.sosa@demo.com',password:'Test1234!'}. 2) POST /planillas {periodoInicio:'2026-09-21T00:00:00.000Z',periodoFin:'2026-10-20T00:00:00.000Z'} -> guardar id. 3) Caso A (feriado real: 2026-10-12 está en config.feriadosPersonalizados): POST /planillas/<id>/registros {fecha:'2026-10-12T00:00:00.000Z',entradaTurno1:'2026-10-12T08:00:00.000Z',salidaTurno1:'2026-10-12T18:00:00.000Z',lugarTrabajo:'BASE'} SIN esFeriado. 4) Caso B (martes hábil): mismo payload con fecha 2026-10-13 y esFeriado:true. 5) Caso C: mismo payload en miércoles 2026-10-07 con esFrancoTrabajado:true. Observar horasNormales/horasExtra50/horasExtra100. calculo.utils.ts sólo mira input.esFeriado / i
- **Evidencia:** HTTP 201 {"fecha":"2026-10-12T00:00:00.000Z","esFeriado":false,"horasTrabajadas":"9","horasNormales":"8","horasExtra50":"1","horasExtra100":"0"} | HTTP 201 {"fecha":"2026-10-13T00:00:00.000Z","esFeriado":true,"horasTrabajadas":"9","horasNormales":"0","horasExtra50":"0","horasExtra100":"9"} | GET /ad

### 🟠 ALTA — Descuento de almuerzo escalonado: 8h exactas en BASE no descuentan nada y 8h15 pagan 45 min MENOS que 8h
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** Config vigente: descuento de almuerzo 60 min SOLO en BASE. 8h en BASE -> 7.00 netas (7 normales); 8h15 -> 7.25; la función debe ser monótona (trabajar más nunca puede pagar menos) y la diferencia BASE vs CAMPO con el mismo horario debe ser exactamente 1h.
- **Obtenido:** 8h exactas en BASE -> horasTrabajadas=8.00 y horasNormales=8.00 (no se descuenta almuerzo). 8h15 en BASE -> 7.25: 15 min más de presencia pagan 0.75h menos. CAMPO 08:00-16:00 también da 8.00, o sea la diferencia BASE/CAMPO es 0h en vez de 1h (con 10h sí da bien: BASE 9 vs CAMPO 10).
- **Repro:** Con la planilla del período 2026-09-21..2026-10-20 de nicolas.sosa: 1) POST /planillas/<id>/registros {fecha:'2026-09-21T00:00:00.000Z',entradaTurno1:'2026-09-21T08:00:00.000Z',salidaTurno1:'2026-09-21T16:00:00.000Z',lugarTrabajo:'BASE'} (8h exactas). 2) POST {fecha:'2026-09-22T00:00:00.000Z',entradaTurno1:'2026-09-22T08:00:00.000Z',salidaTurno1:'2026-09-22T16:15:00.000Z',lugarTrabajo:'BASE'} (8h15). 3) POST {fecha:'2026-09-25T00:00:00.000Z',entradaTurno1:'2026-09-25T08:00:00.000Z',salidaTurno1:'2026-09-25T16:00:00.000Z',lugarTrabajo:'CAMPO'} (mismo horario en CAMPO). Comparar horasTrabajadas. Causa: calculo.utils.ts línea 71 `if (totalMinutos > config.horasJornadaNormal * 60) totalMinutos -
- **Evidencia:** HTTP 201 {"fecha":"2026-09-21...","lugarTrabajo":"BASE","horasTrabajadas":"8","horasNormales":"8"} | HTTP 201 {"fecha":"2026-09-22...","lugarTrabajo":"BASE","horasTrabajadas":"7.25","horasNormales":"7.25"} | HTTP 201 {"fecha":"2026-09-25...","lugarTrabajo":"CAMPO","horasTrabajadas":"8"}

### 🟠 ALTA — maxHorasDiarias (16) no se aplica nunca: se aceptan y liquidan 20h en un solo día
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** Tope de 16h/día por configuración (o rechazo con 400): horasTrabajadas<=16 -> 8 normales + 4 al 50% + 4 al 100%.
- **Obtenido:** HTTP 201 con horasTrabajadas=20, horasNormales=8, extra50=4, extra100=8. Sin cap ni advertencia; el día suma 20h a los totales de la planilla.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-09-30T00:00:00.000Z',entradaTurno1:'2026-09-30T02:00:00.000Z',salidaTurno1:'2026-09-30T22:00:00.000Z',lugarTrabajo:'CAMPO'}. 3) GET /admin/config con admin@wenlen.com muestra maxHorasDiarias:16. El identificador maxHorasDiarias no aparece en ningún archivo de apps/api/src: no se lee ni en calculo.utils.ts ni en planillas.routes.ts.
- **Evidencia:** HTTP 201 {"fecha":"2026-09-30T00:00:00.000Z","lugarTrabajo":"CAMPO","horasTrabajadas":"20","horasNormales":"8","horasExtra50":"4","horasExtra100":"8"} — GET /admin/config: {"maxHorasDiarias":16,...}

### 🟠 ALTA — Un turno invertido por typo (10:00 -> 09:00) se interpreta como cruce de medianoche y liquida 23h
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (sebastian.diaz@demo.com)
- **Esperado:** 400 (salida anterior a la entrada dentro del mismo día) o, si se acepta como cruce de medianoche, respetar el tope diario. En ningún caso 23h liquidadas.
- **Obtenido:** HTTP 201 con horasTrabajadas=23, horasNormales=8, extra50=4, extra100=11: un error de tipeo de 1 hora se convierte en 23h pagas, 11 de ellas al 100%.
- **Repro:** 1) Login sebastian.diaz@demo.com. 2) Crear/usar planilla del período 2026-09-21..2026-10-20. 3) POST /planillas/<id>/registros {fecha:'2026-09-23T00:00:00.000Z',entradaTurno1:'2026-09-23T10:00:00.000Z',salidaTurno1:'2026-09-23T09:00:00.000Z',lugarTrabajo:'CAMPO'}. Causa: calculo.utils.ts `if (mins < 0) mins += 24*60` asume siempre cruce de medianoche, sin exigir que la salida sea del día siguiente ni chequear un máximo razonable.
- **Evidencia:** HTTP 201 → GET /planillas/<id>/registros: 2026-09-23 entrada=2026-09-23T10:00:00.000Z salida=2026-09-23T09:00:00.000Z CAMPO horasTrabajadas=23 (extra100=11)

### 🟠 ALTA — Deadlock: la planilla propia de un COORDINADOR (o del único SUPERVISOR del sector) nunca supera su propio paso — nadie salvo ADMIN puede destrabarla
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** COORDINADOR / SUPERVISOR (dueño del documento)
- **Esperado:** Que exista una salida para el documento propio de quien ocupa el rol del paso: escalar al siguiente paso, delegar al rol superior o al menos aparecer en /aprobaciones de RRHH.
- **Obtenido:** 403 para todos ('No tenés autorización para aprobar esta planilla en el paso de COORDINADOR'), incluido RRHH; la planilla tampoco aparece en planillasPendientes de nadie, así que queda invisible y bloqueada en EN_REVISION/pasoActual=2 indefinidamente. Sólo el ADMIN (escape hatch de approval-auth.utils.ts:41) la destraba.
- **Repro:** 1) Login juancarlos.herrera@demo.com (COORDINADOR, sector Cabezales; coordinadorId=null, supervisorId=null). POST /planillas {"periodoInicio":"2128-05-05T00:00:00.000Z","periodoFin":"2128-05-05T00:00:00.000Z"} → 201 con flujoId del flujo de sector 1:SUPERVISOR > 2:COORDINADOR > 3:RRHH. 2) POST /planillas/:id/registros (un día completo) y POST /planillas/:id/enviar → 200, pasoActual=1. 3) Login roberto.acosta@demo.com (SUPERVISOR de Cabezales) y POST /planillas/:id/avanzar → 200, pasoActual=2 (paso COORDINADOR). 4) Probar POST /planillas/:id/avanzar con los tokens de: juancarlos.herrera (dueño), martin.lopez@demo.com (COORDINADOR de Fractura), maria.rodriguez@demo.com (RRHH) y roberto.acosta 
- **Evidencia:** planilla 4e960b4f-473a-4a5b-af76-82715ce9ea9e (dueño juancarlos.herrera), tras el avance del supervisor: EN_REVISION paso 2. self: 403 {"error":"No tenés autorización para aprobar esta planilla en el paso de COORDINADOR"} coordOtroSector: 403 (mismo mensaje) | rrhh: 403 (mismo mensaje) | supervisor:

### 🟠 ALTA — PATCH compensatorio no valida saldo disponible ni es idempotente: cada llamada reserva otro compensatorio del mismo día
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR
- **Esperado:** 400 'Saldo de compensatorios insuficiente' cuando disponible (acumulados - usados - pendientes) < 1, igual que hace marcar-dia; y la segunda llamada sobre un día que ya es compensatorio debe ser no-op (no reservar un segundo día).
- **Obtenido:** 200 siempre. Sin saldo: compensatoriosPendientes pasa de 0 a 1 con acumulados=0 → disponible = -1. Repitiendo la llamada sobre el mismo registro el contador sigue subiendo (0→1→2) aunque se trate de un único día calendario.
- **Repro:** 1) Como RRHH (ana.martinez@demo.com) dejar el saldo de raul.carrizo en compensatoriosAcumulados=0, compensatoriosUsados=0: PUT /vacacion-saldos/{idSaldo2026} {compensatoriosAcumulados:0, compensatoriosUsados:0}. 2) Como raul: crear planilla de 1 día libre de 2026 y POST /planillas/{pid}/registros con horas normales. 3) Como alberto.ojeda@demo.com: PATCH /planillas/{pid}/registros/{rid}/compensatorio {"activar": true} → observar saldo. 4) Repetir EXACTAMENTE la misma llamada sobre el MISMO rid → observar saldo otra vez. Comparar con POST /planillas/:id/marcar-dia tipo FRANCO_COMPENSATORIO, que sí valida el disponible y devuelve 400 'Saldo de compensatorios insuficiente'.
- **Evidencia:** saldo raul antes: acum=0 pend=0 usados=0 PATCH compensatorio {activar:true} → 200 esFrancoCompensatorio=true bloqueado=true saldo raul después: acum=0 pend=1 usados=0 (acumulados=0 → disponible negativo) PATCH {activar:true} otra vez → 200; saldo: acum=0 pend=2 usados=0

### 🟠 ALTA — PATCH compensatorio no verifica jerarquía: cualquier SUPERVISOR de la empresa otorga/revoca francos a empleados de otro sector
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR
- **Esperado:** 403 'No autorizado' — ricardo no gestiona a raul (mismo control que POST /planillas/:id/marcar-dia y POST /planillas/:id/marcas/:ausenciaId/validar, que devuelven 403 para este par de usuarios).
- **Obtenido:** 200: el registro queda bloqueado con esFrancoCompensatorio=true, observaciones 'Franco compensatorio otorgado por Ricardo Vargas', y se toca el saldo de vacaciones de un empleado que no está a su cargo. Con {activar:false} también puede revocar francos ajenos.
- **Repro:** 1) Login ricardo.vargas@demo.com (SUPERVISOR del sector Almacén; no es supervisor ni coordinador de raul.carrizo, que es de Intendencia y depende de alberto.ojeda). 2) Como raul.carrizo@demo.com: crear planilla de 1 día y un registro con horas. 3) Como ricardo: PATCH /planillas/{pidDeRaul}/registros/{rid}/compensatorio {"activar": true}. El handler sólo aplica requireLevel(LEVEL_SUPERVISOR) y compara empresaId; nunca llama a canManageUser(), a diferencia de marcar-dia y de marcas/validar, que sí lo hacen y devuelven 403 en el mismo escenario.
- **Evidencia:** PATCH compensatorio {activar:true} por ricardo.vargas (SUPERVISOR Almacén) → 200 esFrancoCompensatorio=true bloqueado=true obs="Franco compensatorio otorgado por Ricardo Vargas" saldo raul: acum=0 pend=0 usados=0 → acum=0 pend=1 usados=0 (control: POST /planillas/{pid}/marcar-dia con el mismo token 

### 🟠 ALTA — PATCH compensatorio ignora el estado de la planilla: funciona sobre APROBADA y CERRADA y reserva saldo que nunca se libera
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR
- **Esperado:** 400 'No se puede modificar una planilla en estado APROBADA/CERRADA' (mismo criterio que marcar-dia, que devuelve 400 en ambos casos).
- **Obtenido:** 200 en ambos casos: se modifica una planilla ya aprobada/cerrada. Peor aún, el incremento va a compensatoriosPendientes, y la conversión pendientes→usados sólo ocurre dentro de POST /:id/avanzar al pasar a APROBADA; como la planilla ya está APROBADA/CERRADA ese paso no vuelve a correr, así que el día de saldo queda reservado para siempre.
- **Repro:** 1) Como raul.carrizo@demo.com: crear planilla de 1 día libre de 2026, cargar el registro con horas y POST /planillas/{pid}/enviar. 2) Como ana.martinez@demo.com (RRHH): POST /planillas/{pid}/avanzar → estado APROBADA. 3) Como alberto.ojeda@demo.com: PATCH /planillas/{pid}/registros/{rid}/compensatorio {"activar": true}. 4) Repetir con la planilla CERRADA: POST /planillas/{pid}/cerrar (ana) y volver a hacer el PATCH. Comparar con POST /planillas/:id/marcar-dia, que sí valida el estado (ESTADOS_MANAGER) y devuelve 400 sobre APROBADA/CERRADA.
- **Evidencia:** PATCH sobre APROBADA → 200; saldo acum=20 pend=8 usados=2 → acum=20 pend=9 usados=2 PATCH comp en CERRADA → 200 {"id":"6f154815-6e49-4ae0-bd09-7682db9cf94d",…,"esFrancoCompensatorio":true,"bloqueado":true,"motivoBloqueo":"FRANCO_COMPENSATORIO"} (control: POST /planillas/{pid}/marcar-dia sobre la mis

### 🟠 ALTA — PATCH compensatorio sobre un día ya marcado como FRANCO_COMPENSATORIO descuenta el saldo dos veces por el mismo día
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR
- **Esperado:** 409/400: el día ya está bloqueado por una marca manual de tipo FRANCO_COMPENSATORIO y su saldo ya fue descontado; no puede volver a descontarse.
- **Obtenido:** 200: el mismo día calendario consume 2 días de saldo (usados+1 por la marca y pendientes+1 por el PATCH). El disponible baja de 11 a 10 por un único franco. Además el PATCH pisa el motivoBloqueo/observaciones de la marca manual.
- **Repro:** 1) Como RRHH: dejar a raul.carrizo con compensatoriosAcumulados=5, usados=0 (PUT /vacacion-saldos/{idSaldo2026}). 2) Como raul: crear planilla de 1 día libre de 2026 (fecha F). 3) Como alberto.ojeda@demo.com: POST /planillas/{pid}/marcar-dia {fecha:F, tipo:'FRANCO_COMPENSATORIO'} → 201; la respuesta ES el registro del día (guardar body.id como rid). El saldo pasa a usados+1. 4) Como alberto: PATCH /planillas/{pid}/registros/{rid}/compensatorio {"activar": true} sobre ese mismo rid. marcar-dia sí rechaza el caso inverso (409 si el día ya tenía esFrancoCompensatorio), pero el PATCH no mira ni `bloqueado` ni `marcaManualId`.
- **Evidencia:** saldo acum=20 pend=7 usados=1 disp=12 → tras marcar-dia acum=20 pend=7 usados=2 disp=11 → tras PATCH(200) acum=20 pend=8 usados=2 disp=10

### 🟠 ALTA — Borrar la planilla no libera el compensatorio reservado por PATCH: el saldo queda descontado para siempre
- **Endpoint:** `DELETE /planillas/:id` · **Rol:** OPERADOR
- **Esperado:** Al borrar la planilla se devuelve el compensatorio reservado (pendientes vuelve al valor previo), igual que ocurre con las marcas manuales.
- **Obtenido:** 204 y el saldo queda descontado: compensatoriosPendientes no vuelve atrás. El empleado pierde un día de compensatorio sin ningún registro que lo respalde, y RRHH no puede corregirlo desde PUT /vacacion-saldos (no expone ese campo).
- **Repro:** 1) Como raul.carrizo@demo.com: crear planilla de 1 día libre de 2026 y POST /planillas/{pid}/registros con horas. 2) Anotar vacacion_saldos(raul, 2026).compensatoriosPendientes. 3) Como alberto.ojeda@demo.com: PATCH /planillas/{pid}/registros/{rid}/compensatorio {"activar": true} → pendientes +1. 4) Como raul (planilla en BORRADOR): DELETE /planillas/{pid} → 204. 5) Releer el saldo. limpiarMarcasManuales() (planillas.routes.ts) sólo recorre filas de Ausencia con cargaManual=true; el franco otorgado por PATCH vive únicamente en RegistroHoras.esFrancoCompensatorio, que se borra en cascada sin devolver el saldo. Contraste: el mismo flujo con POST /marcar-dia tipo FRANCO_COMPENSATORIO sí devuelv
- **Evidencia:** saldo acum=0 pend=0 usados=0 → tras PATCH acum=0 pend=1 usados=0 → tras DELETE /planillas/b1285b0c-c6e0-413b-9608-72930dc7c47c (204) acum=0 pend=1 usados=0 (comparación H1, con marca manual: saldo acum=20 pend=9 usados=2 → marca acum=20 pend=9 usados=3 → tras DELETE acum=20 pend=9 usados=2 ✔)

### 🟠 ALTA — marcar-dia no limpia esFrancoTrabajado: aprobar la planilla acumula un compensatorio por un día declarado FALTA_INJUSTIFICADA
- **Endpoint:** `POST /planillas/:id/marcar-dia` · **Rol:** SUPERVISOR
- **Esperado:** Un día marcado como ausencia no genera francos compensatorios: al marcarlo, esFrancoTrabajado debe quedar en false y compensatoriosAcumulados no debe moverse al aprobar.
- **Obtenido:** El bloque de /avanzar cuenta `registros.filter(r => r.esFrancoTrabajado)` e incrementa compensatoriosAcumulados: el empleado gana un día de franco compensatorio por una jornada que la empresa registró como falta injustificada con 0 horas.
- **Repro:** 1) Como raul.carrizo@demo.com: crear planilla de 1 día libre de 2026 (fecha F) y POST /planillas/{pid}/registros {fecha:F, lugarTrabajo:'CAMPO', entradaTurno1:'F T06:00:00.000Z', salidaTurno1:'F T18:00:00.000Z', esFrancoTrabajado:true} → 201, 12 h y esFrancoTrabajado=true. 2) Como alberto.ojeda@demo.com: POST /planillas/{pid}/marcar-dia {fecha:F, tipo:'FALTA_INJUSTIFICADA'} → 201. 3) Leer registros_horas del día: horas en 0 y bloqueado=true, PERO esFrancoTrabajado sigue en true (inyectarDiasBloqueados() en ausencia-calendar.utils.ts pone en cero las horas y lugarTrabajo pero no toca esFrancoTrabajado/esFeriado/pernocte/maneja). 4) Como raul: POST /planillas/{pid}/enviar. 5) Como ana.martinez
- **Evidencia:** marcar-dia → 201; registro: bloqueado=true motivo=FALTA_INJUSTIFICADA horas=0 esFrancoTrabajado=true aprobar → 200 estado=APROBADA; saldo acum=0 pend=1 usados=0 → acum=1 pend=1 usados=0 (2ª corrida, julio.ibanez: saldo acum=20 pend=0 usados=0 → acum=21 pend=0 usados=0)

### 🟠 ALTA — Cualquier SUPERVISOR de cualquier sector puede otorgar/revocar franco compensatorio en la planilla de cualquier empleado de la empresa
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR (nivel 60) ajeno al sector del empleado
- **Esperado:** 403: un supervisor sólo debería poder tocar planillas de empleados a su cargo / de su sector (mismo criterio que /avanzar y /marcar-dia).
- **Obtenido:** 200. Modifica el registro, escribe la observación 'Franco compensatorio otorgado por Lucas Fernández' e incrementa VacacionSaldo.compensatoriosPendientes del empleado ajeno. Escalada horizontal completa.
- **Repro:** 1) Tener una planilla de dario.paz@demo.com (sector Almacén, supervisor ricardo.vargas@demo.com); ej. id bce3e485-ce81-492f-a7eb-ed2e563139fa. 2) Login lucas.fernandez@demo.com (SUPERVISOR del sector Fractura, sin ninguna relación con dario). 3) GET /planillas/<id> con ese token -> 403 (no la puede ni ver). 4) Aun así: PATCH /planillas/<id>/registros/<rid>/compensatorio body {"activar":true} con el token de lucas. La ruta sólo aplica requireLevel(LEVEL_SUPERVISOR) + mismo empresaId; no usa isResponsibleApprover ni canManageUser.
- **Evidencia:** GET /planillas/bce3e485-... (token lucas) -> 403 {"error":"Sin permisos para ver esta planilla"}. PATCH /planillas/bce3e485-.../registros/920f6dd8-492e-46d2-9cc9-73568ddfaeba/compensatorio {"activar":true} (token lucas) -> HTTP 200 {"id":"920f6dd8-...","esFrancoCompensatorio":true,"bloqueado":true,"

### 🟠 ALTA — Los totales de la planilla no se recalculan cuando una ausencia aprobada anula un día ya cargado
- **Endpoint:** `POST /ausencias/:id/avanzar` · **Rol:** OPERADOR / SUPERVISOR / COORDINADOR / RRHH
- **Esperado:** Al anular las horas del día, la planilla debería recalcular sus totales (totalHorasNormales/Extra50/Extra100/Viaje, totalDiasCampo/Base) para que coincidan con la suma de sus registros.
- **Obtenido:** La planilla queda informando horas que ya no existen en ningún registro. Si el operador no vuelve a editar otro día, la envía a aprobación con totales inflados y el supervisor aprueba horas inexistentes.
- **Repro:** 1) Login eduardo.ruiz@demo.com. 2) POST /planillas {} → planilla del período 21/07-20/08. 3) POST /planillas/:id/registros {fecha:'2026-08-05T00:00:00.000Z', entradaTurno1:'2026-08-05T08:00:00.000Z', salidaTurno1:'2026-08-05T18:00:00.000Z', lugarTrabajo:'CAMPO', horasViajeInput:0} → 201 con horasNormales 8 y horasExtra50 2. 4) GET /planillas/:id → anotar totalHorasNormales/totalHorasExtra50. 5) POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-08-05', fechaFin:'2026-08-05', diasAusencia:1}. 6) Aprobar el flujo completo: POST /ausencias/:id/avanzar con roberto.acosta@demo.com, luego juancarlos.herrera@demo.com, luego ana.martinez@demo.com. 7) GET /planillas/:id/registros 
- **Evidencia:** HTTP 200 GET /planillas/2b2cf4c6.../registros → suma real de horasNormales+horasExtra50 de todos los registros = 8. HTTP 200 GET /planillas/2b2cf4c6... → {"totalHorasNormales":"16","totalHorasExtra50":"2"}. El registro del 2026-08-05 quedó en {"bloqueado":true,"motivoBloqueo":"FALTA_JUSTIFICADA","ho

### 🟠 ALTA — El primer día del período no se bloquea al aprobar una ausencia (desfase de zona horaria en periodoInicio)
- **Endpoint:** `POST /ausencias/:id/avanzar` · **Rol:** OPERADOR (dueño) + cadena de aprobación
- **Esperado:** Los dos días de la ausencia aprobada (21 y 22) quedan bloqueados en la planilla que los cubre.
- **Obtenido:** El día 21 (primer día del período) no tiene registro ni bloqueo: queda editable y computable como jornada trabajada pese a haber una ausencia aprobada. El 22 sí se bloquea. El comportamiento además es inconsistente con backfillAusenciasEnPlanilla, que sí crea ese día si la planilla se crea después de aprobar la ausencia.
- **Repro:** Servidor con TZ America/Buenos_Aires (UTC-3). 1) Login eduardo.ruiz@demo.com. 2) POST /planillas {} → GET /planillas/:id muestra periodoInicio '2026-07-21T03:00:00.000Z' (getPeriodoActual usa new Date(anio,mes,dia) en hora local). 3) POST /ausencias/solicitar {tipo:'CERTIFICADO_MEDICO', fechaInicio:'2026-07-21', fechaFin:'2026-07-22', diasAusencia:2, numeroCertificado:'X'}. 4) Aprobar los 3 pasos (roberto.acosta → juancarlos.herrera → ana.martinez). 5) GET /planillas/:id/registros. En inyectarDiasBloqueados el día se normaliza a medianoche UTC (2026-07-21T00:00:00.000Z) y el filtro `day >= p.periodoInicio` lo descarta porque periodoInicio es 03:00Z.
- **Evidencia:** HTTP 200 GET /planillas/2b2cf4c6.../registros → no existe ningún registro con fecha '2026-07-21T00:00:00.000Z'; el del '2026-07-22T00:00:00.000Z' figura {"bloqueado":true,"motivoBloqueo":"CERTIFICADO_MEDICO"}. GET /planillas/:id → {"periodoInicio":"2026-07-21T03:00:00.000Z","periodoFin":"2026-08-20T

### 🟡 MEDIA — maxHorasDiarias (16) está en la config pero no se aplica: se acepta un día con 48 horas
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** 400 rechazando el registro (o tope) por superar maxHorasDiarias=16, que es un parámetro configurable de la empresa y hoy es puramente decorativo.
- **Obtenido:** 201 con horasTrabajadas=48, horasExtra100=36.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id. 3) POST /planillas/{id}/registros {"fecha":"2026-07-28","entradaTurno1":"2026-07-28T00:00:00.000Z","salidaTurno1":"2026-07-30T00:00:00.000Z","lugarTrabajo":"CAMPO"} → 201 con horasTrabajadas=48. 4) GET /planillas/{id} → esas 48h (36 al 100%) quedan en los totales que después se liquidan. EmpresaConfig.maxHorasDiarias=16 no tiene ningún uso en apps/api/src (grep = 0 coincidencias); calcularHorasRegistro tampoco topea el resultado.
- **Evidencia:** HTTP 201 {"fecha":"2026-07-28T00:00:00.000Z","horasTrabajadas":"48","horasNormales":"8","horasExtra50":"4","horasExtra100":"36"}

### 🟡 MEDIA — Una salida anterior a la entrada dentro del mismo día se computa como turno que cruza medianoche y paga 15h
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR
- **Esperado:** 400 (salida anterior a entrada dentro del mismo día) o, como mínimo, algún tope; el cruce de medianoche legítimo se indica con la fecha del día siguiente.
- **Obtenido:** 201 con horasTrabajadas=15 (16h menos 1h de almuerzo): 8 normales + 4 al 50% + 3 al 100% de un típico dedo pegado.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) POST /planillas {} → 201, id. 3) POST /planillas/{id}/registros {"fecha":"2026-07-27","entradaTurno1":"2026-07-27T17:00:00.000Z","salidaTurno1":"2026-07-27T09:00:00.000Z","lugarTrabajo":"BASE"} → 201 con horasTrabajadas=15. En calculo.utils.ts:52 `if (mins < 0) mins += 24*60`. El turno nocturno real ya se expresa correctamente poniendo la fecha del día siguiente en salidaTurno1 (verificado: 22:00 → 06:00 del día siguiente da 8h), así que la rama negativa sólo convierte errores de tipeo en 16h de jornada.
- **Evidencia:** HTTP 201 {"fecha":"2026-07-27T00:00:00.000Z","entradaTurno1":"2026-07-27T17:00:00.000Z","salidaTurno1":"2026-07-27T09:00:00.000Z","horasTrabajadas":"15"}

### 🟡 MEDIA — GET /planillas rompe con 500 ante query params inválidos (estado y periodoInicio no se validan)
- **Endpoint:** `GET /planillas` · **Rol:** OPERADOR
- **Esperado:** 400 'Datos inválidos' (o ignorar el filtro), nunca 500.
- **Obtenido:** 500 Error interno en ambos casos.
- **Repro:** 1) Login facundo.garcia@demo.com / Test1234!. 2) GET /planillas?estado=INVENTADO → 500. 3) GET /planillas?periodoInicio=no-es-fecha → 500. En planillas.routes.ts:99-111 el string de `estado` se pasa directo al where de Prisma como enum y `new Date(periodoInicio)` puede dar Invalid Date; ninguno se valida. Cualquier link o filtro guardado con un estado viejo/mal escrito tumba el listado completo del usuario.
- **Evidencia:** GET /planillas?estado=INVENTADO → HTTP 500 {"error":"Error interno"} | GET /planillas?periodoInicio=no-es-fecha → HTTP 500 {"error":"Error interno"}

### 🟡 MEDIA — El operador puede borrar una planilla RECHAZADA que ya pasó por aprobadores y se lleva puesto todo el historial de aprobación
- **Endpoint:** `DELETE /planillas/:id` · **Rol:** OPERADOR
- **Esperado:** Coherencia con el guard de ENVIADA: si existe historial con EN_REVISION/APROBADA, no permitir el borrado (400) — o borrado lógico conservando el historial.
- **Obtenido:** 204: se elimina la planilla y en cascada las 6 entradas de PlanillaHistorial, incluidos los dos rechazos y el paso de aprobación del supervisor.
- **Repro:** 1) facundo.garcia@demo.com completa y envía su planilla del período vigente (POST /planillas {}, cargar todos los días, POST /planillas/{id}/enviar). 2) lucas.fernandez@demo.com: POST /planillas/{id}/avanzar {"comentario":"ok"} → 200 EN_REVISION, pasoActual 2. 3) facundo: DELETE /planillas/{id} → 400 'No se puede eliminar esta planilla porque está en proceso de aprobación...' (correcto). 4) martin.lopez@demo.com: POST /planillas/{id}/rechazar {"motivo":"corregir"} → 200 RECHAZADA. 5) GET /planillas/{id}/historial → BORRADOR > ENVIADA > RECHAZADA > ENVIADA > EN_REVISION > RECHAZADA. 6) facundo: DELETE /planillas/{id} → 204. GET /planillas/{id} → 404 y el historial se borró (PlanillaHistorial.
- **Evidencia:** DELETE /planillas/{id} → HTTP 204 (cuerpo vacío) sobre una planilla en RECHAZADA cuyo GET /planillas/:id/historial devolvía 6 entradas [BORRADOR, ENVIADA, RECHAZADA, ENVIADA, EN_REVISION, RECHAZADA]; GET posterior → 404 {"error":"Planilla no encontrada"}

### 🟡 MEDIA — 500 'Error interno' ante fecha u hora inválidas en el alta de registro (debería ser 400)
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (sebastian.diaz@demo.com)
- **Esperado:** 400 'Datos inválidos' con el detalle del campo, como sí ocurre con horasViajeInput negativo u observaciones de más de 500 chars.
- **Obtenido:** HTTP 500 {"error":"Error interno"} en ambos casos (no filtra stack, pero el status es incorrecto y no dice qué campo está mal).
- **Repro:** 1) Login sebastian.diaz@demo.com. 2) POST /planillas/<id>/registros {fecha:'no-es-una-fecha',lugarTrabajo:'BASE'} -> 500. 3) POST /planillas/<id>/registros {fecha:'2026-09-22T00:00:00.000Z',entradaTurno1:'banana',salidaTurno1:'2026-09-22T18:00:00.000Z',lugarTrabajo:'BASE'} -> 500. Causa: el schema usa z.string() puro y el handler hace new Date(str) sin validar; el Invalid Date llega a Prisma y, en el caso de las horas, produce NaN -> new Decimal('NaN').
- **Evidencia:** POST {fecha:'no-es-una-fecha'} → 500 {"error":"Error interno"} | POST {entradaTurno1:'banana'} → 500 {"error":"Error interno"} | contraste: POST {horasViajeInput:-5} → 400 {"error":"Datos inválidos","details":{"fieldErrors":{"horasViajeInput":["Number must be greater than or equal to 0"]}}}

### 🟡 MEDIA — Turnos superpuestos se suman dos veces: 08:00-18:00 + 09:00-19:00 liquida 20h (reales 11h)
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (sebastian.diaz@demo.com)
- **Esperado:** 400 (turnos superpuestos) o, como máximo, 11h (de 08:00 a 19:00).
- **Obtenido:** HTTP 201 con horasTrabajadas=20 (10h + 10h): 8 normales + 4 al 50% + 8 al 100%.
- **Repro:** 1) Login sebastian.diaz@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-09-24T00:00:00.000Z',entradaTurno1:'2026-09-24T08:00:00.000Z',salidaTurno1:'2026-09-24T18:00:00.000Z',entradaTurno2:'2026-09-24T09:00:00.000Z',salidaTurno2:'2026-09-24T19:00:00.000Z',lugarTrabajo:'CAMPO'}. calcularHorasRegistro suma los dos turnos sin verificar solapamiento ni que el turno 2 empiece después de terminar el turno 1.
- **Evidencia:** GET /planillas/<id>/registros: 2026-09-24 T1=08:00→18:00 T2=09:00→19:00 CAMPO horasTrabajadas=20

### 🟡 MEDIA — Turno partido: se descuenta una hora de almuerzo adicional sobre un corte que ya excluye el almuerzo
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** 9h trabajadas -> 8 normales + 1 al 50% (el almuerzo ya está descontado por el propio corte entre turnos).
- **Obtenido:** horasTrabajadas=8, horasNormales=8, extra50=0: se descuentan otros 60 min y el operador pierde la única hora al 50% del día.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-10-02T00:00:00.000Z',entradaTurno1:'2026-10-02T08:00:00.000Z',salidaTurno1:'2026-10-02T12:00:00.000Z',entradaTurno2:'2026-10-02T14:00:00.000Z',salidaTurno2:'2026-10-02T19:00:00.000Z',lugarTrabajo:'BASE'}. El corte 12:00-14:00 ya queda fuera de los turnos: son 9h efectivas.
- **Evidencia:** HTTP 201 {"fecha":"2026-10-02T00:00:00.000Z","entradaTurno1":"...T08:00:00.000Z","salidaTurno1":"...T12:00:00.000Z","entradaTurno2":"...T14:00:00.000Z","salidaTurno2":"...T19:00:00.000Z","lugarTrabajo":"BASE","horasTrabajadas":"8","horasNormales":"8","horasExtra50":"0"}

### 🟡 MEDIA — Las horas de viaje del acompañante se pierden: horasViajeCalc=0 cuando maneja=false, pese a existir tarifaViajeSinManejar
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** horasViajeInput=3 declarado en CAMPO debe reflejarse en horasViajeCalc y en totalHorasViaje independientemente de quién maneja; la distinción maneja/no maneja es de tarifa, no de existencia de las horas.
- **Obtenido:** maneja=false -> horasViajeCalc=0; horasViajeInput=3 queda guardado pero no suma a totalHorasViaje. Las horas de viaje del acompañante desaparecen de todos los totales.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-09-28T00:00:00.000Z',entradaTurno1:'2026-09-28T08:00:00.000Z',salidaTurno1:'2026-09-28T18:00:00.000Z',lugarTrabajo:'CAMPO',maneja:true,horasViajeInput:3} -> horasViajeCalc=3. 3) Idem con fecha 2026-09-29 y maneja:false, horasViajeInput:3 -> horasViajeCalc=0. 4) GET /admin/config (admin@wenlen.com) expone tarifaViajeManeja y tarifaViajeSinManejar, o sea el modelo contempla pagar el viaje del que no maneja. Causa: calculo.utils.ts `if (lugar === 'CAMPO' && input.maneja && input.horasViajeInput > 0)`.
- **Evidencia:** HTTP 201 {"fecha":"2026-09-29T00:00:00.000Z","lugarTrabajo":"CAMPO","maneja":false,"horasViajeInput":"3","horasViajeCalc":"0"} vs {"fecha":"2026-09-28...","maneja":true,"horasViajeInput":"3","horasViajeCalc":"3"}; planilla totalHorasViaje=3 (sólo el día que maneja)

### 🟡 MEDIA — descuentoAlmuerzoMinutos es configurable pero el motor tiene 60 minutos hardcodeados
- **Endpoint:** `PUT /admin/config + POST /planillas/:id/registros` · **Rol:** ADMIN (admin@wenlen.com) + OPERADOR (sebastian.diaz@demo.com)
- **Esperado:** Con almuerzo de 30 min, una jornada BASE de 10h -> horasTrabajadas=9.5.
- **Obtenido:** horasTrabajadas=9 (sigue descontando 60 min): el parámetro de configuración no tiene ningún efecto sobre el cálculo. La config quedó restaurada en 60 al terminar (verificado por GET).
- **Repro:** 1) Login admin@wenlen.com; GET /admin/config -> descuentoAlmuerzoMinutos=60 (anotar el valor). 2) PUT /admin/config {descuentoAlmuerzoMinutos:30} -> 200; GET confirma 30. 3) Login sebastian.diaz@demo.com; POST /planillas/<id>/registros {fecha:'2026-10-19T00:00:00.000Z',entradaTurno1:'2026-10-19T08:00:00.000Z',salidaTurno1:'2026-10-19T18:00:00.000Z',lugarTrabajo:'BASE'}. 4) Restaurar con PUT /admin/config {descuentoAlmuerzoMinutos:60}. Causa: calculo.utils.ts hace `totalMinutos -= 60` fijo y la interfaz EmpresaConfigCalc ni siquiera incluye descuentoAlmuerzoMinutos.
- **Evidencia:** PUT /admin/config {descuentoAlmuerzoMinutos:30} → 200; GET → descuentoAlmuerzoMinutos=30; POST registro BASE 08:00-18:00 → 201 horasTrabajadas="9" (esperado 9.5); PUT restore → 200; GET final → descuentoAlmuerzoMinutos=60

### 🟡 MEDIA — El operador puede autodeclarar esFrancoCompensatorio y el día computa igual 8h normales, sin bloqueo ni control de saldo
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** Un franco compensatorio es día de descanso: horas en 0 y día bloqueado; y su alta debería quedar reservada al aprobador o al menos validar que haya saldo de compensatorios.
- **Obtenido:** HTTP 201: el día queda marcado como compensatorio Y con 8 horas normales liquidadas, sin bloqueo. Además, al aprobar (POST /planillas/:id/avanzar) el código cuenta esos registros como compensatoriosUsados y hace `compensatoriosPendientes: {decrement}` sin que nadie los haya incrementado, con lo que el saldo puede quedar negativo (ruta verificada por lectura de código; no la ejecuté para no meter la planilla en el flujo de aprobación).
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-10-08T00:00:00.000Z',entradaTurno1:'2026-10-08T08:00:00.000Z',salidaTurno1:'2026-10-08T16:00:00.000Z',lugarTrabajo:'BASE',esFrancoCompensatorio:true}. 3) GET /planillas/<id>/registros y mirar ese día: esFrancoCompensatorio=true, bloqueado=false, horasNormales=8. Contrastar con PATCH /planillas/:id/registros/:rid/compensatorio (supervisor), que sí pone las horas en 0, bloqueado=true e incrementa compensatoriosPendientes.
- **Evidencia:** HTTP 201 {"fecha":"2026-10-08T00:00:00.000Z","lugarTrabajo":"BASE","esFrancoCompensatorio":true,"bloqueado":false,"horasTrabajadas":"8","horasNormales":"8"}

### 🟡 MEDIA — PUT parcial de un registro borra las horas cargadas y resetea horasViajeInput a 2 y lugarTrabajo a null
- **Endpoint:** `PUT /planillas/:id/registros/:rid` · **Rol:** OPERADOR (sebastian.diaz@demo.com)
- **Esperado:** O 400 exigiendo el objeto completo, o merge de los campos enviados conservando los turnos existentes (el schema todo-opcional sugiere semántica de PATCH).
- **Obtenido:** HTTP 200 con entradaTurno1=null, salidaTurno1=null, horasTrabajadas=0, maneja=false y horasViajeInput reseteado al default 2. Un PUT parcial destruye el día cargado en silencio y recalcula los totales a la baja.
- **Repro:** 1) Login sebastian.diaz@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-09-30T00:00:00.000Z',entradaTurno1:'2026-09-30T08:00:00.000Z',salidaTurno1:'2026-09-30T18:00:00.000Z',lugarTrabajo:'CAMPO',maneja:true,horasViajeInput:4} -> horasTrabajadas=10, horasViajeCalc=4. 3) PUT /planillas/<id>/registros/<rid> {lugarTrabajo:'CAMPO',observaciones:'x'} (el schema acepta todos los campos como opcionales). 4) Mirar la respuesta y los totales de la planilla.
- **Evidencia:** PUT → 200 {"horasTrabajadas":"0","horasViajeInput":"2","entradaTurno1":null} (antes del PUT: horasTrabajadas=10, horasViajeInput=4)

### 🟡 MEDIA — Sábado y domingo se liquidan como días normales: no existe ninguna lógica de fin de semana en el motor
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** Fin de semana trabajado al 100% (9h a extra100) o, como mínimo, que el servidor derive el carácter de franco desde el diagrama del usuario en vez de depender de un flag del cliente.
- **Obtenido:** Sábado y domingo: horasNormales=8, extra50=1, extra100=0, idéntico a un miércoles. Ningún campo de la respuesta señala que el día fue fin de semana.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-09-26T00:00:00.000Z',entradaTurno1:'2026-09-26T08:00:00.000Z',salidaTurno1:'2026-09-26T18:00:00.000Z',lugarTrabajo:'BASE'} (2026-09-26 es sábado). 3) Idem con fecha 2026-09-27 (domingo). calcularHorasRegistro no mira el día de la semana en ningún momento: sólo esFeriado/esFrancoTrabajado provistos por el cliente.
- **Evidencia:** HTTP 201 {"fecha":"2026-09-26T00:00:00.000Z" (Sab),"horasTrabajadas":"9","horasNormales":"8","horasExtra50":"1","horasExtra100":"0"} | idéntico para 2026-09-27 (Dom)

### 🟡 MEDIA — Quitar la marca borra el registro completo del día: se pierden las horas del operador y una planilla ENVIADA se aprueba vacía
- **Endpoint:** `DELETE /planillas/:id/marcas/:ausenciaId` · **Rol:** SUPERVISOR
- **Esperado:** Deshacer la marca no debería destruir las horas que el operador ya había cargado (o, como mínimo, dejar el día recuperable); y una planilla sin ningún registro no debería poder aprobarse, ya que /enviar exige que todos los días estén completos.
- **Obtenido:** La planilla queda con 0 registros y 0 horas; el operador NO puede recargar el día porque la planilla está ENVIADA (400 'Solo se pueden agregar registros en BORRADOR o RECHAZADA'), y RRHH la aprueba igual con totalHorasNormales=0. Un día de campo de 12 h desaparece sin traza para el empleado.
- **Repro:** 1) Como raul.carrizo@demo.com: crear planilla de 1 día libre de 2026 (fecha F), POST /planillas/{pid}/registros {fecha:F, lugarTrabajo:'CAMPO', entradaTurno1:'F T06:00:00.000Z', salidaTurno1:'F T18:00:00.000Z'} (12 h, 8 normales + 4 al 50%) y POST /planillas/{pid}/enviar → ENVIADA con totalHorasNormales=8. 2) Como alberto.ojeda@demo.com: POST /planillas/{pid}/marcar-dia {fecha:F, tipo:'FALTA_JUSTIFICADA'} (marca por error) → 201; inyectarDiasBloqueados pisa el registro y pone las horas en 0. 3) Como alberto, arrepentido: DELETE /planillas/{pid}/marcas/{ausenciaId} {motivo:'me equivoqué'} → 200 RECHAZADA; el handler hace registroHoras.deleteMany({planillaId, marcaManualId}) y el día desaparec
- **Evidencia:** registro operador: horas=12 extra50=4 enviar → 200 estado=ENVIADA totalHorasNormales=8 marcar-dia (alberto, planilla ENVIADA) → 201 marca=APROBADA DELETE marca (alberto) → 200 estado=RECHAZADA registros que quedan en la planilla: 0 el operador intenta re-cargar el día → 400 {"error":"Solo se pueden 

### 🟡 MEDIA — El supervisor puede marcar/validar/rechazar días en una planilla que no tiene permiso para leer (GET devuelve 403)
- **Endpoint:** `GET /planillas/:id vs POST /planillas/:id/marcar-dia` · **Rol:** SUPERVISOR
- **Esperado:** Coherencia entre lectura y escritura: quien puede modificar los días de una planilla tiene que poder abrirla. La UI de marcado vive dentro de la vista de la planilla, que para este supervisor responde 403.
- **Obtenido:** El permiso de escritura es más amplio que el de lectura: alberto modifica a ciegas una planilla que la API le niega. Afecta a todos los sectores cuyo flujo de PLANILLA no incluya el paso SUPERVISOR (Intendencia, Almacén, Administración, Wireline en la DB actual).
- **Repro:** 1) Como raul.carrizo@demo.com (OPERADOR de Intendencia, supervisorId = alberto.ojeda): POST /planillas {periodoInicio, periodoFin} de 1 día libre. 2) Como alberto.ojeda@demo.com (su supervisor directo): GET /planillas/{pid} → 403; GET /planillas/{pid}/registros → 403; GET /planillas no lista la planilla del subordinado. 3) Como alberto, sobre esa MISMA planilla: POST /planillas/{pid}/marcar-dia {fecha, tipo:'FALTA_JUSTIFICADA'} → 201, y también funcionan POST /marcas/:id/validar, POST /marcas/validar-todo, DELETE /marcas/:id y PATCH /registros/:rid/compensatorio. Causa: la lectura usa getFlowVisibleUserIds() (basada en el flujo de aprobación; el flujo PLANILLA del sector Intendencia es 'RRHH
- **Evidencia:** GET /planillas/95139938-26b2-4dd6-86d9-fae51158eb16 (alberto) → 403 {"error":"Sin permisos para ver esta planilla"} GET /planillas/95139938-26b2-4dd6-86d9-fae51158eb16/registros (alberto) → 403 {"error":"Sin permisos"} POST /planillas/95139938-26b2-4dd6-86d9-fae51158eb16/marcar-dia (alberto) → 201 {

### 🟡 MEDIA — Revocar el franco compensatorio no restaura las horas ni los horarios borrados: pérdida de datos irreversible
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio` · **Rol:** SUPERVISOR+ / RRHH
- **Esperado:** Deshacer debería devolver el día a su estado anterior (o al menos avisar que los horarios se pierden y permitir recargarlos si la planilla ya no es editable).
- **Obtenido:** El registro queda con entrada/salida en null y 0 horas, pero ya NO bloqueado y sin franco compensatorio: un día 'fantasma' de 0h que nadie puede corregir si la planilla está APROBADA/CERRADA (POST/PUT de registros exigen BORRADOR o RECHAZADA). En el Excel aparece una fila vacía con la observación de la revocación.
- **Repro:** 1) Tomar un registro con jornada cargada (ej. BASE 08:00-12:00 + 14:00-18:00 = 8h). 2) PATCH /planillas/:id/registros/:rid/compensatorio {"activar":true} -> el handler pone entradaTurno1/salidaTurno1/entradaTurno2/salidaTurno2 = null y todas las horas en 0. 3) PATCH .../compensatorio {"activar":false} para deshacer. 4) GET /planillas/:id/registros y mirar ese registro.
- **Evidencia:** PATCH activar:true -> 200 {"entradaTurno1":null,"salidaTurno1":null,"horasNormales":"0",...}. PATCH activar:false -> 200 {"esFrancoCompensatorio":false,"bloqueado":false,"observaciones":"Franco compensatorio revocado por Lucas Fernández"} con las horas todavía en 0. GET /planillas/bce3e485-.../regis

### 🟡 MEDIA — descuentoAlmuerzoMinutos es configurable y se persiste, pero el cálculo de horas siempre descuenta 60 minutos fijos
- **Endpoint:** `PUT /admin/config + POST /planillas/:id/registros` · **Rol:** ADMIN (configura) / OPERADOR (sufre el cálculo)
- **Esperado:** horasTrabajadas = 9.5 (10h menos 30min), respetando el valor configurado.
- **Obtenido:** horasTrabajadas = 9, es decir que descontó 60 minutos. En src/utils/calculo.utils.ts el descuento está hardcodeado (totalMinutos -= 60) y el campo descuentoAlmuerzoMinutos no se lee en ningún punto del código: un grep sobre src/ sólo lo encuentra en el schema Zod de admin.config.routes.ts. Es una opción de configuración que el admin puede cambiar y que no tiene ningún efecto.
- **Repro:** 1) Login admin@wenlen.com (Test1234!); guardar el valor original con GET /admin/config (hoy descuentoAlmuerzoMinutos=60). 2) PUT /admin/config {"descuentoAlmuerzoMinutos":30} → 200 y el body devuelve 30, o sea que se persiste. 3) Con un operador: POST /planillas {"periodoInicio":"2024-01-21T00:00:00.000Z","periodoFin":"2024-02-20T00:00:00.000Z"} y luego POST /planillas/<pid>/registros {"fecha":"2024-01-24T00:00:00.000Z","entradaTurno1":"2024-01-24T06:00:00.000Z","salidaTurno1":"2024-01-24T16:00:00.000Z","lugarTrabajo":"BASE"} (10 horas brutas; en BASE se aplica el descuento de almuerzo). 4) Mirar horasTrabajadas en la respuesta. 5) RESTAURAR: PUT /admin/config {"descuentoAlmuerzoMinutos":60}
- **Evidencia:** PUT /admin/config {"descuentoAlmuerzoMinutos":30} → HTTP 200 con "descuentoAlmuerzoMinutos":30. POST /planillas/<pid>/registros (06:00Z→16:00Z, BASE) → HTTP 201 {"horasTrabajadas":"9","horasNormales":"8","horasExtra50":"1"}. Salida del script: '· descuentoAlmuerzoMinutos=30, 10h en BASE → horasTraba

### 🟡 MEDIA — GET /planillas devuelve 0 planillas al GERENTE (el rol no figura en ningún flujo) mientras RRHH ve 61
- **Endpoint:** `GET /planillas` · **Rol:** GERENTE (laura.gonzalez@demo.com)
- **Esperado:** Un rol de nivel 80 debería tener alguna visibilidad de planillas (transversal, por sector o al menos un mensaje claro). El nav le muestra 'Planillas' y 'Aprobaciones'.
- **Obtenido:** 200 [] — la pantalla Planillas aparece vacía y /aprobaciones devuelve todos los buckets en 0, sin distinguir 'no tenés permiso' de 'no hay nada pendiente'.
- **Repro:** 1) Login laura.gonzalez@demo.com → GET /planillas → 200 []. 2) Login maria.rodriguez@demo.com → GET /planillas → 200 con 61 elementos. En planillas.routes.ts GET / con nivel 60–89 se resuelve por getFlowVisibleUserIds(...,'PLANILLA'); como ningún FlujoAprobacion tiene un paso con rolAprobador='GERENTE', matchingAssignments queda vacío y la función retorna [userId]. Laura no tiene planillas propias → lista vacía. Lo mismo aplica a /aprobaciones (planillas/vacaciones/ausencias/compensatorios pendientes = 0).
- **Evidencia:** GET /planillas laura → 200, 0 elementos; maria (RRHH) → 200, 61 elementos. GET /aprobaciones laura → 200 {"p":0,"v":0,"a":0,"c":0}

### ⚪ BAJA — El redondeo de 15 min se aplica a la duración total y no a cada marca: 1 minuto de diferencia en la entrada mueve el pago 15 min
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** Criterio de redondeo estable: lo habitual es redondear cada marca al cuarto de hora (08:07 y 08:08 -> ambas a 08:00 o ambas a 08:15, mismo resultado los dos días).
- **Obtenido:** 533 min -> 540 (9h) -> menos almuerzo = 8.00h; 532 min -> 525 (8.75h) -> menos almuerzo = 7.75h. Un minuto de diferencia en la entrada mueve el pago 0.25h y en el primer caso se pagan 7 minutos no trabajados.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-10-05T00:00:00.000Z',entradaTurno1:'2026-10-05T08:07:00.000Z',salidaTurno1:'2026-10-05T17:00:00.000Z',lugarTrabajo:'BASE'} (533 min). 3) POST {fecha:'2026-10-06T00:00:00.000Z',entradaTurno1:'2026-10-06T08:08:00.000Z',salidaTurno1:'2026-10-06T17:00:00.000Z',lugarTrabajo:'BASE'} (532 min).
- **Evidencia:** HTTP 201 {"entradaTurno1":"2026-10-05T08:07:00.000Z","horasTrabajadas":"8","horasNormales":"8"} | HTTP 201 {"entradaTurno1":"2026-10-06T08:08:00.000Z","horasTrabajadas":"7.75","horasNormales":"7.75"}

### ⚪ BAJA — El campo cruzaMedianoche nunca se escribe: queda false incluso en un turno 19:00 -> 07:00
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (nicolas.sosa@demo.com)
- **Esperado:** cruzaMedianoche=true (el cálculo efectivamente aplicó la corrección de +24h) o eliminar el campo del contrato.
- **Obtenido:** cruzaMedianoche=false. El total de 12h es correcto, pero el registro miente sobre el cruce de día; cualquier consumidor (export/liquidación) que se apoye en ese flag lo va a leer mal.
- **Repro:** 1) Login nicolas.sosa@demo.com. 2) POST /planillas/<id>/registros {fecha:'2026-10-01T00:00:00.000Z',entradaTurno1:'2026-10-01T19:00:00.000Z',salidaTurno1:'2026-10-01T07:00:00.000Z',lugarTrabajo:'CAMPO'}. 3) GET /planillas/<id>/registros y mirar cruzaMedianoche. El identificador cruzaMedianoche no aparece en ningún archivo de apps/api/src ni de apps/web/src: el campo del modelo nunca se setea ni se usa.
- **Evidencia:** HTTP 201 {"fecha":"2026-10-01T00:00:00.000Z","entradaTurno1":"2026-10-01T19:00:00.000Z","salidaTurno1":"2026-10-01T07:00:00.000Z","cruzaMedianoche":false,"horasTrabajadas":"12","horasNormales":"8","horasExtra50":"4"}

### ⚪ BAJA — /avanzar evalúa el gating de marcas antes que la autorización del aprobador: un no-aprobador recibe 400 con detalle en vez de 403
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** SUPERVISOR
- **Esperado:** 403 'No tenés autorización para aprobar esta planilla en el paso de RRHH' — el control de autorización debería resolverse antes que las validaciones de negocio.
- **Obtenido:** 400 con el mensaje del gating y el contador de marcas pendientes. Un usuario no autorizado obtiene información de estado de la planilla y un mensaje engañoso que sugiere que si valida las marcas podría aprobarla (probado: tras validar sigue dando 403).
- **Repro:** 1) Como raul.carrizo@demo.com: crear planilla de 1 día libre de 2026, POST /planillas/{pid}/marcar-dia {fecha, tipo:'FALTA_JUSTIFICADA'} (queda PENDIENTE por ser el dueño) y POST /planillas/{pid}/enviar. 2) Como alberto.ojeda@demo.com, que NO es aprobador de esta planilla (el flujo de Intendencia es 'RRHH directo', paso 1 = RRHH): POST /planillas/{pid}/avanzar. En planillas.routes.ts el conteo de marcasPendientes está antes del bloque que resuelve pasoConfig e invoca isResponsibleApprover().
- **Evidencia:** avanzar por NO-aprobador con marcas pendientes → 400 {"error":"Hay 1 marca(s) manual(es) sin validar. Validalas antes de aprobar.","marcasPendientes":1}

### ⚪ BAJA — FlujoPaso.requiereComentarioRechazo se persiste y se muestra en el admin pero ninguna ruta lo lee: el motivo de rechazo es obligatorio siempre
- **Endpoint:** `POST /planillas/:id/rechazar` · **Rol:** SUPERVISOR
- **Esperado:** Con requiereComentarioRechazo=false el rechazo sin motivo debería aceptarse (o, si el motivo es obligatorio por diseño, el flag no debería ser configurable ni mostrarse como '📝 Requiere comentario' en apps/web/src/pages/admin/FlujosPage.tsx:657).
- **Obtenido:** 400 'Se requiere un motivo de rechazo' aunque el paso está configurado con requiereComentarioRechazo=false. La configuración del flujo no tiene ningún efecto sobre el comportamiento.
- **Repro:** 1) Login admin@wenlen.com. POST /admin/flujos {"nombre":"sim-nocomment","tipoDocumento":"PLANILLA","pasos":[{"orden":1,"nombrePaso":"Sup sin comentario","rolAprobador":"SUPERVISOR","requiereComentarioRechazo":false}]} → 201; verificar en la respuesta que pasos[0].requiereComentarioRechazo === false. 2) POST /admin/flujos/asignaciones {"flujoId":<id>,"tipoDocumento":"PLANILLA","usuarioId":"a9552038-d069-4342-9c3d-f60077c12f5d"} (adrian.ledesma@demo.com) → 201. 3) Login adrian.ledesma@demo.com: POST /planillas {"periodoInicio":"2472-08-03T00:00:00.000Z","periodoFin":"2472-08-03T00:00:00.000Z"} → 201 (flujoId = el nuevo); POST /planillas/<pid>/registros {fecha, entradaTurno1 08:00, salidaTurno1
- **Evidencia:** POST /admin/flujos → 201 con pasos[0].requiereComentarioRechazo = false POST /planillas/<pid>/rechazar {} (token ricardo.vargas) → 400 {"error":"Se requiere un motivo de rechazo"} POST /planillas/<pid>/rechazar {"motivo":"..."} → 200 {"estado":"RECHAZADA"}

### ⚪ BAJA — Sin límite de longitud en el motivo de rechazo: se acepta y persiste un string de 100.000 caracteres
- **Endpoint:** `POST /planillas/:id/rechazar` · **Rol:** SUPERVISOR
- **Esperado:** 400 por longitud excesiva (o truncado con un máximo razonable, en línea con los max(500) del resto de los campos de texto).
- **Obtenido:** 200: la planilla queda RECHAZADA con obsRechazo de 100.000 caracteres, que además se copia a PlanillaHistorial.comentario y viaja en cada GET /planillas/:id y en la bandeja de aprobaciones.
- **Repro:** 1) Login adrian.ledesma@demo.com: crear planilla (POST /planillas con periodoInicio=periodoFin='2471-05-01T00:00:00.000Z'), agregar registro y POST /planillas/<pid>/enviar → 200 ENVIADA. 2) Login del supervisor que es aprobador del paso 1 (ricardo.vargas@demo.com si la planilla usa un flujo con paso SUPERVISOR; si no, usar RRHH ana.martinez@demo.com). 3) POST /planillas/<pid>/rechazar {"motivo":"y".repeat(100000)}. 4) GET /planillas/<pid> y GET /planillas/<pid>/historial → verificar obsRechazo y comentario. Nota: los demás campos de texto sí están acotados por zod (observaciones max 500, descripcion max 500); `motivo` y `comentario` de avanzar/rechazar se leen directo de req.body sin schema.
- **Evidencia:** POST /planillas/<pid>/rechazar {"motivo":"yyyy…(100000 chars)"} → 200; String(body.obsRechazo).length === 100000

### ⚪ BAJA — El día bloqueado por un franco compensatorio aprobado queda con esFrancoCompensatorio=false
- **Endpoint:** `POST /ausencias/:id/avanzar` · **Rol:** OPERADOR (eduardo.ruiz) / RRHH
- **Esperado:** El día debería quedar identificado como franco compensatorio también en el flag que consumen analytics (analytics.routes.ts:432 cuenta francosCompensatorios por esFrancoCompensatorio) y el export (export.routes.ts:662 imprime la columna según ese flag).
- **Obtenido:** El día figura bloqueado con motivoBloqueo FRANCO_COMPENSATORIO pero esFrancoCompensatorio=false, por lo que los francos tomados por esta vía no se cuentan en analytics ni salen marcados en el export de planillas.
- **Repro:** 1) Con saldo acreditado, login eduardo.ruiz@demo.com → POST /ausencias/compensatorio {fechaInicio:'2026-08-14', fechaFin:'2026-08-15', diasAusencia:2}. 2) Aprobarlo: POST /ausencias/:id/avanzar con ana.martinez@demo.com (RRHH) → APROBADA. 3) GET /planillas/<planilla del período>/registros → mirar el registro del 2026-08-14. inyectarDiasBloqueados setea bloqueado/motivoBloqueo pero nunca esFrancoCompensatorio.
- **Evidencia:** HTTP 200 GET /planillas/2b2cf4c6.../registros → {"fecha":"2026-08-14T00:00:00.000Z","bloqueado":true,"motivoBloqueo":"FRANCO_COMPENSATORIO","esFrancoCompensatorio":false,"observaciones":"Franco compensatorio — sim-op-ausencias-... franco"}.

### ⚪ BAJA — Cargar horas sobre un día bloqueado por ausencia responde 409 'Ya existe un registro para esa fecha'
- **Endpoint:** `POST /planillas/:id/registros` · **Rol:** OPERADOR (eduardo.ruiz)
- **Esperado:** 403 'Este día está bloqueado: CERTIFICADO_MEDICO', igual que PUT/DELETE, para que la UI pueda explicar por qué no se puede cargar.
- **Obtenido:** 409 'Ya existe un registro para esa fecha', mensaje que no dice que el día está bloqueado por una ausencia aprobada.
- **Repro:** 1) Tener una ausencia aprobada que bloqueó el 2026-08-04 en la planilla de eduardo.ruiz@demo.com. 2) Login eduardo.ruiz@demo.com → POST /planillas/:id/registros {fecha:'2026-08-04T00:00:00.000Z', entradaTurno1:'2026-08-04T08:00:00.000Z', salidaTurno1:'2026-08-04T16:00:00.000Z', lugarTrabajo:'BASE'}. A diferencia de PUT y DELETE de registros (que validan existingReg.bloqueado y devuelven 403 con el motivo), POST no chequea el bloqueo y sólo cae en el unique constraint planillaId+fecha.
- **Evidencia:** HTTP 409 POST /planillas/2b2cf4c6.../registros con fecha 2026-08-04 → {"error":"Ya existe un registro para esa fecha"}, mientras PUT sobre ese mismo registro devuelve HTTP 403 {"error":"Este día está bloqueado: CERTIFICADO_MEDICO"}.

---

## ADMIN — 31 (9 alta, 19 media, 3 baja)

### 🟠 ALTA — GET /usuarios/:id no valida nivel ni sector: cualquier OPERADOR lee DNI/CUIL/teléfono/fecha de nacimiento de cualquier empleado
- **Endpoint:** `GET /usuarios/:id` · **Rol:** OPERADOR (matias.torres@demo.com) y SUPERVISOR (lucas.fernandez@demo.com)
- **Esperado:** 403/404, o al menos el mismo recorte de campos que aplica el listado; un OPERADOR no debe acceder a datos personales (DNI, CUIL, teléfono, fecha de nacimiento, coordinador/supervisor, diagrama) de empleados de otros sectores
- **Obtenido:** 200 con el registro completo del usuario (todo menos passwordHash)
- **Repro:** 1) POST /auth/login {email:'ana.martinez@demo.com',password:'Test1234!'} → token RRHH. 2) Con ese token: POST /usuarios {nombre:'sim-rrhh-personas-pii',apellido:'pii',email:'sim-rrhh-personas-<ts>-pii@demo.com',password:'Test1234!',rol:'OPERADOR',sectorId:'86db0783-542a-4680-97b3-d4f7ccf0ce51' (Almacén),fechaIngreso:'2021-06-01',dni:'30999888',cuil:'20309998881',telefono:'+5492995551234',fechaNacimiento:'1988-03-15'} → 201, guardar id. 3) POST /auth/login {email:'matias.torres@demo.com',password:'Test1234!'} (OPERADOR nivel 10, sector Fractura, distinto del objetivo). 4) GET /usuarios/<id del paso 2> con el token del OPERADOR. Observar: devuelve el registro completo. Mismo resultado con luca
- **Evidencia:** HTTP 200 — {"id":"ba3052ad-f55e-45ab-b869-bd7d1f81fe9c","empresaId":"32e126e4-...","sectorId":"86db0783-...","nombre":"sim-rrhh-personas-1784854859868-pii","email":"...-pii@demo.com","dni":"30999888","cuil":"20309998881","telefono":"+5492995551234","fechaNacimiento":"1988-03-15T00:00:00.000Z",...} —

### 🟠 ALTA — Ninguna operación de RRHH sobre usuarios queda auditada: alta, edición, baja y reset de contraseña no generan entradas en /auditoria
- **Endpoint:** `POST /usuarios, PUT /usuarios/:id, DELETE /usuarios/:id, POST /usuarios/:id/reset-password → GET /auditoria` · **Rol:** RRHH (ana.martinez@demo.com) / ADMIN (admin@wenlen.com)
- **Esperado:** Una entrada por operación en auditoria_log (entidad 'Usuario', accion CREAR/EDITAR/ELIMINAR, con campo/valorAnterior/valorNuevo para cada campo modificado), como sí ocurre con las marcas manuales de planilla
- **Obtenido:** 0 entradas. Las 489 entradas tipo=admin existentes son todas de 'Marca manual ...' generadas por planillas.routes.ts
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /usuarios {nombre:'sim-rrhh-personas-<ts>',apellido:'x',email:'sim-rrhh-personas-<ts>@demo.com',password:'Test1234!',rol:'OPERADOR',fechaIngreso:'2021-06-01'} → 201, guardar id. 3) PUT /usuarios/<id> {nombre:'sim-rrhh-personas-<ts>-Editado',telefono:'+542995551111',dni:'30111333'} → 200. 4) POST /usuarios/<id>/reset-password → 200 (devuelve tempPassword). 5) PUT /usuarios/<id> {activo:false} → 200 (baja). Con token de admin@wenlen.com, DELETE /usuarios/<otro id> → 204. 6) GET /auditoria?tipo=admin&limit=500 con el token de ana. Observar: no hay ninguna entrada con entidadId = <id> ni con el prefijo del sim. En el código, logAuditoria() (src/lib/auditor
- **Evidencia:** GET /auditoria?tipo=admin&limit=500 → HTTP 200, 489 filas; entidades presentes: ["Marca","Validó"]. Ninguna fila contiene el id 785a1b87-0fd6-446d-9dbc-89a2a0912f29 (usuario creado), 601c435f-45d1-4790-a4bb-eca79651a84c (usuario borrado por ADMIN) ni el prefijo sim-rrhh-personas-1784854859868

### 🟠 ALTA — Se acepta un sectorId de OTRA empresa en alta, edición y PATCH /:id/sector: el usuario queda apuntando a un sector ajeno y la API filtra su nombre
- **Endpoint:** `POST /usuarios, PUT /usuarios/:id, PATCH /usuarios/:id/sector` · **Rol:** RRHH (ana.martinez@demo.com) y ADMIN (admin@wenlen.com)
- **Esperado:** 400 'Sector inexistente' — el sectorId debe validarse contra req.user.empresaId, igual que se hace con diagramaId
- **Obtenido:** 201/200 en las tres rutas; el usuario queda con sectorId de otra empresa y la API devuelve el nombre del sector ajeno como si fuera propio
- **Repro:** El sector 7cf448a4-7e6b-4d71-b880-93f34ecdecbe ('Fractura') pertenece a la empresa 62e25426-f39e-4a73-8a19-fc35c3e44f36; ana.martinez es de la empresa 32e126e4-e36b-484b-9233-205922a2840a. 1) Login ana.martinez@demo.com. 2) POST /usuarios {nombre:'sim-rrhh-personas-<ts>-xt',apellido:'xt',email:'sim-rrhh-personas-<ts>-xt@demo.com',password:'Test1234!',rol:'OPERADOR',fechaIngreso:'2024-01-01',sectorId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe'} → 201. 3) Idem sobre un usuario existente: PUT /usuarios/<id> {sectorId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe'} → 200. 4) Con token de admin@wenlen.com: PATCH /usuarios/<id>/sector {sectorId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe'} → 200. 5) GET /usuarios/<i
- **Evidencia:** POST /usuarios → HTTP 201 {"id":"8a77e806-f26c-4e0c-84c2-476b9e61bc73","empresaId":"32e126e4-...","sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe"}. PUT /usuarios/ba3052ad-... → 200; luego GET /usuarios/ba3052ad-... → "sector":{"id":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe","nombre":"Fractura"} (secto

### 🟠 ALTA — GET /usuarios/:id sin guard de nivel ni de sector: cualquier autenticado lee la ficha completa de cualquier empleado
- **Endpoint:** `GET /usuarios/:id` · **Rol:** CMASS (sandra.montenegro@demo.com) y OPERADOR (agustin.delgado@demo.com)
- **Esperado:** 403/404 para quien no tiene visibilidad sobre ese usuario. GET /usuarios sí aplica el filtro por sector para nivel < 90 (usuarios.routes.ts:106-121); GET /usuarios/:id (línea 152) sólo filtra por empresaId y no tiene requireLevel.
- **Obtenido:** 200 con la ficha completa: dni, cuil, fechaNacimiento, telefono, legajo, tipoContrato, fechaIngreso/fechaFinPrueba/fechaEgreso, diasVacacionesSaldo, diasVacacionesUsados, coordinadorId/supervisorId (con nombre y apellido) y diagrama asignado. En la demo dni/cuil/telefono están en null, pero el endpoint los devuelve sin filtro alguno.
- **Repro:** 1) login agustin.delgado@demo.com (OPERADOR, sector CMASS). 2) GET /usuarios → devuelve sólo su sector (10 usuarios), no aparece diego.ramirez (sector Fractura). 3) GET /usuarios/48eb7f2a-8567-42b3-a928-26887e9b712a (diego.ramirez, sector Fractura) con ese mismo token → observar 200 y el cuerpo completo. 4) Repetir con sandra.montenegro@demo.com (CMASS): mismo resultado.
- **Evidencia:** HTTP 200 {"id":"48eb7f2a-...","sectorId":"6ee3adf3-...","nombre":"Diego","apellido":"Ramírez","email":"diego.ramirez@demo.com","legajo":"D003","dni":null,"cuil":null,"fechaNacimiento":null,"telefono":null,"rol":"OPERADOR","tipoContrato":"INDEFINIDO","fechaIngreso":"2024-06-01T00:00:00.000Z","diasVac

### 🟠 ALTA — DELETE /admin/flujos/:id borra un flujo referenciado por documentos en curso y los deja con flujoId=null, sin aviso ni bloqueo
- **Endpoint:** `DELETE /admin/flujos/:id` · **Rol:** ADMIN
- **Esperado:** 409 con un mensaje accionable ('no se puede eliminar: N documento(s) usan este flujo'), o soft-delete poniendo activo=false y preservando la referencia — que es exactamente lo que ya hace DELETE /admin/diagramas/:id cuando detecta historial de asignaciones.
- **Obtenido:** HTTP 204: el flujo se borra y la FK opcional Planilla.flujoId queda en NULL (SetNull por defecto en Prisma para relaciones opcionales). Los documentos en curso quedan huérfanos de circuito de aprobación, lo que además dispara el bug crítico de auto-aprobación en POST /planillas/:id/avanzar. Lo mismo aplica a Vacacion, Ausencia y SolicitudCambioDiagrama, que también referencian flujoId de forma opcional.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/flujos {"nombre":"tmp-planilla","tipoDocumento":"PLANILLA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"RRHH"}]} → <fid>. 3) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"PLANILLA","usuarioId":"<id de un operador>"}. 4) Con el token de ese operador: POST /planillas {"periodoInicio":"2024-03-21T00:00:00.000Z","periodoFin":"2024-04-20T00:00:00.000Z"} → la respuesta trae flujoId=<fid>; agregar al menos un registro con POST /planillas/<pid>/registros. 5) Como admin: DELETE /admin/flujos/asignaciones/<asig> y luego DELETE /admin/flujos/<fid>. 6) GET /planillas/<pid> y mirar el campo flujoId.
- **Evidencia:** DELETE /admin/flujos/<fid> → HTTP 204 (body vacío). GET /planillas/19af6f73-100f-4d10-b966-7f35eaf0b92a → {"flujoId":null,"estado":"BORRADOR"}. Confirmado en DB: las planillas 541d2529-f83e-4572-a047-c76bed0591d3 y 603f3a02-158c-4780-a9bc-b6abab86de24 quedaron con flujo_id NULL.

### 🟠 ALTA — Borrar un sector arrastra su FlujoAsignacion a sectorId=null y la convierte en el flujo por defecto de TODA la empresa
- **Endpoint:** `DELETE /admin/sectores/:id` · **Rol:** ADMIN
- **Esperado:** 409 ('el sector está referenciado por N asignación(es) de flujo') o borrado en cascada de la asignación. El chequeo de integridad de DELETE /admin/sectores/:id sólo cuenta usuarios (prisma.usuario.count) e ignora por completo FlujoAsignacion.
- **Obtenido:** HTTP 204: el sector se borra y la asignación sobrevive con sectorId=null. Una asignación con sectorId=null Y usuarioId=null es exactamente el patrón que src/routes/planillas.routes.ts usa como 'flujo por defecto de la empresa' (asignaciones: { some: { sectorId: null, usuarioId: null, activo: true, tipoDocumento: 'PLANILLA' } }). Es decir: borrar un sector puede cambiar en silencio el circuito de aprobación de todos los empleados que no tengan asignación propia.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/sectores {"nombre":"tmp-sector"} → <sid>. 3) POST /admin/flujos {"nombre":"tmp-flujo","tipoDocumento":"PLANILLA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"SUPERVISOR"}]} → <fid>. 4) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"PLANILLA","sectorId":"<sid>"} → 201, anotar <aid>. 5) DELETE /admin/sectores/<sid> (el sector no tiene usuarios). 6) GET /admin/flujos/asignaciones/list, buscar <aid> y mirar su sectorId.
- **Evidencia:** DELETE /admin/sectores/<sid> → HTTP 204 (body vacío). GET /admin/flujos/asignaciones/list → la asignación creada figura con {"sectorId":null} (antes apuntaba al sector borrado). Salida del script: '· DELETE sector con asignación de flujo → HTTP 204' / '· asignación tras el delete: {"sectorId":null}'

### 🟠 ALTA — POST /admin/flujos/asignaciones acepta un sectorId de OTRA empresa (sólo valida el tenant del flujo)
- **Endpoint:** `POST /admin/flujos/asignaciones` · **Rol:** ADMIN
- **Esperado:** 400 o 404: el sectorId (y análogamente el usuarioId) debe pertenecer a la empresa del solicitante. El handler sólo hace findFirst del flujo filtrando por empresaId y después crea la asignación con sectorId/usuarioId sin ninguna verificación de tenant.
- **Obtenido:** HTTP 201: se crea una asignación que enlaza un flujo de la empresa A con un sector de la empresa B. Rompe el aislamiento multi-empresa y deja un registro cruzado en flujos_asignaciones que aparece en el listado de administración de la empresa A.
- **Repro:** 1) Login admin@wenlen.com (Test1234!) — empresa 32e126e4-e36b-484b-9233-205922a2840a. 2) Crear o tomar un flujo propio: POST /admin/flujos {"nombre":"tmp","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"SUPERVISOR"}]} → <fid>. 3) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"AUSENCIA","sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe"} — ese sector pertenece a la empresa 62e25426-f39e-4a73-8a19-fc35c3e44f36. 4) Observar el status y luego GET /admin/flujos/asignaciones/list.
- **Evidencia:** POST /admin/flujos/asignaciones → HTTP 201 {"id":"c6207633-c887-40be-85cd-212bfcc3fe8a","flujoId":"fb6f13c9-2fce-492e-b222-c843ece4854e","tipoDocumento":"AUSENCIA","sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe","usuarioId":null,"activo":true}

### 🟠 ALTA — PATCH /usuarios/:id/sector permite mover un usuario a un sector de OTRA empresa
- **Endpoint:** `PATCH /usuarios/:id/sector` · **Rol:** ADMIN
- **Esperado:** 400 'Sector inexistente' o 404, igual que hace PATCH /usuarios/:id/diagrama, que sí valida prisma.diagrama.findFirst({ id, empresaId }) antes de asignar.
- **Obtenido:** HTTP 200 y el usuario queda persistido con un sectorId de otra empresa. El handler verifica que el USUARIO pertenezca a la empresa del admin pero no valida el sectorId destino, y la FK a nivel de base de datos no distingue tenant. Consecuencias: el usuario desaparece de los filtros por sector de su propia empresa, la resolución de flujo por sector deja de encontrarlo, y queda contado dentro de un sector ajeno.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) Tomar un usuario propio <uid> (por ejemplo crear uno con POST /usuarios). 3) PATCH /usuarios/<uid>/sector con body {"sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe"} — sector de la empresa 62e25426-f39e-4a73-8a19-fc35c3e44f36. 4) Observar la respuesta y confirmar con GET /usuarios/<uid>.
- **Evidencia:** PATCH /usuarios/f47fb6aa-b701-4a14-835d-39a9e8a7098b/sector {"sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe"} → HTTP 200 {"id":"f47fb6aa-b701-4a14-835d-39a9e8a7098b","empresaId":"32e126e4-e36b-484b-9233-205922a2840a","sectorId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe",...}

### 🟠 ALTA — GERENTE (nivel 80) sin sector sólo se ve a sí mismo en GET /usuarios: 'Mi Equipo' y todo selector de personas queda vacío
- **Endpoint:** `GET /usuarios?activo=true` · **Rol:** GERENTE (laura.gonzalez@demo.com)
- **Esperado:** Un GERENTE (80), por encima de COORDINADOR (70), debería ver al menos el padrón de su empresa (o un scope explícito), no un único registro. El nav le ofrece 'Mi Equipo' y 'Cambios Diagrama' (ambas pantallas listan /usuarios?activo=true).
- **Obtenido:** Devuelve un array de 1 elemento (ella misma). Las pantallas Mi Equipo y Cambios Diagrama quedan vacías sin ningún mensaje de permiso.
- **Repro:** 1) POST /auth/login {email:'laura.gonzalez@demo.com', password:'Test1234!'} → guardar accessToken (rolNivel=80, sectorId=null). 2) GET /usuarios?activo=true con ese token. 3) Repetir con maria.rodriguez@demo.com (RRHH 90). En usuarios.routes.ts GET / el bloque 'Role-based visibility' hace: si nivel<90 y el usuario NO tiene sectorId → where.id = req.user.userId (fallback 'only self'). El GERENTE seeded no tiene sector, así que cae siempre en el fallback. Confirmado el root cause creando (como ADMIN) un usuario rol GERENTE con sectorId=Cabezales: ese gerente sí ve 11 usuarios.
- **Evidencia:** 200 → gerente: 1 elemento ["laura.gonzalez@demo.com"] · RRHH: 127 elementos. Gerente de prueba CON sector (sim-gerente-analytics-…-ger@demo.com, sector Cabezales): 11 elementos.

### 🟡 MEDIA — Los guards de nivel ADMIN de DELETE /usuarios/:id y PATCH /:id/sector son evitables: RRHH logra lo mismo con PUT /usuarios/:id
- **Endpoint:** `DELETE /usuarios/:id y PATCH /usuarios/:id/sector vs PUT /usuarios/:id` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** Un único nivel por operación: o DELETE y PATCH /sector se bajan a LEVEL_RRHH, o PUT /usuarios/:id rechaza los campos activo y sectorId para nivel < 100
- **Obtenido:** 403 en los endpoints dedicados, 200 en el PUT que hace exactamente lo mismo
- **Repro:** 1) Login ana.martinez@demo.com (RRHH, nivel 90). 2) Crear un usuario de prueba: POST /usuarios {...,email:'sim-rrhh-personas-<ts>@demo.com',rol:'OPERADOR',fechaIngreso:'2021-06-01'} → 201. 3) DELETE /usuarios/<id> → 403 'No tiene permisos para esta acción' (la ruta exige LEVEL_ADMIN=100). 4) PUT /usuarios/<id> {activo:false} → 200 con activo=false: misma baja lograda con nivel 90. 5) PATCH /usuarios/<id>/sector {sectorId:'6ee3adf3-0dfc-4171-addd-524e0a43d898'} → 403 (exige LEVEL_ADMIN). 6) PUT /usuarios/<id> {sectorId:'6ee3adf3-0dfc-4171-addd-524e0a43d898'} → 200: mismo cambio de sector con nivel 90. Efecto doble: (a) el control de acceso no se cumple, y (b) RRHH —el rol responsable de la ba
- **Evidencia:** DELETE /usuarios/785a1b87-0fd6-446d-9dbc-89a2a0912f29 → HTTP 403 {"error":"No tiene permisos para esta acción"}; PUT /usuarios/785a1b87-... {activo:false} → HTTP 200 {...,"activo":false}. PATCH /usuarios/785a1b87-.../sector → HTTP 403; PUT /usuarios/785a1b87-... {sectorId:"6ee3adf3-..."} → HTTP 200 

### 🟡 MEDIA — RRHH no puede usar PATCH /usuarios/:id/diagrama-color: el chequeo de 'mismo sector' no exceptúa a los niveles superiores
- **Endpoint:** `PATCH /usuarios/:id/diagrama-color` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 200 (RRHH nivel 90 debe poder setear el color de diagrama de cualquier empleado de su empresa); el filtro por sector sólo debería aplicar a COORDINADOR/CMASS
- **Obtenido:** 403 'Solo puedes modificar empleados de tu sector' para todo empleado con sector asignado
- **Repro:** 1) Login ana.martinez@demo.com (RRHH nivel 90, sectorId = null — como todos los RRHH/GERENTE del seed). 2) Crear/tomar un usuario con sector: POST /usuarios {...,sectorId:'6ee3adf3-0dfc-4171-addd-524e0a43d898',rol:'OPERADOR',fechaIngreso:'2021-06-01'} → 201. 3) PATCH /usuarios/<id>/diagrama-color {diagramaColor:'AZUL'} con el token de RRHH. Observar el 403. La ruta pide requireLevel(LEVEL_COORDINADOR)=70 —que RRHH supera— pero después compara caller.sectorId === target.sectorId (usuarios.routes.ts:452) sin excepción para nivel >= 90, y RRHH/GERENTE no tienen sector. El mismo cambio sí funciona con PUT /usuarios/<id> {diagramaColor:'AZUL'} → 200.
- **Evidencia:** PATCH /usuarios/785a1b87-0fd6-446d-9dbc-89a2a0912f29/diagrama-color {"diagramaColor":"AZUL"} con token RRHH → HTTP 403 {"error":"Solo puedes modificar empleados de tu sector"}; PUT /usuarios/785a1b87-... {"diagramaColor":"AZUL"} con el mismo token → HTTP 200

### 🟡 MEDIA — Un usuario puede auto-desactivarse con PUT /usuarios/{propioId} {activo:false} y queda bloqueado fuera del sistema (DELETE sí impide ese caso)
- **Endpoint:** `PUT /usuarios/:id` · **Rol:** RRHH (usuario de prueba creado en el guion)
- **Esperado:** 400 'No podés desactivar tu propia cuenta', igual que en DELETE /usuarios/:id
- **Obtenido:** 200 y auto-lockout inmediato; si es el último ADMIN/RRHH activo, la empresa queda sin quien lo revierta
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /usuarios {nombre:'sim-rrhh-personas-<ts>-self',apellido:'self',email:'sim-rrhh-personas-<ts>-self@demo.com',password:'Test1234!',rol:'RRHH',fechaIngreso:'2024-01-01'} → 201, guardar id. 3) POST /auth/login {email:'sim-rrhh-personas-<ts>-self@demo.com',password:'Test1234!'} → token propio. 4) Con ESE token: PUT /usuarios/<propio id> {activo:false} → 200, activo=false. 5) POST /auth/login con el mismo email → 401 'Credenciales inválidas'. El usuario ya no puede entrar y necesita que otro lo reactive. DELETE /usuarios/:id sí contempla el caso (usuarios.routes.ts:357 'No podés desactivar tu propia cuenta'), pero PUT no replica ese guard.
- **Evidencia:** PUT /usuarios/601c435f-45d1-4790-a4bb-eca79651a84c {"activo":false} con el token del propio usuario → HTTP 200 {..."activo":false}; POST /auth/login del mismo email → HTTP 401 {"error":"Credenciales inválidas"}

### 🟡 MEDIA — fechaIngreso sin cota superior: se da de alta a alguien que ingresa en el año 2999 y el sistema le genera 14 días de vacaciones
- **Endpoint:** `POST /usuarios` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400: fechaIngreso no debería poder ser posterior a hoy (o al menos no varios siglos adelante); un usuario con antigüedad negativa no debería recibir saldo de vacaciones
- **Obtenido:** 201 y saldo de 14 días para 2026 a un empleado con fecha de ingreso dentro de 973 años
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /usuarios {nombre:'sim-rrhh-personas-<ts>-fut',apellido:'fut',email:'sim-rrhh-personas-<ts>-fut@demo.com',password:'Test1234!',rol:'OPERADOR',fechaIngreso:'2999-01-01'} → 201. 3) POST /vacacion-saldos/generar {anio:2026} → 200. 4) GET /vacacion-saldos?anio=2026 y buscar por usuario.id → tiene diasCorrespondientes=14. El schema usa fechaFlexible (utils/zod.utils.ts) que sólo valida el formato; diasPorAntiguedad() calcula antigüedad negativa y la clampa a 0 (`if (anios < 0) anios = 0`), por lo que un empleado que aún no ingresó computa como si tuviera 0 años de antigüedad y entra en todos los listados y cálculos.
- **Evidencia:** POST /usuarios {"fechaIngreso":"2999-01-01"} → HTTP 201 {"id":"2a4efa41-ae17-49e4-b1ae-9333594fec56","fechaIngreso":"2999-01-01T00:00:00.000Z"}; luego GET /vacacion-saldos?anio=2026 → ese usuario con "diasCorrespondientes":14

### 🟡 MEDIA — PUT /usuarios/:id acepta fechaEgreso anterior a fechaIngreso (empleado que egresa 6 años antes de ingresar)
- **Endpoint:** `PUT /usuarios/:id` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400 'fechaEgreso no puede ser anterior a fechaIngreso' (y lo mismo para fechaFinPrueba)
- **Obtenido:** 200; el registro queda con antigüedad negativa, lo que afecta cualquier cálculo de antigüedad/liquidación
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /usuarios {...,email:'sim-rrhh-personas-<ts>@demo.com',rol:'OPERADOR',fechaIngreso:'2021-06-01'} → 201, guardar id. 3) PUT /usuarios/<id> {fechaEgreso:'2015-01-01'} → 200. 4) GET /usuarios/<id>: fechaIngreso 2021-06-01, fechaEgreso 2015-01-01. No hay ninguna validación cruzada entre fechaIngreso, fechaFinPrueba y fechaEgreso en updateUsuarioSchema ni en el handler.
- **Evidencia:** PUT /usuarios/785a1b87-0fd6-446d-9dbc-89a2a0912f29 {"fechaEgreso":"2015-01-01"} → HTTP 200 {...,"fechaIngreso":"2021-06-01T00:00:00.000Z","fechaEgreso":"2015-01-01T00:00:00.000Z"}

### 🟡 MEDIA — PUT /usuarios/:id devuelve 200 al mandar fechaEgreso:null pero no limpia el campo (idem fechaFinPrueba, fechaNacimiento, fechaIngreso)
- **Endpoint:** `PUT /usuarios/:id` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 200 con fechaEgreso=null persistido (el schema declara .nullable()), o 400 si no se admite limpiar el campo
- **Obtenido:** 200 con el campo intacto: la respuesta contradice lo que el cliente pidió y la operación queda silenciosamente sin efecto
- **Repro:** 1) Login ana.martinez@demo.com. 2) Sobre un usuario de prueba: PUT /usuarios/<id> {fechaEgreso:'2026-01-01'} → 200. 3) PUT /usuarios/<id> {fechaEgreso:null} → 200, pero la respuesta devuelve fechaEgreso con el valor viejo. 4) GET /usuarios/<id> confirma que sigue seteado. Causa: usuarios.routes.ts:327-328 construye el data con `...(d.fechaEgreso !== undefined && d.fechaEgreso !== null && {fechaEgreso: new Date(...)})`, así que null se descarta silenciosamente. Mismo patrón en fechaFinPrueba (línea 327) y en fechaNacimiento/fechaIngreso (líneas 325-326, que usan truthiness). El schema sí acepta null, y el frontend no tiene forma de deshacer una reincorporación mal cargada.
- **Evidencia:** PUT /usuarios/785a1b87-0fd6-446d-9dbc-89a2a0912f29 {"fechaEgreso":null} → HTTP 200 {...,"fechaEgreso":"2015-01-01T00:00:00.000Z"}

### 🟡 MEDIA — coordinadorId/supervisorId sin validación: se acepta un OPERADOR como coordinador y que un usuario sea su propio supervisor
- **Endpoint:** `PUT /usuarios/:id (y POST /usuarios)` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400: coordinadorId debe apuntar a alguien con nivel de COORDINADOR o superior, supervisorId a un SUPERVISOR o superior, y ninguno puede ser el propio usuario (ciclo en la jerarquía de aprobación)
- **Obtenido:** 200; la jerarquía de aprobación queda con un OPERADOR como coordinador y un usuario que es su propio supervisor
- **Repro:** 1) Login ana.martinez@demo.com. 2) GET /usuarios?rol=OPERADOR → tomar el id de cualquier OPERADOR (ej. bde2687d-9a7b-45fc-9974-a541bc86f872). 3) Crear un usuario de prueba con POST /usuarios (rol OPERADOR) → guardar <id>. 4) PUT /usuarios/<id> {coordinadorId:'<id del OPERADOR>', supervisorId:'<id>'} (o sea, él mismo como supervisor) → 200. 5) GET /usuarios/<id>: coordinador y supervisor quedan seteados. Sólo se valida la FK (P2003), nunca el rol/nivel del referenciado ni la auto-referencia.
- **Evidencia:** PUT /usuarios/ba3052ad-f55e-45ab-b869-bd7d1f81fe9c {"coordinadorId":"bde2687d-9a7b-45fc-9974-a541bc86f872","supervisorId":"ba3052ad-f55e-45ab-b869-bd7d1f81fe9c"} → HTTP 200 {...,"coordinadorId":"bde2687d-9a7b-45fc-9974-a541bc86f872","supervisorId":"ba3052ad-f55e-45ab-b869-bd7d1f81fe9c"}

### 🟡 MEDIA — GET /auditoria?desde=<fecha no parseable> devuelve 500 en vez de 400
- **Endpoint:** `GET /auditoria` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400 'Fecha inválida' con detalle del parámetro
- **Obtenido:** 500 'Error interno' — el frontend no puede distinguir un filtro mal tipeado de una caída del servidor
- **Repro:** 1) Login ana.martinez@demo.com. 2) GET /auditoria?desde=ayer → 500. Igual con GET /auditoria?hasta=xx y GET /auditoria?desde=2026-99-99. 3) GET /auditoria?desde=2026-07-01&hasta=2026-07-31&limit=20 → 200 (el caso válido funciona). Causa: auditoria.routes.ts:20-25 hace `new Date(desde as string)` sin validar; el Invalid Date llega a Prisma y revienta la query.
- **Evidencia:** GET /auditoria?desde=ayer → HTTP 500 {"error":"Error interno"}; GET /auditoria?hasta=xx → HTTP 500; GET /auditoria?desde=2026-99-99 → HTTP 500. GET /auditoria?desde=2026-07-01&hasta=2026-07-31&limit=20 → HTTP 200 con 20 filas

### 🟡 MEDIA — DELETE /admin/flujos/:id con asignaciones vigentes devuelve 500 'Error interno' (violación de FK sin traducir) en vez de 409
- **Endpoint:** `DELETE /admin/flujos/:id` · **Rol:** ADMIN
- **Esperado:** 409 con un mensaje accionable ('el flujo tiene N asignación(es), eliminalas primero') o borrado en cascada de las asignaciones. El propio DELETE de sectores y diagramas ya devuelve 409 en casos análogos.
- **Obtenido:** HTTP 500 {"error":"Error interno"}. FlujoAsignacion.flujoId es una relación obligatoria (onDelete Restrict), la P2003 no se traduce y el handler no verifica asignaciones antes de borrar. Desde la UI el admin no tiene forma de saber por qué falla la operación.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/flujos {"nombre":"tmp","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"SUPERVISOR"}]} → <fid>. 3) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"AUSENCIA","usuarioId":"<un usuario propio>"} → 201. 4) DELETE /admin/flujos/<fid>.
- **Evidencia:** DELETE /admin/flujos/<fid> → HTTP 500 {"error":"Error interno"}. Salida del script: '· DELETE flujo con asignación → HTTP 500 {"error":"Error interno"}'.

### 🟡 MEDIA — PUT /admin/config con campos declarados en el schema Zod pero inexistentes en el modelo (zonaHoraria, moneda, horasViajeDefault) devuelve 500
- **Endpoint:** `PUT /admin/config` · **Rol:** ADMIN
- **Esperado:** 200 guardando el valor (si el campo debe existir) o 400 'Datos inválidos' (si no debe aceptarse). Nunca un 5xx.
- **Obtenido:** HTTP 500 {"error":"Error interno"} en los tres casos: prisma.empresaConfig.update() lanza PrismaClientValidationError por campo desconocido y el catch genérico lo convierte en 500. Cualquier pantalla de configuración que envíe el formulario completo (incluyendo estos tres campos) rompe con 500 y no puede guardar ningún cambio.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) PUT /admin/config {"zonaHoraria":"America/Argentina/Buenos_Aires"}. 3) PUT /admin/config {"moneda":"ARS"}. 4) PUT /admin/config {"horasViajeDefault":2}. Los tres pasan la validación de Zod (están declarados en updateConfigSchema de src/routes/admin.config.routes.ts) pero no existen como columnas del modelo EmpresaConfig en prisma/schema.prisma.
- **Evidencia:** PUT /admin/config {"zonaHoraria":"sim-admin-config-1784854841872-TZ"} → HTTP 500 {"error":"Error interno"}; PUT /admin/config {"moneda":"ARS"} → HTTP 500 {"error":"Error interno"}; PUT /admin/config {"horasViajeDefault":2} → HTTP 500 {"error":"Error interno"}

### 🟡 MEDIA — PUT /admin/config acepta combinaciones de umbrales incoherentes (umbralExtra50 > umbralExtra100, todos en 0, período 31/31)
- **Endpoint:** `PUT /admin/config` · **Rol:** ADMIN
- **Esperado:** 400 'Datos inválidos'. El schema valida cada campo por separado (min/max) pero no la relación entre ellos: umbralExtra50 debe ser menor o igual a umbralExtra100; con los umbrales en 0 toda hora trabajada pasa a extra al 100%; periodoDiaInicio=31 rompe getPeriodoActual() en meses de 30 días (new Date(anio, mes, 31) desborda al mes siguiente).
- **Obtenido:** HTTP 200 en los tres casos, con los valores incoherentes persistidos. Con umbralExtra50=20 mayor que umbralExtra100=5, la rama `horasTrabajadas <= umbralExtra50` de calculo.utils.ts convierte cualquier jornada de hasta 20h en 100% horas normales, borrando las horas extra de toda la empresa sin ningún aviso.
- **Repro:** 1) Login admin@wenlen.com (Test1234!); guardar GET /admin/config. 2) PUT /admin/config {"umbralExtra50":20,"umbralExtra100":5} → observar status. 3) PUT /admin/config {"horasJornadaNormal":0,"umbralExtra50":0,"umbralExtra100":0} → observar. 4) PUT /admin/config {"periodoDiaInicio":31,"periodoDiaFin":31} → observar. 5) RESTAURAR los valores originales: periodoDiaInicio 21, periodoDiaFin 20, horasJornadaNormal 8, umbralExtra50 8, umbralExtra100 12.
- **Evidencia:** PUT /admin/config {"umbralExtra50":20,"umbralExtra100":5} → HTTP 200. PUT /admin/config {"horasJornadaNormal":0,"umbralExtra50":0,"umbralExtra100":0} → HTTP 200 con {j:0,u50:0,u100:0}. PUT /admin/config {"periodoDiaInicio":31,"periodoDiaFin":31} → HTTP 200 con 31 y 31.

### 🟡 MEDIA — Los pasos de un flujo no validan el campo `orden`: se aceptan órdenes duplicados y órdenes no consecutivos
- **Endpoint:** `POST /admin/flujos y POST /admin/flujos/:id/pasos` · **Rol:** ADMIN
- **Esperado:** 400: los valores de `orden` deben ser únicos dentro del flujo y consecutivos desde 1, porque el avance usa `pasos.find(p => p.orden === pasoActual)` con pasoActual incrementado de a 1 y compara contra `pasos.length`.
- **Obtenido:** HTTP 201 en los tres casos. Con orden duplicado, find() toma arbitrariamente el primer paso que matchea y el otro nunca se ejecuta (el aprobador real depende del orden de inserción). Con orden salteado (1 y 5) totalPasos=2, así que al aprobar el paso 1 resulta nuevoPaso=2 > totalPasos y el documento pasa directo a APROBADA: el paso 5 (por ejemplo RRHH) nunca se ejecuta.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) Duplicado en la creación: POST /admin/flujos {"nombre":"tmp-dup","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"A","rolAprobador":"SUPERVISOR"},{"orden":1,"nombrePaso":"B","rolAprobador":"RRHH"}]}. 3) Salteado: POST /admin/flujos {"nombre":"tmp-gap","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"A","rolAprobador":"SUPERVISOR"},{"orden":5,"nombrePaso":"B","rolAprobador":"RRHH"}]}. 4) Duplicado por alta individual: sobre un flujo que ya tiene un paso con orden=1, POST /admin/flujos/<fid>/pasos {"orden":1,"nombrePaso":"bis","rolAprobador":"CMASS"}.
- **Evidencia:** POST /admin/flujos con pasos [{orden:1},{orden:1}] → HTTP 201. POST /admin/flujos con pasos [{orden:1},{orden:5}] → HTTP 201. POST /admin/flujos/<fid>/pasos {"orden":1,...} sobre un flujo que ya tenía orden=1 → HTTP 201.

### 🟡 MEDIA — POST /admin/flujos acepta un paso cuyo rolAprobador no existe en RolConfig
- **Endpoint:** `POST /admin/flujos` · **Rol:** ADMIN
- **Esperado:** 400 'rolAprobador inexistente'. El rolAprobador debería validarse contra RolConfig de la empresa, igual que hace assertCanAssignRole() en usuarios.routes.ts al asignar roles a usuarios.
- **Obtenido:** HTTP 201: el schema sólo pide z.string().min(1). Queda configurado un paso que isResponsibleApprover() nunca podrá satisfacer, dejando atascados de forma permanente todos los documentos que usen ese flujo, y sin ningún mensaje que permita diagnosticarlo.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/flujos {"nombre":"tmp-rol-fantasma","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"ROL-QUE-NO-EXISTE"}]}. 3) Asignar ese flujo a un usuario con POST /admin/flujos/asignaciones y enviar un documento: ningún usuario podrá superar el paso 1.
- **Evidencia:** POST /admin/flujos con rolAprobador="sim-admin-config-1784854841872-ROL-QUE-NO-EXISTE" → HTTP 201 con el paso creado.

### 🟡 MEDIA — POST /admin/flujos con usuarioEspecificoId inexistente devuelve 500 'Error interno' en vez de 400
- **Endpoint:** `POST /admin/flujos` · **Rol:** ADMIN
- **Esperado:** 400 'Usuario inexistente' (y además debería validarse que el usuario pertenezca a la misma empresa). Otras rutas ya traducen este caso: POST y PUT /usuarios capturan P2003 y responden 400 'Referencia inválida'.
- **Obtenido:** HTTP 500 {"error":"Error interno"}: la violación de FK de FlujoPaso.usuarioEspecificoId no se traduce. El UUID pasa la validación de formato de Zod, así que el error sólo aparece al escribir en la base.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/flujos {"nombre":"tmp-user-fantasma","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"SUPERVISOR","usuarioEspecificoId":"00000000-0000-4000-8000-000000000000"}]}.
- **Evidencia:** POST /admin/flujos con "usuarioEspecificoId":"00000000-0000-4000-8000-000000000000" → HTTP 500 {"error":"Error interno"}

### 🟡 MEDIA — PUT/DELETE /admin/flujos/:id/pasos/:pid ignora el :id del flujo: se puede editar o borrar un paso de OTRO flujo desde cualquier ruta
- **Endpoint:** `PUT /admin/flujos/:id/pasos/:pid` · **Rol:** ADMIN
- **Esperado:** 404 'Paso no encontrado': el WHERE debería incluir flujoId igual a req.params.id además del tenant. Hoy es { id: pid, flujo: { empresaId } }, o sea que sólo valida la empresa, no el flujo padre.
- **Obtenido:** HTTP 200 y el paso del flujo B queda modificado a través de la ruta del flujo A. Es una inconsistencia de contrato (el :id de la ruta es decorativo) que permite que la UI edite o borre pasos del flujo equivocado sin recibir ningún error, y que complica auditar quién tocó qué flujo.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) Crear el flujo A: POST /admin/flujos {"nombre":"tmp-A","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"a1","rolAprobador":"SUPERVISOR"}]} → <fidA>. 3) Crear el flujo B igual → <fidB>, anotando el id de su paso (<pidB>). 4) PUT /admin/flujos/<fidA>/pasos/<pidB> con body {"nombrePaso":"hijacked"}. 5) GET /admin/flujos/<fidB> y comprobar que su paso cambió de nombre. Repetir con DELETE /admin/flujos/<fidA>/pasos/<pidB>.
- **Evidencia:** PUT /admin/flujos/<flujoA>/pasos/<paso de flujoB> {"nombrePaso":"sim-admin-config-1784854841872-hijacked"} → HTTP 200 con el paso actualizado (su flujoId sigue apuntando a flujoB).

### 🟡 MEDIA — POST /admin/flujos/asignaciones acepta cualquier string como tipoDocumento y no valida que coincida con el tipo del flujo
- **Endpoint:** `POST /admin/flujos/asignaciones` · **Rol:** ADMIN
- **Esperado:** 400: tipoDocumento debería ser el enum ['PLANILLA','VACACION','AUSENCIA','COMPENSATORIO'] como ya lo es en createFlujoSchema, y además coincidir con flujo.tipoDocumento.
- **Obtenido:** HTTP 201 en ambos casos, porque el schema usa z.string().min(1). Una asignación con tipoDocumento inválido nunca matchea la resolución de flujo y queda muerta: el admin cree haber configurado el circuito y los documentos siguen usando el default. Una asignación con tipo cruzado (flujo AUSENCIA asignado para PLANILLA) puede además aplicar un circuito equivocado.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) Crear un flujo de tipo AUSENCIA: POST /admin/flujos {"nombre":"tmp","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"p1","rolAprobador":"SUPERVISOR"}]} → <fid>. 3) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"BASURA"} → observar. 4) POST /admin/flujos/asignaciones {"flujoId":"<fid>","tipoDocumento":"PLANILLA"} (tipo distinto al del flujo) → observar.
- **Evidencia:** POST /admin/flujos/asignaciones {"flujoId":"<flujo de tipo AUSENCIA>","tipoDocumento":"sim-admin-config-1784854841872-BASURA"} → HTTP 201 con la asignación creada.

### 🟡 MEDIA — PUT /admin/diagramas/:id acepta diasTrabajo/diasDescanso/diasSemana, responde 200 y los descarta en silencio: no hay forma de corregir la rotación
- **Endpoint:** `PUT /admin/diagramas/:id` · **Rol:** ADMIN
- **Esperado:** O bien 200 aplicando el cambio de rotación, o bien 400 indicando que esos campos no son editables. Devolver 200 con los valores viejos hace creer al admin que guardó el cambio.
- **Obtenido:** HTTP 200 con {"diasTrabajo":12,"diasDescanso":4}: updateDiagramaSchema sólo contempla nombre, descripcion y activo, y Zod descarta las claves extra sin error. Un diagrama cargado mal (por ejemplo 14x14 en vez de 14x7) sólo se puede arreglar borrándolo y recreándolo, y si ya tiene asignaciones el DELETE responde 409 o hace soft-delete. El cálculo de días franco en POST /planillas/:id/enviar depende directamente de estos valores.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/diagramas {"nombre":"tmp-rot","tipo":"ROTATIVO","diasTrabajo":12,"diasDescanso":4} → 201 <did>. 3) PUT /admin/diagramas/<did> {"nombre":"tmp-rot2","diasTrabajo":21,"diasDescanso":7}. 4) Mirar la respuesta: el nombre cambia pero diasTrabajo/diasDescanso siguen en 12 y 4.
- **Evidencia:** PUT /admin/diagramas/<did> {"nombre":"sim-admin-config-1784854841872-rot2","diasTrabajo":21,"diasDescanso":7} → HTTP 200, respuesta con diasTrabajo=12 y diasDescanso=4 (sin cambios).

### 🟡 MEDIA — Desactivar un rol con usuarios asignados los deja con rolNivel=0 (siguen pudiendo loguearse pero pierden todos los permisos), mientras que borrarlo sí se bloquea con 409
- **Endpoint:** `PUT /admin/roles/:id` · **Rol:** ADMIN
- **Esperado:** Coherencia con el DELETE: 409, o al menos una advertencia con el conteo de usuarios afectados. Un rol desactivado deja a sus usuarios en un limbo silencioso.
- **Obtenido:** El PUT devuelve 200. En auth.routes.ts la búsqueda de nivel es rolConfig.findFirst({ empresaId, codigo, activo: true }) con fallback ?? 0, así que el usuario sigue autenticándose pero con rolNivel=0: pierde todo, incluidas las rutas de nivel 10, sin ningún mensaje que explique por qué. Un ADMIN puede dejar sin acceso a un grupo entero con un click, y el 403 que reciben esos usuarios no menciona el rol desactivado.
- **Repro:** 1) Login admin@wenlen.com (Test1234!). 2) POST /admin/roles {"codigo":"TMP_ROL","nombre":"tmp rol","nivel":65} → 201 <rid>. 3) POST /usuarios {"nombre":"tmp","apellido":"x","email":"tmp2@sim.local","password":"Test1234!","rol":"OPERADOR","fechaIngreso":"2024-01-01"} y luego PUT /usuarios/<uid> {"rol":"TMP_ROL"} → 200. 4) Comprobar el comportamiento correcto: DELETE /admin/roles/<rid> → 409 'No se puede eliminar: 1 usuario(s) tienen este rol asignado'. 5) PUT /admin/roles/<rid> {"activo":false} → observar el status. 6) POST /auth/login {"email":"tmp2@sim.local","password":"Test1234!"} y mirar user.rolNivel.
- **Evidencia:** PUT /admin/roles/8a21335f-8505-484e-9128-8d0354c8dc92 {"activo":false} → HTTP 200. POST /auth/login del usuario afectado → HTTP 200 con "rolNivel":0. Antes de desactivarlo, DELETE del mismo rol → HTTP 409 'No se puede eliminar: 1 usuario(s) tienen este rol asignado'.

### 🟡 MEDIA — GET /usuarios/:id no aplica ningún filtro de rol ni de sector: cualquier usuario autenticado lee la ficha completa de cualquier empleado de la empresa
- **Endpoint:** `GET /usuarios/:id` · **Rol:** SUPERVISOR / OPERADOR
- **Esperado:** 403/404 para un usuario fuera del alcance del solicitante (mismo criterio de sector/jerarquía que GET /usuarios), o al menos ocultar los campos personales.
- **Obtenido:** 200 en ambos casos, con el registro completo del empleado ajeno: dni, cuil, fechaNacimiento, telefono, fechaIngreso, fechaFinPrueba, tipoContrato, diasVacacionesSaldo/Usados, supervisorId, coordinadorId, sector y empresa.
- **Repro:** 1) Login gustavo.ponce@demo.com (OPERADOR, sector Almacén) y ricardo.vargas@demo.com (SUPERVISOR, sector Almacén). 2) GET /usuarios con cualquiera de los dos tokens → devuelve SOLO usuarios de Almacén (13 items); el filtro por sector está en usuarios.routes.ts:110-121 para nivel < 90. 3) Tomar el id de franco.alvarez@demo.com (OPERADOR de Fractura) = b665d83e-8b29-4663-baa6-2fe9043ded01 y hacer GET /usuarios/b665d83e-8b29-4663-baa6-2fe9043ded01 con el token del OPERADOR y con el del SUPERVISOR. Causa raíz: usuarios.routes.ts:152-186 — el handler sólo filtra por empresaId, no tiene requireLevel ni chequeo de sector/jerarquía, a diferencia de GET /usuarios y de GET /usuarios/:id/ficha (que sí 
- **Evidencia:** GET /usuarios/b665d83e-8b29-4663-baa6-2fe9043ded01 → 200 (token ricardo.vargas, SUPERVISOR de Almacén) y 200 (token gustavo.ponce, OPERADOR de Almacén). Campos presentes en el body: dni, cuil, fechaNacimiento, telefono, fechaIngreso, diasVacacionesSaldo, supervisorId (en el seed dni/cuil/telefono es

### ⚪ BAJA — GET /auditoria no sanea limit negativo: ?limit=-5 devuelve 15 filas arbitrarias en vez de error
- **Endpoint:** `GET /auditoria` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400 (o clamp a un mínimo de 1): un limit negativo debería rechazarse, no cambiar la semántica del orden
- **Obtenido:** 200 con 15 filas que no corresponden ni al orden ni a la cantidad esperada
- **Repro:** 1) Login ana.martinez@demo.com. 2) GET /auditoria?limit=-5 → 200 con 15 filas. 3) GET /auditoria?limit=100 → 200 con 100 filas. Causa: auditoria.routes.ts:18 hace `Math.min(Number(lim) || 100, 500)` sin cota inferior; con -5 se pasa `take:-5` a las 4 consultas Prisma (que devuelve los 5 más antiguos de cada tabla, no los más recientes) y luego `results.slice(0, -5)` recorta los últimos 5 del agregado. El resultado no es ni el más reciente ni el tamaño pedido.
- **Evidencia:** GET /auditoria?limit=-5 → HTTP 200, 15 filas; GET /auditoria?limit=100 → HTTP 200, 100 filas

### ⚪ BAJA — PUT /admin/config con un campo aceptado por zod pero inexistente en el modelo (horasViajeDefault) devuelve 500
- **Endpoint:** `PUT /admin/config` · **Rol:** ADMIN (admin@wenlen.com)
- **Esperado:** 400 'Datos inválidos' (campo desconocido) o soporte real del campo.
- **Obtenido:** HTTP 500 {"error":"Error interno"}. La config no se corrompe (Prisma valida antes de escribir), pero el admin no tiene forma de saber qué pasó.
- **Repro:** 1) Login admin@wenlen.com. 2) PUT /admin/config {horasViajeDefault:3}. Lo mismo con {zonaHoraria:'America/Argentina/Buenos_Aires'} o {moneda:'ARS'}: los tres están en updateConfigSchema (admin.config.routes.ts, líneas 24-28) pero no existen en el modelo EmpresaConfig, así que el objeto validado se pasa tal cual a prisma.empresaConfig.update.
- **Evidencia:** PUT /admin/config {horasViajeDefault:3} → 500 {"error":"Error interno"}; GET posterior: {"almuerzo":60,"u50":8,"u100":12,"redondeo":15} (config intacta)

### ⚪ BAJA — PUT /admin/config trunca en silencio los decimales enviados a campos Int (6.7 se guarda como 6)
- **Endpoint:** `PUT /admin/config` · **Rol:** ADMIN
- **Esperado:** 400 'Datos inválidos'. El campo es Int en el modelo Prisma, pero el schema Zod lo declara z.number().min(0).max(24) sin .int(), a diferencia de redondeoMinutos y periodoDiaInicio/Fin que sí usan .int(). Afecta también a umbralExtra100, horasJornadaNormal y descuentoAlmuerzoMinutos.
- **Obtenido:** HTTP 200 y el valor se trunca hacia abajo sin ninguna advertencia (6.7 → 6, 5.2 → 5). Un admin que quiera configurar una jornada de 7.5h termina con 7 y horas extra mal calculadas para toda la empresa a partir de ese momento.
- **Repro:** 1) Login admin@wenlen.com (Test1234!); guardar GET /admin/config (umbralExtra50 original = 8). 2) PUT /admin/config {"umbralExtra50":6.7} → observar el valor devuelto. 3) PUT /admin/config {"umbralExtra50":5.2} → observar. 4) RESTAURAR: PUT /admin/config {"umbralExtra50":8}.
- **Evidencia:** PUT /admin/config {"umbralExtra50":6.7} → HTTP 200, guardado=6. PUT /admin/config {"umbralExtra50":5.2} → HTTP 200, guardado=5.

---

## WENTOP — 20 (3 alta, 13 media, 4 baja)

### 🟠 ALTA — Un OPERADOR puede gestionar el estado de su propia tarjeta: la pasa a EN_PROGRESO, la CIERRA, y hasta reabre un cierre firmado por CMASS borrando accionCierre ✅
- **Endpoint:** `PATCH /api/v1/wentop/:id/estado` · **Rol:** OPERADOR (daniel.aguirre@demo.com, nivel 10)
- **Esperado:** Cambiar estado (EN_PROGRESO / CERRADA) y reabrir deberia ser exclusivo de quien puede gestionar (CMASS, nivel>=90, nivel>=70 del sector, o gestor asignado del sector), igual que decide el frontend con canManageCard(). Para el operador creador: 403. Ademas, reabrir no deberia destruir accionCierre/fechaCierre historicos.
- **Obtenido:** El operador creador (nivel 10) obtiene 200 en EN_PROGRESO, en CERRADA con accionCierre propio, y en la reapertura de una tarjeta cerrada por CMASS, quedando accionCierre=null y fechaCierre=null.
- **Repro:** 1) POST /auth/login {email:'daniel.aguirre@demo.com',password:'Test1234!'} -> token D. 2) POST /wentop con {fechaReporte:new Date().toISOString(), sectorObservacionId:'38a79ee4-20be-426d-9df2-aa4b3388f317', tipoTarjeta:'ACTO_INSEGURO', descripcion:'sim-op-wentop-x'} con token D -> 201, id=T. 3) PATCH /wentop/T/estado {estado:'EN_PROGRESO'} con token D -> 200 (el front WentopPage.tsx solo muestra ese boton si canManageCard(): CMASS | nivel>=90 | nivel>=70 del sector | gestor del sector; el operador creador NO cumple ninguna). 4) PATCH /wentop/T/estado {estado:'CERRADA', accionCierre:'cierro yo mismo'} con token D -> 200: el propio reportante cierra su observacion de seguridad sin intervencion
- **Evidencia:** PATCH /wentop/<id>/estado {estado:'EN_PROGRESO'} -> HTTP 200 {"estado":"EN_PROGRESO"...} PATCH .../estado {estado:'CERRADA',accionCierre:'sim-op-wentop-... cierre por el operador creador'} -> HTTP 200 {"estado":"CERRADA","accionCierre":"sim-op-wentop-1784854671514 - cierre por el operador creador","

### 🟠 ALTA — GET /wentop (listado) no devuelve fotos[]; el modal de detalle del front hace tarjeta.fotos.length sobre ese mismo item y revienta al abrir cualquier tarjeta ✅
- **Endpoint:** `GET /api/v1/wentop` · **Rol:** OPERADOR (daniel.aguirre@demo.com) - aplica a todos los roles
- **Esperado:** O el listado incluye fotos[] (como declara la interfaz WentopTarjeta del front, que marca fotos como obligatorio y _count como opcional), o el detalle se re-consulta con GET /wentop/:id antes de abrir el modal.
- **Obtenido:** El item del listado solo trae _count:{fotos:n}; fotos es undefined, lo que rompe el render del modal de detalle.
- **Repro:** 1) Login daniel.aguirre@demo.com. 2) GET /wentop -> 200. 3) Inspeccionar las claves de cualquier item: id, empresaId, creadorId, sectorObservacionId, sectorTercero, estado, fechaReporte, cliente, lugarPozoLocacion, tipoTarjeta, calidad, medioambiente, seguridadSalud, descripcion, accionesInmediatas, recomendaciones, justificacionAbierta, accionCierre, fechaCierre, createdAt, updatedAt, creador, sectorObservacion, _count. NO viene 'fotos'. 4) En el front (apps/web/src/pages/WentopPage.tsx) la lista pasa el item crudo al modal: linea 423 onSelect={(t)=>{setSelectedTarjeta(t); setShowDetail(true);}} y el modal renderiza en la linea 1281 `{tarjeta.fotos.length > 0 && (` -> TypeError: Cannot read
- **Evidencia:** GET /wentop -> HTTP 200; keys del item = id,empresaId,creadorId,sectorObservacionId,sectorTercero,estado,fechaReporte,cliente,lugarPozoLocacion,tipoTarjeta,calidad,medioambiente,seguridadSalud,descripcion,accionesInmediatas,recomendaciones,justificacionAbierta,accionCierre,fechaCierre,createdAt,upda

### 🟠 ALTA — CMASS no puede asignar ni quitar gestores WENTOP aunque el front le muestra el ABM completo
- **Endpoint:** `POST /wentop/gestores y DELETE /wentop/gestores/:id` · **Rol:** CMASS (sandra.montenegro@demo.com, nivel 75)
- **Esperado:** 201/204 para CMASS. El front (apps/web/src/pages/WentopPage.tsx:258-259) define canManageGestores = rol==='CMASS' || rol==='RRHH' || rol==='ADMIN' || rolNivel>=75, muestra la pestaña 'Gestores' y renderiza el alta/baja (líneas 371, 435, 979, 992); además el GET del mismo recurso está abierto a nivel 75. WENTOP es el módulo propio del rol CMASS.
- **Obtenido:** 403 'No tiene permisos para esta acción' — wentop.routes.ts:228 y 275 usan requireLevel(LEVEL_RRHH)=90 mientras el GET de la línea 208 usa LEVEL_CMASS=75. El CMASS entra a una pantalla de gestión donde toda acción falla.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) GET /wentop/gestores → 200 (el listado sí es nivel CMASS: requireLevel(LEVEL_CMASS)). 3) POST /wentop/gestores {usuarioId:'c8f269e4-afe9-4ed7-a035-1310deb2b0d0' (javier.paredes), sectorId:'6ee3adf3-0dfc-4171-addd-524e0a43d898' (Fractura)} → observar 403. 4) Idem DELETE /wentop/gestores/{id} de un gestor existente → 403. 5) Con ana.martinez@demo.com (RRHH) las dos operaciones funcionan (201 / 204).
- **Evidencia:** POST /wentop/gestores (sandra) → HTTP 403 {"error":"No tiene permisos para esta acción"}; GET /wentop/gestores (sandra) → HTTP 200 []; POST /wentop/gestores (ana, RRHH) → HTTP 201 {"id":"6338aa32-158a-4811-8876-7af05f1928e9",...}

### 🟡 MEDIA — Las fotos de las tarjetas se sirven en /uploads sin ninguna autenticacion ✅
- **Endpoint:** `GET /uploads/:filename (POST /api/v1/wentop/:id/fotos devuelve la URL)` · **Rol:** sin autenticar (anonimo)
- **Esperado:** La evidencia fotografica deberia entregarse detras de autenticacion y con el mismo control de visibilidad que la tarjeta (401/403 sin token).
- **Obtenido:** HTTP 200 con la imagen para cualquier peticion anonima.
- **Repro:** 1) Login daniel.aguirre@demo.com; POST /wentop -> id=T. 2) POST /wentop/T/fotos (multipart, campo 'fotos', PNG valido) -> 201 [{id, url:'/uploads/<uuid>.png'}]. 3) Sin ningun header Authorization: GET http://localhost:4000/uploads/<uuid>.png -> 200 image/png con el contenido del archivo. Cualquiera que obtenga la URL (se devuelve a todos los usuarios que ven la tarjeta) accede a la evidencia fotografica sin token y sin control de empresa/sector. Causa: apps/api/src/app.ts:101 -> app.use('/uploads', express.static(...)) montado sin authMiddleware.
- **Evidencia:** GET http://localhost:4000/uploads/d0337b7d-a35e-468e-9ac4-de4920c1bac9.png (sin Authorization) -> HTTP 200, content-type image/png, content-length 70

### 🟡 MEDIA — GET /wentop con filtros de enum invalidos (estado / tipoTarjeta) devuelve 500 en vez de 400
- **Endpoint:** `GET /api/v1/wentop?estado=NOPE  y  GET /api/v1/wentop?tipoTarjeta=NOPE` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 con mensaje de valor invalido (como ya se hace con desde/hasta), o ignorar el filtro desconocido.
- **Obtenido:** HTTP 500 {"error":"Error interno del servidor"} - un filtro tipeado a mano o un querystring guardado en un bookmark tumba el listado entero.
- **Repro:** 1) Login daniel.aguirre@demo.com. 2) GET /wentop?estado=NOPE -> 500. 3) GET /wentop?tipoTarjeta=NOPE -> 500. Contraste: GET /wentop?desde=garbage si valida y devuelve 400 ('Parametro "desde" invalido'). Causa: en apps/api/src/routes/wentop.routes.ts el handler GET / asigna where.estado / where.tipoTarjeta con el string crudo del query y Prisma lanza PrismaClientValidationError sobre el enum, que cae en el error handler global (app.ts:109) como 500.
- **Evidencia:** GET /wentop?estado=NOPE -> HTTP 500 {"error":"Error interno del servidor"} GET /wentop?tipoTarjeta=NOPE -> HTTP 500 {"error":"Error interno del servidor"}

### 🟡 MEDIA — POST /wentop: sectorObservacionId inexistente y sectorTercero no booleano provocan 500 (sin validacion de entrada) ✅
- **Endpoint:** `POST /api/v1/wentop` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 'Sector no encontrado en esta empresa' / 400 'sectorTercero debe ser booleano' (el propio endpoint POST /wentop/gestores si valida que el sector exista y sea de la empresa).
- **Obtenido:** HTTP 500 {"error":"Error interno del servidor"} en ambos casos.
- **Repro:** 1) Login daniel.aguirre@demo.com. 2) POST /wentop {fechaReporte:new Date().toISOString(), tipoTarjeta:'CONDICION_INSEGURA', descripcion:'sim-op-wentop-x', sectorObservacionId:'00000000-0000-0000-0000-000000000000'} -> 500 (violacion de FK contra sectores). 3) POST /wentop {fechaReporte:..., tipoTarjeta:'CONDICION_INSEGURA', descripcion:'sim-op-wentop-x', sectorTercero:'si'} -> 500 (Boolean recibe string). El handler solo valida fechaReporte, tipoTarjeta y descripcion; el resto llega crudo a prisma.wentopTarjeta.create.
- **Evidencia:** POST /wentop {...,"sectorObservacionId":"00000000-0000-0000-0000-000000000000"} -> HTTP 500 {"error":"Error interno del servidor"} POST /wentop {...,"sectorTercero":"si"} -> HTTP 500 {"error":"Error interno del servidor"}

### 🟡 MEDIA — POST y PUT /wentop aceptan un sectorObservacionId de OTRA empresa (referencia cross-tenant y filtracion del nombre del sector ajeno)
- **Endpoint:** `POST /api/v1/wentop  y  PUT /api/v1/wentop/:id` · **Rol:** OPERADOR (daniel.aguirre@demo.com, empresa 32e126e4-e36b-484b-9233-205922a2840a)
- **Esperado:** 400 'Sector no encontrado en esta empresa', validando que sectorObservacionId pertenezca a req.user.empresaId (como hace POST /wentop/gestores).
- **Obtenido:** 201/200 y la tarjeta queda ligada a un sector de otra empresa, devolviendo su nombre al usuario.
- **Repro:** 1) Login daniel.aguirre@demo.com (empresaId 32e126e4-e36b-484b-9233-205922a2840a). 2) POST /wentop {fechaReporte:new Date().toISOString(), tipoTarjeta:'CONDICION_INSEGURA', descripcion:'sim-op-wentop-x', sectorObservacionId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe'} (ese sector pertenece a la empresa 62e25426-f39e-4a73-8a19-fc35c3e44f36) -> 201. La respuesta incluye sectorObservacion:{id:'7cf448a4...', nombre:'Fractura'}: la API le devuelve al operador el nombre de un sector de otra empresa. 3) Lo mismo con PUT /wentop/<id_propio> {sectorObservacionId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe'} -> 200. 4) Efecto colateral: la tarjeta queda apuntando a un sector que no existe en el selector del fron
- **Evidencia:** POST /wentop -> HTTP 201 {"id":"6eaf86cf-...","empresaId":"32e126e4-e36b-484b-9233-205922a2840a","sectorObservacionId":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe",...,"sectorObservacion":{"id":"7cf448a4-7e6b-4d71-b880-93f34ecdecbe","nombre":"Fractura"}} PUT /wentop/43033c65-... -> HTTP 200 con sectorObse

### 🟡 MEDIA — PUT /wentop/:id con descripcion:null devuelve 500 (campo obligatorio sin validar en el update)
- **Endpoint:** `PUT /api/v1/wentop/:id` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 'descripcion es requerida' (POST si lo valida: POST sin descripcion -> 400).
- **Obtenido:** HTTP 500 {"error":"Error interno del servidor"}.
- **Repro:** 1) Login daniel.aguirre@demo.com; POST /wentop valido -> id=T (estado ABIERTA). 2) PUT /wentop/T {descripcion:null} -> 500. El handler solo revalida tipoTarjeta y fechaReporte; descripcion pasa directo a prisma.update sobre una columna NOT NULL.
- **Evidencia:** PUT /wentop/<id> {"descripcion":null} -> HTTP 500 {"error":"Error interno del servidor"}  (comparar: POST /wentop sin descripcion -> HTTP 400 {"error":"fechaReporte, tipoTarjeta y descripcion son requeridos"})

### 🟡 MEDIA — calidad / medioambiente / seguridadSalud aceptan cualquier JSON (p.ej. un string) en POST y PUT, rompiendo el contrato de arrays que consume el front
- **Endpoint:** `POST /api/v1/wentop  y  PUT /api/v1/wentop/:id` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 si calidad/medioambiente/seguridadSalud no son arrays de strings (o normalizar a []).
- **Obtenido:** 201/200: el string se persiste tal cual en las columnas Json y se devuelve al front.
- **Repro:** 1) Login daniel.aguirre@demo.com. 2) POST /wentop {fechaReporte:new Date().toISOString(), tipoTarjeta:'CONDICION_INSEGURA', descripcion:'sim-op-wentop-x', calidad:'esto-no-es-un-array'} -> 201 y la respuesta trae calidad:"esto-no-es-un-array". 3) PUT /wentop/<id> {calidad:'no-array'} -> 200 con calidad:"no-array". 4) Ese valor vuelve en GET /wentop y GET /wentop/:id; el front (WentopPage.tsx:1193 y 1196) hace tarjeta.calidad.length y tarjeta.calidad.map(...) sobre lo que espera que sea string[] -> el modal de detalle renderiza mal o rompe, y analytics.porCategoria ignora el registro (countLabels descarta lo que no es Array).
- **Evidencia:** POST /wentop {...,"calidad":"esto-no-es-un-array"} -> HTTP 201 {"id":"2560da3f-...",...,"calidad":"esto-no-es-un-array"} PUT /wentop/43033c65-... {"calidad":"no-array"} -> HTTP 200 con "calidad":"no-array"

### 🟡 MEDIA — POST /wentop/:id/fotos con un archivo no permitido devuelve 500 y se pierde el mensaje del filtro de multer
- **Endpoint:** `POST /api/v1/wentop/:id/fotos` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 con el mensaje del filtro ('Solo se permiten imagenes (jpg, png, gif, webp) y PDF'), para que el usuario entienda por que no se subio la foto.
- **Obtenido:** HTTP 500 {"error":"Error interno del servidor"}.
- **Repro:** 1) Login daniel.aguirre@demo.com; POST /wentop -> id=T. 2) POST /wentop/T/fotos como multipart/form-data con un campo 'fotos' cuyo archivo sea 'x.exe' (mimetype application/x-msdownload) -> 500. Causa: el fileFilter de apps/api/src/middleware/upload.middleware.ts hace cb(new Error('Solo se permiten imagenes (jpg, png, gif, webp) y PDF')) y ese error cae en el error handler global (app.ts:109) que responde 500 con mensaje generico. Lo mismo aplicaria a LIMIT_FILE_SIZE (>5MB).
- **Evidencia:** POST /wentop/<id>/fotos (multipart, archivo sim-op-wentop.exe, application/x-msdownload) -> HTTP 500 {"error":"Error interno del servidor"}  (comparar: sin archivos -> HTTP 400 {"error":"No se enviaron archivos"})

### 🟡 MEDIA — El GERENTE (nivel 80) no ve ninguna tarjeta WENTOP y su analytics devuelve todo en cero
- **Endpoint:** `GET /wentop, GET /wentop/analytics, GET /wentop/:id, PATCH /wentop/:id/estado` · **Rol:** GERENTE (laura.gonzalez@demo.com, nivel 80, sin sector)
- **Esperado:** Un GERENTE (nivel superior a CMASS 75 y a COORDINADOR 70) debería al menos ver el tablero HSE de la empresa o de sus sectores; hoy ve estrictamente menos que un SUPERVISOR. buildVisibilityWhere (wentop.routes.ts:47-77) sólo abre todo para rol==='CMASS' o nivel>=90 y para el resto arma la lista con sectorId propio + gestorías, de modo que un gerente sin sector queda con visibilidad cero.
- **Obtenido:** GET /wentop → 200 [] (0 tarjetas, mientras CMASS ve 16); GET /wentop/analytics → 200 con totales en cero (dashboard silenciosamente vacío, sin error); GET /wentop/:id → 404; PATCH estado → 403.
- **Repro:** 1) Como sandra.montenegro@demo.com crear una tarjeta: POST /wentop {fechaReporte:'2026-07-21T00:00:00.000Z', sectorObservacionId:'5d35981c-938a-492e-b592-43d3154c702c', tipoTarjeta:'CONDICION_INSEGURA', descripcion:'x'} → tarjetaId. 2) login laura.gonzalez@demo.com (GERENTE 80). 3) GET /wentop → observar cantidad. 4) GET /wentop/analytics → observar totales. 5) GET /wentop/{tarjetaId} → 404. 6) PATCH /wentop/{tarjetaId}/estado {estado:'EN_PROGRESO'} → 403. Contrastar con javier.paredes@demo.com (SUPERVISOR 60), que sí ve las de su sector.
- **Evidencia:** laura nivel=80 rol=GERENTE sector=null | GET /wentop → HTTP 200 (0) mientras CMASS ve 16 | GET /wentop/analytics → HTTP 200 {"total":0,"abierta":0,"enProgreso":0,"cerrada":0} | GET /wentop/f4232b71-1fae-49f1-8712-03f7a084cb72 → HTTP 404 {"error":"Tarjeta no encontrada"} | PATCH estado → HTTP 403 {"e

### 🟡 MEDIA — El OPERADOR que reporta una tarjeta WENTOP puede cerrarla y reabrirla él mismo, sin intervención de CMASS
- **Endpoint:** `PATCH /wentop/:id/estado` · **Rol:** OPERADOR (agustin.delgado@demo.com, nivel 10)
- **Esperado:** 403. El cierre de una observación HSE debería requerir el rol gestor (CMASS / gestor del sector / nivel>=70 del sector). El propio front no ofrece la acción al creador: canManageCard (WentopPage.tsx:294-306) sólo habilita CMASS, nivel>=90, nivel>=70 del mismo sector o gestor asignado — el creador no está incluido, pero la API sí lo acepta (wentop.routes.ts:515-521 usa isCreator || canManage).
- **Obtenido:** 200 en ambas transiciones: el reportante cierra su propia tarjeta con una justificación autofirmada y puede reabrirla y volver a cerrarla a voluntad. La API concede más que la UI.
- **Repro:** 1) login agustin.delgado@demo.com. 2) POST /wentop {fechaReporte:'2026-07-17T00:00:00.000Z', sectorObservacionId:'5d35981c-938a-492e-b592-43d3154c702c', tipoTarjeta:'CASI_ACCIDENTE', descripcion:'x'} → tarjetaId (estado ABIERTA). 3) Con el MISMO token: PATCH /wentop/{tarjetaId}/estado {estado:'CERRADA', accionCierre:'me lo cierro yo mismo'} → observar 200 y estado CERRADA. 4) PATCH /wentop/{tarjetaId}/estado {estado:'ABIERTA'} → 200 otra vez.
- **Evidencia:** PATCH /wentop/61456362-1da0-4bdd-ad85-27fdfb1b2f83/estado {estado:'CERRADA',accionCierre:'...'} con token de agustin.delgado → HTTP 200, body.estado="CERRADA"; PATCH {estado:'ABIERTA'} → HTTP 200

### 🟡 MEDIA — Filtros estado/tipoTarjeta con valores inválidos en GET /wentop devuelven 500
- **Endpoint:** `GET /wentop?estado=BASURA y GET /wentop?tipoTarjeta=BASURA` · **Rol:** CMASS (sandra.montenegro@demo.com); reproducible con cualquier rol
- **Esperado:** 400 'Estado inválido' / 'tipoTarjeta inválido' — los valores válidos ya están declarados (VALID_TIPOS y el enum WentopEstado) y el mismo handler valida desde/hasta correctamente.
- **Obtenido:** 500 'Error interno del servidor': wentop.routes.ts:305-306 pasa el query string crudo a Prisma sobre columnas enum y la excepción se traga como error de servidor.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) GET /wentop?estado=BASURA → observar 500. 3) GET /wentop?tipoTarjeta=BASURA → observar 500. Comparar con GET /wentop?desde=basura, que sí devuelve 400.
- **Evidencia:** GET /wentop?estado=BASURA → HTTP 500 {"error":"Error interno del servidor"}; GET /wentop?tipoTarjeta=BASURA → HTTP 500 {"error":"Error interno del servidor"}; GET /wentop?desde=basura → HTTP 400 {"error":"Parámetro \"desde\" inválido"}

### 🟡 MEDIA — PATCH /wentop/:id/estado con fechaCierre inválida devuelve 500
- **Endpoint:** `PATCH /wentop/:id/estado` · **Rol:** CMASS (sandra.montenegro@demo.com)
- **Esperado:** 400 'fechaCierre inválida'. El mismo archivo ya valida fechaReporte con isNaN(new Date(x).getTime()) en POST (línea 389) y en PUT (línea 470); en PATCH /estado (línea 538) hace new Date(fechaCierre) sin validar.
- **Obtenido:** 500 'Error interno del servidor' (Invalid Date llega a Prisma). Un front que mande la fecha en un formato no parseable recibe un error genérico de servidor en vez de un mensaje de validación.
- **Repro:** 1) Como sandra crear una tarjeta (POST /wentop {fechaReporte:'2026-07-15T00:00:00.000Z', tipoTarjeta:'CONDICION_INSEGURA', descripcion:'x'}). 2) PATCH /wentop/{id}/estado {estado:'CERRADA', accionCierre:'cierre', fechaCierre:'no-es-una-fecha'} → observar 500.
- **Evidencia:** PATCH /wentop/5a8fe889-f68b-4c70-9080-10cf4e86c861/estado {estado:'CERRADA',accionCierre:'...',fechaCierre:'no-es-una-fecha'} → HTTP 500 {"error":"Error interno del servidor"}

### 🟡 MEDIA — POST /wentop acepta un sectorObservacionId de OTRA empresa (dato cross-tenant)
- **Endpoint:** `POST /wentop (y PUT /wentop/:id)` · **Rol:** CMASS (sandra.montenegro@demo.com); cualquier rol autenticado puede hacerlo
- **Esperado:** 400 'Sector no encontrado en esta empresa'. POST /wentop/gestores en el mismo router sí valida que el sector pertenezca a req.user.empresaId (wentop.routes.ts:238-250); el alta de tarjetas no valida nada.
- **Obtenido:** 201: la tarjeta queda con sectorObservacionId de otra empresa. Efecto colateral: esa tarjeta se cuenta en analytics/porSector con el nombre de un sector ajeno y queda fuera del alcance de todos los guards de sector locales.
- **Repro:** 1) login sandra.montenegro@demo.com (empresa 32e126e4-e36b-484b-9233-205922a2840a). 2) POST /wentop {fechaReporte:'2026-07-19T00:00:00.000Z', sectorObservacionId:'011fe4bd-0a8d-41d4-87d0-85ab565d149f' (sector de la empresa f4252b64-d6c3-41f9-bc89-ecd5938ad9fb), tipoTarjeta:'ACTO_INSEGURO', descripcion:'x'} → observar 201. 3) GET /wentop/{id} devuelve sectorObservacion de la otra empresa.
- **Evidencia:** HTTP 201 {"id":"69ac92b2-d6df-40d3-939a-29baf8b7cbcb","empresaId":"32e126e4-e36b-484b-9233-205922a2840a","sectorObservacionId":"011fe4bd-0a8d-41d4-87d0-85ab565d149f",...}

### 🟡 MEDIA — Reabrir una tarjeta CERRADA borra accionCierre/fechaCierre y permite saltear el bloqueo de edición de cerradas
- **Endpoint:** `PATCH /wentop/:id/estado + PUT /wentop/:id` · **Rol:** CMASS (sandra.montenegro@demo.com, nivel 75)
- **Esperado:** O bien exigir una justificación/motivo de reapertura y conservar el historial de cierre, o bien restringir la reapertura a nivel >= 90 (mismo criterio que el guard de edición de cerradas, que exime a nivel 90). Hoy no hay validación alguna y el dato del cierre anterior se pierde sin traza (no hay tabla de historial para WENTOP).
- **Obtenido:** 200: cualquier gestor de la tarjeta la reabre sin motivo, se borran accionCierre y fechaCierre (wentop.routes.ts:539-543) y con eso queda habilitado el PUT que segundos antes devolvía 400 — el guard 'no se puede editar una tarjeta cerrada' es evitable en dos llamadas.
- **Repro:** 1) Como sandra crear una tarjeta y cerrarla: PATCH /wentop/{id}/estado {estado:'CERRADA', accionCierre:'se reemplazó el EPP', fechaCierre:'2026-07-20T00:00:00.000Z'} → 200. 2) PUT /wentop/{id} {descripcion:'editada'} → 400 'No se puede editar una tarjeta cerrada'. 3) PATCH /wentop/{id}/estado {estado:'ABIERTA'} (sin justificación) → observar 200 y que accionCierre y fechaCierre quedaron en null. 4) PUT /wentop/{id} {descripcion:'editada'} → ahora 200.
- **Evidencia:** PATCH {estado:'ABIERTA'} → HTTP 200 {"estado":"ABIERTA","accionCierre":null,"fechaCierre":null}; PUT /wentop/{id} antes → HTTP 400 {"error":"No se puede editar una tarjeta cerrada"}, después → HTTP 200

### ⚪ BAJA — PATCH /:id/estado no valida fechaCierre: string invalido da 500 y fechas absurdas (ano 3999 o anteriores a fechaReporte) se aceptan
- **Endpoint:** `PATCH /api/v1/wentop/:id/estado` · **Rol:** OPERADOR (daniel.aguirre@demo.com)
- **Esperado:** 400 en fecha invalida (como ya se hace con fechaReporte en POST/PUT) y rechazo de fechas de cierre anteriores a fechaReporte o muy en el futuro; esas fechas alimentan reportes de tiempos de cierre.
- **Obtenido:** 500 con string invalido; 200 con 3999-01-01 y con 1990-01-01 (anterior al reporte).
- **Repro:** 1) Login daniel.aguirre@demo.com; POST /wentop valido -> id=T (fechaReporte = hoy). 2) PATCH /wentop/T/estado {estado:'CERRADA', accionCierre:'sim-op-wentop-cierre', fechaCierre:'no-es-fecha'} -> 500 (new Date('no-es-fecha') = Invalid Date llega a Prisma). 3) PATCH /wentop/T/estado {estado:'CERRADA', accionCierre:'sim-op-wentop-cierre', fechaCierre:'3999-01-01'} -> 200, fechaCierre='3999-01-01T00:00:00.000Z'. 4) PATCH /wentop/T/estado {estado:'CERRADA', accionCierre:'sim-op-wentop-cierre', fechaCierre:'1990-01-01'} -> 200, fechaCierre anterior a la fechaReporte de la observacion.
- **Evidencia:** PATCH .../estado {estado:'CERRADA',accionCierre:'...',fechaCierre:'no-es-fecha'} -> HTTP 500 {"error":"Error interno del servidor"} PATCH .../estado {...,fechaCierre:'3999-01-01'} -> HTTP 200 {"estado":"CERRADA","fechaCierre":"3999-01-01T00:00:00.000Z","fechaReporte":"2026-07-24T00:57:51.685Z"} PATC

### ⚪ BAJA — Se acepta una fechaCierre anterior a la fechaReporte de la tarjeta
- **Endpoint:** `PATCH /wentop/:id/estado` · **Rol:** CMASS (sandra.montenegro@demo.com)
- **Esperado:** 400: la fecha de cierre no puede ser anterior a la de reporte (ni, razonablemente, futura). Distorsiona cualquier indicador de tiempo de resolución en el tablero HSE.
- **Obtenido:** 200, la tarjeta queda con fechaCierre 2020-01-01 y fechaReporte 2026-07-15.
- **Repro:** 1) Como sandra crear la tarjeta con fechaReporte:'2026-07-15T00:00:00.000Z'. 2) PATCH /wentop/{id}/estado {estado:'CERRADA', accionCierre:'cierre retroactivo', fechaCierre:'2020-01-01T00:00:00.000Z'} → observar 200 y el body con fechaCierre < fechaReporte.
- **Evidencia:** HTTP 200 {"estado":"CERRADA","fechaCierre":"2020-01-01T00:00:00.000Z","fechaReporte":"2026-07-15T00:00:00.000Z"}

### ⚪ BAJA — GET /wentop/analytics: porSector no suma el total porque omite las tarjetas sin sector de observación
- **Endpoint:** `GET /wentop/analytics` · **Rol:** CMASS (sandra.montenegro@demo.com)
- **Esperado:** O un bucket 'Sin sector' o que la respuesta documente la diferencia; hoy un gráfico de torta por sector construido sobre totales.total muestra porcentajes que no cierran.
- **Obtenido:** totales.total=15 pero la suma de porSector=8 (7 tarjetas con sectorObservacionId null quedan fuera). Los conteos por estado y por tipo sí cuadran exactamente con el listado real de GET /wentop.
- **Repro:** 1) Como sandra crear una tarjeta sin sectorObservacionId: POST /wentop {fechaReporte:'2026-07-18T00:00:00.000Z', tipoTarjeta:'OBSERVACION_POSITIVA', descripcion:'x'} → 201 (el campo es opcional). 2) GET /wentop/analytics. 3) Sumar los count de porSector y compararlos con totales.total.
- **Evidencia:** GET /wentop/analytics → totales {"total":15,"abierta":10,"enProgreso":3,"cerrada":2} (idénticos al recuento manual sobre GET /wentop) y suma de porSector = 8

### ⚪ BAJA — POST /wentop acepta fechaReporte del año 2999 y una descripción de 20.000 caracteres
- **Endpoint:** `POST /wentop` · **Rol:** CMASS (sandra.montenegro@demo.com); cualquier rol autenticado
- **Esperado:** 400 por fecha fuera de rango razonable (no se puede reportar una observación dentro de 970 años) y por longitud máxima de descripcion/accionesInmediatas/recomendaciones. El resto del proyecto sí usa límites zod (por ejemplo capacitaciones: nombre max 200, descripcion max 500/1000).
- **Obtenido:** 201 en ambos casos; la tarjeta queda en el listado y desplaza el orden por fechaReporte desc (aparece siempre primera) y rompe el layout de cualquier tabla.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) POST /wentop {fechaReporte:'2999-12-31T00:00:00.000Z', tipoTarjeta:'ACTO_INSEGURO', descripcion:'X'.repeat(20000)} → observar 201 y que body.descripcion.length ≈ 20.028.
- **Evidencia:** HTTP 201 {"id":"6364a24e-df86-4ae7-9ef2-42589b805fee",...} con descripcion.length=20028 y fechaReporte 2999-12-31

---

## VACACIONES — 15 (5 alta, 9 media, 1 baja)

### 🟠 ALTA — Crear una vacación no notifica a los aprobadores: el supervisor nunca se entera de la solicitud ✅
- **Endpoint:** `POST /vacaciones` · **Rol:** OPERADOR (miguel.pereyra@demo.com) / SUPERVISOR (roberto.acosta@demo.com)
- **Esperado:** Al quedar la solicitud en PENDIENTE paso 1, el aprobador de ese paso (supervisor del solicitante) recibe la notificación '📨 Nueva solicitud de vacaciones para revisar', igual que en el re-envío.
- **Obtenido:** Cero notificaciones tras el alta. El aprobador sólo se entera si entra a /aprobaciones por su cuenta. La notificación aparece únicamente si la solicitud es rechazada y re-enviada.
- **Repro:** 1) POST /auth/login {email:'roberto.acosta@demo.com',password:'Test1234!'} y GET /api/v1/notificaciones con su token → contar las de tipo VACACION (obtuve 3). 2) POST /auth/login {email:'miguel.pereyra@demo.com',password:'Test1234!'}. 3) POST /api/v1/vacaciones con su token, body {fechaInicio:'2026-10-05T00:00:00.000Z', fechaFin:'2026-10-06T00:00:00.000Z', diasHabiles:2, motivo:'sim-op-vacaciones verif-notif'} → 201 con estado PENDIENTE y pasoActual 1 (flujo 'Vacaciones - Supervisor → Coordinador → RRHH', paso 1 = SUPERVISOR). 4) Esperar 1s y volver a GET /api/v1/notificaciones con el token de roberto.acosta → sigue habiendo 3 de tipo VACACION. 5) Para confirmar la asimetría: POST /api/v1/va
- **Evidencia:** GET /notificaciones (roberto.acosta) antes: 3 de tipo VACACION. POST /vacaciones → 201 {"id":"dce3f12e-...","estado":"PENDIENTE","pasoActual":1,"flujoId":"d07b9926-..."}. GET /notificaciones después: 3 (sin cambios). Tras rechazar+/enviar → 4: {"tipo":"VACACION","titulo":"📨 Nueva solicitud de vacac

### 🟠 ALTA — GET /vacaciones/:id expone el detalle completo de cualquier empleado a cualquier usuario nivel>=60 de la empresa, incluso de otro sector ✅
- **Endpoint:** `GET /vacaciones/:id` · **Rol:** SUPERVISOR de otro sector (lucas.fernandez@demo.com, sector Fractura) sobre vacación de OPERADOR de Cabezales
- **Esperado:** 403 — un supervisor sólo debería ver el detalle de vacaciones de su sector / de sus subordinados, coherente con el filtrado de GET /vacaciones y con el gate de /gantt.
- **Obtenido:** 200 con el objeto completo, incluido `motivo` (dato personal, ej. 'tratamiento médico') e historial de aprobación.
- **Repro:** 1) Login miguel.pereyra@demo.com (Cabezales) y POST /api/v1/vacaciones {fechaInicio:'2026-11-16T00:00:00.000Z', fechaFin:'2026-11-17T00:00:00.000Z', diasHabiles:2, motivo:'sim-op-vacaciones aprobacion-flujo-completo'} → 201, guardar el id. 2) Login lucas.fernandez@demo.com (SUPERVISOR, sector Fractura, sin relación de supervisión ni de sector con miguel). 3) GET /api/v1/vacaciones/{id} con el token de lucas. Observar: devuelve 200 con el registro completo (motivo, fechas, historial con comentarios de los aprobadores, nombre/apellido/sector del empleado). Contrasta con GET /vacaciones (lista) que sí filtra por subordinados+sector, y con GET /vacaciones/gantt que exige puedeVerCalendario(). El
- **Evidencia:** GET /vacaciones/50f78275-b47e-4060-8ff5-f743dc4eb3e3 con token de lucas.fernandez@demo.com → HTTP 200 {"id":"50f78275-...","usuarioId":"cdfbca98-1e82-4f54-8a86-abdc1fd850f4","fechaInicio":"2026-11-16T00:00:00.000Z","fechaFin":"2026-11-17T00:00:00.000Z","diasHabiles":2,"diasTotales":2,"estado":"PENDI

### 🟠 ALTA — POST /vacaciones/:id/enviar no revalida solapamiento: se pueden dejar dos vacaciones vigentes pisadas y el saldo reservado dos veces por los mismos días ✅
- **Endpoint:** `POST /vacaciones/:id/enviar` · **Rol:** OPERADOR (andres.romero@demo.com), rechazo por SUPERVISOR (roberto.acosta@demo.com)
- **Esperado:** 409 'Ya tenés una vacación que se solapa con esas fechas' al re-enviar A, igual que en el alta.
- **Obtenido:** 200: el usuario queda con dos solicitudes vigentes solapadas y con doble reserva de saldo por los mismos días calendario. Si ambas se aprueban, diasUsados se incrementa dos veces por los mismos días.
- **Repro:** 1) Login andres.romero@demo.com. POST /api/v1/vacaciones {fechaInicio:'2027-03-02T00:00:00.000Z', fechaFin:'2027-03-04T00:00:00.000Z', diasHabiles:3, motivo:'sim solape-A'} → 201, id = A. 2) Login roberto.acosta@demo.com. POST /api/v1/vacaciones/{A}/rechazar {motivo:'no'} → 200, A queda RECHAZADA (y libera sus 3 días pendientes). 3) Con andres: POST /api/v1/vacaciones {fechaInicio:'2027-03-03T00:00:00.000Z', fechaFin:'2027-03-05T00:00:00.000Z', diasHabiles:3, motivo:'sim solape-B'} → 201 (correcto: A está RECHAZADA, no bloquea), id = B. 4) Con andres: POST /api/v1/vacaciones/{A}/enviar → 200, A vuelve a PENDIENTE. 5) GET /api/v1/vacaciones?scope=mio con andres → A y B ambas PENDIENTE, con fe
- **Evidencia:** POST /vacaciones/ff24b1ad-d1b7-4b44-8f96-3315b737391d/enviar → HTTP 200 {"id":"ff24b1ad-...","fechaInicio":"2027-03-02T00:00:00.000Z","fechaFin":"2027-03-04T00:00:00.000Z","estado":"PENDIENTE","pasoActual":1}. GET /vacaciones?scope=mio → 2 vigentes pisadas: 353c1180:PENDIENTE (03→05/03) y ff24b1ad:P

### 🟠 ALTA — El ajuste manual de saldos de vacaciones (PUT /vacacion-saldos/:id) no queda auditado pese a modificar días y marcar override
- **Endpoint:** `PUT /vacacion-saldos/:id → GET /auditoria` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** Entrada en el log con entidad 'VacacionSaldo', accion EDITAR, campo, valorAnterior y valorNuevo (ej. diasAjuste 0→3, diasCorrespondientes 14→30, override false→true) y usuarioId del actor
- **Obtenido:** 200 en el PUT, pero 0 entradas en /auditoria; el histórico del ajuste se pierde al siguiente ajuste (observaciones se pisa)
- **Repro:** 1) Login ana.martinez@demo.com. 2) GET /vacacion-saldos?anio=2026 → tomar un id de saldo (por ej. el de un usuario de prueba creado con POST /usuarios + POST /vacacion-saldos/generar {anio:2026}). 3) PUT /vacacion-saldos/<saldoId> {diasAjuste:3, observaciones:'sim-rrhh-personas-<ts>-ajuste manual por convenio'} → 200. 4) PUT /vacacion-saldos/<saldoId> {diasCorrespondientes:30} → 200 (además setea override=true). 5) GET /auditoria?tipo=admin&limit=500. Observar: no aparece ninguna entrada para <saldoId> ni con el texto de las observaciones. El campo `observaciones` es el único rastro y se sobrescribe en cada ajuste, sin quién ni cuándo ni valor anterior.
- **Evidencia:** PUT /vacacion-saldos/81a23edb-612d-436b-b8bf-23fa160878b7 → HTTP 200 {"diasAjuste":3,"observaciones":"sim-rrhh-personas-1784854749492-ajuste manual por convenio","override":true,"diasCorrespondientes":30}. GET /auditoria?tipo=admin&limit=500 → 200, ninguna fila con entidadId=81a23edb-612d-436b-b8bf-

### 🟠 ALTA — Los días de vacaciones ignoran reglasAntiguedad de vacaciones_config: en cada límite (5, 10 y 20 años) se otorgan 7 días menos de los configurados
- **Endpoint:** `POST /vacacion-saldos/generar` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 5 años→21 días, 10 años→28, 20 años→35 (según reglasAntiguedad de la empresa), y que un cambio en vacaciones_config se refleje en la generación
- **Obtenido:** 5 años→14 días, 10 años→21, 20 años→28 (7 días menos en cada tramo). La config de la empresa es ignorada por completo
- **Repro:** vacaciones_config de la empresa 32e126e4-e36b-484b-9233-205922a2840a tiene reglasAntiguedad=[{0-1:14},{1-5:14},{5-10:21},{10-20:28},{20-null:35}]. 1) Login ana.martinez@demo.com. 2) Crear usuarios con antigüedad exacta al 31-12-2030: POST /usuarios {..., email:'sim-rrhh-personas-<ts>-ant5@demo.com', rol:'OPERADOR', fechaIngreso:'2025-06-01'} (5 años), otro con fechaIngreso:'2020-06-01' (10 años), otro con '2010-06-01' (20 años), otro con '2026-06-01' (4 años) y otro con '2005-06-01' (25 años). 3) POST /vacacion-saldos/generar {anio:2030} → 200. 4) GET /vacacion-saldos?anio=2030 y leer diasCorrespondientes de cada uno. Causa: vacacion-saldos.routes.ts:13-26 tiene diasPorAntiguedad() hardcodea
- **Evidencia:** POST /vacacion-saldos/generar {anio:2030} → HTTP 200 {"created":113,"skipped":0,"total":113}; GET /vacacion-saldos?anio=2030 → 4 años: API 14 / config 14 (ok) | 5 años: API 14 / config 21 | 10 años: API 21 / config 28 | 20 años: API 28 / config 35 | 25 años: API 35 / config 35 (ok)

### 🟡 MEDIA — POST /vacaciones con diasHabiles fuera del rango Int32 responde 500 en vez de 400 ✅
- **Endpoint:** `POST /vacaciones` · **Rol:** OPERADOR (miguel.pereyra@demo.com)
- **Esperado:** 400 'Datos inválidos' con el detalle del campo (falta un .max() acorde al Int de la DB, p.ej. <= diasTotales).
- **Obtenido:** 500 'Error interno'.
- **Repro:** 1) Login miguel.pereyra@demo.com. 2) POST /api/v1/vacaciones {fechaInicio:'2026-10-20T00:00:00.000Z', fechaFin:'2026-10-20T00:00:00.000Z', diasHabiles:2147483648, motivo:'sim overflow'}. El schema zod sólo pide z.number().int().min(1); el valor pasa la validación y explota al insertar en la columna Int de Postgres, ya dentro de la transacción. Contraste: diasHabiles:1.5 sí devuelve 400 correctamente con detalle zod.
- **Evidencia:** POST /vacaciones {diasHabiles:2147483648} → HTTP 500 {"error":"Error interno"}. Con diasHabiles:1.5 → HTTP 400 {"error":"Datos inválidos","details":{"fieldErrors":{"diasHabiles":["Expected integer, received float"]}}}

### 🟡 MEDIA — GET /vacaciones/gantt revienta con 500 si el query param anio no es un año válido ✅
- **Endpoint:** `GET /vacaciones/gantt?anio=abc` · **Rol:** SUPERVISOR (roberto.acosta@demo.com); reproducible con cualquier rol con acceso al calendario
- **Esperado:** 400 'anio inválido' (o ignorar el parámetro y usar el año actual). Nunca 500, y nunca devolver un anio fraccionario/0 en la respuesta.
- **Obtenido:** 500 'Error interno' para abc/-5/999999; 200 con anio inválido eco (0 y 2026.5).
- **Repro:** 1) Login roberto.acosta@demo.com. 2) GET /api/v1/vacaciones/gantt?anio=abc → 500. Idem ?anio=-5 y ?anio=999999. 3) GET /api/v1/vacaciones/gantt?anio=0 → 200 pero devuelve {"anio":0,...}; ?anio=2026.5 → 200 con {"anio":2026.5,...}. Causa: `const year = anio ? Number(anio) : new Date().getFullYear()` y luego `new Date(year,0,1)`; con NaN o años fuera de rango se arma un Date inválido que Prisma rechaza.
- **Evidencia:** GET /vacaciones/gantt?anio=abc → HTTP 500 {"error":"Error interno"} · ?anio=-5 → 500 · ?anio=999999 → 500 · ?anio=2026.5 → 200 {"anio":2026.5,"sectores":[...],"empleados":[...]}

### 🟡 MEDIA — diasHabiles no se calcula ni se valida en el server: se acepta cualquier número del cliente (999 hábiles en un rango de 4 días corridos) ✅
- **Endpoint:** `POST /vacaciones` · **Rol:** OPERADOR (miguel.pereyra@demo.com)
- **Esperado:** El server debería calcular diasHabiles a partir del rango (excluyendo fines de semana y feriados) o, como mínimo, rechazar diasHabiles > diasTotales. El saldo se descuenta por días corridos, con lo cual el dato mostrado al empleado y al aprobador puede ser arbitrario.
- **Obtenido:** 201; se persiste y se devuelve el valor arbitrario, que se propaga a /mis-solicitudes y a la UI de vacaciones.
- **Repro:** 1) Login miguel.pereyra@demo.com. 2) POST /api/v1/vacaciones {fechaInicio:'2026-12-04T00:00:00.000Z' (viernes), fechaFin:'2026-12-07T00:00:00.000Z' (lunes), diasHabiles:999, motivo:'sim habiles-absurdo'} → 201 con diasTotales:4 (bien calculado) y diasHabiles:999 (tal cual llegó). 3) GET /api/v1/mis-solicitudes con ese token → el detalle dice '(999 días hábiles)'. No existe modelo de Feriado en el schema ni ninguna función que excluya sábados/domingos: diasHabiles es un campo puramente declarativo del cliente. De hecho el front (VacacionesPage.tsx:446) manda `diasHabiles: diasTotales` con el comentario 'backend field, but we send total calendar days', y luego la UI muestra 'N háb. / M corrido
- **Evidencia:** POST /vacaciones → HTTP 201 {"fechaInicio":"2026-12-04T00:00:00.000Z","fechaFin":"2026-12-07T00:00:00.000Z","diasHabiles":999,"diasTotales":4,"estado":"PENDIENTE"}. GET /mis-solicitudes → detalle: "Vacaciones del 03/12 al 06/12 (999 días hábiles)"

### 🟡 MEDIA — GET /mis-solicitudes muestra las fechas de la vacación corridas un día hacia atrás ✅
- **Endpoint:** `GET /mis-solicitudes` · **Rol:** OPERADOR (miguel.pereyra@demo.com)
- **Esperado:** detalle: 'Vacaciones del 05/10 al 06/10' (las mismas fechas que devuelve GET /vacaciones/:id).
- **Obtenido:** detalle: 'Vacaciones del 04/10 al 05/10' — un día menos en ambos extremos. El empleado ve en 'Mis solicitudes' un período distinto al que pidió.
- **Repro:** 1) Login miguel.pereyra@demo.com. 2) POST /api/v1/vacaciones {fechaInicio:'2026-10-05T00:00:00.000Z', fechaFin:'2026-10-06T00:00:00.000Z', diasHabiles:2, motivo:'sim verif'} → 201 (GET /vacaciones/:id confirma fechaInicio 2026-10-05 y fechaFin 2026-10-06). 3) GET /api/v1/mis-solicitudes → el objeto de esa solicitud trae detalle: 'Vacaciones del 04/10 al 05/10 (2 días hábiles)'. Causa: mis-solicitudes.routes.ts fmtDate() usa d.getDate()/d.getMonth() (hora LOCAL) sobre fechas guardadas como UTC-midnight; con el server en America/Argentina (UTC-3) toda fecha retrocede un día. Afecta por igual al detalle de AUSENCIA y al de PLANILLA en el mismo endpoint.
- **Evidencia:** POST /vacaciones → 201 {"fechaInicio":"2026-10-05T00:00:00.000Z","fechaFin":"2026-10-06T00:00:00.000Z"}. GET /mis-solicitudes → {"tipo":"VACACION","detalle":"Vacaciones del 04/10 al 05/10 (2 días hábiles)"}. Server TZ: GMT-0300 (hora estándar de Argentina).

### 🟡 MEDIA — Una vacación íntegramente del año siguiente descuenta el saldo del año en curso ✅
- **Endpoint:** `POST /vacaciones` · **Rol:** OPERADOR (andres.romero@demo.com)
- **Esperado:** Los días de un período de 2027 deberían imputarse al saldo 2027 (o rechazarse si ese saldo aún no existe), no consumir el cupo 2026.
- **Obtenido:** El cupo 2026 se consume por días de 2027; el saldo 2027 queda intacto. Un empleado que planifica con anticipación se queda sin días este año y con el año que viene entero disponible.
- **Repro:** 1) Login andres.romero@demo.com. GET /api/v1/vacaciones/saldo → anotar 'pendiente' (yo tenía 6 en ese momento; con la cuenta limpia es 0). 2) POST /api/v1/vacaciones {fechaInicio:'2027-08-03T00:00:00.000Z', fechaFin:'2027-08-06T00:00:00.000Z', diasHabiles:4, motivo:'sim anio-siguiente'} → 201, diasTotales 4. 3) GET /api/v1/vacaciones/saldo (que siempre consulta el saldo del año en curso, 2026) → 'pendiente' subió en 4 y 'disponible' bajó en 4. 4) Consultar el VacacionSaldo de anio 2027 → no se toca (ni se crea). Causa: POST usa `const anio = new Date().getFullYear()` y /avanzar y /rechazar derivan el año de vacacion.createdAt, nunca de fechaInicio.
- **Evidencia:** GET /vacaciones/saldo antes: {"disponible":8,"usados":0,"pendiente":6,"total":14}. POST /vacaciones {fechaInicio:'2027-08-03',fechaFin:'2027-08-06',diasHabiles:4} → 201 diasTotales 4. GET /vacaciones/saldo después: {"disponible":4,"usados":0,"pendiente":10,"total":14} (saldo del año 2026).

### 🟡 MEDIA — POST /vacaciones ignora el estado BORRADOR: no hay forma de guardar un borrador y /enviar responde 400 en el alta
- **Endpoint:** `POST /vacaciones/:id/enviar` · **Rol:** OPERADOR (miguel.pereyra@demo.com)
- **Esperado:** O bien POST acepta crear en BORRADOR (y /enviar es el paso que dispara el flujo y reserva el saldo), o bien /enviar deja de existir para el alta y POST hace todo lo que hace /enviar (incluida la notificación a aprobadores).
- **Obtenido:** POST crea directo en PENDIENTE reservando saldo, y /enviar devuelve 400 salvo tras un rechazo. No se puede guardar una solicitud como borrador ni, por lo tanto, borrar una en BORRADOR.
- **Repro:** 1) Login miguel.pereyra@demo.com. 2) POST /api/v1/vacaciones {fechaInicio:'2026-11-16T00:00:00.000Z', fechaFin:'2026-11-17T00:00:00.000Z', diasHabiles:2, motivo:'sim'} → 201 con estado 'PENDIENTE' (el default del modelo Prisma es BORRADOR, pero la ruta fuerza estado:'PENDIENTE' y pasoActual:1 y ya reserva el saldo). 3) POST /api/v1/vacaciones/{id}/enviar → 400 'Solo se puede enviar en BORRADOR o RECHAZADA'. Consecuencias: (a) el estado BORRADOR es inalcanzable vía API, así que la rama de DELETE para BORRADOR y la rama de /enviar para BORRADOR son código muerto; (b) el front (VacacionesPage.tsx) mantiene un enviarMutation contra ese endpoint que sólo funciona tras un rechazo; (c) es la causa 
- **Evidencia:** POST /vacaciones → HTTP 201 {"id":"50f78275-...","estado":"PENDIENTE","pasoActual":1}. POST /vacaciones/50f78275-.../enviar → HTTP 400 {"error":"Solo se puede enviar en BORRADOR o RECHAZADA"}

### 🟡 MEDIA — PUT /vacacion-saldos/:id no valida coherencia: deja el saldo total en -9969 días y los compensatorios disponibles en -48
- **Endpoint:** `PUT /vacacion-saldos/:id` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400 cuando diasCorrespondientes + diasAjuste queda por debajo de los días ya usados/pendientes, y cuando compensatoriosUsados > compensatoriosAcumulados
- **Obtenido:** 200 en ambos casos; el saldo queda con totales negativos que se propagan a mi-saldo y a los listados de RRHH
- **Repro:** 1) Login ana.martinez@demo.com. 2) GET /vacacion-saldos?anio=2026 → tomar <saldoId> (usar el de un usuario de prueba propio). 3) PUT /vacacion-saldos/<saldoId> {diasCorrespondientes:30} → 200. 4) PUT /vacacion-saldos/<saldoId> {diasAjuste:-9999, observaciones:'sim-rrhh-personas-<ts>-negativo'} → 200. El total (diasCorrespondientes + diasAjuste) queda en -9969. 5) PUT /vacacion-saldos/<saldoId> {compensatoriosAcumulados:2, compensatoriosUsados:50} → 200. compensatoriosAcumulados - compensatoriosUsados - compensatoriosPendientes = -48. 6) GET /vacacion-saldos/mi-saldo (como ese usuario) devuelve total negativo; sólo `disponible` está clampeado con Math.max(0, ...), los demás campos no. El sche
- **Evidencia:** PUT /vacacion-saldos/81a23edb-612d-436b-b8bf-23fa160878b7 {"diasAjuste":-9999} → HTTP 200 {"diasCorrespondientes":30,"diasAjuste":-9999,...} → total -9969. PUT {"compensatoriosAcumulados":2,"compensatoriosUsados":50} → HTTP 200 → compensatorios disponibles = 2-50-0 = -48

### 🟡 MEDIA — El saldo de vacaciones de un empleado dado de baja desaparece de GET /vacacion-saldos sin opción de incluirlo
- **Endpoint:** `GET /vacacion-saldos` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** Que RRHH pueda listar los saldos de empleados dados de baja (parámetro opcional o inclusión por defecto): la liquidación final de vacaciones se calcula justamente después de la baja
- **Obtenido:** El saldo se vuelve invisible en el listado (única vía de descubrimiento) apenas se marca activo=false, aunque el registro sigue existiendo y siendo editable por id
- **Repro:** 1) Login ana.martinez@demo.com. 2) Crear usuario de prueba (POST /usuarios) y POST /vacacion-saldos/generar {anio:2026} → 200. 3) GET /vacacion-saldos?anio=2026 → el saldo aparece, anotar <saldoId>. 4) PUT /usuarios/<id> {activo:false} (baja). 5) GET /vacacion-saldos?anio=2026 → el saldo ya NO aparece, y no hay parámetro (activo/incluirInactivos) para traerlo. 6) PUT /vacacion-saldos/<saldoId> {diasAjuste:1, observaciones:'sim-rrhh-personas-<ts>-liquidacion final'} → 200: el recurso sigue siendo editable si se conoce el id, sólo se perdió la vía de descubrimiento. Causa: vacacion-saldos.routes.ts:37 filtra `usuario: { empresaId, activo: true }` de forma fija.
- **Evidencia:** GET /vacacion-saldos?anio=2026 antes de la baja → incluye {"id":"97d7ba88-fa0d-4fc2-932d-2951c1270526",...}; tras PUT /usuarios/<id> {activo:false} → HTTP 200 sin esa fila; PUT /vacacion-saldos/97d7ba88-fa0d-4fc2-932d-2951c1270526 → HTTP 200 (sigue editable)

### 🟡 MEDIA — GET /vacaciones/:id no aplica alcance por sector/flujo: cualquier usuario nivel>=60 de la empresa lee la solicitud completa de cualquier empleado
- **Endpoint:** `GET /vacaciones/:id` · **Rol:** COORDINADOR (y cualquier SUPERVISOR/GERENTE de la empresa)
- **Esperado:** 403 — el detalle debería quedar acotado al dueño, a sus responsables directos, al aprobador del paso vigente o a RRHH/ADMIN, igual que en planillas y ausencias. GET /vacaciones (listado) sí filtra por sector/subordinados, con lo cual el detalle contradice al listado.
- **Obtenido:** 200 con el registro completo (fechas, motivo, obsRechazo, flujo con sus pasos e historial de aprobaciones con nombres) para cualquier supervisor/coordinador de la empresa, sin importar el sector.
- **Repro:** 1) Login facundo.garcia@demo.com (OPERADOR, sector Fractura, coordinador martin.lopez). POST /vacaciones {"fechaInicio":"2128-12-01T00:00:00.000Z","fechaFin":"2128-12-02T00:00:00.000Z","diasHabiles":2,"motivo":"texto sensible"} → 201, anotar el id. 2) Login juancarlos.herrera@demo.com (COORDINADOR de Cabezales; no es supervisor ni coordinador de facundo, otro sector, nivel 70) y GET /vacaciones/<id>. 3) Repetir con roberto.acosta@demo.com (SUPERVISOR de Cabezales). 4) Comparar con el mismo cruce en los otros módulos: GET /planillas/<id de Cabezales> con martin.lopez → 403; GET /ausencias/<id de Cabezales> con martin.lopez → 403. Causa: vacaciones.routes.ts:563-569 autoriza con 'misma empresa
- **Evidencia:** GET /vacaciones/d35880d4-118d-4744-ad19-e899d930c0e3 con token de juancarlos.herrera@demo.com → HTTP 200 {"id":"d35880d4-…","usuarioId":"c43ac143-5938-4ade-8015-fc62fc311674","flujoId":"d07b9926-…","fechaInicio":"2128-12-01T00:00:00.000Z","fechaFin":"2128-12-02T00:00:00.000Z","diasHabiles":2,"diasTo

### ⚪ BAJA — Se aceptan solicitudes de vacaciones con el rango íntegramente en el pasado y descuentan saldo
- **Endpoint:** `POST /vacaciones` · **Rol:** OPERADOR (miguel.pereyra@demo.com)
- **Esperado:** 400 para un OPERADOR que pide vacaciones que ya transcurrieron (o al menos exigir nivel RRHH+ para cargas retroactivas).
- **Obtenido:** 201 y reserva de saldo. Si se aprueba, además bloquea los días en la planilla de un período ya cerrado vía inyectarDiasBloqueados.
- **Repro:** 1) Login miguel.pereyra@demo.com (hoy es 2026-07-23). 2) POST /api/v1/vacaciones {fechaInicio:'2026-01-12T00:00:00.000Z', fechaFin:'2026-01-13T00:00:00.000Z', diasHabiles:2, motivo:'sim pasado'} → 201, estado PENDIENTE, y GET /vacaciones/saldo muestra 2 días más en 'pendiente'. El único chequeo de fechas del schema es fin >= inicio; no hay validación de fecha futura ni de antelación mínima, ni distinción entre lo que puede cargar un OPERADOR y lo que podría cargar RRHH retroactivamente.
- **Evidencia:** POST /vacaciones → HTTP 201 {"id":"888ae61d-a8b0-4bd5-a615-d51082ad408b","fechaInicio":"2026-01-12T00:00:00.000Z","fechaFin":"2026-01-13T00:00:00.000Z","diasHabiles":2,"diasTotales":2,"estado":"PENDIENTE","pasoActual":1} (creado el 2026-07-24)

---

## APROBACIONES — 15 (2 critica, 5 alta, 6 media, 2 baja)

> Nota: las 5 críticas de PLANILLAS/APROBACIONES sobre `avanzar` sin flujo son **una misma causa raíz** en `planillas.routes.ts:514` (`if (pasoActual > totalPasos || totalPasos === 0)` marca APROBADA sin llamar a `isResponsibleApprover`). Alcanzable con los **31 usuarios activos sin sector** (planilla nace `flujoId=null`) o si un admin deja un flujo sin pasos.

### 🔴 CRITICA — Solicitud sin flujo (flujoId=null): POST /:id/avanzar aprueba de una sin verificar quién aprueba (cualquier nivel>=60, incluso el propio afectado)
- **Endpoint:** `POST /cambios-diagrama/:id/avanzar` · **Rol:** SUPERVISOR (hector.ramos@demo.com) — reproducible con cualquier rol nivel>=60
- **Esperado:** Sin cadena de aprobación configurada, /avanzar debería fallar (409/422 'no hay flujo de aprobación configurado') o exigir al menos RRHH/ADMIN; nunca aprobar automáticamente ni permitir que el afectado se apruebe a sí mismo.
- **Obtenido:** 200 OK con estado=APROBADA en la primera llamada, hecha por un SUPERVISOR ajeno al usuario y a su sector; el cambio de diagrama se aplica en usuarios_diagramas.
- **Repro:** 1) Login admin@wenlen.com / Test1234! -> token ADM. 2) POST /admin/sectores {"nombre":"sim-noflujo-1"} (un sector nuevo NO tiene asignación de flujo CAMBIO_DIAGRAMA). 3) POST /usuarios {nombre,apellido,email:'sim.noflow@demo.com',password:'Test1234!',rol:'OPERADOR',sectorId:<simSector>,fechaIngreso:'2020-01-01T00:00:00.000Z',supervisorId:<jorge.cabrera>} con ADM. 4) Login martin.lopez@demo.com (COORDINADOR de Fractura) y POST /cambios-diagrama {usuarioId:<simUser>,diagramaNuevoId:'0d73a9ad-7e42-4c85-815b-fd706f5c6e6e',motivo:'x'} -> 201 con flujoId=null. 5) Login hector.ramos@demo.com (SUPERVISOR de Logística, sin ninguna relación con simUser ni con su sector) y POST /cambios-diagrama/<id>/a
- **Evidencia:** POST /cambios-diagrama/514c26c8-4781-4d4d-a7fc-bcd9182f81a2/avanzar (token hector.ramos) -> 200 {"id":"514c26c8-...","solicitanteId":"834b8d9d-... (martin.lopez)","usuarioId":"0d9ac76c-...","flujoId":null,"estado":"APROBADA","pasoActual":1} ; usuarios_diagramas -> [{"diagramaId":"0d73a9ad-...","acti

### 🔴 CRITICA — Un flujo sin pasos hace que cualquier SUPERVISOR apruebe la planilla de un solo salto, salteando Coordinador y RRHH y sin control de jerarquía
- **Endpoint:** `POST /planillas/:id/avanzar` · **Rol:** ADMIN (provoca el estado) + SUPERVISOR (explota)
- **Esperado:** La planilla no debería poder avanzar con un circuito de aprobación vacío o inexistente: corresponde 400/409 ('el documento no tiene un flujo de aprobación válido'), o como mínimo exigir un aprobador responsable. En ningún caso un supervisor ajeno al empleado debería poder llevarla directo a APROBADA salteándose COORDINADOR y RRHH.
- **Obtenido:** HTTP 200 y la planilla pasa de ENVIADA directamente a APROBADA en una sola llamada. En src/routes/planillas.routes.ts el bloque `if (pasoActual > totalPasos || totalPasos === 0) { nuevoEstado = 'APROBADA' }` cortocircuita la verificación isResponsibleApprover(), por lo que no se valida ni el rol del paso ni la jerarquía (supervisor/coordinador/sector) del aprobador.
- **Repro:** 1) Login admin@wenlen.com (password Test1234!). 2) POST /admin/flujos {"nombre":"tmp-flujo3","tipoDocumento":"PLANILLA","pasos":[{"orden":1,"nombrePaso":"s1","rolAprobador":"SUPERVISOR"},{"orden":2,"nombrePaso":"s2","rolAprobador":"COORDINADOR"},{"orden":3,"nombrePaso":"s3","rolAprobador":"RRHH"}]}. 3) POST /usuarios {"nombre":"tmp","apellido":"x","email":"tmp1@sim.local","password":"Test1234!","rol":"OPERADOR","fechaIngreso":"2024-01-01"} (queda sin sector y sin supervisor). 4) POST /admin/flujos/asignaciones {"flujoId":"<flujo>","tipoDocumento":"PLANILLA","usuarioId":"<tmp1>"}. 5) Login tmp1@sim.local; POST /planillas {"periodoInicio":"2024-05-21T00:00:00.000Z","periodoFin":"2024-05-22T00:
- **Evidencia:** POST /planillas/603f3a02-158c-4780-a9bc-b6abab86de24/avanzar con token de lucas.fernandez@demo.com → HTTP 200 {"estado":"APROBADA","pasoActual":1,...}. Idéntico con flujo activo de 0 pasos: POST /planillas/541d2529-f83e-4572-a047-c76bed0591d3/avanzar → HTTP 200 estado=APROBADA. Verificado en DB: amb

### 🟠 ALTA — POST /cambios-diagrama no valida jerarquía: un COORDINADOR crea solicitudes para usuarios de otro sector, no subordinados, e incluso de mayor nivel (GERENTE)
- **Endpoint:** `POST /cambios-diagrama` · **Rol:** COORDINADOR (martin.lopez@demo.com, sector Fractura)
- **Esperado:** 403: sólo se debería poder pedir el cambio para subordinados directos (supervisorId/coordinadorId propios) o usuarios del propio sector, y nunca para usuarios de nivel superior.
- **Obtenido:** 201 Created en ambos casos, incluida la GERENTE.
- **Repro:** 1) Login martin.lopez@demo.com / Test1234! (COORDINADOR de Fractura, nivel 70). 2) POST /cambios-diagrama {"usuarioId":"<id de un OPERADOR de otro sector, p.ej. walter.molina@demo.com o un usuario de un sector recién creado>","diagramaNuevoId":"0d73a9ad-7e42-4c85-815b-fd706f5c6e6e","motivo":"x"} -> 201. 3) Repetir con el id de laura.gonzalez@demo.com (GERENTE, nivel 80, sectorId=null) -> 201 con flujoId=null. El handler sólo valida empresaId (línea 115-129), nunca supervisorId/coordinadorId/sectorId ni el nivel del objetivo. Encadenado con el hallazgo de flujoId=null, cualquier coordinador+supervisor puede cambiarle el diagrama a la gerencia.
- **Evidencia:** POST /cambios-diagrama (token martin.lopez) -> 201 {"id":"514c26c8-4781-4d4d-a7fc-bcd9182f81a2","solicitanteId":"834b8d9d-... (martin.lopez, Fractura)","usuarioId":"0d9ac76c-... (usuario de otro sector)","flujoId":null,"estado":"PENDIENTE"} ; para la GERENTE: 201 flujoId=null (luego cancelada con DE

### 🟠 ALTA — Una solicitud sin flujo no puede RECHAZARSE nunca (403 incluso para RRHH y ADMIN): sólo admite ser aprobada
- **Endpoint:** `POST /cambios-diagrama/:id/rechazar` · **Rol:** RRHH (maria.rodriguez@demo.com) y ADMIN (admin@wenlen.com)
- **Esperado:** 200: RRHH/ADMIN deberían poder rechazar (o cancelar) una solicitud sin cadena de aprobación; la asimetría 'se puede aprobar sin control pero no rechazar' es lo contrario de lo seguro.
- **Obtenido:** 403 en ambos casos; la solicitud queda inmortal en PENDIENTE y sólo puede resolverse aprobándola.
- **Repro:** 1) Crear una solicitud sobre un usuario cuyo sector no tenga asignación de flujo CAMBIO_DIAGRAMA (sector nuevo o usuario con sectorId=null, p.ej. laura.gonzalez@demo.com) -> queda con flujoId=null. 2) Login maria.rodriguez@demo.com y POST /cambios-diagrama/<id>/rechazar {"motivo":"no corresponde"} -> 403. 3) Login admin@wenlen.com y repetir -> 403. Causa: en /rechazar (línea 404-410) `const currentStep = pasos.find(...)`; con pasos=[] currentStep es undefined y el guard `if (!currentStep || !isResponsibleApprover(...))` corta antes de que aplique el escape hatch de ADMIN. La única salida es DELETE (sólo el solicitante, y sólo si sigue en PENDIENTE) o aprobarla.
- **Evidencia:** POST /cambios-diagrama/c6fd5083-ddf4-4165-8598-aadafed9c2b4/rechazar (token RRHH) -> 403 {"error":"No tenés autorización para rechazar esta solicitud"} ; mismo endpoint con token ADMIN -> 403 {"error":"No tenés autorización para rechazar esta solicitud"}

### 🟠 ALTA — El circuito de cambio de diagrama es inejecutable end-to-end: el único rol con UI de aprobación (RRHH) recibe 403 en los pasos SUPERVISOR/COORDINADOR, y esos roles no tienen acceso a la pantalla
- **Endpoint:** `POST /cambios-diagrama/:id/avanzar + GET /cambios-diagrama/diagramas` · **Rol:** SUPERVISOR (hector.ramos@demo.com) / RRHH (maria.rodriguez@demo.com)
- **Esperado:** Quien figura como aprobador del paso (SUPERVISOR/COORDINADOR) debería poder listar diagramas, ver sus pendientes y aprobar/rechazar; o bien el flujo no debería configurar pasos con roles que el producto no habilita.
- **Obtenido:** RRHH: 403 al avanzar y al rechazar el paso SUPERVISOR. SUPERVISOR: 403 en GET /cambios-diagrama/diagramas y en POST /cambios-diagrama, y sin acceso a la pantalla desde el menú. La solicitud queda trabada salvo intervención de ADMIN.
- **Repro:** 1) Login admin@wenlen.com y POST /cambios-diagrama {"usuarioId":"<ruben.navarro@demo.com>","diagramaNuevoId":"0d73a9ad-7e42-4c85-815b-fd706f5c6e6e","motivo":"x"} -> 201, flujoId=f32a8471 ('Cambios de Diagrama - Supervisor -> RRHH', asignado a Logística y Transporte y CMASS), pasoActual=1 rolAprobador=SUPERVISOR. 2) Login maria.rodriguez@demo.com (RRHH) -> POST /cambios-diagrama/<id>/avanzar -> 403; POST .../rechazar {motivo} -> 403. 3) Login hector.ramos@demo.com (SUPERVISOR, aprobador real del paso 1) -> GET /cambios-diagrama/diagramas -> 403 (requireLevel 70) y POST /cambios-diagrama -> 403. En apps/web: AppShell.tsx:62 oculta el ítem 'Cambios Diagrama' con minLevel:70 y CambiosDiagramaPag
- **Evidencia:** POST /cambios-diagrama/a866498b-5b0e-4285-bcc3-ba1a50069038/avanzar (token maria.rodriguez) -> 403 {"error":"No tenés autorización para aprobar esta solicitud en el paso de SUPERVISOR"} ; POST .../rechazar -> 403 {"error":"No tenés autorización para rechazar esta solicitud"} ; GET /cambios-diagrama/

### 🟠 ALTA — GET /aprobaciones nunca lista ausencias cuyo aprobador sólo participa del flujo de AUSENCIA (filtro armado con visibilidad de PLANILLA y VACACION)
- **Endpoint:** `GET /aprobaciones` · **Rol:** SUPERVISOR
- **Esperado:** La ausencia debe aparecer en ausenciasPendientes del aprobador del paso 1 (es el supervisor directo del solicitante y POST /ausencias/:id/avanzar lo reconoce como aprobador válido). La bandeja y la autorización deben coincidir.
- **Obtenido:** GET /aprobaciones devuelve ausenciasPendientes sin la ausencia (invisible en la bandeja), pero POST /ausencias/:id/avanzar del mismo usuario devuelve 200 y la aprueba. La ausencia queda colgada porque el aprobador nunca la ve.
- **Repro:** 1) Login admin@wenlen.com. 2) POST /usuarios SUPERVISOR sin sector: {"nombre":"SIM","apellido":"sup","email":"sim-sup-<ts>@demo.com","password":"Test1234!","rol":"SUPERVISOR","fechaIngreso":"2020-01-01T00:00:00.000Z"} → 201 (guardar id). 3) POST /usuarios OPERADOR sin sector con supervisorId = id del paso 2 → 201. 4) POST /admin/flujos {"nombre":"sim-aus","tipoDocumento":"AUSENCIA","pasos":[{"orden":1,"nombrePaso":"Sup","rolAprobador":"SUPERVISOR"},{"orden":2,"nombrePaso":"RRHH","rolAprobador":"RRHH"}]} → 201. 5) POST /admin/flujos/asignaciones {"flujoId":<flujo>,"tipoDocumento":"AUSENCIA","usuarioId":<operador>} → 201. 6) Login del operador: POST /ausencias/solicitar {"tipo":"CERTIFICADO_ME
- **Evidencia:** GET /aprobaciones (token sim.sup-aprobaciones.supnoflow.1784855168910@demo.com) → 200, ausenciasPendientes NO contiene de237dfa-0e6c-431b-9454-c66fbef12288 POST /ausencias/de237dfa-0e6c-431b-9454-c66fbef12288/avanzar {"comentario":"ok"} (mismo token) → 200 {"estado":"EN_REVISION","pasoActual":2}

### 🟠 ALTA — El franco compensatorio solicitado por el operador no llega a la bandeja de aprobaciones de nadie
- **Endpoint:** `GET /aprobaciones` · **Rol:** OPERADOR solicita; SUPERVISOR/COORDINADOR/RRHH/ADMIN aprueban
- **Esperado:** La solicitud pendiente que ya reservó saldo del empleado debe aparecer en la bandeja de algún aprobador (al menos RRHH/ADMIN) y poder aprobarse desde la UI.
- **Obtenido:** ausenciasPendientes no la incluye para NINGÚN rol, porque matchesCurrentStep (aprobaciones.routes.ts:80) descarta todo item con flujoId/flujo null. El supervisor tampoco puede aprobarla por API. La única forma de aprobarla es que RRHH conozca el id y llame directo a POST /ausencias/:id/avanzar (rama sin-flujo). En la práctica el pedido queda invisible y el saldo reservado indefinidamente.
- **Repro:** 1) RRHH acredita saldo: PUT /vacacion-saldos/<id del saldo 2026 de eduardo> {compensatoriosAcumulados: 5} con ana.martinez@demo.com. 2) Login eduardo.ruiz@demo.com → POST /ausencias/compensatorio {fechaInicio:'2026-08-14', fechaFin:'2026-08-15', diasAusencia:2} → 201 con estado PENDIENTE y flujoId:null (no hay ninguna FlujoAsignacion de tipoDocumento COMPENSATORIO en la empresa, y el fallback de la ruta exige `asignaciones: {some:{activo:true}}`). 3) GET /aprobaciones con roberto.acosta@demo.com, juancarlos.herrera@demo.com, ana.martinez@demo.com y admin@wenlen.com → revisar ausenciasPendientes. 4) POST /ausencias/:id/avanzar con roberto.acosta@demo.com.
- **Evidencia:** HTTP 201 POST /ausencias/compensatorio → {"id":"f7afc591-6dea-4015-8aee-f3f48b9885ec","tipo":"FRANCO_COMPENSATORIO","estado":"PENDIENTE","pasoActual":1,"flujoId":null}. HTTP 200 GET /aprobaciones (roberto, juancarlos, ana, admin) → ninguno lista ese id en ausenciasPendientes. HTTP 403 POST /ausencia

### 🟡 MEDIA — La fechaEfectiva futura no se respeta: la asignación nueva se crea con activo=true y rige desde el instante de la aprobación
- **Endpoint:** `POST /cambios-diagrama/:id/avanzar (aprobación final)` · **Rol:** SUPERVISOR (hector.ramos@demo.com) + RRHH (maria.rodriguez@demo.com)
- **Esperado:** Hasta el 2026-09-01 el usuario debe seguir con el diagrama anterior; el nuevo debería activarse recién en la fecha efectiva (o los consumidores filtrar por fechaInicio<=hoy).
- **Obtenido:** El diagrama nuevo queda activo=true de inmediato y el calendario de equipo ya lo muestra hoy; la asignación anterior se cierra en el acto (fechaFin=fechaEfectiva) aunque debería seguir vigente 40 días más.
- **Repro:** Hoy = 2026-07-23. 1) Login admin@wenlen.com, POST /cambios-diagrama {"usuarioId":"718806ce-2d36-4c08-85f5-600d82ceac17" (walter.molina),"diagramaNuevoId":"b91ceaf7-ebc1-4ddd-99a9-8d6adaf12882" (14x7),"fechaEfectiva":"2026-09-01","motivo":"x"} -> 201. 2) Login hector.ramos@demo.com -> POST /:id/avanzar -> EN_REVISION. 3) Login maria.rodriguez@demo.com -> POST /:id/avanzar -> APROBADA. 4) GET /vacaciones/gantt?todos=1 con el token de hector y mirar empleados[walter].diagrama; y/o leer usuarios_diagramas. En cambios-diagrama.routes.ts:306 se crea la fila con `activo:true` y `fechaInicio: fechaEfectiva`, y todos los consumidores (vacaciones.routes.ts:273 y planillas.routes.ts:363) filtran sólo p
- **Evidencia:** usuarios_diagramas de walter tras aprobar: [{"diagramaId":"b91ceaf7-... (14x7)","activo":true,"fechaInicio":"2026-09-01T00:00:00.000Z","fechaFin":null}] ; GET /vacaciones/gantt?todos=1 (token hector, hoy 2026-07-23) -> empleados[walter].diagrama = {"nombre":"14×7","fechaInicio":"2026-09-01T00:00:00.

### 🟡 MEDIA — fechaEfectiva en el pasado se acepta y deja usuarios_diagramas inconsistente (fechaFin anterior a fechaInicio)
- **Endpoint:** `POST /cambios-diagrama + POST /cambios-diagrama/:id/avanzar` · **Rol:** ADMIN (creación) + SUPERVISOR (aprobación)
- **Esperado:** 400 'fechaEfectiva no puede ser anterior a la asignación vigente / a hoy', o al menos impedir fechaFin < fechaInicio.
- **Obtenido:** 201 + aprobación OK; queda una asignación con fechaFin (2019-01-01) anterior a su fechaInicio (2026-07-24).
- **Repro:** 1) Tomar un usuario que ya tenga una asignación activa (p.ej. el que quedó con diagrama tras el escenario sin flujo, o daniel.aguirre@demo.com con 14x14 desde 2026-01-01). 2) POST /cambios-diagrama {"usuarioId":<id>,"diagramaNuevoId":"9438be00-c030-44b8-8a45-424679812808","fechaEfectiva":"2019-01-01","motivo":"x"} -> 201 (sin validación alguna sobre la fecha). 3) Aprobar hasta APROBADA. 4) Leer usuarios_diagramas del usuario: la fila anterior queda con fechaFin=2019-01-01 siendo su fechaInicio de 2026, y la fila nueva arranca en 2019 reescribiendo historia (afecta el cálculo de francos de planillas pasadas).
- **Evidencia:** usuarios_diagramas tras aprobar: [{"diagramaId":"0d73a9ad-...","activo":false,"fechaInicio":"2026-07-24T01:00:53.615Z","fechaFin":"2019-01-01T00:00:00.000Z"}]

### 🟡 MEDIA — No se valida pedir el MISMO diagrama que el usuario ya tiene: se crea la solicitud y, al aprobarse, genera una asignación duplicada de duración cero
- **Endpoint:** `POST /cambios-diagrama` · **Rol:** ADMIN / COORDINADOR (cualquier solicitante nivel>=70)
- **Esperado:** 400/409 'el usuario ya tiene ese diagrama' (el propio handler ya calcula diagramaActualId en la línea 140, sólo falta comparar).
- **Obtenido:** 201 Created; ciclo de aprobación completo disponible para un cambio que no cambia nada.
- **Repro:** 1) Verificar el diagrama activo de un usuario (p.ej. GET /vacaciones/gantt?todos=1 -> empleados[x].diagrama, o usuarios_diagramas). 2) POST /cambios-diagrama {"usuarioId":<id>,"diagramaNuevoId":"<el mismo id que ya tiene>","motivo":"x"} -> 201, y en la respuesta diagramaActualId === diagramaNuevoId. 3) Si además se aprueba, la asignación vigente se cierra y se crea otra idéntica: quedan filas con fechaInicio == fechaFin.
- **Evidencia:** POST /cambios-diagrama -> 201 {"id":"d2e3cd0f-4bcb-4dbe-9e82-a7010f0a4e72","usuarioId":"718806ce-... (walter)","diagramaActualId":"9438be00-c030-44b8-8a45-424679812808","diagramaNuevoId":"9438be00-c030-44b8-8a45-424679812808"} ; historial de walter con filas [{"activo":false,"fechaInicio":"2026-09-0

### 🟡 MEDIA — GET /cambios-diagrama/pendientes y GET /cambios-diagrama/:id no filtran por alcance: un supervisor ve solicitudes de empleados de otros sectores (nombre, apellido, legajo, sector, diagramas)
- **Endpoint:** `GET /cambios-diagrama/pendientes y GET /cambios-diagrama/:id` · **Rol:** SUPERVISOR (hector.ramos@demo.com, sector Logística y Transporte)
- **Esperado:** El listado de pendientes debería limitarse a los documentos donde el usuario es aprobador (subordinados / su sector), como hace getFlowVisibleUserIds en visibility.utils.ts; el detalle, lo mismo.
- **Obtenido:** 200 con datos de empleados de otros sectores.
- **Repro:** 1) Con admin o martin.lopez crear una solicitud PENDIENTE para un usuario de otro sector (p.ej. facundo.garcia@demo.com de Fractura, o cualquier usuario de un sector nuevo). 2) Login hector.ramos@demo.com y GET /cambios-diagrama/pendientes -> la solicitud aparece con usuario{nombre, apellido, legajo, sector} pese a que hector no supervisa a esa persona ni pertenece a ese sector (el where sólo filtra por empresaId y estado, cambios-diagrama.routes.ts:79-83). 3) GET /cambios-diagrama/<id de una solicitud de Fractura> con el token de hector -> 200 con el detalle completo (la guarda de la línea 499 `nivel<90 && nivel<60` deja pasar a todo nivel>=60).
- **Evidencia:** GET /cambios-diagrama/pendientes (token hector.ramos) -> 200, incluye {"usuario":{"nombre":"sim-...","apellido":"SinFlujo","sector":{"nombre":"sim-sup-calendario-diagrama-...-sector"}}} ; GET /cambios-diagrama/5c8394ed-fea2-4172-848d-e2eeaebb5a48 (token hector.ramos) -> 200 {"usuarioId":"2ebff597-..

### 🟡 MEDIA — avanzar/rechazar aceptan motivo y comentario de cualquier tipo y devuelven 500 (sin validación de payload)
- **Endpoint:** `POST /planillas/:id/rechazar y POST /planillas/:id/avanzar (mismo patrón en /vacaciones y /ausencias)` · **Rol:** COORDINADOR (aplica a cualquier aprobador)
- **Esperado:** 400 'Datos inválidos' con validación de tipo/longitud del body, igual que hacen el resto de los endpoints del módulo (createRegistroSchema, createVacacionSchema, etc.).
- **Obtenido:** 500 {"error":"Error interno"} — la excepción de Prisma escapa al catch genérico; el cliente recibe un error de servidor donde corresponde un error de validación.
- **Repro:** 1) Llevar una planilla al paso 2: ramon.flores@demo.com crea planilla de un día, carga el registro y envía; roberto.acosta la avanza (pasoActual=2). 2) Login juancarlos.herrera@demo.com y POST /planillas/<id>/rechazar con body {"motivo":{"a":1}} → 500. 3) Mismo endpoint con {"motivo":12345} → 500. 4) POST /planillas/<id>/avanzar con {"comentario":12345} → 500. 5) Mismo patrón verificado en vacaciones: cristian.suarez crea una vacación, roberto.acosta la avanza al paso 2, y con el token del coordinador POST /vacaciones/<id>/rechazar {"motivo":12345} → 500 y POST /vacaciones/<id>/avanzar {"comentario":{"x":1}} → 500. Causa: ninguno de estos handlers pasa el body por zod; toman req.body.motivo 
- **Evidencia:** POST /planillas/78a4…/rechazar {"motivo":{"a":1}} → HTTP 500 {"error":"Error interno"} POST /planillas/78a4…/rechazar {"motivo":12345} → HTTP 500 {"error":"Error interno"} POST /planillas/78a4…/avanzar {"comentario":12345} → HTTP 500 {"error":"Error interno"} (estado posterior: EN_REVISION paso 2, s

### 🟡 MEDIA — GET /aprobaciones: el rótulo y el período 'anterior' de faltantes se corren un día por manejo local/UTC de fechas
- **Endpoint:** `GET /aprobaciones?periodoInicio&periodoFin` · **Rol:** SUPERVISOR
- **Esperado:** faltantes.actual.label = '21 Jun — 20 Jul 2026' y faltantes.anterior con período 2026-05-21 → 2026-06-20 (mismo ciclo 21→20 desplazado un mes).
- **Obtenido:** faltantes.actual.label = '20 Jun — 19 Jul 2026' (un día menos en ambos extremos, y se muestra tal cual en la pestaña Faltantes de AprobacionesPage.tsx:570) y faltantes.anterior = 2026-05-20T03:00:00.000Z → 2026-06-19T03:00:00.000Z, o sea un ciclo 20→19 con hora 03:00 en vez de 21→20.
- **Repro:** 1) Login ricardo.vargas@demo.com (sirve cualquier rol >= SUPERVISOR). 2) GET /aprobaciones?periodoInicio=2026-06-21T00:00:00.000Z&periodoFin=2026-07-20T00:00:00.000Z (el ciclo real es del 21 al 20). 3) Mirar faltantes.actual.label y faltantes.anterior.{label,periodoInicio,periodoFin}. 4) Repetir con formato fecha-sola: ?periodoInicio=2026-06-21&periodoFin=2026-07-20 → mismo resultado. Causa raíz: aprobaciones.routes.ts:314-354 — buildLabel usa getDate()/getMonth() (hora local) sobre Date construidos desde strings UTC, y prevInicio/prevFin se arman con `new Date(y, m-1, d)` (constructor local). Con TZ America/Argentina (UTC-3) toda fecha UTC-medianoche cae el día anterior. Script de repro: ap
- **Evidencia:** GET /aprobaciones?periodoInicio=2026-06-21T00:00:00.000Z&periodoFin=2026-07-20T00:00:00.000Z → 200   faltantes.actual  = {"label":"20 Jun — 19 Jul 2026","periodoInicio":"2026-06-21T00:00:00.000Z","periodoFin":"2026-07-20T00:00:00.000Z"}   faltantes.anterior= {"label":"20 May — 19 Jun 2026","periodoI

### ⚪ BAJA — El empleado afectado no puede ver ni listar la solicitud que le cambia su propio diagrama
- **Endpoint:** `GET /cambios-diagrama y GET /cambios-diagrama/:id` · **Rol:** OPERADOR (walter.molina@demo.com)
- **Esperado:** El usuario afectado debería poder ver (al menos en lectura) las solicitudes que modifican su propio diagrama.
- **Obtenido:** GET / devuelve lista vacía y GET /:id devuelve 403 'Sin permisos'.
- **Repro:** 1) Con admin crear una solicitud para walter.molina@demo.com. 2) Login walter.molina@demo.com / Test1234!. 3) GET /cambios-diagrama -> 200 [] (el where usa solicitanteId=self, línea 51-53, nunca usuarioId=self). 4) GET /cambios-diagrama/<id de su propia solicitud> -> 403 (guarda de la línea 499). El empleado sí recibe la notificación cuando se aprueba, pero no puede consultar el estado antes.
- **Evidencia:** token walter.molina: GET /cambios-diagrama -> 200 [] (len=0) ; GET /cambios-diagrama/201141b9-6c50-4f66-ae14-075f9493d0ff -> 403 {"error":"Sin permisos"}

### ⚪ BAJA — GET /aprobaciones/can-approve devuelve true a un supervisor que no puede aprobar nada: el menú 'Aprobaciones' queda visible con la bandeja siempre vacía
- **Endpoint:** `GET /aprobaciones/can-approve` · **Rol:** SUPERVISOR
- **Esperado:** canApprove debería reflejar si ESE usuario puede aprobar algo (mismo criterio que usa GET /aprobaciones para armar approvableUserIds); si su sector no lo incluye en ningún paso, debería ser false para no mostrar la sección.
- **Obtenido:** canApprove=true de forma permanente para cualquier SUPERVISOR de la empresa (basta con que exista un flujo con paso SUPERVISOR en otro sector). El front usa este flag para mostrar el ítem de menú (apps/web/src/components/layout/AppShell.tsx:164 'requireApprover') y el toggle de scope en Ausencias/Vacaciones, así que el supervisor ve una sección de Aprobaciones que nunca tendrá items.
- **Repro:** 1) Login ricardo.vargas@demo.com (SUPERVISOR de Almacén, 9 subordinados directos según GET /ausencias/subordinados). 2) GET /aprobaciones/can-approve → {"canApprove":true}. 3) GET /aprobaciones → planillasPendientes, vacacionesPendientes, ausenciasPendientes y compensatoriosPendientes en 0, siempre (los 4 flujos asignados al sector Almacén son 'RRHH directo', paso 1 = RRHH: verificable con GET /admin/flujos/asignaciones/list como admin@wenlen.com). 4) Como gustavo.ponce@demo.com (subordinado suyo) enviar una planilla (POST /planillas + registro + /enviar) y volver a 3): la planilla aparece en la bandeja de RRHH (ana.martinez@demo.com) y nunca en la del supervisor; POST /planillas/<pid>/avanz
- **Evidencia:** GET /aprobaciones/can-approve (token ricardo.vargas) → 200 {"canApprove":true} GET /aprobaciones (mismo token) → 200 {"planillasPendientes":[],"vacacionesPendientes":[],"ausenciasPendientes":[],"compensatoriosPendientes":[],...} GET /admin/flujos/asignaciones/list (admin) → asignaciones de Almacén: 

---

## AUSENCIAS — 14 (3 alta, 10 media, 1 baja)

### 🟠 ALTA — Un franco compensatorio sin flujo no puede rechazarse ni siquiera como ADMIN: la reserva de saldo queda atrapada
- **Endpoint:** `POST /ausencias/:id/rechazar` · **Rol:** RRHH (ana.martinez) y ADMIN (admin@wenlen.com)
- **Esperado:** Simetría con /avanzar: si RRHH/ADMIN puede aprobar una ausencia sin flujo, también debe poder rechazarla y liberar compensatoriosPendientes.
- **Obtenido:** La solicitud queda PENDIENTE para siempre: no se puede rechazar por ningún rol, y si la fecha ya pasó tampoco el dueño puede revocarla. Los días reservados nunca vuelven al saldo del empleado.
- **Repro:** 1) Con saldo compensatorio acreditado, login eduardo.ruiz@demo.com → POST /ausencias/compensatorio {fechaInicio:'2026-07-01', fechaFin:'2026-07-01', diasAusencia:1} → 201 PENDIENTE, flujoId null, compensatoriosPendientes +1. 2) POST /ausencias/:id/revocar (dueño) → 400 'No se puede revocar un compensatorio cuya fecha ya pasó'. 3) POST /ausencias/:id/rechazar {motivo:'fuera de término'} con ana.martinez@demo.com → 403. 4) Repetir con admin@wenlen.com → 403. En /rechazar (ausencias.routes.ts:836-842) se calcula `currentStep = pasos.find(...)` y luego `if (!currentStep || !isResponsibleApprover(...)) 403`, así que sin flujo el guard corta antes de la excepción de ADMIN; /avanzar en cambio sí ti
- **Evidencia:** HTTP 400 POST /ausencias/d93de5ad.../revocar → {"error":"No se puede revocar un compensatorio cuya fecha ya pasó"}. HTTP 403 POST /ausencias/d93de5ad.../rechazar (RRHH ana.martinez) → {"error":"No tenés autorización para rechazar esta ausencia"}. HTTP 403 idéntico con admin@wenlen.com (ADMIN).

### 🟠 ALTA — DELETE de un franco compensatorio PENDIENTE borra la solicitud pero no libera compensatoriosPendientes
- **Endpoint:** `DELETE /ausencias/:id` · **Rol:** RRHH / ADMIN
- **Esperado:** Al borrar una solicitud de compensatorio que había reservado saldo se debe decrementar compensatoriosPendientes, o bien bloquear el borrado de compensatorios no finalizados.
- **Obtenido:** El registro desaparece pero la reserva queda huérfana: el empleado pierde días de saldo sin ninguna solicitud asociada y no existe endpoint para recuperarlos (PUT /vacacion-saldos/:id sólo permite tocar diasCorrespondientes, diasAjuste, compensatoriosAcumulados y compensatoriosUsados, no compensatoriosPendientes).
- **Repro:** 1) Login eduardo.ruiz@demo.com (con saldo compensatorio acreditado) → POST /ausencias/compensatorio {fechaInicio:'2026-07-01', fechaFin:'2026-07-01', diasAusencia:1} → 201 PENDIENTE. 2) GET /vacacion-saldos/mi-saldo → anotar compensatoriosPendientes y compensatoriosDisponible. 3) DELETE /ausencias/:id con admin@wenlen.com → 204. 4) GET /vacacion-saldos/mi-saldo de nuevo. El handler DELETE (ausencias.routes.ts:1080) sólo valida estado != APROBADA y ejecuta prisma.ausencia.delete, sin tocar VacacionSaldo (a diferencia de DELETE /vacaciones/:id, que sí devuelve diasPendientes).
- **Evidencia:** HTTP 204 DELETE /ausencias/d93de5ad-62ad-4036-bd76-5bbc90479ebb (admin). GET /vacacion-saldos/mi-saldo antes → {"compensatoriosDisponible":9,"compensatoriosAcumulados":13,"compensatoriosUsados":0,"compensatoriosPendientes":4}; después → exactamente el mismo objeto (pendientes sigue en 4).

### 🟠 ALTA — No hay validación de solapamiento ni de duplicados entre ausencias del mismo empleado
- **Endpoint:** `POST /ausencias/solicitar` · **Rol:** OPERADOR (eduardo.ruiz)
- **Esperado:** 409/400 al pedir una ausencia que se solapa con otra ausencia propia vigente (APROBADA/PENDIENTE/EN_REVISION), igual que hace vacaciones.
- **Obtenido:** Se aceptan ambas. Un mismo día puede acumular varias ausencias de tipos distintos; al aprobarse la segunda, inyectarDiasBloqueados hace upsert sobre el mismo RegistroHoras y pisa el motivoBloqueo del certificado médico ya aprobado (queda un solo día bloqueado con el último motivo, mientras los contadores de días de ausencia quedan duplicados).
- **Repro:** 1) Login eduardo.ruiz@demo.com. 2) POST /ausencias/solicitar {tipo:'CERTIFICADO_MEDICO', fechaInicio:'2026-08-03', fechaFin:'2026-08-04', diasAusencia:2, numeroCertificado:'X'} y aprobarla por los 3 pasos (roberto.acosta → juancarlos.herrera → ana.martinez) hasta APROBADA. 3) POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-08-03', fechaFin:'2026-08-04', diasAusencia:2} → observar status. 4) Repetir dos veces seguidas el mismo POST /ausencias/solicitar {tipo:'LICENCIA_ESPECIAL', fechaInicio:'2026-08-07', fechaFin:'2026-08-08', diasAusencia:2} → ambas 201. POST /vacaciones sí tiene el guard equivalente (VACACION_SOLAPADA, vacaciones.routes.ts:471) pero ausencias no tiene
- **Evidencia:** HTTP 201 POST /ausencias/solicitar (solapada con la APROBADA) → {"id":"cb2c156f-b49e-4ef1-9c0d-e9a41d9802d0","tipo":"FALTA_JUSTIFICADA","estado":"PENDIENTE","fechaInicio":"2026-08-03T00:00:00.000Z","fechaFin":"2026-08-04T00:00:00.000Z"}. HTTP 201 en la solicitud duplicada exacta → {"id":"9bebb4cc-aa

### 🟡 MEDIA — GET /mis-solicitudes muestra las fechas de las ausencias un día antes de la solicitada (fmtDate usa hora local sobre fechas guardadas en UTC) ✅
- **Endpoint:** `GET /mis-solicitudes` · **Rol:** OPERADOR (oscar.castro@demo.com)
- **Esperado:** detalle = 'Falta justificada del 10/11 al 10/11 (1 días)' — el mismo día calendario que se solicitó y que luego se bloquea en la planilla.
- **Obtenido:** detalle = 'Falta justificada del 09/11 al 09/11 (1 días)' — un día menos.
- **Repro:** 1) POST /auth/login {email:'oscar.castro@demo.com',password:'Test1234!'}. 2) POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-11-10', fechaFin:'2026-11-10', diasAusencia:1, descripcion:'trámite personal'} → 201 (el formato YYYY-MM-DD está explícitamente aceptado por el validador fechaFlexible en src/utils/zod.utils.ts: 'use formato YYYY-MM-DD o ISO 8601'). 3) GET /ausencias/<id> → fechaInicio/fechaFin = '2026-11-10T00:00:00.000Z'. 4) GET /mis-solicitudes y buscar el item con ese id: el campo 'detalle' dice 09/11. Causa: fmtDate() en src/routes/mis-solicitudes.routes.ts (líneas 12-16) usa d.getDate()/d.getMonth() (hora local; el servidor corre en UTC-3) sobre fechas pers
- **Evidencia:** HTTP 200 GET /ausencias/<id> → {"fechaInicio":"2026-11-10T00:00:00.000Z","fechaFin":"2026-11-10T00:00:00.000Z","diasAusencia":1}. HTTP 200 GET /mis-solicitudes → {"tipo":"AUSENCIA","estado":"EN_REVISION","detalle":"Falta justificada del 09/11 al 09/11 (1 días)","pasoActual":2,"totalPasos":2}. (Contr

### 🟡 MEDIA — El empleado no puede reenviar su propia ausencia RECHAZADA: POST /ausencias/:id/enviar exige nivel SUPERVISOR
- **Endpoint:** `POST /ausencias/:id/enviar` · **Rol:** OPERADOR (dueño del documento)
- **Esperado:** 200: el dueño debería poder corregir y reenviar su ausencia rechazada (el propio handler ya contempla estado RECHAZADA en ausencias.routes.ts:528-531), o al menos existir una ruta equivalente para él. El ciclo rechazo → corrección → reenvío es el que ejercita el paso 2 del flujo.
- **Obtenido:** 403 {"error":"No tiene permisos para esta acción"} — el guard requireLevel(LEVEL_SUPERVISOR) de la línea 516 corta antes de llegar a la lógica. La ausencia rechazada queda muerta para el empleado: no puede reenviarla, ni editarla, ni borrarla; sólo puede crear otra desde cero con /solicitar, duplicando el registro.
- **Repro:** 1) Login cristian.suarez@demo.com (OPERADOR, Cabezales). POST /ausencias/solicitar {"tipo":"FALTA_JUSTIFICADA","fechaInicio":"2128-09-05T00:00:00.000Z","fechaFin":"2128-09-06T00:00:00.000Z","diasAusencia":2,"descripcion":"…"} → 201 PENDIENTE pasoActual=1. 2) roberto.acosta@demo.com POST /ausencias/<id>/avanzar → 200 EN_REVISION pasoActual=2. 3) juancarlos.herrera@demo.com POST /ausencias/<id>/rechazar {"motivo":"sin certificado"} → 200 RECHAZADA, pasoActual=0, obsRechazo seteado (correcto). 4) Con el token de cristian.suarez (el dueño) POST /ausencias/<id>/enviar. 5) Comprobar que tampoco puede editarla: PUT /ausencias/<id> exige requireLevel(LEVEL_RRHH) (ausencias.routes.ts:1039) y DELETE t
- **Evidencia:** POST /ausencias/89322355-a629-401d-8ab2-3099b0c6891d/enviar con token de cristian.suarez@demo.com → HTTP 403 {"error":"No tiene permisos para esta acción"} Mismo request con token de roberto.acosta@demo.com → HTTP 200 {"estado":"PENDIENTE","pasoActual":1,"obsRechazo":null}

### 🟡 MEDIA — Se acepta una ausencia que cae dentro de una vacación ya aprobada del mismo empleado
- **Endpoint:** `POST /ausencias/solicitar` · **Rol:** OPERADOR (carlos.medina)
- **Esperado:** 409/400: no se puede pedir una ausencia sobre días ya cubiertos por una vacación aprobada (el día ya está bloqueado en la planilla con motivoBloqueo VACACION).
- **Obtenido:** 201. La ausencia entra al circuito de aprobación y, si se aprueba, pisa el bloqueo de la vacación en la planilla (mismo upsert por planillaId+fecha), quedando el día contabilizado como ausencia y no como vacación mientras la vacación sigue consumiendo saldo.
- **Repro:** 1) Login carlos.medina@demo.com → POST /vacaciones {fechaInicio:'2026-09-02', fechaFin:'2026-09-02', diasHabiles:1, motivo:'x'} → 201. 2) Aprobar la vacación: POST /vacaciones/:id/avanzar con roberto.acosta@demo.com, juancarlos.herrera@demo.com y ana.martinez@demo.com hasta estado APROBADA. 3) Login carlos.medina@demo.com → POST /ausencias/solicitar {tipo:'LICENCIA_ESPECIAL', fechaInicio:'2026-09-02', fechaFin:'2026-09-02', diasAusencia:1}.
- **Evidencia:** HTTP 201 POST /ausencias/solicitar → {"id":"3b05559c-3ea1-414e-9e1a-89c6773553de","tipo":"LICENCIA_ESPECIAL","estado":"PENDIENTE","fechaInicio":"2026-09-02T00:00:00.000Z"}. GET /planillas/<planilla 21/08-20/09 de carlos>/registros muestra ese día ya como {"bloqueado":true,"motivoBloqueo":"VACACION"}

### 🟡 MEDIA — PUT /ausencias/:id con una fecha inválida devuelve 500 en vez de 400
- **Endpoint:** `PUT /ausencias/:id` · **Rol:** RRHH (ana.martinez)
- **Esperado:** 400 'Datos inválidos', mismo criterio que POST /ausencias y POST /ausencias/solicitar, que usan fechaFlexible.
- **Obtenido:** 500 'Error interno'. Cualquier string es aceptado por el schema de update.
- **Repro:** 1) Crear cualquier ausencia no aprobada (p. ej. eduardo.ruiz@demo.com POST /ausencias/solicitar {tipo:'LICENCIA_ESPECIAL', fechaInicio:'2026-08-07', fechaFin:'2026-08-08', diasAusencia:2}). 2) Login ana.martinez@demo.com. 3) PUT /ausencias/:id {"fechaInicio":"no-es-una-fecha"}. updateAusenciaSchema declara fechaInicio/fechaFin como z.string().optional() (no usa fechaFlexible), así que pasa la validación y el handler hace new Date('no-es-una-fecha') → Invalid Date → Prisma lanza y cae al catch genérico.
- **Evidencia:** HTTP 500 PUT /ausencias/40be2564-7ed1-48f3-aca6-6c9f0c142eb6 con body {"fechaInicio":"no-es-una-fecha"} → {"error":"Error interno"}.

### 🟡 MEDIA — PUT /ausencias/:id acepta fechaFin anterior a fechaInicio
- **Endpoint:** `PUT /ausencias/:id` · **Rol:** RRHH (ana.martinez)
- **Esperado:** 400: el rango invertido debe rechazarse igual que en POST /ausencias y POST /ausencias/solicitar (ambos devuelven 400 ante el mismo input).
- **Obtenido:** 200 y la ausencia queda persistida con el rango invertido. Si luego se aprueba, buildDaysBetween no genera ningún día y no se bloquea nada en la planilla, además de que diasAusencia deja de guardar relación con el rango.
- **Repro:** 1) Crear una ausencia PENDIENTE del 2026-08-07 al 2026-08-08. 2) Login ana.martinez@demo.com. 3) PUT /ausencias/:id {"fechaInicio":"2026-08-20","fechaFin":"2026-08-01"}. 4) GET /ausencias/:id para confirmar que quedó persistido. updateAusenciaSchema no tiene los dos .refine() que sí tiene createAusenciaSchema (fechaFin >= fechaInicio y diasAusencia <= span del rango).
- **Evidencia:** HTTP 200 PUT /ausencias/40be2564-7ed1-48f3-aca6-6c9f0c142eb6 → {"tipo":"LICENCIA_ESPECIAL","estado":"PENDIENTE","fechaInicio":"2026-08-20T00:00:00.000Z","fechaFin":"2026-08-01T00:00:00.000Z","diasAusencia":2}.

### 🟡 MEDIA — PUT /ausencias/:id {aprobada:true} deja la ausencia aprobada a medias: estado PENDIENTE, sin aprobadaAt y sin bloquear los días
- **Endpoint:** `PUT /ausencias/:id` · **Rol:** RRHH (ana.martinez)
- **Esperado:** O rechazar el campo `aprobada` en PUT (la aprobación va por /avanzar), o aplicar la transición completa: estado APROBADA + aprobadaAt + inyección de los días bloqueados.
- **Obtenido:** Registro incoherente: aprobada=true / estado=PENDIENTE / aprobadaAt=null y ningún día bloqueado. La ausencia sigue circulando como pendiente en el flujo y a la vez figura como aprobada en los listados.
- **Repro:** 1) Login eduardo.ruiz@demo.com → POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-08-06', fechaFin:'2026-08-06', diasAusencia:1} → PENDIENTE. 2) Login ana.martinez@demo.com → PUT /ausencias/:id {"aprobada":true} → 200. 3) GET /ausencias/:id → estado sigue PENDIENTE con aprobada=true. 4) GET /planillas/<planilla del período de eduardo>/registros → el 2026-08-06 no tiene registro bloqueado. El handler setea aprobadaPorId pero no aprobadaAt, no cambia estado y no llama a inyectarDiasBloqueados.
- **Evidencia:** HTTP 200 PUT /ausencias/fd252fa5-b8e8-438a-9e86-bd3e2459cdef con body {"aprobada":true} → {"tipo":"FALTA_JUSTIFICADA","estado":"PENDIENTE","pasoActual":1,"aprobada":true,"aprobadaAt":null}. GET /planillas/2b2cf4c6.../registros → no existe registro con fecha '2026-08-06T00:00:00.000Z'.

### 🟡 MEDIA — /mis-solicitudes muestra las fechas de las solicitudes corridas un día hacia atrás ✅
- **Endpoint:** `GET /mis-solicitudes` · **Rol:** OPERADOR (eduardo.ruiz)
- **Esperado:** detalle 'Certificado médico del 03/08 al 04/08 (2 días)'.
- **Obtenido:** detalle 'Certificado médico del 02/08 al 03/08 (2 días)': el empleado ve en su pantalla de solicitudes un rango distinto al que pidió y al que figura bloqueado en su planilla.
- **Repro:** Servidor con TZ America/Buenos_Aires (UTC-3). 1) Login eduardo.ruiz@demo.com. 2) POST /ausencias/solicitar {tipo:'CERTIFICADO_MEDICO', fechaInicio:'2026-08-03', fechaFin:'2026-08-04', diasAusencia:2, numeroCertificado:'X'}. 3) GET /mis-solicitudes → buscar el item de tipo AUSENCIA y leer el campo `detalle`. La función fmtDate (mis-solicitudes.routes.ts:14) usa d.getDate()/d.getMonth() (hora local) sobre fechas guardadas a medianoche UTC. Afecta igual a los detalles de VACACION y PLANILLA.
- **Evidencia:** HTTP 200 GET /mis-solicitudes → {"id":"9204c73d-ef6e-4423-8e43-a68fe6c97762","tipo":"AUSENCIA","estado":"APROBADA","detalle":"Certificado médico del 02/08 al 03/08 (2 días)"} mientras GET /ausencias/9204c73d... devuelve {"fechaInicio":"2026-08-03T00:00:00.000Z","fechaFin":"2026-08-04T00:00:00.000Z"}

### 🟡 MEDIA — El operador no puede reenviar su propia ausencia rechazada
- **Endpoint:** `POST /ausencias/:id/enviar` · **Rol:** OPERADOR (carlos.medina)
- **Esperado:** El dueño de una ausencia RECHAZADA debería poder corregirla y reenviarla: es el flujo natural del rechazo y la UI le muestra el obsRechazo.
- **Obtenido:** 403 'No tiene permisos para esta acción'. Sólo un supervisor puede reenviarla; el operador debe crear otra solicitud desde cero y la rechazada queda para siempre en su historial.
- **Repro:** 1) Login carlos.medina@demo.com → POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-08-11', fechaFin:'2026-08-11', diasAusencia:1} → 201 PENDIENTE. 2) Login roberto.acosta@demo.com → POST /ausencias/:id/rechazar {motivo:'sin cobertura'} → 200 RECHAZADA. 3) Login carlos.medina@demo.com → POST /ausencias/:id/enviar. La ruta tiene requireLevel(LEVEL_SUPERVISOR) y no contempla al dueño del documento.
- **Evidencia:** HTTP 403 POST /ausencias/<id rechazada>/enviar con token de carlos.medina@demo.com → {"error":"No tiene permisos para esta acción"}. La misma llamada con roberto.acosta@demo.com devuelve HTTP 200 {"estado":"PENDIENTE","pasoActual":1,"obsRechazo":null}.

### 🟡 MEDIA — El operador no tiene forma de cancelar su propia solicitud de ausencia pendiente
- **Endpoint:** `DELETE /ausencias/:id` · **Rol:** OPERADOR (carlos.medina)
- **Esperado:** El dueño debería poder cancelar o editar su solicitud mientras está PENDIENTE y nadie la aprobó, como sí puede hacerlo con vacaciones (DELETE /vacaciones/:id permite al dueño borrar BORRADOR/PENDIENTE/RECHAZADA y devuelve el saldo).
- **Obtenido:** El operador que se equivoca de fecha o de tipo no puede deshacerlo: la solicitud sigue circulando por el flujo y sólo RRHH/ADMIN puede borrarla. Asimetría con el módulo de vacaciones.
- **Repro:** 1) Login carlos.medina@demo.com → POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-08-11', fechaFin:'2026-08-11', diasAusencia:1} → 201 PENDIENTE. 2) DELETE /ausencias/:id con su propio token → 403. 3) PUT /ausencias/:id {descripcion:'corregida'} → 403. 4) POST /ausencias/:id/revocar → 400 (sólo aplica a FRANCO_COMPENSATORIO). No existe ningún otro endpoint de cancelación.
- **Evidencia:** HTTP 403 DELETE /ausencias/<id propia PENDIENTE> con token de carlos.medina@demo.com → {"error":"No tiene permisos para esta acción"}. HTTP 403 PUT /ausencias/<misma id> → {"error":"No tiene permisos para esta acción"}. HTTP 400 POST /ausencias/<misma id>/revocar → {"error":"Solo se pueden revocar f

### 🟡 MEDIA — El supervisor no puede eliminar la ausencia BORRADOR que él mismo cargó, pero la UI le muestra el botón Eliminar
- **Endpoint:** `DELETE /ausencias/:id` · **Rol:** SUPERVISOR (roberto.acosta)
- **Esperado:** Quien puede crear la ausencia en BORRADOR debería poder descartarla; si no, la UI no debería ofrecer el botón.
- **Obtenido:** 403. El supervisor ve el botón Eliminar en su listado y al usarlo recibe 'No tiene permisos para esta acción'; el borrador queda vivo salvo que intervenga RRHH.
- **Repro:** 1) Login roberto.acosta@demo.com. 2) POST /ausencias {usuarioId:'<id de carlos.medina>', tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-09-10', fechaFin:'2026-09-10', diasAusencia:1, descripcion:'x'} → 201 con estado BORRADOR. 3) DELETE /ausencias/:id con el mismo token. En apps/web/src/pages/ausencias/AusenciasPage.tsx:374-381 el botón Eliminar se renderiza para cualquier usuario cuando a.estado === 'BORRADOR', pero la ruta exige requireLevel(LEVEL_RRHH).
- **Evidencia:** HTTP 201 POST /ausencias (roberto.acosta) → {"estado":"BORRADOR","requiereAprobacion":true}. HTTP 403 DELETE /ausencias/<esa id> con el mismo token → {"error":"No tiene permisos para esta acción"}.

### ⚪ BAJA — Se acepta una solicitud de ausencia con fecha absurda (1900-01-01)
- **Endpoint:** `POST /ausencias/solicitar` · **Rol:** OPERADOR (eduardo.ruiz)
- **Esperado:** 400 por fecha fuera de un rango razonable (p. ej. no anterior al ingreso del empleado ni más de N meses en el futuro).
- **Obtenido:** 201: la solicitud entra al circuito de aprobación con fecha de 1900 y ensucia listados, filtros por período y el calendario/gantt.
- **Repro:** 1) Login eduardo.ruiz@demo.com. 2) POST /ausencias/solicitar {tipo:'FALTA_JUSTIFICADA', fechaInicio:'1900-01-01', fechaFin:'1900-01-01', diasAusencia:1, descripcion:'x'}. El schema sólo valida formato y que fechaFin >= fechaInicio; no hay cota de razonabilidad (ni contra fechaIngreso del empleado ni contra un horizonte futuro).
- **Evidencia:** HTTP 201 POST /ausencias/solicitar → {"id":"5863d2b1-d2ab-4f11-8efe-70ab4339a4d0","tipo":"FALTA_JUSTIFICADA","estado":"PENDIENTE","fechaInicio":"1900-01-01T00:00:00.000Z","fechaFin":"1900-01-01T00:00:00.000Z","diasAusencia":1}.

---

## CAPACITACIONES — 13 (1 critica, 1 alta, 9 media, 2 baja)

### 🔴 CRITICA — Cualquier COORDINADOR+ puede finalizar una sesión de capacitación ajena que ni siquiera puede ver
- **Endpoint:** `POST /sesiones-capacitacion/:id/finalizar` · **Rol:** COORDINADOR (martin.lopez@demo.com, nivel 70, sector Fractura) sobre sesión de CMASS
- **Esperado:** 403. PUT /sesiones-capacitacion/:id, DELETE /:id y DELETE /:id/invitaciones/:invId sí validan 'organizador o RRHH+'; finalizar es la acción más destructiva y sólo valida empresaId + requireLevel(70).
- **Obtenido:** 200. Marca asistencia, crea un EmpleadoCapacitacion por asistente y llama a inyectarDiasBloqueados sobre la planilla de cada asistente (upsert con bloqueado=true, horasTrabajadas/horasNormales/extra en 0 y entradas/salidas en null): un coordinador de otro sector puede borrar las horas cargadas de empleados que no le corresponden si la fecha de la sesión cae dentro de un período con planilla.
- **Repro:** 1) login sandra.montenegro@demo.com (CMASS). 2) POST /capacitaciones/tipos como ana.martinez@demo.com (RRHH) {nombre:'x-tipo', vigenciaDias:180, alertaDias:15} → guardar tipoId. 3) Como sandra: POST /sesiones-capacitacion {tipoId, titulo:'x-sesionA', fecha:'2027-03-15T00:00:00.000Z', vacantes:2, lugar:'sala'} → sesionId. 4) POST /sesiones-capacitacion/{sesionId}/invitar {usuarioIds:[agustin.delgado, alfredo.soria]}. 5) Cada operador: GET /sesiones-capacitacion/mis-invitaciones y POST /sesiones-capacitacion/mis-invitaciones/{invId}/responder {aceptar:true}. 6) login martin.lopez@demo.com (COORDINADOR, sector Fractura). 7) GET /sesiones-capacitacion/{sesionId} → 403 'Sin permisos para ver esta
- **Evidencia:** GET /sesiones-capacitacion/fcd9fa17-3edb-49e9-9620-b949908d8376 (martin) → HTTP 403 {"error":"Sin permisos para ver esta sesión"} | POST /sesiones-capacitacion/fcd9fa17-3edb-49e9-9620-b949908d8376/finalizar (martin) → HTTP 200 {"ok":true,"asistieron":2}; luego GET /capacitaciones/mis-capacitaciones 

### 🟠 ALTA — Se puede FINALIZAR una sesión CANCELADA: crea registros de una capacitación que nunca ocurrió
- **Endpoint:** `POST /sesiones-capacitacion/:id/finalizar` · **Rol:** CMASS (sandra.montenegro@demo.com) — organizadora
- **Esperado:** 400 'La sesión ya no admite esta operación'. El endpoint sólo verifica estado === 'FINALIZADA'; CANCELADA queda fuera del guard, y responder invitaciones sí bloquea CANCELADA/FINALIZADA (hay un guard análogo escrito 20 líneas más arriba).
- **Obtenido:** 200 {"ok":true,"asistieron":1}: la sesión cancelada pasa a FINALIZADA, se crea el EmpleadoCapacitacion (el empleado pasó de 0 a 1 registros) y se dispara inyectarDiasBloqueados sobre su planilla. Queda un certificado de capacitación válido por una sesión que fue cancelada.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) POST /sesiones-capacitacion {tipoId (con vigenciaDias), titulo:'x-sesionC', fecha:'2027-03-15T00:00:00.000Z', vacantes:1} → sesionId. 3) POST /sesiones-capacitacion/{sesionId}/invitar {usuarioIds:[luis.contreras]}. 4) luis.contreras acepta vía POST /sesiones-capacitacion/mis-invitaciones/{invId}/responder {aceptar:true}. 5) DELETE /sesiones-capacitacion/{sesionId} (cancela) → 200; GET /sesiones-capacitacion/{sesionId} confirma estado CANCELADA. 6) Contar GET /capacitaciones/mis-capacitaciones de luis.contreras. 7) POST /sesiones-capacitacion/{sesionId}/finalizar {} → observar status y volver a contar los registros del empleado.
- **Evidencia:** DELETE /sesiones-capacitacion/c3d9cff0-603e-4883-bdf0-70b7bb7ff4e6 → HTTP 200 {"ok":true}; GET → estado "CANCELADA"; POST /sesiones-capacitacion/c3d9cff0-603e-4883-bdf0-70b7bb7ff4e6/finalizar → HTTP 200 {"ok":true,"asistieron":1}; registros de luis.contreras 0 → 1

### 🟡 MEDIA — Una invitación RECHAZADA sigue ocupando vacante: no se puede invitar un reemplazo
- **Endpoint:** `POST /sesiones-capacitacion/:id/invitar` · **Rol:** CMASS (sandra.montenegro@demo.com) como organizadora
- **Esperado:** 201: con vacantes=2, 1 rechazada y 1 pendiente, debería poder invitarse un reemplazo. El control de cupo debería contar invitaciones vigentes (PENDIENTE + ACEPTADA), no el total histórico.
- **Obtenido:** 400 'No se pueden invitar 1 personas. Vacantes disponibles: 0 de 2'. sesiones-capacitacion.routes.ts:276-283 compara sesion._count.invitaciones (incluye RECHAZADAS) contra vacantes, así que cada rechazo quema un cupo de forma permanente y la sesión no puede llenarse salvo borrando manualmente la invitación rechazada.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) POST /sesiones-capacitacion {tipoId, titulo:'x-sesionB', fecha:'2027-03-15T00:00:00.000Z', vacantes:2} → sesionId. 3) POST /sesiones-capacitacion/{sesionId}/invitar {usuarioIds:[emilio.barrios, german.arias]} → 201. 4) emilio.barrios: GET /sesiones-capacitacion/mis-invitaciones y POST /mis-invitaciones/{invId}/responder {aceptar:false, motivoRechazo:'estoy de guardia'} → 200 estado RECHAZADA. 5) Como sandra: POST /sesiones-capacitacion/{sesionId}/invitar {usuarioIds:[ivan.cardozo]} → observar el 400 aunque hay 0 aceptadas sobre 2 vacantes.
- **Evidencia:** HTTP 400 {"error":"No se pueden invitar 1 personas. Vacantes disponibles: 0 de 2"} con stats de la sesión = {"aceptadas":0,"pendientes":1,"rechazadas":1,"total":2} y vacantes=2

### 🟡 MEDIA — GET /capacitaciones/registros ignora el filtro usuarioId para roles de nivel < 90
- **Endpoint:** `GET /capacitaciones/registros?usuarioId=<id>` · **Rol:** CMASS (sandra.montenegro@demo.com, nivel 75); afecta a todo nivel < 90
- **Esperado:** Sólo los registros del usuarioId pedido (intersección del filtro con el alcance por sector).
- **Obtenido:** Devuelve todos los registros del sector: capacitaciones.routes.ts:141 hace where.usuarioId = tipoId/usuarioId del query y luego la línea 152 lo pisa con where.usuarioId = { in: sectorUsers }. El filtro explícito se descarta en silencio (mismo patrón en GET /resumen, que no acepta filtros).
- **Repro:** 1) Con ana.martinez@demo.com (RRHH) crear dos registros para dos empleados distintos del sector CMASS: POST /capacitaciones/registros {usuarioId:'ec6b804f-197b-4ad6-b0e9-ef7db4f9dc4c' (agustin.delgado), tipoId, fechaRealizacion:'2026-07-01T00:00:00.000Z'} y otro para alfredo.soria. 2) login sandra.montenegro@demo.com. 3) GET /capacitaciones/registros?usuarioId=ec6b804f-197b-4ad6-b0e9-ef7db4f9dc4c → observar que la respuesta trae registros de otros usuarioId.
- **Evidencia:** GET /capacitaciones/registros?usuarioId=ec6b804f-197b-4ad6-b0e9-ef7db4f9dc4c (sandra) → HTTP 200 con 2 registros de 2 usuarios distintos (1 pertenece a otro empleado)

### 🟡 MEDIA — POST /capacitaciones/registros devuelve 500 con fecha inválida o con usuarioId inexistente
- **Endpoint:** `POST /capacitaciones/registros` · **Rol:** RRHH (ana.martinez@demo.com) — el endpoint es nivel 90
- **Esperado:** 400 'fechaRealizacion inválida' y 400/404 'Usuario no encontrado'. El schema zod declara fechaRealizacion como z.string() sin refine de fecha y no se valida que usuarioId/tipoId existan ni que pertenezcan a la empresa del llamador.
- **Obtenido:** 500 'Error interno' en ambos casos (Invalid Date y violación de FK P2003 sin mapear). Nota adicional: tampoco se valida que usuarioId/tipoId sean de la misma empresa que el llamador.
- **Repro:** 1) login ana.martinez@demo.com. 2) POST /capacitaciones/registros {usuarioId:<uuid válido de un empleado>, tipoId:<uuid de tipo>, fechaRealizacion:'no-es-fecha'} → observar 500. 3) POST /capacitaciones/registros {usuarioId:'00000000-0000-0000-0000-000000000000', tipoId:<uuid de tipo>, fechaRealizacion:'2026-07-01T00:00:00.000Z'} → observar 500.
- **Evidencia:** fechaRealizacion:'no-es-fecha' → HTTP 500 {"error":"Error interno"}; usuarioId inexistente → HTTP 500 {"error":"Error interno"}

### 🟡 MEDIA — POST /sesiones-capacitacion devuelve 500 con fecha inválida o con tipoId inexistente
- **Endpoint:** `POST /sesiones-capacitacion` · **Rol:** CMASS (sandra.montenegro@demo.com, nivel 75)
- **Esperado:** 400 'fecha inválida' y 400/404 'Tipo de capacitación no encontrado' (además debería validarse que el tipo pertenezca a la empresa del llamador).
- **Obtenido:** 500 'Error interno' en ambos casos: createSesionSchema valida fecha como z.string() y luego hace new Date(fecha); el tipoId inexistente rompe por FK (P2003) sin mapeo.
- **Repro:** 1) login sandra.montenegro@demo.com. 2) POST /sesiones-capacitacion {tipoId:<uuid válido>, titulo:'x', fecha:'no-es-fecha', vacantes:2} → observar 500. 3) POST /sesiones-capacitacion {tipoId:'00000000-0000-0000-0000-000000000000', titulo:'x', fecha:'2027-03-15T00:00:00.000Z', vacantes:1} → observar 500. Contrastar con vacantes:0, que sí devuelve 400 por zod.
- **Evidencia:** fecha:'no-es-fecha' → HTTP 500 {"error":"Error interno"}; tipoId inexistente → HTTP 500 {"error":"Error interno"}; vacantes:0 → HTTP 400 {"error":"Datos inválidos",...}

### 🟡 MEDIA — Una invitación RECHAZADA sigue consumiendo la vacante: la sesión de capacitación queda bloqueada y no se puede invitar a un reemplazo
- **Endpoint:** `POST /sesiones-capacitacion/:id/invitar` · **Rol:** Organizador RRHH (ana.martinez@demo.com) / OPERADOR que rechaza (fernando.vera@demo.com)
- **Esperado:** Al rechazar, la vacante debe liberarse: invitar a un reemplazo debería devolver 201 (0 ocupadas de 1 vacante).
- **Obtenido:** 400 'No se pueden invitar 1 personas. Vacantes disponibles: 0 de 1'. La sesión queda inutilizable: nadie ocupa la vacante y no se puede invitar a nadie más.
- **Repro:** 1) Login ana.martinez@demo.com (RRHH). 2) POST /sesiones-capacitacion {tipoId:'4ecab233-2088-4b94-9a25-133927e96289', titulo:'sim sesion rechazar', fecha:'2026-09-16', vacantes:1} → 201, guardar sesionId. 3) POST /sesiones-capacitacion/<sesionId>/invitar {usuarioIds:['b8dcb01d-bb52-4b5e-b532-65453e1772f4']} (fernando.vera) → 201, guardar invitacionId. 4) Login fernando.vera@demo.com y POST /sesiones-capacitacion/mis-invitaciones/<invitacionId>/responder {aceptar:false, motivoRechazo:'estoy de guardia'} → 200, estado RECHAZADA. 5) Como ana, GET /sesiones-capacitacion/<sesionId> → stats {aceptadas:0, pendientes:0, rechazadas:1}, o sea cero personas ocupando la vacante. 6) POST /sesiones-capaci
- **Evidencia:** HTTP 200 GET /sesiones-capacitacion/<id> → {"estado":"ABIERTA","vacantes":1,"stats":{"aceptadas":0,"pendientes":0,"rechazadas":1,"total":1}}. HTTP 400 POST /sesiones-capacitacion/<id>/invitar → {"error":"No se pueden invitar 1 personas. Vacantes disponibles: 0 de 1"}

### 🟡 MEDIA — Al cancelar una sesión, los invitados en estado PENDIENTE no reciben aviso y les queda una invitación fantasma con botones que fallan
- **Endpoint:** `DELETE /sesiones-capacitacion/:id` · **Rol:** OPERADOR invitado (oscar.castro@demo.com); cancela el organizador RRHH (ana.martinez@demo.com)
- **Esperado:** Al cancelar la sesión se debería (a) notificar también a los invitados PENDIENTE, que son justamente los que todavía tenían la invitación abierta, y (b) cerrar/marcar sus invitaciones para que no queden como pendientes de respuesta.
- **Obtenido:** Los invitados PENDIENTE no reciben ninguna notificación y su invitación queda viva en 'Mis invitaciones' con estado PENDIENTE; al intentar responderla la API devuelve 400 'La sesión ya no admite respuestas'.
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /sesiones-capacitacion {tipoId:'4ecab233-2088-4b94-9a25-133927e96289', titulo:'sim sesion cancelada', fecha:'2026-09-17', vacantes:2} → 201. 3) POST /sesiones-capacitacion/<sesionId>/invitar {usuarioIds:['6b7eb63f-992e-4383-b638-8da71f931a0f']} → 201, guardar invitacionId. NO responder la invitación (queda PENDIENTE). 4) Login oscar.castro@demo.com y GET /notificaciones — anotar los ids. 5) Como ana, DELETE /sesiones-capacitacion/<sesionId> → 200 {ok:true}. 6) Como oscar, GET /notificaciones otra vez: NO aparece ninguna notificación nueva de cancelación (sesiones-capacitacion.routes.ts línea 204 sólo carga invitaciones where estado='ACEPTADA' para noti
- **Evidencia:** HTTP 200 DELETE /sesiones-capacitacion/0d65865e-97da-48ec-8a09-8cc6d32766be → {"ok":true}. Diff de GET /notificaciones de oscar antes/después = 0 notificaciones nuevas. HTTP 200 GET /sesiones-capacitacion/mis-invitaciones → item con {"estado":"PENDIENTE","sesion":{"estado":"CANCELADA"}}. HTTP 400 PO

### 🟡 MEDIA — POST /sesiones-capacitacion acepta una fecha no parseable y revienta con 500 en vez de validar con 400
- **Endpoint:** `POST /sesiones-capacitacion` · **Rol:** RRHH (ana.martinez@demo.com); reproducible por cualquier COORDINADOR+
- **Esperado:** 400 'Datos inválidos' indicando que 'fecha' no es una fecha válida.
- **Obtenido:** 500 {"error":"Error interno"} — el cliente no puede distinguir un error suyo de una caída del servidor.
- **Repro:** 1) POST /auth/login {email:'ana.martinez@demo.com',password:'Test1234!'}. 2) POST /sesiones-capacitacion {tipoId:'4ecab233-2088-4b94-9a25-133927e96289', titulo:'fecha mala', fecha:'no-es-fecha', vacantes:2}. El schema zod declara fecha como z.string() sin refine de fecha (sesiones-capacitacion.routes.ts línea 20), así que pasa la validación y llega a new Date('no-es-fecha') = Invalid Date, que Prisma rechaza. Observar el 500. Nota: el resto de la API usa el validador fechaFlexible (src/utils/zod.utils.ts) justamente para esto; acá no se aplica.
- **Evidencia:** HTTP 500 — POST /sesiones-capacitacion body={"tipoId":"4ecab233-2088-4b94-9a25-133927e96289","titulo":"sim-op-social-... fecha mala","fecha":"no-es-fecha","vacantes":2} → {"error":"Error interno"}

### 🟡 MEDIA — POST /sesiones-capacitacion con tipoId inexistente devuelve 500 (violación de FK sin manejar) en vez de 400/404
- **Endpoint:** `POST /sesiones-capacitacion` · **Rol:** RRHH (ana.martinez@demo.com); reproducible por cualquier COORDINADOR+
- **Esperado:** 400/404 con un mensaje del estilo 'Tipo de capacitación no encontrado'.
- **Obtenido:** 500 {"error":"Error interno"}
- **Repro:** 1) Login ana.martinez@demo.com. 2) POST /sesiones-capacitacion {tipoId:'00000000-0000-0000-0000-000000000000', titulo:'tipo inexistente', fecha:'2026-09-18', vacantes:2}. El uuid pasa el schema pero no existe en tipos_capacitacion; el handler (líneas 126-157) no valida existencia ni pertenencia a la empresa y el catch genérico devuelve 500. Mismo agujero para el campo empresaId cruzado: tampoco se comprueba que el tipo pertenezca a la empresa del llamante.
- **Evidencia:** HTTP 500 — POST /sesiones-capacitacion body={"tipoId":"00000000-0000-0000-0000-000000000000","titulo":"sim-op-social-... tipo inexistente","fecha":"2026-09-18","vacantes":2} → {"error":"Error interno"}

### 🟡 MEDIA — POST /capacitaciones/registros con usuarioId inexistente devuelve 500 (violación de FK sin manejar) en vez de 400/404
- **Endpoint:** `POST /capacitaciones/registros` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400/404 'Usuario no encontrado' (y validación de que el usuario pertenece a la empresa del llamante, como hace POST /notificaciones).
- **Obtenido:** 500 {"error":"Error interno"}
- **Repro:** 1) Login ana.martinez@demo.com (RRHH). 2) POST /capacitaciones/registros {usuarioId:'00000000-0000-0000-0000-000000000000', tipoId:'4ecab233-2088-4b94-9a25-133927e96289', fechaRealizacion:'2026-07-03', observaciones:'prueba'}. El handler (capacitaciones.routes.ts líneas 194-229) sólo valida el schema zod y crea directo; no verifica que el usuario exista NI que pertenezca a la empresa del llamante (mismo hueco de aislamiento multi-empresa que en POST /notificaciones, donde sí se valida). Con un uuid inexistente la FK explota y el catch genérico responde 500.
- **Evidencia:** HTTP 500 — POST /capacitaciones/registros body={"usuarioId":"00000000-0000-0000-0000-000000000000","tipoId":"4ecab233-2088-4b94-9a25-133927e96289","fechaRealizacion":"2026-07-03","observaciones":"sim-op-social-... usuario inexistente"} → {"error":"Error interno"}

### ⚪ BAJA — POST /sesiones-capacitacion/:id/finalizar con asistieron no-array devuelve 500
- **Endpoint:** `POST /sesiones-capacitacion/:id/finalizar` · **Rol:** CMASS (sandra.montenegro@demo.com)
- **Esperado:** 400 'Datos inválidos' (el body de finalizar no pasa por zod, a diferencia del resto del router). Con asistieron como string se llega a String.prototype.includes y la asistencia se decide por coincidencia de subcadena, otro comportamiento indefinido.
- **Obtenido:** 500 'Error interno' (asistieronIds.includes no existe en number → TypeError). La sesión queda a medio finalizar: se procesan invitaciones antes del fallo y el estado FINALIZADA no se llega a escribir.
- **Repro:** 1) Como sandra crear una sesión con vacantes:1, invitar a german.arias y que acepte (hace falta al menos 1 invitación ACEPTADA para que se recorra el loop). 2) POST /sesiones-capacitacion/{sesionId}/finalizar {asistieron: 12345} → observar 500.
- **Evidencia:** POST /sesiones-capacitacion/5d90726f-793f-4bbf-9ffc-43ec70714d23/finalizar {"asistieron":12345} → HTTP 500 {"error":"Error interno"}

### ⚪ BAJA — Se acepta un registro de capacitación con fechaVencimiento anterior a la fechaRealizacion
- **Endpoint:** `POST /capacitaciones/registros` · **Rol:** RRHH (ana.martinez@demo.com)
- **Esperado:** 400: fechaVencimiento debe ser posterior a fechaRealizacion.
- **Obtenido:** 201, el registro queda inconsistente y contamina los contadores de /capacitaciones/resumen (suma en 'vencidas').
- **Repro:** 1) login ana.martinez@demo.com. 2) POST /capacitaciones/registros {usuarioId:<empleado>, tipoId:<tipo>, fechaRealizacion:'2026-07-01T00:00:00.000Z', fechaVencimiento:'2020-01-01T00:00:00.000Z'} → observar 201. 3) GET /capacitaciones/registros (como CMASS del sector) → el registro aparece con statusCap 'vencida' pese a estar 'realizado' en el futuro.
- **Evidencia:** HTTP 201 {"id":"e677d208-297e-4bb9-af98-a41e3ebc90d8","fechaRealizacion":"2026-07-01T00:00:00.000Z","fechaVencimiento":"2020-01-01T00:00:00.000Z"}

---

## EXPORT — 11 (2 alta, 6 media, 3 baja)

### 🟠 ALTA — La pestaña 'Pendientes' de la pantalla de Cierre (RRHH) está muerta: pega a GET /admin/usuarios, que no existe (404 HTML)
- **Endpoint:** `GET /admin/usuarios` · **Rol:** RRHH
- **Esperado:** La pestaña 'Pendientes de aprobación' debería listar a los empleados sin planilla aprobada del período (los mismos 128 que devuelve /export/pendientes) y habilitar el botón 'Descargar Excel'.
- **Obtenido:** 404. La pestaña muestra siempre 'Pendientes de aprobación (0)', la tabla vacía y el botón 'Descargar Excel' queda permanentemente deshabilitado (disabled={pendientesTab.length === 0}), aunque el endpoint de Excel funciona. Además la API devuelve HTML en vez de JSON para rutas inexistentes bajo /api/v1, lo que rompe cualquier manejo de error del cliente.
- **Repro:** 1) Login maria.rodriguez@demo.com (RRHH). 2) GET /api/v1/admin/usuarios con el Bearer -> 404 con cuerpo HTML de Express. La ruta no está montada en src/routes/index.ts (sólo /admin/sectores, /admin/diagramas, /admin/flujos, /admin/config, /admin/roles, /admin/alertas). 3) apps/web/src/pages/admin/CierrePage.tsx:129 hace queryFn: api.get('/admin/usuarios') para armar `allUsers`, del que sale `pendientesTab`. Con la query en error, allUsers=[] siempre. 4) Contrastar con GET /export/pendientes (mismo token) que sí devuelve 128 empleados pendientes en 10 hojas.
- **Evidencia:** GET /api/v1/admin/usuarios -> HTTP 404, content-type text/html; charset=utf-8, body: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot GET /api/v1/admin/usuarios</pre></body></html>'. GET /api/v1/export/pendientes (mismo token) -> 200, xlsx de 1

### 🟠 ALTA — POST /export/cierre ('cierre de período') no tiene noción de período: exporta todo el histórico y la hoja Resumen no distingue los períodos
- **Endpoint:** `POST /export/cierre` · **Rol:** RRHH
- **Esperado:** Un 'cierre de período' debería recibir y validar el período (rechazando rango invertido con 400) y exportar sólo las planillas de ese período; la hoja Resumen debería identificar a qué período corresponde cada fila.
- **Obtenido:** 200 y el MISMO archivo en ambos casos: el rango invertido se ignora por completo. El Resumen trae 3 filas con dos 'Rojas, Emanuel' idénticas en encabezado (una de marzo y otra de mayo 2029) y no hay columna de período: quien liquida no puede saber a qué mes corresponde cada fila ni evitar contar dos veces al mismo empleado.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) Hacer que emanuel.rojas@demo.com tenga DOS planillas aprobadas de períodos distintos: una 2029-03-21..2029-03-23 y otra 2029-05-21..2029-05-21 (crear, cargar registros, enviar, y RRHH POST /planillas/:id/avanzar). 3) POST /export/cierre {"sectorIds":["86db0783-542a-4680-97b3-d4f7ccf0ce51"],"forzar":true}. 4) Abrir la hoja 'Resumen'. 5) Repetir el POST agregando periodoInicio:'2029-12-31T00:00:00.000Z' y periodoFin:'2029-01-01T00:00:00.000Z' (rango invertido). El handler (src/routes/export.routes.ts:471) sólo lee sectorIds/exportarTodos/forzar y filtra por estado APROBADA/CERRADA, sin filtro de fechas.
- **Evidencia:** POST /export/cierre {sectorIds:[almacen],forzar:true} -> 200. Resumen headers = ["Empleado","Legajo","Sector","Estado","Hs Normales","Hs Extra 50%","Hs Extra 100%","Hs Viaje (maneja)","Hs Viaje (no maneja)","Días Campo","Días Base","Feriados Trab.","Francos Trab.","Días Ausencia","Viandas"]; filas =

### 🟡 MEDIA — POST /exportaciones/cierre cierra planillas sin escribir PlanillaHistorial: quedan CERRADAS sin traza de quién ni cuándo
- **Endpoint:** `POST /exportaciones/cierre` · **Rol:** RRHH
- **Esperado:** Igual que el cierre individual: una entrada de PlanillaHistorial APROBADA->CERRADA con usuarioId del que cerró, por auditoría del período.
- **Obtenido:** 200 {ok:true, planillasCerradas:2} y las planillas pasan a CERRADA, pero el historial no registra el cierre. La planilla queda cerrada sin ninguna traza de autoría/fecha en su historial (el campo cerradaAt sí se setea, pero no hay actor).
- **Repro:** 1) Tener dos planillas APROBADAS con el mismo período exacto (ej. 2029-03-21T00:00:00.000Z .. 2029-03-23T00:00:00.000Z). 2) Login maria.rodriguez@demo.com y POST /exportaciones/cierre {"periodoInicio":"2029-03-21T00:00:00.000Z","periodoFin":"2029-03-23T00:00:00.000Z"}. 3) GET /planillas/<id>/historial. Comparar con el camino individual POST /planillas/:id/cerrar, que sí crea la entrada APROBADA->CERRADA (planillas.routes.ts:738).
- **Evidencia:** POST /exportaciones/cierre -> HTTP 200 {"ok":true,"planillasCerradas":2,"usuarios":["Rojas Emanuel","Paz Darío"]}. GET /planillas/bce3e485-ce81-492f-a7eb-ed2e563139fa/historial -> 200 con estados ["-->BORRADOR","BORRADOR->ENVIADA","ENVIADA->APROBADA"] (ninguna entrada CERRADA), mientras GET /planill

### 🟡 MEDIA — POST /export/cierre devuelve 500 'Error interno' si sectorIds no es un array de strings (sin validación de body)
- **Endpoint:** `POST /export/cierre` · **Rol:** RRHH
- **Esperado:** 400 'Datos inválidos' con detalle del campo (como hace POST /exportaciones, que sí usa zod).
- **Obtenido:** 500 {"error":"Error interno"} en ambos casos.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) POST /export/cierre body {"sectorIds":"abc","forzar":true}. 3) POST /export/cierre body {"sectorIds":[123,456],"forzar":true}. El handler hace `if (!exportarTodos && sectorIds?.length) userFilter.sectorId = { in: sectorIds }` sin parsear el body con zod, así que Prisma recibe un tipo inválido y explota.
- **Evidencia:** POST /export/cierre {"sectorIds":"abc","forzar":true} -> HTTP 500 {"error":"Error interno"}. POST /export/cierre {"sectorIds":[123,456],"forzar":true} -> HTTP 500 {"error":"Error interno"}. Como contraste, {"sectorIds":["00000000-0000-0000-0000-000000000000"],"forzar":true} -> 400 {"error":"No hay p

### 🟡 MEDIA — POST /exportaciones/cierre devuelve 500 con fechas inválidas o sectorId no-string (sin validación de body)
- **Endpoint:** `POST /exportaciones/cierre` · **Rol:** RRHH
- **Esperado:** 400 'Datos inválidos' (el POST /exportaciones hermano sí valida con zod y responde 400 'Fecha inválida (use formato YYYY-MM-DD o ISO 8601)').
- **Obtenido:** 500 {"error":"Error interno"} en ambos casos. Es una operación de escritura masiva (cierra planillas) sin ninguna validación de entrada.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) POST /exportaciones/cierre body {"periodoInicio":"banana","periodoFin":"tomate"} -> el handler sólo chequea que existan y hace new Date(periodoInicio) => Invalid Date, que Prisma rechaza. 3) POST /exportaciones/cierre body {"periodoInicio":"2029-03-21T00:00:00.000Z","periodoFin":"2029-03-23T00:00:00.000Z","sectorId":12345}.
- **Evidencia:** POST /exportaciones/cierre {"periodoInicio":"banana","periodoFin":"tomate"} -> HTTP 500 {"error":"Error interno"}. POST /exportaciones/cierre {"periodoInicio":"2029-03-21T00:00:00.000Z","periodoFin":"2029-03-23T00:00:00.000Z","sectorId":12345} -> HTTP 500 {"error":"Error interno"}. POST /exportacion

### 🟡 MEDIA — GET /export/planilla/:id no exporta el turno 2: la fila del Excel muestra menos horas de las que declara
- **Endpoint:** `GET /export/planilla/:id` · **Rol:** RRHH / dueño de la planilla
- **Esperado:** El Excel debería reflejar los dos turnos (o al menos no mostrar un horario que contradice las horas del mismo renglón), porque es el papel que firman trabajador y supervisor.
- **Obtenido:** La fila muestra Entró 08:00 / Salió 12:00 (4 horas de reloj) pero Hs Trabajadas = 8. El turno 2 desaparece: el comprobante firmado es internamente incoherente y no permite auditar la jornada partida.
- **Repro:** 1) Login dario.paz@demo.com, crear planilla y POST /planillas/:id/registros con turno partido: {fecha:'2029-03-21T00:00:00.000Z', entradaTurno1: <ISO de 08:00 local>, salidaTurno1: <ISO de 12:00 local>, entradaTurno2: <ISO de 14:00 local>, salidaTurno2: <ISO de 18:00 local>, lugarTrabajo:'BASE'} -> la API responde horasTrabajadas=8. 2) GET /export/planilla/:id (con token RRHH o del dueño) y abrir la primera fila de datos (fila 12). El handler (export.routes.ts:206-207) sólo escribe fmtTime(r.entradaTurno1) y fmtTime(r.salidaTurno1); entradaTurno2/salidaTurno2 no se exportan a ninguna columna.
- **Evidencia:** GET /export/planilla/bce3e485-ce81-492f-a7eb-ed2e563139fa -> HTTP 200, content-type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, archivo válido (empieza con 'PK'). Leído con exceljs: C12='08:00', D12='12:00', E12=8. Registro en la API: {entradaTurno1:'...T11:00:00.000Z', salida

### 🟡 MEDIA — SUPERVISOR y COORDINADOR pueden ver la planilla de su gente pero no exportarla (403), y el botón 'Excel' del detalle no está gateado: falla en silencio
- **Endpoint:** `GET /export/planilla/:id` · **Rol:** SUPERVISOR (60) y COORDINADOR (70)
- **Esperado:** Quien puede ver y aprobar la planilla debería poder descargar su Excel (o, como mínimo, el botón no debería mostrarse ni fallar en silencio).
- **Obtenido:** 403 {"error":"Sin permisos para exportar esta planilla"}. En la UI el botón 'Excel' no hace absolutamente nada (error tragado), sin mensaje al usuario.
- **Repro:** 1) Login juancarlos.herrera@demo.com (COORDINADOR, nivel 70) o roberto.acosta@demo.com (SUPERVISOR, nivel 60). 2) GET /planillas -> tomar una planilla ajena visible (ej. la de 'Flores' en EN_REVISION, id ...33289d). 3) GET /planillas/<id> con ese token -> 200 (la puede abrir y aprobar). 4) GET /export/planilla/<id> con el mismo token -> 403. El guard de export.routes.ts:50 exige nivel>=90, mientras que la visibilidad de /planillas/:id es por flujo. 5) En apps/web/src/pages/planillas/PlanillaDetailPage.tsx:959 el botón 'Excel' se renderiza sin ninguna condición de rol y su onClick tiene `catch { /* noop */ }`.
- **Evidencia:** juancarlos.herrera@demo.com rol=COORDINADOR nivel=70: GET /planillas -> 200 (11 planillas); GET /planillas/<ajena> -> 200; GET /export/planilla/<ajena> -> 403 {"error":"Sin permisos para exportar esta planilla"}. roberto.acosta@demo.com rol=SUPERVISOR nivel=60: GET /planillas/<ajena> -> 200; GET /ex

### 🟡 MEDIA — Las horas de viaje del acompañante se pierden: la columna 'Hs Viaje (no maneja)' del cierre es estructuralmente siempre 0
- **Endpoint:** `POST /export/cierre` · **Rol:** RRHH
- **Esperado:** O bien la columna refleja las horas de viaje declaradas por quien no maneja (horasViajeInput), o bien no existe. Hoy el dato que el operador carga se descarta en silencio.
- **Obtenido:** La columna existe en el Resumen y siempre vale 0.00 para todas las filas; las 2 horas de viaje cargadas por dario no aparecen en ninguna hoja del Excel de cierre ni en el CSV de sector.
- **Repro:** 1) Login dario.paz@demo.com y POST /planillas/:id/registros {fecha:'2029-03-23T00:00:00.000Z', entradaTurno1:<07:00>, salidaTurno1:<19:00>, lugarTrabajo:'CAMPO', maneja:false, horasViajeInput:2}. La API guarda horasViajeInput=2 pero devuelve horasViajeCalc=0 (calculo.utils.ts:100 sólo asigna viaje si lugar==='CAMPO' && maneja). 2) Aprobar la planilla y POST /export/cierre {sectorIds:['86db0783-542a-4680-97b3-d4f7ccf0ce51'],forzar:true}. 3) Mirar la columna 'Hs Viaje (no maneja)' del Resumen: el filtro es `!r.maneja && Number(r.horasViajeCalc) > 0`, condición que no puede darse nunca.
- **Evidencia:** POST registro con maneja:false, horasViajeInput:2 -> 201 con horasViajeCalc='0'. POST /export/cierre -> 200; hoja Resumen fila 2 ['Paz, Darío','D048','Almacén','CERRADA','16.00','4.00','4.00','0.00','0.00',1,2,1,0,0,2] -> 'Hs Viaje (no maneja)'=0.00. Recorrido de todas las filas del Resumen: ninguna

### ⚪ BAJA — POST /exportaciones devuelve 500 si totalRegistros excede el rango Int32 de Postgres
- **Endpoint:** `POST /exportaciones` · **Rol:** RRHH
- **Esperado:** 400 'Datos inválidos' indicando el campo fuera de rango.
- **Obtenido:** 500 {"error":"Error interno"} (el error de Prisma se traga y se responde genérico).
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) POST /exportaciones {"periodoInicio":"2029-03-21T00:00:00.000Z","periodoFin":"2029-03-23T00:00:00.000Z","nombreArchivo":"x.xlsx","totalRegistros":2147483648}. El schema zod usa z.number().int() sin .max(), y la columna es Int (int4).
- **Evidencia:** POST /exportaciones {...,"totalRegistros":2147483648} -> HTTP 500 {"error":"Error interno"}. Con totalRegistros:6 -> HTTP 201.

### ⚪ BAJA — POST /exportaciones acepta totalPersonas y totalRegistros negativos
- **Endpoint:** `POST /exportaciones` · **Rol:** RRHH
- **Esperado:** 400: los contadores de un historial de exportaciones no pueden ser negativos (falta .nonnegative()/.min(0) en exportacionSchema).
- **Obtenido:** 201, y el registro queda persistido en el historial de exportaciones con -50 personas y -999 registros.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) POST /exportaciones {"periodoInicio":"2029-03-21T00:00:00.000Z","periodoFin":"2029-03-23T00:00:00.000Z","nombreArchivo":"neg.xlsx","totalPersonas":-50,"totalRegistros":-999}. 3) GET /exportaciones y ver el registro creado.
- **Evidencia:** POST /exportaciones con totalPersonas:-50, totalRegistros:-999 -> HTTP 201 {"id":"a950f361-6bb1-4702-a873-d1f2275d7411","empresaId":"32e126e4-...","generadaPorId":"a0ff3d61-...","totalPersonas":-50,"totalRegistros":-999}.

### ⚪ BAJA — En el Excel de cierre las horas se escriben como texto, no como número: Excel no las suma
- **Endpoint:** `POST /export/cierre` · **Rol:** RRHH
- **Esperado:** Valores numéricos con numFmt '0.00' (como sí hace GET /export/planilla/:id, que escribe números con numFmt '0.0').
- **Obtenido:** Las celdas son strings ('16.00', '4.00'...). En Excel salen alineadas a la izquierda con el aviso de 'número guardado como texto': SUMA/PROMEDIO y las tablas dinámicas las ignoran hasta convertirlas a mano, justo en la planilla que se usa para liquidar.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) POST /export/cierre {"sectorIds":["86db0783-542a-4680-97b3-d4f7ccf0ce51"],"forzar":true}. 3) Abrir el xlsx (o leerlo con exceljs) y mirar el tipo de las celdas de 'Hs Normales', 'Hs Extra 50%', etc. tanto en 'Resumen' como en las hojas por empleado: el handler escribe Number(...).toFixed(2), que produce string.
- **Evidencia:** Leído con exceljs: hoja 'Resumen' celda E2 = '16.00' con typeof value === 'string'; fila completa ['Paz, Darío','D048','Almacén','CERRADA','16.00','4.00','4.00','0.00','0.00',1,2,1,0,0,2] — nótese que sólo Días Campo/Base/contadores son numéricos. Archivo: scratchpad\rrhh-cierre-export-cierre.xlsx

---

## ANALYTICS — 10 (1 alta, 4 media, 5 baja)

### 🟠 ALTA — /analytics/empresa?sectorId=X ignora el filtro en sectorBreakdown: los KPIs son de un sector y el gráfico por sector es de toda la empresa
- **Endpoint:** `GET /analytics/empresa?sectorId=<sectorId>` · **Rol:** RRHH (maria.rodriguez@demo.com) / ADMIN — es la pantalla Analytics-Empresa
- **Esperado:** Con sectorId, sectorBreakdown debería contener sólo ese sector (o al menos números coherentes con totals). AnalyticsPage.tsx usa data.sectorBreakdown para las barras 'por sector' y muestra el nombre del sector filtrado en el subtítulo.
- **Obtenido:** totals.planillas=11 / totalUsuarios=11 (Cabezales) pero sectorBreakdown devuelve las 22 entradas de la empresa, 9 con datos y 34 planillas en total. ausenciasBySector del MISMO payload sí queda restringido a ['Cabezales'], así que el JSON se contradice a sí mismo.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa → tomar el id de un sector con planillas (ej. 'Cabezales' = 493bb1a2-05d7-49cd-8a9b-01619f5a7d35). 3) GET /analytics/empresa?sectorId=493bb1a2-05d7-49cd-8a9b-01619f5a7d35. 4) Comparar totals/totalUsuarios (filtrados) contra sectorBreakdown (no filtrado). En analytics.routes.ts el qSectorId sólo entra en userWhere; el bloque 'Per-sector breakdown' consulta prisma.sector.findMany({where:{empresaId}}) sin qSectorId y recalcula cada sector con todos sus usuarios. Se reproduce igual con un sectorId inexistente (uuid válido) y con un sectorId no-uuid: KPIs en 0 pero breakdown con datos reales.
- **Evidencia:** 200 → totals={"horasNormales":80,"horasExtra50":8,"horasExtra100":0,"horasViaje":8,"diasCampo":2,"diasBase":8,"planillas":11}, totalUsuarios=11; sectorBreakdown(con datos)=[{"n":"Fractura","pl":7,"us":13},{"n":"Cabezales","pl":11,"us":11},{"n":"Logística y Transporte","pl":1,"us":10},{"n":"Administr

### 🟡 MEDIA — Fecha inválida en el querystring devuelve 500 'Error interno' (falta validación) — también en /planillas y /aprobaciones
- **Endpoint:** `GET /analytics/empresa?periodoInicio=2026-13-45` · **Rol:** RRHH (maria.rodriguez@demo.com); aplica a cualquier rol con acceso al endpoint
- **Esperado:** 400 con un mensaje de validación ('periodoInicio inválido'). Un parámetro de fecha mal formado es input de usuario, no una falla del servidor.
- **Obtenido:** 500 {"error":"Error interno"} en los 4 casos probados de /analytics/empresa y en /planillas y /aprobaciones. No filtra stack al cliente, pero registra un error no controlado en el server.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa?periodoInicio=2026-13-45 → 500. Igual con ?periodoInicio=cualquier-texto, ?periodoFin=hola, ?periodoFin=2026-99-99. 3) El mismo patrón sin guardas (new Date(qParam) sin validar → Invalid Date → Prisma explota) está en GET /planillas?periodoInicio=basura → 500 y GET /aprobaciones?periodoInicio=basura&periodoFin=basura2 → 500.
- **Evidencia:** GET /analytics/empresa?periodoInicio=2026-13-45 → 500 {"error":"Error interno"} · ?periodoInicio=sim-gerente-analytics-basura → 500 · ?periodoInicio=2026-12-21&periodoFin=hola → 500 · ?periodoFin=2026-99-99 → 500 · /planillas?periodoInicio=sim-…-basura → 500 · /aprobaciones?periodoInicio=…&periodoFi

### 🟡 MEDIA — El gráfico 'trend' de /analytics/empresa ignora periodoInicio/periodoFin: la tendencia no acompaña al período elegido
- **Endpoint:** `GET /analytics/empresa?periodoInicio=2026-12-21&periodoFin=2027-01-20` · **Rol:** RRHH (maria.rodriguez@demo.com) / ADMIN
- **Esperado:** El trend debería respetar el rango pedido (o, si es deliberado mostrar 'últimos 8 ciclos', el front no debería re-renderizarlo al cambiar el PeriodSelector). Hoy el usuario cambia de período, los KPIs cambian y la tendencia no.
- **Obtenido:** trend idéntico con y sin filtro de período (8 puntos), mientras los KPIs pasan de 40 a 3 planillas.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa (sin filtros) → guardar body.trend. 3) GET /analytics/empresa?periodoInicio=2026-12-21&periodoFin=2027-01-20 → comparar body.trend con el anterior: es byte a byte idéntico, aunque totals.planillas baja de 40 a 3. En analytics.routes.ts la consulta trendPlanillas usa where {usuarioId:{in:userIds}} SIN ...planillaPeriodFilter (a diferencia de planillaAgg/estadosCounts/topExtras). 4) Contraste: con ?sectorId=<id> el trend sí cambia (userIds cambia), lo que confirma que sólo se ignora el período.
- **Evidencia:** 200 → con período: totals.planillas=3, trend=["mar 29","may 29","mar 27","may 27","mar 28","may 28","oct 28","nov 28"]; sin filtros: totals.planillas=40, trend=["mar 29","may 29","mar 27","may 27","mar 28","may 28","oct 28","nov 28"] (JSON.stringify iguales)

### 🟡 MEDIA — GERENTE sin sector recibe 403 en /analytics/sector/:sid para TODOS los sectores, incluso los que /analytics/sectores le acaba de listar
- **Endpoint:** `GET /analytics/sector/:sid` · **Rol:** GERENTE (laura.gonzalez@demo.com)
- **Esperado:** O bien el gerente (80 > COORDINADOR 70) accede a los sectores (visibilidad transversal), o /analytics/sectores no debería listarle sectores que después no puede abrir. Hoy el endpoint le entrega el menú y le niega todos los platos.
- **Obtenido:** 403 {"error":"Sin permiso"} en los 9 sectores reales + los 3 de prueba; 0/12 accesibles.
- **Repro:** 1) Login laura.gonzalez@demo.com. 2) GET /analytics/sectores → 200 con 12 sectores (el guard es requireLevel(LEVEL_COORDINADOR=70) y ella es 80). 3) GET /analytics/sector/<id> para cada uno de esos ids → 403 en todos. El guard de analytics.routes.ts es: if (rolNivel < LEVEL_RRHH) { requester.sectorId !== sid → 403 }, y como sectorId es null nunca matchea. 4) Root cause confirmado: creando como ADMIN un usuario rol GERENTE con sectorId=Cabezales, ese gerente obtiene 200 en Cabezales y 403 en Fractura (guard OK); laura obtiene 403 en Cabezales.
- **Evidencia:** GET /analytics/sectores → 200 (12 sectores). GET /analytics/sector/:sid → {"Administración":403,"Almacén":403,"Cabezales":403,"CMASS":403,"Fractura":403,"Intendencia":403,"Logística y Transporte":403,"qa-vacaciones-1782446288560":403,"qa-vacaciones-1782446350195":403}; body: {"error":"Sin permiso"}

### 🟡 MEDIA — GERENTE sin sector no puede ver el analytics de ningún usuario ajeno (403), ni siquiera de operadores
- **Endpoint:** `GET /analytics/usuario/:uid` · **Rol:** GERENTE (laura.gonzalez@demo.com)
- **Esperado:** Un GERENTE debería poder abrir la ficha analítica de al menos la gente de la empresa/su línea (un COORDINADOR de nivel inferior sí puede, dentro de su sector).
- **Obtenido:** 403 {"error":"Sin permiso"} para cualquier uid distinto del propio; sólo funciona el auto-análisis.
- **Repro:** 1) Login laura.gonzalez@demo.com. 2) GET /analytics/usuario/<uid> para facundo.garcia@demo.com (OPERADOR/Fractura), lucas.fernandez@demo.com (SUPERVISOR), martin.lopez@demo.com (COORDINADOR) y maria.rodriguez@demo.com (RRHH) → 403 en los 4. 3) GET /analytics/usuario/<su propio id> → 200. El guard 'if (!isSelf && rolNivel < LEVEL_RRHH) { requester.sectorId !== usuario.sectorId → 403 }' nunca puede pasar con sectorId=null.
- **Evidencia:** GET /analytics/usuario/<otro> → 403 {"error":"Sin permiso"} (4/4 targets). GET /analytics/usuario/<self> → 200 {"usuario":{"id":"2e0c083b-…","nombre":"Laura","apellido":"González","legajo":"D031","sector":null,…}}

### ⚪ BAJA — GET /analytics/sector/:sid es inaccesible para el SUPERVISOR de su propio sector: el middleware (nivel 70) contradice la lógica del handler (nivel 60-89)
- **Endpoint:** `GET /analytics/sector/:sid` · **Rol:** SUPERVISOR
- **Esperado:** O bien 200 acotado a su propio sector (que es lo que la lógica interna del handler describe y lo que hace coherente el permiso con /analytics/usuario/:uid, accesible desde nivel 60), o bien eliminar la rama muerta si la decisión es que el análisis sectorial arranca en COORDINADOR.
- **Obtenido:** 403 {"error":"No tiene permisos para esta acción"} incluso para el propio sector del supervisor.
- **Repro:** 1) Login roberto.acosta@demo.com (SUPERVISOR, sectorId=493bb1a2-05d7-49cd-8a9b-01619f5a7d35 'Cabezales', rolNivel=60). 2) GET /analytics/sector/493bb1a2-05d7-49cd-8a9b-01619f5a7d35 (SU PROPIO sector). 3) Comparar con juancarlos.herrera@demo.com (COORDINADOR del mismo sector) → 200. Causa: la ruta usa requireLevel(LEVEL_COORDINADOR=70) (analytics.routes.ts:137) pero el handler tiene una rama explícita 'COORDINADOR/SUPERVISOR (nivel 60-89): only own sector' (analytics.routes.ts:157-167) que resulta inalcanzable para nivel 60. Lo mismo ocurre con GET /analytics/usuario/:uid, que sí admite nivel>=60 (línea 20), de modo que un supervisor puede ver el detalle de cada empleado uno por uno pero no e
- **Evidencia:** GET /analytics/sector/493bb1a2-05d7-49cd-8a9b-01619f5a7d35 con token de roberto.acosta@demo.com → HTTP 403 GET /analytics/sectores con el mismo token → HTTP 403 Mismos endpoints con token de juancarlos.herrera@demo.com → HTTP 200 (sector Cabezales, usuariosCount=10; /sectores devuelve 12 sectores)

### ⚪ BAJA — Con un solo extremo del rango (periodoInicio sin periodoFin), /analytics/empresa filtra planillas pero NO ausencias ni vacaciones
- **Endpoint:** `GET /analytics/empresa?periodoInicio=2026-12-21` · **Rol:** RRHH (maria.rodriguez@demo.com)
- **Esperado:** O se aplican los mismos criterios a todos los agregados del payload, o se rechaza el rango incompleto con 400. Un mismo dashboard no debería mezclar KPIs de un período con ausencias de toda la historia.
- **Obtenido:** totals.planillas 40 → 23, pero ausencias suma 71105 días y vacacionesPendientes=11 en ambos casos.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa (sin filtros) → anotar totals.planillas, suma de ausencias[].dias y vacacionesPendientes. 3) GET /analytics/empresa?periodoInicio=2026-12-21 → las planillas se recortan pero ausencias y vacacionesPendientes quedan idénticas. En el código fechaPeriodFilter sólo se arma 'if (qPeriodoInicio && qPeriodoFin)', mientras planillaPeriodFilter se arma con cada parámetro por separado.
- **Evidencia:** sin filtro: planillas=40, ausencias.dias=71105, vacacionesPendientes=11 · ?periodoInicio=2026-12-21: planillas=23, ausencias.dias=71105, vacacionesPendientes=11

### ⚪ BAJA — sectorBreakdown de /analytics/empresa no cuadra con totals: no existe bucket 'Sin sector' (34 de 40 planillas y 95 de 127 usuarios)
- **Endpoint:** `GET /analytics/empresa` · **Rol:** RRHH (maria.rodriguez@demo.com) / ADMIN
- **Esperado:** El desglose por sector debe sumar el total (agregando un bucket 'Sin sector' como ya hace ausenciasBySector) o el total debe excluir a los usuarios sin sector. Hoy las barras nunca explican el KPI.
- **Obtenido:** sum(sectorBreakdown.planillas)=34 vs totals.planillas=40 (delta 6); sum(sectorBreakdown.usuarios)=95 vs totalUsuarios=127 (delta 32).
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa. 3) Comparar sum(sectorBreakdown[].planillas) contra totals.planillas y sum(sectorBreakdown[].usuarios) contra totalUsuarios. Los usuarios sin sectorId (ADMIN, RRHH, GERENTE y todos los usuarios de prueba) entran en totals pero no en ninguna fila del breakdown. Nótese que ausenciasBySector del mismo endpoint SÍ crea el bucket 'Sin sector'.
- **Evidencia:** 200 → totals={"horasNormales":659,"horasExtra50":48,"horasExtra100":50,"horasViaje":14,"diasCampo":13,"diasBase":74,"planillas":40}, totalUsuarios=127; sum(sectorBreakdown.planillas)=34, sum(sectorBreakdown.usuarios)=95; ausenciasBySector=["Sin sector","Cabezales","Intendencia","Fractura","Logística

### ⚪ BAJA — Analytics de empresa descarta las planillas de usuarios dados de baja: 32 planillas contra 52 que lista la pantalla Planillas
- **Endpoint:** `GET /analytics/empresa` · **Rol:** RRHH (maria.rodriguez@demo.com) / ADMIN
- **Esperado:** Las horas ya cargadas por un empleado dado de baja siguen siendo horas de la empresa en ese período; o se cuentan, o el criterio se explicita en la respuesta/UI. Hoy dos pantallas del mismo usuario muestran totales distintos para 'la empresa'.
- **Obtenido:** totals.planillas=32 vs 52 planillas listadas por /planillas; las 20 de diferencia son de usuarios activo=false.
- **Repro:** 1) Login maria.rodriguez@demo.com. 2) GET /analytics/empresa → totals.planillas. 3) GET /planillas (sin filtros, mismo token) → contar elementos. 4) GET /usuarios → mapear id→activo y clasificar los dueños de las planillas: la diferencia son exactamente las de usuarios con activo=false. En analytics.routes.ts userIds se construye con {empresaId, activo:true}, mientras /planillas filtra sólo por usuario.empresaId.
- **Evidencia:** analytics.totals.planillas=32 · GET /planillas → 52 elementos (de usuarios inactivos=20, dueño no listado=0) · analytics.totalUsuarios=124 · GET /usuarios → 254 (activos=124)

### ⚪ BAJA — /analytics/sectores exige nivel 70 pero AprobacionesPage lo llama sin guard: todo SUPERVISOR (60) que abre Aprobaciones recibe 403 y se queda sin filtro de sector
- **Endpoint:** `GET /analytics/sectores` · **Rol:** SUPERVISOR (lucas.fernandez@demo.com)
- **Esperado:** O el endpoint acepta SUPERVISOR (que ya ve su sector en otros endpoints), o el front no debería pedirlo para roles <70.
- **Obtenido:** 403 {"error":"No tiene permisos para esta acción"} en cada carga de la pantalla Aprobaciones de un supervisor; el filtro por sector queda inutilizable sin feedback.
- **Repro:** 1) Login lucas.fernandez@demo.com (SUPERVISOR, nivel 60). 2) GET /analytics/sectores → 403. 3) En apps/web/src/pages/aprobaciones/AprobacionesPage.tsx la query ['sectores-aprobaciones'] llama api.get('/analytics/sectores') sin ninguna condición 'enabled', y el nav muestra Aprobaciones desde minLevel 60 → la pantalla dispara siempre un 403 silencioso y el <select> de sectores queda vacío (otras pantallas sí lo guardan: AusenciasPage usa enabled:isRRHH).
- **Evidencia:** GET /analytics/sectores con token de lucas.fernandez@demo.com → 403 {"error":"No tiene permisos para esta acción"} (con laura/GERENTE 80 → 200 con 12 sectores)

---

## CALENDARIO — 2 (1 media, 1 baja)

### 🟡 MEDIA — GET /vacaciones/gantt con anio no numérico o fuera de rango devuelve 500 en vez de 400
- **Endpoint:** `GET /vacaciones/gantt?anio=abc` · **Rol:** SUPERVISOR (hector.ramos@demo.com); aplica a cualquier rol con acceso al calendario
- **Esperado:** 400 'anio inválido' (o ignorar el parámetro y usar el año actual).
- **Obtenido:** 500 {"error":"Error interno"} en las tres variantes.
- **Repro:** 1) Login hector.ramos@demo.com / Test1234!. 2) GET /vacaciones/gantt?anio=abc&todos=1 -> 500. 3) Idem con ?anio=999999&todos=1 y ?anio=-5&todos=1 -> 500. Causa: vacaciones.routes.ts:97-99 hace `Number(anio)` sin validar y arma `new Date(year,0,1)`; con NaN o año fuera de rango sale Invalid Date y Prisma revienta.
- **Evidencia:** GET /vacaciones/gantt?anio=abc&todos=1 -> 500 {"error":"Error interno"} ; ?anio=999999&todos=1 -> 500 {"error":"Error interno"} ; ?anio=-5&todos=1 -> 500 {"error":"Error interno"}

### ⚪ BAJA — GET /vacaciones/gantt devuelve la lista completa de sectores de la empresa a un supervisor que sólo puede ver el suyo
- **Endpoint:** `GET /vacaciones/gantt` · **Rol:** SUPERVISOR (hector.ramos@demo.com)
- **Esperado:** Devolver sólo los sectores que el usuario puede filtrar (el propio, para nivel<90).
- **Obtenido:** 200 con los 21 sectores de la empresa.
- **Repro:** 1) Login hector.ramos@demo.com / Test1234!. 2) GET /vacaciones/gantt?todos=1 -> 200. 3) Mirar body.sectores: trae los 21 sectores de la empresa (incluidos los residuos 'qa-planillas-sec-*', 'qa-vacaciones-*') pese a que body.empleados sólo contiene su sector y el filtro sectorId se ignora para nivel<90 (vacaciones.routes.ts:294-298 consulta todos los sectores sin filtrar por alcance).
- **Evidencia:** GET /vacaciones/gantt?todos=1 (token hector.ramos) -> 200 empleados=10 (todos de Logística, correcto) pero sectores=21: ["Administración","Almacén","Cabezales","CMASS","Fractura","Intendencia","Logística y Transporte","qa-planillas-sec-1782446346100","qa-planillas-sec-1784640574883",...]

---

## MENSAJES — 2 (1 alta, 1 baja)

### 🟠 ALTA — Los destinatarios de una difusión leen las respuestas privadas del resto: GET /mensajes/:id oculta la lista de destinatarios pero expone todas las respuestas con autor
- **Endpoint:** `GET /mensajes/:id` · **Rol:** OPERADOR (fernando.vera@demo.com lee la respuesta de oscar.castro@demo.com); remitente RRHH (ana.martinez@demo.com)
- **Esperado:** Un destinatario común de una difusión debería ver únicamente sus propias respuestas (o ninguna): responder una difusión es un canal empleado→RRHH, no un foro. Sólo el remitente (o RRHH+) debería ver el hilo completo, igual que ya ocurre con la lista de destinatarios.
- **Obtenido:** Cualquiera de los 10 destinatarios del sector obtiene 200 con respuestas[] conteniendo el texto íntegro y la identidad del resto de los empleados (datos potencialmente sensibles: motivos médicos, familiares, etc.).
- **Repro:** 1) POST /auth/login {email:'ana.martinez@demo.com',password:'Test1234!'} (RRHH). 2) POST /mensajes (multipart) campos: asunto='sim difusion sector', cuerpo='comunicado', destinoTipo='SECTOR', destinoValor='38a79ee4-20be-426d-9df2-aa4b3388f317' (sector Logística y Transporte), permiteRespuesta='true' → 201 con esDifusion=true y destinatariosCount=10 (incluye a oscar.castro y fernando.vera). Guardar el id del mensaje. 3) Login oscar.castro@demo.com y POST /mensajes/<msgId>/responder {cuerpo:'PRIVADO-OSCAR: no puedo asistir por tratamiento médico'} → 201. 4) Login fernando.vera@demo.com (OPERADOR, simple destinatario de la difusión, sin relación jerárquica con oscar) y GET /mensajes/<msgId>. Ob
- **Evidencia:** HTTP 200 — GET /mensajes/21d82486-f15b-4f4b-b1bf-b133898b4614 con el token de fernando.vera devuelve: {"id":"21d82486-...","asunto":"sim-op-social-... difusion sector","esDifusion":true,"respuestas":[{"id":"44a0726b-afb1-40bf-9dd4-7521a39c3c1e","usuarioId":"6b7eb63f-992e-4383-b638-8da71f931a0f","cue

### ⚪ BAJA — PUT /mensajes/:id/leer responde 200 {ok:true} para mensajes ajenos o inexistentes (éxito falso)
- **Endpoint:** `PUT /mensajes/:id/leer` · **Rol:** OPERADOR (fernando.vera@demo.com sobre un mensaje de oscar.castro@demo.com)
- **Esperado:** 404 'Mensaje no encontrado' cuando el usuario no es destinatario del mensaje o el id no existe (0 filas afectadas).
- **Obtenido:** 200 {"ok":true"} en ambos casos: el cliente cree que marcó como leído algo que no existe o que no le pertenece.
- **Repro:** 1) Login ana.martinez@demo.com y POST /mensajes (multipart) {asunto:'1a1', cuerpo:'x', destinoTipo:'USUARIO', destinoValor:'6b7eb63f-992e-4383-b638-8da71f931a0f' (oscar), permiteRespuesta:'false'} → 201, guardar msgId. 2) Login fernando.vera@demo.com (no es destinatario ni remitente) y PUT /mensajes/<msgId>/leer → 200 {ok:true}. 3) PUT /mensajes/00000000-0000-0000-0000-000000000000/leer con el token de cualquiera → 200 {ok:true}. El handler (mensajes.routes.ts líneas 363-373) hace updateMany scoped por usuarioId y responde ok sin mirar cuántas filas afectó. Verificado que NO hay efecto lateral: la copia de oscar sigue con leido=false (el aislamiento está bien; lo incorrecto es el status).
- **Evidencia:** HTTP 200 PUT /mensajes/<msgId de oscar>/leer con token de fernando → {"ok":true}. HTTP 200 PUT /mensajes/00000000-0000-0000-0000-000000000000/leer → {"ok":true}. Verificación posterior: GET /mensajes con token de oscar → el mensaje sigue con "leido":false.

---

## NOTIFICACIONES — 2 (2 baja)

### ⚪ BAJA — PUT /notificaciones/:id/leer y DELETE /notificaciones/:id responden 200/204 sobre notificaciones de otro usuario (éxito falso)
- **Endpoint:** `PUT /notificaciones/:id/leer` · **Rol:** OPERADOR (oscar.castro@demo.com operando sobre notificaciones de fernando.vera@demo.com)
- **Esperado:** 404 'Notificación no encontrada' cuando el id no pertenece al usuario autenticado (0 filas afectadas).
- **Obtenido:** 200 {ok:true} en el marcado y 204 en el borrado, pese a que no se tocó ninguna fila.
- **Repro:** 1) Login ana.martinez@demo.com (RRHH) y POST /notificaciones {usuarioId:'b8dcb01d-bb52-4b5e-b532-65453e1772f4' (fernando), tipo:'MENSAJE', titulo:'target-fernando'} → 201, guardar notifId. 2) Login oscar.castro@demo.com y PUT /notificaciones/<notifId>/leer → 200 {ok:true}. 3) DELETE /notificaciones/<notifId> con el token de oscar → 204. 4) Login fernando.vera@demo.com y GET /notificaciones: la notificación sigue existiendo y con leida=false. Handlers en notificaciones.routes.ts líneas 54-93: updateMany/deleteMany scoped por usuarioId, responden ok sin comprobar el count. El aislamiento de datos es correcto (nada se altera ni se borra); el problema es el status engañoso, que enmascara un IDOR
- **Evidencia:** HTTP 200 PUT /notificaciones/<notifId de fernando>/leer con token de oscar → {"ok":true}. HTTP 204 DELETE /notificaciones/<notifId de fernando> con token de oscar → sin body. Verificación: GET /notificaciones con token de fernando sigue devolviendo esa notificación con "leida":false.

### ⚪ BAJA — El cierre individual de una planilla no notifica al empleado, mientras que el cierre masivo sí
- **Endpoint:** `POST /planillas/:id/cerrar` · **Rol:** RRHH
- **Esperado:** Consistencia: si cerrar el período notifica al empleado en el camino masivo, el cierre individual desde la pantalla de Cierre (botón 'Cerrar' por fila) debería notificar igual.
- **Obtenido:** POST /planillas/:id/cerrar no invoca notificarPlanilla ni crea Notificacion; el empleado se entera sólo si el cierre se hizo por el endpoint masivo.
- **Repro:** 1) Tener una planilla APROBADA de emanuel.rojas@demo.com. 2) Login maria.rodriguez@demo.com y GET /notificaciones/count con el token del operador para tomar el valor previo. 3) POST /planillas/<id>/cerrar (token RRHH) -> 200 CERRADA. 4) Volver a pedir /notificaciones/count y /notificaciones con el token del operador: no hay ninguna notificación nueva. 5) Contrastar con POST /exportaciones/cierre {periodoInicio, periodoFin}, que sí crea una Notificacion 'Período cerrado' por cada empleado (exportaciones.routes.ts:135).
- **Evidencia:** src/routes/planillas.routes.ts:716-752 (handler completo de /cerrar) no contiene ninguna llamada de notificación. Tras el cierre masivo, GET /notificaciones (token emanuel) sí devuelve {"tipo":"planilla:cerrada","titulo":"Período cerrado","link":"/planillas/bce3e485-..."}, notificación que no aparec

---

## Notas de higiene
- Los scripts de simulación quedaron en `apps/api/tests/sim/*.sim.ts` (prefijo `sim-<guion>-20260724` en los datos).
- La mayoría de los agentes limpió sus datos; quedan algunas planillas/vacaciones/ausencias de prueba que la API no deja borrar por estar aprobadas (detalladas en los logs de cada guion). No se tocó `apps/**/src`.
- Config global tocada y **restaurada**: `descuentoAlmuerzoMinutos` y algún umbral de extras (guiones de cálculo y admin).

---

# ADDENDUM — Segunda corrida (2026-07-24): 4 guiones faltantes, verificados

**Método:** re-lanzados los 4 guiones que la primera corrida no alcanzó a ejecutar (cortada por el límite de sesión). Workflow `wf_6d704241-6a0`, 42 agentes, ~24 min. **Cada hallazgo pasó por un verificador escéptico independiente** que re-ejecutó la repro contra la API viva y leyó el código responsable. A diferencia de la primera corrida (mayormente sin verificar), acá **34 de 34 hallazgos que llegaron a verificarse fueron CONFIRMADOS** y 4 fueron descartados por ser comportamiento intencional.

| Severidad (ajustada por el verificador) | Confirmados |
|---|---|
| 🟠 Alta | 7 |
| 🟡 Media | 18 |
| ⚪ Baja | 9 |
| **Total confirmados** | **34** |
| Descartados (comportamiento esperado) | 4 |

> **Nota de severidad:** los verificadores bajaron a ALTA el cluster `avanzar`-sin-flujo (en la 1ª corrida figuraba como crítica insignia) porque su explotación requiere que el documento nazca sin flujo — condición real pero acotada. La causa raíz y el fix no cambian: es el mismo `planillas.routes.ts:514`.

> **Cruce con la 1ª corrida:** este batch **re-confirma de forma independiente** (a) el cluster de autorización en `avanzar` sin flujo y (b) las lecturas IDOR sobre `GET /usuarios/:id` y `GET /vacaciones/:id`. Que dos corridas separadas, con agentes distintos, lleguen al mismo defecto sube mucho la confianza.

---

## 🟠 ALTA — 7 confirmados

### 🟠 ALTA — POST /auth/forgot-password devuelve el resetUrl con el token en el cuerpo (toma de cuenta anónima)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** auth · **Rol:** anónimo (sin token)
- **Endpoint:** `POST /auth/forgot-password`
- **Esperado:** Nunca devolver el token/URL en la respuesta HTTP; enviarlo sólo por email y responder con un mensaje genérico.
- **Obtenido:** 200 con el reset token en texto plano dentro del body.
- **Repro:** Sin autenticación: POST /auth/forgot-password {"email":"laura.gonzalez@demo.com"}. Con SMTP no configurado (config actual), la respuesta incluye resetUrl con el token (auth.routes.ts:410). Copiar el token y POST /auth/reset-password {token, newPassword:"NuevaPass1"} -> 200 toma la cuenta. Encadenable con la enumeración de emails y con GET /auth/debug-users para tomar cualquier cuenta, incluida ADMIN. Mitigado si NODE_ENV=production o si isSmtpConfigured.
- **Causa raíz (verificada):** apps/api/src/routes/auth.routes.ts:410-411 — `if (!isSmtpConfigured && process.env.NODE_ENV !== 'production') { response.resetUrl = resetUrl; }` devuelve el token en el body HTTP. La condición isSmtpConfigured se define en apps/api/src/utils/email.utils.ts:10. El reset sin auth se procesa en auth.routes.ts:423-479. El rate limit (parcial) está en apps/api/src/app.ts:89-97.
- **Evidencia:** Corrida propia (tests/sim/verify-forgot-pwd-leak-9x7.ts), víctima hunt-validation-lvl@demo.com (ADMIN): [127.0.0.1] GET /auth/debug-users -> 200; victim rol=ADMIN [127.0.0.1] POST /auth/forgot-password {"email":"hunt-validation-lvl@demo.com"} -> 200 {"message"

### 🟠 ALTA — GET /usuarios/:id sin guard de rol/sector: cualquier operador lee la ficha completa (PII) de cualquier colega y del ADMIN  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** admin · **Rol:** OPERADOR (tomas.moreno@demo.com, Fractura)
- **Endpoint:** `GET /usuarios/:id`
- **Esperado:** 403 para operador; limitar a la propia ficha / cadena de mando / RRHH+, como hace /usuarios/:id/ficha.
- **Obtenido:** 200 con el registro completo (passwordHash omitido pero se exponen todos los campos de PII).
- **Repro:** Login tomas. GET /usuarios/<id de nestor.correa@demo.com (otro sector)> -> 200 con dni, cuil, fechaNacimiento, telefono, legajo, tipoContrato, supervisor, etc. GET /usuarios/<id de admin@wenlen.com> -> 200. usuarios.routes.ts:152 sólo filtra por empresaId (sin requireLevel), mientras que /usuarios/:id/ficha sí exige RRHH. Un operador enumera datos personales de toda la empresa.
- **Causa raíz (verificada):** apps/api/src/routes/usuarios.routes.ts:152 — router.get('/:id', async ...) sin requireLevel ni scoping self/sector/cadena-de-mando; sólo el where de línea 155 filtra por empresaId. Contrastar con :507 (/ficha con requireLevel(LEVEL_RRHH)) y :110-121 (lista con filtrado por sector para niveles < RRHH).
- **Evidencia:** Repro propia (tsx tests/sim/verify-usuarios-id-pii-skeptic-q7z.ts contra localhost:4000): tomas y nestor confirmados en sectores distintos (Fractura vs Almacén). [REPRO 1] OPERADOR GET /usuarios/<nestor 61a63444-...> -> 200; keys incluyen dni,cuil,fechaNacimie

### 🟠 ALTA — Supervisor de OTRO sector otorga/revoca franco compensatorio y muta el saldo de un empleado que no gestiona  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** planillas · **Rol:** SUPERVISOR (ricardo.vargas@demo.com, Almacén)
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio`
- **Esperado:** 403 — sólo el supervisor/coordinador del sector del empleado (o RRHH+) debería poder tocar sus registros y saldos.
- **Obtenido:** 200; compensatoriosPendientes de tomas 0 -> 1; registro reescrito y bloqueado por un supervisor ajeno.
- **Repro:** Crear planilla+registro de tomas (Fractura) como tomas. Con token de ricardo (supervisor de Almacén, NO gestiona a tomas): PATCH /planillas/<planillaTomas>/registros/<registroTomas>/compensatorio {"activar":true}. planillas.routes.ts:1074 sólo valida misma empresa, sin chequear sector ni relación de supervisión. La acción nulea entrada/salida del registro, pone horas en 0, lo bloquea y hace increment de compensatoriosPendientes en el saldo de tomas.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:1074 — única autorización es `planilla.usuario.empresaId !== req.user!.empresaId`; falta el guard `canManageUser(actorId, actorNivel, planilla.usuarioId, empresaId)` que sí tienen los endpoints hermanos (L1443, L1512, L1575). El handler completo abarca L1063-1165.
- **Evidencia:** Login: ricardo=SUPERVISOR nivel60 sector Almacén; tomas=OPERADOR sector Fractura (misma empresa). Recon: canManageUser(ricardo→tomas)=false. Repro HTTP en vivo (año aislado 2333) — PATCH .../compensatorio {activar:true} por ricardo => status 200. saldo tomas A

### 🟠 ALTA — Planilla sin flujo (flujoId=null): un SUPERVISOR de otro sector, sin relación jerárquica, la aprueba (avanzar no valida aprobador cuando totalPasos===0)  ✅
- **Guion:** Concurrencia/Estados · **Módulo:** planillas · **Rol:** SUPERVISOR (ajeno: ricardo.vargas@demo.com, sector Almacén)
- **Endpoint:** `POST /planillas/:id/avanzar`
- **Esperado:** 403 — un aprobador ajeno no debe poder aprobar. Vacaciones y ausencias, ante totalPasos===0, exigen RRHH+ y bloquean; planillas debería ser al menos igual de estricto.
- **Obtenido:** 200 y la planilla queda APROBADA. En planillas.routes /avanzar, cuando totalPasos===0 se setea nuevoEstado=APROBADA SIN llamar a isResponsibleApprover; sólo aplica el requireLevel(SUPERVISOR) del middleware, que cualquier supervisor de la empresa cumple. Bypass de autorización horizontal/vertical.
- **Repro:** 1) Login maria.rodriguez@demo.com (RRHH). POST /usuarios {rol:'SUPERVISOR', SIN sectorId, fechaIngreso, legajo} → 201 (queda sin flujo PLANILLA → planilla.flujoId=null). 2) Login como ese usuario, crear+llenar+enviar una planilla (POST /planillas, POST /registros, POST /planillas/:id/enviar → ENVIADA). 3) Login ricardo.vargas@demo.com (supervisor de Almacén, no es supervisor/coordinador del dueño ni comparte sector). 4) POST /planillas/:id/avanzar {comentario}.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:514 (branch `if (pasoActual > totalPasos || totalPasos === 0) { nuevoEstado='APROBADA' }` — no llama a isResponsibleApprover ni bloquea auto-aprobación/exige RRHH+, a diferencia de ausencias.routes.ts:666-675 y vacaciones.routes.ts:688-697)
- **Evidencia:** Repro HTTP propia (localhost:4000, script apps/api/tests/sim/verify-flujonull-foreignsup-x7q3.ts): [1] POST /usuarios (maria.rodriguez RRHH nivel=90) {rol:SUPERVISOR, sin sectorId} -> 201, sectorId=null. [2] owner (supervisor sin sector) POST /planillas -> 201

### 🟠 ALTA — Planilla sin flujo: el dueño (SUPERVISOR sin sector) auto-aprueba su propia planilla vía /avanzar  ✅
- **Guion:** Concurrencia/Estados · **Módulo:** planillas · **Rol:** SUPERVISOR (dueño, usuario sin sector)
- **Endpoint:** `POST /planillas/:id/avanzar`
- **Esperado:** 403 — nadie debe aprobar su propio documento. vacaciones.routes y ausencias.routes bloquean explícitamente el caso totalPasos===0 (self-approval + exigir nivel RRHH); planillas.routes no.
- **Obtenido:** 200 y la planilla queda APROBADA. Mismo root cause que el finding anterior: /avanzar no valida aprobador (ni auto-aprobación) en la rama totalPasos===0. Un supervisor sin flujo asignado firma sus propias horas sin ninguna supervisión.
- **Repro:** 1) RRHH crea usuario SUPERVISOR SIN sectorId (mismo setup que el finding anterior → flujoId=null). 2) Login como ese usuario; crear+llenar+enviar su planilla (→ ENVIADA). 3) El MISMO usuario hace POST /planillas/:id/avanzar sobre su propia planilla.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:514-516 — la rama `if (pasoActual > totalPasos || totalPasos === 0) { nuevoEstado='APROBADA' }` no valida que el aprobador no sea el dueño (owner.id === userId) ni exige rolNivel>=90 (RRHH), controles que sí existen en ausencias.routes.ts:666-675 y vacaciones.routes.ts:688-697.
- **Evidencia:** Parte 1 (pasos literales del reporte): supervisor sin sector recién creado (rol=SUPERVISOR/60, sectorId=null); su planilla tomó flujoId='a4367d9c-…' (NO null) por el flujo global leftover 'VerifFlujo-mryo0ojm' (sec=NULL/usr=NULL). POST /planillas/:id/avanzar p

### 🟠 ALTA — GET /usuarios/:id no tiene control de acceso: cualquier OPERADOR lee la ficha completa (PII) de cualquier usuario de la empresa  ✅
- **Guion:** Contrato UI admin · **Módulo:** admin · **Rol:** OPERADOR
- **Endpoint:** `GET /usuarios/:id`
- **Esperado:** 403/404 para un OPERADOR que consulta la ficha de un usuario ajeno de otro sector; o al menos recorte de campos sensibles.
- **Obtenido:** 200 con la ficha completa y campos de PII de un usuario RRHH de otro sector.
- **Repro:** Login OPERADOR facundo.garcia@demo.com (pass Test1234!). GET /usuarios/a0ff3d61-d7ef-4d7a-8a5d-74a9ebb4faef (María Rodríguez, RRHH, otro sector) con su Bearer. La ruta (src/routes/usuarios.routes.ts:152) sólo filtra por empresaId, sin requireLevel ni chequeo de jerarquía/sector; devuelve el registro completo (sólo se omite passwordHash), incluyendo dni, cuil, telefono, fechaNacimiento, fechaIngreso, fechaFinPrueba, email, legajo. Contrasta con GET /usuarios/:id/ficha que sí exige RRHH (403 para el operador).
- **Causa raíz (verificada):** apps/api/src/routes/usuarios.routes.ts:152 — router.get('/:id') sin requireLevel ni guard de sector/jerarquia (solo where empresaId en linea 155); el include (156-167) y el spread ...safeUsuario (175-181) devuelven todas las columnas menos passwordHash. Contrasta con la lista (110-121) que scoping por sector para nivel < 90 y con /ficha (507) que usa requireLevel(LEVEL_RRHH).
- **Evidencia:** Corrida propia (tests/sim/verify-usuarios-id-acl-7k3.ts) contra http://localhost:4000/api/v1: (1) Login OPERADOR facundo.garcia@demo.com => 200, rol OPERADOR, rolNivel 10, sectorId 6ee3adf3-... (Fractura). (2) GET /usuarios/a0ff3d61-d7ef-4d7a-8a5d-74a9ebb4faef

### 🟠 ALTA — Menú 'Cambios Diagrama' oculto para SUPERVISOR (minLevel 70) pero el backend le da permiso de aprobar/rechazar (requireLevel 60): no puede llegar a la página que le corresponde  ✅
- **Guion:** Contrato UI admin · **Módulo:** aprobaciones · **Rol:** SUPERVISOR
- **Endpoint:** `GET /cambios-diagrama/pendientes`
- **Esperado:** Si el backend habilita a SUPERVISOR (nivel 60) a ver pendientes y avanzar/rechazar cambios de diagrama, el ítem de menú debería ser visible a nivel 60 (o alinear el backend a 70).
- **Obtenido:** Menú oculto a nivel 60, pero GET /cambios-diagrama/pendientes = 200 y avanzar/rechazar habilitados para SUPERVISOR.
- **Repro:** AppShell.tsx:62 muestra 'Cambios Diagrama' con minLevel:70. Pero en cambios-diagrama.routes.ts, /pendientes (:77), POST /:id/avanzar (:222) y POST /:id/rechazar (:378) exigen requireLevel(LEVEL_SUPERVISOR)=60. Login SUPERVISOR lucas.fernandez@demo.com (nivel 60): GET /cambios-diagrama/pendientes = 200 y GET /cambios-diagrama = 200. Es decir, un supervisor que es paso aprobador de cambios de diagrama tiene la capacidad en la API pero el menú le esconde la única página desde donde aprobarlos.
- **Causa raíz (verificada):** apps/web/src/components/layout/AppShell.tsx:62 (menú con minLevel:70 mientras el backend autoriza a nivel 60); corroborado por apps/web/src/pages/CambiosDiagramaPage.tsx:66,87,364 (aprobación gated a isRRHH>=90) y por la ausencia de cambio-diagrama en apps/web/src/pages/aprobaciones/AprobacionesPage.tsx. Backend responsable de habilitar al supervisor: apps/api/src/routes/cambios-diagrama.routes.ts:77,222,378 (requireLevel LEVEL_SUPERVISOR=60) + apps/api/src/utils/approval-auth.utils.ts:43-48 + apps/api/prisma/seed.ts:588-589.
- **Evidencia:** Login supervisor lucas.fernandez@demo.com → rolNivel=60. [sup] GET /cambios-diagrama/pendientes → 200 (items=0). [sup] GET /cambios-diagrama → 200. [rrhh ana.martinez] POST /cambios-diagrama (usuarioId=diego.ramirez, supervisado por lucas) → 201; flujo resuelt

---

## 🟡 MEDIA — 18 confirmados

### 🟡 MEDIA — POST /auth/change-password cambia la clave sin pedir la contraseña actual  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** auth · **Rol:** OPERADOR (cualquier usuario autenticado)
- **Endpoint:** `POST /auth/change-password`
- **Esperado:** Exigir y verificar la contraseña actual (currentPassword) o forzar re-autenticación antes de permitir el cambio.
- **Obtenido:** 200 y la contraseña queda cambiada sin conocer la anterior.
- **Repro:** Login con cualquier cuenta (ej. tomas.moreno@demo.com / Test1234!). Con el accessToken: POST /auth/change-password body {"newPassword":"NuevaPass1"} — sin enviar la contraseña actual. El schema (auth.routes.ts:40 changePasswordSchema) sólo valida newPassword; nunca compara contra la clave vigente. Cualquiera que robe un access token (15 min) toma la cuenta permanentemente.
- **Causa raíz (verificada):** apps/api/src/routes/auth.routes.ts:40-46 (changePasswordSchema omite currentPassword) y el handler apps/api/src/routes/auth.routes.ts:320-354 (no compara contra passwordHash vigente ni revoca refresh tokens tras el cambio, a diferencia de reset-password en la línea 479).
- **Evidencia:** LOGIN (tomas.moreno@demo.com / Test1234!) -> 200, user.primerLogin=false, rol=OPERADOR. POST /auth/change-password body {"newPassword":"NuevaPass1"} (sin currentPassword) -> 200 {"message":"Contraseña actualizada correctamente"}. POST /auth/change-password bod

### 🟡 MEDIA — Doble revocación de franco compensatorio deja compensatoriosPendientes NEGATIVO  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** planillas · **Rol:** SUPERVISOR (lucas.fernandez@demo.com)
- **Endpoint:** `PATCH /planillas/:id/registros/:rid/compensatorio`
- **Esperado:** La 2ª revocación debe ser no-op / 400 y el contador nunca puede quedar negativo.
- **Obtenido:** Ambas revocaciones devuelven 200 y el contador cae por debajo de 0.
- **Repro:** Activar comp en un registro (pendientes -> 1). Luego PATCH {"activar":false} dos veces seguidas. La rama de revocación (planillas.routes.ts:1127-1157) decrementa el saldo SIEMPRE, sin comprobar registro.esFrancoCompensatorio ni si ya estaba revocado; tampoco es idempotente la activación.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:1127-1157 (rama else/revocación): el registro se re-lee fresco en la línea 1079 pero la rama nunca comprueba registro.esFrancoCompensatorio ni si ya estaba revocado antes de ejecutar el decrement incondicional de compensatoriosPendientes en las líneas 1150-1155; el update de la 1128 es no-op en la 2ª llamada pero el decrement igual se dispara. Falta guard de idempotencia/estado.
- **Evidencia:** Repro propia (tests/sim/verify-comp-doble-revoc-9k7z.ts), operador nuevo, año 2026. baseline compensatoriosPendientes=0. [A] activar → status 200, esFrancoComp=true, pendientes=1. [B] revocar#1 → status 200, esFrancoComp=false, pendientes=0. [C] revocar#2 → st

### 🟡 MEDIA — Aislamiento multi-empresa roto: POST /usuarios y PATCH /usuarios/:id/sector aceptan un sector de OTRA empresa  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** admin · **Rol:** ADMIN / RRHH (admin@wenlen.com)
- **Endpoint:** `POST /usuarios`
- **Esperado:** 400 si el sectorId no pertenece a la empresa del actor.
- **Obtenido:** 201 (create) y 200 (patch), con usuario.empresaId != sector.empresaId.
- **Repro:** El admin es de empresa 32e126e4. POST /usuarios {nombre,apellido,email,password,rol:'OPERADOR',fechaIngreso, sectorId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe' (sector 'Fractura' de la empresa 62e25426)} -> 201. Queda usuario.empresaId=32e... con sector de empresa 62e... usuarios.routes.ts:230 (create) y :491 (PATCH /:id/sector) escriben sectorId sin validar que pertenezca a req.user.empresaId (sólo hay FK). Igual reproducible con PATCH /usuarios/:id/sector {sectorId:'7cf448a4-...'} -> 200.
- **Causa raíz (verificada):** apps/api/src/routes/usuarios.routes.ts:230 (POST create escribe sectorId sin validar empresa) y apps/api/src/routes/usuarios.routes.ts:489-491 (PATCH /:id/sector idem); el guard correcto existe y falta replicarse, ver el análogo en apps/api/src/routes/usuarios.routes.ts:394-401 (PATCH /:id/diagrama valida empresaId y devuelve 400).
- **Evidencia:** POST /usuarios {sectorId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe', rol:'OPERADOR'} -> HTTP 201; body.id=0a3968d8-..., body.empresaId=32e126e4-..., body.sectorId=7cf448a4-.... DB read-back: {empresaId:'32e126e4-e36b-484b-9233-205922a2840a', sectorId:'7cf448a4-7e6

### 🟡 MEDIA — Supervisor de OTRO sector lee el detalle de una vacación ajena (el listado sí filtra por sector, el detalle no)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** vacaciones · **Rol:** SUPERVISOR (lucas.fernandez@demo.com, Fractura)
- **Endpoint:** `GET /vacaciones/:id`
- **Esperado:** 403 salvo el supervisor/coordinador del sector del solicitante o RRHH+.
- **Obtenido:** 200 con el detalle completo de la vacación de otro sector.
- **Repro:** Crear vacación de nestor (Almacén). GET /vacaciones/<idVacNestor> con token de lucas (supervisor de Fractura) -> 200 con usuario, motivo e historial. vacaciones.routes.ts:562-569 autoriza a owner O (misma empresa y rolNivel>=60), sin filtrar por sector; GET /vacaciones (listado) sí filtra por sector, por lo que la política es inconsistente.
- **Causa raíz (verificada):** apps/api/src/routes/vacaciones.routes.ts:562-569 — el bloque de autorización de GET /:id chequea solo isOwner || (isSameCompany && userNivel>=60), omitiendo el scoping por sector/cadena de aprobación que sí aplican el listado (:325-355) y approval-auth.utils.ts:43-61.
- **Evidencia:** Corrí apps/api/tests/sim/verify-vacdetail-xsector-7q3.ts contra http://localhost:4000/api/v1. nestor.correa (OPERADOR/Almacén, sector 86db0783) crea vacación id=41dd9eed... motivo="verify-xsector-7q3 motivo-privado-de-nestor". Con token de lucas.fernandez (SUP

### 🟡 MEDIA — POST /auth/change-password no revoca los refresh tokens del usuario  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** auth · **Rol:** OPERADOR
- **Endpoint:** `POST /auth/change-password`
- **Esperado:** Revocar todas las sesiones (refresh tokens) al cambiar la contraseña, igual que reset-password.
- **Obtenido:** Refresh tokens vivos = 1 después del cambio.
- **Repro:** Login (crea refresh token en DB). POST /auth/change-password {newPassword}. Contar prisma.refreshToken del usuario -> sigue habiendo 1 activo. reset-password sí llama revokeAllRefreshTokensForUser (auth.routes.ts:479); change-password (:341) no. Tras cambiar la clave por sospecha de compromiso, las sesiones/refresh previos siguen válidos.
- **Causa raíz (verificada):** apps/api/src/routes/auth.routes.ts:341 — el handler de POST /auth/change-password (bloque prisma.usuario.update, líneas 341-347) omite la llamada a revokeAllRefreshTokensForUser(usuario.id) que sí está presente en reset-password (auth.routes.ts:479). La helper está definida en apps/api/src/utils/jwt.utils.ts:67.
- **Evidencia:** Script propio tests/sim/verify-chpwd-revoke-9x7q.ts contra http://localhost:4000/api/v1 con OPERADOR hunt-leg-a@demo.com (Test1234!, DEBUG_AUTH activo). Salida real: refreshTokens ANTES de login = 0; LOGIN status 200 (accessToken y cookie refreshToken presente

### 🟡 MEDIA — POST /auth/forgot-password permite enumerar usuarios (404 para inexistente / 403 inactivo vs 200 existente)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** auth · **Rol:** anónimo
- **Endpoint:** `POST /auth/forgot-password`
- **Esperado:** Responder siempre 200 con mensaje genérico, sin revelar si el email existe o su estado.
- **Obtenido:** 404 diferenciado para email inexistente.
- **Repro:** POST /auth/forgot-password {"email":"noexiste@demo.com"} -> 404 'No existe una cuenta con ese email'; con un email válido -> 200; con un email de cuenta inactiva -> 403 'La cuenta ... está inactiva'. Las tres respuestas distintas permiten enumerar cuentas y su estado (auth.routes.ts:373/379).
- **Causa raíz (verificada):** apps/api/src/routes/auth.routes.ts:373-375 (404 para email inexistente) y :378-381 (403 para cuenta inactiva), contrastados con :414 (200 para cuenta válida). Deberían unificarse en una única respuesta 200 genérica.
- **Evidencia:** Repro en vivo (mismo IP localhost, DEBUG_AUTH activo) contra http://localhost:4000/api/v1/auth/forgot-password: [noexiste@demo.com] -> status 404, body {"error":"No existe una cuenta con ese email"}. [admin@wenlen.com (activo, de DB)] -> status 200, body {"mes

### 🟡 MEDIA — 500 en POST /planillas/:id/registros con fecha/hora inválida (debería 400)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** planillas · **Rol:** OPERADOR (tomas, sobre su propia planilla)
- **Endpoint:** `POST /planillas/:id/registros`
- **Esperado:** 400 con detalle de validación.
- **Obtenido:** 500 (respuesta genérica, sin stack).
- **Repro:** Sobre una planilla propia: POST /planillas/<id>/registros {fecha:'2026-13-45', lugarTrabajo:'BASE'} -> 500. Igual con {fecha:'no-es-fecha'} y con {fecha:'2024-03-23', entradaTurno1:'xxx', salidaTurno1:'yyy', lugarTrabajo:'BASE'} -> 500. Fechas/horas inválidas rompen el cálculo aguas abajo en vez de rechazarse.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:51-55 (createRegistroSchema: fecha y turnos como z.string() sin validación datetime); el 500 se dispara en línea 898/900 (new Date(Invalid) + prisma.registroHoras.create) para V1/V2 y en el cálculo NaN -> new Decimal (línea 883/916) para V3; catch genérico devuelve 500 en líneas 933-934.
- **Evidencia:** V1 {fecha:'2026-13-45', lugarTrabajo:'BASE'} -> status=500 body={"error":"Error interno"}. V2 {fecha:'no-es-fecha'} -> status=500 body={"error":"Error interno"}. V3 {fecha:'2027-02-23', entradaTurno1:'xxx', salidaTurno1:'yyy', lugarTrabajo:'BASE'} -> status=50

### 🟡 MEDIA — POST /planillas/:id/enviar sin guard de concurrencia: dos envíos en paralelo duplican historial y notificaciones  ✅
- **Guion:** Concurrencia/Estados · **Módulo:** planillas · **Rol:** OPERADOR
- **Endpoint:** `POST /planillas/:id/enviar`
- **Esperado:** Un 200 y el otro 400 ('Solo se puede enviar una planilla en BORRADOR o RECHAZADA'); una sola entrada ENVIADA en historial; una sola notificación al supervisor.
- **Obtenido:** Ambos POST devuelven 200; se crean 2 entradas ENVIADA en el historial y se envían 2 notificaciones idénticas al supervisor. El handler hace findFirst + prisma.planilla.update directo, sin updateMany condicional por estado ni transacción, así que las dos requests leen BORRADOR y ambas avanzan.
- **Repro:** 1) Login franco.alvarez@demo.com (pass Test1234!). 2) POST /planillas {periodoInicio:'2053-02-15T00:00:00.000Z', periodoFin:'2053-02-15T00:00:00.000Z'} → 201, guardar id. 3) POST /planillas/:id/registros {fecha:'2053-02-15T00:00:00.000Z', entradaTurno1:'...T08:...', salidaTurno1:'...T16:...', lugarTrabajo:'BASE'} → 201. 4) Disparar DOS POST /planillas/:id/enviar EN PARALELO (Promise.all, sin body). 5) Contar PlanillaHistorial con estadoNuevo=ENVIADA para esa planilla y las notificaciones nuevas del supervisor lucas.fernandez@demo.com. Reproducible 8/8 con planillas de 1 día.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:333-343 (findFirst + chequeo de estado no atómico) y :440 (prisma.planilla.update por id sin updateMany condicionado por estado / sin transacción); efectos duplicados en :449 (planillaHistorial.create) y :464 (notificarAprobadoresPaso).
- **Evidencia:** Corrida propia (npx tsx tests/sim/verify-enviar-race-9f3k.ts), 8/8 con doble efecto: #0 pid=bc733a enviar 200/200 oks=2 histENVIADA=2 notifDelta=2 <<< DOBLE #1 626a52 200/200 histENVIADA=2 notifDelta=2 DOBLE #2 c14f17 200/200 histENVIADA=2 notifDelta=2 DOBLE #

### 🟡 MEDIA — POST /planillas permite crear DOS planillas del mismo ciclo en paralelo (sin @@unique ni transacción)  ✅
- **Guion:** Concurrencia/Estados · **Módulo:** planillas · **Rol:** OPERADOR
- **Endpoint:** `POST /planillas`
- **Esperado:** Una 201 y la otra 409 ('Ya existe una planilla para este ciclo mensual'); una sola planilla en DB para el período.
- **Obtenido:** Ambas devuelven 201 y quedan 2 planillas del mismo período en DB. El chequeo de solapamiento es un findFirst previo FUERA de transacción y el modelo Planilla no tiene @@unique de período (schema.prisma), por lo que hay carrera TOCTOU. Cada duplicado tiene su propio flujoId y puede llenarse/enviarse/aprobarse por separado → doble cómputo de horas en export/analytics del ciclo.
- **Repro:** 1) Login franco.alvarez@demo.com. 2) Disparar DOS POST /planillas EN PARALELO (Promise.all) con el mismo body {periodoInicio:'2050-05-10T00:00:00.000Z', periodoFin:'2050-05-11T00:00:00.000Z'}. 3) Consultar en DB prisma.planilla.findMany({where:{usuarioId:<franco>, periodoInicio: 2050-05-10}}).
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:172-185 (findFirst de solapamiento) seguido de la creación en :231 (prisma.planilla.create), fuera de cualquier transacción; y prisma/schema.prisma:364 model Planilla sin @@unique sobre (usuarioId, periodoInicio, periodoFin). Fix: envolver check+create en transacción Serializable o agregar un unique compuesto en DB y mapear el fallo a 409.
- **Evidencia:** Re-ejecuté la repro yo mismo (login franco.alvarez@demo.com, Test1234!, DEBUG_AUTH activo). Períodos limpios propios en 2055 para evitar estado previo. Resultados reales: [2055-06-14..15] paralelo → 201 / 201, DB=2 planillas (ids ...20fc83, ...3f43c2, cada una

### 🟡 MEDIA — PlanillaDetailPage muestra Aprobar/Rechazar a RRHH en pasos SUPERVISOR/COORDINADOR/GERENTE, pero avanzar y rechazar devuelven 403  ✅
- **Guion:** Contrato UI core · **Módulo:** planillas · **Rol:** RRHH
- **Endpoint:** `POST /planillas/:id/avanzar  (y POST /planillas/:id/rechazar)`
- **Esperado:** Coherencia front/back: como el backend usa isResponsibleApprover (apps/api/src/utils/approval-auth.utils.ts), para un paso SUPERVISOR con owner.supervisorId seteado sólo aprueba ese supervisor asignado o ADMIN; RRHH (nivel 90, rol RRHH) NO es aprobador responsable. El front debería ocultar Aprobar/Rechazar en ese caso (su canApprove no debería habilitarse sólo por nivel>=90 cuando el paso es SUPERVISOR/COORDINADOR/GERENTE y el usuario no es el aprobador del paso), tal como sí lo hace AprobacionesPage que filtra con matchesCurrentStep/isResponsibleApprover.
- **Obtenido:** El front muestra Aprobar y Rechazar habilitados a RRHH; al clickear, avanzarMutation/rechazarMutation reciben 403 y sólo se ve un toast genérico 'Error al aprobar/rechazar planilla'. RRHH queda convencido de que puede resolver la planilla desde el detalle cuando no puede.
- **Repro:** Setup como admin@wenlen.com (pass Test1234!, DEBUG_AUTH): 1) POST /admin/sectores {nombre}. 2) POST /usuarios rol=SUPERVISOR con ese sectorId → supId. 3) POST /usuarios rol=OPERADOR con sectorId y supervisorId=supId → opId. 4) POST /usuarios rol=RRHH (o usar maria.rodriguez@demo.com si comparte empresa). 5) POST /admin/flujos {tipoDocumento:'PLANILLA', pasos:[{orden:1,nombrePaso:'Supervisor',rolAprobador:'SUPERVISOR'}]} → flujoId. 6) POST /admin/flujos/asignaciones {flujoId, tipoDocumento:'PLANILLA', usuarioId:opId}. 7) Login OP: POST /planillas {periodoInicio:'2331-05-15T00:00:00.000Z', perio
- **Causa raíz (verificada):** apps/web/src/pages/planillas/PlanillaDetailPage.tsx:424-427 — canApprove usa `(currentStep.rolAprobador === user?.rol || userNivel >= 90)` como criterio de aprobador, habilitando Aprobar/Rechazar a cualquier nivel>=90 (RRHH) aunque el paso sea SUPERVISOR/COORDINADOR/GERENTE y el usuario no sea el aprobador responsable. El backend que rechaza (correcto) es apps/api/src/utils/approval-auth.utils.ts:43-48 (paso SUPERVISOR: si owner.supervisorId, sólo ese supervisor o ADMIN). El GET permisivo por nivel está en apps/api/src/routes/planillas.routes.ts:300. Fix sugerido: en el front, para nivel>=90 tratar como aprobador sólo si el paso es RRHH (o el usuario es ADMIN), replicando isResponsibleApprover como ya hace AprobacionesPage.
- **Evidencia:** Script propio: apps/api/tests/sim/verify-rrhh-approve-403-x9k2.ts (HTTP contra http://localhost:4000/api/v1). Setup: sector VerifSec + SUPERVISOR + OPERADOR(supervisorId=sup) + RRHH nuevo (todos empresa de admin@wenlen.com) + flujo PLANILLA pasos=[1:SUPERVISOR

### 🟡 MEDIA — El botón 'Excel' del detalle de planilla se muestra a supervisor/coordinador/gerente pero GET /export/planilla/:id devuelve 403 y el error se traga en silencio  ✅
- **Guion:** Contrato UI core · **Módulo:** export · **Rol:** SUPERVISOR (también COORDINADOR/GERENTE)
- **Endpoint:** `GET /export/planilla/:id`
- **Esperado:** Si el supervisor puede ver y aprobar la planilla, o bien debería poder exportarla (backend export usa isOwn || nivel>=90), o el front debería ocultar/inhabilitar el botón Excel para quien no es owner ni nivel>=90. Además, ante el 403 debería avisar al usuario.
- **Obtenido:** GET /export/planilla/:id → 403 para SUPERVISOR/COORDINADOR/GERENTE que revisa una planilla de subordinado. El onClick lo captura con `catch { /* noop */ }`, así que el botón no descarga nada ni muestra error: parece colgado/roto.
- **Repro:** Con el mismo setup del hallazgo 1 (supervisor supId, operador opId con supervisorId=supId, planilla del operador ENVIADA). Login como el SUPERVISOR (que legítimamente puede ver y aprobar la planilla del subordinado): GET /planillas/:id → 200 (la ve). En PlanillaDetailPage el botón 'Excel' se renderiza SIN condición de rol (siempre visible para cualquier viewer). Click → onClick hace GET /export/planilla/:id con responseType blob. GET /export/planilla/:id como supervisor → 403.
- **Causa raíz (verificada):** apps/web/src/pages/planillas/PlanillaDetailPage.tsx:959-964 (botón Excel sin gating de rol + onClick con `catch { /* noop */ }` que traga el error); el 403 lo emite apps/api/src/routes/export.routes.ts:50 (`if (!isOwn && nivel < 90) res.status(403)`), regla que difiere de la autorización de vista en planillas.routes.ts:300-318 (que sí habilita al supervisor responsable/con flow-visibility).
- **Evidencia:** Live API localhost:4000. [SUP] GET /planillas/5fa8..faa5 → 200. [SUP] GET /export/planilla/5fa8..faa5 → 403 body={"error":"Sin permisos para exportar esta planilla"}. [OWNER] GET /export/planilla/... → 200 (binary xlsx, 7478 bytes, ct=application/vnd.openxmlfo

### 🟡 MEDIA — AusenciasPage muestra el botón Eliminar en ausencias BORRADOR a usuarios no-RRHH, pero DELETE /ausencias/:id exige nivel RRHH → 403  ✅
- **Guion:** Contrato UI core · **Módulo:** ausencias · **Rol:** SUPERVISOR
- **Endpoint:** `DELETE /ausencias/:id`
- **Esperado:** Coherencia: DELETE /ausencias/:id está protegido con requireLevel(RRHH). El front debería ocultar el botón Eliminar para quien no es RRHH/ADMIN (o el backend permitir borrar el BORRADOR propio-creado). Hoy el único que ve ese botón (el supervisor que cargó la ausencia) no puede usarlo.
- **Obtenido:** DELETE /ausencias/:id como supervisor → 403. El supervisor ve el botón Eliminar en su ausencia BORRADOR pero el borrado siempre falla.
- **Repro:** Setup como admin: sector + supervisor (supId) + operador (opId con supervisorId=supId). Login SUPERVISOR: 1) POST /ausencias {usuarioId:opId, tipo:'FALTA_JUSTIFICADA', fechaInicio:'2026-09-10T00:00:00.000Z', fechaFin igual, diasAusencia:1, descripcion} → 201, estado BORRADOR (sólo supervisor+ pueden crear/ver ausencias BORRADOR de subordinados). 2) GET /ausencias?scope=equipo → la ausencia aparece con estado BORRADOR. En AusenciasPage el bloque `{a.estado === 'BORRADOR' && (<button ... deleteMutation.mutate(a.id)>Trash</button>)}` NO tiene gating de rol, así que el supervisor ve el botón Elimi
- **Causa raíz (verificada):** apps/web/src/pages/ausencias/AusenciasPage.tsx:375 (botón Eliminar sin gating de rol; comparar con Enviar en :365 que exige isSuperior) en incoherencia con apps/api/src/routes/ausencias.routes.ts:1080 (DELETE con requireLevel(LEVEL_RRHH))
- **Evidencia:** Setup fresco (sup SUPERVISOR nivel=60 + op OPERADOR con supervisorId=sup). [1] POST /ausencias (supervisor) → 201 estado=BORRADOR (id 86f04447..., cargadaPorId=sup). [2] GET /ausencias?scope=equipo (supervisor) → 200, ausencia BORRADOR presente=true; GET /ause

### 🟡 MEDIA — WentopPage llena el filtro y el selector 'Sector de la observación' con GET /admin/sectores (nivel 100): 403 para CMASS y todos los roles operativos → selects vacíos  ✅
- **Guion:** Contrato UI admin · **Módulo:** wentop · **Rol:** CMASS
- **Endpoint:** `GET /admin/sectores`
- **Esperado:** El selector de sectores de WENTOP se puebla para los roles que ven la página (mínimo CMASS, que es el rol dueño del módulo). Debería usar un endpoint accesible (ej. /analytics/sectores).
- **Obtenido:** 403 en /admin/sectores para CMASS/GERENTE/RRHH/COORD/SUP/OPERADOR; sólo ADMIN obtiene 200. Los selectores de sector de WENTOP quedan vacíos para todos salvo ADMIN.
- **Repro:** WENTOP es visible para todos los roles (AppShell sin minLevel). WentopPage.tsx:280 hace api.get('/admin/sectores') y pasa el array 'sectores' al panel de filtros (option list del filtro Sector), al formulario de alta ('Sector de la observación') y al tab Gestores. Login CMASS sandra.montenegro@demo.com y GET /admin/sectores → 403 (la ruta exige requireLevel(LEVEL_ADMIN)=100). Igual para GERENTE/RRHH/COORD/SUP/OPERADOR. Resultado: el desplegable de sector queda vacío, CMASS no puede filtrar por sector ni elegir sector al crear una tarjeta desde el combo. Existe /analytics/sectores (nivel 70) qu
- **Causa raíz (verificada):** apps/web/src/pages/WentopPage.tsx:280 (api.get('/admin/sectores') en lugar de /analytics/sectores); habilitado por apps/web/src/components/layout/AppShell.tsx:63 (WENTOP sin minLevel) y apps/api/src/routes/admin.sectores.routes.ts:12 (requireLevel(LEVEL_ADMIN)=100)
- **Evidencia:** Mi script (tests/sim/verify-wentop-sectores-403.ts), login DEBUG_AUTH pass Test1234!: ADMIN(100) GET /admin/sectores=200 len=23; CMASS(75) sandra.montenegro@demo.com=403 {"error":"No tiene permisos para esta acción"}; GERENTE(80)=403; RRHH(90)=403; COORDINADOR

### 🟡 MEDIA — Tab 'Gestores' de WENTOP: botón Agregar/Eliminar visible para CMASS y GERENTE (canManageGestores incluye nivel>=75) pero POST/DELETE /wentop/gestores exigen RRHH(90) → 403  ✅
- **Guion:** Contrato UI admin · **Módulo:** wentop · **Rol:** CMASS
- **Endpoint:** `POST /wentop/gestores`
- **Esperado:** Si el tab de gestión de gestores se muestra a CMASS (rol dueño del módulo HSE), el POST/DELETE debería permitirle designar/quitar gestores; o el tab no debería ofrecer el botón a quien no puede usarlo.
- **Obtenido:** GET /wentop/gestores = 200 pero POST /wentop/gestores = 403 para CMASS y GERENTE; sólo RRHH/ADMIN pueden dar de alta.
- **Repro:** WentopPage.tsx:258 define canManageGestores = rol CMASS|RRHH|ADMIN || rolNivel>=75, y con eso muestra el tab 'Gestores' y su botón 'Agregar'. GET /wentop/gestores exige LEVEL_CMASS(75) (200 para CMASS), pero POST /wentop/gestores y DELETE /wentop/gestores/:id exigen requireLevel(LEVEL_RRHH)=90. Login CMASS sandra.montenegro@demo.com; POST /wentop/gestores {usuarioId, sectorId} → 403. Idem GERENTE (nivel 80). El botón que la UI ofrece a CMASS/GERENTE nunca funciona.
- **Causa raíz (verificada):** Frontend (origen del botón muerto): apps/web/src/pages/WentopPage.tsx:257-259 define canManageGestores con umbral rolNivel>=75 (o rol CMASS/RRHH/ADMIN), y ese mismo flag gatea el render del tab y del GestoresTab en WentopPage.tsx:370-371 y 435-436; dentro de GestoresTab el botón 'Agregar' (~línea 1039) y el botón Trash de borrado (~línea 1085) se renderizan sin gate de escritura. Backend (regla que rechaza): apps/api/src/routes/wentop.routes.ts:228 (POST requireLevel(LEVEL_RRHH)) y :275 (DELETE requireLevel(LEVEL_RRHH)), con LEVEL_RRHH=90 vs LEVEL_CMASS=75 en apps/api/src/middleware/roles.middleware.ts:6-8. El desajuste es umbral UI=75 contra umbral escritura backend=90.
- **Evidencia:** Mi corrida (npx tsx tests/sim/verify-wentop-gestores-authz.ts) contra http://localhost:4000/api/v1, login password 'Test1234!': login admin admin@wenlen.com rol=ADMIN nivel=100 canManageGestores(UI)=true login rrhh maria.rodriguez@demo.com rol=RRHH nivel=90 ca

### 🟡 MEDIA — CierrePage: la pestaña 'Pendientes' llama GET /admin/usuarios (ruta inexistente) → 404, por lo que queda siempre vacía  ✅
- **Guion:** Contrato UI admin · **Módulo:** admin · **Rol:** RRHH
- **Endpoint:** `GET /admin/usuarios`
- **Esperado:** La pestaña 'Pendientes' del cierre lista los empleados activos sin planilla aprobada. Debería llamar a /usuarios (que existe y responde 200).
- **Obtenido:** 404 en /admin/usuarios; la lista de pendientes del cierre queda permanentemente vacía para RRHH y ADMIN.
- **Repro:** CierrePage.tsx:91-95 define la query 'usuarios-cierre' = api.get('/admin/usuarios') (enabled si isRRHH) y con allUsers arma pendientesTab (usuarios activos sin planilla aprobada/cerrada, líneas :99-105). En src/routes/index.ts sólo está montado /usuarios, no /admin/usuarios. Login RRHH maria.rodriguez@demo.com; GET /admin/usuarios → 404 (Cannot GET /api/v1/admin/usuarios). allUsers=[] siempre → la pestaña 'Pendientes' (quién falta entregar planilla en el cierre) nunca lista a nadie. El endpoint correcto /usuarios devuelve 200 con 260 usuarios.
- **Causa raíz (verificada):** apps/web/src/pages/admin/CierrePage.tsx:93 (queryFn llama api.get('/admin/usuarios'), ruta no montada en apps/api/src/routes/index.ts; el endpoint correcto es /usuarios)
- **Evidencia:** Sesión RRHH maria.rodriguez@demo.com login=200 rol=RRHH. GET /api/v1/admin/usuarios => status 404, body: '<!DOCTYPE html><html lang="en"><head>...<title>Error</title></head><body><pre>Cannot GET /api/v1/admin/usuarios</pre></body></html>'. GET /api/v1/usuarios

### 🟡 MEDIA — Uploads multipart: multer devuelve 500 (error opaco) en vez de 400 ante campo inesperado o archivo no permitido, en WENTOP fotos y en Mensajes  ✅
- **Guion:** Contrato UI admin · **Módulo:** wentop · **Rol:** CMASS
- **Endpoint:** `POST /wentop/:id/fotos`
- **Esperado:** 400 con un mensaje claro (campo/tipo de archivo no permitido). El usuario que sube por error un .txt/.exe o el front que manda el campo mal debería recibir un 4xx accionable.
- **Obtenido:** 500 {"error":"Error interno del servidor"} en los tres casos.
- **Repro:** upload.middleware.ts:18-27 usa un fileFilter que hace cb(new Error('Solo se permiten imágenes... y PDF')) y no hay ningún middleware de error que mapee MulterError/Error a 400. Casos reproducidos: (1) POST /wentop/:id/fotos con el campo multipart llamado 'foto' (multer espera 'fotos', upload.array('fotos',10)) → 500 (LIMIT_UNEXPECTED_FILE sin handler). (2) POST /wentop/:id/fotos con un adjunto .txt (text/plain) → 500 (fileFilter tira Error). (3) POST /mensajes (upload.single('archivo')) con un .exe application/octet-stream → 500. Login CMASS para wentop, RRHH para mensajes.
- **Causa raíz (verificada):** Principal: apps/api/src/app.ts:109-112 (error handler global devuelve 500 genérico para todo error, sin distinguir MulterError ni el Error del fileFilter). Contribuyente: apps/api/src/middleware/upload.middleware.ts:25 (fileFilter hace cb(new Error(...)) en vez de un error tipado 4xx) y la ausencia de un middleware de mapeo multer→400 en las rutas que usan upload.array/single: wentop.routes.ts:608, mensajes.routes.ts:179 y :287, ausencias.routes.ts:1000.
- **Evidencia:** Login CMASS sandra.montenegro@demo.com (rol CMASS nivel 75); creé tarjeta id 324fe5a2 (201). [C0] POST /wentop/{id}/fotos campo 'fotos' .png => 201 [{"id":"c4b695d0...","url":"/uploads/...png"}]. [C1] mismo endpoint campo 'foto' (esperado 'fotos') .png => 500 

### 🟡 MEDIA — GET /wentop con enum inválido en estado/tipoTarjeta se pasa crudo a Prisma → 500 (debería ser 400)  ✅
- **Guion:** Contrato UI admin · **Módulo:** wentop · **Rol:** CMASS
- **Endpoint:** `GET /wentop?estado=NO_EXISTE`
- **Esperado:** 400 (valor de enum inválido) o ignorar el filtro; no un 500.
- **Obtenido:** 500 {"error":"Error interno del servidor"} al pasar un valor de estado/tipoTarjeta fuera del enum.
- **Repro:** wentop.routes.ts:305 hace 'if (estado) where.estado = estado as string' (idem tipoTarjeta) sin validar contra el enum. Login CMASS sandra.montenegro@demo.com. GET /wentop?estado=NO_EXISTE → 500. GET /wentop?tipoTarjeta=NO_EXISTE → 500. En cambio GET /wentop?estado=ABIERTA = 200 y filtra bien (11 tarjetas).
- **Causa raíz (verificada):** apps/api/src/routes/wentop.routes.ts:305-306 (if (estado) where.estado = estado as string; if (tipoTarjeta) where.tipoTarjeta = tipoTarjeta as string; — sin validar contra los enums WentopEstado/WentopTipoTarjeta antes de pasar a Prisma)
- **Evidencia:** LOGIN 200 nivel=75 rol=CMASS. GET /wentop?estado=NO_EXISTE -> 500 {"error":"Error interno del servidor"}. GET /wentop?tipoTarjeta=NO_EXISTE -> 500 {"error":"Error interno del servidor"}. Controles válidos: GET /wentop?estado=ABIERTA -> 200 (len=10); GET /wento

### 🟡 MEDIA — UsuariosPage y VacacionSaldosPage (visibles a RRHH, nivel 90) pueblan los selects de Sector/Diagrama con GET /admin/sectores y /admin/diagramas (nivel 100) → 403 para RRHH  ✅
- **Guion:** Contrato UI admin · **Módulo:** admin · **Rol:** RRHH
- **Endpoint:** `GET /admin/sectores`
- **Esperado:** RRHH, que puede crear/editar usuarios y editar saldos, debe poder poblar los selectores de sector/diagrama de esas páginas.
- **Obtenido:** 403 en /admin/sectores y /admin/diagramas para RRHH, mientras POST /usuarios = 201; los combos de sector/diagrama quedan vacíos.
- **Repro:** AppShell da 'Usuarios' y 'Saldos Vac.' a minLevel 90. POST/PUT /usuarios exigen RRHH (90) — RRHH sí puede crear/editar usuarios (POST /usuarios = 201). Pero los desplegables 'Sector' y 'Diagrama' del formulario se llenan con GET /admin/sectores y GET /admin/diagramas, ambos requireLevel(LEVEL_ADMIN)=100. VacacionSaldosPage también usa /admin/sectores para su filtro de sector. Login RRHH maria.rodriguez@demo.com: GET /admin/sectores = 403, GET /admin/diagramas = 403. Consecuencia: RRHH puede dar de alta un usuario pero no elegir sector ni diagrama desde los combos (quedan vacíos), y su filtro d
- **Causa raíz (verificada):** apps/api/src/routes/admin.sectores.routes.ts:12 (router.use(requireLevel(LEVEL_ADMIN)) sobre GET /) y apps/api/src/routes/admin.diagramas.routes.ts:11; consumidores frontend: apps/web/src/pages/admin/UsuariosPage.tsx:84 y :95, apps/web/src/pages/admin/VacacionSaldosPage.tsx:59. Alternativa correcta ya existente: apps/api/src/routes/analytics.routes.ts:121 (GET /analytics/sectores, LEVEL_COORDINADOR=70).
- **Evidencia:** Login maria.rodriguez@demo.com (Test1234!, DEBUG_AUTH) → 200, rol=RRHH rolNivel=90. GET /admin/sectores → 403 {"error":"No tiene permisos para esta acción"}. GET /admin/diagramas → 403 {"error":"No tiene permisos para esta acción"}. GET /admin/roles → 200 (7 r

---

## ⚪ BAJA — 9 confirmados

### ⚪ BAJA — POST /wentop acepta sectorObservacionId de OTRA empresa (referencia cross-tenant)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** wentop · **Rol:** OPERADOR (tomas.moreno@demo.com)
- **Endpoint:** `POST /wentop`
- **Esperado:** 400 si el sector no pertenece a la empresa del creador.
- **Obtenido:** 201, tarjeta creada con sector cross-empresa.
- **Repro:** POST /wentop {fechaReporte:'2026-07-02', tipoTarjeta:'ACTO_INSEGURO', descripcion:'x', sectorObservacionId:'7cf448a4-7e6b-4d71-b880-93f34ecdecbe' (sector de otra empresa)} -> 201. wentop.routes.ts:400 guarda sectorObservacionId sin validar la empresa, a diferencia de POST /wentop/gestores (:240) que sí hace sector.findFirst con empresaId. La tarjeta queda con empresaId propio pero apuntando a un sector de otra empresa (la visibilidad se calcula sobre sectorObservacionId).
- **Causa raíz (verificada):** apps/api/src/routes/wentop.routes.ts:400 (handler POST '/', lineas 361-421): guarda `sectorObservacionId: sectorObservacionId || null` sin verificar prisma.sector.findFirst({id, empresaId: req.user.empresaId}). Contrasta con POST '/gestores' linea 240 que si lo valida. Mismo defecto de validacion faltante en PUT '/:id' linea 479 al actualizar sectorObservacionId.
- **Evidencia:** Login tomas.moreno@demo.com (Test1234!) -> OPERADOR, empresaId=32e126e4-e36b-484b-9233-205922a2840a, sectorId=6ee3adf3. Sector reportado 7cf448a4-7e6b-4d71-b880-93f34ecdecbe ("Fractura") pertenece a empresa 62e25426 (distinta). REPRO: POST /wentop {fechaReport

### ⚪ BAJA — PUT /ausencias/:id {aprobada:true} marca aprobada=true sin cambiar estado ni pasar por el flujo (estado inconsistente)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** ausencias · **Rol:** RRHH / ADMIN (admin@wenlen.com)
- **Endpoint:** `PUT /ausencias/:id`
- **Esperado:** Rechazar el flag directo, o sincronizar estado->APROBADA vía el flujo (aprobadaAt, pasoActual, historial).
- **Obtenido:** 200; queda aprobada=true con estado=PENDIENTE y pasoActual=1 (registro incoherente).
- **Repro:** Ausencia en estado PENDIENTE. PUT /ausencias/<id> {"aprobada":true} -> 200. ausencias.routes.ts:1066-1067 setea aprobada + aprobadaPorId pero NO cambia estado a APROBADA ni pasoActual; se saltea el flujo de aprobación (avanzar).
- **Causa raíz (verificada):** apps/api/src/routes/ausencias.routes.ts:1063-1070 (updateAusenciaSchema incluye aprobada en :47; el handler PUT setea data.aprobada + data.aprobadaPorId pero no sincroniza estado, aprobadaAt, historial ni inyectarDiasBloqueados)
- **Evidencia:** POST /ausencias/solicitar (operador) -> 201 estado=PENDIENTE pasoActual=1 aprobada=false aprobadaAt=null flujoId=4aa30c5c-... | PUT /ausencias/<id> {aprobada:true} (RRHH ana.martinez) -> 200 body: estado=PENDIENTE pasoActual=1 aprobada=true aprobadaPorId=7a494

### ⚪ BAJA — 500 en GET con parámetro de fecha inválido (planillas / vacaciones / auditoria)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** planillas · **Rol:** OPERADOR / ADMIN
- **Endpoint:** `GET /planillas?periodoInicio=2026-13-45`
- **Esperado:** 400 (parámetro de fecha inválido).
- **Obtenido:** 500 (respuesta genérica, sin stack).
- **Repro:** GET /planillas?periodoInicio=2026-13-45 (token operador) -> 500. GET /vacaciones?periodoInicio=abc&periodoFin=def -> 500. GET /auditoria?desde=2026-13-45 (token admin) -> 500. Los query params de fecha no se validan antes de construir el filtro.
- **Causa raíz (verificada):** apps/api/src/routes/planillas.routes.ts:107 (y 109) `where.periodoInicio = { gte: new Date(periodoInicio) }`; apps/api/src/routes/vacaciones.routes.ts:364,370 `new Date(periodoFin)`/`gte: new Date(periodoInicio)`; apps/api/src/routes/auditoria.routes.ts:22-23 `new Date(desde as string)`/`new Date(hasta as string)` — ninguno valida el Date antes de pasarlo a Prisma.
- **Evidencia:** Mi corrida real (token admin@wenlen.com, rol=ADMIN nivel=100, DEBUG_AUTH activo, pass Test1234!):  - GET /auditoria?desde=2026-01-01 -> [200] (control OK) ; GET /auditoria?desde=2026-13-45 -> [500] {"error":"Error interno"} - GET /planillas?periodoInicio=2026-

### ⚪ BAJA — 500 en POST /capacitaciones/registros con usuarioId/tipoId inexistentes (debería 400/404)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** capacitaciones · **Rol:** ADMIN
- **Endpoint:** `POST /capacitaciones/registros`
- **Esperado:** 400 o 404 indicando referencia inexistente.
- **Obtenido:** 500 (respuesta genérica, sin stack).
- **Repro:** POST /capacitaciones/registros {usuarioId:'00000000-0000-4000-8000-000000000000', tipoId:'00000000-0000-4000-8000-000000000000', fechaRealizacion:'2024-01-01'} -> 500. La violación de FK (P2003) no se mapea a 400/404.
- **Causa raíz (verificada):** apps/api/src/routes/capacitaciones.routes.ts: create en líneas 208-219 lanza P2003 por FK inexistente; el catch (líneas 221-228) solo mapea ZodError->400 (línea 222) y todo lo demás cae al 500 genérico (línea 227). Falta un mapeo de P2003 -> 400/404.
- **Evidencia:** POST /capacitaciones/registros {usuarioId:'00000000-0000-4000-8000-000000000000', tipoId:'00000000-0000-4000-8000-000000000000', fechaRealizacion:'2024-01-01'} -> 500 {"error":"Error interno"}. POST con tipoId real (4ecab233-2088-4b94-9a25-133927e96289) y usua

### ⚪ BAJA — 500 ante JSON malformado (el error handler global mapea todo a 500 en vez de 400)  ✅
- **Guion:** Seguridad/AuthZ · **Módulo:** planillas · **Rol:** OPERADOR
- **Endpoint:** `POST /planillas`
- **Esperado:** 400 'JSON inválido'.
- **Obtenido:** 500 (sin stack ni internals filtrados).
- **Repro:** POST /planillas con Content-Type application/json y body roto: '{"periodoInicio": ' -> 500. El SyntaxError del body-parser cae en el handler global (app.ts:109-111) que responde 500 para cualquier error.
- **Causa raíz (verificada):** apps/api/src/app.ts:111 (handler global apps/api/src/app.ts:109-111 responde res.status(500) fijo e ignora err.status/err.statusCode=400 que body-parser adjunta al SyntaxError 'entity.parse.failed' generado en express.json de app.ts:71)
- **Evidencia:** CASO 1 (repro exacta, OPERADOR con token): POST /planillas, body '{"periodoInicio": ' -> status 500, body {"error":"Error interno del servidor"}. CASO 2 (sin token): mismo body -> 500. CASO 3 control (body {} valido, con token): 201 con planilla creada, prueba

### ⚪ BAJA — Vacaciones: el front envía los días CORRIDOS en el campo diasHabiles; la UI de aprobación muestra sábados y domingos como 'días hábiles'  ✅
- **Guion:** Contrato UI core · **Módulo:** vacaciones · **Rol:** OPERADOR (solicitante) / aprobador que lo visualiza
- **Endpoint:** `POST /vacaciones  (leído por GET /vacaciones y /aprobaciones)`
- **Esperado:** El valor mostrado como 'días hábiles' debería excluir fines de semana (y feriados). O el backend calcula diasHabiles reales, o el front no debería etiquetar ese número como 'hábiles' (es igual a los corridos siempre).
- **Obtenido:** diasHabiles == diasTotales para todo rango; para un vie→lun (4 corridos) la UI informa '4 días hábiles' cuando los hábiles reales son 2. El saldo se descuenta correctamente por diasTotales (corridos), así que sólo la etiqueta 'hábiles' es incorrecta.
- **Repro:** Login como cualquier operador. En VacacionFormModal (apps/web/src/pages/vacaciones/VacacionesPage.tsx) el submit hace POST /vacaciones {fechaInicio, fechaFin, diasHabiles: diasTotales} — manda los días CORRIDOS en el campo diasHabiles (comentario en el código: 'backend field, but we send total calendar days'). Reproducción HTTP: POST /vacaciones {fechaInicio:'2026-11-06T00:00:00.000Z' (viernes), fechaFin:'2026-11-09T00:00:00.000Z' (lunes), diasHabiles:4, motivo:'x'}. El backend guarda diasHabiles=4 (tal cual) y calcula diasTotales=4. Luego GET /vacaciones y GET /aprobaciones devuelven diasHabi
- **Causa raíz (verificada):** Origen del label incorrecto en el front: apps/web/src/pages/vacaciones/VacacionesPage.tsx:446 (envía días corridos en el campo diasHabiles) y apps/web/src/pages/aprobaciones/AprobacionesPage.tsx:646 (lo renderiza como 'días hábiles'); también VacacionesPage.tsx:117. Complicidad del backend: apps/api/src/routes/vacaciones.routes.ts:493 almacena parsed.data.diasHabiles sin recalcular hábiles reales, mientras diasTotales se calcula como corridos en la línea 418.
- **Evidencia:** Repro en vivo contra http://localhost:4000/api/v1 con operador fresco (verify.vac.864158@sim.local, rolNivel 10): POST /vacaciones {fechaInicio:'2026-11-06T00:00:00.000Z' (Vie), fechaFin:'2026-11-09T00:00:00.000Z' (Lun), diasHabiles:4, motivo:'verify-habiles'}

### ⚪ BAJA — GET /auditoria con parámetro de fecha inválido (desde/hasta) → 500 (new Date(invalid) llega a Prisma)  ✅
- **Guion:** Contrato UI admin · **Módulo:** admin · **Rol:** RRHH
- **Endpoint:** `GET /auditoria?desde=no-es-fecha`
- **Esperado:** 400 'parámetro desde inválido'; no un 500.
- **Obtenido:** 500 {"error":"Error interno"}.
- **Repro:** auditoria.routes.ts:22-23 hace 'gte: new Date(desde as string)' sin validar; un string no-fecha produce Invalid Date que Prisma rechaza. Login RRHH maria.rodriguez@demo.com. GET /auditoria?desde=no-es-fecha&limit=5 → 500. AuditoriaPage usa CalendarRangePicker que normalmente manda fechas válidas, pero cualquier valor mal formado (o manipulado) rompe el endpoint.
- **Causa raíz (verificada):** apps/api/src/routes/auditoria.routes.ts:22-23 — cond[field] = { gte: new Date(desde as string) } / { lte: new Date(hasta as string) } sin validar que la fecha sea parseable; el Invalid Date llega a prisma.*.findMany y provoca la excepción capturada en el catch (línea 148-151) que responde 500.
- **Evidencia:** LOGIN maria.rodriguez@demo.com -> 200. GET /auditoria?limit=5 -> 200 (array len=5). GET /auditoria?desde=no-es-fecha&limit=5 -> 500 {"error":"Error interno"}. GET /auditoria?hasta=xxxx&limit=5 -> 500 {"error":"Error interno"}. GET /auditoria?desde=2026-01-01&l

### ⚪ BAJA — PUT /admin/config no valida coherencia semántica: acepta umbralExtra50 > umbralExtra100 y periodoDiaInicio == periodoDiaFin  ✅
- **Guion:** Contrato UI admin · **Módulo:** admin · **Rol:** ADMIN
- **Endpoint:** `PUT /admin/config`
- **Esperado:** 400 al guardar umbralExtra50 > umbralExtra100 o periodoDiaInicio == periodoDiaFin (configuración que rompe el cálculo/definición de período).
- **Obtenido:** 200 en ambos casos; la config incoherente se persiste.
- **Repro:** Login ADMIN admin@wenlen.com. PUT /admin/config {umbralExtra50:20, umbralExtra100:4} → 200 (el umbral del 50% queda por encima del 100%, dejando incoherente el cálculo de horas extra). PUT /admin/config {periodoDiaInicio:15, periodoDiaFin:15} → 200 (período de longitud 0/365 días). La sim restauró ambos valores originales. El schema valida tipos/mínimos por campo pero no relaciones entre campos.
- **Causa raíz (verificada):** apps/api/src/routes/admin.config.routes.ts:15-33 (updateConfigSchema sin .refine()/.superRefine(); umbralExtra50/umbralExtra100 en lineas 18-19 validados solo por rango 0-24, sin relacion cruzada). La salida corrupta se materializa en apps/api/src/utils/calculo.utils.ts:96-97 (horasExtra50 = config.umbralExtra100 - config.umbralExtra50, se vuelve negativa si u50>u100). El ejemplo de periodo del reporte NO tiene causa raiz porque no es defecto: getPeriodoActual en calculo.utils.ts:166-188 trata inicio/fin como cortes de meses consecutivos.
- **Evidencia:** LOGIN admin@wenlen.com => 200 (ADMIN nivel 100). CONFIG ORIGINAL {umbralExtra50:8,umbralExtra100:12,periodoDiaInicio:21,periodoDiaFin:20}. [1] PUT /admin/config {umbralExtra50:20,umbralExtra100:4} => 200, body persiste {u50:20,u100:4}; consecuencia en calc rea

### ⚪ BAJA — AnalyticsPage no expone el dashboard sectorial a COORDINADOR/CMASS/GERENTE aunque el backend se los habilita  ✅
- **Guion:** Contrato UI admin · **Módulo:** analytics · **Rol:** COORDINADOR
- **Endpoint:** `GET /analytics/sector/:id`
- **Esperado:** Un COORDINADOR (y CMASS/GERENTE) debería poder ver desde Analytics el dashboard de su(s) sector(es), que el backend ya le autoriza.
- **Obtenido:** La UI sólo le muestra su dashboard personal; el dashboard sectorial (200 en la API) no se expone.
- **Repro:** AnalyticsPage sólo renderiza EmpresaDashboard cuando el rol es RRHH/ADMIN; el resto cae al dashboard personal (/analytics/usuario/<self>). Pero el backend habilita a COORDINADOR: login martin.lopez@demo.com → GET /analytics/sectores = 200 (12 sectores) y GET /analytics/sector/<su-propio-sector>?periodoInicio=2026-06-21T00:00:00.000Z&periodoFin=2026-07-20T00:00:00.000Z = 200 (usuariosCount y totales). El acceso ajeno correctamente da 403. Ese panel sectorial (al que el coordinador tiene permiso) no es alcanzable desde ninguna vista de la UI.
- **Causa raíz (verificada):** apps/web/src/pages/analytics/AnalyticsPage.tsx:78-81 (gating de UI: isAdmin=['RRHH','ADMIN'] -> COORDINADOR/CMASS/GERENTE caen al dashboard personal; ninguna rama renderiza el dashboard sectorial). El endpoint autorizado que queda inalcanzable: apps/api/src/routes/analytics.routes.ts:137 (requireLevel(LEVEL_COORDINADOR) con scoping por sector en :157-167).
- **Evidencia:** Login martin.lopez@demo.com -> rol=COORDINADOR, rolNivel=70, sectorId=6ee3adf3...43d898 (Fractura). [1] GET /analytics/sectores = 200 (12 sectores). [2] GET /analytics/sector/<propio Fractura>?periodoInicio=2026-06-21...&periodoFin=2026-07-20... = 200 {"sector

---

## Descartados (verificador: comportamiento intencional)

- **[COMPORTAMIENTO_ESPERADO]** GET /auth/debug-users expone el directorio completo (124 usuarios) SIN autenticación
  - El endpoint reproduce exactamente lo reportado, pero es un helper de desarrollo intencional, no un defecto. Está marcado explícitamente como "dev only" (auth.routes.ts:61-63) y está gateado por DEBUG_AUTH = (process.env.DEBUG_AUTH === 'true' && NODE_ENV !== 'production'), auto-desactivándose con 404 en producción (línea 64-67) — que es justamente el guard de "no exponer en producción" que el repor
- **[COMPORTAMIENTO_ESPERADO]** Baja (soft-delete) de usuario con planilla ENVIADA la saca de la bandeja del supervisor pero la deja pendiente/estancada
  - Reproduje los hechos puntuales del reporte, pero su conclusión central —"documento huérfano/estancado, nunca accionable por la UI"— es FALSA. Los tres comportamientos observados son reglas de negocio intencionales, no un defecto: (1) la planilla desaparece de la bandeja del supervisor porque getFlowVisibleUserIds filtra a activo:true (no molestar al aprobador de primera línea con documentos de un 
- **[COMPORTAMIENTO_ESPERADO]** POST /admin/alertas acepta 'tipo' y 'rolesDestino' arbitrarios sin validar contra ningún enum/lista
  - Reproduje el 201 exacto, pero el "Esperado" del reporte es incorrecto, así que no es un defecto. (1) No existe catálogo server-side de 'tipo': los 8 tipos viven SOLO como constante de UI en AlertasPage.tsx; el modelo AlertaConfig guarda tipo como String libre a propósito (schema.prisma:768). (2) Los roles son DINÁMICOS por empresa: el catálogo real tiene 7 roles del sistema (incluye CMASS) más rol
- **[COMPORTAMIENTO_ESPERADO]** PUT /notificaciones/:id/leer devuelve 200 {ok:true} para un id inexistente o ajeno (updateMany sin verificar count)
  - La conducta se reproduce tal cual, pero no es un defecto: es un diseño idempotente y seguro. "Marcar como leída" es idempotente por naturaleza, y devolver 200 {ok:true} ante un no-op es una convención REST estándar y defendible. Lo importante: el updateMany está scopeado por { id, usuarioId: req.user.userId }, así que una notificación AJENA nunca se modifica — el caso "ajeno" está protegido (posit

---

## Estado del entorno tras esta corrida (leído de las notas de cada guion)

### Seguridad/AuthZ — 138/160 escenarios OK

Script: apps/api/tests/sim/seguridad-authz.sim.ts (ejecutado con `npx tsx tests/sim/seguridad-authz.sim.ts` desde apps/api). Corrida final: 160 escenarios, 0 fallos de script, 0 filtraciones (ningún 4xx/5xx devolvió stack trace, SQL ni rutas del servidor). Todos los hallazgos fueron verificados contra el código de las rutas.

COBERTURA OK (sin hallazgos, comportamiento correcto):
- AUTH: sin token / header vacío / 'Bearer' solo / basura / esquema Basic / JWT truncado / JWT firmado con otro secreto / JWT expirado (secreto real) / alg=none / claims incompletos -> todos 401, nunca 500.
- ESCALADA VERTICAL: ~60 endpoints admin/RRHH/coordinador probados con token OPERADOR (tomas) -> todos 403 (admin/config, sectores, roles, flujos, auditoria, backup, vacacion-saldos/generar, export/cierre, usuarios POST/PUT/DELETE, notificaciones, analytics, capacitaciones, sesiones, wentop/gestores, ausencias avanzar/rechazar, planillas cerrar/reabrir/compensatorio, cambios-diagrama, POST /mensajes multipart, etc.).
- IDOR HORIZONTAL operador->operador (tomas sobre recursos de nestor, otro sector/empresa lógica): planilla, registros, historial, enviar, marcar-dia, export XLSX, ausencia (certificado médico), vacación, mensaje privado, tarjeta WENTOP (GET/PUT/PATCH estado/DELETE), analytics/usuario, ficha RRHH -> todos 403/404. DELETE/PUT-leer de notificaciones y mensajes ajenos: no-op real (verificado en DB que no borran/marcan), aunque responden 204/200 (respuesta algo engañosa, no se contó como bug).
- MASS ASSIGNMENT: POST /planillas, /vacaciones, /wentop con estado/usuarioId/aprobadaPorId/empresaId/creadorId/totales inyectados -> los campos extra se ignoran correctamente.
- Validación: horasViajeInput negativo, observaciones 100k, diasAusencia/diasHabiles negativos, fechas invertidas, fechaReporte/fecha inválida en wentop y vacaciones, tipoTarjeta array, PUT /admin/config fuera de rango, body array, anio fuera de rango en vacacion-saldos/generar -> todos 400 correctos.
- PASSWORD: política (min 8, mayúscula, número) aplicada en change/reset; reset-password con token inválido -> 400; token reutilizado -> 400 'ya fue utilizado' (correcto); reset-password sí revoca refresh tokens; change-password sin token -> 401.

NO SE PUDO CUBRIR / SALVEDADES:
- El resetUrl-en-body (hallazgo 2) sólo se observó cuando el rate-limit de forgot-password (5xx/429) no estaba activo; en corridas repetidas el endpoint devuelve 429 y no expone el link. La evidencia proviene de la corrida sin rate-limit.
- Los hallazgos 2 y 10 (forgot-password resetUrl / debug-users) dependen de la config del entorno (SMTP no configurado, DEBUG_AUTH=true, NODE_ENV=development), que es la del servidor en ejecución; en producción se auto-desactivan. Igualmente se reportan porque la instancia corriendo es explotable.
- Observado durante el teardown (no reportado como bug): DELETE /usuarios es un soft-delete (deja activo=false), por eso los usuarios sim de corridas previas persisten inactivos.

LIMPIEZA: se restauraron todos los datos. Se borraron las planillas+registros sim (periodo 2024-03-21 de tomas y nestor), se soft-borraron los usuarios sim-seguridad-authz vía API admin, y se restauró el saldo 2024 de tomas (compensatoriosPendientes había quedado en -2 por el bug de doble revocación) de vuelta a {0,0,0} con una única escritura Prisma acotada. Verificado: tomas.saldo2024={0,0,0}, nestor.saldo2024=null, sin planillas sim remanentes. Config global de empresa no modificada.

### Concurrencia/Estados — 18/20 escenarios OK

Script: apps/api/tests/sim/concurrencia-estados.sim.ts (20 escenarios, 18 PASS). Recon read-only: .recon.ts / .state.ts. Probe dirigido de doble-envío: .probe.ts. Se corrió desde apps/api con npx tsx. La app estaba corriendo; no se tocó src/. Todo dato creado se prefijó con sim-concurrencia-estados-<ts>.

CONTEXTO DE ENTORNO: la DB traía restos de una corrida previa CRASHEADA de este mismo guion (planillas a fechas fijas 2027/2026, saldo de franco sucio con compensatoriosPendientes=1 y marcador 'setup', vacación PENDIENTE de gustavo con 8 días reservados). Por eso reescribí el sim para (a) pre-limpiar por API lo borrable (planillas BORRADOR/RECHAZADA y vacaciones PENDIENTE de franco/gustavo, y resetear el saldo comp de franco a 0/0), y (b) usar años frescos (2050+) que no colisionan. Verificado al final: gustavo 2026 diasPendientes=0, franco 2026 comp acum/used/pend=0/0/0, sin ausencias huérfanas, duplicados de 5.1 borrados.

COBERTURA (todos los bullets del guion):
- Doble envío en paralelo (1.1 + probe): BUG confirmado 8/8 (finding 1).
- Dos aprobadores válidos en paralelo mismo paso (2.1): OK — /avanzar tiene guard optimista (updateMany where pasoActual) → un 200, un 409.
- Aprobar+rechazar en paralelo (3.1 planilla franco, 3.3 gustavo RRHH-directo): en ambas corridas resolvió coherente (rechazar, que hace update plano, comitea antes y avanzar recibe 409). NO reproduje incoherencia. RIESGO LATENTE: POST /planillas/:id/rechazar hace prisma.planilla.update sin updateMany condicional por estado/paso (a diferencia de /avanzar). Si en otra ventana temporal /avanzar comiteara primero y llegara a APROBADA aplicando saldo, /rechazar podría pisarlo dejando estado incoherente sin revertir saldo; no lo pude forzar en este entorno.
- Dos registros misma fecha en paralelo (4.1): OK — 201 + 409 ('Ya existe un registro para esa fecha'), sin 500 (unique [planillaId,fecha] mapeado a 409).
- Dos planillas mismo período en paralelo (5.1): BUG confirmado (finding 2).
- Dos vacaciones que juntas exceden saldo (6.1): OK — saldo NO queda negativo. La tx Serializable + chequeo de disponible dan 1 creada (201) + 1 rechazada (400 'Saldo insuficiente'); disponible final ≥ 0.
- Borrar planilla con marcas manuales + ausencias (7.1 BORRADOR, 7.2 ENVIADA con marca validada): OK — sin ausencias/registros huérfanos, saldo comp liberado correctamente. 7.3: ausencia formal APROBADA sobrevive al borrado de la planilla (planillaId=null, sigue APROBADA).
- Borrar usuario con doc pendiente (9.1): BUG confirmado (finding 5) — no probé borrar un usuario con planillas EN CURSO borrables porque la baja es soft-delete (no borra planillas); el efecto real es el estancamiento del doc pendiente.
- Rechazar APROBADO / avanzar RECHAZADO (8.1, 8.2, 8.3): OK — todos devuelven 400 con guard claro (planillas y vacaciones tienen guard explícito de estado).
- Planilla sin flujo (10.1): 2 BUGs de autorización (findings 3 y 4, mismo root cause: /avanzar no valida aprobador cuando totalPasos===0).

Findings 3 y 4 comparten la MISMA causa raíz (planillas.routes /avanzar carece del guard que sí tienen vacaciones/ausencias para totalPasos===0); un solo fix (llamar isResponsibleApprover / exigir RRHH+ / bloquear self-approval en esa rama) cubre ambos.

RESTOS INEVITABLES (inherentes a testear guards de estado terminal, no borrables por API y no borré por Prisma por la restricción de sólo-lectura): 1 planilla APROBADA (2050-08-02) y 1 vacación APROBADA (2050-07-05) de franco, 1 ausencia formal APROBADA (2050-11-16), y las planillas del usuario sin-sector desactivado. El saldo de franco 2026 quedó con diasUsados=4 consistente con 2 vacaciones APROBADAS reales (una de esta corrida + una resto de la corrida previa). Quedó activo un usuario '...-1784855540366-sinsector@demo.com' de una corrida ANTERIOR (no creado por mí) — no lo toqué.

### Contrato UI core — 3/8 escenarios OK

Método: extraje cada llamada HTTP del front (services/api.ts + pages de planillas, ausencias, vacaciones, aprobaciones, dashboard, MisSolicitudes) y la contrasté con las rutas reales (planillas/ausencias/vacaciones/aprobaciones/vacacion-saldos/export/usuarios/mis-solicitudes .routes.ts) y con approval-auth.utils/useCanApprove. Todo lo reportado fue confirmado por HTTP contra la API viva (script apps/api/tests/sim/ui-contrato-core.b.sim.ts, 8/8 escenarios). Datos de prueba prefijados con sim-ui-contrato-core-20260724 y limpiados al final (0 usuarios activos residuales verificado).

Hallazgos confirmados: (1) canApprove del front en PlanillaDetailPage habilita Aprobar/Rechazar por nivel>=90 aunque el backend (isResponsibleApprover) sólo deja aprobar al supervisor/coordinador asignado o ADMIN → RRHH recibe 403 en el camino más común. (2) Botón Excel sin gating de rol → 403 para supervisor/coordinador/gerente y el error se traga con catch vacío. (3) Botón Eliminar en ausencia BORRADOR sin gating → DELETE exige RRHH → 403 para el supervisor que la creó. (4) diasHabiles enviado = días corridos → la UI cuenta fines de semana como hábiles.

Contratos revisados que resultaron CORRECTOS (sin bug): shapes de GET /planillas y /planillas/:id (Decimales llegan como string y el front SIEMPRE los envuelve en Number() antes de sumar/formatear — PlanillaCard, MiniCard, PDF export usan Number()); GET /vacaciones/saldo → {disponible,usados,pendiente,total} coincide con Saldo; GET /vacacion-saldos/mi-saldo → compensatoriosDisponible/Acumulados/Usados/Pendientes coincide con CompensatorioSaldo; GET /usuarios/:id expone diagramaActual/diagramaFechaInicio que consume PlanillaDetailPage; marcas manuales (marcar-dia/validar/validar-todo/quitar) y su include marcaManual{id,estado,tipo,cargadaPorId,aprobadaPorId} coinciden; mis-solicitudes devuelve la forma SolicitudUnificada esperada; enriquecerPasos usa pasoFlujo===orden+1 consistente con avanzar.

No cubierto / no confirmable por HTTP: posible corrimiento de día por timezone en buildCalendarDays/dateKey del front (usa new Date(ISO-UTC) + getters locales) — sólo se manifiesta en navegadores con offset negativo (p.ej. UTC-3) y el registroMap se corre en paralelo, por lo que no pude confirmar un desalineo real vía API (el server responde en UTC); lo dejo señalado pero sin reportar como bug para no generar falso positivo. Tampoco ejercité dashboard/DashboardPage a fondo (sus queries de resumen no mostraban divergencias de shape evidentes).

### Contrato UI admin — 36/44 escenarios OK

Método: se reutilizaron y ejecutaron en vivo dos scripts (apps/api/tests/sim/ui-contrato-admin.sim.ts y .b.sim.ts) contra la API en :4000; cada sospecha se confirmó por HTTP y se cruzó contra el código real (rutas en apps/api/src/routes/* y páginas en apps/web/src/*). Cast: admin@wenlen.com, maria.rodriguez (RRHH), laura.gonzalez (GERENTE), sandra.montenegro (CMASS), martin.lopez (COORD), lucas.fernandez (SUP), facundo.garcia (OP). Datos creados prefijados sim-ui-contrato-admin y limpiados; config global restaurada a sus valores originales tras cada prueba. Cobertura: AppShell/menú vs requireLevel, /admin/cierre y /admin/auditoria, formularios guardar-y-releer (alertas, config, sectores, saldos, roles, diagramas, flujos), paginación/filtros de usuarios/auditoría/wentop/mensajes, uploads multipart (wentop fotos, mensajes, avatar/certificado por contrato multer), NotificationBell (polling 30s + count vs no-leídas), WENTOP (filtros/permisos/gestores), capacitaciones y analytics.

Dos FALSOS POSITIVOS del modelo de menú de la sim que se DESCARTARON tras revisar el código: (1) los 403 de /vacaciones/gantt?todos=1 para GERENTE y OPERADOR NO son bug — AppShell.tsx:59 gatea 'Calendario de Equipo' con requireCalendarAccess = user.puedeVerCalendario, y ambos tienen puedeVerCalendario=false, así que el menú les oculta correctamente la página. (2) El 403 de PATCH /usuarios/:id/diagrama-color para ADMIN/RRHH (sin sector) es una limitación latente de la API pero NO un defecto de contrato de front, porque EquipoPage.tsx:59 sólo muestra ese control al COORDINADOR de Well Testing (canEditDiagrama = isWellTesting && rol==='COORDINADOR'); ADMIN/RRHH nunca disparan esa llamada. El caso válido (coordinador sobre operador de su sector) funciona (200) y el cruce de sector se bloquea (403), como debe.

Confirmaciones positivas (sin bug) dignas de mención: el contador de NotificationBell coincide con las no-leídas del listado; PUT /admin/config, /vacacion-saldos y POST /capacitaciones/tipos persisten todos los campos que manda el front; el filtro estado=NO_EXISTE en capacitaciones/registros devuelve 0 (no ignora el filtro); GET /wentop?estado=ABIERTA filtra correctamente; los adjuntos válidos (.png) suben y persisten (201); el cruce horizontal en WENTOP (operador ajeno PUT tarjeta) da 403. La forma de GET /mensajes es un objeto paginado {mensajes,total,noLeidos,page,pages} y MensajesPage no ofrece UI de paginación (default limit 20/max 50): con >20 mensajes el usuario ve sólo la primera página — quedó como observación menor dentro del scope, no elevada a finding por baja probabilidad en el dataset actual (total=3).
