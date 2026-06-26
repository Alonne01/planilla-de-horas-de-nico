# Calendario de Equipo unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar "Calendario Vac." y "Disponibilidad" en una sola página con dos modos (Compacto/Detallado), con relleno/rayado por estado en ambos modos y acceso dinámico según la cadena de aprobación del sector.

**Architecture:** Una página orquestadora (`CalendarioEquipoPage`) dueña de los datos (1 query a `/vacaciones/gantt`), del año, sector y del toggle de modo persistido; renderiza dos subcomponentes de presentación (`CalendarioCompacto`, `CalendarioDetallado`) que comparten tipos/colores/helpers desde `components/calendario/shared.ts`. En backend, un helper (`calendario-access.utils.ts`) calcula el acceso por cadena de aprobación y alimenta tanto el gate del endpoint como un flag `puedeVerCalendario` en el payload de login/refresh/me.

**Tech Stack:** React 18 + TypeScript + Vite + TanStack Query + Tailwind v4 (frontend); Express + Prisma + TypeScript (API). Sin framework de tests: verificación por `tsc` (typecheck), un test `tsx` con prisma falso para el helper, y verificación manual en navegador.

**Nota de testing:** El repo no tiene vitest/jest. Web: `npx tsc -b` (typecheck). API: `npx tsc --noEmit` (typecheck) y `npx tsx <archivo>` para scripts. El único test automatizado nuevo es el del helper de acceso (prisma falso, sin DB). El resto se valida con typecheck + pasos manuales descritos.

**Spec de referencia:** `docs/superpowers/specs/2026-06-26-calendario-equipo-unificado-design.md`

---

## Estructura de archivos

**Backend (API):**
- Crear `apps/api/src/utils/calendario-access.utils.ts` — helper de acceso por cadena.
- Crear `apps/api/tests/calendario-access.test.ts` — test del helper (prisma falso).
- Modificar `apps/api/src/routes/vacaciones.routes.ts` — gate de `/gantt`.
- Modificar `apps/api/src/routes/auth.routes.ts` — flag en login/refresh/me.

**Frontend (web):**
- Modificar `apps/web/src/stores/authStore.ts` — campo `puedeVerCalendario`.
- Crear `apps/web/src/components/calendario/shared.ts` — tipos/colores/helpers/query.
- Modificar `apps/web/src/index.css` — clase `.cal-estado` (relleno/rayado).
- Crear `apps/web/src/components/calendario/CalendarioCompacto.tsx`.
- Crear `apps/web/src/components/calendario/CalendarioDetallado.tsx` (refactor de `DisponibilidadPage`).
- Crear `apps/web/src/pages/CalendarioEquipoPage.tsx` — orquestador.
- Modificar `apps/web/src/App.tsx` — ruta `/calendario` + redirects.
- Modificar `apps/web/src/components/layout/AppShell.tsx` — nav 2→1.
- Eliminar `apps/web/src/pages/VacacionesGanttPage.tsx` y `apps/web/src/pages/DisponibilidadPage.tsx`.

---

## Task 1: Helper de acceso por cadena de aprobación (backend)

**Files:**
- Create: `apps/api/src/utils/calendario-access.utils.ts`
- Test: `apps/api/tests/calendario-access.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/tests/calendario-access.test.ts`:

```ts
import assert from 'node:assert';
import { nivelMinimoAccesoSector, puedeVerCalendario } from '../src/utils/calendario-access.utils.js';

// Prisma falso: ignora el `where` y devuelve datos canónicos. Permite testear
// la lógica de agregación (min nivel) y fallback sin base de datos.
function fakePrisma(pasos: { rolAprobador: string }[], roles: { codigo: string; nivel: number }[]) {
  return {
    flujoPaso: { findMany: async () => pasos },
    rolConfig: { findMany: async () => roles },
  } as any;
}

async function run() {
  // 1. Cadena Supervisor→Coordinador→RRHH → min = 60
  {
    const prisma = fakePrisma(
      [{ rolAprobador: 'SUPERVISOR' }, { rolAprobador: 'COORDINADOR' }, { rolAprobador: 'RRHH' }],
      [{ codigo: 'SUPERVISOR', nivel: 60 }, { codigo: 'COORDINADOR', nivel: 70 }, { codigo: 'RRHH', nivel: 90 }],
    );
    assert.strictEqual(await nivelMinimoAccesoSector(prisma, 'e1', 's1'), 60, 'min debe ser 60');
  }
  // 2. Sin flujos → fallback 70
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await nivelMinimoAccesoSector(prisma, 'e1', 's1'), 70, 'fallback 70');
  }
  // 3. Supervisor(60) en sector con min 60 → accede
  {
    const prisma = fakePrisma([{ rolAprobador: 'SUPERVISOR' }], [{ codigo: 'SUPERVISOR', nivel: 60 }]);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 60, empresaId: 'e1', sectorId: 's1' }), true, 'supervisor accede');
  }
  // 4. Supervisor(60) en sector con min 70 → NO accede
  {
    const prisma = fakePrisma(
      [{ rolAprobador: 'COORDINADOR' }, { rolAprobador: 'RRHH' }],
      [{ codigo: 'COORDINADOR', nivel: 70 }, { codigo: 'RRHH', nivel: 90 }],
    );
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 60, empresaId: 'e1', sectorId: 's1' }), false, 'supervisor NO accede');
  }
  // 5. RRHH(90) sin sector → accede igual
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 90, empresaId: 'e1', sectorId: null }), true, 'RRHH accede sin sector');
  }
  // 6. Coordinador(70) sin sector → NO accede
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 70, empresaId: 'e1', sectorId: null }), false, 'sub-RRHH sin sector NO accede');
  }
  console.log('✓ calendario-access: 6/6 OK');
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd "apps/api" && npx tsx tests/calendario-access.test.ts`
Expected: FAIL — error de import / módulo `calendario-access.utils` inexistente.

- [ ] **Step 3: Implementar el helper**

Crear `apps/api/src/utils/calendario-access.utils.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

// Sin flujos asignados al sector → se cae al gate histórico (COORDINADOR = 70).
const FALLBACK_NIVEL = 70;

export interface CalendarUser {
  rolNivel?: number;
  empresaId: string;
  sectorId?: string | null;
}

/**
 * Nivel del aprobador MÁS BAJO entre TODOS los flujos activos que aplican al
 * sector (asignación específica al sector O global, sectorId null), sobre
 * cualquier tipoDocumento. Si no hay pasos, devuelve 70 (comportamiento previo).
 * `rolAprobador` es un CÓDIGO de rol → se resuelve a nivel vía RolConfig.
 */
export async function nivelMinimoAccesoSector(
  prisma: PrismaClient,
  empresaId: string,
  sectorId: string,
): Promise<number> {
  const pasos = await prisma.flujoPaso.findMany({
    where: {
      flujo: {
        empresaId,
        activo: true,
        asignaciones: { some: { activo: true, OR: [{ sectorId }, { sectorId: null }] } },
      },
    },
    select: { rolAprobador: true },
  });
  if (pasos.length === 0) return FALLBACK_NIVEL;

  const codigos = [...new Set(pasos.map((p) => p.rolAprobador))];
  const roles = await prisma.rolConfig.findMany({
    where: { empresaId, codigo: { in: codigos }, activo: true },
    select: { codigo: true, nivel: true },
  });
  const nivelByCodigo = new Map(roles.map((r) => [r.codigo, r.nivel]));

  let min = Infinity;
  for (const codigo of codigos) {
    const nivel = nivelByCodigo.get(codigo);
    if (nivel != null && nivel < min) min = nivel;
  }
  return min === Infinity ? FALLBACK_NIVEL : min;
}

/**
 * ¿El usuario puede ver el Calendario de Equipo?
 * - RRHH/ADMIN (>= 90): siempre (ven todos los sectores).
 * - Sin sector: no.
 * - Resto: su nivel >= nivel mínimo de la cadena de su sector.
 */
export async function puedeVerCalendario(prisma: PrismaClient, user: CalendarUser): Promise<boolean> {
  const nivel = user.rolNivel ?? 0;
  if (nivel >= 90) return true;
  if (!user.sectorId) return false;
  const min = await nivelMinimoAccesoSector(prisma, user.empresaId, user.sectorId);
  return nivel >= min;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd "apps/api" && npx tsx tests/calendario-access.test.ts`
Expected: `✓ calendario-access: 6/6 OK`

- [ ] **Step 5: Typecheck**

Run: `cd "apps/api" && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/utils/calendario-access.utils.ts apps/api/tests/calendario-access.test.ts
git commit -m "feat(api): helper de acceso al calendario por cadena de aprobación"
```

---

## Task 2: Gate dinámico en `/vacaciones/gantt`

**Files:**
- Modify: `apps/api/src/routes/vacaciones.routes.ts` (imports + handler de `/gantt`)

- [ ] **Step 1: Importar el helper**

En `apps/api/src/routes/vacaciones.routes.ts`, agregar al bloque de imports (después de la línea que importa `approval-auth.utils.js`):

```ts
import { puedeVerCalendario } from '../utils/calendario-access.utils.js';
```

- [ ] **Step 2: Reemplazar el gate plano por el dinámico**

Buscar (en el handler `router.get('/gantt', ...)`):

```ts
    // Only COORDINADOR+ can see team gantt
    if (userNivel < 70) {
      res.status(403).json({ error: 'Sin permisos' });
      return;
    }

    const { anio, sectorId } = req.query;
    const year = anio ? Number(anio) : new Date().getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const userWhere: any = { empresaId };
    // Below RRHH (< 90): force own sector only. RRHH+ can filter or see all.
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      if (me?.sectorId) userWhere.sectorId = me.sectorId;
    } else if (sectorId) {
      userWhere.sectorId = sectorId as string;
    }
```

Reemplazar por:

```ts
    const { anio, sectorId } = req.query;
    const year = anio ? Number(anio) : new Date().getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    const userWhere: any = { empresaId };
    // Acceso dinámico por cadena de aprobación. RRHH+ (>=90) ven todo y pueden
    // filtrar por sector; el resto sólo su propio sector, y sólo si están en la
    // cadena de aprobación de ese sector ("de supervisor para arriba" donde aplique).
    if (userNivel < 90) {
      const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { sectorId: true } });
      const allowed = await puedeVerCalendario(prisma, { rolNivel: userNivel, empresaId, sectorId: me?.sectorId ?? null });
      if (!allowed) {
        res.status(403).json({ error: 'Sin permisos' });
        return;
      }
      if (me?.sectorId) userWhere.sectorId = me.sectorId;
    } else if (sectorId) {
      userWhere.sectorId = sectorId as string;
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd "apps/api" && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual (con API corriendo)**

Con el server en `:4000` y un usuario SUPERVISOR de un sector cuya cadena incluye paso SUPERVISOR, `GET /vacaciones/gantt?anio=2026&todos=1` responde 200. Un usuario sin sector o cuyo sector no lo incluye → 403.
(Opcional si no hay entorno levantado: omitir y validar en la verificación integral final.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/vacaciones.routes.ts
git commit -m "feat(api): gate de /gantt por cadena de aprobación del sector"
```

---

## Task 3: Flag `puedeVerCalendario` en login / refresh / me

**Files:**
- Modify: `apps/api/src/routes/auth.routes.ts` (handlers de login, refresh y `/me`)

- [ ] **Step 1: Importar el helper**

En `apps/api/src/routes/auth.routes.ts`, agregar a los imports:

```ts
import { puedeVerCalendario } from '../utils/calendario-access.utils.js';
```

- [ ] **Step 2: Login — computar y devolver el flag**

En el handler de login, buscar:

```ts
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = await signRefreshToken(usuario.id);

    // Set refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
      },
    });
```

Reemplazar por (agrega el `const puedeVerCal` y el campo en el objeto `user`):

```ts
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = await signRefreshToken(usuario.id);

    // Set refresh token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    const puedeVerCal = await puedeVerCalendario(prisma, {
      rolNivel, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
    });

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
        puedeVerCalendario: puedeVerCal,
      },
    });
```

- [ ] **Step 3: Refresh — computar y devolver el flag**

En el handler de refresh, buscar:

```ts
    const accessToken = signAccessToken(tokenPayload);
    const newRefreshToken = await signRefreshToken(usuario.id);

    res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
      },
    });
```

Reemplazar por:

```ts
    const accessToken = signAccessToken(tokenPayload);
    const newRefreshToken = await signRefreshToken(usuario.id);

    res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);

    const puedeVerCal = await puedeVerCalendario(prisma, {
      rolNivel, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
    });

    res.json({
      accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol,
        rolNivel,
        empresaId: usuario.empresaId,
        empresaNombre: usuario.empresa.nombre,
        sectorId: usuario.sectorId,
        sectorNombre: usuario.sector?.nombre ?? null,
        primerLogin: usuario.primerLogin,
        puedeVerCalendario: puedeVerCal,
      },
    });
```

- [ ] **Step 4: `/me` — computar y devolver el flag**

En el handler de `/me`, buscar:

```ts
      primerLogin: usuario.primerLogin,
      avatarUrl: usuario.avatarUrl,
    });
```

Reemplazar por (computar el flag justo antes del `res.json`; el nivel se toma del token `req.user`):

```ts
      primerLogin: usuario.primerLogin,
      avatarUrl: usuario.avatarUrl,
      puedeVerCalendario: await puedeVerCalendario(prisma, {
        rolNivel: req.user!.rolNivel ?? 0, empresaId: usuario.empresaId, sectorId: usuario.sectorId,
      }),
    });
```

- [ ] **Step 5: Typecheck**

Run: `cd "apps/api" && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.routes.ts
git commit -m "feat(api): exponer puedeVerCalendario en login/refresh/me"
```

---

## Task 4: Campo `puedeVerCalendario` en el store de auth (frontend)

**Files:**
- Modify: `apps/web/src/stores/authStore.ts` (interfaz `User`)

- [ ] **Step 1: Agregar el campo a la interfaz `User`**

Buscar:

```ts
  sectorId: string | null;
  sectorNombre: string | null;
  primerLogin: boolean;
}
```

Reemplazar por:

```ts
  sectorId: string | null;
  sectorNombre: string | null;
  primerLogin: boolean;
  puedeVerCalendario?: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/authStore.ts
git commit -m "feat(web): campo puedeVerCalendario en User"
```

---

## Task 5: Módulo compartido `shared.ts` (frontend)

**Files:**
- Create: `apps/web/src/components/calendario/shared.ts`

- [ ] **Step 1: Crear el módulo compartido**

Crear `apps/web/src/components/calendario/shared.ts`:

```ts
import api from '@/services/api';
import { type DiagramaInfo } from '@/utils/planillaHelpers';

export interface Sector { id: string; nombre: string }
export type EmpDiagrama = DiagramaInfo & { fechaInicio: string };
export interface Bloque {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: string;
  tipo: string;
  detalle: string | null;
}
export interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string | null;
  sector: Sector | null;
  diagrama?: EmpDiagrama | null;
  bloques: Bloque[];
}
export interface GanttData {
  anio: number;
  sectores: Sector[];
  empleados: Empleado[];
}

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export type Cat = 'VACACION' | 'AUSENCIA' | 'FRANCO' | 'CAPACITACION' | 'DESCANSO';

// Clases literales (nunca interpolar `text-cal-${cat}`: Tailwind v4 JIT lo purga).
export const CAT: Record<Cat, string> = {
  VACACION: 'text-cal-teal',
  AUSENCIA: 'text-cal-red',
  FRANCO: 'text-cal-violet',
  CAPACITACION: 'text-cal-blue',
  DESCANSO: 'text-muted-foreground',
};
export const CAT_LABEL: Record<Cat, string> = {
  VACACION: 'Vacación',
  AUSENCIA: 'Ausencia / Licencia',
  FRANCO: 'Franco comp.',
  CAPACITACION: 'Capacitación',
  DESCANSO: 'Franco / Descanso',
};
export const ESTADO_BADGE: Record<string, string> = {
  APROBADA: 'bg-cal-emerald/20 text-cal-emerald',
  EN_REVISION: 'bg-cal-amber/20 text-cal-amber',
  PENDIENTE: 'bg-cal-blue/20 text-cal-blue',
};
// Categorías que cuentan para el solape (ausencia real). DESCANSO/CAPACITACION no.
export const COUNTABLE: Record<Cat, boolean> = {
  VACACION: true, AUSENCIA: true, FRANCO: true, CAPACITACION: false, DESCANSO: false,
};
export const CAT_ORDER: Cat[] = ['VACACION', 'AUSENCIA', 'FRANCO', 'CAPACITACION'];

export function catOf(tipo: string): Cat {
  if (tipo === 'VACACION') return 'VACACION';
  if (tipo === 'AUSENCIA_FRANCO_COMPENSATORIO') return 'FRANCO';
  if (tipo === 'CAPACITACION') return 'CAPACITACION';
  return 'AUSENCIA'; // cualquier otro AUSENCIA_*
}

// Etiqueta del TIPO exacto (para el tooltip), preservando la granularidad.
export const TIPO_LABEL: Record<string, string> = {
  VACACION: 'Vacación',
  CAPACITACION: 'Capacitación',
  AUSENCIA_CERTIFICADO_MEDICO: 'Cert. médico',
  AUSENCIA_FALTA_INJUSTIFICADA: 'Falta injust.',
  AUSENCIA_FALTA_JUSTIFICADA: 'Falta just.',
  AUSENCIA_LICENCIA_ESPECIAL: 'Lic. especial',
  AUSENCIA_FRANCO_COMPENSATORIO: 'Compensatorio',
  AUSENCIA_ACCIDENTE_TRABAJO: 'Acc. trabajo',
  AUSENCIA_LICENCIA_GREMIAL: 'Lic. gremial',
  AUSENCIA_SUSPENSION: 'Suspensión',
};
export function tipoLabel(tipo: string): string {
  return TIPO_LABEL[tipo] ?? tipo;
}

// Parse date-only (sin `new Date(iso)`): el backend serializa fechas server-local
// vía .toISOString(); construir un Date acá correría el día en algunas timezones.
export function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}
export function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}
export function fmtDate(iso: string) {
  const [y, m, d] = ymd(iso);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
}
export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Query compartida del calendario de equipo (ambos modos). Siempre `todos=1`.
export function calendarQueryKey(anio: number, sectorId: string) {
  return ['calendario-equipo', anio, sectorId] as const;
}
export async function fetchCalendar(anio: number, sectorId: string): Promise<GanttData> {
  const params = new URLSearchParams({ anio: String(anio), todos: '1' });
  if (sectorId) params.set('sectorId', sectorId);
  return (await api.get(`/vacaciones/gantt?${params}`)).data;
}

// ── Solapes (overlap) ──────────────────────────────────────────────────────
// Offsets día-del-año por mes (leap-aware).
export function monthOffsets(anio: number): { monthOffset: number[]; totalDays: number } {
  const monthOffset: number[] = [];
  let acc = 0;
  for (let mi = 0; mi < 12; mi++) { monthOffset[mi] = acc; acc += daysInMonth(anio, mi); }
  return { monthOffset, totalDays: acc };
}

// Rango [inicio,fin] en día-del-año de un bloque, acotado al año (null si queda afuera).
export function blockDoyRange(
  fechaInicio: string, fechaFin: string, year: number, monthOffset: number[], totalDays: number,
): [number, number] | null {
  const [y1, m1, d1] = ymd(fechaInicio);
  const [y2, m2, d2] = ymd(fechaFin);
  if (y1 > year || y2 < year) return null;
  const start = y1 < year ? 0 : monthOffset[m1 - 1] + (d1 - 1);
  const end = y2 > year ? totalDays - 1 : monthOffset[m2 - 1] + (d2 - 1);
  return [Math.max(0, start), Math.min(totalDays - 1, end)];
}

// Pico de ocupación por bloque countable (≥2 ⇒ al menos otra persona afuera esos
// días). Cada empleado cuenta 1 por día. Devuelve sólo los bloques con pico ≥ 2.
export function computeOverlapPeaks(empleados: Empleado[], anio: number): Map<string, number> {
  const { monthOffset, totalDays } = monthOffsets(anio);
  const counts = new Int16Array(totalDays);
  for (const emp of empleados) {
    const doySet = new Set<number>();
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
      if (!rg) continue;
      for (let d = rg[0]; d <= rg[1]; d++) doySet.add(d);
    }
    for (const d of doySet) counts[d]++;
  }
  const peaks = new Map<string, number>();
  for (const emp of empleados) {
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
      if (!rg) continue;
      let peak = 0;
      for (let d = rg[0]; d <= rg[1]; d++) if (counts[d] > peak) peak = counts[d];
      if (peak >= 2) peaks.set(b.id, peak);
    }
  }
  return peaks;
}

// IDs de empleados (excluye al clickeado) cuyo bloque countable se solapa con el
// rango del bloque dado.
export function overlappingEmployeeIds(
  empleados: Empleado[], block: Bloque, clickedEmpId: string, anio: number,
): Set<string> {
  const { monthOffset, totalDays } = monthOffsets(anio);
  const ids = new Set<string>();
  const range = blockDoyRange(block.fechaInicio, block.fechaFin, anio, monthOffset, totalDays);
  if (!range) return ids;
  const [s0, s1] = range;
  for (const emp of empleados) {
    if (emp.id === clickedEmpId) continue;
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
      if (!rg || rg[0] > s1 || rg[1] < s0) continue;
      ids.add(emp.id);
      break;
    }
  }
  return ids;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores (módulo aún sin consumidores).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/calendario/shared.ts
git commit -m "feat(web): módulo compartido del calendario de equipo"
```

---

## Task 6: Clase CSS `.cal-estado` (relleno / rayado)

**Files:**
- Modify: `apps/web/src/index.css`

**Nota:** se agrega una clase nueva en vez de tocar `.av-seg` (la grilla detallada funciona y ya usa su propio set). Pequeña duplicación deliberada para no regresionar el detallado.

- [ ] **Step 1: Agregar la clase `.cal-estado`**

En `apps/web/src/index.css`, buscar la línea:

```css
.av-seg { border-radius: 3px; }
```

Insertar **antes** de esa línea:

```css
/* Relleno sólido (aprobada) o rayado 45° + borde punteado (pendiente/en
   revisión). Usada por las barras del modo compacto del Calendario de Equipo.
   Toma su color de la clase text-cal-* del elemento, vía currentColor. */
.cal-estado { border-radius: 4px; }
.cal-estado::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: 0.8;
}
.cal-estado[data-estado="PENDIENTE"]::before,
.cal-estado[data-estado="EN_REVISION"]::before { opacity: 0.22; }
.cal-estado[data-estado="PENDIENTE"]::after,
.cal-estado[data-estado="EN_REVISION"]::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px dashed currentColor;
  background: repeating-linear-gradient(45deg, currentColor 0 1.5px, transparent 1.5px 4px);
  opacity: 0.55;
}
/* Marcador de solape: contorno rosa (cal-rose no lo usan las categorías). */
.cal-estado[data-overlap="1"] { outline: 1.5px solid color-mix(in srgb, var(--cal-rose) 75%, transparent); outline-offset: 1px; }
.cal-estado[data-overlap="2"] { outline: 1.5px solid var(--cal-rose); outline-offset: 1px; }
```

- [ ] **Step 2: Typecheck (CSS no rompe TS, pero validamos el build de tipos)**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(web): clase .cal-estado (relleno/rayado por estado)"
```

---

## Task 7: Componente `CalendarioCompacto`

**Files:**
- Create: `apps/web/src/components/calendario/CalendarioCompacto.tsx`

- [ ] **Step 1: Crear el componente compacto**

Crear `apps/web/src/components/calendario/CalendarioCompacto.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type GanttData, type Bloque, type Cat,
  MESES, CAT, CAT_LABEL, CAT_ORDER, ESTADO_BADGE, catOf, tipoLabel, computeOverlapPeaks,
} from './shared';

interface Props {
  data?: GanttData;
  anio: number;
  isLoading: boolean;
  onOverlapSelect: (block: Bloque, empId: string, empName: string) => void;
}

export default function CalendarioCompacto({ data, anio, isLoading, onOverlapSelect }: Props) {
  const [hovered, setHovered] = useState<(Bloque & { empNombre: string; cat: Cat }) | null>(null);

  // Picos de solape por bloque (pico ≥ 2 ⇒ al menos otra persona afuera esos días).
  const overlapPeaks = useMemo(
    () => (data ? computeOverlapPeaks(data.empleados, anio) : new Map<string, number>()),
    [data, anio],
  );

  const months = useMemo(
    () => MESES.map((label, i) => ({ label, index: i, days: new Date(anio, i + 1, 0).getDate() })),
    [anio],
  );
  const totalDays = useMemo(() => months.reduce((s, m) => s + m.days, 0), [months]);

  const dateToDayOffset = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(anio, 0, 1);
    const diff = Math.max(0, Math.floor((d.getTime() - start.getTime()) / 86400000));
    return Math.min(diff, totalDays - 1);
  };

  // Categorías presentes (para la leyenda).
  const activeCats = useMemo(() => {
    if (!data) return [] as Cat[];
    const set = new Set<Cat>();
    for (const emp of data.empleados) for (const b of emp.bloques) set.add(catOf(b.tipo));
    return CAT_ORDER.filter((c) => set.has(c));
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Leyenda */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        {activeCats.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cn('w-3 h-3 rounded', CAT[c])} style={{ backgroundColor: 'currentColor' }} />
            {CAT_LABEL[c]}
          </span>
        ))}
        {activeCats.length === 0 && <span>Sin datos</span>}
        <span className="ml-2 flex items-center gap-2 text-[11px]">
          <span>▓ aprobada</span><span>▨ en revisión</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-cal-rose" /> solape</span>
        </span>
      </div>

      {/* Gantt */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {!data?.empleados.length ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">No hay registros en {anio}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Header de meses */}
              <div className="flex border-b border-border">
                <div className="w-48 min-w-48 px-3 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground border-r border-border">
                  Empleado
                </div>
                <div className="flex-1 flex">
                  {months.map((m) => (
                    <div
                      key={m.index}
                      className="text-center text-xs font-medium text-muted-foreground py-2 border-r border-border/50"
                      style={{ width: `${(m.days / totalDays) * 100}%` }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Filas de empleados */}
              {data.empleados.map((emp) => (
                <div key={emp.id} className="flex border-b border-border/50 hover:bg-muted/10 transition-colors">
                  <div className="w-48 min-w-48 px-3 py-2.5 border-r border-border flex flex-col justify-center">
                    <span className="text-sm font-medium truncate">{emp.apellido}, {emp.nombre}</span>
                    {emp.sector && (
                      <span className="text-[10px] text-muted-foreground truncate">{emp.sector.nombre}</span>
                    )}
                  </div>

                  <div className="flex-1 relative py-1.5 px-0.5" style={{ minHeight: '40px' }}>
                    {/* Gridlines de meses */}
                    {months.map((m) => {
                      const offset = months.slice(0, m.index).reduce((s, mm) => s + mm.days, 0);
                      return (
                        <div
                          key={m.index}
                          className="absolute top-0 bottom-0 border-r border-border/20"
                          style={{ left: `${(offset / totalDays) * 100}%` }}
                        />
                      );
                    })}

                    {/* Marcador de hoy */}
                    {anio === new Date().getFullYear() && (() => {
                      const todayOffset = dateToDayOffset(new Date().toISOString());
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-primary/60 z-10"
                          style={{ left: `${(todayOffset / totalDays) * 100}%` }}
                        />
                      );
                    })()}

                    {/* Barras */}
                    {emp.bloques.map((b) => {
                      const cat = catOf(b.tipo);
                      const peak = overlapPeaks.get(b.id);
                      const isOverlap = peak != null;
                      const startDay = dateToDayOffset(b.fechaInicio);
                      const endDay = dateToDayOffset(b.fechaFin);
                      const duration = Math.max(endDay - startDay + 1, 1);
                      const leftPct = (startDay / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;
                      return (
                        <div
                          key={`${b.tipo}-${b.id}`}
                          className={cn('cal-estado absolute top-1/2 -translate-y-1/2 h-5', CAT[cat], isOverlap ? 'cursor-pointer' : 'cursor-default')}
                          data-estado={b.estado}
                          data-overlap={isOverlap ? (peak >= 3 ? '2' : '1') : undefined}
                          title={isOverlap ? 'Solape — clic para ver con quién' : undefined}
                          style={{ left: `${leftPct}%`, width: `max(${widthPct}%, 4px)` }}
                          onMouseEnter={() => setHovered({ ...b, cat, empNombre: `${emp.apellido}, ${emp.nombre}` })}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => { if (isOverlap) onOverlapSelect(b, emp.id, `${emp.apellido}, ${emp.nombre}`); }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hovered && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-card shadow-lg p-4 max-w-xs">
          <p className="font-semibold text-sm">{hovered.empNombre}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(hovered.fechaInicio).toLocaleDateString('es-AR')} — {new Date(hovered.fechaFin).toLocaleDateString('es-AR')}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', CAT[hovered.cat])} style={{ backgroundColor: 'currentColor' }} />
            <span className="text-xs font-medium">{tipoLabel(hovered.tipo)}</span>
          </div>
          <p className="text-xs mt-1">
            <span className="font-medium">{hovered.dias} día{hovered.dias !== 1 ? 's' : ''}</span>
            <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium', ESTADO_BADGE[hovered.estado] ?? 'bg-muted text-muted-foreground')}>
              {hovered.estado}
            </span>
          </p>
          {hovered.detalle && <p className="text-xs text-muted-foreground mt-1 italic">"{hovered.detalle}"</p>}
        </div>
      )}

      {/* Resumen */}
      {data && data.empleados.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
          <span>{data.empleados.length} empleados</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.length, 0)} registros</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.filter((b) => b.tipo === 'VACACION').length, 0)} vacaciones</span>
          <span>{data.empleados.reduce((s, e) => s + e.bloques.filter((b) => b.tipo.startsWith('AUSENCIA_')).length, 0)} ausencias</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/calendario/CalendarioCompacto.tsx
git commit -m "feat(web): CalendarioCompacto (5 cat + estado + tipo en tooltip + solapes)"
```

---

## Task 8: Componente `CalendarioDetallado` (refactor de `DisponibilidadPage`)

**Files:**
- Create: `apps/web/src/components/calendario/CalendarioDetallado.tsx` (copia de `DisponibilidadPage.tsx` + ediciones)

- [ ] **Step 1: Copiar la página actual al nuevo archivo**

```bash
cp "apps/web/src/pages/DisponibilidadPage.tsx" "apps/web/src/components/calendario/CalendarioDetallado.tsx"
```

- [ ] **Step 2: Reemplazar imports + definiciones locales por imports del módulo compartido**

En `CalendarioDetallado.tsx`, reemplazar TODO el bloque desde el inicio del archivo hasta (e incluyendo) la función `norm` — es decir, los imports, las interfaces locales (`Sector`, `EmpDiagrama`, `Bloque`, `Empleado`, `GanttData`), las constantes (`MESES`, `DOW_SHORT`, `Cat`, `CAT`, `CAT_LABEL`, `ESTADO_BADGE`, `COUNTABLE`, `CAT_ORDER`), y las funciones `catOf`, `ymd`, `daysInMonth`, `fmtDate`, `norm`.

Concretamente, reemplazar desde la línea 1 hasta la línea que cierra `norm` (`}` de `function norm`), que termina justo antes del comentario `// ── Turno derivation…`, por:

```tsx
import { useMemo, useState, useEffect } from 'react';
import { Search, Users, Loader2, Eye, EyeOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { esDiaFranco } from '@/utils/planillaHelpers';
import {
  type GanttData, type Empleado, type EmpDiagrama, type Bloque, type Cat,
  MESES, DOW_SHORT, CAT, CAT_LABEL, ESTADO_BADGE, COUNTABLE, CAT_ORDER,
  catOf, tipoLabel, ymd, daysInMonth, fmtDate, norm,
} from './shared';
```

Conservar intacto TODO lo que viene después (desde `// ── Turno derivation: …` en adelante: `epochDay`, `turnoKey`, `turnoSubtitle`, `letterOf`, `restGradient`, `Segment`, `RowData`, `OverlapEntry`, `DetailState`, `blockDoyRange`, `edgeOf`, `buildSegments`, `GRID_STYLE`).

- [ ] **Step 3: Cambiar la firma del componente + recibir props (sin query ni estado de año/sector)**

Buscar:

```tsx
export default function DisponibilidadPage() {
  const user = useAuthStore((s) => s.user);
  const nivel = user?.rolNivel ?? 0;
  const isRRHH = nivel >= 90;

  const [anio, setAnio] = useState(new Date().getFullYear());
  const [sectorId, setSectorId] = useState('');
  const [q, setQ] = useState('');
  const [turnoSel, setTurnoSel] = useState('');
  const [vis, setVis] = useState<Record<Cat, boolean>>({
    VACACION: true, AUSENCIA: true, FRANCO: true, CAPACITACION: false, DESCANSO: false,
  });
  const [hover, setHover] = useState<{ seg: Segment; x: number; y: number } | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const { data, isLoading } = useQuery<GanttData>({
    queryKey: ['disponibilidad', anio, sectorId],
    queryFn: async () => {
      const params = new URLSearchParams({ anio: String(anio), todos: '1' });
      if (sectorId) params.set('sectorId', sectorId);
      return (await api.get(`/vacaciones/gantt?${params}`)).data;
    },
    enabled: nivel >= 70,
  });
```

Reemplazar por:

```tsx
interface Props {
  data?: GanttData;
  anio: number;
  isLoading: boolean;
  onOverlapSelect: (block: Bloque, empId: string, empName: string) => void;
}

export default function CalendarioDetallado({ data, anio, isLoading, onOverlapSelect }: Props) {
  const [q, setQ] = useState('');
  const [turnoSel, setTurnoSel] = useState('');
  const [vis, setVis] = useState<Record<Cat, boolean>>({
    VACACION: true, AUSENCIA: true, FRANCO: true, CAPACITACION: false, DESCANSO: false,
  });
  const [hover, setHover] = useState<{ seg: Segment; x: number; y: number } | null>(null);
```

Nota: `Bloque` ya viene importado desde `./shared` (Step 2). Se elimina el estado
`detail` porque el panel de detalle se reemplaza por el filtro (Steps 8–14).

- [ ] **Step 4: Eliminar el gate de permisos local (lo maneja el orquestador)**

Buscar y eliminar por completo:

```tsx
  if (user && nivel < 70) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
        <Lock className="h-10 w-10 mb-3 opacity-50" />
        <p>No tenés permisos para ver la disponibilidad del equipo.</p>
      </div>
    );
  }

```

- [ ] **Step 5: Reemplazar el toolbar (título + sector + año) por sólo búsqueda + turno**

Buscar:

```tsx
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-primary" />
          Disponibilidad
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o legajo…"
              className="rounded-lg border border-border bg-card pl-8 pr-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {isRRHH && (
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Todos los sectores</option>
              {data?.sectores.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          )}
          <select
            value={turnoSel}
            onChange={(e) => setTurnoSel(e.target.value)}
            aria-label="Filtrar por turno"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm max-w-[16rem]"
          >
            <option value="">Todos los turnos</option>
            {turnos.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key === 'SIN' ? `Sin diagrama (${t.count})` : `Turno ${t.letra} — ${t.subtitle} (${t.count})`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button onClick={() => setAnio((a) => a - 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[4ch] text-center tabular-nums">{anio}</span>
            <button onClick={() => setAnio((a) => a + 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
```

Reemplazar por:

```tsx
    <div className="space-y-3">
      {/* Filtros propios del modo detallado (búsqueda + turno) */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre o legajo…"
            className="rounded-lg border border-border bg-card pl-8 pr-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={turnoSel}
          onChange={(e) => setTurnoSel(e.target.value)}
          aria-label="Filtrar por turno"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm max-w-[16rem]"
        >
          <option value="">Todos los turnos</option>
          {turnos.map((t) => (
            <option key={t.key} value={t.key}>
              {t.key === 'SIN' ? `Sin diagrama (${t.count})` : `Turno ${t.letra} — ${t.subtitle} (${t.count})`}
            </option>
          ))}
        </select>
      </div>
```

- [ ] **Step 6: Mostrar el TIPO exacto en el popover de hover**

Buscar:

```tsx
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', CAT[hover.seg.cat])} style={{ backgroundColor: 'currentColor' }} />
            <span className="text-xs font-medium">{CAT_LABEL[hover.seg.cat]}</span>
          </div>
```

Reemplazar por:

```tsx
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', CAT[hover.seg.cat])} style={{ backgroundColor: 'currentColor' }} />
            <span className="text-xs font-medium">{tipoLabel(hover.seg.block.tipo)}</span>
          </div>
```

- [ ] **Step 7: Mostrar el TIPO exacto en el header del panel de detalle**

Buscar:

```tsx
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={cn('w-2.5 h-2.5 rounded', CAT[detail.seg.cat])} style={{ backgroundColor: 'currentColor' }} />
                  <span className="text-xs">{CAT_LABEL[detail.seg.cat]}</span>
```

Reemplazar por:

```tsx
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={cn('w-2.5 h-2.5 rounded', CAT[detail.seg.cat])} style={{ backgroundColor: 'currentColor' }} />
                  <span className="text-xs">{tipoLabel(detail.seg.block.tipo)}</span>
```

- [ ] **Step 8: Eliminar las interfaces `OverlapEntry` y `DetailState`**

Buscar y eliminar por completo (quedan sin uso al reemplazar el panel por el filtro):

```tsx
interface OverlapEntry {
  id: string; name: string; legajo: string | null; sector: string | null;
  cat: Cat; estado: string; fechaInicio: string; fechaFin: string;
}
interface DetailState { seg: Segment; empName: string; others: OverlapEntry[]; }
```

- [ ] **Step 9: Eliminar la función local `blockDoyRange`**

Buscar y eliminar por completo (sólo la usaba `openDetail`; el orquestador usa la versión de `./shared`):

```tsx
// Day-of-year range [start,end] of a block, clamped to the visible year (null if outside).
function blockDoyRange(fechaInicio: string, fechaFin: string, year: number, monthOffset: number[], totalDays: number): [number, number] | null {
  const [y1, m1, d1] = ymd(fechaInicio);
  const [y2, m2, d2] = ymd(fechaFin);
  if (y1 > year || y2 < year) return null;
  const start = y1 < year ? 0 : monthOffset[m1 - 1] + (d1 - 1);
  const end = y2 > year ? totalDays - 1 : monthOffset[m2 - 1] + (d2 - 1);
  return [Math.max(0, start), Math.min(totalDays - 1, end)];
}
```

- [ ] **Step 10: Eliminar el `useEffect` de Escape y la función `openDetail`**

Buscar y eliminar:

```tsx
  // Close the overlap-detail panel on Escape.
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);
```

Y también buscar y eliminar:

```tsx
  // Click a segment → list every employee whose visible/countable request overlaps that block's days.
  const openDetail = (seg: Segment, clickedEmpId: string) => {
    if (!data) return;
    const range = blockDoyRange(seg.block.fechaInicio, seg.block.fechaFin, anio, monthOffset, totalDays);
    if (!range) return;
    const [s0, s1] = range;
    const others: OverlapEntry[] = [];
    for (const emp of data.empleados) {
      if (emp.id === clickedEmpId) continue;
      for (const b of emp.bloques) {
        const cat = catOf(b.tipo);
        if (!COUNTABLE[cat] || !vis[cat]) continue;
        const rg = blockDoyRange(b.fechaInicio, b.fechaFin, anio, monthOffset, totalDays);
        if (!rg || rg[0] > s1 || rg[1] < s0) continue;
        others.push({
          id: emp.id, name: `${emp.apellido}, ${emp.nombre}`, legajo: emp.legajo,
          sector: emp.sector?.nombre ?? null, cat, estado: b.estado,
          fechaInicio: b.fechaInicio, fechaFin: b.fechaFin,
        });
      }
    }
    others.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio) || a.name.localeCompare(b.name));
    setDetail({ seg, empName: seg.emp, others });
  };
```

- [ ] **Step 11: Click en solape → filtro (reemplaza `openDetail`)**

Buscar:

```tsx
                              onClick={() => openDetail(s, r.emp.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(s, r.emp.id); } }}
```

Reemplazar por (sólo filtra si el tramo está marcado como solape):

```tsx
                              onClick={() => { if (s.overlap) onOverlapSelect(s.block, r.emp.id, s.emp); }}
                              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && s.overlap) { e.preventDefault(); onOverlapSelect(s.block, r.emp.id, s.emp); } }}
```

- [ ] **Step 12: Dejar el popover de hover siempre visible (ya no se suprime por el panel)**

Buscar:

```tsx
      {/* Shared hover/focus popover (suppressed while the click-detail panel is open) */}
      {hover && !detail && (
```

Reemplazar por:

```tsx
      {/* Shared hover/focus popover */}
      {hover && (
```

- [ ] **Step 13: Eliminar el panel lateral de detalle**

Buscar el bloque JSX completo del panel y eliminarlo. Empieza en:

```tsx
      {/* Click-detail panel: every employee whose request overlaps the clicked block */}
      {detail && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDetail(null)} aria-hidden />
```

…y termina con el cierre de ese bloque `{detail && ( … )}`, es decir las líneas:

```tsx
            </div>
          </div>
        </>
      )}
```

Eliminar TODO desde el comentario `{/* Click-detail panel: … */}` hasta ese `)}` inclusive. **Conservar** el `    </div>` final (el que cierra el `<div className="space-y-3">` del componente) y el `  );` / `}` de cierre de la función.

- [ ] **Step 14: Limpiar imports que quedaron sin uso**

`useEffect` (sólo lo usaba el Escape) y `X` (sólo lo usaba el panel) quedan sin uso.

Buscar:

```tsx
import { useMemo, useState, useEffect } from 'react';
import { Search, Users, Loader2, Eye, EyeOff, X } from 'lucide-react';
```

Reemplazar por:

```tsx
import { useMemo, useState } from 'react';
import { Search, Users, Loader2, Eye, EyeOff } from 'lucide-react';
```

(`CAT_LABEL` sigue en uso en los chips de categorías — **no** quitarlo del import de `./shared`.)

- [ ] **Step 15: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores. Si TS marca algún símbolo sin uso (p. ej. `OverlapEntry`, `DetailState`, `X`, `useEffect`), confirmar que se eliminó según los Steps 8–14.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/components/calendario/CalendarioDetallado.tsx
git commit -m "feat(web): CalendarioDetallado (shared + tipo en tooltip + click-solape filtra, sin panel)"
```

---

## Task 9: Página orquestadora `CalendarioEquipoPage`

**Files:**
- Create: `apps/web/src/pages/CalendarioEquipoPage.tsx`

- [ ] **Step 1: Crear el orquestador**

Crear `apps/web/src/pages/CalendarioEquipoPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange, Lock, LayoutList, CalendarDays, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  type GanttData, type Bloque, calendarQueryKey, fetchCalendar, fmtDate, overlappingEmployeeIds,
} from '@/components/calendario/shared';
import CalendarioCompacto from '@/components/calendario/CalendarioCompacto';
import CalendarioDetallado from '@/components/calendario/CalendarioDetallado';

interface OverlapSel { block: Bloque; empId: string; empName: string; }

type Modo = 'compacto' | 'detallado';
const MODO_KEY = 'calendario-equipo-modo';
function loadModo(): Modo {
  try { return localStorage.getItem(MODO_KEY) === 'detallado' ? 'detallado' : 'compacto'; } catch { return 'compacto'; }
}

export default function CalendarioEquipoPage() {
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;
  const puedeVer = user?.puedeVerCalendario ?? false;

  const [anio, setAnio] = useState(new Date().getFullYear());
  const [sectorId, setSectorId] = useState('');
  const [modo, setModoState] = useState<Modo>(loadModo);
  const [overlap, setOverlap] = useState<OverlapSel | null>(null);
  const setModo = (m: Modo) => {
    setModoState(m);
    try { localStorage.setItem(MODO_KEY, m); } catch { /* ignore */ }
  };

  const { data, isLoading } = useQuery<GanttData>({
    queryKey: calendarQueryKey(anio, sectorId),
    queryFn: () => fetchCalendar(anio, sectorId),
    enabled: puedeVer,
  });

  // El filtro de solape deja de ser válido si cambia el año o el sector.
  useEffect(() => { setOverlap(null); }, [anio, sectorId]);

  // Datos pasados al subcomponente: con filtro activo, sólo el empleado clickeado
  // + los que se solapan con ese bloque.
  const viewData = useMemo<GanttData | undefined>(() => {
    if (!data || !overlap) return data;
    const ids = overlappingEmployeeIds(data.empleados, overlap.block, overlap.empId, anio);
    ids.add(overlap.empId);
    return { ...data, empleados: data.empleados.filter((e) => ids.has(e.id)) };
  }, [data, overlap, anio]);

  const overlapCount = viewData && overlap ? Math.max(0, viewData.empleados.length - 1) : 0;

  if (user && !puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
        <Lock className="h-10 w-10 mb-3 opacity-50" />
        <p>No tenés permisos para ver el calendario del equipo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar compartida: título + toggle de modo + sector (RRHH) + año */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-primary" />
          Calendario de Equipo
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setModo('compacto')}
              aria-pressed={modo === 'compacto'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                modo === 'compacto' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-4 w-4" /> Compacto
            </button>
            <button
              type="button"
              onClick={() => setModo('detallado')}
              aria-pressed={modo === 'detallado'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                modo === 'detallado' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <CalendarDays className="h-4 w-4" /> Detallado
            </button>
          </div>

          {isRRHH && (
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Todos los sectores</option>
              {data?.sectores.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1">
            <button onClick={() => setAnio((a) => a - 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[4ch] text-center tabular-nums">{anio}</span>
            <button onClick={() => setAnio((a) => a + 1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Año siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Banner del filtro de solape (ambos modos) */}
      {overlap && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-cal-rose/40 bg-cal-rose/10 px-3 py-2 text-sm">
          <span className="text-foreground">
            Mostrando a <span className="font-semibold">{overlap.empName}</span> y {overlapCount}{' '}
            {overlapCount === 1 ? 'persona que se solapa' : 'personas que se solapan'}
            <span className="text-muted-foreground"> ({fmtDate(overlap.block.fechaInicio)}–{fmtDate(overlap.block.fechaFin)})</span>
          </span>
          <button
            type="button"
            onClick={() => setOverlap(null)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted/50"
          >
            <X className="h-3.5 w-3.5" /> Mostrar todos
          </button>
        </div>
      )}

      {modo === 'compacto'
        ? <CalendarioCompacto data={viewData} anio={anio} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />
        : <CalendarioDetallado data={viewData} anio={anio} isLoading={isLoading} onOverlapSelect={(block, empId, empName) => setOverlap({ block, empId, empName })} />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CalendarioEquipoPage.tsx
git commit -m "feat(web): orquestador CalendarioEquipoPage (toggle persistido + filtro de solape)"
```

---

## Task 10: Ruta `/calendario` + redirects en `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Cambiar imports de páginas**

Buscar:

```tsx
import VacacionesGanttPage from '@/pages/VacacionesGanttPage';
import DisponibilidadPage from '@/pages/DisponibilidadPage';
```

Reemplazar por:

```tsx
import CalendarioEquipoPage from '@/pages/CalendarioEquipoPage';
```

- [ ] **Step 2: Cambiar las rutas (nueva + redirects)**

Buscar:

```tsx
              <Route path="/vacaciones/gantt" element={<VacacionesGanttPage />} />
              <Route path="/disponibilidad" element={<DisponibilidadPage />} />
```

Reemplazar por:

```tsx
              <Route path="/calendario" element={<CalendarioEquipoPage />} />
              <Route path="/vacaciones/gantt" element={<Navigate to="/calendario" replace />} />
              <Route path="/disponibilidad" element={<Navigate to="/calendario" replace />} />
```

(`Navigate` ya está importado de `react-router-dom` al inicio del archivo.)

- [ ] **Step 3: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): ruta /calendario + redirects de las rutas viejas"
```

---

## Task 11: Menú lateral — 2 ítems → 1 con `requireCalendarAccess`

**Files:**
- Modify: `apps/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Agregar el predicado a la interfaz `NavItem`**

Buscar:

```tsx
interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  minLevel?: number;
  requireApprover?: boolean;
}
```

Reemplazar por:

```tsx
interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  minLevel?: number;
  requireApprover?: boolean;
  requireCalendarAccess?: boolean;
}
```

- [ ] **Step 2: Reemplazar los dos ítems por uno**

Buscar:

```tsx
  { label: 'Calendario Vac.', path: '/vacaciones/gantt', icon: CalendarRange, minLevel: 70 },
  { label: 'Disponibilidad', path: '/disponibilidad', icon: LayoutGrid, minLevel: 70 },
```

Reemplazar por:

```tsx
  { label: 'Calendario de Equipo', path: '/calendario', icon: CalendarRange, requireCalendarAccess: true },
```

- [ ] **Step 3: Agregar la condición al filtro del nav**

Buscar:

```tsx
  const filteredNavItems = navItems.filter(
    (item) => {
      if (item.minLevel && (!user || (user.rolNivel ?? 0) < item.minLevel)) return false;
      if (item.requireApprover && canApprove === false) return false;
      return true;
    }
  );
```

Reemplazar por:

```tsx
  const filteredNavItems = navItems.filter(
    (item) => {
      if (item.minLevel && (!user || (user.rolNivel ?? 0) < item.minLevel)) return false;
      if (item.requireApprover && canApprove === false) return false;
      if (item.requireCalendarAccess && !user?.puedeVerCalendario) return false;
      return true;
    }
  );
```

- [ ] **Step 4: Quitar el import `LayoutGrid` si quedó sin uso**

`LayoutGrid` sólo se usaba en el ítem de Disponibilidad. Buscar en el import de `lucide-react` del archivo y quitar `LayoutGrid` de la lista (dejar el resto igual). Ejemplo, si aparece `LayoutGrid,` en el import, eliminarlo.

(Verificación: `grep -n "LayoutGrid" apps/web/src/components/layout/AppShell.tsx` debe quedar sin resultados tras la edición.)

- [ ] **Step 5: Typecheck**

Run: `cd "apps/web" && npx tsc -b`
Expected: sin errores (si `LayoutGrid` quedó importado sin uso, TS lo marcará → quitarlo).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/AppShell.tsx
git commit -m "feat(web): nav unificado 'Calendario de Equipo' con requireCalendarAccess"
```

---

## Task 12: Eliminar páginas viejas + verificación integral

**Files:**
- Delete: `apps/web/src/pages/VacacionesGanttPage.tsx`
- Delete: `apps/web/src/pages/DisponibilidadPage.tsx`

- [ ] **Step 1: Verificar que no queden referencias**

Run: `grep -rn "VacacionesGanttPage\|DisponibilidadPage" apps/web/src`
Expected: sin resultados (todas las referencias migraron en Task 10). Si aparece alguna, resolverla antes de borrar.

- [ ] **Step 2: Eliminar los archivos**

```bash
git rm "apps/web/src/pages/VacacionesGanttPage.tsx" "apps/web/src/pages/DisponibilidadPage.tsx"
```

- [ ] **Step 3: Typecheck + build de frontend**

Run: `cd "apps/web" && npm run build`
Expected: build OK, sin errores de tipos.

- [ ] **Step 4: Typecheck de API**

Run: `cd "apps/api" && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Re-correr el test del helper**

Run: `cd "apps/api" && npx tsx tests/calendario-access.test.ts`
Expected: `✓ calendario-access: 6/6 OK`

- [ ] **Step 6: Verificación manual en navegador (API + web levantadas)**

Con `apps/api` (`npm run dev`) y `apps/web` (`npm run dev`):
1. Login como COORDINADOR → aparece "Calendario de Equipo" en el menú; abre en modo Compacto.
2. Barras: una solicitud APROBADA se ve rellena; una EN_REVISION/PENDIENTE se ve rayada. Hover muestra el tipo exacto (p. ej. "Cert. médico").
3. Toggle a Detallado → grilla mes×día con búsqueda, turno, chips, solapes. Recargar la página → vuelve a abrir en Detallado (persistencia).
4. Cambiar año/sector no rompe; cambiar de modo NO dispara un refetch (1 sola request en Network por año/sector).
5. Navegar a `/vacaciones/gantt` y `/disponibilidad` → redirigen a `/calendario`.
6. Login como SUPERVISOR de un sector cuya cadena incluye paso SUPERVISOR → ve el ítem y su sector. Login como usuario cuyo sector NO lo incluye (o sin sector) → ítem oculto y `/calendario` muestra "sin permisos".
7. Solapes (compacto): una barra que coincide con la ausencia de otro empleado muestra contorno rosa; una barra sin coincidencia, no. Clic en la barra con solape → la lista queda con ese empleado + los que se solapan, aparece el banner. "Mostrar todos" restaura. Clic en una barra sin solape no filtra.
8. Solapes (detallado): mismo filtrado al clickear un tramo marcado; ya no aparece el panel lateral; el popover de hover sigue funcionando. El filtro se mantiene al togglear de modo y se limpia al cambiar año/sector.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(web): eliminar páginas VacacionesGantt y Disponibilidad (unificadas)"
```

---

## Self-Review (completado por el autor del plan)

**Cobertura del spec:**
- Página única + toggle de modo persistido → Tasks 9 (orquestador, localStorage).
- 5 categorías en ambos modos + tooltip con tipo exacto → Tasks 5 (shared CAT/TIPO_LABEL), 7 (compacto), 8 (detallado steps 6-7).
- Relleno/rayado por estado en ambos modos → Tasks 6 (CSS `.cal-estado`), 7 (compacto usa `cal-estado`), detallado ya lo tiene vía `.av-seg`.
- Compacto minimalista / detallado con todos los filtros → Tasks 9 (sector+año+toggle compartidos), 8 (detallado conserva búsqueda/turno/chips/solapes).
- Acceso por cadena de aprobación + flag → Tasks 1 (helper+test), 2 (gate /gantt), 3 (flag login/refresh/me), 4 (User store), 11 (nav predicate).
- Nav unificado + redirects → Tasks 10, 11.
- Eliminar páginas viejas → Task 12.
- Solapes marcados en ambos modos + filtrado por click → Tasks 5 (helpers `computeOverlapPeaks`/`overlappingEmployeeIds`), 6 (CSS `.cal-estado[data-overlap]`), 7 (compacto marca+click), 8 (detallado click→filtro, sin panel), 9 (orquestador: estado `overlap`, `viewData`, banner).

**Consistencia de tipos:** `puedeVerCalendario` (helper backend, payloads, store `User`, predicate nav) coherente. `GanttData`/`Empleado`/`Bloque`/`Cat`/`EmpDiagrama` provienen de `shared.ts` y los consumen compacto/detallado/orquestador con las mismas firmas. `tipoLabel`, `CAT`, `CAT_LABEL`, `catOf` exportados desde shared y usados consistentemente.

**Placeholders:** ninguno — cada paso muestra el código real o el comando exacto.
