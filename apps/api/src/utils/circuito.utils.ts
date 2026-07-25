import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Un paso del circuito de aprobación, ya desprendido del flujo que lo originó.
 *
 * Esta es la forma que se guarda en `circuitoSnapshot` del documento: una vez
 * enviado, el recorrido es de ese documento y no vuelve a depender de la
 * configuración, que puede cambiar mientras el documento circula.
 *
 * Va como `type` y no como `interface` a propósito: TypeScript solo le da
 * index signature implícita a los type alias, y sin ella un `PasoCircuito[]` no
 * encaja en el `Prisma.InputJsonValue` de la columna `circuitoSnapshot`. Con
 * `interface` cada uno de los cuatro tipos de documento necesitaría un cast.
 */
export type PasoCircuito = {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  usuarioEspecificoId: string | null;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
  notificarRoles: string[];
};

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

/**
 * Los tipos de documento que pasan por un flujo. `tipoDocumento` es String en
 * el schema, no un enum de Prisma: esta unión es la única cosa que impide
 * escribir un tipo inexistente y que la consulta devuelva null en silencio.
 */
export type TipoDocumentoFlujo = 'PLANILLA' | 'VACACION' | 'AUSENCIA' | 'COMPENSATORIO' | 'CAMBIO_DIAGRAMA';

/**
 * Qué flujo le corresponde a un documento, con prioridad usuario → sector →
 * global. Devuelve null si no hay ninguno configurado.
 *
 * La prioridad se resuelve con tres consultas encadenadas y no con un OR: en un
 * OR plano el flujo global le puede ganar al asignado al usuario, que es
 * justamente lo contrario de lo que la asignación quiere decir.
 *
 * El `orderBy` es obligatorio: sin él, con dos asignaciones que empatan el
 * resultado lo decide el orden físico de Postgres y puede cambiar entre
 * consultas. La restricción única que agrega la migración de este plan hace que
 * el empate no ocurra, pero el orden queda igual para que el comportamiento no
 * dependa de esa garantía.
 */
export async function resolverFlujo(
  prisma: PrismaClient,
  tipoDocumento: TipoDocumentoFlujo,
  usuario: { userId: string; empresaId: string; sectorId: string | null },
): Promise<{ id: string } | null> {
  const base = { empresaId: usuario.empresaId, tipoDocumento, activo: true };
  // El `tipoDocumento` se repite adentro de la asignación a propósito: una
  // asignación puede apuntar a un flujo de otro tipo y no tiene que contar.
  const buscar = (asignacion: Prisma.FlujoAsignacionWhereInput) =>
    prisma.flujoAprobacion.findFirst({
      where: { ...base, asignaciones: { some: { ...asignacion, activo: true, tipoDocumento } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

  const porUsuario = await buscar({ usuarioId: usuario.userId });
  if (porUsuario) return porUsuario;

  if (usuario.sectorId) {
    const porSector = await buscar({ sectorId: usuario.sectorId });
    if (porSector) return porSector;
  }

  return buscar({ sectorId: null, usuarioId: null });
}

/**
 * Los niveles de cada código de rol de la empresa, para `construirCircuito`.
 *
 * Solo roles activos: un rol desactivado no tiene nivel con el que comparar y
 * `construirCircuito` lo trata como huérfano, que es lo que se quiere.
 */
export async function nivelesPorRol(
  prisma: PrismaClient,
  empresaId: string,
): Promise<Record<string, number>> {
  const roles = await prisma.rolConfig.findMany({
    where: { empresaId, activo: true },
    select: { codigo: true, nivel: true },
  });
  // La tupla va `as const` para que `fromEntries` infiera number y no any.
  return Object.fromEntries(roles.map((r) => [r.codigo, r.nivel] as const));
}

/**
 * Los pasos que rigen un documento.
 *
 * Prioriza el snapshot congelado al enviarlo. Cae a los pasos vivos del flujo
 * solo para documentos anteriores a este cambio, que no tienen snapshot: sin
 * ese fallback, todo lo que estuviera en curso al desplegar quedaría trabado.
 */
export function pasosDe(documento: {
  circuitoSnapshot: unknown;
  flujo?: { pasos: PasoCircuito[] } | null;
}): PasoCircuito[] {
  if (Array.isArray(documento.circuitoSnapshot)) {
    return documento.circuitoSnapshot as PasoCircuito[];
  }
  // Los pasos vivos vienen del `include` y nadie garantiza su orden: se ordenan
  // acá porque `pasoActual` indexa por `orden`, no por posición.
  const vivos = documento.flujo?.pasos ?? [];
  return [...vivos].sort((a, b) => a.orden - b.orden);
}

/** El paso vigente según `pasoActual` (1-based). `null` si está fuera de rango. */
export function pasoActualDe(
  documento: { circuitoSnapshot: unknown; pasoActual: number; flujo?: { pasos: PasoCircuito[] } | null },
): PasoCircuito | null {
  return pasosDe(documento).find((p) => p.orden === documento.pasoActual) ?? null;
}
