/**
 * Seed script to add 20 debug users to an EXISTING database.
 * Run: cd apps/api && npx tsx prisma/seed-debug-users.ts
 */
import { PrismaClient, ContratoTipo } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Agregando 20 usuarios debug...');

  const passwordHash = await bcrypt.hash('Admin1234!', 12);

  // Find the first empresa
  const empresa = await prisma.empresa.findFirst();
  if (!empresa) {
    console.error('❌ No hay empresa. Corré primero el seed principal.');
    process.exit(1);
  }

  // Get existing sectors
  const sectores = await prisma.sector.findMany({ where: { empresaId: empresa.id } });
  const sectorMap: Record<string, string> = {};
  for (const s of sectores) sectorMap[s.nombre] = s.id;

  // Find existing coordinador for Well Testing
  const existingCoord = await prisma.usuario.findFirst({
    where: { empresaId: empresa.id, rol: 'COORDINADOR', sector: { nombre: 'Well Testing' } },
  });

  const usuarios = [
    // Well Testing team (diagrama colors for testing)
    { nombre: 'Martín', apellido: 'Acosta', email: 'macosta@demo.com', rol: 'SUPERVISOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-B', diagramaColor: 'AZUL' },
    { nombre: 'Federico', apellido: 'Benítez', email: 'fbenitez@demo.com', rol: 'OPERADOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-C', diagramaColor: 'AZUL' },
    { nombre: 'Gonzalo', apellido: 'Carrizo', email: 'gcarrizo@demo.com', rol: 'OPERADOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-D', diagramaColor: 'AMARILLO' },
    { nombre: 'Ramiro', apellido: 'Domínguez', email: 'rdominguez@demo.com', rol: 'OPERADOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-E', diagramaColor: 'AMARILLO' },
    { nombre: 'Tomás', apellido: 'Espinoza', email: 'tespinoza@demo.com', rol: 'OPERADOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-C', diagramaColor: 'BASE' },
    { nombre: 'Adrián', apellido: 'Flores', email: 'aflores@demo.com', rol: 'OPERADOR', sector: 'Well Testing', convenio: 'PP', cat: 'TIII-D', diagramaColor: 'BASE' },
    // Fractura team
    { nombre: 'Sebastián', apellido: 'García', email: 'sgarcia@demo.com', rol: 'COORDINADOR', sector: 'Fractura', convenio: 'PJ', cat: 'JER-C' },
    { nombre: 'Nicolás', apellido: 'Herrera', email: 'nherrera@demo.com', rol: 'SUPERVISOR', sector: 'Fractura', convenio: 'PP', cat: 'TII-A1' },
    { nombre: 'Matías', apellido: 'Ibáñez', email: 'mibanez@demo.com', rol: 'OPERADOR', sector: 'Fractura', convenio: 'PP', cat: 'TII-B1' },
    { nombre: 'Facundo', apellido: 'Juárez', email: 'fjuarez@demo.com', rol: 'OPERADOR', sector: 'Fractura', convenio: 'PP', cat: 'TII-C1' },
    { nombre: 'Leandro', apellido: 'Krause', email: 'lkrause@demo.com', rol: 'OPERADOR', sector: 'Fractura', convenio: 'PP', cat: 'TII-D' },
    // Wireline team
    { nombre: 'Gabriel', apellido: 'Luna', email: 'gluna@demo.com', rol: 'COORDINADOR', sector: 'Wireline', convenio: 'PJ', cat: 'JER-C' },
    { nombre: 'Emiliano', apellido: 'Morales', email: 'emorales@demo.com', rol: 'SUPERVISOR', sector: 'Wireline', convenio: 'PP', cat: 'TII-A1' },
    { nombre: 'Santiago', apellido: 'Navarro', email: 'snavarro@demo.com', rol: 'OPERADOR', sector: 'Wireline', convenio: 'PP', cat: 'TII-B1' },
    // END team
    { nombre: 'Franco', apellido: 'Ortiz', email: 'fortiz@demo.com', rol: 'SUPERVISOR', sector: 'END', convenio: 'PP', cat: 'TII-A2' },
    { nombre: 'Agustín', apellido: 'Pereyra', email: 'apereyra@demo.com', rol: 'OPERADOR', sector: 'END', convenio: 'PP', cat: 'TII-C1' },
    // Mantenimiento Mecánico
    { nombre: 'Ezequiel', apellido: 'Quiroga', email: 'equiroga@demo.com', rol: 'SUPERVISOR', sector: 'Mantenimiento Mecánico', convenio: 'PP', cat: 'TII-A1' },
    { nombre: 'Ignacio', apellido: 'Ríos', email: 'irios@demo.com', rol: 'OPERADOR', sector: 'Mantenimiento Mecánico', convenio: 'PP', cat: 'TII-B2' },
    // Pañol
    { nombre: 'Damián', apellido: 'Sosa', email: 'dsosa@demo.com', rol: 'OPERADOR', sector: 'Pañol', convenio: 'PP', cat: 'TII-E' },
    // Certificaciones
    { nombre: 'Valentín', apellido: 'Torres', email: 'vtorres@demo.com', rol: 'OPERADOR', sector: 'Certificaciones', convenio: 'PP', cat: 'TII-C2' },
  ];

  let created = 0;
  for (const u of usuarios) {
    // Skip if user already exists
    const exists = await prisma.usuario.findFirst({ where: { email: u.email, empresaId: empresa.id } });
    if (exists) {
      console.log(`  ⏭️  ${u.email} ya existe`);
      continue;
    }

    const sectorId = sectorMap[u.sector];
    if (!sectorId) {
      console.warn(`  ⚠️  Sector "${u.sector}" no encontrado, saltando ${u.email}`);
      continue;
    }

    // Find coordinador for this sector
    let coordinadorId: string | null = null;
    if (u.rol === 'OPERADOR' || u.rol === 'SUPERVISOR') {
      const coord = await prisma.usuario.findFirst({
        where: { empresaId: empresa.id, rol: 'COORDINADOR', sectorId },
      });
      coordinadorId = coord?.id ?? existingCoord?.id ?? null;
    }

    const fechaIngreso = new Date(2020 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28));

    await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        sectorId,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        passwordHash,
        rol: u.rol,
        legajo: `WT-${String(100 + created).padStart(4, '0')}`,
        tipoContrato: ContratoTipo.INDEFINIDO,
        fechaIngreso,
        coordinadorId,
        diagramaColor: (u as any).diagramaColor ?? null,
      },
    });
    created++;
    console.log(`  ✅ ${u.nombre} ${u.apellido} (${u.rol}, ${u.sector}) — ${u.email}`);
  }

  console.log(`\n🎉 ${created} usuarios debug creados`);
  console.log('Password para todos: Admin1234!');
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
