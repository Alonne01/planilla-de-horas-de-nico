/**
 * QA Suite — VISIBILIDAD de planillas y adjuntos por nivel (KEY=visibilidad-nivel)
 *
 * Regla: solo ve la planilla de otro quien puede aprobarla, y solo si el dueño está
 * en un nivel ESTRICTAMENTE menor. La excepción es el jefe directo, que ve a su
 * subordinado aunque compartan nivel. RRHH/ADMIN (>=90) siguen viendo todo.
 * El certificado médico en /uploads sigue el mismo criterio: antes bastaba con ser
 * nivel >=70 del mismo sector para abrirlo por URL directa.
 *
 * Black-box HTTP contra la API viva.
 * Run: cd apps/api && npx tsx tests/qa/visibilidad-nivel.qa.ts
 */
// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'vis';
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
const del = (p: string, tok?: string) => apiCall('DELETE', p, { token: tok });

interface Session { token: string; cookie: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const body: any = await res.json();
  assertStatus(res.status, 200, `Login ${email}: ${JSON.stringify(body)}`);
  const raw = res.headers.get('set-cookie') ?? '';
  const cookie = raw.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0]!.trim()).filter(Boolean).join('; ');
  return { token: body.accessToken, cookie, user: body.user };
}
/** /uploads autentica con la cookie httpOnly, no con el header Authorization. */
async function getUpload(url: string, ses: Session): Promise<number> {
  const res = await fetch(`${BASE.replace('/api/v1', '')}${url}`, { headers: { Cookie: ses.cookie } });
  return res.status;
}
async function subirArchivo(path: string, tok: string): Promise<{ status: number; body: any }> {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fd = new FormData();
  fd.append('archivo', new Blob([png], { type: 'image/png' }), 'cert.png');
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}

async function main() {
  console.log(col('CYAN', `\n═══ QA VISIBILIDAD POR NIVEL suite (ts=${TS}) ═══\n`));
  const admin = await login('admin@wenlen.com');
  const rrhh = await login('rrhh1@test.wenlen.com'); // nivel 90

  // Un sector común para todos: la regla vieja (canManageUser) daba acceso por
  // sector + nivel>=70, así que compartir sector es justo lo que hay que probar.
  //
  // Pero el sector no puede ser cualquiera: la visibilidad sale del flujo, y en un
  // sector con "Planillas - RRHH directo" el supervisor no aprueba nada y por lo
  // tanto NO ve — correcto, pero inútil para probar el filtro por nivel. Hace falta
  // uno cuyo circuito pase por SUPERVISOR y COORDINADOR.
  const { body: sectores } = await get('/admin/sectores', admin.token);
  const listaSectores: any[] = Array.isArray(sectores) ? sectores : (sectores?.data ?? []);
  assert(listaSectores.length > 0, 'no hay sectores cargados');
  const nombreSector = new Map<string, string>(listaSectores.map((s: any) => [s.id, s.nombre]));

  /** Sectores donde el circuito de `tipo` incluye todos los roles pedidos. */
  async function sectoresConCircuito(tipo: string, rolesPedidos: string[]): Promise<Set<string>> {
    const { body: flujos } = await get('/admin/flujos', admin.token);
    const candidatos = (flujos as any[]).filter(f =>
      f.activo && f.tipoDocumento === tipo &&
      rolesPedidos.every(rol => (f.pasos ?? []).some((p: any) => p.rolAprobador === rol)),
    );
    const encontrados = new Set<string>();
    for (const f of candidatos) {
      const { body: detalle } = await get(`/admin/flujos/${f.id}`, admin.token);
      for (const a of (detalle.asignaciones ?? [])) {
        if (a.activo && a.sectorId) encontrados.add(a.sectorId);
      }
    }
    return encontrados;
  }

  const conPlanilla = await sectoresConCircuito('PLANILLA', ['SUPERVISOR', 'COORDINADOR']);
  const conAusencia = await sectoresConCircuito('AUSENCIA', ['COORDINADOR']);
  const ambos = [...conPlanilla].filter(id => conAusencia.has(id));
  assert(conPlanilla.size > 0, 'ningún sector tiene un circuito de PLANILLA con SUPERVISOR y COORDINADOR');
  const sectorId: string = ambos[0] ?? [...conPlanilla][0]!;
  const certAplica = ambos.length > 0;
  // Segundo sector para probar el límite del alcance: el aprobador ve a los de
  // nivel menor DE SU SECTOR, no de toda la empresa.
  const otroSectorId: string | undefined = (ambos[1] ?? [...conPlanilla].find(id => id !== sectorId));
  info(`sector de prueba: ${nombreSector.get(sectorId) ?? sectorId} (certificado con circuito de coordinador: ${certAplica})`);
  info(`sector de contraste: ${otroSectorId ? (nombreSector.get(otroSectorId) ?? otroSectorId) : 'ninguno disponible'}`);

  const ingreso = new Date('2020-01-01T00:00:00Z').toISOString();
  async function createUser(role: string, tag: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { status, body } = await post('/usuarios', {
      nombre: `QA${tag}`, apellido: `Vis${TS}`, email: `qa.${KEY}.${TS}.${tag}@demo.com`,
      password: 'Test1234!', rol: role, fechaIngreso: ingreso, sectorId, ...extra,
    }, rrhh.token);
    assertStatus(status, 201, `create ${tag}: ${JSON.stringify(body)}`);
    return body.id as string;
  }

  // Topología:
  //   coordA (70) ── supA (60) ── opA (10)
  //   coordB (70) ── supB (60) ── opB (10)
  //   supC  (60): subordinado DIRECTO de supB (mismo nivel, supervisorId=supB)
  const ids: Record<string, string> = {};
  await scenario('SETUP coordinadores A y B (nivel 70)', async () => {
    ids.coordA = await createUser('COORDINADOR', 'coordA');
    ids.coordB = await createUser('COORDINADOR', 'coordB');
  });
  await scenario('SETUP supervisores A y B (nivel 60)', async () => {
    ids.supA = await createUser('SUPERVISOR', 'supA', { coordinadorId: ids.coordA });
    ids.supB = await createUser('SUPERVISOR', 'supB', { coordinadorId: ids.coordB });
  });
  await scenario('SETUP operadores A y B (nivel 10)', async () => {
    ids.opA = await createUser('OPERADOR', 'opA', { supervisorId: ids.supA, coordinadorId: ids.coordA });
    ids.opB = await createUser('OPERADOR', 'opB', { supervisorId: ids.supB, coordinadorId: ids.coordB });
  });
  await scenario('SETUP supC: supervisor con supervisorId=supB (mismo nivel, jefe directo)', async () => {
    ids.supC = await createUser('SUPERVISOR', 'supC', { supervisorId: ids.supB });
  });
  await scenario('SETUP supD y coordD en OTRO sector', async () => {
    if (!otroSectorId) { info('no hay un segundo sector con circuito: los contrastes por sector no aplican'); return; }
    ids.supD = await createUser('SUPERVISOR', 'supD', { sectorId: otroSectorId });
    ids.coordD = await createUser('COORDINADOR', 'coordD', { sectorId: otroSectorId });
  });
  cleanupQueue.push(async () => {
    for (const id of [ids.opA, ids.opB, ids.supC, ids.supD, ids.coordD, ids.supA, ids.supB, ids.coordA, ids.coordB]) {
      if (id) await del(`/usuarios/${id}`, admin.token).catch(() => {});
    }
  });

  const opA = await login(`qa.${KEY}.${TS}.opA@demo.com`);
  const opB = await login(`qa.${KEY}.${TS}.opB@demo.com`);
  const supA = await login(`qa.${KEY}.${TS}.supA@demo.com`);
  const supB = await login(`qa.${KEY}.${TS}.supB@demo.com`);
  const supC = await login(`qa.${KEY}.${TS}.supC@demo.com`);
  const coordA = await login(`qa.${KEY}.${TS}.coordA@demo.com`);
  const coordB = await login(`qa.${KEY}.${TS}.coordB@demo.com`);
  const supD = ids.supD ? await login(`qa.${KEY}.${TS}.supD@demo.com`) : null;
  const coordD = ids.coordD ? await login(`qa.${KEY}.${TS}.coordD@demo.com`) : null;

  const createdPlanillas: Array<{ id: string; tok: string }> = [];
  cleanupQueue.push(async () => { for (const p of createdPlanillas) await del(`/planillas/${p.id}`, p.tok).catch(() => {}); });
  async function nuevaPlanilla(fecha: string, ses: Session): Promise<string> {
    const { status, body } = await post('/planillas', { periodoInicio: fecha, periodoFin: fecha }, ses.token);
    assertStatus(status, 201, `crear planilla de ${ses.user.rol}: ${JSON.stringify(body)}`);
    createdPlanillas.push({ id: body.id, tok: ses.token });
    return body.id as string;
  }

  let planillaOpA = '', planillaSupA = '', planillaSupC = '';
  await scenario('SETUP planillas de opA, supA y supC', async () => {
    planillaOpA = await nuevaPlanilla('2027-08-02', opA);
    planillaSupA = await nuevaPlanilla('2027-08-03', supA);
    planillaSupC = await nuevaPlanilla('2027-08-04', supC);
  });

  // ═══ A. GET /planillas/:id — acceso puntual ═══
  await scenario('A1 el dueño ve su propia planilla', async () => {
    assertStatus((await get(`/planillas/${planillaOpA}`, opA.token)).status, 200, 'dueño');
  });
  await scenario('A2 un par (OPERADOR) NO ve la planilla de otro operador → 403', async () => {
    const { status } = await get(`/planillas/${planillaOpA}`, opB.token);
    assertStatus(status, 403, 'par operador');
  });
  await scenario('A3 el supervisor SÍ ve la planilla de su operador', async () => {
    assertStatus((await get(`/planillas/${planillaOpA}`, supA.token)).status, 200, 'supervisor directo');
  });
  await scenario('A4 el alcance es el sector: otro supervisor del sector SÍ ve al operador', async () => {
    // supB no es el jefe de opA, pero comparte sector y el circuito de ese sector
    // lo pone como aprobador. Lo que lo limita es el nivel, no la línea de mando.
    assertStatus((await get(`/planillas/${planillaOpA}`, supB.token)).status, 200, 'supervisor del mismo sector');
  });
  await scenario('A4b un supervisor de OTRO sector no ve la planilla → 403', async () => {
    if (!supD) { info('sin segundo sector: no aplica'); return; }
    const { status } = await get(`/planillas/${planillaOpA}`, supD.token);
    assertStatus(status, 403, 'supervisor de otro sector');
  });
  await scenario('A5 un par (SUPERVISOR) NO ve la planilla de otro supervisor → 403', async () => {
    const { status } = await get(`/planillas/${planillaSupA}`, supB.token);
    assertStatus(status, 403, 'par supervisor, mismo nivel');
  });
  await scenario('A6 el coordinador (70) SÍ ve la planilla de su supervisor (60)', async () => {
    assertStatus((await get(`/planillas/${planillaSupA}`, coordA.token)).status, 200, 'coordinador de la línea');
  });
  await scenario('A7 el jefe directo ve a su subordinado aunque compartan nivel', async () => {
    // supC es SUPERVISOR igual que supB, pero supB es su supervisorId.
    assertStatus((await get(`/planillas/${planillaSupC}`, supB.token)).status, 200, 'jefe directo, mismo nivel');
  });
  await scenario('A8 otro supervisor sin relación NO ve la planilla de supC → 403', async () => {
    const { status } = await get(`/planillas/${planillaSupC}`, supA.token);
    assertStatus(status, 403, 'supervisor sin relación');
  });
  await scenario('A9 RRHH (90) ve cualquier planilla', async () => {
    assertStatus((await get(`/planillas/${planillaOpA}`, rrhh.token)).status, 200, 'RRHH');
    assertStatus((await get(`/planillas/${planillaSupA}`, rrhh.token)).status, 200, 'RRHH sobre supervisor');
  });

  // ═══ B. GET /planillas — el listado usa el mismo filtro ═══
  async function idsDelListado(tok: string): Promise<string[]> {
    const { status, body } = await get('/planillas?limit=200', tok);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    const lista: any[] = Array.isArray(body) ? body : (body.data ?? body.planillas ?? body.items ?? []);
    return lista.map(p => p.id);
  }
  await scenario('B0 el listado de un supervisor de otro sector no trae nada de este', async () => {
    if (!supD) { info('sin segundo sector: no aplica'); return; }
    const vistos = await idsDelListado(supD.token);
    for (const [nombre, pid] of [['opA', planillaOpA], ['supA', planillaSupA], ['supC', planillaSupC]] as const) {
      assert(!vistos.includes(pid), `supD (otro sector) no debería ver la planilla de ${nombre}`);
    }
  });
  await scenario('B1 el listado del supervisor incluye a su operador y no al par', async () => {
    const vistos = await idsDelListado(supA.token);
    assert(vistos.includes(planillaOpA), 'supA debería ver la planilla de opA');
    assert(!vistos.includes(planillaSupC), 'supA NO debería ver la planilla de supC');
  });
  await scenario('B2 el listado de un operador solo trae las propias', async () => {
    const vistos = await idsDelListado(opB.token);
    assert(!vistos.includes(planillaOpA), 'opB no debe ver la planilla de opA');
    assert(!vistos.includes(planillaSupA), 'opB no debe ver la planilla de supA');
  });
  await scenario('B3 el listado del par supervisor no trae la planilla del otro supervisor', async () => {
    const vistos = await idsDelListado(supB.token);
    assert(!vistos.includes(planillaSupA), 'supB no debe ver la planilla de supA (mismo nivel)');
    assert(vistos.includes(planillaSupC), 'supB sí debe ver la de supC (es su jefe directo)');
  });
  await scenario('B4 el listado de RRHH trae las planillas de todos', async () => {
    const vistos = await idsDelListado(rrhh.token);
    for (const [nombre, pid] of [['opA', planillaOpA], ['supA', planillaSupA], ['supC', planillaSupC]] as const) {
      assert(vistos.includes(pid), `RRHH debería ver la planilla de ${nombre}`);
    }
  });

  // ═══ C. Certificado médico en /uploads ═══
  let certUrl = '', ausenciaSupAId = '';
  await scenario('SETUP certificado adjunto a una ausencia de supA', async () => {
    const a = await post('/ausencias/solicitar', {
      tipo: 'CERTIFICADO_MEDICO', fechaInicio: '2027-09-06', fechaFin: '2027-09-06',
      diasAusencia: 1, descripcion: `QA ${TS}`,
    }, supA.token);
    assertStatus(a.status, 201, `crear ausencia: ${JSON.stringify(a.body)}`);
    ausenciaSupAId = a.body.id;
    const up = await subirArchivo(`/ausencias/${ausenciaSupAId}/archivo`, supA.token);
    assertStatus(up.status, 200, `subir certificado: ${JSON.stringify(up.body)}`);
    certUrl = up.body.archivoUrl;
    assert(!!certUrl, `sin archivoUrl: ${JSON.stringify(up.body)}`);
  });

  await scenario('C1 el titular abre su propio certificado', async () => {
    const s = await getUpload(certUrl, supA);
    assert(s === 200, `el titular no pudo abrir su certificado (${s})`);
  });
  await scenario('C2 un par de nivel 60 NO abre el certificado por URL directa', async () => {
    const s = await getUpload(certUrl, supB);
    assert(s !== 200, `supB pudo abrir el certificado de supA (${s})`);
  });
  await scenario('C3 un coordinador de OTRO sector no lo abre', async () => {
    // Con la regla vieja (canManageUser) alcanzaba con ser nivel >=70 de la empresa
    // por sector propio; ahora tiene que tenerlo dentro de su alcance de aprobación.
    if (!coordD) { info('sin segundo sector: no aplica'); return; }
    const s = await getUpload(certUrl, coordD);
    assert(s !== 200, `coordD (otro sector) pudo abrir el certificado de supA (${s})`);
  });
  await scenario('C4 el coordinador de su línea SÍ lo abre', async () => {
    if (!certAplica) { info('el circuito de AUSENCIA de este sector no pasa por COORDINADOR: no aplica'); return; }
    const s = await getUpload(certUrl, coordA);
    assert(s === 200, `coordA no pudo abrir el certificado de su supervisor (${s})`);
  });
  await scenario('C5 RRHH abre cualquier certificado', async () => {
    const s = await getUpload(certUrl, rrhh);
    assert(s === 200, `RRHH no pudo abrir el certificado (${s})`);
  });
  await scenario('C6 un operador no abre el certificado de su supervisor', async () => {
    const s = await getUpload(certUrl, opA);
    assert(s !== 200, `opA pudo abrir el certificado de supA (${s})`);
  });

  // ═══ D. Ausencias: el listado sigue la misma regla ═══
  await scenario('D1 GET /ausencias no filtra ausencias de pares al supervisor', async () => {
    const { status, body } = await get('/ausencias?limit=200', supB.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    const lista: any[] = Array.isArray(body) ? body : (body.data ?? body.ausencias ?? body.items ?? []);
    assert(!lista.some(a => a.id === ausenciaSupAId), 'supB no debería ver la ausencia de supA');
  });
  await scenario('D2 GET /ausencias sí se la muestra a RRHH', async () => {
    const { status, body } = await get('/ausencias?limit=200', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    const lista: any[] = Array.isArray(body) ? body : (body.data ?? body.ausencias ?? body.items ?? []);
    assert(lista.some(a => a.id === ausenciaSupAId), 'RRHH debería ver la ausencia de supA');
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
