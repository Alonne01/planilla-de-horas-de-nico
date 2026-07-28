/**
 * Quién puede difundir un mensaje y hasta dónde llega.
 *
 * En vez de una tabla de excepciones por rol, cada remitente tiene un ALCANCE
 * MÁXIMO y todo lo demás se deriva de ahí.
 *
 * La regla que no es obvia: **un rol de nivel ≥ 70 SIN sector asignado es
 * transversal**, no un usuario mal configurado. Es la misma convención que ya
 * rige los circuitos de aprobación, donde un GERENTE sin sector aprueba para
 * toda la empresa. El gerente general es exactamente ese caso: no tiene sector
 * porque su alcance es la compañía entera.
 */

export type AlcanceDifusion = 'EMPRESA' | 'SECTOR' | 'NINGUNO';

/** Nivel mínimo para poder difundir. Coordinador. */
export const NIVEL_MINIMO_DIFUSION = 70;

export interface RemitenteDifusion {
  rol: string;
  rolNivel: number;
  sectorId: string | null;
}

export function alcanceDeDifusion(u: RemitenteDifusion): AlcanceDifusion {
  if (u.rolNivel >= 90) return 'EMPRESA';                          // RRHH / ADMIN
  if (u.rol === 'CMASS') return 'EMPRESA';                         // elige: su sector o toda la planta
  if (u.rolNivel >= NIVEL_MINIMO_DIFUSION && !u.sectorId) return 'EMPRESA'; // transversal (gerente general)
  if (u.rolNivel >= NIVEL_MINIMO_DIFUSION) return 'SECTOR';
  return 'NINGUNO';
}

/**
 * Los `destinoTipo` que ese alcance habilita.
 *
 * `ROL` queda reservado a nivel ≥ 90: es la única segmentación que atraviesa la
 * jerarquía («todos los supervisores de la empresa») y no tiene lectura natural
 * ni para CMASS ni para un gerente general.
 *
 * Con alcance `SECTOR` no van `TODOS` ni `ROL`: no se traducen a "mi sector" sin
 * ambigüedad, y `SECTOR` con el sector propio dice lo mismo sin dejar dudas en
 * la auditoría de a quién se le mandó.
 */
export function destinosPermitidos(alcance: AlcanceDifusion, rolNivel: number): string[] {
  if (alcance === 'NINGUNO') return [];
  if (alcance === 'SECTOR') return ['SECTOR', 'TURNO', 'USUARIO'];
  return rolNivel >= 90
    ? ['TODOS', 'SECTOR', 'ROL', 'TURNO', 'USUARIO']
    : ['TODOS', 'SECTOR', 'TURNO', 'USUARIO'];
}
