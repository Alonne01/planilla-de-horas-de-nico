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

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'mensajes';
const TS = Date.now();

// Para AD2, el único caso que necesita mirar el disco (ver su comentario).
import { readdirSync } from 'node:fs';
import path from 'node:path';
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

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
type Archivo = { data: Uint8Array; name: string; type: string };
async function postMultipart(
  path: string,
  fields: Record<string, string>,
  tok?: string,
  archivos?: Archivo | Archivo[],
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  // Un mensaje puede llevar varios: el campo se repite, siempre con el mismo
  // nombre ('adjuntos'), que es lo que espera `upload.array`.
  for (const f of archivos ? (Array.isArray(archivos) ? archivos : [archivos]) : []) {
    form.append('adjuntos', new Blob([f.data], { type: f.type }), f.name);
  }
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
// PDF mínimo. El fileFilter mira extensión y mimetype, no el contenido, así que
// alcanza para probar que un adjunto no-imagen se tipa como ARCHIVO.
const PDF = Uint8Array.from(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1'));

// ── Auth ─────────────────────────────────────────────────────────────────────
interface Session {
  token: string;
  cookie: string;
  user: { id: string; nombre: string; apellido: string; email: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null };
}
async function login(email: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const body: any = await res.json();
  assertStatus(res.status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  // /uploads no mira el header Authorization: autentica con la cookie httpOnly
  // 'refreshToken', que es lo único que manda un <img> del navegador.
  const raw = res.headers.get('set-cookie') ?? '';
  const cookie = raw.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0]!.trim()).filter(Boolean).join('; ');
  return { token: body.accessToken, cookie, user: body.user };
}

/** GET a /uploads con la cookie de sesión, como lo haría el navegador. */
async function getUpload(url: string, ses: Session): Promise<number> {
  const res = await fetch(`${BASE.replace('/api/v1', '')}${url}`, { headers: { Cookie: ses.cookie } });
  return res.status;
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

  // El rol tiene que EXISTIR antes de asignarlo. `POST /usuarios` lo valida
  // contra RolConfig desde 4ecc71f (2026-06-26), como parte de la guardia
  // anti-escalada de privilegios: un código suelto da 400 "Rol inexistente".
  // Esta suite es del 2026-07-13, o sea que nació después de esa validación y
  // nunca la contempló: reventaba en el setup, antes de la primera aserción.
  // Nivel 10 = operador raso, para que A/B/C sean destinatarios y no
  // aprobadores. Se pushea el cleanup ANTES de crear los usuarios porque el
  // array se recorre con `.reverse()`: así el rol se borra después que ellos.
  const rolRes = await post('/admin/roles', {
    codigo: QAROL, nombre: `QA Mensajes ${TS}`, nivel: 10,
  }, admin.token);
  assertStatus(rolRes.status, 201, `create rol: ${JSON.stringify(rolRes.body)}`);
  const rolId: string = rolRes.body.id;
  cleanup.push(async () => { await del(`/admin/roles/${rolId}`, admin.token); });

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
  let adjuntoSectorUrl = '';
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
    // Un destinatario raso NO ve la lista del resto: es una difusión y enumerar
    // a los demás sería filtrar quién la recibió. La ve el remitente (o RRHH+),
    // y eso lo cubre M3b. Esta aserción pedía lo contrario y por eso la suite
    // nunca corrió verde desde que se agregó el ocultamiento en 7825e14.
    assert(r.body.destinatarios === undefined, `un destinatario raso no debería ver la lista: ${JSON.stringify(r.body.destinatarios)}`);
    assert(Array.isArray(r.body.respuestas), 'respuestas missing');
    const inbox = await get('/mensajes', A.token);
    const m = inbox.body.mensajes.find((x: any) => x.id === msgMultiId);
    assert(m && m.leido === true, `M1 should be read after GET detail, leido=${m?.leido}`);
    const after = await noLeidos(A.token);
    assert(after <= before, `no-leidos should not increase after read (${before}->${after})`);
  });

  // ── M4: responder (happy) + notif to sender + thread ────────────────────────
  // ── M3b: el otro lado del ocultamiento de M3 ────────────────────────────────
  await scenario('M3b GET /mensajes/:id (sender) DOES see destinatarios', async () => {
    const r = await get(`/mensajes/${msgMultiId}`, sender.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.destinatarios) && r.body.destinatarios.length > 0,
      `el remitente debería ver la lista: ${JSON.stringify(r.body.destinatarios)}`);
  });

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
  await scenario('M5 responder with PNG file stores adjunto', async () => {
    const r = await postMultipart(`/mensajes/${msgMultiId}/responder`, { cuerpo: 'respuesta con archivo' }, B.token,
      { data: PNG, name: 'evidencia.png', type: 'image/png' });
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(Array.isArray(r.body.adjuntos) && r.body.adjuntos.length === 1, `adjuntos=${JSON.stringify(r.body.adjuntos)}`);
    const a = r.body.adjuntos[0];
    assert(a.nombre === 'evidencia.png', `nombre=${a.nombre}`);
    assert(typeof a.url === 'string' && a.url.startsWith('/uploads/'), `url=${a.url}`);
    // El tipo sale del mimetype, no de la extensión.
    assert(a.tipo === 'IMAGEN', `tipo=${a.tipo}`);
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
    assert(r.body.adjuntos?.length === 1 && r.body.adjuntos[0].nombre === 'aviso.png'
      && r.body.adjuntos[0].url?.startsWith('/uploads/'), `adjuntos: ${JSON.stringify(r.body.adjuntos)}`);
    msgSectorId = r.body.id;
    adjuntoSectorUrl = r.body.adjuntos[0].url;
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
  const operador = await login('op1.almacen@test.wenlen.com'); // seed OPERADOR (nivel 10)
  assert(operador.user.rolNivel < 90, `franco nivel ${operador.user.rolNivel} expected <90`);

  // ── U1/U2: quién puede abrir el adjunto por URL directa ─────────────────────
  // El adjunto ya no se resuelve por la columna `archivo_url` del mensaje sino
  // por la tabla `mensaje_adjuntos`. Es el camino que decide si un comunicado
  // interno se puede leer adivinando el nombre del archivo, así que se prueba
  // con los dos lados: alguien de la difusión y alguien ajeno.
  await scenario('U1 recipient opens the message attachment -> 200', async () => {
    assert(adjuntoSectorUrl !== '', 'M6 no dejó la URL del adjunto');
    const status = await getUpload(adjuntoSectorUrl, Cc);
    assertStatus(status, 200, `destinatario no pudo abrir ${adjuntoSectorUrl}`);
  });

  // 404 y no 403 a propósito (ver app.ts): así la respuesta no sirve para
  // confirmar que el archivo existe ni de quién es.
  await scenario('U2 non-recipient cannot open the message attachment -> 404', async () => {
    assert(adjuntoSectorUrl !== '', 'M6 no dejó la URL del adjunto');
    const status = await getUpload(adjuntoSectorUrl, operador);
    assertStatus(status, 404, `un ajeno abrió ${adjuntoSectorUrl}`);
  });

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

  // ═══ DIFUSIÓN SEGMENTADA ════════════════════════════════════════════════════
  //
  // Cada remitente tiene un ALCANCE MÁXIMO y todo se deriva de ahí. Lo que estos
  // casos cuidan es el borde: que un coordinador NO pueda escribirle a otro
  // sector ni siquiera pasando el id a mano, y que un gerente general —que no
  // tiene sector porque su alcance es la empresa— sí pueda.
  const secBRes = await post('/admin/sectores', { nombre: `qa.${KEY}.B.${TS}`, color: '#654321' }, admin.token);
  assertStatus(secBRes.status, 201, `create sector B: ${JSON.stringify(secBRes.body)}`);
  const sectorBId: string = secBRes.body.id;
  cleanup.push(async () => { await del(`/admin/sectores/${sectorBId}`, admin.token); });

  const D = await makeUser('d', QAROL, sectorBId);          // destinatario del sector B
  const coord = await makeUser('coord', 'COORDINADOR', sectorId);
  const cmass = await makeUser('cmass', 'CMASS', sectorId);
  const gerente = await makeUser('ger', 'GERENTE', null);   // gerente general: sin sector a propósito
  const supervisor = await makeUser('sup', 'SUPERVISOR', sectorId);
  console.log(`\n  coord=${coord.user.rolNivel} cmass=${cmass.user.rolNivel} gerente=${gerente.user.rolNivel} sup=${supervisor.user.rolNivel} sectorB=${sectorBId}\n`);

  /** Los ids de los destinatarios de un mensaje, mirándolo como su remitente. */
  async function destinatariosDe(mensajeId: string, remitente: Session): Promise<string[]> {
    const r = await get(`/mensajes/${mensajeId}`, remitente.token);
    assertStatus(r.status, 200, `ver ${mensajeId}: ${JSON.stringify(r.body)}`);
    assert(Array.isArray(r.body.destinatarios), 'el remitente debería ver la lista');
    return r.body.destinatarios.map((d: any) => d.usuarioId);
  }

  await scenario('D1 COORDINADOR SECTOR -> llega a su sector y a nadie de B', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D1 ${TS}`, cuerpo: 'para mi sector', destinoTipo: 'SECTOR', destinoValor: sectorId,
    }, coord.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const ids = await destinatariosDe(r.body.id, coord);
    assert(ids.includes(A.user.id) && ids.includes(B.user.id), `faltan A/B: ${ids.length}`);
    assert(!ids.includes(D.user.id), 'llegó a alguien del sector B');
    assert(!ids.includes(coord.user.id), 'el remitente se auto-incluyó');
  });

  await scenario('D2 COORDINADOR TODOS -> 403 y ROL -> 403', async () => {
    const todos = await postMultipart('/mensajes', {
      asunto: `D2a ${TS}`, cuerpo: 'x', destinoTipo: 'TODOS',
    }, coord.token);
    assertStatus(todos.status, 403, JSON.stringify(todos.body));
    const rol = await postMultipart('/mensajes', {
      asunto: `D2b ${TS}`, cuerpo: 'x', destinoTipo: 'ROL', destinoValor: QAROL,
    }, coord.token);
    assertStatus(rol.status, 403, JSON.stringify(rol.body));
  });

  await scenario('D3 COORDINADOR SECTOR ajeno -> 403', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D3 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorBId,
    }, coord.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('D4 COORDINADOR USUARIO de otro sector -> 400 sin destinatarios', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D4 ${TS}`, cuerpo: 'x', destinoTipo: 'USUARIO', destinoValor: D.user.id,
    }, coord.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('D5 COORDINADOR TURNO -> sólo los de ese turno', async () => {
    // A/B/C se crean sin diagrama asignado, así que su clave de turno es 'SIN'.
    // El cálculo de las claves ROTATIVO/FIJO_SEMANA lo cubre turnos.test.ts; acá
    // se prueba el cableado: agrupar el alcance y filtrar por la clave elegida.
    const grupos = await get('/mensajes/grupos-difusion', coord.token);
    assertStatus(grupos.status, 200, JSON.stringify(grupos.body));
    assert(grupos.body.alcance === 'SECTOR', `alcance=${grupos.body.alcance}`);
    const sinDiagrama = grupos.body.turnos.find((t: any) => t.clave === 'SIN');
    assert(sinDiagrama && sinDiagrama.cantidad >= 3, `grupo SIN: ${JSON.stringify(grupos.body.turnos)}`);

    const r = await postMultipart('/mensajes', {
      asunto: `D5 ${TS}`, cuerpo: 'x', destinoTipo: 'TURNO', destinoValor: 'SIN',
    }, coord.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const ids = await destinatariosDe(r.body.id, coord);
    assert(ids.includes(A.user.id), 'no llegó a A');
    assert(!ids.includes(D.user.id), 'llegó a alguien del sector B');
  });

  await scenario('D6 COORDINADOR TURNO inexistente -> 400 sin destinatarios', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D6 ${TS}`, cuerpo: 'x', destinoTipo: 'TURNO', destinoValor: 'R|99|99|0',
    }, coord.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('D7 CMASS elige: TODOS llega a los dos sectores', async () => {
    const grupos = await get('/mensajes/grupos-difusion', cmass.token);
    assertStatus(grupos.status, 200, JSON.stringify(grupos.body));
    assert(grupos.body.alcance === 'EMPRESA', `CMASS alcance=${grupos.body.alcance}`);
    const r = await postMultipart('/mensajes', {
      asunto: `D7 ${TS}`, cuerpo: 'x', destinoTipo: 'TODOS',
    }, cmass.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const ids = await destinatariosDe(r.body.id, cmass);
    assert(ids.includes(A.user.id) && ids.includes(D.user.id), 'TODOS no cruzó los sectores');
  });

  await scenario('D8 CMASS SECTOR ajeno -> sólo ese sector', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D8 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorBId,
    }, cmass.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const ids = await destinatariosDe(r.body.id, cmass);
    assert(ids.includes(D.user.id), 'no llegó a B');
    assert(!ids.includes(A.user.id), 'se filtró a alguien del sector A');
  });

  await scenario('D9 GERENTE sin sector es transversal: SECTOR B -> llega a B', async () => {
    const grupos = await get('/mensajes/grupos-difusion', gerente.token);
    assertStatus(grupos.status, 200, JSON.stringify(grupos.body));
    assert(grupos.body.alcance === 'EMPRESA', `gerente general alcance=${grupos.body.alcance}`);
    assert(grupos.body.sectorPropio === null, `sectorPropio=${grupos.body.sectorPropio}`);
    const r = await postMultipart('/mensajes', {
      asunto: `D9 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorBId,
    }, gerente.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const ids = await destinatariosDe(r.body.id, gerente);
    assert(ids.includes(D.user.id), 'el gerente general no alcanzó al sector B');
  });

  await scenario('D10 GERENTE (nivel 80) ROL -> 403, reservado a nivel >= 90', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D10 ${TS}`, cuerpo: 'x', destinoTipo: 'ROL', destinoValor: QAROL,
    }, gerente.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('D11 SUPERVISOR (nivel 60) no difunde -> 403', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `D11 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorId,
    }, supervisor.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
    const grupos = await get('/mensajes/grupos-difusion', supervisor.token);
    assertStatus(grupos.status, 403, JSON.stringify(grupos.body));
  });

  // ── ADJUNTOS MÚLTIPLES ──────────────────────────────────────────────────────
  await scenario('AD1 un mensaje con imagen Y PDF devuelve los dos, tipados', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `AD1 ${TS}`, cuerpo: 'con dos adjuntos', destinoTipo: 'SECTOR', destinoValor: sectorId,
    }, coord.token, [
      { data: PNG, name: 'foto.png', type: 'image/png' },
      { data: PDF, name: 'instructivo.pdf', type: 'application/pdf' },
    ]);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    const detalle = await get(`/mensajes/${r.body.id}`, coord.token);
    const adj: any[] = detalle.body.adjuntos;
    assert(Array.isArray(adj) && adj.length === 2, `adjuntos=${JSON.stringify(adj)}`);
    const img = adj.find(a => a.nombre === 'foto.png');
    const pdf = adj.find(a => a.nombre === 'instructivo.pdf');
    assert(img?.tipo === 'IMAGEN', `foto.png tipo=${img?.tipo}`);
    assert(pdf?.tipo === 'ARCHIVO', `instructivo.pdf tipo=${pdf?.tipo}`);
    assert(img.tamanioBytes > 0, `tamanioBytes=${img.tamanioBytes}`);
  });

  await scenario('AD2 un rechazo no deja los archivos en disco', async () => {
    // El destino es ajeno, así que da 403 DESPUÉS de que multer ya escribió el
    // archivo. Si la ruta no lo descarta, cada intento fallido deja basura.
    //
    // Se cuenta el directorio, que es lo único que prueba el borrado: la
    // respuesta HTTP se ve igual con o sin limpieza. Vale porque la suite corre
    // en la misma máquina que la API; si algún día no fuera así, este caso hay
    // que moverlo a un test de integración.
    const antes = readdirSync(UPLOADS_DIR).length;
    // Si la ruta apuntara al directorio equivocado, el caso pasaría contando
    // 0 == 0 sin probar nada. AD1 acaba de subir dos archivos, así que no puede
    // estar vacío.
    assert(antes > 0, `UPLOADS_DIR vacío o mal resuelto: ${UPLOADS_DIR}`);
    const r = await postMultipart('/mensajes', {
      asunto: `AD2 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorBId,
    }, coord.token, { data: PNG, name: 'huerfana.png', type: 'image/png' });
    assertStatus(r.status, 403, JSON.stringify(r.body));
    const despues = readdirSync(UPLOADS_DIR).length;
    assert(despues === antes, `quedaron ${despues - antes} archivos huérfanos en uploads/`);
  });

  // ── CONFIRMACIÓN DE RECEPCIÓN ───────────────────────────────────────────────
  let msgConfirmaId = '';
  await scenario('C1 sin requiereConfirmacion, confirmar -> 400', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `C1 ${TS}`, cuerpo: 'x', destinoTipo: 'SECTOR', destinoValor: sectorId,
    }, coord.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.requiereConfirmacion === false, `requiereConfirmacion=${r.body.requiereConfirmacion}`);
    const c = await post(`/mensajes/${r.body.id}/confirmar`, {}, A.token);
    assertStatus(c.status, 400, JSON.stringify(c.body));
  });

  await scenario('C2 con requiereConfirmacion: confirma, repite y no cambia la fecha', async () => {
    const r = await postMultipart('/mensajes', {
      asunto: `C2 ${TS}`, cuerpo: 'acusar recibo', destinoTipo: 'SECTOR', destinoValor: sectorId,
      requiereConfirmacion: 'true',
    }, coord.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.requiereConfirmacion === true, 'no se guardó el flag');
    msgConfirmaId = r.body.id;

    const primera = await post(`/mensajes/${msgConfirmaId}/confirmar`, {}, A.token);
    assertStatus(primera.status, 200, JSON.stringify(primera.body));
    assert(!!primera.body.confirmadoAt, 'no devolvió la fecha');

    // Idempotente: reconfirmar no puede mover el dato que se quiere conservar.
    const segunda = await post(`/mensajes/${msgConfirmaId}/confirmar`, {}, A.token);
    assertStatus(segunda.status, 200, JSON.stringify(segunda.body));
    assert(segunda.body.confirmadoAt === primera.body.confirmadoAt,
      `la fecha se movió: ${primera.body.confirmadoAt} -> ${segunda.body.confirmadoAt}`);
  });

  await scenario('C3 un ajeno no puede confirmar -> 403', async () => {
    const r = await post(`/mensajes/${msgConfirmaId}/confirmar`, {}, D.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('C4 el remitente ve quién confirmó y quién no', async () => {
    const r = await get(`/mensajes/${msgConfirmaId}`, coord.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    const dests: any[] = r.body.destinatarios;
    const deA = dests.find(d => d.usuarioId === A.user.id);
    const deB = dests.find(d => d.usuarioId === B.user.id);
    assert(!!deA?.confirmadoAt, 'A confirmó y no figura');
    assert(deB && deB.confirmadoAt === null, `B no confirmó y figura: ${deB?.confirmadoAt}`);
    assert(!!deA.usuario?.apellido, 'falta el nombre para mostrar la lista');
  });

  await scenario('C5 /no-leidos cuenta lo pendiente de confirmar aparte', async () => {
    // B no confirmó. Leer no confirma: son dos estados distintos.
    await put(`/mensajes/${msgConfirmaId}/leer`, {}, B.token);
    const r = await get('/mensajes/no-leidos', B.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(typeof r.body.pendientesConfirmacion === 'number', `falta pendientesConfirmacion: ${JSON.stringify(r.body)}`);
    assert(r.body.pendientesConfirmacion >= 1, `leído pero sin confirmar debería seguir pendiente: ${r.body.pendientesConfirmacion}`);
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
