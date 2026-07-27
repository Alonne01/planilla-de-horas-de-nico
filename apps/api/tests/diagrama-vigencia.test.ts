import assert from 'node:assert';
import {
  tramoDelDia,
  esFrancoEnFecha,
  diaAnterior,
  cierreDeAsignacion,
  type TramoDiagrama,
} from '../src/utils/diagrama-vigencia.utils.js';

/** Medianoche UTC de un 'YYYY-MM-DD', igual que guarda la base. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const LUN_VIE = {
  id: 'diag-lv', nombre: 'Lunes a Viernes', tipo: 'FIJO_SEMANA',
  diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5],
};
const SIETE_X_SIETE = {
  id: 'diag-77', nombre: '7x7', tipo: 'ROTATIVO',
  diasTrabajo: 7, diasDescanso: 7, diasSemana: [],
};

/** L-V hasta el 31/07 inclusive; 7x7 desde el 01/08, sin solape. */
const TRAMOS: TramoDiagrama[] = [
  { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: d('2026-07-31') },
  { diagrama: SIETE_X_SIETE, fechaInicio: d('2026-08-01'), fechaFin: null },
];

async function run() {
  // 1. Un día de la primera mitad cae en el tramo viejo
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-07-20'))?.diagrama.id, 'diag-lv');

  // 2. Un día posterior al corte cae en el nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-08-05'))?.diagrama.id, 'diag-77');

  // 3. El día del corte pertenece al tramo NUEVO
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-08-01'))?.diagrama.id, 'diag-77');

  // 4. Con datos viejos que solapan el día del corte, sigue ganando el nuevo:
  //    la asignación anterior se cerraba con la misma fecha en que abre la nueva.
  const solapados: TramoDiagrama[] = [
    { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: d('2026-08-01') },
    { diagrama: SIETE_X_SIETE, fechaInicio: d('2026-08-01'), fechaFin: null },
  ];
  assert.strictEqual(tramoDelDia(solapados, d('2026-08-01'))?.diagrama.id, 'diag-77');

  // 5. Antes del primer tramo no hay diagrama (no inventar el más viejo)
  assert.strictEqual(tramoDelDia(TRAMOS, d('2025-12-31')), null);

  // 6. Sin tramos, ningún día es franco
  assert.strictEqual(esFrancoEnFecha([], d('2026-07-20')), false);

  // 7. FIJO_SEMANA: el domingo 26/07/2026 es franco, el lunes 27 no
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-26')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-27')), false);

  // 8. ROTATIVO: el ciclo se cuenta desde el fechaInicio DEL TRAMO (01/08).
  //    01–07/08 trabaja, 08–14/08 descansa.
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-07')), false);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-08')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-14')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-15')), false);

  // 9. Un día anterior al corte cae en el tramo VIEJO por selección de tramo (la
  //    fecha manda), no en el nuevo. Con FIJO_SEMANA el resultado no depende de
  //    ningún ancla, así que esto prueba selección de tramo, no aislamiento del
  //    ancla entre ROTATIVOS (para eso está el caso 11).
  //    (sábado 25/07 franco por semana fija, no por el ciclo 7x7)
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-25')), true);

  // 10. Tramo sin fechaFin cubre hacia adelante indefinidamente
  assert.strictEqual(tramoDelDia(TRAMOS, d('2027-03-01'))?.diagrama.id, 'diag-77');

  // 11. Dos ROTATIVOS seguidos, con anclas (fechaInicio) distintas: un día del
  //     PRIMER tramo tiene que resolverse con SU PROPIA ancla (01/07), nunca con
  //     la del tramo siguiente (01/08). Se calculó a mano con el algoritmo de
  //     esDiaFrancoSegunDiagrama (ciclo 14 = 7 trabajo + 7 descanso) que ambos
  //     días cambian de resultado según qué ancla se use, así que el assert es
  //     genuinamente discriminante (no decorativo):
  //       - 07-01: offset 0 desde 01/07 → pos 0 → TRABAJA.
  //                offset -31 desde 01/08 → pos 11 → FRANCO. Opuesto.
  //       - 07-08: offset 7 desde 01/07 → pos 7 → FRANCO.
  //                offset -24 desde 01/08 → pos 4 → TRABAJA. Opuesto.
  const dosRotativos: TramoDiagrama[] = [
    { diagrama: { ...SIETE_X_SIETE, id: 'diag-77-a' }, fechaInicio: d('2026-07-01'), fechaFin: d('2026-07-31') },
    { diagrama: { ...SIETE_X_SIETE, id: 'diag-77-b' }, fechaInicio: d('2026-08-01'), fechaFin: null },
  ];
  assert.strictEqual(esFrancoEnFecha(dosRotativos, d('2026-07-01')), false);
  assert.strictEqual(esFrancoEnFecha(dosRotativos, d('2026-07-08')), true);

  // 12. Timestamps reales del mismo día: las rutas que aprueban un cambio cierran
  //     y abren con `new Date()` (la hora de la aprobación), no medianoche UTC.
  //     Con comparación cruda de Date, el tramo nuevo (fechaInicio 15:32:10.150)
  //     queda excluido al preguntar por el día 26/07 a medianoche porque
  //     t.fechaInicio > fecha; el día del cambio se iría con el diagrama VIEJO,
  //     al revés de lo que promete el desempate. Por clave de día, ambos tramos
  //     cubren el 26/07 y gana el nuevo, como en el caso 4.
  const timestampsMismoDia: TramoDiagrama[] = [
    { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: new Date('2026-07-26T15:32:10.100Z') },
    { diagrama: SIETE_X_SIETE, fechaInicio: new Date('2026-07-26T15:32:10.150Z'), fechaFin: null },
  ];
  assert.strictEqual(tramoDelDia(timestampsMismoDia, d('2026-07-26'))?.diagrama.id, 'diag-77');

  // 13. Cruce de medianoche UTC (~21 hs en Buenos Aires): el cierre viejo y la
  //     apertura nueva caen en días de calendario distintos. Con Date crudo, el
  //     26/07 pierde el tramo nuevo (fechaInicio 27/07 > fecha) y el 27/07 pierde
  //     el viejo (fechaFin 26/07 < fecha): ningún tramo cubre el 27, que es
  //     exactamente el bug de "día sin diagrama" que este módulo vino a arreglar.
  //     Por clave de día, cada fecha cae del lado que le corresponde.
  const cruceMedianoche: TramoDiagrama[] = [
    { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: new Date('2026-07-26T23:59:59.900Z') },
    { diagrama: SIETE_X_SIETE, fechaInicio: new Date('2026-07-27T00:00:00.100Z'), fechaFin: null },
  ];
  assert.notStrictEqual(tramoDelDia(cruceMedianoche, d('2026-07-26')), null);
  assert.notStrictEqual(tramoDelDia(cruceMedianoche, d('2026-07-27')), null);
  assert.strictEqual(tramoDelDia(cruceMedianoche, d('2026-07-26'))?.diagrama.id, 'diag-lv');
  assert.strictEqual(tramoDelDia(cruceMedianoche, d('2026-07-27'))?.diagrama.id, 'diag-77');

  // 14. El borde superior no se ensancha de más: un día posterior al cierre del
  //     único tramo (con hora, no medianoche) sigue sin diagrama.
  const cierreConHora: TramoDiagrama[] = [
    { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: new Date('2026-07-26T15:32:10.100Z') },
  ];
  assert.strictEqual(tramoDelDia(cierreConHora, d('2026-07-27')), null);

  // 15. Un día normal: retrocede uno.
  assert.strictEqual(diaAnterior(d('2026-08-02')).toISOString(), d('2026-08-01').toISOString());

  // 16. Cruce de mes: 01/08 → 31/07.
  assert.strictEqual(diaAnterior(d('2026-08-01')).toISOString(), d('2026-07-31').toISOString());

  // 17. Cruce de año: 01/01 → 31/12 del año anterior.
  assert.strictEqual(diaAnterior(d('2026-01-01')).toISOString(), d('2025-12-31').toISOString());

  // 18. No muta el Date recibido: las rutas siguen usando la fecha original
  //     después de calcular el corte, así que una mutación in-place sería un bug
  //     silencioso (fechaInicio de la nueva asignación correría un día para atrás).
  const original = new Date('2026-08-01T15:32:10.100Z');
  const antes = original.getTime();
  diaAnterior(original);
  assert.strictEqual(original.getTime(), antes);

  // 19. Conserva la hora original: las rutas guardan la hora real de la
  //     aprobación/asignación, no medianoche, y tramoDelDia compara por clave de
  //     día — pero igual el valor guardado en la base debe conservar la hora.
  assert.strictEqual(
    diaAnterior(new Date('2026-08-01T15:32:10.100Z')).toISOString(),
    '2026-07-31T15:32:10.100Z',
  );

  // 20. cierreDeAsignacion: caso normal, la entrante arranca al día siguiente de
  //     la saliente → devuelve el día anterior a la entrante (01/08 → 31/07).
  assert.strictEqual(
    cierreDeAsignacion(d('2026-07-01'), d('2026-08-01')).toISOString(),
    d('2026-07-31').toISOString(),
  );

  // 21. cierreDeAsignacion: mismo día calendario que la propia saliente (RRHH
  //     corrige un diagrama mal cargado el mismo día). diaAnterior(entrante) caería
  //     ANTES del propio fechaInicio de la saliente → rango invertido. La guarda
  //     tiene que devolver el fechaInicio de la saliente, no ese día anterior.
  assert.strictEqual(
    cierreDeAsignacion(d('2026-08-01'), d('2026-08-01')).toISOString(),
    d('2026-08-01').toISOString(),
  );

  // 22. cierreDeAsignacion: saliente con hora real (la de la aprobación, no
  //     medianoche) el mismo día calendario que la entrante. La comparación es por
  //     CLAVE DE DÍA, así que sigue devolviendo el propio fechaInicio de la
  //     saliente (con su hora), no un timestamp roto por comparar Date crudo.
  const salienteConHora = new Date('2026-08-01T09:15:00.000Z');
  assert.strictEqual(
    cierreDeAsignacion(salienteConHora, new Date('2026-08-01T18:40:00.000Z')).toISOString(),
    salienteConHora.toISOString(),
  );

  console.log('✓ diagrama-vigencia: 22/22 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
