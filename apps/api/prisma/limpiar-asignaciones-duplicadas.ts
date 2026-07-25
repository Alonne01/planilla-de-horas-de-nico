/**
 * limpiar-asignaciones-duplicadas.ts — Deja una sola asignación de flujo por
 * (tipoDocumento, alcance), donde el alcance es el sector, el usuario o global.
 *
 * Corre ANTES de la migración que agrega la restricción única: con duplicados,
 * la migración falla al aplicarse. Es idempotente, así que se puede reintentar.
 *
 * Criterio: se conserva la asignación MÁS ANTIGUA. Es la que venía del seed o
 * la que el sector viene usando; la nueva suele ser un agregado por error, que
 * además hoy le roba el sector a la vieja en silencio (con varias asignaciones
 * activas gana una al azar).
 *
 * La antigüedad se mide por `flujo.createdAt` porque FlujoAsignacion no tiene
 * fecha propia. Como el seed crea todos los flujos en la misma transacción, dos
 * pueden compartir el timestamp; por eso el desempate final es por `id`, que es
 * estable entre corridas y no depende del orden en que Postgres devuelva filas.
 *
 * Ejecutar:  npx tsx prisma/limpiar-asignaciones-duplicadas.ts
 *            npx tsx prisma/limpiar-asignaciones-duplicadas.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const todas = await prisma.flujoAsignacion.findMany({
    orderBy: { id: 'asc' },
    include: {
      flujo: { select: { nombre: true, createdAt: true } },
      sector: { select: { nombre: true } },
      usuario: { select: { email: true } },
    },
  });

  // Agrupamos por la misma clave que va a tener la restricción única. Las
  // asignaciones sin sector ni usuario son las globales, y también tienen que
  // ser únicas por tipo (eso lo cubre un índice parcial, porque para Postgres
  // dos NULL no son iguales).
  const porClave = new Map<string, typeof todas>();
  for (const a of todas) {
    const clave = `${a.tipoDocumento}|${a.sectorId ?? '-'}|${a.usuarioId ?? '-'}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), a]);
  }

  const aBorrar: string[] = [];
  for (const [clave, grupo] of porClave) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort(
      (x, y) =>
        x.flujo.createdAt.getTime() - y.flujo.createdAt.getTime() || x.id.localeCompare(y.id),
    );
    const conserva = ordenado[0];
    const sobran = ordenado.slice(1);
    const alcance = conserva.sector?.nombre ?? conserva.usuario?.email ?? 'global';
    console.log(`${clave}  (${alcance})`);
    console.log(`   conserva: ${conserva.flujo.nombre}`);
    for (const s of sobran) {
      console.log(`   borra:    ${s.flujo.nombre}`);
      aBorrar.push(s.id);
    }
  }

  if (aBorrar.length === 0) {
    console.log('No hay asignaciones duplicadas.');
    return;
  }
  if (dryRun) {
    console.log(`\n*** DRY RUN — se borrarían ${aBorrar.length} asignaciones ***`);
    return;
  }
  const { count } = await prisma.flujoAsignacion.deleteMany({ where: { id: { in: aBorrar } } });
  console.log(`\nBorradas ${count} asignaciones duplicadas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
