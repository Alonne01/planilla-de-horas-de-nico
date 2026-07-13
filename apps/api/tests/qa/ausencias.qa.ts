/**
 * QA Suite — AUSENCIAS subsystem (KEY=ausencias)
 *
 * Black-box HTTP tests against the live API. Covers:
 *   /ausencias/solicitar, /ausencias/compensatorio, /ausencias (direct create),
 *   enviar / avanzar / rechazar / revocar, PUT, DELETE, GET (list/subordinados/:id),
 *   /mis-solicitudes, compensatorio saldo reserve/restore/re-reserve, notifications,
 *   role/level guards, validation, state-machine and authz boundaries.
 *
 * Run: cd apps/api && npx tsx tests/qa/ausencias.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'ausencias';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m',
  YELLOW: '\x1b[33m', CYAN: '\x1b[36m',
};
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.RESET}`; }

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanupQueue: Array<() => Promise<void>> = [];
type Bug = {
  id: string; title: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  endpoint: string; expected: string; actual: string; evidence: string; rootCause: string; repro: string;
};
const bugs: Bug[] = [];

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK' });
    process.stdout.write(`  ${col('GREEN', 'PASS')} ${name}\n`);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail });
    process.stdout.write(`  ${col('RED', 'FAIL')} ${name} — ${detail}\n`);
  }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}
function info(msg: string) { process.stdout.write(`    ${col('DIM', '· ' + msg)}\n`); }

// ── HTTP ────────────────────────────────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
const get = (p: string, tok?: string) => api('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => api('PUT', p, { token: tok, body: b });
const del = (p: string, tok?: string) => api('DELETE', p, { token: tok });

// ── Auth ────────────────────────────────────────────────────────────────────
interface Session {
  token: string;
  user: { id: string; nombre: string; apellido: string; email: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null };
}
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

function fmtDateTime(d: Date) { return d.toISOString(); }
function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

// Notification helpers (target-user inbox)
async function notifCount(tok: string): Promise<number> {
  const { body } = await get('/notificaciones/count', tok);
  return typeof body?.count === 'number' ? body.count : -1;
}
async function topNotifs(tok: string): Promise<Array<{ tipo: string; titulo: string; link: string }>> {
  const { body } = await get('/notificaciones', tok);
  return Array.isArray(body) ? body : [];
}
async function getCompSaldo(tok: string): Promise<{ acum: number; usados: number; pend: number; disp: number }> {
  const { body } = await get('/vacacion-saldos/mi-saldo', tok);
  return {
    acum: body.compensatoriosAcumulados, usados: body.compensatoriosUsados,
    pend: body.compensatoriosPendientes, disp: body.compensatoriosDisponible,
  };
}

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

async function main() {
  console.log(col('CYAN', `\n═══ QA AUSENCIAS suite (ts=${TS}) ═══\n`));

  // ── Sessions ──
  const admin = await login('admin@wenlen.com');
  const ana = await login('ana.martinez@demo.com'); // RRHH nivel 90
  assert(admin.user.rolNivel >= 100, 'admin nivel');
  assert(ana.user.rolNivel >= 90, `ana nivel ${ana.user.rolNivel}`);

  // ── Create dedicated users (owner OPERADOR + supervisor + unrelated supervisor + unrelated operador) ──
  let supUser: Session, owner: Session, otherSup: Session, otherOp: Session;
  const ingreso = fmtDateTime(new Date('2020-01-01T00:00:00Z'));

  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Ausencias${TS}`,
      email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, ...extra,
    }, ana.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  let supId = '', ownerId = '', otherSupId = '', otherOpId = '';
  await scenario('SETUP create supervisor user', async () => { supId = await createUser('SUPERVISOR', 'sup'); });
  await scenario('SETUP create owner OPERADOR (supervisorId=sup)', async () => {
    ownerId = await createUser('OPERADOR', 'owner', { supervisorId: supId });
  });
  await scenario('SETUP create unrelated supervisor', async () => { otherSupId = await createUser('SUPERVISOR', 'othersup'); });
  await scenario('SETUP create unrelated operador', async () => { otherOpId = await createUser('OPERADOR', 'otherop'); });

  cleanupQueue.push(async () => {
    for (const id of [ownerId, supId, otherSupId, otherOpId]) {
      if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {});
    }
  });

  supUser = await login(`qa.${KEY}.${TS}.sup@demo.com`);
  owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
  otherSup = await login(`qa.${KEY}.${TS}.othersup@demo.com`);
  otherOp = await login(`qa.${KEY}.${TS}.otherop@demo.com`);
  info(`owner nivel=${owner.user.rolNivel} sup nivel=${supUser.user.rolNivel}`);
  assert(owner.user.rolNivel < 60, `owner should be OPERADOR-level, got ${owner.user.rolNivel}`);
  assert(supUser.user.rolNivel >= 60, `sup should be SUPERVISOR-level, got ${supUser.user.rolNivel}`);

  // ── Create AUSENCIA flujo (2 steps: SUPERVISOR -> RRHH) assigned to owner ──
  let ausFlujoId = '', ausAsigId = '';
  await scenario('SETUP create AUSENCIA flujo (SUPERVISOR→RRHH) + assignment to owner', async () => {
    const { status, body } = await post('/admin/flujos', {
      nombre: `QA-AUS-${TS}`, tipoDocumento: 'AUSENCIA', descripcion: 'qa ausencias',
      pasos: [
        { orden: 1, nombrePaso: 'Supervisor', rolAprobador: 'SUPERVISOR', requiereComentarioRechazo: true },
        { orden: 2, nombrePaso: 'RRHH', rolAprobador: 'RRHH', requiereComentarioRechazo: true },
      ],
    }, admin.token);
    assertStatus(status, 201, JSON.stringify(body));
    ausFlujoId = body.id;
    const { status: as, body: ab } = await post('/admin/flujos/asignaciones', {
      flujoId: ausFlujoId, tipoDocumento: 'AUSENCIA', usuarioId: ownerId,
    }, admin.token);
    assertStatus(as, 201, JSON.stringify(ab));
    ausAsigId = ab.id;
  });

  // ── Create COMPENSATORIO flujo (1 step SUPERVISOR) assigned to owner ──
  let compFlujoId = '', compAsigId = '';
  await scenario('SETUP create COMPENSATORIO flujo (SUPERVISOR) + assignment to owner', async () => {
    const { status, body } = await post('/admin/flujos', {
      nombre: `QA-COMP-${TS}`, tipoDocumento: 'COMPENSATORIO', descripcion: 'qa comp',
      pasos: [{ orden: 1, nombrePaso: 'Supervisor', rolAprobador: 'SUPERVISOR', requiereComentarioRechazo: true }],
    }, admin.token);
    assertStatus(status, 201, JSON.stringify(body));
    compFlujoId = body.id;
    const { status: as, body: ab } = await post('/admin/flujos/asignaciones', {
      flujoId: compFlujoId, tipoDocumento: 'COMPENSATORIO', usuarioId: ownerId,
    }, admin.token);
    assertStatus(as, 201, JSON.stringify(ab));
    compAsigId = ab.id;
  });

  // ── Seed owner compensatorio saldo (acumulados=5) ──
  let saldoId = '';
  const compYear = new Date('2026-09-15').getFullYear();
  await scenario('SETUP seed owner compensatorio saldo (acumulados=5)', async () => {
    await get('/vacacion-saldos/mi-saldo', owner.token); // auto-create current-year row
    const { body } = await get(`/vacacion-saldos?anio=${compYear}`, ana.token);
    const s = (body as any[]).find(x => x.usuarioId === ownerId);
    assert(!!s, `owner saldo for ${compYear} not found`);
    saldoId = s.id;
    const { status } = await put(`/vacacion-saldos/${saldoId}`, {
      compensatoriosAcumulados: 5, compensatoriosUsados: 0,
    }, ana.token);
    assertStatus(status, 200, 'seed saldo');
    const cs = await getCompSaldo(owner.token);
    assert(cs.acum === 5 && cs.usados === 0, `seed check acum=${cs.acum} usados=${cs.usados}`);
  });
  cleanupQueue.push(async () => {
    if (saldoId) await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, ana.token).catch(() => {});
  });

  // Track created ausencias for cleanup
  const createdAus: string[] = [];
  cleanupQueue.push(async () => {
    for (const id of createdAus) await del(`/ausencias/${id}`, ana.token).catch(() => {});
  });
  cleanupQueue.push(async () => {
    if (compAsigId) await del(`/admin/flujos/asignaciones/${compAsigId}`, admin.token).catch(() => {});
    if (ausAsigId) await del(`/admin/flujos/asignaciones/${ausAsigId}`, admin.token).catch(() => {});
    if (compFlujoId) await del(`/admin/flujos/${compFlujoId}`, admin.token).catch(() => {});
    if (ausFlujoId) await del(`/admin/flujos/${ausFlujoId}`, admin.token).catch(() => {});
  });

  const absStart = '2026-09-10', absEnd = '2026-09-12';

  // helper: owner self-requests an ausencia
  async function solicitar(tipo: string, dias = 1, dates: [string, string] = [absStart, absEnd]) {
    return post('/ausencias/solicitar', {
      tipo, fechaInicio: dates[0], fechaFin: dates[1], diasAusencia: dias, descripcion: `qa ${tipo}`,
    }, owner.token);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A. POST /ausencias/solicitar
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('A1 solicitar invalid tipo (ENFERMEDAD) → 400', async () => {
    const { status } = await solicitar('ENFERMEDAD');
    assertStatus(status, 400, 'invalid enum tipo');
  });
  await scenario('A2 solicitar FRANCO_COMPENSATORIO → 400 (must use /compensatorio)', async () => {
    const { status, body } = await solicitar('FRANCO_COMPENSATORIO');
    assertStatus(status, 400, JSON.stringify(body));
  });
  await scenario('A3 solicitar missing diasAusencia → 400', async () => {
    const { status } = await post('/ausencias/solicitar', { tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd }, owner.token);
    assertStatus(status, 400, 'missing dias');
  });
  await scenario('A4 solicitar FALTA_INJUSTIFICADA → 201, PENDIENTE, descuentaSueldo=true, flujoId set, notify supervisor', async () => {
    const before = await notifCount(supUser.token);
    const { status, body } = await solicitar('FALTA_INJUSTIFICADA');
    assertStatus(status, 201, JSON.stringify(body));
    createdAus.push(body.id);
    assert(body.estado === 'PENDIENTE', `estado=${body.estado}`);
    assert(body.pasoActual === 1, `pasoActual=${body.pasoActual}`);
    assert(body.flujoId === ausFlujoId, `flujoId=${body.flujoId} expected ${ausFlujoId}`);
    assert(body.descuentaSueldo === true, `descuentaSueldo=${body.descuentaSueldo}`);
    assert(Number(body.porcentajeDescuento) === 100, `porcentaje=${body.porcentajeDescuento}`);
    // notification: supervisor (dedicated, clean inbox)
    const after = await notifCount(supUser.token);
    assert(after >= before + 1, `supervisor notif count ${before}→${after} (expected +1)`);
    const top = await topNotifs(supUser.token);
    const match = top.find(n => n.tipo === 'AUSENCIA' && /revisar/i.test(n.titulo) && n.link === '/aprobaciones');
    assert(!!match, `no approver notif found; top=${JSON.stringify(top.slice(0, 3))}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // B. avanzar (multi-step approve) + notifications + authz + state machine
  // ═══════════════════════════════════════════════════════════════════════
  let approveAusId = '';
  await scenario('B0 create ausencia to approve (solicitar FALTA_JUSTIFICADA)', async () => {
    const { status, body } = await solicitar('FALTA_JUSTIFICADA');
    assertStatus(status, 201, JSON.stringify(body));
    approveAusId = body.id; createdAus.push(approveAusId);
  });
  await scenario('B1 avanzar by OPERADOR (owner) → 403 (requireLevel SUPERVISOR)', async () => {
    const { status } = await post(`/ausencias/${approveAusId}/avanzar`, {}, owner.token);
    assertStatus(status, 403, 'operador cannot approve');
  });
  await scenario('B2 avanzar by unrelated SUPERVISOR → 403 (not responsible approver)', async () => {
    const { status, body } = await post(`/ausencias/${approveAusId}/avanzar`, {}, otherSup.token);
    assertStatus(status, 403, JSON.stringify(body));
  });
  await scenario('B3 avanzar by owner-supervisor → 200, EN_REVISION (paso2), notify owner "avanzó de paso"', async () => {
    const before = await notifCount(owner.token);
    const { status, body } = await post(`/ausencias/${approveAusId}/avanzar`, { comentario: 'ok paso1' }, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'EN_REVISION', `estado=${body.estado}`);
    assert(body.pasoActual === 2, `pasoActual=${body.pasoActual}`);
    const after = await notifCount(owner.token);
    assert(after >= before + 1, `owner notif ${before}→${after}`);
    const top = await topNotifs(owner.token);
    assert(!!top.find(n => n.tipo === 'AUSENCIA' && /paso/i.test(n.titulo) && n.link === '/ausencias'),
      `no EN_REVISION notif; top=${JSON.stringify(top.slice(0, 3))}`);
  });
  await scenario('B4 avanzar paso2 by RRHH (ana) → 200, APROBADA, notify owner "aprobada"', async () => {
    const before = await notifCount(owner.token);
    const { status, body } = await post(`/ausencias/${approveAusId}/avanzar`, { comentario: 'ok paso2' }, ana.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
    assert(body.aprobada === true, `aprobada=${body.aprobada}`);
    const after = await notifCount(owner.token);
    assert(after >= before + 1, `owner notif ${before}→${after}`);
    const top = await topNotifs(owner.token);
    assert(!!top.find(n => n.tipo === 'AUSENCIA' && /aprobad/i.test(n.titulo)), `no APROBADA notif; top=${JSON.stringify(top.slice(0, 3))}`);
  });
  await scenario('B5 avanzar an already-APROBADA → 400 (no está pendiente)', async () => {
    const { status, body } = await post(`/ausencias/${approveAusId}/avanzar`, {}, ana.token);
    assertStatus(status, 400, JSON.stringify(body));
  });
  await scenario('B6 avanzar non-existent id → 404', async () => {
    const { status } = await post(`/ausencias/${RANDOM_UUID}/avanzar`, {}, ana.token);
    assertStatus(status, 404, 'non-existent');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C. rechazar (reject) + notif + authz + validation
  // ═══════════════════════════════════════════════════════════════════════
  let rejectAusId = '';
  await scenario('C0 create ausencia to reject', async () => {
    const { status, body } = await solicitar('FALTA_JUSTIFICADA');
    assertStatus(status, 201, JSON.stringify(body));
    rejectAusId = body.id; createdAus.push(rejectAusId);
  });
  await scenario('C1 rechazar without motivo → 400', async () => {
    const { status, body } = await post(`/ausencias/${rejectAusId}/rechazar`, {}, supUser.token);
    assertStatus(status, 400, JSON.stringify(body));
  });
  await scenario('C2 rechazar by OPERADOR → 403 (requireLevel SUPERVISOR)', async () => {
    const { status } = await post(`/ausencias/${rejectAusId}/rechazar`, { motivo: 'x' }, owner.token);
    assertStatus(status, 403, 'operador');
  });
  await scenario('C3 rechazar by unrelated SUPERVISOR → 403 (not responsible)', async () => {
    const { status, body } = await post(`/ausencias/${rejectAusId}/rechazar`, { motivo: 'x' }, otherSup.token);
    assertStatus(status, 403, JSON.stringify(body));
  });
  await scenario('C4 rechazar by owner-supervisor with motivo → 200 RECHAZADA + notify owner', async () => {
    const before = await notifCount(owner.token);
    const { status, body } = await post(`/ausencias/${rejectAusId}/rechazar`, { motivo: 'No corresponde' }, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'RECHAZADA', `estado=${body.estado}`);
    assert(body.obsRechazo === 'No corresponde', `obsRechazo=${body.obsRechazo}`);
    const after = await notifCount(owner.token);
    assert(after >= before + 1, `owner notif ${before}→${after}`);
    const top = await topNotifs(owner.token);
    assert(!!top.find(n => n.tipo === 'AUSENCIA' && /rechaz/i.test(n.titulo)), `no RECHAZADA notif; top=${JSON.stringify(top.slice(0, 3))}`);
  });
  await scenario('C5 re-send rejected ausencia via enviar (supervisor) → 200 PENDIENTE paso1', async () => {
    const { status, body } = await post(`/ausencias/${rejectAusId}/enviar`, {}, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'PENDIENTE', `estado=${body.estado}`);
    assert(body.pasoActual === 1, `pasoActual=${body.pasoActual}`);
  });
  await scenario('C6 enviar a PENDIENTE ausencia → 400 (only BORRADOR/RECHAZADA)', async () => {
    const { status, body } = await post(`/ausencias/${rejectAusId}/enviar`, {}, supUser.token);
    assertStatus(status, 400, JSON.stringify(body));
  });
  await scenario('C7 enviar by OPERADOR → 403', async () => {
    const { status } = await post(`/ausencias/${rejectAusId}/enviar`, {}, owner.token);
    assertStatus(status, 403, 'operador enviar');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // D. Compensatorio: reserve / approve / reject-restore / re-reserve regression
  // ═══════════════════════════════════════════════════════════════════════
  const compFuture = '2026-09-15';
  async function compensatorio(dias: number, fecha = compFuture) {
    return post('/ausencias/compensatorio', { fechaInicio: fecha, fechaFin: fecha, diasAusencia: dias, descripcion: 'qa comp' }, owner.token);
  }
  await scenario('D1 compensatorio insufficient balance (6 > 5) → 400', async () => {
    const { status, body } = await compensatorio(6);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/insuficiente/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });
  let compAusId = '';
  await scenario('D2 compensatorio 2 days → 201 PENDIENTE, pendientes reserved (+2)', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await compensatorio(2);
    assertStatus(status, 201, JSON.stringify(body));
    compAusId = body.id; createdAus.push(compAusId);
    assert(body.tipo === 'FRANCO_COMPENSATORIO', `tipo=${body.tipo}`);
    assert(body.estado === 'PENDIENTE', `estado=${body.estado}`);
    assert(body.flujoId === compFlujoId, `flujoId=${body.flujoId} expected ${compFlujoId}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 2, `pendientes ${before.pend}→${after.pend} (expected +2)`);
  });
  await scenario('D3 approve compensatorio (supervisor) → APROBADA, pendientes-2 usados+2', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${compAusId}/avanzar`, {}, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend - 2, `pendientes ${before.pend}→${after.pend} (expected -2)`);
    assert(after.usados === before.usados + 2, `usados ${before.usados}→${after.usados} (expected +2)`);
  });

  // reject → restore → re-enviar → re-reserve regression
  let comp2Id = '';
  await scenario('D4 new compensatorio 1 day → pendientes +1', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await compensatorio(1);
    assertStatus(status, 201, JSON.stringify(body));
    comp2Id = body.id; createdAus.push(comp2Id);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 1, `pendientes ${before.pend}→${after.pend}`);
  });
  await scenario('D5 reject compensatorio → RECHAZADA, pendientes restored (-1)', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${comp2Id}/rechazar`, { motivo: 'qa reject' }, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'RECHAZADA', `estado=${body.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend - 1, `pendientes ${before.pend}→${after.pend} (expected -1, restore)`);
  });
  await scenario('D6 re-enviar rejected compensatorio (supervisor) → pendientes RE-reserved (+1) [DD regression]', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${comp2Id}/enviar`, {}, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'PENDIENTE', `estado=${body.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 1, `pendientes ${before.pend}→${after.pend} (expected +1, re-reserve) — regression if not`);
    // BUG PROBE: enviar must keep a FRANCO_COMPENSATORIO on the COMPENSATORIO flow, not the AUSENCIA flow.
    info(`comp2 flujoId after enviar = ${body.flujoId} (compFlujo=${compFlujoId}, ausFlujo=${ausFlujoId})`);
    if (body.flujoId !== compFlujoId) {
      bugs.push({
        id: `${KEY}-02`,
        title: 'enviar misroutes a re-sent FRANCO_COMPENSATORIO onto the AUSENCIA approval flow instead of the COMPENSATORIO flow',
        severity: 'MEDIUM',
        endpoint: 'POST /ausencias/:id/enviar',
        expected: `A re-submitted FRANCO_COMPENSATORIO keeps its COMPENSATORIO flujo (id=${compFlujoId}, 1 SUPERVISOR step), the same chain a freshly-created compensatorio gets.`,
        actual: `flujoId became ${body.flujoId} (the AUSENCIA flujo, 2 steps SUPERVISOR→RRHH); next avanzar yields EN_REVISION instead of APROBADA, so the compensatorio is routed through a different approval chain/approvers than intended.`,
        evidence: `POST /ausencias/${comp2Id}/enviar → 200 with flujoId=${body.flujoId}; expected COMPENSATORIO flujo ${compFlujoId}. Subsequent avanzar returns EN_REVISION (proving totalPasos>=2).`,
        rootCause: 'src/routes/ausencias.routes.ts enviar handler (lines ~530-561): all three flujoAprobacion lookups hardcode tipoDocumento:"AUSENCIA" regardless of ausencia.tipo. The same handler special-cases FRANCO_COMPENSATORIO for saldo re-reservation (lines ~591-606) but not for flow resolution. The /compensatorio create path correctly resolves the COMPENSATORIO flow.',
        repro: '1) owner POST /ausencias/compensatorio (gets COMPENSATORIO flujo). 2) supervisor rejects it. 3) supervisor POST /ausencias/<id>/enviar → ausencia.flujoId is overwritten with the AUSENCIA flujo. 4) avanzar → EN_REVISION (extra/incorrect approval step) instead of APROBADA.',
      });
    }
  });
  // After D6, comp2 was (buggily) reassigned to the 2-step AUSENCIA flow. Walk it to
  // confirm the saldo accounting still reconciles to usados despite the misroute.
  await scenario('D7a avanzar re-sent compensatorio paso1 (supervisor) → EN_REVISION (AUSENCIA misroute), pendientes unchanged', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${comp2Id}/avanzar`, {}, supUser.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'EN_REVISION', `estado=${body.estado} (confirms misroute to 2-step AUSENCIA flow)`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend && after.usados === before.usados, `saldo unchanged mid-flow: pend ${before.pend}→${after.pend} usados ${before.usados}→${after.usados}`);
  });
  await scenario('D7b avanzar re-sent compensatorio paso2 (RRHH) → APROBADA, usados+1 pendientes-1 (saldo reconciles)', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${comp2Id}/avanzar`, {}, ana.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.usados === before.usados + 1 && after.pend === before.pend - 1, `usados ${before.usados}→${after.usados} pend ${before.pend}→${after.pend}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // E. revocar
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('E1 revocar approved compensatorio (future) → 200, usados decremented', async () => {
    const before = await getCompSaldo(owner.token);
    const { status, body } = await post(`/ausencias/${compAusId}/revocar`, { motivo: 'qa revoke' }, owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    const after = await getCompSaldo(owner.token);
    assert(after.usados === before.usados - 2, `usados ${before.usados}→${after.usados} (expected -2)`);
  });
  await scenario('E2 revocar already-revoked (RECHAZADA) → 400 (estado)', async () => {
    const { status, body } = await post(`/ausencias/${compAusId}/revocar`, { motivo: 'again' }, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
  });
  let revPendId = '';
  await scenario('E3 revocar PENDIENTE compensatorio → 200, pendientes decremented', async () => {
    const r = await compensatorio(1);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    revPendId = r.body.id; createdAus.push(revPendId);
    const before = await getCompSaldo(owner.token);
    const { status } = await post(`/ausencias/${revPendId}/revocar`, {}, owner.token);
    assertStatus(status, 200, 'revoke pendiente');
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend - 1, `pendientes ${before.pend}→${after.pend}`);
  });
  await scenario('E4 revocar a non-compensatorio ausencia → 400', async () => {
    const r = await solicitar('FALTA_JUSTIFICADA');
    createdAus.push(r.body.id);
    const { status, body } = await post(`/ausencias/${r.body.id}/revocar`, {}, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/compensatorio/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });
  await scenario('E5 revocar someone else\'s compensatorio (not owner) → 403', async () => {
    const r = await compensatorio(1);
    createdAus.push(r.body.id);
    const { status, body } = await post(`/ausencias/${r.body.id}/revocar`, {}, otherOp.token);
    assertStatus(status, 403, JSON.stringify(body));
    // restore: reject it via supervisor to free the reserved day
    await post(`/ausencias/${r.body.id}/rechazar`, { motivo: 'cleanup' }, supUser.token).catch(() => {});
  });
  await scenario('E6 revocar past-dated compensatorio → 400 (fecha ya pasó)', async () => {
    const r = await compensatorio(1, '2026-02-10');
    assertStatus(r.status, 201, JSON.stringify(r.body));
    createdAus.push(r.body.id);
    const { status, body } = await post(`/ausencias/${r.body.id}/revocar`, {}, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/pas/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
    await post(`/ausencias/${r.body.id}/rechazar`, { motivo: 'cleanup' }, supUser.token).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F. RRHH/supervisor direct-create POST /ausencias/ + PUT + DELETE
  // ═══════════════════════════════════════════════════════════════════════
  let certMedId = '', borradorId = '';
  await scenario('F1 RRHH direct-create CERTIFICADO_MEDICO → 201 APROBADA (auto)', async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'CERTIFICADO_MEDICO', fechaInicio: absStart, fechaFin: absEnd,
      diasAusencia: 3, descripcion: 'gripe', numeroCertificado: 'CM-1',
    }, ana.token);
    assertStatus(status, 201, JSON.stringify(body));
    certMedId = body.id; createdAus.push(certMedId);
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
    assert(body.aprobada === true, `aprobada=${body.aprobada}`);
  });
  await scenario('F2 RRHH direct-create FALTA_JUSTIFICADA → 201 BORRADOR', async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 2,
    }, ana.token);
    assertStatus(status, 201, JSON.stringify(body));
    borradorId = body.id; createdAus.push(borradorId);
    assert(body.estado === 'BORRADOR', `estado=${body.estado}`);
    assert(body.requiereAprobacion === true, `requiereAprobacion=${body.requiereAprobacion}`);
  });
  await scenario('F3 owner-supervisor direct-create for owner → 201 (canManageUser via supervisorId)', async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1,
    }, supUser.token);
    assertStatus(status, 201, JSON.stringify(body));
    createdAus.push(body.id);
  });
  await scenario('F4 unrelated supervisor direct-create for owner → 403', async () => {
    const { status, body } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1,
    }, otherSup.token);
    assertStatus(status, 403, JSON.stringify(body));
  });
  await scenario('F5 OPERADOR direct-create → 403 (requireLevel SUPERVISOR)', async () => {
    const { status } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1,
    }, owner.token);
    assertStatus(status, 403, 'operador direct create');
  });
  await scenario('F6 direct-create for unknown user → 403 (canManageUser false)', async () => {
    const { status } = await post('/ausencias', {
      usuarioId: RANDOM_UUID, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1,
    }, supUser.token);
    assertStatus(status, 403, 'unknown target');
  });
  await scenario('F7 direct-create invalid body (bad tipo) → 400', async () => {
    const { status } = await post('/ausencias', {
      usuarioId: ownerId, tipo: 'NOPE', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1,
    }, ana.token);
    assertStatus(status, 400, 'bad tipo');
  });

  // PUT /ausencias/:id
  await scenario('G1 PUT ausencia by RRHH (set aprobada+descripcion) → 200', async () => {
    const { status, body } = await put(`/ausencias/${borradorId}`, { descripcion: 'editado qa', aprobada: true }, ana.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.aprobada === true && body.descripcion === 'editado qa', `body=${JSON.stringify({ a: body.aprobada, d: body.descripcion })}`);
    assert(body.aprobadaPorId === ana.user.id, `aprobadaPorId=${body.aprobadaPorId}`);
  });
  await scenario('G2 PUT by SUPERVISOR → 403 (requireLevel RRHH)', async () => {
    const { status } = await put(`/ausencias/${borradorId}`, { descripcion: 'x' }, supUser.token);
    assertStatus(status, 403, 'supervisor put');
  });
  await scenario('G3 PUT invalid body (diasAusencia=0) → 400', async () => {
    const { status } = await put(`/ausencias/${borradorId}`, { diasAusencia: 0 }, ana.token);
    assertStatus(status, 400, 'invalid dias');
  });
  await scenario('G4 PUT non-existent → 404', async () => {
    const { status } = await put(`/ausencias/${RANDOM_UUID}`, { descripcion: 'x' }, ana.token);
    assertStatus(status, 404, 'put 404');
  });

  // DELETE /ausencias/:id
  await scenario('H1 DELETE by SUPERVISOR → 403 (requireLevel RRHH)', async () => {
    const { status } = await del(`/ausencias/${certMedId}`, supUser.token);
    assertStatus(status, 403, 'supervisor delete');
  });
  await scenario('H2 DELETE non-existent by RRHH → 404', async () => {
    const { status } = await del(`/ausencias/${RANDOM_UUID}`, ana.token);
    assertStatus(status, 404, 'delete 404');
  });
  await scenario('H3 DELETE by RRHH → 204', async () => {
    const r = await post('/ausencias', { usuarioId: ownerId, tipo: 'FALTA_JUSTIFICADA', fechaInicio: absStart, fechaFin: absEnd, diasAusencia: 1 }, ana.token);
    const id = r.body.id;
    const { status } = await del(`/ausencias/${id}`, ana.token);
    assertStatus(status, 204, 'delete ok');
    const { status: getStatus } = await get(`/ausencias/${id}`, ana.token);
    assertStatus(getStatus, 404, 'deleted gone');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // I. GET endpoints + scoping
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('I1 GET /ausencias as owner (OPERADOR) → only own records', async () => {
    const { status, body } = await get('/ausencias', owner.token);
    assertStatus(status, 200, '');
    assert(Array.isArray(body), 'array');
    const foreign = (body as any[]).filter(a => a.usuarioId !== ownerId);
    assert(foreign.length === 0, `operador sees ${foreign.length} foreign records — leak`);
    assert((body as any[]).some(a => a.usuarioId === ownerId), 'owner sees own');
  });
  await scenario('I2 GET /ausencias as owner-supervisor → includes subordinate (owner) records', async () => {
    const { status, body } = await get('/ausencias', supUser.token);
    assertStatus(status, 200, '');
    assert((body as any[]).some(a => a.usuarioId === ownerId), 'supervisor sees subordinate');
  });
  await scenario('I3 GET /ausencias as RRHH (ana) → company-wide includes owner', async () => {
    const { status, body } = await get('/ausencias', ana.token);
    assertStatus(status, 200, '');
    assert((body as any[]).some(a => a.usuarioId === ownerId), 'rrhh sees owner');
  });
  await scenario('I4 GET /ausencias?tipo=FRANCO_COMPENSATORIO filter (owner)', async () => {
    const { status, body } = await get('/ausencias?tipo=FRANCO_COMPENSATORIO', owner.token);
    assertStatus(status, 200, '');
    assert((body as any[]).every(a => a.tipo === 'FRANCO_COMPENSATORIO'), 'filter applied');
  });
  await scenario('I5 GET /ausencias/subordinados as supervisor → includes owner', async () => {
    const { status, body } = await get('/ausencias/subordinados', supUser.token);
    assertStatus(status, 200, '');
    assert((body as any[]).some(u => u.id === ownerId), 'subordinados includes owner');
  });
  await scenario('I6 GET /ausencias/subordinados as OPERADOR → 403', async () => {
    const { status } = await get('/ausencias/subordinados', owner.token);
    assertStatus(status, 403, 'operador subordinados');
  });
  await scenario('I7 GET /ausencias/:id valid → 200 with historial', async () => {
    const { status, body } = await get(`/ausencias/${approveAusId}`, ana.token);
    assertStatus(status, 200, '');
    assert(body.id === approveAusId, 'id match');
    assert(Array.isArray(body.historial), 'historial array');
  });
  await scenario('I8 GET /ausencias/:id non-existent → 404', async () => {
    const { status } = await get(`/ausencias/${RANDOM_UUID}`, ana.token);
    assertStatus(status, 404, 'detail 404');
  });
  await scenario('I9 GET /mis-solicitudes as owner → includes own ausencias (requiereAprobacion, not BORRADOR)', async () => {
    const { status, body } = await get('/mis-solicitudes', owner.token);
    assertStatus(status, 200, '');
    const aus = (body as any[]).filter(s => s.tipo === 'AUSENCIA');
    assert(aus.length > 0, 'has ausencia solicitudes');
    assert(aus.some(s => s.id === approveAusId), 'approved ausencia present');
    assert(!aus.some(s => s.estado === 'BORRADOR'), 'no BORRADOR leaked');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // J. SECURITY PROBE — horizontal authz on GET /ausencias/:id
  //    List endpoint scopes OPERADOR to own records; detail endpoint only
  //    scopes by tenant. Probe whether an unrelated OPERADOR can read another
  //    user's absence (incl. medical descripcion / numeroCertificado) by id.
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('J1 PROBE unrelated OPERADOR reads owner medical absence by id', async () => {
    const { status, body } = await get(`/ausencias/${certMedId}`, otherOp.token);
    info(`otherOp GET /ausencias/${certMedId.slice(0, 8)} → HTTP ${status}`);
    if (status === 200) {
      bugs.push({
        id: `${KEY}-01`,
        title: 'Horizontal authz / IDOR: any authenticated user can read any absence (incl. medical details) by id',
        severity: 'MEDIUM',
        endpoint: `GET /ausencias/:id`,
        expected: 'Non-privileged OPERADOR unrelated to the owner should NOT read another user\'s absence detail (403/404), consistent with GET /ausencias list scoping which limits OPERADOR to own records.',
        actual: `HTTP 200 returned full absence incl. tipo=${body.tipo}, descripcion="${body.descripcion}", numeroCertificado="${body.numeroCertificado}".`,
        evidence: `otherOp (OPERADOR, unrelated, different/no sector) GET /ausencias/${certMedId} → 200; body.usuarioId=${body.usuario?.id ?? body.usuarioId}`,
        rootCause: 'src/routes/ausencias.routes.ts GET /:id (~line 480-501): findFirst filters only by usuario.empresaId (tenant) with no owner/role/subordinate check, unlike the list handler (lines 104-107) which restricts OPERADOR to where.usuarioId=userId.',
        repro: '1) RRHH creates CERTIFICADO_MEDICO absence for user A. 2) Login as unrelated OPERADOR B (different sector, not A\'s subordinate). 3) GET /ausencias/<absenceId> as B → 200 with A\'s medical data.',
      });
      throw new Error(`LEAK: unrelated OPERADOR read another user's medical absence (200). descripcion="${body.descripcion}"`);
    }
    assert(status === 403 || status === 404, `expected 403/404, got ${status}`);
  });

  // ── Summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n═══ RESULTS: ${passed}/${results.length} passed, ${failed} failed ═══`));
  if (failed) {
    console.log(col('YELLOW', 'Failed scenarios:'));
    results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
  }
  if (bugs.length) {
    console.log(col('RED', `\n═══ SUSPECTED BUGS: ${bugs.length} ═══`));
    bugs.forEach(b => console.log(`  [${b.id}] ${b.severity} ${b.title}\n      ${b.actual}`));
  }

  // ── Cleanup (best-effort, reverse order) ──
  console.log(col('DIM', '\nCleaning up...'));
  for (const fn of cleanupQueue.reverse()) { await fn().catch(() => {}); }

  console.log('\n__RESULT_JSON__' + JSON.stringify({
    passed, failed, total: results.length, bugs,
  }));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
