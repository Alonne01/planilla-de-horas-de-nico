import { PrismaClient } from '@prisma/client';
import { tramosDeUsuario, esFrancoEnFecha } from './diagrama-vigencia.utils.js';
import { claveFecha } from './fecha-dia.utils.js';

const prisma = new PrismaClient();

/**
 * Contexto de un día para un usuario: si es feriado y si le toca franco por su
 * diagrama. De acá salen los dos flags que disparan el recargo del 100%
 * (`esFeriado` / `esFrancoTrabajado`), así que los decide el servidor: el
 * navegador los mandaba desde un calendario guardado en localStorage, editable
 * desde la consola del navegador.
 */

// ─── Feriados ────────────────────────────────────

/**
 * Respaldo offline de los feriados nacionales inamovibles y trasladables (los que
 * se pagan al 100% si se trabajan). Los "puente" y "no laborables" NO entran:
 * valen como día común.
 *
 * Es sólo el piso, para que una instalación recién levantada sin internet no
 * liquide sin recargos. La lista viva la trae feriados-sync.service.ts a la tabla
 * FeriadoNacional, y **por cada año que esa tabla cubre este respaldo se ignora
 * por completo**: si un trasladable se movió por decreto, la fecha vieja no puede
 * seguir contando al lado de la nueva.
 */
const FERIADOS_NACIONALES: Record<string, string> = {
  // 2025
  '2025-01-01': 'Año Nuevo',
  '2025-03-03': 'Carnaval',
  '2025-03-04': 'Carnaval',
  '2025-03-24': 'Día de la Memoria',
  '2025-04-02': 'Veteranos de Malvinas',
  '2025-04-18': 'Viernes Santo',
  '2025-05-01': 'Día del Trabajador',
  '2025-05-25': 'Revolución de Mayo',
  '2025-06-16': 'Paso a la Inmortalidad del Gral. Güemes (trasladado)',
  '2025-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2025-07-09': 'Día de la Independencia',
  '2025-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2025-10-12': 'Día de la Diversidad Cultural',
  '2025-11-24': 'Día de la Soberanía Nacional (trasladado)',
  '2025-12-08': 'Inmaculada Concepción',
  '2025-12-25': 'Navidad',
  // 2026
  '2026-01-01': 'Año Nuevo',
  '2026-02-16': 'Carnaval',
  '2026-02-17': 'Carnaval',
  '2026-03-24': 'Día de la Memoria',
  '2026-04-02': 'Veteranos de Malvinas',
  '2026-04-03': 'Viernes Santo',
  '2026-05-01': 'Día del Trabajador',
  '2026-05-25': 'Revolución de Mayo',
  '2026-06-15': 'Paso a la Inmortalidad del Gral. Güemes (trasladado)',
  '2026-06-20': 'Paso a la Inmortalidad del Gral. Belgrano',
  '2026-07-09': 'Día de la Independencia',
  '2026-08-17': 'Paso a la Inmortalidad del Gral. San Martín',
  '2026-10-12': 'Día de la Diversidad Cultural',
  '2026-11-23': 'Día de la Soberanía Nacional (trasladado)',
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad',
};

const ANIOS_DEL_RESPALDO = new Set(
  Object.keys(FERIADOS_NACIONALES).map((k) => Number(k.slice(0, 4))),
);

// La convención de fecha-día (y su documentación) vive en fecha-dia.utils.ts.
// Se re-exportan sólo claveFecha y hoyLocalEmpresa porque son las dos que medio
// código ya importa desde este módulo (cambios-diagrama.routes.ts,
// export.routes.ts, diagrama-vigencia.utils.ts, cambios-diagrama.service.ts).
// diaDesdeEntrada/mismoDia/dentroDelRango NO se re-exportan aunque también viven
// en fecha-dia.utils.ts: nadie las importa desde acá, y sumarlas sería abrir un
// segundo camino sancionado para llegar a la API nueva — justo lo opuesto de
// "una sola autoridad".
export { claveFecha, hoyLocalEmpresa } from './fecha-dia.utils.js';

const CACHE_FERIADOS_MS = 5 * 60 * 1000;

export type FeriadosVigentes = {
  /** fecha 'YYYY-MM-DD' → nombre */
  mapa: Map<string, string>;
  /** Años con feriados nacionales conocidos (de la tabla o del respaldo). */
  aniosCubiertos: Set<number>;
};

const cacheFeriados = new Map<string, { valor: FeriadosVigentes; expira: number }>();

/**
 * Feriados vigentes para una empresa, en orden de autoridad:
 *   1. Tabla FeriadoNacional (lo que se sincronizó desde internet, más lo cargado
 *      a mano). Por cada año que cubre, el respaldo del código no se mira.
 *   2. Respaldo del código, sólo para los años que la tabla no tiene.
 *   3. Los propios de la empresa (feriadosPersonalizados), que se suman siempre:
 *      ahí van los del CCT petrolero, que no son nacionales.
 */
export async function feriadosVigentes(empresaId: string): Promise<FeriadosVigentes> {
  const hit = cacheFeriados.get(empresaId);
  if (hit && Date.now() < hit.expira) return hit.valor;

  const [nacionales, config] = await Promise.all([
    prisma.feriadoNacional.findMany({ select: { fecha: true, nombre: true, anio: true } }),
    prisma.empresaConfig.findFirst({
      where: { empresaId },
      select: { feriadosPersonalizados: true },
    }),
  ]);

  const aniosEnTabla = new Set(nacionales.map((f) => f.anio));
  const mapa = new Map<string, string>();

  for (const [clave, nombre] of Object.entries(FERIADOS_NACIONALES)) {
    if (!aniosEnTabla.has(Number(clave.slice(0, 4)))) mapa.set(clave, nombre);
  }
  for (const f of nacionales) mapa.set(f.fecha, f.nombre);

  const propios = config?.feriadosPersonalizados;
  if (Array.isArray(propios)) {
    for (const item of propios) {
      // La columna es Json: se aceptan 'YYYY-MM-DD' y ISO completo, y se ignora
      // cualquier otra cosa antes de que llegue al cálculo de horas.
      if (typeof item !== 'string') continue;
      const clave = item.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clave)) continue;
      if (!mapa.has(clave)) mapa.set(clave, 'Feriado de la empresa');
    }
  }

  const valor: FeriadosVigentes = {
    mapa,
    aniosCubiertos: new Set([...aniosEnTabla, ...ANIOS_DEL_RESPALDO]),
  };
  cacheFeriados.set(empresaId, { valor, expira: Date.now() + CACHE_FERIADOS_MS });
  return valor;
}

/** Sólo el mapa fecha → nombre, que es lo que consume el resto del código. */
export async function feriadosDeEmpresa(empresaId: string): Promise<Map<string, string>> {
  return (await feriadosVigentes(empresaId)).mapa;
}

/** Invalida el cache: la usa la ruta que edita los feriados de la empresa. */
export function olvidarFeriados(empresaId?: string): void {
  if (empresaId) cacheFeriados.delete(empresaId);
  else cacheFeriados.clear();
}

export async function esFeriado(empresaId: string, fecha: Date): Promise<boolean> {
  const clave = claveFecha(fecha);
  const { mapa, aniosCubiertos } = await feriadosVigentes(empresaId);
  if (mapa.has(clave)) return true;

  // Un año sin feriados cargados devolvería false para todos y el recargo del
  // 100% desaparecería sin que nadie se entere. Se avisa fuerte en el log.
  const anio = Number(clave.slice(0, 4));
  if (!aniosCubiertos.has(anio)) {
    console.warn(
      `⚠️  Sin feriados para ${anio}: no se sincronizaron desde internet ni están en el ` +
        'respaldo del código. Hasta que se carguen, el recargo del 100% no se aplica.',
    );
  }
  return false;
}

// ─── Franco por diagrama ─────────────────────────

type DiagramaCiclo = {
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
};

/**
 * True si la fecha cae en día de descanso según el diagrama.
 *
 * ROTATIVO: cicla diasTrabajo y después diasDescanso desde fechaInicio.
 * FIJO_SEMANA: descansa los días que no están en diasSemana (0=domingo).
 *
 * Todo en UTC por la misma razón que claveFecha().
 */
export function esDiaFrancoSegunDiagrama(
  fecha: Date,
  diagrama: DiagramaCiclo,
  fechaInicio: Date,
): boolean {
  if (diagrama.tipo === 'ROTATIVO') {
    const ciclo = (diagrama.diasTrabajo ?? 0) + (diagrama.diasDescanso ?? 0);
    if (ciclo === 0) return false;
    const MS_POR_DIA = 86400000;
    const inicioMs = Date.parse(`${claveFecha(fechaInicio)}T00:00:00Z`);
    const fechaMs = Date.parse(`${claveFecha(fecha)}T00:00:00Z`);
    const dias = Math.round((fechaMs - inicioMs) / MS_POR_DIA);
    const pos = ((dias % ciclo) + ciclo) % ciclo;
    return pos >= (diagrama.diasTrabajo ?? 0);
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    return !diagrama.diasSemana.includes(new Date(`${claveFecha(fecha)}T00:00:00Z`).getUTCDay());
  }
  return false;
}

/**
 * Si a esa persona le tocaba franco ese día, según el diagrama vigente ESE día.
 *
 * Antes se filtraba por `activo: true`, y como aprobar un cambio apaga la
 * asignación anterior, cualquier día previo al cambio se quedaba sin diagrama y
 * daba `false`: recalcular un día viejo le borraba el recargo del 100%. La
 * vigencia la deciden las fechas; ver diagrama-vigencia.utils.ts.
 */
export async function esFrancoPorDiagrama(usuarioId: string, fecha: Date): Promise<boolean> {
  const tramos = await tramosDeUsuario(usuarioId, fecha, fecha);
  return esFrancoEnFecha(tramos, fecha);
}

/**
 * Los dos flags que definen el recargo, derivados de la base.
 *
 * `hayTrabajo` sale de las horas ya calculadas: un franco sin horas cargadas no
 * es un franco trabajado, y un compensatorio tampoco cuenta como jornada.
 */
export async function contextoDelDia(
  usuarioId: string,
  empresaId: string,
  fecha: Date,
  hayTrabajo: boolean,
): Promise<{ esFeriado: boolean; esFrancoTrabajado: boolean }> {
  const [feriado, franco] = await Promise.all([
    esFeriado(empresaId, fecha),
    hayTrabajo ? esFrancoPorDiagrama(usuarioId, fecha) : Promise.resolve(false),
  ]);
  return { esFeriado: feriado, esFrancoTrabajado: franco && hayTrabajo };
}
