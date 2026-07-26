/**
 * Lo que comparten la pantalla de flujos y la matriz de configuración.
 *
 * Vive aparte para que las dos vistas hablen de las mismas formas: si cada una
 * declarara su propio `Flujo`, agregar un campo en la API obligaría a acordarse
 * de tocar los dos archivos.
 */

export interface FlujoPaso {
  id: string;
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
  notificarRoles: string[];
}

export interface Flujo {
  id: string;
  nombre: string;
  tipoDocumento: string;
  descripcion: string | null;
  activo: boolean;
  pasos: FlujoPaso[];
  _count: { asignaciones: number; planillas: number; vacaciones: number };
}

export interface Asignacion {
  id: string;
  flujoId: string;
  tipoDocumento: string;
  sectorId: string | null;
  usuarioId: string | null;
  activo: boolean;
  flujo: { nombre: string; tipoDocumento: string };
  sector: { id: string; nombre: string } | null;
  usuario: { id: string; nombre: string; apellido: string } | null;
}

export interface Sector {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface Rol {
  codigo: string;
  nombre: string;
  color: string;
  activo: boolean;
  /** Jerarquía del rol. Es lo que decide qué pasos se saltea quien envía. */
  nivel: number;
}

/**
 * Los cinco tipos de documento que pasan por un circuito. Es la misma lista que
 * `TIPOS_DOCUMENTO` de apps/api/src/routes/admin.flujos.routes.ts: si acá falta
 * uno, el admin que borre ese flujo no tiene forma de recrearlo.
 */
export const TIPOS_DOCUMENTO: { valor: string; label: string; color: string }[] = [
  { valor: 'PLANILLA', label: 'Planilla', color: 'bg-blue-500/20 text-blue-400' },
  { valor: 'VACACION', label: 'Vacación', color: 'bg-emerald-500/20 text-emerald-400' },
  { valor: 'AUSENCIA', label: 'Ausencia', color: 'bg-amber-500/20 text-amber-400' },
  { valor: 'COMPENSATORIO', label: 'Compensatorio', color: 'bg-purple-500/20 text-purple-400' },
  { valor: 'CAMBIO_DIAGRAMA', label: 'Cambio de diagrama', color: 'bg-cyan-500/20 text-cyan-400' },
];

export const COLOR_TIPO_DOC: Record<string, string> = Object.fromEntries(
  TIPOS_DOCUMENTO.map((t) => [t.valor, t.color]),
);

/**
 * Respaldo de presentación: solo se usa si un paso ya guardado referencia un
 * código de rol que ya no está entre los roles activos del servidor (por
 * ejemplo, un rol borrado). Los selectores se arman con los roles reales que
 * devuelve GET /admin/roles, no con esta lista fija.
 */
export const ROL_LABELS: Record<string, string> = {
  OPERADOR: 'Operador',
  SUPERVISOR: 'Supervisor',
  COORDINADOR: 'Coordinador',
  GERENTE: 'Gerente',
  RRHH: 'RRHH',
  ADMIN: 'Admin',
};

export const ROL_COLORS: Record<string, string> = {
  OPERADOR: 'bg-slate-500/20 text-slate-400',
  SUPERVISOR: 'bg-blue-500/20 text-blue-400',
  COORDINADOR: 'bg-purple-500/20 text-purple-400',
  GERENTE: 'bg-amber-500/20 text-amber-400',
  RRHH: 'bg-emerald-500/20 text-emerald-400',
  ADMIN: 'bg-red-500/20 text-red-400',
};

/**
 * El nombre para mostrar de un código de rol. Un paso ya guardado puede
 * referenciar un código que ya no está entre los roles de la empresa; en ese
 * caso cae al respaldo fijo y, si tampoco está ahí, muestra el código crudo en
 * vez de romper o dejar el lugar vacío.
 */
export function nombreDeRol(roles: Rol[], codigo: string): string {
  return roles.find((r) => r.codigo === codigo)?.nombre ?? ROL_LABELS[codigo] ?? codigo;
}

/** La cadena de un flujo en una línea: «Supervisor → Coordinador → RRHH». */
export function cadenaDe(roles: Rol[], pasos: { orden: number; rolAprobador: string }[]): string {
  return [...pasos]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => nombreDeRol(roles, p.rolAprobador))
    .join(' → ');
}
