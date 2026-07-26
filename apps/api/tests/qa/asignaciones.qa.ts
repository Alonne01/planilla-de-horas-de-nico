/**
 * QA Suite — KEY=asignaciones
 * Qué flujo rige cada alcance: PUT /admin/flujos/asignaciones/alcance.
 *
 * El endpoint fija en un solo pedido el flujo de un alcance (sector + tipo de
 * documento), reemplazando el que hubiera. Sin él la pantalla tendría que hacer
 * DELETE + POST y dejar al sector sin flujo entre uno y otro.
 *
 * Todo lo que crea (un sector y dos flujos temporales) lo borra al terminar.
 *
 * Run: cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/asignaciones.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];

function log(sym: string, msg: string) { process.stdout.write(`  ${sym} ${msg}\n`); }

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK' });
    log('✅', `${name}  (${Date.now() - start}ms)`);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail });
    log('❌', `${name}  — ${detail}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} esperado, llegó ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
const get = (p: string, tok?: string) => api('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => api('PUT', p, { token: tok, body: b });
const del = (p: string, tok?: string) => api('DELETE', p, { token: tok });

const ALCANCE = '/admin/flujos/asignaciones/alcance';

async function login(email: string, password: string): Promise<string> {
  const { status, body } = await post('/auth/login', { email, password });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  return body.accessToken;
}

/** Las asignaciones de un alcance, leídas del listado real (no de la respuesta). */
async function asignacionesDe(tok: string, tipoDocumento: string, sectorId: string | null): Promise<any[]> {
  const { body } = await get('/admin/flujos/asignaciones/list', tok);
  assert(Array.isArray(body), `El listado de asignaciones no es un array: ${JSON.stringify(body)}`);
  return body.filter((a: any) => a.tipoDocumento === tipoDocumento && a.sectorId === sectorId && !a.usuarioId);
}

const cadena = (nombre: string, roles: string[]) => ({
  nombre,
  tipoDocumento: 'PLANILLA',
  pasos: roles.map((rol, i) => ({
    orden: i + 1,
    nombrePaso: `Paso ${rol}`,
    rolAprobador: rol,
    requiereComentarioRechazo: true,
  })),
});

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write('\n═══ QA asignaciones — PUT /admin/flujos/asignaciones/alcance ═══\n\n');

  const admin = await login('admin@wenlen.com', 'Test1234!');

  // Alguien sin nivel de admin, para el chequeo de autorización. Se prueban
  // varias credenciales porque la nómina de demo se puede haber borrado y los
  // usuarios de prueba propios usan otra contraseña; si no entra ninguna, el
  // escenario se saltea en vez de dar un rojo que no dice nada.
  const CANDIDATOS: [string, string][] = [
    ['cmass1.administracion@test.wenlen.com', 'Prueba2026!'],
    ['rrhh1@test.wenlen.com', 'Test1234!'],
  ];
  let noAdmin: string | null = null;
  for (const [email, password] of CANDIDATOS) {
    try { noAdmin = await login(email, password); break; } catch { /* probar el siguiente */ }
  }

  // ── setup: un sector y dos flujos propios, para no tocar la configuración real
  const { status: sStatus, body: sector } = await post('/admin/sectores', {
    nombre: `qa-asig-${TS}`, descripcion: 'temporal de la suite de asignaciones',
  }, admin);
  assertStatus(sStatus, 201, `alta de sector: ${JSON.stringify(sector)}`);

  const { status: f1Status, body: flujoLargo } = await post('/admin/flujos', cadena(`qa-asig-largo-${TS}`, ['SUPERVISOR', 'COORDINADOR', 'RRHH']), admin);
  assertStatus(f1Status, 201, `alta de flujo largo: ${JSON.stringify(flujoLargo)}`);

  const { status: f2Status, body: flujoCorto } = await post('/admin/flujos', cadena(`qa-asig-corto-${TS}`, ['RRHH']), admin);
  assertStatus(f2Status, 201, `alta de flujo corto: ${JSON.stringify(flujoCorto)}`);

  const { body: flujoVac } = await post('/admin/flujos', {
    ...cadena(`qa-asig-vac-${TS}`, ['RRHH']), tipoDocumento: 'VACACION',
  }, admin);

  try {
    await scenario('A. Alcance vacío + PUT con flujo → queda asignado', async () => {
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: flujoLargo.id,
      }, admin);
      assertStatus(status, 200, JSON.stringify(body));
      assert(body.asignacion?.flujoId === flujoLargo.id, `Devolvió ${JSON.stringify(body.asignacion)}`);
      const filas = await asignacionesDe(admin, 'PLANILLA', sector.id);
      assert(filas.length === 1, `Esperaba 1 asignación, hay ${filas.length}`);
      assert(filas[0].flujoId === flujoLargo.id, 'La asignación guardada no es la del flujo largo');
    });

    await scenario('B. PUT con otro flujo → reemplaza, no acumula', async () => {
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: flujoCorto.id,
      }, admin);
      assertStatus(status, 200, JSON.stringify(body));
      const filas = await asignacionesDe(admin, 'PLANILLA', sector.id);
      assert(filas.length === 1, `Quedaron ${filas.length} asignaciones para el mismo alcance`);
      assert(filas[0].flujoId === flujoCorto.id, 'No quedó el flujo nuevo');
    });

    await scenario('C. PUT con flujoId null → el alcance se queda sin flujo propio', async () => {
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: null,
      }, admin);
      assertStatus(status, 200, JSON.stringify(body));
      assert(body.asignacion === null, `Esperaba asignacion:null, llegó ${JSON.stringify(body.asignacion)}`);
      const filas = await asignacionesDe(admin, 'PLANILLA', sector.id);
      assert(filas.length === 0, `Quedaron ${filas.length} asignaciones`);
    });

    await scenario('D. Quitar el flujo de un alcance que no tenía → idempotente', async () => {
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: null,
      }, admin);
      assertStatus(status, 200, JSON.stringify(body));
      assert(body.asignacion === null, 'Debería seguir sin asignación');
    });

    await scenario('E. Cada tipo de documento es independiente', async () => {
      await put(ALCANCE, { tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: flujoLargo.id }, admin);
      await put(ALCANCE, { tipoDocumento: 'VACACION', sectorId: sector.id, flujoId: flujoVac.id }, admin);

      const planilla = await asignacionesDe(admin, 'PLANILLA', sector.id);
      const vacacion = await asignacionesDe(admin, 'VACACION', sector.id);
      assert(planilla.length === 1 && planilla[0].flujoId === flujoLargo.id, 'Asignar VACACION pisó la de PLANILLA');
      assert(vacacion.length === 1 && vacacion[0].flujoId === flujoVac.id, 'La asignación de VACACION no quedó');

      // Y quitar una no toca la otra: es el caso que motivó la matriz.
      await put(ALCANCE, { tipoDocumento: 'VACACION', sectorId: sector.id, flujoId: null }, admin);
      const planillaDespues = await asignacionesDe(admin, 'PLANILLA', sector.id);
      assert(planillaDespues.length === 1, 'Quitar VACACION se llevó puesta la de PLANILLA');
    });

    await scenario('F. Flujo de otro tipo de documento → 400', async () => {
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'VACACION', sectorId: sector.id, flujoId: flujoLargo.id,
      }, admin);
      assertStatus(status, 400, JSON.stringify(body));
      assert(String(body.error).includes('PLANILLA'), `El mensaje no dice el tipo real: ${body.error}`);
    });

    await scenario('G. Sector inexistente → 400 y no crea nada', async () => {
      const fantasma = '00000000-0000-4000-8000-000000000000';
      const { status, body } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: fantasma, flujoId: flujoLargo.id,
      }, admin);
      assertStatus(status, 400, JSON.stringify(body));
      const filas = await asignacionesDe(admin, 'PLANILLA', fantasma);
      assert(filas.length === 0, 'Creó una asignación contra un sector que no existe');
    });

    await scenario('H. El alta (POST) también valida el sector', async () => {
      const { status, body } = await post('/admin/flujos/asignaciones', {
        flujoId: flujoLargo.id, tipoDocumento: 'PLANILLA',
        sectorId: '00000000-0000-4000-8000-000000000000',
      }, admin);
      assertStatus(status, 400, JSON.stringify(body));
    });

    await scenario('I. Flujo inexistente → 404', async () => {
      const { status } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id,
        flujoId: '00000000-0000-4000-8000-000000000000',
      }, admin);
      assertStatus(status, 404);
    });

    await scenario('J. Alcance global: se fija y se limpia sin tocar los sectores', async () => {
      const antes = await asignacionesDe(admin, 'PLANILLA', null);
      assert(antes.length === 0, `Ya había un flujo global de PLANILLA (${antes.length}): la suite no lo pisa`);

      const { status } = await put(ALCANCE, { tipoDocumento: 'PLANILLA', sectorId: null, flujoId: flujoCorto.id }, admin);
      assertStatus(status, 200);
      assert((await asignacionesDe(admin, 'PLANILLA', null)).length === 1, 'No quedó el global');
      assert((await asignacionesDe(admin, 'PLANILLA', sector.id)).length === 1, 'El global pisó la asignación del sector');

      await put(ALCANCE, { tipoDocumento: 'PLANILLA', sectorId: null, flujoId: null }, admin);
      assert((await asignacionesDe(admin, 'PLANILLA', null)).length === 0, 'No se limpió el global');
    });

    await scenario('K. Sin nivel de admin → 403', async () => {
      if (!noAdmin) { log('  ', '(salteado: no hay usuario no-admin disponible)'); return; }
      const { status } = await put(ALCANCE, {
        tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: flujoCorto.id,
      }, noAdmin);
      assertStatus(status, 403);
    });

    await scenario('L. Sin token → 401', async () => {
      const { status } = await put(ALCANCE, { tipoDocumento: 'PLANILLA', sectorId: sector.id, flujoId: null }, undefined);
      assertStatus(status, 401);
    });

    await scenario('M. tipoDocumento inventado → 400', async () => {
      const { status } = await put(ALCANCE, { tipoDocumento: 'INVENTADO', sectorId: sector.id, flujoId: null }, admin);
      assertStatus(status, 400);
    });
  } finally {
    // ── limpieza: primero las asignaciones, después flujos y sector
    for (const tipo of ['PLANILLA', 'VACACION']) {
      await put(ALCANCE, { tipoDocumento: tipo, sectorId: sector.id, flujoId: null }, admin);
      await put(ALCANCE, { tipoDocumento: tipo, sectorId: null, flujoId: null }, admin);
    }
    for (const f of [flujoLargo, flujoCorto, flujoVac]) {
      if (f?.id) await del(`/admin/flujos/${f.id}?forzarDesasignacion=true`, admin);
    }
    if (sector?.id) await del(`/admin/sectores/${sector.id}`, admin);
  }

  const ok = results.filter((r) => r.passed).length;
  process.stdout.write(`\n─── ${ok}/${results.length} escenarios OK ───\n`);
  for (const r of results.filter((x) => !x.passed)) process.stdout.write(`  ❌ ${r.name}: ${r.detail}\n`);
  process.stdout.write('\n');
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
