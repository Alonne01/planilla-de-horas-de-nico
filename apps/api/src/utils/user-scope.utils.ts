import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Whether `actor` (por id + nivel de rol) puede gestionar al empleado `targetUserId`
 * dentro de la misma empresa: RRHH/ADMIN (nivel>=90) siempre; supervisor/coordinador
 * directo; o coordinador+ (nivel>=70) del mismo sector.
 */
export async function canManageUser(
  actorId: string,
  actorNivel: number,
  targetUserId: string,
  empresaId: string,
): Promise<boolean> {
  if (actorNivel >= 90) return true; // RRHH/ADMIN can manage anyone

  const target = await prisma.usuario.findUnique({
    where: { id: targetUserId },
    select: { empresaId: true, supervisorId: true, coordinadorId: true, sectorId: true },
  });
  if (!target || target.empresaId !== empresaId) return false;

  if (target.supervisorId === actorId || target.coordinadorId === actorId) return true;

  if (actorNivel >= 70 && target.sectorId) {
    const actor = await prisma.usuario.findUnique({ where: { id: actorId }, select: { sectorId: true } });
    if (actor?.sectorId === target.sectorId) return true;
  }

  return false;
}
