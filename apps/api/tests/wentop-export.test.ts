import assert from 'node:assert';
import { ubicarFoto, LADO_FOTO_PX } from '../src/utils/wentop-export.utils.js';

// La geometría de las celdas de foto del Excel.
//
// El pedido era explícito: "que las celdas de las fotos se adecuen a 16:9 y 9:16
// … tal vez haciendo todas las celdas cuadradas para que entren sin
// deformarse". Eso se traduce en tres propiedades que este test fija:
//
//   a) NINGUNA foto se deforma: la proporción de salida es la de entrada.
//   b) NINGUNA se sale del cuadrado.
//   c) Cada una queda CENTRADA en su celda.
//
// Son cuentas puras, así que se prueban acá y no abriendo un .xlsx a ojo.

/** Tolerancia en píxeles: `ubicarFoto` redondea a entero. */
function casiIgual(a: number, b: number, tol: number, msg: string) {
  assert(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`);
}

async function run() {
  let aserciones = 0;
  const ok = (fn: () => void) => { fn(); aserciones++; };

  /** El margen esperado, en EMU, para una foto de ese tamaño dentro del cuadrado. */
  const margenEmu = (lado: number) => Math.round(((LADO_FOTO_PX - lado) / 2) * 9525);

  // 1. Apaisada 16:9 → toca los costados, sobra arriba y abajo.
  ok(() => {
    const { ext, tl } = ubicarFoto(1920, 1080, 5, 3);
    assert.strictEqual(ext.width, LADO_FOTO_PX, 'la 16:9 tiene que ocupar todo el ancho');
    casiIgual(ext.width / ext.height, 16 / 9, 0.02, 'la 16:9 se deformó');
    assert(ext.height <= LADO_FOTO_PX, 'se pasó de alto');
    // Pegada a los costados, centrada en vertical.
    assert.strictEqual(tl.nativeCol, 5);
    assert.strictEqual(tl.nativeColOff, 0, 'no debería sobrar margen horizontal');
    assert.strictEqual(tl.nativeRow, 3);
    assert.strictEqual(tl.nativeRowOff, margenEmu(ext.height), 'no quedó centrada en vertical');
  });

  // 2. Vertical 9:16 → toca arriba y abajo, sobra a los costados. Es el caso que
  //    una celda apaisada deformaría o recortaría.
  ok(() => {
    const { ext, tl } = ubicarFoto(1080, 1920, 5, 3);
    assert.strictEqual(ext.height, LADO_FOTO_PX, 'la 9:16 tiene que ocupar todo el alto');
    casiIgual(ext.width / ext.height, 9 / 16, 0.02, 'la 9:16 se deformó');
    assert(ext.width <= LADO_FOTO_PX, 'se pasó de ancho');
    assert.strictEqual(tl.nativeRowOff, 0, 'no debería sobrar margen vertical');
    assert.strictEqual(tl.nativeColOff, margenEmu(ext.width), 'no quedó centrada en horizontal');
  });

  // 3. Cuadrada: llena la celda exacta, sin márgenes.
  ok(() => {
    const { ext, tl } = ubicarFoto(600, 600, 2, 7);
    assert.strictEqual(ext.width, LADO_FOTO_PX);
    assert.strictEqual(ext.height, LADO_FOTO_PX);
    assert.strictEqual(tl.nativeColOff, 0);
    assert.strictEqual(tl.nativeRowOff, 0);
    assert.strictEqual(tl.nativeCol, 2);
    assert.strictEqual(tl.nativeRow, 7);
  });

  // 3b. El margen en EMU es el REAL, no el que sale de la conversión fraccionaria
  //     de ExcelJS. Una 9:16 deja (140-79)/2 = 30,5 px a cada lado = 290512 EMU;
  //     con el `tl` fraccionario ExcelJS escribía 43571 EMU (6,7 veces menos) y la
  //     foto quedaba pegada al borde izquierdo.
  ok(() => {
    const { tl, ext } = ubicarFoto(1080, 1920, 0, 0);
    assert.strictEqual(ext.width, 79);
    assert.strictEqual(tl.nativeColOff, 290513);
  });

  // 4. Una foto MÁS CHICA que la celda tampoco se estira: se agranda sólo hasta
  //    llenar una dimensión, nunca más allá de su proporción.
  ok(() => {
    const { ext } = ubicarFoto(40, 30, 0, 0);
    casiIgual(ext.width / ext.height, 4 / 3, 0.02, 'la chica se deformó');
    assert(ext.width <= LADO_FOTO_PX && ext.height <= LADO_FOTO_PX, 'se pasó del cuadrado');
  });

  // 5. Panorámica extrema: sigue entrando, por finita que quede.
  ok(() => {
    const { ext } = ubicarFoto(4000, 200, 0, 0);
    assert.strictEqual(ext.width, LADO_FOTO_PX);
    assert(ext.height >= 1, `quedó sin alto: ${ext.height}`);
    assert(ext.height <= LADO_FOTO_PX, 'se pasó de alto');
  });

  // 6. Varias fotos de la misma tarjeta van a las columnas de al lado, en la
  //    misma fila: "que se vaya sumando a las celdas de al lado".
  ok(() => {
    const a = ubicarFoto(1920, 1080, 10, 4);
    const b = ubicarFoto(1080, 1920, 11, 4);
    assert.strictEqual(b.tl.nativeCol, a.tl.nativeCol + 1, 'la segunda foto no cayó en la columna siguiente');
    assert.strictEqual(a.tl.nativeRow, b.tl.nativeRow, 'las dos tienen que ir en la misma fila');
  });

  console.log(`✓ wentop-export: ${aserciones}/${aserciones} OK`);
}

run().catch((e) => { console.error(e); process.exit(1); });
