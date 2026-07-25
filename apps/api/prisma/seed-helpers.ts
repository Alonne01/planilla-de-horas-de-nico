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
 */
export interface DelegadoBuscable {
  findFirst(args: { where: Record<string, unknown> }): Promise<any>;
  create(args: { data: Record<string, unknown> }): Promise<any>;
}

export async function buscarOCrear(
  delegado: DelegadoBuscable,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ fila: any; creada: boolean }> {
  const existente = await delegado.findFirst({ where });
  if (existente) return { fila: existente, creada: false };
  return { fila: await delegado.create({ data }), creada: true };
}
