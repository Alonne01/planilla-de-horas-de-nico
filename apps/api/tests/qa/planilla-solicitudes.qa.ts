/**
 * QA Suite — SOLICITUDES EN LA PLANILLA (KEY=planilla-solicitudes)
 *
 * Cubre cuatro cosas:
 *  1. `solicitudesPendientes` en GET /planillas/:id (las ausencias/vacaciones sin
 *     firmar que tocan el período) y el aviso de días faltantes al enviar, que
 *     distingue los huecos que ya tienen un pedido en curso.
 *  2. Qué pasa cuando el pedido se APRUEBA: pisa las horas cargadas si la
 *     planilla es editable, y avisa.
 *  3. Que la salida que ese aviso recomienda existe de verdad: con la planilla
 *     ya enviada la aprobación se saltea, y RECHAZARLA repone el día bloqueado
 *     sin tener que borrar la planilla (escenario 8b).
 *  4. Que borrar y recrear la planilla repone los días ya aprobados.
 *
 * ─── Banco de pruebas propio y descartable ───────────────────────────────────
 *
 * Varios escenarios necesitan llevar una FALTA_JUSTIFICADA hasta APROBADA, y una
 * ausencia aprobada NO se puede deshacer por la API: `DELETE /ausencias/:id`
 * responde 400 ("No se puede eliminar una ausencia aprobada") sin importar el
 * rol, `POST /ausencias/:id/revocar` sólo acepta FRANCO_COMPENSATORIO, y la
 * cancelación del dueño exige que nadie haya firmado todavía. O sea: cada
 * escenario de aprobación quema un día del calendario de quien lo corre, para
 * siempre. Una versión anterior de esta suite trabajaba sobre un operador de demo
 * y su período corriente, y a las quince corridas se quedó sin días libres.
 *
 * Por eso la suite arma su propio banco en cada corrida, siguiendo el patrón que
 * ya usan cancelaciones.qa.ts, marca-manual.qa.ts y el test bed de audit.qa.ts:
 *
 *   · RRHH da de alta un OPERADOR nuevo, con email irrepetible (`...${TS}...`),
 *     en el MISMO sector que el primer supervisor candidato. El sector no es
 *     decorativo: es lo que hace que `resolverFlujo` encuentre un circuito de
 *     AUSENCIA y que los pasos SUPERVISOR/COORDINADOR tengan quién los firme
 *     (con el dueño sin superior asignado, `isResponsibleApprover` cae en la
 *     regla de sector, así que sirve cualquiera del sector y no una persona).
 *   · Las planillas del banco viven en un año LEJANO (2070), fuera de todo dato
 *     real y de los períodos que usan las otras suites (audit: 2078 y 2080-2099,
 *     capacit: 2099). Ahí no hay feriados cargados y el usuario nuevo no tiene
 *     diagrama asignado, así que todos los días del período son laborables: la
 *     suite controla el calendario entero y no depende de nada heredado.
 *   · Al terminar se borran las dos planillas y se da de baja al usuario. Lo
 *     único que sobrevive es lo irreversible —las ausencias aprobadas—, colgado
 *     de un usuario inactivo y fechado en 2070.
 *
 * Consecuencia: la corrida número cincuenta hace exactamente lo mismo que la
 * primera, porque el banco nace vacío cada vez. Y nada de esto toca a los
 * usuarios de demo: los aprobadores sólo firman, no son dueños de nada.
 *
 * Run: cd apps/api && npx tsx tests/qa/planilla-solicitudes.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que está en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';
const KEY = 'planilla-solicitudes';
const TS = Date.now();

/**
 * El período del banco. 2070 no es caprichoso: la tabla de feriados no pasa de
 * 2027, así que todos los días del rango cuentan como laborables y el validador
 * de envío los reclama a todos. Doce días alcanzan de sobra para los tres que se
 * piden más el borde.
 */
const P_INICIO = '2070-03-02';
const P_FIN = '2070-03-13';
/** La planilla suelta de UN día del escenario 8, en un período que no se solapa. */
const DIA_SUELTO = '2070-01-15';

let fallos = 0;
let pasados = 0;
function check(cond: boolean, msg: string) {
  if (cond) { pasados++; console.log(`  PASS ${msg}`); }
  else { fallos++; console.log(`  FAIL ${msg}`); }
}

/** Corta la corrida dejando el motivo escrito, pero SIEMPRE pasando por la limpieza. */
class Abortar extends Error {}
function abortar(motivo: string): never { throw new Abortar(motivo); }

/** Lo que hay que deshacer al final, corra bien o mal. Se ejecuta en orden inverso. */
const limpieza: Array<() => Promise<void>> = [];

interface Sesion {
  token: string;
  user: { id: string; rol: string; rolNivel: number; empresaId: string; sectorId: string | null };
}

async function login(email: string, password = 'Test1234!'): Promise<Sesion> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!data.accessToken) throw new Error(`login falló para ${email}: ${JSON.stringify(data)}`);
  return { token: data.accessToken as string, user: data.user };
}

function auth(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Los aprobadores que se prueban para firmar un paso, en orden.
 *
 * A propósito SIN el ADMIN: el admin es la escotilla de escape que aprueba
 * cualquier paso (ver `_isResponsibleApprover`), así que incluirlo haría pasar la
 * suite aunque el circuito estuviera mal armado. El admin aparece una sola vez en
 * todo el archivo, en la limpieza, porque `DELETE /usuarios/:id` pide nivel 100.
 *
 * El PRIMERO de la lista además define el sector del banco (ver `armarBanco`):
 * así el paso SUPERVISOR siempre tiene quién lo firme sin hardcodear ids ni
 * depender de cómo esté armada la línea de mando de la demo.
 */
const CANDIDATOS_APROBADORES = [
  'sup1.testing@test.wenlen.com',
  'sup2.testing@test.wenlen.com',
  'coord1.testing@test.wenlen.com',
  'coord2.testing@test.wenlen.com',
  'rrhh1@test.wenlen.com',
  'gerente1@test.wenlen.com',
];

const tokensCache = new Map<string, string>();
async function tokenDe(email: string): Promise<string> {
  const cached = tokensCache.get(email);
  if (cached) return cached;
  const s = await login(email);
  tokensCache.set(email, s.token);
  return s.token;
}

/** Clave de día de una fecha-día serializada por el backend: sale del STRING, nunca de un `Date`. */
function diaKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * El MISMO día calendario argentino que `clave`, pero mandado por el cable como
 * el INSTANTE de las 23:00 de ese día — o sea `D+1T02:00:00.000Z`.
 *
 * Por qué así y no `D T03:00:00.000Z` (la medianoche argentina, que es lo que usa
 * `isoDayAr()` en audit.qa.ts): mandar `03:00Z` no discrimina nada en esta suite.
 * Un handler que truncara en UTC lo dejaría igual en el día D, así que la
 * aserción pasaría con el código roto. La ventana `(00:00Z, 03:00Z)` es la única
 * en la que el día UTC y el día argentino DISCREPAN: `2070-03-14T02:00:00.000Z`
 * es el 14 en UTC pero las 23:00 del 13 en Argentina. Medirlo en UTC lo corre un
 * día hacia adelante — fuera del período de la planilla si D es el último día —
 * y la inyección no encuentra planilla que tocar.
 *
 * Es exactamente la forma que produce el front bajo TZ=AR cuando el usuario elige
 * el día D y algo le agrega la hora de la máquina en vez de la medianoche.
 */
function isoUltimaHoraAr(clave: string): string {
  const siguiente = new Date(`${clave}T00:00:00.000Z`);
  siguiente.setUTCDate(siguiente.getUTCDate() + 1);
  return `${siguiente.toISOString().slice(0, 10)}T02:00:00.000Z`;
}

/**
 * La clave 'YYYY-MM-DD' como la escribe `fmtFechaDia` en el cuerpo de las
 * notificaciones (D/M/YYYY). Se arma desde el STRING para no depender del huso
 * del proceso que corre la suite.
 */
function fmtDia(clave: string): string {
  const [anio, mes, dia] = clave.split('-');
  return `${Number(dia)}/${Number(mes)}/${anio}`;
}

/** Los ids de notificación que YA tenía alguien, para poder exigir una NUEVA después. */
async function idsNotificaciones(token: string): Promise<Set<string>> {
  const notifs = await (await fetch(`${BASE}/notificaciones`, { headers: auth(token) })).json();
  return new Set((Array.isArray(notifs) ? notifs : []).map((n: any) => n.id as string));
}

/**
 * ¿Apareció una notificación NUEVA con este título y este día en el cuerpo?
 *
 * El "nueva" se mide contra los ids que había antes de disparar la acción, no por
 * fecha de creación ni por unicidad del día. Los aprobadores son usuarios de demo
 * compartidos: su bandeja acumula entre corridas y el cuerpo del aviso sólo
 * menciona el tipo de ausencia y el día (`formatTipoAusencia` + `fmtFechaDia`),
 * así que una corrida anterior sobre el mismo día de banco daría un falso PASS.
 * Comparar ids lo vuelve exacto y hace que el período del banco pueda ser fijo.
 */
async function hayNotificacionNueva(
  token: string, previas: Set<string>, titulo: string, dia: string,
): Promise<boolean> {
  const notifs = await (await fetch(`${BASE}/notificaciones`, { headers: auth(token) })).json();
  return (Array.isArray(notifs) ? notifs : []).some(
    (n: any) => !previas.has(n.id) && n.titulo === titulo && (n.cuerpo ?? '').includes(fmtDia(dia)),
  );
}

/** El operador descartable del banco, ya logueado. */
interface Banco { token: string; usuarioId: string; email: string }

async function armarBanco(): Promise<Banco> {
  const rrhh = await login('rrhh1@test.wenlen.com');   // nivel 90: puede dar de alta un OPERADOR
  const admin = await login('admin@wenlen.com');       // SÓLO para la baja final (nivel 100)
  tokensCache.set('rrhh1@test.wenlen.com', rrhh.token);

  // El sector sale del primer supervisor candidato, no de una constante: es la
  // única forma de garantizar —sin hardcodear ids— que el paso SUPERVISOR del
  // circuito tenga quién lo firme.
  const emailSup = CANDIDATOS_APROBADORES[0] as string;
  const supRef = await login(emailSup);
  tokensCache.set(emailSup, supRef.token);
  if (!supRef.user.sectorId) abortar(`${emailSup} no tiene sector: sin él no se puede armar el banco`);

  const email = `qa.${KEY}.${TS}.owner@demo.com`;
  const alta = await fetch(`${BASE}/usuarios`, {
    method: 'POST',
    headers: auth(rrhh.token),
    body: JSON.stringify({
      nombre: 'QASolicitudes', apellido: `Banco${TS}`, email,
      password: 'Test1234!', rol: 'OPERADOR', fechaIngreso: '2020-01-01',
      sectorId: supRef.user.sectorId,
      // Sin supervisorId ni coordinadorId a propósito: así `isResponsibleApprover`
      // aplica la regla de sector y sirve cualquier supervisor/coordinador de ese
      // sector, en vez de atarse a una persona concreta de la demo.
    }),
  });
  const usuario = await alta.json();
  if (!usuario.id) {
    abortar(`no se pudo crear el operador del banco (status ${alta.status}): ${JSON.stringify(usuario).slice(0, 300)}`);
  }
  limpieza.push(async () => {
    await fetch(`${BASE}/usuarios/${usuario.id}`, { method: 'DELETE', headers: auth(admin.token) });
  });

  const ses = await login(email);
  return { token: ses.token, usuarioId: usuario.id as string, email };
}

async function run() {
  const banco = await armarBanco();
  const op = banco.token;

  /** Crea una planilla del banco y deja programada su baja. */
  async function nuevaPlanilla(inicio: string, fin: string): Promise<any> {
    const r = await fetch(`${BASE}/planillas`, {
      method: 'POST', headers: auth(op),
      body: JSON.stringify({ periodoInicio: inicio, periodoFin: fin }),
    });
    const pl = await r.json();
    if (pl?.id) {
      limpieza.push(async () => {
        await fetch(`${BASE}/planillas/${pl.id}`, { method: 'DELETE', headers: auth(op) });
      });
    }
    return { ...pl, _status: r.status };
  }

  // La planilla del banco. Período explícito: el usuario es nuevo, así que no hay
  // solapamiento posible con nada.
  const planilla = await nuevaPlanilla(P_INICIO, P_FIN);
  check(!!planilla.id, `el banco tiene su planilla de pruebas (${P_INICIO} a ${P_FIN})`);
  if (!planilla.id) {
    abortar(`no se pudo crear la planilla del banco (status ${planilla._status}): ${JSON.stringify(planilla).slice(0, 300)}`);
  }

  // El día que se va a pedir sale del PROPIO validador de envío: así queda
  // garantizado que está vacío, que no es franco ni feriado y que ya cuenta como
  // faltante. Elegir `periodoInicio` a ojo rompe la suite en cuanto ese día tenga
  // horas cargadas, por motivos ajenos a lo que se está probando.
  const preEnvio = await fetch(`${BASE}/planillas/${planilla.id}/enviar`, { method: 'POST', headers: auth(op) });
  const preData = await preEnvio.json();
  if (preEnvio.status !== 400 || !(preData.diasFaltantes ?? []).length) {
    abortar(`la planilla del banco tendría que nacer con todos los días vacíos (status ${preEnvio.status}: ${JSON.stringify(preData).slice(0, 300)})`);
  }
  // Los días de los escenarios salen todos de acá, y se descartan los que ya
  // tienen un pedido sin firmar encima: pedir dos veces el mismo día no es lo que
  // se está probando, y en vacaciones directamente lo rechaza el guard de
  // solapamiento. `periodoFin` también sale del pool porque tiene su propio
  // escenario (el borde del período). En un banco recién armado no hay pedidos
  // previos, pero el filtro se conserva: es lo que hace que la elección siga
  // siendo correcta si el período del banco llegara a tener un feriado o un franco.
  const detallePrevio = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const yaPedidos = (detallePrevio.solicitudesPendientes ?? []) as Array<{ fechaInicio: string; fechaFin: string }>;
  const finPeriodo = diaKey(planilla.periodoFin);
  const faltantes = preData.diasFaltantes as string[];
  const libres = faltantes.filter(
    (d) => d !== finPeriodo && !yaPedidos.some((s) => diaKey(s.fechaInicio) <= d && d <= diaKey(s.fechaFin)),
  );
  if (libres.length < 3 || !faltantes.includes(finPeriodo)) {
    abortar(`el período del banco no sirve: ${libres.length} días libres y el borde ${finPeriodo} ${faltantes.includes(finPeriodo) ? 'sí' : 'NO'} es laborable`);
  }

  const fecha = libres[0] as string;
  const diaPisar = libres[1] as string;
  const diaVac = libres[2] as string;
  check(true, `día vacío elegido para el pedido: ${fecha}`);

  // Solicitar una ausencia dentro del período, que queda PENDIENTE
  const solicitud = await (await fetch(`${BASE}/ausencias/solicitar`, {
    method: 'POST',
    headers: auth(op),
    body: JSON.stringify({
      tipo: 'FALTA_JUSTIFICADA',
      fechaInicio: fecha,
      fechaFin: fecha,
      diasAusencia: 1,
      descripcion: 'QA solicitudes pendientes',
    }),
  })).json();
  check(!!solicitud.id, 'se creó la ausencia pendiente');

  // 1. El detalle de la planilla la reporta
  const detalle = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check(Array.isArray(detalle.solicitudesPendientes), 'el detalle trae solicitudesPendientes');
  const pend = (detalle.solicitudesPendientes ?? []).find((s: any) => s.id === solicitud.id);
  check(!!pend, 'la ausencia pendiente figura en solicitudesPendientes');
  check(pend?.clase === 'AUSENCIA', 'la clase es AUSENCIA');
  check(diaKey(pend?.fechaInicio ?? '') === fecha, 'la fecha coincide con la pedida');

  // 2. El día NO está bloqueado: la solicitud todavía no se aprobó
  const reg = (detalle.registros ?? []).find((r: any) => diaKey(r.fecha) === fecha);
  check(!reg?.bloqueado, 'el día de la solicitud pendiente no está bloqueado');

  // 3. Sólo viajan solicitudes sin firmar: nada aprobado ni rechazado se cuela
  const estados = (detalle.solicitudesPendientes ?? []).map((s: any) => s.estado);
  check(estados.every((e: string) => e === 'PENDIENTE' || e === 'EN_REVISION'),
    'solicitudesPendientes sólo trae PENDIENTE / EN_REVISION');

  // 4. Un día pedido y sin cargar SIGUE contando como faltante al enviar: la
  //    planilla no sale con huecos. Lo único que cambia es que el error dice
  //    cuáles de esos huecos ya tienen un pedido en curso.
  const envio = await fetch(`${BASE}/planillas/${planilla.id}/enviar`, { method: 'POST', headers: auth(op) });
  const errEnvio = await envio.json();
  check(envio.status === 400, 'la planilla con huecos no se envía');
  check((errEnvio.diasFaltantes ?? []).includes(fecha), 'el día con pedido en revisión sigue siendo faltante');
  check((errEnvio.diasConPedidoPendiente ?? []).includes(fecha), 'el error marca que ese día tiene pedido en revisión');

  // limpieza: el retiro del dueño (DELETE /ausencias/:id exige nivel RRHH y le
  // devolvería un 403 al operador, dejando la solicitud viva)
  const cancel = await fetch(`${BASE}/mis-solicitudes/ausencia/${solicitud.id}/cancelar`, {
    method: 'POST', headers: auth(op),
  });
  check(cancel.ok, 'el operador puede cancelar su propia solicitud');

  // 5. Cancelada, deja de figurar: la marca del calendario se recalcula sola
  const tras = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check(!(tras.solicitudesPendientes ?? []).some((s: any) => s.id === solicitud.id),
    'la solicitud cancelada sale de solicitudesPendientes');

  // 5b. Lo mismo con VACACIONES: el calendario ya las pintaba, pero el cartel de
  //     días faltantes al enviar sólo miraba ausencias, así que un día con
  //     vacaciones pedidas se reclamaba sin decir que ya había un pedido en curso.
  //     Se deshace al final (DELETE devuelve el saldo), así que no gasta el día.
  const vac = await (await fetch(`${BASE}/vacaciones`, {
    method: 'POST',
    headers: auth(op),
    body: JSON.stringify({ fechaInicio: diaVac, fechaFin: diaVac, diasHabiles: 1, motivo: 'QA vacación pendiente' }),
  })).json();
  check(!!vac.id, `se creó la vacación pendiente sobre ${diaVac}`);

  const detVac = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check((detVac.solicitudesPendientes ?? []).some((s: any) => s.id === vac.id && s.clase === 'VACACION'),
    'la vacación pendiente figura en solicitudesPendientes');

  const envioVac = await fetch(`${BASE}/planillas/${planilla.id}/enviar`, { method: 'POST', headers: auth(op) });
  const errVac = await envioVac.json();
  check((errVac.diasFaltantes ?? []).includes(diaVac), 'el día con vacaciones pedidas sigue siendo faltante');
  check((errVac.diasConPedidoPendiente ?? []).includes(diaVac),
    'el error marca que ese día tiene una VACACIÓN en curso');

  const bajaVac = await fetch(`${BASE}/vacaciones/${vac.id}`, { method: 'DELETE', headers: auth(op) });
  check(bajaVac.ok, 'el dueño puede borrar su vacación pendiente (devuelve el saldo)');

  /**
   * Pide una falta justificada de un día y la lleva hasta APROBADA recorriendo su
   * circuito.
   *
   * La cadena de aprobadores NO se hardcodea: en este sistema el circuito se arma
   * por NIVEL del solicitante y se congela en `circuitoSnapshot`, y encima
   * `isResponsibleApprover` ata los pasos SUPERVISOR/COORDINADOR al sector (o al
   * superior asignado) del dueño. Nada de eso es contrato de esta suite. Se lee el
   * snapshot para saber cuántos pasos hay y, en cada paso, se prueba con los
   * candidatos hasta que uno firma. Si la ausencia no llegara a APROBADA los
   * checks de pisado darían falso-negativo, así que el estado final se verifica acá.
   *
   * `comoLoManda` es la representación que viaja por el cable; por defecto es el
   * propio `dia` ('YYYY-MM-DD'). Sirve para mandar el mismo día en una forma
   * hostil (ver `isoUltimaHoraAr`) y comprobar que el servidor lo guarda igual.
   */
  async function solicitarYAprobar(
    dia: string, descripcion: string, comoLoManda: string = dia,
  ): Promise<string | null> {
    const alta = await fetch(`${BASE}/ausencias/solicitar`, {
      method: 'POST',
      headers: auth(op),
      body: JSON.stringify({
        tipo: 'FALTA_JUSTIFICADA', fechaInicio: comoLoManda, fechaFin: comoLoManda,
        diasAusencia: 1, descripcion,
      }),
    });
    const aus = await alta.json();
    if (!aus.id) {
      check(false, `se creó la ausencia de ${dia} (status ${alta.status}: ${JSON.stringify(aus).slice(0, 200)})`);
      return null;
    }
    // El día que quedó guardado, medido sobre el STRING que devuelve el backend.
    // Con `comoLoManda` en la forma hostil ésta es la aserción que separa medir el
    // día en Argentina de medirlo en UTC: en UTC caería un día más adelante.
    check(diaKey(aus.fechaInicio) === dia && diaKey(aus.fechaFin) === dia,
      `la ausencia mandada como ${comoLoManda} quedó fechada el ${dia} (quedó ${diaKey(aus.fechaInicio ?? '')})`);

    // Sin circuito la ausencia la aprueba de una quien tenga nivel RRHH o
    // superior: una vuelta alcanza.
    const pasos = Array.isArray(aus.circuitoSnapshot) ? aus.circuitoSnapshot.length : 0;
    let ultimoFirmante: string | null = null;
    for (let i = 0; i < Math.max(pasos, 1); i++) {
      ultimoFirmante = null;
      for (const email of CANDIDATOS_APROBADORES) {
        const r = await fetch(`${BASE}/ausencias/${aus.id}/avanzar`, {
          method: 'POST', headers: auth(await tokenDe(email)), body: JSON.stringify({}),
        });
        if (r.ok) { ultimoFirmante = email; break; }
      }
      if (!ultimoFirmante) {
        check(false, `alguien pudo firmar el paso ${i + 1} de la ausencia de ${dia}`);
        return null;
      }
    }

    const final = await (await fetch(`${BASE}/ausencias/${aus.id}`, { headers: auth(op) })).json();
    check(final.estado === 'APROBADA', `la ausencia de ${dia} llegó a APROBADA (quedó ${final.estado})`);
    return final.estado === 'APROBADA' ? ultimoFirmante : null;
  }

  /**
   * Deja lista una planilla ENVIADA de UN SOLO día, con ese día cargado con horas.
   *
   * Va en un período aparte del principal —y de un solo día— para que alcance con
   * cargar una fecha para poder enviarla, en vez de completar los doce días del
   * banco. El día es fijo y no hace falta buscarlo: el operador del banco es nuevo
   * en cada corrida, así que su calendario de 2070 arranca vacío.
   */
  async function conPlanillaEnviadaDeUnDia(): Promise<
    { planillaId: string; dia: string; registroPrevio: any } | null
  > {
    const dia = DIA_SUELTO;
    const pl = await nuevaPlanilla(dia, dia);
    if (!pl.id) {
      check(false, `se creó la planilla suelta de ${dia} (status ${pl._status}: ${JSON.stringify(pl).slice(0, 200)})`);
      return null;
    }

    const conHs = await fetch(`${BASE}/planillas/${pl.id}/registros`, {
      method: 'POST', headers: auth(op),
      body: JSON.stringify({
        fecha: dia,
        entradaTurno1: `${dia}T08:00:00.000Z`,
        salidaTurno1: `${dia}T16:00:00.000Z`,
        lugarTrabajo: 'BASE', pernocte: 'NO', maneja: false, horasViajeInput: 0,
      }),
    });
    const enviada = await fetch(`${BASE}/planillas/${pl.id}/enviar`, { method: 'POST', headers: auth(op) });
    if (!conHs.ok || !enviada.ok) {
      check(false, `se pudo enviar la planilla de un día ${dia} (registro ${conHs.status}, envío ${enviada.status}: ${JSON.stringify(await enviada.json()).slice(0, 200)})`);
      return null;
    }

    const detEnv = await (await fetch(`${BASE}/planillas/${pl.id}`, { headers: auth(op) })).json();
    const registroPrevio = (detEnv.registros ?? []).find((r: any) => diaKey(r.fecha) === dia);
    check(detEnv.estado === 'ENVIADA' && Number(registroPrevio?.horasTrabajadas) > 0,
      `hay una planilla ENVIADA de un día (${dia}) con horas cargadas`);
    return { planillaId: pl.id, dia, registroPrevio };
  }

  // 6. Con la planilla en BORRADOR, aprobar PISA las horas cargadas
  const altaHoras = await fetch(`${BASE}/planillas/${planilla.id}/registros`, {
    method: 'POST',
    headers: auth(op),
    body: JSON.stringify({
      fecha: diaPisar,
      entradaTurno1: `${diaPisar}T08:00:00.000Z`,
      salidaTurno1: `${diaPisar}T16:00:00.000Z`,
      lugarTrabajo: 'BASE',
      pernocte: 'NO',
      maneja: false,
      horasViajeInput: 0,
    }),
  });
  check(altaHoras.ok, `se cargaron horas en ${diaPisar} para que la aprobación las pise`);

  const conHoras = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const antes = (conHoras.registros ?? []).find((r: any) => diaKey(r.fecha) === diaPisar);
  check(Number(antes?.horasTrabajadas) > 0, 'el día quedó con horas antes de aprobar la ausencia');

  const notifsAntesDelPisado = await idsNotificaciones(op);
  await solicitarYAprobar(diaPisar, 'QA pisado');

  const detalle2 = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const delDia = (detalle2.registros ?? []).filter((r: any) => diaKey(r.fecha) === diaPisar);
  check(delDia.length === 1, 'el día pisado tiene UN solo registro (no se duplicó)');
  check(delDia[0]?.bloqueado === true, 'el día quedó bloqueado');
  check(Number(delDia[0]?.horasTrabajadas) === 0, 'las horas se pusieron en cero');
  check(delDia[0]?.entradaTurno1 === null, 'el horario cargado se limpió');
  // Los totales de la cabecera tienen que seguir al pisado: si no se recalculan,
  // la planilla suma horas que ya no están en ningún registro.
  check(
    Number(detalle2.totalHorasNormales) === Number(conHoras.totalHorasNormales) - Number(antes?.horasNormales ?? 0),
    'el total de horas normales de la cabecera se recalculó al pisar',
  );
  check(Number(detalle2.totalDiasBase) === Number(conHoras.totalDiasBase) - 1,
    'el día pisado dejó de contar como día en base');
  check(await hayNotificacionNueva(op, notifsAntesDelPisado, 'Se reemplazaron horas cargadas', diaPisar),
    'al dueño le avisan que le reemplazaron las horas cargadas');

  // 7. El borde de arriba del período: el ÚLTIMO día también se inyecta, y se
  //    inyecta aunque la ausencia llegue medida en la ventana horaria en la que
  //    el día UTC y el día argentino discrepan.
  //
  //    El pedido viaja como `isoUltimaHoraAr(finPeriodo)` a propósito. Con
  //    'YYYY-MM-DD' este escenario NO discriminaba: toda la suite crea las fechas
  //    como fecha-sola, el backend las normaliza a 00:00Z y el bucle de días
  //    llega al último día del período por aritmética, con convención de día
  //    correcta o no. Mandando las 23:00 argentinas del último día, medir el día
  //    en UTC lo corre al día SIGUIENTE — fuera de [periodoInicio, periodoFin] —
  //    y entonces no hay planilla que solape: el día no se bloquea y los dos
  //    checks de abajo caen.
  await solicitarYAprobar(finPeriodo, 'QA borde fin de período', isoUltimaHoraAr(finPeriodo));
  const detalleBorde = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const regUltimo = (detalleBorde.registros ?? []).find((r: any) => diaKey(r.fecha) === finPeriodo);
  check(!!regUltimo?.bloqueado, 'la ausencia del último día del período se inyectó');

  // 8. Con la planilla YA ENVIADA, la aprobación NO la toca.
  //
  //    Se monta sobre una planilla aparte de UN SOLO DÍA, y no sobre la del
  //    período principal del banco: así alcanza con cargar un día para poder
  //    enviarla, en vez de completar los doce.
  const suelta = await conPlanillaEnviadaDeUnDia();
  if (suelta) {
    const { planillaId: plSueltaId, dia: diaEnviado, registroPrevio } = suelta;
    // Las bandejas se fotografían ANTES de aprobar: los aprobadores son usuarios
    // de demo compartidos y hay que poder distinguir el aviso de ESTA corrida.
    const notifsDueno = await idsNotificaciones(op);
    const notifsPorFirmante = new Map<string, Set<string>>();
    for (const email of CANDIDATOS_APROBADORES) {
      notifsPorFirmante.set(email, await idsNotificaciones(await tokenDe(email)));
    }

    const firmante = await solicitarYAprobar(diaEnviado, 'QA planilla ya enviada');

    const detalleSuelta = await (await fetch(`${BASE}/planillas/${plSueltaId}`, { headers: auth(op) })).json();
    const regSuelta = (detalleSuelta.registros ?? []).find((r: any) => diaKey(r.fecha) === diaEnviado);
    check(detalleSuelta.estado === 'ENVIADA', 'la planilla enviada sigue ENVIADA tras aprobar la ausencia');
    check(regSuelta?.bloqueado !== true, 'el día de la planilla enviada NO se bloqueó');
    check(Number(regSuelta?.horasTrabajadas) === Number(registroPrevio.horasTrabajadas),
      'las horas cargadas en la planilla enviada quedaron intactas');
    check(regSuelta?.entradaTurno1 === registroPrevio.entradaTurno1,
      'el horario cargado en la planilla enviada quedó intacto');

    // El aviso es lo único que convierte el salteo en algo accionable: sin él,
    // la ausencia queda aprobada y la planilla nunca la refleja, en silencio.
    check(await hayNotificacionNueva(op, notifsDueno, 'La ausencia aprobada no se aplicó a la planilla', diaEnviado),
      'al dueño le avisan que la ausencia aprobada no se aplicó');
    check(
      !!firmante && await hayNotificacionNueva(
        await tokenDe(firmante), notifsPorFirmante.get(firmante) ?? new Set(),
        'Ausencia aprobada sin aplicar a la planilla', diaEnviado,
      ),
      'a quien aprobó también le avisan que no se aplicó',
    );

    // 8b. La salida que ese aviso recomienda ("rechazala y reenviala") tiene que
    //     EXISTIR: al rechazar, la planilla vuelve a un estado editable y los días
    //     que se saltearon se reponen ahí mismo.
    //
    //     Antes no pasaba: `backfillAusenciasEnPlanilla` tenía un único llamador,
    //     `POST /planillas` (creación). `POST /:id/rechazar` sólo cambiaba el
    //     estado, así que el ciclo aprobar → omitidos → rechazar → reenviar
    //     terminaba con el día SIN bloquear y la ausencia aprobada en la base. El
    //     único camino que funcionaba era borrar la planilla y recrearla, que le
    //     borra al operador todas las horas del ciclo y no se lo dice nadie.
    const notifsAntesDelRechazo = await idsNotificaciones(op);
    let quienRechazo: string | null = null;
    for (const email of CANDIDATOS_APROBADORES) {
      const r = await fetch(`${BASE}/planillas/${plSueltaId}/rechazar`, {
        method: 'POST', headers: auth(await tokenDe(email)),
        body: JSON.stringify({ motivo: 'QA: rechazo para reponer la ausencia aprobada' }),
      });
      if (r.ok) { quienRechazo = email; break; }
    }
    check(!!quienRechazo, 'alguien del circuito pudo rechazar la planilla enviada');

    const detRechazada = await (await fetch(`${BASE}/planillas/${plSueltaId}`, { headers: auth(op) })).json();
    check(detRechazada.estado === 'RECHAZADA', 'la planilla quedó RECHAZADA');
    const delDiaRepuesto = (detRechazada.registros ?? []).filter((r: any) => diaKey(r.fecha) === diaEnviado);
    check(delDiaRepuesto.length === 1, 'el día repuesto tiene UN solo registro (no se duplicó)');
    check(delDiaRepuesto[0]?.bloqueado === true,
      'al rechazar, el día de la ausencia aprobada queda bloqueado sin borrar la planilla');
    check(Number(delDiaRepuesto[0]?.horasTrabajadas) === 0, 'las horas del día repuesto quedaron en cero');
    check(delDiaRepuesto[0]?.entradaTurno1 === null, 'el horario del día repuesto se limpió');
    // Si el backfill pisa horas, los totales de la cabecera tienen que seguirlo:
    // el único día de esta planilla pasó a estar bloqueado, así que no queda nada.
    check(Number(detRechazada.totalHorasNormales) === 0 && Number(detRechazada.totalDiasBase) === 0,
      'los totales de la cabecera siguieron al pisado del rechazo');
    check(await hayNotificacionNueva(op, notifsAntesDelRechazo, 'Se reemplazaron horas cargadas', diaEnviado),
      'al dueño le avisan que al rechazar se reemplazaron las horas del día ausente');

    // Y el ciclo se cierra: la planilla se reenvía sin tener que cargarle horas a
    // un día que no se trabajó (el validador de completitud da por completo un día
    // bloqueado). Reenviar tampoco vuelve a tocar el día.
    const reenvio = await fetch(`${BASE}/planillas/${plSueltaId}/enviar`, { method: 'POST', headers: auth(op) });
    check(reenvio.ok, 'la planilla con el día repuesto se reenvía sin cargar horas de un día ausente');
  } else {
    // Sin la planilla suelta no se pueden correr sus checks. Se marcan fallados en
    // vez de desaparecer del total: si no, una corrida rota reportaría menos
    // escenarios en vez de reportar fallas.
    check(false, `la ausencia de ${DIA_SUELTO} llegó a APROBADA (no se pudo montar la planilla enviada)`);
    for (const q of [
      'la planilla enviada sigue ENVIADA tras aprobar la ausencia',
      'el día de la planilla enviada NO se bloqueó',
      'las horas cargadas en la planilla enviada quedaron intactas',
      'el horario cargado en la planilla enviada quedó intacto',
      'al dueño le avisan que la ausencia aprobada no se aplicó',
      'a quien aprobó también le avisan que no se aplicó',
      'alguien del circuito pudo rechazar la planilla enviada',
      'la planilla quedó RECHAZADA',
      'el día repuesto tiene UN solo registro (no se duplicó)',
      'al rechazar, el día de la ausencia aprobada queda bloqueado sin borrar la planilla',
      'las horas del día repuesto quedaron en cero',
      'el horario del día repuesto se limpió',
      'los totales de la cabecera siguieron al pisado del rechazo',
      'al dueño le avisan que al rechazar se reemplazaron las horas del día ausente',
      'la planilla con el día repuesto se reenvía sin cargar horas de un día ausente',
    ]) check(false, `${q} (no se pudo montar la planilla enviada)`);
  }

  // 9. Borrar y recrear la planilla repone los días aprobados
  const borrada = await fetch(`${BASE}/planillas/${planilla.id}`, { method: 'DELETE', headers: auth(op) });
  check(borrada.ok, 'el dueño puede borrar su planilla en BORRADOR');
  const nueva = await nuevaPlanilla(P_INICIO, P_FIN);
  check(!!nueva.id, 'se pudo crear la planilla del período de nuevo');
  const detalle3 = await (await fetch(`${BASE}/planillas/${nueva.id}`, { headers: auth(op) })).json();
  const repuesto = (detalle3.registros ?? []).find((r: any) => diaKey(r.fecha) === diaPisar);
  check(!!repuesto?.bloqueado, 'al recrear la planilla, el día aprobado vuelve bloqueado');
  check(diaKey(repuesto?.fecha ?? '') === diaPisar, 'vuelve en la fecha correcta');
  const repuestoBorde = (detalle3.registros ?? []).find((r: any) => diaKey(r.fecha) === finPeriodo);
  check(!!repuestoBorde?.bloqueado, 'el día del borde del período también vuelve bloqueado');
}

/** Deshace el banco. Se ejecuta siempre, y ningún error de acá tumba el reporte. */
async function desarmarBanco() {
  for (const paso of [...limpieza].reverse()) {
    try { await paso(); } catch { /* la limpieza no puede romper el reporte */ }
  }
}

run()
  .then(async () => {
    await desarmarBanco();
    const total = pasados + fallos;
    console.log(fallos === 0
      ? `\n✓ planilla-solicitudes: ${pasados}/${total} todo OK`
      : `\n✗ planilla-solicitudes: ${fallos} fallas (${pasados}/${total})`);
    if (fallos > 0) process.exit(1);
  })
  .catch(async (e) => {
    await desarmarBanco();
    if (e instanceof Abortar) console.log(`\n✗ planilla-solicitudes: ${e.message}`);
    else console.error(e);
    process.exit(1);
  });
