import assert from 'node:assert';
import { construirCircuito, pasosDe, pasoActualDe, type PasoCircuito } from '../src/utils/circuito.utils.js';

/** La cadena del spec: Supervisor → Coordinador → Gerente → RRHH. */
const CADENA: PasoCircuito[] = [
  { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: null, notificarRoles: [] },
  { orden: 2, nombrePaso: 'Aprobación Coordinador', rolAprobador: 'COORDINADOR', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: 48, notificarRoles: ['OPERADOR'] },
  { orden: 3, nombrePaso: 'Visto Gerencia', rolAprobador: 'GERENTE', usuarioEspecificoId: null, requiereComentarioRechazo: false, tiempoLimiteHoras: null, notificarRoles: [] },
  { orden: 4, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH', usuarioEspecificoId: null, requiereComentarioRechazo: true, tiempoLimiteHoras: null, notificarRoles: [] },
];

const NIVELES: Record<string, number> = {
  ADMIN: 100, RRHH: 90, GERENTE: 80, CMASS: 75, COORDINADOR: 70, SUPERVISOR: 60, OPERADOR: 10,
};

const roles = (ps: PasoCircuito[]) => ps.map((p) => p.rolAprobador);

async function run() {
  // 1. OPERADOR (10): no se saltea nada
  {
    const c = construirCircuito(CADENA, 10, NIVELES);
    assert.deepStrictEqual(roles(c), ['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH']);
  }
  // 2. SUPERVISOR (60): se saltea su propio nivel
  {
    const c = construirCircuito(CADENA, 60, NIVELES);
    assert.deepStrictEqual(roles(c), ['COORDINADOR', 'GERENTE', 'RRHH']);
  }
  // 3. COORDINADOR (70): el caso del pedido
  {
    const c = construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(roles(c), ['GERENTE', 'RRHH']);
  }
  // 4. GERENTE (80)
  {
    const c = construirCircuito(CADENA, 80, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH']);
  }
  // 5. RRHH (90): no queda nadie por nivel, pero se conserva el último paso
  {
    const c = construirCircuito(CADENA, 90, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH'], 'nunca puede quedar en cero');
  }
  // 6. ADMIN (100): idem
  {
    const c = construirCircuito(CADENA, 100, NIVELES);
    assert.deepStrictEqual(roles(c), ['RRHH']);
  }
  // 7. El circuito se renumera 1..N: pasoActual indexa el snapshot, no la cadena original
  {
    const c = construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(c.map((p) => p.orden), [1, 2], 'los ordenes deben ser contiguos desde 1');
  }
  // 8. Se conservan los datos del paso, no solo el rol
  {
    const c = construirCircuito(CADENA, 60, NIVELES);
    assert.strictEqual(c[0].nombrePaso, 'Aprobación Coordinador');
    assert.strictEqual(c[0].tiempoLimiteHoras, 48);
    assert.deepStrictEqual(c[0].notificarRoles, ['OPERADOR']);
  }
  // 9. Rol sin nivel conocido (borrado o desactivado): no entra al filtro por
  //    nivel, así que nunca se saltea
  {
    const conHuerfano: PasoCircuito[] = [
      { ...CADENA[0], rolAprobador: 'CAPATAZ_BORRADO' },
      CADENA[3],
    ];
    const c = construirCircuito(conHuerfano, 90, NIVELES);
    assert.deepStrictEqual(roles(c), ['CAPATAZ_BORRADO', 'RRHH'], 'el paso huerfano tiene que verse, no esconderse');
  }
  // 10. Cadena vacía: devuelve vacío, no explota
  {
    assert.deepStrictEqual(construirCircuito([], 10, NIVELES), []);
  }
  // 11. No muta la entrada
  {
    const copia = JSON.parse(JSON.stringify(CADENA));
    construirCircuito(CADENA, 70, NIVELES);
    assert.deepStrictEqual(CADENA, copia, 'construirCircuito no puede mutar los pasos que recibe');
  }
  // 12. pasosDe prioriza el snapshot sobre el flujo vivo
  {
    const doc = { circuitoSnapshot: [CADENA[3]], flujo: { pasos: CADENA } };
    assert.deepStrictEqual(roles(pasosDe(doc)), ['RRHH'], 'el snapshot manda');
  }
  // 13. pasosDe cae al flujo vivo si no hay snapshot (documentos viejos)
  {
    const doc = { circuitoSnapshot: null, flujo: { pasos: CADENA } };
    assert.strictEqual(pasosDe(doc).length, 4);
  }
  // 14. pasosDe sin snapshot ni flujo devuelve vacío, no explota
  {
    assert.deepStrictEqual(pasosDe({ circuitoSnapshot: null, flujo: null }), []);
  }
  // 15. pasoActualDe devuelve null si el paso quedó fuera de rango
  {
    const doc = { circuitoSnapshot: [CADENA[3]], pasoActual: 3, flujo: null };
    assert.strictEqual(pasoActualDe(doc), null);
  }
  console.log('✓ circuito: 15/15 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
