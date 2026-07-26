import { PrismaClient } from '@prisma/client';
import { nivelesPorRol } from './circuito.utils.js';

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
    return legacyVisibility(prisma, userId, empresaId, userNivel);
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
  // Global flow: own sector peers. Sector-specific: own sector only (if it has a matching flow).
  // Without this restriction, a coordinator in Sector A sees peers from Sectors B, C, etc.
  // just because those sectors also have COORDINADOR in their flow steps.
  //
  // Un aprobador SIN sector es transversal (así crea el seed a RRHH y GERENTE):
  // acotarlo a "su sector" lo deja viendo solo a sí mismo y su bandeja queda
  // vacía para siempre. Para él el alcance son los sectores cuyo flujo incluye
  // su rol, que es justamente lo que `visibleSectorIds` ya calculó; con flujo
  // global, toda la empresa.
  const esTransversal = !me?.sectorId;
  const verTodaLaEmpresa = esTransversal && isGlobal;
  const sectorFilter = esTransversal
    ? visibleSectorIds
    : isGlobal
      ? [me!.sectorId!]
      : (visibleSectorIds.includes(me!.sectorId!) ? [me!.sectorId!] : []);

  if (verTodaLaEmpresa || sectorFilter.length > 0) {
    const sectorPeers = await prisma.usuario.findMany({
      where: {
        ...(verTodaLaEmpresa ? {} : { sectorId: { in: sectorFilter } }),
        empresaId,
        activo: true,
      },
      select: { id: true },
    });
    for (const u of sectorPeers) ids.add(u.id);
  }

  return filtrarPorNivel(prisma, [...ids], userId, userNivel, empresaId);
}

/** Legacy visibility: subordinates + same sector (for companies without configured flows) */
async function legacyVisibility(
  prisma: PrismaClient,
  userId: string,
  empresaId: string,
  userNivel: number,
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

  return filtrarPorNivel(prisma, [...ids], userId, userNivel, empresaId);
}

/**
 * Deja solo a quienes el actor puede mirar: los de nivel estrictamente menor, más
 * sus subordinados directos (que pueden compartir nivel — dos coordinadores donde
 * uno manda al otro) y él mismo.
 *
 * Ser aprobador NO alcanza: sin este filtro, cualquiera cuyo rol figure en un paso
 * del flujo se lleva el sector entero, pares y superiores incluidos.
 *
 * `Usuario.rol` es un string suelto; el nivel vive en `RolConfig` por empresa, así
 * que se resuelve con `nivelesPorRol`. Un rol HUÉRFANO (borrado o desactivado) no
 * tiene nivel con qué comparar y queda FUERA: acá el default seguro es no mostrar.
 * Es el criterio opuesto al de `construirCircuito` a propósito — allá un huérfano
 * que se saltea deja un documento sin aprobador y hay que verlo; acá un huérfano
 * que se cuela filtra la planilla de otro.
 */
async function filtrarPorNivel(
  prisma: PrismaClient,
  ids: string[],
  actorId: string,
  actorNivel: number,
  empresaId: string,
): Promise<string[]> {
  const candidatos = ids.filter((id) => id !== actorId);
  if (candidatos.length === 0) return [actorId];

  const [usuarios, niveles] = await Promise.all([
    prisma.usuario.findMany({
      where: { id: { in: candidatos } },
      select: { id: true, rol: true, supervisorId: true, coordinadorId: true },
    }),
    nivelesPorRol(prisma, empresaId),
  ]);

  const visibles = usuarios
    .filter((u) => {
      if (u.supervisorId === actorId || u.coordinadorId === actorId) return true;
      const nivel = niveles[u.rol];
      if (nivel === undefined) return false; // rol huérfano: no se muestra
      return nivel < actorNivel;
    })
    .map((u) => u.id);

  return [actorId, ...visibles];
}
