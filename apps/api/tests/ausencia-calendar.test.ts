import assert from 'node:assert';
import { buildDaysBetween, clampDia } from '../src/utils/ausencia-calendar.utils.js';
import { dentroDelRango, rangoConsultaDia } from '../src/utils/fecha-dia.utils.js';

// Igual que en fecha-dia.test.ts (ver el encabezado de ese archivo para el
// razonamiento): estas aserciones son aritmética UTC pura y pasarían bajo
// cualquier TZ, pero lo que prueban sólo se rompe con getters locales bajo la TZ
// de producción. Sin fijarla, en un runner en la nube (UTC) dejarían de servir
// como red.
process.env.TZ = 'America/Argentina/Buenos_Aires';

const d = (iso: string) => new Date(iso);

async function run() {
  // 1. Rango de un día.
  const uno = buildDaysBetween(d('2026-07-31T00:00:00.000Z'), d('2026-07-31T00:00:00.000Z'));
  assert.strictEqual(uno.length, 1);
  assert.strictEqual(uno[0]!.toISOString(), '2026-07-31T00:00:00.000Z');

  // 2. Rango de dos días.
  const dos = buildDaysBetween(d('2026-07-28T00:00:00.000Z'), d('2026-07-29T00:00:00.000Z'));
  assert.deepStrictEqual(
    dos.map((x) => x.toISOString()),
    ['2026-07-28T00:00:00.000Z', '2026-07-29T00:00:00.000Z'],
  );

  // 3. Entradas con hora argentina (datos previos a la migración): mismo día.
  const conHora = buildDaysBetween(d('2026-07-31T03:00:00.000Z'), d('2026-07-31T03:00:00.000Z'));
  assert.strictEqual(conHora.length, 1);
  assert.strictEqual(conHora[0]!.toISOString(), '2026-07-31T00:00:00.000Z');

  // 4. clampDia recorta al piso del período aunque el período tenga hora.
  assert.strictEqual(
    clampDia(d('2026-07-10T00:00:00.000Z'), d('2026-07-16T03:00:00.000Z')).toISOString(),
    '2026-07-16T00:00:00.000Z',
  );

  // 5. El día que ya está dentro no se toca.
  assert.strictEqual(
    clampDia(d('2026-07-20T00:00:00.000Z'), d('2026-07-16T03:00:00.000Z')).toISOString(),
    '2026-07-20T00:00:00.000Z',
  );

  // 6. clampDia con techo.
  assert.strictEqual(
    clampDia(d('2026-08-20T00:00:00.000Z'), d('2026-08-15T03:00:00.000Z'), true).toISOString(),
    '2026-08-15T00:00:00.000Z',
  );

  // 6b. clampDia con techo y un valor que ya está adentro: no se toca.
  assert.strictEqual(
    clampDia(d('2026-08-10T00:00:00.000Z'), d('2026-08-15T03:00:00.000Z'), true).toISOString(),
    '2026-08-10T00:00:00.000Z',
  );

  // 6c. buildDaysBetween con start > end: rango vacío, no explota.
  assert.deepStrictEqual(
    buildDaysBetween(d('2026-07-31T00:00:00.000Z'), d('2026-07-30T00:00:00.000Z')),
    [],
  );

  // 6d. buildDaysBetween cruzando fin de mes.
  assert.deepStrictEqual(
    buildDaysBetween(d('2026-07-31T00:00:00.000Z'), d('2026-08-01T00:00:00.000Z')).map((x) => x.toISOString()),
    ['2026-07-31T00:00:00.000Z', '2026-08-01T00:00:00.000Z'],
  );

  // 6e. El piso de buildDaysBetween es el día calendario ARGENTINO, no el UTC:
  //     ambas puntas caen en la ventana (00:00Z, 03:00Z), que en Argentina
  //     todavía es el día anterior.
  const enVentana = buildDaysBetween(d('2026-08-01T02:00:00.000Z'), d('2026-08-01T02:30:00.000Z'));
  assert.strictEqual(enVentana.length, 1);
  assert.strictEqual(enVentana[0]!.toISOString(), '2026-07-31T00:00:00.000Z');

  // 7. Camino completo que usa inyectarDiasBloqueados, reproduciendo el bug
  //    reportado: una ausencia que arranca el 31/7 a las 03:00Z (medianoche
  //    argentina) y una planilla con periodoFin el 31/7 a las 00:00Z (mismo día
  //    calendario, sin hora). Con el filtro CRUDO (el bug), "periodoFin >=
  //    fechaInicio" da "00:00 >= 03:00" → false, y la planilla se pierde antes de
  //    que dentroDelRango llegue a evaluarla — no alcanza con arreglar
  //    dentroDelRango si el pre-filtro SQL nunca la trae. Este test verifica las
  //    dos puntas reales: (a) el pre-filtro ensanchado no la descarta, y (b) el
  //    día de la ausencia queda dentro del período de esa planilla según
  //    dentroDelRango, que es la comparación que hace inyectarDiasBloqueados por
  //    cada día del rango.
  const inicioAusencia = d('2026-07-31T03:00:00.000Z');
  const finAusencia = d('2026-08-05T00:00:00.000Z');
  const periodoInicioPlanilla = d('2026-07-16T00:00:00.000Z');
  const periodoFinPlanilla = d('2026-07-31T00:00:00.000Z');

  // Sanity: el filtro CRUDO (sin ensanchar) SÍ perdía esta planilla.
  assert.ok(!(periodoFinPlanilla.getTime() >= inicioAusencia.getTime()));

  // (a) El pre-filtro SQL ensanchado (rangoConsultaDia) no la descarta.
  const { desde: desdePreFiltro } = rangoConsultaDia(inicioAusencia, finAusencia);
  assert.ok(periodoFinPlanilla.getTime() >= desdePreFiltro.getTime());

  // (b) El día real de la ausencia (el que arma buildDaysBetween) cae dentro del
  //     período de la planilla según dentroDelRango.
  const [primerDiaAusencia] = buildDaysBetween(inicioAusencia, inicioAusencia);
  assert.strictEqual(dentroDelRango(primerDiaAusencia!, periodoInicioPlanilla, periodoFinPlanilla), true);

  console.log('✓ ausencia-calendar: 7/7 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
