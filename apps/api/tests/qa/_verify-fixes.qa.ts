/**
 * Verification suite for the QA-sweep fixes (2026-06-26).
 * Asserts the CORRECTED behaviour of each fix (not the old buggy contract).
 * Run: cd apps/api && npx tsx tests/qa/_verify-fixes.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const TS = Date.now();
const C: Record<string, string> = { R: '\x1b[0m', G: '\x1b[32m', RD: '\x1b[31m', Y: '\x1b[33m', CY: '\x1b[36m', DIM: '\x1b[2m' };
const col = (k: string, s: string) => `${C[k] ?? ''}${s}${C.R}`;

type Res = { name: string; ok: boolean; detail: string };
const results: Res[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true, detail: 'OK' }); process.stdout.write(`  ${col('G', 'VERIFIED')} ${name}\n`); }
  catch (e) { const d = e instanceof Error ? e.message : String(e); results.push({ name, ok: false, detail: d }); process.stdout.write(`  ${col('RD', 'BROKEN  ')} ${name} — ${d}\n`); }
}
function assert(c: boolean, m: string): asserts c { if (!c) throw new Error(m); }
const snip = (b: unknown) => { const s = typeof b === 'string' ? b : JSON.stringify(b); return s.length > 200 ? s.slice(0, 200) + '…' : s; };

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
const get = (p: string, t?: string) => api('GET', p, { token: t });
const post = (p: string, b: unknown, t?: string) => api('POST', p, { token: t, body: b });
const put = (p: string, b: unknown, t?: string) => api('PUT', p, { token: t, body: b });
const del = (p: string, t?: string) => api('DELETE', p, { token: t });
const iso = (d: Date) => d.toISOString();

async function login(email: string) {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assert(status === 200, `login ${email} → ${status} ${snip(body)}`);
  return { token: body.accessToken as string, user: body.user };
}

(async () => {
  console.log(col('CY', `\n=== VERIFY FIXES (ts=${TS}) ===\n`));
  const admin = await login('admin@wenlen.com');
  const rrhh = await login('rrhh1@test.wenlen.com');
  const operador = await login('op1.almacen@test.wenlen.com');
  const createdUsers: string[] = [];
  const base = (extra: Record<string, unknown> = {}) => ({
    nombre: 'QaFix', apellido: `T${TS}`, email: `qa.fix.${TS}.${Math.random().toString(36).slice(2, 7)}@demo.com`,
    password: 'Test1234!', rol: 'OPERADOR', fechaIngreso: iso(new Date('2020-01-15T00:00:00Z')), ...extra,
  });

  // HIGH-1: RRHH cannot create an ADMIN-level user
  await check('HIGH usuarios: RRHH POST rol=ADMIN → 403', async () => {
    const { status, body } = await post('/usuarios', base({ rol: 'ADMIN' }), rrhh.token);
    if (status === 201) { createdUsers.push(body.id); throw new Error(`escalation still open: 201 ${snip(body)}`); }
    assert(status === 403, `expected 403, got ${status} ${snip(body)}`);
  });

  // HIGH-1b: RRHH cannot promote an existing user to ADMIN
  await check('HIGH usuarios: RRHH PUT rol=ADMIN → 403', async () => {
    const u = await post('/usuarios', base(), rrhh.token);
    assert(u.status === 201, `setup create failed ${snip(u.body)}`); createdUsers.push(u.body.id);
    const { status, body } = await put(`/usuarios/${u.body.id}`, { rol: 'ADMIN' }, rrhh.token);
    assert(status === 403, `expected 403, got ${status} ${snip(body)}`);
  });

  // HIGH-1c: RRHH CAN still assign a role at/below its level (no false positive)
  await check('HIGH usuarios: RRHH PUT rol=SUPERVISOR still allowed → 200', async () => {
    const u = await post('/usuarios', base(), rrhh.token);
    assert(u.status === 201, `setup ${snip(u.body)}`); createdUsers.push(u.body.id);
    const { status, body } = await put(`/usuarios/${u.body.id}`, { rol: 'SUPERVISOR' }, rrhh.token);
    assert(status === 200, `expected 200, got ${status} ${snip(body)}`);
  });

  // HIGH-2: reversed vacation range rejected
  await check('HIGH vacaciones: reversed range → 400', async () => {
    const ini = iso(new Date('2026-08-20T00:00:00Z'));
    const fin = iso(new Date('2026-08-10T00:00:00Z'));
    const { status, body } = await post('/vacaciones', { fechaInicio: ini, fechaFin: fin, diasHabiles: 5 }, operador.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // MED ausencias IDOR: a foreign operador cannot read another's absence
  await check('MED ausencias: IDOR GET /:id by foreign user → 403', async () => {
    const a = await post('/ausencias/solicitar', { tipo: 'CERTIFICADO_MEDICO', fechaInicio: iso(new Date('2026-07-01T00:00:00Z')), fechaFin: iso(new Date('2026-07-02T00:00:00Z')), diasAusencia: 2, descripcion: 'qa' }, operador.token);
    assert(a.status === 201, `setup ausencia failed ${snip(a.body)}`);
    const u = await post('/usuarios', base({ nombre: 'QaForeign' }), rrhh.token);
    assert(u.status === 201, `setup user ${snip(u.body)}`); createdUsers.push(u.body.id);
    const foreign = await login(u.body.email);
    const { status, body } = await get(`/ausencias/${a.body.id}`, foreign.token);
    assert(status === 403, `expected 403, got ${status} ${snip(body)}`);
  });

  // MED ausencias: owner can still read their own absence
  await check('MED ausencias: owner GET /:id → 200', async () => {
    const a = await post('/ausencias/solicitar', { tipo: 'FALTA_JUSTIFICADA', fechaInicio: iso(new Date('2026-07-05T00:00:00Z')), fechaFin: iso(new Date('2026-07-05T00:00:00Z')), diasAusencia: 1 }, operador.token);
    assert(a.status === 201, `setup ${snip(a.body)}`);
    const { status } = await get(`/ausencias/${a.body.id}`, operador.token);
    assert(status === 200, `expected 200, got ${status}`);
  });

  // MED planillas: inverted period rejected at creation
  await check('MED planillas: POST inverted period → 400', async () => {
    const ini = iso(new Date('2026-09-20T00:00:00Z'));
    const fin = iso(new Date('2026-09-01T00:00:00Z'));
    const { status, body } = await post('/planillas', { periodoInicio: ini, periodoFin: fin }, operador.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // MED admin.roles: system role cannot be deactivated (with safety restore)
  await check('MED admin.roles: PUT esSistema activo=false → 403', async () => {
    const { body: roles } = await get('/admin/roles', admin.token);
    const sys = (roles as any[]).find(r => r.esSistema);
    assert(!!sys, 'no system role found');
    const { status, body } = await put(`/admin/roles/${sys.id}`, { activo: false }, admin.token);
    if (status === 200) { await put(`/admin/roles/${sys.id}`, { activo: true }, admin.token); throw new Error('system role was deactivated (restored)'); }
    assert(status === 403, `expected 403, got ${status} ${snip(body)}`);
  });

  // LOW admin.roles: GET requires RRHH+ (operador blocked)
  await check('LOW admin.roles: GET as OPERADOR → 403', async () => {
    const { status } = await get('/admin/roles', operador.token);
    assert(status === 403, `expected 403, got ${status}`);
  });

  // LOW mensajes: message addressed only to self yields no recipients → 400
  await check('LOW mensajes: USUARIO self-only → 400 (no self-message)', async () => {
    const { status, body } = await post('/mensajes', { asunto: 'qa', cuerpo: 'qa', destinoTipo: 'USUARIO', destinoValor: rrhh.user.id }, rrhh.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // LOW mensajes: a recipient of a broadcast does not see the recipient list
  await check('LOW mensajes: recipient GET /:id hides recipient list', async () => {
    const send = await post('/mensajes', { asunto: `qa-${TS}`, cuerpo: 'broadcast', destinoTipo: 'ROL', destinoValor: 'OPERADOR' }, rrhh.token);
    assert(send.status === 201, `setup send ${snip(send.body)}`);
    const list = await get('/mensajes', operador.token);
    const mine = (list.body.mensajes as any[]).find(m => m.asunto === `qa-${TS}`);
    assert(!!mine, 'recipient did not receive broadcast');
    const { status, body } = await get(`/mensajes/${mine.id}`, operador.token);
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.destinatarios === undefined, `recipient saw destinatarios list (count=${Array.isArray(body.destinatarios) ? body.destinatarios.length : '?'})`);
  });

  // LOW wentop: invalid inputs → 400 instead of 500
  await check('LOW wentop: PUT invalid tipoTarjeta → 400', async () => {
    const t = await post('/wentop', { fechaReporte: iso(new Date('2026-06-01T00:00:00Z')), tipoTarjeta: 'OBSERVACION_POSITIVA', descripcion: 'qa' }, operador.token);
    assert(t.status === 201, `setup tarjeta ${snip(t.body)}`);
    const { status, body } = await put(`/wentop/${t.body.id}`, { tipoTarjeta: 'NOPE' }, operador.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
    await del(`/wentop/${t.body.id}`, operador.token);
  });
  await check('LOW wentop: POST malformed fechaReporte → 400', async () => {
    const { status, body } = await post('/wentop', { fechaReporte: 'not-a-date', tipoTarjeta: 'OBSERVACION_POSITIVA', descripcion: 'qa' }, operador.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });
  await check('LOW wentop: GET ?desde invalid → 400', async () => {
    const { status, body } = await get('/wentop?desde=garbage', operador.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // LOW exportaciones: missing periodo → 400 instead of 500
  await check('LOW exportaciones: POST missing periodo → 400', async () => {
    const { status, body } = await post('/exportaciones', { nombreArchivo: 'qa.xlsx' }, rrhh.token);
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // LOW usuarios: nonexistent FK sectorId → 400 instead of 500
  await check('LOW usuarios: nonexistent sectorId → 400', async () => {
    const { status, body } = await post('/usuarios', base({ sectorId: '00000000-0000-4000-8000-000000000000' }), rrhh.token);
    if (status === 201) { createdUsers.push(body.id); throw new Error('created with bogus sector'); }
    assert(status === 400, `expected 400, got ${status} ${snip(body)}`);
  });

  // cleanup
  for (const id of createdUsers) { try { await del(`/usuarios/${id}`, admin.token); } catch { /* ignore */ } }

  const ok = results.filter(r => r.ok).length;
  console.log(col('CY', `\n=== ${ok}/${results.length} fixes VERIFIED ===`));
  if (ok < results.length) { for (const r of results.filter(r => !r.ok)) console.log(`  ${col('RD', 'BROKEN')} ${r.name} — ${r.detail}`); process.exit(2); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
