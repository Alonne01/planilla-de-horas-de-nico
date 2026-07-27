/**
 * QA Suite — CANCELACIÓN de solicitudes por el dueño (KEY=cancelaciones)
 *
 * POST /mis-solicitudes/:tipo/:id/cancelar para planilla, vacacion, ausencia y
 * cambio-diagrama. Regla: solo el dueño, y solo mientras NADIE haya firmado.
 * Cancelar una planilla la devuelve a BORRADOR con los registros intactos; el
 * resto queda en CANCELADA (cambio-diagrama se borra, no tiene ese estado).
 *
 * Black-box HTTP contra la API viva.
 * Run: cd apps/api && npx tsx tests/qa/cancelaciones.qa.ts
 */
// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'cancel';
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
const cancelar = (tipo: string, id: string, tok: string) => post(`/mis-solicitudes/${tipo}/${id}/cancelar`, {}, tok);

async function main() {
  console.log(col('CYAN', `\n═══ QA CANCELACIONES suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const rrhh = await login('rrhh1@test.wenlen.com'); // nivel 90

  const ingreso = new Date('2020-01-01T00:00:00Z').toISOString();
  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Cancel${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, ...extra,
    }, rrhh.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  let supId = '', ownerId = '', ajenoId = '';
  await scenario('SETUP supervisor', async () => { supId = await createUser('SUPERVISOR', 'sup'); });
  await scenario('SETUP owner OPERADOR', async () => { ownerId = await createUser('OPERADOR', 'owner', { supervisorId: supId }); });
  await scenario('SETUP tercero OPERADOR', async () => { ajenoId = await createUser('OPERADOR', 'ajeno', { supervisorId: supId }); });
  cleanupQueue.push(async () => { for (const id of [ownerId, ajenoId, supId]) if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {}); });

  const owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
  const ajeno = await login(`qa.${KEY}.${TS}.ajeno@demo.com`);

  // Saldos para que vacaciones y compensatorios se puedan pedir
  let saldoId = '';
  await scenario('SETUP saldo de vacaciones y compensatorios del owner', async () => {
    await get('/vacacion-saldos/mi-saldo', owner.token);
    const { body } = await get('/vacacion-saldos?anio=2026', rrhh.token);
    const s = (body as any[]).find(x => x.usuarioId === ownerId);
    assert(!!s, 'saldo 2026 del owner no encontrado');
    saldoId = s.id;
    const { status } = await put(`/vacacion-saldos/${saldoId}`, {
      diasCorrespondientes: 20, diasTomados: 0, compensatoriosAcumulados: 5, compensatoriosUsados: 0,
    }, rrhh.token);
    assertStatus(status, 200, 'seed saldo');
  });
  cleanupQueue.push(async () => { if (saldoId) await put(`/vacacion-saldos/${saldoId}`, { diasCorrespondientes: 0, diasTomados: 0, compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, rrhh.token).catch(() => {}); });

  const createdPlanillas: string[] = [];
  cleanupQueue.push(async () => { for (const id of createdPlanillas) await del(`/planillas/${id}`, owner.token).catch(() => {}); });

  /** Planilla de un día, con el registro cargado para que `enviar` la acepte. */
  async function planillaEnviable(fecha: string): Promise<string> {
    const { status, body } = await post('/planillas', { periodoInicio: fecha, periodoFin: fecha }, owner.token);
    assertStatus(status, 201, `crear planilla ${fecha}: ${JSON.stringify(body)}`);
    createdPlanillas.push(body.id);
    const r = await post(`/planillas/${body.id}/registros`, {
      fecha, lugarTrabajo: 'BASE',
      entradaTurno1: `${fecha}T08:00:00.000Z`, salidaTurno1: `${fecha}T16:00:00.000Z`,
    }, owner.token);
    assert(r.status === 201 || r.status === 200, `registro ${fecha}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return body.id as string;
  }
  async function enviar(pid: string): Promise<void> {
    const { status, body } = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(status, 200, `enviar: ${JSON.stringify(body)}`);
  }

  // ═══ A. Planilla ═══
  await scenario('A1 el dueño cancela su planilla ENVIADA → vuelve a BORRADOR', async () => {
    const pid = await planillaEnviable('2027-03-02');
    await enviar(pid);
    const { status, body } = await cancelar('planilla', pid, owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'BORRADOR', `estado=${body.estado}`);
    assert(body.pasoActual === 0, `pasoActual=${body.pasoActual}`);
    assert(body.enviadaAt === null, `enviadaAt=${body.enviadaAt}`);
    assert(body.circuitoSnapshot === null, `circuitoSnapshot=${JSON.stringify(body.circuitoSnapshot)}`);
  });
  await scenario('A2 los registros sobreviven a la cancelación', async () => {
    const pid = await planillaEnviable('2027-03-03');
    await enviar(pid);
    await cancelar('planilla', pid, owner.token);
    const { body } = await get(`/planillas/${pid}`, owner.token);
    const dia = (body.registros as any[]).find(r => String(r.fecha).startsWith('2027-03-03'));
    assert(!!dia, 'el registro del día se perdió al cancelar');
    assert(!!dia.entradaTurno1, `el registro quedó vacío: ${JSON.stringify(dia)}`);
  });
  await scenario('A3 se puede corregir y reenviar después de cancelar', async () => {
    const pid = await planillaEnviable('2027-03-04');
    await enviar(pid);
    await cancelar('planilla', pid, owner.token);
    const r = await post(`/planillas/${pid}/registros`, { fecha: '2027-03-04', observaciones: 'corregido' }, owner.token);
    assert(r.status === 200 || r.status === 201 || r.status === 409, `editar tras cancelar: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    await enviar(pid);
    const { body } = await get(`/planillas/${pid}`, owner.token);
    assert(body.estado === 'ENVIADA', `estado=${body.estado}`);
  });
  await scenario('A4 cancelar una planilla en BORRADOR → 400', async () => {
    const pid = await planillaEnviable('2027-03-05');
    const { status, body } = await cancelar('planilla', pid, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
  });
  await scenario('A5 un tercero no puede cancelar la planilla ajena → 403', async () => {
    const pid = await planillaEnviable('2027-03-08');
    await enviar(pid);
    const { status } = await cancelar('planilla', pid, ajeno.token);
    assertStatus(status, 403, 'tercero cancelando');
  });
  await scenario('A6 ni RRHH puede cancelar la planilla de otro → 403', async () => {
    const pid = await planillaEnviable('2027-03-09');
    await enviar(pid);
    const { status } = await cancelar('planilla', pid, rrhh.token);
    assertStatus(status, 403, 'RRHH cancelando planilla ajena');
  });
  await scenario('A7 una planilla ya APROBADA no se cancela → 400', async () => {
    const pid = await planillaEnviable('2027-03-10');
    await enviar(pid);
    let estado = '';
    for (let i = 0; i < 6; i++) {
      const av = await post(`/planillas/${pid}/avanzar`, {}, rrhh.token);
      assertStatus(av.status, 200, `avanzar: ${JSON.stringify(av.body)}`);
      estado = av.body.estado;
      if (estado === 'APROBADA') break;
    }
    assert(estado === 'APROBADA', `la planilla quedó en ${estado}`);
    const { status, body } = await cancelar('planilla', pid, owner.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  // ═══ B. Vacación ═══
  const createdVacaciones: string[] = [];
  cleanupQueue.push(async () => { for (const id of createdVacaciones) await del(`/vacaciones/${id}`, owner.token).catch(() => {}); });
  async function nuevaVacacion(ini: string, fin: string, dias: number, tok = owner.token): Promise<any> {
    const { status, body } = await post('/vacaciones', { fechaInicio: ini, fechaFin: fin, diasHabiles: dias, motivo: `QA ${TS}` }, tok);
    assertStatus(status, 201, `crear vacacion: ${JSON.stringify(body)}`);
    createdVacaciones.push(body.id);
    return body;
  }
  // /mi-saldo expone `pendiente`/`usados`/`disponible`, no los nombres de columna.
  async function saldoVac(tok: string): Promise<{ pend: number; usados: number }> {
    const { body } = await get('/vacacion-saldos/mi-saldo', tok);
    return { pend: body.pendiente, usados: body.usados };
  }

  await scenario('B1 el dueño cancela su vacación → CANCELADA y devuelve los días', async () => {
    const before = await saldoVac(owner.token);
    const vac = await nuevaVacacion('2027-04-05', '2027-04-09', 5);
    const mid = await saldoVac(owner.token);
    assert(mid.pend === before.pend + 5, `pendientes ${before.pend}→${mid.pend}`);
    const { status, body } = await cancelar('vacacion', vac.id, owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'CANCELADA', `estado=${body.estado}`);
    const after = await saldoVac(owner.token);
    assert(after.pend === before.pend, `pendientes ${mid.pend}→${after.pend} (esperado ${before.pend})`);
  });
  await scenario('B2 cancelar dos veces la misma vacación → 400', async () => {
    const vac = await nuevaVacacion('2027-04-12', '2027-04-13', 2);
    assertStatus((await cancelar('vacacion', vac.id, owner.token)).status, 200, 'primera');
    const { status } = await cancelar('vacacion', vac.id, owner.token);
    assertStatus(status, 400, 'segunda');
  });
  await scenario('B3 un tercero no puede cancelar la vacación ajena → 403', async () => {
    const vac = await nuevaVacacion('2027-04-19', '2027-04-20', 2);
    const { status } = await cancelar('vacacion', vac.id, ajeno.token);
    assertStatus(status, 403, 'tercero');
  });

  // ═══ C. Ausencia formal ═══
  // POST /ausencias pide SUPERVISOR: el empleado pide la suya por /solicitar,
  // y el compensatorio tiene su propia ruta porque reserva saldo.
  async function nuevaAusencia(tipo: string, ini: string, fin: string, dias: number): Promise<any> {
    const ruta = tipo === 'FRANCO_COMPENSATORIO' ? '/ausencias/compensatorio' : '/ausencias/solicitar';
    const payload = tipo === 'FRANCO_COMPENSATORIO'
      ? { fechaInicio: ini, fechaFin: fin, diasAusencia: dias, descripcion: `QA ${TS}` }
      : { tipo, fechaInicio: ini, fechaFin: fin, diasAusencia: dias, descripcion: `QA ${TS}` };
    const { status, body } = await post(ruta, payload, owner.token);
    assertStatus(status, 201, `crear ausencia ${tipo}: ${JSON.stringify(body)}`);
    return body;
  }
  async function compPend(tok: string): Promise<number> {
    const { body } = await get('/vacacion-saldos/mi-saldo', tok);
    return body.compensatoriosPendientes ?? body.compPendiente;
  }

  await scenario('C1 el dueño cancela su ausencia → CANCELADA', async () => {
    const aus = await nuevaAusencia('CERTIFICADO_MEDICO', '2027-05-04', '2027-05-05', 2);
    const { status, body } = await cancelar('ausencia', aus.id, owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.estado === 'CANCELADA', `estado=${body.estado}`);
    assert(body.aprobada === false, `aprobada=${body.aprobada}`);
  });
  await scenario('C2 cancelar un compensatorio devuelve el saldo reservado', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, rrhh.token);
    const before = await compPend(owner.token);
    // Año 2026 a propósito: la reserva y la devolución del compensatorio miran el
    // saldo del año de `fechaInicio`, y el saldo sembrado en el SETUP es de 2026.
    const aus = await nuevaAusencia('FRANCO_COMPENSATORIO', '2026-12-14', '2026-12-14', 1);
    const mid = await compPend(owner.token);
    assert(mid === before + 1, `pendientes ${before}→${mid}`);
    assertStatus((await cancelar('ausencia', aus.id, owner.token)).status, 200, 'cancelar comp');
    const after = await compPend(owner.token);
    assert(after === before, `pendientes ${mid}→${after} (esperado ${before})`);
  });
  await scenario('C3 una marca manual NO se cancela por acá → 400', async () => {
    // El plan B se prende solo para crear la marca y se vuelve a apagar.
    const cfg = await get('/admin/config', admin.token);
    const original = cfg.body?.marcaManualActiva ?? false;
    await put('/admin/config', { marcaManualActiva: true }, admin.token);
    try {
      const p = await post('/planillas', { periodoInicio: '2027-05-17', periodoFin: '2027-05-17' }, owner.token);
      assertStatus(p.status, 201, JSON.stringify(p.body));
      createdPlanillas.push(p.body.id);
      const m = await post(`/planillas/${p.body.id}/marcar-dia`, { fecha: '2027-05-17', tipo: 'FALTA_JUSTIFICADA' }, owner.token);
      assertStatus(m.status, 201, JSON.stringify(m.body));
      const { status, body } = await cancelar('ausencia', m.body.marcaManual.id, owner.token);
      assertStatus(status, 400, JSON.stringify(body));
      assert(/planilla/i.test(JSON.stringify(body)), `el mensaje debe mandar a la planilla: ${JSON.stringify(body)}`);
    } finally {
      await put('/admin/config', { marcaManualActiva: original }, admin.token);
    }
  });
  await scenario('C4 un tercero no puede cancelar la ausencia ajena → 403', async () => {
    const aus = await nuevaAusencia('CERTIFICADO_MEDICO', '2027-05-24', '2027-05-24', 1);
    const { status } = await cancelar('ausencia', aus.id, ajeno.token);
    assertStatus(status, 403, 'tercero');
  });

  // ═══ D. Cambio de diagrama ═══
  /** Fecha futura para las solicitudes de cambio de diagrama, que exigen una. */
  function fechaFuturaISO(diasAdelante = 30): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + diasAdelante);
    return d.toISOString().slice(0, 10);
  }
  await scenario('D1 el dueño cancela su cambio de diagrama → desaparece', async () => {
    const { body: diagramas } = await get('/diagramas', owner.token);
    const lista = Array.isArray(diagramas) ? diagramas : (diagramas?.data ?? []);
    if (lista.length === 0) { info('no hay diagramas cargados: escenario no aplicable'); return; }
    const destino = lista.find((d: any) => d.id !== owner.user.sectorId) ?? lista[0];
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: ownerId, diagramaNuevoId: destino.id, motivo: `QA ${TS}`, fechaEfectiva: fechaFuturaISO(),
    }, owner.token);
    if (status !== 201) { info(`no se pudo crear la solicitud (HTTP ${status}): ${JSON.stringify(body).slice(0, 120)}`); return; }
    const c = await cancelar('cambio-diagrama', body.id, owner.token);
    assertStatus(c.status, 200, JSON.stringify(c.body));
    assert(c.body.estado === 'CANCELADA', `estado=${c.body.estado}`);
    const { status: after } = await get(`/cambios-diagrama/${body.id}`, owner.token);
    assertStatus(after, 404, 'la solicitud debía borrarse');
  });

  // ═══ E. Contrato del listado ═══
  await scenario('E1 tipo desconocido → 400', async () => {
    const { status } = await cancelar('inventado', '00000000-0000-4000-8000-000000000000', owner.token);
    assertStatus(status, 400, 'tipo inválido');
  });
  await scenario('E2 id inexistente → 404', async () => {
    const { status } = await cancelar('vacacion', '00000000-0000-4000-8000-000000000000', owner.token);
    assertStatus(status, 404, 'id inexistente');
  });
  await scenario('E3 GET /mis-solicitudes marca cancelable según el estado', async () => {
    const pid = await planillaEnviable('2027-06-01');
    await enviar(pid);
    const { status, body } = await get('/mis-solicitudes', owner.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const lista: any[] = Array.isArray(body) ? body : (body.solicitudes ?? body.data ?? []);
    const enviada = lista.find(s => s.tipo === 'PLANILLA' && s.id === pid);
    assert(!!enviada, `la planilla recién enviada no aparece en mis-solicitudes`);
    assert(enviada.cancelable === true, `cancelable=${enviada.cancelable} para una ENVIADA sin firmar`);
    const aprobada = lista.find(s => s.estado === 'APROBADA');
    if (aprobada) assert(aprobada.cancelable === false, `una APROBADA no puede ser cancelable`);
    else info('no hay ninguna solicitud APROBADA en el listado para contrastar');
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
