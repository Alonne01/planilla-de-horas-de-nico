/**
 * Suite de la convención de fecha-día.
 *
 * ─── Zona horaria ────────────────────────────────────────────────────────────
 * Casi todas las aserciones de este archivo son aritmética UTC pura, así que por
 * sí solas **pasarían bajo cualquier TZ**. Pero lo que prueban —`finDelDia`,
 * `filtroPeriodoPlanilla`, `estadoVigencia`— son justamente las funciones cuyo
 * bug original sólo se manifiesta con getters locales bajo la TZ de producción:
 * implementar `finDelDia` con el `setHours(23,59,59,999)` viejo da
 * `23:59:59.999Z` en UTC (el test pasaría con el bug adentro) y `02:59:59.999Z`
 * en Argentina (el test falla, que es lo que queremos).
 *
 * Por eso la suite FIJA la TZ a la de producción en vez de heredar la de la
 * máquina: en un runner en la nube, que por defecto corre en UTC, si no la
 * fijáramos estos casos dejarían de distinguir el bug — y como `apps/api` no
 * tiene ESLint, `tsc` y estos tests son toda la red.
 *
 * Se fija acá adentro (y no con `TZ=... npx tsx` por fuera) para que no dependa
 * de que quien la corre se acuerde. El assert de `run()` no es redundante: si el
 * build de ICU no conoce la zona, Node cae a UTC EN SILENCIO, y ahí la suite
 * volvería a pasar con el bug adentro. Con el assert, eso es un fallo ruidoso.
 */
import nodeAssert from 'node:assert';
import {
  claveFecha,
  diaDesdeEntrada,
  mismoDia,
  dentroDelRango,
  hoyLocalEmpresa,
  diaLocalEmpresaDe,
  rangoConsultaDia,
  finDelDia,
  fmtFechaDia,
  fmtFechaDiaCorta,
} from '../src/utils/fecha-dia.utils.js';
import { fechaDia, spanDiasCalendario } from '../src/utils/zod.utils.js';
import {
  periodoQuerySchema,
  filtroPeriodoPlanilla,
  filtroFechaInicioEnPeriodo,
  filtroDiaExacto,
} from '../src/utils/periodo-query.utils.js';
import { estadoVigencia } from '../src/utils/capacitacion-vigencia.utils.js';

// Ver el encabezado del archivo. Va acá arriba de todo (antes de que se
// construya cualquier Date o Intl) porque Node reconstruye su caché de zona
// horaria recién cuando se reasigna `process.env.TZ`.
process.env.TZ = 'America/Argentina/Buenos_Aires';

/**
 * `node:assert` envuelto para llevar la cuenta REAL de aserciones ejecutadas.
 *
 * El total que imprime el final del archivo era un literal escrito a mano, que
 * ya se había desalineado una vez: no verificaba nada, y si alguien borraba un
 * `assert` seguía anunciando el mismo número. Envolver acá evita tocar las casi
 * cien líneas de aserciones que ya existen.
 */
let aserciones = 0;
const assert = {
  strictEqual(actual: unknown, esperado: unknown, msg?: string) {
    aserciones++; nodeAssert.strictEqual(actual, esperado, msg);
  },
  notStrictEqual(actual: unknown, esperado: unknown, msg?: string) {
    aserciones++; nodeAssert.notStrictEqual(actual, esperado, msg);
  },
  deepStrictEqual(actual: unknown, esperado: unknown, msg?: string) {
    aserciones++; nodeAssert.deepStrictEqual(actual, esperado, msg);
  },
  ok(valor: unknown, msg?: string) {
    aserciones++; nodeAssert.ok(valor, msg);
  },
  throws(fn: () => unknown, error?: ErrorConstructor, msg?: string) {
    aserciones++; nodeAssert.throws(fn, error, msg);
  },
};

/**
 * Evalúa un filtro `{ gte, lte }` igual que el `where` de Prisma, para poder
 * probar los filtros de período por su COMPORTAMIENTO (qué filas sobreviven) y
 * no sólo comparando sus bordes contra un ISO literal — que una vez fijado con
 * `strictEqual` vuelve tautológico todo `assert.ok(fila >= filtro.gte)` que
 * venga después.
 */
function pasaFiltro(valor: Date, f?: { gte?: Date; lte?: Date }): boolean {
  if (!f) return true;
  if (f.gte && valor < f.gte) return false;
  if (f.lte && valor > f.lte) return false;
  return true;
}

async function run() {
  // 0. La suite tiene que correr bajo la TZ de producción (ver encabezado). Si
  //    el build de ICU no conoce la zona, Node cae a UTC sin avisar y los casos
  //    de abajo dejan de distinguir el bug que fijan.
  //
  //    Se verifica el COMPORTAMIENTO, no el nombre: ICU canonicaliza
  //    'America/Argentina/Buenos_Aires' a 'America/Buenos_Aires', así que
  //    comparar contra el string del Dockerfile fallaría con la zona correcta
  //    puesta. Lo que estos tests necesitan es exactamente esto: UTC-3 sin
  //    horario de verano, o sea que leer una medianoche UTC con getters locales
  //    devuelva el día anterior.
  const zonaResuelta = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pista = `El proceso resolvió la zona '${zonaResuelta}'. Esta suite necesita la de producción `
    + '(America/Argentina/Buenos_Aires, ver Dockerfile): bajo otra zona, los casos de fecha-día '
    + 'pasan igual con el bug adentro y dejan de servir como red.';
  // Invierno y verano del hemisferio sur: Argentina no observa horario de
  // verano, así que las dos puntas tienen que dar el mismo offset de 180 min.
  assert.strictEqual(new Date('2026-07-21T00:00:00.000Z').getTimezoneOffset(), 180, pista);
  assert.strictEqual(new Date('2026-01-15T00:00:00.000Z').getTimezoneOffset(), 180, pista);
  // La consecuencia concreta, que es lo que rompía el código viejo.
  assert.strictEqual(new Date('2026-07-21T00:00:00.000Z').getDate(), 20, pista);

  // 1. Fecha-sola: el día es literal, no se le aplica ningún offset.
  assert.strictEqual(diaDesdeEntrada('2026-07-31').toISOString(), '2026-07-31T00:00:00.000Z');

  // 2. Medianoche argentina (lo que manda hoy el front) → día 31, no 30.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T03:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 3. Mediodía argentino (lo que manda hoy la planilla) → mismo día.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T15:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 4. Medianoche UTC exacta YA es la convención de destino: se devuelve igual.
  //    Restarle el offset la correría al día anterior y rompería todo lo migrado.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T00:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 5. Offset explícito -03:00 (formato que puede mandar un cliente).
  assert.strictEqual(diaDesdeEntrada('2026-07-31T00:00:00-03:00').toISOString(), '2026-07-31T00:00:00.000Z');

  // 6. Las últimas 3 horas del día argentino: en UTC ya es el día siguiente,
  //    pero para el usuario sigue siendo el 31.
  assert.strictEqual(diaDesdeEntrada('2026-08-01T02:59:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 7. Acepta Date además de string.
  assert.strictEqual(diaDesdeEntrada(new Date('2026-07-31T15:00:00.000Z')).toISOString(), '2026-07-31T00:00:00.000Z');

  // 8. Entrada inválida: falla fuerte, no devuelve Invalid Date.
  assert.throws(() => diaDesdeEntrada('no-es-fecha'), RangeError);

  // 9. claveFecha sigue funcionando con las tres convenciones viejas.
  assert.strictEqual(claveFecha(new Date('2026-07-31T00:00:00.000Z')), '2026-07-31');
  assert.strictEqual(claveFecha(new Date('2026-07-31T03:00:00.000Z')), '2026-07-31');
  assert.strictEqual(claveFecha(new Date('2026-07-31T15:00:00.000Z')), '2026-07-31');

  // 10. mismoDia compara por día calendario, no por instante.
  assert.strictEqual(mismoDia(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T15:00:00.000Z')), true);
  assert.strictEqual(mismoDia(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')), false);

  // 11. dentroDelRango es inclusivo en los dos extremos — el bug del primer día
  //     del período era exactamente esto (00:00Z < 03:00Z daba "afuera").
  const ini = new Date('2026-07-16T03:00:00.000Z');
  const fin = new Date('2026-08-15T03:00:00.000Z');
  assert.strictEqual(dentroDelRango(new Date('2026-07-16T00:00:00.000Z'), ini, fin), true);
  assert.strictEqual(dentroDelRango(new Date('2026-08-15T00:00:00.000Z'), ini, fin), true);
  assert.strictEqual(dentroDelRango(new Date('2026-07-15T00:00:00.000Z'), ini, fin), false);
  assert.strictEqual(dentroDelRango(new Date('2026-08-16T00:00:00.000Z'), ini, fin), false);

  // 12. El día de negocio de un instante: a las 00:00Z en Argentina todavía es
  //     ayer. Este borde se rompía cuando hoyLocalEmpresa reusaba diaDesdeEntrada.
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T00:00:00.000Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T00:00:00.001Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T02:59:59.999Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T03:00:00.000Z'))), '2026-07-31');
  assert.strictEqual(hoyLocalEmpresa().getTime() % 86_400_000, 0);

  // 13. fechaDia devuelve un Date ya normalizado, no un string.
  const parseado = fechaDia.parse('2026-07-31T03:00:00.000Z');
  assert.ok(parseado instanceof Date);
  assert.strictEqual(parseado.toISOString(), '2026-07-31T00:00:00.000Z');

  // 14. fechaDia rechaza basura con el mismo mensaje que fechaFlexible.
  assert.strictEqual(fechaDia.safeParse('31/07/2026').success, false);

  // 14b. Un día que no existe pero que Date.parse acepta rodando al mes siguiente
  //      ('2026-02-29' → 1 de marzo) tiene que dar error de validación, no una
  //      excepción: si el transform lanza, se escapa de safeParse y la ruta da 500.
  assert.strictEqual(fechaDia.safeParse('2026-02-29').success, false);
  assert.strictEqual(fechaDia.safeParse('2026-04-31').success, false);

  // 15. spanDiasCalendario acepta Date (además de string) y es inclusivo.
  assert.strictEqual(spanDiasCalendario('2026-07-28', '2026-07-29'), 2);
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-28T00:00:00.000Z'), new Date('2026-07-29T00:00:00.000Z')),
    2,
  );
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T00:00:00.000Z')),
    1,
  );

  // 16. Una fecha malformada NO puede hacer explotar el refine que la usa: el
  //     endpoint tiene que contestar 400 (validación), no 500 (excepción).
  assert.ok(Number.isNaN(spanDiasCalendario('31/07/2026', '31/07/2026')));

  // 17. El atajo de fecha-sola también valida: un día que no existe no puede
  //     colarse como el día siguiente.
  assert.throws(() => diaDesdeEntrada('2026-13-45'), RangeError);
  assert.throws(() => diaDesdeEntrada('2026-02-30'), RangeError);

  // 18. Entrada inválida también con un Date (antes sólo se probaba con string).
  assert.throws(() => diaDesdeEntrada(new Date('no-es-fecha')), RangeError);

  // 19. diaDesdeEntrada nunca devuelve el mismo objeto que recibió: buildDaysBetween
  //     depende de esto para poder mutar el resultado con setUTCDate sin alterar
  //     el Date que le pasaron.
  const original = new Date('2026-07-31T00:00:00.000Z');
  assert.notStrictEqual(diaDesdeEntrada(original), original);

  // 20. Las tres comparaciones del módulo miden el día de la misma manera, también
  //     en la ventana (00:00Z, 03:00Z) donde el día UTC (lo que mide claveFecha
  //     cruda) y el día argentino (lo que mide diaDesdeEntrada) discrepan.
  //     mismoDia/dentroDelRango normalizan antes de comparar para no mezclar las
  //     dos nociones dentro del mismo módulo.
  const enVentana = new Date('2026-08-01T02:00:00.000Z'); // 31/7 23:00 en AR
  assert.strictEqual(claveFecha(diaDesdeEntrada(enVentana)), '2026-07-31');
  assert.strictEqual(mismoDia(enVentana, new Date('2026-07-31T00:00:00.000Z')), true);
  assert.strictEqual(
    dentroDelRango(enVentana, new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T00:00:00.000Z')),
    true,
  );

  // 21. rangoConsultaDia amplía [desde, hasta] al día completo en UTC: el piso baja
  //     a medianoche del día de "desde" y el techo sube a 1 ms antes de la
  //     medianoche siguiente a "hasta". Es lo que hay que usar en el `where` de
  //     Prisma para no perder registros guardados con hora (medianoche argentina,
  //     mediodía, la hora de una aprobación) que caen en esos mismos días.
  const rango = rangoConsultaDia(new Date('2026-07-31T03:00:00.000Z'), new Date('2026-08-15T03:00:00.000Z'));
  assert.strictEqual(rango.desde.toISOString(), '2026-07-31T00:00:00.000Z');
  assert.strictEqual(rango.hasta.toISOString(), '2026-08-15T23:59:59.999Z');

  // 22. rangoConsultaDia sobre un único día: el techo queda 1 ms antes de la
  //     medianoche del día SIGUIENTE, no del mismo día.
  const unDia = rangoConsultaDia(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T00:00:00.000Z'));
  assert.strictEqual(unDia.desde.toISOString(), '2026-07-31T00:00:00.000Z');
  assert.strictEqual(unDia.hasta.toISOString(), '2026-07-31T23:59:59.999Z');

  // 23. El año de una fecha-día sale del día calendario argentino, no del huso
  //     del proceso. Éste es el invariante que hace falta usar getUTCFullYear()
  //     en vez de getFullYear(): el test tiene que demostrar la DIVERGENCIA que
  //     el bug explota, no sólo un valor que también daría un getFullYear()
  //     corriendo en UTC (eso pasaría igual con el código viejo y no cazaría la
  //     regresión). Se simula a mano cómo leería esa misma medianoche UTC un
  //     proceso con TZ=America/Argentina/Buenos_Aires (el huso real, ver
  //     Dockerfile) en vez de depender del TZ de la máquina que corre el test:
  //     restar el offset y leer los componentes UTC del resultado es
  //     exactamente lo que hacen los getters locales bajo ese huso.
  const primeroDeEnero = diaDesdeEntrada('2026-01-01');
  const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;
  const comoLoLeeriaUnProcesoEnArgentina = new Date(primeroDeEnero.getTime() - OFFSET_ARGENTINA_MS);
  assert.strictEqual(primeroDeEnero.getUTCFullYear(), 2026);
  assert.strictEqual(comoLoLeeriaUnProcesoEnArgentina.getUTCFullYear(), 2025);
  assert.notStrictEqual(primeroDeEnero.getUTCFullYear(), comoLoLeeriaUnProcesoEnArgentina.getUTCFullYear());

  // 24. fmtFechaDia formatea desde la clave UTC (D/M/YYYY, sin ceros a la
  //     izquierda), no con toLocaleDateString(): bajo TZ=America/Argentina/
  //     Buenos_Aires, toLocaleDateString() leería un día antes.
  assert.strictEqual(fmtFechaDia(diaDesdeEntrada('2026-07-31')), '31/7/2026');
  assert.strictEqual(fmtFechaDia(diaDesdeEntrada('2026-01-05')), '5/1/2026');
  // Acepta también una fecha-día que llegó con hora (medianoche o mediodía
  // argentino), no sólo la medianoche UTC exacta.
  assert.strictEqual(fmtFechaDia(diaDesdeEntrada('2026-07-31T15:00:00.000Z')), '31/7/2026');

  // 25. fmtFechaDiaCorta: DD/MM con ceros a la izquierda, sin año — el formato
  //     que ya usaban mis-solicitudes.routes.ts y export.routes.ts para rangos.
  assert.strictEqual(fmtFechaDiaCorta(diaDesdeEntrada('2026-07-05')), '05/07');
  assert.strictEqual(fmtFechaDiaCorta(diaDesdeEntrada('2026-01-31')), '31/01');

  // 25b. El ÚNICO call site donde la salida visible cambió: la columna "Fecha"
  //      de las hojas por empleado del Excel de cierre (export.routes.ts, `fmtDate`).
  //      Antes se formateaba con toLocaleDateString('es-AR', { day: '2-digit',
  //      month: '2-digit' }), que en es-AR NO zero-paddea (el skeleton `Md`
  //      resuelve al patrón `d/M` y descarta el ancho pedido): mostraba `5/7`.
  //      El zero-padding es intencional; este test lo fija para que un futuro
  //      "simplificá esto con toLocaleDateString" no lo revierta en silencio.
  assert.strictEqual(fmtFechaDiaCorta(new Date('2026-07-05T00:00:00.000Z')), '05/07');
  assert.notStrictEqual(fmtFechaDiaCorta(new Date('2026-07-05T00:00:00.000Z')), '5/7');

  // 26. finDelDia: el techo de un filtro de Prisma es el último instante del día
  //     ARGENTINO pedido. Reemplaza a `fin.setHours(23,59,59,999)`, que bajo
  //     TZ=America/Argentina/Buenos_Aires daba 02:59:59.999Z del día SIGUIENTE.
  assert.strictEqual(finDelDia(new Date('2026-08-20T00:00:00.000Z')).toISOString(), '2026-08-20T23:59:59.999Z');
  assert.strictEqual(finDelDia(new Date('2026-08-20T03:00:00.000Z')).toISOString(), '2026-08-20T23:59:59.999Z');
  assert.strictEqual(finDelDia(new Date('2026-08-20T15:00:00.000Z')).toISOString(), '2026-08-20T23:59:59.999Z');

  // 27. El schema de query normaliza el payload REAL del front (medianoche
  //     argentina = 03:00Z) a fecha-día, y descarta las claves que no son suyas.
  const q = periodoQuerySchema.parse({
    periodoInicio: '2026-07-21T03:00:00.000Z',
    periodoFin: '2026-08-20T03:00:00.000Z',
    tipo: 'VACACIONES',
    scope: 'mio',
  });
  assert.strictEqual(q.periodoInicio!.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.strictEqual(q.periodoFin!.toISOString(), '2026-08-20T00:00:00.000Z');
  assert.strictEqual((q as Record<string, unknown>).tipo, undefined);

  // 28. Los dos bordes son opcionales por separado, la cadena vacía se ignora
  //     (antes las rutas gateaban con `if (periodoInicio)`), y la basura da
  //     error de validación en vez de un Invalid Date que rompe a Prisma.
  assert.strictEqual(periodoQuerySchema.parse({}).periodoInicio, undefined);
  assert.strictEqual(periodoQuerySchema.parse({ periodoInicio: '' }).periodoInicio, undefined);
  assert.strictEqual(periodoQuerySchema.safeParse({ periodoInicio: '21/07/2026' }).success, false);
  assert.strictEqual(periodoQuerySchema.safeParse({ periodoFin: 'no-es-fecha' }).success, false);

  // 29. EL BUG, probado por comportamiento: qué planillas sobreviven al filtro.
  //     Con el payload del front, el piso era 03:00Z (una planilla del primer
  //     día del ciclo, ya normalizada a 00:00Z, quedaba AFUERA) y el techo
  //     02:59:59.999Z del día siguiente (entraba un día de más).
  //
  //     Se compara el CONJUNTO de ids que pasan, no cada fila por separado:
  //     así el caso también caza que se pierda un borde, que se inviertan
  //     `gte`/`lte`, o que se filtre por la columna equivocada — cosas que un
  //     `assert.ok(fila >= filtro.gte)` no puede ver, porque una vez fijado
  //     `gte` con `strictEqual` esa comparación es una tautología aritmética.
  const fPlanilla = filtroPeriodoPlanilla(q);
  assert.strictEqual(fPlanilla.periodoInicio!.gte!.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.strictEqual(fPlanilla.periodoFin!.lte!.toISOString(), '2026-08-20T23:59:59.999Z');

  // Planillas de prueba: el ciclo pedido en las tres convenciones que conviven
  // en la base, el ciclo anterior y el siguiente.
  const planillas = [
    { id: 'ciclo-pedido-migrada', ini: '2026-07-21T00:00:00.000Z', fin: '2026-08-20T00:00:00.000Z' },
    { id: 'ciclo-pedido-medianoche-ar', ini: '2026-07-21T03:00:00.000Z', fin: '2026-08-20T03:00:00.000Z' },
    { id: 'ciclo-pedido-mediodia', ini: '2026-07-21T15:00:00.000Z', fin: '2026-08-20T15:00:00.000Z' },
    { id: 'ciclo-anterior', ini: '2026-06-21T00:00:00.000Z', fin: '2026-07-20T00:00:00.000Z' },
    { id: 'ciclo-siguiente', ini: '2026-08-21T00:00:00.000Z', fin: '2026-09-20T00:00:00.000Z' },
  ];
  const sobreviven = planillas
    .filter((p) => pasaFiltro(new Date(p.ini), fPlanilla.periodoInicio)
      && pasaFiltro(new Date(p.fin), fPlanilla.periodoFin))
    .map((p) => p.id);
  assert.deepStrictEqual(
    sobreviven,
    ['ciclo-pedido-migrada', 'ciclo-pedido-medianoche-ar', 'ciclo-pedido-mediodia'],
    'el filtro tiene que devolver el ciclo pedido en las tres convenciones, y sólo ese',
  );

  // 30. Cada borde del filtro de planillas se aplica por separado, y el que
  //     falta deja pasar todo de ese lado (no corta la consulta entera).
  assert.deepStrictEqual(filtroPeriodoPlanilla({}), {});
  const soloInicio = filtroPeriodoPlanilla({ periodoInicio: diaDesdeEntrada('2026-07-21') });
  assert.strictEqual(soloInicio.periodoFin, undefined);
  assert.deepStrictEqual(
    planillas
      .filter((p) => pasaFiltro(new Date(p.ini), soloInicio.periodoInicio)
        && pasaFiltro(new Date(p.fin), soloInicio.periodoFin))
      .map((p) => p.id),
    ['ciclo-pedido-migrada', 'ciclo-pedido-medianoche-ar', 'ciclo-pedido-mediodia', 'ciclo-siguiente'],
    'sin borde superior tiene que entrar también todo lo posterior',
  );

  // 30b. La función normaliza sus propias puntas y no depende de que el
  //      llamador ya lo haya hecho: pasarle un `periodoInicio` leído de la base
  //      todavía sin migrar (`03:00Z`) tiene que dar el MISMO filtro que
  //      pasarle la fecha-día, y no perder las filas ya migradas a `00:00Z`.
  assert.deepStrictEqual(
    filtroPeriodoPlanilla({
      periodoInicio: new Date('2026-07-21T03:00:00.000Z'),
      periodoFin: new Date('2026-08-20T15:00:00.000Z'),
    }),
    fPlanilla,
  );

  // 31. El filtro por fechaInicio (ausencias/vacaciones) necesita los dos bordes
  //     —con uno solo quedaba abierto y devolvía historia entera— y cubre el día
  //     completo en las dos puntas.
  assert.deepStrictEqual(filtroFechaInicioEnPeriodo({ periodoInicio: diaDesdeEntrada('2026-07-21') }), {});
  const fFecha = filtroFechaInicioEnPeriodo(q);
  assert.strictEqual(fFecha.fechaInicio!.gte!.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.strictEqual(fFecha.fechaInicio!.lte!.toISOString(), '2026-08-20T23:59:59.999Z');

  // 32. El span de días con datos MIXTOS pre/post migración (inicio ya
  //     normalizado a 00:00Z, fin todavía con la medianoche argentina 03:00Z).
  //     El `Math.ceil(diff / MS_POR_DIA) + 1` que reimplementaba este helper en
  //     vacaciones.routes.ts daba ceil(2.125) + 1 = 4 días para un rango de 3, y
  //     ese día de más se descontaba del saldo de vacaciones.
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-21T00:00:00.000Z'), new Date('2026-07-23T03:00:00.000Z')),
    3,
  );
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-21T03:00:00.000Z'), new Date('2026-07-23T00:00:00.000Z')),
    3,
  );

  // 33. filtroDiaExacto: reemplaza a la igualdad exacta `columna: new Date(x)`
  //     de POST /exportaciones/cierre. Sigue siendo "ese día y no otro", pero
  //     matchea las filas guardadas con cualquiera de las tres convenciones
  //     viejas mientras la migración de datos no corra.
  const diaExacto = filtroDiaExacto(diaDesdeEntrada('2026-07-21T03:00:00.000Z'));
  assert.strictEqual(diaExacto.gte.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.strictEqual(diaExacto.lte.toISOString(), '2026-07-21T23:59:59.999Z');

  // Como en el 29, se prueba por comportamiento y sobre las DOS columnas a la
  // vez, que es como lo usa el cierre. Lo que hay que demostrar es que el rango
  // de un día no ensanchó la semántica de la igualdad exacta que reemplazó: una
  // planilla que arranca el mismo día pero termina otro NO es el mismo período
  // y no se puede cerrar de arrastre.
  const cierreIni = filtroDiaExacto(diaDesdeEntrada('2026-07-21'));
  const cierreFin = filtroDiaExacto(diaDesdeEntrada('2026-08-20'));
  const candidatas = [
    ...planillas,
    { id: 'mismo-inicio-otro-fin', ini: '2026-07-21T00:00:00.000Z', fin: '2026-08-19T00:00:00.000Z' },
    { id: 'otro-inicio-mismo-fin', ini: '2026-07-22T03:00:00.000Z', fin: '2026-08-20T00:00:00.000Z' },
  ];
  assert.deepStrictEqual(
    candidatas
      .filter((p) => pasaFiltro(new Date(p.ini), cierreIni) && pasaFiltro(new Date(p.fin), cierreFin))
      .map((p) => p.id),
    ['ciclo-pedido-migrada', 'ciclo-pedido-medianoche-ar', 'ciclo-pedido-mediodia'],
    'el cierre tiene que tomar ese período en las tres convenciones, y ningún período vecino',
  );

  // 34. El estado de vigencia de una capacitación se mide por día calendario,
  //     no contra el instante `new Date()`. El caso que fallaba: el 26/7 a las
  //     23:00 hora argentina (= 27/7 02:00Z), un certificado que vence el 26/7
  //     daba ceil(-1.083) = -1 → "vencida", cuando en Argentina todavía es el 26
  //     y vence recién esa noche.
  const hoy26 = diaLocalEmpresaDe(new Date('2026-07-27T02:00:00.000Z')); // 26/7 23:00 AR
  assert.strictEqual(claveFecha(hoy26), '2026-07-26');
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-07-26'), 30, hoy26), 'proxima');
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-07-25'), 30, hoy26), 'vencida');
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-08-25'), 30, hoy26), 'proxima');
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-08-26'), 30, hoy26), 'vigente');
  assert.strictEqual(estadoVigencia(null, 30, hoy26), 'sin_vencimiento');
  // Tolera las filas viejas sin migrar (medianoche argentina / mediodía).
  assert.strictEqual(estadoVigencia(new Date('2026-07-26T03:00:00.000Z'), 30, hoy26), 'proxima');
  assert.strictEqual(estadoVigencia(new Date('2026-07-25T15:00:00.000Z'), 30, hoy26), 'vencida');
  // alertaDias = 0: sólo el mismo día avisa.
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-07-26'), 0, hoy26), 'proxima');
  assert.strictEqual(estadoVigencia(diaDesdeEntrada('2026-07-27'), 0, hoy26), 'vigente');

  console.log(`✓ fecha-dia: ${aserciones} aserciones OK (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
}

run().catch((e) => { console.error(e); process.exit(1); });
