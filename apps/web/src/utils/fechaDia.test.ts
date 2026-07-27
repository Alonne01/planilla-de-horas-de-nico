import assert from 'node:assert';
import { diaKey, fmtDia, diaLocal } from './fechaDia.js';

async function run() {
  // 1. La clave sale del string, sin construir un Date (que correría el día en UTC-3).
  assert.strictEqual(diaKey('2026-07-31T00:00:00.000Z'), '2026-07-31');

  // 2. Datos previos a la migración (medianoche argentina) → mismo día.
  assert.strictEqual(diaKey('2026-07-31T03:00:00.000Z'), '2026-07-31');

  // 3. Fecha-sola.
  assert.strictEqual(diaKey('2026-07-31'), '2026-07-31');

  // 4. diaLocal da un Date en el día correcto del huso del navegador.
  const d = diaLocal('2026-07-31T00:00:00.000Z');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 31);

  // 5. El formateo muestra el día pedido, no el anterior.
  assert.strictEqual(fmtDia('2026-07-31T00:00:00.000Z'), '31/7/2026');

  // 6. Con opciones: el formato que usa WentopPage (`formatDate`) para
  //    fechaReporte/fechaCierre. Antes daba '30/07/2026'.
  assert.strictEqual(
    fmtDia('2026-07-31T00:00:00.000Z', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    '31/07/2026',
  );

  console.log('✓ fechaDia: 6/6 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
