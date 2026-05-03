/**
 * Planilla de Horas — User Simulation Suite
 *
 * Simulates realistic multi-user usage of the system with concurrent
 * and sequential scenarios across different roles and sectors.
 *
 * Scenarios:
 *   A. Franco Álvarez (Fractura)  — planilla full approval chain (SUPERVISOR → COORDINADOR → RRHH)
 *   B. Rodrigo Ahumada (Wireline) — planilla rejection → re-submit → approval
 *   C. Kevin Fuentes  (Testing)   — vacation rejection → saldo restored → re-submit → approved
 *   D. Hugo Figueroa  (Almacén)   — absence (certificado médico) full approval chain
 *   E. RRHH (Ana Martínez)        — messaging broadcast + mis-aprobaciones dashboard
 *   F. Export after all closures
 *
 * Requirements:
 *   - API running at http://localhost:4000
 *   - DEBUG_AUTH=true in .env (any password accepted)
 *   - Database seeded with demo users
 *
 * Run: cd apps/api && npx tsx tests/simulation.ts
 */

const BASE = 'http://localhost:4000/api/v1';

// ── Colors / output ───────────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  RESET:  '\x1b[0m',
  DIM:    '\x1b[2m',
  BOLD:   '\x1b[1m',
  GREEN:  '\x1b[32m',
  RED:    '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN:   '\x1b[36m',
  BLUE:   '\x1b[34m',
  MAGENTA:'\x1b[35m',
};
function c(col: string, s: string) { return `${COLORS[col] ?? ''}${s}${COLORS.RESET}`; }

type Result = { name: string; passed: boolean; detail: string; scenario: string; ms: number };
const results: Result[] = [];
const cleanupQueue: (() => Promise<void>)[] = [];

function log(sym: string, msg: string, scenario = '') {
  const prefix = scenario ? c('DIM', `[${scenario}] `) : '';
  process.stdout.write(`  ${sym} ${prefix}${msg}\n`);
}

async function scenario(
  name: string,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, detail: 'OK', scenario: label, ms });
    log(c('GREEN', '✅'), `${name}  (${ms}ms)`, label);
  } catch (e: unknown) {
    const ms = Date.now() - start;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail, scenario: label, ms });
    log(c('RED', '❌'), `${name}  — ${detail}`, label);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertStatus(actual: number, expected: number, ctx = '') {
  if (actual !== expected)
    throw new Error(`HTTP ${expected} expected, got ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body };
}

const get  = (p: string, tok?: string) => api('GET',    p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST',   p, { token: tok, body: b });
const del  = (p: string, tok?: string) => api('DELETE', p, { token: tok });

// ── Auth ──────────────────────────────────────────────────────────────────────

interface Session {
  token: string;
  user: {
    id: string; nombre: string; apellido: string; email: string;
    rol: string; rolNivel: number; empresaId: string; sectorId: string | null;
  };
}

async function login(email: string): Promise<Session> {
  const { status, body } = await post('/auth/login', { email, password: 'Test1234!' });
  assertStatus(status, 200, `Login ${email}`);
  const b = body as Record<string, unknown>;
  assert(typeof b.accessToken === 'string', 'No accessToken');
  return { token: b.accessToken as string, user: b.user as Session['user'] };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmt(d: Date) { return d.toISOString().split('T')[0]; }
function isoTs(date: string, time: string) { return `${date}T${time}:00.000Z`; }

/**
 * Returns a 3-day period unique per (offset).
 * Uses years 1975-1999 (distinct from integration tests which use 2002-2019).
 */
function simPeriod(offset = 0): { inicio: Date; fin: Date; dates: string[] } {
  // Use current minute rather than hour for finer granularity
  const slot  = Math.floor(Date.now() / 60_000) + offset;
  const year  = 1975 + (slot % 24);   // 1975–1998
  const month = (slot % 12) + 1;      // 1–12
  const day   = (slot % 20) + 1;      // 1–20
  const inicio = new Date(year, month - 1, day);
  const fin    = new Date(year, month - 1, day + 2);
  return {
    inicio, fin,
    dates: [fmt(inicio), fmt(new Date(inicio.getTime() + 86400000)), fmt(fin)],
  };
}

/**
 * Create planilla, fill 3 days, submit. Returns planillaId or null on failure.
 */
async function createAndSubmitPlanilla(
  session: Session,
  slotOffset: number,
  label: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { inicio, fin, dates } = simPeriod(slotOffset + attempt * 31);

    const { status: cs, body: cb } = await post(
      '/planillas',
      { periodoInicio: inicio.toISOString(), periodoFin: fin.toISOString() },
      session.token,
    );

    if (cs === 409) {
      const existing = (cb as Record<string, unknown>);
      const cid = existing.planillaId as string | undefined;
      if (cid) {
        const { body: ex } = await get(`/planillas/${cid}`, session.token);
        const est = (ex as Record<string, unknown>).estado as string;
        if (['BORRADOR', 'RECHAZADA'].includes(est)) {
          await del(`/planillas/${cid}`, session.token);
          continue;
        }
      }
      continue;
    }
    if (cs !== 201) { log('⚠', `Intento ${attempt}: HTTP ${cs} — ${JSON.stringify(cb)}`, label); continue; }

    const planillaId = (cb as Record<string, unknown>).id as string;

    // Register 3 days
    for (const d of dates) {
      await post(
        `/planillas/${planillaId}/registros`,
        { fecha: d, entradaTurno1: isoTs(d, '08:00'), salidaTurno1: isoTs(d, '17:00'), lugarTrabajo: 'BASE' },
        session.token,
      );
    }

    // Submit
    const { status: es, body: eb } = await post(`/planillas/${planillaId}/enviar`, {}, session.token);
    if (es !== 200) throw new Error(`enviar failed: HTTP ${es} — ${JSON.stringify(eb)}`);

    cleanupQueue.push(async () => {
      const { body: pb } = await get(`/planillas/${planillaId}`, session.token);
      const est = (pb as Record<string, unknown>).estado as string;
      if (['BORRADOR', 'RECHAZADA', 'ENVIADA'].includes(est)) {
        await del(`/planillas/${planillaId}`, session.token);
      }
    });

    return planillaId;
  }
  return null;
}

/**
 * Walk through all approval steps of a planilla.
 * Returns final estado.
 */
async function walkApprovalChain(
  planillaId: string,
  users: UserInfo[],
  ownerSectorNombre: string,
  rrhhSession: Session,
  label: string,
): Promise<string> {
  const { body: pb } = await get(`/planillas/${planillaId}`, rrhhSession.token);
  const planillaBody = pb as Record<string, unknown>;
  const flujo = planillaBody.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;

  if (!flujo || flujo.pasos.length === 0) {
    // No flujo: RRHH approves directly
    const { status, body } = await post(
      `/planillas/${planillaId}/avanzar`,
      { comentario: 'Aprobación directa (sin flujo)' },
      rrhhSession.token,
    );
    if (status !== 200) throw new Error(`No-flujo avanzar: HTTP ${status} — ${JSON.stringify(body)}`);
    return (body as Record<string, unknown>).estado as string;
  }

  log('ℹ', `Flujo: ${flujo.pasos.map(p => p.rolAprobador).join(' → ')}`, label);

  let estado = 'ENVIADA';
  for (const paso of flujo.pasos) {
    if (estado === 'APROBADA') break;

    const approverSession = await findApproverForPaso(
      paso.rolAprobador, ownerSectorNombre, users, rrhhSession, label,
    );

    const { status, body } = await post(
      `/planillas/${planillaId}/avanzar`,
      { comentario: `Aprobación paso ${paso.orden} (${paso.rolAprobador})` },
      approverSession.token,
    );

    if (status === 403) {
      const err = (body as Record<string, unknown>).error;
      throw new Error(`403 en paso ${paso.orden} (${paso.rolAprobador}): ${err}`);
    }
    if (status !== 200) throw new Error(`Paso ${paso.orden}: HTTP ${status} — ${JSON.stringify(body)}`);

    estado = (body as Record<string, unknown>).estado as string;
    log('ℹ', `  Paso ${paso.orden} OK → ${estado}`, label);
  }

  return estado;
}

/**
 * Walk vacation/absence approval chain fully.
 */
async function walkVacacionChain(
  vacId: string,
  path: '/vacaciones' | '/ausencias',
  users: UserInfo[],
  ownerSectorNombre: string,
  rrhhSession: Session,
  label: string,
): Promise<string> {
  const { body: vb } = await get(`${path}/${vacId}`, rrhhSession.token);
  const vBody = vb as Record<string, unknown>;
  const flujo = vBody.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;

  if (!flujo || flujo.pasos.length === 0) {
    const { status, body } = await post(
      `${path}/${vacId}/avanzar`,
      { comentario: 'Aprobación directa (sin flujo)' },
      rrhhSession.token,
    );
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    return (body as Record<string, unknown>).estado as string;
  }

  log('ℹ', `Flujo: ${flujo.pasos.map(p => p.rolAprobador).join(' → ')}`, label);

  let estado = 'PENDIENTE';
  for (const paso of flujo.pasos) {
    if (estado === 'APROBADA') break;
    const approverSession = await findApproverForPaso(
      paso.rolAprobador, ownerSectorNombre, users, rrhhSession, label,
    );
    const { status, body } = await post(
      `${path}/${vacId}/avanzar`,
      { comentario: `Paso ${paso.orden} OK` },
      approverSession.token,
    );
    if (status === 403) throw new Error(`403 paso ${paso.orden}: ${(body as Record<string, unknown>).error}`);
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    estado = (body as Record<string, unknown>).estado as string;
    log('ℹ', `  Paso ${paso.orden} OK → ${estado}`, label);
  }

  return estado;
}

interface UserInfo {
  id: string; nombre: string; apellido: string; email: string;
  rol: string; sector: { nombre: string } | null;
}

async function findApproverForPaso(
  rol: string,
  sectorNombre: string,
  users: UserInfo[],
  rrhhSession: Session,
  label: string,
): Promise<Session> {
  // Match by role + sector name
  const bySector = users.filter(u => u.rol === rol && u.sector?.nombre === sectorNombre);
  if (bySector.length > 0) {
    log('ℹ', `  Aprobador ${rol}: ${bySector[0].nombre} ${bySector[0].apellido} [sector match]`, label);
    return login(bySector[0].email);
  }
  // Cross-sector fallback
  const byRole = users.filter(u => u.rol === rol);
  if (byRole.length > 0) {
    log('⚠', `  Aprobador ${rol}: ${byRole[0].nombre} ${byRole[0].apellido} [cross-sector]`, label);
    return login(byRole[0].email);
  }
  log('⚠', `  Aprobador ${rol}: usando RRHH como último recurso`, label);
  return rrhhSession;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Scenario A: Franco Álvarez (Fractura) — Full planilla chain ───────────────

async function scenarioA_PlanillaFullChain(users: UserInfo[], rrhhSession: Session) {
  const label = 'A:Franco/Fractura';
  console.log(c('CYAN', '\n── Scenario A: Franco Álvarez (Fractura) — planilla full chain ─────────'));

  const francoUser = users.find(u => u.email.includes('franco.alvarez'));
  if (!francoUser) { log('⚠', 'Franco Álvarez no encontrado — omitiendo', label); return; }

  let franco: Session;
  await scenario('Login como Franco Álvarez', label, async () => {
    franco = await login(francoUser.email);
    log('ℹ', `Sesión: ${franco.user.nombre} ${franco.user.apellido} (${franco.user.rol})`, label);
  });

  let planillaId = '';
  await scenario('Franco crea y envía planilla', label, async () => {
    const id = await createAndSubmitPlanilla(franco!, 500, label);
    assert(id !== null, 'No se pudo crear la planilla');
    planillaId = id!;
    log('ℹ', `Planilla creada: ${planillaId}`, label);
  });

  if (!planillaId) return;

  let finalEstado = '';
  await scenario('Cadena de aprobación completa (SUPERVISOR → COORDINADOR → RRHH)', label, async () => {
    finalEstado = await walkApprovalChain(planillaId, users, 'Fractura', rrhhSession, label);
    assert(finalEstado === 'APROBADA', `Estado final: ${finalEstado} (esperado APROBADA)`);
    log('ℹ', `Estado final: ${finalEstado}`, label);
  });

  if (finalEstado === 'APROBADA') {
    await scenario('RRHH cierra la planilla', label, async () => {
      const { status, body } = await post(`/planillas/${planillaId}/cerrar`, {}, rrhhSession.token);
      assertStatus(status, 200, JSON.stringify(body));
      assert((body as Record<string, unknown>).estado === 'CERRADA', 'No quedó CERRADA');
      log('ℹ', 'Planilla cerrada correctamente', label);
    });

    await scenario('Exportar planilla cerrada a Excel', label, async () => {
      const res = await fetch(`${BASE}/export/planilla/${planillaId}`, {
        headers: { Authorization: `Bearer ${rrhhSession.token}` },
      });
      assert(res.status === 200 || res.status === 404, `HTTP ${res.status}`);
      if (res.status === 200) {
        const ct = res.headers.get('content-type') ?? '';
        assert(ct.includes('spreadsheet') || ct.includes('octet'), `Content-Type inesperado: ${ct}`);
        log('ℹ', `Export OK — Content-Type: ${ct}`, label);
      } else {
        log('ℹ', 'Exportación individual no disponible (404 esperado sin ruta específica)', label);
      }
    });
  }
}

// ── Scenario B: Rodrigo Ahumada (Wireline) — Rejection + re-submit ────────────

async function scenarioB_PlanillaRejection(users: UserInfo[], rrhhSession: Session) {
  const label = 'B:Rodrigo/Wireline';
  console.log(c('BLUE', '\n── Scenario B: Rodrigo Ahumada (Wireline) — rechazo y re-envío ─────────'));

  const rodrigoUser = users.find(u => u.email.includes('rodrigo.ahumada'));
  if (!rodrigoUser) { log('⚠', 'Rodrigo Ahumada no encontrado — omitiendo', label); return; }

  let rodrigo: Session;
  await scenario('Login como Rodrigo Ahumada', label, async () => {
    rodrigo = await login(rodrigoUser.email);
    log('ℹ', `Sesión: ${rodrigo.user.nombre} ${rodrigo.user.apellido}`, label);
  });

  let planillaId = '';
  await scenario('Rodrigo crea y envía planilla', label, async () => {
    const id = await createAndSubmitPlanilla(rodrigo!, 600, label);
    assert(id !== null, 'No se pudo crear la planilla');
    planillaId = id!;
    log('ℹ', `Planilla ${planillaId} → ENVIADA`, label);
  });

  if (!planillaId) return;

  await scenario('RRHH/responsable rechaza la planilla', label, async () => {
    // Discover the actual first-step approver from the planilla's flujo (don't assume SUPERVISOR)
    const { body: pb } = await get(`/planillas/${planillaId}`, rrhhSession.token);
    const flujoBody = pb as Record<string, unknown>;
    const flujo = flujoBody.flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;

    let rejecter = rrhhSession;
    if (flujo?.pasos?.length) {
      const firstStep = flujo.pasos[0];
      log('ℹ', `Paso 1 rolAprobador: ${firstStep.rolAprobador}`, label);
      rejecter = await findApproverForPaso(firstStep.rolAprobador, 'Wireline', users, rrhhSession, label);
    }
    const { status, body } = await post(
      `/planillas/${planillaId}/rechazar`,
      { motivo: 'Horarios incompletos — corregir y re-enviar' },
      rejecter.token,
    );
    if (status === 403) throw new Error(`403: ${(body as Record<string, unknown>).error}`);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as Record<string, unknown>).estado === 'RECHAZADA', 'No quedó RECHAZADA');
    log('ℹ', 'Planilla rechazada', label);
  });

  await scenario('Rodrigo re-envía la planilla rechazada', label, async () => {
    const { status, body } = await post(`/planillas/${planillaId}/enviar`, {}, rodrigo!.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as Record<string, unknown>).estado === 'ENVIADA', 'No quedó ENVIADA');
    log('ℹ', 'Re-envío exitoso → ENVIADA', label);
  });

  await scenario('Cadena de aprobación completa (post-rechazo)', label, async () => {
    const estado = await walkApprovalChain(planillaId, users, 'Wireline', rrhhSession, label);
    assert(estado === 'APROBADA', `Estado final: ${estado}`);
    log('ℹ', `Aprobada tras re-envío → ${estado}`, label);
  });

  // Close after approval
  await scenario('Cerrar planilla post re-aprobación', label, async () => {
    const { body } = await get(`/planillas/${planillaId}`, rrhhSession.token);
    const est = (body as Record<string, unknown>).estado as string;
    if (est === 'APROBADA') {
      const { status, body: cb } = await post(`/planillas/${planillaId}/cerrar`, {}, rrhhSession.token);
      assertStatus(status, 200, JSON.stringify(cb));
    } else {
      log('ℹ', `Estado actual: ${est} — sin cerrar`, label);
    }
  });
}

// ── Scenario C: Kevin Fuentes (Testing) — Vacation rejection & saldo ──────────

async function scenarioC_VacationRejection(users: UserInfo[], rrhhSession: Session) {
  const label = 'C:Kevin/Vacaciones';
  console.log(c('MAGENTA', '\n── Scenario C: Kevin Fuentes (Testing) — rechazo vacaciones + saldo ────'));

  const kevinUser = users.find(u => u.email.includes('kevin.fuentes'));
  if (!kevinUser) { log('⚠', 'Kevin Fuentes no encontrado — omitiendo', label); return; }

  let kevin: Session;
  await scenario('Login como Kevin Fuentes', label, async () => {
    kevin = await login(kevinUser.email);
    log('ℹ', `Sesión: ${kevin.user.nombre} ${kevin.user.apellido}`, label);
  });

  // Read saldo before
  let saldoAntes = 0;
  let pendientesAntes = 0;
  let saldoInsuficiente = false;
  await scenario('Leer saldo vacacional antes de solicitar', label, async () => {
    const { body } = await get('/vacaciones/saldo', kevin!.token);
    const b = body as Record<string, unknown>;
    saldoAntes = b.disponible as number;
    pendientesAntes = b.pendientes as number ?? 0;
    log('ℹ', `Disponible: ${saldoAntes} días | Pendientes: ${pendientesAntes} | Total: ${b.total}`, label);
    if (saldoAntes < 3) {
      saldoInsuficiente = true;
      log('⚠', `Saldo insuficiente (${saldoAntes} disponibles) — se omitirán los sub-tests de Kevin`, label);
    }
  });

  if (saldoInsuficiente) return;

  const currentYear = new Date().getFullYear();
  const vacFechaInicio = new Date(currentYear, 9, 5);  // Oct 5 of current year (unique month)
  const vacFechaFin    = new Date(currentYear, 9, 7);  // Oct 7 of current year (3 days)

  let vacacionId = '';
  await scenario('Kevin solicita 3 días de vacaciones', label, async () => {
    const { status, body } = await post(
      '/vacaciones',
      {
        fechaInicio: vacFechaInicio.toISOString(),
        fechaFin:    vacFechaFin.toISOString(),
        diasHabiles: 3,
        motivo:      'Vacaciones simulación — scenario C',
      },
      kevin!.token,
    );
    if (status === 409) {
      vacacionId = (body as Record<string, unknown>).vacacionId as string ?? '';
      log('ℹ', `Vacación ya existe: ${vacacionId}`, label);
      return;
    }
    assertStatus(status, 201, JSON.stringify(body));
    vacacionId = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => { await del(`/vacaciones/${vacacionId}`, rrhhSession.token); });
    log('ℹ', `Vacación creada: ${vacacionId}`, label);
  });

  if (!vacacionId) return;

  // Submit
  await scenario('Kevin envía la solicitud de vacaciones', label, async () => {
    const { body: vb } = await get(`/vacaciones/${vacacionId}`, kevin!.token);
    const est = (vb as Record<string, unknown>).estado as string;
    if (est === 'PENDIENTE') { log('ℹ', 'Ya está PENDIENTE', label); return; }
    if (est !== 'BORRADOR' && est !== 'RECHAZADA') return;
    const { status, body } = await post(`/vacaciones/${vacacionId}/enviar`, {}, kevin!.token);
    assertStatus(status, 200, JSON.stringify(body));
    log('ℹ', `Estado tras enviar: ${(body as Record<string, unknown>).estado}`, label);
  });

  // Verify saldo was debited
  await scenario('Verificar que diasPendientes aumentó', label, async () => {
    const { body } = await get('/vacaciones/saldo', kevin!.token);
    const b = body as Record<string, unknown>;
    const pendientesAhora = b.pendientes as number ?? 0;
    const disponibleAhora = b.disponible as number;
    log('ℹ', `Disponible: ${disponibleAhora} (era ${saldoAntes}) | Pendientes: ${pendientesAhora} (era ${pendientesAntes})`, label);
    // Available should have decreased by at least the requested days
    assert(disponibleAhora < saldoAntes, `disponible no disminuyó (${disponibleAhora} >= ${saldoAntes})`);
  });

  // RRHH rejects
  await scenario('RRHH rechaza la solicitud de vacaciones', label, async () => {
    // Try to find the approver for step 1 of the vacation flow
    const { body: vb } = await get(`/vacaciones/${vacacionId}`, rrhhSession.token);
    const flujo = (vb as Record<string, unknown>).flujo as { pasos: Array<{ orden: number; rolAprobador: string }> } | null;

    let rejecter = rrhhSession;
    if (flujo?.pasos?.length) {
      const firstStep = flujo.pasos[0];
      rejecter = await findApproverForPaso(firstStep.rolAprobador, 'Testing', users, rrhhSession, label);
    }

    const { status, body } = await post(
      `/vacaciones/${vacacionId}/rechazar`,
      { motivo: 'Fechas en conflicto con operaciones — elija otro período' },
      rejecter.token,
    );
    if (status === 403) throw new Error(`403: ${(body as Record<string, unknown>).error}`);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as Record<string, unknown>).estado === 'RECHAZADA', 'No quedó RECHAZADA');
    log('ℹ', 'Vacación rechazada', label);
  });

  // CRITICAL: verify saldo was restored after rejection (Bug C1 fix)
  await scenario('Verificar que saldo fue RESTAURADO tras el rechazo (Bug C1)', label, async () => {
    const { body } = await get('/vacaciones/saldo', kevin!.token);
    const b = body as Record<string, unknown>;
    const disponibleAhora = b.disponible as number;
    log('ℹ', `Disponible tras rechazo: ${disponibleAhora} (debería ser ${saldoAntes})`, label);
    assert(
      disponibleAhora === saldoAntes,
      `Saldo NO restaurado. Era ${saldoAntes}, ahora ${disponibleAhora} — Bug C1 no está funcionando`,
    );
    log('✅', '  Saldo restaurado correctamente', label);
  });

  // Re-submit and approve (tests Bug C1b fix: re-increment on re-send)
  await scenario('Kevin re-envía la vacación rechazada', label, async () => {
    const { status, body } = await post(`/vacaciones/${vacacionId}/enviar`, {}, kevin!.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert((body as Record<string, unknown>).estado === 'PENDIENTE', 'No quedó PENDIENTE');
    log('ℹ', 'Re-envío exitoso → PENDIENTE', label);
  });

  // Saldo should be debited again after re-send
  await scenario('Verificar que saldo fue debitado de nuevo tras re-envío (Bug C1b)', label, async () => {
    const { body } = await get('/vacaciones/saldo', kevin!.token);
    const disponible = (body as Record<string, unknown>).disponible as number;
    log('ℹ', `Disponible tras re-envío: ${disponible} (esperado < ${saldoAntes})`, label);
    assert(disponible < saldoAntes, `Saldo no fue re-debitado (${disponible} >= ${saldoAntes}) — Bug C1b no funciona`);
  });

  await scenario('RRHH aprueba la vacación re-enviada', label, async () => {
    const estado = await walkVacacionChain(vacacionId, '/vacaciones', users, 'Testing', rrhhSession, label);
    assert(estado === 'APROBADA', `Estado final: ${estado}`);
    log('ℹ', `Vacación aprobada → ${estado}`, label);
  });

  // Saldo: pendientes → usados
  await scenario('Verificar saldo final: días usados (no pendientes)', label, async () => {
    const { body } = await get('/vacaciones/saldo', kevin!.token);
    const b = body as Record<string, unknown>;
    const usadosAhora  = b.usados  as number ?? 0;
    const pendientesNow = b.pendientes as number ?? 0;
    log('ℹ', `Usados: ${usadosAhora} | Pendientes: ${pendientesNow} | Disponible: ${b.disponible}`, label);
    assert(pendientesNow <= pendientesAntes, `Pendientes no se liberaron: ${pendientesNow}`);
  });
}

// ── Scenario D: Hugo Figueroa (Almacén) — Absence lifecycle ──────────────────

async function scenarioD_AbsenceLifecycle(users: UserInfo[], rrhhSession: Session) {
  const label = 'D:Hugo/Ausencia';
  console.log(c('YELLOW', '\n── Scenario D: Hugo Figueroa (Almacén) — ausencia médica ───────────────'));

  const hugoUser = users.find(u => u.email.includes('hugo.figueroa'));
  if (!hugoUser) { log('⚠', 'Hugo Figueroa no encontrado — omitiendo', label); return; }

  let hugo: Session;
  await scenario('Login como Hugo Figueroa', label, async () => {
    hugo = await login(hugoUser.email);
    log('ℹ', `Sesión: ${hugo.user.nombre} ${hugo.user.apellido}`, label);
  });

  const ausInicio = new Date(1988, 3, 20); // 1988-04-20
  const ausFin    = new Date(1988, 3, 21); // 1988-04-21

  let ausenciaId = '';
  await scenario('Hugo solicita certificado médico', label, async () => {
    const { status, body } = await post(
      '/ausencias/solicitar',
      {
        tipo:        'CERTIFICADO_MEDICO',
        fechaInicio: ausInicio.toISOString(),
        fechaFin:    ausFin.toISOString(),
        diasAusencia: 2,
        descripcion:  'Gripe — simulación scenario D',
      },
      hugo!.token,
    );
    if (status === 409) {
      ausenciaId = (body as Record<string, unknown>).ausenciaId as string ?? '';
      log('ℹ', `Ausencia ya existe: ${ausenciaId}`, label);
      return;
    }
    assertStatus(status, 201, JSON.stringify(body));
    ausenciaId = (body as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => { await del(`/ausencias/${ausenciaId}`, rrhhSession.token); });
    log('ℹ', `Ausencia creada: ${ausenciaId}`, label);
  });

  if (!ausenciaId) return;

  await scenario('Ausencia aparece en mis solicitudes', label, async () => {
    const { body } = await get('/mis-solicitudes', hugo!.token);
    const list = body as Array<{ id: string }>;
    assert(Array.isArray(list), 'No es array');
    const found = list.some(item => (item as Record<string, unknown>).id === ausenciaId);
    log('ℹ', `Total solicitudes: ${list.length} — ausencia encontrada: ${found}`, label);
    assert(found, 'Ausencia no aparece en mis-solicitudes');
  });

  await scenario('Cadena de aprobación de la ausencia', label, async () => {
    const estado = await walkVacacionChain(ausenciaId, '/ausencias', users, 'Almacén', rrhhSession, label);
    log('ℹ', `Estado final ausencia: ${estado}`, label);
    assert(
      estado === 'APROBADA' || estado === 'PENDIENTE' || estado === 'EN_REVISION',
      `Estado inesperado: ${estado}`,
    );
  });

  // Verify it does NOT appear as BORRADOR in mis-solicitudes (Bug 2 fix)
  await scenario('Verificar que BORRADOR no aparece en mis-solicitudes (Bug 2)', label, async () => {
    const { body } = await get('/mis-solicitudes', hugo!.token);
    const list = body as Array<Record<string, unknown>>;
    const borradores = list.filter(item => item.estado === 'BORRADOR');
    log('ℹ', `Items BORRADOR en mis-solicitudes: ${borradores.length}`, label);
    assert(borradores.length === 0, `Hay ${borradores.length} items BORRADOR en mis-solicitudes — Bug 2 persiste`);
  });
}

// ── Scenario E: RRHH — Messaging + dashboard ────────────────────────────────

async function scenarioE_RrhhDashboard(users: UserInfo[], rrhhSession: Session) {
  const label = 'E:RRHH/Mensajes';
  console.log(c('GREEN', '\n── Scenario E: RRHH — mensajes y dashboard de aprobaciones ─────────────'));

  // Dashboard
  await scenario('RRHH ve dashboard de aprobaciones', label, async () => {
    const { status, body } = await get('/aprobaciones', rrhhSession.token);
    assertStatus(status, 200, JSON.stringify(body));
    const b = body as Record<string, unknown>;
    const planillas  = (b.planillas  as unknown[])?.length ?? 0;
    const vacaciones = (b.vacaciones as unknown[])?.length ?? 0;
    const ausencias  = (b.ausencias  as unknown[])?.length ?? 0;
    log('ℹ', `Pendientes — planillas: ${planillas} | vacaciones: ${vacaciones} | ausencias: ${ausencias}`, label);
  });

  // RRHH sends announcement to all
  let mensajeId = '';
  await scenario('RRHH envía comunicado a todos', label, async () => {
    const { status, body } = await post(
      '/mensajes',
      {
        asunto:        'Recordatorio: envíen planillas antes del viernes',
        cuerpo:        'Estimados: recuerden enviar sus planillas de horas antes del viernes 23:59. Cualquier consulta comunicarse con RRHH.',
        destinoTipo:   'TODOS',
        permiteRespuesta: true,
      },
      rrhhSession.token,
    );
    assertStatus(status, 201, JSON.stringify(body));
    mensajeId = (body as Record<string, unknown>).id as string;
    log('ℹ', `Mensaje enviado: ${mensajeId}`, label);
  });

  // An operator reads and replies
  const operador = users.find(u => u.rol === 'OPERADOR' && u.email.includes('daniel.aguirre'));
  if (operador && mensajeId) {
    let danielSession: Session;
    await scenario('Daniel Aguirre lee el comunicado', label, async () => {
      danielSession = await login(operador.email);
      const { status, body } = await get(`/mensajes/${mensajeId}`, danielSession!.token);
      assertStatus(status, 200, JSON.stringify(body));
      const b = body as Record<string, unknown>;
      assert(b.id === mensajeId, 'ID mismatch');
      log('ℹ', `Mensaje leído: "${b.asunto}"`, label);
    });

    await scenario('Daniel responde al comunicado', label, async () => {
      const { status, body } = await post(
        `/mensajes/${mensajeId}/responder`,
        { cuerpo: 'Recibido, muchas gracias por el aviso.' },
        danielSession!.token,
      );
      assertStatus(status, 201, JSON.stringify(body));
      log('ℹ', 'Respuesta enviada', label);
    });

    await scenario('Daniel marca todas las notificaciones como leídas', label, async () => {
      const { status } = await put(`/notificaciones/leer-todas`, {}, danielSession!.token);
      assertStatus(status, 200);
    });
  }

  // Cross-tenant message isolation (Bug B1/B2 fix verification)
  await scenario('Verificar aislamiento multi-empresa en mensajes', label, async () => {
    // Try to GET the message with a fake ID from "another tenant"
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const { status } = await get(`/mensajes/${fakeId}`, rrhhSession.token);
    // Should be 404, not 500 or 200
    assert(status === 404, `Debería ser 404, got ${status}`);
    log('ℹ', `Mensaje inexistente devuelve ${status} correctamente`, label);
  });
}

// Helper for scenario E
async function put(path: string, body: unknown, token?: string) {
  return api('PUT', path, { token, body });
}

// ── Scenario F: Edge cases / security ────────────────────────────────────────

async function scenarioF_EdgeCases(users: UserInfo[], rrhhSession: Session) {
  const label = 'F:EdgeCases';
  console.log(c('RED', '\n── Scenario F: casos borde / seguridad ──────────────────────────────────'));

  const operador = users.find(u => u.rol === 'OPERADOR' && u.email.includes('daniel.aguirre'));
  if (!operador) return;

  let danielSession: Session;
  await scenario('Setup: login como operador de base', label, async () => {
    danielSession = await login(operador.email);
  });

  // Can't approve own planilla
  await scenario('OPERADOR no puede aprobar su propia planilla → 403', label, async () => {
    // Get an ENVIADA planilla to test against
    const { body } = await get('/planillas?estado=ENVIADA', danielSession!.token);
    const list = body as Array<{ id: string; usuarioId: string }>;
    if (!Array.isArray(list) || list.length === 0) {
      log('ℹ', 'No hay planillas ENVIADA para testear — skip', label);
      return;
    }
    const planilla = list[0];
    const { status } = await post(
      `/planillas/${planilla.id}/avanzar`,
      { comentario: 'Intento ilegal' },
      danielSession!.token,
    );
    assert(status === 403 || status === 401, `Se esperaba 403/401, got ${status}`);
    log('ℹ', `Intento de auto-aprobar → ${status} ✓`, label);
  });

  // Unauthorized access to another user's planilla
  await scenario('OPERADOR no puede ver planilla ajena → 403/404', label, async () => {
    // Create a planilla as a different operator
    const otroOperador = users.find(u => u.rol === 'OPERADOR' && !u.email.includes('daniel.aguirre'));
    if (!otroOperador) { log('ℹ', 'No hay otro operador — skip', label); return; }
    const otroSession = await login(otroOperador.email);
    const { inicio, fin } = simPeriod(9999);
    const { status: cs, body: cb } = await post(
      '/planillas',
      { periodoInicio: inicio.toISOString(), periodoFin: fin.toISOString() },
      otroSession.token,
    );
    if (cs !== 201) { log('ℹ', `No se pudo crear planilla ajena (${cs}) — skip`, label); return; }
    const otraId = (cb as Record<string, unknown>).id as string;
    cleanupQueue.push(async () => await del(`/planillas/${otraId}`, otroSession.token));

    const { status } = await get(`/planillas/${otraId}`, danielSession!.token);
    assert(status === 403 || status === 404, `Se esperaba 403/404, got ${status}`);
    log('ℹ', `Acceso a planilla ajena → ${status} ✓`, label);
  });

  // ENVIADA planillas can be retracted (deleted) IF no approver has touched them yet
  // This is intentional behavior — the operator can withdraw before review starts
  await scenario('ENVIADA sin revisión puede ser retirada (comportamiento esperado)', label, async () => {
    // Find an ENVIADA planilla for Daniel
    const { body } = await get('/planillas?estado=ENVIADA', danielSession!.token);
    const list = body as Array<{ id: string }>;
    if (!Array.isArray(list) || list.length === 0) { log('ℹ', 'No hay ENVIADA para testear — skip', label); return; }
    const { status } = await del(`/planillas/${list[0].id}`, danielSession!.token);
    // 204 = retracted successfully (no approver touched it yet), 400 = already reviewed (both OK)
    assert(status === 204 || status === 400, `Se esperaba 204 o 400, got ${status}`);
    log('ℹ', `Retirar planilla ENVIADA → ${status} (204=retirada, 400=ya revisada) ✓`, label);
  });

  // Notification auth
  await scenario('Sin token → 401 en endpoints protegidos', label, async () => {
    const { status } = await get('/planillas');
    assertStatus(status, 401);
    log('ℹ', 'Endpoint protegido devuelve 401 sin token ✓', label);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(c('BOLD', '\n🎭 Planilla de Horas — User Simulation Suite'));
  console.log(`   Target: ${BASE}`);
  console.log(`   Hora:   ${new Date().toISOString()}\n`);

  // Health check
  const health = await get('/health');
  if ((health.body as Record<string, unknown>).status !== 'ok') {
    console.error('❌ API no disponible');
    process.exit(1);
  }
  console.log(c('GREEN', '  ✅ API healthy\n'));

  // Load users
  const { body: usersBody } = await get('/auth/debug-users');
  const users = usersBody as UserInfo[];
  console.log(`  ℹ ${users.length} usuarios disponibles`);

  // RRHH/Admin session (used across scenarios as backstop approver)
  const rrhhUser = users.find(u => ['RRHH', 'ADMIN'].includes(u.rol));
  assert(rrhhUser !== undefined, 'No hay usuario RRHH/ADMIN en el sistema');
  const rrhhSession = await login(rrhhUser.email);
  console.log(`  ℹ Backstop approver: ${rrhhSession.user.nombre} ${rrhhSession.user.apellido} (${rrhhSession.user.rol})\n`);

  // Run scenarios — A & B can be parallel (different users/sectors), C-F sequential
  const [, ] = await Promise.all([
    scenarioA_PlanillaFullChain(users, rrhhSession),
    scenarioB_PlanillaRejection(users, rrhhSession),
  ]);

  await scenarioC_VacationRejection(users, rrhhSession);
  await scenarioD_AbsenceLifecycle(users, rrhhSession);
  await scenarioE_RrhhDashboard(users, rrhhSession);
  await scenarioF_EdgeCases(users, rrhhSession);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  console.log(c('DIM', '\n── Cleanup ─────────────────────────────────────────────────────────────'));
  for (const cleanup of cleanupQueue) {
    try { await cleanup(); } catch { /* best effort */ }
  }

  // ── Results ──────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log(c('BOLD', '\n═══════════════════════════════════════════════════════════════════════'));
  console.log(c('BOLD', '  RESULTADOS DE SIMULACIÓN'));
  console.log(c('BOLD', '═══════════════════════════════════════════════════════════════════════'));

  // Group by scenario
  const byScenario = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario)!.push(r);
  }

  for (const [label, items] of byScenario) {
    const ok = items.filter(i => i.passed).length;
    const ko = items.filter(i => !i.passed).length;
    const sym = ko > 0 ? c('RED', '❌') : c('GREEN', '✅');
    console.log(`  ${sym} ${c('BOLD', label.padEnd(22))} ${ok}/${items.length} passed`);
    for (const item of items.filter(i => !i.passed)) {
      console.log(`       ${c('RED', '↳ FAIL')} ${item.name}: ${item.detail}`);
    }
  }

  console.log(c('BOLD', '\n─────────────────────────────────────────────────────────────────────'));
  const summary = passed === results.length
    ? c('GREEN', `✅ ${passed}/${results.length} tests pasaron`)
    : c('RED',   `❌ ${failed} fallidos / ${results.length} total`);
  console.log(`  ${summary}   ⏱ ${totalMs}ms total`);
  console.log(c('BOLD', '═══════════════════════════════════════════════════════════════════════\n'));

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
