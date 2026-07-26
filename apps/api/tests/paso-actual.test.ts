import assert from 'node:assert';
import { matchesCurrentStep, type AprobadorContexto, type DocumentoConCircuito } from '../src/utils/approval-auth.utils.js';
import type { PasoCircuito } from '../src/utils/circuito.utils.js';

/**
 * El criterio de "a quién le toca" que comparten la bandeja unificada
 * (`GET /aprobaciones`) y `GET /cambios-diagrama/pendientes`. Tiene que dar lo
 * mismo que la guarda de `/avanzar`: si diverge, una vista ofrece algo que
 * después no se puede aprobar, o esconde algo que sí.
 */

const paso = (orden: number, rol: string): PasoCircuito => ({
  orden,
  nombrePaso: `Paso ${rol}`,
  rolAprobador: rol,
  usuarioEspecificoId: null,
  requiereComentarioRechazo: true,
  tiempoLimiteHoras: null,
  notificarRoles: [],
});

/** Supervisor → Coordinador → RRHH. */
const CIRCUITO: PasoCircuito[] = [paso(1, 'SUPERVISOR'), paso(2, 'COORDINADOR'), paso(3, 'RRHH')];

const SECTOR = 'sector-A';
const DUENIO = 'user-duenio';
const SUPER = 'user-supervisor';
const COORD = 'user-coordinador';

/** El empleado dueño del documento, con su cadena de mando cargada. */
const usuario = {
  id: DUENIO,
  sectorId: SECTOR,
  supervisorId: SUPER,
  coordinadorId: COORD,
};

const doc = (pasoActual: number, snapshot: PasoCircuito[] | null = CIRCUITO): DocumentoConCircuito => ({
  circuitoSnapshot: snapshot,
  pasoActual,
  flujo: null,
  usuario,
});

const supervisor: AprobadorContexto = { userId: SUPER, rol: 'SUPERVISOR', nivel: 60, sectorId: SECTOR };
const coordinador: AprobadorContexto = { userId: COORD, rol: 'COORDINADOR', nivel: 70, sectorId: SECTOR };
const rrhh: AprobadorContexto = { userId: 'user-rrhh', rol: 'RRHH', nivel: 90, sectorId: null };
const duenio: AprobadorContexto = { userId: DUENIO, rol: 'SUPERVISOR', nivel: 60, sectorId: SECTOR };

async function run() {
  // 1. El paso vigente es el suyo → lo ve
  {
    assert.strictEqual(matchesCurrentStep(doc(1), supervisor), true);
    assert.strictEqual(matchesCurrentStep(doc(2), coordinador), true);
    assert.strictEqual(matchesCurrentStep(doc(3), rrhh), true);
  }
  // 2. El paso vigente es de otro rol → no lo ve
  {
    assert.strictEqual(matchesCurrentStep(doc(2), supervisor), false, 'el supervisor no ve el paso del coordinador');
    assert.strictEqual(matchesCurrentStep(doc(1), coordinador), false, 'ya firmó: el paso 1 no es suyo');
    assert.strictEqual(matchesCurrentStep(doc(1), rrhh), false, 'RRHH no se adelanta a los pasos previos');
  }
  // 3. Documento SIN circuito: cae en la rama de escape del avance, que pide
  //    nivel RRHH o superior. Devolver false lo dejaba invisible para todos.
  {
    assert.strictEqual(matchesCurrentStep(doc(1, []), rrhh), true, 'sin circuito lo destraba RRHH');
    assert.strictEqual(matchesCurrentStep(doc(1, []), supervisor), false, 'sin circuito el supervisor no puede');
    assert.strictEqual(matchesCurrentStep(doc(1, []), coordinador), false);
  }
  // 4. El dueño mirando lo suyo: nadie aprueba su propio documento, ni siquiera
  //    si el rol del paso coincide con el suyo
  {
    assert.strictEqual(matchesCurrentStep(doc(1), duenio), false);
    // Ni por la rama sin circuito: un RRHH que envía conserva el paso RRHH.
    const duenioRrhh: AprobadorContexto = { userId: DUENIO, rol: 'RRHH', nivel: 90, sectorId: SECTOR };
    assert.strictEqual(matchesCurrentStep(doc(1, []), duenioRrhh), false);
  }
  // 5. `pasoActual` fuera de rango (documento ya aprobado o corrupto): misma
  //    rama de escape que "sin circuito"
  {
    assert.strictEqual(matchesCurrentStep(doc(4), rrhh), true);
    assert.strictEqual(matchesCurrentStep(doc(4), coordinador), false);
  }
  // 6. Documento rechazado (`pasoActual` 0): no hay paso vigente que matchee
  {
    assert.strictEqual(matchesCurrentStep(doc(0), supervisor), false);
    assert.strictEqual(matchesCurrentStep(doc(0), coordinador), false);
  }
  // 7. Sector ajeno: sin relación directa de mando, el rol del paso no alcanza
  {
    const sinMando = { id: DUENIO, sectorId: SECTOR, supervisorId: null, coordinadorId: null };
    const ajeno: DocumentoConCircuito = { circuitoSnapshot: CIRCUITO, pasoActual: 1, flujo: null, usuario: sinMando };
    const supervisorDeOtroSector: AprobadorContexto = { userId: 'otro-sup', rol: 'SUPERVISOR', nivel: 60, sectorId: 'sector-B' };
    assert.strictEqual(matchesCurrentStep(ajeno, supervisorDeOtroSector), false, 'otro sector no ve el documento');
    assert.strictEqual(matchesCurrentStep(ajeno, { ...supervisorDeOtroSector, sectorId: SECTOR }), true, 'mismo sector sí');
  }
  // 8. El snapshot manda sobre el flujo vivo: con un circuito acortado por
  //    nivel, buscar el paso vivo por `orden` se lo ofrecía al rol equivocado
  {
    const congelado: DocumentoConCircuito = {
      // El empleado es COORDINADOR: su circuito arranca directamente en RRHH,
      // renumerado como paso 1.
      circuitoSnapshot: [{ ...CIRCUITO[2], orden: 1 }],
      pasoActual: 1,
      flujo: { pasos: CIRCUITO },
      usuario,
    };
    assert.strictEqual(matchesCurrentStep(congelado, rrhh), true, 'el paso 1 del snapshot es RRHH');
    assert.strictEqual(matchesCurrentStep(congelado, supervisor), false, 'el paso 1 del flujo VIVO es SUPERVISOR: no cuenta');
  }
  // 9. Documento anterior al congelado (sin snapshot): se cae al flujo vivo
  {
    const viejo: DocumentoConCircuito = { circuitoSnapshot: null, pasoActual: 2, flujo: { pasos: CIRCUITO }, usuario };
    assert.strictEqual(matchesCurrentStep(viejo, coordinador), true);
    assert.strictEqual(matchesCurrentStep(viejo, supervisor), false);
  }
  // 10. ADMIN: escape hatch para destrabar cualquier paso, salvo lo propio
  {
    const admin: AprobadorContexto = { userId: 'user-admin', rol: 'ADMIN', nivel: 100, sectorId: null };
    assert.strictEqual(matchesCurrentStep(doc(1), admin), true);
    assert.strictEqual(matchesCurrentStep(doc(2), admin), true);
    assert.strictEqual(matchesCurrentStep(doc(1), { ...admin, userId: DUENIO }), false);
  }
  console.log('✓ paso-actual: 10/10 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
