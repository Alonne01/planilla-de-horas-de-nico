/**
 * QA suite — KEY=planillas
 * Black-box HTTP tests for src/routes/planillas.routes.ts
 * Run: cd apps/api && npx tsx tests/qa/planillas.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'planillas';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m',
  YELLOW: '\x1b[33m', CYAN: '\x1b[36m',
};
function col(c: string, s: string) { return `${C[c] ?? ''}${s}${C.RESET}`; }

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const bugs: string[] = [];

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, detail: 'OK' });
    process.stdout.write(`  ${col('GREEN', 'PASS')} ${name}  (${ms}ms)\n`);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail });
    process.stdout.write(`  ${col('RED', 'FAIL')} ${name} — ${detail}\n`);
  }
}
function note(msg: string) { process.stdout.write(`       ${col('DIM', '· ' + msg)}\n`); }
function bug(msg: string) { bugs.push(msg); process.stdout.write(`  ${col('YELLOW', 'BUG?')} ${msg}\n`); }

function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

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
const get = (p: string, t?: string) => api('GET', p, { token: t });
const post = (p: string, b: unknown, t?: string) => api('POST', p, { token: t, body: b });
const put = (p: string, b: unknown, t?: string) => api('PUT', p, { token: t, body: b });
const del = (p: string, t?: string) => api('DELETE', p, { token: t });

interface Session { token: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

function isoDay(year: number, month: number, day: number) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}T00:00:00.000Z`;
}
function isoTime(year: number, month: number, day: number, hh: number) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const HH = String(hh).padStart(2, '0');
  return `${year}-${mm}-${dd}T${HH}:00:00.000Z`;
}
const num = (v: unknown) => Number(v);

// ── cleanup registry ─────────────────────────────────────────────────────────
const cleanup: Array<() => Promise<void>> = [];

async function main() {
  console.log(col('CYAN', `\n=== QA planillas (ts=${TS}) ===\n`));

  const admin = await login('admin@wenlen.com');
  note(`admin empresaId=${admin.user.empresaId} nivel=${admin.user.rolNivel}`);

  // ── Setup: dedicated sector, supervisor, owner operador A, intruder operador B ──
  let sectorId: string | null = null;
  let flujoId: string | null = null;
  let asignacionId: string | null = null;
  const createdUserIds: string[] = [];

  // sector
  {
    const { status, body } = await post('/admin/sectores', { nombre: `qa-${KEY}-sec-${TS}` }, admin.token);
    if (status === 201) { sectorId = body.id; note(`sector=${sectorId}`); }
    else note(`sector create failed (${status}) — continuing without sector`);
  }

  async function mkUser(rol: string, suffix: string, extra: Record<string, unknown> = {}): Promise<string> {
    const email = `qa.${KEY}.${suffix}.${TS}@demo.com`;
    const { status, body } = await post('/usuarios', {
      nombre: `QA${suffix}`, apellido: `T${TS}`, email,
      password: 'Test1234!', rol, sectorId,
      fechaIngreso: isoDay(2020, 1, 1), ...extra,
    }, admin.token);
    assertStatus(status, 201, `create ${rol}: ${JSON.stringify(body)}`);
    createdUserIds.push(body.id);
    return body.id;
}

  const supId = await mkUser('SUPERVISOR', 'sup');
  const aId = await mkUser('OPERADOR', 'opA', { supervisorId: supId });
  const bId = await mkUser('OPERADOR', 'opB');
  note(`supervisor=${supId} opA=${aId} opB=${bId}`);

  const A = await login(`qa.${KEY}.opA.${TS}@demo.com`);
  const B = await login(`qa.${KEY}.opB.${TS}@demo.com`);
  const S = await login(`qa.${KEY}.sup.${TS}@demo.com`);
  assert(A.user.rolNivel < 60, `A should be OPERADOR nivel<60 (got ${A.user.rolNivel})`);

  // ── flujo PLANILLA with one SUPERVISOR step, scoped to opA only ──
  {
    const { status, body } = await post('/admin/flujos', {
      nombre: `qa-${KEY}-flujo-${TS}`, tipoDocumento: 'PLANILLA',
      pasos: [{ orden: 1, nombrePaso: 'Supervisor', rolAprobador: 'SUPERVISOR' }],
    }, admin.token);
    assertStatus(status, 201, `create flujo: ${JSON.stringify(body)}`);
    flujoId = body.id;
    const asg = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'PLANILLA', usuarioId: aId,
    }, admin.token);
    assertStatus(asg.status, 201, `create asignacion: ${JSON.stringify(asg.body)}`);
    asignacionId = asg.body.id;
    note(`flujo=${flujoId} asignacion=${asignacionId} (scoped to opA)`);
  }

  // year allocation per planilla to avoid overlap (dedicated user)
  const Y_MAIN = 2310, Y_EMPTY = 2320, Y_SEND = 2330, Y_INV = 2340;
  let mainPlanillaId = '';
  let sendPlanillaId = '';
  let invPlanillaId = '';

  // ════════════════════ HAPPY PATH: create / list / detail ════════════════════

  await scenario('POST /planillas creates BORRADOR with flujo assigned', async () => {
    const { status, body } = await post('/planillas', {
      periodoInicio: isoDay(Y_MAIN, 5, 10), periodoFin: isoDay(Y_MAIN, 5, 12),
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.estado === 'BORRADOR', `estado should be BORRADOR, got ${body.estado}`);
    assert(body.usuarioId === aId, 'usuarioId mismatch');
    assert(body.flujoId === flujoId, `flujoId should be my flujo (got ${body.flujoId})`);
    assert(body.pasoActual === 0, `pasoActual should be 0, got ${body.pasoActual}`);
    mainPlanillaId = body.id;
  });

  await scenario('GET /planillas (owner) lists own planilla', async () => {
    const { status, body } = await get('/planillas', A.token);
    assertStatus(status, 200);
    assert(Array.isArray(body), 'expected array');
    assert(body.some((p: any) => p.id === mainPlanillaId), 'own planilla not in list');
    assert(body.every((p: any) => p.usuarioId === aId), 'list leaked other users planillas to OPERADOR');
  });

  await scenario('GET /planillas/:id (owner) detail has registros[] + flujo.pasos', async () => {
    const { status, body } = await get(`/planillas/${mainPlanillaId}`, A.token);
    assertStatus(status, 200);
    assert(Array.isArray(body.registros), 'registros array missing');
    assert(body.flujo && Array.isArray(body.flujo.pasos), 'flujo.pasos missing');
    assert(body.flujo.pasos[0].rolAprobador === 'SUPERVISOR', 'paso rol mismatch');
  });

  // ════════════════════ REGISTROS: compute / edit / delete ════════════════════

  let regBaseId = '';
  await scenario('POST registro BASE 08-17 → computed hours, sum invariant', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 10),
      entradaTurno1: isoTime(Y_MAIN, 5, 10, 8),
      salidaTurno1: isoTime(Y_MAIN, 5, 10, 17),
      lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    regBaseId = body.id;
    const ht = num(body.horasTrabajadas), hn = num(body.horasNormales), h50 = num(body.horasExtra50), h100 = num(body.horasExtra100);
    assert(ht > 0, `horasTrabajadas should be >0, got ${ht}`);
    assert(Math.abs((hn + h50 + h100) - ht) < 0.01, `sum invariant broken: ${hn}+${h50}+${h100} != ${ht}`);
    note(`BASE 9h shift → trabajadas=${ht} normales=${hn} extra50=${h50} extra100=${h100}`);
  });

  await scenario('POST registro CAMPO+maneja → horasViajeCalc>0, sum invariant', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 11),
      entradaTurno1: isoTime(Y_MAIN, 5, 11, 6),
      salidaTurno1: isoTime(Y_MAIN, 5, 11, 18),
      lugarTrabajo: 'CAMPO', maneja: true, horasViajeInput: 3,
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    const ht = num(body.horasTrabajadas), hn = num(body.horasNormales), h50 = num(body.horasExtra50), h100 = num(body.horasExtra100);
    assert(num(body.horasViajeCalc) === 3, `horasViajeCalc should be 3, got ${body.horasViajeCalc}`);
    assert(Math.abs((hn + h50 + h100) - ht) < 0.01, `sum invariant broken: ${hn}+${h50}+${h100} != ${ht}`);
    note(`CAMPO 12h shift → trabajadas=${ht} normales=${hn} extra50=${h50} extra100=${h100} viaje=${body.horasViajeCalc}`);
  });

  await scenario('POST registro esFeriado → all hours to extra100', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 12),
      entradaTurno1: isoTime(Y_MAIN, 5, 12, 9),
      salidaTurno1: isoTime(Y_MAIN, 5, 12, 13),
      lugarTrabajo: 'BASE', esFeriado: true,
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    const ht = num(body.horasTrabajadas), hn = num(body.horasNormales), h50 = num(body.horasExtra50), h100 = num(body.horasExtra100);
    assert(hn === 0 && h50 === 0, `feriado normales/extra50 should be 0, got ${hn}/${h50}`);
    assert(Math.abs(h100 - ht) < 0.01, `feriado extra100 should equal trabajadas: ${h100} != ${ht}`);
  });

  await scenario('PUT registro recomputes hours', async () => {
    const { status, body } = await put(`/planillas/${mainPlanillaId}/registros/${regBaseId}`, {
      fecha: isoDay(Y_MAIN, 5, 10),
      entradaTurno1: isoTime(Y_MAIN, 5, 10, 8),
      salidaTurno1: isoTime(Y_MAIN, 5, 10, 12),
      lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(num(body.horasTrabajadas) === 4, `edited shift should be 4h, got ${body.horasTrabajadas}`);
  });

  await scenario('DELETE registro → 204', async () => {
    const { status } = await del(`/planillas/${mainPlanillaId}/registros/${regBaseId}`, A.token);
    assertStatus(status, 204);
    // confirm gone
    const after = await get(`/planillas/${mainPlanillaId}/registros`, A.token);
    assert(!after.body.some((r: any) => r.id === regBaseId), 'registro still present after delete');
  });

  // ════════════════════ REGISTROS: negative / edge ════════════════════

  await scenario('POST registro duplicate fecha → 409', async () => {
    // 5/11 already has a registro
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 11), lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 409, JSON.stringify(body));
  });

  await scenario('POST registro missing fecha → 400', async () => {
    const { status } = await post(`/planillas/${mainPlanillaId}/registros`, { lugarTrabajo: 'BASE' }, A.token);
    assertStatus(status, 400);
  });

  await scenario('POST registro invalid lugarTrabajo enum → 400', async () => {
    const { status } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 13), lugarTrabajo: 'MARTE',
    }, A.token);
    assertStatus(status, 400);
  });

  await scenario('POST registro salida<entrada → no validation (treated as cross-midnight)', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 14),
      entradaTurno1: isoTime(Y_MAIN, 5, 14, 8),
      salidaTurno1: isoTime(Y_MAIN, 5, 14, 6),
      lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    note(`salida<entrada accepted → horasTrabajadas=${body.horasTrabajadas} (cross-midnight, no validation)`);
  });

  await scenario('POST registro overlapping turnos → no validation (hours summed)', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 15),
      entradaTurno1: isoTime(Y_MAIN, 5, 15, 8), salidaTurno1: isoTime(Y_MAIN, 5, 15, 16),
      entradaTurno2: isoTime(Y_MAIN, 5, 15, 10), salidaTurno2: isoTime(Y_MAIN, 5, 15, 18),
      lugarTrabajo: 'CAMPO',
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    note(`overlapping turnos accepted → horasTrabajadas=${body.horasTrabajadas} (both turnos summed)`);
  });

  await scenario('POST registro to non-existent planilla → 404', async () => {
    const { status } = await post(`/planillas/00000000-0000-0000-0000-000000000000/registros`, {
      fecha: isoDay(Y_MAIN, 5, 16), lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 404);
  });

  await scenario('POST registro with non-existent proyectoId (well-formed uuid)', async () => {
    const { status, body } = await post(`/planillas/${mainPlanillaId}/registros`, {
      fecha: isoDay(Y_MAIN, 5, 17), lugarTrabajo: 'BASE',
      proyectoId: '11111111-1111-1111-1111-111111111111',
    }, A.token);
    note(`non-existent proyectoId → HTTP ${status}`);
    if (status === 500) {
      bug(`POST registro with well-formed but non-existent proyectoId returns 500 (FK violation uncaught) — should be 400/404. body=${JSON.stringify(body)}`);
    } else {
      assert(status === 400 || status === 404 || status === 201, `unexpected status ${status}`);
    }
  });

  // ════════════════════ PLANILLA negative / state machine ════════════════════

  await scenario('POST /planillas duplicate period → 409 with planillaId', async () => {
    const { status, body } = await post('/planillas', {
      periodoInicio: isoDay(Y_MAIN, 5, 10), periodoFin: isoDay(Y_MAIN, 5, 12),
    }, A.token);
    assertStatus(status, 409, JSON.stringify(body));
    assert(body.planillaId === mainPlanillaId, `409 body.planillaId should be ${mainPlanillaId}, got ${body.planillaId}`);
  });

  await scenario('POST /planillas invalid periodoInicio format → 400', async () => {
    const { status } = await post('/planillas', { periodoInicio: 'not-a-date', periodoFin: isoDay(Y_MAIN, 6, 1) }, A.token);
    assertStatus(status, 400);
  });

  await scenario('POST /planillas with periodoFin < periodoInicio → accepted (validation gap)', async () => {
    const { status, body } = await post('/planillas', {
      periodoInicio: isoDay(Y_INV, 7, 20), periodoFin: isoDay(Y_INV, 7, 10),
    }, A.token);
    assertStatus(status, 201, JSON.stringify(body));
    invPlanillaId = body.id;
    bug(`POST /planillas accepts periodoFin<periodoInicio (201, no validation). inicio=${body.periodoInicio} fin=${body.periodoFin}`);
  });

  await scenario('enviar inverted-period planilla → bypasses completeness (submits EMPTY planilla)', async () => {
    const det = await get(`/planillas/${invPlanillaId}`, A.token);
    assert((det.body.registros ?? []).length === 0, 'inverted planilla unexpectedly has registros');
    const { status, body } = await post(`/planillas/${invPlanillaId}/enviar`, {}, A.token);
    if (status === 200 && body.estado === 'ENVIADA') {
      bug(`enviar on periodoFin<periodoInicio planilla returns 200/ENVIADA with ZERO registros — completeness guard bypassed via inverted period`);
    } else {
      note(`enviar inverted → HTTP ${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  });

  await scenario('enviar EMPTY planilla (valid forward period) → 400 diasFaltantes', async () => {
    const cr = await post('/planillas', { periodoInicio: isoDay(Y_EMPTY, 5, 10), periodoFin: isoDay(Y_EMPTY, 5, 11) }, A.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    cleanup.push(async () => { await del(`/planillas/${cr.body.id}`, A.token); });
    const { status, body } = await post(`/planillas/${cr.body.id}/enviar`, {}, A.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(Array.isArray(body.diasFaltantes) && body.diasFaltantes.length >= 1, `expected diasFaltantes list, got ${JSON.stringify(body)}`);
    note(`diasFaltantes=${JSON.stringify(body.diasFaltantes)}`);
  });

  // ════════════════════ enviar success + NOTIFICATION to supervisor ════════════════════

  await scenario('enviar fully-filled planilla → 200 ENVIADA + notifies supervisor', async () => {
    // 1-day period, fill the day
    const cr = await post('/planillas', { periodoInicio: isoDay(Y_SEND, 6, 15), periodoFin: isoDay(Y_SEND, 6, 15) }, A.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    sendPlanillaId = cr.body.id;
    const reg = await post(`/planillas/${sendPlanillaId}/registros`, {
      fecha: isoDay(Y_SEND, 6, 15),
      entradaTurno1: isoTime(Y_SEND, 6, 15, 8), salidaTurno1: isoTime(Y_SEND, 6, 15, 17),
      lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(reg.status, 201, JSON.stringify(reg.body));

    // capture supervisor notif count BEFORE
    const before = await get('/notificaciones/count', S.token);
    assertStatus(before.status, 200);
    const cntBefore = num(before.body.count);

    const { status, body } = await post(`/planillas/${sendPlanillaId}/enviar`, {}, A.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'ENVIADA', `estado should be ENVIADA, got ${body.estado}`);
    assert(body.pasoActual === 1, `pasoActual should be 1, got ${body.pasoActual}`);

    // notification delivered immediately?
    const after = await get('/notificaciones/count', S.token);
    const cntAfter = num(after.body.count);
    assert(cntAfter >= cntBefore + 1, `supervisor unread count did not increase (${cntBefore} -> ${cntAfter})`);
    const list = await get('/notificaciones', S.token);
    const top = (list.body as any[])[0];
    assert(top && top.tipo === 'PLANILLA', `top notif tipo should be PLANILLA, got ${top?.tipo}`);
    assert(typeof top.titulo === 'string' && top.titulo.includes('planilla'), `notif titulo mismatch: ${top?.titulo}`);
    assert(top.link === '/aprobaciones', `notif link should be /aprobaciones, got ${top?.link}`);
    note(`supervisor notif: "${top.titulo}" (count ${cntBefore}->${cntAfter})`);
  });

  await scenario('enviar already-ENVIADA planilla → 400', async () => {
    const { status, body } = await post(`/planillas/${sendPlanillaId}/enviar`, {}, A.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  await scenario('POST registro to ENVIADA planilla → 400', async () => {
    const { status, body } = await post(`/planillas/${sendPlanillaId}/registros`, {
      fecha: isoDay(Y_SEND, 6, 16), lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  await scenario('PUT registro on ENVIADA planilla → 400', async () => {
    const regs = await get(`/planillas/${sendPlanillaId}/registros`, A.token);
    const rid = regs.body[0]?.id;
    assert(!!rid, 'no registro to edit');
    const { status } = await put(`/planillas/${sendPlanillaId}/registros/${rid}`, {
      fecha: isoDay(Y_SEND, 6, 15), lugarTrabajo: 'BASE',
    }, A.token);
    assertStatus(status, 400);
  });

  await scenario('enviar non-existent planilla → 404', async () => {
    const { status } = await post(`/planillas/00000000-0000-0000-0000-000000000000/enviar`, {}, A.token);
    assertStatus(status, 404);
  });

  await scenario('GET non-existent planilla → 404', async () => {
    const { status } = await get(`/planillas/00000000-0000-0000-0000-000000000000`, A.token);
    assertStatus(status, 404);
  });

  // ════════════════════ permission boundaries (OPERADOR on approver endpoints) ════════════════════

  await scenario('OPERADOR POST /planillas/:id/avanzar → 403 (level guard)', async () => {
    const { status } = await post(`/planillas/${sendPlanillaId}/avanzar`, { comentario: 'x' }, A.token);
    assertStatus(status, 403);
  });
  await scenario('OPERADOR POST /planillas/:id/rechazar → 403 (level guard)', async () => {
    const { status } = await post(`/planillas/${sendPlanillaId}/rechazar`, { motivo: 'x' }, A.token);
    assertStatus(status, 403);
  });
  await scenario('OPERADOR POST /planillas/:id/cerrar → 403 (level guard)', async () => {
    const { status } = await post(`/planillas/${sendPlanillaId}/cerrar`, {}, A.token);
    assertStatus(status, 403);
  });
  await scenario('OPERADOR POST /planillas/:id/reabrir → 403 (level guard)', async () => {
    const { status } = await post(`/planillas/${sendPlanillaId}/reabrir`, { motivo: 'x' }, A.token);
    assertStatus(status, 403);
  });
  await scenario('OPERADOR PATCH compensatorio → 403 (level guard)', async () => {
    const { status } = await api('PATCH', `/planillas/${mainPlanillaId}/registros/x/compensatorio`, { token: A.token, body: { activar: true } });
    assertStatus(status, 403);
  });

  // ════════════════════ cross-user authz (intruder operador B, same empresa) ════════════════════

  await scenario('B (other OPERADOR) GET /planillas/:id of A → 403', async () => {
    const { status } = await get(`/planillas/${mainPlanillaId}`, B.token);
    assertStatus(status, 403);
  });
  await scenario('B GET /planillas/:id/registros of A → 403', async () => {
    const { status } = await get(`/planillas/${mainPlanillaId}/registros`, B.token);
    assertStatus(status, 403);
  });
  await scenario('B GET /planillas/:id/historial of A → 403', async () => {
    const { status } = await get(`/planillas/${mainPlanillaId}/historial`, B.token);
    assertStatus(status, 403);
  });
  await scenario('B POST registro to A planilla → 404 (ownership-scoped)', async () => {
    const { status } = await post(`/planillas/${mainPlanillaId}/registros`, { fecha: isoDay(Y_MAIN, 5, 18), lugarTrabajo: 'BASE' }, B.token);
    assertStatus(status, 404);
  });
  await scenario('B POST enviar A planilla → 404', async () => {
    const { status } = await post(`/planillas/${mainPlanillaId}/enviar`, {}, B.token);
    assertStatus(status, 404);
  });
  await scenario('B DELETE A planilla → 404', async () => {
    const { status } = await del(`/planillas/${mainPlanillaId}`, B.token);
    assertStatus(status, 404);
  });
  await scenario('B GET /planillas list excludes A planilla', async () => {
    const { status, body } = await get('/planillas', B.token);
    assertStatus(status, 200);
    assert(!body.some((p: any) => p.id === mainPlanillaId), 'A planilla leaked to B list');
  });

  // ════════════════════ DELETE BORRADOR ════════════════════

  await scenario('DELETE BORRADOR planilla → 204', async () => {
    const cr = await post('/planillas', { periodoInicio: isoDay(2350, 4, 5), periodoFin: isoDay(2350, 4, 6) }, A.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const { status } = await del(`/planillas/${cr.body.id}`, A.token);
    assertStatus(status, 204);
    const after = await get(`/planillas/${cr.body.id}`, A.token);
    assertStatus(after.status, 404);
  });

  // ════════════════════ CLEANUP ════════════════════
  console.log(col('CYAN', '\n-- cleanup --'));
  for (const fn of cleanup) { try { await fn(); } catch { /* ignore */ } }
  // delete planillas owned by A
  for (const pid of [mainPlanillaId, sendPlanillaId, invPlanillaId]) {
    if (pid) { try { await del(`/planillas/${pid}`, A.token); } catch { /* ignore */ } }
  }
  // delete flujo asignacion + flujo
  if (asignacionId) { try { await del(`/admin/flujos/asignaciones/${asignacionId}`, admin.token); } catch { /* ignore */ } }
  if (flujoId) { try { await del(`/admin/flujos/${flujoId}`, admin.token); } catch { /* ignore */ } }
  // deactivate created users (soft delete; admin only)
  for (const uid of createdUserIds) { try { await del(`/usuarios/${uid}`, admin.token); } catch { /* ignore */ } }
  // deactivate sector
  if (sectorId) { try { await put(`/admin/sectores/${sectorId}`, { activo: false }, admin.token); } catch { /* ignore */ } }
  note('cleanup done (best-effort)');

  // ── summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n=== RESULT: ${passed}/${results.length} passed, ${failed} failed, ${bugs.length} suspected bug(s) ===`));
  if (failed) for (const r of results.filter(x => !x.passed)) console.log(col('RED', `  FAIL ${r.name}: ${r.detail}`));
  if (bugs.length) { console.log(col('YELLOW', '\nSuspected bugs:')); bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b}`)); }
}

main().catch((e) => { console.error(col('RED', 'FATAL: ' + (e?.stack ?? e))); process.exit(1); });
