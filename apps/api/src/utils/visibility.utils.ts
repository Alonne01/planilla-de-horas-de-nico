import { PrismaClient } from '@prisma/client';

/**
 * Determines which user IDs a given user can see, based on approval flow configuration.
 *
 * Rules:
 * 1. nivel >= 90 (RRHH/ADMIN): all active users in the company
 * 2. nivel < 90: own ID + users visible through flow configuration:
 *    - If a global flow (sectorId=null) includes the role → subordinates across all sectors
 *    - If sector-specific flows include the role → subordinates in those sectors + all users in those sectors
 *    - Additionally: all users in user's own sector if their role is in the sector's flow
 *    - If no flows exist at all for the company/tipo → fallback to legacy behavior
 *
 * @returns Array of user IDs the caller can see (always includes self)
 */
export async function getFlowVisibleUserIds(
  prisma: PrismaClient,
  userId: string,
  empresaId: string,
  userRole: string,
  userNivel: number,
  tipoDocumento: string,
): Promise<string[]> {
  if (userNivel >= 90) {
    const all = await prisma.usuario.findMany({
      where: { empresaId, activo: true },
      select: { id: true },
    });
    return all.map((u: { id: string }) => u.id);
  }

  // Check if ANY active flow assignments exist for this doc type in the company
  const anyAssignment = await prisma.flujoAsignacion.findFirst({
    where: {
      tipoDocumento,
      activo: true,
      flujo: { empresaId, activo: true },
    },
  });

  if (!anyAssignment) {
    return legacyVisibility(prisma, userId, empresaId);
  }

  // Find flow assignments where the user's role is in any approval step
  const matchingAssignments = await prisma.flujoAsignacion.findMany({
    where: {
      tipoDocumento,
      activo: true,
      flujo: {
        empresaId,
        activo: true,
        pasos: { some: { rolAprobador: userRole } },
      },
    },
    select: { sectorId: true },
  });

  if (matchingAssignments.length === 0) {
    return [userId];
  }

  let isGlobal = false;
  const visibleSectorIds: string[] = [];

  for (const a of matchingAssignments) {
    if (a.sectorId) {
      visibleSectorIds.push(a.sectorId);
    } else {
      isGlobal = true;
    }
  }

  const ids = new Set<string>([userId]);

  // 1) Subordinates (supervisorId/coordinadorId = me)
  //    If global flow: all subordinates. If sector-specific: only in those sectors.
  const subordinateWhere = {
    empresaId,
    activo: true,
    OR: [
      { supervisorId: userId },
      { coordinadorId: userId },
    ],
    ...(isGlobal ? {} : { sectorId: { in: visibleSectorIds } }),
  };
  const subordinates = await prisma.usuario.findMany({
    where: subordinateWhere,
    select: { id: true },
  });
  for (const u of subordinates) ids.add(u.id);

  // 2) Same-sector peers: all users in sectors where the user's role is in the flow
  const me = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { sectorId: true },
  });
  // Global flow: own sector peers. Sector-specific: peers in all visible sectors.
  const sectorFilter = isGlobal
    ? (me?.sectorId ? [me.sectorId] : [])
    : visibleSectorIds;

  if (sectorFilter.length > 0) {
    const sectorPeers = await prisma.usuario.findMany({
      where: { sectorId: { in: sectorFilter }, empresaId, activo: true },
      select: { id: true },
    });
    for (const u of sectorPeers) ids.add(u.id);
  }

  return [...ids];
}

/** Legacy visibility: subordinates + same sector (for companies without configured flows) */
async function legacyVisibility(
  prisma: PrismaClient,
  userId: string,
  empresaId: string,
): Promise<string[]> {
  const ids = new Set<string>([userId]);

  const subordinados = await prisma.usuario.findMany({
    where: {
      empresaId,
      activo: true,
      OR: [
        { supervisorId: userId },
        { coordinadorId: userId },
      ],
    },
    select: { id: true },
  });
  for (const u of subordinados) ids.add(u.id);

  const me = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { sectorId: true },
  });
  if (me?.sectorId) {
    const sectorUsers = await prisma.usuario.findMany({
      where: { sectorId: me.sectorId, empresaId, activo: true },
      select: { id: true },
    });
    for (const u of sectorUsers) ids.add(u.id);
  }

  return [...ids];
}
