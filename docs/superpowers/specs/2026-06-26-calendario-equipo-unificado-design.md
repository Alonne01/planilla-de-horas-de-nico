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
     modo + leyenda. Sin búsqueda/turno/solapes.
   - **Detallado:** conserva todo lo actual de Disponibilidad (búsqueda, sector,
     turno, chips de categorías, solapes + panel de detalle, tinte de francos).
6. **Acceso:** `nivel >= 70` ("coordinación para arriba"): COORDINADOR (70),
   CMASS (75), GERENTE (80), RRHH (90), ADMIN (100). Quedan afuera SUPERVISOR
   (60) y OPERADOR (10). Es el mismo gate que tienen ambas páginas hoy
   (`minLevel: 70` en el nav + `nivel >= 70` in-component), por lo que **no hay
   cambio de comportamiento de acceso**.

## Arquitectura

Una página orquestadora que es dueña de los datos y del estado de modo, más dos
subcomponentes de presentación. Se descartó:
- Un mega-componente con `if` inline (el detallado ya ronda las 700 líneas →
  inmanejable).
- Dos rutas con cross-links (no unifica realmente; sigue siendo dos vistas).

```
CalendarioEquipoPage                      ← 1 sola query a
 │                                          /vacaciones/gantt?anio&todos=1[&sectorId]
 ├─ estado: anio, sectorId, modo (persistido en localStorage)
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

## Modo Compacto (`CalendarioCompacto`)

Refactor de `VacacionesGanttPage`:
- **Colores:** cambiar de `TIPO_COLORS` (granular, `bg-*`) al esquema de 5
  categorías (`CAT`, `text-cal-*` + `currentColor`), vía `catOf()`.
- **Estado:** las barras adoptan la clase de estado compartida → relleno sólido
  (aprobada) / rayado (en revisión / pendiente). **Nuevo.**
- **Tooltip:** muestra el **tipo exacto** (`TIPO_LABEL[bloque.tipo]`) además de
  la categoría y el estado.
- **Toolbar:** sector (solo RRHH) + año + el toggle de modo + leyenda
  (`▓ aprobada · ▨ en revisión` + colores de categorías presentes).
- Conserva: tooltip al hover, marcador de "hoy", footer de resumen.

## Modo Detallado (`CalendarioDetallado`)

Refactor de `DisponibilidadPage`, **sin cambios funcionales** salvo:
- Consumir el módulo compartido (tipos, `catOf`, colores, labels).
- Tooltip/hover muestra el tipo exacto además de la categoría (ya muestra
  categoría + estado; se agrega `TIPO_LABEL`).
- Adopta la clase de estado compartida en lugar de las reglas locales de
  `.av-seg` (mismo resultado visual).

Conserva: búsqueda, filtro de sector y turno, chips de categorías (ojos),
detección de solapes + panel de detalle, tinte de francos, marcador de "hoy".

## Navegación y rutas

- **`AppShell.tsx`:** reemplazar los dos ítems (`Calendario Vac.` →
  `/vacaciones/gantt` y `Disponibilidad` → `/disponibilidad`) por **uno**:
  `{ label: 'Calendario de Equipo', path: '/calendario', icon: CalendarRange, minLevel: 70 }`.
- **`App.tsx`:**
  - Nueva ruta `/calendario` → `CalendarioEquipoPage`.
  - `/vacaciones/gantt` → `<Navigate to="/calendario" replace />`.
  - `/disponibilidad` → `<Navigate to="/calendario" replace />`.
- **Gate in-component:** `nivel >= 70` (mismo cartel de "sin permisos" que el
  detallado actual).

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
| `apps/web/src/components/layout/AppShell.tsx` | Nav: 2 ítems → 1 |
| `apps/web/src/index.css` | Generalizar reglas de estado de `.av-seg` a clase compartida |

## Persistencia del modo

`localStorage` con clave dedicada (p. ej. `calendario-equipo-modo`), valores
`'compacto' | 'detallado'`. Default `'compacto'` si no hay valor guardado. Se
lee al montar y se escribe en cada cambio de toggle.

## Testing / verificación

- Verificación manual en navegador (no hay tests de UI en el repo):
  - Toggle alterna modos sin refetch (una sola request en Network).
  - Compacto: barras aprobadas sólidas, en revisión rayadas; tooltip con tipo
    exacto; leyenda correcta.
  - Detallado: paridad funcional con la Disponibilidad actual (búsqueda, turno,
    solapes, francos).
  - `/vacaciones/gantt` y `/disponibilidad` redirigen a `/calendario`.
  - Acceso: un usuario SUPERVISOR (60) ve el cartel de "sin permisos"; un
    COORDINADOR (70) accede.
  - El modo elegido persiste tras recargar.
- `typecheck` del front limpio.

## Fuera de alcance (YAGNI)

- Cambios en el endpoint `/vacaciones/gantt` (sirve a ambos modos tal cual).
- Responsive/mobile específico más allá del overflow horizontal ya existente.
- Exportación, impresión o nuevos filtros no presentes hoy.
