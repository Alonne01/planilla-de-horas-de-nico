/**
 * QA Suite — MARCA MANUAL de días en planilla, "plan B" (KEY=marca-manual)
 *
 * Modelo vigente: la planilla es del dueño. Solo él marca días, solo él los quita,
 * y las marcas se aprueban solas cuando la cadena aprueba la planilla. No hay
 * validar/validar-todo. El alta está detrás del flag `marcaManualActiva`, que
 * nace apagado; borrar y ver NO dependen del flag.
 *
 * Black-box HTTP contra la API viva.
 * Run: cd apps/api && npx tsx tests/qa/marca-manual.qa.ts
 */
// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
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

/** Sube un PNG mínimo como certificado. multipart, no JSON. */
async function subirArchivo(path: string, tok: string, nombre = 'cert.png'): Promise<{ status: number; body: any }> {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fd = new FormData();
  fd.append('archivo', new Blob([png], { type: 'image/png' }), nombre);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}

interface Session { token: string; cookie: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const body: any = await res.json();
  assertStatus(res.status, 200, `Login ${email}: ${JSON.stringify(body)}`);
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
function fmtDateTime(d: Date) { return d.toISOString(); }
async function getCompSaldo(tok: string): Promise<{ acum: number; usados: number; pend: number; disp: number }> {
  const { body } = await get('/vacacion-saldos/mi-saldo', tok);
  return { acum: body.compensatoriosAcumulados, usados: body.compensatoriosUsados, pend: body.compensatoriosPendientes, disp: body.compensatoriosDisponible };
}

async function main() {
  console.log(col('CYAN', `\n═══ QA MARCA MANUAL suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const ana = await login('rrhh1@test.wenlen.com'); // RRHH nivel 90

  // ── Flag del plan B: se prende y apaga por empresa. Se restaura al final. ──
  async function setFlag(activo: boolean): Promise<void> {
    const { status, body } = await put('/admin/config', { marcaManualActiva: activo }, admin.token);
    assertStatus(status, 200, `set flag=${activo}: ${JSON.stringify(body)}`);
  }
  const { body: cfg0 } = await get('/admin/config', admin.token);
  const flagOriginal: boolean = cfg0?.marcaManualActiva ?? false;
  info(`flag marcaManualActiva original = ${flagOriginal}`);
  cleanupQueue.push(async () => { await setFlag(flagOriginal).catch(() => {}); });

  const ingreso = fmtDateTime(new Date('2020-01-01T00:00:00Z'));
  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Marca${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, ...extra,
    }, ana.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  let supId = '', ownerId = '';
  await scenario('SETUP supervisor', async () => { supId = await createUser('SUPERVISOR', 'sup'); });
  await scenario('SETUP owner OPERADOR (supervisorId=sup)', async () => { ownerId = await createUser('OPERADOR', 'owner', { supervisorId: supId }); });
  cleanupQueue.push(async () => { for (const id of [ownerId, supId]) if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {}); });

  const owner = await login(`qa.${KEY}.${TS}.owner@demo.com`);
  const sup = await login(`qa.${KEY}.${TS}.sup@demo.com`);

  const compYear = 2026;
  let saldoId = '';
  await scenario('SETUP seed owner compensatorio saldo (acumulados=5)', async () => {
    await get('/vacacion-saldos/mi-saldo', owner.token);
    const { body } = await get(`/vacacion-saldos?anio=${compYear}`, ana.token);
    const s = (body as any[]).find(x => x.usuarioId === ownerId);
    assert(!!s, `owner saldo for ${compYear} not found`);
    saldoId = s.id;
    const { status } = await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    assertStatus(status, 200, 'seed saldo');
  });
  cleanupQueue.push(async () => { if (saldoId) await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, ana.token).catch(() => {}); });

  const createdPlanillas: string[] = [];
  cleanupQueue.push(async () => { for (const id of createdPlanillas) await del(`/planillas/${id}`, owner.token).catch(() => {}); });
  async function nuevaPlanilla(fecha: string, fin?: string): Promise<string> {
    const { status, body } = await post('/planillas', { periodoInicio: fecha, periodoFin: fin ?? fecha }, owner.token);
    assertStatus(status, 201, `crear planilla ${fecha}: ${JSON.stringify(body)}`);
    createdPlanillas.push(body.id);
    return body.id as string;
  }
  async function marcar(pid: string, fecha: string, tipo: string, tok: string, descripcion?: string) {
    return post(`/planillas/${pid}/marcar-dia`, { fecha, tipo, ...(descripcion ? { descripcion } : {}) }, tok);
  }
  /** `enviar` exige que todo día hábil tenga registro cargado o esté bloqueado. */
  async function completarDias(pid: string, fechas: string[]): Promise<void> {
    for (const fecha of fechas) {
      // entradaTurno1/salidaTurno1 son DateTime completos, no "HH:mm".
      const r = await post(`/planillas/${pid}/registros`, {
        fecha, lugarTrabajo: 'BASE',
        entradaTurno1: `${fecha}T08:00:00.000Z`, salidaTurno1: `${fecha}T16:00:00.000Z`,
      }, owner.token);
      if (r.status !== 201 && r.status !== 200) throw new Error(`completar ${fecha}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  /**
   * Sin flujo de PLANILLA configurado, `avanzar` exige RRHH+. Se avanza con RRHH
   * hasta que quede APROBADA, sin asumir de cuántos pasos es el circuito.
   */
  async function aprobarPlanilla(pid: string): Promise<string> {
    let estado = '';
    for (let i = 0; i < 6; i++) {
      const av = await post(`/planillas/${pid}/avanzar`, {}, ana.token);
      if (av.status !== 200) throw new Error(`avanzar #${i + 1}: HTTP ${av.status} ${JSON.stringify(av.body)}`);
      estado = av.body.estado;
      if (estado === 'APROBADA') return estado;
    }
    return estado;
  }

  // ═══ A. El flag: el plan B nace apagado ═══
  await setFlag(false);

  await scenario('A1 GET /config/modulos informa el flag a cualquier autenticado', async () => {
    const { status, body } = await get('/config/modulos', owner.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(body.marcaManualActiva === false, `marcaManualActiva=${body.marcaManualActiva}`);
  });
  await scenario('A2 flag apagado: el dueño NO puede marcar → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-03');
    const { status, body } = await marcar(pid, '2026-11-03', 'FALTA_JUSTIFICADA', owner.token);
    assertStatus(status, 403, JSON.stringify(body));
    assert(/habilitada/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });
  await scenario('A3 flag apagado: una marca preexistente SÍ se puede borrar', async () => {
    await setFlag(true);
    const pid = await nuevaPlanilla('2026-11-04');
    const { status: ms, body: reg } = await marcar(pid, '2026-11-04', 'FALTA_JUSTIFICADA', owner.token);
    assertStatus(ms, 201, JSON.stringify(reg));
    await setFlag(false);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 204, 'borrar con flag apagado');
  });

  // El resto de la suite corre con el plan B encendido.
  await setFlag(true);

  // ═══ B. Alta: solo el dueño ═══
  await scenario('B1 dueño marca FALTA_JUSTIFICADA → 201 PENDIENTE, día bloqueado', async () => {
    const pid = await nuevaPlanilla('2026-11-06');
    const { status, body } = await marcar(pid, '2026-11-06', 'FALTA_JUSTIFICADA', owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.bloqueado === true, `bloqueado=${body.bloqueado}`);
    assert(body.motivoBloqueo === 'FALTA_JUSTIFICADA', `motivo=${body.motivoBloqueo}`);
    assert(body.marcaManual?.estado === 'PENDIENTE', `estado=${body.marcaManual?.estado}`);
    assert('archivoUrl' in (body.marcaManual ?? {}), 'el registro debe exponer archivoUrl de la marca');
  });
  await scenario('B2 el supervisor NO puede marcar en la planilla del subordinado → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-07');
    const { status, body } = await marcar(pid, '2026-11-07', 'FALTA_JUSTIFICADA', sup.token);
    assertStatus(status, 403, JSON.stringify(body));
    assert(/dueño/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });
  await scenario('B3 RRHH tampoco puede marcar en una planilla ajena → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-09');
    const { status } = await marcar(pid, '2026-11-09', 'FALTA_JUSTIFICADA', ana.token);
    assertStatus(status, 403, 'RRHH marcando planilla ajena');
  });
  await scenario('B4 fecha fuera del período → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-10');
    const { status } = await marcar(pid, '2026-12-01', 'FALTA_JUSTIFICADA', owner.token);
    assertStatus(status, 400, 'fuera de período');
  });
  await scenario('B5 tipo inválido → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-11');
    const { status } = await marcar(pid, '2026-11-11', 'NOPE', owner.token);
    assertStatus(status, 400, 'bad tipo');
  });
  await scenario('B6 día ya marcado → 409', async () => {
    const pid = await nuevaPlanilla('2026-11-12');
    await marcar(pid, '2026-11-12', 'FALTA_JUSTIFICADA', owner.token);
    const { status } = await marcar(pid, '2026-11-12', 'LICENCIA_ESPECIAL', owner.token);
    assertStatus(status, 409, 'ya bloqueado');
  });
  await scenario('B7 día con esFrancoCompensatorio ya declarado → 409', async () => {
    const pid = await nuevaPlanilla('2026-11-13');
    const r = await post(`/planillas/${pid}/registros`, { fecha: '2026-11-13', esFrancoCompensatorio: true }, owner.token);
    assertStatus(r.status, 201, `crear registro comp: ${JSON.stringify(r.body)}`);
    const { status } = await marcar(pid, '2026-11-13', 'FRANCO_COMPENSATORIO', owner.token);
    assertStatus(status, 409, 'esFrancoCompensatorio ya declarado');
  });
  await scenario('B8 planilla ENVIADA: ni el dueño puede marcar → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-16', '2026-11-17');
    await completarDias(pid, ['2026-11-16', '2026-11-17']);
    const env = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(env.status, 200, `enviar: ${JSON.stringify(env.body)}`);
    const { status } = await marcar(pid, '2026-11-17', 'FALTA_JUSTIFICADA', owner.token);
    assertStatus(status, 400, 'planilla congelada');
  });

  // ═══ C. Compensatorio ═══
  await scenario('C1 marca FRANCO_COMPENSATORIO con saldo → pendientes +1', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-19');
    const { status, body } = await marcar(pid, '2026-11-19', 'FRANCO_COMPENSATORIO', owner.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(body.marcaManual.estado === 'PENDIENTE', `estado=${body.marcaManual?.estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend + 1, `pendientes ${before.pend}→${after.pend}`);
  });
  await scenario('C2 sin saldo disponible → 400', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 0, compensatoriosUsados: 0 }, ana.token);
    const s = await getCompSaldo(owner.token);
    info(`saldo: acum=${s.acum} usados=${s.usados} pend=${s.pend} disp=${s.disp}`);
    const pid = await nuevaPlanilla('2026-11-20');
    const { status, body } = await marcar(pid, '2026-11-20', 'FRANCO_COMPENSATORIO', owner.token);
    assertStatus(status, 400, JSON.stringify(body));
    assert(/insuficiente/i.test(JSON.stringify(body)), `msg=${JSON.stringify(body)}`);
  });
  await scenario('C3 quitar una marca comp PENDIENTE devuelve el pendiente', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-11-23');
    const { body: reg } = await marcar(pid, '2026-11-23', 'FRANCO_COMPENSATORIO', owner.token);
    assert((await getCompSaldo(owner.token)).pend === before.pend + 1, 'reservó el pendiente');
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 204, 'quitar comp');
    assert((await getCompSaldo(owner.token)).pend === before.pend, 'devolvió el pendiente');
  });

  // ═══ D. Quitar la marca — el síntoma reportado: "no puedo borrar la marca" ═══
  await scenario('D1 el dueño quita su marca → 204 y el día queda libre', async () => {
    const pid = await nuevaPlanilla('2026-11-25');
    const { body: reg } = await marcar(pid, '2026-11-25', 'FALTA_JUSTIFICADA', owner.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 204, 'quitar');
    const { body: pl } = await get(`/planillas/${pid}`, owner.token);
    const dia = (pl.registros as any[]).find(r => String(r.fecha).startsWith('2026-11-25'));
    assert(!dia || dia.bloqueado === false, `el día sigue bloqueado: ${JSON.stringify(dia)}`);
  });
  await scenario('D2 quitar la marca cancela la solicitud: la Ausencia desaparece', async () => {
    const pid = await nuevaPlanilla('2026-11-26');
    const { body: reg } = await marcar(pid, '2026-11-26', 'FALTA_JUSTIFICADA', owner.token);
    const ausId = reg.marcaManual.id;
    await del(`/planillas/${pid}/marcas/${ausId}`, owner.token);
    const { status } = await get(`/ausencias/${ausId}`, owner.token);
    assertStatus(status, 404, 'la ausencia debe haberse borrado');
  });
  await scenario('D3 el supervisor NO puede quitar la marca del subordinado → 403', async () => {
    const pid = await nuevaPlanilla('2026-11-27');
    const { body: reg } = await marcar(pid, '2026-11-27', 'FALTA_JUSTIFICADA', owner.token);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, sup.token);
    assertStatus(status, 403, 'supervisor quitando marca ajena');
  });
  await scenario('D4 planilla ENVIADA: no se puede quitar → 400', async () => {
    const pid = await nuevaPlanilla('2026-11-30', '2026-12-01');
    const { body: reg } = await marcar(pid, '2026-11-30', 'FALTA_JUSTIFICADA', owner.token);
    await completarDias(pid, ['2026-12-01']);
    const env = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(env.status, 200, `enviar: ${JSON.stringify(env.body)}`);
    const { status } = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 400, 'planilla congelada');
  });
  await scenario('D5 validar / validar-todo ya no existen → 404', async () => {
    const pid = await nuevaPlanilla('2026-12-03');
    const { body: reg } = await marcar(pid, '2026-12-03', 'FALTA_JUSTIFICADA', owner.token);
    const v1 = await post(`/planillas/${pid}/marcas/${reg.marcaManual.id}/validar`, {}, sup.token);
    assertStatus(v1.status, 404, `validar: ${JSON.stringify(v1.body)}`);
    const v2 = await post(`/planillas/${pid}/marcas/validar-todo`, {}, sup.token);
    assertStatus(v2.status, 404, `validar-todo: ${JSON.stringify(v2.body)}`);
  });

  // ═══ E. Las marcas viajan con la planilla ═══
  await scenario('E1 aprobar la planilla aprueba sus marcas, sin validación previa', async () => {
    const pid = await nuevaPlanilla('2026-12-07', '2026-12-08');
    const { body: reg } = await marcar(pid, '2026-12-07', 'FALTA_JUSTIFICADA', owner.token);
    await completarDias(pid, ['2026-12-08']);
    const env = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(env.status, 200, `enviar: ${JSON.stringify(env.body)}`);

    // El gate viejo devolvía 400 acá por "marcas sin validar". Ya no existe.
    const estado = await aprobarPlanilla(pid);
    assert(estado === 'APROBADA', `la planilla quedó en ${estado}`);
    const { body: aus } = await get(`/ausencias/${reg.marcaManual.id}`, owner.token);
    assert(aus.estado === 'APROBADA', `la marca quedó en ${aus.estado}`);
    assert(aus.aprobada === true, `aprobada=${aus.aprobada}`);
  });
  await scenario('E2 al aprobar la planilla, el comp pasa de pendiente a usado', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-12-10', '2026-12-11');
    await marcar(pid, '2026-12-10', 'FRANCO_COMPENSATORIO', owner.token);
    const mid = await getCompSaldo(owner.token);
    assert(mid.pend === before.pend + 1, `pend ${before.pend}→${mid.pend}`);
    await completarDias(pid, ['2026-12-11']);
    const env = await post(`/planillas/${pid}/enviar`, {}, owner.token);
    assertStatus(env.status, 200, `enviar: ${JSON.stringify(env.body)}`);
    const estado = await aprobarPlanilla(pid);
    assert(estado === 'APROBADA', `la planilla quedó en ${estado}`);
    const after = await getCompSaldo(owner.token);
    assert(after.pend === before.pend && after.usados === before.usados + 1,
      `pend ${mid.pend}→${after.pend} (esperado ${before.pend}), usados ${before.usados}→${after.usados}`);
  });
  await scenario('E3 GET /planillas/:id trae la marca en el registro', async () => {
    const pid = await nuevaPlanilla('2026-12-14');
    await marcar(pid, '2026-12-14', 'LICENCIA_ESPECIAL', owner.token);
    const { body } = await get(`/planillas/${pid}`, owner.token);
    const dia = (body.registros as any[]).find(r => String(r.fecha).startsWith('2026-12-14'));
    assert(dia?.marcaManual?.estado === 'PENDIENTE', `marcaManual=${JSON.stringify(dia?.marcaManual)}`);
  });

  // ═══ F. Certificado médico adjunto después de crear la marca ═══
  await scenario('F1 el dueño adjunta el certificado a su marca ya creada', async () => {
    const pid = await nuevaPlanilla('2026-12-16');
    const { body: reg } = await marcar(pid, '2026-12-16', 'CERTIFICADO_MEDICO', owner.token, 'Gripe');
    const up = await subirArchivo(`/ausencias/${reg.marcaManual.id}/archivo`, owner.token);
    assertStatus(up.status, 200, JSON.stringify(up.body));
    const { body: pl } = await get(`/planillas/${pid}`, owner.token);
    const dia = (pl.registros as any[]).find(r => String(r.fecha).startsWith('2026-12-16'));
    assert(!!dia?.marcaManual?.archivoUrl, `archivoUrl=${dia?.marcaManual?.archivoUrl}`);
  });
  await scenario('F2 el supervisor NO puede adjuntar a la marca del subordinado → 403', async () => {
    const pid = await nuevaPlanilla('2026-12-17');
    const { body: reg } = await marcar(pid, '2026-12-17', 'CERTIFICADO_MEDICO', owner.token);
    const up = await subirArchivo(`/ausencias/${reg.marcaManual.id}/archivo`, sup.token);
    assertStatus(up.status, 403, JSON.stringify(up.body));
  });
  await scenario('F3 quitar la marca se lleva el certificado (no queda servible)', async () => {
    const pid = await nuevaPlanilla('2026-12-18');
    const { body: reg } = await marcar(pid, '2026-12-18', 'CERTIFICADO_MEDICO', owner.token);
    const up = await subirArchivo(`/ausencias/${reg.marcaManual.id}/archivo`, owner.token);
    assertStatus(up.status, 200, JSON.stringify(up.body));
    const url: string = up.body.archivoUrl;
    assert(!!url, `sin archivoUrl: ${JSON.stringify(up.body)}`);
    const antes = await getUpload(url, owner);
    assert(antes === 200, `el archivo debía servirse antes de borrar (got ${antes})`);
    const d = await del(`/planillas/${pid}/marcas/${reg.marcaManual.id}`, owner.token);
    assertStatus(d.status, 204, 'quitar marca con adjunto');
    const despues = await getUpload(url, owner);
    assert(despues !== 200, `el archivo sigue accesible tras borrar la marca (${despues})`);
  });

  // ═══ G. Borrar la planilla limpia sus marcas ═══
  await scenario('G1 borrar la planilla libera el saldo y no deja ausencias huérfanas', async () => {
    await put(`/vacacion-saldos/${saldoId}`, { compensatoriosAcumulados: 5, compensatoriosUsados: 0 }, ana.token);
    const before = await getCompSaldo(owner.token);
    const pid = await nuevaPlanilla('2026-12-21');
    const { body: reg } = await marcar(pid, '2026-12-21', 'FRANCO_COMPENSATORIO', owner.token);
    assert((await getCompSaldo(owner.token)).pend === before.pend + 1, 'reservó el pendiente');
    const d = await del(`/planillas/${pid}`, owner.token);
    assertStatus(d.status, 204, `borrar planilla: ${JSON.stringify(d.body)}`);
    assert((await getCompSaldo(owner.token)).pend === before.pend, 'liberó el pendiente al borrar la planilla');
    const { status } = await get(`/ausencias/${reg.marcaManual.id}`, owner.token);
    assertStatus(status, 404, 'quedó una marca huérfana');
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
