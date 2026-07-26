/**
 * El circuito de aprobación, del lado del navegador.
 *
 * Es un ESPEJO de `apps/api/src/utils/circuito.utils.ts`: el back es el que
 * manda (congela el circuito en `circuitoSnapshot` al enviar el documento), esto
 * existe para que la pantalla lea el MISMO recorrido que el servidor. Si las dos
 * versiones se separan, el front muestra pasos que el documento no tiene y
 * decide mal qué botones habilitar.
 *
 * Todo lo que dependa de "qué pasos rigen este documento" tiene que pasar por
 * `pasosDe` / `pasoActualDe` de este archivo: son una sola regla, y duplicada
 * diverge en el primer cambio.
 */

/** Lo mínimo que la regla necesita de un paso. */
export interface PasoConNivel {
  orden: number;
  rolAprobador: string;
}

/**
 * Los pasos que le tocan a quien envía, según su nivel.
 *
 * Replica las dos garantías del back:
 *
 *  1. Se saltea todo paso cuyo aprobador tenga nivel MENOR O IGUAL al del
 *     solicitante. Un coordinador no necesita que lo aprueben un supervisor ni
 *     otro coordinador; sí un gerente y RRHH.
 *
 *  2. Nunca devuelve cero pasos si la cadena tenía alguno: si el nivel del
 *     solicitante saltea todos los pasos de nivel CONOCIDO, se conserva el
 *     ÚLTIMO paso de la cadena original, para que siempre quede una firma ajena.
 *
 * Un rol SIN entrada en `nivelPorRol` (borrado, o desactivado — el back solo
 * manda los niveles de los roles activos) NO participa del filtro por nivel y
 * sobrevive siempre. Resolverlo con `?? 0` lo saltearía en cuanto el
 * solicitante tuviera nivel > 0, que es exactamente lo contrario del back: el
 * problema tiene que verse, no esconderse.
 *
 * A diferencia del back, acá los pasos NO se renumeran 1..N: el `orden`
 * original se conserva porque esto solo dibuja la secuencia, y renumerar
 * obligaría a clonar los objetos sin ninguna ventaja. La pantalla numera por
 * posición.
 */
export function circuitoPara<T extends PasoConNivel>(
  pasos: T[],
  nivelSolicitante: number,
  nivelPorRol: Record<string, number>,
): T[] {
  if (pasos.length === 0) return [];

  const enOrden = [...pasos].sort((a, b) => a.orden - b.orden);

  // Distingue "el rol tiene nivel conocido" de "vale 0": son cosas distintas.
  const conocido = (rol: string) => Object.prototype.hasOwnProperty.call(nivelPorRol, rol);

  const sobrevivenConocidos = enOrden.filter(
    (p) => conocido(p.rolAprobador) && nivelPorRol[p.rolAprobador] > nivelSolicitante,
  );
  const huerfanos = enOrden.filter((p) => !conocido(p.rolAprobador));

  // La garantía del último paso se evalúa SOLO contra los pasos de nivel
  // conocido: si ninguno sobrevive se agrega el último de la cadena original
  // (aunque sea huérfano, en cuyo caso el Map de abajo lo deduplica).
  const garantia = sobrevivenConocidos.length === 0 ? [enOrden[enOrden.length - 1]] : [];

  // Dedupe por `orden` original, para no depender del orden de concatenación.
  const porOrden = new Map<number, T>();
  for (const p of [...sobrevivenConocidos, ...huerfanos, ...garantia]) porOrden.set(p.orden, p);
  return [...porOrden.values()].sort((a, b) => a.orden - b.orden);
}

// ═══════════════════════════════════════════════════════
// QUÉ PASOS RIGEN UN DOCUMENTO
// ═══════════════════════════════════════════════════════

/** Un paso, tal como viaja en `circuitoSnapshot` o en `flujo.pasos`. */
export interface PasoDocumento {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
}

/**
 * La forma mínima de un documento aprobable (planilla, vacación, ausencia,
 * cambio de diagrama). `circuitoSnapshot` va como `unknown` porque es una
 * columna JSON: puede ser un array de pasos, `null` en los documentos anteriores
 * al congelado, o cualquier cosa si alguien la editó a mano.
 */
export interface DocumentoConCircuito {
  circuitoSnapshot: unknown;
  flujo?: { pasos: PasoDocumento[] } | null;
}

/**
 * Los pasos que rigen un documento — espejo de `pasosDe` del back.
 *
 * Prioriza el circuito congelado al enviarlo. Cae a los pasos VIVOS del flujo
 * solo para documentos anteriores a ese cambio, que no tienen snapshot: sin ese
 * fallback, todo lo que estuviera en curso al desplegar se vería sin recorrido.
 *
 * Leer los pasos vivos cuando hay snapshot es justamente el error que esto
 * evita: con un circuito acortado por el nivel del solicitante, la cadena
 * configurada tiene pasos que el documento no recorre.
 */
export function pasosDe(documento: DocumentoConCircuito): PasoDocumento[] {
  if (Array.isArray(documento.circuitoSnapshot)) {
    return documento.circuitoSnapshot as PasoDocumento[];
  }
  // Nadie garantiza el orden de los pasos vivos que manda la API: se ordenan acá
  // porque `pasoActual` indexa por `orden`, no por posición.
  const vivos = documento.flujo?.pasos ?? [];
  return [...vivos].sort((a, b) => a.orden - b.orden);
}

/** El paso vigente según `pasoActual` (1-based). `null` si está fuera de rango. */
export function pasoActualDe(
  documento: DocumentoConCircuito & { pasoActual: number },
): PasoDocumento | null {
  return pasosDe(documento).find((p) => p.orden === documento.pasoActual) ?? null;
}

// ═══════════════════════════════════════════════════════
// RECONSTRUCCIÓN DEL RECORRIDO
// ═══════════════════════════════════════════════════════

/**
 * Un paso del circuito ya cruzado con quién lo firmó. Es la forma que dibuja
 * `ApprovalProgressBar` y la misma que `GET /mis-solicitudes` devuelve ya
 * enriquecida desde el servidor.
 */
export interface PasoRecorrido {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  completado: boolean;
  actual: boolean;
  aprobadoPor?: { nombre: string; apellido: string } | null;
  fecha?: string | null;
  comentario?: string | null;
}

/** Una fila de historial, reducida a lo que los cuatro tipos tienen en común. */
export interface FirmaHistorial {
  pasoFlujo: number | null;
  rolAprobador: string | null;
  estadoNuevo: string;
  comentario: string | null;
  createdAt: string;
  usuario: { nombre: string; apellido: string };
}

/**
 * Cruza los pasos de un documento con su historial — espejo de `enriquecerPasos`
 * del back.
 *
 * Los `pasos` tienen que salir de `pasosDe(documento)`, NO de los pasos vivos:
 * con la cadena editada, los vivos le atribuirían a alguien la aprobación de un
 * paso que no existía cuando el documento circuló.
 *
 * Convive con dos criterios de historial, sin migrar los datos viejos:
 *  - filas NUEVAS (`rolAprobador` no nulo): `pasoFlujo` es el paso que se FIRMÓ;
 *  - filas VIEJAS (`rolAprobador` nulo): `pasoFlujo` guardaba el paso DESTINO,
 *    o sea el firmado + 1.
 * Un documento aprobado a caballo del deploy tiene las dos, así que la fila nueva
 * gana: bajo el criterio viejo la firma del paso N−1 también matchea el paso N, y
 * sin esa prioridad se le atribuiría al aprobador equivocado.
 */
export function enriquecerPasos(
  pasos: PasoDocumento[],
  pasoActual: number,
  historial: FirmaHistorial[],
): PasoRecorrido[] {
  // Un rechazo no es una firma del paso: corta el circuito, no lo completa.
  const firmas = historial.filter((h) => h.estadoNuevo !== 'RECHAZADA');

  return pasos.map((paso) => {
    // `!= null` y no `!== null` a propósito: si un endpoint recorta el `select`
    // del historial, `rolAprobador` llega `undefined` y con la comparación
    // estricta una fila vieja pasaría por nueva.
    const entry =
      firmas.find((h) => h.rolAprobador != null && h.pasoFlujo === paso.orden) ??
      firmas.find((h) => h.rolAprobador == null && h.pasoFlujo === paso.orden + 1);

    return {
      orden: paso.orden,
      nombrePaso: paso.nombrePaso,
      rolAprobador: paso.rolAprobador,
      // Un paso con firma registrada está completado aunque `pasoActual` diga
      // otra cosa: al rechazar, el documento vuelve a 0 y sin esto los pasos que
      // sí se aprobaron antes del corte se pintarían como si nunca hubieran
      // pasado. Para un documento en curso las dos condiciones coinciden.
      completado: paso.orden < pasoActual || entry !== undefined,
      actual: paso.orden === pasoActual,
      aprobadoPor: entry ? { nombre: entry.usuario.nombre, apellido: entry.usuario.apellido } : null,
      fecha: entry ? entry.createdAt : null,
      comentario: entry?.comentario ?? null,
    };
  });
}
