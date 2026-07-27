/**
 * QA Suite — SOLICITUDES EN LA PLANILLA (KEY=planilla-solicitudes)
 *
 * Cubre: `solicitudesPendientes` en GET /planillas/:id (las ausencias/vacaciones
 * sin firmar que tocan el período) y el aviso de días faltantes al enviar, que
 * distingue los huecos que ya tienen un pedido en curso.
 *
 * La suite se limpia sola: la ausencia que crea se cancela por
 * POST /mis-solicitudes/ausencia/:id/cancelar (el retiro del dueño), así que dos
 * corridas seguidas arrancan del mismo estado.
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
  const fecha = preData.diasFaltantes[0] as string;
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

  // limpieza: el retiro del dueño (DELETE /ausencias/:id exige nivel RRHH y le
  // devolvería un 403 al operador, dejando la solicitud viva para la próxima corrida)
  const cancel = await fetch(`${BASE}/mis-solicitudes/ausencia/${solicitud.id}/cancelar`, {
    method: 'POST', headers: auth(op),
  });
  check(cancel.ok, 'el operador puede cancelar su propia solicitud');

  // 4. Cancelada, deja de figurar: la marca del calendario se recalcula sola
  const tras = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check(!(tras.solicitudesPendientes ?? []).some((s: any) => s.id === solicitud.id),
    'la solicitud cancelada sale de solicitudesPendientes');

  console.log(fallos === 0 ? '\n✓ planilla-solicitudes: todo OK' : `\n✗ planilla-solicitudes: ${fallos} fallas`);
  if (fallos > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
