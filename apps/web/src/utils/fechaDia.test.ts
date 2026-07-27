import assert from 'node:assert';
import { diaKey, fmtDia, diaLocal, hoyKey, diasEntre } from './fechaDia.js';

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

  // 7. hoyKey mide el día del huso del NAVEGADOR, no el UTC. Ése era el bug del
  //    marcador de "hoy" del gantt: se le pasaba `new Date().toISOString()`, cuyo
  //    slice(0,10) es el día UTC, así que entre las 21:00 y las 24:00 en
  //    Argentina el marcador se dibujaba sobre el día siguiente.
  //    Se contrasta contra 'sv-SE', que formatea YYYY-MM-DD en hora local: es un
  //    camino independiente (Intl) del de hoyKey (getters), así que el assert no
  //    es tautológico y vale en cualquier huso.
  for (const iso of ['2026-07-27T01:00:00.000Z', '2026-01-01T00:30:00.000Z', '2026-12-31T23:30:00.000Z']) {
    const d = new Date(iso);
    assert.strictEqual(hoyKey(d), d.toLocaleDateString('sv-SE'), `hoyKey(${iso})`);
  }

  // 8. diasEntre: días calendario enteros, sin depender de la hora ni del huso.
  //    Es lo que decide el badge de vencimiento de una capacitación.
  assert.strictEqual(diasEntre('2026-08-01', '2026-07-31'), 1);
  assert.strictEqual(diasEntre('2026-07-31', '2026-07-31'), 0);
  assert.strictEqual(diasEntre('2026-07-31', '2026-08-01'), -1);
  // Mezcla de convenciones: 00:00Z (migrada) contra 03:00Z (previa) → 1 día.
  assert.strictEqual(diasEntre('2026-08-01T00:00:00.000Z', '2026-07-31T03:00:00.000Z'), 1);
  // Año bisiesto: 2028 tiene 29 de febrero.
  assert.strictEqual(diasEntre('2028-03-01', '2028-02-28'), 2);

  // 9. La ventana que rompía: 21:00–24:00 en Argentina, donde el día UTC ya es el
  //    siguiente. Ahí `new Date().toISOString().split('T')[0]` grababa MAÑANA —
  //    era el bug de la fecha de cierre de una tarjeta WENTOP y de los defaults
  //    de fecha de los formularios.
  //    El instante se arma con componentes LOCALES (22:00 del 26/7), así que el
  //    primer assert vale en cualquier huso; el segundo sólo corre en los husos
  //    donde el día UTC efectivamente difiere (Argentina entre ellos) y es el que
  //    fija que hoyKey sigue al día local y no al UTC.
  const nocheLocal = new Date(2026, 6, 26, 22, 0, 0);
  assert.strictEqual(hoyKey(nocheLocal), '2026-07-26');
  const diaUtc = nocheLocal.toISOString().slice(0, 10);
  if (diaUtc !== '2026-07-26') {
    assert.notStrictEqual(hoyKey(nocheLocal), diaUtc, 'hoyKey debe seguir el día local, no el UTC');
  }

  console.log('✓ fechaDia: 9/9 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
