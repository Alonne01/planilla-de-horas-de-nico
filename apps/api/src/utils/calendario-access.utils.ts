import type { PrismaClient } from '@prisma/client';

// Sin flujos asignados al sector → se cae al gate histórico (COORDINADOR = 70).
const FALLBACK_NIVEL = 70;

export interface CalendarUser {
  rolNivel?: number;
  empresaId: string;
  sectorId?: string | null;
}

/**
 * Nivel del aprobador MÁS BAJO entre TODOS los flujos activos que aplican al
 * sector (asignación específica al sector O global, sectorId null), sobre
 * cualquier tipoDocumento. Si no hay pasos, devuelve 70 (comportamiento previo).
 * `rolAprobador` es un CÓDIGO de rol → se resuelve a nivel vía RolConfig.
 */
export async function nivelMinimoAccesoSector(
  prisma: PrismaClient,
  empresaId: string,
  sectorId: string,
): Promise<number> {
  const pasos = await prisma.flujoPaso.findMany({
    where: {
      flujo: {
        empresaId,
        activo: true,
        asignaciones: { some: { activo: true, OR: [{ sectorId }, { sectorId: null }] } },
      },
    },
    select: { rolAprobador: true },
  });
  if (pasos.length === 0) return FALLBACK_NIVEL;

  const codigos = [...new Set(pasos.map((p) => p.rolAprobador))];
  const roles = await prisma.rolConfig.findMany({
    where: { empresaId, codigo: { in: codigos }, activo: true },
    select: { codigo: true, nivel: true },
  });
  const nivelByCodigo = new Map(roles.map((r) => [r.codigo, r.nivel]));

  let min = Infinity;
  for (const codigo of codigos) {
    const nivel = nivelByCodigo.get(codigo);
    if (nivel != null && nivel < min) min = nivel;
  }
  return min === Infinity ? FALLBACK_NIVEL : min;
}

/**
 * ¿El usuario puede ver el Calendario de Equipo?
 * - RRHH/ADMIN (>= 90): siempre (ven todos los sectores).
 * - Sin sector: no.
 * - Resto: su nivel >= nivel mínimo de la cadena de su sector.
 */
export async function puedeVerCalendario(prisma: PrismaClient, user: CalendarUser): Promise<boolean> {
  const nivel = user.rolNivel ?? 0;
  if (nivel >= 90) return true;
  if (!user.sectorId) return false;
  const min = await nivelMinimoAccesoSector(prisma, user.empresaId, user.sectorId);
  return nivel >= min;
}
