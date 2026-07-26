import { Prisma } from '@prisma/client';
import { borrarUploadPorUrl } from '../middleware/upload.middleware.js';

/** Lo mínimo que hace falta de una marca para saber qué saldo devolver. */
export interface MarcaSaldo {
  usuarioId: string;
  tipo: string;
  estado: string;
  fechaInicio: Date;
}

/**
 * Devuelve al saldo el compensatorio que la marca tenía reservado (PENDIENTE) o
 * consumido (APROBADA). No hace nada para los otros tipos ni para marcas ya
 * canceladas/rechazadas, que no tienen nada reservado.
 *
 * El año se toma con getFullYear() LOCAL a propósito: es el mismo criterio que usan
 * la acumulación en `avanzar` y el flujo formal de compensatorios. Mezclarlo con UTC
 * acá desalinearía esta operación del resto del sistema de saldos.
 */
export async function devolverSaldoDeMarca(
  tx: Prisma.TransactionClient,
  marca: MarcaSaldo,
): Promise<void> {
  if (marca.tipo !== 'FRANCO_COMPENSATORIO') return;
  const anio = new Date(marca.fechaInicio).getFullYear();
  if (marca.estado === 'APROBADA') {
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: marca.usuarioId, anio },
      data: { compensatoriosUsados: { decrement: 1 } },
    });
  } else if (marca.estado === 'PENDIENTE') {
    await tx.vacacionSaldo.updateMany({
      where: { usuarioId: marca.usuarioId, anio },
      data: { compensatoriosPendientes: { decrement: 1 } },
    });
  }
}

/**
 * Borra del disco los certificados de un conjunto de marcas. Va FUERA de la
 * transacción: el filesystem no participa del rollback, así que se llama recién
 * cuando la transacción confirmó.
 */
export function borrarAdjuntosDeMarcas(urls: Array<string | null>): void {
  for (const url of urls) borrarUploadPorUrl(url);
}
