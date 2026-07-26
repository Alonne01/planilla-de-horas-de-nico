/**
 * limpiar-para-testing.ts — Deja la base con SOLO los usuarios de prueba.
 *
 * Es el complemento de `crear-usuarios-prueba.ts`: ese crea la nómina de
 * placeholders (2 usuarios de cada rol en cada sector), este saca todo lo
 * demás para que las pruebas arranquen sobre una base limpia.
 *
 * A diferencia de `reset-testing.ts` —que borra TODOS los usuarios menos el
 * admin y obliga a recrear los de prueba con IDs nuevos— acá los placeholders
 * se conservan tal cual están, con sus relaciones supervisor/coordinador
 * intactas.
 *
 * Borra:
 *   - Todos los usuarios menos admin@wenlen.com y los @test.wenlen.com
 *     (la nómina real de WENLEN que arrastra el seed, y la basura de QA)
 *   - Todos los datos transaccionales (planillas, ausencias, vacaciones,
 *     saldos, WENTOP, mensajes, notificaciones, auditoría, exportaciones…)
 *   - Sectores, flujos y diagramas cuyo nombre arranca con un prefijo de
 *     prueba ("qa-", "Verif", "hunt-", "smoke-", "sim-")
 *   - Empresas huérfanas que hayan dejado las simulaciones
 *
 * Conserva:
 *   - admin@wenlen.com y los 76 usuarios @test.wenlen.com
 *   - Los flujos de aprobación legítimos, con sus pasos y sus asignaciones
 *     por sector / globales
 *   - Sectores, roles, diagramas, feriados y configuración de la empresa
 *
 * Ejecutar:  npx tsx prisma/limpiar-para-testing.ts --dry-run   (solo informa)
 *            npx tsx prisma/limpiar-para-testing.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@wenlen.com';
const DOMINIO_PRUEBA = '@test.wenlen.com';
// Prefijos que usan los scripts de QA y las simulaciones al crear config
const PREFIJOS_DE_PRUEBA = ['qa-', 'Verif', 'verif-', 'hunt-', 'smoke-', 'sim-', 'sim3-'];

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

  const conservados = await prisma.usuario.findMany({
    where: { OR: [{ id: admin.id }, { email: { endsWith: DOMINIO_PRUEBA } }] },
    select: { id: true },
  });
  const idsConservados = conservados.map((u) => u.id);

  const aBorrar = await prisma.usuario.findMany({
    where: { id: { notIn: idsConservados } },
    select: { id: true, email: true },
  });
  const idsBorrar = aBorrar.map((u) => u.id);

  log(`Admin preservado:      ${admin.nombre} ${admin.apellido} (${ADMIN_EMAIL})`);
  log(`Usuarios conservados:  ${idsConservados.length}  (admin + ${idsConservados.length - 1} de ${DOMINIO_PRUEBA})`);
  log(`Usuarios a borrar:     ${idsBorrar.length}`);
  if (dryRun) log('\n*** DRY RUN — no se borra nada ***');
  log('');

  const borrados: Record<string, number> = {};
  const borrar = async (nombre: string, fn: () => Promise<{ count: number }>) => {
    if (dryRun) return;
    const { count } = await fn();
    if (count > 0) borrados[nombre] = count;
  };

  // ── 1. Datos transaccionales ───────────────────────────────────────────────
  // Se vacían por completo, no solo los de los usuarios que se van: la idea es
  // arrancar las pruebas sin ninguna planilla ni solicitud previa. El orden
  // respeta las dependencias: primero los hijos, después los padres.
  log('Borrando datos transaccionales…');
  await borrar('Registros de horas', () => prisma.registroHoras.deleteMany({}));
  await borrar('Historial de planillas', () => prisma.planillaHistorial.deleteMany({}));
  await borrar('Planillas', () => prisma.planilla.deleteMany({}));

  await borrar('Historial de vacaciones', () => prisma.vacacionHistorial.deleteMany({}));
  await borrar('Vacaciones', () => prisma.vacacion.deleteMany({}));
  // Los saldos se rearman solos: la app los crea con upsert al aprobar la
  // primera planilla o al pedir el primer compensatorio.
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

  // ── 2. Referencias que bloquean el borrado de usuarios ─────────────────────
  // Son FKs nullables sin onDelete: hay que soltarlas a mano o el delete falla.
  if (idsBorrar.length > 0) {
    log('Soltando referencias a los usuarios que se van…');

    // supervisorId/coordinadorId apuntan a la misma tabla. Se limpian tanto en
    // los que se borran como en los que quedan (un placeholder podría estar
    // colgado de alguien de la nómina real).
    if (!dryRun) {
      await prisma.usuario.updateMany({
        where: { supervisorId: { in: idsBorrar } },
        data: { supervisorId: null },
      });
      await prisma.usuario.updateMany({
        where: { coordinadorId: { in: idsBorrar } },
        data: { coordinadorId: null },
      });
      // Un paso de flujo puede apuntar a un aprobador nominal.
      const pasos = await prisma.flujoPaso.updateMany({
        where: { usuarioEspecificoId: { in: idsBorrar } },
        data: { usuarioEspecificoId: null },
      });
      if (pasos.count > 0) borrados['Pasos de flujo desvinculados'] = pasos.count;

      // Las plantillas de exportación son configuración: en vez de perderlas,
      // pasan a nombre del admin.
      const plantillas = await prisma.exportacionPlantilla.updateMany({
        where: { creadaPorId: { in: idsBorrar } },
        data: { creadaPorId: admin.id },
      });
      if (plantillas.count > 0) borrados['Plantillas reasignadas al admin'] = plantillas.count;
    }

    // Una asignación de flujo dirigida a un usuario que se va no tiene sentido;
    // las globales y las por sector no se tocan.
    await borrar('Asignaciones de flujo por usuario', () =>
      prisma.flujoAsignacion.deleteMany({ where: { usuarioId: { in: idsBorrar } } }),
    );

    // ── 3. Usuarios ──────────────────────────────────────────────────────────
    log('Borrando usuarios…');
    await borrar('Asignaciones de diagrama', () =>
      prisma.usuarioDiagrama.deleteMany({ where: { usuarioId: { in: idsBorrar } } }),
    );
    await borrar('Tokens de refresh', () =>
      prisma.refreshToken.deleteMany({ where: { usuarioId: { in: idsBorrar } } }),
    );
    await borrar('Tokens de reseteo', () =>
      prisma.passwordResetToken.deleteMany({ where: { usuarioId: { in: idsBorrar } } }),
    );
    await borrar('Usuarios', () => prisma.usuario.deleteMany({ where: { id: { in: idsBorrar } } }));
  }

  // ── 4. Configuración creada por corridas de prueba ─────────────────────────
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
      const ids = flujosPrueba.map((f) => f.id);
      await prisma.flujoPaso.deleteMany({ where: { flujoId: { in: ids } } });
      await prisma.flujoAsignacion.deleteMany({ where: { flujoId: { in: ids } } });
      const { count } = await prisma.flujoAprobacion.deleteMany({ where: { id: { in: ids } } });
      borrados['Flujos de prueba'] = count;
    }
    if (diagramasPrueba.length) {
      const ids = diagramasPrueba.map((d) => d.id);
      await prisma.usuarioDiagrama.deleteMany({ where: { diagramaId: { in: ids } } });
      const { count } = await prisma.diagrama.deleteMany({ where: { id: { in: ids } } });
      borrados['Diagramas de prueba'] = count;
    }
    if (sectoresPrueba.length) {
      const ids = sectoresPrueba.map((s) => s.id);
      // Una asignación de flujo apunta al sector sin cascade: primero se saca.
      await prisma.flujoAsignacion.deleteMany({ where: { sectorId: { in: ids } } });
      const { count } = await prisma.sector.deleteMany({ where: { id: { in: ids } } });
      borrados['Sectores de prueba'] = count;
    }
  }

  // ── 5. Empresas huérfanas ──────────────────────────────────────────────────
  const otras = await prisma.empresa.findMany({
    where: { id: { not: admin.empresaId } },
    select: { id: true },
  });
  if (otras.length > 0) {
    log(`Borrando ${otras.length} empresa(s) de simulaciones…`);
    if (!dryRun) {
      const ids = otras.map((e) => e.id);
      await prisma.flujoPaso.deleteMany({ where: { flujo: { empresaId: { in: ids } } } });
      await prisma.flujoAsignacion.deleteMany({ where: { empresaId: { in: ids } } });
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
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  log('\n─── Resumen ───');
  if (dryRun) {
    log('Nada se borró (--dry-run).');
    log(`Se habrían borrado ${idsBorrar.length} usuarios y todo lo transaccional.`);
  } else {
    const filas = Object.entries(borrados).sort((a, b) => b[1] - a[1]);
    if (filas.length === 0) log('No había nada para borrar.');
    for (const [nombre, cantidad] of filas) {
      log(`  ${nombre.padEnd(34)} ${String(cantidad).padStart(6)}`);
    }
    log('');
    log(`Quedan ${await prisma.usuario.count()} usuarios y ${await prisma.flujoAprobacion.count()} flujos de aprobación.`);
  }
}

main()
  .catch((e) => {
    console.error('Falló la limpieza:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
