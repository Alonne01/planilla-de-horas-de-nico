const DEBUG = process.env.DEBUG_APPROVALS === '1' || process.env.DEBUG_APPROVALS === 'true';

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
  const result = _isResponsibleApprover(rolAprobador, owner, approverId, approverRole, approverSectorId);
  if (DEBUG) {
    console.log(`[APPROVAL] isResponsibleApprover → ${result}`, JSON.stringify({
      paso: rolAprobador,
      owner: { id: owner.id?.slice(-6), supId: owner.supervisorId?.slice(-6), coordId: owner.coordinadorId?.slice(-6), sector: owner.sectorId?.slice(-6) },
      approver: { id: approverId.slice(-6), role: approverRole, sector: approverSectorId?.slice(-6) },
    }));
  }
  return result;
}

function _isResponsibleApprover(
  rolAprobador: string,
  owner: { id?: string | null; supervisorId: string | null; coordinadorId: string | null; sectorId?: string | null },
  approverId: string,
  approverRole: string,
  approverSectorId?: string | null,
): boolean {
  if (owner.id && owner.id === approverId) return false;

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

  return rolAprobador === approverRole;
}
