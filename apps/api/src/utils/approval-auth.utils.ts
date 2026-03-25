/**
 * Check whether a specific user is authorized to approve/reject a document
 * at its current flow step. Rules:
 * - SUPERVISOR/COORDINADOR/GERENTE: must be in the same sector as the owner
 * - RRHH/ADMIN (nivel >= 90): can approve any sector, but must still match the flow step role
 * - Nobody can approve their own documents
 */
export function isResponsibleApprover(
  rolAprobador: string,
  owner: { id?: string | null; supervisorId: string | null; coordinadorId: string | null; sectorId?: string | null },
  approverId: string,
  approverRole: string,
  _approverNivel: number,
  approverSectorId?: string | null,
): boolean {
  // Never self-approve
  if (owner.id && owner.id === approverId) return false;

  // Sector-restricted roles: SUPERVISOR, COORDINADOR, GERENTE
  if (rolAprobador === 'SUPERVISOR') {
    if (owner.supervisorId) return owner.supervisorId === approverId;
    return approverRole === 'SUPERVISOR'
      && !!owner.sectorId
      && owner.sectorId === approverSectorId;
  }

  if (rolAprobador === 'COORDINADOR') {
    if (owner.coordinadorId) return owner.coordinadorId === approverId;
    return approverRole === 'COORDINADOR'
      && !!owner.sectorId
      && owner.sectorId === approverSectorId;
  }

  if (rolAprobador === 'GERENTE') {
    return approverRole === 'GERENTE'
      && !!owner.sectorId
      && owner.sectorId === approverSectorId;
  }

  // RRHH, ADMIN, or future high-level roles: cross-sector but must match the step role
  return rolAprobador === approverRole;
}
