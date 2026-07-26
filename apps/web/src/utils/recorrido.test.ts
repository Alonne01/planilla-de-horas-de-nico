import assert from 'node:assert';
import {
  enriquecerPasos,
  pasosDe,
  type FirmaHistorial,
  type PasoDocumento,
} from './circuito.js';

/**
 * Los mismos casos que `apps/api/tests/recorrido.test.ts`. La única diferencia
 * con el back es el tipo de `createdAt` (string acá, Date allá): el criterio de
 * cruce con el historial tiene que ser idéntico, porque las dos reconstrucciones
 * se ven en pantallas distintas del mismo documento.
 */

/** El circuito congelado de un documento: Supervisor → Coordinador → RRHH. */
const CIRCUITO: PasoDocumento[] = [
  { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR' },
  { orden: 2, nombrePaso: 'Aprobación Coordinador', rolAprobador: 'COORDINADOR' },
  { orden: 3, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH' },
];

const ts = (min: number) => new Date(2026, 6, 25, 10, min).toISOString();

/** Fila del criterio NUEVO: `pasoFlujo` es el paso que se firmó. */
function firma(paso: number, rol: string, nombre: string, min: number): FirmaHistorial {
  return {
    pasoFlujo: paso,
    rolAprobador: rol,
    estadoNuevo: 'EN_REVISION',
    comentario: null,
    createdAt: ts(min),
    usuario: { nombre, apellido: 'Pérez' },
  };
}

/** Fila del criterio VIEJO: sin rol y con el paso DESTINO (firmado + 1). */
function firmaVieja(destino: number, nombre: string, min: number): FirmaHistorial {
  return {
    pasoFlujo: destino,
    rolAprobador: null,
    estadoNuevo: 'EN_REVISION',
    comentario: null,
    createdAt: ts(min),
    usuario: { nombre, apellido: 'Gómez' },
  };
}

async function run() {
  // 1. Criterio nuevo: cada firma se le atribuye al paso que firmó
  {
    const r = enriquecerPasos(CIRCUITO, 3, [firma(1, 'SUPERVISOR', 'Ana', 0), firma(2, 'COORDINADOR', 'Beto', 5)]);
    assert.strictEqual(r[0].aprobadoPor?.nombre, 'Ana');
    assert.strictEqual(r[1].aprobadoPor?.nombre, 'Beto');
    assert.strictEqual(r[2].aprobadoPor, null, 'el paso en curso no tiene firma todavía');
  }
  // 2. Estado de cada paso en un documento en curso
  {
    const r = enriquecerPasos(CIRCUITO, 3, [firma(1, 'SUPERVISOR', 'Ana', 0), firma(2, 'COORDINADOR', 'Beto', 5)]);
    assert.deepStrictEqual(r.map((p) => p.completado), [true, true, false]);
    assert.deepStrictEqual(r.map((p) => p.actual), [false, false, true]);
  }
  // 3. Filas viejas (sin rolAprobador, con el destino): se leen con el criterio viejo
  {
    const r = enriquecerPasos(CIRCUITO, 3, [firmaVieja(2, 'Ana', 0), firmaVieja(3, 'Beto', 5)]);
    assert.strictEqual(r[0].aprobadoPor?.nombre, 'Ana', 'destino 2 = firma del paso 1');
    assert.strictEqual(r[1].aprobadoPor?.nombre, 'Beto');
    assert.strictEqual(r[2].aprobadoPor, null);
  }
  // 4. Documento mixto (aprobado a caballo del cambio): la fila nueva gana
  {
    // La vieja (destino 2) es la firma del paso 1; la nueva (pasoFlujo 2) es la
    // del paso 2. Las dos matchean el paso 2 si no se prioriza la nueva.
    const r = enriquecerPasos(CIRCUITO, 3, [firmaVieja(2, 'Ana', 0), firma(2, 'COORDINADOR', 'Beto', 5)]);
    assert.strictEqual(r[0].aprobadoPor?.nombre, 'Ana');
    assert.strictEqual(r[1].aprobadoPor?.nombre, 'Beto', 'la fila nueva manda sobre la vieja');
  }
  // 5. El rechazo no cuenta como firma, pero lo firmado antes del corte queda
  //    completado aunque el documento haya vuelto a pasoActual 0
  {
    const rechazo: FirmaHistorial = {
      pasoFlujo: 2, rolAprobador: 'COORDINADOR', estadoNuevo: 'RECHAZADA',
      comentario: 'no', createdAt: ts(9), usuario: { nombre: 'Caro', apellido: 'Díaz' },
    };
    const r = enriquecerPasos(CIRCUITO, 0, [firma(1, 'SUPERVISOR', 'Ana', 0), rechazo]);
    assert.strictEqual(r[0].aprobadoPor?.nombre, 'Ana');
    assert.strictEqual(r[0].completado, true, 'lo firmado antes del rechazo no se borra');
    assert.strictEqual(r[1].aprobadoPor, null, 'un rechazo no es una firma del paso');
    assert.strictEqual(r[1].completado, false);
    assert.deepStrictEqual(r.map((p) => p.actual), [false, false, false], 'rechazado: ningún paso vigente');
  }
  // 6. Sin historial no explota y no inventa firmas
  {
    const r = enriquecerPasos(CIRCUITO, 1, []);
    assert.deepStrictEqual(r.map((p) => p.aprobadoPor), [null, null, null]);
    assert.deepStrictEqual(r.map((p) => p.fecha), [null, null, null]);
  }
  // 7. El recorrido sale del snapshot y no de la cadena editada después
  {
    // El documento congeló sólo RRHH (renumerado como paso 1); el flujo vivo
    // tiene los tres. Cruzar contra los vivos le atribuiría a Ana la firma de un
    // paso por el que este documento nunca pasó.
    const doc = { circuitoSnapshot: [{ ...CIRCUITO[2], orden: 1 }], flujo: { pasos: CIRCUITO } };
    const r = enriquecerPasos(pasosDe(doc), 2, [firma(1, 'RRHH', 'Ana', 0)]);
    assert.strictEqual(r.length, 1, 'el snapshot manda sobre la cadena viva');
    assert.strictEqual(r[0].rolAprobador, 'RRHH');
    assert.strictEqual(r[0].aprobadoPor?.nombre, 'Ana');
  }
  // 8. No muta lo que recibe
  {
    const historial = [firma(1, 'SUPERVISOR', 'Ana', 0)];
    const copia = JSON.parse(JSON.stringify(historial));
    enriquecerPasos(CIRCUITO, 2, historial);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(historial)), copia);
  }
  console.log('✓ recorrido: 8/8 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
