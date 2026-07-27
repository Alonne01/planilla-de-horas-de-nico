import assert from 'node:assert';
import { tramoDelDia, francoDelDia, esInicioDeTramo, type TramoDiagrama } from './tramosDiagrama';

/** El backend serializa las fechas de vigencia en ISO; el front las recibe así. */
const LUN_VIE = {
  id: 'diag-lv', nombre: 'Lunes a Viernes', tipo: 'FIJO_SEMANA',
  diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5],
};
const SIETE_X_SIETE = {
  id: 'diag-77', nombre: '7x7', tipo: 'ROTATIVO',
  diasTrabajo: 7, diasDescanso: 7, diasSemana: [],
};

const TRAMOS: TramoDiagrama[] = [
  { diagrama: LUN_VIE, fechaInicio: '2026-01-01T00:00:00.000Z', fechaFin: '2026-07-31T00:00:00.000Z' },
  { diagrama: SIETE_X_SIETE, fechaInicio: '2026-08-01T00:00:00.000Z', fechaFin: null },
];

/** El calendario del front construye los días con `new Date(a, m, d)` (hora local). */
const dia = (y: number, m: number, d: number) => new Date(y, m - 1, d);

async function run() {
  // 1. Sin tramos no hay franco (usuario sin diagrama asignado)
  assert.strictEqual(francoDelDia([], dia(2026, 7, 20)), false);

  // 2. Un día de la primera mitad usa el tramo viejo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 7, 20))?.diagrama.id, 'diag-lv');

  // 3. Un día posterior al corte usa el nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 8, 5))?.diagrama.id, 'diag-77');

  // 4. El día del corte pertenece al tramo nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 8, 1))?.diagrama.id, 'diag-77');

  // 5. FIJO_SEMANA en la primera mitad: domingo franco, lunes no
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 26)), true);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 27)), false);

  // 6. ROTATIVO desde el 01/08: 01–07 trabaja, 08–14 descansa
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 7)), false);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 8)), true);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 15)), false);

  // 7. El sábado previo al corte sigue siendo franco por semana fija, no por ciclo
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 25)), true);

  // 8. Antes del primer tramo no hay diagrama
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2025, 12, 31)), null);

  // 9. El día del corte se detecta para marcarlo en el calendario
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 8, 1)), true);
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 8, 2)), false);
  // El primer tramo no marca corte: no hay nada antes con qué comparar.
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 1, 1)), false);

  console.log('✓ tramosDiagrama: 9/9 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
