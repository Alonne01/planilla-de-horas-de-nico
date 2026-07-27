import assert from 'node:assert';
import { turnoKey } from './turnos';
import type { TramoDiagrama } from './tramosDiagrama';

const LUN_VIE = {
  id: 'diag-lv', nombre: 'Lunes a Viernes', tipo: 'FIJO_SEMANA',
  diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5],
};
const SIETE_X_SIETE = {
  id: 'diag-77', nombre: '7x7', tipo: 'ROTATIVO',
  diasTrabajo: 7, diasDescanso: 7, diasSemana: [],
};

// Tramo abierto (fechaFin: null) que arranca bien en el pasado: cubre "hoy" sin
// importar cuándo corra el test.
function tramoAbierto(diagrama: typeof LUN_VIE | typeof SIETE_X_SIETE, fechaInicio: string): TramoDiagrama[] {
  return [{ diagrama, fechaInicio: `${fechaInicio}T00:00:00.000Z`, fechaFin: null }];
}

async function run() {
  // 1. FIJO_SEMANA: la fecha de alta no cambia qué días son francos → misma clave
  //    aunque las dos personas se hayan asignado en fechas distintas.
  const empA = tramoAbierto(LUN_VIE, '2019-06-01');
  const empB = tramoAbierto(LUN_VIE, '2021-11-23');
  assert.strictEqual(turnoKey(empA), turnoKey(empB));
  assert.notStrictEqual(turnoKey(empA), 'SIN');

  // 2. ROTATIVO en la misma fase del ciclo (14 días después = 1 ciclo 7x7
  //    completo) → mismo patrón de descanso → misma clave.
  const empC = tramoAbierto(SIETE_X_SIETE, '2020-01-01');
  const empD = tramoAbierto(SIETE_X_SIETE, '2020-01-15');
  assert.strictEqual(turnoKey(empC), turnoKey(empD));

  // 3. ROTATIVO desfasado medio ciclo (7 días) → descansan días distintos →
  //    clave distinta.
  const empE = tramoAbierto(SIETE_X_SIETE, '2020-01-08');
  assert.notStrictEqual(turnoKey(empC), turnoKey(empE));

  // 4. Sin tramos (usuario sin diagrama asignado) → 'SIN'
  assert.strictEqual(turnoKey([]), 'SIN');

  console.log('✓ turnos: 4/4 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
