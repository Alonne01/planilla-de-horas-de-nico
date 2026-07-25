# Correcciones del recorrido por la app — 2026-07-25

## Origen

Recorrido manual por la app en mobile (Android, vía Cloudflare Tunnel) con 10 capturas anotadas.
Se consolidan en 7 frentes de trabajo. Cuatro son bugs reales; tres son pedidos de UI.

Todo el diagnóstico de este documento fue verificado leyendo el código, y los conteos de la base
con `SELECT` de solo lectura contra `postgresql://localhost:5432/planilla_horas`.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Emojis | Limpieza completa: web (39 ocurrencias) **y** títulos de notificación del API |
| Errores de validación | Alcance total: `setErrorMap` global + helper compartido en las ~15 pantallas |
| WENTOP / creador | Habilitar cerrar + editar + borrar fotos (alinear front con backend) |
| Limpieza de datos | **Reset completo** con `reset-testing.ts` (deja solo admin, conserva config) |
| Selector de Flujos | Arreglarlo para que lea los roles reales de `/admin/roles` |

Fuera de alcance por decisión explícita: migrar fechas de planillas históricas, hacer idempotente
el seed. Ambos quedan anotados al final.

---

## A. Quitar los emojis de la interfaz

**Capturas 1 y 2.** Pedido de UI, no hay bug.

### Estado actual

39 emojis hardcodeados en 11 archivos de `apps/web/src`, relevados a nivel de codepoint. Conviven
con `lucide-react`, que es la librería de iconos del proyecto (la importan 44 archivos) y es el
estilo dominante — en `DashboardPage.tsx` el emoji de la línea 137 convive con `<Shield/>` y
`<MapPin/>` en las líneas 141 y 145.

| Archivo | Líneas | Emojis |
|---|---|---|
| `pages/dashboard/DashboardPage.tsx` | 137 | 👋 (captura 1) |
| `pages/admin/FlujosPage.tsx` | 172, 657, 658 | ⏰, 📝 (captura 2), ⏰ |
| `pages/CapacitacionesPage.tsx` | 613, 617-619, 701, 787-789, 796-798 | ✅❌⏳📅🕐📍➕ (11 ocurrencias) |
| `pages/planillas/PlanillaDetailPage.tsx` | 1291, 1373, 1377, 1435, 1444, 1449, 1503 | ⚠⏳✓🗓⚡⚡📋 |
| `pages/EquipoPage.tsx` | 40-42, 47-49 | 🔵🟡🏢 (duplicados en `DIAGRAMA_LABEL` y `DIAGRAMA_OPTIONS`) |
| `pages/admin/UsuariosPage.tsx` | 573, 574, 655 | 🔄📅⚠️ |
| `pages/ausencias/AusenciasPage.tsx` | 343, 536 | 💰✓ |
| `pages/auth/ForgotPasswordPage.tsx` | 82 | 🛠️ (solo visible en dev) |
| `pages/admin/ConfigPage.tsx` | 82 | ✓ en «✓ Guardado» |
| `components/calendario/CalendarioCompacto.tsx` | 68 | ▓ — **no es emoji** |
| `components/calendario/CalendarioDetallado.tsx` | 320-321 | ▓▨ — **no es emoji** |

### Cambio

1. **Regla general:** se elimina el emoji. Si aportaba significado (no era decoración), se
   reemplaza por el icono `lucide-react` equivalente con `className="h-3 w-3"` o `h-4 w-4` según
   el contexto, envuelto en el `flex items-center gap-1` que ya usan los contenedores padre.
2. **Excepción — leyendas de calendario:** `▓` y `▨` son *swatches* que identifican un patrón
   visual; borrarlos rompe la leyenda. Se reemplazan por un `<span>` con el mismo `background`
   que la celda que representan.
3. **Cuidado al editar:** solo dos líneas llevan variation selector `U+FE0F` y el match exacto lo
   necesita — `UsuariosPage.tsx:655` (`U+26A0 U+FE0F`) y `ForgotPasswordPage.tsx:82`
   (`U+1F6E0 U+FE0F`). En cambio `PlanillaDetailPage.tsx:1435` es `U+1F5D3` pelado.
4. **API — títulos de notificación.** Se quitan de `utils/notificacion.utils.ts` (32-34, 58-60,
   84-86, 116, 180), `routes/sesiones-capacitacion.routes.ts` (246, 342, 503, 609),
   `routes/cambios-diagrama.routes.ts` (357, 365, 443) y `routes/mensajes.routes.ts` (268, 349).
   Se ven crudos en la campanita (`NotificationBell.tsx:177`).

**No se tocan:** los emojis de logs de consola del servidor (`app.ts:329-331`, `backup.service.ts`,
`feriados-sync.service.ts`, `debug-auth.utils.ts`, `seed.ts`) ni el HTML del mail de reset
(`email.utils.ts:42`) — no son UI de la app. Tampoco la tipografía (`—`, `→`, `•`, `…`).

### Riesgo

Las notificaciones **ya guardadas** en la base conservan su emoji en el título; el cambio solo
afecta a las nuevas. El reset completo (frente E) las borra a todas, así que en la práctica queda
limpio.

---

## B. Los períodos siguen en 21→20 con la configuración en 16→15

**Capturas 5 y 10.** Bug confirmado y verificado adversarialmente.

### Causa raíz

El guardado funciona punta a punta. `ConfigPage.tsx:92-93,99-100` escriben `periodoDiaInicio` /
`periodoDiaFin`; `:42` hace `PUT /admin/config`; el backend valida con zod
(`admin.config.routes.ts:16-17`) y persiste en `empresaConfig` (`:63-66`), un único registro por
empresa (`schema.prisma:626`). No hay caché en memoria.

El `21/20` son **defaults de parámetro** en `PeriodSelector.tsx`:

```
:18-19   generateCycles(count, diaInicio: number = 21, diaFin: number = 20)
:63-64   getCurrentPeriod(diaInicio: number = 21, diaFin: number = 20)
```

que el propio componente invoca **sin argumentos**:

```
:86      const cycles = useMemo(() => generateCycles(12), []);
:88      const currentPeriod = useMemo(() => getCurrentPeriod(), []);
```

`PeriodSelectorProps` (`:72-76`) solo tiene `value`/`onChange`/`className`: no hay forma de
inyectarle la configuración, y el componente no llama a la API. El label del síntoma se arma en
`:55`. Simulado con la fecha de hoy (25/07/2026) reproduce exactamente «21 Jul - 20 Ago 2026».

`CierrePage.tsx:71` hereda el problema en el título (`:235`) y en la query (`:84`).

**El backend no tiene el bug:** `calculo.utils.ts:166-188` calcula por parámetro y
`planillas.routes.ts:227-229` lee la config. Pero `GET /planillas` (`:175-187`) filtra por las
fechas que manda el cliente, así que el servidor nunca puede corregir al front.

**Bloqueante:** `GET /admin/config` está detrás de `requireLevel(LEVEL_ADMIN)` aplicado a todo el
router (`admin.config.routes.ts:11`), con `LEVEL_ADMIN = 100`. `PeriodSelector` corre en 5
pantallas accesibles por roles menores — y `CierrePage.tsx:73` admite RRHH, que es nivel 90: un
RRHH parado en la pantalla del bug recibiría 403.

### Cambio

**1. Backend — endpoint nuevo, no abrir el de admin.**

Se crea `GET /config/periodo` montado en `routes/index.ts` con solo `authMiddleware`, que devuelve
únicamente `{ periodoDiaInicio, periodoDiaFin }`. Se prefiere esto a sacar el `requireLevel` de
`admin.config.routes.ts:11` porque ese `GET` devuelve el objeto completo, incluidas
`tarifaViajeManeja` / `tarifaViajeSinManejar` (`schema.prisma:640-641`), y el router viene de una
auditoría de seguridad reciente. Superficie mínima, imposible filtrar tarifas por descuido.

**2. Front — hook compartido.**

`apps/web/src/hooks/usePeriodoConfig.ts`:

```ts
export function usePeriodoConfig() {
  const { data } = useQuery({
    queryKey: ['config', 'periodo'],
    queryFn: async () => (await api.get('/config/periodo')).data,
    staleTime: 5 * 60 * 1000,
  });
  return { diaInicio: data?.periodoDiaInicio ?? 21, diaFin: data?.periodoDiaFin ?? 20, listo: !!data };
}
```

En `PeriodSelector.tsx` se reemplazan las líneas 86 y 88 pasando los días **y las deps**: hoy son
`[]` y sin corregirlas los ciclos no se recalculan cuando llega la configuración. Los defaults
21/20 de las firmas quedan como último recurso.

**3. Front — estado inicial de las 5 pantallas.**

`useState(getCurrentPeriod())` es síncrono y corre antes de que llegue la config, así que el
título nacería en 21/20 y la primera query saldría con fechas viejas. Se pasa a `null` +
`useEffect` que lo setea cuando `listo`, con `enabled: !!periodo` en la query y un skeleton
mientras tanto. Aplica a:

- `pages/admin/CierrePage.tsx:71` (+ query en `:85`)
- `pages/aprobaciones/AprobacionesPage.tsx:165`
- `pages/analytics/AnalyticsPage.tsx:85`
- `pages/ausencias/AusenciasPage.tsx:99`
- `pages/vacaciones/VacacionesPage.tsx:218`

Se corrigen las 5 y no solo Cierre: comparten el mismo `getCurrentPeriod()` y arreglar una sola
las dejaría mostrando ventanas distintas entre sí.

**4. `ConfigPage` sin `onError`.** `ConfigPage.tsx:41-49` tiene solo `onSuccess`. Si el PUT falla
no hay toast ni mensaje y el formulario sigue mostrando lo tipeado: la pantalla se ve **idéntica**
haya persistido o no. Se agrega `onError` con toast.

**5. Guarda de desborde de mes.** `new Date(anio, mes, dia)` con `dia=31` desborda al mes
siguiente en meses de 30 días, tanto en `PeriodSelector.tsx:37-38` como en
`calculo.utils.ts:176-184`. El PUT acepta hasta 31 (`admin.config.routes.ts:16-17`). Ya está
reportado en `INFORME_SIMULACION_BUGS.md:513`. Con 16/15 no se dispara, pero se agrega el clamp
porque el cambio hace que ese código pase a depender de un valor configurable por el usuario.

### Riesgo

- `PeriodSelector.tsx:90-98` calcula `selectedIndex` comparando el `value` contra los ciclos por
  timestamp exacto; sin match cae a `cycles[0].label` (`:100-101`), o sea muestra una etiqueta que
  no corresponde al período consultado. Es otra razón para hacer el punto 3 completo.
- Las planillas guardadas con el ciclo 21→20 dejan de aparecer en las ventanas 16→15 (el filtro es
  de contención, `planillas.routes.ts:177-187`). **Sin impacto real**: el reset del frente E las
  borra a todas.

---

## C. WENTOP: la tarjeta creada no se puede abrir

**Capturas 8 y 9.** Dos bugs independientes. Ninguno es de autorización del backend.

### Causa raíz (a) — el crash

El modal de detalle usa el objeto del **listado**, no del detalle:

```
WentopPage.tsx:348-354   única query de tarjetas: api.get('/wentop', { params })
WentopPage.tsx:731       onClick={() => onSelect(t)}   ← item crudo del listado
WentopPage.tsx:453-456   setSelectedTarjeta(t)
WentopPage.tsx:470-472   <TarjetaDetailModal tarjeta={selectedTarjeta} />
WentopPage.tsx:1311      {tarjeta.fotos.length > 0 && (      ← revienta acá
```

Y el listado no incluye la relación: `tarjetaInclude` (`wentop.routes.ts:157-161`, usado por el
listado en `:412`) trae `_count: { select: { fotos: true } }` **sin** `fotos`. Por eso el contador
«1 foto» funciona y `tarjeta.fotos` es `undefined`.

`GET /wentop/:id` (`:426`) sí usa `tarjetaDetailInclude` (`:163-167`, con `fotos: true`) y está
bien autorizado, pero **el front nunca lo llama** — es código muerto.

Prueba cruzada de que el autor conocía el shape: la tarjeta del listado ya está escrita defensiva
en `WentopPage.tsx:786-790` (`t.fotos?.length ?? t._count?.fotos`). El modal quedó sin esa guarda.
Existe desde el commit `480f02e` y **revienta para cualquier usuario**, no solo el creador.

Mismo patrón sin guarda en el modal de edición: `:1660` (revienta en el render, al abrir «Editar»)
y `:2126`, `:2130`.

### Causa raíz (b) — los botones escondidos

El backend contempla al creador en **todo**, leído condición por condición:

| Operación | Ubicación | Regla |
|---|---|---|
| Ver (listado y detalle) | `wentop.routes.ts:150-153` | `OR: [sector, { creadorId: user.userId }]` |
| Cerrar / cambiar estado | `:601-607` | `isCreator \|\| canManage` |
| Editar | `:527-538` | `isCreator \|\| canManage` (+ bloquea CERRADA si nivel < 90) |
| Subir fotos | `:709-716` | `isCreator \|\| canManage` |
| Borrar foto | `:779-785` | `isCreator \|\| canManage` |
| Borrar tarjeta | `:658-664` | creador solo si ABIERTA |
| Ver las imágenes | `upload-access.utils.ts:132` | `dueno.creadorId === actor.userId` |

El front, en cambio, gatea todo con `canManage` a secas (`:1380`, `:1389`, `:1401`), y
`canManageCard` (`:324-335`) replica `canManageWentop` del backend, que **no** incluye al creador
(por eso cada ruta le suma `isCreator` aparte). `isCreator` solo se usa para `canDelete` (`:1166`).

### Cambio

**1. Guardas defensivas** en los 3 sitios: `:1311`, `:1317`, `:1660`, `:2126`, `:2130`.
Obligatorias — evitan el `ErrorBoundary` pase lo que pase.

**2. El detalle pide el detalle.** `TarjetaDetailModal` consume `GET /wentop/:id` con
`placeholderData: tarjeta` para que pinte instantáneo y se complete al llegar la respuesta. Se
prefiere esto a agregar `fotos: true` al `tarjetaInclude` del listado, que engordaría la respuesta
de hasta 500 tarjetas × 10 fotos — justo lo que el comentario de `wentop.routes.ts:28-30` quiso
evitar. El `invalidateQueries({ queryKey: ['wentop'] })` de las mutations (`:360`, `:374`, `:388`)
ya cubre la key nueva por prefijo.

Al renombrar `tarjeta` → `t` dentro del modal hay que reemplazar **todas** las referencias del
cuerpo (~`:1178` a `:1420`), no solo las de fotos, o quedan dos objetos mezclados. Menos frágil:
renombrar la prop entrante y dejar el cuerpo intacto.

**3. Habilitar al creador.**

```ts
const puedeGestionar = canManage || isCreator;
const puedeEditar = puedeGestionar && (tarjeta.estado !== 'CERRADA' || (rolNivel ?? 0) >= 90);
```

aplicado a `:1380` (En Progreso), `:1389` (Cerrar), `:1401` (Editar) y `:1325` (borrar foto).
`canDelete` (`:1166`) queda como está: ya coincide con `wentop.routes.ts:661`.

La segunda mitad de `puedeEditar` es necesaria: sin ella un admin **perdería** el botón Editar en
tarjetas cerradas, que hoy tiene y el backend le acepta (`:535` solo rechaza si `rolNivel < 90`).
`TarjetaDetailModal` no tiene el usuario en scope (props `:1143-1161`), hay que pasar `rolNivel`
como prop o importar el store adentro.

**4. Grieta latente en el mismo modal.** `calidad`, `medioambiente` y `seguridadSalud` son `Json?`
nullable (`schema.prisma:980-982`) pero el front los tipa `string[]` no-nulo (`:46-48`) y hace
`.length` sin guarda en `:1223`, `:1237`, `:1251`. Por la API nunca quedan NULL (`:490-492` usa
`?? []`), pero cualquier fila creada por seed o SQL directo reproduce el mismo error. Se guardan
en el mismo pase.

### Riesgo

El fix 3 amplía lo que el usuario **ve**, no lo que puede hacer: el backend ya aceptaba esas
operaciones. Cambia el comportamiento observado — un OPERADOR que hoy no ve «Cerrar» pasará a
verlo. Confirmado como intencional por el usuario.

---

## D. Errores de validación mudos

**Captura 3.** Bug confirmado; el verificador amplió el diagnóstico con dos caminos de error extra.

### Causa raíz

El backend **sí** manda el detalle. `usuarios.routes.ts:289-293` responde:

```json
{ "error": "Datos inválidos", "details": { "formErrors": [], "fieldErrors": { "password": ["Invalid", "Invalid"] } } }
```

Dos fallas encadenadas:

1. **El mensaje es inservible.** `usuarios.routes.ts:22` es
   `z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/)` **sin mensajes**. Ejecutado contra la zod
   instalada (3.25.76), `"abcdefgh"` devuelve literalmente `["Invalid", "Invalid"]`. Los otros
   campos salen en inglés: `email` → `"Invalid email"`, `sectorId` → `"Invalid uuid"`.
2. **El front lo descarta.** `UsuariosPage.tsx:442-448` castea a `{ response?: { data?: { error?: string } } }`
   — el tipo ni siquiera declara `details` — y solo lee `.error`. En pantalla queda «Datos
   inválidos» y nada más.

El interceptor de `services/api.ts:73-126` **no** pierde nada: rechaza con el `AxiosError` intacto.

El texto de ayuda del formulario («Mín. 8 caracteres, 1 mayúscula, 1 número») **coincide** con la
regla real: no hay reglas ocultas. `<form>` (`:468`) no tiene `noValidate`, y el input de password
(`:494`) tiene `required minLength={8}` pero **no** `pattern` — por eso `"abcdefgh"` pasa la
validación del navegador, viaja al servidor y vuelve como el error mudo. Ese es exactamente el
caso de la captura.

El patrón se repite en ~15 pantallas: `DiagramasPage:181`, `SectoresPage:143`, `RolesPage:149`,
`FlujosPage:263,384`, `AusenciasPage:489,688,831`, `VacacionesPage:453`, `ChangePasswordPage:68`,
`ResetPasswordPage:82`, `LoginPage:93`, `WentopPage:1754`, `App.tsx:51`.

### Cambio

**1. API — `z.setErrorMap()` global en castellano.**

En vez de editar a mano los 39 `parsed.error.flatten()` repartidos en 18 archivos de
`apps/api/src/routes`, se instala un error map global (se aplica en el arranque, `app.ts`) que
traduce de una sola vez los mensajes por defecto de zod: `Required`, `Invalid uuid`,
`Invalid email`, `String must contain at least N character(s)`, etc.

Un mapa global **no puede** adivinar qué significa una regex, así que esas quedan explícitas:

```ts
password: z.string()
  .min(8, 'Mínimo 8 caracteres')
  .max(72, 'Máximo 72 caracteres')          // bcrypt trunca en silencio a 72 bytes
  .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
  .regex(/[0-9]/, 'Debe contener al menos un número'),
```

`auth.routes.ts:79-84` y `:92-97` ya tienen exactamente estos mensajes: se copia el patrón que ya
existe. Se aplica a `createUsuarioSchema` (`:19-23`), `updateUsuarioSchema` (`:38-57`) y
`assignDiagramaSchema` (`:59-62`), que comparten el mismo modal.

Ningún test de `apps/api/tests` depende de los mensajes en inglés (grep sin hits sobre
`fieldErrors` / `String must contain`), así que traducirlos no rompe nada.

**2. Front — helper compartido.**

`mensajeDeError(err)` en `services/api.ts`, devuelve `{ mensaje, fieldErrors }` distinguiendo tres
casos que hoy se confunden:

- **sin respuesta del servidor** (`err.code === 'ERR_NETWORK'` / `!err.response`) → «Error de conexión»
- **respuesta con error** → arma el texto desde `details.fieldErrors` + `formErrors`, con un mapa
  de etiquetas (`sectorId` → «Sector», `diagramaColor` → «Color de diagrama») para no filtrar
  jerga de la API
- **excepción de JS del cliente** → mensaje propio, no «Error de conexión»

Se aplica a las ~15 pantallas listadas arriba.

**3. Modal de usuarios — error inline.**

Estado `fieldErrors`, borde rojo (`cn(inputClass, fieldErrors.x && 'border-destructive')`) y texto
bajo cada campo. Más `ref` en el cartel de error (`:470`) con `scrollIntoView` al fallar —
defensivo, para pantallas bajas donde el contenedor `max-h-[90vh] overflow-y-auto` (`:458`) sí
scrollea. Requiere agregar `useRef` al import de `:1`, que hoy solo trae `useState`.

**4. Dos bugs laterales del mismo `handleSubmit`.**

- `UsuariosPage.tsx:431-438` — el alta son **dos** requests. Si el `POST /usuarios` devuelve 201 y
  el `PATCH /usuarios/:id/diagrama` falla, el usuario **ya quedó creado**, `onSuccess()` (`:441`)
  nunca corre, el modal queda abierto y el reintento se come un 409 «Ya existe un usuario con ese
  email» (`usuarios.routes.ts:297`). Es el peor caso del síntoma reportado. Se envuelve el PATCH
  en su propio try/catch: se llama `onSuccess()` igual y se avisa «Usuario creado, pero no se pudo
  asignar el diagrama: …».
- `UsuariosPage.tsx:427` y `:436` — `new Date(diagramaFechaInicio + 'T00:00:00').toISOString()`
  tira `RangeError` con la fecha vacía, y el input (`:558-564`) no tiene `required`, solo
  `disabled={!diagramaId}`: se puede elegir diagrama y después borrar la fecha. Hoy se muestra
  como «Error de conexión», que es falso. Se valida antes de enviar.

### Riesgo

El punto 1 es la pieza que hace viable el alcance total: sin él, aplicar el helper compartido a
toda la app haría aparecer «Invalid uuid» / «Required» en 15 pantallas — un empeoramiento real.
El orden importa: **primero el error map, después el helper**.

---

## E. Reset completo de la base

**Captura 4.** El usuario va a iniciar tests desde cero; los datos previos son descartables.

### Estado actual

`diagramas` tiene 48 filas en 3 empresas, todas llamadas «WENLEN»:

- **32e126e4…** (la de `admin@wenlen.com`, 2 usuarios) → 30 diagramas: 9 reales del seed
  (`seed.ts:521-531`: Lun-Vier, 7×7, 10×5, 14×14, 8×6, 21×7, 2×1 (8×4), 14×7, 10×4) + **21 de
  prueba**: 19 `SIM3-Rotativo-<epoch>` (de `tests/simulation3.ts:274`, cuyo cleanup no llegó a
  correr) y 2 `sim-admin-config-1784854841872-*`.
- **bf79f36c…** y **bddb5a38…** → 9 diagramas cada una, 0 usuarios. Creadas **hoy** por reruns del
  seed. Invisibles en la UI porque todo filtra por `empresaId`.

Los 21 de prueba tienen **0** filas en `usuarios_diagramas` y **0** en
`solicitudes_cambio_diagrama` (consultado fila por fila). El único diagrama con asignación activa
es «Lun-Vier» del seed, del admin.

Aparecen en el selector porque `GET /analytics/diagramas` (`analytics.routes.ts:139-142`) devuelve
`{ empresaId, activo: true }` y `UsuariosPage.tsx:548` vuelve a filtrar por `activo`: 29 opciones
= 9 reales + 20 de prueba (el `-rot2` está inactivo).

Nadie los limpió porque `reset-testing.ts:27` define
`PREFIJOS_DE_PRUEBA = ['qa-', 'Verif', 'verif-', 'hunt-', 'smoke-']` — **sin** `sim`.

### Cambio

**1. `pg_dump` de la base completa** antes de cualquier cosa.

**2. Un solo carácter de configuración:**

```ts
// reset-testing.ts:27
const PREFIJOS_DE_PRUEBA = ['qa-', 'Verif', 'verif-', 'hunt-', 'smoke-', 'sim-', 'sim3-'];
```

La comparación de `:30` es case-insensitive, así que `'sim3-'` cubre `SIM3-`. Verificado que el
regex no puede matchear ninguno de los 9 nombres reales.

**3. `npx tsx prisma/reset-testing.ts --dry-run`**, revisar la salida, y recién después sin el flag.

El script ya hace todo lo necesario, verificado leyéndolo entero:

- borra todo lo transaccional (`:62-91`) y todos los usuarios menos el admin (`:95-107`)
- borra los diagramas de prueba por prefijo (`:129-132`), después de haber borrado las
  asignaciones (`:95-97`), que es lo que evita el `RESTRICT` de la FK
- borra las 2 empresas huérfanas con sus diagramas, sectores, roles y config (`:141-158`)
- **conserva** el `empresaConfig` del admin (`:155` filtra por `id: { not: empresaId }`), o sea
  los 16/15 sobreviven al reset
- aborta si no encuentra al admin (`:41-43`), para no dejar la base sin acceso

**4. Guarda defensiva (opcional, barata):** `:129-132` haría `P2003` si el **admin** tuviera
asignado un diagrama de prueba, porque `:96` excluye sus asignaciones. Hoy no pasa (tiene
«Lun-Vier»), pero un pre-chequeo de `_count` evita un fallo total del `deleteMany`, que es
todo-o-nada.

**Fix aparte, independiente:** `admin.diagramas.routes.ts:121-161` no consulta
`solicitudes_cambio_diagrama` antes del borrado físico, así que un diagrama referenciado por una
solicitud devuelve un 500 opaco en vez de un 409. Y `DiagramasPage.tsx:38-41` no tiene `onError`,
así que ese 409 no se ve. Se corrigen los dos.

### Riesgo

- **Es destructivo e irreversible sin el dump.** Borra el usuario `nvazquez@wenlen.com`, la tarjeta
  WENTOP creada y todo lo transaccional. Confirmado por el usuario.
- Después del reset **no hay tarjeta WENTOP** para verificar el frente C: hay que crear una nueva.
- Colisión de caché: `UsuariosPage.tsx:94` y `DiagramasPage.tsx:34` comparten la queryKey
  `['diagramas']` con `queryFn` y shapes distintos. Conviene refrescar la página antes de contar.

---

## F. UI desprolija en Cierre de Período

**Captura 6.** Tailwind v4 vía `@tailwindcss/vite`; no hay `tailwind.config.*`, la config vive en
`index.css:1-119`. No hay componente `<Select>` compartido: cada página lo escribe a mano.

### Causa raíz

Tres defectos acumulados en `CierrePage.tsx:356-391`:

1. **`:356`** — `<div className="flex items-center justify-between">` sin `flex-col sm:flex-row`,
   sin `flex-wrap`, sin `gap`. Fuerza al `<h2>` y a los controles a la misma línea a cualquier
   ancho; el `<h2>` no tiene `min-w-0`, así que su piso es su ancho de min-content («aprobación») y
   parte en dos líneas. Eso es el «se apila raro».
2. **`:361`, `:381`** — el desborde no es `position: absolute` ni un ancho fijo: es el
   `min-width: auto` de flex item. Un `<select>` se dimensiona al `<option>` más ancho y como flex
   item **no puede encogerse por debajo de eso**. Botón (~130px) + icono (16px) + gaps (16px) +
   select (~180-200px) ≈ 360px contra ~288px disponibles en un viewport de 360px. Ni la card ni el
   `<main>` (`AppShell.tsx:372`) tienen `overflow-hidden`, así que sangra hasta el borde de la
   pantalla.
3. **`:401-402`** — la tabla tiene `overflow-x-auto` pero es **inútil**: la `<table>` es `w-full`,
   o sea se ajusta al contenedor y nunca lo excede, así que el scroll jamás se activa. En vez de
   scrollear, las 4 columnas se comprimen y el texto envuelve.

**Confirmación estructural:** `AprobacionesPage.tsx:296` tiene el select con la cadena de clases
**idéntica** y no se desborda, porque ahí los filtros viven en su propia línea con `flex flex-wrap`
(`:289`), separados del título.

### Cambio

Todo con patrones que el proyecto ya usa; no se introduce ninguno nuevo.

| Línea | Antes | Después | Patrón de referencia |
|---|---|---|---|
| 356 | `flex items-center justify-between` | `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3` | `PlanillasPage.tsx:238`, `CierrePage.tsx:229` |
| 361 | `flex items-center gap-2` | `flex flex-wrap items-center gap-2` | `AprobacionesPage.tsx:289` |
| 375 | — | `+ shrink-0 … whitespace-nowrap` | `AprobacionesPage.tsx:601` |
| 379-389 | `<Filter/>` suelto + select | agrupados en `flex w-full items-center gap-2 sm:w-auto`, select con `w-full min-w-0 sm:w-auto sm:min-w-[180px]` | `WentopPage.tsx:611-624`, `VacacionSaldosPage.tsx:206` |
| 401-402 | `overflow-x-auto` / `w-full` | `+ -mx-5 px-5 sm:mx-0 sm:px-0` / `w-full min-w-[520px]` | `CalendarioCompacto.tsx:81-82` |

`min-w-0` es la clave del desborde: anula el `min-width: auto` que hoy impide encoger el select.
Además `whitespace-nowrap` en el `<th>`/`<td>` de «Estado planilla» (`:408`, `:417`).

Se aplica lo mismo a la pestaña **Aprobadas** del mismo archivo (`:461`, `:511`), que tiene el bug
idéntico.

**Fuera de alcance:** las tablas de `VacacionSaldosPage.tsx:228` (12 columnas) y
`WentopPage.tsx:1086` tienen el mismo bug latente. Otro pedido.

---

## G. Mostrar qué habilita cada nivel de rol

**Captura 7.** Pedido de UI. El input «Nivel (0-99)» (`RolesPage.tsx:202-207`) solo manda un entero;
el único texto es «Mayor = más permisos» (`:206`) y el default es 50 (`:127`).

### Hallazgo central

Los permisos dependen de **dos mecanismos distintos**, y la separación es limpia y enumerable:

- **El acceso a pantallas y endpoints es 100% por nivel numérico** (`requireLevel` + comparaciones
  inline). Esto **sí** se puede tabular con honestidad.
- **Aprobar documentos, WENTOP cross-sector y a quién se notifica dependen del *código* literal
  del rol.** `approval-auth.utils.ts:41-67` compara contra `'ADMIN'`, `'SUPERVISOR'`,
  `'COORDINADOR'`, `'GERENTE'`, `'RRHH'` — y su parámetro `_approverNivel` (`:15`) está
  deliberadamente sin usar. **Un rol nuevo con nivel 95 pasa todos los `requireLevel` y no puede
  aprobar nada.**

Fuente de verdad de los niveles: `roles.middleware.ts:5-11` → ADMIN=100, RRHH=90, GERENTE=80,
CMASS=75, COORDINADOR=70, SUPERVISOR=60, OPERADOR=10. El gate genérico está en `:22`.

**Techo del formulario:** el backend valida `0..99` (`admin.roles.routes.ts:35`, `:78`) y el input
también. Un rol nuevo **nunca** alcanza 100, o sea nunca accede a Sectores, Diagramas, Flujos,
Roles, Configuración, backups, reabrir planilla, borrar usuario ni cambiar de sector.

**El nivel se lee al iniciar sesión** (`auth.routes.ts:169-173`, `app.ts:211-219`) y viaja en el
JWT: cambiarlo no afecta sesiones vivas.

### Cambio

**1. Bloque explicativo** bajo el campo Nivel, en Nuevo **y** Editar rol. Acordeón `<details>`
colapsado por defecto para no romper el `max-w-md` del modal (`:162`), con el escalón
correspondiente a `form.nivel` resaltado en vivo. Lista **acciones**, no pantallas:

| Escalón | Qué habilita |
|---|---|
| **0-59** (OPERADOR=10) | Solo lo propio: sus planillas, ausencias, vacaciones, mensajes, capacitaciones, WENTOP. Bandeja de Aprobaciones vacía (`aprobaciones.routes.ts:27`). |
| **60-69** (SUPERVISOR) | Aprobar/rechazar planillas, ausencias, vacaciones y cambios de diagrama; cargar ausencias por otro; marcar compensatorios y validar marcas; analytics de su sector. Alcance: subordinados directos. |
| **70-74** (COORDINADOR) | Lo anterior + alcance a **todo su sector** (`user-scope.utils.ts:26`); analytics por sector y diagramas; capacitaciones y sesiones; gestionar tarjetas WENTOP de su sector. |
| **75-79** | Nada nuevo salvo `GET /wentop/gestores` (`wentop.routes.ts:286`). El poder de CMASS es por código, no por el 75. |
| **80-89** (GERENTE) | Idéntico a 70-74 en gates numéricos. GERENTE solo se distingue por su **código** en los pasos de flujo y en las notificaciones. |
| **90-99** (RRHH) | Salto grande: ve y gestiona **toda la empresa**; ABM de usuarios y reset de contraseña; cerrar planillas; exportaciones y liquidación; saldos, auditoría, alertas, feriados; mensajes masivos; puede avanzar pasos aunque no haya flujo configurado. |
| **100** (ADMIN) | **No alcanzable desde este formulario.** Sectores, Diagramas, Flujos, Roles, Configuración, backups, reabrir planilla, borrar usuario, cambiar de sector. Se muestra en gris con la aclaración. |

**2. Aviso fijo «el nivel no alcanza para»:** aprobar depende del código del rol y de figurar como
aprobador en un paso de flujo; ver todas las tarjetas WENTOP es exclusivo del código `CMASS` o de
nivel 90+; el nivel se lee al iniciar sesión.

**3. Arreglar el selector de rol aprobador.** `FlujosPage.tsx:50-57` tiene un `ROL_LABELS` fijo de
6 códigos y el `<select>` de `rolAprobador` se arma con él (`:123`). El backend acepta cualquier
string (`admin.flujos.routes.ts:19`, `z.string().min(1)`). Pasa a leer `/admin/roles`, que ya
existe y está gateado en nivel 90 (`admin.roles.routes.ts:13`). Sin esto, crear un rol es una
función a medias: se puede crear pero nunca podrá aprobar nada.

**4. Deshabilitar el input de nivel para roles de sistema.** `admin.roles.routes.ts:97-106` rechaza
cambiar el nivel o desactivar un rol de sistema, pero el modal muestra el campo editable → 403 al
guardar.

No requiere ningún cambio de backend salvo el punto 3, que solo consume un endpoint existente.

### Observaciones

- `EquipoPage.tsx:60` compara contra **50**, un umbral huérfano: ningún rol del sistema lo tiene y
  es el único uso de 50 en todo el backend. Coincide con el default del formulario. No se toca,
  pero se documenta.
- El front **no** tiene guard por nivel en las rutas (`App.tsx:139-168`, solo `PrivateRoute`):
  escribiendo la URL se entra a cualquier pantalla y el bloqueo real lo pone el 403 del backend.
  El menú sí filtra (`AppShell.tsx:198-209`).

---

## Orden de ejecución

El orden importa en dos puntos: el error map va **antes** del helper de errores (D), y el reset va
**antes** de verificar cualquier cosa que dependa de datos (E).

1. **E — Reset** (`pg_dump` → prefijos → `--dry-run` → reset). Deja la base limpia para verificar
   todo lo demás.
2. **B — Períodos.** Es el bug de fondo y toca 5 pantallas.
3. **C — WENTOP.** Requiere crear una tarjeta nueva post-reset para verificar.
4. **D — Errores** (error map global → helper → 15 pantallas → modal de usuarios).
5. **F — UI de Cierre.** Independiente.
6. **G — Permisos por nivel** + selector de Flujos.
7. **A — Emojis.** Último a propósito: toca 11 archivos de forma superficial y generaría
   conflictos con todos los frentes anteriores si va primero.

Commits agrupados por frente, en ese orden, sobre `anvil/ui-improvements`.

## Verificación

Cada frente se verifica en la app real, no solo con tests:

- **B** — Configuración en 16/15 → Cierre muestra «16 Jul - 15 Ago 2026» en título y desplegable.
  Repetir en Aprobaciones, Analytics, Ausencias y Vacaciones. Probar con un usuario **RRHH**, que
  es el caso que hoy daría 403.
- **C** — Crear tarjeta como OPERADOR con una foto → abrirla (no debe reventar, debe mostrar la
  foto) → ver los botones Cerrar y Editar → cerrarla.
- **D** — Crear usuario con `"abcdefgh"` → el cartel debe decir qué falta, en castellano, y el
  campo debe quedar marcado. Probar también el camino del diagrama fallido.
- **E** — `--dry-run` primero; contar filas de `diagramas` antes y después (48 → 9).
- **F** — En 360px de ancho: el filtro no debe sangrar fuera de la card; la tabla debe scrollear.
- **G** — Abrir Nuevo rol, mover el nivel y ver el escalón resaltado; crear un rol y comprobar que
  aparece en el selector de aprobador de Flujos.

## Fuera de alcance (anotado, no se hace)

- **Migrar las fechas de planillas históricas** al ciclo 16/15. Sin sentido tras el reset.
- **Hacer idempotente el seed.** `seed.ts:469` hace `prisma.empresa.create` incondicional, sin
  upsert ni deleteMany previo: **cada `npm run db:seed` futuro crea otra empresa «WENLEN» con 9
  sectores y 9 diagramas duplicados**. Es el origen de las 2 empresas huérfanas. Volverá a pasar.
- Las tablas de `VacacionSaldosPage.tsx:228` y `WentopPage.tsx:1086`, con el mismo bug de
  `overflow-x-auto` inútil que el frente F.
- Selección múltiple + «Eliminar seleccionados» en `/admin/diagramas`.
