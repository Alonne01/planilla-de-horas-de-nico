/**
 * QA — Capacitaciones / Sesiones de Capacitación (KEY=capacit)
 * Black-box HTTP tests against the LIVE API.
 *
 * Flow: RRHH creates tipo -> COORDINADOR creates sesión -> invita operadores ->
 *       operadores aceptan/rechazan -> coordinador elimina invitación + finaliza.
 * Plus: registros CRUD, tipos CRUD, resumen, mis-capacitaciones, authz boundaries,
 *       notifications, and state-machine probes.
 *
 * Run: cd apps/api && npx tsx tests/qa/capacit.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'capacit';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
const COLORS: Record<string, string> = {
  RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m',
  YELLOW: '\x1b[33m', CYAN: '\x1b[36m', MAGENTA: '\x1b[35m',
};
function c(col: string, s: string) { return `${COLORS[col] ?? ''}${s}${COLORS.RESET}`; }

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];
const bugs: string[] = [];

function log(sym: string, msg: string) { process.stdout.write(`  ${sym} ${msg}\n`); }

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK' });
    log(c('GREEN', '✅'), `${name}  (${Date.now() - start}ms)`);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail });
    log(c('RED', '❌'), `${name} — ${detail}`);
  }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}
function flagBug(msg: string) { bugs.push(msg); log(c('MAGENTA', '🐞'), c('MAGENTA', msg)); }

// ── HTTP ────────────────────────────────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body: body as any };
}
const get = (p: string, tok?: string) => api('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => api('PUT', p, { token: tok, body: b });
const del = (p: string, tok?: string) => api('DELETE', p, { token: tok });

// ── auth ────────────────────────────────────────────────────────────────────
interface Session {
  token: string;
  user: { id: string; nombre: string; apellido: string; email: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null; sectorNombre?: string };
}
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

// ── notif helpers ───────────────────────────────────────────────────────────
async function notifCount(tok: string): Promise<number> {
  const { body } = await get('/notificaciones/count', tok);
  return body.count as number;
}
async function notifTop(tok: string): Promise<any[]> {
  const { body } = await get('/notificaciones', tok);
  return body as any[];
}

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

async function main() {
  console.log(c('CYAN', `\n═══ QA capacitaciones — KEY=${KEY} ts=${TS} ═══\n`));

  // ── Setup identities ──
  const admin = await login('admin@wenlen.com');
  const rrhh = await login('ana.martinez@demo.com');
  assert(rrhh.user.rolNivel >= 90, `ana.martinez nivel ${rrhh.user.rolNivel} (<90)`);

  // Discover users
  const { body: allUsers } = await get('/auth/debug-users', admin.token);
  assert(Array.isArray(allUsers), 'debug-users not array');
  const coordEntry = (allUsers as any[]).find(u => u.rol === 'COORDINADOR');
  assert(!!coordEntry, 'No COORDINADOR seed user found');
  const coord = await login(coordEntry.email);
  assert(coord.user.rolNivel >= 70, `coord nivel ${coord.user.rolNivel}`);
  const coordSectorId = coord.user.sectorId;
  assert(!!coordSectorId, 'Coordinador has no sectorId — cannot run subordinate flow');
  log('ℹ', `Coordinador: ${coord.user.nombre} ${coord.user.apellido} sector=${coordEntry.sector?.nombre} (${coordSectorId})`);

  // A second coordinador in a DIFFERENT sector (for cross-org mutation probe)
  let coord2: Session | null = null;
  for (const u of allUsers as any[]) {
    if (u.rol === 'COORDINADOR' && u.email !== coordEntry.email) {
      const s = await login(u.email);
      if (s.user.sectorId && s.user.sectorId !== coordSectorId) { coord2 = s; break; }
    }
  }
  if (coord2) log('ℹ', `Coordinador #2 (otro sector): ${coord2.user.nombre} ${coord2.user.apellido}`);

  // A supervisor (nivel 60) for authz boundary
  let supervisor: Session | null = null;
  const supEntry = (allUsers as any[]).find(u => u.rol === 'SUPERVISOR');
  if (supEntry) supervisor = await login(supEntry.email);

  // ── Create 3 dedicated OPERADOR test users in coordinador's sector ──
  const operadores: Session[] = [];
  const createdUserIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const email = `qa.${KEY}.${TS}.op${i}@demo.com`;
    const { status, body } = await post('/usuarios', {
      nombre: `QA${KEY}`, apellido: `Op${i}_${TS}`,
      email, password: 'Test1234!', rol: 'OPERADOR',
      sectorId: coordSectorId, fechaIngreso: '2020-01-01T00:00:00.000Z',
    }, admin.token);
    assertStatus(status, 201, `create op${i}: ${JSON.stringify(body)}`);
    createdUserIds.push(body.id);
    cleanup.push(async () => { await del(`/usuarios/${body.id}`, admin.token); });
    operadores.push(await login(email));
  }
  const [op1, op2, op3] = operadores;
  log('ℹ', `Operadores creados: ${createdUserIds.join(', ')}`);

  // Compute a TRUE non-subordinate (outsider) using the coordinador's actual subordinate set.
  // NOTE: a user in a different sector can still be a subordinate via coordinadorId/supervisorId,
  // so we must exclude the real subordinate set, not just compare sector names.
  const { body: subBody } = await get('/sesiones-capacitacion/subordinados', coord.token);
  const subSet = new Set((subBody as any[]).map(u => u.id));
  const outsiderEntry = (allUsers as any[]).find(
    u => u.rol === 'OPERADOR' && !subSet.has(u.id) && !createdUserIds.includes(u.id) && u.id !== coord.user.id,
  );
  const outsiderId = outsiderEntry?.id as string | undefined;
  log('ℹ', outsiderId ? `Outsider (no subordinado): ${outsiderEntry.nombre} ${outsiderEntry.apellido} (${outsiderId})` : 'No se halló outsider');

  // shared ids populated during flow
  let tipoId = '';
  let tipo2Id = '';
  let msId = '';                  // main session
  const invIds: Record<string, string> = {}; // userId -> invitationId for MS
  const createdInvIdsForCleanup: string[] = [];
  const createdSesionIds: string[] = [];

  // ═══════════════════════════════════════════════════════════════════════
  // 1. RRHH creates tipo de capacitación
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('POST /capacitaciones/tipos (RRHH) → 201', async () => {
    const { status, body } = await post('/capacitaciones/tipos', {
      nombre: `QA-${KEY}-Tipo-${TS}`, descripcion: 'Tipo de prueba QA',
      vigenciaDias: 365, esObligatoria: true, alertaDias: 30,
    }, rrhh.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(typeof body.id === 'string', 'no id');
    assert(body.vigenciaDias === 365, 'vigenciaDias mismatch');
    assert(body.esObligatoria === true, 'esObligatoria mismatch');
    tipoId = body.id;
    cleanup.push(async () => { await del(`/capacitaciones/tipos/${tipoId}`, rrhh.token); });
  });

  await scenario('POST /capacitaciones/tipos invalid (nombre vacío) → 400', async () => {
    const { status } = await post('/capacitaciones/tipos', { nombre: '' }, rrhh.token);
    assertStatus(status, 400);
  });

  await scenario('POST /capacitaciones/tipos as OPERADOR → 403', async () => {
    const { status } = await post('/capacitaciones/tipos', { nombre: `QA-${KEY}-x` }, op1.token);
    assertStatus(status, 403);
  });

  await scenario('POST /capacitaciones/tipos as COORDINADOR (nivel 70 < 90 RRHH) → 403', async () => {
    const { status } = await post('/capacitaciones/tipos', { nombre: `QA-${KEY}-x2` }, coord.token);
    assertStatus(status, 403);
  });

  // second tipo for PUT/DELETE lifecycle (no vigencia → no auto-vencimiento)
  await scenario('POST /capacitaciones/tipos #2 → 201, PUT → 200, DELETE → ok', async () => {
    const { status, body } = await post('/capacitaciones/tipos', { nombre: `QA-${KEY}-Tipo2-${TS}` }, rrhh.token);
    assertStatus(status, 201, JSON.stringify(body));
    tipo2Id = body.id;
    assert(body.alertaDias === 30, 'default alertaDias should be 30');
    assert(body.esObligatoria === false, 'default esObligatoria should be false');
    const upd = await put(`/capacitaciones/tipos/${tipo2Id}`, { nombre: `QA-${KEY}-Tipo2b-${TS}`, alertaDias: 15 }, rrhh.token);
    assertStatus(upd.status, 200, JSON.stringify(upd.body));
    assert(upd.body.nombre === `QA-${KEY}-Tipo2b-${TS}`, 'nombre not updated');
    assert(upd.body.alertaDias === 15, 'alertaDias not updated');
    const d = await del(`/capacitaciones/tipos/${tipo2Id}`, rrhh.token);
    assertStatus(d.status, 200, JSON.stringify(d.body));
    assert(d.body.ok === true, 'delete tipo not ok');
  });

  await scenario('PUT /capacitaciones/tipos/:id inexistente → 404', async () => {
    const { status } = await put(`/capacitaciones/tipos/${RANDOM_UUID}`, { nombre: 'x' }, rrhh.token);
    assertStatus(status, 404);
  });

  await scenario('DELETE /capacitaciones/tipos/:id inexistente → 404', async () => {
    const { status } = await del(`/capacitaciones/tipos/${RANDOM_UUID}`, rrhh.token);
    assertStatus(status, 404);
  });

  await scenario('GET /capacitaciones/tipos (COORDINADOR) → 200 incluye mi tipo', async () => {
    const { status, body } = await get('/capacitaciones/tipos', coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'not array');
    assert(body.some((t: any) => t.id === tipoId), 'created tipo missing from list');
  });

  await scenario('GET /capacitaciones/tipos as OPERADOR → 403', async () => {
    const { status } = await get('/capacitaciones/tipos', op1.token);
    assertStatus(status, 403);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. COORDINADOR creates sesión + edits it
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('POST /sesiones-capacitacion (COORDINADOR) → 201', async () => {
    const { status, body } = await post('/sesiones-capacitacion', {
      tipoId, titulo: `QA-${KEY}-MS-${TS}`, descripcion: 'Sesión principal QA',
      fecha: '2099-03-15', horaInicio: '09:00', horaFin: '13:00', lugar: 'Sala QA', vacantes: 3,
    }, coord.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(typeof body.id === 'string', 'no id');
    assert(body.estado === 'ABIERTA', `estado inicial = ${body.estado}, esperado ABIERTA`);
    assert(body.organizadorId === coord.user.id, 'organizadorId mismatch');
    msId = body.id;
    createdSesionIds.push(msId);
  });

  await scenario('POST /sesiones-capacitacion invalid (vacantes 0) → 400', async () => {
    const { status } = await post('/sesiones-capacitacion', {
      tipoId, titulo: 'x', fecha: '2099-03-15', vacantes: 0,
    }, coord.token);
    assertStatus(status, 400);
  });

  await scenario('POST /sesiones-capacitacion as OPERADOR → 403', async () => {
    const { status } = await post('/sesiones-capacitacion', {
      tipoId, titulo: 'x', fecha: '2099-03-15', vacantes: 2,
    }, op1.token);
    assertStatus(status, 403);
  });

  if (supervisor) {
    await scenario('POST /sesiones-capacitacion as SUPERVISOR (nivel 60 < 70) → 403', async () => {
      const { status } = await post('/sesiones-capacitacion', {
        tipoId, titulo: 'x', fecha: '2099-03-15', vacantes: 2,
      }, supervisor!.token);
      assertStatus(status, 403);
    });
  }

  await scenario('PUT /sesiones-capacitacion/:id (COORDINADOR) → 200', async () => {
    const { status, body } = await put(`/sesiones-capacitacion/${msId}`, { lugar: 'Sala QA Editada', vacantes: 3 }, coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.lugar === 'Sala QA Editada', 'lugar not updated');
  });

  await scenario('PUT /sesiones-capacitacion/:id inexistente → 404', async () => {
    const { status } = await put(`/sesiones-capacitacion/${RANDOM_UUID}`, { lugar: 'x' }, coord.token);
    assertStatus(status, 404);
  });

  await scenario('GET /sesiones-capacitacion (COORDINADOR) → 200 incluye MS con stats', async () => {
    const { status, body } = await get('/sesiones-capacitacion', coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    const ms = (body as any[]).find(s => s.id === msId);
    assert(!!ms, 'MS not in list');
    assert(ms.stats && typeof ms.stats.total === 'number', 'stats missing');
  });

  await scenario('GET /sesiones-capacitacion as OPERADOR → 403', async () => {
    const { status } = await get('/sesiones-capacitacion', op1.token);
    assertStatus(status, 403);
  });

  await scenario('GET /sesiones-capacitacion/subordinados (COORDINADOR) incluye mis operadores', async () => {
    const { status, body } = await get('/sesiones-capacitacion/subordinados', coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    const ids = (body as any[]).map(u => u.id);
    for (const uid of createdUserIds) assert(ids.includes(uid), `operador ${uid} no es subordinado visible`);
  });

  await scenario('GET /sesiones-capacitacion/subordinados as OPERADOR → 403', async () => {
    const { status } = await get('/sesiones-capacitacion/subordinados', op1.token);
    assertStatus(status, 403);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Invite operadores (+ notif delivery)
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('POST /:id/invitar usuarioIds vacío → 400', async () => {
    const { status } = await post(`/sesiones-capacitacion/${msId}/invitar`, { usuarioIds: [] }, coord.token);
    assertStatus(status, 400);
  });

  await scenario('POST /:id/invitar beyond cupo (4 > vacantes 3) → 400 (no contamina MS)', async () => {
    // cupo check runs before subordinate validation/creation, so any 4 ids trigger 400
    const { status, body } = await post(`/sesiones-capacitacion/${msId}/invitar`, {
      usuarioIds: [...createdUserIds, RANDOM_UUID],
    }, coord.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  if (outsiderId) {
    await scenario('POST /:id/invitar a NO-subordinado → 403 (sesión dedicada)', async () => {
      // dedicated session so a successful/failed invite never pollutes MS
      const sx = await post('/sesiones-capacitacion', { tipoId, titulo: `QA-${KEY}-X-${TS}`, fecha: '2099-08-10', vacantes: 3 }, coord.token);
      assertStatus(sx.status, 201, JSON.stringify(sx.body));
      createdSesionIds.push(sx.body.id);
      const { status, body } = await post(`/sesiones-capacitacion/${sx.body.id}/invitar`, { usuarioIds: [outsiderId] }, coord.token);
      assertStatus(status, 403, JSON.stringify(body));
    });
  } else {
    log(c('YELLOW', '⚠'), 'Sin outsider disponible — se omite test de invitación no-subordinado');
  }

  await scenario('POST /:id/invitar inexistente → 404', async () => {
    const { status } = await post(`/sesiones-capacitacion/${RANDOM_UUID}/invitar`, { usuarioIds: [createdUserIds[0]] }, coord.token);
    assertStatus(status, 404);
  });

  // capture pre-invite notif counts for each operador (clean inboxes)
  const preCounts = await Promise.all(operadores.map(o => notifCount(o.token)));

  await scenario('POST /:id/invitar 3 operadores → 201 + notif a cada uno', async () => {
    const { status, body } = await post(`/sesiones-capacitacion/${msId}/invitar`, { usuarioIds: createdUserIds }, coord.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(Array.isArray(body) && body.length === 3, `esperaba 3 invitaciones, got ${Array.isArray(body) ? body.length : 'n/a'}`);
    for (const inv of body) { invIds[inv.usuarioId] = inv.id; createdInvIdsForCleanup.push(inv.id); }
    // notif delivery per operador
    for (let i = 0; i < operadores.length; i++) {
      const o = operadores[i];
      const after = await notifCount(o.token);
      assert(after >= preCounts[i] + 1, `op${i + 1} count no aumentó (${preCounts[i]} -> ${after})`);
      const top = await notifTop(o.token);
      const match = top.find(n => n.tipo === 'CAPACITACION' && typeof n.cuerpo === 'string' && n.cuerpo.includes(`QA-${KEY}-MS-${TS}`));
      assert(!!match, `op${i + 1} no recibió notif de invitación`);
      assert(match.titulo.includes('Invitación a capacitación'), `op${i + 1} titulo notif inesperado: ${match.titulo}`);
    }
  });

  await scenario('GET /mis-invitaciones (cada operador) muestra la invitación', async () => {
    for (let i = 0; i < operadores.length; i++) {
      const o = operadores[i];
      const { status, body } = await get('/sesiones-capacitacion/mis-invitaciones', o.token);
      assertStatus(status, 200, JSON.stringify(body));
      const inv = (body as any[]).find(x => x.sesionId === msId);
      assert(!!inv, `op${i + 1} no ve su invitación`);
      assert(inv.estado === 'PENDIENTE', `op${i + 1} estado inicial = ${inv.estado}`);
      assert(inv.sesion && inv.sesion.titulo === `QA-${KEY}-MS-${TS}`, `op${i + 1} sesion.titulo faltante`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Accept / Reject + organizer notifications
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('responder ACEPTAR (op1) → 200 ACEPTADA + notif al organizador', async () => {
    const preCoord = await notifCount(coord.token);
    const { status, body } = await post(`/sesiones-capacitacion/mis-invitaciones/${invIds[op1.user.id]}/responder`, { aceptar: true }, op1.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'ACEPTADA', `estado = ${body.estado}`);
    assert(body.respondidoAt, 'respondidoAt no seteado');
    const afterCoord = await notifCount(coord.token);
    assert(afterCoord >= preCoord + 1, `notif organizador no aumentó (${preCoord} -> ${afterCoord})`);
    const top = await notifTop(coord.token);
    const match = top.find(n => typeof n.titulo === 'string' && n.titulo.includes('Invitación aceptada') && typeof n.cuerpo === 'string' && n.cuerpo.includes(`QA-${KEY}-MS-${TS}`));
    assert(!!match, 'organizador no recibió notif de aceptación');
  });

  await scenario('responder RECHAZAR (op2, con motivo) → 200 RECHAZADA + notif al organizador', async () => {
    const preCoord = await notifCount(coord.token);
    const motivo = `No disponible QA-${TS}`;
    const { status, body } = await post(`/sesiones-capacitacion/mis-invitaciones/${invIds[op2.user.id]}/responder`, { aceptar: false, motivoRechazo: motivo }, op2.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'RECHAZADA', `estado = ${body.estado}`);
    assert(body.motivoRechazo === motivo, `motivoRechazo = ${body.motivoRechazo}`);
    const afterCoord = await notifCount(coord.token);
    assert(afterCoord >= preCoord + 1, `notif organizador no aumentó (${preCoord} -> ${afterCoord})`);
    const top = await notifTop(coord.token);
    const match = top.find(n => typeof n.titulo === 'string' && n.titulo.includes('Invitación rechazada') && typeof n.cuerpo === 'string' && n.cuerpo.includes(motivo));
    assert(!!match, 'organizador no recibió notif de rechazo con motivo');
  });

  await scenario('responder DOBLE (op1 de nuevo) → 400 "ya respondiste"', async () => {
    const { status, body } = await post(`/sesiones-capacitacion/mis-invitaciones/${invIds[op1.user.id]}/responder`, { aceptar: true }, op1.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  await scenario('responder invitación AJENA (op2 responde la de op1) → 404', async () => {
    const { status } = await post(`/sesiones-capacitacion/mis-invitaciones/${invIds[op1.user.id]}/responder`, { aceptar: true }, op2.token);
    assertStatus(status, 404);
  });

  await scenario('responder con aceptar no-boolean → 400', async () => {
    const { status } = await post(`/sesiones-capacitacion/mis-invitaciones/${invIds[op3.user.id]}/responder`, { aceptar: 'yes' }, op3.token);
    assertStatus(status, 400);
  });

  await scenario('responder invitación inexistente → 404', async () => {
    const { status } = await post(`/sesiones-capacitacion/mis-invitaciones/${RANDOM_UUID}/responder`, { aceptar: true }, op3.token);
    assertStatus(status, 404);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Remove invitation (op3, still PENDIENTE)
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('DELETE /:id/invitaciones/:invId (op3) → 200 y desaparece de mis-invitaciones', async () => {
    const { status, body } = await del(`/sesiones-capacitacion/${msId}/invitaciones/${invIds[op3.user.id]}`, coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.ok === true, 'delete inv not ok');
    const { body: invs } = await get('/sesiones-capacitacion/mis-invitaciones', op3.token);
    assert(!(invs as any[]).some(x => x.id === invIds[op3.user.id]), 'invitación op3 sigue presente tras borrarla');
    // remove from cleanup list (already deleted)
    const idx = createdInvIdsForCleanup.indexOf(invIds[op3.user.id]);
    if (idx >= 0) createdInvIdsForCleanup.splice(idx, 1);
  });

  await scenario('DELETE /:id/invitaciones/:invId inexistente → 404', async () => {
    const { status } = await del(`/sesiones-capacitacion/${msId}/invitaciones/${RANDOM_UUID}`, coord.token);
    assertStatus(status, 404);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Finalizar (attendance → EmpleadoCapacitacion + notif)
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('POST /:id/finalizar → 200, registra asistencia de op1 + notif', async () => {
    const preOp1 = await notifCount(op1.token);
    const { status, body } = await post(`/sesiones-capacitacion/${msId}/finalizar`, { asistieron: [op1.user.id] }, coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.ok === true && body.asistieron === 1, `finalizar resp inesperada: ${JSON.stringify(body)}`);
    // attendee notif
    const afterOp1 = await notifCount(op1.token);
    assert(afterOp1 >= preOp1 + 1, `op1 notif completado no aumentó (${preOp1} -> ${afterOp1})`);
    const top = await notifTop(op1.token);
    assert(top.some(n => typeof n.titulo === 'string' && n.titulo.includes('Capacitación completada') && n.cuerpo.includes(`QA-${KEY}-MS-${TS}`)), 'op1 no recibió notif de capacitación completada');
    // EmpleadoCapacitacion created for op1 (vigenciaDias=365 -> vencimiento set)
    const { body: misCap } = await get('/capacitaciones/mis-capacitaciones', op1.token);
    const rec = (misCap as any[]).find(r => r.tipoId === tipoId && typeof r.observaciones === 'string' && r.observaciones.includes(`QA-${KEY}-MS-${TS}`));
    assert(!!rec, 'op1 no tiene EmpleadoCapacitacion tras finalizar');
    assert(!!rec.fechaVencimiento, 'fechaVencimiento no calculada desde vigenciaDias');
    // sesión marcada FINALIZADA
    const { body: list } = await get('/sesiones-capacitacion', coord.token);
    const ms = (list as any[]).find(s => s.id === msId);
    assert(ms && ms.estado === 'FINALIZADA', `sesión estado = ${ms?.estado}, esperado FINALIZADA`);
  });

  await scenario('POST /:id/finalizar de nuevo → 400 "ya finalizada"', async () => {
    const { status } = await post(`/sesiones-capacitacion/${msId}/finalizar`, {}, coord.token);
    assertStatus(status, 400);
  });

  await scenario('POST /:id/finalizar inexistente → 404', async () => {
    const { status } = await post(`/sesiones-capacitacion/${RANDOM_UUID}/finalizar`, {}, coord.token);
    assertStatus(status, 404);
  });

  await scenario('POST /:id/finalizar as OPERADOR → 403', async () => {
    const { status } = await post(`/sesiones-capacitacion/${msId}/finalizar`, {}, op1.token);
    assertStatus(status, 403);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. COMPLETA transition (accept fills vacantes)
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('Sesión vacantes=1: aceptar la única invitación → estado COMPLETA', async () => {
    const cs = await post('/sesiones-capacitacion', { tipoId, titulo: `QA-${KEY}-CS-${TS}`, fecha: '2099-04-10', vacantes: 1 }, coord.token);
    assertStatus(cs.status, 201, JSON.stringify(cs.body));
    const csId = cs.body.id; createdSesionIds.push(csId);
    const inv = await post(`/sesiones-capacitacion/${csId}/invitar`, { usuarioIds: [op2.user.id] }, coord.token);
    assertStatus(inv.status, 201, JSON.stringify(inv.body));
    const invId = inv.body[0].id; createdInvIdsForCleanup.push(invId);
    const resp = await post(`/sesiones-capacitacion/mis-invitaciones/${invId}/responder`, { aceptar: true }, op2.token);
    assertStatus(resp.status, 200, JSON.stringify(resp.body));
    const { body: list } = await get('/sesiones-capacitacion', coord.token);
    const csFound = (list as any[]).find(s => s.id === csId);
    assert(csFound && csFound.estado === 'COMPLETA', `estado tras llenar vacantes = ${csFound?.estado}, esperado COMPLETA`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. STATE-MACHINE PROBE — responder a sesión CANCELADA / FINALIZADA
  // ═══════════════════════════════════════════════════════════════════════
  await scenario('PROBE: responder invitación de sesión CANCELADA', async () => {
    const cancel = await post('/sesiones-capacitacion', { tipoId, titulo: `QA-${KEY}-CANCEL-${TS}`, fecha: '2099-05-10', vacantes: 5 }, coord.token);
    assertStatus(cancel.status, 201, JSON.stringify(cancel.body));
    const cId = cancel.body.id; createdSesionIds.push(cId);
    const inv = await post(`/sesiones-capacitacion/${cId}/invitar`, { usuarioIds: [op3.user.id] }, coord.token);
    assertStatus(inv.status, 201, JSON.stringify(inv.body));
    const invId = inv.body[0].id; createdInvIdsForCleanup.push(invId);
    // cancel session
    const dc = await del(`/sesiones-capacitacion/${cId}`, coord.token);
    assertStatus(dc.status, 200, JSON.stringify(dc.body));
    // invitar a sesión cancelada → debe 400
    const reinv = await post(`/sesiones-capacitacion/${cId}/invitar`, { usuarioIds: [op2.user.id] }, coord.token);
    assertStatus(reinv.status, 400, `invitar a sesión cancelada debería 400, got ${reinv.status}`);
    // operador responde aceptar a sesión cancelada
    const resp = await post(`/sesiones-capacitacion/mis-invitaciones/${invId}/responder`, { aceptar: true }, op3.token);
    log('ℹ', `responder(aceptar) sesión CANCELADA → HTTP ${resp.status} estado=${resp.body?.estado}`);
    if (resp.status === 200 && resp.body?.estado === 'ACEPTADA') {
      flagBug(`responder acepta invitación de sesión CANCELADA (HTTP 200, estado ACEPTADA). El endpoint responder no valida sesion.estado.`);
    } else {
      // current behavior is acceptable (blocked); assert it's a clean 4xx
      assert(resp.status >= 400 && resp.status < 500, `esperaba bloqueo 4xx, got ${resp.status}`);
    }
  });

  await scenario('PROBE: responder invitación de sesión FINALIZADA', async () => {
    const fs = await post('/sesiones-capacitacion', { tipoId, titulo: `QA-${KEY}-FINAL-${TS}`, fecha: '2099-06-10', vacantes: 5 }, coord.token);
    assertStatus(fs.status, 201, JSON.stringify(fs.body));
    const fId = fs.body.id; createdSesionIds.push(fId);
    // invite op1 (will accept) and op3 (stays pending)
    const inv = await post(`/sesiones-capacitacion/${fId}/invitar`, { usuarioIds: [op1.user.id, op3.user.id] }, coord.token);
    assertStatus(inv.status, 201, JSON.stringify(inv.body));
    const byUser: Record<string, string> = {};
    for (const i of inv.body) { byUser[i.usuarioId] = i.id; createdInvIdsForCleanup.push(i.id); }
    const acc = await post(`/sesiones-capacitacion/mis-invitaciones/${byUser[op1.user.id]}/responder`, { aceptar: true }, op1.token);
    assertStatus(acc.status, 200, JSON.stringify(acc.body));
    const fin = await post(`/sesiones-capacitacion/${fId}/finalizar`, { asistieron: [op1.user.id] }, coord.token);
    assertStatus(fin.status, 200, JSON.stringify(fin.body));
    // op3 (pending) responds to a FINALIZADA session
    const resp = await post(`/sesiones-capacitacion/mis-invitaciones/${byUser[op3.user.id]}/responder`, { aceptar: true }, op3.token);
    log('ℹ', `responder(aceptar) sesión FINALIZADA → HTTP ${resp.status} estado=${resp.body?.estado}`);
    if (resp.status === 200 && resp.body?.estado === 'ACEPTADA') {
      flagBug(`responder acepta invitación de sesión FINALIZADA (HTTP 200, estado ACEPTADA) tras cerrar la sesión.`);
    } else {
      assert(resp.status >= 400 && resp.status < 500, `esperaba bloqueo 4xx, got ${resp.status}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. AUTHZ PROBE — coordinador de OTRO sector muta sesión ajena
  // ═══════════════════════════════════════════════════════════════════════
  if (coord2) {
    await scenario('PROBE: coordinador de otro sector edita/borra sesión ajena', async () => {
      const s = await post('/sesiones-capacitacion', { tipoId, titulo: `QA-${KEY}-OWN-${TS}`, fecha: '2099-07-10', vacantes: 3 }, coord.token);
      assertStatus(s.status, 201, JSON.stringify(s.body));
      const sId = s.body.id; createdSesionIds.push(sId);
      const inv = await post(`/sesiones-capacitacion/${sId}/invitar`, { usuarioIds: [op1.user.id] }, coord.token);
      assertStatus(inv.status, 201, JSON.stringify(inv.body));
      const invId = inv.body[0].id; createdInvIdsForCleanup.push(invId);
      // coord2 (diff sector, not organizer, not RRHH) tries to mutate
      const putR = await put(`/sesiones-capacitacion/${sId}`, { lugar: 'HIJACK' }, coord2!.token);
      const delInvR = await del(`/sesiones-capacitacion/${sId}/invitaciones/${invId}`, coord2!.token);
      log('ℹ', `coord2 PUT sesión ajena → ${putR.status}; DELETE invitación ajena → ${delInvR.status}`);
      if (putR.status === 200) {
        flagBug(`Un COORDINADOR de otro sector (no organizador) puede EDITAR (PUT /:id) una sesión ajena (HTTP 200). PUT no valida organizador/empresa/sector.`);
      }
      if (delInvR.status === 200) {
        flagBug(`Un COORDINADOR de otro sector puede BORRAR invitaciones (DELETE /:id/invitaciones/:invId) de una sesión ajena (HTTP 200). No valida ownership.`);
        const idx = createdInvIdsForCleanup.indexOf(invId);
        if (idx >= 0) createdInvIdsForCleanup.splice(idx, 1);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Registros CRUD (RRHH) + resumen
  // ═══════════════════════════════════════════════════════════════════════
  let registroId = '';
  await scenario('POST /capacitaciones/registros (RRHH) → 201 (vencimiento auto)', async () => {
    const { status, body } = await post('/capacitaciones/registros', {
      usuarioId: op2.user.id, tipoId, fechaRealizacion: '2099-01-10', institucion: 'Inst QA', observaciones: `manual QA-${TS}`,
    }, rrhh.token);
    assertStatus(status, 201, JSON.stringify(body));
    registroId = body.id;
    assert(!!body.fechaVencimiento, 'fechaVencimiento no autocalculada (tipo tiene vigenciaDias)');
    cleanup.push(async () => { await del(`/capacitaciones/registros/${registroId}`, rrhh.token); });
  });

  await scenario('POST /capacitaciones/registros invalid (sin usuarioId) → 400', async () => {
    const { status } = await post('/capacitaciones/registros', { tipoId, fechaRealizacion: '2099-01-10' }, rrhh.token);
    assertStatus(status, 400);
  });

  await scenario('POST /capacitaciones/registros as OPERADOR → 403', async () => {
    const { status } = await post('/capacitaciones/registros', { usuarioId: op2.user.id, tipoId, fechaRealizacion: '2099-01-10' }, op1.token);
    assertStatus(status, 403);
  });

  await scenario('GET /capacitaciones/registros (RRHH) incluye mi registro', async () => {
    const { status, body } = await get(`/capacitaciones/registros?tipoId=${tipoId}`, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as any[]).some(r => r.id === registroId), 'registro creado no aparece');
    const r = (body as any[]).find(r => r.id === registroId);
    assert(typeof r.statusCap === 'string', 'statusCap faltante');
  });

  await scenario('GET /capacitaciones/registros as OPERADOR → 403', async () => {
    const { status } = await get('/capacitaciones/registros', op1.token);
    assertStatus(status, 403);
  });

  await scenario('PUT /capacitaciones/registros/:id (RRHH) → 200', async () => {
    const { status, body } = await put(`/capacitaciones/registros/${registroId}`, { observaciones: `editado QA-${TS}` }, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.observaciones === `editado QA-${TS}`, 'observaciones no actualizada');
  });

  await scenario('PUT /capacitaciones/registros/:id inexistente → 404', async () => {
    const { status } = await put(`/capacitaciones/registros/${RANDOM_UUID}`, { observaciones: 'x' }, rrhh.token);
    assertStatus(status, 404);
  });

  await scenario('GET /capacitaciones/resumen (RRHH) → shape', async () => {
    const { status, body } = await get('/capacitaciones/resumen', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    for (const k of ['total', 'vigentes', 'vencidas', 'proximas']) assert(typeof body[k] === 'number', `resumen.${k} faltante`);
  });

  await scenario('GET /capacitaciones/resumen (COORDINADOR) → 200', async () => {
    const { status, body } = await get('/capacitaciones/resumen', coord.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(typeof body.total === 'number', 'total faltante');
  });

  await scenario('GET /capacitaciones/resumen as OPERADOR → 403', async () => {
    const { status } = await get('/capacitaciones/resumen', op1.token);
    assertStatus(status, 403);
  });

  await scenario('DELETE /capacitaciones/registros/:id (RRHH) → 200 luego 404', async () => {
    const d1 = await del(`/capacitaciones/registros/${registroId}`, rrhh.token);
    assertStatus(d1.status, 200, JSON.stringify(d1.body));
    const d2 = await del(`/capacitaciones/registros/${registroId}`, rrhh.token);
    assertStatus(d2.status, 404);
  });

  await scenario('DELETE /capacitaciones/registros as OPERADOR → 403', async () => {
    const { status } = await del(`/capacitaciones/registros/${RANDOM_UUID}`, op1.token);
    assertStatus(status, 403);
  });

  await scenario('GET /mis-capacitaciones (op2) → array', async () => {
    const { status, body } = await get('/capacitaciones/mis-capacitaciones', op2.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body), 'no es array');
  });

  // ── Cleanup ──
  console.log(c('CYAN', '\n── Cleanup ──'));
  // delete leftover invitations (best-effort) — need their session ids; iterate sessions
  for (const invId of createdInvIdsForCleanup) {
    // sessionId unknown per inv here; try via each created session
    for (const sId of createdSesionIds) {
      try { await del(`/sesiones-capacitacion/${sId}/invitaciones/${invId}`, coord.token); } catch { /* ignore */ }
    }
  }
  // delete EmpleadoCapacitacion rows created by finalizar (find by tipoId)
  try {
    const { body } = await get(`/capacitaciones/registros?tipoId=${tipoId}`, rrhh.token);
    for (const r of (body as any[]) ?? []) {
      if (createdUserIds.includes(r.usuarioId)) {
        try { await del(`/capacitaciones/registros/${r.id}`, rrhh.token); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  // cancel created sessions
  for (const sId of createdSesionIds) {
    try { await del(`/sesiones-capacitacion/${sId}`, coord.token); } catch { /* ignore */ }
  }
  // remaining cleanup callbacks (tipos, users)
  for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* ignore */ } }
  log('ℹ', 'cleanup done (best-effort)');

  // ── Summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(c('CYAN', `\n═══ RESULT: ${passed}/${results.length} passed, ${failed} failed, ${bugs.length} bug(s) flagged ═══`));
  if (failed > 0) {
    console.log(c('RED', 'FAILURES:'));
    results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
  }
  if (bugs.length) {
    console.log(c('MAGENTA', 'BUGS:'));
    bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  }
  console.log(`\n__SUMMARY__ ${JSON.stringify({ total: results.length, passed, failed, bugs: bugs.length })}`);
}

main().catch(e => { console.error(c('RED', `FATAL: ${e?.stack || e}`)); process.exit(1); });
