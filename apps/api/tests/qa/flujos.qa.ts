/**
 * QA Suite — KEY=flujos
 * Approval-chain (flujo) engine for tipoDocumento=PLANILLA.
 *
 * Headline: build 3 distinct chains and drive a planilla through each:
 *   (A) [RRHH]                       (B) [SUPERVISOR -> RRHH]
 *   (C) [SUPERVISOR -> COORDINADOR -> RRHH]
 * Plus negative/authz/notification coverage for enviar/avanzar/rechazar
 * and admin/flujos + aprobaciones endpoints.
 *
 * Run: cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/flujos.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'flujos';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];

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
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
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

// ── auth ───────────────────────────────────────────────────────────────────
interface Session { token: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

// ── notif helpers ──────────────────────────────────────────────────────────
async function notifCount(tok: string): Promise<number> {
  const { body } = await get('/notificaciones/count', tok);
  return typeof body?.count === 'number' ? body.count : -1;
}
async function notifs(tok: string): Promise<any[]> {
  const { body } = await get('/notificaciones', tok);
  return Array.isArray(body) ? body : [];
}
function hasNotif(list: any[], pred: (n: any) => boolean, within = 12): boolean {
  return list.slice(0, within).some(pred);
}
/**
 * Los roles del circuito CONGELADO de un documento, en orden.
 *
 * Sale de `circuitoSnapshot` y no de `flujo.pasos`: desde que el circuito se
 * arma según el nivel de quien envía, la cadena configurada tiene pasos que el
 * documento puede no recorrer. Solo tiene valor después de enviar — un borrador
 * todavía no congeló nada.
 */
function circuito(doc: any): string[] {
  const pasos = Array.isArray(doc?.circuitoSnapshot) ? doc.circuitoSnapshot : [];
  return [...pasos].sort((a: any, b: any) => a.orden - b.orden).map((p: any) => p.rolAprobador);
}

const isParaRevisar = (n: any) => n.tipo === 'PLANILLA' && typeof n.titulo === 'string' && n.titulo.toLowerCase().includes('para revisar');
const ownerLink = (pid: string) => (n: any) => n.tipo === 'PLANILLA' && n.link === `/planillas/${pid}`;

// ── builders ──────────────────────────────────────────────────────────────
const createdUsers: string[] = [];
const createdFlujos: string[] = [];
const createdAsigs: string[] = [];
const createdPlanillas: { id: string; ownerTok: string }[] = [];

async function createUser(adminTok: string, role: string, tag: string, sectorId: string | null): Promise<{ id: string; email: string }> {
  const email = `qa.${KEY}.${TS}.${tag}@demo.com`;
  const { status, body } = await post('/usuarios', {
    nombre: `QA${tag}`, apellido: `${KEY}${TS}`, email, password: 'Test1234!',
    rol: role, sectorId, fechaIngreso: '2001-01-01T00:00:00.000Z',
  }, adminTok);
  assertStatus(status, 201, `createUser ${tag}: ${JSON.stringify(body)}`);
  createdUsers.push(body.id);
  return { id: body.id, email };
}

async function createFlujo(adminTok: string, nombre: string, pasos: { orden: number; rol: string; reqCom?: boolean }[]): Promise<string> {
  const { status, body } = await post('/admin/flujos', {
    nombre, tipoDocumento: 'PLANILLA',
    pasos: pasos.map(p => ({ orden: p.orden, nombrePaso: `Paso ${p.orden} ${p.rol}`, rolAprobador: p.rol, requiereComentarioRechazo: p.reqCom ?? true })),
  }, adminTok);
  assertStatus(status, 201, `createFlujo ${nombre}: ${JSON.stringify(body)}`);
  createdFlujos.push(body.id);
  return body.id;
}

async function assignFlujo(adminTok: string, flujoId: string, usuarioId: string): Promise<string> {
  const { status, body } = await post('/admin/flujos/asignaciones', { flujoId, tipoDocumento: 'PLANILLA', usuarioId }, adminTok);
  assertStatus(status, 201, `assignFlujo: ${JSON.stringify(body)}`);
  createdAsigs.push(body.id);
  return body.id;
}

// Owner logs in, creates a 1-day planilla, fills the day, returns {id, day}
async function createFilledPlanilla(ownerSession: Session, dayISO: string): Promise<string> {
  const tok = ownerSession.token;
  const { status, body } = await post('/planillas', { periodoInicio: dayISO, periodoFin: dayISO }, tok);
  assertStatus(status, 201, `createPlanilla: ${JSON.stringify(body)}`);
  const pid = body.id;
  createdPlanillas.push({ id: pid, ownerTok: tok });
  const day = dayISO.split('T')[0];
  const { status: rs, body: rb } = await post(`/planillas/${pid}/registros`, {
    fecha: `${day}T00:00:00.000Z`,
    entradaTurno1: `${day}T08:00:00.000Z`, salidaTurno1: `${day}T16:00:00.000Z`,
    lugarTrabajo: 'CAMPO',
  }, tok);
  assertStatus(rs, 201, `createRegistro: ${JSON.stringify(rb)}`);
  return pid;
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n=== QA flujos suite (ts=${TS}) ===\n`);

  const admin = await login('admin@wenlen.com');
  assert(admin.user.rolNivel >= 100, `admin nivel ${admin.user.rolNivel}`);

  // El aprobador de RRHH se crea acá en vez de tomarse de la nómina: antes era
  // un login fijo a rrhh1@test.wenlen.com, y la suite entera moría con un 401 el
  // día que ese usuario dejó de existir. Va SIN sector, como los RRHH del seed:
  // así es transversal y ve los documentos de cualquier sector.
  const rrhhUser = await createUser(admin.token, 'RRHH', 'rrhh', null);
  const rrhh = await login(rrhhUser.email);
  assert(rrhh.user.rolNivel >= 90, `rrhh nivel ${rrhh.user.rolNivel}`);

  // pick a real sector
  let sectorId: string | null = null;
  {
    const { body } = await get('/usuarios', admin.token);
    if (Array.isArray(body)) {
      const withSector = body.find((u: any) => u.sector?.id);
      sectorId = withSector?.sector?.id ?? null;
    }
  }
  log('ℹ', `sectorId=${sectorId ?? 'none'}`);

  // dedicated approvers (clean notif inboxes) + owners
  const supU = await createUser(admin.token, 'SUPERVISOR', 'sup', sectorId);
  const coordU = await createUser(admin.token, 'COORDINADOR', 'coord', sectorId);
  const supSession = await login(supU.email);
  const coordSession = await login(coordU.email);
  assert(supSession.user.rolNivel >= 60, `sup nivel ${supSession.user.rolNivel}`);
  assert(coordSession.user.rolNivel >= 70, `coord nivel ${coordSession.user.rolNivel}`);

  const ownerAu = await createUser(admin.token, 'OPERADOR', 'ownerA', sectorId);
  const ownerBu = await createUser(admin.token, 'OPERADOR', 'ownerB', sectorId);
  const ownerCu = await createUser(admin.token, 'OPERADOR', 'ownerC', sectorId);
  const ownerDu = await createUser(admin.token, 'OPERADOR', 'ownerD', sectorId);

  // wire supervisor/coordinador via PUT /usuarios
  await scenario('PUT /usuarios sets supervisorId/coordinadorId', async () => {
    for (const [id, sup, coord] of [
      [ownerBu.id, supU.id, null], [ownerCu.id, supU.id, coordU.id], [ownerDu.id, supU.id, null],
    ] as [string, string, string | null][]) {
      const { status, body } = await put(`/usuarios/${id}`, { supervisorId: sup, coordinadorId: coord }, admin.token);
      assertStatus(status, 200, `PUT user ${id}: ${JSON.stringify(body)}`);
    }
  });

  const ownerA = await login(ownerAu.email);
  const ownerB = await login(ownerBu.email);
  const ownerC = await login(ownerCu.email);
  const ownerD = await login(ownerDu.email);

  // ── create + assign the 3 chains + 1 reject-chain ────────────────────────
  let flujoA = '', flujoB = '', flujoC = '', flujoD = '';
  await scenario('POST /admin/flujos creates 1/2/3-step PLANILLA chains', async () => {
    flujoA = await createFlujo(admin.token, `QA-${KEY}-A-${TS}`, [{ orden: 1, rol: 'RRHH' }]);
    flujoB = await createFlujo(admin.token, `QA-${KEY}-B-${TS}`, [{ orden: 1, rol: 'SUPERVISOR' }, { orden: 2, rol: 'RRHH' }]);
    flujoC = await createFlujo(admin.token, `QA-${KEY}-C-${TS}`, [{ orden: 1, rol: 'SUPERVISOR' }, { orden: 2, rol: 'COORDINADOR' }, { orden: 3, rol: 'RRHH' }]);
    flujoD = await createFlujo(admin.token, `QA-${KEY}-D-${TS}`, [{ orden: 1, rol: 'SUPERVISOR' }, { orden: 2, rol: 'RRHH' }]);
    await assignFlujo(admin.token, flujoA, ownerAu.id);
    await assignFlujo(admin.token, flujoB, ownerBu.id);
    await assignFlujo(admin.token, flujoC, ownerCu.id);
    await assignFlujo(admin.token, flujoD, ownerDu.id);
  });

  // ── admin/flujos negative & misc ─────────────────────────────────────────
  await scenario('POST /admin/flujos as non-admin (RRHH) -> 403', async () => {
    const { status } = await post('/admin/flujos', { nombre: 'x', tipoDocumento: 'PLANILLA', pasos: [{ orden: 1, nombrePaso: 'p', rolAprobador: 'RRHH' }] }, rrhh.token);
    assertStatus(status, 403);
  });
  await scenario('POST /admin/flujos invalid (empty pasos) -> 400', async () => {
    const { status } = await post('/admin/flujos', { nombre: 'x', tipoDocumento: 'PLANILLA', pasos: [] }, admin.token);
    assertStatus(status, 400);
  });
  await scenario('GET /admin/flujos/:id returns pasos in order', async () => {
    const { status, body } = await get(`/admin/flujos/${flujoC}`, admin.token);
    assertStatus(status, 200);
    const roles = body.pasos.map((p: any) => p.rolAprobador);
    assert(JSON.stringify(roles) === JSON.stringify(['SUPERVISOR', 'COORDINADOR', 'RRHH']), `pasos=${JSON.stringify(roles)}`);
  });
  await scenario('GET /admin/flujos/:id unknown -> 404', async () => {
    const { status } = await get('/admin/flujos/00000000-0000-0000-0000-000000000000', admin.token);
    assertStatus(status, 404);
  });
  await scenario('POST /admin/flujos/asignaciones duplicate scope -> 409', async () => {
    const { status, body } = await post('/admin/flujos/asignaciones', { flujoId: flujoA, tipoDocumento: 'PLANILLA', usuarioId: ownerAu.id }, admin.token);
    assertStatus(status, 409, JSON.stringify(body));
  });

  // ── can-approve ──────────────────────────────────────────────────────────
  await scenario('GET /aprobaciones/can-approve: SUP=true, COORD=true, owner(OPERADOR)=false', async () => {
    const s = await get('/aprobaciones/can-approve', supSession.token);
    assertStatus(s.status, 200); assert(s.body.canApprove === true, `sup canApprove=${s.body.canApprove}`);
    const c = await get('/aprobaciones/can-approve', coordSession.token);
    assert(c.body.canApprove === true, `coord canApprove=${c.body.canApprove}`);
    const o = await get('/aprobaciones/can-approve', ownerA.token);
    assert(o.body.canApprove === false, `owner canApprove=${o.body.canApprove}`);
  });

  // ════════════════ CHAIN A: [RRHH] ════════════════
  await scenario('CHAIN A [RRHH]: enviar resolves flujo, notifies RRHH; RRHH avanzar -> APROBADA + owner notif', async () => {
    const pid = await createFilledPlanilla(ownerA, '2001-03-15T00:00:00.000Z');

    // Un borrador NO tiene flujo: el circuito se resuelve y se congela al
    // enviar, no al crear. Antes de ese cambio esto se verificaba acá y ahora
    // sería un falso rojo.
    const det = await get(`/planillas/${pid}`, ownerA.token);
    assertStatus(det.status, 200, JSON.stringify(det.body));
    assert(det.body.flujoId == null, `un borrador no debería tener flujo (llegó ${det.body.flujoId})`);

    const rrhhBefore = await notifCount(rrhh.token);
    const sendRes = await post(`/planillas/${pid}/enviar`, {}, ownerA.token);
    assertStatus(sendRes.status, 200, JSON.stringify(sendRes.body));
    assert(sendRes.body.estado === 'ENVIADA', `estado=${sendRes.body.estado}`);
    assert(sendRes.body.pasoActual === 1, `pasoActual=${sendRes.body.pasoActual}`);

    // El circuito congelado tiene que ser la cadena configurada: quien envía es
    // un OPERADOR (nivel 10) y ningún aprobador de la cadena está a esa altura,
    // así que no se saltea ningún paso.
    assert(JSON.stringify(circuito(sendRes.body)) === JSON.stringify(['RRHH']),
      `chain A circuito=${JSON.stringify(circuito(sendRes.body))}`);

    // RRHH (next approver) gets a "para revisar" notif
    const rrhhAfter = await notifCount(rrhh.token);
    assert(rrhhAfter > rrhhBefore, `RRHH count did not increase on enviar (${rrhhBefore}->${rrhhAfter})`);
    assert(hasNotif(await notifs(rrhh.token), isParaRevisar), 'RRHH has no "para revisar" notif after enviar');

    // RRHH inbox includes the planilla as pendiente
    const apr = await get('/aprobaciones', rrhh.token);
    assertStatus(apr.status, 200);
    assert(apr.body.planillasPendientes.some((p: any) => p.id === pid), 'planilla not in RRHH pendientes');

    // single-step approval -> APROBADA
    const ownerBefore = await notifCount(ownerA.token);
    const adv = await post(`/planillas/${pid}/avanzar`, { comentario: 'QA A aprobar' }, rrhh.token);
    assertStatus(adv.status, 200, JSON.stringify(adv.body));
    assert(adv.body.estado === 'APROBADA', `chain A estado=${adv.body.estado} (expected APROBADA after final step)`);

    const ownerAfter = await notifCount(ownerA.token);
    assert(ownerAfter > ownerBefore, `owner A count did not increase (${ownerBefore}->${ownerAfter})`);
    assert(hasNotif(await notifs(ownerA.token), (n) => ownerLink(pid)(n) && n.titulo.toLowerCase().includes('aprobada')), 'owner A missing APROBADA notif');

    // avanzar again on APROBADA -> 400 (state machine)
    const again = await post(`/planillas/${pid}/avanzar`, { comentario: 'x' }, rrhh.token);
    assertStatus(again.status, 400, JSON.stringify(again.body));
  });

  // ════════════════ CHAIN B: [SUPERVISOR -> RRHH] ════════════════
  let pidB = '';
  await scenario('CHAIN B [SUP->RRHH]: only APROBADA after 2nd step; per-step notifs', async () => {
    pidB = await createFilledPlanilla(ownerB, '2002-04-10T00:00:00.000Z');

    const supBefore = await notifCount(supSession.token);
    const send = await post(`/planillas/${pidB}/enviar`, {}, ownerB.token);
    assertStatus(send.status, 200, JSON.stringify(send.body));
    assert(send.body.pasoActual === 1, `pasoActual=${send.body.pasoActual}`);
    assert(JSON.stringify(circuito(send.body)) === JSON.stringify(['SUPERVISOR', 'RRHH']),
      `chain B circuito=${JSON.stringify(circuito(send.body))}`);
    // step-1 approver (dedicated supervisor) notified
    assert((await notifCount(supSession.token)) > supBefore, 'supervisor not notified on enviar');
    assert(hasNotif(await notifs(supSession.token), isParaRevisar), 'supervisor missing "para revisar"');

    // supervisor inbox includes planilla
    const supApr = await get('/aprobaciones', supSession.token);
    assert(supApr.body.planillasPendientes.some((p: any) => p.id === pidB), 'planilla not in supervisor pendientes');

    // step 1 -> EN_REVISION (NOT approved yet)
    const ownerBefore = await notifCount(ownerB.token);
    const rrhhBefore = await notifCount(rrhh.token);
    const adv1 = await post(`/planillas/${pidB}/avanzar`, { comentario: 'QA B paso1' }, supSession.token);
    assertStatus(adv1.status, 200, JSON.stringify(adv1.body));
    assert(adv1.body.estado === 'EN_REVISION', `after step1 estado=${adv1.body.estado} (expected EN_REVISION)`);
    assert(adv1.body.pasoActual === 2, `after step1 pasoActual=${adv1.body.pasoActual}`);
    // owner gets EN_REVISION, next approver (RRHH) gets para revisar
    assert((await notifCount(ownerB.token)) > ownerBefore, 'owner B not notified on step1 advance');
    assert(hasNotif(await notifs(ownerB.token), (n) => ownerLink(pidB)(n) && n.titulo.toLowerCase().includes('avanz')), 'owner B missing EN_REVISION notif');
    assert((await notifCount(rrhh.token)) > rrhhBefore, 'RRHH not notified for step2');

    // step 2 (RRHH) -> APROBADA
    const ownerBefore2 = await notifCount(ownerB.token);
    const adv2 = await post(`/planillas/${pidB}/avanzar`, { comentario: 'QA B paso2' }, rrhh.token);
    assertStatus(adv2.status, 200, JSON.stringify(adv2.body));
    assert(adv2.body.estado === 'APROBADA', `chain B estado=${adv2.body.estado} (expected APROBADA after step2)`);
    assert((await notifCount(ownerB.token)) > ownerBefore2, 'owner B not notified on final approval');
    assert(hasNotif(await notifs(ownerB.token), (n) => ownerLink(pidB)(n) && n.titulo.toLowerCase().includes('aprobada')), 'owner B missing APROBADA notif');
  });

  // ════════════════ CHAIN C: [SUP -> COORD -> RRHH] ════════════════
  let pidC = '';
  await scenario('CHAIN C [SUP->COORD->RRHH]: walks 3 steps, APROBADA only after step3', async () => {
    pidC = await createFilledPlanilla(ownerC, '2003-05-12T00:00:00.000Z');

    const envio = await post(`/planillas/${pidC}/enviar`, {}, ownerC.token);
    assertStatus(envio.status, 200, JSON.stringify(envio.body));
    assert(JSON.stringify(circuito(envio.body)) === JSON.stringify(['SUPERVISOR', 'COORDINADOR', 'RRHH']),
      `chain C circuito=${JSON.stringify(circuito(envio.body))}`);

    // step 1 SUP -> EN_REVISION (paso 2), coordinador notified next
    const coordBefore = await notifCount(coordSession.token);
    const a1 = await post(`/planillas/${pidC}/avanzar`, { comentario: 'C1' }, supSession.token);
    assertStatus(a1.status, 200, JSON.stringify(a1.body));
    assert(a1.body.estado === 'EN_REVISION' && a1.body.pasoActual === 2, `C step1 -> ${a1.body.estado}/${a1.body.pasoActual}`);
    assert((await notifCount(coordSession.token)) > coordBefore, 'coordinador not notified for step2');
    assert(hasNotif(await notifs(coordSession.token), isParaRevisar), 'coordinador missing "para revisar"');

    // coordinador inbox includes it
    const cApr = await get('/aprobaciones', coordSession.token);
    assert(cApr.body.planillasPendientes.some((p: any) => p.id === pidC), 'planilla not in coordinador pendientes');

    // step 2 COORD -> EN_REVISION (paso 3)
    const a2 = await post(`/planillas/${pidC}/avanzar`, { comentario: 'C2' }, coordSession.token);
    assertStatus(a2.status, 200, JSON.stringify(a2.body));
    assert(a2.body.estado === 'EN_REVISION' && a2.body.pasoActual === 3, `C step2 -> ${a2.body.estado}/${a2.body.pasoActual}`);

    // step 3 RRHH -> APROBADA
    const a3 = await post(`/planillas/${pidC}/avanzar`, { comentario: 'C3' }, rrhh.token);
    assertStatus(a3.status, 200, JSON.stringify(a3.body));
    assert(a3.body.estado === 'APROBADA', `chain C final estado=${a3.body.estado}`);
    assert(hasNotif(await notifs(ownerC.token), (n) => ownerLink(pidC)(n) && n.titulo.toLowerCase().includes('aprobada')), 'owner C missing APROBADA notif');
  });

  // ════════════════ AUTHZ negatives on avanzar ════════════════
  await scenario('avanzar by OPERADOR (owner) -> 403 (level guard)', async () => {
    // fresh chain-B-style planilla, sent, sitting at SUPERVISOR step
    const pid = await createFilledPlanilla(ownerB, '2004-06-08T00:00:00.000Z');
    await post(`/planillas/${pid}/enviar`, {}, ownerB.token);
    const { status, body } = await post(`/planillas/${pid}/avanzar`, { comentario: 'x' }, ownerB.token);
    assertStatus(status, 403, JSON.stringify(body));
    // wrong responsible approver: COORDINADOR (level ok) trying a SUPERVISOR step
    const wrong = await post(`/planillas/${pid}/avanzar`, { comentario: 'x' }, coordSession.token);
    assertStatus(wrong.status, 403, `wrong-approver expected 403, got ${wrong.status}: ${JSON.stringify(wrong.body)}`);
    // cleanup: reject so it can be removed later
    await post(`/planillas/${pid}/rechazar`, { motivo: 'QA cleanup' }, supSession.token);
  });

  await scenario('avanzar unknown planilla -> 404', async () => {
    const { status } = await post('/planillas/00000000-0000-0000-0000-000000000000/avanzar', { comentario: 'x' }, rrhh.token);
    assertStatus(status, 404);
  });

  // ════════════════ RECHAZAR ════════════════
  await scenario('rechazar: no motivo -> 400; wrong approver -> 403; valid -> RECHAZADA + owner notif', async () => {
    const pid = await createFilledPlanilla(ownerD, '2005-07-14T00:00:00.000Z');
    await post(`/planillas/${pid}/enviar`, {}, ownerD.token); // sits at SUPERVISOR (supU)

    // no motivo -> 400
    const noMot = await post(`/planillas/${pid}/rechazar`, {}, supSession.token);
    assertStatus(noMot.status, 400, JSON.stringify(noMot.body));

    // wrong approver (coordinador, level ok but not responsible) -> 403
    const wrong = await post(`/planillas/${pid}/rechazar`, { motivo: 'no soy yo' }, coordSession.token);
    assertStatus(wrong.status, 403, JSON.stringify(wrong.body));

    // valid reject by responsible supervisor
    const ownerBefore = await notifCount(ownerD.token);
    const ok = await post(`/planillas/${pid}/rechazar`, { motivo: 'Faltan datos QA' }, supSession.token);
    assertStatus(ok.status, 200, JSON.stringify(ok.body));
    assert(ok.body.estado === 'RECHAZADA', `estado=${ok.body.estado}`);
    assert(ok.body.pasoActual === 0, `pasoActual after reject=${ok.body.pasoActual}`);
    assert((await notifCount(ownerD.token)) > ownerBefore, 'owner D not notified on reject');
    assert(hasNotif(await notifs(ownerD.token), (n) => ownerLink(pid)(n) && n.titulo.toLowerCase().includes('rechazada')), 'owner D missing RECHAZADA notif');
  });

  await scenario('rechazar unknown planilla -> 404', async () => {
    const { status } = await post('/planillas/00000000-0000-0000-0000-000000000000/rechazar', { motivo: 'x' }, rrhh.token);
    assertStatus(status, 404);
  });

  // ════════════════ CLEANUP ════════════════
  console.log('\n── cleanup ──');
  // delete planillas owners can (BORRADOR/RECHAZADA/ENVIADA-unreviewed); APROBADA will fail (expected)
  for (const p of createdPlanillas) { try { await del(`/planillas/${p.id}`, p.ownerTok); } catch { /* ignore */ } }
  for (const id of createdAsigs) { try { await del(`/admin/flujos/asignaciones/${id}`, admin.token); } catch { /* ignore */ } }
  for (const id of createdFlujos) {
    try {
      const r = await del(`/admin/flujos/${id}`, admin.token);
      if (r.status !== 204) await put(`/admin/flujos/${id}`, { activo: false }, admin.token);
    } catch { /* ignore */ }
  }
  for (const id of createdUsers) { try { await del(`/usuarios/${id}`, admin.token); } catch { /* ignore */ } }
  log('ℹ', `cleanup done (planillas=${createdPlanillas.length}, flujos=${createdFlujos.length}, asigs=${createdAsigs.length}, users=${createdUsers.length})`);

  // ── summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n=== RESULT: ${passed}/${results.length} passed, ${failed} failed ===`);
  for (const r of results.filter(x => !x.passed)) console.log(`  FAIL: ${r.name} — ${r.detail}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
