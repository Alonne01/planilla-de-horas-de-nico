/**
 * QA Suite — WENTOP subsystem (KEY=wentop)
 * Black-box HTTP tests against http://localhost:4000/api/v1
 * Covers: gestores CRUD + guards, cards CRUD + state workflow + visibility, fotos upload/delete, analytics.
 *
 * Run: cd apps/api && npx tsx tests/qa/wentop.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'wentop';
const TS = Date.now();

// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

// ── output ───────────────────────────────────────
const C: Record<string, string> = { R: '\x1b[0m', G: '\x1b[32m', RED: '\x1b[31m', Y: '\x1b[33m', CY: '\x1b[36m', D: '\x1b[2m' };
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];
const bugs: string[] = [];

function log(sym: string, msg: string) { process.stdout.write(`  ${sym} ${msg}\n`); }
async function scenario(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try { await fn(); results.push({ name, passed: true, detail: 'OK' }); log(`${C.G}PASS${C.R}`, `${name} (${Date.now() - t}ms)`); }
  catch (e) { const d = e instanceof Error ? e.message : String(e); results.push({ name, passed: false, detail: d }); log(`${C.RED}FAIL${C.R}`, `${name} — ${d}`); }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') { if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`); }

// ── HTTP ─────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body: body as any };
}
const get = (p: string, t?: string) => api('GET', p, { token: t });
const post = (p: string, b: unknown, t?: string) => api('POST', p, { token: t, body: b });
const put = (p: string, b: unknown, t?: string) => api('PUT', p, { token: t, body: b });
const patch = (p: string, b: unknown, t?: string) => api('PATCH', p, { token: t, body: b });
const del = (p: string, t?: string) => api('DELETE', p, { token: t });

async function uploadFotos(path: string, token: string, files: { name: string; buf: Buffer; type: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append('fotos', new Blob([f.buf], { type: f.type }), f.name);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body: body as any };
}

interface Session { token: string; user: any; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  assert(typeof body.accessToken === 'string', 'No accessToken');
  return { token: body.accessToken, user: body.user };
}

// ═════════════════════════════════════════════════
async function main() {
  console.log(C.CY + '\n=== WENTOP QA SUITE ===' + C.R);

  const admin = await login('admin@wenlen.com');
  log('i', `admin nivel=${admin.user.rolNivel} empresa=${admin.user.empresaId}`);

  // discover users + sectors
  const du = await get('/auth/debug-users', admin.token);
  assertStatus(du.status, 200, 'debug-users');
  const allUsers: any[] = du.body;
  const cmassU = allUsers.find((u) => u.rol === 'CMASS');
  assert(!!cmassU, 'No CMASS seed user found');

  const ul = await get('/usuarios', admin.token);
  assertStatus(ul.status, 200, 'usuarios list');
  const sectorMap = new Map<string, string>();
  for (const u of ul.body) if (u.sector?.id) sectorMap.set(u.sector.id, u.sector.nombre);
  const sectorIds = [...sectorMap.keys()];
  assert(sectorIds.length >= 2, `Need >=2 sectors, got ${sectorIds.length}`);
  const sectorA = sectorIds[0];
  const sectorB = sectorIds[1];
  log('i', `sectorA=${sectorMap.get(sectorA)} sectorB=${sectorMap.get(sectorB)}`);

  const cmass = await login(cmassU.email);
  log('i', `cmass(${cmassU.email}) nivel=${cmass.user.rolNivel}`);

  // create two dedicated operators in distinct sectors
  async function mkUser(suffix: string, sectorId: string): Promise<Session> {
    const email = `qa.${KEY}.${TS}.${suffix}@demo.com`;
    const r = await post('/usuarios', {
      nombre: `QA${KEY}`, apellido: suffix, email, password: 'Test1234!', rol: 'OPERADOR',
      sectorId, fechaIngreso: new Date().toISOString(),
    }, admin.token);
    assertStatus(r.status, 201, `create user ${suffix}: ${JSON.stringify(r.body)}`);
    cleanup.push(async () => { await put(`/usuarios/${r.body.id}`, { activo: false }, admin.token); });
    const s = await login(email);
    return s;
  }
  const owner = await mkUser('owner', sectorA);   // creator, in sectorA
  const foreign = await mkUser('foreign', sectorB); // unrelated, in sectorB
  log('i', `owner nivel=${owner.user.rolNivel} foreign nivel=${foreign.user.rolNivel}`);

  // ─────────── GESTORES ───────────
  console.log(C.CY + '\n-- Gestores --' + C.R);

  await scenario('G1 GET /gestores as OPERADOR -> 403', async () => {
    const r = await get('/wentop/gestores', owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('G2 GET /gestores as CMASS -> 200 array', async () => {
    const r = await get('/wentop/gestores', cmass.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body), 'not array');
  });
  await scenario('G3 GET /gestores as ADMIN -> 200', async () => {
    const r = await get('/wentop/gestores', admin.token);
    assertStatus(r.status, 200);
  });
  await scenario('G4 POST /gestores as CMASS(75) -> 403 (needs RRHH 90)', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: sectorB }, cmass.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('G5 POST /gestores as OPERADOR -> 403', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: sectorB }, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('G6 POST /gestores missing fields -> 400', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('G7 POST /gestores bad usuarioId -> 400', async () => {
    const r = await post('/wentop/gestores', { usuarioId: '00000000-0000-0000-0000-000000000000', sectorId: sectorB }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('G8 POST /gestores bad sectorId -> 400', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: '00000000-0000-0000-0000-000000000000' }, admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  let gestorId = '';
  await scenario('G9 POST /gestores valid -> 201', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: sectorB }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    gestorId = r.body.id;
    cleanup.push(async () => { await del(`/wentop/gestores/${gestorId}`, admin.token); });
  });
  await scenario('G10 POST /gestores duplicate -> 201 (upsert idempotent)', async () => {
    const r = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: sectorB }, admin.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
  });
  await scenario('G11 GET /mis-gestores as owner includes sectorB', async () => {
    const r = await get('/wentop/mis-gestores', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body) && r.body.includes(sectorB), `expected sectorB in ${JSON.stringify(r.body)}`);
  });
  await scenario('G12 DELETE /gestores as OPERADOR -> 403', async () => {
    const r = await del(`/wentop/gestores/${gestorId}`, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('G13 DELETE /gestores nonexistent -> 404', async () => {
    const r = await del('/wentop/gestores/00000000-0000-0000-0000-000000000000', admin.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });
  await scenario('G14 DELETE /gestores valid -> 204', async () => {
    const r = await del(`/wentop/gestores/${gestorId}`, admin.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });
  await scenario('G15 GET /mis-gestores after delete excludes sectorB', async () => {
    const r = await get('/wentop/mis-gestores', owner.token);
    assertStatus(r.status, 200);
    assert(!r.body.includes(sectorB), `sectorB should be gone: ${JSON.stringify(r.body)}`);
  });

  // ─────────── CARDS ───────────
  console.log(C.CY + '\n-- Cards --' + C.R);
  const goodCard = { fechaReporte: new Date().toISOString(), tipoTarjeta: 'CONDICION_INSEGURA', descripcion: `qa-${KEY}-${TS}` };

  await scenario('C1 POST /wentop missing descripcion -> 400', async () => {
    const r = await post('/wentop', { fechaReporte: goodCard.fechaReporte, tipoTarjeta: 'CONDICION_INSEGURA' }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('C2 POST /wentop invalid tipoTarjeta -> 400', async () => {
    const r = await post('/wentop', { ...goodCard, tipoTarjeta: 'NOPE' }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  let cardId = '';
  await scenario('C3 POST /wentop valid -> 201 estado ABIERTA', async () => {
    const r = await post('/wentop', { ...goodCard, sectorObservacionId: sectorA, calidad: ['Orden y limpieza'] }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.estado === 'ABIERTA', `estado=${r.body.estado}`);
    assert(r.body.creadorId === owner.user.id, 'creador mismatch');
    cardId = r.body.id;
    cleanup.push(async () => { await del(`/wentop/${cardId}`, admin.token); });
  });
  let nullSectorCard = '';
  await scenario('C4 POST /wentop without sectorObservacion -> 201', async () => {
    const r = await post('/wentop', { ...goodCard, tipoTarjeta: 'OBSERVACION_POSITIVA' }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(r.body.sectorObservacionId === null, 'expected null sector');
    nullSectorCard = r.body.id;
    cleanup.push(async () => { await del(`/wentop/${nullSectorCard}`, admin.token); });
  });
  await scenario('C5 GET /wentop/:id as creator -> 200', async () => {
    const r = await get(`/wentop/${cardId}`, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.fotos), 'no fotos array in detail');
  });
  await scenario('C6 GET /wentop list as creator includes card', async () => {
    const r = await get('/wentop', owner.token);
    assertStatus(r.status, 200);
    assert(r.body.tarjetas.some((t: any) => t.id === cardId), 'card not in list');
  });
  await scenario('C7 GET /wentop?estado filter', async () => {
    const a = await get('/wentop?estado=ABIERTA', owner.token);
    assertStatus(a.status, 200);
    assert(a.body.tarjetas.some((t: any) => t.id === cardId), 'ABIERTA filter missing card');
    const c = await get('/wentop?estado=CERRADA', owner.token);
    assertStatus(c.status, 200);
    assert(!c.body.tarjetas.some((t: any) => t.id === cardId), 'CERRADA filter wrongly includes card');
  });
  await scenario('C8 GET /wentop?tipoTarjeta filter', async () => {
    const r = await get('/wentop?tipoTarjeta=CONDICION_INSEGURA', owner.token);
    assertStatus(r.status, 200);
    assert(r.body.tarjetas.some((t: any) => t.id === cardId), 'tipo filter missing card');
    assert(r.body.tarjetas.every((t: any) => t.tipoTarjeta === 'CONDICION_INSEGURA'), 'tipo filter leaked other types');
  });
  await scenario('C9 GET /wentop?sectorId filter', async () => {
    const r = await get(`/wentop?sectorId=${sectorA}`, owner.token);
    assertStatus(r.status, 200);
    assert(r.body.tarjetas.some((t: any) => t.id === cardId), 'sector filter missing card');
  });
  await scenario('C10 [ISOLATION] GET /wentop/:id as foreign-sector user -> 404', async () => {
    const r = await get(`/wentop/${cardId}`, foreign.token);
    assertStatus(r.status, 404, `LEAK: foreign user saw card from another sector: ${JSON.stringify(r.body)}`);
  });
  await scenario('C10b [ISOLATION] foreign list excludes card', async () => {
    const r = await get('/wentop', foreign.token);
    assertStatus(r.status, 200);
    assert(!r.body.tarjetas.some((t: any) => t.id === cardId), 'LEAK: card visible in foreign list');
  });
  await scenario('C11 GET /wentop/:id nonexistent -> 404', async () => {
    const r = await get('/wentop/00000000-0000-0000-0000-000000000000', owner.token);
    assertStatus(r.status, 404);
  });
  await scenario('C12 PUT /wentop/:id as foreign user -> 403', async () => {
    const r = await put(`/wentop/${cardId}`, { descripcion: 'hack' }, foreign.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('C13 PUT /wentop/:id as creator -> 200', async () => {
    const r = await put(`/wentop/${cardId}`, { descripcion: `qa-${KEY}-edited`, recomendaciones: 'usar EPP' }, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.descripcion === `qa-${KEY}-edited`, 'descripcion not updated');
  });

  // PROBE: PUT with invalid tipoTarjeta (POST validates this, PUT does not)
  await scenario('C14 [PROBE] PUT invalid tipoTarjeta -> expect 400 (not 500)', async () => {
    const r = await put(`/wentop/${cardId}`, { tipoTarjeta: 'TOTALLY_INVALID' }, owner.token);
    if (r.status === 500) bugs.push(`C14: PUT invalid tipoTarjeta returned 500 — body=${JSON.stringify(r.body)}`);
    assertStatus(r.status, 400, `actual body=${JSON.stringify(r.body)}`);
  });

  // ── state workflow ──
  await scenario('C15 PATCH estado invalid value -> 400', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'PENDIENTE' }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('C16 PATCH estado CERRADA without accionCierre -> 400', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'CERRADA' }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('C17 PATCH estado -> EN_PROGRESO -> 200', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'EN_PROGRESO' }, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.estado === 'EN_PROGRESO', `estado=${r.body.estado}`);
  });
  await scenario('C18 PATCH estado -> CERRADA with accionCierre -> 200 fechaCierre set', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'CERRADA', accionCierre: 'corregido' }, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.estado === 'CERRADA' && r.body.accionCierre === 'corregido', 'closure fields not set');
    assert(!!r.body.fechaCierre, 'fechaCierre missing on close');
    // El PATCH de arriba NO manda `fechaCierre`, así que esto cubre el valor por
    // defecto del servidor. `fecha_cierre` es una FECHA-DÍA (la migración
    // 20260727173000_normalizar_fechas_dia la trunca junto con `fecha_reporte`),
    // así que tiene que salir a medianoche UTC. Con el `new Date()` que había
    // antes salía la hora del cierre, y cerrar entre las 21:00 y las 24:00
    // argentinas caía en la ventana (00:00, 03:00) UTC que el encabezado de esa
    // migración declara como precondición a revalidar.
    assert(String(r.body.fechaCierre).endsWith('T00:00:00.000Z'),
      `fechaCierre no es una fecha-día normalizada: ${r.body.fechaCierre}`);
  });
  await scenario('C19 PUT on CERRADA card as creator(low) -> 400', async () => {
    const r = await put(`/wentop/${cardId}`, { descripcion: 'edit-closed' }, owner.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('C20 PUT on CERRADA card as ADMIN -> 200 (override)', async () => {
    const r = await put(`/wentop/${cardId}`, { descripcion: `qa-${KEY}-admin-edit` }, admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
  });
  await scenario('C21 PATCH estado as foreign user -> 403', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'ABIERTA' }, foreign.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  // reopen (clears closure) — verify
  await scenario('C22 PATCH reopen CERRADA->ABIERTA clears closure', async () => {
    const r = await patch(`/wentop/${cardId}/estado`, { estado: 'ABIERTA' }, owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.estado === 'ABIERTA', `estado=${r.body.estado}`);
    assert(r.body.accionCierre === null && r.body.fechaCierre === null, 'closure not cleared on reopen');
  });

  // DELETE rules
  let delCard = '';
  await scenario('C23 create + move to EN_PROGRESO + creator DELETE -> 403 (only ABIERTA)', async () => {
    const cr = await post('/wentop', { ...goodCard, sectorObservacionId: sectorA }, owner.token);
    assertStatus(cr.status, 201, JSON.stringify(cr.body));
    delCard = cr.body.id;
    cleanup.push(async () => { await del(`/wentop/${delCard}`, admin.token); });
    const mv = await patch(`/wentop/${delCard}/estado`, { estado: 'EN_PROGRESO' }, owner.token);
    assertStatus(mv.status, 200);
    const dr = await del(`/wentop/${delCard}`, owner.token);
    assertStatus(dr.status, 403, JSON.stringify(dr.body));
  });
  await scenario('C24 foreign DELETE ABIERTA card -> 403', async () => {
    const r = await del(`/wentop/${nullSectorCard}`, foreign.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('C25 creator DELETE own ABIERTA card -> 204', async () => {
    const r = await del(`/wentop/${nullSectorCard}`, owner.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });
  await scenario('C26 ADMIN DELETE non-ABIERTA card -> 204', async () => {
    const r = await del(`/wentop/${delCard}`, admin.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });

  // PROBE: invalid fechaReporte on create
  await scenario('C27 [PROBE] POST invalid fechaReporte -> expect 400 (not 500)', async () => {
    const r = await post('/wentop', { fechaReporte: 'not-a-date', tipoTarjeta: 'CONDICION_INSEGURA', descripcion: 'x' }, owner.token);
    if (r.status === 500) bugs.push(`C27: POST invalid fechaReporte returned 500 — body=${JSON.stringify(r.body)}`);
    if (r.status === 201) { cleanup.push(async () => { await del(`/wentop/${r.body.id}`, admin.token); }); }
    assertStatus(r.status, 400, `actual=${r.status} body=${JSON.stringify(r.body)}`);
  });
  // PROBE: invalid query date on list
  await scenario('C28 [PROBE] GET /wentop?desde=garbage -> expect 200/400 (not 500)', async () => {
    const r = await get('/wentop?desde=garbage', owner.token);
    if (r.status === 500) bugs.push(`C28: GET ?desde=garbage returned 500 — body=${JSON.stringify(r.body)}`);
    assert(r.status !== 500, `500 on invalid query date: ${JSON.stringify(r.body)}`);
  });

  // ─────────── ANALYTICS ───────────
  console.log(C.CY + '\n-- Analytics --' + C.R);
  await scenario('A1 GET /wentop/analytics as owner -> 200 shape', async () => {
    const r = await get('/wentop/analytics', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    const b = r.body;
    assert(b.totales && typeof b.totales.total === 'number', 'no totales.total');
    assert(Array.isArray(b.porTipo) && Array.isArray(b.porSector) && Array.isArray(b.porMes), 'missing arrays');
    assert(b.porCategoria && Array.isArray(b.porCategoria.calidad), 'no porCategoria.calidad');
  });
  await scenario('A2 GET /wentop/analytics as admin -> 200', async () => {
    const r = await get('/wentop/analytics', admin.token);
    assertStatus(r.status, 200);
    assert(r.body.totales.total >= 0, 'bad total');
  });

  // ─────────── FOTOS ───────────
  console.log(C.CY + '\n-- Fotos --' + C.R);
  // fresh ABIERTA card for foto tests
  let fotoCard = '';
  await scenario('F0 create card for fotos', async () => {
    const r = await post('/wentop', { ...goodCard, sectorObservacionId: sectorA }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    fotoCard = r.body.id;
    cleanup.push(async () => { await del(`/wentop/${fotoCard}`, admin.token); });
  });
  let fotoId = '';
  await scenario('F1 POST /:id/fotos with PNG as creator -> 201', async () => {
    const r = await uploadFotos(`/wentop/${fotoCard}/fotos`, owner.token, [{ name: 't.png', buf: PNG_BUF, type: 'image/png' }]);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    assert(Array.isArray(r.body) && r.body.length === 1 && typeof r.body[0].url === 'string', 'bad foto resp');
    fotoId = r.body[0].id;
  });
  await scenario('F2 GET detail shows uploaded foto', async () => {
    const r = await get(`/wentop/${fotoCard}`, owner.token);
    assertStatus(r.status, 200);
    assert(r.body.fotos.some((f: any) => f.id === fotoId), 'foto not in detail');
  });
  await scenario('F3 POST /:id/fotos with no files -> 400', async () => {
    const r = await uploadFotos(`/wentop/${fotoCard}/fotos`, owner.token, []);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });
  await scenario('F4 POST /:id/fotos as foreign user -> 403', async () => {
    const r = await uploadFotos(`/wentop/${fotoCard}/fotos`, foreign.token, [{ name: 't.png', buf: PNG_BUF, type: 'image/png' }]);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('F5 POST /:id/fotos to nonexistent card -> 404', async () => {
    const r = await uploadFotos('/wentop/00000000-0000-0000-0000-000000000000/fotos', owner.token, [{ name: 't.png', buf: PNG_BUF, type: 'image/png' }]);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });
  await scenario('F6 DELETE foto nonexistent -> 404', async () => {
    const r = await del(`/wentop/${fotoCard}/fotos/00000000-0000-0000-0000-000000000000`, owner.token);
    assertStatus(r.status, 404, JSON.stringify(r.body));
  });
  await scenario('F7 DELETE foto as foreign user -> 403', async () => {
    const r = await del(`/wentop/${fotoCard}/fotos/${fotoId}`, foreign.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });
  await scenario('F8 DELETE foto as creator -> 204', async () => {
    const r = await del(`/wentop/${fotoCard}/fotos/${fotoId}`, owner.token);
    assertStatus(r.status, 204, JSON.stringify(r.body));
  });

  // ─────────── ALCANCE DEL TABLERO ───────────
  console.log(C.CY + '\n-- Alcance del tablero --' + C.R);

  // Una tarjeta de `owner` (sector A) sobre el sector B. Es el caso que separa el
  // alcance del LISTADO del alcance del TABLERO.
  let cruzada = '';
  await scenario('A0 owner crea una tarjeta sobre el sector B', async () => {
    const r = await post('/wentop', { ...goodCard, sectorObservacionId: sectorB, descripcion: `qa-${KEY}-${TS}-cruzada` }, owner.token);
    assertStatus(r.status, 201, JSON.stringify(r.body));
    cruzada = r.body.id;
    cleanup.push(async () => { await del(`/wentop/${cruzada}`, admin.token); });
  });

  await scenario('A1 GET /wentop/sectores como OPERADOR -> 200', async () => {
    // El bug: el front pedía esta lista a /analytics/sectores (nivel 70) y un
    // operador recibía 403, quedándose sin poder elegir el sector de observación
    // al cargar una tarjeta.
    const r = await get('/wentop/sectores', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body) && r.body.length >= 2, `esperaba >=2 sectores: ${JSON.stringify(r.body)}`);
    assert(r.body.every((s: any) => typeof s.id === 'string' && typeof s.nombre === 'string'), 'forma inesperada');
  });

  await scenario('A2 mi-alcance de un operador: su sector, no global', async () => {
    const r = await get('/wentop/mi-alcance', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.global === false, 'un operador no puede tener alcance global');
    assert(r.body.sectores.length === 1 && r.body.sectores[0].id === sectorA, `esperaba solo sectorA: ${JSON.stringify(r.body.sectores)}`);
  });

  await scenario('A3 mi-alcance de admin: global', async () => {
    const r = await get('/wentop/mi-alcance', admin.token);
    assertStatus(r.status, 200);
    assert(r.body.global === true, 'admin tiene que ser global');
  });

  await scenario('A4 mi-alcance de CMASS: global', async () => {
    const r = await get('/wentop/mi-alcance', cmass.token);
    assertStatus(r.status, 200);
    assert(r.body.global === true, 'CMASS tiene que ver todos los sectores');
  });

  await scenario('A5 el tablero de un operador solo cuenta su sector', async () => {
    const r = await get('/wentop/analytics', owner.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    const ajenos = r.body.porSector.filter((s: any) => s.sectorId !== sectorA);
    assert(ajenos.length === 0, `el tablero de sector A trajo otros sectores: ${JSON.stringify(ajenos)}`);
  });

  await scenario('A6 el tablero NO cuenta la tarjeta propia de otro sector', async () => {
    // `buildVisibilityWhere` la incluye por `creadorId` para que el dueño siempre
    // encuentre su tarjeta; el tablero usa `buildAnalyticsWhere`, que no.
    const tablero = await get('/wentop/analytics', owner.token);
    assertStatus(tablero.status, 200);
    assert(
      !tablero.body.porSector.some((s: any) => s.sectorId === sectorB),
      'la tarjeta propia sobre el sector B se coló en el tablero del sector A',
    );
    const listado = await get('/wentop', owner.token);
    assertStatus(listado.status, 200);
    assert(
      listado.body.tarjetas.some((t: any) => t.id === cruzada),
      'el LISTADO sí tiene que mostrarle su propia tarjeta, aunque sea de otro sector',
    );
  });

  await scenario('A7 filtrar por un sector ajeno -> 403', async () => {
    const r = await get(`/wentop/analytics?sectorId=${sectorB}`, owner.token);
    assertStatus(r.status, 403, JSON.stringify(r.body));
  });

  await scenario('A8 admin filtra por sector y el tablero se acota', async () => {
    const todo = await get('/wentop/analytics', admin.token);
    assertStatus(todo.status, 200);
    const soloA = await get(`/wentop/analytics?sectorId=${sectorA}`, admin.token);
    assertStatus(soloA.status, 200, JSON.stringify(soloA.body));
    assert(soloA.body.totales.total <= todo.body.totales.total, 'el filtro no puede agrandar el total');
    const ajenos = soloA.body.porSector.filter((s: any) => s.sectorId !== sectorA);
    assert(ajenos.length === 0, `filtrado por A pero trajo: ${JSON.stringify(ajenos)}`);
  });

  await scenario('A9 un gestor puede filtrar entre sus sectores', async () => {
    const alta = await post('/wentop/gestores', { usuarioId: owner.user.id, sectorId: sectorB }, admin.token);
    assertStatus(alta.status, 201, JSON.stringify(alta.body));
    cleanup.push(async () => { await del(`/wentop/gestores/${alta.body.id}`, admin.token); });

    const alcance = await get('/wentop/mi-alcance', owner.token);
    assertStatus(alcance.status, 200);
    assert(alcance.body.sectores.length === 2, `esperaba 2 sectores: ${JSON.stringify(alcance.body.sectores)}`);

    const r = await get(`/wentop/analytics?sectorId=${sectorB}`, owner.token);
    assertStatus(r.status, 200, `siendo gestor de B ya no puede ser 403: ${JSON.stringify(r.body)}`);
  });

  await scenario('A10 el rango de fechas recorta', async () => {
    const r = await get('/wentop/analytics?desde=2099-01-01', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.totales.total === 0, `nada puede haberse reportado en 2099: ${r.body.totales.total}`);
  });

  await scenario('A11 fecha inválida -> 400 (y no 500)', async () => {
    const r = await get('/wentop/analytics?desde=abc', admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  // ─────────── PAGINADO Y ORDEN ───────────
  console.log(C.CY + '\n-- Paginado y orden --' + C.R);

  await scenario('P1 el listado devuelve la envoltura con total y páginas', async () => {
    const r = await get('/wentop', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(Array.isArray(r.body.tarjetas), 'falta el array tarjetas');
    assert(typeof r.body.total === 'number', 'falta total');
    assert(r.body.page === 1, `page tendría que ser 1: ${r.body.page}`);
    assert(r.body.pages >= 1, `pages tendría que ser >= 1: ${r.body.pages}`);
  });

  await scenario('P2 limit acota la página y pages lo refleja', async () => {
    const r = await get('/wentop?limit=1', admin.token);
    assertStatus(r.status, 200);
    assert(r.body.tarjetas.length <= 1, `pidió 1 y trajo ${r.body.tarjetas.length}`);
    if (r.body.total > 1) assert(r.body.pages === r.body.total, 'con limit=1, pages == total');
  });

  await scenario('P3 la página 2 trae otras tarjetas', async () => {
    const p1 = await get('/wentop?limit=1&page=1', admin.token);
    const p2 = await get('/wentop?limit=1&page=2', admin.token);
    assertStatus(p1.status, 200);
    assertStatus(p2.status, 200);
    if (p1.body.total >= 2) {
      assert(p2.body.tarjetas.length === 1, 'la página 2 tendría que traer una');
      assert(p1.body.tarjetas[0].id !== p2.body.tarjetas[0].id, 'la página 2 repitió la 1');
    }
  });

  await scenario('P4 limit se topea en 100 (no se puede pedir todo de una)', async () => {
    const r = await get('/wentop?limit=99999', admin.token);
    assertStatus(r.status, 200);
    assert(r.body.tarjetas.length <= 100, `el tope no se aplicó: ${r.body.tarjetas.length}`);
  });

  await scenario('P5 una página más allá del final devuelve vacío, no error', async () => {
    const r = await get('/wentop?limit=1&page=9999', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
    assert(r.body.tarjetas.length === 0, 'esperaba una página vacía');
  });

  await scenario('P6 orden inválido -> 400 (lista blanca)', async () => {
    const r = await get('/wentop?orden=descripcion', admin.token);
    assertStatus(r.status, 400, JSON.stringify(r.body));
  });

  await scenario('P7 orden por fecha ascendente invierte el listado', async () => {
    const desc = await get('/wentop?orden=fechaReporte&dir=desc&limit=100', admin.token);
    const asc = await get('/wentop?orden=fechaReporte&dir=asc&limit=100', admin.token);
    assertStatus(desc.status, 200);
    assertStatus(asc.status, 200, JSON.stringify(asc.body));
    const fechas = asc.body.tarjetas.map((t: any) => t.fechaReporte);
    const ordenadas = [...fechas].sort();
    assert(JSON.stringify(fechas) === JSON.stringify(ordenadas), 'asc no vino ordenado ascendente');
  });

  await scenario('P8 orden por relación (sector) no rompe', async () => {
    const r = await get('/wentop?orden=sector&dir=asc', admin.token);
    assertStatus(r.status, 200, `el orderBy anidado falló: ${JSON.stringify(r.body)}`);
  });

  await scenario('P9 orden por creador no rompe', async () => {
    const r = await get('/wentop?orden=creador&dir=desc', admin.token);
    assertStatus(r.status, 200, JSON.stringify(r.body));
  });

  // ─────────── EXPORTACIÓN A EXCEL ───────────
  console.log(C.CY + '\n-- Exportación a Excel --' + C.R);

  // Los .xlsx son ZIP: los primeros dos bytes son 'PK'. Alcanza para distinguir
  // un archivo real de un JSON de error servido con el content-type equivocado.
  async function descargar(path: string, token: string) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf, tipo: res.headers.get('content-type') ?? '' };
  }

  await scenario('X1 un operador sin gestoría no puede exportar -> 403', async () => {
    const r = await descargar('/wentop/export.xlsx', foreign.token);
    assertStatus(r.status, 403, r.buf.toString().slice(0, 200));
  });

  await scenario('X2 admin exporta un .xlsx de verdad', async () => {
    const r = await descargar('/wentop/export.xlsx', admin.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
    assert(r.tipo.includes('spreadsheetml'), `content-type inesperado: ${r.tipo}`);
    assert(r.buf.subarray(0, 2).toString() === 'PK', 'no parece un xlsx (falta la firma ZIP)');
    assert(r.buf.length > 1000, `archivo sospechosamente chico: ${r.buf.length} bytes`);
  });

  await scenario('X3 CMASS también exporta', async () => {
    const r = await descargar('/wentop/export.xlsx', cmass.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
  });

  await scenario('X4 un gestor exporta lo de su sector', async () => {
    // `owner` quedó gestor del sector B en el caso A9.
    const r = await descargar('/wentop/export.xlsx', owner.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
  });

  await scenario('X5 el export respeta los filtros', async () => {
    const r = await descargar('/wentop/export.xlsx?estado=CERRADA', admin.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
    assert(r.buf.subarray(0, 2).toString() === 'PK', 'no parece un xlsx');
  });

  await scenario('X6 un filtro inválido da 400 antes de abrir el stream', async () => {
    const r = await descargar('/wentop/export.xlsx?estado=NOPE', admin.token);
    assertStatus(r.status, 400, r.buf.toString().slice(0, 200));
  });

  await scenario('X7 un rango sin resultados igual devuelve un xlsx válido', async () => {
    const r = await descargar('/wentop/export.xlsx?desde=2099-01-01', admin.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
    assert(r.buf.subarray(0, 2).toString() === 'PK', 'el archivo vacío también tiene que ser un xlsx');
  });

  await scenario('X8 una tarjeta CON foto se exporta sin romper', async () => {
    const nueva = await post('/wentop', { ...goodCard, sectorObservacionId: sectorA, descripcion: `qa-${KEY}-${TS}-conFoto` }, owner.token);
    assertStatus(nueva.status, 201, JSON.stringify(nueva.body));
    cleanup.push(async () => { await del(`/wentop/${nueva.body.id}`, admin.token); });
    const subida = await uploadFotos(`/wentop/${nueva.body.id}/fotos`, owner.token, [{ name: 'x.png', buf: PNG_BUF, type: 'image/png' }]);
    assertStatus(subida.status, 201, JSON.stringify(subida.body));

    const r = await descargar('/wentop/export.xlsx', admin.token);
    assertStatus(r.status, 200, r.buf.toString().slice(0, 200));
    assert(r.buf.subarray(0, 2).toString() === 'PK', 'no parece un xlsx');
  });

  // ─────────── CLEANUP ───────────
  console.log(C.CY + '\n-- Cleanup --' + C.R);
  for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* ignore */ } }

  // ─────────── SUMMARY ───────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${C.CY}=== SUMMARY ===${C.R}`);
  console.log(`Total: ${results.length}  ${C.G}Passed: ${passed}${C.R}  ${C.RED}Failed: ${failed}${C.R}`);
  if (failed) for (const r of results.filter((x) => !x.passed)) console.log(`  ${C.RED}FAIL${C.R} ${r.name} :: ${r.detail}`);
  if (bugs.length) { console.log(`\n${C.Y}=== BUG EVIDENCE ===${C.R}`); for (const b of bugs) console.log('  * ' + b); }
  console.log(`\nRESULT_JSON ${JSON.stringify({ total: results.length, passed, failed, bugs })}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
