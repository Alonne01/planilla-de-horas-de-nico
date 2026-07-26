/**
 * Verificación integral de los circuitos de aprobación — Task 15 del plan
 * docs/superpowers/plans/2026-07-25-circuitos-aprobacion.md.
 *
 * Requiere el servidor en :4000 (cd apps/api && npm run dev) y la base con los
 * usuarios de prueba de prisma/crear-usuarios-prueba.ts.
 *
 * Correr: cd apps/api && npx tsx tests/circuito-integracion.qa.ts
 *
 * ── QUÉ CADENA Y QUÉ SECTOR SE USAN ─────────────────────────────────────────
 * El seed NO trae la cadena del spec (Supervisor → Coordinador → Gerente →
 * RRHH): sus flujos de PLANILLA llegan a tres pasos y ninguno incluye GERENTE.
 * Así que esta suite crea el flujo de cuatro pasos y lo asigna al sector
 * **Testing**, después de desasignar el flujo de PLANILLA que ese sector ya
 * tenía. El `finally` borra lo creado y restaura la asignación original CON SU
 * ID, para que la configuración quede exactamente como estaba.
 *
 * Los conteos esperados salen de esa cadena y de los niveles de `roles_config`
 * (RRHH 90, GERENTE 80, COORDINADOR 70, SUPERVISOR 60, OPERADOR 10):
 *   op1.testing    (10) → 4 pasos: SUPERVISOR → COORDINADOR → GERENTE → RRHH
 *   coord1.testing (70) → 2 pasos: GERENTE → RRHH
 *   rrhh1          (90) → 1 paso:  RRHH (la garantía del último paso)
 *
 * `rrhh1` es transversal (sin sector), así que la asignación por sector no lo
 * alcanza: se le crea una asignación POR USUARIO del mismo flujo, que es lo que
 * `resolverFlujo` mira primero.
 *
 * Para el escenario 8 (documento sin circuito) se desasigna temporalmente el
 * flujo de PLANILLA del sector **Almacén**, porque en esta base los nueve
 * sectores tienen flujo de PLANILLA asignado y no hay ninguno "sin circuito"
 * disponible. También se restaura al final.
 *
 * ── DEFECTO CONOCIDO QUE ESTA SUITE DEJA A LA VISTA ─────────────────────────
 * El escenario 7b (la bandeja del gerente) FALLA hoy y no es un problema de la
 * verificación: NINGÚN usuario con rol GERENTE tiene sector (el seed y
 * crear-usuarios-prueba los crean transversales, igual que RRHH), pero
 * `isResponsibleApprover` le exige al GERENTE compartir sector con el dueño del
 * documento (utils/approval-auth.utils.ts) y `getFlowVisibleUserIds` no le deja
 * ver a nadie fuera de su sector (utils/visibility.utils.ts). Con eso, un paso
 * GERENTE en la cadena no lo puede firmar ningún gerente: sólo el ADMIN por su
 * escape hatch. Está reportado; no se toca acá.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const BASE = 'http://localhost:4000/api/v1';
const TS = Date.now();
const prisma = new PrismaClient();

// Días de un pasado lejano, uno por planilla: una planilla por día evita el
// choque de períodos superpuestos del POST /planillas y deja el bucle
// día-por-día de /enviar en una sola iteración.
const DIA_OP1 = '2019-03-11';
const DIA_COORD1 = '2019-03-12';
const DIA_RRHH1 = '2019-03-13';
const DIA_CONGELADO = '2019-03-14';
const DIA_SIN_SNAPSHOT = '2019-03-15';
const DIA_SIN_CIRCUITO = '2019-03-16';

// ── salida ──────────────────────────────────────────────────────────────────
type Resultado = { nombre: string; ok: boolean; detalle: string };
const resultados: Resultado[] = [];

function log(sym: string, msg: string) { process.stdout.write(`  ${sym} ${msg}\n`); }

async function escenario(nombre: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    resultados.push({ nombre, ok: true, detalle: 'OK' });
    log('✅', `${nombre}  (${Date.now() - t0}ms)`);
  } catch (e: unknown) {
    const detalle = e instanceof Error ? e.message : String(e);
    resultados.push({ nombre, ok: false, detalle });
    log('❌', `${nombre}  — ${detalle}`);
  }
}

function assert(c: boolean, m: string): asserts c { if (!c) throw new Error(m); }
function assertStatus(actual: number, esperado: number, ctx = '') {
  if (actual !== esperado) throw new Error(`se esperaba HTTP ${esperado}, llegó ${actual}${ctx ? ` — ${ctx}` : ''}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}
const get = (p: string, tok?: string) => api('GET', p, { token: tok });
const post = (p: string, b: unknown, tok?: string) => api('POST', p, { token: tok, body: b });
const put = (p: string, b: unknown, tok?: string) => api('PUT', p, { token: tok, body: b });

// ── sesiones ────────────────────────────────────────────────────────────────
interface Sesion { email: string; token: string; id: string; rol: string; nivel: number }

const PASS_PRUEBA = 'Prueba2026!';

async function login(email: string, password: string): Promise<Sesion> {
  const r = await post('/auth/login', { email, password });
  assertStatus(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return { email, token: r.body.accessToken as string, id: r.body.user.id, rol: r.body.user.rol, nivel: r.body.user.rolNivel };
}

// ── helpers de dominio ──────────────────────────────────────────────────────
const planillasCreadas: string[] = [];

/** Planilla de un solo día, con su registro cargado: lista para enviarse. */
async function crearPlanillaCompleta(sesion: Sesion, dia: string): Promise<string> {
  const cre = await post('/planillas', {
    periodoInicio: `${dia}T00:00:00.000Z`, periodoFin: `${dia}T00:00:00.000Z`,
  }, sesion.token);
  assertStatus(cre.status, 201, `crear planilla de ${sesion.email}: ${JSON.stringify(cre.body)}`);
  planillasCreadas.push(cre.body.id);
  const reg = await post(`/planillas/${cre.body.id}/registros`, {
    fecha: `${dia}T00:00:00.000Z`,
    entradaTurno1: `${dia}T08:00:00.000Z`,
    salidaTurno1: `${dia}T16:00:00.000Z`,
    lugarTrabajo: 'BASE',
  }, sesion.token);
  assertStatus(reg.status, 201, `crear registro de ${sesion.email}: ${JSON.stringify(reg.body)}`);
  return cre.body.id as string;
}

const rolesDe = (snapshot: any): string[] =>
  Array.isArray(snapshot) ? snapshot.map((p: any) => p.rolAprobador) : [];
const ordenesDe = (snapshot: any): number[] =>
  Array.isArray(snapshot) ? snapshot.map((p: any) => p.orden) : [];

/** Los ids de las planillas pendientes que devuelve la bandeja de aprobaciones. */
async function pendientesDe(sesion: Sesion): Promise<string[]> {
  const r = await get('/aprobaciones', sesion.token);
  assertStatus(r.status, 200, `GET /aprobaciones de ${sesion.email}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return (r.body.planillasPendientes as any[]).map((p) => p.id);
}

/** Un paso del flujo tal como lo pide POST/PUT /admin/flujos. */
const paso = (orden: number, nombrePaso: string, rolAprobador: string) => ({
  orden, nombrePaso, rolAprobador, requiereComentarioRechazo: true, notificarRoles: [] as string[],
});

const CADENA_4 = [
  paso(1, 'Revisión Supervisor', 'SUPERVISOR'),
  paso(2, 'Aprobación Coordinador', 'COORDINADOR'),
  paso(3, 'Visto Gerencia', 'GERENTE'),
  paso(4, 'Cierre RRHH', 'RRHH'),
];

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n=== Circuitos de aprobación — verificación integral (ts=${TS}) ===\n`);

  // ── sesiones ──────────────────────────────────────────────────────────────
  const admin = await login('admin@wenlen.com', process.env.SEED_ADMIN_PASSWORD ?? 'Admin2026!');
  const op1 = await login('op1.testing@test.wenlen.com', PASS_PRUEBA);
  const op2 = await login('op2.testing@test.wenlen.com', PASS_PRUEBA);
  const sup1 = await login('sup1.testing@test.wenlen.com', PASS_PRUEBA);
  const sup2 = await login('sup2.testing@test.wenlen.com', PASS_PRUEBA);
  const coord1 = await login('coord1.testing@test.wenlen.com', PASS_PRUEBA);
  const gerente1 = await login('gerente1@test.wenlen.com', PASS_PRUEBA);
  const rrhh1 = await login('rrhh1@test.wenlen.com', PASS_PRUEBA);
  const opAlmacen = await login('op1.almacen@test.wenlen.com', PASS_PRUEBA);
  const supAlmacen = await login('sup1.almacen@test.wenlen.com', PASS_PRUEBA);

  // Los niveles se leen de la base, no se asumen: los escenarios dependen de
  // ellos y `roles_config` es editable desde el panel de administración.
  const niveles = Object.fromEntries(
    (await prisma.rolConfig.findMany({ where: { activo: true }, select: { codigo: true, nivel: true } }))
      .map((r) => [r.codigo, r.nivel]),
  );
  console.log(`  niveles: ${JSON.stringify(niveles)}`);

  const sectorTesting = await prisma.sector.findFirst({ where: { nombre: 'Testing' } });
  const sectorAlmacen = await prisma.sector.findFirst({ where: { nombre: 'Almacén' } });
  assert(!!sectorTesting && !!sectorAlmacen, 'faltan los sectores Testing y/o Almacén en la base');

  // ── lo que hay que restaurar sí o sí ─────────────────────────────────────
  const asignacionesRestaurar: Prisma.FlujoAsignacionUncheckedCreateInput[] = [];
  const flujosCreados: string[] = [];
  const asignacionesCreadas: string[] = [];

  /** Saca la asignación de PLANILLA de un sector y la anota para restaurarla. */
  async function liberarSector(sectorId: string, nombre: string) {
    const previa = await prisma.flujoAsignacion.findFirst({
      where: { tipoDocumento: 'PLANILLA', sectorId },
    });
    if (!previa) { console.log(`  (${nombre} no tenía flujo de PLANILLA)`); return; }
    asignacionesRestaurar.push(previa);
    await prisma.flujoAsignacion.delete({ where: { id: previa.id } });
    console.log(`  ${nombre}: desasignado el flujo ${previa.flujoId.slice(-6)} (se restaura al final)`);
  }

  try {
    // ── preparación ────────────────────────────────────────────────────────
    // Restos de una corrida anterior que se haya cortado antes del finally: se
    // acota a los seis usuarios y a los seis días de esta suite.
    const idsDueños = [op1.id, op2.id, coord1.id, rrhh1.id, opAlmacen.id];
    const borradas = await prisma.planilla.deleteMany({
      where: {
        usuarioId: { in: idsDueños },
        periodoInicio: { gte: new Date('2019-03-11T00:00:00.000Z'), lte: new Date('2019-03-16T00:00:00.000Z') },
      },
    });
    if (borradas.count > 0) console.log(`  limpieza previa: ${borradas.count} planilla(s) de una corrida anterior`);

    await liberarSector(sectorTesting.id, 'Testing');
    await liberarSector(sectorAlmacen.id, 'Almacén');

    const nuevoFlujo = await post('/admin/flujos', {
      nombre: `QA circuito 4 pasos ${TS}`,
      tipoDocumento: 'PLANILLA',
      descripcion: 'Cadena del spec para la verificación integral',
      pasos: CADENA_4,
    }, admin.token);
    assertStatus(nuevoFlujo.status, 201, `crear flujo: ${JSON.stringify(nuevoFlujo.body)}`);
    const flujoId = nuevoFlujo.body.id as string;
    const flujoNombre = nuevoFlujo.body.nombre as string;
    flujosCreados.push(flujoId);

    const asigSector = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'PLANILLA', sectorId: sectorTesting.id,
    }, admin.token);
    assertStatus(asigSector.status, 201, `asignar a Testing: ${JSON.stringify(asigSector.body)}`);
    asignacionesCreadas.push(asigSector.body.id);

    // rrhh1 no tiene sector: sin una asignación por usuario no le resolvería
    // ningún flujo y el escenario 3 mediría otra cosa (un circuito vacío).
    const asigRrhh = await post('/admin/flujos/asignaciones', {
      flujoId, tipoDocumento: 'PLANILLA', usuarioId: rrhh1.id,
    }, admin.token);
    assertStatus(asigRrhh.status, 201, `asignar a rrhh1: ${JSON.stringify(asigRrhh.body)}`);
    asignacionesCreadas.push(asigRrhh.body.id);

    console.log(`  flujo "${flujoNombre}" creado y asignado a Testing + rrhh1\n`);

    // ── 1. un OPERADOR recorre la cadena entera ────────────────────────────
    let planillaOp1 = '';
    await escenario('1. op1.testing (OPERADOR) → snapshot con los 4 roles, orden 1..4', async () => {
      planillaOp1 = await crearPlanillaCompleta(op1, DIA_OP1);
      const env = await post(`/planillas/${planillaOp1}/enviar`, {}, op1.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));
      assert(env.body.estado === 'ENVIADA', `estado=${env.body.estado}`);
      assert(env.body.pasoActual === 1, `pasoActual=${env.body.pasoActual}`);
      const roles = rolesDe(env.body.circuitoSnapshot);
      assert(
        JSON.stringify(roles) === JSON.stringify(['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH']),
        `circuito=${JSON.stringify(roles)}`,
      );
      assert(JSON.stringify(ordenesDe(env.body.circuitoSnapshot)) === JSON.stringify([1, 2, 3, 4]),
        `ordenes=${JSON.stringify(ordenesDe(env.body.circuitoSnapshot))}`);
      assert(env.body.avisoSinCircuito === undefined, 'no debería avisar "sin circuito" con 4 pasos');
    });

    // ── 2. un COORDINADOR se saltea supervisor y coordinador ───────────────
    let planillaCoord1 = '';
    await escenario("2. coord1.testing (COORDINADOR) → snapshot ['GERENTE', 'RRHH']", async () => {
      planillaCoord1 = await crearPlanillaCompleta(coord1, DIA_COORD1);
      const env = await post(`/planillas/${planillaCoord1}/enviar`, {}, coord1.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));
      const roles = rolesDe(env.body.circuitoSnapshot);
      assert(JSON.stringify(roles) === JSON.stringify(['GERENTE', 'RRHH']), `circuito=${JSON.stringify(roles)}`);
      assert(JSON.stringify(ordenesDe(env.body.circuitoSnapshot)) === JSON.stringify([1, 2]),
        'el circuito tiene que quedar renumerado desde 1');
    });

    // ── 3. RRHH conserva el último paso y no puede firmarlo ────────────────
    let planillaRrhh1 = '';
    await escenario('3. rrhh1 (RRHH) → 1 paso y 403 al intentar aprobarse a sí mismo', async () => {
      planillaRrhh1 = await crearPlanillaCompleta(rrhh1, DIA_RRHH1);
      const env = await post(`/planillas/${planillaRrhh1}/enviar`, {}, rrhh1.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));
      const roles = rolesDe(env.body.circuitoSnapshot);
      assert(JSON.stringify(roles) === JSON.stringify(['RRHH']),
        `la garantía del último paso tiene que dejar exactamente ['RRHH'], quedó ${JSON.stringify(roles)}`);

      const propio = await post(`/planillas/${planillaRrhh1}/avanzar`, { comentario: 'me apruebo yo' }, rrhh1.token);
      assertStatus(propio.status, 403, `nadie firma lo suyo: ${JSON.stringify(propio.body)}`);
    });

    // ── 4. el circuito queda congelado aunque se edite el flujo ────────────
    let planillaCongelada = '';
    await escenario('4. editar el flujo NO altera el snapshot de lo que ya está en vuelo', async () => {
      planillaCongelada = await crearPlanillaCompleta(op2, DIA_CONGELADO);
      const env = await post(`/planillas/${planillaCongelada}/enviar`, {}, op2.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));
      assert(rolesDe(env.body.circuitoSnapshot).length === 4, 'la planilla tenía que salir con 4 pasos');

      // Se saca el paso de GERENTE de la configuración viva.
      const sinGerente = await put(`/admin/flujos/${flujoId}`, {
        pasos: [paso(1, 'Revisión Supervisor', 'SUPERVISOR'), paso(2, 'Aprobación Coordinador', 'COORDINADOR'), paso(3, 'Cierre RRHH', 'RRHH')],
      }, admin.token);
      assertStatus(sinGerente.status, 200, JSON.stringify(sinGerente.body));
      assert(sinGerente.body.pasos.length === 3, `el flujo vivo quedó con ${sinGerente.body.pasos.length} pasos`);

      const despues = await get(`/planillas/${planillaCongelada}`, op2.token);
      assertStatus(despues.status, 200, JSON.stringify(despues.body));
      const roles = rolesDe(despues.body.circuitoSnapshot);
      assert(
        JSON.stringify(roles) === JSON.stringify(['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH']),
        `el snapshot congelado se contaminó con la edición: ${JSON.stringify(roles)}`,
      );

      // Se devuelve la cadena de 4 pasos: los escenarios que siguen leen el
      // flujo vivo (el 6 justamente por el fallback sin snapshot).
      const restaurado = await put(`/admin/flujos/${flujoId}`, { pasos: CADENA_4 }, admin.token);
      assertStatus(restaurado.status, 200, `no se pudo restaurar la cadena: ${JSON.stringify(restaurado.body)}`);
    });

    // ── 5. un solo flujo de PLANILLA por sector ────────────────────────────
    await escenario('5. segundo flujo PLANILLA al mismo sector → 409 nombrando al que lo ocupa', async () => {
      const otro = await post('/admin/flujos', {
        nombre: `QA circuito rival ${TS}`,
        tipoDocumento: 'PLANILLA',
        pasos: [paso(1, 'Cierre RRHH', 'RRHH')],
      }, admin.token);
      assertStatus(otro.status, 201, JSON.stringify(otro.body));
      flujosCreados.push(otro.body.id);

      const choque = await post('/admin/flujos/asignaciones', {
        flujoId: otro.body.id, tipoDocumento: 'PLANILLA', sectorId: sectorTesting.id,
      }, admin.token);
      if (choque.status === 201) asignacionesCreadas.push(choque.body.id);
      assertStatus(choque.status, 409, JSON.stringify(choque.body));
      assert(typeof choque.body.error === 'string' && choque.body.error.includes(flujoNombre),
        `el 409 tiene que nombrar al flujo que ocupa el alcance ("${flujoNombre}"), dijo: ${choque.body.error}`);
    });

    // ── 6. fallback de los documentos anteriores al snapshot ───────────────
    await escenario('6. circuitoSnapshot NULL → sigue avanzando con el flujo vivo, sin 500', async () => {
      const planilla = await crearPlanillaCompleta(op2, DIA_SIN_SNAPSHOT);
      const env = await post(`/planillas/${planilla}/enviar`, {}, op2.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));

      // Así se ven las planillas que ya estaban en vuelo cuando se desplegó el
      // circuito congelado: la columna nunca se escribió.
      await prisma.planilla.update({ where: { id: planilla }, data: { circuitoSnapshot: Prisma.DbNull } });
      const sinSnapshot = await get(`/planillas/${planilla}`, op2.token);
      assert(sinSnapshot.body.circuitoSnapshot === null, 'el snapshot tenía que quedar en NULL para esta prueba');

      // La bandeja también tiene que caer al flujo vivo, no esconder el documento.
      assert((await pendientesDe(sup2)).includes(planilla),
        'sin snapshot, la bandeja del supervisor tiene que caer a los pasos vivos del flujo');

      const avance = await post(`/planillas/${planilla}/avanzar`, { comentario: 'QA fallback' }, sup2.token);
      assertStatus(avance.status, 200, `el fallback sin snapshot rompió: ${JSON.stringify(avance.body)}`);
      assert(avance.body.pasoActual === 2, `pasoActual=${avance.body.pasoActual}`);
      assert(avance.body.estado === 'EN_REVISION', `estado=${avance.body.estado}`);
    });

    // ── 7. la bandeja coincide con lo que se puede aprobar ─────────────────
    await escenario('7a. la planilla del coordinador NO aparece en la bandeja del supervisor', async () => {
      assert(planillaCoord1 !== '', 'depende del escenario 2, que no llegó a enviar la planilla');
      const pendientesSup = await pendientesDe(sup1);
      // Control positivo: la bandeja de sup1 sí trae lo que le toca. Sin esto,
      // una bandeja vacía por cualquier motivo haría pasar la prueba.
      assert(pendientesSup.includes(planillaOp1),
        'la planilla del operador tendría que estar en la bandeja de su supervisor');
      assert(!pendientesSup.includes(planillaCoord1),
        'el circuito del coordinador saltea el paso de supervisor: sup1 NO puede tener esa planilla en la bandeja');
    });

    await escenario('7b. la planilla del coordinador SÍ aparece en la bandeja del gerente', async () => {
      assert(planillaCoord1 !== '', 'depende del escenario 2, que no llegó a enviar la planilla');
      const pendientesGer = await pendientesDe(gerente1);
      if (!pendientesGer.includes(planillaCoord1)) {
        // Diagnóstico: se prueba también el avance, que es la otra mitad del
        // mismo criterio (la bandeja tiene que decir lo mismo que /avanzar).
        const intento = await post(`/planillas/${planillaCoord1}/avanzar`, { comentario: 'QA gerente' }, gerente1.token);
        const gerenteEnBase = await prisma.usuario.findUnique({ where: { id: gerente1.id }, select: { sectorId: true } });
        throw new Error(
          `el gerente no ve la planilla que le toca (paso 1 = GERENTE). ` +
          `POST /avanzar como gerente1 → ${intento.status} ${JSON.stringify(intento.body)}. ` +
          `gerente1.sectorId=${gerenteEnBase?.sectorId ?? 'null'} — con sector nulo ` +
          `isResponsibleApprover (approval-auth.utils.ts) nunca da true para un paso GERENTE ` +
          `y getFlowVisibleUserIds (visibility.utils.ts) no le hace visible a nadie`,
        );
      }
    });

    // ── 8. un documento sin circuito cae en la bandeja de RRHH ─────────────
    await escenario('8. sin flujo asignado → avisoSinCircuito y sólo RRHH lo ve', async () => {
      const planilla = await crearPlanillaCompleta(opAlmacen, DIA_SIN_CIRCUITO);
      const env = await post(`/planillas/${planilla}/enviar`, {}, opAlmacen.token);
      assertStatus(env.status, 200, JSON.stringify(env.body));
      assert(typeof env.body.avisoSinCircuito === 'string' && env.body.avisoSinCircuito.length > 0,
        'al enviar sin circuito el API tiene que avisarlo en la respuesta');
      assert(rolesDe(env.body.circuitoSnapshot).length === 0, 'el circuito tenía que salir vacío');

      assert((await pendientesDe(rrhh1)).includes(planilla),
        'un documento sin circuito lo aprueba RRHH: tiene que estar en su bandeja');
      assert(!(await pendientesDe(supAlmacen)).includes(planilla),
        'un supervisor no puede aprobar sin circuito, así que tampoco puede verlo pendiente');
    });

    // ── 9. el historial guarda el paso FIRMADO y su rol ────────────────────
    await escenario('9. el historial anota el paso firmado (no el destino) y el rol del paso', async () => {
      assert(planillaOp1 !== '', 'depende del escenario 1');
      const avance = await post(`/planillas/${planillaOp1}/avanzar`, { comentario: 'QA historial' }, sup1.token);
      assertStatus(avance.status, 200, JSON.stringify(avance.body));
      assert(avance.body.pasoActual === 2, `pasoActual=${avance.body.pasoActual}`);

      const hist = await get(`/planillas/${planillaOp1}/historial`, sup1.token);
      assertStatus(hist.status, 200, JSON.stringify(hist.body));
      const firma = (hist.body as any[]).filter((h) => h.estadoNuevo === 'EN_REVISION').at(-1);
      assert(!!firma, `no quedó fila de historial de la aprobación: ${JSON.stringify(hist.body)}`);
      assert(firma.pasoFlujo === 1,
        `el historial tiene que anotar el paso FIRMADO (1), anotó ${firma.pasoFlujo}`);
      assert(firma.rolAprobador === 'SUPERVISOR',
        `el rol del paso firmado tiene que ser SUPERVISOR, quedó ${firma.rolAprobador}`);
    });
  } finally {
    // ── limpieza: todo lo creado se borra y lo desasignado se restaura ──────
    console.log('\n── limpieza ──');
    let errores = 0;
    const intentar = async (que: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { errores++; log('⚠', `${que}: ${e instanceof Error ? e.message : String(e)}`); }
    };

    // Las notificaciones que dispararon los envíos apuntan por link, sin FK.
    await intentar('notificaciones', () => prisma.notificacion.deleteMany({
      where: { link: { in: planillasCreadas.map((id) => `/planillas/${id}`) } },
    }));
    // Registros e historial se van en cascada con la planilla.
    await intentar('planillas', () => prisma.planilla.deleteMany({ where: { id: { in: planillasCreadas } } }));
    await intentar('asignaciones creadas', () => prisma.flujoAsignacion.deleteMany({ where: { id: { in: asignacionesCreadas } } }));
    await intentar('pasos de los flujos creados', () => prisma.flujoPaso.deleteMany({ where: { flujoId: { in: flujosCreados } } }));
    await intentar('flujos creados', () => prisma.flujoAprobacion.deleteMany({ where: { id: { in: flujosCreados } } }));
    // Va último: el índice único (tipoDocumento, sectorId) exige que el lugar
    // esté libre, y lo libera el borrado de las asignaciones de arriba.
    for (const a of asignacionesRestaurar) {
      await intentar(`restaurar asignación ${a.id}`, () => prisma.flujoAsignacion.create({ data: a }));
    }
    log('ℹ', `limpieza: ${planillasCreadas.length} planilla(s), ${flujosCreados.length} flujo(s), ${asignacionesCreadas.length} asignación(es) creadas; ${asignacionesRestaurar.length} restaurada(s)${errores ? `; ${errores} problema(s)` : ''}`);

    await prisma.$disconnect();

    const ok = resultados.filter((r) => r.ok).length;
    console.log(`\n=== RESULTADO: ${ok}/${resultados.length} escenarios OK ===`);
    for (const r of resultados.filter((x) => !x.ok)) console.log(`  FALLA: ${r.nombre} — ${r.detalle}`);
    if (ok !== resultados.length) process.exitCode = 1;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
