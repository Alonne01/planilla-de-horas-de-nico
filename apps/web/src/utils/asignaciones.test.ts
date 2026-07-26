import assert from 'node:assert';
import {
  asignacionDeAlcance,
  flujoVigente,
  type AsignacionAlcance,
  type FlujoAsignable,
} from './asignaciones.js';

/**
 * La regla tiene que coincidir con `resolverFlujo` del back
 * (`apps/api/src/utils/circuito.utils.ts`): prioridad sector → global, y una
 * asignación solo cuenta si tanto ella como su flujo están activos y son del
 * mismo tipo de documento.
 */

const LARGO: FlujoAsignable = { id: 'f-largo', tipoDocumento: 'PLANILLA', activo: true };
const CORTO: FlujoAsignable = { id: 'f-corto', tipoDocumento: 'PLANILLA', activo: true };
const INACTIVO: FlujoAsignable = { id: 'f-inactivo', tipoDocumento: 'PLANILLA', activo: false };
const DE_VACACIONES: FlujoAsignable = { id: 'f-vac', tipoDocumento: 'VACACION', activo: true };
const FLUJOS = [LARGO, CORTO, INACTIVO, DE_VACACIONES];

function asig(flujoId: string, sectorId: string | null, extra: Partial<AsignacionAlcance> = {}): AsignacionAlcance {
  return { flujoId, tipoDocumento: 'PLANILLA', sectorId, usuarioId: null, activo: true, ...extra };
}

async function run() {
  // 1. Sin asignaciones no rige nada: el documento sale sin circuito
  {
    assert.strictEqual(flujoVigente(FLUJOS, [], 'PLANILLA', 's1'), null);
    assert.strictEqual(flujoVigente(FLUJOS, [], 'PLANILLA', null), null);
  }
  // 2. Asignación propia del sector
  {
    const v = flujoVigente(FLUJOS, [asig('f-largo', 's1')], 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-largo');
    assert.strictEqual(v?.heredado, false);
  }
  // 3. Sin propia, hereda el global
  {
    const v = flujoVigente(FLUJOS, [asig('f-corto', null)], 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-corto');
    assert.strictEqual(v?.heredado, true, 'el sector no lo tiene asignado, lo hereda');
  }
  // 4. La propia le gana al global
  {
    const v = flujoVigente(FLUJOS, [asig('f-corto', null), asig('f-largo', 's1')], 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-largo');
    assert.strictEqual(v?.heredado, false);
  }
  // 5. La fila global nunca hereda: es el último eslabón
  {
    const v = flujoVigente(FLUJOS, [asig('f-corto', null)], 'PLANILLA', null);
    assert.strictEqual(v?.flujo.id, 'f-corto');
    assert.strictEqual(v?.heredado, false);
  }
  // 6. Asignación desactivada → cae al global (el back filtra por activo)
  {
    const asigs = [asig('f-largo', 's1', { activo: false }), asig('f-corto', null)];
    const v = flujoVigente(FLUJOS, asigs, 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-corto');
    assert.strictEqual(v?.heredado, true);
  }
  // 7. Flujo desactivado → cae al global, aunque la asignación siga activa
  {
    const asigs = [asig('f-inactivo', 's1'), asig('f-corto', null)];
    const v = flujoVigente(FLUJOS, asigs, 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-corto', 'un flujo inactivo no rige');
    assert.strictEqual(v?.heredado, true);
  }
  // 8. Flujo desactivado y sin global → sin circuito
  {
    assert.strictEqual(flujoVigente(FLUJOS, [asig('f-inactivo', 's1')], 'PLANILLA', 's1'), null);
  }
  // 9. Flujo borrado (la asignación quedó apuntando a la nada) → no rige
  {
    const v = flujoVigente(FLUJOS, [asig('f-fantasma', 's1'), asig('f-corto', null)], 'PLANILLA', 's1');
    assert.strictEqual(v?.flujo.id, 'f-corto');
  }
  // 10. Una asignación de otro tipo de documento no cuenta
  {
    const otra = asig('f-largo', 's1', { tipoDocumento: 'VACACION' });
    assert.strictEqual(flujoVigente(FLUJOS, [otra], 'PLANILLA', 's1'), null);
  }
  // 11. Asignación cuyo flujo es de otro tipo: el back la ignora, acá también
  {
    const cruzada = asig('f-vac', 's1');
    assert.strictEqual(flujoVigente(FLUJOS, [cruzada], 'PLANILLA', 's1'), null);
  }
  // 12. Una asignación por usuario no rige al sector
  {
    const porUsuario = asig('f-largo', null, { usuarioId: 'u1' });
    assert.strictEqual(flujoVigente(FLUJOS, [porUsuario], 'PLANILLA', 's1'), null);
    assert.strictEqual(flujoVigente(FLUJOS, [porUsuario], 'PLANILLA', null), null);
  }
  // 13. Cada sector es independiente
  {
    const asigs = [asig('f-largo', 's1'), asig('f-corto', 's2')];
    assert.strictEqual(flujoVigente(FLUJOS, asigs, 'PLANILLA', 's1')?.flujo.id, 'f-largo');
    assert.strictEqual(flujoVigente(FLUJOS, asigs, 'PLANILLA', 's2')?.flujo.id, 'f-corto');
    assert.strictEqual(flujoVigente(FLUJOS, asigs, 'PLANILLA', 's3'), null);
  }
  // 14. Cada tipo de documento es independiente: el caso que motivó la matriz
  {
    const asigs: AsignacionAlcance[] = [
      asig('f-largo', 's1'),
      { flujoId: 'f-vac', tipoDocumento: 'VACACION', sectorId: 's1', usuarioId: null, activo: true },
    ];
    assert.strictEqual(flujoVigente(FLUJOS, asigs, 'PLANILLA', 's1')?.flujo.id, 'f-largo');
    assert.strictEqual(flujoVigente(FLUJOS, asigs, 'VACACION', 's1')?.flujo.id, 'f-vac');
  }

  // ── asignacionDeAlcance: lo CONFIGURADO, aunque no rija ──────────────────
  // 15. Devuelve la asignación aunque su flujo esté inactivo
  {
    const rota = asig('f-inactivo', 's1');
    assert.strictEqual(asignacionDeAlcance([rota], 'PLANILLA', 's1'), rota);
    assert.strictEqual(flujoVigente(FLUJOS, [rota], 'PLANILLA', 's1'), null, 'configurada pero no vigente');
  }
  // 16. No confunde el alcance global con el de un sector, ni con el de un usuario
  {
    const asigs = [asig('f-corto', null), asig('f-largo', 's1'), asig('f-corto', null, { usuarioId: 'u1' })];
    assert.strictEqual(asignacionDeAlcance(asigs, 'PLANILLA', null)?.flujoId, 'f-corto');
    assert.strictEqual(asignacionDeAlcance(asigs, 'PLANILLA', 's1')?.flujoId, 'f-largo');
    assert.strictEqual(asignacionDeAlcance(asigs, 'PLANILLA', 's9'), undefined);
  }
  // 17. No muta lo que recibe
  {
    const asigs = [asig('f-largo', 's1'), asig('f-corto', null)];
    const copia = JSON.parse(JSON.stringify(asigs));
    flujoVigente(FLUJOS, asigs, 'PLANILLA', 's1');
    asignacionDeAlcance(asigs, 'PLANILLA', 's1');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(asigs)), copia);
  }

  console.log('✓ asignaciones: 17/17 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
