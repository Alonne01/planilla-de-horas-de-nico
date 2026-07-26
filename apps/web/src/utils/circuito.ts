/**
 * Vista previa del circuito de aprobación, del lado del navegador.
 *
 * Es un ESPEJO de `construirCircuito` de `apps/api/src/utils/circuito.utils.ts`:
 * el back es el que manda (congela el circuito en `circuitoSnapshot` al enviar
 * el documento), esto solo existe para que el admin VEA la regla antes de
 * guardar un flujo. Si las dos versiones se separan, la pantalla miente.
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
