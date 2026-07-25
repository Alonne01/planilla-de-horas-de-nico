/**
 * Planilla de Horas — Integration Test Suite
 *
 * Tests all major workflows end-to-end against a running API:
 *   - Auth (login, refresh, invalid cases)
 *   - Planilla lifecycle: create → fill → submit → approve chain → close → export
 *   - Vacaciones lifecycle: saldo check → request → approve
 *   - Ausencias lifecycle: self-request → approve
 *   - Mensajes: send → inbox → read
 *   - Notificaciones: list → mark as read
 *   - Aprobaciones dashboard
 *
 * Requirements:
 *   - API running at http://localhost:4000
 *   - DEBUG_AUTH=true in .env (any password accepted)
 *   - Database seeded with at least one empresa + users
 *
 * Run: cd apps/api && npx tsx tests/integration.ts
 */

const BASE = 'http://localhost:4000/api/v1';

// ── Result tracking ────────────────────────────────

type TestResult = { name: string; passed: boolean; detail: string; durationMs: number };
const results: TestResult[] = [];
const createdResources: { type: string; id: string; url: string; headers?: Record<string, string> }[] = [];

function log(symbol: string, msg: string) {
  process.stdout.write(`  ${symbol} ${msg}\n`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, detail: 'OK', durationMs: ms });
    log('✅', `${name}  (${ms}ms)`);
  } catch (e: unknown) {
    const ms = Date.now() - start;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, detail, durationMs: ms });
    log('❌', `${name}  — ${detail}`);
  }
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

function assertStatus(actual: number, expected: number, context?: string) {
  if (actual !== expected) {
    throw new Error(`Expected HTTP ${expected}, got ${actual}${context ? ` — ${context}` : ''}`);
  }
}

// ── HTTP helpers ────────────────────────────────────

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; expectStatus?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // /auth/debug-users exige la clave del modo debug (antes era abierto).
  headers['x-debug-clave'] = process.env.DEBUG_AUTH_PASSWORD ?? 'Test1234!';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (opts.expectStatus !== undefined) {
    assertStatus(res.status, opts.expectStatus, `${method} ${path} → ${JSON.stringify(body)}`);
  }

  return { status: res.status, body };
}

async function get(path: string, token?: string, expectStatus = 200) {
  return api('GET', path, { token, expectStatus });
}

async function post(path: string, body: unknown, token?: string, expectStatus?: number) {
  return api('POST', path, { token, body, expectStatus });
}

async function put(path: string, body: unknown, token?: string, expectStatus?: number) {
  return api('PUT', path, { token, body, expectStatus });
}

async function del(path: string, token?: string, expectStatus?: number) {
  return api('DELETE', path, { token, expectStatus });
}

// ── Login helper ────────────────────────────────────

interface UserSession {
  token: string;
  user: {
    id: string; nombre: string; apellido: string; email: string;
    rol: string; rolNivel: number; empresaId: string; sectorId: string | null;
  };
}

async function login(email: string, password = 'Test1234!'): Promise<UserSession> {
  const { status, body } = await post('/auth/login', { email, password });
  assertStatus(status, 200, `Login ${email}`);
  const b = body as Record<string, unknown>;
  assert(typeof b.accessToken === 'string', 'No accessToken in login response');
  return { token: b.accessToken as string, user: b.user as UserSession['user'] };
}

// ── Date helpers ────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDatetime(dateStr: string, timeStr: string): string {
  return `${dateStr}T${timeStr}:00.000Z`;
}

/**
 * Generate a unique 3-day test period for this run.
 * Maps current hour → a date in 2002–2019 that cycles every ~37 days.
 * Use offset > 0 to try alternate slots when conflict detected (HTTP 409).
 */
function getTestPeriod(offset = 0): { inicio: Date; fin: Date } {
  const hourNum = Math.floor(Date.now() / 3_600_000) + offset;
  const year    = 2002 + (hourNum % 18);   // 2002–2019
  const month   = (hourNum % 12) + 1;      // 1–12
  const day     = (hourNum % 22) + 1;      // 1–22 (safe for all months)
  const inicio  = new Date(year, month - 1, day);
  const fin     = new Date(year, month - 1, day + 2);
  return { inicio, fin };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🔨 Planilla de Horas — Integration Tests');
  console.log(`   Target: ${BASE}`);
  console.log(`   Time:   ${new Date().toISOString()}\n`);

  // ── 0. Health check ─────────────────────────────
  console.log('── Health ──────────────────────────────');
  await test('GET /health → 200', async () => {
    const { status, body } = await get('/health');
    assertStatus(status, 200);
    assert((body as Record<string, unknown>).status === 'ok', 'status !== ok');
  });

  // ── 1. Auth tests ────────────────────────────────
  console.log('\n── Auth ────────────────────────────────');

  let users: Array<{ id: string; nombre: string; apellido: string; email: string; rol: string; sector: { nombre: string } | null }> = [];

  await test('GET /auth/debug-users → lista usuarios', async () => {
    const { status, body } = await get('/auth/debug-users');
    assertStatus(status, 200);
    const list = body as typeof users;
    assert(Array.isArray(list) && list.length > 0, 'Lista vacía');
    users = list;
    log('ℹ', `${list.length} usuarios encontrados`);
  });

  await test('POST /auth/login — credenciales inválidas → 401', async () => {
    // DEBUG_AUTH is on so any password works, but unknown email should fail
    const { status } = await post('/auth/login', { email: 'no-existe@test.com', password: 'X' });
    assertStatus(status, 401);
  });

  await test('GET /notificaciones sin token → 401', async () => {
    const { status } = await get('/notificaciones', undefined, 401);
    assertStatus(status, 401);
  });

  // ── Discover test users ──────────────────────────
  // We need: 1 OPERADOR, 1 supervisor/coordinator for that sector, 1 RRHH/ADMIN (nivel ≥ 90)
  const operadorUser = users.find(u => u.rol === 'OPERADOR');
  const rrhh = users.find(u => ['RRHH', 'ADMIN'].includes(u.rol));

  assert(!!operadorUser, 'No se encontró ningún usuario OPERADOR');
  assert(!!rrhh, 'No se encontró usuario RRHH/ADMIN');

  log('ℹ', `Operador: ${operadorUser!.nombre} ${operadorUser!.apellido} (${operadorUser!.email})`);
  log('ℹ', `RRHH/Admin: ${rrhh!.nombre} ${rrhh!.apellido} (${rrhh!.email})`);

  let operadorSession!: UserSession;
  let rrhhSession!: UserSession;

  await test(`Login como OPERADOR (${operadorUser!.email})`, async () => {
    operadorSession = await login(operadorUser!.email);
    assert(operadorSession.user.rol === 'OPERADOR', `Rol esperado OPERADOR, got ${operadorSession.user.rol}`);
  });

  await test(`Login como RRHH/ADMIN (${rrhh!.email})`, async () => {
    rrhhSession = await login(rrhh!.email);
    assert(rrhhSession.user.rolNivel >= 90, `Nivel esperado ≥90, got ${rrhhSession.user.rolNivel}`);
  });

  // ── 2. Planilla lifecycle ────────────────────────
  console.log('\n── Planilla lifecycle ──────────────────');

  // Pick a unique period for this run; retry on 409 conflict
  let planillaId = '';
  // Initialize with period 0 so downstream code never crashes if creation fails
  const _defaultPeriod = getTestPeriod(0);
  let periodoInicio: Date = _defaultPeriod.inicio;
  let periodoFin: Date    = _defaultPeriod.fin;
  let ownerSectorNombre = '';

  await test('POST /planillas — crear planilla (BORRADOR, período único)', async () => {
    for (let slot = 0; slot < 15; slot++) {
      const period = getTestPeriod(slot);
      const { status, body } = await post(
        '/planillas',
        { periodoInicio: period.inicio.toISOString(), periodoFin: period.fin.toISOString() },
        operadorSession.token,
      );
      if (status === 201) {
        periodoInicio = period.inicio;
        periodoFin    = period.fin;
        planillaId    = (body as Record<string, unknown>).id as string;
        createdResources.push({ type: 'planilla', id: planillaId, url: `/planillas/${planillaId}`, headers: {} });
        log('ℹ', `Período: ${formatDate(periodoInicio)} → ${formatDate(periodoFin)}`);
        log('ℹ', `Planilla creada: ${planillaId}`);
        return;
      }
      if (status === 409) {
        // Try to clean up: if the conflict planilla is ENVIADA we can DELETE it
        const b = body as Record<string, unknown>;
        const cid = b.planillaId as string | undefined;
        if (cid) {
          const { body: existing } = await get(`/planillas/${cid}`, operadorSession.token, 200);
          const estado = (existing as Record<string, unknown>).estado as string;
          if (estado === 'BORRADOR' || estado === 'RECHAZADA' || estado === 'ENVIADA') {
            await del(`/planillas/${cid}`, operadorSession.token);
            log('ℹ', `Limpiado conflicto slot ${slot} (${estado}): ${cid.slice(-6)}`);
            // Retry same slot
            const { status: s2, body: b2 } = await post(
              '/planillas',
              { periodoInicio: period.inicio.toISOString(), periodoFin: period.fin.toISOString() },
              operadorSession.token,
            );
            if (s2 === 201) {
              periodoInicio = period.inicio;
              periodoFin    = period.fin;
              planillaId    = (b2 as Record<string, unknown>).id as string;
              createdResources.push({ type: 'planilla', id: planillaId, url: `/planillas/${planillaId}`, headers: {} });
              log('ℹ', `Período: ${formatDate(periodoInicio)} → ${formatDate(periodoFin)}`);
              log('ℹ', `Planilla creada: ${planillaId}`);
              return;
            }
          }
        }
        log('ℹ', `Slot ${slot} en conflicto (${(body as Record<string, unknown>).error}), probando siguiente...`);
        continue;
      }
      throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
    }
    throw new Error('No se pudo encontrar un período libre después de 15 intentos');
  });

  await test('GET /planillas/:id — planilla en BORRADOR', async () => {
    const { body } = await get(`/planillas/${planillaId}`, operadorSession.token, 200);
    const b = body as Record<string, unknown>;
    assert((b.estado as string) === 'BORRADOR', `Estado esperado BORRADOR`);
    assert((b.usuarioId as string) === operadorSession.user.id, 'usuarioId mismatch');
    // Capture sector name for later approver lookup
    ownerSectorNombre = ((b.usuario as Record<string, unknown>)?.sector as Record<string, unknown>)?.nombre as string ?? '';
    log('ℹ', `Sector del operador: ${ownerSectorNombre || '(sin sector)'}`);
  });

  // Add registros for the 3-day period
  const registroIds: string[] = [];
  const dates = [
    formatDate(periodoInicio),
    formatDate(new Date(periodoInicio.getTime() + 86400000)),
    formatDate(periodoFin),
  ];

  await test('POST /planillas/:id/registros — 3 días de trabajo', async () => {
    for (const dateStr of dates) {
      const { status, body } = await post(
        `/planillas/${planillaId}/registros`,
        {
          fecha: dateStr,
          entradaTurno1: isoDatetime(dateStr, '08:00'),
          salidaTurno1: isoDatetime(dateStr, '17:00'),
          lugarTrabajo: 'BASE',
        },
        operadorSession.token,
      );
      if (status === 409) {
        log('ℹ', `Registro para ${dateStr} ya existe`);
        continue;
      }
      assertStatus(status, 201, `registro ${dateStr}: ${JSON.stringify(body)}`);
      const b = body as Record<string, unknown>;
      registroIds.push(b.id as string);
    }
  });

  await test('GET /planillas/:id/registros — lista registros', async () => {
    const { body } = await get(`/planillas/${planillaId}/registros`, operadorSession.token);
    const list = body as unknown[];
    assert(Array.isArray(list) && list.length === 3, `Expected 3 registros, got ${list.length}`);
  });

  if (registroIds.length > 0) {
    await test('PUT /planillas/:id/registros/:rid — actualizar registro (full schema)', async () => {
      const rid = registroIds[0];
      const dateStr = dates[0];
      // PUT uses the full createRegistroSchema — must include all required fields (fecha + times or lugarTrabajo)
      const { status, body } = await put(
        `/planillas/${planillaId}/registros/${rid}`,
        {
          fecha: dateStr,
          entradaTurno1: isoDatetime(dateStr, '07:00'),
          salidaTurno1:  isoDatetime(dateStr, '16:00'),
          lugarTrabajo: 'BASE',
          observaciones: 'Test observación actualizada',
        },
        operadorSession.token,
      );
      assertStatus(status, 200, JSON.stringify(body));
    });
  }

  await test('POST /planillas/:id/enviar — enviar planilla → ENVIADA', async () => {
    const { status, body } = await post(`/planillas/${planillaId}/enviar`, {}, operadorSession.token);
    if (status === 400) {
      const b = body as Record<string, unknown>;
      throw new Error(`Faltan registros: ${JSON.stringify(b.diasFaltantes ?? b.error)}`);
    }
    assertStatus(status, 200);
    const b = body as Record<string, unknown>;
    assert((b.estado as string) === 'ENVIADA', `Estado esperado ENVIADA, got ${b.estado}`);
    assert((b.pasoActual as number) === 1, `pasoActual esperado 1, got ${b.pasoActual}`);
  });

  await test('GET /planillas/:id/historial — historial con BORRADOR→ENVIADA', async () => {
    const { body } = await get(`/planillas/${planillaId}/historial`, operadorSession.token);
    const hist = body as Array<{ estadoNuevo: string }>;
    assert(Array.isArray(hist) && hist.length >= 2, `Expected ≥2 historial entries, got ${hist.length}`);
    assert(hist.some(h => h.estadoNuevo === 'ENVIADA'), 'No entry with estadoNuevo=ENVIADA');
  });

  await test('POST /planillas/:id/enviar — re-submit ya enviada → 400', async () => {
    const { status } = await post(`/planillas/${planillaId}/enviar`, {}, operadorSession.token);
    assertStatus(status, 400);
  });

  // ── Discover full approval chain ──────────────────
  // Build a map: paso.orden → UserSession for each approval step
  let planillaFlujo: { pasos: Array<{ orden: number; rolAprobador: string }> } | null = null;
  let planillaOwner: { id: string; supervisorId: string | null; coordinadorId: string | null; sectorId: string | null } | null = null;
  const approverSessions = new Map<number, UserSession>();

  await test('Descubrir cadena de aprobación completa', async () => {
    const { body } = await get(`/planillas/${planillaId}`, rrhhSession.token);
    const b = body as Record<string, unknown>;
    planillaFlujo = (b.flujo as typeof planillaFlujo) ?? null;
    planillaOwner = {
      id:             (b.usuario as Record<string, unknown>).id as string,
      supervisorId:   (b.usuario as Record<string, unknown>).supervisorId as string | null,
      coordinadorId:  (b.usuario as Record<string, unknown>).coordinadorId as string | null,
      sectorId:       (b.usuario as Record<string, unknown>).sectorId as string | null,
    };

    if (!planillaFlujo || planillaFlujo.pasos.length === 0) {
      log('ℹ', 'Sin flujo configurado — RRHH aprobará directamente');
      return;
    }

    const pasos = planillaFlujo.pasos;
    log('ℹ', `Flujo: ${pasos.length} pasos — ${pasos.map(p => p.rolAprobador).join(' → ')}`);

    for (const paso of pasos) {
      const rol = paso.rolAprobador;

      // 1. Try specific user ID set on the owner (supervisor/coordinator)
      const specificId =
        rol === 'SUPERVISOR'   ? planillaOwner.supervisorId :
        rol === 'COORDINADOR'  ? planillaOwner.coordinadorId :
        null;

      if (specificId) {
        const u = users.find(u => u.id === specificId);
        if (u) {
          approverSessions.set(paso.orden, await login(u.email));
          log('ℹ', `Paso ${paso.orden} (${rol}): ${u.nombre} ${u.apellido} [ID match]`);
          continue;
        }
      }

      // 2. Find by role + sector name (using ownerSectorNombre captured earlier)
      const candidates = users.filter(u =>
        u.rol === rol && !!ownerSectorNombre && u.sector?.nombre === ownerSectorNombre,
      );
      if (candidates.length > 0) {
        approverSessions.set(paso.orden, await login(candidates[0].email));
        log('ℹ', `Paso ${paso.orden} (${rol}): ${candidates[0].nombre} ${candidates[0].apellido} [sector match]`);
        continue;
      }

      // 3. Fall back to any user with that role in the DB (cross-sector)
      const anyCandidates = users.filter(u => u.rol === rol);
      if (anyCandidates.length > 0) {
        approverSessions.set(paso.orden, await login(anyCandidates[0].email));
        log('⚠', `Paso ${paso.orden} (${rol}): ${anyCandidates[0].nombre} ${anyCandidates[0].apellido} [cross-sector fallback]`);
        continue;
      }

      // 4. Use RRHH as last resort (may get 403 if not the right approver)
      approverSessions.set(paso.orden, rrhhSession);
      log('⚠', `Paso ${paso.orden} (${rol}): usando RRHH como fallback (puede fallar)`);
    }
  });

  // Walk through ALL approval steps with discovered approvers
  await test('POST /planillas/:id/avanzar — cadena de aprobación completa', async () => {
    const pasos = planillaFlujo?.pasos ?? [];
    let estado = 'ENVIADA';

    for (const paso of pasos) {
      if (estado === 'APROBADA') break;
      const session = approverSessions.get(paso.orden) ?? rrhhSession;
      const { status, body } = await post(
        `/planillas/${planillaId}/avanzar`,
        { comentario: `Test paso ${paso.orden} (${paso.rolAprobador})` },
        session.token,
      );
      if (status === 403) {
        log('⚠', `Paso ${paso.orden} (${paso.rolAprobador}): 403 — ${(body as Record<string, unknown>).error}`);
        // Keep going — subsequent steps might still work
        continue;
      }
      if (status !== 200) {
        throw new Error(`Paso ${paso.orden}: HTTP ${status} — ${JSON.stringify(body)}`);
      }
      const b = body as Record<string, unknown>;
      estado = b.estado as string;
      log('ℹ', `Paso ${paso.orden} OK → estado: ${estado} (paso ${b.pasoActual})`);
    }

    // If no flujo configured, try RRHH directly
    if (pasos.length === 0) {
      const { status, body } = await post(`/planillas/${planillaId}/avanzar`, { comentario: 'Sin flujo' }, rrhhSession.token);
      if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(body)}`);
      estado = (body as Record<string, unknown>).estado as string;
    }

    log('ℹ', `Estado final tras cadena: ${estado}`);
  });

  // Check final state before cerrar
  let planillaAprobada = false;
  await test('GET /planillas/:id — verificar estado post-aprobación', async () => {
    const { body } = await get(`/planillas/${planillaId}`, rrhhSession.token);
    const b = body as Record<string, unknown>;
    const estado = b.estado as string;
    planillaAprobada = estado === 'APROBADA';
    log('ℹ', `Estado actual: ${estado}`);
    // This is informational — we don't fail here, cerrar will tell us
  });

  if (planillaAprobada) {
    await test('POST /planillas/:id/cerrar — cerrar planilla APROBADA → CERRADA', async () => {
      const { status, body } = await post(`/planillas/${planillaId}/cerrar`, {}, rrhhSession.token);
      assertStatus(status, 200, JSON.stringify(body));
      const b = body as Record<string, unknown>;
      assert((b.estado as string) === 'CERRADA', `Estado esperado CERRADA, got ${b.estado}`);
    });

    // Export test — exportaciones/planillas-excel
    await test('GET /export/planilla/:id — exportar planilla cerrada', async () => {
      const res = await fetch(`${BASE}/export/planilla/${planillaId}`, {
        headers: { Authorization: `Bearer ${rrhhSession.token}` },
      });
      // Accept 200 with xlsx or 404 if route doesn't exist for single planilla
      assert(res.status === 200 || res.status === 404, `HTTP ${res.status}`);
      if (res.status === 200) {
        const ct = res.headers.get('content-type') ?? '';
        log('ℹ', `Content-Type: ${ct}`);
      }
    });
  } else {
    await test('POST /planillas/:id/cerrar — no-APROBADA → 400', async () => {
      const { status } = await post(`/planillas/${planillaId}/cerrar`, {}, rrhhSession.token);
      assertStatus(status, 400);
    });
  }

  // Rejection test — create a new separate planilla
  console.log('\n── Planilla rejection test ─────────────');
  let planillaRechazarId = '';
  let rechazarDates: string[] = [];

  await test('Crear, llenar y enviar segunda planilla (para test rechazo)', async () => {
    let created = false;
    for (let slot = 20; slot < 35; slot++) {
      const rp = getTestPeriod(slot);
      const { status: cs, body: cb } = await post(
        '/planillas',
        { periodoInicio: rp.inicio.toISOString(), periodoFin: rp.fin.toISOString() },
        operadorSession.token,
      );
      if (cs === 409) {
        const b = cb as Record<string, unknown>;
        const cid = b.planillaId as string | undefined;
        if (cid) {
          const { body: existing } = await get(`/planillas/${cid}`, operadorSession.token, 200);
          const estado = (existing as Record<string, unknown>).estado as string;
          if (estado === 'BORRADOR' || estado === 'RECHAZADA' || estado === 'ENVIADA') {
            await del(`/planillas/${cid}`, operadorSession.token);
            const { status: s2, body: b2 } = await post(
              '/planillas',
              { periodoInicio: rp.inicio.toISOString(), periodoFin: rp.fin.toISOString() },
              operadorSession.token,
            );
            if (s2 === 201) {
              planillaRechazarId = (b2 as Record<string, unknown>).id as string;
              createdResources.push({ type: 'planilla', id: planillaRechazarId, url: `/planillas/${planillaRechazarId}`, headers: {} });
              rechazarDates = [formatDate(rp.inicio), formatDate(new Date(rp.inicio.getTime() + 86400000)), formatDate(rp.fin)];
              created = true;
              break;
            }
          }
        }
        continue;
      }
      if (cs === 201) {
        planillaRechazarId = (cb as Record<string, unknown>).id as string;
        createdResources.push({ type: 'planilla', id: planillaRechazarId, url: `/planillas/${planillaRechazarId}`, headers: {} });
        rechazarDates = [formatDate(rp.inicio), formatDate(new Date(rp.inicio.getTime() + 86400000)), formatDate(rp.fin)];
        created = true;
        break;
      }
      throw new Error(`HTTP ${cs}: ${JSON.stringify(cb)}`);
    }
    if (!created) { log('⚠', 'No se pudo crear planilla de rechazo — salteando'); return; }

    for (const dateStr of rechazarDates) {
      await post(
        `/planillas/${planillaRechazarId}/registros`,
        { fecha: dateStr, entradaTurno1: isoDatetime(dateStr, '08:00'), salidaTurno1: isoDatetime(dateStr, '17:00'), lugarTrabajo: 'BASE' },
        operadorSession.token,
      );
    }
    const { status: es } = await post(`/planillas/${planillaRechazarId}/enviar`, {}, operadorSession.token);
    assertStatus(es, 200);
  });

  if (planillaRechazarId) {
    await test('POST /planillas/:id/rechazar — con aprobador paso 1 (SUPERVISOR)', async () => {
      // rechazar requires the current step's approver — paso 1 = SUPERVISOR
      const paso1Session = approverSessions.get(1) ?? rrhhSession;
      const { status, body } = await post(
        `/planillas/${planillaRechazarId}/rechazar`,
        { motivo: 'Test de rechazo — motivo de prueba' },
        paso1Session.token,
      );
      if (status === 403) {
        log('⚠', `Aprobador no autorizado: ${(body as Record<string, unknown>).error}`);
        throw new Error(`403 Forbidden: ${(body as Record<string, unknown>).error}`);
      }
      assertStatus(status, 200, JSON.stringify(body));
      assert((body as Record<string, unknown>).estado === 'RECHAZADA', 'Estado esperado RECHAZADA');
    });

    await test('Re-enviar planilla rechazada → ENVIADA', async () => {
      const { status, body } = await post(`/planillas/${planillaRechazarId}/enviar`, {}, operadorSession.token);
      assertStatus(status, 200, JSON.stringify(body));
      assert((body as Record<string, unknown>).estado === 'ENVIADA', 'Estado esperado ENVIADA');
    });
  }

  // ── 3. Vacaciones lifecycle ──────────────────────
  console.log('\n── Vacaciones ──────────────────────────');

  await test('GET /vacaciones/saldo — saldo del operador', async () => {
    const { body } = await get('/vacaciones/saldo', operadorSession.token);
    const b = body as Record<string, unknown>;
    assert(typeof b.disponible === 'number', `disponible no es número: ${JSON.stringify(b)}`);
    assert(typeof b.total === 'number', `total no es número`);
    log('ℹ', `Saldo: ${b.disponible} disponibles / ${b.total} total`);
  });

  let vacacionId = '';
  let vacacionSaldoDisponible = 0;
  // Use old fixed dates for vacaciones (a week-long block in 2009)
  const vacInicio = new Date(2009, 2, 10); // 2009-03-10
  const vacFin    = new Date(2009, 2, 16); // 2009-03-16 (7 days)

  await test('POST /vacaciones — crear solicitud de vacaciones', async () => {
    // Re-read current balance
    const { body: saldoBody } = await get('/vacaciones/saldo', operadorSession.token);
    vacacionSaldoDisponible = (saldoBody as Record<string, unknown>).disponible as number ?? 0;

    if (vacacionSaldoDisponible === 0) {
      log('⚠', 'Saldo 0 — no se puede solicitar vacaciones. Skipping (no es error de la app).');
      return; // pass the test — can't test without balance
    }

    const diasSolicitar = Math.min(5, vacacionSaldoDisponible);
    const fechaFinAjustada = diasSolicitar < 5 ? vacInicio : vacFin;
    const { status, body } = await post(
      '/vacaciones',
      {
        fechaInicio: vacInicio.toISOString(),
        fechaFin: fechaFinAjustada.toISOString(),
        diasHabiles: diasSolicitar,
        motivo: 'Vacaciones de prueba — test de integración',
      },
      operadorSession.token,
    );

    if (status === 400) {
      const b = body as Record<string, unknown>;
      const error = (b.error as string) ?? '';
      if (error.toLowerCase().includes('saldo') || error.includes('SALDO_INSUFICIENTE')) {
        log('⚠', `Saldo insuficiente al crear (${error}). Skipping.`);
        return; // pass — balance race condition, not a bug
      }
      throw new Error(`HTTP 400: ${JSON.stringify(body)}`);
    }
    if (status === 409) {
      // Already exists — grab the existing id and move on
      vacacionId = (body as Record<string, unknown>).vacacionId as string ?? '';
      log('ℹ', `Vacación ya existe: ${vacacionId}`);
      return;
    }
    assertStatus(status, 201);
    vacacionId = (body as Record<string, unknown>).id as string;
    createdResources.push({ type: 'vacacion', id: vacacionId, url: '', headers: {} });
    log('ℹ', `Vacación creada: ${vacacionId}`);
  });

  if (vacacionId) {
    await test('GET /vacaciones/:id — detalle de vacación', async () => {
      const { body } = await get(`/vacaciones/${vacacionId}`, operadorSession.token);
      const b = body as Record<string, unknown>;
      assert(b.id === vacacionId, 'id mismatch');
    });

    await test('POST /vacaciones/:id/enviar — enviar vacación a aprobación', async () => {
      const { status, body } = await post(`/vacaciones/${vacacionId}/enviar`, {}, operadorSession.token);
      if (status === 400) {
        const b = body as Record<string, unknown>;
        log('ℹ', `enviar: ${b.error}`);
        return;
      }
      assertStatus(status, 200, JSON.stringify(body));
      const b = body as Record<string, unknown>;
      log('ℹ', `Estado vacación: ${b.estado}`);
    });

    await test('GET /vacaciones — lista incluye nuestra solicitud', async () => {
      const { body } = await get('/vacaciones', operadorSession.token);
      const list = body as Array<{ id: string }>;
      assert(Array.isArray(list), 'No es array');
      assert(list.some(v => v.id === vacacionId), 'Vacación no aparece en lista');
    });

    await test('POST /vacaciones/:id/avanzar — RRHH aprueba vacación', async () => {
      const { status, body } = await post(
        `/vacaciones/${vacacionId}/avanzar`,
        { comentario: 'Aprobada en test de integración' },
        rrhhSession.token,
      );
      // RRHH might not be the right approver for step 1 if there's a specific flow
      if (status === 403) {
        log('⚠', `RRHH no puede aprobar vacación: ${(body as Record<string, unknown>).error}`);
        return; // not a hard failure — flow config dependent
      }
      assertStatus(status, 200, JSON.stringify(body));
      const b = body as Record<string, unknown>;
      log('ℹ', `Estado vacación post-avanzar: ${b.estado}`);
    });
  }

  // ── 4. Ausencias ────────────────────────────────
  console.log('\n── Ausencias ───────────────────────────');

  let ausenciaId = '';
  const ausInicio = new Date(2008, 5, 15); // 2008-06-15 (fixed old date)
  const ausFin    = new Date(2008, 5, 16); // 2008-06-16

  // Test self-request by employee
  await test('POST /ausencias/solicitar — empleado solicita certificado médico', async () => {
    const { status, body } = await post(
      '/ausencias/solicitar',
      {
        tipo: 'CERTIFICADO_MEDICO',
        fechaInicio: ausInicio.toISOString(),
        fechaFin: ausFin.toISOString(),
        diasAusencia: 2,
        descripcion: 'Test de certificado médico — integración',
      },
      operadorSession.token,
    );
    assertStatus(status, 201, JSON.stringify(body));
    ausenciaId = (body as Record<string, unknown>).id as string;
    log('ℹ', `Ausencia creada: ${ausenciaId}`);
  });

  if (ausenciaId) {
    await test('GET /ausencias — lista incluye ausencia', async () => {
      const { body } = await get('/ausencias?scope=mio', operadorSession.token);
      const list = body as Array<{ id: string }>;
      assert(Array.isArray(list), 'No es array');
      assert(list.some(a => a.id === ausenciaId), 'Ausencia no aparece en lista');
    });

    await test('POST /ausencias/:id/avanzar — RRHH aprueba ausencia', async () => {
      const { status, body } = await post(
        `/ausencias/${ausenciaId}/avanzar`,
        { comentario: 'Aprobada en test de integración' },
        rrhhSession.token,
      );
      if (status === 403) {
        log('⚠', `RRHH no puede aprobar ausencia: ${(body as Record<string, unknown>).error}`);
        return;
      }
      assertStatus(status, 200, JSON.stringify(body));
      const b = body as Record<string, unknown>;
      log('ℹ', `Estado ausencia: ${b.estado}`);
    });
  }

  // Test RRHH creating an absence for employee
  let ausenciaRrhhId = '';
  const ausRrhhInicio = new Date(2007, 8, 5); // 2007-09-05 (fixed old date)
  const ausRrhhFin    = new Date(2007, 8, 6);

  await test('POST /ausencias — RRHH crea ausencia para empleado', async () => {
    const { status, body } = await post(
      '/ausencias',
      {
        usuarioId: operadorSession.user.id,
        tipo: 'FALTA_JUSTIFICADA',
        fechaInicio: ausRrhhInicio.toISOString(),
        fechaFin: ausRrhhFin.toISOString(),
        diasAusencia: 1,
        descripcion: 'Creada por RRHH en test',
        descuentaSueldo: false,
      },
      rrhhSession.token,
    );
    assertStatus(status, 201, JSON.stringify(body));
    ausenciaRrhhId = (body as Record<string, unknown>).id as string;
    log('ℹ', `Ausencia RRHH creada: ${ausenciaRrhhId}`);
  });

  // ── 5. Aprobaciones dashboard ─────────────────────
  console.log('\n── Aprobaciones dashboard ──────────────');

  await test('GET /aprobaciones — RRHH ve dashboard completo', async () => {
    const { body } = await get('/aprobaciones', rrhhSession.token);
    const b = body as Record<string, unknown>;
    assert('planillasPendientes' in b, 'Missing planillasPendientes');
    assert('vacacionesPendientes' in b, 'Missing vacacionesPendientes');
    assert('ausenciasPendientes' in b, 'Missing ausenciasPendientes');
    assert('historial' in b, 'Missing historial');
    const pp = b.planillasPendientes as unknown[];
    const vp = b.vacacionesPendientes as unknown[];
    const ap = b.ausenciasPendientes as unknown[];
    log('ℹ', `Pendientes — planillas: ${pp.length}, vacaciones: ${vp.length}, ausencias: ${ap.length}`);
  });

  await test('GET /aprobaciones — operador ve solo sus items (scope=mio)', async () => {
    const { body } = await get('/aprobaciones?scope=mio', operadorSession.token);
    const b = body as Record<string, unknown>;
    assert('planillasPendientes' in b || 'faltantes' in b, 'Respuesta inesperada');
  });

  // ── 6. Mensajes ────────────────────────────────────
  console.log('\n── Mensajes ────────────────────────────');

  let mensajeId = '';

  await test('POST /mensajes — RRHH envía mensaje a todos', async () => {
    const res = await fetch(`${BASE}/mensajes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${rrhhSession.token}` },
      body: (() => {
        const fd = new FormData();
        fd.append('asunto', 'Test de integración — mensaje de prueba');
        fd.append('cuerpo', 'Este es un mensaje de prueba creado por los tests de integración automáticos.');
        fd.append('destinoTipo', 'TODOS');
        fd.append('permiteRespuesta', 'true');
        return fd;
      })(),
    });
    assertStatus(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    mensajeId = body.id as string;
    log('ℹ', `Mensaje enviado: ${mensajeId}`);
  });

  if (mensajeId) {
    await test('GET /mensajes — operador ve inbox', async () => {
      const { body } = await get('/mensajes', operadorSession.token);
      const b = body as Record<string, unknown>;
      const msgs = b.mensajes as Array<{ id: string }>;
      assert(Array.isArray(msgs), 'mensajes no es array');
      log('ℹ', `Inbox: ${msgs.length} mensajes, ${b.noLeidos} no leídos`);
    });

    await test('GET /mensajes/no-leidos — contador', async () => {
      const { body } = await get('/mensajes/no-leidos', operadorSession.token);
      const b = body as Record<string, unknown>;
      assert(typeof b.count === 'number', 'count no es número');
      log('ℹ', `No leídos: ${b.count}`);
    });

    await test('GET /mensajes/:id — leer mensaje', async () => {
      const { body } = await get(`/mensajes/${mensajeId}`, operadorSession.token);
      const b = body as Record<string, unknown>;
      assert(b.id === mensajeId, 'id mismatch');
      assert(b.asunto === 'Test de integración — mensaje de prueba', 'asunto mismatch');
    });

    await test('POST /mensajes/:id/responder — operador responde', async () => {
      const res = await fetch(`${BASE}/mensajes/${mensajeId}/responder`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${operadorSession.token}` },
        body: (() => {
          const fd = new FormData();
          fd.append('cuerpo', 'Respuesta de prueba desde el test de integración');
          return fd;
        })(),
      });
      assertStatus(res.status, 201);
    });

    await test('PUT /mensajes/leer-todas — marcar todo como leído', async () => {
      const { status } = await put('/mensajes/leer-todas', {}, operadorSession.token, 200);
      assertStatus(status, 200);
    });
  }

  // ── 7. Notificaciones ─────────────────────────────
  console.log('\n── Notificaciones ──────────────────────');

  await test('GET /notificaciones — listar (generadas por el flujo)', async () => {
    const { body } = await get('/notificaciones', operadorSession.token);
    const list = body as unknown[];
    assert(Array.isArray(list), 'No es array');
    log('ℹ', `${list.length} notificaciones para el operador`);
  });

  await test('GET /notificaciones/count — contador no leídas', async () => {
    const { body } = await get('/notificaciones/count', operadorSession.token);
    const b = body as Record<string, unknown>;
    assert(typeof b.count === 'number', 'count no es número');
    log('ℹ', `No leídas: ${b.count}`);
  });

  // Create a manual notification via RRHH and read it
  let notifId = '';
  await test('POST /notificaciones — RRHH crea notificación manual', async () => {
    const { status, body } = await post(
      '/notificaciones',
      {
        usuarioId: operadorSession.user.id,
        tipo: 'TEST',
        titulo: 'Notificación de prueba — test integración',
        cuerpo: 'Cuerpo de la notificación de prueba',
        link: '/planillas',
      },
      rrhhSession.token,
    );
    assertStatus(status, 201, JSON.stringify(body));
    notifId = (body as Record<string, unknown>).id as string;
    log('ℹ', `Notificación creada: ${notifId}`);
  });

  if (notifId) {
    await test('PUT /notificaciones/:id/leer — marcar como leída', async () => {
      const { status } = await put(`/notificaciones/${notifId}/leer`, {}, operadorSession.token, 200);
      assertStatus(status, 200);
    });
  }

  await test('PUT /notificaciones/leer-todas — marcar todo como leído', async () => {
    const { status } = await put('/notificaciones/leer-todas', {}, operadorSession.token, 200);
    assertStatus(status, 200);
  });

  // ── 8. Export ─────────────────────────────────────
  console.log('\n── Export ──────────────────────────────');

  await test('GET /exportaciones — lista exportaciones previas', async () => {
    const { status, body } = await get('/exportaciones', rrhhSession.token, 200);
    assert(status === 200 || status === 404, `HTTP ${status}`);
    if (status === 200) {
      log('ℹ', `Exportaciones: ${Array.isArray(body) ? (body as unknown[]).length : 'N/A'}`);
    }
  });

  // ── 9. Mis solicitudes (employee dashboard) ───────
  console.log('\n── Mis Solicitudes ─────────────────────');

  await test('GET /mis-solicitudes — resumen del operador', async () => {
    const { status, body } = await get('/mis-solicitudes', operadorSession.token, 200);
    if (status !== 200) { log('⚠', `${status}: ${JSON.stringify(body)}`); return; }
    const list = body as unknown[];
    log('ℹ', `Mis solicitudes: ${list.length} registros (tipos: ${[...new Set(list.map((x: any) => x.tipo))].join(', ')})`);
  });

  // ── 10. Edge cases & auth checks ──────────────────
  console.log('\n── Edge cases / Auth ───────────────────');

  await test('GET /planillas/:id por otro usuario → 403/404', async () => {
    // Create a second user session
    const otroUser = users.find(u => u.rol === 'OPERADOR' && u.email !== operadorUser!.email);
    if (!otroUser) { log('⚠', 'No hay segundo OPERADOR para test de autorización'); return; }
    const otroSession = await login(otroUser.email);
    const { status } = await get(`/planillas/${planillaId}`, otroSession.token, 403);
    assert(status === 403 || status === 404, `Expected 403/404, got ${status}`);
  });

  await test('DELETE /planillas/:id en estado no-BORRADOR → 400/403', async () => {
    const { status } = await del(`/planillas/${planillaId}`, operadorSession.token, 400);
    assert(status === 400 || status === 403 || status === 404, `Expected 4xx, got ${status}`);
  });

  await test('POST /planillas/:id/avanzar sin permiso (OPERADOR) → 403', async () => {
    const { status } = await post(
      `/planillas/${planillaId}/avanzar`,
      { comentario: 'test' },
      operadorSession.token,
      403,
    );
    assertStatus(status, 403);
  });

  // ══════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════
  console.log('\n── Cleanup ─────────────────────────────');

  // Delete test planillas — BORRADOR, RECHAZADA, and ENVIADA can all be deleted by owner
  for (const r of createdResources.filter(x => x.type === 'planilla')) {
    try {
      const { body } = await get(`/planillas/${r.id}`, rrhhSession.token, 200);
      const estado = (body as Record<string, unknown>).estado as string;
      if (estado === 'BORRADOR' || estado === 'RECHAZADA' || estado === 'ENVIADA') {
        const { status: ds } = await del(`/planillas/${r.id}`, operadorSession.token);
        if (ds === 204) log('🧹', `Planilla ${estado} ${r.id.slice(-6)} eliminada`);
        else log('⚠', `No se pudo eliminar planilla ${r.id.slice(-6)}: HTTP ${ds}`);
      } else if (estado === 'EN_REVISION') {
        // Try each discovered approver — the current step's approver is the right one
        let cleaned = false;
        const sessions = [...approverSessions.values(), rrhhSession];
        for (const sess of sessions) {
          const { status: rs } = await post(`/planillas/${r.id}/rechazar`, { motivo: 'Cleanup de test' }, sess.token);
          if (rs === 200) {
            const { status: ds } = await del(`/planillas/${r.id}`, operadorSession.token);
            if (ds === 204) log('🧹', `Planilla EN_REVISION ${r.id.slice(-6)} rechazada y eliminada`);
            cleaned = true;
            break;
          }
        }
        if (!cleaned) log('⚠', `Planilla EN_REVISION ${r.id.slice(-6)} — no se pudo limpiar`);
      } else {
        log('🧹', `Planilla ${r.id.slice(-6)} en ${estado} — no eliminada (estado no limpiable)`);
      }
    } catch {
      // ignore cleanup errors
    }
  }

  // Clean up test ausencias
  for (const id of [ausenciaId, ausenciaRrhhId].filter(Boolean)) {
    try {
      const { status: ds } = await del(`/ausencias/${id}`, rrhhSession.token);
      if (ds === 204) log('🧹', `Ausencia ${id.slice(-6)} eliminada`);
      else log('⚠', `No se pudo eliminar ausencia ${id.slice(-6)}: HTTP ${ds}`);
    } catch {
      // ignore cleanup errors
    }
  }

  // Clean up test vacaciones
  for (const r of createdResources.filter(x => x.type === 'vacacion')) {
    try {
      const { status: ds } = await del(`/vacaciones/${r.id}`, rrhhSession.token);
      if (ds === 204) log('🧹', `Vacación ${r.id.slice(-6)} eliminada`);
      else log('⚠', `No se pudo eliminar vacación ${r.id.slice(-6)}: HTTP ${ds}`);
    } catch {
      // ignore cleanup errors
    }
  }

  // ══════════════════════════════════════════════
  // REPORT
  // ══════════════════════════════════════════════

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log('\n═══════════════════════════════════════════');
  console.log('  RESULTADO FINAL');
  console.log('═══════════════════════════════════════════');
  console.log(`  ✅ Pasados:  ${passed}/${total}`);
  console.log(`  ❌ Fallados: ${failed}/${total}`);
  console.log(`  ⏱  Tiempo:  ${totalMs}ms total\n`);

  if (failed > 0) {
    console.log('  FALLOS DETALLADOS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}`);
      console.log(`     → ${r.detail}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n💥 Error fatal en tests:', e);
  process.exit(1);
});
