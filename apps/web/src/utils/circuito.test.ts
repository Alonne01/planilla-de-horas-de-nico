import assert from 'node:assert';
import { circuitoPara, pasosDe, pasoActualDe, type PasoConNivel, type PasoDocumento } from './circuito.js';

/**
 * Los mismos casos que `apps/api/tests/circuito.test.ts`. Si esta suite y la del
 * back dejan de coincidir, el front le está mintiendo al usuario sobre el
 * circuito que quedó congelado en el documento.
 */

/** La cadena del spec: Supervisor → Coordinador → Gerente → RRHH. */
const CADENA: PasoConNivel[] = [
  { orden: 1, rolAprobador: 'SUPERVISOR' },
  { orden: 2, rolAprobador: 'COORDINADOR' },
  { orden: 3, rolAprobador: 'GERENTE' },
  { orden: 4, rolAprobador: 'RRHH' },
];

const NIVELES: Record<string, number> = {
  ADMIN: 100, RRHH: 90, GERENTE: 80, CMASS: 75, COORDINADOR: 70, SUPERVISOR: 60, OPERADOR: 10,
};

const roles = (ps: PasoConNivel[]) => ps.map((p) => p.rolAprobador);

async function run() {
  // 1. OPERADOR (10): no se saltea nada
  {
    assert.deepStrictEqual(
      roles(circuitoPara(CADENA, 10, NIVELES)),
      ['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH'],
    );
  }
  // 2. SUPERVISOR (60): se saltea su propio nivel
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 60, NIVELES)), ['COORDINADOR', 'GERENTE', 'RRHH']);
  }
  // 3. COORDINADOR (70): el caso del pedido
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 70, NIVELES)), ['GERENTE', 'RRHH']);
  }
  // 4. CMASS (75): queda entre coordinador y gerente
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 75, NIVELES)), ['GERENTE', 'RRHH']);
  }
  // 5. GERENTE (80)
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 80, NIVELES)), ['RRHH']);
  }
  // 6. RRHH (90): no queda nadie por nivel, pero se conserva el último paso
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 90, NIVELES)), ['RRHH'], 'nunca puede quedar en cero');
  }
  // 7. ADMIN (100): idem
  {
    assert.deepStrictEqual(roles(circuitoPara(CADENA, 100, NIVELES)), ['RRHH']);
  }
  // 8. Se conservan los datos del paso, no solo el rol
  {
    const cadena = [
      { orden: 1, rolAprobador: 'SUPERVISOR', nombrePaso: 'Revisión Supervisor' },
      { orden: 2, rolAprobador: 'COORDINADOR', nombrePaso: 'Aprobación Coordinador' },
    ];
    const c = circuitoPara(cadena, 60, NIVELES);
    assert.strictEqual(c[0].nombrePaso, 'Aprobación Coordinador');
  }
  // 9. Rol sin nivel conocido (borrado o desactivado): no entra al filtro por
  //    nivel, así que nunca se saltea. Resolverlo con `?? 0` lo escondería.
  {
    const conHuerfano: PasoConNivel[] = [
      { orden: 1, rolAprobador: 'CAPATAZ_BORRADO' },
      { orden: 4, rolAprobador: 'RRHH' },
    ];
    assert.deepStrictEqual(
      roles(circuitoPara(conHuerfano, 90, NIVELES)),
      ['CAPATAZ_BORRADO', 'RRHH'],
      'el paso huerfano tiene que verse, no esconderse',
    );
  }
  // 10. Huérfano solo, con la garantía del último paso apuntándole: no se duplica
  {
    const soloHuerfano: PasoConNivel[] = [{ orden: 1, rolAprobador: 'CAPATAZ_BORRADO' }];
    assert.deepStrictEqual(roles(circuitoPara(soloHuerfano, 100, NIVELES)), ['CAPATAZ_BORRADO']);
  }
  // 11. Cadena vacía: devuelve vacío, no explota
  {
    assert.deepStrictEqual(circuitoPara([], 10, NIVELES), []);
  }
  // 12. Sin niveles (la query de roles todavía no resolvió): todos son huérfanos
  //     y no se saltea ninguno, en vez de mostrar un circuito de un solo paso
  {
    assert.deepStrictEqual(
      roles(circuitoPara(CADENA, 70, {})),
      ['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH'],
    );
  }
  // 13. No muta la entrada
  {
    const copia = JSON.parse(JSON.stringify(CADENA));
    circuitoPara(CADENA, 70, NIVELES);
    assert.deepStrictEqual(CADENA, copia, 'circuitoPara no puede mutar los pasos que recibe');
  }
  // 14. Los pasos llegan desordenados (el orden del servidor no está garantizado)
  {
    const desordenada = [CADENA[3], CADENA[0], CADENA[2], CADENA[1]];
    assert.deepStrictEqual(
      roles(circuitoPara(desordenada, 10, NIVELES)),
      ['SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH'],
    );
  }

  // ── pasosDe / pasoActualDe: qué pasos rigen un documento ──

  /** La cadena viva, con los datos que la pantalla necesita de cada paso. */
  const VIVOS: PasoDocumento[] = [
    { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR' },
    { orden: 2, nombrePaso: 'Aprobación Coordinador', rolAprobador: 'COORDINADOR' },
    { orden: 3, nombrePaso: 'Visto Gerente', rolAprobador: 'GERENTE' },
    { orden: 4, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH' },
  ];

  // 15. El snapshot manda sobre el flujo vivo
  {
    const doc = { circuitoSnapshot: [{ ...VIVOS[3], orden: 1 }], flujo: { pasos: VIVOS } };
    assert.deepStrictEqual(pasosDe(doc).map((p) => p.rolAprobador), ['RRHH'], 'el snapshot manda');
  }
  // 16. Sin snapshot cae al flujo vivo (documentos anteriores al congelado)
  {
    const doc = { circuitoSnapshot: null, flujo: { pasos: VIVOS } };
    assert.strictEqual(pasosDe(doc).length, 4);
  }
  // 17. Un snapshot VACÍO es un hecho del documento ("se envió sin circuito"),
  //     no un documento viejo: no puede caer al flujo vivo
  {
    const doc = { circuitoSnapshot: [], flujo: { pasos: VIVOS } };
    assert.deepStrictEqual(pasosDe(doc), [], 'el [] del snapshot no es un fallback');
  }
  // 18. Sin snapshot ni flujo devuelve vacío, no explota
  {
    assert.deepStrictEqual(pasosDe({ circuitoSnapshot: null, flujo: null }), []);
    assert.deepStrictEqual(pasosDe({ circuitoSnapshot: undefined }), []);
  }
  // 19. Los pasos vivos llegan desordenados: `pasoActual` indexa por `orden`
  {
    const doc = { circuitoSnapshot: null, flujo: { pasos: [VIVOS[2], VIVOS[0], VIVOS[3], VIVOS[1]] } };
    assert.deepStrictEqual(pasosDe(doc).map((p) => p.orden), [1, 2, 3, 4]);
  }
  // 20. pasoActualDe indexa el SNAPSHOT: con el circuito acortado, el paso 1 es
  //     RRHH y no el supervisor de la cadena configurada. De esto depende que el
  //     botón de aprobar aparezca o no.
  {
    const doc = { circuitoSnapshot: [{ ...VIVOS[3], orden: 1 }], flujo: { pasos: VIVOS }, pasoActual: 1 };
    assert.strictEqual(pasoActualDe(doc)?.rolAprobador, 'RRHH');
  }
  // 21. pasoActualDe devuelve null si el paso quedó fuera de rango (p. ej. un
  //     documento rechazado, que vuelve a pasoActual 0)
  {
    const doc = { circuitoSnapshot: [{ ...VIVOS[3], orden: 1 }], flujo: null, pasoActual: 0 };
    assert.strictEqual(pasoActualDe(doc), null);
  }
  console.log('✓ circuito: 21/21 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
