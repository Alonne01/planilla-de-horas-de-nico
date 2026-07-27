import assert from 'node:assert';
import { buildDaysBetween, clampDia, rangoConsultaDia } from '../src/utils/ausencia-calendar.utils.js';

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

  // 7. rangoConsultaDia amplía [desde, hasta] al día completo en UTC: el piso baja
  //    a medianoche del día de "desde" y el techo sube a 1 ms antes de la
  //    medianoche siguiente a "hasta". Es lo que hay que usar en el `where` de
  //    Prisma para no perder registros guardados con hora (medianoche argentina,
  //    mediodía, la hora de una aprobación) que caen en esos mismos días.
  const rango = rangoConsultaDia(d('2026-07-31T03:00:00.000Z'), d('2026-08-15T03:00:00.000Z'));
  assert.strictEqual(rango.desde.toISOString(), '2026-07-31T00:00:00.000Z');
  assert.strictEqual(rango.hasta.toISOString(), '2026-08-15T23:59:59.999Z');

  // 8. Reproduce el bug reportado: una ausencia que arranca a las 03:00Z (medianoche
  //    argentina) y una planilla cuyo periodoFin es 00:00Z del mismo día calendario.
  //    El filtro crudo compara "00:00 >= 03:00" (false) y pierde la planilla; con
  //    el piso ensanchado a 00:00Z del mismo día, la comparación pasa.
  const periodoFinPlanilla = d('2026-07-31T00:00:00.000Z');
  assert.ok(periodoFinPlanilla.getTime() >= rango.desde.getTime());

  console.log('✓ ausencia-calendar: 8/8 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
