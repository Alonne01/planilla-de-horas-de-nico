/**
 * QA Suite — Mensajes subsystem (KEY=mensajes)
 *
 * Covers POST /mensajes (multipart, RRHH+), GET /mensajes (inbox),
 * GET /mensajes/no-leidos, GET /mensajes/enviados (RRHH+),
 * GET /mensajes/:id, POST /mensajes/:id/responder (multipart),
 * PUT /mensajes/:id/leer, PUT /mensajes/leer-todas.
 * Plus notification side-effects and authz/validation boundaries.
 *
 * Run: cd apps/api && npx tsx tests/qa/mensajes.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';
const KEY = 'mensajes';
const TS = Date.now();

// ── output ───────────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m',
  YELLOW: '\x1b[33m', CYAN: '\x1b[36m',
};
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.RESET}`; }

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];

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

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP (JSON) ──────────────────────────────────────────────────────────────
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

// ── HTTP (multipart) ─────────────────────────────────────────────────────────
async function postMultipart(
  path: string,
  fields: Record<string, string>,
  tok?: string,
  file?: { data: Uint8Array; name: string; type: string },
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('archivo', new Blob([file.data], { type: file.type }), file.name);
  const headers: Record<string, string> = {};
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

// 1x1 transparent PNG
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

// ── Auth ─────────────────────────────────────────────────────────────────────
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

async function notifCount(tok: string): Promise<number> {
  const { status, body } = await get('/notificaciones/count', tok);
  assertStatus(status, 200, 'notif count');
  return body.count as number;
}
async function noLeidos(tok: string): Promise<number> {
  const { status, body } = await get('/mensajes/no-leidos', tok);
  assertStatus(status, 200, 'no-leidos');
  return body.count as number;
}

// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(col('CYAN', `\n=== QA Mensajes (TS=${TS}) ===\n`));

  // ── Setup ──────────────────────────────────────────────────────────────────
  const admin = await login('admin@wenlen.com');
  console.log(`  admin empresaId=${admin.user.empresaId} nivel=${admin.user.rolNivel}`);

  // Fresh isolated sector
  const secRes = await post('/admin/sectores', { nombre: `qa.${KEY}.${TS}`, color: '#123456' }, admin.token);
  assertStatus(secRes.status, 201, `create sector: ${JSON.stringify(secRes.body)}`);
  const sectorId: string = secRes.body.id;
  cleanup.push(async () => { await del(`/admin/sectores/${sectorId}`, admin.token); });

  const QAROL = `QAMENS_${TS}`;
  const ingreso = new Date().toISOString();

  async function makeUser(prefix: string, rol: string, sId: string | null): Promise<Session> {
    const email = `qa.${KEY}.${prefix}.${TS}@demo.com`;
    const r = await post('/usuarios', {
      nombre: `QA${prefix}`, apellido: KEY, email, password: 'Test1234!',
      rol, sectorId: sId, fechaIngreso: ingreso,
    }, admin.token);
    assertStatus(r.status, 201, `create user ${prefix}: ${JSON.stringify(r.body)}`);
    const id: string = r.body.id;
    cleanup.push(async () => {
      await api('PATCH', `/usuarios/${id}/sector`, { token: admin.token, body: { sectorId: null } });
      await del(`/usuarios/${id}`, admin.token);
    });
    return login(email);
  }

  // RRHH sender (no sector so SECTOR broadcast hits only A/B/C)
  const sender = await makeUser('sender', 'RRHH', null);
  assert(sender.user.rolNivel >= 90, `sender nivel ${sender.user.rolNivel} expected >=90 (RolConfig RRHH)`);
  // Recipients with unique rol so ROL broadcast is isolated
  const A = await makeUser('a', QAROL, sectorId);
  const B = await makeUser('b', QAROL, sectorId);
  const Cc = await makeUser('c', QAROL, sectorId);
  console.log(`  sender=${sender.user.id} A=${A.user.id} B=${B.user.id} C=${Cc.user.id} sector=${sectorId} rol=${QAROL}\n`);

  // shared state
  let msgMultiId = '';
  let msgSectorId = '';
  let msgRolId = '';
  let msgToA_replyId = '';
  let msgToA_noreplyId = '';

  // ── M1: POST /mensajes USUARIO multi (happy) + notif to A & B ────────────────
  await scenario('M1 POST /mensajes USUARIO multi -> 201 + notifs', async () => {
    const aBefore = await notifCount(A.token);
    const bBefore = await notifCount(B.token);
    const asunto = `M1 asunto ${TS}`;
    const r = await postMultipart('/mensajes', {
      asunto, cuerpo: 'cuerpo M1', permiteRespuesta: 'true',
      destinoTipo: 'USUARIO', destinoValor: `${A.user.id},${B.user.id}`,
    }, sender.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.destinatariosCount === 2, `destinatariosCount=${r.body.destinatariosCount} expected 2`);
    assert(r.body.esDifusion === true, `esDifusion expected true got ${r.body.esDifusion}`);
    assert(r.body.permiteRespuesta === true, 'permiteRespuesta expected true');
    msgMultiId = r.body.id;
    // Notification delivery
    const aAfter = await notifCount(A.token);
    const bAfter = await notifCount(B.token);
    assert(aAfter >= aBefore + 1, `A notif count ${aBefore}->${aAfter} expected +>=1`);
    assert(bAfter >= bBefore + 1, `B notif count ${bBefore}->${bAfter} expected +>=1`);
    const aNotifs = await get('/notificaciones', A.token);
    const top = aNotifs.body[0];
    assert(top && top.tipo === 'MENSAJE', `A top notif tipo=${top?.tipo}`);
    assert(typeof top.titulo === 'string' && top.titulo.includes(asunto), `A top notif titulo=${top?.titulo}`);
    assert(top.link === '/mensajes', `A top notif link=${top?.link}`);
  });

  // ── M2: inbox shows it + no-leidos ──────────────────────────────────────────
  await scenario('M2 GET /mensajes inbox lists M1 (unread)', async () => {
    const r = await get('/mensajes', A.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.mensajes), 'mensajes not array');
    assert(typeof r.body.total === 'number' && typeof r.body.pages === 'number' && typeof r.body.noLeidos === 'number', 'missing pagination fields');
    const m = r.body.mensajes.find((x: any) => x.id === msgMultiId);
    assert(!!m, 'M1 message not in A inbox');
    assert(m.leido === false, `M1 expected unread, leido=${m.leido}`);
    assert(await noLeidos(A.token) >= 1, 'A no-leidos expected >=1');
  });

  // ── M3: GET /mensajes/:id as recipient marks read ───────────────────────────
  await scenario('M3 GET /mensajes/:id (recipient) marks read', async () => {
    const before = await noLeidos(A.token);
    const r = await get(`/mensajes/${msgMultiId}`, A.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.id === msgMultiId, 'wrong message');
    assert(Array.isArray(r.body.destinatarios), 'destinatarios missing');
    assert(Array.isArray(r.body.respuestas), 'respuestas missing');
    const inbox = await get('/mensajes', A.token);
    const m = inbox.body.mensajes.find((x: any) => x.id === msgMultiId);
    assert(m && m.leido === true, `M1 should be read after GET detail, leido=${m?.leido}`);
    const after = await noLeidos(A.token);
    assert(after <= before, `no-leidos should not increase after read (${before}->${after})`);
  });

  // ── M4: responder (happy) + notif to sender + thread ────────────────────────
  await scenario('M4 POST /mensajes/:id/responder (recipient) -> 201 + notif to sender', async () => {
    const sBefore = await notifCount(sender.token);
    const r = await postMultipart(`/mensajes/${msgMultiId}/responder`, { cuerpo: 'respuesta de A' }, A.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.cuerpo === 'respuesta de A', `reply cuerpo=${r.body.cuerpo}`);
    assert(r.body.usuario && r.body.usuario.id === A.user.id, 'reply usuario mismatch');
    // sender notified
    const sAfter = await notifCount(sender.token);
    assert(sAfter >= sBefore + 1, `sender notif ${sBefore}->${sAfter} expected +>=1`);
    const sNotifs = await get('/notificaciones', sender.token);
    const top = sNotifs.body[0];
    assert(top && top.tipo === 'MENSAJE' && /Respuesta a/.test(top.titulo), `sender top notif titulo=${top?.titulo}`);
    // thread visible to sender
    const detail = await get(`/mensajes/${msgMultiId}`, sender.token);
    assertStatus(detail.status, 200, 'sender view thread');
    assert(detail.body.respuestas.some((x: any) => x.cuerpo === 'respuesta de A'), 'reply not on thread');
  });

  // ── M5: responder WITH file attaches archivo ────────────────────────────────
  await scenario('M5 responder with PNG file stores archivoUrl/Nombre', async () => {
    const r = await postMultipart(`/mensajes/${msgMultiId}/responder`, { cuerpo: 'respuesta con archivo' }, B.token,
      { data: PNG, name: 'evidencia.png', type: 'image/png' });
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.archivoNombre === 'evidencia.png', `archivoNombre=${r.body.archivoNombre}`);
    assert(typeof r.body.archivoUrl === 'string' && r.body.archivoUrl.startsWith('/uploads/'), `archivoUrl=${r.body.archivoUrl}`);
  });

  // ── M6: SECTOR broadcast with file + notif to C ─────────────────────────────
  await scenario('M6 POST /mensajes SECTOR broadcast (with file) -> 201, 3 recipients', async () => {
    const cBefore = await notifCount(Cc.token);
    const asunto = `M6 sector ${TS}`;
    const r = await postMultipart('/mensajes', {
      asunto, cuerpo: 'cuerpo sector', permiteRespuesta: 'false',
      destinoTipo: 'SECTOR', destinoValor: sectorId,
    }, sender.token, { data: PNG, name: 'aviso.png', type: 'image/png' });
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.destinatariosCount === 3, `destinatariosCount=${r.body.destinatariosCount} expected 3 (A,B,C)`);
    assert(r.body.esDifusion === true, 'SECTOR esDifusion expected true');
    assert(r.body.archivoNombre === 'aviso.png' && r.body.archivoUrl?.startsWith('/uploads/'), `file fields: ${r.body.archivoUrl}`);
    msgSectorId = r.body.id;
    const cAfter = await notifCount(Cc.token);
    assert(cAfter >= cBefore + 1, `C notif ${cBefore}->${cAfter} expected +>=1`);
    const cInbox = await get('/mensajes', Cc.token);
    assert(cInbox.body.mensajes.some((x: any) => x.id === msgSectorId), 'C did not receive SECTOR msg');
  });

  // ── M7: ROL broadcast (isolated custom rol) -> 3 recipients ─────────────────
  await scenario('M7 POST /mensajes ROL broadcast -> 201, 3 recipients', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `M7 rol ${TS}`, cuerpo: 'cuerpo rol', permiteRespuesta: 'false',
      destinoTipo: 'ROL', destinoValor: QAROL,
    }, sender.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.destinatariosCount === 3, `destinatariosCount=${r.body.destinatariosCount} expected 3`);
    msgRolId = r.body.id;
  });

  // ── M8: GET /mensajes/enviados (RRHH) ───────────────────────────────────────
  await scenario('M8 GET /mensajes/enviados lists sender messages', async () => {
    const r = await get('/mensajes/enviados', sender.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'enviados not array');
    const m = r.body.find((x: any) => x.id === msgMultiId);
    assert(!!m, 'msgMulti not in enviados');
    assert(m._count && typeof m._count.destinatarios === 'number' && typeof m._count.respuestas === 'number', 'missing _count');
    assert(m._count.respuestas >= 2, `expected >=2 respuestas, got ${m._count.respuestas}`);
  });

  // ── M9: PUT /mensajes/:id/leer marks read ───────────────────────────────────
  await scenario('M9 PUT /mensajes/:id/leer marks SECTOR msg read for B', async () => {
    const r = await put(`/mensajes/${msgSectorId}/leer`, {}, B.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.ok === true, 'expected ok:true');
    const inbox = await get('/mensajes', B.token);
    const m = inbox.body.mensajes.find((x: any) => x.id === msgSectorId);
    assert(m && m.leido === true, `SECTOR msg should be read for B, leido=${m?.leido}`);
  });

  // ── M10: PUT /mensajes/leer-todas zeroes unread ─────────────────────────────
  await scenario('M10 PUT /mensajes/leer-todas -> 0 unread', async () => {
    const r = await put('/mensajes/leer-todas', {}, Cc.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.ok === true, 'expected ok:true');
    assert(await noLeidos(Cc.token) === 0, 'C no-leidos should be 0 after leer-todas');
  });

  // ── Setup extra messages for negative tests ─────────────────────────────────
  {
    const r1 = await postMultipart('/mensajes', {
      asunto: `toA reply ${TS}`, cuerpo: 'x', permiteRespuesta: 'true',
      destinoTipo: 'USUARIO', destinoValor: A.user.id,
    }, sender.token);
    assertStatus(r1.status, 201, `setup msgToA_reply: ${JSON.stringify(r1.body)}`);
    msgToA_replyId = r1.body.id;
    assert(r1.body.esDifusion === false, `single-recipient USUARIO esDifusion expected false got ${r1.body.esDifusion}`);

    const r2 = await postMultipart('/mensajes', {
      asunto: `toA noreply ${TS}`, cuerpo: 'x', permiteRespuesta: 'false',
      destinoTipo: 'USUARIO', destinoValor: A.user.id,
    }, sender.token);
    assertStatus(r2.status, 201, `setup msgToA_noreply: ${JSON.stringify(r2.body)}`);
    msgToA_noreplyId = r2.body.id;
  }

  // ── NEGATIVE / AUTHZ ────────────────────────────────────────────────────────
  const operador = await login('franco.alvarez@demo.com'); // seed OPERADOR (nivel 10)
  assert(operador.user.rolNivel < 90, `franco nivel ${operador.user.rolNivel} expected <90`);

  await scenario('N1 OPERADOR POST /mensajes -> 403', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: 'nope', cuerpo: 'nope', destinoTipo: 'USUARIO', destinoValor: A.user.id,
    }, operador.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('N2 OPERADOR GET /mensajes/enviados -> 403', async () => {
    const r = await get('/mensajes/enviados', operador.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('N3 POST /mensajes missing asunto -> 400', async () => {
    const r = await postMultipart('/mensajes', {
      cuerpo: 'sin asunto', destinoTipo: 'USUARIO', destinoValor: A.user.id,
    }, sender.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('N4 POST /mensajes empty cuerpo -> 400', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: 'tiene asunto', cuerpo: '', destinoTipo: 'USUARIO', destinoValor: A.user.id,
    }, sender.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('N5 POST /mensajes SECTOR without destinoValor -> 400', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: 'a', cuerpo: 'b', destinoTipo: 'SECTOR',
    }, sender.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
    assert(/sector/i.test(JSON.stringify(r.body)), `expected sector msg, got ${JSON.stringify(r.body)}`);
  });

  await scenario('N6 POST /mensajes USUARIO non-existent recipient -> 400 (no destinatarios)', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: 'a', cuerpo: 'b', destinoTipo: 'USUARIO',
      destinoValor: '00000000-0000-0000-0000-000000000000',
    }, sender.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
    assert(/destinatario/i.test(JSON.stringify(r.body)), `expected destinatarios msg, got ${JSON.stringify(r.body)}`);
  });

  await scenario('N7 POST /mensajes invalid destinoTipo -> 400', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: 'a', cuerpo: 'b', destinoTipo: 'FOO', destinoValor: A.user.id,
    }, sender.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('N8 responder to message not addressed to you -> 403', async () => {
    const r = await postMultipart(`/mensajes/${msgToA_replyId}/responder`, { cuerpo: 'intruso' }, Cc.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('N9 responder when permiteRespuesta=false -> 400', async () => {
    const r = await postMultipart(`/mensajes/${msgToA_noreplyId}/responder`, { cuerpo: 'hola' }, A.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
    assert(/no permite/i.test(JSON.stringify(r.body)), `expected 'no permite respuestas', got ${JSON.stringify(r.body)}`);
  });

  await scenario('N10 responder empty cuerpo -> 400', async () => {
    const r = await postMultipart(`/mensajes/${msgToA_replyId}/responder`, { cuerpo: '' }, A.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('N11 responder to non-existent mensaje -> 404', async () => {
    const r = await postMultipart('/mensajes/00000000-0000-0000-0000-000000000000/responder', { cuerpo: 'x' }, A.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('N12 GET /mensajes/:id non-existent -> 404', async () => {
    const r = await get('/mensajes/00000000-0000-0000-0000-000000000000', A.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });

  await scenario('N13 GET /mensajes/:id without access -> 403', async () => {
    // C is not recipient/sender of msgToA_reply
    const r = await get(`/mensajes/${msgToA_replyId}`, Cc.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  // ── BUG HUNT: USUARIO self-send not excluded (asymmetry vs broadcast) ────────
  await scenario('B1 USUARIO send-to-self behaviour', async () => {
    const sBefore = await notifCount(sender.token);
    const r = await postMultipart('/mensajes', {
      asunto: `self ${TS}`, cuerpo: 'a mi mismo', permiteRespuesta: 'false',
      destinoTipo: 'USUARIO', destinoValor: sender.user.id,
    }, sender.token);
    // Broadcast types exclude the sender (id != remitenteId); USUARIO does NOT.
    // Document the actual behaviour.
    console.log(`     [B1] self-send status=${r.status} destinatariosCount=${r.body?.destinatariosCount} esDifusion=${r.body?.esDifusion}`);
    if (r.status === 201) {
      const sAfter = await notifCount(sender.token);
      console.log(`     [B1] sender self-notified: ${sBefore}->${sAfter}`);
      // assert the asymmetry is real
      assert(r.body.destinatariosCount === 1, `expected self as 1 recipient, got ${r.body.destinatariosCount}`);
    } else {
      // If it 400s like the broadcast types, there is no bug
      assertStatus(r.status, 400, JSON.stringify(r.body));
    }
  });

  // ── CLEANUP ─────────────────────────────────────────────────────────────────
  console.log(col('DIM', '\n  cleaning up...'));
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch { /* best effort */ }
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${col('CYAN', '=== SUMMARY ===')}`);
  console.log(`  total=${results.length} ${col('GREEN', `passed=${passed}`)} ${failed ? col('RED', `failed=${failed}`) : `failed=0`}`);
  if (failed) {
    for (const r of results.filter(x => !x.passed)) console.log(`  ${col('RED', 'FAIL')} ${r.name} :: ${r.detail}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(col('RED', 'FATAL'), e); process.exit(2); });
