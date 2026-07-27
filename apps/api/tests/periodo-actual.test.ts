import assert from 'node:assert';
import { getPeriodoActual } from '../src/utils/calculo.utils.js';

// `getPeriodoActual` produce FECHAS-DÍA: el `periodoInicio`/`periodoFin` con el
// que nace cada planilla. Este test cubre dos cosas distintas:
//
//   a) El RECORTE al último día del mes. El día de inicio/fin lo elige el usuario
//      en Admin > Config (admin.config.routes.ts acepta 1-31), así que un día alto
//      en un mes corto (ej. 31 en febrero) desborda al mes siguiente si no se
//      recorta — el mismo problema que ya resolvía `fechaEnMes` en
//      apps/web/src/utils/periodos.ts.
//
//   b) La HORA. La convención del sistema (fecha-dia.utils.ts) es medianoche UTC
//      del día calendario argentino, y `fechaEnMes` armaba las fechas con el
//      constructor LOCAL de `Date`: bajo TZ=America/Argentina/Buenos_Aires eso
//      daba las 03:00Z, así que cada planilla nueva nacía fuera de la convención
//      y deshacía de a poco la migración 20260727173000_normalizar_fechas_dia.
//      Sin las aserciones de hora de más abajo el bug vuelve sin que nadie se
//      entere: el DÍA sale bien con las dos implementaciones.

/** Día de una fecha-día. Getters UTC: leerla en local da el día anterior bajo TZ=AR. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Toda fecha-día tiene que ser medianoche UTC exacta, no 03:00Z ni 00:00 local. */
function assertMedianoche(d: Date, que: string) {
  assert.ok(
    d.toISOString().endsWith('T00:00:00.000Z'),
    `${que} debe ser medianoche UTC exacta, fue ${d.toISOString()}`,
  );
}

// `hoy` es un INSTANTE real, no una fecha-día: se construye en UTC explícito para
// que el test no dependa de la TZ del proceso (el dev corre en TZ=AR, CI podría
// correr en UTC). 15:00Z = mediodía argentino del mismo día.
function mediodiaAR(iso: string): Date {
  return new Date(`${iso}T15:00:00.000Z`);
}

async function run() {
  let aserciones = 0;
  const chequear = (fn: () => void) => { fn(); aserciones++; };

  // 1. Día que NO desborda (config vigente 16/15). Hoy = 20/jul/2026 (>= diaInicio
  //    16) → segunda mitad: inicio = 16/jul, fin = 15/ago. Ningún mes tiene menos
  //    de 16 ni de 15 días, así que el recorte no debe alterar nada.
  {
    const { inicio, fin } = getPeriodoActual(16, 15, mediodiaAR('2026-07-20'));
    chequear(() => assert.strictEqual(ymd(inicio), '2026-07-16', 'inicio 16/15 no desbordante'));
    chequear(() => assert.strictEqual(ymd(fin), '2026-08-15', 'fin 16/15 no desbordante'));
    chequear(() => assertMedianoche(inicio, 'inicio 16/15 no desbordante'));
    chequear(() => assertMedianoche(fin, 'fin 16/15 no desbordante'));
  }

  // 1b. Misma config, primera mitad del período (hoy < diaInicio).
  {
    const { inicio, fin } = getPeriodoActual(16, 15, mediodiaAR('2026-07-10'));
    chequear(() => assert.strictEqual(ymd(inicio), '2026-06-16', 'inicio 16/15 primera mitad'));
    chequear(() => assert.strictEqual(ymd(fin), '2026-07-15', 'fin 16/15 primera mitad'));
    chequear(() => assertMedianoche(inicio, 'inicio 16/15 primera mitad'));
    chequear(() => assertMedianoche(fin, 'fin 16/15 primera mitad'));
  }

  // 2. Día que SÍ desborda: diaFin=31 y el ciclo termina en febrero (2026 no es
  //    bisiesto, así que feb tiene 28 días). Sin recorte, `Date.UTC(2026,1,31)`
  //    da 3 de marzo (verificado abajo); con el recorte debe quedar en 28/feb.
  {
    const sinRecortar = new Date(Date.UTC(2026, 1, 31)); // el bug: desborda a marzo
    chequear(() => assert.strictEqual(ymd(sinRecortar), '2026-03-03', 'sanity check: Date sin recortar desborda a marzo'));

    const { inicio, fin } = getPeriodoActual(16, 31, mediodiaAR('2026-01-20'));
    chequear(() => assert.strictEqual(ymd(inicio), '2026-01-16', 'inicio no debería desbordar (16 es válido en enero)'));
    chequear(() => assert.strictEqual(ymd(fin), '2026-02-28', 'fin debe recortarse al 28/feb, no desbordar a marzo'));
    chequear(() => assertMedianoche(fin, 'fin recortado a febrero'));
  }

  // 2b. Recorte en un mes de 30 días (abril) y en febrero bisiesto (2028), para
  //     que el recorte no quede probado sólo contra el caso de 28.
  {
    const { fin } = getPeriodoActual(16, 31, mediodiaAR('2026-03-20'));
    chequear(() => assert.strictEqual(ymd(fin), '2026-04-30', 'fin debe recortarse al 30/abr'));
    chequear(() => assertMedianoche(fin, 'fin recortado a abril'));
  }
  {
    const { fin } = getPeriodoActual(16, 31, mediodiaAR('2028-01-20'));
    chequear(() => assert.strictEqual(ymd(fin), '2028-02-29', 'fin debe recortarse al 29/feb en año bisiesto'));
    chequear(() => assertMedianoche(fin, 'fin recortado a febrero bisiesto'));
  }

  // 3. Config vieja 21/20: 21 y 20 son válidos en cualquier mes, así que el
  //    recorte no los toca y el DÍA tiene que ser el mismo de siempre. Lo que sí
  //    cambió respecto de la implementación vieja es la HORA (03:00Z → 00:00Z):
  //    los valores esperados se construyen con `Date.UTC`, no con el constructor
  //    local, justamente porque el local es el bug que se arregló.
  {
    // Segunda mitad: hoy = 25 jul 2026 (>= 21)
    const { inicio, fin } = getPeriodoActual(21, 20, mediodiaAR('2026-07-25'));
    chequear(() => assert.strictEqual(inicio.getTime(), Date.UTC(2026, 6, 21), '21/20 segunda mitad: inicio'));
    chequear(() => assert.strictEqual(fin.getTime(), Date.UTC(2026, 7, 20), '21/20 segunda mitad: fin'));
    chequear(() => assertMedianoche(inicio, '21/20 segunda mitad: inicio'));
    chequear(() => assertMedianoche(fin, '21/20 segunda mitad: fin'));
  }
  {
    // Primera mitad: hoy = 5 jul 2026 (< 21)
    const { inicio, fin } = getPeriodoActual(21, 20, mediodiaAR('2026-07-05'));
    chequear(() => assert.strictEqual(inicio.getTime(), Date.UTC(2026, 5, 21), '21/20 primera mitad: inicio (junio)'));
    chequear(() => assert.strictEqual(fin.getTime(), Date.UTC(2026, 6, 20), '21/20 primera mitad: fin'));
    chequear(() => assertMedianoche(inicio, '21/20 primera mitad: inicio'));
    chequear(() => assertMedianoche(fin, '21/20 primera mitad: fin'));
  }
  {
    // 21/20 también cruzando fin de año, para cubrir el ajuste de mes/año.
    // hoy = 5 ene 2026, < 21 → primera mitad, mes anterior = diciembre 2025.
    const { inicio, fin } = getPeriodoActual(21, 20, mediodiaAR('2026-01-05'));
    chequear(() => assert.strictEqual(inicio.getTime(), Date.UTC(2025, 11, 21), '21/20 cruce de año: inicio'));
    chequear(() => assert.strictEqual(fin.getTime(), Date.UTC(2026, 0, 20), '21/20 cruce de año: fin'));
    chequear(() => assertMedianoche(inicio, '21/20 cruce de año: inicio'));
    chequear(() => assertMedianoche(fin, '21/20 cruce de año: fin'));
  }
  {
    // Y el cruce de año hacia adelante (diciembre → enero), que ejercita el mes 12.
    const { inicio, fin } = getPeriodoActual(21, 20, mediodiaAR('2026-12-25'));
    chequear(() => assert.strictEqual(inicio.getTime(), Date.UTC(2026, 11, 21), 'cruce dic→ene: inicio'));
    chequear(() => assert.strictEqual(fin.getTime(), Date.UTC(2027, 0, 20), 'cruce dic→ene: fin'));
    chequear(() => assertMedianoche(fin, 'cruce dic→ene: fin'));
  }

  // 4. El día que decide la mitad del período es el ARGENTINO, no el UTC. A las
  //    02:00Z del 21 en Argentina todavía son las 23:00 del 20, así que con
  //    diaInicio=21 el período vigente es el que arrancó el mes ANTERIOR. Si
  //    `getPeriodoActual` leyera `hoy` con getters UTC, acá diría 21 y daría el
  //    período siguiente: es el caso que rompe entre las 21:00 y las 24:00.
  {
    const casiMedianocheAR = new Date('2026-07-21T02:00:00.000Z'); // 23:00 del 20/jul en AR
    const { inicio, fin } = getPeriodoActual(21, 20, casiMedianocheAR);
    chequear(() => assert.strictEqual(ymd(inicio), '2026-06-21', '21:00-24:00 AR: sigue en el período anterior'));
    chequear(() => assert.strictEqual(ymd(fin), '2026-07-20', '21:00-24:00 AR: fin del período anterior'));
  }
  {
    // Y tres horas después (05:00Z = 02:00 AR del 21) ya es el período nuevo.
    const madrugadaAR = new Date('2026-07-21T05:00:00.000Z');
    const { inicio } = getPeriodoActual(21, 20, madrugadaAR);
    chequear(() => assert.strictEqual(ymd(inicio), '2026-07-21', 'pasada la medianoche AR: período nuevo'));
  }

  console.log(`✓ periodo-actual: ${aserciones}/${aserciones} OK`);
}

run().catch((e) => { console.error(e); process.exit(1); });
