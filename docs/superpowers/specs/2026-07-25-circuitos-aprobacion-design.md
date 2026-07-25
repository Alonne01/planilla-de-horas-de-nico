# Circuitos de aprobación por nivel — 2026-07-25

## El pedido

> «Cada sector debe tener un solo flujo de aprobaciones, pero puede variar por nivel de usuario. Ejemplo: sector A, operador envía la planilla → aprueba supervisor, coordinador, gerente, RRHH. Pero si la planilla la envía un coordinador, solo necesita gerente y RRHH. Si fue supervisor: coordinador, gerente y RRHH.»

Y, sobre los problemas encontrados al investigar el sistema actual: «arreglá todos los posibles problemas que puede haber».

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Regla de salteo | Automática por nivel: se saltea todo paso cuyo aprobador tenga nivel ≤ al del solicitante |
| Sin aprobadores restantes | Siempre se conserva el último paso de la cadena. Nadie se autoaprueba |
| Documentos en vuelo | El circuito se congela al enviar |
| Alcance | Los 4 tipos de documento |
| Problemas colaterales | Se arreglan todos los detectados |

---

## Parte A — El motor de circuitos

### A.1 La regla

Se configura **una cadena completa por sector**. Al enviar un documento, el sistema construye el circuito efectivo quedándose con los pasos cuyo `rolAprobador` tenga **nivel mayor** al del solicitante.

Con la cadena `Supervisor(60) → Coordinador(70) → Gerente(80) → RRHH(90)`:

| Envía | Nivel | Circuito efectivo |
|---|---|---|
| Operador | 10 | Supervisor → Coordinador → Gerente → RRHH |
| Supervisor | 60 | Coordinador → Gerente → RRHH |
| Coordinador | 70 | Gerente → RRHH |
| Gerente | 80 | RRHH |
| RRHH | 90 | RRHH (lo aprueba **otro** RRHH) |
| Admin | 100 | RRHH (ídem) |

Las tres primeras filas son los ejemplos del pedido. Las tres últimas salen de la garantía del último paso.

El nivel se resuelve contra `roles_config` (`codigo → nivel`), no contra códigos hardcodeados, así que un rol nuevo entra en la regla automáticamente según su nivel.

**Casos borde definidos:**

- Cadena vacía (flujo sin pasos) → el documento no puede enviarse; error explícito al usuario.
- Todos los pasos salteados → se conserva **el último paso de la cadena original**, nunca cero. «Original» es la cadena configurada, antes de aplicar el salteo.
- Paso con `usuarioEspecificoId` → se evalúa por el nivel de su `rolAprobador` igual que el resto. Si sobrevive al salteo y ese usuario específico es el solicitante, se aplica la guarda de autoaprobación (A.3).
- **Rol sin entrada en `roles_config`** (código huérfano por un rol borrado, o rol desactivado): su nivel se toma como `0`. Un paso así nunca se saltea —queda siempre en el circuito— y el problema se ve en vez de esconderse. B.6 evita que se llegue a ese estado, pero la regla necesita ser total.
- **Sin flujo asignado** → se **conserva** el comportamiento actual: el documento se envía igual y queda a la espera de que alguien de nivel ≥90 lo apruebe de un saque. No se bloquea el envío. Es tentador exigir un circuito configurado, pero rompería a quien no tiene sector: el admin tiene `sectorId = null` y hoy no existe ninguna asignación global, así que bloquear lo dejaría sin poder enviar nada.

  Lo que sí cambia es que deja de ser silencioso: la respuesta del envío avisa que el sector no tiene circuito configurado y que el documento va a requerir una aprobación manual de RRHH o superior.

### A.2 El congelamiento

Hoy el documento guarda `flujoId` + `pasoActual: Int` y relee `flujo.pasos` **vivos** en cada aprobación (`planillas.routes.ts:564-570`). El vínculo con un paso es únicamente que un número coincida.

Se agrega a los 4 modelos de documento una columna `circuitoSnapshot Json?` que se llena **al enviar** con el circuito ya resuelto para el nivel del solicitante:

```json
[
  { "orden": 1, "nombrePaso": "Aprobación Coordinador", "rolAprobador": "COORDINADOR",
    "usuarioEspecificoId": null, "requiereComentarioRechazo": true,
    "tiempoLimiteHoras": 48, "notificarRoles": ["OPERADOR"] },
  { "orden": 2, "nombrePaso": "Cierre RRHH", "rolAprobador": "RRHH", "...": "..." }
]
```

`flujoId` se conserva para trazabilidad (de qué flujo salió), pero **deja de ser la fuente de verdad del recorrido**.

**Compatibilidad hacia atrás:** si `circuitoSnapshot` es `null` (documentos anteriores a este cambio), el motor cae a leer el flujo vivo, que es el comportamiento actual. Hoy hay 0 planillas en curso, pero el código lo contempla igual para no romper una base con datos.

Se elige JSON y no una tabla nueva porque el motor solo necesita «la lista ordenada de pasos de ESTE documento»; no hace falta consultar pasos a través de documentos. Una tabla polimórfica para 4 tipos exigiría 4 FKs anulables sin ganancia.

### A.3 Guarda de autoaprobación

**Hoy no existe en el camino normal.** El único chequeo está en la rama de escape de «flujo acortado» (`planillas.routes.ts:602`). Con la regla nueva esto se vuelve crítico: un RRHH que envía conserva el paso RRHH y, sin guarda, podría aprobarse a sí mismo.

Se agrega una guarda general en los 4 tipos: **el solicitante nunca puede aprobar su propio documento**, sin importar el paso ni su nivel. Un ADMIN tampoco (el escape de `approval-auth.utils.ts:41` no debe saltear esto).

### A.4 Un módulo, no cuatro copias

Hoy los 4 tipos resuelven el flujo con código copiado que ya divergió:

| Tipo | Cómo resuelve | Problema |
|---|---|---|
| PLANILLA | usuario→sector→global, `orderBy createdAt desc` | Gana el más nuevo, regla invisible |
| VACACION | Ídem | Ídem |
| AUSENCIA | `findFirst` **sin orderBy** | Lo decide Postgres, no determinista |
| CAMBIO_DIAGRAMA | `findFirst` **sin orderBy** | Ídem |
| COMPENSATORIO | `OR` plano en una sola consulta | **Colapsa la prioridad**: un flujo global puede ganarle a una asignación específica del usuario |

Todo eso pasa a `apps/api/src/utils/circuito.utils.ts`:

- `resolverFlujo(tipoDocumento, usuario)` — prioridad usuario → sector → global, determinista.
- `construirCircuito(flujo, nivelSolicitante)` — aplica el salteo y la garantía del último paso.
- `pasosDe(documento)` — devuelve el snapshot, o el flujo vivo si no hay snapshot.
- `pasoActualDe(documento)` — el paso vigente según `pasoActual`.

Los 4 tipos consumen este módulo. Es la pieza que evita que la divergencia se reproduzca.

---

## Parte B — Integridad de la configuración

### B.1 Un flujo por sector, garantizado en la base

`flujos_asignaciones` **no tiene ninguna restricción única** (`schema.prisma:270-283`). Se agrega `@@unique([tipoDocumento, sectorId])`.

Como Postgres no considera dos `NULL` como iguales, esa restricción no cubre el alcance global. Se agregan además dos índices únicos parciales por SQL en la migración:

- `UNIQUE (tipo_documento) WHERE sector_id IS NULL AND usuario_id IS NULL` — un solo flujo global por tipo.
- `UNIQUE (tipo_documento, usuario_id) WHERE usuario_id IS NOT NULL` — un solo flujo por usuario y tipo.

**Limpieza previa obligatoria:** el sector `Testing` tiene hoy dos asignaciones `PLANILLA` activas. La migración fallaría con datos duplicados, así que hay que resolverlo antes: se conserva la más antigua (la del seed) y se borra la otra.

### B.2 El endpoint de asignación

`admin.flujos.routes.ts:344-356` valida duplicados incluyendo `flujoId` en el `WHERE`, así que solo bloquea asignar **el mismo** flujo dos veces. Dos flujos distintos al mismo sector devuelven `201 Created` sin advertencia, y el sector pasa a conducirse por el nuevo.

Pasa a devolver **409 con el nombre del flujo que ya ocupa ese sector**.

### B.3 Editar un flujo en uso

`PUT /admin/flujos/:id` hace `deleteMany` de todos los pasos y los recrea con IDs nuevos (`:161-184`), sin consultar si hay documentos circulando.

Con el congelamiento de A.2 esto deja de corromper documentos en vuelo. Igual se agrega:

- **Aviso, no bloqueo:** la respuesta informa cuántos documentos en curso usan ese flujo. Editarlo ya no los afecta, pero el admin merece saber el alcance.
- **Auditoría:** el archivo no tiene un solo `logAuditoria` (grep vacío). Se registran alta, edición, borrado y asignación de flujos.

### B.4 Borrar un flujo

`DELETE /admin/flujos/:id` (`:201-218`) no borra las asignaciones primero, y la FK es `ON DELETE RESTRICT` (`init/migration.sql:581`), así que la operación falla con un **500 «Error interno»** que no explica nada.

Pasa a: si hay asignaciones, responder **409 listando los sectores afectados**. Para confirmar, el admin repite la llamada con `?forzarDesasignacion=true`, y entonces se borran las asignaciones y el flujo en una transacción. No se usa un borrado en dos pasos con estado intermedio: sin el parámetro nunca se borra nada.

Los documentos ya enviados no se ven afectados porque llevan su snapshot.

### B.5 Órdenes de paso sin huecos ni duplicados

`FlujoPaso.orden` no tiene unicidad ni contigüidad. El panel siempre renumera (`FlujosPage.tsx:237-240`), así que **desde el producto no se pueden generar huecos** — pero los endpoints `POST /:id/pasos` y `DELETE /:id/pasos/:pid` sí lo permiten, y nadie del front los llama (grep de `/pasos` en `apps/web/src`: 0 resultados).

Se agrega `@@unique([flujoId, orden])` y los endpoints de paso individual renumeran al borrar. Con el snapshot esto ya no puede tildar un documento, pero deja la configuración consistente.

### B.6 Borrar un rol usado como aprobador

`DELETE /admin/roles/:id` (`admin.roles.routes.ts:135-139`) solo verifica que ningún **usuario** tenga ese rol. No mira `flujos_pasos.rol_aprobador` ni `notificar_roles`, así que deja pasos apuntando a un código huérfano que nadie puede aprobar salvo un ADMIN.

Pasa a responder **409 listando los flujos y pasos que lo referencian**.

---

## Parte C — Consistencia entre los cuatro tipos

### C.1 Momento de atadura

Hoy difiere:

- **PLANILLA**: se ata al crear el **borrador** (`planillas.routes.ts:307-313`), a veces semanas antes de enviarse, y `/enviar` no re-resuelve (`:524-527`). Una planilla creada cuando el sector no tenía flujo queda con `flujoId = null` para siempre.
- **VACACION** y **CAMBIO_DIAGRAMA**: se atan al crear, que coincide con enviar.
- **AUSENCIA**: dos comportamientos en el mismo archivo. La que carga el empleado se ata al crear (`:273-290`); la que carga un superior nace sin `flujoId` y se resuelve en `/enviar`, sobreescribiéndolo en cada reenvío (`:643`).

Se unifica: **el circuito se resuelve y se congela en el momento de ENVIAR**, en los 4 tipos. Crear un borrador no ata nada.

### C.2 COMPENSATORIO

Es un quinto tipo de facto y el peor tratado: resolución con `OR` plano sin prioridad (`ausencias.routes.ts:352-363`) y un fallback que agarra **cualquier** flujo COMPENSATORIO de la empresa ignorando el sector (`:367-371`).

Además **no existe ningún flujo COMPENSATORIO en la base**, así que hoy todo franco compensatorio nace con `flujoId = null`.

Se unifica bajo el mismo motor y **el seed crea los flujos COMPENSATORIO** que faltan, con los mismos tres patrones que los demás tipos.

### C.3 Flujo desactivado

El `include` de aprobación no filtra por `flujo.activo` (`planillas.routes.ts:564-570`), así que un flujo desactivado sigue conduciendo documentos. Con el snapshot esto deja de importar para lo que está en curso; para lo nuevo, `resolverFlujo` ignora los flujos inactivos.

### C.4 Guarda de aprobación duplicada

`planillas.routes.ts:646-656` compara contra el **número del paso destino**. Si se reordenan los pasos, la misma persona puede quedar responsable de dos posiciones y aprobar ambas. Con el circuito congelado el reordenamiento ya no afecta a lo enviado; igualmente la guarda pasa a comparar contra el paso **aprobado**, no el destino.

---

## Parte D — Trazabilidad

### D.1 Qué guarda hoy el historial

Los 4 historiales tienen los mismos 6 campos y **ninguno guarda el rol, el nombre del paso ni el `flujoId`**. Peor:

- `pasoFlujo` guarda el paso **destino**, no el aprobado (`planillas.routes.ts:694`).
- El **rechazo no guarda `pasoFlujo`** en ninguno de los 4 tipos, así que se pierde dónde se cortó.
- La pantalla que muestra el recorrido (`mis-solicitudes.routes.ts:53-67`) lo arma contra los pasos **actuales** del flujo. Si la cadena cambió, le atribuye a alguien la aprobación de un paso que no existía cuando firmó.

### D.2 Qué cambia

- El historial guarda el paso **aprobado** y el `rolAprobador` de ese paso.
- El rechazo guarda `pasoFlujo`.
- La reconstrucción del recorrido pasa a leer el **snapshot del documento**, no los pasos actuales del flujo. Eso elimina la atribución falsa de raíz.

---

## Parte E — CAMBIO_DIAGRAMA al mismo nivel que los demás

Tres problemas independientes, todos confirmados:

1. **No se puede crear.** `createFlujoSchema` solo acepta `['PLANILLA','VACACION','AUSENCIA','COMPENSATORIO']` (`admin.flujos.routes.ts:28`) y el `<select>` del panel tampoco lo ofrece. Los tres que existen vienen del seed: si el admin borra uno, **no hay forma de recrearlo**. Se agrega el tipo al schema y al panel.
2. **No está en la bandeja unificada.** `GET /aprobaciones` consulta planillas, vacaciones, ausencias y compensatorios, pero no solicitudes de cambio de diagrama. Se agrega.
3. **No notifica a nadie.** `notificarAprobadoresPaso` solo tipa `'PLANILLA'|'VACACION'|'AUSENCIA'` y `cambios-diagrama.routes.ts` nunca la llama. Se agrega el tipo y la llamada.

Aparte: `GET /cambios-diagrama/pendientes` no filtra por paso ni por aprobador responsable — cualquier nivel ≥60 ve **todas** las solicitudes de la empresa, incluidos sectores ajenos. Pasa a filtrar por el paso vigente del documento, como hace la bandeja.

---

## Parte F — La regla tiene que verse

El punto flojo de una regla automática es que es implícita. En `FlujosPage`, debajo de la cadena configurada, se muestra una **vista previa del recorrido por nivel**: la tabla de A.1 calculada con los roles reales de la empresa y la cadena que el admin está editando. Así ve el efecto antes de guardar.

Además, el selector de sectores marca los que ya tienen un flujo de ese tipo asignado, para que el 409 de B.2 no sea una sorpresa.

---

## Verificación

Lo que hay que poder demostrar:

1. **La regla**: con la cadena de A.1, un documento enviado por cada uno de los 6 niveles produce exactamente el circuito de la tabla. Test unitario sobre `construirCircuito`, sin base.
2. **La garantía del último paso**: un RRHH que envía conserva un paso, y **no puede aprobarlo él mismo**.
3. **El congelamiento**: se envía un documento, se edita el flujo (se saca un paso del medio), y el documento sigue recorriendo el circuito con el que nació.
4. **Un flujo por sector**: intentar asignar un segundo flujo del mismo tipo a un sector devuelve 409, y la base lo rechaza aunque se intente por SQL.
5. **Compatibilidad**: un documento sin `circuitoSnapshot` sigue avanzando con el flujo vivo.
6. **Los 4 tipos**: los mismos escenarios en planilla, vacación, ausencia y cambio de diagrama.

## Riesgos

- **La migración de `@@unique` falla si quedan duplicados.** La limpieza de B.1 tiene que correr antes, y el script tiene que ser idempotente por si la migración se reintenta.
- **El snapshot congela también los errores de configuración.** Si un flujo estaba mal armado cuando se envió el documento, corregir el flujo ya no arregla ese documento. Es el precio de la trazabilidad; para eso existe el escape de nivel ≥90.
- **Cambiar el momento de atadura (C.1) cambia el comportamiento observable** de las planillas: una creada como borrador hoy resuelve el flujo al crearse; a partir del cambio lo resuelve al enviarse. Es lo correcto, pero es un cambio de comportamiento, no solo un arreglo.
