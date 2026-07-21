# Marca manual de días en la planilla (plan B) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cargar manualmente sobre la planilla un día como compensatorio / falta justificada / injustificada / certificado médico / licencia especial cuando se olvidó el flujo formal de solicitud+aprobación, dejándolo plasmado en la planilla y validable por un superior.

**Architecture:** Cada marca manual crea una `Ausencia` real (`cargaManual=true`) ligada a la planilla que inyecta el día bloqueado reusando el mecanismo existente. El empleado marca → `PENDIENTE` (sin validar); un superior marca → `APROBADA` (auto-validada). El superior valida día por día o en lote; las marcas sin validar frenan la aprobación de la planilla (no el envío). El compensatorio exige saldo disponible.

**Tech Stack:** Node + Express + Prisma (PostgreSQL) en `apps/api`; React + TanStack Query + Zustand en `apps/web`. Tests: suites HTTP black-box en `apps/api/tests/qa/*.qa.ts` corridas con `tsx` contra la API viva en `localhost:4000`.

**Spec:** `docs/superpowers/specs/2026-07-21-marca-manual-dias-planilla-design.md`

---

## Mapa de archivos

**Backend (`apps/api`):**
- `prisma/schema.prisma` — MODIFICAR: `Ausencia.cargaManual`, `RegistroHoras.marcaManualId` + relación.
- `src/utils/user-scope.utils.ts` — CREAR: `canManageUser` extraído (hoy duplicado en ausencias).
- `src/routes/ausencias.routes.ts` — MODIFICAR: importar `canManageUser` del util (borrar copia local).
- `src/utils/ausencia-calendar.utils.ts` — MODIFICAR: `inyectarDiasBloqueados` acepta `marcaManualId?`.
- `src/routes/planillas.routes.ts` — MODIFICAR: endpoints `marcar-dia`, `marcas/:ausenciaId/validar`, `marcas/validar-todo`, `DELETE marcas/:ausenciaId`; gating en `/avanzar`; `include` de `marcaManual` en `GET /:id`.
- `tests/qa/marca-manual.qa.ts` — CREAR: suite de integración.

**Frontend (`apps/web`):**
- `src/pages/planillas/PlanillaDetailPage.tsx` — MODIFICAR: tipo `Registro.marcaManual`, menú "Marcar día especial", chip "Sin validar", validar/rechazar/quitar, "Aprobar todas las marcas", deshabilitar aprobar con marcas pendientes.

**Convención de tests (leer antes de empezar):** las suites QA son scripts `tsx` que pegan HTTP contra `http://localhost:4000/api/v1` con un harness propio (`scenario`/`assert`/`login`/`get`/`post`). No hay runner por-test: se corre la suite entera y se observan los `PASS/FAIL`. El ciclo TDD acá es: agregar los `scenario(...)` de la tarea → correr la suite → ver los nuevos FAIL (404/endpoint faltante) → implementar → correr → ver PASS. Requiere el server dev corriendo (`cd apps/api && npm run dev`) y la DB migrada.

---

## Task 1: Migración de schema (Ausencia.cargaManual + RegistroHoras.marcaManualId)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Ausencia` ~546-577, model `RegistroHoras` ~418-452)

- [ ] **Step 1: Agregar campos al model `Ausencia`**

En `apps/api/prisma/schema.prisma`, dentro de `model Ausencia`, después de la línea `aprobadaAt DateTime? @map("aprobada_at")` agregar el campo escalar:

```prisma
  cargaManual         Boolean        @default(false) @map("carga_manual")
```

Y en la sección de relaciones de `Ausencia` (después de `historial   AusenciaHistorial[]`) agregar la back-relation:

```prisma
  registrosMarcados   RegistroHoras[]      @relation("registro_marca_manual")
```

- [ ] **Step 2: Agregar campos al model `RegistroHoras`**

En `model RegistroHoras`, después de `proyectoId String? @map("proyecto_id")` agregar:

```prisma
  marcaManualId         String?       @map("marca_manual_id")
```

Y en la sección de relaciones de `RegistroHoras` (después de `proyecto Proyecto? @relation(...)`) agregar:

```prisma
  marcaManual Ausencia? @relation("registro_marca_manual", fields: [marcaManualId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: Crear la migración y regenerar el cliente**

Run:
```bash
cd apps/api && npx prisma migrate dev --name marca_manual
```
Expected: crea `prisma/migrations/<timestamp>_marca_manual/migration.sql` con `ALTER TABLE "ausencias" ADD COLUMN "carga_manual"` y `ALTER TABLE "registros_horas" ADD COLUMN "marca_manual_id"` + FK, y `✔ Generated Prisma Client`.

- [ ] **Step 4: Verificar que compila**

Run:
```bash
cd apps/api && npx tsc --noEmit
```
Expected: sin errores (los tipos nuevos `cargaManual` / `marcaManualId` / `marcaManual` existen en el cliente).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): campos para marca manual de días (Ausencia.cargaManual, RegistroHoras.marcaManualId)"
```

---

## Task 2: Extraer `canManageUser` a un util compartido

**Files:**
- Create: `apps/api/src/utils/user-scope.utils.ts`
- Modify: `apps/api/src/routes/ausencias.routes.ts:49-70` (borrar la función local) y sus imports.

- [ ] **Step 1: Crear el util**

Crear `apps/api/src/utils/user-scope.utils.ts` con exactamente el mismo comportamiento que la función local actual:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Whether `actor` (por id + nivel de rol) puede gestionar al empleado `targetUserId`
 * dentro de la misma empresa: RRHH/ADMIN (nivel>=90) siempre; supervisor/coordinador
 * directo; o coordinador+ (nivel>=70) del mismo sector.
 */
export async function canManageUser(
  actorId: string,
  actorNivel: number,
  targetUserId: string,
  empresaId: string,
): Promise<boolean> {
  if (actorNivel >= 90) return true; // RRHH/ADMIN can manage anyone

  const target = await prisma.usuario.findUnique({
    where: { id: targetUserId },
    select: { empresaId: true, supervisorId: true, coordinadorId: true, sectorId: true },
  });
  if (!target || target.empresaId !== empresaId) return false;

  if (target.supervisorId === actorId || target.coordinadorId === actorId) return true;

  if (actorNivel >= 70 && target.sectorId) {
    const actor = await prisma.usuario.findUnique({ where: { id: actorId }, select: { sectorId: true } });
    if (actor?.sectorId === target.sectorId) return true;
  }

  return false;
}
```

- [ ] **Step 2: Reemplazar la función local en `ausencias.routes.ts` por el import**

En `apps/api/src/routes/ausencias.routes.ts`, borrar el bloque de la función local `canManageUser` (líneas ~49-70, desde el comentario `// ─── Helper: check if user can manage target employee` hasta el cierre de la función) y agregar el import junto a los demás utils del encabezado:

```ts
import { canManageUser } from '../utils/user-scope.utils.js';
```

- [ ] **Step 3: Verificar que compila**

Run:
```bash
cd apps/api && npx tsc --noEmit
```
Expected: sin errores (las llamadas existentes a `canManageUser(...)` resuelven al import).

- [ ] **Step 4: Regresión — correr la suite de ausencias**

Con el server dev corriendo (`cd apps/api && npm run dev` en otra terminal):
```bash
cd apps/api && npx tsx tests/qa/ausencias.qa.ts
```
Expected: los escenarios F3 (owner-supervisor direct-create → 201) y F4 (unrelated supervisor → 403) siguen en PASS — confirma que `canManageUser` no cambió de comportamiento.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/user-scope.utils.ts apps/api/src/routes/ausencias.routes.ts
git commit -m "refactor(api): extraer canManageUser a utils/user-scope.utils"
```

---

## Task 3: `inyectarDiasBloqueados` acepta `marcaManualId`

**Files:**
- Modify: `apps/api/src/utils/ausencia-calendar.utils.ts:14-81`

- [ ] **Step 1: Extender la interfaz `AusenciaRange`**

En `apps/api/src/utils/ausencia-calendar.utils.ts`, agregar el campo opcional:

```ts
interface AusenciaRange {
  usuarioId: string;
  fechaInicio: Date;
  fechaFin: Date;
  motivoBloqueo: string;
  observaciones: string;
  marcaManualId?: string;
}
```

- [ ] **Step 2: Setear `marcaManualId` en el upsert de `inyectarDiasBloqueados`**

Dentro del `prisma.registroHoras.upsert(...)` de `inyectarDiasBloqueados`, agregar `marcaManualId: range.marcaManualId ?? null,` tanto en el objeto `update` como en el `create` (junto a `motivoBloqueo`). Queda:

```ts
      update: {
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        // Zero out hours — absence days have no worked hours
        entradaTurno1: null,
        salidaTurno1: null,
        entradaTurno2: null,
        salidaTurno2: null,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        lugarTrabajo: null,
      },
      create: {
        planillaId: planilla.id,
        fecha: day,
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        horasViajeInput: ZERO,
      },
```

(El flujo formal no pasa `marcaManualId`, así que sus inyecciones siguen con `marcaManualId=null` — comportamiento intacto.)

- [ ] **Step 3: Exportar `formatTipoAusencia` (ya exportada) — verificar import disponible**

`formatTipoAusencia` ya está exportada al final del archivo. No requiere cambios.

- [ ] **Step 4: Verificar que compila**

Run:
```bash
cd apps/api && npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/ausencia-calendar.utils.ts
git commit -m "feat(api): inyectarDiasBloqueados acepta marcaManualId opcional"
```

---

## Task 4: Endpoint `POST /planillas/:id/marcar-dia` + scaffold de la suite QA

**Files:**
- Create: `apps/api/tests/qa/marca-manual.qa.ts`
- Modify: `apps/api/src/routes/planillas.routes.ts` (imports del encabezado + nuevo handler antes de `export default router`)

- [ ] **Step 1: Crear el scaffold de la suite QA con los primeros escenarios (fallarán)**

Crear `apps/api/tests/qa/marca-manual.qa.ts`:

```ts
/**
 * QA Suite — MARCA MANUAL de días en planilla (KEY=marca-manual)
 * Black-box HTTP contra la API viva.
 * Run: cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
 */
const BASE = 'http://localhost:4000/api/v1';
const KEY = 'marca-manual';
const TS = Date.now();

const C: Record<string, string> = { RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m', YELLOW: '\x1b[33m', CYAN: '\x1b[36m' };
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.RESET}`; }
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanupQueue: Array<() => Promise<void>> = [];
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, passed: true, detail: 'OK' }); process.stdout.write(`  ${col('GREEN','PASS')} ${name}\n`); }
  catch (e: unknown) { const detail = e instanceof Error ? e.message : String(e); results.push({ name, passed: false, detail }); process.stdout.write(`  ${col('RED','FAIL')} ${name} — ${detail}\n`); }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') { if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`); }
function info(msg: string) { process.stdout.write(`    ${col('DIM','· ' + msg)}\n`); }

async function apiCall(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
const get = (p: string, tok?: string) => apiCall('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => apiCall('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => apiCall('PUT', p, { token: tok, body: b });
const del = (p: string, tok?: string) => apiCall('DELETE', p, { token: tok });

interface Session { token: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  return { token: body.accessToken, user: body.user };
}
function fmtDateTime(d: Date) { return d.toISOString(); }
async function getCompSaldo(tok: string): Promise<{ acum: number; usados: number; pend: number; disp: number }> {
  const { body } = await get('/vacacion-saldos/mi-saldo', tok);
  return { acum: body.compensatoriosAcumulados, usados: body.compensatoriosUsados, pend: body.compensatoriosPendientes, disp: body.compensatoriosDisponible };
}
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

async function main() {
  console.log(col('CYAN', `\n═══ QA MARCA MANUAL suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const ana = await login('ana.martinez@demo.com'); // RRHH nivel 90

  const ingreso = fmtDateTime(new Date('2020-01-01T00:00:00Z'));
  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Marca${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, ...extra,
    }, ana.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  let supId = '', ownerId = '', otherSupId = '';
  await scenario('SETUP supervisor', async () => { supId = await createUser('SUPERVISOR', 'sup'); });
  await scenario('SETUP owner OPERADOR (supervisorId=sup)', async () => { ownerId = await createUser('OPERADOR', 'owner', { supervisorId: supId }); });
  await scenario('SETUP unrelated supervisor', async () => { otherSupId = await createUser('SUPERVISOR', 'othersup'); });
  cleanupQueue.push(async () => { for (const id of [ownerId, supId, otherSupId]) if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {}); });

  const owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
  const sup = await login(`qa.${KEY}.${TS}.sup@demo.com`);
  const otherSup = await login(`qa.${KEY}.${TS}.othersup@demo.com`);

  // Seed owner compensatorio saldo (acumulados=3) for the marked year
  const compYear = 2026;
  let saldoId = '';
  await scenario('SETUP seed owner compensatorio saldo (acumulados=3)', async () => {
    await get('/vacacion-saldos/mi-saldo', owner.token);
    const { body } = await get(`/vacacion-saldos?anio=${compYear}`, ana.token);
    const s = (body as any[]).find(x => x.usuarioId === ownerId);
    assert(!!s, `owner saldo for ${compYear} not found`);
    saldoId = s.id;
    const { status } = await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 3, compensatoriosUsados: 0 }, ana.token);
    assertStatus(status, 200, 'seed saldo');
  });
  cleanupQueue.push(async () => { if (saldoId) await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, ana.token).catch(() => {}); });

  // Helper: create a planilla for a distinct 1-day period (avoids overlap collisions)
  const createdPlanillas: string[] = [];
  cleanupQueue.push(async () => { for (const id of createdPlanillas) await del(`/planillas/${id}`, owner.token).catch(() => {}); });
  async function nuevaPlanilla(fecha: string): Promise<string> {
    const { status, body } = await post('/planillas', { periodoInicio: fecha, periodoFin: fecha }, owner.token);
    assertStatus(status, 201, `crear planilla ${fecha}: ${JSON.stringify(body)}`);
    createdPlanillas.push(body.id);
    return body.id as string;
  }

  // ═══ A. marcar-dia: auth + validación ═══
  await scenario('A1 owner marca FALTA_JUSTIFICADA → 201 PENDIENTE + registro bloqueado + marcaManual', async () => {
    const pid = await nuevaPlanilla('2026-11-03');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-03', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.bloqueado === true, `bloqueado=${body.bloqueado}`);
    assert(body.motivoBloqueo === 'FALTA_JUSTIFICADA', `motivo=${body.motivoBloqueo}`);
    assert(body.marcaManual && body.marcaManual.estado === 'PENDIENTE', `marcaManual=${JSON.stringify(body.marcaManual)}`);
    assert(body.marcaManual.tipo === 'FALTA_JUSTIFICADA', `tipo=${body.marcaManual?.tipo}`);
  });
  await scenario('A2 supervisor marca FALTA_JUSTIFICADA → 201 APROBADA (auto-validada)', async () => {
    const pid = await nuevaPlanilla('2026-11-04');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-04', tipo: 'FALTA_JUSTIFICADA' }, sup.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual && body.marcaManual.estado === 'APROBADA', `estado=${body.marcaManual?.estado}`);
  });
  await scenario('A3 unrelated supervisor marca → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-05');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-05', tipo: 'FALTA_JUSTIFICADA' }, otherSup.token);
    assertStatus(status, 403, 'unrelated sup');
  });
  await scenario('A4 fecha fuera del período → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-06');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-01', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    assertStatus(status, 400, 'fuera de período');
  });
  await scenario('A5 tipo inválido → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-07');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-07', tipo: 'NOPE' }, owner.token);
    assertStatus(status, 400, 'bad tipo');
  });
  await scenario('A6 marcar un día ya marcado → 409', async () => {
    const pid = await nuevaPlanilla('2026-11-08');
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-08', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-08', tipo: 'LICENCIA_ESPECIAL' }, owner.token);
    assertStatus(status, 409, 'ya bloqueado');
  });

  // ═══ B. compensatorio: saldo ═══
  await scenario('B1 owner marca FRANCO_COMPENSATORIO con saldo → 201, pendientes +1', async () => {
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-10');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-10', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual.estado === 'PENDIENTE', `estado=${body.marcaManual?.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 1, `pendientes ${before.pend}→${after.pend} (esperado +1)`);
  });
  await scenario('B2 supervisor marca FRANCO_COMPENSATORIO → 201 APROBADA, usados +1', async () => {
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-11');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-11', tipo: 'FRANCO_COMPENSATORIO' }, sup.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual.estado === 'APROBADA', `estado=${body.marcaManual?.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.usados === before.usados + 1, `usados ${before.usados}→${after.usados} (esperado +1)`);
  });
  await scenario('B3 compensatorio sin saldo disponible → 400', async () => {
    // acumulados=3; ya reservado/usado 2 (B1 pend + B2 usado). Consumir el restante y pedir uno más.
    const s1 = await getCompSaldo(owner.token);
    info(`saldo antes: acum=${s1.acum} usados=${s1.usados} pend=${s1.pend} disp=${s1.disp}`);
    const pid = await nuevaPlanilla('2026-11-12');
    // disp=1 → marcar consume el último
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-12', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    const pid2 = await nuevaPlanilla('2026-11-13');
    const { status, body } = await post(`/planillas/${pid2}/marcar-dia`, { fecha: '2026-11-13', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/insuficiente/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });

  // ── Resumen ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n═══ RESULTS: ${passed}/${results.length} passed, ${failed} failed ═══`));
  if (failed) { console.log(col('YELLOW', 'Failed:')); results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`)); }
  console.log(col('DIM', '\nCleaning up...'));
  for (const fn of cleanupQueue.reverse()) { await fn().catch(() => {}); }
  console.log('\n__RESULT_JSON__' + JSON.stringify({ passed, failed, total: results.length }));
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
```

- [ ] **Step 2: Correr la suite y verificar que A/B fallan**

Con el server dev corriendo:
```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: los SETUP pasan; A1–A6 y B1–B3 fallan (HTTP 404 — `marcar-dia` no existe).

- [ ] **Step 3: Agregar imports en `planillas.routes.ts`**

En el encabezado de `apps/api/src/routes/planillas.routes.ts`:
- Cambiar la import de `@prisma/client` para incluir `Prisma` y `AusenciaTipo`:
```ts
import { PrismaClient, PlanillaEstado, LugarTrabajo, PernocteEnum, Prisma, AusenciaTipo } from '@prisma/client';
```
- Cambiar la import de utils de ausencia para incluir `inyectarDiasBloqueados` y `formatTipoAusencia`:
```ts
import { backfillAusenciasEnPlanilla, inyectarDiasBloqueados, formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
```
- Agregar:
```ts
import { logAuditoria } from '../lib/auditoria.js';
import { canManageUser } from '../utils/user-scope.utils.js';
```

- [ ] **Step 4: Implementar el handler `POST /:id/marcar-dia`**

Justo antes de `export default router;` en `planillas.routes.ts`, agregar:

```ts
// ═══════════════════════════════════════════════════
// MARCAS MANUALES DE DÍAS (plan B)
// ═══════════════════════════════════════════════════

const ESTADOS_OWNER = ['BORRADOR', 'RECHAZADA'];
const ESTADOS_MANAGER = ['BORRADOR', 'RECHAZADA', 'ENVIADA', 'EN_REVISION'];

const marcarDiaSchema = z.object({
  fecha: fechaFlexible,
  tipo: z.nativeEnum(AusenciaTipo),
  descripcion: z.string().max(500).optional(),
});

function ymd(d: Date): string { return d.toISOString().split('T')[0]; }

// ─── POST /planillas/:id/marcar-dia ──────────────
router.post('/:id/marcar-dia', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = marcarDiaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }
    const planillaId = req.params.id as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;
    const empresaId = req.user!.empresaId;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    const isOwner = planilla.usuarioId === actorId;
    const isManager = !isOwner && await canManageUser(actorId, actorNivel, planilla.usuarioId, empresaId);
    if (!isOwner && !isManager) {
      res.status(403).json({ error: 'No autorizado para marcar días en esta planilla' });
      return;
    }

    const allowed = isOwner ? ESTADOS_OWNER : ESTADOS_MANAGER;
    if (!allowed.includes(planilla.estado)) {
      res.status(400).json({ error: `No se puede marcar días con la planilla en estado ${planilla.estado}` });
      return;
    }

    const fecha = new Date(parsed.data.fecha);
    fecha.setHours(0, 0, 0, 0);
    const ini = new Date(planilla.periodoInicio); ini.setHours(0, 0, 0, 0);
    const fin = new Date(planilla.periodoFin); fin.setHours(0, 0, 0, 0);
    if (fecha < ini || fecha > fin) {
      res.status(400).json({ error: 'La fecha está fuera del período de la planilla' });
      return;
    }

    // El día no debe estar ya bloqueado (ausencia formal, vacación u otra marca)
    const existingReg = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId, fecha } },
    });
    if (existingReg?.bloqueado) {
      res.status(409).json({ error: `El día ya está bloqueado (${existingReg.motivoBloqueo ?? 'ausencia/vacación'})` });
      return;
    }

    const tipo = parsed.data.tipo;
    const anio = fecha.getFullYear();
    const autoValidada = isManager;

    let ausencia;
    try {
      ausencia = await prisma.$transaction(async (tx) => {
        if (tipo === 'FRANCO_COMPENSATORIO') {
          const saldo = await tx.vacacionSaldo.findUnique({ where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } } });
          const disponible = (saldo?.compensatoriosAcumulados ?? 0) - (saldo?.compensatoriosUsados ?? 0) - (saldo?.compensatoriosPendientes ?? 0);
          if (disponible < 1) throw Object.assign(new Error('SALDO_COMPENSATORIO_INSUFICIENTE'), { disponible });
          await tx.vacacionSaldo.upsert({
            where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
            update: { compensatoriosPendientes: { increment: 1 } },
            create: { usuarioId: planilla.usuarioId, anio, diasCorrespondientes: 0, compensatoriosPendientes: 1 },
          });
        }

        const aus = await tx.ausencia.create({
          data: {
            usuarioId: planilla.usuarioId,
            cargadaPorId: actorId,
            planillaId,
            cargaManual: true,
            tipo,
            estado: autoValidada ? 'APROBADA' : 'PENDIENTE',
            pasoActual: 0,
            fechaInicio: fecha,
            fechaFin: fecha,
            diasAusencia: 1,
            descripcion: parsed.data.descripcion ?? null,
            descuentaSueldo: tipo === 'FALTA_INJUSTIFICADA',
            porcentajeDescuento: tipo === 'FALTA_INJUSTIFICADA' ? 100 : 0,
            requiereAprobacion: !autoValidada,
            aprobada: autoValidada,
            ...(autoValidada ? { aprobadaPorId: actorId, aprobadaAt: new Date() } : {}),
            flujoId: null,
          },
        });

        await tx.ausenciaHistorial.create({
          data: {
            ausenciaId: aus.id,
            usuarioId: actorId,
            estadoNuevo: autoValidada ? 'APROBADA' : 'PENDIENTE',
            comentario: autoValidada ? 'Marca manual (auto-validada por superior)' : 'Marca manual del empleado (sin validar)',
          },
        });

        if (autoValidada && tipo === 'FRANCO_COMPENSATORIO') {
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: planilla.usuarioId, anio } },
            data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
          });
        }

        return aus;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err: any) {
      if (err?.message === 'SALDO_COMPENSATORIO_INSUFICIENTE') {
        res.status(400).json({ error: `Saldo de compensatorios insuficiente. Disponible: ${err.disponible} días` });
        return;
      }
      if ((err as { code?: string }).code === 'P2034') {
        res.status(409).json({ error: 'Conflicto de transacción, intente de nuevo' });
        return;
      }
      throw err;
    }

    // Inyectar/reemplazar el día bloqueado, ligado a la marca
    const tipoLabel = formatTipoAusencia(tipo);
    await inyectarDiasBloqueados({
      usuarioId: planilla.usuarioId,
      fechaInicio: fecha,
      fechaFin: fecha,
      motivoBloqueo: tipo,
      observaciones: `${tipoLabel} (marca manual)${parsed.data.descripcion ? ` — ${parsed.data.descripcion}` : ''}`,
      marcaManualId: ausencia.id,
    });

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({
      entidad: 'Ausencia', entidadId: ausencia.id, accion: 'CREAR',
      descripcion: `Marca manual ${tipo} ${ymd(fecha)}${autoValidada ? ' (validada)' : ' (sin validar)'}`,
      usuarioId: actorId,
    });

    const registro = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId, fecha } },
      include: { marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true } } },
    });
    res.status(201).json(registro);
  } catch (error) {
    console.error('Error marcando día:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Step 5: Correr la suite y verificar A/B en PASS**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: A1–A6 y B1–B3 en PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): POST /planillas/:id/marcar-dia (marca manual plan B) + suite QA"
```

---

## Task 5: Endpoints de validación (`validar` y `validar-todo`)

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts` (nuevos handlers tras `marcar-dia`)
- Modify: `apps/api/tests/qa/marca-manual.qa.ts` (nuevos escenarios en `main`, antes del bloque `// ── Resumen ──`)

- [ ] **Step 1: Agregar escenarios de validación (fallarán)**

En `main()`, antes de `// ── Resumen ──`, agregar:

```ts
  // ═══ C. validar ═══
  await scenario('C1 owner no puede validar su propia marca → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-15');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-15', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, owner.token);
    assertStatus(status, 403, 'owner self-validate');
  });
  await scenario('C2 supervisor valida marca pendiente del owner → 200 APROBADA', async () => {
    const pid = await nuevaPlanilla('2026-11-16');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-16', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status, body } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
  });
  await scenario('C3 unrelated supervisor valida → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-17');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-17', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, otherSup.token);
    assertStatus(status, 403, 'unrelated validate');
  });
  await scenario('C4 validar una marca ya APROBADA → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-18');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-18', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 400, 'no pendiente');
  });
  await scenario('C5 validar-todo valida todas las pendientes → 200', async () => {
    // planilla de rango de 3 días para varias marcas
    const { status: ps, body: pb } = await post('/planillas', { periodoInicio: '2026-11-20', periodoFin: '2026-11-22' }, owner.token);
    assertStatus(ps, 201, JSON.stringify(pb)); createdPlanillas.push(pb.id);
    await post(`/planillas/${pb.id}/marcar-dia`, { fecha: '2026-11-20', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pb.id}/marcar-dia`, { fecha: '2026-11-21', tipo: 'FALTA_INJUSTIFICADA' }, owner.token);
    const { status, body } = await post(`/planillas/${pb.id}/marcas/validar-todo`, {}, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.validadas === 2, `validadas=${body.validadas}`);
  });
  await scenario('C6 validar compensatorio pendiente → usados +1, pendientes -1', async () => {
    // reset saldo a acum=2 usados=0 para tener disponible
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-24');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-24', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    const midPend = (await getCompSaldo(owner.token)).pend;
    assert(midPend === before.pend + 1, `pend tras marcar ${before.pend}→${midPend}`);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 200, 'validar comp');
    const after = await getCompSaldo(owner.token);
    assert(after.pend === midPend - 1 && after.usados === before.usados + 1, `pend ${midPend}→${after.pend} usados ${before.usados}→${after.usados}`);
  });
```

- [ ] **Step 2: Correr la suite y ver C1–C6 fallar**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: C1–C6 fallan (404 — endpoints inexistentes).

- [ ] **Step 3: Implementar `validar` y `validar-todo`**

En `planillas.routes.ts`, tras el handler `marcar-dia`, agregar:

```ts
// ─── POST /planillas/:id/marcas/:ausenciaId/validar ──────
router.post('/:id/marcas/:ausenciaId/validar', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.usuarioId === actorId) {
      res.status(403).json({ error: 'No podés validar tus propias marcas' });
      return;
    }
    if (!await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId)) {
      res.status(403).json({ error: 'No autorizado para validar marcas de este empleado' });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }
    if (ausencia.estado !== 'PENDIENTE') {
      res.status(400).json({ error: 'La marca no está pendiente de validación' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.ausencia.update({
        where: { id: ausenciaId },
        data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: actorId, aprobadaAt: new Date() },
      });
      await tx.ausenciaHistorial.create({
        data: { ausenciaId, usuarioId: actorId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'APROBADA', comentario: 'Marca manual validada' },
      });
      if (ausencia.tipo === 'FRANCO_COMPENSATORIO') {
        const anio = new Date(ausencia.fechaInicio).getFullYear();
        await tx.vacacionSaldo.update({
          where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } },
          data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
        });
      }
    });

    await logAuditoria({ entidad: 'Ausencia', entidadId: ausenciaId, accion: 'EDITAR', campo: 'estado', valorAnterior: 'PENDIENTE', valorNuevo: 'APROBADA', descripcion: 'Marca manual validada', usuarioId: actorId });
    const updated = await prisma.ausencia.findUnique({ where: { id: ausenciaId } });
    res.json(updated);
  } catch (error) {
    console.error('Error validando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── POST /planillas/:id/marcas/validar-todo ─────────────
router.post('/:id/marcas/validar-todo', requireLevel(LEVEL_SUPERVISOR), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }
    if (planilla.usuarioId === actorId) {
      res.status(403).json({ error: 'No podés validar tus propias marcas' });
      return;
    }
    if (!await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId)) {
      res.status(403).json({ error: 'No autorizado para validar marcas de este empleado' });
      return;
    }

    const pendientes = await prisma.ausencia.findMany({ where: { planillaId, cargaManual: true, estado: 'PENDIENTE' } });
    if (pendientes.length === 0) { res.json({ validadas: 0 }); return; }

    await prisma.$transaction(async (tx) => {
      for (const aus of pendientes) {
        await tx.ausencia.update({
          where: { id: aus.id },
          data: { estado: 'APROBADA', aprobada: true, aprobadaPorId: actorId, aprobadaAt: new Date() },
        });
        await tx.ausenciaHistorial.create({
          data: { ausenciaId: aus.id, usuarioId: actorId, estadoAnterior: 'PENDIENTE', estadoNuevo: 'APROBADA', comentario: 'Marca manual validada (lote)' },
        });
        if (aus.tipo === 'FRANCO_COMPENSATORIO') {
          const anio = new Date(aus.fechaInicio).getFullYear();
          await tx.vacacionSaldo.update({
            where: { usuarioId_anio: { usuarioId: aus.usuarioId, anio } },
            data: { compensatoriosPendientes: { decrement: 1 }, compensatoriosUsados: { increment: 1 } },
          });
        }
      }
    });

    await logAuditoria({ entidad: 'Planilla', entidadId: planillaId, accion: 'EDITAR', descripcion: `Validó ${pendientes.length} marca(s) manual(es) en lote`, usuarioId: actorId });
    res.json({ validadas: pendientes.length });
  } catch (error) {
    console.error('Error validando marcas en lote:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Step 4: Correr la suite y ver C1–C6 en PASS**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: C1–C6 PASS (con A/B intactos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): validar y validar-todo marcas manuales (+ saldo compensatorio)"
```

---

## Task 6: `DELETE /planillas/:id/marcas/:ausenciaId` (quitar / rechazar)

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts` (handler tras `validar-todo`)
- Modify: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Agregar escenarios (fallarán)**

En `main()`, antes de `// ── Resumen ──`:

```ts
  // ═══ D. quitar / rechazar ═══
  await scenario('D1 owner quita su marca PENDIENTE → 204, día desbloqueado', async () => {
    const pid = await nuevaPlanilla('2026-11-26');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-26', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 204, 'quitar');
    const { body: pl } = await get(`/planillas/${pid}`, owner.token);
    const dia = (pl.registros as any[]).find(r => r.fecha.startsWith('2026-11-26'));
    assert(!dia || dia.bloqueado === false, `día sigue bloqueado: ${JSON.stringify(dia)}`);
  });
  await scenario('D2 owner NO puede quitar una marca ya APROBADA → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-27');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-27', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 400, 'owner reject aprobada');
  });
  await scenario('D3 supervisor rechaza marca APROBADA → 200 RECHAZADA, día desbloqueado', async () => {
    const pid = await nuevaPlanilla('2026-11-28');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-28', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status, body } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'RECHAZADA', `estado=${body.estado}`);
  });
  await scenario('D4 rechazar compensatorio PENDIENTE libera pendientes (-1)', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-29');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-29', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assert((await getCompSaldo(owner.token)).pend === before.pend + 1, 'reservó pendiente');
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 200, 'rechazar comp');
    assert((await getCompSaldo(owner.token)).pend === before.pend, 'liberó pendiente');
  });
```

- [ ] **Step 2: Correr y ver D1–D4 fallar**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: D1–D4 fallan (404 — DELETE inexistente).

- [ ] **Step 3: Implementar el DELETE**

Tras `validar-todo` en `planillas.routes.ts`:

```ts
// ─── DELETE /planillas/:id/marcas/:ausenciaId ────────────
// Dueño: quita su marca PENDIENTE (elimina la fila). Superior: rechaza (RECHAZADA).
router.delete('/:id/marcas/:ausenciaId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const planillaId = req.params.id as string;
    const ausenciaId = req.params.ausenciaId as string;
    const actorId = req.user!.userId;
    const actorNivel = req.user!.rolNivel ?? 0;

    const planilla = await prisma.planilla.findUnique({
      where: { id: planillaId },
      include: { usuario: { select: { id: true, empresaId: true } } },
    });
    if (!planilla || planilla.usuario.empresaId !== req.user!.empresaId) {
      res.status(404).json({ error: 'Planilla no encontrada' });
      return;
    }

    const ausencia = await prisma.ausencia.findFirst({ where: { id: ausenciaId, planillaId, cargaManual: true } });
    if (!ausencia) {
      res.status(404).json({ error: 'Marca no encontrada' });
      return;
    }

    const isOwner = planilla.usuarioId === actorId;
    const isManager = !isOwner && actorNivel >= LEVEL_SUPERVISOR && await canManageUser(actorId, actorNivel, planilla.usuarioId, req.user!.empresaId);
    if (!isOwner && !isManager) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }

    if (isOwner) {
      if (!ESTADOS_OWNER.includes(planilla.estado)) {
        res.status(400).json({ error: `No se puede quitar marcas con la planilla en estado ${planilla.estado}` });
        return;
      }
      if (ausencia.estado !== 'PENDIENTE') {
        res.status(400).json({ error: 'Solo podés quitar marcas sin validar' });
        return;
      }
    }

    const anio = new Date(ausencia.fechaInicio).getFullYear();

    await prisma.$transaction(async (tx) => {
      // Liberar saldo comp. reservado/usado
      if (ausencia.tipo === 'FRANCO_COMPENSATORIO') {
        if (ausencia.estado === 'APROBADA') {
          await tx.vacacionSaldo.update({ where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } }, data: { compensatoriosUsados: { decrement: 1 } } });
        } else if (ausencia.estado === 'PENDIENTE') {
          await tx.vacacionSaldo.update({ where: { usuarioId_anio: { usuarioId: ausencia.usuarioId, anio } }, data: { compensatoriosPendientes: { decrement: 1 } } });
        }
      }
      // Des-inyectar: eliminar el/los registro(s) del día ligados a la marca (mientras el link existe)
      await tx.registroHoras.deleteMany({ where: { planillaId, marcaManualId: ausenciaId } });
      // Dueño: elimina la fila. Superior: la deja RECHAZADA para traza.
      if (isOwner) {
        await tx.ausencia.delete({ where: { id: ausenciaId } });
      } else {
        await tx.ausencia.update({
          where: { id: ausenciaId },
          data: { estado: 'RECHAZADA', aprobada: false, obsRechazo: (req.body?.motivo as string) ?? 'Marca rechazada' },
        });
        await tx.ausenciaHistorial.create({
          data: { ausenciaId, usuarioId: actorId, estadoAnterior: ausencia.estado, estadoNuevo: 'RECHAZADA', comentario: (req.body?.motivo as string) ?? 'Marca manual rechazada' },
        });
      }
    });

    await recalcularTotalesPlanilla(planillaId);
    await logAuditoria({ entidad: 'Ausencia', entidadId: ausenciaId, accion: isOwner ? 'ELIMINAR' : 'EDITAR', descripcion: isOwner ? 'Marca manual quitada por el dueño' : 'Marca manual rechazada', usuarioId: actorId });

    if (isOwner) {
      res.status(204).send();
    } else {
      const updated = await prisma.ausencia.findUnique({ where: { id: ausenciaId } });
      res.json(updated);
    }
  } catch (error) {
    console.error('Error quitando/rechazando marca:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Step 4: Correr y ver D1–D4 en PASS**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: D1–D4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): quitar/rechazar marca manual (des-inyecta día + libera saldo)"
```

---

## Task 7: Gating en `/avanzar` + `marcaManual` en `GET /planillas/:id`

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts` (`GET /:id` include ~279-284; `/avanzar` guard ~487-490)
- Modify: `apps/api/tests/qa/marca-manual.qa.ts`

- [ ] **Step 1: Agregar escenarios de gating (fallarán)**

En `main()`, antes de `// ── Resumen ──`:

```ts
  // ═══ E. gating de aprobación ═══
  await scenario('E1 avanzar con marca sin validar → 400; validar → avanzar 200', async () => {
    const pid = await nuevaPlanilla('2026-12-02');
    // marca del owner (sin validar) sobre el único día
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-02', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    // el owner envía la planilla (el día bloqueado cuenta como completo) → NO se bloquea el envío
    const enviar = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(enviar.status, 200, `enviar: ${JSON.stringify(enviar.body)}`);
    assert(enviar.body.estado === 'ENVIADA', `estado=${enviar.body.estado}`);
    // el supervisor intenta avanzar → 400 (marca sin validar)
    const avA = await post(`/planillas/${pid}/avanzar`, {}, sup.token);
    assertStatus(avA.status, 400, JSON.stringify(avA.body));
    assert(avA.body.marcasPendientes === 1, `marcasPendientes=${avA.body.marcasPendientes}`);
    // valida la marca y reintenta → 200
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const avB = await post(`/planillas/${pid}/avanzar`, {}, sup.token);
    assertStatus(avB.status, 200, JSON.stringify(avB.body));
    assert(avB.body.estado === 'APROBADA', `estado=${avB.body.estado}`);
  });
  await scenario('E2 GET /planillas/:id incluye marcaManual en el registro', async () => {
    const pid = await nuevaPlanilla('2026-12-04');
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-04', tipo: 'LICENCIA_ESPECIAL' }, owner.token);
    const { body } = await get(`/planillas/${pid}`, owner.token);
    const dia = (body.registros as any[]).find(r => r.fecha.startsWith('2026-12-04'));
    assert(dia && dia.marcaManual && dia.marcaManual.estado === 'PENDIENTE', `marcaManual=${JSON.stringify(dia?.marcaManual)}`);
  });
```

- [ ] **Step 2: Correr y ver E1/E2 fallar**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: E1 falla (avanzar devuelve 200 en vez de 400 — sin gating aún); E2 falla (`marcaManual` no viene en el GET).

- [ ] **Step 3: Incluir `marcaManual` en `GET /:id`**

En el `GET /:id` de `planillas.routes.ts`, cambiar el include de `registros` (líneas ~279-284) por:

```ts
        registros: {
          orderBy: { fecha: 'asc' },
          include: {
            proyecto: { select: { codigo: true, nombre: true } },
            marcaManual: { select: { id: true, estado: true, tipo: true, cargadaPorId: true, aprobadaPorId: true } },
          },
        },
```

- [ ] **Step 4: Agregar el gating en `/avanzar`**

En el handler `POST /:id/avanzar`, inmediatamente después del guard de estado (después de `if (planilla.estado !== 'ENVIADA' && planilla.estado !== 'EN_REVISION') { ... return; }`, ~línea 490) agregar:

```ts
    // Gating plan B: no se puede avanzar/aprobar con marcas manuales sin validar
    const marcasPendientes = await prisma.ausencia.count({
      where: { planillaId, cargaManual: true, estado: { notIn: ['APROBADA', 'RECHAZADA'] } },
    });
    if (marcasPendientes > 0) {
      res.status(400).json({ error: `Hay ${marcasPendientes} marca(s) manual(es) sin validar. Validalas antes de aprobar.`, marcasPendientes });
      return;
    }
```

- [ ] **Step 5: Correr y ver toda la suite en PASS**

```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: TODOS los escenarios (A–E) PASS.

- [ ] **Step 6: Regresión de planillas + typecheck**

```bash
cd apps/api && npx tsx tests/qa/planillas.qa.ts && npx tsc --noEmit
```
Expected: la suite de planillas sigue verde (el gating no afecta planillas sin marcas manuales) y compila.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/marca-manual.qa.ts
git commit -m "feat(api): gating de aprobación por marcas sin validar + marcaManual en GET planilla"
```

---

## Task 8: Frontend — marcar / validar / rechazar en `PlanillaDetailPage`

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`

Anclas de referencia (números aproximados): interfaz `Registro` ~29-49; `avanzarMutation` ~232; `registroMap` ~314; `isOwner`/`canEdit`/`canApprove` ~370-381; botón aprobar ~862; panel de día bloqueado ~1270-1293; diálogo de confirmación de aprobación ~1588.

- [ ] **Step 1: Extender el tipo `Registro`**

En la interfaz `Registro`, después de `motivoBloqueo: string | null;` agregar:

```ts
  marcaManual?: {
    id: string;
    estado: string;
    tipo: string;
    cargadaPorId: string;
    aprobadaPorId: string | null;
  } | null;
```

- [ ] **Step 2: Agregar derivados de rol/estado de marcas**

Después de la línea `const canApprove = ...` (~381), agregar:

```ts
  // Marca manual (plan B): quién puede marcar/validar y cuántas quedan sin validar
  const canMarkAsManager = !isOwner && userNivel >= 60 &&
    ['BORRADOR', 'RECHAZADA', 'ENVIADA', 'EN_REVISION'].includes(planilla.estado);
  const marcasPendientes = planilla.registros.filter(r => r.marcaManual?.estado === 'PENDIENTE').length;
```

- [ ] **Step 3: Agregar las mutaciones de marca**

Después de `rechazarMutation` (~245-255), agregar:

```ts
  const marcarDiaMutation = useMutation({
    mutationFn: (vars: { fecha: string; tipo: string }) => api.post(`/planillas/${id}/marcar-dia`, vars),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); setSelectedDate(null); },
    onError: (err: any) => toast({ title: 'No se pudo marcar', description: err.response?.data?.error ?? 'Error al marcar el día', variant: 'destructive' }),
  });
  const validarMarcaMutation = useMutation({
    mutationFn: (ausenciaId: string) => api.post(`/planillas/${id}/marcas/${ausenciaId}/validar`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); setSelectedDate(null); },
    onError: (err: any) => toast({ title: 'No se pudo validar', description: err.response?.data?.error ?? 'Error al validar', variant: 'destructive' }),
  });
  const validarTodoMutation = useMutation({
    mutationFn: () => api.post(`/planillas/${id}/marcas/validar-todo`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); },
    onError: (err: any) => toast({ title: 'No se pudo validar', description: err.response?.data?.error ?? 'Error al validar', variant: 'destructive' }),
  });
  const quitarMarcaMutation = useMutation({
    mutationFn: (ausenciaId: string) => api.delete(`/planillas/${id}/marcas/${ausenciaId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); setSelectedDate(null); },
    onError: (err: any) => toast({ title: 'No se pudo quitar', description: err.response?.data?.error ?? 'Error', variant: 'destructive' }),
  });

  const TIPOS_MARCA: { value: string; label: string }[] = [
    { value: 'FRANCO_COMPENSATORIO', label: 'Franco compensatorio' },
    { value: 'FALTA_JUSTIFICADA', label: 'Falta justificada' },
    { value: 'FALTA_INJUSTIFICADA', label: 'Falta injustificada' },
    { value: 'CERTIFICADO_MEDICO', label: 'Certificado médico' },
    { value: 'LICENCIA_ESPECIAL', label: 'Licencia especial' },
  ];

  const handleMarcar = async (tipo: string) => {
    if (!selectedDate) return;
    const existing = registroMap[selectedDate];
    if (existing && !existing.bloqueado && existing.entradaTurno1) {
      const ok = await dialog.confirm({ title: 'Reemplazar día', message: 'Este día tiene horas cargadas. Se reemplazarán por la marca. ¿Continuar?', variant: 'danger' });
      if (!ok) return;
    }
    marcarDiaMutation.mutate({ fecha: selectedDate, tipo });
  };
```

- [ ] **Step 4: Botón "Aprobar todas las marcas" + deshabilitar aprobar con pendientes**

En el botón de aprobar (~862), envolver/condicionar. Reemplazar el bloque del botón de aprobar por:

```tsx
            {marcasPendientes > 0 && canApprove && (
              <button onClick={() => validarTodoMutation.mutate()} disabled={validarTodoMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cal-amber/90 text-white text-sm font-medium hover:bg-cal-amber disabled:opacity-50">
                {validarTodoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Aprobar todas las marcas ({marcasPendientes})
              </button>
            )}
            <button onClick={() => setShowConfirmApproval(true)} disabled={avanzarMutation.isPending || marcasPendientes > 0}
              title={marcasPendientes > 0 ? `Validá las ${marcasPendientes} marca(s) manual(es) primero` : undefined}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {avanzarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aprobar
            </button>
```

(Ajustar sólo los atributos `disabled`/`title` del botón existente y anteponer el botón de "Aprobar todas las marcas" si el reemplazo literal no coincide por diferencias menores de markup.)

- [ ] **Step 5: Menú "Marcar día especial" en el panel de día no bloqueado**

Dentro del bloque `{!registroMap[selectedDate]?.bloqueado && (<>` (~1296), justo después de la apertura, insertar el menú de marca (visible para dueño editable o gestor):

```tsx
              {((canEdit) || canMarkAsManager) && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/30 rounded-lg">
                    Marcar día especial (ausencia / compensatorio)
                  </summary>
                  <div className="p-2 grid grid-cols-1 gap-1">
                    {TIPOS_MARCA.map(t => (
                      <button key={t.value} type="button" onClick={() => handleMarcar(t.value)} disabled={marcarDiaMutation.isPending}
                        className="text-left px-3 py-2 rounded-md text-sm hover:bg-accent disabled:opacity-50">
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
```

- [ ] **Step 6: Evitar choque con el botón "Revocar compensatorio" existente**

El botón viejo "Revocar compensatorio" (~1278) usa el `PATCH .../compensatorio` y no debe aparecer sobre una marca manual (que tiene su propio flujo y `esFrancoCompensatorio=false`). Agregar `&& !registroMap[selectedDate]?.marcaManual` a su condición. Queda:

```tsx
                  {registroMap[selectedDate]?.motivoBloqueo === 'FRANCO_COMPENSATORIO' && !registroMap[selectedDate]?.marcaManual && user && (user.rolNivel ?? 0) >= 60 && (
```

- [ ] **Step 7: Chip "Sin validar" + acciones en el panel de día bloqueado**

En el bloque de día bloqueado (~1270-1293), después del `<p>` con el motivo (y del botón viejo de "Revocar compensatorio"), insertar el estado de la marca manual y sus acciones:

```tsx
                  {registroMap[selectedDate]?.marcaManual && (
                    <div className="mt-2 space-y-2">
                      {registroMap[selectedDate]!.marcaManual!.estado === 'PENDIENTE' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-cal-amber border border-cal-amber/30">
                          ⏳ Sin validar
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">
                          ✓ Validado
                        </span>
                      )}

                      {/* Dueño: quitar su marca sin validar */}
                      {isOwner && canEdit && registroMap[selectedDate]!.marcaManual!.estado === 'PENDIENTE' && (
                        <button onClick={() => quitarMarcaMutation.mutate(registroMap[selectedDate]!.marcaManual!.id)}
                          disabled={quitarMarcaMutation.isPending}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 disabled:opacity-50">
                          Quitar marca
                        </button>
                      )}

                      {/* Superior: validar / rechazar */}
                      {canMarkAsManager && registroMap[selectedDate]!.marcaManual!.estado === 'PENDIENTE' && (
                        <div className="flex gap-2">
                          <button onClick={() => validarMarcaMutation.mutate(registroMap[selectedDate]!.marcaManual!.id)}
                            disabled={validarMarcaMutation.isPending}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                            Validar
                          </button>
                          <button onClick={async () => { if (await dialog.confirm({ message: '¿Rechazar esta marca? El día quedará libre.', variant: 'danger' })) quitarMarcaMutation.mutate(registroMap[selectedDate]!.marcaManual!.id); }}
                            disabled={quitarMarcaMutation.isPending}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                            Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
```

- [ ] **Step 8: Chip "Sin validar" en la celda del calendario**

En el render de la celda del día bloqueado (~1182-1194, donde se muestra el label de `motivoBloqueo`), agregar debajo del label un pequeño indicador cuando la marca está pendiente. Localizar el bloque que muestra `reg.motivoBloqueo === 'FALTA_JUSTIFICADA' ? 'Falta Just.' ...` y, dentro de ese contenedor, agregar:

```tsx
                          {reg?.marcaManual?.estado === 'PENDIENTE' && (
                            <span className="mt-0.5 block text-[9px] font-semibold text-cal-amber">sin validar</span>
                          )}
```

- [ ] **Step 9: Verificar build del frontend**

```bash
cd apps/web && npx tsc --noEmit && npm run build
```
Expected: compila sin errores de tipos; build OK.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): marcar/validar/rechazar días especiales (plan B) en la planilla"
```

---

## Task 9: Verificación integral y cierre

**Files:** ninguno (verificación)

- [ ] **Step 1: Suite completa de marca manual**

Con el server dev corriendo:
```bash
cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
```
Expected: `RESULTS: N/N passed, 0 failed`.

- [ ] **Step 2: Regresiones clave**

```bash
cd apps/api && npx tsx tests/qa/ausencias.qa.ts && npx tsx tests/qa/planillas.qa.ts
```
Expected: ambas suites sin fallos nuevos (los bugs pre-existentes documentados, si aparecen, no cuentan como regresión).

- [ ] **Step 3: Typecheck de ambos paquetes**

```bash
cd apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 4: Smoke manual (opcional pero recomendado)**

Levantar la app (`start-dev.bat` o `npm run dev` en api + web), loguearse como un operador, abrir una planilla en BORRADOR, marcar un día como "Falta justificada" → aparece bloqueado con chip "sin validar". Loguearse como su supervisor, abrir la misma planilla enviada → "Aprobar todas las marcas" valida; el botón "Aprobar" se habilita.

- [ ] **Step 5: Commit final (si quedaron ajustes del smoke)**

```bash
git add -A
git commit -m "chore: ajustes finales marca manual de días (plan B)"
```

---

## Notas de decisiones (para el que implementa)

- **`esFrancoCompensatorio` NO se setea** en el registro inyectado por una marca manual de compensatorio: el saldo lo maneja el ciclo de la ausencia (reservar al marcar → usar al validar), no la aprobación de la planilla. Esto evita el doble conteo del path de `avanzar` de planilla que sí cuenta `esFrancoCompensatorio`.
- **Orden en el DELETE:** primero `deleteMany` de registros por `marcaManualId` (mientras el FK existe), después borrar/actualizar la `Ausencia`. Al revés, `onDelete: SetNull` dejaría el día bloqueado huérfano.
- **El `PATCH .../compensatorio` de supervisor existente se deja intacto**; es un camino separado. La marca manual es el camino nuevo y completo.
- **El certificado médico marcado a mano queda sin archivo**; se adjunta después con `POST /ausencias/:id/archivo` (endpoint existente).
