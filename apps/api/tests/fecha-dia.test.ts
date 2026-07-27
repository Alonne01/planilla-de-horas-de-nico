import assert from 'node:assert';
import {
  claveFecha,
  diaDesdeEntrada,
  mismoDia,
  dentroDelRango,
  hoyLocalEmpresa,
  diaLocalEmpresaDe,
  rangoConsultaDia,
} from '../src/utils/fecha-dia.utils.js';
import { fechaDia, spanDiasCalendario } from '../src/utils/zod.utils.js';

async function run() {
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

  console.log('✓ fecha-dia: 22/22 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
