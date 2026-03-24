import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditLogParams {
  entidad: string;
  entidadId: string;
  accion: 'CREAR' | 'EDITAR' | 'ELIMINAR';
  campo?: string;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  descripcion?: string;
  usuarioId: string;
}

export async function logAuditoria(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditoriaLog.create({
      data: {
        entidad: params.entidad,
        entidadId: params.entidadId,
        accion: params.accion,
        campo: params.campo ?? null,
        valorAnterior: params.valorAnterior ?? null,
        valorNuevo: params.valorNuevo ?? null,
        descripcion: params.descripcion ?? null,
        usuarioId: params.usuarioId,
      },
    });
  } catch (err) {
    console.error('[AUDIT] Error writing audit log:', err);
  }
}

/**
 * Log multiple field changes for a single entity update.
 * Compares old vs new values and writes one log entry per changed field.
 */
export async function logFieldChanges(
  entidad: string,
  entidadId: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  usuarioId: string,
  descripcionBase?: string,
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [campo, newVal] of Object.entries(newValues)) {
    const oldVal = oldValues[campo];
    const oldStr = oldVal == null ? null : String(oldVal);
    const newStr = newVal == null ? null : String(newVal);

    if (oldStr !== newStr) {
      promises.push(
        logAuditoria({
          entidad,
          entidadId,
          accion: 'EDITAR',
          campo,
          valorAnterior: oldStr,
          valorNuevo: newStr,
          descripcion: descripcionBase ? `${descripcionBase} — ${campo}` : undefined,
          usuarioId,
        }),
      );
    }
  }

  await Promise.all(promises);
}
