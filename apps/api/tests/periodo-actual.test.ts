import assert from 'node:assert';
import { getPeriodoActual } from '../src/utils/calculo.utils.js';

// getPeriodoActual arma las fechas de período con `new Date(anio, mes, dia)`.
// El día de inicio/fin lo elige el usuario en Admin > Config (admin.config.routes.ts
// acepta 1-31), así que un día alto en un mes corto (ej. 31 en febrero) desborda
// al mes siguiente si no se recorta — el mismo problema que ya resolvía
// `fechaEnMes` en apps/web/src/utils/periodos.ts. Este test verifica que el
// backend ahora recorta igual, y que la config vigente (16/15) y la vieja (21/20)
// no cambiaron de resultado.

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function run() {
  // 1. Día que NO desborda (config vigente 16/15). Hoy = 20/jul/2026 (>= diaInicio
  //    16) → segunda mitad: inicio = 16/jul, fin = 15/ago. Ningún mes tiene menos
  //    de 16 ni de 15 días, así que el recorte no debe alterar nada.
  {
    const hoy = new Date(2026, 6, 20); // 20 jul 2026
    const { inicio, fin } = getPeriodoActual(16, 15, hoy);
    assert.strictEqual(ymd(inicio), '2026-07-16', 'inicio 16/15 no desbordante');
    assert.strictEqual(ymd(fin), '2026-08-15', 'fin 16/15 no desbordante');
  }

  // 1b. Misma config, primera mitad del período (hoy < diaInicio).
  {
    const hoy = new Date(2026, 6, 10); // 10 jul 2026, antes del día 16
    const { inicio, fin } = getPeriodoActual(16, 15, hoy);
    assert.strictEqual(ymd(inicio), '2026-06-16', 'inicio 16/15 primera mitad');
    assert.strictEqual(ymd(fin), '2026-07-15', 'fin 16/15 primera mitad');
  }

  // 2. Día que SÍ desborda: diaFin=31 y el ciclo termina en febrero (2026 no es
  //    bisiesto, así que feb tiene 28 días). Sin recorte, `new Date(2026,1,31)`
  //    da 3 de marzo (verificado abajo); con el fix debe quedar en 28/feb.
  {
    const sinRecortar = new Date(2026, 1, 31); // el bug: desborda a marzo
    assert.strictEqual(ymd(sinRecortar), '2026-03-03', 'sanity check: Date sin recortar desborda a marzo');

    const hoy = new Date(2026, 0, 20); // 20 ene 2026 (>= diaInicio 16) → segunda mitad
    const { inicio, fin } = getPeriodoActual(16, 31, hoy);
    assert.strictEqual(ymd(inicio), '2026-01-16', 'inicio no debería desbordar (16 es válido en enero)');
    assert.strictEqual(ymd(fin), '2026-02-28', 'fin debe recortarse al 28/feb, no desbordar a marzo');
  }

  // 3. Config vieja 21/20: 21 y 20 son válidos en cualquier mes, así que el
  //    resultado debe ser IDÉNTICO al que daba la función antes del cambio
  //    (construido a mano con `new Date(anio, mes, dia)` sin ningún recorte).
  {
    // Segunda mitad: hoy = 25 jul 2026 (>= 21)
    const hoy = new Date(2026, 6, 25);
    const { inicio, fin } = getPeriodoActual(21, 20, hoy);
    const inicioEsperado = new Date(2026, 6, 21);
    const finEsperado = new Date(2026, 7, 20);
    assert.strictEqual(inicio.getTime(), inicioEsperado.getTime(), '21/20 segunda mitad: inicio idéntico al de antes');
    assert.strictEqual(fin.getTime(), finEsperado.getTime(), '21/20 segunda mitad: fin idéntico al de antes');
  }
  {
    // Primera mitad: hoy = 5 jul 2026 (< 21)
    const hoy = new Date(2026, 6, 5);
    const { inicio, fin } = getPeriodoActual(21, 20, hoy);
    const inicioEsperado = new Date(2026, 5, 21); // junio
    const finEsperado = new Date(2026, 6, 20);
    assert.strictEqual(inicio.getTime(), inicioEsperado.getTime(), '21/20 primera mitad: inicio idéntico al de antes');
    assert.strictEqual(fin.getTime(), finEsperado.getTime(), '21/20 primera mitad: fin idéntico al de antes');
  }
  {
    // 21/20 también cruzando fin de año, para cubrir el ajuste de mes/año.
    const hoy = new Date(2026, 0, 5); // 5 ene 2026, < 21 → primera mitad, mes anterior = diciembre 2025
    const { inicio, fin } = getPeriodoActual(21, 20, hoy);
    const inicioEsperado = new Date(2025, 11, 21);
    const finEsperado = new Date(2026, 0, 20);
    assert.strictEqual(inicio.getTime(), inicioEsperado.getTime(), '21/20 cruce de año: inicio idéntico al de antes');
    assert.strictEqual(fin.getTime(), finEsperado.getTime(), '21/20 cruce de año: fin idéntico al de antes');
  }

  console.log('✓ periodo-actual: 6/6 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
