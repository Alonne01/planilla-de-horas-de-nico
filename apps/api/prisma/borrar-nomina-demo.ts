/**
 * borrar-nomina-demo.ts — Saca la nómina de demo que siembra `seed.ts`.
 *
 * Conserva el admin y los usuarios de prueba (`@test.wenlen.com`, los que crea
 * `crear-usuarios-prueba.ts`). Existe porque el seed crea la nómina completa de
 * `EMPLEADOS` y hay entornos donde solo se la quiere para los flujos y la
 * configuración, no para los ~400 usuarios.
 *
 * Es idempotente y NO borra usuarios que tengan documentos cargados: si alguno
 * tiene planillas, vacaciones o ausencias, corta y avisa en vez de arrastrarlos.
 *
 * Ejecutar:  npx tsx prisma/borrar-nomina-demo.ts --dry-run
 *            npx tsx prisma/borrar-nomina-demo.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const objetivo = await prisma.usuario.findMany({
    where: {
      email: { endsWith: '@wenlen.com', not: 'admin@wenlen.com' },
      // Los de prueba comparten el dominio de segundo nivel pero no el sufijo
      // exacto: `x@test.wenlen.com` no matchea `%@wenlen.com`. El NOT queda
      // igual como red, porque el filtro depende de un detalle del LIKE.
      NOT: { email: { endsWith: '@test.wenlen.com' } },
    },
    select: { id: true, email: true },
  });

  if (objetivo.length === 0) {
    console.log('No hay usuarios de la nómina de demo.');
    return;
  }
  const ids = objetivo.map((u) => u.id);

  const [planillas, vacaciones, ausencias] = await Promise.all([
    prisma.planilla.count({ where: { usuarioId: { in: ids } } }),
    prisma.vacacion.count({ where: { usuarioId: { in: ids } } }),
    prisma.ausencia.count({ where: { usuarioId: { in: ids } } }),
  ]);
  if (planillas + vacaciones + ausencias > 0) {
    console.error(
      `Hay documentos cargados a nombre de esos usuarios ` +
        `(planillas=${planillas} vacaciones=${vacaciones} ausencias=${ausencias}). ` +
        `No se borra nada: revisalos a mano.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Usuarios de la nómina de demo: ${objetivo.length}`);
  if (dryRun) {
    console.log(`*** DRY RUN — no se borró nada. Muestra: ${objetivo.slice(0, 3).map((u) => u.email).join(', ')}`);
    return;
  }

  // `supervisorId` y `coordinadorId` son claves foráneas al mismo modelo y
  // bloquean el borrado. Se sueltan en TODOS los usuarios, no solo en los que se
  // van: un usuario que se conserva puede estar apuntando a uno que se borra.
  await prisma.usuario.updateMany({ where: { supervisorId: { in: ids } }, data: { supervisorId: null } });
  await prisma.usuario.updateMany({ where: { coordinadorId: { in: ids } }, data: { coordinadorId: null } });

  await prisma.usuarioDiagrama.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.passwordResetToken.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.notificacion.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.vacacionSaldo.deleteMany({ where: { usuarioId: { in: ids } } });

  const { count } = await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  console.log(`Borrados ${count} usuarios de la nómina de demo.`);
  console.log(`Quedan ${await prisma.usuario.count()} usuarios en total.`);
}

main()
  .catch((e) => {
    console.error('Falló el borrado de la nómina de demo:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
