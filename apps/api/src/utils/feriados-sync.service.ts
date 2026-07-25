import { PrismaClient } from '@prisma/client';
import { olvidarFeriados } from './contexto-dia.utils.js';

const prisma = new PrismaClient();

/**
 * Sincronización de feriados nacionales desde internet.
 *
 * Fuente: api.argentinadatos.com (pública, sin credenciales). Se guardan sólo los
 * inamovibles y trasladables, que son los que se pagan al 100% si se trabajan; los
 * "puente" y "no laborables" valen como día común y quedan afuera a propósito.
 *
 * Se sincroniza del lado del servidor, no del navegador: así el cálculo del
 * recargo usa la misma lista para todos, no depende de que cada teléfono haya
 * abierto la app con internet, y no hace falta abrir la CSP a un dominio externo.
 *
 * Todo falla en silencio hacia lo que ya había guardado: quedarse con los
 * feriados de ayer siempre es mejor que quedarse sin ninguno.
 */

const API_URL = process.env.FERIADOS_API_URL ?? 'https://api.argentinadatos.com/v1/feriados';
const TIMEOUT_MS = 10_000;
const TIPOS_QUE_PAGAN = new Set(['inamovible', 'trasladable']);
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** `false` desactiva la sincronización: instalaciones sin salida a internet. */
const SYNC_ACTIVA = (process.env.FERIADOS_SYNC ?? 'true') !== 'false';

type FeriadoApi = { fecha?: unknown; tipo?: unknown; nombre?: unknown };

export type ResultadoAnio = {
  anio: number;
  ok: boolean;
  guardados: number;
  detalle?: string;
};

let timer: NodeJS.Timeout | null = null;

async function traerAnio(anio: number): Promise<FeriadoApi[] | null> {
  try {
    const res = await fetch(`${API_URL}/${anio}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data as FeriadoApi[]) : null;
  } catch {
    // sin internet, DNS caído, timeout, JSON roto
    return null;
  }
}

/**
 * Baja un año y lo deja guardado. Devuelve cuántos quedaron.
 *
 * Reemplaza el año completo: si un trasladable cambió de fecha por decreto, la
 * fila vieja tiene que desaparecer, no sumarse. Sólo se borra cuando la respuesta
 * trae feriados de verdad — una respuesta vacía no puede vaciar el calendario.
 */
async function sincronizarAnio(anio: number): Promise<ResultadoAnio> {
  const crudo = await traerAnio(anio);
  if (crudo === null) {
    return { anio, ok: false, guardados: 0, detalle: 'no se pudo consultar la API' };
  }

  const filas: { fecha: string; nombre: string; tipo: string }[] = [];
  for (const item of crudo) {
    const tipo = typeof item.tipo === 'string' ? item.tipo.toLowerCase() : '';
    if (!TIPOS_QUE_PAGAN.has(tipo)) continue;
    if (typeof item.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha)) continue;
    if (!item.fecha.startsWith(String(anio))) continue; // la API no devuelve otros años, pero por si acaso
    filas.push({
      fecha: item.fecha,
      nombre: typeof item.nombre === 'string' && item.nombre ? item.nombre : 'Feriado nacional',
      tipo,
    });
  }

  if (filas.length === 0) {
    return { anio, ok: false, guardados: 0, detalle: 'la API respondió sin feriados que paguen recargo' };
  }

  await prisma.$transaction([
    // Se conservan los cargados a mano: un ADMIN que corrigió una fecha no puede
    // perderla porque la API todavía no publicó el decreto.
    prisma.feriadoNacional.deleteMany({ where: { anio, origen: 'API' } }),
    prisma.feriadoNacional.createMany({
      data: filas.map((f) => ({ ...f, anio, origen: 'API' })),
      skipDuplicates: true, // un MANUAL en la misma fecha gana
    }),
  ]);

  olvidarFeriados(); // el cache por empresa quedó viejo
  return { anio, ok: true, guardados: filas.length };
}

/** Años que vale la pena tener al día: el corriente, el que viene y el pasado. */
export function aniosDeInteres(hoy = new Date()): number[] {
  const anio = hoy.getUTCFullYear();
  return [anio - 1, anio, anio + 1];
}

export async function sincronizarFeriados(anios: number[]): Promise<ResultadoAnio[]> {
  const resultados: ResultadoAnio[] = [];
  for (const anio of anios) {
    resultados.push(await sincronizarAnio(anio));
  }
  return resultados;
}

/** Cuándo se actualizó por última vez, para poder mostrarlo. */
export async function ultimaSincronizacion(): Promise<Date | null> {
  const fila = await prisma.feriadoNacional.findFirst({
    where: { origen: 'API' },
    orderBy: { actualizadoAt: 'desc' },
    select: { actualizadoAt: true },
  });
  return fila?.actualizadoAt ?? null;
}

/**
 * Arranca la sincronización periódica. El primer intento va demorado para no
 * competir con el arranque del servidor, y nunca propaga un error: si no hay
 * internet, el módulo de feriados sigue con lo que tenga guardado.
 */
export function startFeriadosSync(): void {
  if (!SYNC_ACTIVA) {
    console.log('📅 Sincronización de feriados desactivada (FERIADOS_SYNC=false)');
    return;
  }

  const correr = () => {
    sincronizarFeriados(aniosDeInteres())
      .then((res) => {
        const ok = res.filter((r) => r.ok);
        if (ok.length === 0) {
          console.warn(
            '📅 No se pudieron actualizar los feriados desde internet; ' +
              'se sigue usando lo último guardado. ' +
              res.map((r) => `${r.anio}: ${r.detalle}`).join(' | '),
          );
          return;
        }
        console.log(
          '📅 Feriados actualizados — ' + ok.map((r) => `${r.anio}: ${r.guardados}`).join(', '),
        );
      })
      .catch((err) => console.error('Error sincronizando feriados:', err));
  };

  setTimeout(correr, 15_000);
  timer = setInterval(correr, UN_DIA_MS);
  console.log('📅 Feriados: se revisan contra internet cada 24 horas');
}

export function stopFeriadosSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
