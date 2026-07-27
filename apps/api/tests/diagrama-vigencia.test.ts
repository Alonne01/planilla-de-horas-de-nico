import assert from 'node:assert';
import {
  tramoDelDia,
  esFrancoEnFecha,
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

  console.log('✓ diagrama-vigencia: 11/11 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
