import assert from 'node:assert';
import { diasPorAntiguedad } from '../src/utils/vacaciones-antiguedad.utils.js';

// `diasPorAntiguedad` traduce la fecha de ingreso a los días de vacaciones que
// manda la LCT. Es un cálculo con efecto legal, así que este test cubre las tres
// cosas que se pueden romper por separado:
//
//   a) EL HUSO. `fechaIngreso` es una FECHA-DÍA (medianoche UTC del día
//      calendario argentino, ver fecha-dia.utils.ts) y el proceso corre con
//      TZ=America/Argentina/Buenos_Aires (Dockerfile:45). Leerla con getters
//      LOCALES devuelve el día anterior, así que un ingreso del 1 de enero se
//      leía como el 31 de diciembre del año anterior: un año de antigüedad de
//      regalo y 21 días donde correspondían 14. Ése era el bug reportado.
//
//   b) LOS ESCALONES del art. 150 LCT, que son cerrados arriba ("no exceda de
//      cinco años" ⇒ 5 años exactos son 14 días, no 21). Cada límite es un
//      salto de 7 días, así que equivocarse en el `<=` cuesta una semana por
//      persona y por año.
//
//   c) LA INDEPENDENCIA DEL HUSO como invariante estructural. No alcanza con
//      probar la tabla bajo un huso: el resultado tiene que ser idéntico bajo
//      cualquiera. Es la única aserción que caza una vuelta a los getters
//      locales sin depender de dónde se corra el test.
//
// El barrido de husos exige poder cambiar TZ en caliente. Node lo soporta
// (asignar `process.env.TZ` dispara DateTimeConfigurationChangeNotification en
// V8), pero si algún día dejara de funcionar el test tiene que FALLAR, no
// degradarse a un no-op silencioso: por eso `conHuso` verifica que el cambio
// tomó efecto antes de correr nada.

/** Fecha-día tal como la guarda la base: medianoche UTC del día argentino. */
function fechaDia(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Corre `fn` con el huso del proceso forzado, y lo restaura después.
 *
 * Verifica que el cambio realmente tomó efecto (en TZ=AR, medianoche UTC se lee
 * como las 21:00 del día anterior). Si no tomó, lanza: un barrido de husos que
 * en realidad corre todo bajo el mismo huso no prueba nada.
 */
function conHuso<T>(tz: string, horaEsperada: number, fn: () => T): T {
  const previo = process.env.TZ;
  process.env.TZ = tz;
  try {
    const sonda = new Date('2026-01-01T00:00:00.000Z').getHours();
    assert.strictEqual(
      sonda, horaEsperada,
      `No se pudo forzar TZ=${tz} en caliente (getHours dio ${sonda}, esperaba ${horaEsperada}). ` +
      'Sin eso el barrido de husos no prueba nada: correr el test con la variable TZ ya seteada.',
    );
    return fn();
  } finally {
    if (previo === undefined) delete process.env.TZ;
    else process.env.TZ = previo;
  }
}

// Antigüedad medida al 31 de diciembre del año de las vacaciones (LCT art. 150,
// último párrafo). Cada caso dice cuántos años cumplidos da esa combinación.
const CASOS: Array<{ ingreso: string; anio: number; esperado: number; nota: string }> = [
  // El caso reportado: ingreso del 1 de enero. Con getters locales bajo TZ=AR se
  // leía 2020-12-31 → 6 años → 21 días.
  { ingreso: '2021-01-01', anio: 2026, esperado: 14, nota: '1/ene: 5 años cumplidos, no 6' },
  { ingreso: '2021-01-01', anio: 2027, esperado: 21, nota: '1/ene: al año siguiente sí son 6' },
  // Los otros dos escalones, también con ingreso del 1 de enero: ahí el año de
  // más empujaba al tramo siguiente y regalaba 7 días.
  { ingreso: '2016-01-01', anio: 2026, esperado: 21, nota: '1/ene: 10 años exactos siguen siendo 21' },
  { ingreso: '2006-01-01', anio: 2026, esperado: 28, nota: '1/ene: 20 años exactos siguen siendo 28' },

  // Escalones del art. 150 con una fecha de ingreso interior al año (donde el
  // bug de huso no llegaba a cambiar el año).
  { ingreso: '2021-06-15', anio: 2026, esperado: 14, nota: '5 años: no excede de 5 → 14' },
  { ingreso: '2020-06-15', anio: 2026, esperado: 21, nota: '6 años: mayor de 5 → 21' },
  { ingreso: '2016-06-15', anio: 2026, esperado: 21, nota: '10 años: no excede de 10 → 21' },
  { ingreso: '2015-06-15', anio: 2026, esperado: 28, nota: '11 años: mayor de 10 → 28' },
  { ingreso: '2006-06-15', anio: 2026, esperado: 28, nota: '20 años: no excede de 20 → 28' },
  { ingreso: '2005-06-15', anio: 2026, esperado: 35, nota: '21 años: excede de 20 → 35' },

  // Bordes del calendario: el 31 de diciembre es el día en que se mide, y el
  // ingreso de ese mismo día ya cuenta el año completo.
  { ingreso: '2015-12-31', anio: 2026, esperado: 28, nota: '31/dic: 11 años' },
  { ingreso: '2026-12-31', anio: 2026, esperado: 14, nota: 'ingreso el día mismo del corte: 0 años' },
  { ingreso: '2026-03-10', anio: 2026, esperado: 14, nota: 'ingresó este año: 0 años' },
  // Un 29 de febrero no tiene aniversario todos los años; el cálculo no puede
  // depender de que exista.
  { ingreso: '2020-02-29', anio: 2026, esperado: 21, nota: '29/feb: 6 años' },
  // Fecha de ingreso futura (el alta de usuarios la acepta): la antigüedad no
  // puede quedar negativa ni caer fuera de la escala.
  { ingreso: '2027-05-01', anio: 2026, esperado: 14, nota: 'ingreso futuro: piso en 0 años' },
];

async function run() {
  let aserciones = 0;
  const chequear = (fn: () => void) => { fn(); aserciones++; };

  // 1. La tabla completa bajo el huso en el que corre la aplicación.
  conHuso('America/Argentina/Buenos_Aires', 21, () => {
    for (const c of CASOS) {
      chequear(() => assert.strictEqual(
        diasPorAntiguedad(fechaDia(c.ingreso), c.anio), c.esperado,
        `${c.ingreso} para ${c.anio} → ${c.esperado} días (${c.nota})`,
      ));
    }
  });

  // 2. Invariante estructural: el resultado NO puede depender del huso del
  //    proceso. UTC (donde el bug no se manifestaba) y Tokio (offset positivo,
  //    donde una fecha-día leída en local se corre al día SIGUIENTE).
  for (const [tz, hora] of [['UTC', 0], ['Asia/Tokyo', 9]] as const) {
    conHuso(tz, hora, () => {
      for (const c of CASOS) {
        chequear(() => assert.strictEqual(
          diasPorAntiguedad(fechaDia(c.ingreso), c.anio), c.esperado,
          `bajo TZ=${tz}, ${c.ingreso} para ${c.anio} tiene que dar lo mismo: ${c.esperado}`,
        ));
      }
    });
  }

  // 3. Las tres convenciones históricas que conviven en bases sin migrar tienen
  //    que dar el mismo resultado que la fecha-día normalizada: 03:00Z era la
  //    medianoche argentina y 15:00Z el mediodía local que mandaba la planilla.
  //    (Ver la cabecera de la migración 20260727173000_normalizar_fechas_dia.)
  conHuso('America/Argentina/Buenos_Aires', 21, () => {
    const normalizada = diasPorAntiguedad(fechaDia('2021-01-01'), 2026);
    for (const hora of ['03:00', '15:00', '23:30']) {
      chequear(() => assert.strictEqual(
        diasPorAntiguedad(new Date(`2021-01-01T${hora}:00.000Z`), 2026), normalizada,
        `un ingreso guardado a las ${hora}Z del 1/1/2021 es el mismo día que la fecha-día normalizada`,
      ));
    }
  });

  console.log(`✓ dias-antiguedad: ${aserciones}/${aserciones} OK`);
}

run().catch((e) => { console.error(e); process.exit(1); });
