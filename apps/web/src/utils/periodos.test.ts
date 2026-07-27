import assert from 'node:assert';
import { generateCycles, getCurrentPeriod } from './periodos.js';

/** Toda fecha-día tiene que ser medianoche UTC exacta, no 03:00Z ni 00:00 local. */
function assertMedianoche(iso: string, que: string) {
  assert.ok(
    iso.endsWith('T00:00:00.000Z'),
    `${que} debe ser medianoche UTC exacta, fue ${iso}`,
  );
}

async function run() {
  // 1. EL BUG REPORTADO: con 16/15 el ciclo actual debe ser 16 Jul - 15 Ago
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '16 Jul - 15 Ago 2026', `esperaba 16/15, fue "${c.label}"`);
  }
  // 2. El comportamiento viejo sigue siendo correcto cuando se piden 21/20
  {
    const [c] = generateCycles(1, 21, 20, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '21 Jul - 20 Ago 2026', `esperaba 21/20, fue "${c.label}"`);
  }
  // 3. Antes del día de inicio, el ciclo vigente es el que arrancó el mes pasado
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 10));
    assert.strictEqual(c.label, '16 Jun - 15 Jul 2026', `esperaba el ciclo anterior, fue "${c.label}"`);
  }
  // 4. Cruce de año: el año se muestra en el inicio solo si difiere del fin
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 0, 5));
    assert.strictEqual(c.label, '16 Dic 2025 - 15 Ene 2026', `esperaba cruce de año, fue "${c.label}"`);
  }
  // 5. CLAMP: día 31 en febrero no debe desbordar a marzo
  {
    const [c] = generateCycles(1, 31, 30, new Date(2026, 2, 5));
    assert.ok(c.label.startsWith('28 Feb'), `dia 31 en feb debe caer al 28, fue "${c.label}"`);
  }
  // 6. Devuelve exactamente la cantidad pedida, en orden descendente
  {
    const cs = generateCycles(12, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(cs.length, 12, 'deben ser 12 ciclos');
    assert.ok(new Date(cs[0].inicio) > new Date(cs[1].inicio), 'el más reciente va primero');
  }
  // 7. getCurrentPeriod respeta los días que recibe.
  //    Getters UTC: las fechas de ciclo son FECHAS-DÍA (medianoche UTC del día
  //    calendario argentino, ver apps/api/src/utils/fecha-dia.utils.ts). Con
  //    `getDate()` esto daría 15 bajo TZ=AR.
  {
    const p = getCurrentPeriod(16, 15, new Date(2026, 6, 25));
    assert.strictEqual(new Date(p.inicio).getUTCDate(), 16, 'el período actual debe empezar el 16');
  }
  // 8. LA HORA, que es lo que se rompía: `fechaEnMes` armaba las fechas con el
  //    constructor LOCAL de `Date`, así que `inicio`/`fin` salían a las 03:00Z
  //    desde un navegador argentino y el front pedía períodos fuera de la
  //    convención. El DÍA sale bien con las dos implementaciones — sin esta
  //    aserción el bug vuelve sin que nadie se entere.
  {
    const cs = generateCycles(3, 16, 15, new Date(2026, 6, 25));
    for (const c of cs) {
      assertMedianoche(c.inicio, `inicio de "${c.label}"`);
      assertMedianoche(c.fin, `fin de "${c.label}"`);
    }
    const p = getCurrentPeriod(21, 20, new Date(2026, 1, 5));
    assertMedianoche(p.inicio, 'inicio de getCurrentPeriod');
    assertMedianoche(p.fin, 'fin de getCurrentPeriod');
  }
  // 9. El label y el ISO tienen que hablar del MISMO día: si uno se lee en UTC y
  //    el otro en local, se desincronizan en un día y nadie lo nota hasta que
  //    alguien compara la pantalla con el Excel.
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(c.inicio.slice(0, 10), '2026-07-16', `el ISO de inicio debe coincidir con el label "${c.label}"`);
    assert.strictEqual(c.fin.slice(0, 10), '2026-08-15', `el ISO de fin debe coincidir con el label "${c.label}"`);
  }
  console.log('✓ periodos: 9/9 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
