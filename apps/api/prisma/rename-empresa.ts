import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.empresa.updateMany({
    data: { nombre: 'WENLEN' },
  });
  console.log(`✅ ${result.count} empresa(s) renombrada(s) a "WENLEN"`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
