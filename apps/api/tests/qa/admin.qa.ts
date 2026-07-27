/**
 * QA Suite — KEY=admin
 * Subsystem: Admin CRUD (sectores, diagramas, config, roles, alertas) + level guards.
 * Black-box over HTTP against http://localhost:4000/api/v1 (DEBUG_AUTH on).
 *
 * Run: cd apps/api && npx tsx tests/qa/admin.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'admin';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
type Result = { name: string; passed: boolean; detail: string; scenario: string };
const results: Result[] = [];
const cleanupQueue: Array<() => Promise<void>> = [];

function log(sym: string, msg: string, sc = '') {
  process.stdout.write(`  ${sym} ${sc ? `[${sc}] ` : ''}${msg}\n`);
}
async function scenario(name: string, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK', scenario: label });
    log('PASS', name, label);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail, scenario: label });
    log('FAIL', `${name} — ${detail}`, label);
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';
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
const patch = (p: string, b: unknown, tok?: string) => api('PATCH', p, { token: tok, body: b });
const del = (p: string, tok?: string) => api('DELETE', p, { token: tok });

interface Session { token: string; user: any }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}
const isoNow = () => new Date().toISOString();

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== ADMIN QA SUITE (ts=${TS}) ===\n`);

  const admin = await login('admin@wenlen.com');
  assert(admin.user.rolNivel >= 100, `admin nivel ${admin.user.rolNivel} < 100`);
  const rrhh = await login('rrhh1@test.wenlen.com');   // nivel 90
  const oper = await login('op1.almacen@test.wenlen.com'); // nivel 10

  // find a SUPERVISOR for extra below-admin authz coverage
  let supervisor: Session | null = null;
  const du = await get('/auth/debug-users', admin.token);
  if (du.status === 200 && Array.isArray(du.body)) {
    const sup = du.body.find((u: any) => u.rol === 'SUPERVISOR');
    if (sup) supervisor = await login(sup.email);
  }
  log('INFO', `rrhh nivel=${rrhh.user.rolNivel} oper nivel=${oper.user.rolNivel} supervisor=${supervisor ? supervisor.user.rolNivel : 'n/a'}`);

  // ════════════════════════════════════════════════════════════════════════
  // SECTORES
  // ════════════════════════════════════════════════════════════════════════
  let sectorId: string | null = null;
  let sectorWithUserId: string | null = null;
  let sectorUserId: string | null = null;

  await scenario('GET /admin/sectores → 200 array', 'SEC', async () => {
    const r = await get('/admin/sectores', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'not array');
  });

  await scenario('POST /admin/sectores valid → 201', 'SEC', async () => {
    const r = await post('/admin/sectores', { nombre: `qa-${KEY}-sec-${TS}`, descripcion: 'qa', color: '#1A2B3C' }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.id, 'no id');
    sectorId = r.body.id;
    cleanupQueue.push(async () => { await del(`/admin/sectores/${sectorId}`, admin.token); });
  });

  await scenario('POST /admin/sectores empty nombre → 400', 'SEC', async () => {
    const r = await post('/admin/sectores', { nombre: '' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('POST /admin/sectores bad color → 400', 'SEC', async () => {
    const r = await post('/admin/sectores', { nombre: `qa-${KEY}-badcolor-${TS}`, color: 'red' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('PUT /admin/sectores/:id → 200', 'SEC', async () => {
    assert(sectorId, 'no sectorId');
    const r = await put(`/admin/sectores/${sectorId}`, { descripcion: 'updated', activo: false }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.descripcion === 'updated' && r.body.activo === false, 'not updated');
  });

  await scenario('PUT /admin/sectores/:id nonexistent → 404', 'SEC', async () => {
    const r = await put(`/admin/sectores/00000000-0000-0000-0000-000000000000`, { descripcion: 'x' }, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('PUT /admin/sectores/:id bad color → 400', 'SEC', async () => {
    assert(sectorId, 'no sectorId');
    const r = await put(`/admin/sectores/${sectorId}`, { color: 'nothex' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('DELETE sector WITH assigned user → 409', 'SEC', async () => {
    // create a dedicated sector + user in it
    const s = await post('/admin/sectores', { nombre: `qa-${KEY}-secU-${TS}` }, admin.token);
    assertStatus(s.status, 201, JSON.stringify(s.body));
    sectorWithUserId = s.body.id;
    cleanupQueue.push(async () => { if (sectorWithUserId) await del(`/admin/sectores/${sectorWithUserId}`, admin.token); });

    const u = await post('/usuarios', {
      nombre: 'QA', apellido: `SecUser${TS}`, email: `qa.${KEY}.secuser.${TS}@demo.com`,
      password: 'Test1234!', rol: 'OPERADOR', sectorId: sectorWithUserId, fechaIngreso: isoNow(),
    }, admin.token);
    assertStatus(u.status, 201, JSON.stringify(u.body));
    sectorUserId = u.body.id;
    cleanupQueue.push(async () => {
      if (sectorUserId) {
        await patch(`/usuarios/${sectorUserId}/sector`, { sectorId: null }, admin.token); // free the sector first
        await del(`/usuarios/${sectorUserId}`, admin.token); // soft-deactivate
      }
    });

    const d = await del(`/admin/sectores/${sectorWithUserId}`, admin.token);
    assertStatus(d.status, 409, JSON.stringify(d.body));
    assert(String(d.body.error || '').includes('usuario'), `unexpected error msg: ${JSON.stringify(d.body)}`);
  });

  await scenario('DELETE sector nonexistent → 404', 'SEC', async () => {
    const r = await del(`/admin/sectores/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('DELETE empty sector → 204', 'SEC', async () => {
    const s = await post('/admin/sectores', { nombre: `qa-${KEY}-secDel-${TS}` }, admin.token);
    assertStatus(s.status, 201, JSON.stringify(s.body));
    const r = await del(`/admin/sectores/${s.body.id}`, admin.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });

  // SECTORES authz
  await scenario('SECTORES authz: RRHH(90) GET → 403', 'SEC-AUTHZ', async () => {
    const r = await get('/admin/sectores', rrhh.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('SECTORES authz: OPERADOR POST → 403', 'SEC-AUTHZ', async () => {
    const r = await post('/admin/sectores', { nombre: `qa-${KEY}-hack-${TS}` }, oper.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('SECTORES authz: OPERADOR DELETE → 403', 'SEC-AUTHZ', async () => {
    assert(sectorId, 'no sectorId');
    const r = await del(`/admin/sectores/${sectorId}`, oper.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ════════════════════════════════════════════════════════════════════════
  // DIAGRAMAS
  // ════════════════════════════════════════════════════════════════════════
  let rotativoId: string | null = null;

  await scenario('GET /admin/diagramas → 200 array', 'DIAG', async () => {
    const r = await get('/admin/diagramas', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'not array');
  });

  await scenario('POST diagrama ROTATIVO → 201', 'DIAG', async () => {
    const r = await post('/admin/diagramas', {
      nombre: `qa-${KEY}-rot-${TS}`, tipo: 'ROTATIVO', diasTrabajo: 14, diasDescanso: 7, descripcion: '14x7',
    }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.diasTrabajo === 14 && r.body.diasDescanso === 7, 'dias not stored');
    rotativoId = r.body.id;
    cleanupQueue.push(async () => { if (rotativoId) await del(`/admin/diagramas/${rotativoId}`, admin.token); });
  });

  await scenario('POST diagrama ROTATIVO missing diasDescanso → 400', 'DIAG', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-rotbad-${TS}`, tipo: 'ROTATIVO', diasTrabajo: 14 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('POST diagrama FIJO_SEMANA → 201', 'DIAG', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-fij-${TS}`, tipo: 'FIJO_SEMANA', diasSemana: [1, 2, 3, 4, 5] }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(Array.isArray(r.body.diasSemana) && r.body.diasSemana.length === 5, 'diasSemana not stored');
    const id = r.body.id;
    cleanupQueue.push(async () => { await del(`/admin/diagramas/${id}`, admin.token); });
  });

  await scenario('POST diagrama FIJO_SEMANA empty diasSemana → 400', 'DIAG', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-fijbad-${TS}`, tipo: 'FIJO_SEMANA', diasSemana: [] }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('POST diagrama FIJO_SEMANA diasSemana out-of-range [7] → 400', 'DIAG', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-fijoor-${TS}`, tipo: 'FIJO_SEMANA', diasSemana: [7] }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('POST diagrama invalid tipo → 400', 'DIAG', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-badtipo-${TS}`, tipo: 'WEEKLYISH' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('PUT diagrama → 200', 'DIAG', async () => {
    assert(rotativoId, 'no rotativoId');
    const r = await put(`/admin/diagramas/${rotativoId}`, { descripcion: 'changed', activo: false }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.descripcion === 'changed' && r.body.activo === false, 'not updated');
  });

  await scenario('PUT diagrama nonexistent → 404', 'DIAG', async () => {
    const r = await put(`/admin/diagramas/00000000-0000-0000-0000-000000000000`, { descripcion: 'x' }, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  let diaBugId: string | null = null;
  let diaBugUserId: string | null = null;
  await scenario('DELETE diagrama WITH active assignment → 409', 'DIAG', async () => {
    // create dedicated diagrama + user, assign
    const dia = await post('/admin/diagramas', { nombre: `qa-${KEY}-diaA-${TS}`, tipo: 'ROTATIVO', diasTrabajo: 7, diasDescanso: 7 }, admin.token);
    assertStatus(dia.status, 201, JSON.stringify(dia.body));
    diaBugId = dia.body.id;
    cleanupQueue.push(async () => { if (diaBugId) await del(`/admin/diagramas/${diaBugId}`, admin.token); });

    const u = await post('/usuarios', {
      nombre: 'QA', apellido: `DiagUser${TS}`, email: `qa.${KEY}.diaguser.${TS}@demo.com`,
      password: 'Test1234!', rol: 'OPERADOR', fechaIngreso: isoNow(),
    }, admin.token);
    assertStatus(u.status, 201, JSON.stringify(u.body));
    diaBugUserId = u.body.id;
    cleanupQueue.push(async () => { if (diaBugUserId) await del(`/usuarios/${diaBugUserId}`, admin.token); });

    const asg = await patch(`/usuarios/${diaBugUserId}/diagrama`, { diagramaId: diaBugId, fechaInicio: isoNow() }, admin.token);
    assertStatus(asg.status, 200, JSON.stringify(asg.body));

    const d = await del(`/admin/diagramas/${diaBugId}`, admin.token);
    assertStatus(d.status, 409, JSON.stringify(d.body));
    assert(String(d.body.error || '').includes('asignaci'), `unexpected: ${JSON.stringify(d.body)}`);
  });

  // BUG repro: guard only checks activo:true, but the FK (UsuarioDiagrama.diagrama, schema.prisma:221)
  // has no onDelete → Restrict. A diagrama with only an INACTIVE/historical assignment passes the 409
  // guard but then crashes the DB delete with P2003 → 500. Such a diagrama can never be deleted via API.
  await scenario('BUG: DELETE diagrama with only INACTIVE assignment → 500 (FK Restrict)', 'DIAG-BUG', async () => {
    assert(diaBugId && diaBugUserId, 'precondition (409 scenario) did not set up state');
    // swap the user to a seed diagrama → deactivates diaBug's assignment (activo:false), leaving a historical row
    const list = await get('/admin/diagramas', admin.token);
    const other = (list.body as any[]).find((x) => x.id !== diaBugId);
    assert(other, 'no other diagrama to swap to');
    const swap = await patch(`/usuarios/${diaBugUserId}/diagrama`, { diagramaId: other.id, fechaInicio: isoNow() }, admin.token);
    assertStatus(swap.status, 200, JSON.stringify(swap.body));

    // now 0 active assignments → 409 guard passes → DB delete hits FK Restrict from the inactive row
    const d = await del(`/admin/diagramas/${diaBugId}`, admin.token);
    (globalThis as any).__diagInactiveDeleteStatus = d.status;
    assertStatus(d.status, 500, `EXPECTED clean handling (204 or 409); got ${d.status}. body=${JSON.stringify(d.body)}`);
  });

  await scenario('DELETE diagrama nonexistent → 404', 'DIAG', async () => {
    const r = await del(`/admin/diagramas/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // DIAGRAMAS authz
  await scenario('DIAGRAMAS authz: SUPERVISOR/OPERADOR GET → 403', 'DIAG-AUTHZ', async () => {
    const tok = supervisor ? supervisor.token : oper.token;
    const r = await get('/admin/diagramas', tok);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('DIAGRAMAS authz: RRHH POST → 403', 'DIAG-AUTHZ', async () => {
    const r = await post('/admin/diagramas', { nombre: `qa-${KEY}-x-${TS}`, tipo: 'ROTATIVO', diasTrabajo: 1, diasDescanso: 1 }, rrhh.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ════════════════════════════════════════════════════════════════════════
  // CONFIG  (capture → mutate → confirm → RESTORE)
  // ════════════════════════════════════════════════════════════════════════
  await scenario('GET /admin/config → 200', 'CFG', async () => {
    const r = await get('/admin/config', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(typeof r.body.horasJornadaNormal === 'number', 'no horasJornadaNormal');
  });

  await scenario('PUT config change horasJornadaNormal → GET confirms → restore', 'CFG', async () => {
    const orig = await get('/admin/config', admin.token);
    assertStatus(orig.status, 200, JSON.stringify(orig.body));
    const o = orig.body;
    const origHoras = o.horasJornadaNormal;
    const origRedondeo = o.redondeoMinutos;
    const target = origHoras === 8 ? 9 : 8;
    try {
      const upd = await put('/admin/config', { horasJornadaNormal: target, redondeoMinutos: 15 }, admin.token);
      assertStatus(upd.status, 200, JSON.stringify(upd.body));
      assert(upd.body.horasJornadaNormal === target, `not applied: ${upd.body.horasJornadaNormal}`);
      const after = await get('/admin/config', admin.token);
      assert(after.body.horasJornadaNormal === target, `GET did not reflect: ${after.body.horasJornadaNormal}`);
    } finally {
      // RESTORE original values
      const restore = await put('/admin/config', { horasJornadaNormal: origHoras, redondeoMinutos: origRedondeo }, admin.token);
      assertStatus(restore.status, 200, `RESTORE failed: ${JSON.stringify(restore.body)}`);
      const verify = await get('/admin/config', admin.token);
      assert(verify.body.horasJornadaNormal === origHoras, `RESTORE not verified: ${verify.body.horasJornadaNormal}`);
    }
  });

  await scenario('PUT config negative horasJornadaNormal → 400', 'CFG', async () => {
    const r = await put('/admin/config', { horasJornadaNormal: -1 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('PUT config huge horasJornadaNormal (25) → 400', 'CFG', async () => {
    const r = await put('/admin/config', { horasJornadaNormal: 25 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('PUT config periodoDiaInicio=0 → 400', 'CFG', async () => {
    const r = await put('/admin/config', { periodoDiaInicio: 0 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('PUT config periodoDiaInicio=32 → 400', 'CFG', async () => {
    const r = await put('/admin/config', { periodoDiaInicio: 32 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('PUT config redondeoMinutos=0 → 400', 'CFG', async () => {
    const r = await put('/admin/config', { redondeoMinutos: 0 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  // CONFIG authz
  await scenario('CONFIG authz: RRHH GET → 403', 'CFG-AUTHZ', async () => {
    const r = await get('/admin/config', rrhh.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('CONFIG authz: RRHH PUT → 403', 'CFG-AUTHZ', async () => {
    const r = await put('/admin/config', { horasJornadaNormal: 7 }, rrhh.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ════════════════════════════════════════════════════════════════════════
  // ROLES
  // ════════════════════════════════════════════════════════════════════════
  let customRoleId: string | null = null;
  let customRoleCodigo: string | null = null;
  let systemRole: any = null;

  await scenario('GET /admin/roles → 200 array', 'ROL', async () => {
    const r = await get('/admin/roles', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'not array');
    systemRole = r.body.find((x: any) => x.esSistema === true);
    assert(systemRole, 'no system role found');
  });

  await scenario('POST custom role → 201', 'ROL', async () => {
    const codigo = `QA${TS}`; // <=30, no spaces
    const r = await post('/admin/roles', { codigo, nombre: `QA Role ${TS}`, nivel: 45, color: '#abcdef' }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.codigo === codigo.toUpperCase(), `codigo transform: ${r.body.codigo}`);
    assert(r.body.esSistema === false, 'should not be system');
    assert(r.body.nivel === 45, `nivel ${r.body.nivel}`);
    customRoleId = r.body.id;
    customRoleCodigo = r.body.codigo;
    cleanupQueue.push(async () => { if (customRoleId) await del(`/admin/roles/${customRoleId}`, admin.token); });
  });

  await scenario('POST duplicate codigo → 409', 'ROL', async () => {
    assert(customRoleCodigo, 'no codigo');
    const r = await post('/admin/roles', { codigo: customRoleCodigo, nombre: 'dup' }, admin.token);
    assertStatus(r.status, 409, JSON.stringify(r.body));
  });

  await scenario('POST role codigo too short (1 char) → 400', 'ROL', async () => {
    const r = await post('/admin/roles', { codigo: 'A', nombre: 'short' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('POST role nivel=100 (>99) → 400', 'ROL', async () => {
    const r = await post('/admin/roles', { codigo: `QAB${TS}`, nombre: 'lvl', nivel: 100 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('PUT custom role → 200', 'ROL', async () => {
    assert(customRoleId, 'no id');
    const r = await put(`/admin/roles/${customRoleId}`, { nombre: 'QA Role Updated', nivel: 30 }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.nivel === 30, `nivel ${r.body.nivel}`);
  });

  await scenario('PUT role nonexistent → 404', 'ROL', async () => {
    const r = await put(`/admin/roles/00000000-0000-0000-0000-000000000000`, { nombre: 'QA Nonexist' }, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('DELETE system role (esSistema) → 403', 'ROL', async () => {
    assert(systemRole, 'no system role');
    const r = await del(`/admin/roles/${systemRole.id}`, admin.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
    assert(String(r.body.error || '').includes('sistema'), `unexpected: ${JSON.stringify(r.body)}`);
  });

  await scenario('DELETE custom role WITH users assigned → 409', 'ROL', async () => {
    const codigo = `QAU${TS}`;
    const cr = await post('/admin/roles', { codigo, nombre: `QA RoleU ${TS}`, nivel: 40 }, admin.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const crId = cr.body.id;
    const crCod = cr.body.codigo;
    cleanupQueue.push(async () => { await del(`/admin/roles/${crId}`, admin.token); });

    const u = await post('/usuarios', {
      nombre: 'QA', apellido: `RoleUser${TS}`, email: `qa.${KEY}.roleuser.${TS}@demo.com`,
      password: 'Test1234!', rol: crCod, fechaIngreso: isoNow(),
    }, admin.token);
    assertStatus(u.status, 201, JSON.stringify(u.body));
    const uId = u.body.id;
    cleanupQueue.push(async () => { await del(`/usuarios/${uId}`, admin.token); });

    const d = await del(`/admin/roles/${crId}`, admin.token);
    assertStatus(d.status, 409, JSON.stringify(d.body));

    // free: change user rol off the custom role, then delete should 204
    const upd = await put(`/usuarios/${uId}`, { rol: 'OPERADOR' }, admin.token);
    assertStatus(upd.status, 200, JSON.stringify(upd.body));
    const d2 = await del(`/admin/roles/${crId}`, admin.token);
    assertStatus(d2.status, 204, `delete after freeing role: ${JSON.stringify(d2.body)}`);
  });

  await scenario('DELETE custom role (no users) → 204', 'ROL', async () => {
    const cr = await post('/admin/roles', { codigo: `QAD${TS}`, nombre: `QA RoleD ${TS}`, nivel: 35 }, admin.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const r = await del(`/admin/roles/${cr.body.id}`, admin.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });

  await scenario('DELETE role nonexistent → 404', 'ROL', async () => {
    const r = await del(`/admin/roles/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // BUG HUNT: PUT /admin/roles/:id lacks the esSistema guard that DELETE has.
  // Demonstrated SAFELY on the shared DB: mutate ONLY the cosmetic 'nombre' of a (non-ADMIN) system
  // role — fully reversible, no privilege change. A 200 (vs 403) proves no esSistema guard exists.
  // The same unguarded handler also accepts 'nivel' and 'activo' which drive auth at login
  // (auth.routes.ts:124-128); we deliberately do NOT exercise those to avoid corrupting the env.
  await scenario('BUG: PUT system role mutates it (no esSistema guard) — reversible nombre probe', 'ROL-BUG', async () => {
    const rl = await get('/admin/roles', admin.token);
    const sys = (rl.body as any[]).find((x) => x.esSistema === true && x.codigo !== 'ADMIN' && x.nivel <= 99);
    assert(sys, 'no suitable non-ADMIN system role');
    const origNombre = sys.nombre;
    const marker = `QAPROBE${TS}`.slice(0, 50);
    try {
      const r = await put(`/admin/roles/${sys.id}`, { nombre: marker }, admin.token);
      (globalThis as any).__sysPutStatus = r.status;
      assertStatus(r.status, 200, `Expected 200 (guard absent) — got ${r.status}: ${JSON.stringify(r.body)}`);
      assert(r.body.esSistema === true, 'role lost esSistema flag');
      assert(r.body.nombre === marker, `nombre not mutated: ${r.body.nombre}`);
    } finally {
      // RESTORE original nombre
      const restore = await put(`/admin/roles/${sys.id}`, { nombre: origNombre }, admin.token);
      assertStatus(restore.status, 200, `RESTORE system role failed: ${JSON.stringify(restore.body)}`);
      const v = await get('/admin/roles', admin.token);
      const now = (v.body as any[]).find((x) => x.id === sys.id);
      assert(now && now.nombre === origNombre, `RESTORE not verified: ${JSON.stringify(now)}`);
    }
  });

  // ROLES authz
  await scenario('ROLES GET as OPERADOR — observe (no level guard on GET)', 'ROL-AUTHZ', async () => {
    const r = await get('/admin/roles', oper.token);
    (globalThis as any).__rolesGetOperStatus = r.status;
    // Document behavior; sibling /admin GETs require ADMIN. Not asserting a specific code here.
    log('INFO', `OPERADOR GET /admin/roles → ${r.status}`, 'ROL-AUTHZ');
    assert(r.status === 200 || r.status === 403, `unexpected ${r.status}`);
  });
  await scenario('ROLES authz: RRHH POST → 403', 'ROL-AUTHZ', async () => {
    const r = await post('/admin/roles', { codigo: `QAH${TS}`, nombre: 'hack' }, rrhh.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('ROLES authz: OPERADOR DELETE → 403', 'ROL-AUTHZ', async () => {
    assert(customRoleId, 'no customRoleId');
    const r = await del(`/admin/roles/${customRoleId}`, oper.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ════════════════════════════════════════════════════════════════════════
  // ALERTAS
  // ════════════════════════════════════════════════════════════════════════
  let alertaId: string | null = null;

  await scenario('GET /admin/alertas → 200 array', 'ALE', async () => {
    const r = await get('/admin/alertas', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'not array');
  });
  await scenario('GET /admin/alertas as RRHH → 200 (level RRHH ok)', 'ALE', async () => {
    const r = await get('/admin/alertas', rrhh.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
  });

  await scenario('POST alerta → 201', 'ALE', async () => {
    const r = await post('/admin/alertas', {
      tipo: `qa-${KEY}-alert-${TS}`, activa: true, diasAnticipacion: 5, horasLimite: 10,
      rolesDestino: ['RRHH', 'ADMIN'], descripcion: 'qa',
    }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.activa === true, 'activa');
    alertaId = r.body.id;
    cleanupQueue.push(async () => { if (alertaId) await del(`/admin/alertas/${alertaId}`, admin.token); });
  });

  await scenario('POST alerta missing tipo → 400', 'ALE', async () => {
    const r = await post('/admin/alertas', { activa: true }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('POST alerta empty tipo → 400', 'ALE', async () => {
    const r = await post('/admin/alertas', { tipo: '' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('POST alerta negative diasAnticipacion → 400', 'ALE', async () => {
    const r = await post('/admin/alertas', { tipo: `qa-${KEY}-neg-${TS}`, diasAnticipacion: -1 }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('PUT alerta → 200', 'ALE', async () => {
    assert(alertaId, 'no alertaId');
    const r = await put(`/admin/alertas/${alertaId}`, { descripcion: 'updated', activa: false }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.descripcion === 'updated' && r.body.activa === false, 'not updated');
  });
  await scenario('PUT alerta nonexistent → 404', 'ALE', async () => {
    const r = await put(`/admin/alertas/00000000-0000-0000-0000-000000000000`, { descripcion: 'x' }, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('PATCH alerta toggle → 200 flips activa', 'ALE', async () => {
    assert(alertaId, 'no alertaId');
    const before = await get('/admin/alertas', admin.token);
    const cur = (before.body as any[]).find((a) => a.id === alertaId);
    const r = await patch(`/admin/alertas/${alertaId}/toggle`, {}, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.activa === !cur.activa, `toggle did not flip: ${cur.activa} -> ${r.body.activa}`);
  });
  await scenario('PATCH alerta toggle nonexistent → 404', 'ALE', async () => {
    const r = await patch(`/admin/alertas/00000000-0000-0000-0000-000000000000/toggle`, {}, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('DELETE alerta → 200 {ok:true}', 'ALE', async () => {
    const cr = await post('/admin/alertas', { tipo: `qa-${KEY}-del-${TS}` }, admin.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    const r = await del(`/admin/alertas/${cr.body.id}`, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body && r.body.ok === true, `expected {ok:true}: ${JSON.stringify(r.body)}`);
  });
  await scenario('DELETE alerta nonexistent → 404', 'ALE', async () => {
    const r = await del(`/admin/alertas/00000000-0000-0000-0000-000000000000`, admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  // ALERTAS authz (level RRHH=90 required)
  await scenario('ALERTAS authz: OPERADOR GET → 403', 'ALE-AUTHZ', async () => {
    const r = await get('/admin/alertas', oper.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('ALERTAS authz: SUPERVISOR(60) POST → 403', 'ALE-AUTHZ', async () => {
    const tok = supervisor ? supervisor.token : oper.token;
    const r = await post('/admin/alertas', { tipo: `qa-${KEY}-hack-${TS}` }, tok);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n--- cleanup ---');
  for (const c of cleanupQueue.reverse()) {
    try { await c(); } catch (e) { /* best-effort */ }
  }

  // ── summary ──
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed, ${failed} failed ===`);
  if (failed) {
    console.log('\nFAILURES:');
    for (const r of results.filter((x) => !x.passed)) console.log(`  [${r.scenario}] ${r.name} — ${r.detail}`);
  }
  console.log('\n__RESULTS_JSON__' + JSON.stringify({
    total: results.length, passed, failed,
    sysRolePutStatus: (globalThis as any).__sysPutStatus,
    rolesGetOperStatus: (globalThis as any).__rolesGetOperStatus,
    failures: results.filter((x) => !x.passed).map((x) => ({ s: x.scenario, n: x.name, d: x.detail })),
  }));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
