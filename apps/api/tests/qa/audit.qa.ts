/**
 * QA Suite — KEY=audit
 * Subsystem: Auditoría, Analytics, Export, Exportaciones, Cambios-Diagrama, Backup
 * Black-box over HTTP. API live at http://localhost:4000/api/v1.
 *
 * Run: cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/audit.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'audit';
const TS = Date.now();

// ── output ──────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  R: '\x1b[0m', DIM: '\x1b[2m', G: '\x1b[32m', RED: '\x1b[31m', Y: '\x1b[33m', CY: '\x1b[36m',
};
function col(k: string, s: string) { return `${C[k] ?? ''}${s}${C.R}`; }

type Result = { name: string; passed: boolean; detail: string; scenario: string };
const results: Result[] = [];
const cleanup: (() => Promise<void>)[] = [];
const bugs: string[] = [];

async function scenario(name: string, label: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true, detail: 'OK', scenario: label });
    process.stdout.write(`  ${col('G', 'PASS')} ${col('DIM', `[${label}]`)} ${name}\n`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail, scenario: label });
    process.stdout.write(`  ${col('RED', 'FAIL')} ${col('DIM', `[${label}]`)} ${name}\n        ${col('Y', detail)}\n`);
  }
}
function assert(cond: boolean, msg: string): asserts cond { if (!cond) throw new Error(msg); }
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected) throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body, contentType: ct };
}
const get = (p: string, t?: string) => api('GET', p, { token: t });
const post = (p: string, b: unknown, t?: string) => api('POST', p, { token: t, body: b });
const put = (p: string, b: unknown, t?: string) => api('PUT', p, { token: t, body: b });
const del = (p: string, t?: string) => api('DELETE', p, { token: t });

interface Session { token: string; user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null }; }
async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}`);
  const b = body as any;
  assert(typeof b.accessToken === 'string', `No accessToken for ${email}`);
  return { token: b.accessToken, user: b.user };
}

function isoDay(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
}

/**
 * El MISMO día que `isoDay`, pero expresado como medianoche argentina — que es
 * lo que manda de verdad el front (`new Date(y, m, d).toISOString()` bajo
 * TZ=AR). `isoDay` devuelve justo la forma ya normalizada por la convención de
 * fecha-día, así que un test que sólo use `isoDay` no puede cazar un handler que
 * compare por igualdad exacta de instantes: coincide de casualidad.
 */
function isoDayAr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T03:00:00.000Z`;
}

/**
 * Un día del mes `mes0` (0-11, admite valores fuera de rango) SIN desbordar al
 * mes siguiente: el día 31 de febrero es el 28, no el 3 de marzo. Es el mismo
 * `fechaEnMes` que usa `generateCycles` en el front (apps/web/src/utils/periodos.ts),
 * porque los ciclos de este test tienen que ser exactamente los que ofrece el
 * selector: el día de inicio/fin lo elige el usuario y el backend acepta hasta 31.
 *
 * Todo en getters UTC, que es la convención de fecha-día del sistema.
 */
function diaEnMes(anio: number, mes0: number, dia: number): { y: number; m: number; d: number } {
  const base = new Date(Date.UTC(anio, mes0, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: Math.min(dia, ultimo) };
}

/** Clave 'YYYY-MM-DD' de un día devuelto por `diaEnMes`. */
function claveDia({ y, m, d }: { y: number; m: number; d: number }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(col('CY', `\n=== QA audit suite (ts=${TS}) ===\n`));

  // ── Bootstrap sessions ──────────────────────────────────────────────────
  const admin = await login('admin@wenlen.com');
  const rrhh = await login('rrhh1@test.wenlen.com');
  const operador = await login('op1.almacen@test.wenlen.com');

  // discover a COORDINADOR and SUPERVISOR
  const { body: duBody } = await get('/auth/debug-users', admin.token);
  const debugUsers = duBody as Array<{ id: string; email: string; rol: string }>;
  const coordEmail = debugUsers.find(u => u.rol === 'COORDINADOR')?.email;
  const supEmail = debugUsers.find(u => u.rol === 'SUPERVISOR')?.email;
  assert(!!coordEmail, 'No COORDINADOR found in debug-users');
  assert(!!supEmail, 'No SUPERVISOR found in debug-users');
  const coord = await login(coordEmail!);
  const supervisor = await login(supEmail!);

  console.log(col('DIM', `  admin=${admin.user.rolNivel} rrhh=${rrhh.user.rolNivel} coord=${coord.user.rolNivel} sup=${supervisor.user.rolNivel} op=${operador.user.rolNivel}\n`));

  // ════════════════════════════════════════════════════════════════════════
  // AUDITORÍA
  // ════════════════════════════════════════════════════════════════════════
  let adminAuditCountBefore = -1;
  await scenario('AUD1 GET /auditoria (RRHH) → 200 array', 'Auditoria', async () => {
    const { status, body } = await get('/auditoria?limit=50', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray(body), 'not an array');
  });
  await scenario('AUD2 GET /auditoria/stats (RRHH) → 200 ultimos30Dias', 'Auditoria', async () => {
    const { status, body } = await get('/auditoria/stats', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as any;
    assert(b.ultimos30Dias && typeof b.ultimos30Dias.total === 'number', `bad shape: ${JSON.stringify(b)}`);
  });
  await scenario('AUD3 GET /auditoria as OPERADOR → 403', 'Auditoria', async () => {
    const { status } = await get('/auditoria', operador.token);
    assertStatus(status, 403);
  });
  await scenario('AUD4 GET /auditoria as SUPERVISOR(60<90) → 403', 'Auditoria', async () => {
    const { status } = await get('/auditoria', supervisor.token);
    assertStatus(status, 403);
  });
  await scenario('AUD5 GET /auditoria as COORDINADOR(70<90) → 403', 'Auditoria', async () => {
    const { status } = await get('/auditoria/stats', coord.token);
    assertStatus(status, 403);
  });
  await scenario('AUD6 GET /auditoria?tipo=admin → 200 (capture baseline)', 'Auditoria', async () => {
    const { status, body } = await get('/auditoria?tipo=admin&limit=500', admin.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray(body), 'not array');
    adminAuditCountBefore = (body as any[]).length;
  });
  await scenario('AUD7 GET /auditoria?tipo=vacacion + date filter → 200', 'Auditoria', async () => {
    const { status, body } = await get('/auditoria?tipo=vacacion&desde=2000-01-01&hasta=2100-01-01&limit=10', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray(body), 'not array');
  });

  // ════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ════════════════════════════════════════════════════════════════════════
  await scenario('AN1 GET /analytics/usuario/:ownId (OPERADOR own) → 200', 'Analytics', async () => {
    const { status, body } = await get(`/analytics/usuario/${operador.user.id}`, operador.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    assert(b.usuario && b.totals && b.vacaciones && Array.isArray(b.trend), `bad shape: ${JSON.stringify(b).slice(0, 200)}`);
  });
  await scenario('AN2 GET /analytics/usuario/:otherId (OPERADOR) → 403', 'Analytics', async () => {
    const { status } = await get(`/analytics/usuario/${admin.user.id}`, operador.token);
    assertStatus(status, 403);
  });
  await scenario('AN3 GET /analytics/usuario/<nonexistent> (RRHH) → 404', 'Analytics', async () => {
    const { status } = await get('/analytics/usuario/00000000-0000-0000-0000-000000000000', rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('AN4 GET /analytics/sectores (RRHH) → 200 array', 'Analytics', async () => {
    const { status, body } = await get('/analytics/sectores', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('AN5 GET /analytics/sectores (OPERADOR) → 403', 'Analytics', async () => {
    const { status } = await get('/analytics/sectores', operador.token);
    assertStatus(status, 403);
  });
  await scenario('AN6 GET /analytics/sectores (SUPERVISOR 60<70) → 403', 'Analytics', async () => {
    const { status } = await get('/analytics/sectores', supervisor.token);
    assertStatus(status, 403);
  });
  let aSectorId = '';
  await scenario('AN7 GET /analytics/sectores (COORDINADOR 70) → 200', 'Analytics', async () => {
    const { status, body } = await get('/analytics/sectores', coord.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const arr = body as Array<{ id: string }>;
    assert(Array.isArray(arr) && arr.length > 0, 'no sectores');
    aSectorId = arr[0].id;
  });
  await scenario('AN8 GET /analytics/sector/:sid (COORDINADOR) → 200 shape', 'Analytics', async () => {
    assert(!!aSectorId, 'no sector id (AN7 failed)');
    const { status, body } = await get(`/analytics/sector/${aSectorId}`, coord.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    assert(b.sector && b.totals && Array.isArray(b.userBreakdown), `bad shape: ${JSON.stringify(b).slice(0, 150)}`);
  });
  await scenario('AN9 GET /analytics/sector/<bad> (RRHH) → 404', 'Analytics', async () => {
    const { status } = await get('/analytics/sector/00000000-0000-0000-0000-000000000000', rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('AN10 GET /analytics/empresa (RRHH 90) → 200 shape', 'Analytics', async () => {
    const { status, body } = await get('/analytics/empresa', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    assert(typeof b.totalUsuarios === 'number' && b.totals && Array.isArray(b.sectorBreakdown), `bad shape: ${JSON.stringify(b).slice(0, 150)}`);
  });
  await scenario('AN11 GET /analytics/empresa (COORDINADOR 70<90) → 403', 'Analytics', async () => {
    const { status } = await get('/analytics/empresa', coord.token);
    assertStatus(status, 403);
  });
  await scenario('AN12 GET /analytics/empresa?period filters (RRHH) → 200', 'Analytics', async () => {
    const { status } = await get('/analytics/empresa?periodoInicio=2000-01-01&periodoFin=2100-01-01', rrhh.token);
    assertStatus(status, 200);
  });

  // ════════════════════════════════════════════════════════════════════════
  // TEST BED — own operator + flujo(RRHH 1 step) + APROBADA planilla
  // ════════════════════════════════════════════════════════════════════════
  let opId = '';
  let opSession: Session | null = null;
  let flujoId = '';
  let asignId = '';
  let planillaId = '';
  let pInicioIso = '';
  let pFinIso = '';
  // El mismo período que pInicioIso/pFinIso pero en medianoche argentina, tal
  // como lo manda el front. Ver isoDayAr().
  let pInicioArIso = '';
  let pFinArIso = '';
  const opEmail = `qa.${KEY}.${TS}@demo.com`;

  await scenario('BED1 RRHH creates dedicated OPERADOR', 'TestBed', async () => {
    const { status, body } = await post('/usuarios', {
      nombre: 'QAaudit', apellido: `Owner${TS}`, email: opEmail,
      password: 'QaAudit1234!', rol: 'OPERADOR', fechaIngreso: '2024-01-01T00:00:00.000Z',
    }, rrhh.token);
    assertStatus(status, 201, JSON.stringify(body));
    opId = (body as any).id;
    cleanup.push(async () => { await del(`/usuarios/${opId}`, admin.token); });
    opSession = await login(opEmail);
  });

  await scenario('BED2 Admin creates PLANILLA flujo (1 RRHH step) + user-scoped asignacion', 'TestBed', async () => {
    assert(!!opId, 'no opId');
    const { status: fs, body: fb } = await post('/admin/flujos', {
      nombre: `QA-${KEY}-Flujo-${TS}`, tipoDocumento: 'PLANILLA', descripcion: 'QA audit test bed',
      pasos: [{ orden: 1, nombrePaso: 'Aprob RRHH', rolAprobador: 'RRHH', requiereComentarioRechazo: true, notificarRoles: [] }],
    }, admin.token);
    assertStatus(fs, 201, JSON.stringify(fb));
    flujoId = (fb as any).id;
    const { status: as, body: ab } = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'PLANILLA', usuarioId: opId,
    }, admin.token);
    assertStatus(as, 201, JSON.stringify(ab));
    asignId = (ab as any).id;
    cleanup.push(async () => {
      if (asignId) await del(`/admin/flujos/asignaciones/${asignId}`, admin.token);
      if (flujoId) await del(`/admin/flujos/${flujoId}`, admin.token);
    });
  });

  await scenario('BED3 Operator creates + fills planilla (unique 3-day period)', 'TestBed', async () => {
    assert(!!opSession, 'no opSession');
    const y = 2080 + (TS % 20);
    const m = (TS % 12) + 1;
    const d = (TS % 25) + 1;
    pInicioIso = isoDay(y, m, d);
    pFinIso = isoDay(y, m, d + 2);
    pInicioArIso = isoDayAr(y, m, d);
    pFinArIso = isoDayAr(y, m, d + 2);
    const dates = [isoDay(y, m, d), isoDay(y, m, d + 1), isoDay(y, m, d + 2)];
    const { status, body } = await post('/planillas', { periodoInicio: pInicioIso, periodoFin: pFinIso }, opSession!.token);
    assertStatus(status, 201, JSON.stringify(body));
    planillaId = (body as any).id;
    for (const dt of dates) {
      const dayOnly = dt.split('T')[0];
      const { status: rs, body: rb } = await post(`/planillas/${planillaId}/registros`, {
        fecha: dayOnly,
        entradaTurno1: `${dayOnly}T08:00:00.000Z`,
        salidaTurno1: `${dayOnly}T17:00:00.000Z`,
        lugarTrabajo: 'BASE',
      }, opSession!.token);
      assertStatus(rs, 201, `registro ${dayOnly}: ${JSON.stringify(rb)}`);
    }
  });

  await scenario('BED4 Operator enviar → ENVIADA', 'TestBed', async () => {
    const { status, body } = await post(`/planillas/${planillaId}/enviar`, {}, opSession!.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as any).estado === 'ENVIADA', `estado=${(body as any).estado}`);
  });

  await scenario('BED5 RRHH avanzar → APROBADA', 'TestBed', async () => {
    const { status, body } = await post(`/planillas/${planillaId}/avanzar`, { comentario: 'QA approve' }, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as any).estado === 'APROBADA', `estado=${(body as any).estado}`);
  });

  // ── AUDIT: verify the planilla transition WAS logged ──────────────────────
  await scenario('AUD8 /auditoria logs planilla action (actor+entidad+estado)', 'Auditoria', async () => {
    assert(!!opId && !!planillaId, 'test bed incomplete');
    const { status, body } = await get(`/auditoria?usuarioId=${opId}&tipo=planilla&limit=50`, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const arr = body as Array<any>;
    const mine = arr.filter(e => e.entidadId === planillaId);
    assert(mine.length >= 1, `no audit entries for planilla ${planillaId}`);
    const e = mine[0];
    assert(e.tipo === 'PLANILLA', `tipo=${e.tipo}`);
    assert(e.usuario && e.usuario.id === opId, `actor mismatch: ${JSON.stringify(e.usuario)}`);
    assert(typeof e.estadoNuevo === 'string', 'no estadoNuevo');
  });

  // ── AUDIT GAP: admin config change leaves no AuditoriaLog (logAuditoria dead code) ──
  await scenario('AUD9 PUT /admin/config NOT audit-logged [gap]', 'Auditoria', async () => {
    if (adminAuditCountBefore < 0) throw new Error('baseline AUD6 failed');
    const { body: cfgBody } = await get('/admin/config', admin.token);
    const orig = (cfgBody as any).horasJornadaNormal as number;
    const newVal = orig === 8 ? 9 : 8;
    const { status: ps } = await put('/admin/config', { horasJornadaNormal: newVal }, admin.token);
    assertStatus(ps, 200);
    // restore immediately
    await put('/admin/config', { horasJornadaNormal: orig }, admin.token);
    const { body: after } = await get('/auditoria?tipo=admin&limit=500', admin.token);
    const afterCount = (after as any[]).length;
    // Demonstrate the gap: the config mutation produced ZERO new admin audit rows.
    if (afterCount === adminAuditCountBefore) {
      bugs.push(`AUD9: admin config change produced no AuditoriaLog entry (count stayed ${afterCount}) — logAuditoria/logFieldChanges are dead code (src/lib/auditoria.ts never imported).`);
    } else {
      throw new Error(`Expected no new admin audit rows (gap), but count rose ${adminAuditCountBefore}->${afterCount}; admin mutations may now be audited`);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ════════════════════════════════════════════════════════════════════════
  const XLSX = 'spreadsheetml.sheet';
  await scenario('EX1 GET /export/planilla/:id (RRHH) → 200 xlsx', 'Export', async () => {
    const { status, contentType } = await get(`/export/planilla/${planillaId}`, rrhh.token);
    assertStatus(status, 200);
    assert(contentType.includes(XLSX), `content-type=${contentType}`);
  });
  await scenario('EX2 GET /export/planilla/:id (owner) → 200', 'Export', async () => {
    const { status } = await get(`/export/planilla/${planillaId}`, opSession!.token);
    assertStatus(status, 200);
  });
  await scenario('EX3 GET /export/planilla/:id (other OPERADOR) → 403', 'Export', async () => {
    const { status } = await get(`/export/planilla/${planillaId}`, operador.token);
    assertStatus(status, 403);
  });
  await scenario('EX4 GET /export/planilla/<bad> (RRHH) → 404', 'Export', async () => {
    const { status } = await get('/export/planilla/00000000-0000-0000-0000-000000000000', rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('EX5 GET /export/sector/:sid (RRHH) → 200 csv', 'Export', async () => {
    assert(!!aSectorId, 'no sector');
    const { status, contentType } = await get(`/export/sector/${aSectorId}`, rrhh.token);
    assertStatus(status, 200);
    assert(contentType.includes('text/csv'), `content-type=${contentType}`);
  });
  await scenario('EX6 GET /export/sector/<bad> (RRHH) → 404', 'Export', async () => {
    const { status } = await get('/export/sector/00000000-0000-0000-0000-000000000000', rrhh.token);
    assertStatus(status, 404);
  });
  await scenario('EX7 GET /export/sector/:sid (OPERADOR) → 403', 'Export', async () => {
    const { status } = await get(`/export/sector/${aSectorId}`, operador.token);
    assertStatus(status, 403);
  });
  await scenario('EX8 GET /export/pendientes (RRHH) → 200 xlsx', 'Export', async () => {
    assert(!!pInicioArIso, 'test bed incomplete');
    const { status, contentType } = await get(
      `/export/pendientes?periodoInicio=${encodeURIComponent(pInicioArIso)}&periodoFin=${encodeURIComponent(pFinArIso)}`,
      rrhh.token,
    );
    assertStatus(status, 200);
    assert(contentType.includes(XLSX), `content-type=${contentType}`);
  });
  await scenario('EX9 GET /export/pendientes (OPERADOR) → 403', 'Export', async () => {
    const { status } = await get('/export/pendientes', operador.token);
    assertStatus(status, 403);
  });
  await scenario('EX10 POST /export/cierre {exportarTodos,forzar} (RRHH) → 200 xlsx', 'Export', async () => {
    assert(!!pInicioArIso, 'test bed incomplete');
    const { status, contentType } = await post('/export/cierre', {
      exportarTodos: true, forzar: true, periodoInicio: pInicioArIso, periodoFin: pFinArIso,
    }, rrhh.token);
    assertStatus(status, 200);
    assert(contentType.includes(XLSX), `content-type=${contentType}`);
  });
  await scenario('EX11 POST /export/cierre no forzar (RRHH) → 409 pendientes', 'Export', async () => {
    assert(!!pInicioArIso, 'test bed incomplete');
    const { status, body } = await post('/export/cierre', {
      exportarTodos: true, periodoInicio: pInicioArIso, periodoFin: pFinArIso,
    }, rrhh.token);
    assertStatus(status, 409, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray((body as any).pendientes), 'no pendientes array');
  });
  await scenario('EX12 POST /export/cierre (OPERADOR) → 403', 'Export', async () => {
    // Sin período a propósito: la autorización tiene que cortar ANTES de validar
    // el body, si no un OPERADOR distingue "sin permisos" de "período inválido".
    const { status } = await post('/export/cierre', { exportarTodos: true, forzar: true }, operador.token);
    assertStatus(status, 403);
  });

  // ── Alcance por PERÍODO del cierre ────────────────────────────────────────
  // Los tres endpoints de exportación consultaban TODAS las planillas
  // APROBADA/CERRADA sin filtro de período. Eso tenía dos consecuencias: el
  // Excel arrastraba el histórico entero, y —peor— el chequeo de "usuarios sin
  // planilla aprobada" que devuelve 409 y bloquea el cierre daba por entregada
  // una planilla aprobada de CUALQUIER período, así que se podía cerrar un ciclo
  // con gente que no había presentado nada. EX14 es ese escenario.
  //
  // Período de control: 2078, disjunto del que usa el test bed (2080+TS%20) y
  // del ciclo vigente. EX14 verifica que esté vacío antes de concluir nada.
  const zMes = (TS % 12) + 1;
  const zDia = (TS % 25) + 1;
  const zInicioAr = isoDayAr(2078, zMes, zDia);
  const zFinAr = isoDayAr(2078, zMes, zDia + 2);

  await scenario('EX13 POST /export/cierre del período del test bed → el dueño NO figura pendiente', 'Export', async () => {
    assert(!!opId && !!pInicioArIso, 'test bed incomplete');
    const { status, body } = await post('/export/cierre', {
      exportarTodos: true, periodoInicio: pInicioArIso, periodoFin: pFinArIso,
    }, rrhh.token);
    assertStatus(status, 409, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    assert(b.totalAprobadas >= 1, `totalAprobadas=${b.totalAprobadas}, se esperaba al menos la planilla del test bed`);
    assert(
      !(b.pendientes as Array<{ id: string }>).some(p => p.id === opId),
      'el dueño de la planilla aprobada de ESTE período figura como pendiente',
    );
  });

  await scenario('EX14 POST /export/cierre de OTRO período: ni arrastra aprobadas ni las da por entregadas', 'Export', async () => {
    assert(!!opId, 'test bed incomplete');
    // El período de control tiene que estar vacío, y se confirma con la MISMA
    // lista que muestra la pantalla de Cierre (GET /planillas?periodo...).
    const { status: ls, body: lb } = await get(
      `/planillas?periodoInicio=${encodeURIComponent(zInicioAr)}&periodoFin=${encodeURIComponent(zFinAr)}`,
      rrhh.token,
    );
    assertStatus(ls, 200, JSON.stringify(lb).slice(0, 200));
    const enZ = (lb as Array<{ estado: string }>).filter(p => p.estado === 'APROBADA' || p.estado === 'CERRADA');
    assert(enZ.length === 0, `el período de control no está vacío (${enZ.length} planillas aprobadas): elegí otro`);

    const { status, body } = await post('/export/cierre', {
      exportarTodos: true, periodoInicio: zInicioAr, periodoFin: zFinAr,
    }, rrhh.token);
    assertStatus(status, 409, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    // Las dos consecuencias se reportan juntas: la segunda (el chequeo que
    // bloquea el cierre) es la grave y no se ve si la primera corta antes.
    const fallas: string[] = [];
    if (!(b.pendientes as Array<{ id: string }>).some(p => p.id === opId)) {
      fallas.push('el chequeo de pendientes da por entregada una planilla aprobada de OTRO período: el cierre deja pasar a ese usuario');
    }
    if (b.totalAprobadas !== 0) {
      fallas.push(`el Excel arrastra ${b.totalAprobadas} planilla(s) aprobada(s) de OTRO período`);
    }
    assert(fallas.length === 0, fallas.join(' || '));
  });

  await scenario('EX15 POST /export/cierre sin período → 400 (no 500)', 'Export', async () => {
    const { status, body } = await post('/export/cierre', { exportarTodos: true, forzar: true }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body).slice(0, 200));
  });

  await scenario('EX16 GET /export/pendientes sin período → 400 (no 500)', 'Export', async () => {
    const { status, body } = await get('/export/pendientes', rrhh.token);
    assertStatus(status, 400, JSON.stringify(body).slice(0, 200));
  });

  await scenario('EX17 POST /export/cierre con período inválido → 400 (no 500)', 'Export', async () => {
    const { status, body } = await post('/export/cierre', {
      exportarTodos: true, forzar: true, periodoInicio: 'no-es-fecha', periodoFin: pFinArIso,
    }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body).slice(0, 200));
  });

  await scenario('EX18 el Excel y el chequeo de pendientes salen de la MISMA ventana', 'Export', async () => {
    // INVARIANTE, atada acá y no sólo con un comentario en el handler: el
    // listado que va al Excel (`totalAprobadas`) y el chequeo que devuelve 409 y
    // bloquea el cierre (`totalPendientes`) tienen que derivar del MISMO período
    // y del MISMO universo de usuarios. Hoy se cumple porque los dos salen de un
    // único `findMany`; el día que alguien meta una segunda consulta con otra
    // ventana, esta identidad se rompe y este test lo caza.
    //
    // Con `exportarTodos: true` el universo del endpoint es `{empresaId,
    // activo: true}`, que es exactamente lo que devuelve GET /usuarios?activo=true
    // para un RRHH (nivel 90, sin recorte por sector). Y como no puede haber dos
    // planillas del mismo usuario en un mismo ciclo, vale la igualdad:
    //     totalAprobadas + totalPendientes === usuarios activos
    const { status: us, body: ub } = await get('/usuarios?activo=true', rrhh.token);
    assertStatus(us, 200, JSON.stringify(ub).slice(0, 200));
    const activos = (ub as unknown[]).length;
    assert(activos > 0, 'no hay usuarios activos con los que verificar la invariante');

    for (const [etiqueta, ini, fin] of [
      ['período del test bed', pInicioArIso, pFinArIso],
      ['período de control vacío', zInicioAr, zFinAr],
    ] as const) {
      const { status, body } = await post('/export/cierre', {
        exportarTodos: true, periodoInicio: ini, periodoFin: fin,
      }, rrhh.token);
      assertStatus(status, 409, `${etiqueta}: ${JSON.stringify(body).slice(0, 200)}`);
      const b = body as { totalAprobadas: number; totalPendientes: number };
      assert(
        b.totalAprobadas + b.totalPendientes === activos,
        `${etiqueta}: totalAprobadas(${b.totalAprobadas}) + totalPendientes(${b.totalPendientes}) = `
        + `${b.totalAprobadas + b.totalPendientes} ≠ ${activos} usuarios activos — el Excel y el `
        + 'chequeo de pendientes dejaron de mirar la misma ventana',
      );
    }
  });

  // ── Períodos que no anidan en NINGÚN ciclo ofrecido ───────────────────────
  //
  // `filtroPeriodoPlanilla` exige anidamiento (`periodoInicio >= X` y
  // `periodoFin <= Y`), y está bien que así sea: con solapamiento una misma
  // planilla caería en dos ciclos y se contaría/cerraría dos veces. El efecto
  // colateral es que una planilla guardada bajo OTRA configuración de ciclo
  // (esta empresa pasó de 21/20 a 16/15) no anida en ninguno de los ciclos que
  // la pantalla de Cierre ofrece: no se lista, no entra al Excel y su dueño
  // cuenta como pendiente en el 409 que bloquea el cierre — todo en silencio.
  //
  // `GET /export/periodos` es lo que rompe el silencio: devuelve los pares
  // (periodoInicio, periodoFin) que existen de verdad, con cuántas planillas
  // hay en cada uno y en qué estado, para que el front los compare contra los
  // ciclos que ya genera y avise por los que no están.
  let huerfanaId = '';
  let hInicioKey = '';
  let hFinKey = '';
  const claveDe = (p: { periodoInicio: string; periodoFin: string }) =>
    `${p.periodoInicio.slice(0, 10)}|${p.periodoFin.slice(0, 10)}`;

  await scenario('EX19 GET /export/periodos (RRHH) → 200 con el período del test bed y su estado', 'Export', async () => {
    assert(!!pInicioIso, 'test bed incomplete');
    const { status, body } = await get('/export/periodos', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const arr = body as Array<{ periodoInicio: string; periodoFin: string; total: number; porEstado: Record<string, number> }>;
    assert(Array.isArray(arr), 'not array');
    const buscada = `${pInicioIso.slice(0, 10)}|${pFinIso.slice(0, 10)}`;
    const mio = arr.find(p => claveDe(p) === buscada);
    assert(!!mio, `el período del test bed (${buscada}) no figura en /export/periodos`);
    assert(mio!.total >= 1, `total=${mio!.total}, se esperaba al menos la planilla del test bed`);
    const firmadas = (mio!.porEstado.APROBADA ?? 0) + (mio!.porEstado.CERRADA ?? 0);
    assert(firmadas >= 1, `porEstado no cuenta la planilla aprobada del test bed: ${JSON.stringify(mio!.porEstado)}`);
    // Las puntas salen normalizadas a medianoche UTC del día argentino: el
    // front las compara con `diaKey`, que saca la clave del STRING. Si
    // volvieran con `03:00:00.000Z` (la convención vieja que todavía convive en
    // la base) la clave sería la misma, pero un `15:00:00.000Z` correría el día.
    assert(
      mio!.periodoInicio.endsWith('T00:00:00.000Z') && mio!.periodoFin.endsWith('T00:00:00.000Z'),
      `período sin normalizar: ${mio!.periodoInicio} .. ${mio!.periodoFin}`,
    );
  });

  await scenario('EX20 GET /export/periodos: permisos (nivel < RRHH → 403, sin token → 401)', 'Export', async () => {
    for (const [etiqueta, s] of [['OPERADOR', operador], ['SUPERVISOR', supervisor], ['COORDINADOR', coord]] as const) {
      const { status } = await get('/export/periodos', s.token);
      assertStatus(status, 403, `${etiqueta} (nivel ${s.user.rolNivel}) no debería ver los períodos de toda la empresa`);
    }
    const { status: sinToken } = await get('/export/periodos');
    assertStatus(sinToken, 401, 'sin token');
    const { status: adminStatus } = await get('/export/periodos', admin.token);
    assertStatus(adminStatus, 200, 'ADMIN');
  });

  await scenario('EX21 un período que NO anida en ningún ciclo aparece en /export/periodos', 'Export', async () => {
    assert(!!opSession, 'test bed incomplete');
    // La configuración REAL de ciclo de la empresa: el escenario tiene que valer
    // con 16/15, con 21/20 o con lo que haya configurado en el momento.
    const { status: cs, body: cb } = await get('/config/periodo', rrhh.token);
    assertStatus(cs, 200, JSON.stringify(cb).slice(0, 200));
    const { periodoDiaInicio: di, periodoDiaFin: df } = cb as { periodoDiaInicio: number; periodoDiaFin: number };

    // Año 2073: fuera de los rangos que ocupan las otras suites (2070, 2078,
    // 2080-2099). `mes0` ≤ 8 para que el ciclo B termine como mucho en
    // noviembre y no haya que cruzar de año.
    const anio = 2073;
    const mes0 = TS % 9;
    const cicloA = { ini: diaEnMes(anio, mes0, di), fin: diaEnMes(anio, mes0 + 1, df) };
    const cicloB = { ini: diaEnMes(anio, mes0 + 1, di), fin: diaEnMes(anio, mes0 + 2, df) };

    // El período huérfano abarca los DOS ciclos: no anida en A (termina
    // después) ni en B (empieza antes), y tampoco en ningún otro — un ciclo que
    // lo contuviera tendría que empezar en el mes M o antes y terminar en el
    // mes M+2 o después, y todos los ciclos van de un mes al siguiente. Vale
    // para cualquier (diaInicio, diaFin) configurado.
    const hIni = cicloA.ini;
    const hFin = cicloB.fin;
    hInicioKey = claveDia(hIni);
    hFinKey = claveDia(hFin);

    const { status: ps, body: pb } = await post('/planillas', {
      periodoInicio: isoDayAr(hIni.y, hIni.m, hIni.d),
      periodoFin: isoDayAr(hFin.y, hFin.m, hFin.d),
    }, opSession!.token);
    assertStatus(ps, 201, JSON.stringify(pb));
    huerfanaId = (pb as any).id;
    cleanup.push(async () => { await del(`/planillas/${huerfanaId}`, opSession!.token); });

    // (a) Los dos ciclos que la rozan NO la traen. Es literalmente lo que ve la
    //     pantalla de Cierre, que lista con GET /planillas?periodoInicio=&periodoFin=.
    for (const [etiqueta, c] of [['ciclo A', cicloA], ['ciclo B', cicloB]] as const) {
      const ini = isoDayAr(c.ini.y, c.ini.m, c.ini.d);
      const fin = isoDayAr(c.fin.y, c.fin.m, c.fin.d);
      const { status, body } = await get(
        `/planillas?periodoInicio=${encodeURIComponent(ini)}&periodoFin=${encodeURIComponent(fin)}`,
        rrhh.token,
      );
      assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
      assert(
        !(body as Array<{ id: string }>).some(p => p.id === huerfanaId),
        `${etiqueta} (${claveDia(c.ini)}..${claveDia(c.fin)}) devolvió la planilla huérfana: `
        + 'el filtro de período dejó de exigir anidamiento',
      );
    }

    // (b) …pero /export/periodos SÍ la muestra, con la MISMA ventana que pide
    //     el front (el tramo que cubre el selector). Sin esto la planilla es
    //     inalcanzable y nadie se entera.
    const { status, body } = await get(
      `/export/periodos?desde=${claveDia(cicloA.ini)}&hasta=${claveDia(cicloB.fin)}`,
      rrhh.token,
    );
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const arr = body as Array<{ periodoInicio: string; periodoFin: string; total: number; porEstado: Record<string, number> }>;
    const encontrado = arr.find(p => claveDe(p) === `${hInicioKey}|${hFinKey}`);
    assert(!!encontrado, `/export/periodos no devolvió el período huérfano ${hInicioKey}..${hFinKey}: ${JSON.stringify(arr).slice(0, 300)}`);
    assert(
      (encontrado!.porEstado.BORRADOR ?? 0) >= 1,
      `porEstado no cuenta el borrador huérfano: ${JSON.stringify(encontrado!.porEstado)}`,
    );
  });

  await scenario('EX22 GET /export/periodos: la ventana acota por SOLAPAMIENTO, no por anidamiento', 'Export', async () => {
    assert(!!huerfanaId, 'EX21 no dejó la planilla huérfana');
    const clave = `${hInicioKey}|${hFinKey}`;
    // Una ventana que sólo toca el primer día del período huérfano igual lo
    // trae. Si acotara por anidamiento, el endpoint se callaría justo por los
    // períodos que se salen del tramo del selector, que son los que importan.
    const { status, body } = await get(`/export/periodos?desde=${hInicioKey}&hasta=${hInicioKey}`, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(
      (body as Array<{ periodoInicio: string; periodoFin: string }>).some(p => claveDe(p) === clave),
      'una ventana que solapa el período huérfano no lo devolvió',
    );
    // Y una ventana disjunta no lo trae: la ventana filtra de verdad.
    const { status: s2, body: b2 } = await get('/export/periodos?desde=2072-01-01&hasta=2072-12-31', rrhh.token);
    assertStatus(s2, 200, JSON.stringify(b2).slice(0, 200));
    assert(
      !(b2 as Array<{ periodoInicio: string; periodoFin: string }>).some(p => claveDe(p) === clave),
      'una ventana disjunta devolvió el período huérfano',
    );
  });

  await scenario('EX23 GET /export/periodos con ventana inválida → 400 (no 500)', 'Export', async () => {
    const { status: s1, body: b1 } = await get('/export/periodos?desde=no-es-fecha', rrhh.token);
    assertStatus(s1, 400, JSON.stringify(b1).slice(0, 200));
    const { status: s2, body: b2 } = await get('/export/periodos?desde=2073-05-01&hasta=2073-04-01', rrhh.token);
    assertStatus(s2, 400, JSON.stringify(b2).slice(0, 200));
    // Parámetro presente pero vacío = sin filtro, igual que el resto de los
    // filtros de período del sistema. No 400.
    const { status: s3, body: b3 } = await get('/export/periodos?desde=&hasta=', rrhh.token);
    assertStatus(s3, 200, `desde/hasta vacíos deberían ignorarse: ${JSON.stringify(b3).slice(0, 200)}`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // EXPORTACIONES (list / log / cierre that mutates + notifies)
  // ════════════════════════════════════════════════════════════════════════
  await scenario('EXP1 GET /exportaciones (RRHH) → 200 array', 'Exportaciones', async () => {
    const { status, body } = await get('/exportaciones', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('EXP2 GET /exportaciones (OPERADOR) → 403', 'Exportaciones', async () => {
    const { status } = await get('/exportaciones', operador.token);
    assertStatus(status, 403);
  });
  await scenario('EXP3 POST /exportaciones (log entry, RRHH) → 201', 'Exportaciones', async () => {
    const { status, body } = await post('/exportaciones', {
      periodoInicio: pInicioIso, periodoFin: pFinIso,
      sectoresIds: [], usuariosIds: [opId],
      nombreArchivo: `qa-${KEY}-${TS}.xlsx`, totalPersonas: 1, totalRegistros: 3,
    }, rrhh.token);
    assertStatus(status, 201, JSON.stringify(body));
    assert(typeof (body as any).id === 'string', 'no id');
  });
  await scenario('EXP4 POST /exportaciones empty body (RRHH) — validation', 'Exportaciones', async () => {
    const { status, body } = await post('/exportaciones', {}, rrhh.token);
    // Expected: 400 (missing required periodoInicio/Fin). If 500 → no input validation (bug).
    if (status === 500) {
      bugs.push(`EXP4: POST /exportaciones with empty body returns 500 (no Zod validation; new Date(undefined) → Invalid Date → Prisma throw). Expected 400. Body: ${JSON.stringify(body).slice(0, 120)}`);
    } else {
      assertStatus(status, 400, `Got ${status}: ${JSON.stringify(body).slice(0, 150)}`);
    }
  });
  await scenario('EXP5 POST /exportaciones/cierre missing fields (RRHH) → 400', 'Exportaciones', async () => {
    const { status } = await post('/exportaciones/cierre', {}, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('EXP6 POST /exportaciones/cierre (OPERADOR) → 403', 'Exportaciones', async () => {
    const { status } = await post('/exportaciones/cierre', { periodoInicio: pInicioIso, periodoFin: pFinIso }, operador.token);
    assertStatus(status, 403);
  });

  // ── Notification: capture operator's count BEFORE cierre ──
  let countBeforeCierre = 0;
  await scenario('EXP7 capture operator notif count pre-cierre', 'Exportaciones', async () => {
    const { status, body } = await get('/notificaciones/count', opSession!.token);
    assertStatus(status, 200, JSON.stringify(body));
    countBeforeCierre = (body as any).count;
  });
  // El payload va en medianoche ARGENTINA (03:00Z) a propósito, que es lo que
  // manda el front, mientras que la planilla se guardó como fecha-día (00:00Z).
  // Con la igualdad exacta de instantes que tenía el handler esto devolvía cero
  // filas y contestaba 400 "No hay planillas aprobadas para cerrar en este
  // período"; el cierre quedaba muerto para cualquier cliente real.
  await scenario('EXP8 POST /exportaciones/cierre con payload 03:00Z (RRHH) → APROBADA→CERRADA', 'Exportaciones', async () => {
    const { status, body } = await post('/exportaciones/cierre', { periodoInicio: pInicioArIso, periodoFin: pFinArIso }, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    const b = body as any;
    assert(b.ok === true, 'no ok');
    assert(typeof b.planillasCerradas === 'number' && b.planillasCerradas >= 1, `planillasCerradas=${b.planillasCerradas}`);
  });
  await scenario('EXP9 verify my planilla now CERRADA', 'Exportaciones', async () => {
    const { status, body } = await get(`/planillas/${planillaId}`, rrhh.token);
    assertStatus(status, 200);
    assert((body as any).estado === 'CERRADA', `estado=${(body as any).estado}`);
  });
  await scenario('EXP10 NOTIF: operator received planilla:cerrada (count up + top match)', 'Notif', async () => {
    const { body: cb } = await get('/notificaciones/count', opSession!.token);
    const after = (cb as any).count;
    assert(after >= countBeforeCierre + 1, `count did not increase: ${countBeforeCierre} -> ${after}`);
    const { body: nb } = await get('/notificaciones', opSession!.token);
    const list = nb as Array<any>;
    const match = list.find(n => n.tipo === 'planilla:cerrada' && n.link === `/planillas/${planillaId}`);
    assert(!!match, `no planilla:cerrada notif found. top=${JSON.stringify(list[0]).slice(0, 150)}`);
  });
  await scenario('EXP11 POST /exportaciones/cierre again same period → 400 (no APROBADA)', 'Exportaciones', async () => {
    const { status, body } = await post('/exportaciones/cierre', { periodoInicio: pInicioIso, periodoFin: pFinIso }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body).slice(0, 150));
  });

  // ════════════════════════════════════════════════════════════════════════
  // CAMBIOS-DIAGRAMA
  // ════════════════════════════════════════════════════════════════════════
  /** Fecha futura para las solicitudes de cambio de diagrama, que exigen una. */
  function fechaFuturaISO(diasAdelante = 30): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + diasAdelante);
    return d.toISOString().slice(0, 10);
  }
  let diagId = '';
  let solA = '';
  let solB = '';
  let solC = '';
  await scenario('CD-prep admin creates a diagrama target', 'CambiosDiagrama', async () => {
    const { status, body } = await post('/admin/diagramas', {
      nombre: `QA-${KEY}-Diag-${TS}`, tipo: 'ROTATIVO', diasTrabajo: 14, diasDescanso: 7, descripcion: 'QA',
    }, admin.token);
    assertStatus(status, 201, JSON.stringify(body));
    diagId = (body as any).id;
    cleanup.push(async () => { await del(`/admin/diagramas/${diagId}`, admin.token); });
  });
  await scenario('CD1 GET /cambios-diagrama/diagramas (COORDINADOR) → 200', 'CambiosDiagrama', async () => {
    const { status, body } = await get('/cambios-diagrama/diagramas', coord.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('CD2 GET /cambios-diagrama/diagramas (OPERADOR) → 403', 'CambiosDiagrama', async () => {
    const { status } = await get('/cambios-diagrama/diagramas', operador.token);
    assertStatus(status, 403);
  });
  await scenario('CD3 GET /cambios-diagrama (RRHH) → 200 array', 'CambiosDiagrama', async () => {
    const { status, body } = await get('/cambios-diagrama', rrhh.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('CD4 GET /cambios-diagrama (OPERADOR own-only) → 200', 'CambiosDiagrama', async () => {
    const { status, body } = await get('/cambios-diagrama', operador.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('CD5 GET /cambios-diagrama/pendientes (SUPERVISOR) → 200', 'CambiosDiagrama', async () => {
    const { status, body } = await get('/cambios-diagrama/pendientes', supervisor.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 150));
    assert(Array.isArray(body), 'not array');
  });
  await scenario('CD6 GET /cambios-diagrama/pendientes (OPERADOR) → 403', 'CambiosDiagrama', async () => {
    const { status } = await get('/cambios-diagrama/pendientes', operador.token);
    assertStatus(status, 403);
  });
  await scenario('CD7 POST /cambios-diagrama (OPERADOR) → 403', 'CambiosDiagrama', async () => {
    const { status } = await post('/cambios-diagrama', { usuarioId: opId, diagramaNuevoId: diagId, fechaEfectiva: fechaFuturaISO() }, operador.token);
    assertStatus(status, 403);
  });
  await scenario('CD8 POST /cambios-diagrama invalid body (COORDINADOR) → 400', 'CambiosDiagrama', async () => {
    const { status } = await post('/cambios-diagrama', { usuarioId: 'not-a-uuid' }, coord.token);
    assertStatus(status, 400);
  });
  await scenario('CD9 POST /cambios-diagrama (COORDINADOR) → 201 (solA)', 'CambiosDiagrama', async () => {
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: opId, diagramaNuevoId: diagId, motivo: 'QA test A', fechaEfectiva: fechaFuturaISO(),
    }, coord.token);
    assertStatus(status, 201, JSON.stringify(body));
    solA = (body as any).id;
    cleanup.push(async () => { await del(`/cambios-diagrama/${solA}`, coord.token).catch(() => {}); });
  });
  await scenario('CD10 POST /cambios-diagrama duplicate pending → 409', 'CambiosDiagrama', async () => {
    // fechaEfectiva es obligatoria desde e4acf21, pero acá lo que se prueba es el
    // 409 por duplicado: sin la fecha, el 400 de validación lo taparía antes de
    // llegar al chequeo de duplicados.
    const { status } = await post('/cambios-diagrama', { usuarioId: opId, diagramaNuevoId: diagId, fechaEfectiva: fechaFuturaISO() }, coord.token);
    assertStatus(status, 409);
  });
  await scenario('CD11 POST :id/rechazar no motivo (RRHH) → 400', 'CambiosDiagrama', async () => {
    const { status } = await post(`/cambios-diagrama/${solA}/rechazar`, {}, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CD12 POST :id/rechazar (RRHH) → 200 RECHAZADA', 'CambiosDiagrama', async () => {
    const { status, body } = await post(`/cambios-diagrama/${solA}/rechazar`, { motivo: 'QA reject' }, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as any).estado === 'RECHAZADA', `estado=${(body as any).estado}`);
  });
  await scenario('CD13 POST :id/avanzar on RECHAZADA → 400 (state machine)', 'CambiosDiagrama', async () => {
    const { status } = await post(`/cambios-diagrama/${solA}/avanzar`, {}, rrhh.token);
    assertStatus(status, 400);
  });
  await scenario('CD14 POST /cambios-diagrama (solB, after A rejected) → 201', 'CambiosDiagrama', async () => {
    const { status, body } = await post('/cambios-diagrama', { usuarioId: opId, diagramaNuevoId: diagId, motivo: 'QA test B', fechaEfectiva: fechaFuturaISO() }, coord.token);
    assertStatus(status, 201, JSON.stringify(body));
    solB = (body as any).id;
  });
  // capture op notif before approving B (cambios-diagrama notification check)
  let cdNotifBefore = 0;
  await scenario('CD15 capture op notif count pre-approve', 'CambiosDiagrama', async () => {
    const { body } = await get('/notificaciones/count', opSession!.token);
    cdNotifBefore = (body as any).count;
  });
  await scenario('CD16 POST :id/avanzar (RRHH, flujo null) → 200 APROBADA', 'CambiosDiagrama', async () => {
    const { status, body } = await post(`/cambios-diagrama/${solB}/avanzar`, { comentario: 'QA approve B' }, rrhh.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as any).estado === 'APROBADA', `estado=${(body as any).estado}`);
  });
  await scenario('CD17 NOTIF: target user notified of diagram change?', 'Notif', async () => {
    const { body } = await get('/notificaciones/count', opSession!.token);
    const after = (body as any).count;
    if (after === cdNotifBefore) {
      bugs.push(`CD17: cambios-diagrama approval (avanzar→APROBADA) created NO notification for the affected employee (count stayed ${after}). The diagram was silently changed. Inconsistent with planilla/vacacion flows which always notify. (cambios-diagrama.routes.ts has no notificacion.create anywhere.)`);
    } else {
      // notification exists — good, not a bug
      assert(after >= cdNotifBefore, 'count decreased unexpectedly');
    }
  });
  await scenario('CD18 POST :id/avanzar (OPERADOR) → 403', 'CambiosDiagrama', async () => {
    const { status } = await post(`/cambios-diagrama/${solB}/avanzar`, {}, operador.token);
    assertStatus(status, 403);
  });
  await scenario('CD19 POST /cambios-diagrama (solC) → 201', 'CambiosDiagrama', async () => {
    const { status, body } = await post('/cambios-diagrama', { usuarioId: opId, diagramaNuevoId: diagId, motivo: 'QA test C', fechaEfectiva: fechaFuturaISO() }, coord.token);
    assertStatus(status, 201, JSON.stringify(body));
    solC = (body as any).id;
  });
  await scenario('CD20 DELETE pending (solicitante COORDINADOR) → 204', 'CambiosDiagrama', async () => {
    const { status } = await del(`/cambios-diagrama/${solC}`, coord.token);
    assertStatus(status, 204);
  });
  await scenario('CD21 DELETE <bad uuid> → 404', 'CambiosDiagrama', async () => {
    const { status } = await del('/cambios-diagrama/00000000-0000-0000-0000-000000000000', coord.token);
    assertStatus(status, 404);
  });
  await scenario('CD22 POST <bad>/avanzar → 404', 'CambiosDiagrama', async () => {
    const { status } = await post('/cambios-diagrama/00000000-0000-0000-0000-000000000000/avanzar', {}, rrhh.token);
    assertStatus(status, 404);
  });

  // ════════════════════════════════════════════════════════════════════════
  // BACKUP (read-only status + authz; no trigger/restore — destructive)
  // ════════════════════════════════════════════════════════════════════════
  await scenario('BK1 GET /backup/status (ADMIN) → 200', 'Backup', async () => {
    const { status, body } = await get('/backup/status', admin.token);
    assertStatus(status, 200, JSON.stringify(body).slice(0, 200));
    assert(typeof (body as any).totalBackups === 'number', `bad shape: ${JSON.stringify(body).slice(0, 150)}`);
  });
  await scenario('BK2 GET /backup/status (RRHH 90<100) → 403', 'Backup', async () => {
    const { status } = await get('/backup/status', rrhh.token);
    assertStatus(status, 403);
  });
  await scenario('BK3 GET /backup/status (OPERADOR) → 403', 'Backup', async () => {
    const { status } = await get('/backup/status', operador.token);
    assertStatus(status, 403);
  });

  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════
  console.log(col('CY', '\n-- cleanup --'));
  let cf = 0;
  for (const fn of [...cleanup].reverse()) { try { await fn(); } catch { cf++; } }
  console.log(col('DIM', `  cleanup done (${cf} non-critical failures)`));

  // ── summary ──
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  console.log(`\n${col('CY', '=== RESULTS ===')}  ${passed}/${total} passed${failed ? col('RED', ` (${failed} FAILED)`) : col('G', ' (ALL PASS)')}`);
  if (failed) {
    console.log(col('RED', '\nFAILURES:'));
    for (const r of results.filter(r => !r.passed)) console.log(`  - [${r.scenario}] ${r.name}: ${r.detail}`);
  }
  if (bugs.length) {
    console.log(col('Y', '\nSUSPECTED BUGS / FINDINGS:'));
    for (const b of bugs) console.log(`  * ${b}`);
  }
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(col('RED', `FATAL: ${e?.stack ?? e}`)); process.exit(1); });
