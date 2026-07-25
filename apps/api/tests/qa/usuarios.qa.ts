/**
 * QA Suite — KEY=usuarios — full "personal" lifecycle over HTTP (black-box)
 * Run: cd apps/api && npx tsx tests/qa/usuarios.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'usuarios';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
const C: Record<string, string> = { R: '\x1b[0m', G: '\x1b[32m', RD: '\x1b[31m', Y: '\x1b[33m', CY: '\x1b[36m', DIM: '\x1b[2m' };
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.R}`; }
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, passed: true, detail: 'OK' }); process.stdout.write(`  ${col('G', 'PASS')} ${name}\n`); }
  catch (e: unknown) { const d = e instanceof Error ? e.message : String(e); results.push({ name, passed: false, detail: d }); process.stdout.write(`  ${col('RD', 'FAIL')} ${name} — ${d}\n`); }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') { if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`); }
function snippet(b: unknown) { const s = typeof b === 'string' ? b : JSON.stringify(b); return s.length > 300 ? s.slice(0, 300) + '…' : s; }

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
const get = (p: string, t?: string) => api('GET', p, { token: t });
const post = (p: string, b: unknown, t?: string) => api('POST', p, { token: t, body: b });
const put = (p: string, b: unknown, t?: string) => api('PUT', p, { token: t, body: b });
const patch = (p: string, b: unknown, t?: string) => api('PATCH', p, { token: t, body: b });
const del = (p: string, t?: string) => api('DELETE', p, { token: t });

interface Session { token: string; user: { id: string; nombre: string; apellido: string; email: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${snippet(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

const iso = (d: Date) => d.toISOString();
const bug = (id: string, msg: string) => process.stdout.write(`  ${col('Y', 'BUG')} [${id}] ${msg}\n`);

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(col('CY', `\n=== QA usuarios suite (ts=${TS}) ===\n`));

  const admin = await login('admin@wenlen.com');
  const rrhh = await login('ana.martinez@demo.com');
  const operador = await login('franco.alvarez@demo.com');
  console.log(col('DIM', `  admin nivel=${admin.user.rolNivel} rrhh nivel=${rrhh.user.rolNivel} operador nivel=${operador.user.rolNivel} (oper sector=${operador.user.sectorId})`));

  // discover a real sectorId + supervisor + coordinador
  const { body: list } = await get('/usuarios', admin.token);
  assert(Array.isArray(list), 'usuarios list not array');
  const withSector = (list as any[]).find(u => u.sector?.id);
  const sectorId: string = withSector?.sector?.id ?? null;
  const sectorId2: string | null = (list as any[]).map(u => u.sector?.id).filter(Boolean).find((s: string) => s !== sectorId) ?? null;
  const { body: dbg } = await get('/auth/debug-users', admin.token);
  const supEntry = (dbg as any[]).find(u => u.rol === 'SUPERVISOR');
  const coordEntry = (dbg as any[]).find(u => u.rol === 'COORDINADOR');
  console.log(col('DIM', `  sectorId=${sectorId} sectorId2=${sectorId2} sup=${supEntry?.id} coord=${coordEntry?.id}`));

  const createdUserIds: string[] = [];
  const createdDiagramaIds: string[] = [];

  function basePayload(extra: Record<string, unknown> = {}) {
    return {
      nombre: `Qa${KEY}`, apellido: `T${TS}`,
      email: `qa.${KEY}.${TS}.${Math.random().toString(36).slice(2, 7)}@demo.com`,
      password: 'Test1234!', rol: 'OPERADOR', fechaIngreso: iso(new Date('2020-01-15T00:00:00Z')),
      ...extra,
    };
  }

  // ── CREATE happy paths ──────────────────────────────────────────────────────
  let userA: any = null;
  await scenario('CREATE OPERADOR (201 + id, fields persisted)', async () => {
    const p = basePayload({ dni: '30111222', cuil: '20301112223', legajo: `L${TS % 100000}`, telefono: '+5492990000001', tipoContrato: 'INDEFINIDO' });
    const { status, body } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 201, snippet(body));
    assert(typeof body.id === 'string', 'no id returned');
    userA = body; createdUserIds.push(body.id);
    // verify via GET
    const { status: gs, body: g } = await get(`/usuarios/${body.id}`, rrhh.token);
    assertStatus(gs, 200, snippet(g));
    assert(g.email === p.email && g.dni === '30111222' && g.cuil === '20301112223' && g.legajo === p.legajo && g.telefono === p.telefono, `persisted fields mismatch: ${snippet(g)}`);
    assert(g.tipoContrato === 'INDEFINIDO', 'tipoContrato mismatch');
    assert(g.primerLogin === true, 'primerLogin should default true');
  });

  let userB: any = null;
  await scenario('CREATE SUPERVISOR rich (sector+sup+coord+contrato)', async () => {
    const p = basePayload({ rol: 'SUPERVISOR', sectorId, supervisorId: supEntry?.id, coordinadorId: coordEntry?.id, tipoContrato: 'PLAZO_FIJO', fechaFinPrueba: iso(new Date('2020-04-15T00:00:00Z')), diagramaColor: 'AZUL' });
    const { status, body } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 201, snippet(body));
    userB = body; createdUserIds.push(body.id);
    const { body: g } = await get(`/usuarios/${body.id}`, rrhh.token);
    assert(g.rol === 'SUPERVISOR', 'rol mismatch');
    assert(g.sector?.id === sectorId, `sector not persisted: ${snippet(g.sector)}`);
    assert(g.supervisor?.id === supEntry?.id, `supervisor not persisted: ${snippet(g.supervisor)}`);
    assert(g.coordinador?.id === coordEntry?.id, `coordinador not persisted: ${snippet(g.coordinador)}`);
    assert(g.tipoContrato === 'PLAZO_FIJO', 'tipoContrato mismatch');
    assert(g.diagramaColor === 'AZUL', 'diagramaColor mismatch');
  });

  // ── CREATE negative/edge ─────────────────────────────────────────────────────
  await scenario('CREATE duplicate email → 409', async () => {
    const p = basePayload();
    const r1 = await post('/usuarios', p, rrhh.token);
    assertStatus(r1.status, 201, snippet(r1.body)); createdUserIds.push(r1.body.id);
    const r2 = await post('/usuarios', { ...basePayload(), email: p.email }, rrhh.token);
    assertStatus(r2.status, 409, snippet(r2.body));
  });
  await scenario('CREATE invalid email → 400', async () => {
    const { status } = await post('/usuarios', basePayload({ email: 'not-an-email' }), rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CREATE missing fechaIngreso → 400', async () => {
    const p: any = basePayload(); delete p.fechaIngreso;
    const { status } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CREATE weak password (no digit/upper) → 400', async () => {
    const { status } = await post('/usuarios', basePayload({ password: 'lowercaseonly' }), rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CREATE missing nombre → 400', async () => {
    const p: any = basePayload(); delete p.nombre;
    const { status } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CREATE bad sectorId uuid format → 400', async () => {
    const { status } = await post('/usuarios', basePayload({ sectorId: 'xyz' }), rrhh.token);
    assertStatus(status, 400);
  });

  // FK edge: valid-format but nonexistent sectorId
  await scenario('CREATE nonexistent sectorId (valid uuid) — expect 400/404 not 500', async () => {
    const fakeUuid = '00000000-0000-4000-8000-000000000000';
    const { status, body } = await post('/usuarios', basePayload({ sectorId: fakeUuid }), rrhh.token);
    if (status === 201) { createdUserIds.push(body.id); }
    if (status === 500) { bug(`${KEY}-FK`, `nonexistent sectorId returns 500 (FK violation unhandled): ${snippet(body)}`); throw new Error(`got 500 (should be 400/404): ${snippet(body)}`); }
    assert(status === 400 || status === 404, `expected 400/404, got ${status}: ${snippet(body)}`);
  });

  // ── PRIVILEGE ESCALATION probe: RRHH creates ADMIN-roled user ─────────────────
  await scenario('AUTHZ: RRHH creates rol=ADMIN user → escalation check', async () => {
    const p = basePayload({ rol: 'ADMIN', nombre: 'QaEscalate' });
    const { status, body } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 201, snippet(body));
    createdUserIds.push(body.id);
    // login as the new ADMIN-roled user — DEBUG_AUTH any password
    const escSession = await login(p.email);
    process.stdout.write(col('DIM', `      new user rolNivel on login = ${escSession.user.rolNivel}\n`));
    if (escSession.user.rolNivel >= 100) {
      // confirm escalation: this RRHH-minted user can perform ADMIN-only DELETE
      const victim = await post('/usuarios', basePayload({ nombre: 'QaVictim' }), rrhh.token);
      assertStatus(victim.status, 201, snippet(victim.body)); createdUserIds.push(victim.body.id);
      const { status: ds } = await del(`/usuarios/${victim.body.id}`, escSession.token);
      if (ds === 204) {
        bug(`${KEY}-ESC`, `RRHH (nivel 90) created rol=ADMIN user who logs in as nivel ${escSession.user.rolNivel} and performed ADMIN-only DELETE (204). No level cap on rol assignment.`);
        throw new Error(`PRIVILEGE ESCALATION: RRHH-minted ADMIN performed admin-only DELETE (204)`);
      }
    }
  });

  // ── PUT / edit ───────────────────────────────────────────────────────────────
  await scenario('PUT edit nombre/telefono/legajo (200 + persisted)', async () => {
    const { status, body } = await put(`/usuarios/${userA.id}`, { nombre: 'QaEdited', telefono: '+5492999999999', legajo: `LE${TS % 100000}` }, rrhh.token);
    assertStatus(status, 200, snippet(body));
    const { body: g } = await get(`/usuarios/${userA.id}`, rrhh.token);
    assert(g.nombre === 'QaEdited' && g.telefono === '+5492999999999' && g.legajo === `LE${TS % 100000}`, `not persisted: ${snippet(g)}`);
  });
  await scenario('PUT change rol OPERADOR→SUPERVISOR (200 + persisted)', async () => {
    const { status } = await put(`/usuarios/${userA.id}`, { rol: 'SUPERVISOR' }, rrhh.token);
    assertStatus(status, 200);
    const { body: g } = await get(`/usuarios/${userA.id}`, rrhh.token);
    assert(g.rol === 'SUPERVISOR', `rol not changed: ${g.rol}`);
  });
  await scenario('PUT assign sector+supervisor+coordinador (200 + persisted)', async () => {
    const { status, body } = await put(`/usuarios/${userA.id}`, { sectorId, supervisorId: supEntry?.id, coordinadorId: coordEntry?.id }, rrhh.token);
    assertStatus(status, 200, snippet(body));
    const { body: g } = await get(`/usuarios/${userA.id}`, rrhh.token);
    assert(g.sector?.id === sectorId, 'sector not persisted');
    assert(g.supervisor?.id === supEntry?.id, 'supervisor not persisted');
    assert(g.coordinador?.id === coordEntry?.id, 'coordinador not persisted');
  });
  await scenario('PUT email collision with existing → 409', async () => {
    const { status } = await put(`/usuarios/${userA.id}`, { email: rrhh.user.email }, rrhh.token);
    assertStatus(status, 409);
  });
  await scenario('PUT nonexistent user → 404', async () => {
    const { status } = await put('/usuarios/00000000-0000-4000-8000-000000000000', { nombre: 'X' }, rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('PUT invalid body (bad tipoContrato) → 400', async () => {
    const { status } = await put(`/usuarios/${userA.id}`, { tipoContrato: 'NOPE' }, rrhh.token);
    assertStatus(status, 400);
  });

  // ── GET list + filters ───────────────────────────────────────────────────────
  await scenario('GET /usuarios filter rol=SUPERVISOR (all returned are SUPERVISOR)', async () => {
    const { status, body } = await get('/usuarios?rol=SUPERVISOR', admin.token);
    assertStatus(status, 200);
    assert(Array.isArray(body) && body.every((u: any) => u.rol === 'SUPERVISOR'), 'filter rol leaked non-supervisors');
  });
  await scenario('GET /usuarios filter activo=false', async () => {
    const { status, body } = await get('/usuarios?activo=false', admin.token);
    assertStatus(status, 200);
    assert(Array.isArray(body) && body.every((u: any) => u.activo === false), 'activo=false returned active users');
  });
  await scenario('GET /usuarios search by surname token', async () => {
    const { status, body } = await get(`/usuarios?search=T${TS}`, admin.token);
    assertStatus(status, 200);
    assert(Array.isArray(body) && body.some((u: any) => u.id === userA.id), 'search did not find created user by apellido');
  });
  await scenario('GET /usuarios/:id nonexistent → 404', async () => {
    const { status } = await get('/usuarios/00000000-0000-4000-8000-000000000000', admin.token);
    assertStatus(status, 404);
  });

  // ── ficha (RRHH) ─────────────────────────────────────────────────────────────
  await scenario('GET /usuarios/:id/ficha as RRHH → 200 (with relations)', async () => {
    const { status, body } = await get(`/usuarios/${userA.id}/ficha`, rrhh.token);
    assertStatus(status, 200, snippet(body));
    assert('planillas' in body && 'vacaciones' in body && 'ausencias' in body, 'ficha missing relation arrays');
  });
  await scenario('GET /usuarios/:id/ficha as OPERADOR → 403', async () => {
    const { status } = await get(`/usuarios/${userA.id}/ficha`, operador.token);
    assertStatus(status, 403);
  });

  // ── reset-password ───────────────────────────────────────────────────────────
  await scenario('POST reset-password as RRHH → 200 + tempPassword', async () => {
    const { status, body } = await post(`/usuarios/${userA.id}/reset-password`, {}, rrhh.token);
    assertStatus(status, 200, snippet(body));
    assert(typeof body.tempPassword === 'string' && body.tempPassword.length >= 6, 'no tempPassword returned');
  });
  await scenario('POST reset-password as OPERADOR → 403', async () => {
    const { status } = await post(`/usuarios/${userA.id}/reset-password`, {}, operador.token);
    assertStatus(status, 403);
  });
  await scenario('POST reset-password on self (RRHH own id) → 400', async () => {
    const { status } = await post(`/usuarios/${rrhh.user.id}/reset-password`, {}, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('POST reset-password nonexistent → 404', async () => {
    const { status } = await post('/usuarios/00000000-0000-4000-8000-000000000000/reset-password', {}, rrhh.token);
    assertStatus(status, 404);
  });

  // ── diagrama: create as admin then PATCH assign ──────────────────────────────
  let diagramaId: string | null = null;
  await scenario('POST /admin/diagramas (ROTATIVO) → 201', async () => {
    const { status, body } = await post('/admin/diagramas', { nombre: `qa-${KEY}-${TS % 100000}`, tipo: 'ROTATIVO', diasTrabajo: 14, diasDescanso: 7, descripcion: 'qa diagrama' }, admin.token);
    assertStatus(status, 201, snippet(body));
    diagramaId = body.id; createdDiagramaIds.push(body.id);
  });
  await scenario('PATCH /usuarios/:id/diagrama assign → 200', async () => {
    assert(!!diagramaId, 'no diagramaId');
    const { status, body } = await patch(`/usuarios/${userA.id}/diagrama`, { diagramaId, fechaInicio: iso(new Date('2020-02-01T00:00:00Z')) }, rrhh.token);
    assertStatus(status, 200, snippet(body));
    assert(body.diagrama?.id === diagramaId, 'assignment diagrama mismatch');
    // verify diagramaActual reflected in GET
    const { body: g } = await get(`/usuarios/${userA.id}`, rrhh.token);
    assert(g.diagramaActual?.id === diagramaId, `diagramaActual not reflected: ${snippet(g.diagramaActual)}`);
  });
  await scenario('PATCH diagrama invalid (missing fechaInicio) → 400', async () => {
    const { status } = await patch(`/usuarios/${userA.id}/diagrama`, { diagramaId }, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('PATCH diagrama nonexistent user → 404', async () => {
    const { status } = await patch('/usuarios/00000000-0000-4000-8000-000000000000/diagrama', { diagramaId, fechaInicio: iso(new Date('2020-02-01T00:00:00Z')) }, rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('PATCH diagrama nonexistent diagramaId (valid uuid) — expect 400/404 not 500', async () => {
    const { status, body } = await patch(`/usuarios/${userA.id}/diagrama`, { diagramaId: '00000000-0000-4000-8000-000000000000', fechaInicio: iso(new Date('2020-02-01T00:00:00Z')) }, rrhh.token);
    if (status === 500) { bug(`${KEY}-DGFK`, `nonexistent diagramaId → 500 (FK violation unhandled): ${snippet(body)}`); throw new Error(`got 500 (should be 400/404): ${snippet(body)}`); }
    assert(status === 400 || status === 404, `expected 400/404, got ${status}: ${snippet(body)}`);
  });

  // ── PATCH sector (admin) + diagrama-color (coordinador-level) ─────────────────
  await scenario('PATCH /usuarios/:id/sector as ADMIN → 200', async () => {
    const { status, body } = await patch(`/usuarios/${userB.id}/sector`, { sectorId: sectorId2 ?? sectorId }, admin.token);
    assertStatus(status, 200, snippet(body));
  });
  await scenario('PATCH /usuarios/:id/sector as OPERADOR → 403', async () => {
    const { status } = await patch(`/usuarios/${userB.id}/sector`, { sectorId }, operador.token);
    assertStatus(status, 403);
  });
  await scenario('PATCH diagrama-color same-sector as RRHH → 200', async () => {
    // create a target user in RRHH caller's sector
    if (!rrhh.user.sectorId) { process.stdout.write(col('DIM', '      (skip: RRHH has no sector)\n')); return; }
    const t = await post('/usuarios', basePayload({ nombre: 'QaColor', sectorId: rrhh.user.sectorId }), rrhh.token);
    assertStatus(t.status, 201, snippet(t.body)); createdUserIds.push(t.body.id);
    const { status, body } = await patch(`/usuarios/${t.body.id}/diagrama-color`, { diagramaColor: 'AMARILLO' }, rrhh.token);
    assertStatus(status, 200, snippet(body));
    assert(body.diagramaColor === 'AMARILLO', 'color not set');
  });
  await scenario('PATCH diagrama-color different-sector → 403', async () => {
    if (!sectorId2 || sectorId2 === rrhh.user.sectorId) { process.stdout.write(col('DIM', '      (skip: no distinct foreign sector)\n')); return; }
    const t = await post('/usuarios', basePayload({ nombre: 'QaColorF', sectorId: sectorId2 }), rrhh.token);
    assertStatus(t.status, 201, snippet(t.body)); createdUserIds.push(t.body.id);
    const { status } = await patch(`/usuarios/${t.body.id}/diagrama-color`, { diagramaColor: 'BASE' }, rrhh.token);
    assertStatus(status, 403);
  });

  // ── authz: OPERADOR cannot create/edit ───────────────────────────────────────
  await scenario('AUTHZ OPERADOR create → 403', async () => {
    const { status } = await post('/usuarios', basePayload(), operador.token);
    assertStatus(status, 403);
  });
  await scenario('AUTHZ OPERADOR edit → 403', async () => {
    const { status } = await put(`/usuarios/${userA.id}`, { nombre: 'Hack' }, operador.token);
    assertStatus(status, 403);
  });
  await scenario('AUTHZ OPERADOR delete → 403', async () => {
    const { status } = await del(`/usuarios/${userA.id}`, operador.token);
    assertStatus(status, 403);
  });
  await scenario('AUTHZ RRHH delete (needs ADMIN level) → 403', async () => {
    const { status } = await del(`/usuarios/${userA.id}`, rrhh.token);
    assertStatus(status, 403);
  });

  // ── visibility: OPERADOR list scoped to own sector ───────────────────────────
  await scenario('VISIBILITY OPERADOR GET /usuarios scoped to own sector (no leak)', async () => {
    const { status, body } = await get('/usuarios', operador.token);
    assertStatus(status, 200);
    assert(Array.isArray(body), 'not array');
    const myFromList = (list as any[]); void myFromList;
    if (operador.user.sectorId) {
      const leaked = body.filter((u: any) => u.sector && u.sector.id && u.sector.id !== operador.user.sectorId);
      assert(leaked.length === 0, `OPERADOR saw ${leaked.length} users outside own sector (data leak)`);
    }
  });

  // ── DELETE / reactivate lifecycle ────────────────────────────────────────────
  await scenario('DELETE as ADMIN → 204 + activo=false', async () => {
    const { status } = await del(`/usuarios/${userB.id}`, admin.token);
    assertStatus(status, 204);
    const { body: g } = await get(`/usuarios/${userB.id}`, admin.token);
    assert(g.activo === false, 'user not deactivated');
  });
  await scenario('DELETE self (admin own id) → 400', async () => {
    const { status } = await del(`/usuarios/${admin.user.id}`, admin.token);
    assertStatus(status, 400);
  });
  await scenario('DELETE nonexistent → 404', async () => {
    const { status } = await del('/usuarios/00000000-0000-4000-8000-000000000000', admin.token);
    assertStatus(status, 404);
  });
  await scenario('reset-password on inactive user → 400', async () => {
    const { status } = await post(`/usuarios/${userB.id}/reset-password`, {}, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('REACTIVATE via PUT activo=true → 200 + activo=true', async () => {
    const { status, body } = await put(`/usuarios/${userB.id}`, { activo: true }, rrhh.token);
    assertStatus(status, 200, snippet(body));
    const { body: g } = await get(`/usuarios/${userB.id}`, admin.token);
    assert(g.activo === true, 'user not reactivated');
  });

  // ── notification side-effect check on user creation ──────────────────────────
  await scenario('NOTIF: creating a user emits NO welcome notif (documented)', async () => {
    const p = basePayload({ nombre: 'QaNotif' });
    const { status, body } = await post('/usuarios', p, rrhh.token);
    assertStatus(status, 201, snippet(body)); createdUserIds.push(body.id);
    const newSess = await login(p.email);
    const { body: cnt } = await get('/notificaciones/count', newSess.token);
    const { body: notifs } = await get('/notificaciones', newSess.token);
    process.stdout.write(col('DIM', `      new user unread count=${JSON.stringify(cnt)} notifs=${Array.isArray(notifs) ? notifs.length : '?'}\n`));
    // Route emits no notification — assert absence (informational, not a product bug)
    assert(Array.isArray(notifs) && notifs.length === 0, `expected fresh user to have 0 notifs, got ${Array.isArray(notifs) ? notifs.length : snippet(notifs)}`);
  });

  // ── CLEANUP ──────────────────────────────────────────────────────────────────
  console.log(col('CY', '\n── cleanup ──'));
  for (const id of createdUserIds) {
    try { await del(`/usuarios/${id}`, admin.token); } catch { /* ignore */ }
  }
  for (const id of createdDiagramaIds) {
    try { await del(`/admin/diagramas/${id}`, admin.token); } catch { /* ignore */ }
  }
  await Promise.all(cleanup.map(f => f().catch(() => {})));
  console.log(col('DIM', `  deactivated ${createdUserIds.length} users, attempted delete of ${createdDiagramaIds.length} diagramas`));

  // ── summary ──────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CY', `\n=== RESULT: ${passed}/${results.length} passed, ${failed} failed ===`));
  if (failed) for (const r of results.filter(r => !r.passed)) console.log(`  ${col('RD', 'FAIL')} ${r.name} — ${r.detail}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
