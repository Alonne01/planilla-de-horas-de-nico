/**
 * Check whether a specific user is authorized to approve/reject a document
 * at its current flow step. Enforces ownership-based authorization:
 * - SUPERVISOR step: user must be the owner's direct supervisor
 * - COORDINADOR step: user must be the owner's direct coordinator
 * - RRHH/ADMIN/GERENTE: role match only (company-wide responsibility)
 * - nivel >= 90: always allowed (RRHH/ADMIN override)
 */
export function isResponsibleApprover(
  rolAprobador: string,
  owner: { supervisorId: string | null; coordinadorId: string | null },
  approverId: string,
  approverRole: string,
  approverNivel: number,
): boolean {
  if (approverNivel >= 90) return true;
  if (rolAprobador === 'SUPERVISOR') return owner.supervisorId === approverId;
  if (rolAprobador === 'COORDINADOR') return owner.coordinadorId === approverId;
  return rolAprobador === approverRole;
}
