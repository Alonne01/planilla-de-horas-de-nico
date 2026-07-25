/**
 * Búsqueda-o-creación para el seed. Hace idempotente cualquier tabla, incluso
 * las que no tienen restricción única sobre su clave natural (sector, diagrama,
 * flujo), sin necesidad de migrar el schema.
 *
 * Si la fila ya existe se devuelve tal cual: NUNCA se pisa con `data`. Eso evita
 * revertir configuración que el usuario o el servidor hayan cambiado después
 * del primer sembrado.
 *
 * Devuelve `creada` para que el seed pueda informar cuántas filas creó de
 * verdad, en vez de imprimir cantidades fijas que serían mentira en una
 * segunda corrida.
 *
 * `where` tiene que ser un subconjunto de `data` con los mismos valores: si no,
 * la idempotencia se rompe en silencio (crea una fila duplicada en cada
 * corrida, sin error, e informando `creada: true` cada vez).
 */
export async function buscarOCrear<
  D extends {
    findFirst(args: { where: any }): Promise<any>;
    create(args: { data: any }): Promise<any>;
  },
>(
  delegado: D,
  where: Parameters<D['findFirst']>[0]['where'],
  data: Parameters<D['create']>[0]['data'],
): Promise<{ fila: Awaited<ReturnType<D['create']>>; creada: boolean }> {
  const existente = await delegado.findFirst({ where });
  if (existente) return { fila: existente, creada: false };
  return { fila: await delegado.create({ data }), creada: true };
}
