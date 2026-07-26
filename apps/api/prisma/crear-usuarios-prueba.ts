/**
 * crear-usuarios-prueba.ts — Nómina de placeholders para pruebas manuales.
 *
 * Crea 2 usuarios de cada rol operativo en CADA sector, más los roles
 * transversales, y los deja enganchados entre sí (supervisorId /
 * coordinadorId) para que se puedan probar de verdad los alcances:
 *
 *   - Un SUPERVISOR ve a sus subordinados directos, no a los del otro
 *     supervisor del mismo sector (nivel 60-69, user-scope.utils.ts).
 *   - Un COORDINADOR ve todo su sector (nivel >= 70).
 *   - RRHH y GERENTE son transversales y van sin sector, como en el seed.
 *
 * Las fechas de ingreso están repartidas a propósito entre los cinco tramos de
 * antigüedad de vacacionesConfig (0-1, 1-5, 5-10, 10-20, 20+ años), así los
 * saldos salen distintos y se puede verificar el cálculo sin editar nada.
 *
 * Todos usan el dominio @test.wenlen.com, así que se distinguen de un vistazo
 * de la nómina real y se borran de una.
 *
 * Ejecutar:  npx tsx prisma/crear-usuarios-prueba.ts
 *            npx tsx prisma/crear-usuarios-prueba.ts --borrar
 *
 * Es idempotente: correrlo dos veces no duplica nada.
 */

import { PrismaClient, ContratoTipo } from '@prisma/client';
import bcrypt from 'bcrypt';
import { buscarOCrear } from './seed-helpers.js';

const prisma = new PrismaClient();

const DOMINIO = '@test.wenlen.com';
const PASSWORD = 'Prueba2026!';

/** Rol operativo: existe dentro de un sector. */
const ROLES_POR_SECTOR = [
  { codigo: 'COORDINADOR', etiqueta: 'Coordinador', slug: 'coord', legajo: 'COO' },
  { codigo: 'SUPERVISOR', etiqueta: 'Supervisor', slug: 'sup', legajo: 'SUP' },
  { codigo: 'OPERADOR', etiqueta: 'Operador', slug: 'op', legajo: 'OPE' },
  { codigo: 'CMASS', etiqueta: 'Cmass', slug: 'cmass', legajo: 'CMA' },
] as const;

/** Rol transversal: no cuelga de ningún sector, igual que en el seed. */
const ROLES_TRANSVERSALES = [
  { codigo: 'RRHH', etiqueta: 'Rrhh', slug: 'rrhh', legajo: 'RRH' },
  { codigo: 'GERENTE', etiqueta: 'Gerente', slug: 'gerente', legajo: 'GER' },
] as const;

/** Un año por tramo de antigüedad, para que los saldos de vacaciones difieran. */
const ANIOS_INGRESO = [2026, 2023, 2019, 2012, 2001];

/** Sin acentos ni espacios: sirve para el email y para el legajo. */
function slugSector(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')[0];
}

async function borrarTodos(): Promise<void> {
  const objetivo = await prisma.usuario.findMany({
    where: { email: { endsWith: DOMINIO } },
    select: { id: true },
  });
  if (objetivo.length === 0) {
    console.log('No hay usuarios de prueba para borrar.');
    return;
  }
  const ids = objetivo.map((u) => u.id);
  // Primero se sueltan las referencias entre ellos: supervisorId y
  // coordinadorId son claves foráneas al mismo usuario y bloquean el borrado.
  await prisma.usuario.updateMany({
    where: { id: { in: ids } },
    data: { supervisorId: null, coordinadorId: null },
  });
  await prisma.usuarioDiagrama.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { usuarioId: { in: ids } } });
  const { count } = await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  console.log(`Borrados ${count} usuarios de prueba.`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--borrar')) {
    await borrarTodos();
    return;
  }

  const empresa = await prisma.empresa.findFirst({ select: { id: true } });
  if (!empresa) {
    throw new Error('No hay ninguna empresa en la base. Corré el seed primero.');
  }

  const sectores = await prisma.sector.findMany({
    where: { empresaId: empresa.id },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
  if (sectores.length === 0) {
    throw new Error('No hay sectores. Corré el seed primero.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  let creados = 0;
  let existentes = 0;
  let indiceAntiguedad = 0;

  const crear = async (datos: {
    email: string;
    nombre: string;
    apellido: string;
    legajo: string;
    rol: string;
    sectorId: string | null;
    supervisorId?: string | null;
    coordinadorId?: string | null;
    diagramaColor?: string | null;
  }): Promise<string> => {
    const anio = ANIOS_INGRESO[indiceAntiguedad % ANIOS_INGRESO.length];
    indiceAntiguedad++;
    const { fila, creada } = await buscarOCrear(
      prisma.usuario,
      { email: datos.email },
      {
        empresaId: empresa.id,
        sectorId: datos.sectorId,
        nombre: datos.nombre,
        apellido: datos.apellido,
        email: datos.email,
        passwordHash,
        legajo: datos.legajo,
        rol: datos.rol,
        tipoContrato: ContratoTipo.INDEFINIDO,
        fechaIngreso: new Date(`${anio}-03-15T00:00:00.000Z`),
        supervisorId: datos.supervisorId ?? null,
        coordinadorId: datos.coordinadorId ?? null,
        diagramaColor: datos.diagramaColor ?? null,
        // Sin esto la app obliga a cambiar la contraseña en el primer ingreso,
        // que es justo lo que no se quiere en un usuario descartable.
        primerLogin: false,
      },
    );
    if (creada) creados++;
    else existentes++;
    return fila.id;
  };

  for (const sector of sectores) {
    const slug = slugSector(sector.nombre);
    const abrev = slug.slice(0, 3).toUpperCase();
    // El apellido es el sector: en el listado (que ordena por apellido) quedan
    // agrupados, y en el selector de debug (que agrupa por rol) se ve de qué
    // sector es cada uno.
    const apellido = sector.nombre;

    // Los coordinadores van primero porque los de abajo los referencian.
    const coordinadores: string[] = [];
    const supervisores: string[] = [];

    for (const n of [1, 2]) {
      for (const rol of ROLES_POR_SECTOR) {
        const id = await crear({
          email: `${rol.slug}${n}.${slug}${DOMINIO}`,
          nombre: `${rol.etiqueta} ${n}`,
          apellido,
          legajo: `T-${abrev}-${rol.legajo}${n}`,
          rol: rol.codigo,
          sectorId: sector.id,
          // Cada supervisor cuelga de un coordinador distinto y cada operador
          // de un supervisor distinto: así se puede ver que el supervisor 1 no
          // alcanza al equipo del supervisor 2 dentro del mismo sector.
          coordinadorId: rol.codigo === 'COORDINADOR' ? null : (coordinadores[n - 1] ?? null),
          supervisorId: rol.codigo === 'OPERADOR' ? (supervisores[n - 1] ?? null) : null,
          // El badge de color solo se usa en Testing (Well Testing).
          diagramaColor:
            sector.nombre === 'Testing' ? (n === 1 ? 'AZUL' : 'AMARILLO') : null,
        });
        if (rol.codigo === 'COORDINADOR') coordinadores[n - 1] = id;
        if (rol.codigo === 'SUPERVISOR') supervisores[n - 1] = id;
      }
    }
  }

  for (const rol of ROLES_TRANSVERSALES) {
    for (const n of [1, 2]) {
      await crear({
        email: `${rol.slug}${n}${DOMINIO}`,
        nombre: `${rol.etiqueta} ${n}`,
        apellido: 'Central',
        legajo: `T-CEN-${rol.legajo}${n}`,
        rol: rol.codigo,
        sectorId: null,
      });
    }
  }

  console.log('');
  console.log(`Sectores cubiertos: ${sectores.length}`);
  console.log(`Usuarios creados:   ${creados}`);
  console.log(`Ya existían:        ${existentes}`);
  console.log('');
  console.log(`Contraseña de todos: ${PASSWORD}`);
  console.log(`Dominio:             ${DOMINIO}  (para borrarlos: --borrar)`);
}

main()
  .catch((e) => {
    console.error('Falló la creación de usuarios de prueba:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
