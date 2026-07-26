/**
 * Qué flujo de aprobación rige cada alcance, del lado del navegador.
 *
 * Es un ESPEJO de `resolverFlujo` de `apps/api/src/utils/circuito.utils.ts`,
 * recortado a lo que la pantalla necesita: el alcance por SECTOR y el GLOBAL.
 * El servidor además contempla una asignación por usuario, con prioridad sobre
 * las dos: acá se descarta explícitamente (mirá `cuentaParaElSector`) para no
 * mostrar una asignación individual como si rigiera a todo el sector.
 *
 * Existe para que la matriz de configuración diga lo mismo que va a hacer el
 * servidor cuando alguien envíe un documento. Si las dos versiones se separan,
 * el admin configura una cosa y el sistema aplica otra.
 */

/** Lo mínimo que la regla necesita de un flujo. */
export interface FlujoAsignable {
  id: string;
  tipoDocumento: string;
  activo: boolean;
}

/** Lo mínimo que la regla necesita de una asignación. */
export interface AsignacionAlcance {
  flujoId: string;
  tipoDocumento: string;
  sectorId: string | null;
  usuarioId: string | null;
  activo: boolean;
}

/** El flujo que rige un alcance, y de dónde salió. */
export interface Vigencia<F> {
  flujo: F;
  /** `true` si el sector no tiene flujo propio y usa el global de la empresa. */
  heredado: boolean;
}

/**
 * La asignación configurada para un alcance, exista o no un flujo válido detrás.
 *
 * Es lo que hay que mostrar en el selector: si un admin asignó un flujo que
 * después quedó inactivo, la asignación sigue ahí y hay que poder verla para
 * corregirla, aunque `flujoVigente` ya no la tenga en cuenta.
 *
 * Ignora las asignaciones por usuario: son otro alcance, con su propio lugar.
 */
export function asignacionDeAlcance<A extends AsignacionAlcance>(
  asignaciones: A[],
  tipoDocumento: string,
  sectorId: string | null,
): A | undefined {
  return asignaciones.find(
    (a) => a.tipoDocumento === tipoDocumento && a.sectorId === sectorId && !a.usuarioId,
  );
}

/**
 * El flujo que efectivamente rige un sector para un tipo de documento.
 *
 * Prioridad sector → global, igual que el servidor. Devuelve `null` cuando no
 * hay ninguno: en ese caso el documento se envía sin circuito y solo lo puede
 * aprobar alguien de nivel 90 o más.
 *
 * Una asignación NO cuenta si está desactivada, si su flujo está desactivado, si
 * el flujo ya no existe, o si el flujo es de otro tipo de documento. Las cuatro
 * condiciones salen de `resolverFlujo`, que filtra por `activo: true` en los dos
 * lados y repite el `tipoDocumento` adentro de la asignación. Cualquiera de
 * ellas hace que el sector caiga al global, y por eso la matriz tiene que
 * dibujar esa herencia y no el nombre del flujo roto.
 *
 * Para el alcance global (`sectorId === null`) nunca hay herencia: es el último
 * eslabón.
 */
export function flujoVigente<F extends FlujoAsignable>(
  flujos: F[],
  asignaciones: AsignacionAlcance[],
  tipoDocumento: string,
  sectorId: string | null,
): Vigencia<F> | null {
  const flujoDe = (id: string) => flujos.find((f) => f.id === id);

  const cuentaParaElSector = (a: AsignacionAlcance): boolean => {
    if (!a.activo || a.usuarioId) return false;
    if (a.tipoDocumento !== tipoDocumento) return false;
    const f = flujoDe(a.flujoId);
    return !!f && f.activo && f.tipoDocumento === tipoDocumento;
  };

  if (sectorId !== null) {
    const propia = asignaciones.find((a) => a.sectorId === sectorId && cuentaParaElSector(a));
    if (propia) return { flujo: flujoDe(propia.flujoId)!, heredado: false };
  }

  const global = asignaciones.find((a) => a.sectorId === null && cuentaParaElSector(a));
  if (global) return { flujo: flujoDe(global.flujoId)!, heredado: sectorId !== null };

  return null;
}
