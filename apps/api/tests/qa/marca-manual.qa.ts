/**
 * QA Suite — MARCA MANUAL de días en planilla (KEY=marca-manual)
 * Black-box HTTP contra la API viva.
 * Run: cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
 */
const BASE = 'http://localhost:4000/api/v1';
const KEY = 'marca-manual';
const TS = Date.now();

const C: Record<string, string> = { RESET: '\x1b[0m', DIM: '\x1b[2m', GREEN: '\x1b[32m', RED: '\x1b[31m', YELLOW: '\x1b[33m', CYAN: '\x1b[36m' };
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.RESET}`; }
type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
const cleanupQueue: Array<() => Promise<void>> = [];
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, passed: true, detail: 'OK' }); process.stdout.write(`  ${col('GREEN','PASS')} ${name}\n`); }
  catch (e: unknown) { const detail = e instanceof Error ? e.message : String(e); results.push({ name, passed: false, detail }); process.stdout.write(`  ${col('RED','FAIL')} ${name} — ${detail}\n`); }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') { if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`); }
function info(msg: string) { process.stdout.write(`    ${col('DIM','· ' + msg)}\n`); }

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

interface Session { token: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  return { token: body.accessToken, user: body.user };
}
function fmtDateTime(d: Date) { return d.toISOString(); }
async function getCompSaldo(tok: string): Promise<{ acum: number; usados: number; pend: number; disp: number }> {
  const { body } = await get('/vacacion-saldos/mi-saldo', tok);
  return { acum: body.compensatoriosAcumulados, usados: body.compensatoriosUsados, pend: body.compensatoriosPendientes, disp: body.compensatoriosDisponible };
}
const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

async function main() {
  console.log(col('CYAN', `\n═══ QA MARCA MANUAL suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const ana = await login('ana.martinez@demo.com'); // RRHH nivel 90

  const ingreso = fmtDateTime(new Date('2020-01-01T00:00:00Z'));
  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Marca${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, ...extra,
    }, ana.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  let supId = '', ownerId = '', otherSupId = '';
  await scenario('SETUP supervisor', async () => { supId = await createUser('SUPERVISOR', 'sup'); });
  await scenario('SETUP owner OPERADOR (supervisorId=sup)', async () => { ownerId = await createUser('OPERADOR', 'owner', { supervisorId: supId }); });
  await scenario('SETUP unrelated supervisor', async () => { otherSupId = await createUser('SUPERVISOR', 'othersup'); });
  cleanupQueue.push(async () => { for (const id of [ownerId, supId, otherSupId]) if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {}); });

  const owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
  const sup = await login(`qa.${KEY}.${TS}.sup@demo.com`);
  const otherSup = await login(`qa.${KEY}.${TS}.othersup@demo.com`);

  // Seed owner compensatorio saldo (acumulados=3) for the marked year
  const compYear = 2026;
  let saldoId = '';
  await scenario('SETUP seed owner compensatorio saldo (acumulados=3)', async () => {
    await get('/vacacion-saldos/mi-saldo', owner.token);
    const { body } = await get(`/vacacion-saldos?anio=${compYear}`, ana.token);
    const s = (body as any[]).find(x => x.usuarioId === ownerId);
    assert(!!s, `owner saldo for ${compYear} not found`);
    saldoId = s.id;
    const { status } = await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 3, compensatoriosUsados: 0 }, ana.token);
    assertStatus(status, 200, 'seed saldo');
  });
  cleanupQueue.push(async () => { if (saldoId) await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, ana.token).catch(() => {}); });

  // Helper: create a planilla for a distinct 1-day period (avoids overlap collisions)
  const createdPlanillas: string[] = [];
  cleanupQueue.push(async () => { for (const id of createdPlanillas) await del(`/planillas/${id}`, owner.token).catch(() => {}); });
  async function nuevaPlanilla(fecha: string): Promise<string> {
    const { status, body } = await post('/planillas', { periodoInicio: fecha, periodoFin: fecha }, owner.token);
    assertStatus(status, 201, `crear planilla ${fecha}: ${JSON.stringify(body)}`);
    createdPlanillas.push(body.id);
    return body.id as string;
  }

  // ═══ A. marcar-dia: auth + validación ═══
  await scenario('A1 owner marca FALTA_JUSTIFICADA → 201 PENDIENTE + registro bloqueado + marcaManual', async () => {
    const pid = await nuevaPlanilla('2026-11-03');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-03', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.bloqueado === true, `bloqueado=${body.bloqueado}`);
    assert(body.motivoBloqueo === 'FALTA_JUSTIFICADA', `motivo=${body.motivoBloqueo}`);
    assert(body.marcaManual && body.marcaManual.estado === 'PENDIENTE', `marcaManual=${JSON.stringify(body.marcaManual)}`);
    assert(body.marcaManual.tipo === 'FALTA_JUSTIFICADA', `tipo=${body.marcaManual?.tipo}`);
  });
  await scenario('A2 supervisor marca FALTA_JUSTIFICADA → 201 APROBADA (auto-validada)', async () => {
    const pid = await nuevaPlanilla('2026-11-04');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-04', tipo: 'FALTA_JUSTIFICADA' }, sup.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual && body.marcaManual.estado === 'APROBADA', `estado=${body.marcaManual?.estado}`);
  });
  await scenario('A3 unrelated supervisor marca → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-05');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-05', tipo: 'FALTA_JUSTIFICADA' }, otherSup.token);
    assertStatus(status, 403, 'unrelated sup');
  });
  await scenario('A4 fecha fuera del período → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-06');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-01', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    assertStatus(status, 400, 'fuera de período');
  });
  await scenario('A5 tipo inválido → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-07');
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-07', tipo: 'NOPE' }, owner.token);
    assertStatus(status, 400, 'bad tipo');
  });
  await scenario('A6 marcar un día ya marcado → 409', async () => {
    const pid = await nuevaPlanilla('2026-11-08');
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-08', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-08', tipo: 'LICENCIA_ESPECIAL' }, owner.token);
    assertStatus(status, 409, 'ya bloqueado');
  });

  // ═══ B. compensatorio: saldo ═══
  await scenario('B1 owner marca FRANCO_COMPENSATORIO con saldo → 201, pendientes +1', async () => {
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-10');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-10', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual.estado === 'PENDIENTE', `estado=${body.marcaManual?.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 1, `pendientes ${before.pend}→${after.pend} (esperado +1)`);
  });
  await scenario('B2 supervisor marca FRANCO_COMPENSATORIO → 201 APROBADA, usados +1', async () => {
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-11');
    const { status, body } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-11', tipo: 'FRANCO_COMPENSATORIO' }, sup.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual.estado === 'APROBADA', `estado=${body.marcaManual?.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.usados === before.usados + 1, `usados ${before.usados}→${after.usados} (esperado +1)`);
  });
  await scenario('B3 compensatorio sin saldo disponible → 400', async () => {
    const s1 = await getCompSaldo(owner.token);
    info(`saldo antes: acum=${s1.acum} usados=${s1.usados} pend=${s1.pend} disp=${s1.disp}`);
    const pid = await nuevaPlanilla('2026-11-12');
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-12', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    const pid2 = await nuevaPlanilla('2026-11-13');
    const { status, body } = await post(`/planillas/${pid2}/marcar-dia`, { fecha: '2026-11-13', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/insuficiente/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });

  // ═══ C. validar ═══
  await scenario('C1 owner no puede validar su propia marca → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-15');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-15', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, owner.token);
    assertStatus(status, 403, 'owner self-validate');
  });
  await scenario('C2 supervisor valida marca pendiente del owner → 200 APROBADA', async () => {
    const pid = await nuevaPlanilla('2026-11-16');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-16', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status, body } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'APROBADA', `estado=${body.estado}`);
  });
  await scenario('C3 unrelated supervisor valida → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-17');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-17', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, otherSup.token);
    assertStatus(status, 403, 'unrelated validate');
  });
  await scenario('C4 validar una marca ya APROBADA → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-18');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-18', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 400, 'no pendiente');
  });
  await scenario('C5 validar-todo valida todas las pendientes → 200', async () => {
    const { status: ps, body: pb } = await post('/planillas', { periodoInicio: '2026-11-20', periodoFin: '2026-11-22' }, owner.token);
    assertStatus(ps, 201, JSON.stringify(pb)); createdPlanillas.push(pb.id);
    await post(`/planillas/${pb.id}/marcar-dia`, { fecha: '2026-11-20', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pb.id}/marcar-dia`, { fecha: '2026-11-21', tipo: 'FALTA_INJUSTIFICADA' }, owner.token);
    const { status, body } = await post(`/planillas/${pb.id}/marcas/validar-todo`, {}, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.validadas === 2, `validadas=${body.validadas}`);
  });
  await scenario('C6 validar compensatorio pendiente → usados +1, pendientes -1', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-24');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-24', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    const midPend = (await getCompSaldo(owner.token)).pend;
    assert(midPend === before.pend + 1, `pend tras marcar ${before.pend}→${midPend}`);
    const { status } = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(status, 200, 'validar comp');
    const after = await getCompSaldo(owner.token);
    assert(after.pend === midPend - 1 && after.usados === before.usados + 1, `pend ${midPend}→${after.pend} usados ${before.usados}→${after.usados}`);
  });

  // ═══ D. quitar / rechazar ═══
  await scenario('D1 owner quita su marca PENDIENTE → 204, día desbloqueado', async () => {
    const pid = await nuevaPlanilla('2026-11-26');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-26', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 204, 'quitar');
    const { body: pl } = await get(`/planillas/${pid}`, owner.token);
    const dia = (pl.registros as any[]).find(r => r.fecha.startsWith('2026-11-26'));
    assert(!dia || dia.bloqueado === false, `día sigue bloqueado: ${JSON.stringify(dia)}`);
  });
  await scenario('D2 owner NO puede quitar una marca ya APROBADA → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-27');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-27', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 400, 'owner reject aprobada');
  });
  await scenario('D3 supervisor rechaza marca APROBADA → 200 RECHAZADA, día desbloqueado', async () => {
    const pid = await nuevaPlanilla('2026-11-28');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-28', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const { status, body } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'RECHAZADA', `estado=${body.estado}`);
  });
  await scenario('D4 rechazar compensatorio PENDIENTE libera pendientes (-1)', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-29');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-11-29', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assert((await getCompSaldo(owner.token)).pend === before.pend + 1, 'reservó pendiente');
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 200, 'rechazar comp');
    assert((await getCompSaldo(owner.token)).pend === before.pend, 'liberó pendiente');
  });

  // ═══ E. gating de aprobación ═══
  await scenario('E1 avanzar con marca sin validar → 400; validar → avanzar 200', async () => {
    const pid = await nuevaPlanilla('2026-12-02');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-02', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    const enviar = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(enviar.status, 200, `enviar: ${JSON.stringify(enviar.body)}`);
    assert(enviar.body.estado === 'ENVIADA', `estado=${enviar.body.estado}`);
    const avA = await post(`/planillas/${pid}/avanzar`, {}, sup.token);
    assertStatus(avA.status, 400, JSON.stringify(avA.body));
    assert(avA.body.marcasPendientes === 1, `marcasPendientes=${avA.body.marcasPendientes}`);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const avB = await post(`/planillas/${pid}/avanzar`, {}, sup.token);
    assertStatus(avB.status, 200, JSON.stringify(avB.body));
    assert(avB.body.estado === 'APROBADA', `estado=${avB.body.estado}`);
  });
  await scenario('E2 GET /planillas/:id incluye marcaManual en el registro', async () => {
    const pid = await nuevaPlanilla('2026-12-04');
    await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-04', tipo: 'LICENCIA_ESPECIAL' }, owner.token);
    const { body } = await get(`/planillas/${pid}`, owner.token);
    const dia = (body.registros as any[]).find(r => r.fecha.startsWith('2026-12-04'));
    assert(dia && dia.marcaManual && dia.marcaManual.estado === 'PENDIENTE', `marcaManual=${JSON.stringify(dia?.marcaManual)}`);
  });

  // ═══ F. endurecimiento (guards de correctitud) ═══
  await scenario('F1 marcar comp sobre un día con esFrancoCompensatorio ya declarado → 409', async () => {
    const pid = await nuevaPlanilla('2026-12-06');
    const r = await post(`/planillas/${pid}/registros`, { fecha: '2026-12-06', esFrancoCompensatorio: true }, owner.token);
    assertStatus(r.status, 201, `crear registro comp: ${JSON.stringify(r.body)}`);
    const { status } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-06', tipo: 'FRANCO_COMPENSATORIO' }, owner.token);
    assertStatus(status, 409, 'esFrancoCompensatorio ya declarado');
  });
  await scenario('F2 superior NO puede rechazar marca en planilla ya APROBADA → 400', async () => {
    const pid = await nuevaPlanilla('2026-12-08');
    const { body: reg } = await post(`/planillas/${pid}/marcar-dia`, { fecha: '2026-12-08', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
    await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    const enviar = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(enviar.status, 200, `enviar: ${JSON.stringify(enviar.body)}`);
    const av = await post(`/planillas/${pid}/avanzar`, {}, sup.token);
    assertStatus(av.status, 200, `avanzar: ${JSON.stringify(av.body)}`);
    assert(av.body.estado === 'APROBADA', `estado=${av.body.estado}`);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 400, 'reject en planilla aprobada');
  });

  // ── Resumen ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n═══ RESULTS: ${passed}/${results.length} passed, ${failed} failed ═══`));
  if (failed) { console.log(col('YELLOW', 'Failed:')); results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`)); }
  console.log(col('DIM', '\nCleaning up...'));
  for (const fn of cleanupQueue.reverse()) { await fn().catch(() => {}); }
  console.log('\n__RESULT_JSON__' + JSON.stringify({ passed, failed, total: results.length }));
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
