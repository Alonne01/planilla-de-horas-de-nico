/**
 * Un paso del circuito de aprobación, ya desprendido del flujo que lo originó.
 *
 * Esta es la forma que se guarda en `circuitoSnapshot` del documento: una vez
 * enviado, el recorrido es de ese documento y no vuelve a depender de la
 * configuración, que puede cambiar mientras el documento circula.
 */
export interface PasoCircuito {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  usuarioEspecificoId: string | null;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
  notificarRoles: string[];
}

/**
 * Arma el circuito que le corresponde a quien envía, según su nivel.
 *
 * Regla: se saltea todo paso cuyo aprobador tenga nivel MENOR O IGUAL al del
 * solicitante. Un coordinador no necesita que lo aprueben un supervisor ni otro
 * coordinador; sí un gerente y RRHH.
 *
 * Garantía: nunca devuelve cero pasos si la cadena tenía alguno. Si el nivel
 * del solicitante saltea todo paso de nivel CONOCIDO (por ejemplo, RRHH en una
 * cadena que termina en RRHH), se conserva el ÚLTIMO paso de la cadena
 * original. Así nadie se aprueba a sí mismo y siempre queda una firma ajena.
 * La guarda que impide que el propio solicitante firme ese paso vive en las
 * rutas, no acá.
 *
 * Un rol SIN entrada en `nivelPorRol` (borrado, o desactivado — `nivelesPorRol`
 * solo trae roles activos) no tiene nivel con el que compararlo: no entra en
 * el filtro por nivel y queda SIEMPRE en el circuito, sin condición. Si se le
 * asignara un nivel arbitrario (por ejemplo 0) terminaría salteado por el
 * mismo filtro normal en cuanto el solicitante tuviera nivel > 0, que es
 * exactamente lo contrario de "nunca se saltea": el problema tiene que verse,
 * no esconderse.
 *
 * Devuelve pasos RENUMERADOS desde 1: `pasoActual` del documento indexa este
 * circuito, no la cadena configurada.
 */
export function construirCircuito(
  pasos: PasoCircuito[],
  nivelSolicitante: number,
  nivelPorRol: Record<string, number>,
): PasoCircuito[] {
  if (pasos.length === 0) return [];

  const enOrden = [...pasos].sort((a, b) => a.orden - b.orden);

  // Distingue "el rol tiene nivel conocido" de "vale 0": son cosas distintas.
  // Un huérfano no participa del filtro por nivel en absoluto.
  const tieneNivelConocido = (rol: string) =>
    Object.prototype.hasOwnProperty.call(nivelPorRol, rol);

  const conocidos = enOrden.filter((p) => tieneNivelConocido(p.rolAprobador));
  const huerfanos = enOrden.filter((p) => !tieneNivelConocido(p.rolAprobador));

  const sobrevivientesConocidos = conocidos.filter(
    (p) => nivelPorRol[p.rolAprobador] > nivelSolicitante,
  );

  // La garantía del último paso se evalúa solo contra los pasos de nivel
  // conocido: si ninguno sobrevive, se agrega el último paso de la cadena
  // ORIGINAL completa (aunque sea un huérfano, en cuyo caso ya está incluido
  // más abajo y el Map de más adelante lo deduplica sin problema).
  const garantia = sobrevivientesConocidos.length === 0 ? [enOrden[enOrden.length - 1]] : [];

  // Dedupe por `orden` original y se reordena para no depender del orden de
  // concatenación de los tres grupos.
  const porOrdenOriginal = new Map<number, PasoCircuito>();
  for (const p of [...sobrevivientesConocidos, ...huerfanos, ...garantia]) {
    porOrdenOriginal.set(p.orden, p);
  }
  const final = [...porOrdenOriginal.values()].sort((a, b) => a.orden - b.orden);

  return final.map((p, i) => ({ ...p, orden: i + 1 }));
}
