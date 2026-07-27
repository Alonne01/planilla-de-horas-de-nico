/**
 * Filtros de PERÍODO que llegan por query string (`?periodoInicio=&periodoFin=`).
 *
 * El barrido de la convención de fecha-día normalizó el camino de ESCRITURA (el
 * schema `fechaDia` en el borde de las rutas), pero el de LECTURA se quedó con
 * `new Date(req.query.periodoInicio)` crudo y con el idiom
 * `fin.setHours(23,59,59,999)` repetido en cinco archivos. Bajo
 * TZ=America/Argentina/Buenos_Aires (ver Dockerfile) esa pareja corre la ventana
 * un día entero: con el payload real del front (`2026-07-21T03:00:00.000Z`) el
 * filtro quedaba en `[22/7 .. 21/8]` en vez de `[21/7 .. 20/8]`, así que se
 * perdía todo lo cargado el primer día del ciclo y se colaba el día siguiente al
 * último.
 *
 * Este módulo es el único lugar donde se arma ese filtro. Los dos bordes se
 * resuelven juntos a propósito: arreglar sólo el techo deja la pérdida del
 * primer día, que es el defecto que reportó el usuario.
 */
import { z } from 'zod';
import { fechaDia } from './zod.utils.js';
import { finDelDia, rangoConsultaDia } from './fecha-dia.utils.js';

/**
 * Una fecha-día opcional que llega por query string.
 *
 * El `preprocess` mapea la cadena vacía a `undefined` para conservar el
 * comportamiento anterior: las rutas gateaban con `if (periodoInicio)`, así que
 * `?periodoInicio=` (parámetro presente pero vacío) se ignoraba en vez de dar
 * 400. Sin esto, un cliente que arma la query con un valor vacío pasaría de
 * "sin filtro" a "400 Datos inválidos".
 */
const fechaDiaQuery = z.preprocess(
  (v) => (v === '' ? undefined : v),
  fechaDia.optional(),
);

/**
 * Query params de filtro por período. Zod descarta las claves desconocidas, así
 * que se le puede pasar `req.query` entero: el resto de los filtros de cada
 * ruta (`estado`, `tipo`, `sectorId`, `scope`…) sigue manejándose aparte.
 *
 * Reemplaza a los `isNaN(new Date(x).getTime())` escritos a mano en
 * planillas / ausencias / vacaciones / analytics / aprobaciones.
 */
export const periodoQuerySchema = z.object({
  periodoInicio: fechaDiaQuery,
  periodoFin: fechaDiaQuery,
});

export type PeriodoQuery = z.infer<typeof periodoQuerySchema>;

/** Borde de un rango tal como lo espera el `where` de Prisma. */
type FiltroRango = { gte?: Date; lte?: Date };

/**
 * Filtro sobre las columnas `periodoInicio`/`periodoFin` de una planilla.
 *
 * Los dos bordes son independientes (cada uno se aplica sólo si vino), como en
 * el código que reemplaza. El piso es la medianoche UTC del día pedido —que ya
 * es lo que devuelve `fechaDia`—, así que una planilla guardada con la fecha-día
 * normalizada del primer día del ciclo entra en la ventana; el techo es el
 * último instante del último día, para que también entren las filas viejas que
 * todavía tienen hora (`03:00Z`, `15:00Z`) mientras no corra la migración.
 */
export function filtroPeriodoPlanilla(p: PeriodoQuery): { periodoInicio?: FiltroRango; periodoFin?: FiltroRango } {
  const filtro: { periodoInicio?: FiltroRango; periodoFin?: FiltroRango } = {};
  if (p.periodoInicio) filtro.periodoInicio = { gte: p.periodoInicio };
  if (p.periodoFin) filtro.periodoFin = { lte: finDelDia(p.periodoFin) };
  return filtro;
}

/**
 * Filtro sobre la columna `fechaInicio` de ausencias y vacaciones: el registro
 * arranca dentro del período pedido.
 *
 * Sólo se aplica cuando llegan los DOS bordes, igual que el código que
 * reemplaza: con uno solo el filtro quedaba abierto de un lado y devolvía
 * historia entera.
 */
export function filtroFechaInicioEnPeriodo(p: PeriodoQuery): { fechaInicio?: FiltroRango } {
  if (!p.periodoInicio || !p.periodoFin) return {};
  const { desde, hasta } = rangoConsultaDia(p.periodoInicio, p.periodoFin);
  return { fechaInicio: { gte: desde, lte: hasta } };
}

/**
 * Filtro de "esta columna cae exactamente en ESTE día calendario".
 *
 * Es el reemplazo de la igualdad exacta `columna: new Date(x)`, que sólo matchea
 * si el instante guardado coincide al milisegundo con el que mandó el cliente.
 * Mientras la migración de datos no corra conviven en la base las tres
 * convenciones viejas (`00:00Z`, `03:00Z`, `15:00Z`) para el mismo día, así que
 * la igualdad exacta devuelve cero filas apenas el cliente y la fila no fueron
 * escritos con la misma convención. El rango de un día conserva la semántica
 * (sigue siendo "ese día y no otro") sin depender de la hora guardada.
 */
export function filtroDiaExacto(dia: Date): { gte: Date; lte: Date } {
  const { desde, hasta } = rangoConsultaDia(dia, dia);
  return { gte: desde, lte: hasta };
}
