/**
 * Script para agregar sectores y flujos faltantes a una base de datos existente.
 * Ejecutar: npx tsx prisma/add-sectors-flows.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get the first empresa
  const empresa = await prisma.empresa.findFirst();
  if (!empresa) {
    console.error('❌ No se encontró ninguna empresa. Ejecutá primero el seed.');
    return;
  }
  console.log(`📦 Empresa: ${empresa.nombre} (${empresa.id})\n`);

  // ─── Sectores ────────────────────────────────────────
  const nuevos = [
    { nombre: 'Pañol', color: '#06B6D4', descripcion: 'Gestión de pañol y herramientas' },
    { nombre: 'PH', color: '#6366F1', descripcion: 'Pruebas hidráulicas' },
    { nombre: 'Certificaciones', color: '#D946EF', descripcion: 'Certificaciones y documentación' },
    { nombre: 'Mantenimiento de Trailers', color: '#F97316', descripcion: 'Mantenimiento de trailers y vehículos' },
  ];

  let sectoresCreados = 0;
  for (const s of nuevos) {
    const existe = await prisma.sector.findFirst({
      where: { empresaId: empresa.id, nombre: s.nombre },
    });
    if (!existe) {
      await prisma.sector.create({ data: { empresaId: empresa.id, ...s } });
      console.log(`  ✅ Sector creado: ${s.nombre}`);
      sectoresCreados++;
    } else {
      console.log(`  ⏭️  Sector ya existe: ${s.nombre}`);
    }
  }
  console.log(`\n📊 ${sectoresCreados} sectores nuevos creados\n`);

  // ─── Flujos de Aprobación ────────────────────────────
  const flujosNuevos = [
    {
      nombre: 'Flujo Estándar Ausencias',
      tipoDocumento: 'AUSENCIA',
      descripcion: 'Flujo de aprobación para ausencias (licencias, enfermedad, etc.)',
      pasos: [
        { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['RRHH', 'OPERADOR'] },
        { orden: 2, nombrePaso: 'Confirmación RRHH', rolAprobador: 'RRHH', accionAprobar: 'CONFIRMAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
      ],
    },
    {
      nombre: 'Flujo Compensatorios',
      tipoDocumento: 'COMPENSATORIO',
      descripcion: 'Flujo de aprobación para francos compensatorios',
      pasos: [
        { orden: 1, nombrePaso: 'Revisión Coordinador', rolAprobador: 'COORDINADOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['SUPERVISOR', 'RRHH'] },
        { orden: 2, nombrePaso: 'Aprobación RRHH', rolAprobador: 'RRHH', accionAprobar: 'CONFIRMAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
      ],
    },
  ];

  let flujosCreados = 0;
  for (const f of flujosNuevos) {
    const existe = await prisma.flujoAprobacion.findFirst({
      where: { empresaId: empresa.id, tipoDocumento: f.tipoDocumento },
    });
    if (!existe) {
      const flujo = await prisma.flujoAprobacion.create({
        data: {
          empresaId: empresa.id,
          nombre: f.nombre,
          tipoDocumento: f.tipoDocumento,
          descripcion: f.descripcion,
          pasos: { create: f.pasos },
        },
      });
      // Create global assignment
      await prisma.flujoAsignacion.create({
        data: { empresaId: flujo.empresaId, flujoId: flujo.id, tipoDocumento: f.tipoDocumento },
      });
      console.log(`  ✅ Flujo creado: ${f.nombre} (${f.tipoDocumento})`);
      flujosCreados++;
    } else {
      console.log(`  ⏭️  Flujo ya existe: ${f.tipoDocumento}`);
    }
  }
  console.log(`\n📊 ${flujosCreados} flujos nuevos creados`);

  // Summary
  const totalSectores = await prisma.sector.count({ where: { empresaId: empresa.id } });
  const totalFlujos = await prisma.flujoAprobacion.count({ where: { empresaId: empresa.id } });
  console.log(`\n🏁 Total: ${totalSectores} sectores, ${totalFlujos} flujos de aprobación\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
