/**
 * QA suite — Notificaciones subsystem (KEY=notif)
 *
 * Verifies the "notificaciones en tiempo real" claim end-to-end over HTTP (black-box).
 * Endpoints covered:
 *   GET    /notificaciones            (list, desc createdAt, take:50 cap)
 *   GET    /notificaciones/count      (unread count, uncapped)
 *   PUT    /notificaciones/:id/leer   (mark one read; updateMany scoped by usuarioId)
 *   PUT    /notificaciones/leer-todas (mark all read -> 0)
 *   POST   /notificaciones            (RRHH+ create; empresa-scoped target; 403 below RRHH; 400 validation)
 *
 * Run: cd apps/api && npx tsx tests/qa/notif.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'notif';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m',
  YELLOW: '\x1b[33m', CYAN: '\x1b[36m',
};
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.RESET}`; }

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK' });
    process.stdout.write(`  ${col('GREEN', 'PASS')} ${name}  ${col('DIM', `(${Date.now() - start}ms)`)}\n`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail });
    process.stdout.write(`  ${col('RED', 'FAIL')} ${name} — ${detail}\n`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
async function apiCall(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
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
const get = (p: string, tok?: string) => apiCall('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => apiCall('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => apiCall('PUT', p, { token: tok, body: b });
const del = (p: string, tok?: string) => apiCall('DELETE', p, { token: tok });

// ── auth ────────────────────────────────────────────────────────────────────
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

// ── helpers ─────────────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString();

async function createOperador(adminTok: string, tag: string, extra: Record<string, unknown> = {}): Promise<{ id: string; email: string }> {
  const email = `qa.${KEY}.${tag}.${TS}@demo.com`;
  const { status, body } = await post('/usuarios', {
    nombre: `QA${tag}`, apellido: `Notif${TS}`, email,
    password: 'Test1234!', rol: 'OPERADOR',
    fechaIngreso: iso(new Date('2020-01-01')),
    ...extra,
  }, adminTok);
  assertStatus(status, 201, `create operador ${tag}: ${JSON.stringify(body)}`);
  cleanup.push(async () => { await del(`/usuarios/${body.id}`, adminTok); });
  return { id: body.id, email };
}

function findById(list: any[], id: string): any | undefined {
  return Array.isArray(list) ? list.find((n) => n.id === id) : undefined;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(col('CYAN', `\n=== QA Notificaciones (KEY=${KEY}, ts=${TS}) ===\n`));

  const admin = await login('admin@wenlen.com');
  const rrhh = await login('rrhh1@test.wenlen.com');
  assert(admin.user.rolNivel >= 100, `admin nivel ${admin.user.rolNivel}`);
  assert(rrhh.user.rolNivel >= 90, `rrhh nivel ${rrhh.user.rolNivel}`);
  const sameEmpresa = admin.user.empresaId === rrhh.user.empresaId;
  console.log(col('DIM', `  admin empresa=${admin.user.empresaId.slice(-6)} rrhh empresa=${rrhh.user.empresaId.slice(-6)} same=${sameEmpresa}\n`));

  // Create dedicated test users
  const target = await createOperador(admin.token, 'tgt');
  const attacker = await createOperador(admin.token, 'atk');
  const bulk = await createOperador(admin.token, 'blk');
  const targetS = await login(target.email);
  const attackerS = await login(attacker.email);
  const bulkS = await login(bulk.email);

  // Whoever shares empresa with target is the notif creator for part (a)
  const creatorForTarget = rrhh.user.empresaId === target.id ? rrhh : rrhh; // target created in admin's empresa
  const partAcreator = sameEmpresa ? rrhh : admin; // RRHH if same empresa, else admin (same empresa as target)

  let notifA_id = '';

  // ─────────────────────────────────────────────────────────────────────────
  // (a) Immediate synchronous delivery: RRHH POST -> target sees it instantly
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('(a) RRHH POST /notificaciones -> 201 with correct fields', async () => {
    const c0 = await get('/notificaciones/count', targetS.token);
    assertStatus(c0.status, 200);
    assert(c0.body.count === 0, `fresh target unread expected 0, got ${c0.body.count}`);

    const payload = { usuarioId: target.id, tipo: 'QA_TEST', titulo: `qa.${KEY} immediate ${TS}`, cuerpo: 'cuerpo inmediato', link: '/qa-test' };
    const tBefore = Date.now();
    const r = await post('/notificaciones', payload, partAcreator.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.id && r.body.usuarioId === target.id, 'returned notif missing id/usuarioId');
    assert(r.body.tipo === 'QA_TEST' && r.body.titulo === payload.titulo, 'returned notif fields mismatch');
    assert(r.body.leida === false, 'new notif should be unread');
    notifA_id = r.body.id;

    // Immediately retrievable (synchronous creation)
    const c1 = await get('/notificaciones/count', targetS.token);
    const latency = Date.now() - tBefore;
    assertStatus(c1.status, 200);
    assert(c1.body.count === 1, `count after create expected 1, got ${c1.body.count}`);

    const list = await get('/notificaciones', targetS.token);
    assertStatus(list.status, 200);
    const top = list.body[0];
    assert(top && top.id === notifA_id, `top notif id mismatch (got ${top?.id})`);
    assert(top.tipo === 'QA_TEST' && top.titulo === payload.titulo && top.link === '/qa-test' && top.cuerpo === 'cuerpo inmediato',
      `top notif fields wrong: ${JSON.stringify(top)}`);
    console.log(col('DIM', `       synchronous retrieval latency (POST->count reflects): ${latency}ms`));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateMany scoping leak: attacker marks target's notif -> must NOT change it
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('LEAK: another user PUT /:id/leer on target notif does NOT mark it read', async () => {
    assert(!!notifA_id, 'no notifA_id from part (a)');
    const before = await get('/notificaciones/count', targetS.token);
    assert(before.body.count === 1, `precondition target unread=1, got ${before.body.count}`);

    const r = await put(`/notificaciones/${notifA_id}/leer`, {}, attackerS.token);
    assertStatus(r.status, 200, JSON.stringify(r.body)); // route returns ok:true even if 0 rows matched
    assert(r.body.ok === true, 'expected {ok:true}');

    // target's notif must remain unread
    const after = await get('/notificaciones/count', targetS.token);
    assert(after.body.count === 1, `target unread should stay 1 after cross-user leer, got ${after.body.count}`);
    const list = await get('/notificaciones', targetS.token);
    const n = findById(list.body, notifA_id);
    assert(n && n.leida === false, `target notif must still be unread (leida=${n?.leida})`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /:id/leer decrements count by 1 (owner marks own)
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('PUT /:id/leer by owner decrements unread by 1', async () => {
    const before = await get('/notificaciones/count', targetS.token);
    const r = await put(`/notificaciones/${notifA_id}/leer`, {}, targetS.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.ok === true, 'expected {ok:true}');
    const after = await get('/notificaciones/count', targetS.token);
    assert(after.body.count === before.body.count - 1, `expected ${before.body.count - 1}, got ${after.body.count}`);
    const list = await get('/notificaciones', targetS.token);
    const n = findById(list.body, notifA_id);
    assert(n && n.leida === true, `notif should now be read (leida=${n?.leida})`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (b) Real action: admin creates+rejects an ausencia for target -> owner notif
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('(b) Reject ausencia (real action) creates owner notif synchronously', async () => {
    // Build a deterministic single-step RRHH flow scoped to target (avoids empresa-wide flow)
    const fl = await post('/admin/flujos', {
      nombre: `qa.${KEY}.flujo.${TS}`, tipoDocumento: 'AUSENCIA',
      pasos: [{ orden: 1, nombrePaso: 'RRHH review', rolAprobador: 'RRHH' }],
    }, admin.token);
    assertStatus(fl.status, 201, JSON.stringify(fl.body));
    const flujoId = fl.body.id;
    cleanup.push(async () => { await del(`/admin/flujos/${flujoId}`, admin.token); });

    const asg = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'AUSENCIA', usuarioId: target.id,
    }, admin.token);
    assertStatus(asg.status, 201, JSON.stringify(asg.body));
    const asgId = asg.body.id;
    cleanup.push(async () => { await del(`/admin/flujos/asignaciones/${asgId}`, admin.token); });

    // create ausencia for target (admin) -> BORRADOR
    const av = await post('/ausencias', {
      usuarioId: target.id, tipo: 'LICENCIA_ESPECIAL',
      fechaInicio: iso(new Date('2031-03-01')), fechaFin: iso(new Date('2031-03-02')),
      diasAusencia: 2, descripcion: `qa.${KEY} ausencia ${TS}`,
    }, admin.token);
    assertStatus(av.status, 201, JSON.stringify(av.body));
    const ausId = av.body.id;
    cleanup.push(async () => { await del(`/ausencias/${ausId}`, rrhh.token); });
    assert(av.body.estado === 'BORRADOR', `ausencia estado expected BORRADOR, got ${av.body.estado}`);

    // enviar -> PENDIENTE (picks our user-scoped flow)
    const en = await post(`/ausencias/${ausId}/enviar`, {}, admin.token);
    assertStatus(en.status, 200, JSON.stringify(en.body));
    assert(en.body.estado === 'PENDIENTE', `enviar estado expected PENDIENTE, got ${en.body.estado}`);
    assert(en.body.flujoId === flujoId, `ausencia should use our flujo (got ${en.body.flujoId})`);

    // capture target unread before reject
    const before = (await get('/notificaciones/count', targetS.token)).body.count;

    const rj = await post(`/ausencias/${ausId}/rechazar`, { motivo: 'qa reject motivo' }, admin.token);
    assertStatus(rj.status, 200, JSON.stringify(rj.body));
    assert(rj.body.estado === 'RECHAZADA', `reject estado expected RECHAZADA, got ${rj.body.estado}`);

    // owner notif appears immediately
    const after = (await get('/notificaciones/count', targetS.token)).body.count;
    assert(after === before + 1, `owner unread expected ${before + 1}, got ${after}`);
    const list = await get('/notificaciones', targetS.token);
    const top = list.body[0];
    assert(top.tipo === 'AUSENCIA', `top tipo expected AUSENCIA, got ${top.tipo}`);
    assert(/rechazada/i.test(top.titulo), `top titulo expected rechazo, got ${top.titulo}`);
    assert(top.link === '/ausencias', `top link expected /ausencias, got ${top.link}`);
    assert(top.leida === false, 'owner notif should be unread');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /leer-todas -> unread becomes 0
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('PUT /leer-todas marks all target notifs read (unread -> 0)', async () => {
    const before = (await get('/notificaciones/count', targetS.token)).body.count;
    assert(before >= 1, `expected >=1 unread before leer-todas, got ${before}`);
    const r = await put('/notificaciones/leer-todas', {}, targetS.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.ok === true, 'expected {ok:true}');
    const after = (await get('/notificaciones/count', targetS.token)).body.count;
    assert(after === 0, `unread after leer-todas expected 0, got ${after}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // take:50 cap + desc ordering + count uncapped (bulk user)
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('GET /notificaciones caps at 50, count uncapped, desc createdAt', async () => {
    const N = 55;
    for (let i = 1; i <= N; i++) {
      const r = await post('/notificaciones', {
        usuarioId: bulk.id, tipo: 'QA_BULK', titulo: `bulk-${String(i).padStart(3, '0')}`,
      }, admin.token);
      assertStatus(r.status, 201, `bulk create ${i}: ${JSON.stringify(r.body)}`);
    }
    const list = await get('/notificaciones', bulkS.token);
    assertStatus(list.status, 200);
    assert(Array.isArray(list.body), 'list not array');
    assert(list.body.length === 50, `list length expected 50 (take:50 cap), got ${list.body.length}`);
    // desc createdAt: non-increasing
    for (let i = 1; i < list.body.length; i++) {
      const prev = new Date(list.body[i - 1].createdAt).getTime();
      const cur = new Date(list.body[i].createdAt).getTime();
      assert(prev >= cur, `ordering not desc at index ${i}: ${prev} < ${cur}`);
    }
    // count is uncapped (counts all unread = 55, not 50)
    const c = await get('/notificaciones/count', bulkS.token);
    assert(c.body.count === N, `count should be uncapped ${N}, got ${c.body.count}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Authz: OPERADOR POST -> 403
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('AUTHZ: OPERADOR POST /notificaciones -> 403', async () => {
    const r = await post('/notificaciones', {
      usuarioId: target.id, tipo: 'QA_TEST', titulo: 'should not pass',
    }, attackerS.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Empresa scoping: target user not in caller empresa -> 400 "Usuario no encontrado"
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('SCOPE: POST to non-existent/cross-empresa usuarioId -> 400', async () => {
    const ghost = crypto.randomUUID();
    const r = await post('/notificaciones', {
      usuarioId: ghost, tipo: 'QA_TEST', titulo: 'cross empresa',
    }, rrhh.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
    assert(/no encontrado/i.test(r.body.error ?? ''), `expected 'Usuario no encontrado', got ${JSON.stringify(r.body)}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Validation: bad bodies -> 400
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('VALIDATION: missing titulo -> 400', async () => {
    const r = await post('/notificaciones', { usuarioId: target.id, tipo: 'QA_TEST' }, rrhh.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('VALIDATION: usuarioId not uuid -> 400', async () => {
    const r = await post('/notificaciones', { usuarioId: 'not-a-uuid', tipo: 'QA_TEST', titulo: 'x' }, rrhh.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('VALIDATION: titulo > 200 chars -> 400', async () => {
    const r = await post('/notificaciones', { usuarioId: target.id, tipo: 'QA_TEST', titulo: 'A'.repeat(201) }, rrhh.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Auth required: no token -> 401
  // ─────────────────────────────────────────────────────────────────────────
  await scenario('AUTH: GET /notificaciones/count without token -> 401', async () => {
    const r = await get('/notificaciones/count');
    assertStatus(r.status, 401, JSON.stringify(r.body));
  });

  // ── cleanup ────────────────────────────────────────────────────────────────
  console.log(col('CYAN', '\n  cleanup...'));
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch { /* best-effort */ }
  }

  // ── summary ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n=== Summary: ${passed}/${results.length} passed, ${failed} failed ===`));
  for (const r of results.filter((r) => !r.passed)) console.log(col('RED', `  FAIL ${r.name}: ${r.detail}`));
}

main().catch((e) => { console.error(col('RED', `FATAL: ${e?.stack ?? e}`)); process.exit(1); });
