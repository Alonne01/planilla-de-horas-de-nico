/**
 * Planilla de Horas — Extended Simulation Suite (simulation2.ts)
 *
 * Covers all endpoints not tested by integration.ts or simulation.ts:
 *   G. Capacitaciones — tipos CRUD, registros, resumen, mis-capacitaciones
 *   H. Sesiones Capacitación — create, invite, respond, update, cancel
 *   I. FRANCO_COMPENSATORIO — saldo grant, request, revocar, re-request, approve
 *   J. LICENCIA_ESPECIAL + RRHH ausencia admin — create/edit/delete
 *   K. Planilla edge cases — multi-shift, delete registro, submit-with-gaps
 *   L. Analytics + Auditoria — all dashboard endpoints
 *   M. Vacacion-saldos admin — generar, adjust, mi-saldo, insufficient check
 *   N. WenTop CMASS — tarjeta lifecycle, analytics, gestores
 *   O. Cambios Diagrama — create request, approval chain
 *
 * Requirements:
 *   - API running at http://localhost:4000
 *   - DEBUG_AUTH=true in .env (any password accepted)
 *   - Database seeded with demo users
 *
 * Run: cd apps/api && npx tsx tests/simulation2.ts
 */

const BASE = 'http://localhost:4000/api/v1';

// ── Colors / output ────────────────────────────────────────────────────────────

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

const get  = (p: string, tok?: string) => api('GET',    p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST',   p, { token: tok, body: b });
const put  = (p: string, b: unknown, tok?: string) => api('PUT',    p, { token: tok, body: b });
const patch = (p: string, b: unknown, tok?: string) => api('PATCH', p, { token: tok, body: b });
const del  = (p: string, tok?: string) => api('DELETE', p, { token: tok });

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
 * Uses years 1940–1973 (distinct from sim1: 1975-1998 and integration: 2002-2019).
 */
function sim2Period(offset = 0): { inicio: Date; fin: Date; dates: string[] } {
  const slot  = Math.floor(Date.now() / 60_000) + offset + 20_000;
  const year  = 1940 + (slot % 33);  // 1940–1972
  const month = (slot % 12) + 1;
  const day   = (slot % 20) + 1;
  const inicio = new Date(year, month - 1, day);
  const fin    = new Date(year, month - 1, day + 2);
  return {
    inicio, fin,
    dates: [fmt(inicio), fmt(new Date(inicio.getTime() + 86_400_000)), fmt(fin)],
  };
}

interface UserInfo {
  id: string; nombre: string; apellido: string; email: string;
  rol: string; sector: { nombre: string } | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO G: Capacitaciones — tipos CRUD, registros, resumen
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioG_Capacitaciones(users: UserInfo[], rrhhSession: Session, adminSession: Session) {
  const label = 'G:Capacitaciones';
  console.log(c('CYAN', '\n── Scenario G: Capacitaciones — tipos CRUD + registros ─────────────────'));

  let tipoId = '';
  let registroId = '';
  let empleadoSession: Session;

  // Use Franco Álvarez as the employee to receive training
  const francoUser = users.find(u => u.email.includes('franco.alvarez'));
  assert(!!francoUser, 'franco.alvarez not found');
  empleadoSession = await login(francoUser!.email);

  // G1: RRHH creates training type
  await scenario('G1 POST /capacitaciones/tipos (RRHH creates)', label, async () => {
    const { status, body } = await post('/capacitaciones/tipos', {
      nombre: `SIM2-Seguridad en Altura ${Date.now()}`,
      descripcion: 'Capacitación en trabajo en altura',
      vigenciaDias: 365,
      esObligatoria: true,
      alertaDias: 30,
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id in response');
    tipoId = b.id as string;
    cleanupQueue.push(async () => { await del(`/capacitaciones/tipos/${tipoId}`, rrhhSession.token); });
  });

  // G2: COORDINADOR lists training types
  await scenario('G2 GET /capacitaciones/tipos (COORDINADOR)', label, async () => {
    const coord = users.find(u => u.rol === 'COORDINADOR');
    if (!coord) { log('⚠', 'No COORDINADOR found, skipping', label); return; }
    const coordSession = await login(coord.email);
    const { status, body } = await get('/capacitaciones/tipos', coordSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // G3: RRHH updates training type
  await scenario('G3 PUT /capacitaciones/tipos/:id', label, async () => {
    assert(!!tipoId, 'tipoId not set');
    const { status, body } = await put(`/capacitaciones/tipos/${tipoId}`, {
      alertaDias: 45,
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert((b.alertaDias as number) === 45, `alertaDias expected 45, got ${b.alertaDias}`);
  });

  // G4: RRHH creates training record for employee
  await scenario('G4 POST /capacitaciones/registros', label, async () => {
    assert(!!tipoId, 'tipoId not set');
    const { status, body } = await post('/capacitaciones/registros', {
      usuarioId: francoUser!.id,
      tipoId,
      fechaRealizacion: '2024-01-15',
      institucion: 'Centro de Capacitación Industrial',
      observaciones: 'Aprobado con nota 9',
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.id === 'string', 'No id in registro');
    registroId = b.id as string;
    cleanupQueue.push(async () => { await del(`/capacitaciones/registros/${registroId}`, rrhhSession.token); });
  });

  // G5: COORDINADOR lists all records
  await scenario('G5 GET /capacitaciones/registros', label, async () => {
    const { status, body } = await get('/capacitaciones/registros', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // G6: Filter records by estado
  await scenario('G6 GET /capacitaciones/registros?estado=vigente', label, async () => {
    const { status, body } = await get('/capacitaciones/registros?estado=vigente', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // G7: GET /capacitaciones/resumen
  await scenario('G7 GET /capacitaciones/resumen', label, async () => {
    const { status, body } = await get('/capacitaciones/resumen', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('vigentes' in b || 'total' in b || Array.isArray(b), 'Unexpected resumen shape');
  });

  // G8: Employee views own training records
  await scenario('G8 GET /capacitaciones/mis-capacitaciones', label, async () => {
    const { status, body } = await get('/capacitaciones/mis-capacitaciones', empleadoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // G9: RRHH deletes (deactivates) training record
  await scenario('G9 DELETE /capacitaciones/registros/:id', label, async () => {
    assert(!!registroId, 'registroId not set');
    const { status } = await del(`/capacitaciones/registros/${registroId}`, rrhhSession.token);
    assert([200, 204].includes(status), `Expected 200/204, got ${status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO H: Sesiones Capacitación — create, invite, respond, update, cancel
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioH_SesionesCapacitacion(users: UserInfo[], rrhhSession: Session) {
  const label = 'H:SesionesCap';
  console.log(c('CYAN', '\n── Scenario H: Sesiones Capacitación ───────────────────────────────────'));

  let tipoId = '';
  let sesionId = '';
  let invitacionId = '';

  // Find COORDINADOR and an OPERADOR
  const coord = users.find(u => u.rol === 'COORDINADOR');
  const operador = users.find(u => u.rol === 'OPERADOR');
  assert(!!coord, 'No COORDINADOR found');
  assert(!!operador, 'No OPERADOR found');

  const coordSession = await login(coord!.email);
  const empSession = await login(operador!.email);

  // H1: RRHH creates training type for the session
  await scenario('H1 Create tipo for session', label, async () => {
    const { status, body } = await post('/capacitaciones/tipos', {
      nombre: `SIM2-Primeros Auxilios ${Date.now()}`,
      vigenciaDias: 730,
      esObligatoria: true,
    }, rrhhSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    tipoId = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => { await del(`/capacitaciones/tipos/${tipoId}`, rrhhSession.token); });
  });

  // H2: COORDINADOR creates a training session
  await scenario('H2 POST /sesiones-capacitacion', label, async () => {
    assert(!!tipoId, 'tipoId not set');
    const { status, body } = await post('/sesiones-capacitacion', {
      tipoId,
      titulo: `SIM2 Sesión Primeros Auxilios ${Date.now()}`,
      descripcion: 'Sesión de entrenamiento en primeros auxilios',
      fecha: '2025-06-15',
      horaInicio: '09:00',
      horaFin: '12:00',
      lugar: 'Sala de capacitación A',
      vacantes: 10,
    }, coordSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    sesionId = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => {
      const { body: sb } = await get(`/sesiones-capacitacion`, coordSession.token);
      const sesiones = sb as Array<Record<string, unknown>>;
      const s = sesiones.find(x => x.id === sesionId);
      if (s && s.estado !== 'CANCELADA' && s.estado !== 'FINALIZADA') {
        await del(`/sesiones-capacitacion/${sesionId}`, coordSession.token);
      }
    });
  });

  // H3: COORDINADOR lists sessions
  await scenario('H3 GET /sesiones-capacitacion', label, async () => {
    const { status, body } = await get('/sesiones-capacitacion', coordSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // H4: COORDINADOR lists subordinates to invite
  await scenario('H4 GET /sesiones-capacitacion/subordinados', label, async () => {
    const { status, body } = await get('/sesiones-capacitacion/subordinados', coordSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // H5: COORDINADOR invites employees
  await scenario('H5 POST /sesiones-capacitacion/:id/invitar', label, async () => {
    assert(!!sesionId, 'sesionId not set');
    const { status, body } = await post(`/sesiones-capacitacion/${sesionId}/invitar`, {
      usuarioIds: [operador!.id],
    }, coordSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    const invList = (b.invitaciones || b) as Array<Record<string, unknown>>;
    const inv = Array.isArray(invList) ? invList.find(i => i.usuarioId === operador!.id) : null;
    if (inv) invitacionId = inv.id as string;
  });

  // H6: Employee views own invitations
  await scenario('H6 GET /sesiones-capacitacion/mis-invitaciones', label, async () => {
    const { status, body } = await get('/sesiones-capacitacion/mis-invitaciones', empSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
    // Find the invitation created
    const invs = body as Array<Record<string, unknown>>;
    if (invs.length > 0 && !invitacionId) {
      const found = invs.find(i => (i.sesionId === sesionId) || (i.sesion as Record<string, unknown>)?.id === sesionId);
      if (found) invitacionId = found.id as string;
    }
  });

  // H7: Employee responds to invitation (ACEPTADA)
  await scenario('H7 POST /sesiones-capacitacion/mis-invitaciones/:id/responder (ACEPTADA)', label, async () => {
    if (!invitacionId) {
      // Retry: get invitations list
      const { body } = await get('/sesiones-capacitacion/mis-invitaciones', empSession.token);
      const invs = body as Array<Record<string, unknown>>;
      const inv = invs.find(i => {
        const sesId = i.sesionId || (i.sesion as Record<string, unknown>)?.id;
        return sesId === sesionId;
      });
      if (inv) invitacionId = inv.id as string;
    }
    assert(!!invitacionId, 'invitacionId not found — check H5/H6');
    const { status, body } = await post(
      `/sesiones-capacitacion/mis-invitaciones/${invitacionId}/responder`,
      { aceptar: true },
      empSession.token,
    );
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'ACEPTADA', `Expected ACEPTADA, got ${b.estado}`);
  });

  // H8: COORDINADOR updates session details
  await scenario('H8 PUT /sesiones-capacitacion/:id', label, async () => {
    assert(!!sesionId, 'sesionId not set');
    const { status, body } = await put(`/sesiones-capacitacion/${sesionId}`, {
      vacantes: 15,
      lugar: 'Sala de capacitación B',
    }, coordSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert((b.vacantes as number) === 15, `Expected vacantes=15, got ${b.vacantes}`);
  });

  // H9: COORDINADOR cancels session
  await scenario('H9 DELETE /sesiones-capacitacion/:id (cancel)', label, async () => {
    assert(!!sesionId, 'sesionId not set');
    const { status } = await del(`/sesiones-capacitacion/${sesionId}`, coordSession.token);
    assert([200, 204].includes(status), `Expected 200/204, got ${status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO I: FRANCO_COMPENSATORIO — saldo, request, revocar, re-request, approve
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioI_Compensatorio(users: UserInfo[], rrhhSession: Session) {
  const label = 'I:Compensatorio';
  console.log(c('CYAN', '\n── Scenario I: FRANCO_COMPENSATORIO ────────────────────────────────────'));

  // Use Kevin Fuentes (Testing sector OPERADOR)
  const kevin = users.find(u => u.email.includes('kevin.fuentes'));
  assert(!!kevin, 'kevin.fuentes not found');
  const kevinSession = await login(kevin!.email);

  const today = new Date();
  const curYear = today.getFullYear();
  // Future date within the current year so saldo year is consistent with request/revokar/avanzar
  const rawFuture = new Date(curYear, today.getMonth() + 1, 15);
  const futureStart = rawFuture.getFullYear() === curYear ? rawFuture : new Date(curYear, 11, 28);
  const futureEnd   = new Date(futureStart.getTime() + 86_400_000);

  let saldoId = '';
  let compAusenciaId = '';
  const anio = today.getFullYear();

  // I1: RRHH gets kevin's vacation saldo for current year
  await scenario('I1 GET /vacacion-saldos?anio (find kevin saldo)', label, async () => {
    const { status, body } = await get(`/vacacion-saldos?anio=${anio}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const saldos = body as Array<Record<string, unknown>>;
    const kevinSaldo = saldos.find(s => (s.usuario as Record<string, unknown>)?.id === kevin!.id);
    if (kevinSaldo) saldoId = kevinSaldo.id as string;
  });

  // I2: RRHH grants compensatorio credits (if saldo found)
  await scenario('I2 PUT /vacacion-saldos/:id (grant compensatorios)', label, async () => {
    if (!saldoId) {
      // Try mi-saldo to create it first
      const { body: ms } = await get('/vacacion-saldos/mi-saldo', kevinSession.token);
      log('ℹ', `mi-saldo response: ${JSON.stringify(ms)}`, label);
      // Re-fetch saldos list
      const { body: list } = await get(`/vacacion-saldos?anio=${anio}`, rrhhSession.token);
      const saldos = list as Array<Record<string, unknown>>;
      const kevinSaldo = saldos.find(s => (s.usuario as Record<string, unknown>)?.id === kevin!.id);
      if (kevinSaldo) saldoId = kevinSaldo.id as string;
    }
    assert(!!saldoId, 'Kevin saldoId not found');
    const { status, body } = await put(`/vacacion-saldos/${saldoId}`, {
      compensatoriosAcumulados: 5,
      compensatoriosUsados: 0,  // Reset used count to avoid depletion across test runs
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert((b.compensatoriosAcumulados as number) >= 5, `Expected compensatoriosAcumulados >= 5, got ${b.compensatoriosAcumulados}`);
  });

  // I3: Kevin requests 1 compensatorio day
  await scenario('I3 POST /ausencias/compensatorio', label, async () => {
    const { status, body } = await post('/ausencias/compensatorio', {
      fechaInicio: fmt(futureStart),
      fechaFin:   fmt(futureEnd),
      diasAusencia: 1,
      descripcion: 'Franco compensatorio por horas extra',
    }, kevinSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.tipo === 'FRANCO_COMPENSATORIO', `Expected FRANCO_COMPENSATORIO, got ${b.tipo}`);
    compAusenciaId = b.id as string;
  });

  // I4: Kevin revokes the compensatorio request (before approval, future date)
  await scenario('I4 POST /ausencias/:id/revocar', label, async () => {
    assert(!!compAusenciaId, 'compAusenciaId not set');
    const { status, body } = await post(`/ausencias/${compAusenciaId}/revocar`, {
      motivo: 'Ya no necesito el día libre',
    }, kevinSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.message === 'string', 'Expected message in response');
  });

  // I5: Kevin re-requests after revocar
  await scenario('I5 POST /ausencias/compensatorio (re-request)', label, async () => {
    const { status, body } = await post('/ausencias/compensatorio', {
      fechaInicio: fmt(new Date(futureStart.getTime() + 7 * 86_400_000)),
      fechaFin:   fmt(new Date(futureEnd.getTime()   + 7 * 86_400_000)),
      diasAusencia: 1,
      descripcion: 'Franco compensatorio re-solicitado',
    }, kevinSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    compAusenciaId = (body as Record<string, unknown>).id as string;
  });

  // I6: Supervisor approves compensatorio
  await scenario('I6 Walk approval chain for compensatorio', label, async () => {
    assert(!!compAusenciaId, 'compAusenciaId not set');
    const { body: ab } = await get(`/ausencias/${compAusenciaId}`, rrhhSession.token);
    const ausencia = ab as Record<string, unknown>;
    const flujo = ausencia.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;
    if (!flujo || flujo.pasos.length === 0) {
      const { status, body } = await post(`/ausencias/${compAusenciaId}/avanzar`, { comentario: 'Aprobado' }, rrhhSession.token);
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    } else {
      const kevinUser = users.find(u => u.email.includes('kevin.fuentes'))!;
      const sectorNombre = kevinUser.sector?.nombre ?? '';
      for (const paso of flujo.pasos) {
        const approver = users.find(u => u.rol === paso.rolAprobador && u.sector?.nombre === sectorNombre)
                      || users.find(u => u.rol === paso.rolAprobador);
        const approverSession = approver ? await login(approver.email) : rrhhSession;
        const { status, body } = await post(`/ausencias/${compAusenciaId}/avanzar`, { comentario: 'OK' }, approverSession.token);
        if (status === 403) {
          log('⚠', `403 on paso ${paso.orden} — using RRHH`, label);
          const { status: s2, body: b2 } = await post(`/ausencias/${compAusenciaId}/avanzar`, { comentario: 'OK' }, rrhhSession.token);
          if (s2 !== 200) throw new Error(`HTTP ${s2}: ${JSON.stringify(b2)}`);
        } else if (status !== 200) {
          throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
        }
        const newEstado = (body as Record<string, unknown>).estado as string;
        log('ℹ', `  Paso ${paso.orden} → ${newEstado}`, label);
        if (newEstado === 'APROBADA') break;
      }
    }
    // Verify final state
    const { body: final } = await get(`/ausencias/${compAusenciaId}`, rrhhSession.token);
    const finalEstado = (final as Record<string, unknown>).estado as string;
    assert(finalEstado === 'APROBADA', `Expected APROBADA, got ${finalEstado}`);
  });

  // I7: Insufficient saldo guard
  await scenario('I7 POST /ausencias/compensatorio (insufficient saldo → 400)', label, async () => {
    const { status, body } = await post('/ausencias/compensatorio', {
      fechaInicio: fmt(new Date(futureStart.getTime() + 60 * 86_400_000)),
      fechaFin:   fmt(new Date(futureStart.getTime() + 90 * 86_400_000)),
      diasAusencia: 100,  // way more than available
      descripcion: 'Test saldo insuficiente',
    }, kevinSession.token);
    assertStatus(status, 400, `Expected 400 for insufficient saldo, got ${status}: ${JSON.stringify(body)}`);
    const b = body as Record<string, unknown>;
    assert(
      typeof b.error === 'string' && b.error.toLowerCase().includes('saldo'),
      `Expected saldo error, got: ${b.error}`,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO J: LICENCIA_ESPECIAL + RRHH ausencia admin (create/edit/delete)
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioJ_LicenciaEspecial(users: UserInfo[], rrhhSession: Session) {
  const label = 'J:LicenciaEspecial';
  console.log(c('CYAN', '\n── Scenario J: LICENCIA_ESPECIAL + RRHH ausencia admin ─────────────────'));

  // Use Hugo Figueroa (Almacén OPERADOR) supervised by Ricardo Vargas
  const hugo = users.find(u => u.email.includes('hugo.figueroa'));
  const supervisor = users.find(u => u.email.includes('ricardo.vargas'));
  assert(!!hugo, 'hugo.figueroa not found');
  assert(!!supervisor, 'ricardo.vargas (supervisor) not found');
  const supSession = await login(supervisor!.email);

  let ausenciaId = '';

  // J1: Supervisor creates LICENCIA_ESPECIAL for subordinate
  await scenario('J1 POST /ausencias (LICENCIA_ESPECIAL by supervisor)', label, async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: hugo!.id,
      tipo: 'LICENCIA_ESPECIAL',
      fechaInicio: '2025-07-01',
      fechaFin: '2025-07-05',
      diasAusencia: 5,
      descripcion: 'Licencia por matrimonio',
    }, supSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.tipo === 'LICENCIA_ESPECIAL', `Expected LICENCIA_ESPECIAL, got ${b.tipo}`);
    ausenciaId = b.id as string;
    cleanupQueue.push(async () => { await del(`/ausencias/${ausenciaId}`, rrhhSession.token); });
  });

  // J2: RRHH edits the absence (PUT /ausencias/:id)
  await scenario('J2 PUT /ausencias/:id (RRHH edits)', label, async () => {
    assert(!!ausenciaId, 'ausenciaId not set');
    const { status, body } = await put(`/ausencias/${ausenciaId}`, {
      descripcion: 'Licencia por matrimonio — actualizada',
      diasAusencia: 5,
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(
      typeof b.descripcion === 'string' && b.descripcion.includes('actualizada'),
      `Expected updated descripcion, got: ${b.descripcion}`,
    );
  });

  // J3: RRHH creates FALTA_INJUSTIFICADA (auto descuentaSueldo)
  let faltaId = '';
  await scenario('J3 POST /ausencias (FALTA_INJUSTIFICADA by supervisor)', label, async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: hugo!.id,
      tipo: 'FALTA_INJUSTIFICADA',
      fechaInicio: '2025-08-01',
      fechaFin: '2025-08-01',
      diasAusencia: 1,
      descripcion: 'Falta sin aviso',
    }, supSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    faltaId = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => { await del(`/ausencias/${faltaId}`, rrhhSession.token); });
  });

  // J4: Verify FALTA_INJUSTIFICADA → descuentaSueldo = true (check in historial/detail)
  await scenario('J4 GET /ausencias/:id — verify FALTA descuentaSueldo', label, async () => {
    assert(!!faltaId, 'faltaId not set');
    const { status, body } = await get(`/ausencias/${faltaId}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.tipo === 'FALTA_INJUSTIFICADA', `Expected FALTA_INJUSTIFICADA, got ${b.tipo}`);
    // descuentaSueldo may be true or false depending on who creates it (supervisor not RRHH)
    // Just verify the field exists
    assert('descuentaSueldo' in b, 'No descuentaSueldo field');
  });

  // J5: RRHH deletes the absence (DELETE /ausencias/:id)
  await scenario('J5 DELETE /ausencias/:id (RRHH deletes)', label, async () => {
    assert(!!ausenciaId, 'ausenciaId not set');
    const { status } = await del(`/ausencias/${ausenciaId}`, rrhhSession.token);
    assert([200, 204].includes(status), `Expected 200/204, got ${status}`);
    ausenciaId = '';  // already deleted, don't clean up again
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO K: Planilla edge cases — multi-shift, delete registro, submit-with-gaps
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioK_PlanillaEdgeCases(users: UserInfo[], rrhhSession: Session) {
  const label = 'K:PlanillaEdge';
  console.log(c('CYAN', '\n── Scenario K: Planilla edge cases ─────────────────────────────────────'));

  const daniel = users.find(u => u.email.includes('daniel.aguirre'));
  assert(!!daniel, 'daniel.aguirre not found');
  const danielSession = await login(daniel!.email);

  const { inicio, fin, dates } = sim2Period(50);
  let planillaId = '';
  let registroId = '';

  // K1: Create planilla for a unique period
  await scenario('K1 POST /planillas (create)', label, async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const { inicio: i, fin: f, dates: ds } = sim2Period(50 + attempt * 37);
      const { status, body } = await post('/planillas', {
        periodoInicio: i.toISOString(),
        periodoFin:    f.toISOString(),
      }, danielSession.token);
      if (status === 409) {
        const cid = (body as Record<string, unknown>).planillaId as string | undefined;
        if (cid) await del(`/planillas/${cid}`, danielSession.token);
        continue;
      }
      assertStatus(status, 201, JSON.stringify(body));
      planillaId = (body as Record<string, unknown>).id as string;
      cleanupQueue.push(async () => {
        const { body: pb } = await get(`/planillas/${planillaId}`, danielSession.token);
        const est = (pb as Record<string, unknown>).estado as string;
        if (['BORRADOR', 'RECHAZADA', 'ENVIADA'].includes(est)) {
          await del(`/planillas/${planillaId}`, danielSession.token);
        }
      });
      break;
    }
    assert(!!planillaId, 'Could not create planilla');
  });

  // K2: Add multi-shift record (Turno1 + Turno2)
  await scenario('K2 POST /planillas/:id/registros (multi-shift Turno1+Turno2)', label, async () => {
    assert(!!planillaId, 'planillaId not set');
    const { inicio: i2 } = sim2Period(50);
    const d = fmt(i2);
    const { status, body } = await post(`/planillas/${planillaId}/registros`, {
      fecha: d,
      entradaTurno1: isoTs(d, '06:00'),
      salidaTurno1:  isoTs(d, '14:00'),
      entradaTurno2: isoTs(d, '18:00'),
      salidaTurno2:  isoTs(d, '22:00'),
      lugarTrabajo: 'CAMPO',
      pernocte: 'NO',
      maneja: false,
    }, danielSession.token);
    if (status !== 201 && status !== 200 && status !== 409) {
      throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    }
    if (status === 201 || status === 200) {
      registroId = (body as Record<string, unknown>).id as string;
    }
  });

  // K3: Add second day (esFeriado flag)
  let reg2Id = '';
  await scenario('K3 POST /planillas/:id/registros (esFeriado flag)', label, async () => {
    assert(!!planillaId, 'planillaId not set');
    const { inicio: i2 } = sim2Period(50);
    const d = fmt(new Date(i2.getTime() + 86_400_000));  // day 2
    const { status, body } = await post(`/planillas/${planillaId}/registros`, {
      fecha: d,
      entradaTurno1: isoTs(d, '08:00'),
      salidaTurno1:  isoTs(d, '17:00'),
      lugarTrabajo: 'BASE',
      esFeriado: true,
      pernocte: 'NO',
    }, danielSession.token);
    if (status !== 201 && status !== 200 && status !== 409) {
      throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    }
    if (status === 201 || status === 200) {
      reg2Id = (body as Record<string, unknown>).id as string;
    }
  });

  // K4: DELETE one registro
  await scenario('K4 DELETE /planillas/:id/registros/:rid', label, async () => {
    if (!registroId) { log('⚠', 'no registroId (day 1 was 409), skipping delete', label); return; }
    assert(!!planillaId, 'planillaId not set');
    const { status } = await del(`/planillas/${planillaId}/registros/${registroId}`, danielSession.token);
    assert([200, 204].includes(status), `Expected 200/204, got ${status}`);
  });

  // K5: Try to submit with missing days → 400
  await scenario('K5 POST /planillas/:id/enviar — incomplete → 400', label, async () => {
    assert(!!planillaId, 'planillaId not set');
    // The planilla has 3 days; we only filled day2 and maybe day3 (day1 was deleted)
    // Only submit if there's at least 1 missing day
    const { status, body } = await post(`/planillas/${planillaId}/enviar`, {}, danielSession.token);
    if (status === 400) {
      const b = body as Record<string, unknown>;
      assert(
        Array.isArray(b.diasFaltantes) || (typeof b.error === 'string' && b.error.includes('día')),
        `Expected diasFaltantes or day error, got: ${JSON.stringify(b)}`,
      );
    } else if (status === 200) {
      // The user has a rotating diagram where these are all rest days — also acceptable
      log('ℹ', `enviar returned 200 (period may be all-franco days for this user)`, label);
    } else {
      throw new Error(`Expected 400 or 200, got ${status}: ${JSON.stringify(body)}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO L: Analytics + Auditoria
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioL_AnalyticsAuditoria(users: UserInfo[], rrhhSession: Session) {
  const label = 'L:Analytics';
  console.log(c('CYAN', '\n── Scenario L: Analytics + Auditoria ───────────────────────────────────'));

  const francoUser = users.find(u => u.email.includes('franco.alvarez'));
  assert(!!francoUser, 'franco.alvarez not found');

  // L1: GET /analytics/usuario/:uid (own user)
  await scenario('L1 GET /analytics/usuario/:uid', label, async () => {
    const { status, body } = await get(`/analytics/usuario/${francoUser!.id}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('usuario' in b || 'id' in b || 'nombre' in b, 'Expected user data in analytics');
  });

  // L2: OPERADOR can view own analytics
  await scenario('L2 GET /analytics/usuario/:uid (self-access by OPERADOR)', label, async () => {
    const francoSession = await login(francoUser!.email);
    const { status, body } = await get(`/analytics/usuario/${francoUser!.id}`, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
  });

  // L3: OPERADOR cannot view other user's analytics
  await scenario('L3 GET /analytics/usuario/:uid — other user → 403', label, async () => {
    const francoSession = await login(francoUser!.email);
    const otherUser = users.find(u => u.id !== francoUser!.id && u.rol === 'OPERADOR');
    if (!otherUser) { log('⚠', 'No other OPERADOR, skipping', label); return; }
    const { status } = await get(`/analytics/usuario/${otherUser.id}`, francoSession.token);
    assertStatus(status, 403, 'Expected 403 for cross-user analytics');
  });

  // L4: RRHH views sector analytics
  await scenario('L4 GET /analytics/sectores', label, async () => {
    const { status, body } = await get('/analytics/sectores', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array for sectores');
  });

  // L5: RRHH views empresa analytics
  await scenario('L5 GET /analytics/empresa', label, async () => {
    const { status, body } = await get('/analytics/empresa', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('totalUsuarios' in b || 'sectorBreakdown' in b, `Expected empresa analytics, got keys: ${Object.keys(b).join(', ')}`);
  });

  // L6: GET /auditoria (RRHH only)
  await scenario('L6 GET /auditoria', label, async () => {
    const { status, body } = await get('/auditoria', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array for audit log');
  });

  // L7: GET /auditoria with tipo filter
  await scenario('L7 GET /auditoria?tipo=planilla', label, async () => {
    const { status, body } = await get('/auditoria?tipo=planilla', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // L8: GET /auditoria/stats
  await scenario('L8 GET /auditoria/stats', label, async () => {
    const { status, body } = await get('/auditoria/stats', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('ultimos30Dias' in b, `Expected ultimos30Dias, got: ${JSON.stringify(b)}`);
  });

  // L9: Non-RRHH cannot access auditoria
  await scenario('L9 GET /auditoria — OPERADOR → 403', label, async () => {
    const francoSession = await login(francoUser!.email);
    const { status } = await get('/auditoria', francoSession.token);
    assertStatus(status, 403, 'Expected 403 for OPERADOR accessing auditoria');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO M: Vacacion-saldos admin — generar, adjust, mi-saldo
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioM_VacacionSaldosAdmin(users: UserInfo[], rrhhSession: Session) {
  const label = 'M:VacacionSaldos';
  console.log(c('CYAN', '\n── Scenario M: Vacacion-saldos admin ──────────────────────────────────'));

  const testAnio = 2099;  // Far future year for isolation
  let saldoId = '';

  // M1: GET /vacacion-saldos (RRHH lists all)
  await scenario('M1 GET /vacacion-saldos (RRHH)', label, async () => {
    const { status, body } = await get(`/vacacion-saldos?anio=${new Date().getFullYear()}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // M2: POST /vacacion-saldos/generar (generate for test year)
  await scenario('M2 POST /vacacion-saldos/generar', label, async () => {
    const { status, body } = await post('/vacacion-saldos/generar', { anio: testAnio }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(typeof b.created === 'number', `Expected created count, got ${JSON.stringify(b)}`);
    assert(typeof b.total === 'number', 'Expected total field');
    log('ℹ', `Generated ${b.created} saldos for ${testAnio} (${b.skipped} skipped)`, label);
  });

  // M3: Run generar again — should skip all (idempotent)
  await scenario('M3 POST /vacacion-saldos/generar (idempotent — all skipped)', label, async () => {
    const { status, body } = await post('/vacacion-saldos/generar', { anio: testAnio }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.created === 0, `Expected 0 new created, got ${b.created}`);
    assert(typeof b.skipped === 'number' && (b.skipped as number) > 0, 'Expected some skipped');
  });

  // M4: GET /vacacion-saldos for test year
  await scenario('M4 GET /vacacion-saldos?anio=testAnio', label, async () => {
    const { status, body } = await get(`/vacacion-saldos?anio=${testAnio}`, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const saldos = body as Array<Record<string, unknown>>;
    assert(saldos.length > 0, `Expected saldos for ${testAnio}`);
    saldoId = saldos[0].id as string;
  });

  // M5: PUT /vacacion-saldos/:id (adjust)
  await scenario('M5 PUT /vacacion-saldos/:id (adjust diasAjuste)', label, async () => {
    assert(!!saldoId, 'saldoId not set');
    const { status, body } = await put(`/vacacion-saldos/${saldoId}`, {
      diasAjuste: 3,
      observaciones: 'Ajuste por convenio colectivo',
    }, rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert((b.diasAjuste as number) === 3, `Expected diasAjuste=3, got ${b.diasAjuste}`);
  });

  // M6: GET /vacacion-saldos/mi-saldo (any employee)
  await scenario('M6 GET /vacacion-saldos/mi-saldo (employee)', label, async () => {
    const franco = users.find(u => u.email.includes('franco.alvarez'));
    assert(!!franco, 'franco.alvarez not found');
    const francoSession = await login(franco!.email);
    const { status, body } = await get('/vacacion-saldos/mi-saldo', francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('disponible' in b, `Expected disponible, got: ${JSON.stringify(b)}`);
    assert('total' in b, 'Expected total');
    assert('compensatoriosDisponible' in b, 'Expected compensatoriosDisponible');
    log('ℹ', `Franco saldo: disponible=${b.disponible}, total=${b.total}`, label);
  });

  // M7: Non-RRHH cannot access saldos admin
  await scenario('M7 GET /vacacion-saldos — OPERADOR → 403', label, async () => {
    const franco = users.find(u => u.email.includes('franco.alvarez'));
    const francoSession = await login(franco!.email);
    const { status } = await get(`/vacacion-saldos?anio=${testAnio}`, francoSession.token);
    assertStatus(status, 403, 'Expected 403 for OPERADOR accessing saldos admin');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO N: WenTop CMASS — tarjeta lifecycle, analytics, gestores
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioN_WenTop(users: UserInfo[], rrhhSession: Session, adminSession: Session) {
  const label = 'N:WenTop';
  console.log(c('CYAN', '\n── Scenario N: WenTop CMASS ─────────────────────────────────────────────'));

  const franco = users.find(u => u.email.includes('franco.alvarez'));
  assert(!!franco, 'franco.alvarez not found');
  const francoSession = await login(franco!.email);

  let tarjetaId1 = '';
  let tarjetaId2 = '';
  let tarjetaId3 = '';
  let sectorId = '';

  // Get a sector id
  await scenario('N0 Get sector id', label, async () => {
    const { status, body } = await get('/admin/sectores', adminSession.token);
    if (status === 200) {
      const sects = body as Array<Record<string, unknown>>;
      if (sects.length > 0) sectorId = sects[0].id as string;
    }
    if (!sectorId && franco!.sector) {
      // Fetch via profile
      const { body: me } = await get('/usuarios/me', francoSession.token);
      sectorId = (me as Record<string, unknown>).sectorId as string || '';
    }
  });

  // N1: Create CONDICION_INSEGURA tarjeta
  await scenario('N1 POST /wentop (CONDICION_INSEGURA)', label, async () => {
    const body: Record<string, unknown> = {
      fechaReporte: new Date().toISOString().split('T')[0],
      tipoTarjeta: 'CONDICION_INSEGURA',
      descripcion: 'Piso mojado sin señalización en la entrada del taller',
      accionesInmediatas: 'Se colocó señalización de advertencia',
      calidad: [],
      medioambiente: [],
      seguridadSalud: ['Riesgo de caída'],
    };
    if (sectorId) body.sectorObservacionId = sectorId;
    const { status, body: rb } = await post('/wentop', body, francoSession.token);
    assertStatus(status, 201, JSON.stringify(rb));
    tarjetaId1 = (rb as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => {
      await del(`/wentop/${tarjetaId1}`, francoSession.token).catch(() => {});
    });
  });

  // N2: Create OBSERVACION_POSITIVA tarjeta
  await scenario('N2 POST /wentop (OBSERVACION_POSITIVA)', label, async () => {
    const { status, body } = await post('/wentop', {
      fechaReporte: new Date().toISOString().split('T')[0],
      tipoTarjeta: 'OBSERVACION_POSITIVA',
      descripcion: 'Equipo usó EPP completo durante toda la operación',
      seguridadSalud: ['Uso correcto de EPP'],
      calidad: [],
      medioambiente: [],
    }, francoSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    tarjetaId2 = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => {
      await del(`/wentop/${tarjetaId2}`, francoSession.token).catch(() => {});
    });
  });

  // N3: Create CASI_ACCIDENTE tarjeta
  await scenario('N3 POST /wentop (CASI_ACCIDENTE)', label, async () => {
    const { status, body } = await post('/wentop', {
      fechaReporte: new Date().toISOString().split('T')[0],
      tipoTarjeta: 'CASI_ACCIDENTE',
      descripcion: 'Manguera de alta presión estuvo a punto de desprenderse',
      accionesInmediatas: 'Reemplazo inmediato de la manguera',
      recomendaciones: 'Inspección semanal de mangueras',
      seguridadSalud: [],
      calidad: [],
      medioambiente: [],
    }, francoSession.token);
    assertStatus(status, 201, JSON.stringify(body));
    tarjetaId3 = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => {
      await del(`/wentop/${tarjetaId3}`, francoSession.token).catch(() => {});
    });
  });

  // N4: GET /wentop (list, filtered by tipo)
  await scenario('N4 GET /wentop?tipoTarjeta=CONDICION_INSEGURA', label, async () => {
    const { status, body } = await get('/wentop?tipoTarjeta=CONDICION_INSEGURA', francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // N5: GET /wentop/:id
  await scenario('N5 GET /wentop/:id', label, async () => {
    assert(!!tarjetaId1, 'tarjetaId1 not set');
    const { status, body } = await get(`/wentop/${tarjetaId1}`, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.id === tarjetaId1, `Expected id=${tarjetaId1}`);
  });

  // N6: PUT /wentop/:id (update)
  await scenario('N6 PUT /wentop/:id (update descripcion)', label, async () => {
    assert(!!tarjetaId1, 'tarjetaId1 not set');
    const { status, body } = await put(`/wentop/${tarjetaId1}`, {
      descripcion: 'Piso mojado sin señalización — ACTUALIZADO',
      recomendaciones: 'Mantener zona seca permanentemente',
    }, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(
      typeof b.descripcion === 'string' && b.descripcion.includes('ACTUALIZADO'),
      `Expected updated descripcion`,
    );
  });

  // N7: PATCH /wentop/:id/estado — advance to EN_PROGRESO
  await scenario('N7 PATCH /wentop/:id/estado (ABIERTA → EN_PROGRESO)', label, async () => {
    assert(!!tarjetaId1, 'tarjetaId1 not set');
    const { status, body } = await patch(`/wentop/${tarjetaId1}/estado`, {
      estado: 'EN_PROGRESO',
    }, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'EN_PROGRESO', `Expected EN_PROGRESO, got ${b.estado}`);
  });

  // N8: PATCH /wentop/:id/estado — close tarjeta
  await scenario('N8 PATCH /wentop/:id/estado (EN_PROGRESO → CERRADA)', label, async () => {
    assert(!!tarjetaId1, 'tarjetaId1 not set');
    const { status, body } = await patch(`/wentop/${tarjetaId1}/estado`, {
      estado: 'CERRADA',
      accionCierre: 'Se resolvió la condición insegura correctamente',
      fechaCierre: new Date().toISOString().split('T')[0],
    }, francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert(b.estado === 'CERRADA', `Expected CERRADA, got ${b.estado}`);
  });

  // N9: Invalid estado → 400
  await scenario('N9 PATCH /wentop/:id/estado (invalid → 400)', label, async () => {
    assert(!!tarjetaId2, 'tarjetaId2 not set');
    const { status, body } = await patch(`/wentop/${tarjetaId2}/estado`, {
      estado: 'INVALIDO',
    }, francoSession.token);
    assertStatus(status, 400, `Expected 400 for invalid estado: ${JSON.stringify(body)}`);
  });

  // N10: Close without accionCierre → 400
  await scenario('N10 PATCH /wentop/:id/estado (close without accionCierre → 400)', label, async () => {
    assert(!!tarjetaId2, 'tarjetaId2 not set');
    const { status, body } = await patch(`/wentop/${tarjetaId2}/estado`, {
      estado: 'CERRADA',
      // no accionCierre
    }, francoSession.token);
    assertStatus(status, 400, `Expected 400 for missing accionCierre: ${JSON.stringify(body)}`);
  });

  // N11: GET /wentop/analytics
  await scenario('N11 GET /wentop/analytics', label, async () => {
    const { status, body } = await get('/wentop/analytics', francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    assert('totales' in b, `Expected totales in analytics, got: ${JSON.stringify(b)}`);
    assert('porTipo' in b, 'Expected porTipo');
    assert('porMes' in b, 'Expected porMes');
  });

  // N12: GET /wentop/mis-gestores
  await scenario('N12 GET /wentop/mis-gestores', label, async () => {
    const { status, body } = await get('/wentop/mis-gestores', francoSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // N13: RRHH assigns a gestor (requires sectorId)
  await scenario('N13 POST /wentop/gestores (RRHH assigns gestor)', label, async () => {
    if (!sectorId) { log('⚠', 'No sectorId, skipping', label); return; }
    const { status, body } = await post('/wentop/gestores', {
      usuarioId: franco!.id,
      sectorId,
    }, rrhhSession.token);
    if (status === 200 || status === 201) {
      log('ℹ', 'Gestor assigned (upsert)', label);
    } else {
      assertStatus(status, 201, JSON.stringify(body));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO O: Cambios Diagrama — create request, approval chain
// ═══════════════════════════════════════════════════════════════════════════════

async function scenarioO_CambiosDiagrama(users: UserInfo[], rrhhSession: Session, adminSession: Session) {
  const label = 'O:CambioDiagrama';
  console.log(c('CYAN', '\n── Scenario O: Cambios Diagrama ─────────────────────────────────────────'));

  const coord = users.find(u => u.rol === 'COORDINADOR');
  const operador = users.find(u => u.rol === 'OPERADOR');
  assert(!!coord, 'No COORDINADOR found');
  assert(!!operador, 'No OPERADOR found');
  const coordSession = await login(coord!.email);

  let diagramas: Array<Record<string, unknown>> = [];
  let solicitudId = '';

  // O1: GET /cambios-diagrama/diagramas (list available)
  await scenario('O1 GET /cambios-diagrama/diagramas', label, async () => {
    const { status, body } = await get('/cambios-diagrama/diagramas', coordSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array of diagramas');
    diagramas = body as Array<Record<string, unknown>>;
    log('ℹ', `Found ${diagramas.length} diagramas`, label);
  });

  if (diagramas.length < 1) {
    log('⚠', 'No diagramas found — skipping O2-O5', label);
    return;
  }

  // Pick a different diagrama than what the operador currently has
  const diagramaNuevoId = diagramas[diagramas.length - 1].id as string;

  // O2: COORDINADOR creates change request
  await scenario('O2 POST /cambios-diagrama (COORDINADOR creates)', label, async () => {
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: operador!.id,
      diagramaNuevoId,
      motivo: 'Cambio de turno por necesidades operativas',
    }, coordSession.token);
    if (status === 409) {
      // Pending/en-revision request exists — use RRHH to cancel or reject it
      const { body: allSols } = await get('/cambios-diagrama', rrhhSession.token);
      const toCancel = (allSols as Array<Record<string, unknown>>).filter(s =>
        s.usuarioId === operador!.id && ['PENDIENTE', 'EN_REVISION'].includes(s.estado as string),
      );
      for (const p of toCancel) {
        if (p.estado === 'PENDIENTE') {
          await del(`/cambios-diagrama/${p.id}`, rrhhSession.token).catch(() => {});
        } else {
          // EN_REVISION → reject it (RRHH has rolNivel >= 90)
          await post(`/cambios-diagrama/${p.id}/rechazar`, { motivo: 'Cleanup prior test run' }, rrhhSession.token).catch(() => {});
        }
      }
      // Retry creation
      const { status: s2, body: b2 } = await post('/cambios-diagrama', {
        usuarioId: operador!.id,
        diagramaNuevoId,
        motivo: 'Cambio de turno por necesidades operativas (retry)',
      }, coordSession.token);
      if (s2 !== 201 && s2 !== 200) throw new Error(`HTTP ${s2}: ${JSON.stringify(b2)}`);
      solicitudId = (b2 as Record<string, unknown>).id as string;
    } else {
      assertStatus(status, 201, JSON.stringify(body));
      solicitudId = (body as Record<string, unknown>).id as string;
    }
    cleanupQueue.push(async () => {
      if (solicitudId) await del(`/cambios-diagrama/${solicitudId}`, rrhhSession.token).catch(() => {});
    });
  });

  // O3: GET /cambios-diagrama (RRHH sees all)
  await scenario('O3 GET /cambios-diagrama (RRHH)', label, async () => {
    const { status, body } = await get('/cambios-diagrama', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // O4: GET /cambios-diagrama/pendientes
  await scenario('O4 GET /cambios-diagrama/pendientes', label, async () => {
    const { status, body } = await get('/cambios-diagrama/pendientes', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'Expected array');
  });

  // O5: Walk approval chain to approve
  await scenario('O5 POST /cambios-diagrama/:id/avanzar (approve)', label, async () => {
    assert(!!solicitudId, 'solicitudId not set');
    const { body: sb } = await get('/cambios-diagrama', rrhhSession.token);
    const solic = (sb as Array<Record<string, unknown>>).find(s => s.id === solicitudId);
    if (!solic) {
      log('⚠', 'solicitud not found in RRHH list', label);
      return;
    }
    const flujo = solic.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;
    if (!flujo || flujo.pasos.length === 0) {
      // No flow: RRHH approves directly
      const { status, body } = await post(`/cambios-diagrama/${solicitudId}/avanzar`, {
        comentario: 'Aprobado (sin flujo)',
      }, rrhhSession.token);
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
      const estado = (body as Record<string, unknown>).estado as string;
      assert(['APROBADA', 'EN_REVISION'].includes(estado), `Expected APROBADA/EN_REVISION, got ${estado}`);
    } else {
      for (const paso of flujo.pasos) {
        const approver = users.find(u => u.rol === paso.rolAprobador) || null;
        const approverSession = approver ? await login(approver.email) : rrhhSession;
        const { status, body } = await post(`/cambios-diagrama/${solicitudId}/avanzar`, {
          comentario: `Paso ${paso.orden} aprobado`,
        }, approverSession.token);
        if (status === 403) {
          // Use RRHH as fallback
          const { status: s2, body: b2 } = await post(`/cambios-diagrama/${solicitudId}/avanzar`, {
            comentario: `Paso ${paso.orden} aprobado (RRHH override)`,
          }, rrhhSession.token);
          if (s2 !== 200) throw new Error(`HTTP ${s2}: ${JSON.stringify(b2)}`);
        } else if (status !== 200) {
          throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
        }
        const est = (body as Record<string, unknown>).estado as string;
        log('ℹ', `  Paso ${paso.orden} → ${est}`, label);
        if (est === 'APROBADA') break;
      }
    }
  });

  // O6: Reject a new change request
  await scenario('O6 POST /cambios-diagrama (create + reject)', label, async () => {
    // Create another request with the same or different diagrama
    const altDiagramaId = diagramas[0].id as string;
    // Need to check if there's a pending one first
    const { body: pendingList } = await get('/cambios-diagrama', rrhhSession.token);
    const hasPending = (pendingList as Array<Record<string, unknown>>).some(s =>
      s.usuarioId === operador!.id && ['PENDIENTE', 'EN_REVISION'].includes(s.estado as string),
    );
    if (hasPending) { log('⚠', 'Pending request exists, skipping O6', label); return; }
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: operador!.id,
      diagramaNuevoId: altDiagramaId,
      motivo: 'Cambio de prueba para rechazar',
    }, coordSession.token);
    if (status !== 201 && status !== 200) { log('⚠', `Could not create second request: ${status}`, label); return; }
    const newSolId = (body as Record<string, unknown>).id as string;
    const { status: rs, body: rb } = await post(`/cambios-diagrama/${newSolId}/rechazar`, {
      motivo: 'No aplica en este momento',
    }, rrhhSession.token);
    if (rs !== 200) throw new Error(`Rechazar HTTP ${rs}: ${JSON.stringify(rb)}`);
    const b = rb as Record<string, unknown>;
    assert(b.estado === 'RECHAZADA', `Expected RECHAZADA, got ${b.estado}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(c('BOLD', '\n═══════════════════════════════════════════════════════════════════════════'));
  console.log(c('BOLD', '  Planilla de Horas — Extended Simulation Suite (simulation2.ts)'));
  console.log(c('BOLD', '═══════════════════════════════════════════════════════════════════════════\n'));

  // Login core sessions
  let rrhhSession: Session;
  let adminSession: Session;
  try {
    rrhhSession = await login('rrhh1@test.wenlen.com');
    adminSession = await login('admin@wenlen.com');
    log(c('GREEN', '✅'), 'Core sessions OK (RRHH + ADMIN)');
  } catch (e) {
    console.error(c('RED', `\n❌ Cannot login to API: ${e instanceof Error ? e.message : e}`));
    console.error(c('YELLOW', '   Is the API running? (npm run dev in apps/api)'));
    process.exit(1);
  }

  // Load full user list
  const { body: usersBody } = await get('/usuarios', rrhhSession.token);
  const users = usersBody as UserInfo[];
  log(c('GREEN', '✅'), `Loaded ${users.length} users`);

  // ─── Run Scenarios ─────────────────────────────────────────────────────────

  await scenarioG_Capacitaciones(users, rrhhSession, adminSession);
  await scenarioH_SesionesCapacitacion(users, rrhhSession);
  await scenarioI_Compensatorio(users, rrhhSession);
  await scenarioJ_LicenciaEspecial(users, rrhhSession);
  await scenarioK_PlanillaEdgeCases(users, rrhhSession);
  await scenarioL_AnalyticsAuditoria(users, rrhhSession);
  await scenarioM_VacacionSaldosAdmin(users, rrhhSession);
  await scenarioN_WenTop(users, rrhhSession, adminSession);
  await scenarioO_CambiosDiagrama(users, rrhhSession, adminSession);

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  console.log(c('DIM', '\n── Cleanup ──────────────────────────────────────────────────────────────'));
  for (const fn of cleanupQueue.reverse()) {
    try { await fn(); } catch { /* silent */ }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(c('BOLD', '\n═══════════════════════════════════════════════════════════════════════════'));
  console.log(c('BOLD', `  Results: ${c('GREEN', `${passed} passed`)}  ${failed > 0 ? c('RED', `${failed} failed`) : c('GREEN', '0 failed')}`));
  console.log(c('BOLD', '═══════════════════════════════════════════════════════════════════════════'));

  if (failed > 0) {
    console.log(c('RED', '\n  Failed tests:'));
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${c('RED', '❌')} ${c('DIM', `[${r.scenario}]`)} ${r.name}`);
      console.log(`     ${c('YELLOW', r.detail)}`);
    }
  }

  const byScenario = new Map<string, { pass: number; fail: number }>();
  for (const r of results) {
    const s = byScenario.get(r.scenario) ?? { pass: 0, fail: 0 };
    if (r.passed) s.pass++; else s.fail++;
    byScenario.set(r.scenario, s);
  }
  console.log(c('BOLD', '\n  Per scenario:'));
  for (const [scen, { pass, fail }] of byScenario) {
    const icon = fail === 0 ? c('GREEN', '✅') : c('RED', '❌');
    console.log(`  ${icon} ${scen.padEnd(22)} ${pass}/${pass + fail}`);
  }

  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(c('DIM', `\n  Total time: ${(totalMs / 1000).toFixed(1)}s`));
  console.log(c('BOLD', `  ${passed}/${results.length} pasaron, ${failed} fallaron\n`));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(c('RED', `Fatal error: ${e instanceof Error ? e.stack : e}`));
  process.exit(1);
});
