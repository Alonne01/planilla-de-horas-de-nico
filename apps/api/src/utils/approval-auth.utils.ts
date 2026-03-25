/**
 * Check whether a specific user is authorized to approve/reject a document
 * at its current flow step. Enforces ownership-based authorization:
 * - SUPERVISOR step: user must be the owner's direct supervisor, OR if not assigned,
 *   any SUPERVISOR in the same sector
 * - COORDINADOR step: user must be the owner's direct coordinator, OR if not assigned,
 *   any COORDINADOR in the same sector
 * - RRHH/ADMIN/GERENTE: role match only (company-wide responsibility)
 * - nivel >= 90: always allowed (RRHH/ADMIN override)
 */
export function isResponsibleApprover(
  rolAprobador: string,
  owner: { id?: string | null; supervisorId: string | null; coordinadorId: string | null; sectorId?: string | null },
  approverId: string,
  approverRole: string,
  approverNivel: number,
  approverSectorId?: string | null,
): boolean {
  // RRHH/ADMIN override — but never self-approve
  if (approverNivel >= 90) return owner.id !== approverId;

  if (rolAprobador === 'SUPERVISOR') {
    if (owner.supervisorId) return owner.supervisorId === approverId;
    // Fallback: any SUPERVISOR in the same sector (never self)
    return approverId !== owner.id
      && approverRole === 'SUPERVISOR'
      && !!owner.sectorId
      && owner.sectorId === approverSectorId;
  }

  if (rolAprobador === 'COORDINADOR') {
    if (owner.coordinadorId) return owner.coordinadorId === approverId;
    // Fallback: any COORDINADOR in the same sector (never self)
    return approverId !== owner.id
      && approverRole === 'COORDINADOR'
      && !!owner.sectorId
      && owner.sectorId === approverSectorId;
  }

  // Generic role match (RRHH, GERENTE, etc.) — never self
  return approverId !== owner.id && rolAprobador === approverRole;
}
