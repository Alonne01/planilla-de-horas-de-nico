import assert from 'node:assert';
import { turnoKey, proximoInicioDeCiclo, etiquetaTurno } from '../src/utils/turnos.utils.js';
import { alcanceDeDifusion, destinosPermitidos } from '../src/utils/difusion.utils.js';

// Los cuatro primeros casos son el ESPEJO de apps/web/src/utils/turnos.test.ts.
// Las dos copias de `turnoKey` tienen que agrupar igual: la del front decide qué
// se ve en el calendario y ésta decide a quién le llega un mensaje. Si se
// desincronizan, el remitente elige un grupo en pantalla y el servidor le manda
// a otro.

const LUN_VIE: Diagrama = { tipo: 'FIJO_SEMANA', diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5] };
const SIETE: Diagrama = { tipo: 'ROTATIVO', diasTrabajo: 7, diasDescanso: 7, diasSemana: [] };
const CATORCE: Diagrama = { tipo: 'ROTATIVO', diasTrabajo: 14, diasDescanso: 7, diasSemana: [] };
const ROTO: Diagrama = { tipo: 'ROTATIVO', diasTrabajo: 0, diasDescanso: 0, diasSemana: [] };

type Diagrama = { tipo: string; diasTrabajo: number | null; diasDescanso: number | null; diasSemana: number[] };

/** Una fecha-día: medianoche UTC del día calendario argentino. */
const dia = (clave: string) => new Date(`${clave}T00:00:00.000Z`);
const tramo = (diagrama: Diagrama, inicio: string) => ({ diagrama, fechaInicio: dia(inicio) });

async function run() {
  let aserciones = 0;
  const ok = (fn: () => void) => { fn(); aserciones++; };

  // ── turnoKey ────────────────────────────────────────────────────────────
  // 1. FIJO_SEMANA: la fecha de alta no cambia qué días son francos.
  ok(() => assert.strictEqual(turnoKey(tramo(LUN_VIE, '2019-06-01')), turnoKey(tramo(LUN_VIE, '2021-11-23'))));
  ok(() => assert.notStrictEqual(turnoKey(tramo(LUN_VIE, '2019-06-01')), 'SIN'));

  // 2. ROTATIVO en la misma fase (14 días = un ciclo 7×7 entero) → mismo patrón.
  ok(() => assert.strictEqual(turnoKey(tramo(SIETE, '2020-01-01')), turnoKey(tramo(SIETE, '2020-01-15'))));

  // 3. ROTATIVO desfasado medio ciclo → descansan días distintos.
  ok(() => assert.notStrictEqual(turnoKey(tramo(SIETE, '2020-01-01')), turnoKey(tramo(SIETE, '2020-01-08'))));

  // 4. Sin diagrama vigente.
  ok(() => assert.strictEqual(turnoKey(null), 'SIN'));

  // 5. Un ROTATIVO con el ciclo en cero (dato roto) no puede dividir por cero ni
  //    inventar un grupo: cae en 'SIN'.
  ok(() => assert.strictEqual(turnoKey(tramo(ROTO, '2020-01-01')), 'SIN'));

  // 6. Dos diagramas 7×7 y 14×7 alineados el mismo día NO son el mismo turno:
  //    el largo del ciclo entra en la clave.
  ok(() => assert.notStrictEqual(turnoKey(tramo(SIETE, '2026-07-02')), turnoKey(tramo(CATORCE, '2026-07-02'))));

  // ── proximoInicioDeCiclo ────────────────────────────────────────────────
  // Un 14×7 arrancado el jueves 2/7/2026 recicla cada 21 días: 2/7, 23/7, 13/8.
  const t147 = tramo(CATORCE, '2026-07-02');
  const claveDe = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  ok(() => assert.strictEqual(claveDe(proximoInicioDeCiclo(t147, dia('2026-07-24'))), '2026-08-13'));

  // 8. Si HOY es un inicio de ciclo, el próximo es hoy. Sumar el ciclo entero
  //    mandaría el aviso al grupo equivocado justo el día que arrancan.
  ok(() => assert.strictEqual(claveDe(proximoInicioDeCiclo(t147, dia('2026-07-23'))), '2026-07-23'));

  // 9. Un día antes del inicio.
  ok(() => assert.strictEqual(claveDe(proximoInicioDeCiclo(t147, dia('2026-07-22'))), '2026-07-23'));

  // 10. Fecha ANTERIOR al alta del tramo: el módulo negativo está normalizado,
  //     así que no explota ni devuelve una fecha pasada. Devuelve el 2/7, que es
  //     el alta misma: el primer arranque de ciclo que hay a partir del 20/6.
  ok(() => assert.strictEqual(claveDe(proximoInicioDeCiclo(t147, dia('2026-06-20'))), '2026-07-02'));

  // 11. FIJO_SEMANA no tiene ciclo que empiece.
  ok(() => assert.strictEqual(proximoInicioDeCiclo(tramo(LUN_VIE, '2020-01-01'), dia('2026-07-28')), null));

  // ── etiquetaTurno ───────────────────────────────────────────────────────
  // 12. El día de la semana sale de getUTCDay. Con getters locales, bajo
  //     TZ=America/Argentina/Buenos_Aires, una fecha-día se lee como el día
  //     ANTERIOR y la etiqueta diría "miércoles 12/08".
  ok(() => {
    const { etiqueta, proximoInicio } = etiquetaTurno(t147, dia('2026-07-24'));
    assert.strictEqual(etiqueta, 'Rotativo 14×7 — arrancan el jueves 13/08');
    assert.strictEqual(proximoInicio, '2026-08-13');
  });

  ok(() => {
    const { etiqueta, proximoInicio } = etiquetaTurno(tramo(LUN_VIE, '2020-01-01'), dia('2026-07-28'));
    assert.strictEqual(etiqueta, 'Semana fija — trabajan lunes, martes, miércoles, jueves, viernes');
    assert.strictEqual(proximoInicio, null);
  });

  ok(() => assert.strictEqual(etiquetaTurno(null, dia('2026-07-28')).etiqueta, 'Sin diagrama asignado'));

  // ── alcanceDeDifusion ───────────────────────────────────────────────────
  // RRHH y ADMIN: toda la empresa, como siempre.
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'RRHH', rolNivel: 90, sectorId: 's1' }), 'EMPRESA'));
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'ADMIN', rolNivel: 100, sectorId: null }), 'EMPRESA'));

  // CMASS elige entre su sector y toda la empresa ⇒ alcance EMPRESA aunque tenga
  // sector asignado.
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'CMASS', rolNivel: 75, sectorId: 's1' }), 'EMPRESA'));

  // Gerente general: nivel alto SIN sector. No está mal configurado — es
  // transversal, igual que en los circuitos de aprobación.
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'GERENTE', rolNivel: 80, sectorId: null }), 'EMPRESA'));

  // Gerente de sector y coordinador: su sector.
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'GERENTE', rolNivel: 80, sectorId: 's1' }), 'SECTOR'));
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'COORDINADOR', rolNivel: 70, sectorId: 's1' }), 'SECTOR'));

  // Debajo de 70 no se difunde, con o sin sector.
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'SUPERVISOR', rolNivel: 60, sectorId: 's1' }), 'NINGUNO'));
  ok(() => assert.strictEqual(alcanceDeDifusion({ rol: 'OPERADOR', rolNivel: 10, sectorId: null }), 'NINGUNO'));

  // ── destinosPermitidos ──────────────────────────────────────────────────
  // ROL atraviesa la jerarquía ("todos los supervisores de la empresa") y queda
  // reservado a nivel ≥ 90.
  ok(() => assert.deepStrictEqual(destinosPermitidos('EMPRESA', 90).sort(), ['ROL', 'SECTOR', 'TODOS', 'TURNO', 'USUARIO']));
  ok(() => assert.deepStrictEqual(destinosPermitidos('EMPRESA', 75).sort(), ['SECTOR', 'TODOS', 'TURNO', 'USUARIO']));
  ok(() => assert.deepStrictEqual(destinosPermitidos('SECTOR', 70).sort(), ['SECTOR', 'TURNO', 'USUARIO']));
  ok(() => assert.deepStrictEqual(destinosPermitidos('NINGUNO', 10), []));

  console.log(`✓ turnos y difusión: ${aserciones}/${aserciones} OK`);
}

run().catch((e) => { console.error(e); process.exit(1); });
