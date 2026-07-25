import assert from 'node:assert';
import { generateCycles, getCurrentPeriod } from './periodos.js';

async function run() {
  // 1. EL BUG REPORTADO: con 16/15 el ciclo actual debe ser 16 Jul - 15 Ago
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '16 Jul - 15 Ago 2026', `esperaba 16/15, fue "${c.label}"`);
  }
  // 2. El comportamiento viejo sigue siendo correcto cuando se piden 21/20
  {
    const [c] = generateCycles(1, 21, 20, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '21 Jul - 20 Ago 2026', `esperaba 21/20, fue "${c.label}"`);
  }
  // 3. Antes del día de inicio, el ciclo vigente es el que arrancó el mes pasado
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 10));
    assert.strictEqual(c.label, '16 Jun - 15 Jul 2026', `esperaba el ciclo anterior, fue "${c.label}"`);
  }
  // 4. Cruce de año: el año se muestra en el inicio solo si difiere del fin
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 0, 5));
    assert.strictEqual(c.label, '16 Dic 2025 - 15 Ene 2026', `esperaba cruce de año, fue "${c.label}"`);
  }
  // 5. CLAMP: día 31 en febrero no debe desbordar a marzo
  {
    const [c] = generateCycles(1, 31, 30, new Date(2026, 2, 5));
    assert.ok(c.label.startsWith('28 Feb'), `dia 31 en feb debe caer al 28, fue "${c.label}"`);
  }
  // 6. Devuelve exactamente la cantidad pedida, en orden descendente
  {
    const cs = generateCycles(12, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(cs.length, 12, 'deben ser 12 ciclos');
    assert.ok(new Date(cs[0].inicio) > new Date(cs[1].inicio), 'el más reciente va primero');
  }
  // 7. getCurrentPeriod respeta los días que recibe
  {
    const p = getCurrentPeriod(16, 15, new Date(2026, 6, 25));
    assert.strictEqual(new Date(p.inicio).getDate(), 16, 'el período actual debe empezar el 16');
  }
  console.log('✓ periodos: 7/7 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
