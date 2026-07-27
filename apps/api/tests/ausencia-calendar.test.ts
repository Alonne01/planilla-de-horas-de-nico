import assert from 'node:assert';
import { buildDaysBetween, clampDia } from '../src/utils/ausencia-calendar.utils.js';

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

  console.log('✓ ausencia-calendar: 6/6 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
