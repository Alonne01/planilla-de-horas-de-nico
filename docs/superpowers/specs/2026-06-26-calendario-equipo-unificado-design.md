# Calendario de Equipo unificado — Diseño

**Fecha:** 2026-06-26
**Estado:** Aprobado (pendiente revisión final del spec)

## Problema

Hoy existen dos páginas separadas que muestran la misma información (ausencias,
vacaciones, francos y capacitaciones del equipo a lo largo del año) sobre el
mismo endpoint `/vacaciones/gantt`:

- **Calendario Vac.** (`VacacionesGanttPage`, ruta `/vacaciones/gantt`): Gantt
  full-width con barras continuas a lo largo del año. Vista "de un vistazo".
  Pinta sólido sin distinguir estado de aprobación.
- **Disponibilidad** (`DisponibilidadPage`, ruta `/disponibilidad`): grilla
  mes×día con precisión diaria, filtros de categoría, turnos, detección de
  solapes y tinte de francos. Vista de planificación detallada. Ya distingue
  aprobada (relleno) de en revisión (rayado) vía `.av-seg[data-estado]`.

Son redundantes como ítems de menú separados. Se unifican en **una sola
funcionalidad con dos modos de operación**: Compacto (la vista actual de
Calendario Vac.) y Detallado (la vista actual de Disponibilidad).

## Decisiones tomadas

1. **Categorías unificadas a 5 en ambos modos:** `Vacación` (teal) ·
   `Ausencia / Licencia` (rojo) · `Franco comp.` (violeta) · `Capacitación`
   (azul) · `Descanso` (gris, solo modo detallado). Misma leyenda y mismos
   tokens `text-cal-*` en los dos modos.
   - **Resolución a la pérdida de granularidad:** con 5 categorías, los tipos
     `AUSENCIA_CERTIFICADO_MEDICO`, `AUSENCIA_FALTA_JUSTIFICADA`, etc., comparten
     el mismo color rojo (categoría `Ausencia / Licencia`). Para no perder el
     detalle, el **color** se determina por categoría (5), pero el **tooltip /
     hover** muestra el **tipo exacto** ("Cert. médico", "Falta just.", "Acc.
     trabajo", …). Esto aplica a ambos modos.
2. **Modo inicial:** arranca en **Compacto**; la última elección del usuario se
   persiste en `localStorage`.
3. **Estado: relleno vs rayado en AMBOS modos:**
   - `APROBADA` → relleno sólido.
   - `EN_REVISION` / `PENDIENTE` → rayado 45° + borde punteado.
   - El detallado ya lo hace; el compacto lo incorpora (es lo nuevo pedido).
4. **Nombre del menú:** un único ítem **"Calendario de Equipo"** → ruta
   `/calendario` (reemplaza los dos ítems actuales).
5. **Filtros por modo:**
   - **Compacto (minimalista):** sólo **sector** (RRHH) + **año** + toggle de
     modo + leyenda. Sin búsqueda/turno/chips. **Sí marca solapes** y permite el
     filtrado por click (ver decisión 7).
   - **Detallado:** conserva todo lo actual de Disponibilidad (búsqueda, sector,
     turno, chips de categorías, tinte de francos) + marcado de solapes.
7. **Solapes marcados en AMBOS modos + filtrado por click:**
   - **Marcado:** las barras/tramos cuyos días coinciden con la ausencia de ≥1
     compañero (pico ≥ 2 sobre categorías "countables": Vacación, Ausencia,
     Franco comp.) se marcan con contorno rosa. Hoy sólo el detallado lo hace; el
     compacto lo incorpora.
   - **Filtrado por click:** al tocar un día/barra **marcado como solape**, la
     lista se filtra para mostrar **sólo** al empleado clickeado + los empleados
     cuya ausencia se solapa con ese bloque. Un banner indica el contexto y
     ofrece "Mostrar todos". Aplica a ambos modos.
   - **Reemplaza** el panel lateral de detalle del detallado (el filtro cumple la
     misma función "ver con quién se solapa", pero en la grilla). El popover de
     hover se conserva.
6. **Acceso: dinámico por cadena de aprobación del sector** (reemplaza el gate
   plano `nivel >= 70`). Ver sección dedicada más abajo. En resumen: un usuario
   accede al calendario de su sector si su nivel es `>=` el nivel del aprobador
   más bajo de la cadena de aprobación de ese sector. RRHH/ADMIN (>= 90) acceden
   siempre y ven todos los sectores.

## Acceso por cadena de aprobación

En vez de un nivel fijo (`>= 70`), el acceso al calendario depende de la **cadena
de aprobación del sector** del usuario. Motivación: un supervisor que es el
primer eslabón de la cadena de su sector necesita ver la disponibilidad del
equipo para planificar/aprobar, pero hoy (nivel 60) está bloqueado del todo.

### Regla (por usuario)

```
acceso(usuario):
  if usuario.nivel >= 90:            # RRHH / ADMIN
      return true                    # y ven todos los sectores
  if !usuario.sectorId:
      return false                   # sub-RRHH sin sector → sin acceso
  flujos = FlujoAprobacion activos asignados al sector del usuario
           (FlujoAsignacion.sectorId == sectorId && activo), TODOS los
           tipoDocumento  (decisión: "todos los flujos del sector")
  niveles = [ Rol.nivel[paso.rolAprobador]
              for flujo in flujos for paso in flujo.pasos ]
  minNivel = min(niveles) if niveles else 70   # fallback al gate actual
  return usuario.nivel >= minNivel
```

- **Umbral "hacia arriba", no match exacto de rol.** Un GERENTE (80) accede aunque
  GERENTE no sea literalmente un paso de la cadena (evita regresionar el acceso
  que ya tienen gerentes/coordinadores hoy).
- `rolAprobador` guarda un **código** de rol → el nivel se resuelve uniendo con la
  tabla `Rol` (`codigo` → `nivel`). Sirve también para roles personalizados.
- Sin flujo asignado al sector → `minNivel = 70` (comportamiento actual).
- **Scope de datos sin cambios:** sub-RRHH sigue viendo **solo su propio sector**
  (incluido el supervisor, que ve **todo el sector**, igual que hoy el
  coordinador). RRHH/ADMIN ven todo.

### Helper compartido (backend)

Un único helper, p. ej. `apps/api/src/utils/calendario-access.utils.ts`:

```
nivelMinimoAccesoSector(empresaId, sectorId): Promise<number>
// min nivel de aprobador entre los flujos del sector; 70 si no hay flujos.

puedeVerCalendario(usuario): Promise<boolean>
// aplica la regla de arriba (usa nivelMinimoAccesoSector).
```

Lo consumen **dos** lugares (única fuente de verdad):
1. **Enforcement:** `GET /vacaciones/gantt` reemplaza `if (userNivel < 70)` por
   `if (!await puedeVerCalendario(req.user)) → 403`.
2. **Flag de UI:** el payload de usuario de `POST /auth/login` y `GET /auth/me`
   incluye `puedeVerCalendario: boolean` (computado con el mismo helper).

### Frontend — menú por flag

- `authStore` / interfaz `User`: agregar `puedeVerCalendario?: boolean`.
- `AppShell` `NavItem`: nuevo predicado `requireCalendarAccess?: boolean`
  (análogo al `requireApprover` existente). El ítem "Calendario de Equipo" se
  muestra si `user.puedeVerCalendario === true`. **No** usa `minLevel`.
- Gate in-component de la página: si `puedeVerCalendario` es false, mostrar el
  cartel "sin permisos" (y de todas formas el backend responde 403).

## Arquitectura

Una página orquestadora que es dueña de los datos y del estado de modo, más dos
subcomponentes de presentación. Se descartó:
- Un mega-componente con `if` inline (el detallado ya ronda las 700 líneas →
  inmanejable).
- Dos rutas con cross-links (no unifica realmente; sigue siendo dos vistas).

```
CalendarioEquipoPage                      ← 1 sola query a
 │                                          /vacaciones/gantt?anio&todos=1[&sectorId]
 ├─ estado: anio, sectorId, modo (persistido en localStorage), overlap (filtro)
 ├─ módulo compartido (tipos + helpers):
 │     catOf(), CAT (colores), CAT_LABEL, ESTADO_BADGE, TIPO_LABEL (tooltip),
 │     query de datos
 ├─ toggle Compacto / Detallado
 ├─ <CalendarioCompacto data … />          ← refactor de VacacionesGanttPage
 └─ <CalendarioDetallado data … />         ← refactor de DisponibilidadPage
```

**Una sola query sirve a los dos modos.** Cambiar de modo **no** refetchea. El
detallado consume el campo `diagrama` del payload; el compacto lo ignora. La
query siempre pasa `todos=1` (necesario para traer todos los empleados +
diagramas que el detallado requiere).

### Módulo compartido

Extraer a `apps/web/src/components/calendario/shared.ts` (junto a los dos
subcomponentes):

- Interfaces `Sector`, `Bloque`, `Empleado`, `GanttData`, `EmpDiagrama`.
- `type Cat` y mapas `CAT` (colores `text-cal-*`), `CAT_LABEL`, `ESTADO_BADGE`,
  `COUNTABLE`, `CAT_ORDER`.
- `catOf(tipo)`: mapea el tipo granular a una de las 5 categorías.
- `TIPO_LABEL`: mapa de tipo granular → etiqueta legible para el tooltip
  (reusar las labels actuales de `VacacionesGanttPage.TIPO_LABELS`).
- Helpers de fecha (`ymd`, `daysInMonth`, `fmtDate`, `norm`).
- La definición/uso de la query (`queryKey`, `queryFn`).
- Helpers de solape: `monthOffsets`, `blockDoyRange`, `computeOverlapPeaks`
  (pico por bloque countable) y `overlappingEmployeeIds` (quiénes se solapan con
  un bloque dado). Los usan el compacto (marcado) y el orquestador (filtro).

### CSS: estado compartido (relleno / rayado)

Las reglas que hoy viven en `.av-seg[data-estado]` (`index.css` ~líneas
498–517) se generalizan a una clase de estado reutilizable (p. ej.
`.cal-estado`) que apliquen **tanto** las barras del compacto **como** los
tramos `.av-seg` del detallado. Patrón:

- `::before` → relleno sólido `currentColor` opacidad ~0.8 (aprobada).
- `[data-estado="EN_REVISION"|"PENDIENTE"]` → `::before` baja opacidad +
  `::after` con `repeating-linear-gradient(45deg, …)` y borde punteado.

El color sigue tomándose de la clase `text-cal-*` vía `currentColor`, así que
una sola regla sirve a las 5 categorías y a los 6 temas sin hex hardcodeado.

Además, `.cal-estado[data-overlap="1"|"2"]` agrega el contorno rosa de solape
(mismo patrón que `.av-seg[data-overlap]`), para el marcado en el modo compacto.

**Decisión de implementación:** en vez de migrar `.av-seg` a `.cal-estado` (la
grilla detallada funciona y tiene su propio set), se agrega `.cal-estado` como
clase nueva para las barras del compacto. Pequeña duplicación deliberada para no
regresionar el detallado.

## Modo Compacto (`CalendarioCompacto`)

Refactor de `VacacionesGanttPage`:
- **Colores:** cambiar de `TIPO_COLORS` (granular, `bg-*`) al esquema de 5
  categorías (`CAT`, `text-cal-*` + `currentColor`), vía `catOf()`.
- **Estado:** las barras adoptan la clase de estado compartida → relleno sólido
  (aprobada) / rayado (en revisión / pendiente). **Nuevo.**
- **Tooltip:** muestra el **tipo exacto** (`TIPO_LABEL[bloque.tipo]`) además de
  la categoría y el estado.
- **Toolbar:** sector (solo RRHH) + año + el toggle de modo + leyenda
  (`▓ aprobada · ▨ en revisión` + colores de categorías presentes + "▢ solape").
- **Solapes (nuevo):** marca con contorno rosa las barras con pico ≥ 2
  (`computeOverlapPeaks`). Click en una barra marcada → dispara el filtro de
  solape (ver sección dedicada).
- Conserva: tooltip al hover, marcador de "hoy", footer de resumen.

## Modo Detallado (`CalendarioDetallado`)

Refactor de `DisponibilidadPage`, cambios:
- Consumir el módulo compartido (tipos, `catOf`, colores, labels).
- Tooltip/hover muestra el tipo exacto además de la categoría (ya muestra
  categoría + estado; se agrega `TIPO_LABEL`).
- Adopta la clase de estado compartida en lugar de las reglas locales de
  `.av-seg` (mismo resultado visual).
- **Click en solape → filtro** (reemplaza el panel lateral de detalle): clic en
  un tramo marcado como solape dispara el filtro del orquestador; se elimina el
  `openDetail`/panel/`DetailState`. El popover de hover se conserva (incluida la
  advertencia "⚠ N compañero(s) afuera").

Conserva: búsqueda, filtro de sector y turno, chips de categorías (ojos),
marcado de solapes, tinte de francos, marcador de "hoy".

## Solapes y filtrado por click (ambos modos)

Comportamiento compartido, orquestado desde `CalendarioEquipoPage`:

- **Estado del filtro** (en el orquestador): `overlap: { block, empId, empName } | null`.
- Cada subcomponente recibe un callback `onOverlapSelect(block, empId, empName)`
  que sólo se dispara al clickear un bloque **marcado como solape**.
- Al setearse, el orquestador calcula
  `ids = overlappingEmployeeIds(empleadosOriginales, block, empId, anio)` y pasa
  al subcomponente activo un `data` filtrado a `{ empId } ∪ ids` (el clickeado +
  los que se solapan). Un **banner** muestra "Mostrando a *empName* y *N* que se
  solapan (*fechas*)" + botón "Mostrar todos".
- El filtro se limpia al cambiar de **año** o **sector** (el bloque deja de ser
  válido) y con "Mostrar todos". Cambiar de **modo** lo conserva (es a nivel de
  datos).
- Definición de solape: pico ≥ 2 sobre categorías *countables* (`Vacación`,
  `Ausencia`, `Franco comp.`), independiente de los chips de visibilidad.

## Navegación y rutas

- **`AppShell.tsx`:** reemplazar los dos ítems (`Calendario Vac.` →
  `/vacaciones/gantt` y `Disponibilidad` → `/disponibilidad`) por **uno**:
  `{ label: 'Calendario de Equipo', path: '/calendario', icon: CalendarRange, requireCalendarAccess: true }`
  (sin `minLevel`; se muestra según el flag `user.puedeVerCalendario`).
- **`App.tsx`:**
  - Nueva ruta `/calendario` → `CalendarioEquipoPage`.
  - `/vacaciones/gantt` → `<Navigate to="/calendario" replace />`.
  - `/disponibilidad` → `<Navigate to="/calendario" replace />`.
- **Gate in-component:** según `user.puedeVerCalendario` (cartel "sin permisos"
  si es false); el backend además responde 403.

## Archivos afectados

| Archivo | Acción |
|---|---|
| `apps/web/src/pages/CalendarioEquipoPage.tsx` | **Nuevo** — orquestador + toggle + query |
| `apps/web/src/components/calendario/CalendarioCompacto.tsx` | **Nuevo** — refactor de `VacacionesGanttPage` |
| `apps/web/src/components/calendario/CalendarioDetallado.tsx` | **Nuevo** — refactor de `DisponibilidadPage` |
| `apps/web/src/components/calendario/shared.ts` | **Nuevo** — tipos + helpers + query compartidos |
| `apps/web/src/pages/VacacionesGanttPage.tsx` | **Eliminar** (su lógica migra al compacto) |
| `apps/web/src/pages/DisponibilidadPage.tsx` | **Eliminar** (su lógica migra al detallado) |
| `apps/web/src/App.tsx` | Ruta nueva + 2 redirects |
| `apps/web/src/components/layout/AppShell.tsx` | Nav: 2 ítems → 1; predicado `requireCalendarAccess` |
| `apps/web/src/index.css` | Generalizar reglas de estado de `.av-seg` a clase compartida |
| `apps/api/src/utils/calendario-access.utils.ts` | **Nuevo** — helper `nivelMinimoAccesoSector` + `puedeVerCalendario` |
| `apps/api/src/routes/vacaciones.routes.ts` | Gate `/gantt`: usar `puedeVerCalendario` en vez de `< 70` |
| `apps/api/src/routes/auth.routes.ts` | Agregar `puedeVerCalendario` al payload de `login` y `/me` |
| `apps/web/src/stores/authStore.ts` (interfaz `User`) | Agregar `puedeVerCalendario?: boolean` |

## Persistencia del modo

`localStorage` con clave dedicada (p. ej. `calendario-equipo-modo`), valores
`'compacto' | 'detallado'`. Default `'compacto'` si no hay valor guardado. Se
lee al montar y se escribe en cada cambio de toggle.

## Testing / verificación

- Verificación manual en navegador (no hay tests de UI en el repo):
  - Toggle alterna modos sin refetch (una sola request en Network).
  - Compacto: barras aprobadas sólidas, en revisión rayadas; tooltip con tipo
    exacto; leyenda correcta; **barras solapadas con contorno rosa**.
  - Detallado: paridad funcional con la Disponibilidad actual (búsqueda, turno,
    francos), con el marcado de solapes.
  - **Solape (ambos modos):** click en una barra/tramo marcado → la lista queda
    sólo con el empleado clickeado + los que se solapan; aparece el banner; click
    en una barra NO solapada no filtra; "Mostrar todos" restaura.
  - `/vacaciones/gantt` y `/disponibilidad` redirigen a `/calendario`.
  - Acceso por cadena:
    - Supervisor de un sector con paso de SUPERVISOR en la cadena → **accede**
      a su sector (ítem visible, sin 403).
    - Supervisor de un sector cuya cadena arranca en COORDINADOR → **no** accede
      (ítem oculto, `/gantt` responde 403).
    - Coordinador/Gerente → acceden a su sector (sin regresión).
    - RRHH/ADMIN → acceden y ven todos los sectores.
  - El modo elegido persiste tras recargar.
- `typecheck` de front y API limpios.

## Fuera de alcance (YAGNI)

- Cambios en el endpoint `/vacaciones/gantt` (sirve a ambos modos tal cual).
- Responsive/mobile específico más allá del overflow horizontal ya existente.
- Exportación, impresión o nuevos filtros no presentes hoy.
