import assert from 'node:assert';
import { buscarOCrear } from '../prisma/seed-helpers.js';

// Delegado falso: simula una tabla en memoria con findFirst/create de Prisma.
function tablaFalsa(filasIniciales: Record<string, unknown>[] = []) {
  const filas = [...filasIniciales];
  let creaciones = 0;
  return {
    creaciones: () => creaciones,
    filas: () => filas,
    delegado: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        filas.find((f) => Object.entries(where).every(([k, v]) => f[k] === v)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creaciones++;
        const fila = { id: `id-${filas.length + 1}`, ...data };
        filas.push(fila);
        return fila;
      },
    },
  };
}

async function run() {
  // 1. Tabla vacía → crea, y lo informa
  {
    const t = tablaFalsa();
    const { fila, creada } = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    assert.strictEqual(t.creaciones(), 1, 'debe crear cuando no existe');
    assert.strictEqual(creada, true, 'debe informar que la creó');
    assert.strictEqual(fila.nombre, 'WENLEN');
  }
  // 2. Segunda llamada con la misma clave → NO crea, devuelve la existente
  {
    const t = tablaFalsa();
    const a = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    const b = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    assert.strictEqual(t.creaciones(), 1, 'la segunda llamada NO debe crear');
    assert.strictEqual(b.creada, false, 'debe informar que ya existía');
    assert.strictEqual(a.fila.id, b.fila.id, 'debe devolver la misma fila');
    assert.strictEqual(t.filas().length, 1, 'la tabla debe quedar con una sola fila');
  }
  // 3. Clave compuesta: mismo nombre en otra empresa SÍ crea
  {
    const t = tablaFalsa();
    await buscarOCrear(t.delegado, { empresaId: 'e1', nombre: 'Fractura' }, { empresaId: 'e1', nombre: 'Fractura' });
    await buscarOCrear(t.delegado, { empresaId: 'e2', nombre: 'Fractura' }, { empresaId: 'e2', nombre: 'Fractura' });
    assert.strictEqual(t.creaciones(), 2, 'misma clave en otra empresa es otra fila');
  }
  // 4. No pisa los datos existentes: si la fila existe, `data` se ignora
  {
    const t = tablaFalsa([{ id: 'x', empresaId: 'e1', nombre: 'Cfg', valor: 'ORIGINAL' }]);
    const { fila, creada } = await buscarOCrear(t.delegado, { empresaId: 'e1', nombre: 'Cfg' }, { empresaId: 'e1', nombre: 'Cfg', valor: 'NUEVO' });
    assert.strictEqual(fila.valor, 'ORIGINAL', 'no debe pisar el valor existente');
    assert.strictEqual(creada, false);
    assert.strictEqual(t.creaciones(), 0);
  }
  console.log('✓ seed-idempotente: 4/4 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
