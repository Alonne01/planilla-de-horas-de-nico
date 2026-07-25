/**
 * reset-testing.ts — Deja la base lista para empezar a testear de cero.
 *
 * Borra:
 *   - Todos los usuarios menos admin@wenlen.com
 *   - Todos los datos transaccionales (planillas, ausencias, vacaciones,
 *     WENTOP, mensajes, notificaciones, auditoría, exportaciones…)
 *   - Las empresas basura que dejaron las simulaciones (todas menos la del admin)
 *   - La configuración creada por corridas de prueba: sectores, flujos y
 *     diagramas cuyo nombre empieza con "qa-" o "Verif"
 *
 * Conserva:
 *   - admin@wenlen.com y su empresa
 *   - Sectores, roles, flujos, diagramas y tipos de capacitación legítimos
 *   - Feriados y configuración de vacaciones de la empresa
 *
 * Ejecutar:  npx tsx prisma/reset-testing.ts
 *            npx tsx prisma/reset-testing.ts --dry-run   (solo muestra qué haría)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@wenlen.com';
// Prefijos que usan los scripts de QA y las simulaciones al crear datos
const PREFIJOS_DE_PRUEBA = ['qa-', 'Verif', 'verif-', 'hunt-', 'smoke-'];

const esDePrueba = (nombre: string | null | undefined) =>
  !!nombre && PREFIJOS_DE_PRUEBA.some((p) => nombre.toLowerCase().startsWith(p.toLowerCase()));

const dryRun = process.argv.includes('--dry-run');
const log = (msg: string) => console.log(msg);

async function main() {
  const admin = await prisma.usuario.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { id: true, empresaId: true, nombre: true, apellido: true },
  });

  if (!admin) {
    throw new Error(`No existe ${ADMIN_EMAIL}. Abortado para no dejar la base sin ningún acceso.`);
  }

  const empresaId = admin.empresaId;
  log(`Admin preservado: ${admin.nombre} ${admin.apellido} (${ADMIN_EMAIL})`);
  log(`Empresa preservada: ${empresaId}`);
  if (dryRun) log('\n*** DRY RUN — no se borra nada ***');
  log('');

  // ── 1. Datos transaccionales ───────────────────────────────────────────────
  // El orden respeta las dependencias: primero los hijos, después los padres.
  const borrados: Record<string, number> = {};

  const borrar = async (nombre: string, fn: () => Promise<{ count: number }>) => {
    if (dryRun) return;
    const { count } = await fn();
    if (count > 0) borrados[nombre] = count;
  };

  log('Borrando datos transaccionales…');
  await borrar('Registros de horas', () => prisma.registroHoras.deleteMany({}));
  await borrar('Historial de planillas', () => prisma.planillaHistorial.deleteMany({}));
  await borrar('Planillas', () => prisma.planilla.deleteMany({}));

  await borrar('Historial de vacaciones', () => prisma.vacacionHistorial.deleteMany({}));
  await borrar('Vacaciones', () => prisma.vacacion.deleteMany({}));
  await borrar('Saldos de vacaciones', () => prisma.vacacionSaldo.deleteMany({}));

  await borrar('Historial de ausencias', () => prisma.ausenciaHistorial.deleteMany({}));
  await borrar('Ausencias', () => prisma.ausencia.deleteMany({}));

  await borrar('Historial cambios de diagrama', () => prisma.cambioDiagramaHistorial.deleteMany({}));
  await borrar('Solicitudes cambio de diagrama', () => prisma.solicitudCambioDiagrama.deleteMany({}));

  await borrar('Fotos WENTOP', () => prisma.wentopFoto.deleteMany({}));
  await borrar('Tarjetas WENTOP', () => prisma.wentopTarjeta.deleteMany({}));
  await borrar('Gestores WENTOP', () => prisma.wentopGestor.deleteMany({}));

  await borrar('Respuestas de mensajes', () => prisma.mensajeRespuesta.deleteMany({}));
  await borrar('Destinatarios de mensajes', () => prisma.mensajeDestinatario.deleteMany({}));
  await borrar('Mensajes', () => prisma.mensaje.deleteMany({}));

  await borrar('Invitaciones a capacitación', () => prisma.invitacionCapacitacion.deleteMany({}));
  await borrar('Sesiones de capacitación', () => prisma.sesionCapacitacion.deleteMany({}));
  await borrar('Capacitaciones de empleados', () => prisma.empleadoCapacitacion.deleteMany({}));

  await borrar('Notificaciones', () => prisma.notificacion.deleteMany({}));
  await borrar('Auditoría', () => prisma.auditoriaLog.deleteMany({}));
  await borrar('Exportaciones', () => prisma.exportacion.deleteMany({}));
  await borrar('Proyectos', () => prisma.proyecto.deleteMany({}));

  // ── 2. Usuarios (todos menos el admin) ─────────────────────────────────────
  log('Borrando usuarios…');
  await borrar('Asignaciones de diagrama', () =>
    prisma.usuarioDiagrama.deleteMany({ where: { usuarioId: { not: admin.id } } }),
  );
  await borrar('Asignaciones de flujo', () =>
    prisma.flujoAsignacion.deleteMany({ where: { usuarioId: { not: admin.id } } }),
  );
  await borrar('Tokens de refresh', () =>
    prisma.refreshToken.deleteMany({ where: { usuarioId: { not: admin.id } } }),
  );
  await borrar('Tokens de reseteo', () =>
    prisma.passwordResetToken.deleteMany({ where: { usuarioId: { not: admin.id } } }),
  );
  await borrar('Usuarios', () => prisma.usuario.deleteMany({ where: { id: { not: admin.id } } }));

  // ── 3. Configuración creada por pruebas ────────────────────────────────────
  log('Borrando configuración de prueba…');
  const sectores = await prisma.sector.findMany({ select: { id: true, nombre: true } });
  const sectoresPrueba = sectores.filter((s) => esDePrueba(s.nombre));
  const flujos = await prisma.flujoAprobacion.findMany({ select: { id: true, nombre: true } });
  const flujosPrueba = flujos.filter((f) => esDePrueba(f.nombre));
  const diagramas = await prisma.diagrama.findMany({ select: { id: true, nombre: true } });
  const diagramasPrueba = diagramas.filter((d) => esDePrueba(d.nombre));

  log(`  sectores de prueba:  ${sectoresPrueba.length} → ${sectoresPrueba.map((s) => s.nombre).join(', ') || '—'}`);
  log(`  flujos de prueba:    ${flujosPrueba.length} → ${flujosPrueba.map((f) => f.nombre).join(', ') || '—'}`);
  log(`  diagramas de prueba: ${diagramasPrueba.length} → ${diagramasPrueba.map((d) => d.nombre).join(', ') || '—'}`);

  if (!dryRun) {
    if (flujosPrueba.length) {
      await prisma.flujoPaso.deleteMany({ where: { flujoId: { in: flujosPrueba.map((f) => f.id) } } });
      await prisma.flujoAsignacion.deleteMany({ where: { flujoId: { in: flujosPrueba.map((f) => f.id) } } });
      const { count } = await prisma.flujoAprobacion.deleteMany({ where: { id: { in: flujosPrueba.map((f) => f.id) } } });
      borrados['Flujos de prueba'] = count;
    }
    if (diagramasPrueba.length) {
      const { count } = await prisma.diagrama.deleteMany({ where: { id: { in: diagramasPrueba.map((d) => d.id) } } });
      borrados['Diagramas de prueba'] = count;
    }
    if (sectoresPrueba.length) {
      const { count } = await prisma.sector.deleteMany({ where: { id: { in: sectoresPrueba.map((s) => s.id) } } });
      borrados['Sectores de prueba'] = count;
    }
  }

  // ── 4. Empresas basura (todas menos la del admin) ──────────────────────────
  log('Borrando empresas de simulaciones…');
  const otras = await prisma.empresa.findMany({
    where: { id: { not: empresaId } },
    select: { id: true },
  });
  if (!dryRun && otras.length > 0) {
    const ids = otras.map((e) => e.id);
    await prisma.flujoPaso.deleteMany({ where: { flujo: { empresaId: { in: ids } } } });
    await prisma.flujoAsignacion.deleteMany({ where: { flujo: { empresaId: { in: ids } } } });
    await prisma.flujoAprobacion.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.diagrama.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.sector.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.rolConfig.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.tipoCapacitacion.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.vacacionesConfig.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.empresaConfig.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.alertaConfig.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.exportacionPlantilla.deleteMany({ where: { empresaId: { in: ids } } });
    const { count } = await prisma.empresa.deleteMany({ where: { id: { in: ids } } });
    borrados['Empresas de simulaciones'] = count;
  } else {
    log(`  empresas a borrar: ${otras.length}`);
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  log('\n─── Resumen ───');
  if (dryRun) {
    log('Nada se borró (--dry-run).');
  } else {
    const filas = Object.entries(borrados).sort((a, b) => b[1] - a[1]);
    if (filas.length === 0) log('No había nada para borrar.');
    for (const [nombre, cantidad] of filas) {
      log(`  ${nombre.padEnd(32)} ${String(cantidad).padStart(6)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Falló la limpieza:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
