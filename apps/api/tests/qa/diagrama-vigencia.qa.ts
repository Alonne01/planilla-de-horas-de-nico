/**
 * QA Suite — VIGENCIA del diagrama por rango de fechas y VENCIMIENTO de
 * solicitudes de cambio de diagrama (KEY=diagvig)
 *
 * Reglas de negocio bajo prueba:
 *  - `POST /cambios-diagrama` exige `fechaEfectiva` obligatoria y estrictamente
 *    posterior a hoy (en hora Argentina).
 *  - `GET /planillas/:id` expone `tramosDiagrama`: los tramos que cubren el
 *    período, resueltos por fecha y no por el flag `activo`.
 *  - Una solicitud que llega a su `fechaEfectiva` sin terminar de aprobarse
 *    VENCE: pasa a RECHAZADA con un motivo "Vencida...". El barrido lo hace
 *    `vencerCambiosDiagrama()` (apps/api/src/utils/cambios-diagrama.service.ts);
 *    las solicitudes viejas sin `fechaEfectiva` (el campo era opcional) no se
 *    tocan.
 *  - El bug central de todo este trabajo: cerrar una asignación de diagrama
 *    (`activo: false`) no puede borrarle el recargo del 100% a los días
 *    anteriores al corte. `esFrancoPorDiagrama` (contexto-dia.utils.ts) tiene
 *    que seguir viendo el franco de un tramo viejo aunque ya no esté activo.
 *  - Al aprobar un cambio de diagrama, `recalcularDesde()`
 *    (recalculo-diagrama.utils.ts) recalcula los registros con fecha >= la
 *    fecha de corte: sólo toca planillas BORRADOR/RECHAZADA, congela (no
 *    toca) las demás y actualiza los totales de la planilla recalculada. Un
 *    día que era laborable pasa a franco trabajado (100%) si el diagrama
 *    nuevo lo marca franco; un día anterior al corte no se toca nunca.
 *
 * Black-box HTTP contra la API viva, más acceso directo a Prisma para los
 * escenarios que la propia API ya no deja producir por HTTP (fechas pasadas,
 * filas viejas sin `fechaEfectiva`).
 *
 * Run: cd apps/api && npx tsx tests/qa/diagrama-vigencia.qa.ts
 */
// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que esta en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'diagvig';
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

// UUIDs con formato válido pero sin fila real detrás: alcanza para los
// escenarios 1 y 2, porque el 400 de `fechaEfectiva` lo dispara el `refine`
// de zod ANTES de que la ruta toque la base de datos.
const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

// Argentina es UTC-3 fijo (sin horario de verano desde 2009), igual que
// `hoyEnArgentina()` en cambios-diagrama.routes.ts. Se replica acá para que
// "hoy"/"ayer" en el test coincidan con el día que la propia ruta calcula,
// sin importar en qué hora UTC corra la suite (el cruce de medianoche UTC
// entre las 21:00 y las 24:00 hora Argentina movería el resultado si se
// comparara contra el UTC crudo).
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;
function hoyEnArgentinaStr(): string {
  const ahoraEnAR = new Date(Date.now() - OFFSET_ARGENTINA_MS);
  return new Date(Date.UTC(ahoraEnAR.getUTCFullYear(), ahoraEnAR.getUTCMonth(), ahoraEnAR.getUTCDate())).toISOString().slice(0, 10);
}
function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m as number) - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  console.log(col('CYAN', `\n═══ QA DIAGRAMA-VIGENCIA suite (ts=${TS}) ═══\n`));
  const rrhh = await login('rrhh1@test.wenlen.com'); // nivel 90: alcanza para COORDINADOR (70) y para RRHH+
  // El usuario de la consigna es "ope1.testing@..."; el que existe en el seed
  // es "op1.testing@..." (sin la "e"). Se usa el real.
  const ope = await login('op1.testing@test.wenlen.com');

  // ═══ 1-2. Validación de fechaEfectiva en POST /cambios-diagrama ═══

  await scenario('1. sin fechaEfectiva → 400 (es obligatoria)', async () => {
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: UUID_A, diagramaNuevoId: UUID_B, motivo: `QA ${TS}`,
    }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  await scenario('2a. fechaEfectiva pasada → 400', async () => {
    const ayer = sumarDias(hoyEnArgentinaStr(), -1);
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: UUID_A, diagramaNuevoId: UUID_B, motivo: `QA ${TS}`, fechaEfectiva: ayer,
    }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  await scenario('2b. fechaEfectiva de hoy → 400 (tiene que ser estrictamente posterior)', async () => {
    const hoy = hoyEnArgentinaStr();
    const { status, body } = await post('/cambios-diagrama', {
      usuarioId: UUID_A, diagramaNuevoId: UUID_B, motivo: `QA ${TS}`, fechaEfectiva: hoy,
    }, rrhh.token);
    assertStatus(status, 400, JSON.stringify(body));
  });

  // ═══ 3. Una fecha futura sí se acepta ═══

  const solicitudesCreadas: string[] = [];
  cleanupQueue.push(async () => {
    for (const id of solicitudesCreadas) await del(`/cambios-diagrama/${id}`, rrhh.token).catch(() => {});
  });

  await scenario('3. fechaEfectiva futura → 201, se crea la solicitud', async () => {
    const { body: diagramasResp } = await get('/cambios-diagrama/diagramas', rrhh.token);
    const diagramas = Array.isArray(diagramasResp) ? diagramasResp : (diagramasResp?.data ?? []);
    if (diagramas.length === 0) { info('no hay diagramas cargados: escenario no aplicable'); return; }

    const { body: usuariosResp } = await get('/usuarios?activo=true', rrhh.token);
    const usuarios: any[] = Array.isArray(usuariosResp) ? usuariosResp : (usuariosResp?.data ?? usuariosResp?.usuarios ?? []);
    if (usuarios.length === 0) { info('no hay usuarios activos: escenario no aplicable'); return; }

    // Evitar el 409 de "ya existe una solicitud pendiente para este usuario":
    // se descartan los que ya tienen una PENDIENTE/EN_REVISION en curso.
    const { body: existentesResp } = await get('/cambios-diagrama', rrhh.token);
    const existentes: any[] = Array.isArray(existentesResp) ? existentesResp : (existentesResp?.data ?? []);
    const conPendiente = new Set(
      existentes.filter((s) => s.estado === 'PENDIENTE' || s.estado === 'EN_REVISION').map((s) => s.usuarioId),
    );
    const candidatos = usuarios.filter((u) => !conPendiente.has(u.id));
    if (candidatos.length === 0) { info('todos los usuarios activos ya tienen una solicitud pendiente: escenario no aplicable'); return; }

    const fechaFutura = sumarDias(hoyEnArgentinaStr(), 30);
    let creado: { status: number; body: any } | null = null;
    for (const u of candidatos.slice(0, 10)) {
      const r = await post('/cambios-diagrama', {
        usuarioId: u.id, diagramaNuevoId: diagramas[0].id, motivo: `QA ${TS}`, fechaEfectiva: fechaFutura,
      }, rrhh.token);
      if (r.status === 201) { creado = r; break; }
      if (r.status !== 409) { creado = r; break; } // error inesperado: no seguir probando, que falle con detalle
    }
    assert(!!creado, 'no se encontró ningún candidato sin solicitud pendiente entre los primeros 10');
    assertStatus(creado!.status, 201, JSON.stringify(creado!.body));
    solicitudesCreadas.push(creado!.body.id);
  });

  // ═══ 4. GET /planillas/:id trae tramosDiagrama ═══

  const planillasCreadas: string[] = [];
  cleanupQueue.push(async () => {
    for (const id of planillasCreadas) await del(`/planillas/${id}`, ope.token).catch(() => {});
  });

  await scenario('4. GET /planillas/:id devuelve tramosDiagrama como array', async () => {
    const { status: cStatus, body: cBody } = await post('/planillas', {
      periodoInicio: '2031-02-10', periodoFin: '2031-02-10',
    }, ope.token);
    assertStatus(cStatus, 201, `crear planilla: ${JSON.stringify(cBody)}`);
    planillasCreadas.push(cBody.id);

    const { status, body } = await get(`/planillas/${cBody.id}`, ope.token);
    assertStatus(status, 200, JSON.stringify(body));
    assert(Array.isArray(body.tramosDiagrama), `tramosDiagrama no es array: ${JSON.stringify(body.tramosDiagrama)}`);
  });

  // ═══ Prisma directo: escenarios que la API ya no deja producir por HTTP ═══

  let rawPrisma: any = null;
  async function getPrisma(): Promise<any> {
    if (!rawPrisma) {
      const { PrismaClient } = await import('@prisma/client');
      rawPrisma = new PrismaClient();
    }
    return rawPrisma;
  }

  const solicitudesRawCreadas: string[] = [];
  const notifsRawCreadas: string[] = [];
  const usuarioDiagramaRawCreados: string[] = [];
  cleanupQueue.push(async () => {
    if (!rawPrisma) return;
    // El historial cuelga de la solicitud con onDelete: Cascade: borrar la
    // solicitud alcanza. Las notificaciones no tienen esa relación y hay que
    // borrarlas aparte.
    for (const id of solicitudesRawCreadas) await rawPrisma.solicitudCambioDiagrama.delete({ where: { id } }).catch(() => {});
    for (const id of notifsRawCreadas) await rawPrisma.notificacion.delete({ where: { id } }).catch(() => {});
    for (const id of usuarioDiagramaRawCreados) await rawPrisma.usuarioDiagrama.delete({ where: { id } }).catch(() => {});
  });

  // ═══ 5. El barrido vence una PENDIENTE cuya fecha ya llegó ═══

  await scenario('5. vencerCambiosDiagrama() cierra una PENDIENTE vencida (RECHAZADA + notifs, sin aplicar el cambio)', async () => {
    const prisma = await getPrisma();
    const empleado = await prisma.usuario.findFirst({ where: { empresaId: rrhh.user.empresaId, activo: true } });
    const diagrama = await prisma.diagrama.findFirst({ where: { empresaId: rrhh.user.empresaId, activo: true } });
    if (!empleado || !diagrama) { info('no hay empleado o diagrama para armar el escenario: no aplicable'); return; }

    const asignacionesAntes = await prisma.usuarioDiagrama.count({ where: { usuarioId: empleado.id } });

    const ayerUTC = new Date();
    ayerUTC.setUTCDate(ayerUTC.getUTCDate() - 1);

    const solicitud = await prisma.solicitudCambioDiagrama.create({
      data: {
        solicitanteId: rrhh.user.id,
        usuarioId: empleado.id,
        diagramaNuevoId: diagrama.id,
        estado: 'PENDIENTE',
        pasoActual: 1,
        motivo: `QA ${TS} vencida`,
        fechaEfectiva: ayerUTC,
      },
    });
    solicitudesRawCreadas.push(solicitud.id);

    const antesDeVencer = new Date();
    const { vencerCambiosDiagrama, MOTIVO_VENCIDA } = await import('../../src/utils/cambios-diagrama.service.js');
    await vencerCambiosDiagrama();

    const releida = await prisma.solicitudCambioDiagrama.findUnique({ where: { id: solicitud.id } });
    assert(!!releida, 'la solicitud desapareció');
    assert(releida.estado === 'RECHAZADA', `estado=${releida.estado}`);
    assert(!!releida.obsRechazo && releida.obsRechazo.startsWith('Vencida'), `obsRechazo=${releida.obsRechazo}`);
    assert(releida.obsRechazo === MOTIVO_VENCIDA, `obsRechazo no coincide con MOTIVO_VENCIDA: ${releida.obsRechazo}`);

    // Vencer NO es aplicar: no tiene que haber una asignación de diagrama nueva.
    const asignacionesDespues = await prisma.usuarioDiagrama.count({ where: { usuarioId: empleado.id } });
    assert(asignacionesDespues === asignacionesAntes, `se crearon asignaciones de diagrama: ${asignacionesAntes} → ${asignacionesDespues}`);

    // Notificaciones al empleado y al solicitante (acá son la misma persona
    // si el findFirst devolvió al propio rrhh, así que se compara por Set).
    const destinatarios = [...new Set([empleado.id, rrhh.user.id])];
    const notifs = await prisma.notificacion.findMany({
      where: {
        usuarioId: { in: destinatarios },
        tipo: 'CAMBIO_DIAGRAMA',
        titulo: 'Solicitud de cambio de diagrama vencida',
        createdAt: { gte: antesDeVencer },
      },
    });
    for (const n of notifs) notifsRawCreadas.push(n.id);
    assert(notifs.length === destinatarios.length, `se esperaban ${destinatarios.length} notificaciones, hubo ${notifs.length}`);
  });

  // ═══ 6. El barrido no toca las que no tienen fecha ═══

  await scenario('6. vencerCambiosDiagrama() no toca una PENDIENTE con fechaEfectiva null', async () => {
    const prisma = await getPrisma();
    const empleado = await prisma.usuario.findFirst({ where: { empresaId: rrhh.user.empresaId, activo: true } });
    const diagrama = await prisma.diagrama.findFirst({ where: { empresaId: rrhh.user.empresaId, activo: true } });
    if (!empleado || !diagrama) { info('no hay empleado o diagrama para armar el escenario: no aplicable'); return; }

    const solicitud = await prisma.solicitudCambioDiagrama.create({
      data: {
        solicitanteId: rrhh.user.id,
        usuarioId: empleado.id,
        diagramaNuevoId: diagrama.id,
        estado: 'PENDIENTE',
        pasoActual: 1,
        motivo: `QA ${TS} sin-fecha`,
        fechaEfectiva: null,
      },
    });
    solicitudesRawCreadas.push(solicitud.id);

    const { vencerCambiosDiagrama } = await import('../../src/utils/cambios-diagrama.service.js');
    await vencerCambiosDiagrama();

    const releida = await prisma.solicitudCambioDiagrama.findUnique({ where: { id: solicitud.id } });
    assert(!!releida, 'la solicitud desapareció');
    assert(releida.estado === 'PENDIENTE', `estado=${releida.estado} (no debía tocarse)`);
  });

  // ═══ 7. Un franco de un tramo viejo se sigue detectando ═══

  await scenario('7. esFrancoPorDiagrama detecta un franco del tramo VIEJO aunque ya esté cerrado (activo: false)', async () => {
    const prisma = await getPrisma();
    const { esDiaFrancoSegunDiagrama, esFrancoPorDiagrama } = await import('../../src/utils/contexto-dia.utils.js');

    // ROTATIVO da francos garantizados dentro de una ventana de 6 meses (el
    // ciclo más largo del seed es 14×14=28 días); FIJO_SEMANA podría no tener
    // ninguno si diasSemana cubre los 7 días, así que se prueban varios.
    const diagramas = await prisma.diagrama.findMany({
      where: { empresaId: rrhh.user.empresaId, activo: true, tipo: 'ROTATIVO' },
      take: 5,
    });
    if (diagramas.length === 0) { info('no hay diagramas ROTATIVO: escenario no aplicable'); return; }

    // Ventana muy vieja (1995) para no pisar el historial real de asignaciones
    // de ningún empleado del seed (el más antiguo ingresó en 2012).
    const viejaInicio = new Date(Date.UTC(1995, 0, 1));
    const viejaFin = new Date(Date.UTC(1995, 5, 30));
    const nuevaInicio = new Date(Date.UTC(1995, 6, 1));

    let diagramaViejo: any = null;
    let diagramaNuevo: any = null;
    let diaFranco: Date | null = null;
    for (const d of diagramas) {
      const candidato = new Date(viejaInicio);
      while (candidato <= viejaFin) {
        if (esDiaFrancoSegunDiagrama(candidato, d, viejaInicio)) { diaFranco = new Date(candidato); break; }
        candidato.setUTCDate(candidato.getUTCDate() + 1);
      }
      if (diaFranco) {
        diagramaViejo = d;
        // El nuevo, activo, es otro diagrama distinto (o el mismo si sólo hay
        // uno): así se prueba que el franco del día viejo sale del diagrama
        // VIEJO y no del que está activo hoy.
        diagramaNuevo = diagramas.find((x) => x.id !== d.id) ?? d;
        break;
      }
    }
    if (!diaFranco || !diagramaViejo) { info('ningún diagrama ROTATIVO tuvo francos en la ventana de prueba: no aplicable'); return; }

    const empleado = await prisma.usuario.findFirst({ where: { empresaId: rrhh.user.empresaId, activo: true } });
    if (!empleado) { info('no hay empleado: escenario no aplicable'); return; }

    const vieja = await prisma.usuarioDiagrama.create({
      data: { usuarioId: empleado.id, diagramaId: diagramaViejo.id, fechaInicio: viejaInicio, fechaFin: viejaFin, activo: false },
    });
    usuarioDiagramaRawCreados.push(vieja.id);
    const nueva = await prisma.usuarioDiagrama.create({
      data: { usuarioId: empleado.id, diagramaId: diagramaNuevo.id, fechaInicio: nuevaInicio, fechaFin: null, activo: true },
    });
    usuarioDiagramaRawCreados.push(nueva.id);

    const esFranco = await esFrancoPorDiagrama(empleado.id, diaFranco);
    assert(esFranco === true, `esFrancoPorDiagrama(${diaFranco.toISOString().slice(0, 10)}) = ${esFranco}, esperaba true (tramo viejo, activo:false)`);
  });

  // ═══ 8-12. recalcularDesde(): recálculo al aprobar un cambio de diagrama ═══
  //
  // El escenario se arma una sola vez (8) y las siguientes 4 sólo leen lo que
  // dejó: separarlo así evita levantar dos veces el mismo historial de
  // diagramas/planillas/registros para probar cuatro aristas de un mismo
  // llamado a recalcularDesde().

  const planillasRawCreadas: string[] = [];
  cleanupQueue.push(async () => {
    if (!rawPrisma) return;
    // Los registros y el historial cuelgan de la planilla con onDelete: Cascade.
    for (const id of planillasRawCreadas) await rawPrisma.planilla.delete({ where: { id } }).catch(() => {});
  });

  let rPlanillaBorradorId: string | null = null;
  let rPlanillaAprobadaId: string | null = null;
  let rRegistroAntesId: string | null = null;
  let rRegistroDespuesBorradorId: string | null = null;
  let rRegistroDespuesAprobadaId: string | null = null;
  let rResultado: any = null;
  let rHorasExtra100Despues: number | null = null;

  await scenario('8. recalculo: arma el escenario (empleado sin historial + 2 diagramas reales con francos distintos)', async () => {
    const prisma = await getPrisma();
    const empresaId = rrhh.user.empresaId;

    // Empleado real sin asignaciones de diagrama ni planillas previas: así el
    // historial que arma este escenario es el único que puede afectarlo (se
    // verifica con la propia base, no se asume).
    const empleado = await prisma.usuario.findFirst({
      where: {
        empresaId, activo: true,
        id: { notIn: [rrhh.user.id, ope.user.id] },
        diagramas: { none: {} },
        planillas: { none: {} },
      },
    });
    if (!empleado) { info('no hay ningún empleado sin diagramas/planillas previas: escenario no aplicable'); return; }

    // Dos diagramas reales: uno ROTATIVO (para tener francos previsibles por
    // ciclo) y uno FIJO_SEMANA, activos en la empresa.
    const diagramaNuevo = await prisma.diagrama.findFirst({
      where: { empresaId, activo: true, tipo: 'ROTATIVO', diasTrabajo: { gt: 0 }, diasDescanso: { gt: 0 } },
    });
    const diagramaViejo = await prisma.diagrama.findFirst({
      where: { empresaId, activo: true, tipo: 'FIJO_SEMANA', id: { not: diagramaNuevo?.id ?? '' } },
    });
    if (!diagramaNuevo || !diagramaViejo) { info('no hay un ROTATIVO y un FIJO_SEMANA activos para armar el contraste: no aplicable'); return; }

    const { esDiaFrancoSegunDiagrama } = await import('../../src/utils/contexto-dia.utils.js');
    const { diaAnterior } = await import('../../src/utils/diagrama-vigencia.utils.js');

    // Fechas lejanas (2028) para no chocar con datos reales del seed.
    const periodoInicio = new Date(Date.UTC(2028, 0, 1));
    const periodoFin = new Date(Date.UTC(2028, 0, 31));
    const corte = new Date(Date.UTC(2028, 0, 15)); // fecha efectiva del cambio de diagrama

    // Un día posterior al corte que sea LABORABLE en el diagrama viejo y
    // FRANCO en el nuevo: se calcula con las funciones reales (no se adivina),
    // recorriendo un ciclo completo del ROTATIVO desde la fecha del corte —el
    // mismo `fechaInicio` que va a tener la asignación nueva más abajo—.
    const ciclo = (diagramaNuevo.diasTrabajo as number) + (diagramaNuevo.diasDescanso as number);
    let diaDespues: Date | null = null;
    for (let offset = 1; offset <= ciclo; offset++) {
      const candidato = new Date(corte);
      candidato.setUTCDate(candidato.getUTCDate() + offset);
      if (candidato > periodoFin) break;
      const francoEnNuevo = esDiaFrancoSegunDiagrama(candidato, diagramaNuevo, corte);
      const francoEnViejo = esDiaFrancoSegunDiagrama(candidato, diagramaViejo, periodoInicio);
      if (francoEnNuevo && !francoEnViejo) { diaDespues = candidato; break; }
    }
    if (!diaDespues) { info('ningún día del ciclo combina laborable-viejo/franco-nuevo dentro del período: no aplicable'); return; }

    // Un día previo al corte, laborable en el diagrama viejo: control de que
    // el recálculo no lo toca.
    let diaAntes: Date | null = null;
    for (let offset = 1; offset <= 13; offset++) {
      const candidato = new Date(corte);
      candidato.setUTCDate(candidato.getUTCDate() - offset);
      if (candidato < periodoInicio) break;
      if (!esDiaFrancoSegunDiagrama(candidato, diagramaViejo, periodoInicio)) { diaAntes = candidato; break; }
    }
    if (!diaAntes) { info('no se encontró un día previo al corte laborable en el diagrama viejo: no aplicable'); return; }

    // Historial de diagramas: el viejo cierra el día antes de que abra el
    // nuevo, igual que hace la aprobación real (cierreDeAsignacion).
    const asigVieja = await prisma.usuarioDiagrama.create({
      data: { usuarioId: empleado.id, diagramaId: diagramaViejo.id, fechaInicio: periodoInicio, fechaFin: diaAnterior(corte), activo: false },
    });
    usuarioDiagramaRawCreados.push(asigVieja.id);
    const asigNueva = await prisma.usuarioDiagrama.create({
      data: { usuarioId: empleado.id, diagramaId: diagramaNuevo.id, fechaInicio: corte, fechaFin: null, activo: true },
    });
    usuarioDiagramaRawCreados.push(asigNueva.id);

    // Una planilla BORRADOR y otra ya APROBADA, las dos cubriendo el corte:
    // el recálculo tiene que tratarlas distinto (escenarios 9 vs. 10).
    const planillaBorrador = await prisma.planilla.create({
      data: { usuarioId: empleado.id, periodoInicio, periodoFin, estado: 'BORRADOR' },
    });
    planillasRawCreadas.push(planillaBorrador.id);
    const planillaAprobada = await prisma.planilla.create({
      data: { usuarioId: empleado.id, periodoInicio, periodoFin, estado: 'APROBADA' },
    });
    planillasRawCreadas.push(planillaAprobada.id);

    // Un día de 8hs "normales" (07:00–15:00 ART), como si se hubiera cargado
    // cuando sólo regía el diagrama viejo (que en ese momento no era franco).
    // Se escriben los campos ya calculados directamente por Prisma (no vía
    // calcularConContexto): lo que importa acá es el estado PREVIO al
    // recálculo, no cómo se hubiera llegado a él en producción.
    const jornada = (dia: Date) => ({
      entradaTurno1: new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 10, 0, 0)),
      salidaTurno1: new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 18, 0, 0)),
      lugarTrabajo: 'BASE' as const,
      esFrancoTrabajado: false,
      esFeriado: false,
      horasTrabajadas: 8,
      horasNormales: 8,
      horasExtra50: 0,
      horasExtra100: 0,
    });

    const regAntes = await prisma.registroHoras.create({
      data: { planillaId: planillaBorrador.id, fecha: diaAntes, ...jornada(diaAntes) },
    });
    const regDespuesBorrador = await prisma.registroHoras.create({
      data: { planillaId: planillaBorrador.id, fecha: diaDespues, ...jornada(diaDespues) },
    });
    const regDespuesAprobada = await prisma.registroHoras.create({
      data: { planillaId: planillaAprobada.id, fecha: diaDespues, ...jornada(diaDespues) },
    });

    const { recalcularDesde } = await import('../../src/utils/recalculo-diagrama.utils.js');
    rResultado = await recalcularDesde(empleado.id, empresaId, corte);

    rPlanillaBorradorId = planillaBorrador.id;
    rPlanillaAprobadaId = planillaAprobada.id;
    rRegistroAntesId = regAntes.id;
    rRegistroDespuesBorradorId = regDespuesBorrador.id;
    rRegistroDespuesAprobadaId = regDespuesAprobada.id;

    assert(!!rResultado, 'recalcularDesde no devolvió resultado');
  });

  await scenario('9. recalculo: BORRADOR — el día posterior al corte pasa a franco trabajado y al 100%', async () => {
    if (!rResultado) { info('escenario base no aplicable: se omite'); return; }
    const prisma = await getPrisma();
    const reg = await prisma.registroHoras.findUnique({ where: { id: rRegistroDespuesBorradorId! } });
    assert(!!reg, 'el registro posterior al corte (BORRADOR) desapareció');
    assert(reg.esFrancoTrabajado === true, `esFrancoTrabajado=${reg.esFrancoTrabajado}, esperaba true`);
    assert(Number(reg.horasNormales) === 0, `horasNormales=${reg.horasNormales}, esperaba 0 (todo se mueve al 100%)`);
    assert(Number(reg.horasExtra50) === 0, `horasExtra50=${reg.horasExtra50}, esperaba 0`);
    assert(Number(reg.horasExtra100) === Number(reg.horasTrabajadas), `horasExtra100=${reg.horasExtra100} debería igualar horasTrabajadas=${reg.horasTrabajadas}`);
    assert(Number(reg.horasExtra100) > 0, 'horasExtra100 debería ser mayor a 0');
    rHorasExtra100Despues = Number(reg.horasExtra100);

    assert(rResultado.diasRecalculados === 1, `diasRecalculados=${rResultado.diasRecalculados}, esperaba 1 (sólo el día posterior al corte de la BORRADOR)`);
  });

  await scenario('10. recalculo: APROBADA — el mismo día queda intacto y aparece en planillasCongeladas', async () => {
    if (!rResultado) { info('escenario base no aplicable: se omite'); return; }
    const prisma = await getPrisma();
    const reg = await prisma.registroHoras.findUnique({ where: { id: rRegistroDespuesAprobadaId! } });
    assert(!!reg, 'el registro posterior al corte (APROBADA) desapareció');
    assert(reg.esFrancoTrabajado === false, `esFrancoTrabajado=${reg.esFrancoTrabajado}, esperaba false (una planilla APROBADA no se toca)`);
    assert(Number(reg.horasNormales) === 8, `horasNormales=${reg.horasNormales}, esperaba 8 (sin recalcular)`);
    assert(Number(reg.horasExtra100) === 0, `horasExtra100=${reg.horasExtra100}, esperaba 0 (sin recalcular)`);

    const congelada = (rResultado.planillasCongeladas as any[]).find((p) => p.planillaId === rPlanillaAprobadaId);
    assert(!!congelada, `la planilla APROBADA (${rPlanillaAprobadaId}) no aparece en planillasCongeladas: ${JSON.stringify(rResultado.planillasCongeladas)}`);
    assert(congelada.estado === 'APROBADA', `estado en planillasCongeladas=${congelada.estado}`);
    assert(congelada.dias === 1, `dias en planillasCongeladas=${congelada.dias}, esperaba 1`);
  });

  await scenario('11. recalculo: los totales de la planilla BORRADOR se actualizaron', async () => {
    if (!rResultado) { info('escenario base no aplicable: se omite'); return; }
    const prisma = await getPrisma();
    const planilla = await prisma.planilla.findUnique({ where: { id: rPlanillaBorradorId! } });
    assert(!!planilla, 'la planilla BORRADOR desapareció');
    assert(Number(planilla.totalHorasNormales) === 8, `totalHorasNormales=${planilla.totalHorasNormales}, esperaba 8 (sólo el día anterior al corte, sin tocar)`);
    assert(Number(planilla.totalHorasExtra50) === 0, `totalHorasExtra50=${planilla.totalHorasExtra50}, esperaba 0`);
    assert(rHorasExtra100Despues !== null, 'el escenario 9 no dejó horasExtra100Despues (¿corrió antes que éste?)');
    assert(Number(planilla.totalHorasExtra100) === rHorasExtra100Despues, `totalHorasExtra100=${planilla.totalHorasExtra100}, esperaba ${rHorasExtra100Despues} (el día recalculado)`);
  });

  await scenario('12. recalculo: un día anterior al corte no se toca', async () => {
    if (!rResultado) { info('escenario base no aplicable: se omite'); return; }
    const prisma = await getPrisma();
    const reg = await prisma.registroHoras.findUnique({ where: { id: rRegistroAntesId! } });
    assert(!!reg, 'el registro anterior al corte desapareció');
    assert(reg.esFrancoTrabajado === false, `esFrancoTrabajado=${reg.esFrancoTrabajado}, esperaba false (no se toca)`);
    assert(Number(reg.horasNormales) === 8, `horasNormales=${reg.horasNormales}, esperaba 8 (valor original, sin recalcular)`);
    assert(Number(reg.horasExtra100) === 0, `horasExtra100=${reg.horasExtra100}, esperaba 0 (sin recalcular)`);
  });

  // ═══ Limpieza ═══
  console.log(col('DIM', '\nCleaning up...'));
  for (const fn of cleanupQueue.reverse()) { await fn().catch(() => {}); }

  // Verificación final: que no haya quedado nada de lo creado por esta suite.
  await scenario('13. limpieza: no quedó nada de lo creado por esta suite', async () => {
    for (const id of solicitudesCreadas) {
      const { status } = await get(`/cambios-diagrama/${id}`, rrhh.token);
      assert(status === 404, `la solicitud HTTP ${id} debía haberse borrado (HTTP ${status})`);
    }
    for (const id of planillasCreadas) {
      const { status } = await get(`/planillas/${id}`, ope.token);
      assert(status === 404, `la planilla ${id} debía haberse borrado (HTTP ${status})`);
    }
    if (rawPrisma) {
      const solRestantes = await rawPrisma.solicitudCambioDiagrama.findMany({ where: { id: { in: solicitudesRawCreadas } } });
      assert(solRestantes.length === 0, `quedaron ${solRestantes.length} solicitudes creadas por Prisma sin borrar`);
      const notifRestantes = await rawPrisma.notificacion.findMany({ where: { id: { in: notifsRawCreadas } } });
      assert(notifRestantes.length === 0, `quedaron ${notifRestantes.length} notificaciones sin borrar`);
      const asigRestantes = await rawPrisma.usuarioDiagrama.findMany({ where: { id: { in: usuarioDiagramaRawCreados } } });
      assert(asigRestantes.length === 0, `quedaron ${asigRestantes.length} asignaciones de diagrama sin borrar`);
      // Las planillas del escenario de recálculo (8-12) se borran por id directo
      // (no vía HTTP, se armaron con Prisma): los registros cuelgan de ellas con
      // onDelete: Cascade, así que basta con verificar la planilla.
      const planillasRestantes = await rawPrisma.planilla.findMany({ where: { id: { in: planillasRawCreadas } } });
      assert(planillasRestantes.length === 0, `quedaron ${planillasRestantes.length} planillas del escenario de recálculo sin borrar`);
    }
  });

  if (rawPrisma) await rawPrisma.$disconnect();

  // ── Resumen ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(col('CYAN', `\n═══ RESULTS: ${passed}/${results.length} passed, ${failed} failed ═══`));
  if (failed) { console.log(col('YELLOW', 'Failed:')); results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`)); }
  console.log('\n__RESULT_JSON__' + JSON.stringify({ passed, failed, total: results.length }));

  // Los módulos de src/ importados dinámicamente (cambios-diagrama.service.ts,
  // contexto-dia.utils.ts) abren su propio PrismaClient a nivel de módulo y no
  // lo desconectan: sin este exit explícito el proceso se queda colgado
  // esperando que esas conexiones se cierren solas.
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
