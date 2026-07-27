/**
 * QA Suite — VACACIONES subsystem (KEY=vacaciones)
 * Black-box HTTP tests against the live API.
 * Run: cd apps/api && npx tsx tests/qa/vacaciones.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'vacaciones';
const TS = Date.now();
const YEAR = new Date().getFullYear();

// ── output ──────────────────────────────────────────────────────────────
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
function log(sym: string, msg: string) { process.stdout.write(`  ${sym} ${msg}\n`); }
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, passed: true, detail: 'OK' }); log('PASS', name); }
  catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail }); log('FAIL', `${name} — ${detail}`);
  }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────
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

interface Session { token: string; user: any; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

function isoDate(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d)).toISOString(); }
// calendar-day span inclusive, matching server: ceil((fin-inicio)/day)+1
function span(inicioISO: string, finISO: string) {
  return Math.ceil((new Date(finISO).getTime() - new Date(inicioISO).getTime()) / 86400000) + 1;
}

// saldo helper: GET /vacaciones/saldo for a user
async function getSaldo(tok: string): Promise<{ disponible: number; usados: number; pendiente: number; total: number }> {
  const { status, body } = await get('/vacaciones/saldo', tok);
  assertStatus(status, 200, `getSaldo: ${JSON.stringify(body)}`);
  return body;
}

const cleanup: Array<() => Promise<void>> = [];

async function main() {
  console.log(`\n=== QA VACACIONES (ts=${TS}, year=${YEAR}) ===\n`);

  const admin = await login('admin@wenlen.com');
  const empresaId = admin.user.empresaId;

  // ── Setup: dedicated sector + users + flujo ──────────────────────────
  let sectorId = '';
  let sup1: Session, sup2: Session, owner: Session, op2: Session;
  let sup1Id = '', sup2Id = '', ownerId = '', op2Id = '';
  let flujoId = '', asignacionId = '';

  await scenario('SETUP create sector/users/flujo', async () => {
    const sec = await post('/admin/sectores', { nombre: `qa-${KEY}-${TS}`, descripcion: 'QA temp' }, admin.token);
    assertStatus(sec.status, 201, JSON.stringify(sec.body));
    sectorId = sec.body.id;

    const mkUser = async (suffix: string, rol: string, extra: Record<string, unknown> = {}) => {
      const r = await post('/usuarios', {
        nombre: `QA${suffix}`, apellido: `${KEY}${TS}`,
        email: `qa.${KEY}.${TS}.${suffix}@demo.com`,
        password: 'Test1234!', rol, sectorId,
        fechaIngreso: isoDate(2020, 1, 15), ...extra,
      }, admin.token);
      assertStatus(r.status, 201, `create ${suffix}: ${JSON.stringify(r.body)}`);
      return r.body.id as string;
    };

    sup1Id = await mkUser('sup1', 'SUPERVISOR');
    sup2Id = await mkUser('sup2', 'SUPERVISOR');
    ownerId = await mkUser('owner', 'OPERADOR', { supervisorId: sup1Id });
    op2Id = await mkUser('op2', 'OPERADOR');

    // VACACION flujo: single SUPERVISOR step
    const fl = await post('/admin/flujos', {
      nombre: `qa-${KEY}-flujo-${TS}`, tipoDocumento: 'VACACION',
      pasos: [{ orden: 1, nombrePaso: 'Supervisor', rolAprobador: 'SUPERVISOR' }],
    }, admin.token);
    assertStatus(fl.status, 201, JSON.stringify(fl.body));
    flujoId = fl.body.id;

    // assign narrowly to the owner only
    const asg = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'VACACION', usuarioId: ownerId,
    }, admin.token);
    assertStatus(asg.status, 201, JSON.stringify(asg.body));
    asignacionId = asg.body.id;

    sup1 = await login(`qa.${KEY}.${TS}.sup1@demo.com`);
    sup2 = await login(`qa.${KEY}.${TS}.sup2@demo.com`);
    owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
    op2 = await login(`qa.${KEY}.${TS}.op2@demo.com`);
    assert(sup1.user.rolNivel >= 60, `sup1 nivel=${sup1.user.rolNivel} (expected >=60)`);
    assert(owner.user.rolNivel < 60, `owner nivel=${owner.user.rolNivel} (expected operador)`);

    // cleanup registrations
    cleanup.push(async () => { await del(`/admin/flujos/asignaciones/${asignacionId}`, admin.token); });
    cleanup.push(async () => { await del(`/admin/flujos/${flujoId}`, admin.token); });
    cleanup.push(async () => { for (const id of [sup1Id, sup2Id, ownerId, op2Id]) await del(`/usuarios/${id}`, admin.token); });
    cleanup.push(async () => { await del(`/admin/sectores/${sectorId}`, admin.token); });
  });

  if (!owner!) { console.log('Setup failed — aborting'); return; }

  // ── Seed saldo via admin to a known value (60 days) ──────────────────
  let saldoId = '';
  await scenario('SETUP seed saldo=60 via admin PUT', async () => {
    // auto-create the saldo as the user
    const s0 = await getSaldo(owner.token);
    assert(typeof s0.disponible === 'number', 'saldo shape');
    // list as admin to get the id
    const lst = await get(`/vacacion-saldos?anio=${YEAR}`, admin.token);
    assertStatus(lst.status, 200, JSON.stringify(lst.body));
    const mine = (lst.body as any[]).find(x => x.usuario?.id === ownerId);
    assert(!!mine, 'owner saldo not found in admin list');
    saldoId = mine.id;
    const upd = await put(`/vacacion-saldos/${saldoId}`, { diasCorrespondientes: 60, diasAjuste: 0 }, admin.token);
    assertStatus(upd.status, 200, JSON.stringify(upd.body));
    const s1 = await getSaldo(owner.token);
    assert(s1.total === 60, `total expected 60, got ${s1.total}`);
    assert(s1.disponible === 60 && s1.pendiente === 0 && s1.usados === 0, `fresh saldo ${JSON.stringify(s1)}`);
  });

  // ── Saldo endpoint permissions ───────────────────────────────────────
  await scenario('GET /vacacion-saldos as OPERADOR -> 403', async () => {
    const r = await get(`/vacacion-saldos?anio=${YEAR}`, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('PUT /vacacion-saldos/:id as OPERADOR -> 403', async () => {
    const r = await put(`/vacacion-saldos/${saldoId}`, { diasAjuste: 5 }, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('GET /vacacion-saldos/mi-saldo as owner -> 200', async () => {
    const r = await get('/vacacion-saldos/mi-saldo', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.diasCorrespondientes === 60, `mi-saldo dc=${r.body.diasCorrespondientes}`);
  });
  await scenario('POST /vacacion-saldos/generar as OPERADOR -> 403', async () => {
    const r = await post('/vacacion-saldos/generar', { anio: YEAR }, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('POST /vacacion-saldos/generar missing anio -> 400', async () => {
    const r = await post('/vacacion-saldos/generar', {}, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('POST /vacacion-saldos/generar {anio} as admin -> 200 (fills gaps, skips existing)', async () => {
    const r = await post('/vacacion-saldos/generar', { anio: YEAR }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(typeof r.body.created === 'number' && typeof r.body.skipped === 'number' && typeof r.body.total === 'number', `shape ${JSON.stringify(r.body)}`);
    // owner already had a saldo for YEAR -> must be skipped, not recreated/reset
    const mi = await get('/vacacion-saldos/mi-saldo', owner.token);
    assert(mi.body.diasCorrespondientes === 60, `owner saldo reset by generar: dc=${mi.body.diasCorrespondientes}`);
  });

  // ── CREATE validation ────────────────────────────────────────────────
  await scenario('POST /vacaciones missing diasHabiles -> 400', async () => {
    const r = await post('/vacaciones', { fechaInicio: isoDate(2035, 3, 1), fechaFin: isoDate(2035, 3, 5) }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('POST /vacaciones diasHabiles=0 -> 400', async () => {
    const r = await post('/vacaciones', { fechaInicio: isoDate(2035, 3, 1), fechaFin: isoDate(2035, 3, 5), diasHabiles: 0 }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  // ── Happy path: create A, reserve, approve ───────────────────────────
  let vacA = '';
  const aInicio = isoDate(2035, 3, 1), aFin = isoDate(2035, 3, 5);
  const aDias = span(aInicio, aFin); // 5
  await scenario('POST /vacaciones A reserves pendientes', async () => {
    const before = await getSaldo(owner.token);
    const r = await post('/vacaciones', { fechaInicio: aInicio, fechaFin: aFin, diasHabiles: 4, motivo: `qa-${TS}-A` }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    vacA = r.body.id;
    assert(r.body.estado === 'PENDIENTE', `estado=${r.body.estado}`);
    assert(r.body.diasTotales === aDias, `diasTotales=${r.body.diasTotales} expected ${aDias}`);
    assert(r.body.flujoId === flujoId, `flujoId not assigned: ${r.body.flujoId}`);
    const after = await getSaldo(owner.token);
    assert(after.pendiente === before.pendiente + aDias, `pendiente ${before.pendiente}->${after.pendiente}, expected +${aDias}`);
    assert(after.disponible === before.disponible - aDias, `disponible not reduced by ${aDias}`);
  });

  await scenario('POST /vacaciones/:id/avanzar by NON-supervisor operator -> 403', async () => {
    const r = await post(`/vacaciones/${vacA}/avanzar`, {}, op2.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('POST /vacaciones/:id/avanzar by WRONG supervisor (not owner.supervisor) -> 403', async () => {
    const r = await post(`/vacaciones/${vacA}/avanzar`, {}, sup2.token);
    assertStatus(r.status, 403, `expected 403 for non-responsible approver: ${JSON.stringify(r.body)}`);
  });

  await scenario('POST /vacaciones/:id/avanzar by authorized supervisor -> APROBADA, pendientes->usados + notif', async () => {
    const beforeSaldo = await getSaldo(owner.token);
    const beforeCount = (await get('/notificaciones/count', owner.token)).body.count;
    const r = await post(`/vacaciones/${vacA}/avanzar`, { comentario: 'ok' }, sup1.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.estado === 'APROBADA', `estado=${r.body.estado}`);
    assert(r.body.aprobadaPorId === sup1Id, `aprobadaPorId=${r.body.aprobadaPorId}`);
    const afterSaldo = await getSaldo(owner.token);
    assert(afterSaldo.usados === beforeSaldo.usados + aDias, `usados ${beforeSaldo.usados}->${afterSaldo.usados}, expected +${aDias}`);
    assert(afterSaldo.pendiente === beforeSaldo.pendiente - aDias, `pendiente ${beforeSaldo.pendiente}->${afterSaldo.pendiente}, expected -${aDias}`);
    // notification
    const afterCount = (await get('/notificaciones/count', owner.token)).body.count;
    assert(afterCount >= beforeCount + 1, `notif count ${beforeCount}->${afterCount} (expected +>=1)`);
    const notifs = (await get('/notificaciones', owner.token)).body as any[];
    const match = notifs.find(n => n.tipo === 'VACACION' && /aprobad/i.test(n.titulo));
    assert(!!match, `no APROBADA vacacion notif found; top=${JSON.stringify(notifs[0])}`);
    assert(notifs[0].tipo === 'VACACION' && /aprobad/i.test(notifs[0].titulo), `top notif not the approval: ${JSON.stringify(notifs[0])}`);
  });

  // state machine: re-avanzar an APROBADA -> 400
  await scenario('POST /vacaciones/:id/avanzar on APROBADA -> 400', async () => {
    const r = await post(`/vacaciones/${vacA}/avanzar`, {}, sup1.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  // ── Reject flow: create B, reject, restore ───────────────────────────
  let vacB = '';
  const bInicio = isoDate(2035, 4, 1), bFin = isoDate(2035, 4, 5);
  const bDias = span(bInicio, bFin);
  await scenario('POST /vacaciones B reserves pendientes', async () => {
    const r = await post('/vacaciones', { fechaInicio: bInicio, fechaFin: bFin, diasHabiles: 4, motivo: `qa-${TS}-B` }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    vacB = r.body.id;
    assert(r.body.estado === 'PENDIENTE', `estado=${r.body.estado}`);
  });

  await scenario('POST /vacaciones/:id/rechazar without motivo -> 400', async () => {
    const r = await post(`/vacaciones/${vacB}/rechazar`, {}, sup1.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('POST /vacaciones/:id/rechazar by WRONG supervisor -> 403', async () => {
    const r = await post(`/vacaciones/${vacB}/rechazar`, { motivo: 'x' }, sup2.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('POST /vacaciones/:id/rechazar by operator -> 403 (level guard)', async () => {
    const r = await post(`/vacaciones/${vacB}/rechazar`, { motivo: 'x' }, op2.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('POST /vacaciones/:id/rechazar -> RECHAZADA, pendientes restored + notif', async () => {
    const beforeSaldo = await getSaldo(owner.token);
    const beforeCount = (await get('/notificaciones/count', owner.token)).body.count;
    const r = await post(`/vacaciones/${vacB}/rechazar`, { motivo: `qa-rechazo-${TS}` }, sup1.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.estado === 'RECHAZADA', `estado=${r.body.estado}`);
    assert(r.body.obsRechazo === `qa-rechazo-${TS}`, `obsRechazo=${r.body.obsRechazo}`);
    const afterSaldo = await getSaldo(owner.token);
    assert(afterSaldo.pendiente === beforeSaldo.pendiente - bDias, `pendiente ${beforeSaldo.pendiente}->${afterSaldo.pendiente}, expected -${bDias}`);
    assert(afterSaldo.disponible === beforeSaldo.disponible + bDias, `disponible not restored`);
    const afterCount = (await get('/notificaciones/count', owner.token)).body.count;
    assert(afterCount >= beforeCount + 1, `notif count ${beforeCount}->${afterCount}`);
    const notifs = (await get('/notificaciones', owner.token)).body as any[];
    assert(notifs[0].tipo === 'VACACION' && /rechazad/i.test(notifs[0].titulo), `top notif not rejection: ${JSON.stringify(notifs[0])}`);
  });

  // ── Negative: insufficient balance ───────────────────────────────────
  await scenario('POST /vacaciones insufficient balance -> 400', async () => {
    const cur = await getSaldo(owner.token); // disponible ~55
    const inicio = isoDate(2035, 6, 1);
    const fin = isoDate(2035, 6, 1 + cur.disponible + 10); // way more than disponible
    const r = await post('/vacaciones', { fechaInicio: inicio, fechaFin: fin, diasHabiles: 5 }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
    assert(/saldo insuficiente/i.test(JSON.stringify(r.body)), `unexpected msg: ${JSON.stringify(r.body)}`);
    // ensure no reservation happened
    const after = await getSaldo(owner.token);
    assert(after.pendiente === cur.pendiente, `pendiente changed on rejected create: ${cur.pendiente}->${after.pendiente}`);
  });

  // ── Negative: fechaFin < fechaInicio (reversed range) ────────────────
  await scenario('POST /vacaciones fechaFin<fechaInicio (reversed) — expect 400 or detect corruption', async () => {
    const before = await getSaldo(owner.token);
    const inicio = isoDate(2035, 7, 10), fin = isoDate(2035, 7, 5); // reversed -> negative span
    const r = await post('/vacaciones', { fechaInicio: inicio, fechaFin: fin, diasHabiles: 1, motivo: `qa-${TS}-rev` }, owner.token);
    if (r.status === 400) {
      // correct behavior
      return;
    }
    // Bug path: server accepted a negative-duration request
    assertStatus(r.status, 201, `unexpected status: ${JSON.stringify(r.body)}`);
    const negId = r.body.id as string;
    const after = await getSaldo(owner.token);
    // Record evidence: diasTotales negative and pendientes corrupted (decremented instead of incremented)
    const corrupted = (r.body.diasTotales <= 0) || (after.pendiente < before.pendiente);
    // cleanup this bogus request regardless
    await del(`/vacaciones/${negId}`, owner.token);
    throw new Error(`BUG: reversed-range accepted 201 diasTotales=${r.body.diasTotales}; saldo pendiente ${before.pendiente}->${after.pendiente}, disponible ${before.disponible}->${after.disponible}; corrupted=${corrupted}`);
  });

  // ── Edge: request entirely in the past (no future-date guard) ────────
  await scenario('POST /vacaciones entirely in the past — behavior probe', async () => {
    const inicio = isoDate(2000, 1, 10), fin = isoDate(2000, 1, 12);
    const r = await post('/vacaciones', { fechaInicio: inicio, fechaFin: fin, diasHabiles: 2, motivo: `qa-${TS}-past` }, owner.token);
    // No validation in source -> expected 201 (not flagged as bug); clean up if created
    assert(r.status === 201 || r.status === 400, `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.status === 201) await del(`/vacaciones/${r.body.id}`, owner.token);
  });

  // ── GET /vacaciones list & filters ───────────────────────────────────
  await scenario('GET /vacaciones?scope=mio as owner returns own', async () => {
    const r = await get('/vacaciones?scope=mio', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    const arr = r.body as any[];
    assert(Array.isArray(arr), 'not array');
    assert(arr.every(v => v.usuarioId === ownerId), 'scope=mio leaked others');
    assert(arr.some(v => v.id === vacA), 'own approved request missing in list');
  });
  await scenario('GET /vacaciones as admin sees company-wide (finds owner request)', async () => {
    const r = await get('/vacaciones', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert((r.body as any[]).some(v => v.id === vacA), 'admin cannot see owner vac');
  });

  // ── GET /vacaciones/:id authz ────────────────────────────────────────
  await scenario('GET /vacaciones/:id as owner -> 200', async () => {
    const r = await get(`/vacaciones/${vacA}`, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.historial), 'no historial');
  });
  await scenario('GET /vacaciones/:id as unrelated OPERADOR -> 403', async () => {
    const r = await get(`/vacaciones/${vacA}`, op2.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('GET /vacaciones/:id as supervisor (>=60) -> 200', async () => {
    const r = await get(`/vacaciones/${vacA}`, sup1.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
  });
  await scenario('GET /vacaciones/:id non-existent -> 404', async () => {
    const r = await get(`/vacaciones/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // ── avanzar / rechazar not found ─────────────────────────────────────
  await scenario('POST /vacaciones/:id/avanzar non-existent -> 404', async () => {
    const r = await post(`/vacaciones/00000000-0000-0000-0000-000000000000/avanzar`, {}, sup1.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });
  await scenario('POST /vacaciones/:id/rechazar non-existent (with motivo) -> 404', async () => {
    const r = await post(`/vacaciones/00000000-0000-0000-0000-000000000000/rechazar`, { motivo: 'x' }, sup1.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // ── GET /vacaciones/gantt ────────────────────────────────────────────
  await scenario('GET /vacaciones/gantt as admin -> 200', async () => {
    const r = await get(`/vacaciones/gantt?anio=2035`, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.empleados) && Array.isArray(r.body.sectores), 'gantt shape');
  });
  // El gantt dejó de tener guard duro de nivel 70: ahora el alcance sale de la
  // cadena de aprobación, así que un supervisor entra pero ve solo lo suyo.
  await scenario('GET /vacaciones/gantt as SUPERVISOR -> 200 con alcance acotado', async () => {
    const r = await get(`/vacaciones/gantt`, sup1.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.empleados), 'gantt shape');
    const rrhhRes = await get(`/vacaciones/gantt`, admin.token);
    assert(r.body.empleados.length <= (rrhhRes.body.empleados?.length ?? 0),
      `el supervisor ve ${r.body.empleados.length} empleados y el admin ${rrhhRes.body.empleados?.length}`);
  });
  await scenario('GET /vacaciones/gantt as OPERADOR -> 403', async () => {
    const r = await get(`/vacaciones/gantt`, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ── DELETE flows ─────────────────────────────────────────────────────
  await scenario('DELETE own PENDIENTE returns reserved days (cancel)', async () => {
    const c = isoDate(2035, 9, 1), cf = isoDate(2035, 9, 3);
    const cr = await post('/vacaciones', { fechaInicio: c, fechaFin: cf, diasHabiles: 2, motivo: `qa-${TS}-C` }, owner.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const cDias = cr.body.diasTotales;
    const afterCreate = await getSaldo(owner.token);
    const r = await del(`/vacaciones/${cr.body.id}`, owner.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
    const afterDel = await getSaldo(owner.token);
    assert(afterDel.pendiente === afterCreate.pendiente - cDias, `pendiente not restored on delete: ${afterCreate.pendiente}->${afterDel.pendiente}`);
  });
  await scenario('DELETE own APROBADA -> 400', async () => {
    const r = await del(`/vacaciones/${vacA}`, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('DELETE others vacacion as unrelated operator -> 403', async () => {
    // create a pending one owned by owner, attempt delete by op2
    const c = isoDate(2035, 10, 1), cf = isoDate(2035, 10, 2);
    const cr = await post('/vacaciones', { fechaInicio: c, fechaFin: cf, diasHabiles: 1 }, owner.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const r = await del(`/vacaciones/${cr.body.id}`, op2.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
    // admin deletes it (PENDIENTE allowed)
    const ar = await del(`/vacaciones/${cr.body.id}`, admin.token);
    assertStatus(ar.status, 204, `admin delete pendiente: ${JSON.stringify(ar.body)}`);
  });
  await scenario('DELETE non-existent -> 404', async () => {
    const r = await del(`/vacaciones/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // ── /enviar state guard (only BORRADOR/RECHAZADA) ────────────────────
  await scenario('POST /vacaciones/:id/enviar on PENDIENTE -> 400', async () => {
    const c = isoDate(2035, 11, 1), cf = isoDate(2035, 11, 2);
    const cr = await post('/vacaciones', { fechaInicio: c, fechaFin: cf, diasHabiles: 1 }, owner.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const r = await post(`/vacaciones/${cr.body.id}/enviar`, {}, owner.token);
    assertStatus(r.status, 400, `expected 400 (PENDIENTE not sendable): ${JSON.stringify(r.body)}`);
    await del(`/vacaciones/${cr.body.id}`, owner.token);
  });

  // ── cleanup ──────────────────────────────────────────────────────────
  console.log('\n--- cleanup ---');
  for (const fn of cleanup.reverse()) { try { await fn(); } catch (e) { /* best-effort */ } }

  // ── summary ──────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n=== RESULTS: ${passed}/${results.length} passed, ${failed} failed ===`);
  for (const r of results.filter(r => !r.passed)) console.log(`  FAILED: ${r.name} :: ${r.detail}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
