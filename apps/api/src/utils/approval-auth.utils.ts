import { pasosDe, type PasoCircuito } from './circuito.utils.js';

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

  // ADMIN: escape hatch para destrabar aprobaciones (p. ej. un paso cuyo rol no
  // tiene aprobador asignado en el sector). Puede avanzar cualquier paso, salvo
  // aprobar su propio documento (ya descartado arriba).
  if (approverRole === 'ADMIN') return true;

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
    if (approverRole !== 'GERENTE') return false;
    // Un gerente SIN sector es transversal, igual que RRHH: así los crea el seed
    // (`['ADMIN','RRHH','GERENTE']` en ADMINISTRACION van con `sectorId: null`).
    // Exigirle que comparta sector con el dueño lo dejaba sin poder firmar NUNCA
    // ningún paso GERENTE, porque nunca hay sector que comparar.
    if (!approverSectorId) return true;
    // Un gerente CON sector sí queda acotado al suyo, que es la lectura
    // restrictiva y la que ya aplican supervisor y coordinador.
    return !!owner.sectorId && owner.sectorId === approverSectorId;
  }

  // RRHH and ADMIN are equivalent for RRHH-step approvals
  if (rolAprobador === 'RRHH') {
    return approverRole === 'RRHH' || approverRole === 'ADMIN';
  }
  return rolAprobador === approverRole;
}

/**
 * Un documento que circula por un flujo, reducido a lo único que hace falta para
 * decidir a quién le toca. Sirve para los cinco tipos (planilla, vacación,
 * ausencia, compensatorio —vía su planilla— y cambio de diagrama).
 *
 * `supervisorId` y `coordinadorId` van OBLIGATORIOS a propósito: si el `select`
 * de la consulta se los olvida, la decisión se toma con datos incompletos y
 * `matchesCurrentStep` esconde documentos en silencio. Mejor que no compile.
 */
export interface DocumentoConCircuito {
  circuitoSnapshot: unknown;
  pasoActual: number;
  flujo?: { pasos: PasoCircuito[] } | null;
  usuario: {
    id?: string | null;
    sectorId?: string | null;
    supervisorId: string | null;
    coordinadorId: string | null;
  };
}

/** Quién está mirando: el aprobador y su contexto. */
export interface AprobadorContexto {
  userId: string;
  rol: string;
  nivel: number;
  sectorId: string | null;
}

/**
 * ¿Este documento le toca a quien lo está mirando?
 *
 * Tiene que dar exactamente lo mismo que la guarda de `/avanzar` de cada ruta, o
 * las vistas mienten en alguna de las dos direcciones: le ofrecen a alguien algo
 * que después no puede aprobar, o le esconden algo que sí.
 *
 * Vive acá y no como closure de la bandeja porque lo usan dos vistas
 * (`GET /aprobaciones` y `GET /cambios-diagrama/pendientes`) y duplicado
 * divergen en el primer cambio.
 *
 * Lee el circuito con `pasosDe`: el snapshot congelado renumera los pasos desde
 * 1, así que `pasoActual` NO indexa la cadena configurada. Con un circuito
 * acortado por nivel, buscar el paso vivo por `orden` se lo ofrecía al rol
 * equivocado.
 */
export function matchesCurrentStep(
  documento: DocumentoConCircuito,
  aprobador: AprobadorContexto,
): boolean {
  // Nadie aprueba lo suyo: la misma guarda que abre `/avanzar`.
  if (documento.usuario.id && documento.usuario.id === aprobador.userId) return false;

  const pasos = pasosDe(documento);

  // Sin circuito el documento cae en la rama de escape del avance, que pide
  // nivel RRHH o superior. Devolver `false` acá lo dejaba invisible para todos,
  // incluido justamente quien sí podía aprobarlo.
  if (pasos.length === 0 || documento.pasoActual > pasos.length) return aprobador.nivel >= 90;

  const paso = pasos.find((p) => p.orden === documento.pasoActual);
  if (!paso) return false;

  return isResponsibleApprover(
    paso.rolAprobador,
    documento.usuario,
    aprobador.userId,
    aprobador.rol,
    aprobador.nivel,
    aprobador.sectorId,
  );
}
