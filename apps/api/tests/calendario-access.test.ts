import assert from 'node:assert';
import { nivelMinimoAccesoSector, puedeVerCalendario } from '../src/utils/calendario-access.utils.js';

// Prisma falso: ignora el `where` y devuelve datos canónicos. Permite testear
// la lógica de agregación (min nivel) y fallback sin base de datos.
function fakePrisma(pasos: { rolAprobador: string }[], roles: { codigo: string; nivel: number }[]) {
  return {
    flujoPaso: { findMany: async () => pasos },
    rolConfig: { findMany: async () => roles },
  } as any;
}

async function run() {
  // 1. Cadena Supervisor→Coordinador→RRHH → min = 60
  {
    const prisma = fakePrisma(
      [{ rolAprobador: 'SUPERVISOR' }, { rolAprobador: 'COORDINADOR' }, { rolAprobador: 'RRHH' }],
      [{ codigo: 'SUPERVISOR', nivel: 60 }, { codigo: 'COORDINADOR', nivel: 70 }, { codigo: 'RRHH', nivel: 90 }],
    );
    assert.strictEqual(await nivelMinimoAccesoSector(prisma, 'e1', 's1'), 60, 'min debe ser 60');
  }
  // 2. Sin flujos → fallback 70
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await nivelMinimoAccesoSector(prisma, 'e1', 's1'), 70, 'fallback 70');
  }
  // 3. Supervisor(60) en sector con min 60 → accede
  {
    const prisma = fakePrisma([{ rolAprobador: 'SUPERVISOR' }], [{ codigo: 'SUPERVISOR', nivel: 60 }]);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 60, empresaId: 'e1', sectorId: 's1' }), true, 'supervisor accede');
  }
  // 4. Supervisor(60) en sector con min 70 → NO accede
  {
    const prisma = fakePrisma(
      [{ rolAprobador: 'COORDINADOR' }, { rolAprobador: 'RRHH' }],
      [{ codigo: 'COORDINADOR', nivel: 70 }, { codigo: 'RRHH', nivel: 90 }],
    );
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 60, empresaId: 'e1', sectorId: 's1' }), false, 'supervisor NO accede');
  }
  // 5. RRHH(90) sin sector → accede igual
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 90, empresaId: 'e1', sectorId: null }), true, 'RRHH accede sin sector');
  }
  // 6. Coordinador(70) sin sector → NO accede
  {
    const prisma = fakePrisma([], []);
    assert.strictEqual(await puedeVerCalendario(prisma, { rolNivel: 70, empresaId: 'e1', sectorId: null }), false, 'sub-RRHH sin sector NO accede');
  }
  console.log('✓ calendario-access: 6/6 OK');
}
run().catch((e) => { console.error(e); process.exit(1); });
