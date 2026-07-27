/**
 * QA Suite — SOLICITUDES EN LA PLANILLA (KEY=planilla-solicitudes)
 *
 * Cubre tres cosas:
 *  1. `solicitudesPendientes` en GET /planillas/:id (las ausencias/vacaciones sin
 *     firmar que tocan el período) y el aviso de días faltantes al enviar, que
 *     distingue los huecos que ya tienen un pedido en curso.
 *  2. Qué pasa cuando el pedido se APRUEBA: pisa las horas cargadas si la
 *     planilla es editable, y avisa.
 *  3. Que borrar y recrear la planilla repone los días ya aprobados.
 *
 * Limpieza entre corridas: lo que se puede deshacer se deshace (la ausencia
 * pendiente se cancela, la vacación pendiente se borra y devuelve el saldo). Lo
 * que NO se puede deshacer es la ausencia APROBADA de los escenarios de pisado:
 * el API no tiene revocación para una falta justificada aprobada, y borrarla a
 * mano contra la base está fuera de lo que puede hacer una suite. Por eso los
 * días de esos escenarios se eligen de `diasFaltantes` en cada corrida: un día ya
 * bloqueado deja de ser faltante, así que la corrida siguiente agarra uno nuevo y
 * la suite se mantiene idempotente. El costo es que cada corrida consume un día
 * libre del período; cuando se acaben, la suite lo dice y corta.
 *
 * Run: cd apps/api && npx tsx tests/qa/planilla-solicitudes.qa.ts
 */

// `QA_BASE` permite apuntar la suite a otra instancia (p. ej. una levantada en
// :4001 para no reiniciar la que está en uso). Por defecto, la de siempre.
const BASE = process.env.QA_BASE ?? 'http://localhost:4000/api/v1';

let fallos = 0;
function check(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); }
  else { console.log(`  FAIL ${msg}`); fallos++; }
}

async function login(email: string, password = 'Test1234!') {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!data.accessToken) throw new Error(`login falló para ${email}: ${JSON.stringify(data)}`);
  return data.accessToken as string;
}

function auth(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Los aprobadores que se prueban para firmar un paso, en orden.
 *
 * A propósito SIN el ADMIN: el admin es la escotilla de escape que aprueba
 * cualquier paso (ver `_isResponsibleApprover`), así que incluirlo haría pasar la
 * suite aunque el circuito estuviera mal armado.
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
  const t = await login(email);
  tokensCache.set(email, t);
  return t;
}

/** Clave 'YYYY-MM-DD' del día de HOY en el huso del proceso (los contenedores corren en AR). */
function hoyKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Clave de día de una fecha-día serializada por el backend: sale del STRING, nunca de un `Date`. */
function diaKey(iso: string): string {
  return iso.slice(0, 10);
}

async function run() {
  const op = await login('op2.testing@test.wenlen.com');

  // La planilla del período CORRIENTE. Se busca por período —el orden del
  // listado no es una garantía—: `planillas[0]` puede ser cualquier ciclo.
  const planillas = await (await fetch(`${BASE}/planillas`, { headers: auth(op) })).json();
  const hoy = hoyKey();
  const planilla = (planillas as any[]).find(
    (p) => diaKey(p.periodoInicio) <= hoy && hoy <= diaKey(p.periodoFin),
  );
  check(!!planilla, 'el operador tiene la planilla del período corriente');
  if (!planilla) { console.log('\n✗ planilla-solicitudes: sin planilla del período, no se puede seguir'); process.exit(1); }

  // El día que se va a pedir sale del PROPIO validador de envío: así queda
  // garantizado que está vacío, que no es franco ni feriado y que hoy ya cuenta
  // como faltante. Elegir `periodoInicio` a ojo rompe la suite en cuanto ese día
  // tenga horas cargadas, por motivos ajenos a lo que se está probando.
  const preEnvio = await fetch(`${BASE}/planillas/${planilla.id}/enviar`, { method: 'POST', headers: auth(op) });
  const preData = await preEnvio.json();
  if (preEnvio.status !== 400 || !(preData.diasFaltantes ?? []).length) {
    console.log(`  FAIL la planilla del período tiene un día vacío para pedir (status ${preEnvio.status})`);
    console.log('\n✗ planilla-solicitudes: la planilla no tiene huecos, la suite necesita uno');
    process.exit(1);
  }
  // Los días de los escenarios salen todos de acá, y se descartan los que ya
  // tienen un pedido sin firmar encima: pedir dos veces el mismo día no es lo que
  // se está probando, y en vacaciones directamente lo rechaza el guard de
  // solapamiento. `periodoFin` también sale del pool porque tiene su propio
  // escenario (el borde del período).
  const detallePrevio = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const yaPedidos = (detallePrevio.solicitudesPendientes ?? []) as Array<{ fechaInicio: string; fechaFin: string }>;
  const finPeriodo = diaKey(planilla.periodoFin);
  const libres = (preData.diasFaltantes as string[]).filter(
    (d) => d !== finPeriodo && !yaPedidos.some((s) => diaKey(s.fechaInicio) <= d && d <= diaKey(s.fechaFin)),
  );
  if (libres.length < 2) {
    console.log(`  FAIL hacen falta 2 días libres en el período y quedan ${libres.length}`);
    console.log('\n✗ planilla-solicitudes: el período se quedó sin días libres para los escenarios');
    process.exit(1);
  }

  const fecha = libres[0] as string;
  const diaPisar = libres[1] as string;
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
  // devolvería un 403 al operador, dejando la solicitud viva para la próxima corrida)
  const cancel = await fetch(`${BASE}/mis-solicitudes/ausencia/${solicitud.id}/cancelar`, {
    method: 'POST', headers: auth(op),
  });
  check(cancel.ok, 'el operador puede cancelar su propia solicitud');

  // 5. Cancelada, deja de figurar: la marca del calendario se recalcula sola
  const tras = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check(!(tras.solicitudesPendientes ?? []).some((s: any) => s.id === solicitud.id),
    'la solicitud cancelada sale de solicitudesPendientes');

  /**
   * Pide una falta justificada de un día y la lleva hasta APROBADA recorriendo su
   * circuito.
   *
   * La cadena de aprobadores NO se hardcodea: en este sistema el circuito se arma
   * por NIVEL del solicitante y se congela en `circuitoSnapshot`, y encima
   * `isResponsibleApprover` ata los pasos SUPERVISOR/COORDINADOR al superior
   * asignado al dueño. Nada de eso es contrato de esta suite. Se lee el snapshot
   * para saber cuántos pasos hay y, en cada paso, se prueba con los candidatos
   * hasta que uno firma. Si la ausencia no llegara a APROBADA los checks de
   * pisado darían falso-negativo, así que el estado final se verifica acá.
   */
  async function solicitarYAprobar(dia: string, descripcion: string): Promise<boolean> {
    const alta = await fetch(`${BASE}/ausencias/solicitar`, {
      method: 'POST',
      headers: auth(op),
      body: JSON.stringify({
        tipo: 'FALTA_JUSTIFICADA', fechaInicio: dia, fechaFin: dia,
        diasAusencia: 1, descripcion,
      }),
    });
    const aus = await alta.json();
    if (!aus.id) {
      check(false, `se creó la ausencia de ${dia} (status ${alta.status}: ${JSON.stringify(aus).slice(0, 200)})`);
      return false;
    }

    // Sin circuito la ausencia la aprueba de una quien tenga nivel RRHH o
    // superior: una vuelta alcanza.
    const pasos = Array.isArray(aus.circuitoSnapshot) ? aus.circuitoSnapshot.length : 0;
    for (let i = 0; i < Math.max(pasos, 1); i++) {
      let firmado = false;
      for (const email of CANDIDATOS_APROBADORES) {
        const r = await fetch(`${BASE}/ausencias/${aus.id}/avanzar`, {
          method: 'POST', headers: auth(await tokenDe(email)), body: JSON.stringify({}),
        });
        if (r.ok) { firmado = true; break; }
      }
      if (!firmado) {
        check(false, `alguien pudo firmar el paso ${i + 1} de la ausencia de ${dia}`);
        return false;
      }
    }

    const final = await (await fetch(`${BASE}/ausencias/${aus.id}`, { headers: auth(op) })).json();
    check(final.estado === 'APROBADA', `la ausencia de ${dia} llegó a APROBADA (quedó ${final.estado})`);
    return final.estado === 'APROBADA';
  }

  /**
   * Deja lista una planilla ENVIADA de un solo día en un período viejo, con ese
   * día cargado con horas. Devuelve null (y deja el motivo como FAIL) si no lo
   * consigue.
   *
   * El día se elige caminando hacia atrás desde un ancla fija: cada corrida deja
   * sobre el día que usó una ausencia APROBADA que el API no sabe deshacer, y al
   * recrear la planilla el backfill lo devolvería bloqueado. Un día ya bloqueado
   * no sirve para probar que la aprobación NO lo tocó, así que se saltea.
   */
  async function conPlanillaEnviadaDeUnDia(): Promise<
    { planillaId: string; dia: string; registroPrevio: any } | null
  > {
    const ANCLA = Date.UTC(2025, 0, 15);
    for (let offset = 0; offset < 40; offset++) {
      const dia = new Date(ANCLA - offset * 86_400_000).toISOString().slice(0, 10);

      const alta = await fetch(`${BASE}/planillas`, {
        method: 'POST', headers: auth(op),
        body: JSON.stringify({ periodoInicio: dia, periodoFin: dia }),
      });
      if (!alta.ok) continue; // 409: se solapa con otra planilla del usuario
      const pl = await alta.json();

      const det = await (await fetch(`${BASE}/planillas/${pl.id}`, { headers: auth(op) })).json();
      const yaBloqueado = (det.registros ?? []).some((r: any) => r.bloqueado);
      if (yaBloqueado) {
        // Lo dejó una corrida anterior: se descarta la planilla y se prueba con
        // el día de más atrás.
        await fetch(`${BASE}/planillas/${pl.id}`, { method: 'DELETE', headers: auth(op) });
        continue;
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
        await fetch(`${BASE}/planillas/${pl.id}`, { method: 'DELETE', headers: auth(op) });
        return null;
      }

      const detEnv = await (await fetch(`${BASE}/planillas/${pl.id}`, { headers: auth(op) })).json();
      const registroPrevio = (detEnv.registros ?? []).find((r: any) => diaKey(r.fecha) === dia);
      check(detEnv.estado === 'ENVIADA' && Number(registroPrevio?.horasTrabajadas) > 0,
        `hay una planilla ENVIADA de un día (${dia}) con horas cargadas`);
      return { planillaId: pl.id, dia, registroPrevio };
    }
    check(false, 'se encontró un día viejo libre para la planilla ya enviada');
    return null;
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

  // 7. Los bordes del período: el último día también se inyecta (antes se perdía
  //    porque 00:00Z quedaba fuera del filtro contra un período guardado a 03:00Z)
  await solicitarYAprobar(finPeriodo, 'QA borde fin de período');
  const detalleBorde = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const regUltimo = (detalleBorde.registros ?? []).find((r: any) => diaKey(r.fecha) === finPeriodo);
  check(!!regUltimo?.bloqueado, 'la ausencia del último día del período se inyectó');

  // 8. Con la planilla YA ENVIADA, la aprobación NO la toca.
  //
  //    Se monta sobre una planilla aparte de UN SOLO DÍA en un período viejo, y no
  //    sobre la del período corriente: así alcanza con cargar un día para poder
  //    enviarla (en vez de completar el mes entero) y no se gasta ninguno de los
  //    días libres del ciclo en curso. El día se busca hacia atrás porque la
  //    ausencia aprobada que deja cada corrida no se puede deshacer por API, y en
  //    la corrida siguiente el backfill la repondría bloqueada.
  const diaViejo = await conPlanillaEnviadaDeUnDia();
  if (diaViejo) {
    const { planillaId: plViejaId, dia: diaEnviado, registroPrevio } = diaViejo;
    await solicitarYAprobar(diaEnviado, 'QA planilla ya enviada');

    const detalleVieja = await (await fetch(`${BASE}/planillas/${plViejaId}`, { headers: auth(op) })).json();
    const regVieja = (detalleVieja.registros ?? []).find((r: any) => diaKey(r.fecha) === diaEnviado);
    check(detalleVieja.estado === 'ENVIADA', 'la planilla enviada sigue ENVIADA tras aprobar la ausencia');
    check(regVieja?.bloqueado !== true, 'el día de la planilla enviada NO se bloqueó');
    check(Number(regVieja?.horasTrabajadas) === Number(registroPrevio.horasTrabajadas),
      'las horas cargadas en la planilla enviada quedaron intactas');
    check(regVieja?.entradaTurno1 === registroPrevio.entradaTurno1,
      'el horario cargado en la planilla enviada quedó intacto');

    await fetch(`${BASE}/planillas/${plViejaId}`, { method: 'DELETE', headers: auth(op) });
  }

  // 9. Borrar y recrear la planilla repone los días aprobados
  const borrada = await fetch(`${BASE}/planillas/${planilla.id}`, { method: 'DELETE', headers: auth(op) });
  check(borrada.ok, 'el dueño puede borrar su planilla en BORRADOR');
  const nueva = await (await fetch(`${BASE}/planillas`, {
    method: 'POST', headers: auth(op), body: JSON.stringify({}),
  })).json();
  check(!!nueva.id, 'se pudo crear la planilla del período de nuevo');
  const detalle3 = await (await fetch(`${BASE}/planillas/${nueva.id}`, { headers: auth(op) })).json();
  const repuesto = (detalle3.registros ?? []).find((r: any) => diaKey(r.fecha) === diaPisar);
  check(!!repuesto?.bloqueado, 'al recrear la planilla, el día aprobado vuelve bloqueado');
  check(diaKey(repuesto?.fecha ?? '') === diaPisar, 'vuelve en la fecha correcta');
  const repuestoBorde = (detalle3.registros ?? []).find((r: any) => diaKey(r.fecha) === finPeriodo);
  check(!!repuestoBorde?.bloqueado, 'el día del borde del período también vuelve bloqueado');

  console.log(fallos === 0 ? '\n✓ planilla-solicitudes: todo OK' : `\n✗ planilla-solicitudes: ${fallos} fallas`);
  if (fallos > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
