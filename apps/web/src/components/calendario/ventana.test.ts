import assert from 'node:assert';
import { ventanaDeMeses, ventanaAnual, rangoEnVentana, indiceDeDiaAcotado, aniosDeVentana } from './ventana';

/** Una fecha-día tal como la serializa el backend. */
function fd(clave: string) { return `${clave}T00:00:00.000Z`; }

async function run() {
  let aserciones = 0;
  const ok = (fn: () => void) => { fn(); aserciones++; };

  // 1. La ventana anual es el eje viejo con otro nombre: 365 días y un offset por
  //    mes. Es la garantía de que la vista de año no cambia de comportamiento.
  const anual = ventanaAnual(2026);
  ok(() => assert.strictEqual(anual.meses.length, 12));
  ok(() => assert.strictEqual(anual.totalDias, 365));
  ok(() => assert.deepStrictEqual(anual.offset.slice(0, 4), [0, 31, 59, 90]));
  ok(() => assert.deepStrictEqual(aniosDeVentana(anual), [2026]));

  // 2. Bisiesto: los días salen del calendario, no de una constante.
  ok(() => assert.strictEqual(ventanaAnual(2028).totalDias, 366));
  ok(() => assert.strictEqual(ventanaDeMeses(2028, 2, 1).totalDias, 29));
  ok(() => assert.strictEqual(ventanaDeMeses(2026, 2, 1).totalDias, 28));

  // 3. La ventana cruza diciembre: noviembre + 2 cae en enero del año siguiente.
  //    Es el caso que el eje día-del-año no podía ni nombrar.
  const cruce = ventanaDeMeses(2026, 11, 3);
  ok(() => assert.deepStrictEqual(cruce.meses, [
    { anio: 2026, mes: 11 }, { anio: 2026, mes: 12 }, { anio: 2027, mes: 1 },
  ]));
  ok(() => assert.strictEqual(cruce.totalDias, 30 + 31 + 31));
  ok(() => assert.deepStrictEqual(aniosDeVentana(cruce), [2026, 2027]));

  // 4. Un bloque que arranca en diciembre y termina en enero se ve entero.
  ok(() => assert.deepStrictEqual(
    rangoEnVentana(fd('2026-12-28'), fd('2027-01-05'), cruce),
    [30 + 27, 30 + 31 + 4],
  ));

  // 5. Un bloque que empieza antes y termina después se recorta a las puntas.
  const marzo = ventanaDeMeses(2026, 3, 1);
  ok(() => assert.deepStrictEqual(rangoEnVentana(fd('2026-01-10'), fd('2026-12-20'), marzo), [0, 30]));

  // 6. Un bloque enteramente fuera no existe para la ventana (por los dos lados).
  ok(() => assert.strictEqual(rangoEnVentana(fd('2026-01-10'), fd('2026-01-20'), marzo), null));
  ok(() => assert.strictEqual(rangoEnVentana(fd('2026-05-01'), fd('2026-05-02'), marzo), null));

  // 7. Un bloque de un solo día, y las dos puntas exactas del mes.
  ok(() => assert.deepStrictEqual(rangoEnVentana(fd('2026-03-15'), fd('2026-03-15'), marzo), [14, 14]));
  ok(() => assert.deepStrictEqual(rangoEnVentana(fd('2026-03-01'), fd('2026-03-31'), marzo), [0, 30]));

  // 8. Un bloque de otro AÑO que cae en el mismo mes no se cuela: la ventana
  //    identifica el mes por (año, mes), no por el número de mes.
  ok(() => assert.strictEqual(rangoEnVentana(fd('2025-03-10'), fd('2025-03-20'), marzo), null));

  // 9. `indiceDeDiaAcotado` pega contra las puntas en vez de devolver null: lo usa
  //    el marcador de "hoy", que siempre tiene que caer en algún lado.
  ok(() => assert.strictEqual(indiceDeDiaAcotado(fd('2026-01-01'), marzo), 0));
  ok(() => assert.strictEqual(indiceDeDiaAcotado(fd('2026-12-31'), marzo), 30));
  ok(() => assert.strictEqual(indiceDeDiaAcotado(fd('2026-03-02'), marzo), 1));
  ok(() => assert.strictEqual(indiceDeDiaAcotado(fd('2027-01-03'), cruce), 30 + 31 + 2));

  console.log(`✓ ventana: ${aserciones}/${aserciones} OK`);
}

run().catch((e) => { console.error(e); process.exit(1); });
