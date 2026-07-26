/**
 * Planilla de Horas — Admin + Export Simulation Suite (simulation3.ts)
 *
 * Covers all endpoints not tested by integration.ts, simulation.ts, or simulation2.ts:
 *   P.  Admin Sectores        — POST, PUT, DELETE
 *   Q.  Admin Diagramas       — GET, POST (ROTATIVO + FIJO_SEMANA), PUT, DELETE
 *   R.  Admin Roles           — GET, POST, PUT, DELETE (403 on system, 204 on custom)
 *   S.  Admin Config          — GET, PUT
 *   T.  Admin Alertas         — GET, POST, PUT, PATCH toggle, DELETE
 *   U.  Admin Flujos          — full CRUD + pasos + asignaciones
 *   W.  Usuarios CRUD         — create, update, ficha, reset-password, diagrama, deactivate
 *   X.  Test Bed              — create + approve planilla (base for Y–BB)
 *   Y.  Export XLSX           — planilla, sector, pendientes, POST cierre
 *   AA. Exportaciones log     — GET list, POST log, POST cierre (closes planilla → CERRADA)
 *   CC. Backup                — GET status
 *
 * Requirements:
 *   - API running at http://localhost:4000
 *   - DEBUG_AUTH=true in .env (any password accepted for login)
 *   - Database seeded with demo users
 *
 * Run: cd apps/api && npx tsx tests/simulation3.ts
 */

const BASE = 'http://localhost:4000/api/v1';

// ── Colors / output ───────────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  RESET:   '\x1b[0m',
  DIM:     '\x1b[2m',
  BOLD:    '\x1b[1m',
  GREEN:   '\x1b[32m',
  RED:     '\x1b[31m',
  YELLOW:  '\x1b[33m',
  CYAN:    '\x1b[36m',
  BLUE:    '\x1b[34m',
  MAGENTA: '\x1b[35m',
};
function c(col: string, s: string) { return `${COLORS[col] ?? ''}${s}${COLORS.RESET}`; }

type Result = { name: string; passed: boolean; detail: string; scenario: string; ms: number };
const results: Result[] = [];
const cleanupQueue: (() => Promise<void>)[] = [];

function log(sym: string, msg: string, scenario = '') {
  const prefix = scenario ? c('DIM', `[${scenario}] `) : '';
  process.stdout.write(`  ${sym} ${prefix}${msg}\n`);
}

async function scenario(name: string, label: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, detail: 'OK', scenario: label, ms });
    log(c('GREEN', '✅'), `${name}  (${ms}ms)`, label);
  } catch (e: unknown) {
    const ms = Date.now() - start;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail, scenario: label, ms });
    log(c('RED', '❌'), `${name}  — ${detail}`, label);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected)
    throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

const get   = (p: string, tok?: string) => api('GET',    p, { token: tok });
const post  = (p: string, b: unknown, tok?: string) => api('POST',   p, { token: tok, body: b });
const put   = (p: string, b: unknown, tok?: string) => api('PUT',    p, { token: tok, body: b });
const patch = (p: string, b: unknown, tok?: string) => api('PATCH',  p, { token: tok, body: b });
const del   = (p: string, tok?: string) => api('DELETE', p, { token: tok });

// ── Auth ───────────────────────────────────────────────────────────────────────

interface Session {
  token: string;
  user: {
    id: string; nombre: string; apellido: string; email: string;
    rol: string; rolNivel: number; empresaId: string; sectorId: string | null;
  };
}

async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}`);
  const b = body as Record<string, unknown>;
  assert(typeof b.accessToken === 'string', 'No accessToken');
  return { token: b.accessToken as string, user: b.user as Session['user'] };
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function fmt(d: Date) { return d.toISOString().split('T')[0]; }
function isoTs(date: string, time: string) { return `${date}T${time}:00.000Z`; }

/**
 * Returns a 3-day period unique per offset.
 * Uses years 1900–1938 (distinct from sim1: 1975-1998, sim2: 1940-1972, integration: 2002-2019).
 */
function sim3Period(offset = 0): { inicio: Date; fin: Date; dates: string[] } {
  const slot  = Math.floor(Date.now() / 60_000) + offset + 40_000;
  const year  = 1900 + (slot % 38);   // 1900–1937
  const month = (slot % 12) + 1;
  const day   = (slot % 20) + 1;
  const inicio = new Date(year, month - 1, day);
  const fin    = new Date(year, month - 1, day + 2);
  return {
    inicio, fin,
    dates: [fmt(inicio), fmt(new Date(inicio.getTime() + 86_400_000)), fmt(fin)],
  };
}

// ── Approval-chain helpers ─────────────────────────────────────────────────────

interface UserInfo {
  id: string; nombre: string; apellido: string; email: string;
  rol: string; sector: { nombre: string } | null;
}

async function findApproverForPaso(
  rol: string,
  sectorNombre: string,
  users: UserInfo[],
  rrhhSession: Session,
  label: string,
): Promise<Session> {
  const bySector = users.filter(u => u.rol === rol && u.sector?.nombre === sectorNombre);
  if (bySector.length > 0) {
    log('ℹ', `  Aprobador ${rol}: ${bySector[0].nombre} ${bySector[0].apellido} [sector]`, label);
    return login(bySector[0].email);
  }
  const byRole = users.filter(u => u.rol === rol);
  if (byRole.length > 0) {
    log('⚠', `  Aprobador ${rol}: ${byRole[0].nombre} ${byRole[0].apellido} [cross-sector]`, label);
    return login(byRole[0].email);
  }
  log('⚠', `  Aprobador ${rol}: usando RRHH fallback`, label);
  return rrhhSession;
}

async function walkApprovalChain(
  planillaId: string,
  users: UserInfo[],
  ownerSectorNombre: string,
  rrhhSession: Session,
  label: string,
): Promise<string> {
  const { body: pb } = await get(`/planillas/${planillaId}`, rrhhSession.token);
  const planillaBody = pb as Record<string, unknown>;
  const flujo = planillaBody.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;

  if (!flujo || flujo.pasos.length === 0) {
    const { status, body } = await post(
      `/planillas/${planillaId}/avanzar`,
      { comentario: 'Aprobación directa (sin flujo)' },
      rrhhSession.token,
    );
    if (status !== 200) throw new Error(`No-flujo avanzar: HTTP ${status} — ${JSON.stringify(body)}`);
    return (body as Record<string, unknown>).estado as string;
  }

  log('ℹ', `Flujo: ${flujo.pasos.map(p => p.rolAprobador).join(' → ')}`, label);

  let estado = 'ENVIADA';
  for (const paso of flujo.pasos) {
    if (estado === 'APROBADA') break;
    const approverSession = await findApproverForPaso(paso.rolAprobador, ownerSectorNombre, users, rrhhSession, label);
    const { status, body } = await post(
      `/planillas/${planillaId}/avanzar`,
      { comentario: `Aprobación paso ${paso.orden} (${paso.rolAprobador})` },
      approverSession.token,
    );
    if (status === 403) throw new Error(`403 paso ${paso.orden}: ${(body as Record<string, unknown>).error}`);
    if (status !== 200) throw new Error(`Paso ${paso.orden}: HTTP ${status} — ${JSON.stringify(body)}`);
    estado = (body as Record<string, unknown>).estado as string;
    log('ℹ', `  Paso ${paso.orden} OK → ${estado}`, label);
  }
  return estado;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO P: Admin Sectores CRUD
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioP_AdminSectores(adminSession: Session): Promise<void> {
  const label = 'P:AdminSectores';
  console.log(c('CYAN', '\n── Scenario P: Admin Sectores CRUD ─────────────────────────────────────'));

  let sectorId = '';

  await scenario('P1 POST /admin/sectores (create)', label, async () => {
    const { status, body } = await post('/admin/sectores', {
      nombre: `SIM3-Sector-${Date.now()}`,
      descripcion: 'Sector de prueba simulation3',
      color: '#FF5733',
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id in response');
    sectorId = b.id as string;
    cleanupQueue.push(async () => { await del(`/admin/sectores/${sectorId}`, adminSession.token); });
  });

  await scenario('P2 GET /admin/sectores (list includes new)', label, async () => {
    const { status, body } = await get('/admin/sectores', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const arr = body as Array<Record<string, unknown>>;
    assert(Array.isArray(arr), 'Response is not array');
    const found = arr.some(s => s.id === sectorId);
    assert(found, `New sector ${sectorId} not found in list`);
  });

  await scenario('P3 PUT /admin/sectores/:id (update)', label, async () => {
    if (!sectorId) throw new Error('sectorId not set (P1 failed)');
    const { status, body } = await put(`/admin/sectores/${sectorId}`, {
      nombre: `SIM3-Sector-Updated-${Date.now()}`,
      color: '#00BFFF',
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id in response');
  });

  await scenario('P4 DELETE /admin/sectores/:id', label, async () => {
    if (!sectorId) throw new Error('sectorId not set (P1 failed)');
    const { status } = await del(`/admin/sectores/${sectorId}`, adminSession.token);
    assertStatus(status, 204);
    cleanupQueue.pop(); // already deleted, remove from queue
    sectorId = '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO Q: Admin Diagramas CRUD
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioQ_AdminDiagramas(adminSession: Session): Promise<string> {
  const label = 'Q:AdminDiagramas';
  console.log(c('CYAN', '\n── Scenario Q: Admin Diagramas CRUD ────────────────────────────────────'));

  let diagramaRotativoId = '';
  let diagramaFijoId = '';

  await scenario('Q1 GET /admin/diagramas (list existing)', label, async () => {
    const { status, body } = await get('/admin/diagramas', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Not an array');
  });

  await scenario('Q2 POST /admin/diagramas (ROTATIVO)', label, async () => {
    const { status, body } = await post('/admin/diagramas', {
      nombre: `SIM3-Rotativo-${Date.now()}`,
      tipo: 'ROTATIVO',
      diasTrabajo: 14,
      diasDescanso: 7,
      descripcion: 'Diagrama rotativo de prueba',
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    diagramaRotativoId = b.id as string;
    cleanupQueue.push(async () => { await del(`/admin/diagramas/${diagramaRotativoId}`, adminSession.token); });
  });

  await scenario('Q3 POST /admin/diagramas (FIJO_SEMANA)', label, async () => {
    const { status, body } = await post('/admin/diagramas', {
      nombre: `SIM3-FijoSemana-${Date.now()}`,
      tipo: 'FIJO_SEMANA',
      diasSemana: [1, 2, 3, 4, 5],
      descripcion: 'Diagrama lunes-viernes de prueba',
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    diagramaFijoId = b.id as string;
    cleanupQueue.push(async () => { await del(`/admin/diagramas/${diagramaFijoId}`, adminSession.token); });
  });

  await scenario('Q4 PUT /admin/diagramas/:id (update description)', label, async () => {
    if (!diagramaRotativoId) throw new Error('diagramaRotativoId not set (Q2 failed)');
    const { status, body } = await put(`/admin/diagramas/${diagramaRotativoId}`, {
      descripcion: 'Diagrama rotativo actualizado en sim3',
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  await scenario('Q5 DELETE /admin/diagramas/:id (no assignments)', label, async () => {
    if (!diagramaFijoId) throw new Error('diagramaFijoId not set (Q3 failed)');
    const { status } = await del(`/admin/diagramas/${diagramaFijoId}`, adminSession.token);
    assertStatus(status, 204);
    cleanupQueue.pop(); // already deleted
    diagramaFijoId = '';
  });

  return diagramaRotativoId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO R: Admin Roles CRUD
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioR_AdminRoles(adminSession: Session): Promise<void> {
  const label = 'R:AdminRoles';
  console.log(c('CYAN', '\n── Scenario R: Admin Roles CRUD ────────────────────────────────────────'));

  let customRolId = '';
  let systemRolId = '';

  await scenario('R1 GET /admin/roles (list all)', label, async () => {
    const { status, body } = await get('/admin/roles', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const arr = body as Array<Record<string, unknown>>;
    assert(Array.isArray(arr) && arr.length > 0, 'Empty roles list');
    // Pick a system role for the 403 test
    const sysRole = arr.find(r => r.esSistema === true);
    if (sysRole) systemRolId = sysRole.id as string;
  });

  await scenario('R2 POST /admin/roles (create custom)', label, async () => {
    const { status, body } = await post('/admin/roles', {
      codigo: `SIM3ROLE${Date.now().toString().slice(-6)}`,
      nombre: 'Rol Sim3 Test',
      descripcion: 'Rol de prueba simulation3',
      color: '#7B2FBE',
      nivel: 25,
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    customRolId = b.id as string;
    cleanupQueue.push(async () => { await del(`/admin/roles/${customRolId}`, adminSession.token); });
  });

  await scenario('R3 PUT /admin/roles/:id (update custom)', label, async () => {
    if (!customRolId) throw new Error('customRolId not set (R2 failed)');
    const { status, body } = await put(`/admin/roles/${customRolId}`, {
      nombre: 'Rol Sim3 Actualizado',
      nivel: 30,
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  await scenario('R4 DELETE system role → 403', label, async () => {
    if (!systemRolId) throw new Error('No system role found (R1 found none)');
    const { status } = await del(`/admin/roles/${systemRolId}`, adminSession.token);
    assertStatus(status, 403);
  });

  await scenario('R5 DELETE /admin/roles/:id (custom)', label, async () => {
    if (!customRolId) throw new Error('customRolId not set (R2 failed)');
    const { status } = await del(`/admin/roles/${customRolId}`, adminSession.token);
    assertStatus(status, 204);
    cleanupQueue.pop(); // already deleted
    customRolId = '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO S: Admin Config GET/PUT
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioS_AdminConfig(adminSession: Session): Promise<void> {
  const label = 'S:AdminConfig';
  console.log(c('CYAN', '\n── Scenario S: Admin Config GET/PUT ────────────────────────────────────'));

  let originalHorasJornada = 8;

  await scenario('S1 GET /admin/config', label, async () => {
    const { status, body } = await get('/admin/config', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.horasJornadaNormal === 'number', 'Missing horasJornadaNormal');
    originalHorasJornada = b.horasJornadaNormal as number;
  });

  await scenario('S2 PUT /admin/config (update horasJornadaNormal)', label, async () => {
    const newVal = originalHorasJornada === 8 ? 9 : 8;
    const { status, body } = await put('/admin/config', {
      horasJornadaNormal: newVal,
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.horasJornadaNormal === newVal, `Expected ${newVal}, got ${b.horasJornadaNormal}`);
    cleanupQueue.push(async () => {
      await put('/admin/config', { horasJornadaNormal: originalHorasJornada }, adminSession.token);
    });
  });

  await scenario('S3 GET /admin/config (verify updated)', label, async () => {
    const { status, body } = await get('/admin/config', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    const newVal = originalHorasJornada === 8 ? 9 : 8;
    assert(b.horasJornadaNormal === newVal, `Config not updated. Expected ${newVal}, got ${b.horasJornadaNormal}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO T: Admin Alertas CRUD
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioT_AdminAlertas(rrhhSession: Session): Promise<void> {
  const label = 'T:AdminAlertas';
  console.log(c('CYAN', '\n── Scenario T: Admin Alertas CRUD ─────────────────────────────────────'));

  let alertaId = '';
  let alertaActivaOriginal = true;

  await scenario('T1 GET /admin/alertas (list)', label, async () => {
    const { status, body } = await get('/admin/alertas', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Not an array');
  });

  await scenario('T2 POST /admin/alertas (create)', label, async () => {
    const { status, body } = await post('/admin/alertas', {
      tipo: 'planilla_pendiente_sim3',
      activa: true,
      diasAnticipacion: 3,
      horasLimite: 48,
      rolesDestino: ['RRHH', 'COORDINADOR'],
      descripcion: 'Alerta de prueba simulation3',
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    alertaId = b.id as string;
    alertaActivaOriginal = b.activa as boolean;
    cleanupQueue.push(async () => { await del(`/admin/alertas/${alertaId}`, rrhhSession.token); });
  });

  await scenario('T3 PUT /admin/alertas/:id (update)', label, async () => {
    if (!alertaId) throw new Error('alertaId not set (T2 failed)');
    const { status, body } = await put(`/admin/alertas/${alertaId}`, {
      diasAnticipacion: 5,
      descripcion: 'Alerta sim3 actualizada',
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.diasAnticipacion === 5, `Expected 5, got ${b.diasAnticipacion}`);
  });

  await scenario('T4 PATCH /admin/alertas/:id/toggle', label, async () => {
    if (!alertaId) throw new Error('alertaId not set (T2 failed)');
    const { status, body } = await patch(`/admin/alertas/${alertaId}/toggle`, {}, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.activa !== alertaActivaOriginal, `Toggle did not change activa (was ${alertaActivaOriginal}, got ${b.activa})`);
  });

  await scenario('T5 DELETE /admin/alertas/:id', label, async () => {
    if (!alertaId) throw new Error('alertaId not set (T2 failed)');
    const { status, body } = await del(`/admin/alertas/${alertaId}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.ok === true, 'Missing ok:true in response');
    cleanupQueue.pop(); // already deleted
    alertaId = '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO U: Admin Flujos — full CRUD + pasos + asignaciones
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioU_AdminFlujos(adminSession: Session): Promise<void> {
  const label = 'U:AdminFlujos';
  console.log(c('CYAN', '\n── Scenario U: Admin Flujos CRUD ───────────────────────────────────────'));

  let flujoId = '';
  let pasoId = '';
  let asignacionId = '';

  await scenario('U1 GET /admin/flujos (list)', label, async () => {
    const { status, body } = await get('/admin/flujos', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Not an array');
  });

  await scenario('U2 POST /admin/flujos (create with pasos)', label, async () => {
    const { status, body } = await post('/admin/flujos', {
      nombre: `SIM3-Flujo-${Date.now()}`,
      tipoDocumento: 'PLANILLA',
      descripcion: 'Flujo de prueba simulation3',
      pasos: [
        {
          orden: 1,
          nombrePaso: 'Aprobación Supervisor',
          rolAprobador: 'SUPERVISOR',
          requiereComentarioRechazo: true,
          notificarRoles: ['OPERADOR'],
        },
        {
          orden: 2,
          nombrePaso: 'Aprobación RRHH',
          rolAprobador: 'RRHH',
          requiereComentarioRechazo: true,
          notificarRoles: ['SUPERVISOR'],
        },
      ],
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    flujoId = b.id as string;
    const pasos = b.pasos as Array<Record<string, unknown>>;
    assert(pasos.length === 2, `Expected 2 pasos, got ${pasos.length}`);
    cleanupQueue.push(async () => { await del(`/admin/flujos/${flujoId}`, adminSession.token); });
  });

  await scenario('U3 GET /admin/flujos/:id (single)', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (U2 failed)');
    const { status, body } = await get(`/admin/flujos/${flujoId}`, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.id === flujoId, 'Wrong flujo returned');
    assert(Array.isArray(b.pasos), 'Missing pasos');
  });

  await scenario('U4 PUT /admin/flujos/:id (update name)', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (U2 failed)');
    const { status, body } = await put(`/admin/flujos/${flujoId}`, {
      nombre: `SIM3-Flujo-Updated-${Date.now()}`,
      descripcion: 'Flujo actualizado',
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  await scenario('U5 POST /admin/flujos/:id/pasos (add step)', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (U2 failed)');
    const { status, body } = await post(`/admin/flujos/${flujoId}/pasos`, {
      orden: 3,
      nombrePaso: 'Revisión Coordinador',
      rolAprobador: 'COORDINADOR',
      requiereComentarioRechazo: false,
      notificarRoles: [],
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No paso id');
    pasoId = b.id as string;
  });

  await scenario('U6 PUT /admin/flujos/:id/pasos/:pid (update step)', label, async () => {
    if (!flujoId || !pasoId) throw new Error('IDs not set (U2/U5 failed)');
    const { status, body } = await put(`/admin/flujos/${flujoId}/pasos/${pasoId}`, {
      orden: 3,
      nombrePaso: 'Revisión Coordinador (actualizado)',
      rolAprobador: 'COORDINADOR',
      tiempoLimiteHoras: 72,
    }, adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  await scenario('U7 DELETE /admin/flujos/:id/pasos/:pid', label, async () => {
    if (!flujoId || !pasoId) throw new Error('IDs not set');
    const { status } = await del(`/admin/flujos/${flujoId}/pasos/${pasoId}`, adminSession.token);
    assertStatus(status, 204);
  });

  await scenario('U8 GET /admin/flujos/asignaciones/list', label, async () => {
    const { status, body } = await get('/admin/flujos/asignaciones/list', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Not an array');
  });

  await scenario('U9 POST /admin/flujos/asignaciones', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (U2 failed)');
    const { status, body } = await post('/admin/flujos/asignaciones', {
      flujoId,
      tipoDocumento: 'PLANILLA',
    }, adminSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No asignacion id');
    asignacionId = b.id as string;
  });

  await scenario('U10 DELETE /admin/flujos/asignaciones/:id', label, async () => {
    if (!asignacionId) throw new Error('asignacionId not set (U9 failed)');
    const { status } = await del(`/admin/flujos/asignaciones/${asignacionId}`, adminSession.token);
    assertStatus(status, 204);
  });

  await scenario('U11 DELETE /admin/flujos/:id', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (U2 failed)');
    const { status } = await del(`/admin/flujos/${flujoId}`, adminSession.token);
    assertStatus(status, 204);
    cleanupQueue.pop(); // already deleted
    flujoId = '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO W: Usuarios CRUD
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioW_UsuariosCRUD(
  rrhhSession: Session,
  adminSession: Session,
  diagramaId: string,
): Promise<void> {
  const label = 'W:UsuariosCRUD';
  console.log(c('CYAN', '\n── Scenario W: Usuarios CRUD ──────────────────────────────────────────'));

  let newUserId = '';
  const newEmail = `sim3.test.${Date.now()}@demo.com`;

  await scenario('W1 POST /usuarios (create new employee)', label, async () => {
    const { status, body } = await post('/usuarios', {
      nombre: 'Sim3',
      apellido: 'TestUser',
      email: newEmail,
      password: 'Simulation3Test1!',
      rol: 'OPERADOR',
      fechaIngreso: '2024-01-01T00:00:00.000Z',
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id');
    newUserId = b.id as string;
    cleanupQueue.push(async () => { await del(`/usuarios/${newUserId}`, adminSession.token); });
  });

  await scenario('W2 GET /usuarios/:id (single)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    const { status, body } = await get(`/usuarios/${newUserId}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.id === newUserId, 'Wrong user returned');
    assert(b.email === newEmail, 'Wrong email');
  });

  await scenario('W3 PUT /usuarios/:id (update fields)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    const { status, body } = await put(`/usuarios/${newUserId}`, {
      nombre: 'Sim3Updated',
      telefono: '+54 9 299 111-2233',
      legajo: 'SIM3-001',
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.legajo === 'SIM3-001', `Wrong legajo: ${b.legajo}`);
  });

  await scenario('W4 GET /usuarios/:id/ficha (RRHH)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    const { status, body } = await get(`/usuarios/${newUserId}/ficha`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.id === newUserId, 'Wrong user in ficha');
  });

  await scenario('W5 POST /usuarios/:id/reset-password (RRHH)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    const { status, body } = await post(`/usuarios/${newUserId}/reset-password`, {}, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.temporalPassword !== undefined || b.ok === true || b.message !== undefined,
      `Unexpected response: ${JSON.stringify(b)}`);
  });

  await scenario('W6 PATCH /usuarios/:id/diagrama (assign diagram)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    if (!diagramaId) throw new Error('diagramaId not set (Q2 failed)');
    const { status, body } = await patch(`/usuarios/${newUserId}/diagrama`, {
      diagramaId,
      fechaInicio: '2024-01-01T00:00:00.000Z',
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  await scenario('W7 DELETE /usuarios/:id (soft deactivate)', label, async () => {
    if (!newUserId) throw new Error('newUserId not set (W1 failed)');
    const { status } = await del(`/usuarios/${newUserId}`, adminSession.token);
    assertStatus(status, 204);
    cleanupQueue.pop(); // already deleted (soft-deleted)
    newUserId = '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO X: Test Bed — create + approve a planilla for subsequent export tests
// ═══════════════════════════════════════════════════════════════════════════════

interface PlanillaTestData {
  planillaId: string;
  usuarioId: string;
  sectorId: string;
  sectorNombre: string;
  periodoInicio: string;
  periodoFin: string;
}

async function scenarioX_TestBed(
  francoSession: Session,
  users: UserInfo[],
  rrhhSession: Session,
): Promise<PlanillaTestData | null> {
  const label = 'X:TestBed';
  console.log(c('CYAN', '\n── Scenario X: Test Bed (create + approve planilla) ────────────────────'));

  let planillaId = '';
  let result: PlanillaTestData | null = null;

  // Find Franco's sector info
  const francoUser = users.find(u => u.email?.includes('franco.alvarez'));
  const francoSector = francoUser?.sector?.nombre ?? 'Fractura';

  await scenario('X1 Create + fill planilla (Franco)', label, async () => {
    let created = false;
    for (let attempt = 0; attempt < 25 && !created; attempt++) {
      const { inicio, fin, dates } = sim3Period(attempt * 37);

      const { status: cs, body: cb } = await post(
        '/planillas',
        { periodoInicio: inicio.toISOString(), periodoFin: fin.toISOString() },
        francoSession.token,
      );

      if (cs === 409) {
        const cid = (cb as Record<string, unknown>).planillaId as string | undefined;
        if (cid) {
          const { body: ex } = await get(`/planillas/${cid}`, francoSession.token);
          const est = (ex as Record<string, unknown>).estado as string;
          if (['BORRADOR', 'RECHAZADA'].includes(est)) {
            await del(`/planillas/${cid}`, francoSession.token);
          }
        }
        continue;
      }
      if (cs !== 201) continue;

      planillaId = (cb as Record<string, unknown>).id as string;

      // Fill 3 days
      for (const d of dates) {
        await post(`/planillas/${planillaId}/registros`, {
          fecha: d,
          entradaTurno1: isoTs(d, '08:00'),
          salidaTurno1: isoTs(d, '17:00'),
          lugarTrabajo: 'BASE',
        }, francoSession.token);
      }

      created = true;
    }
    assert(planillaId !== '', 'Could not create planilla after 25 attempts');
    log('ℹ', `Planilla ${planillaId} created`, label);
  });

  await scenario('X2 Submit planilla (enviar)', label, async () => {
    if (!planillaId) throw new Error('planillaId not set (X1 failed)');
    const { status, body } = await post(`/planillas/${planillaId}/enviar`, {}, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as Record<string, unknown>).estado === 'ENVIADA', 'Not ENVIADA after enviar');
  });

  await scenario('X3 Walk approval chain → APROBADA', label, async () => {
    if (!planillaId) throw new Error('planillaId not set (X1 failed)');
    const finalEstado = await walkApprovalChain(planillaId, users, francoSector, rrhhSession, label);
    assert(finalEstado === 'APROBADA', `Expected APROBADA, got ${finalEstado}`);
  });

  await scenario('X4 Verify planilla is APROBADA', label, async () => {
    if (!planillaId) throw new Error('planillaId not set (X1 failed)');
    const { status, body } = await get(`/planillas/${planillaId}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'APROBADA', `Expected APROBADA, got ${b.estado}`);
    // Populate result for downstream tests
    result = {
      planillaId,
      usuarioId: francoSession.user.id,
      sectorId: francoSession.user.sectorId ?? '',
      sectorNombre: francoSector,
      periodoInicio: (b.periodoInicio as string),
      periodoFin: (b.periodoFin as string),
    };
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO Y: Export XLSX endpoints
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioY_ExportXLSX(
  rrhhSession: Session,
  data: PlanillaTestData,
): Promise<void> {
  const label = 'Y:ExportXLSX';
  console.log(c('CYAN', '\n── Scenario Y: Export XLSX ─────────────────────────────────────────────'));

  await scenario('Y1 GET /export/planilla/:id (XLSX single planilla)', label, async () => {
    const { status } = await get(`/export/planilla/${data.planillaId}`, rrhhSession.token);
    assertStatus(status, 200);
  });

  await scenario('Y2 GET /export/sector/:sid (XLSX by sector)', label, async () => {
    if (!data.sectorId) throw new Error('sectorId not set (X4 returned no sectorId)');
    const { status } = await get(`/export/sector/${data.sectorId}`, rrhhSession.token);
    assertStatus(status, 200);
  });

  await scenario('Y3 GET /export/pendientes (XLSX pending planillas)', label, async () => {
    const { status } = await get('/export/pendientes', rrhhSession.token);
    assertStatus(status, 200);
  });

  await scenario('Y4 POST /export/cierre (XLSX generation, no state change)', label, async () => {
    const { status, body } = await post('/export/cierre', {
      exportarTodos: true,
      forzar: true,   // bypass "usuarios sin planilla" check (test DB has 91 users, 1 planilla)
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO AA: Exportaciones log + cierre (closes APROBADA → CERRADA)
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioAA_Exportaciones(
  rrhhSession: Session,
  data: PlanillaTestData,
): Promise<void> {
  const label = 'AA:Exportaciones';
  console.log(c('CYAN', '\n── Scenario AA: Exportaciones log + cierre ─────────────────────────────'));

  await scenario('AA1 GET /exportaciones (list)', label, async () => {
    const { status, body } = await get('/exportaciones', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Not an array');
  });

  await scenario('AA2 POST /exportaciones (create log entry)', label, async () => {
    const { status, body } = await post('/exportaciones', {
      periodoInicio: data.periodoInicio,
      periodoFin: data.periodoFin,
      sectoresIds: [data.sectorId],
      usuariosIds: [data.usuarioId],
      nombreArchivo: `sim3-test-export-${Date.now()}.xlsx`,
      totalPersonas: 1,
      totalRegistros: 3,
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id in exportacion');
  });

  await scenario('AA3 POST /exportaciones/cierre (close APROBADA → CERRADA)', label, async () => {
    const { status, body } = await post('/exportaciones/cierre', {
      periodoInicio: data.periodoInicio,
      periodoFin: data.periodoFin,
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.ok === true, 'Missing ok:true');
    assert(typeof b.planillasCerradas === 'number' && (b.planillasCerradas as number) >= 1,
      `Expected ≥1 planillas cerradas, got ${b.planillasCerradas}`);
    log('ℹ', `Closed ${b.planillasCerradas} planilla(s), created ${b.recibosCreados} recibo(s)`, label);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO CC: Backup status (read-only)
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioCC_Backup(adminSession: Session): Promise<void> {
  const label = 'CC:Backup';
  console.log(c('CYAN', '\n── Scenario CC: Backup Status ──────────────────────────────────────────'));

  await scenario('CC1 GET /backup/status (read-only)', label, async () => {
    const { status, body } = await get('/backup/status', adminSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.totalBackups === 'number', `Missing totalBackups: ${JSON.stringify(b)}`);
    log('ℹ', `Total backups: ${b.totalBackups}`, label);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO DD: Compensatorio Reject → Re-submit balance tracking (bug regression)
//
// Problem:
//   The test DB has no COMPENSATORIO flow, so compensatorio ausencias get flujoId=null.
//   rechazar requires a flujo step to find the authorized rejector, so we create
//   a temporary COMPENSATORIO flow (1 RRHH step, default assignment) for this test.
//
// Test path:
//   Create flow → Franco creates compensatorio (now picks up flujoId)
//   → RRHH rejects (tests Fix 1: atomic rechazar + saldo restore)
//   → verify pending=0 → RRHH re-submits via enviar (tests Fix 2: saldo re-reservation)
//   → verify pending=1 [regression]
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioDD_CompensatorioRejectResubmit(
  francoSession: Session,
  rrhhSession: Session,
  adminSession: Session,
): Promise<void> {
  const label = 'DD:CompensatorioRejectResubmit';
  console.log(c('CYAN', '\n── Scenario DD: Compensatorio Reject→Resubmit Balance ──────────────────'));

  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + 3);
  const futureDateStr = fmt(futureDate);
  const anio = futureDate.getFullYear();

  let flujoId = '';
  let asignacionId = '';
  let ausenciaId = '';
  let francoSaldoId = '';

  // DD1: Create a COMPENSATORIO flow with a single RRHH step + default assignment
  // (The test DB has no COMPENSATORIO flow; rechazar requires one to authorize the rejector.)
  await scenario('DD1 Create COMPENSATORIO flow (RRHH step) for test', label, async () => {
    const { status: fs, body: fb } = await post('/admin/flujos', {
      nombre: `DD-Compensatorio-${Date.now()}`,
      tipoDocumento: 'COMPENSATORIO',
      descripcion: 'Flujo temporal para test DD',
      pasos: [{
        orden: 1,
        nombrePaso: 'Aprobación RRHH',
        rolAprobador: 'RRHH',
        requiereComentarioRechazo: true,
        notificarRoles: ['OPERADOR'],
      }],
    }, adminSession.token);
    assertStatus(fs, 201, JSON.stringify(fb));
    flujoId = (fb as Record<string, unknown>).id as string;

    const { status: as, body: ab } = await post('/admin/flujos/asignaciones', {
      flujoId,
      tipoDocumento: 'COMPENSATORIO',
      // no sectorId / usuarioId → default for all users
    }, adminSession.token);
    assertStatus(as, 201, JSON.stringify(ab));
    asignacionId = (ab as Record<string, unknown>).id as string;

    cleanupQueue.push(async () => {
      if (asignacionId) await del(`/admin/flujos/asignaciones/${asignacionId}`, adminSession.token);
      if (flujoId) await del(`/admin/flujos/${flujoId}`, adminSession.token);
    });
  });

  // DD2: Seed Franco saldo (acumulados=3, pending=0)
  await scenario('DD2 Admin seeds Franco compensatorio saldo (acumulados=3)', label, async () => {
    await get('/vacaciones/saldo', francoSession.token); // trigger auto-creation
    const { body: saldosBody } = await get('/vacacion-saldos', adminSession.token);
    const saldos = saldosBody as Array<Record<string, unknown>>;
    const s = saldos.find(x => x.usuarioId === francoSession.user.id && x.anio === anio);
    if (!s) throw new Error(`Franco saldo for year ${anio} not found`);
    francoSaldoId = s.id as string;
    const { status } = await put(`/vacacion-saldos/${francoSaldoId}`, {
      compensatoriosAcumulados: 3,
      compensatoriosUsados: 0,
      compensatoriosPendientes: 0,
    }, adminSession.token);
    assertStatus(status, 200, 'Failed to seed saldo');
    cleanupQueue.push(async () => {
      if (francoSaldoId) {
        await put(`/vacacion-saldos/${francoSaldoId}`, {
          compensatoriosAcumulados: 0,
          compensatoriosUsados: 0,
          compensatoriosPendientes: 0,
        }, adminSession.token);
      }
    });
  });

  // DD3: Franco creates compensatorio → PENDIENTE, pending+1 (picks up new flujoId)
  await scenario('DD3 Franco requests 1 compensatorio day', label, async () => {
    if (!flujoId) throw new Error('flujoId not set (DD1 failed)');
    const { status, body } = await post('/ausencias/compensatorio', {
      fechaInicio: futureDateStr,
      fechaFin: futureDateStr,
      diasAusencia: 1,
      descripcion: 'DD regression: reject/resubmit balance',
    }, francoSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    ausenciaId = (body as Record<string, unknown>).id as string;
    assert(ausenciaId.length > 0, 'No ausencia ID returned');
    const b = body as Record<string, unknown>;
    assert(b.flujoId === flujoId, `Expected flujoId=${flujoId}, got ${b.flujoId}`);
    log('ℹ', `Ausencia: ${ausenciaId}`, label);

    cleanupQueue.push(async () => {
      if (ausenciaId) await post(`/ausencias/${ausenciaId}/revocar`, { motivo: 'DD cleanup' }, francoSession.token).catch(() => {});
    });
  });

  // DD4: Verify pending balance incremented to 1
  await scenario('DD4 Saldo: compensatoriosPendientes=1 after creation', label, async () => {
    if (!ausenciaId) throw new Error('ausenciaId not set (DD3 failed)');
    const { body: saldosBody } = await get('/vacacion-saldos', adminSession.token);
    const saldos = saldosBody as Array<Record<string, unknown>>;
    const s = saldos.find(x => x.usuarioId === francoSession.user.id && x.anio === anio);
    if (!s) throw new Error('Franco saldo not found');
    assert(s.compensatoriosPendientes === 1, `Expected pending=1, got ${s.compensatoriosPendientes}`);
  });

  // DD5: RRHH rejects at paso 1 (RRHH step) — tests Fix 1: atomic rechazar + saldo restore
  await scenario('DD5 RRHH rejects compensatorio [Fix 1: rechazar transaction]', label, async () => {
    if (!ausenciaId) throw new Error('ausenciaId not set');
    const { status, body } = await post(`/ausencias/${ausenciaId}/rechazar`, {
      motivo: 'Test rejection — DD regression',
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'RECHAZADA', `Expected RECHAZADA, got ${b.estado}`);
  });

  // DD6: Verify pending balance restored to 0 (validates Fix 1)
  await scenario('DD6 Saldo: compensatoriosPendientes=0 after rejection [Fix 1 validates]', label, async () => {
    if (!ausenciaId) throw new Error('ausenciaId not set');
    const { body: saldosBody } = await get('/vacacion-saldos', adminSession.token);
    const saldos = saldosBody as Array<Record<string, unknown>>;
    const s = saldos.find(x => x.usuarioId === francoSession.user.id && x.anio === anio);
    if (!s) throw new Error('Franco saldo not found');
    assert(s.compensatoriosPendientes === 0, `Expected pending=0 after rejection, got ${s.compensatoriosPendientes}`);
  });

  // DD7: RRHH re-submits the RECHAZADA compensatorio — tests Fix 2: saldo re-reservation on enviar
  await scenario('DD7 RRHH re-submits rejected compensatorio [Fix 2: enviar re-reserves]', label, async () => {
    if (!ausenciaId) throw new Error('ausenciaId not set');
    const { status, body } = await post(`/ausencias/${ausenciaId}/enviar`, {}, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'PENDIENTE', `Expected PENDIENTE after re-submit, got ${b.estado}`);
  });

  // DD8: Verify pending balance re-reserved — key regression test for Fix 2
  await scenario('DD8 Saldo: compensatoriosPendientes=1 after re-submission [Fix 2 regression]', label, async () => {
    if (!ausenciaId) throw new Error('ausenciaId not set');
    const { body: saldosBody } = await get('/vacacion-saldos', adminSession.token);
    const saldos = saldosBody as Array<Record<string, unknown>>;
    const s = saldos.find(x => x.usuarioId === francoSession.user.id && x.anio === anio);
    if (!s) throw new Error('Franco saldo not found');
    assert(
      s.compensatoriosPendientes === 1,
      `Expected pending=1 after re-submission, got ${s.compensatoriosPendientes} — Fix 2 regression: enviar did not re-reserve saldo`,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(c('BOLD', '\n╔══════════════════════════════════════════════════════════════════╗'));
  console.log(c('BOLD', '║  Planilla de Horas — simulation3.ts (Admin + Export Coverage)   ║'));
  console.log(c('BOLD', '╚══════════════════════════════════════════════════════════════════╝\n'));

  // ── Bootstrap: login all sessions ────────────────────────────────────────────

  const adminSession = await login('admin@wenlen.com');
  const rrhhSession  = await login('rrhh1@test.wenlen.com');
  const francoSession = await login('op1.almacen@test.wenlen.com');

  log(c('BLUE', '●'), `Admin:  ${adminSession.user.nombre} ${adminSession.user.apellido}`);
  log(c('BLUE', '●'), `RRHH:   ${rrhhSession.user.nombre} ${rrhhSession.user.apellido}`);
  log(c('BLUE', '●'), `Franco: ${francoSession.user.nombre} ${francoSession.user.apellido}`);

  // ── Load user list for approval chain ────────────────────────────────────────

  const { body: usersBody } = await get('/usuarios', rrhhSession.token);
  const users = usersBody as UserInfo[];
  log(c('BLUE', '●'), `Loaded ${users.length} users for approval chain lookups`);

  // ── Run scenarios ─────────────────────────────────────────────────────────────

  await scenarioP_AdminSectores(adminSession);
  const diagramaId = await scenarioQ_AdminDiagramas(adminSession);
  await scenarioR_AdminRoles(adminSession);
  await scenarioS_AdminConfig(adminSession);
  await scenarioT_AdminAlertas(rrhhSession);
  await scenarioU_AdminFlujos(adminSession);
  await scenarioW_UsuariosCRUD(rrhhSession, adminSession, diagramaId);

  // Test bed: create + approve a planilla
  const planillaData = await scenarioX_TestBed(francoSession, users, rrhhSession);

  if (planillaData) {
    await scenarioY_ExportXLSX(rrhhSession, planillaData);
    await scenarioAA_Exportaciones(rrhhSession, planillaData);
  } else {
    log(c('YELLOW', '⚠'), 'Test bed planilla setup failed — skipping Y, AA, Z, BB scenarios');
    for (const name of ['Y1','Y2','Y3','Y4','Y5','AA1','AA2','AA3','Z1','Z2','Z3','Z4','BB1','BB2','BB3','BB4']) {
      results.push({ name, passed: false, detail: 'Skipped: Test bed (X) failed', scenario: 'SKIPPED', ms: 0 });
    }
  }

  await scenarioCC_Backup(adminSession);
  await scenarioDD_CompensatorioRejectResubmit(francoSession, rrhhSession, adminSession);

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  console.log(c('CYAN', '\n── Cleanup ─────────────────────────────────────────────────────────────'));
  const reversed = [...cleanupQueue].reverse();
  let cleanupFailed = 0;
  for (const fn of reversed) {
    try { await fn(); } catch { cleanupFailed++; }
  }
  if (cleanupFailed > 0) log(c('YELLOW', '⚠'), `${cleanupFailed} cleanup step(s) failed (non-critical)`);
  else log(c('GREEN', '✅'), 'Cleanup complete');

  // ── Summary ───────────────────────────────────────────────────────────────────

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(c('BOLD', '\n╔══════════════════════════════════════════════════════════════════╗'));
  console.log(c('BOLD', `║  Results: ${passed}/${total} passed  ${failed > 0 ? `(${failed} FAILED)` : '(ALL PASSED)'}`.padEnd(67) + '║'));
  console.log(c('BOLD', '╚══════════════════════════════════════════════════════════════════╝\n'));

  if (failed > 0) {
    console.log(c('RED', 'FAILURES:'));
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${c('RED', '✗')} ${c('DIM', `[${r.scenario}]`)} ${r.name}`);
      console.log(`      ${c('YELLOW', r.detail)}`);
    }
    console.log('');
  }

  // Group by scenario
  const byScenario = new Map<string, Result[]>();
  for (const r of results) {
    const arr = byScenario.get(r.scenario) ?? [];
    arr.push(r);
    byScenario.set(r.scenario, arr);
  }

  for (const [scen, rs] of byScenario) {
    const p = rs.filter(r => r.passed).length;
    const sym = p === rs.length ? c('GREEN', '●') : c('RED', '○');
    const avgMs = rs.reduce((s, r) => s + r.ms, 0) / rs.length;
    process.stdout.write(`  ${sym} ${scen.padEnd(20)} ${p}/${rs.length}  (avg ${avgMs.toFixed(0)}ms)\n`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c('RED', `\nFATAL: ${err.message}`));
  process.exit(1);
});
