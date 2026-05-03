/**
 * reset-demo.ts — Limpia datos transaccionales y usuarios,
 * preserva: Empresa, Sectores, Roles, Flujos, Convenios, Categorías, Conceptos, Diagramas, Config.
 * Crea ~10 usuarios demo por sector con roles variados.
 *
 * Ejecutar:  npx ts-node prisma/reset-demo.ts
 */

import { PrismaClient, ContratoTipo } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

// ──────────────────────────────────────────────
// Demo personnel: ~10 per sector, varied roles
// ──────────────────────────────────────────────
interface DemoUser {
  nombre: string;
  apellido: string;
  sectorNombre: string | null; // null = sin sector (admin/rrhh/gerente)
  rol: string;
  legajo: string;
  email: string;
  convenio: 'PP' | 'PJ';
  categoria: string;
}

const DEMO_USERS: DemoUser[] = [
  // ── FRACTURA (10) ──────────────────────────
  { nombre: 'Martín', apellido: 'López', sectorNombre: 'Fractura', rol: 'COORDINADOR', legajo: 'D001', email: 'martin.lopez@demo.com', convenio: 'PP', categoria: 'TII-TA-IX' },
  { nombre: 'Lucas', apellido: 'Fernández', sectorNombre: 'Fractura', rol: 'SUPERVISOR', legajo: 'D002', email: 'lucas.fernandez@demo.com', convenio: 'PP', categoria: 'TII-TA-VIII' },
  { nombre: 'Diego', apellido: 'Ramírez', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D003', email: 'diego.ramirez@demo.com', convenio: 'PP', categoria: 'TII-TA-VII' },
  { nombre: 'Facundo', apellido: 'García', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D004', email: 'facundo.garcia@demo.com', convenio: 'PP', categoria: 'TII-TA-VI' },
  { nombre: 'Matías', apellido: 'Torres', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D005', email: 'matias.torres@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Nicolás', apellido: 'Sosa', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D006', email: 'nicolas.sosa@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Sebastián', apellido: 'Díaz', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D007', email: 'sebastian.diaz@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Gonzalo', apellido: 'Martínez', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D008', email: 'gonzalo.martinez@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Franco', apellido: 'Álvarez', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D009', email: 'franco.alvarez@demo.com', convenio: 'PP', categoria: 'TII-TA-III' },
  { nombre: 'Tomás', apellido: 'Moreno', sectorNombre: 'Fractura', rol: 'OPERADOR', legajo: 'D010', email: 'tomas.moreno@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },

  // ── CABEZALES (10) ─────────────────────────
  { nombre: 'Juan Carlos', apellido: 'Herrera', sectorNombre: 'Cabezales', rol: 'COORDINADOR', legajo: 'D011', email: 'juancarlos.herrera@demo.com', convenio: 'PP', categoria: 'TII-TA-IX' },
  { nombre: 'Roberto', apellido: 'Acosta', sectorNombre: 'Cabezales', rol: 'SUPERVISOR', legajo: 'D012', email: 'roberto.acosta@demo.com', convenio: 'PP', categoria: 'TII-TA-VIII' },
  { nombre: 'Miguel', apellido: 'Pereyra', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D013', email: 'miguel.pereyra@demo.com', convenio: 'PP', categoria: 'TII-TA-VII' },
  { nombre: 'Andrés', apellido: 'Romero', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D014', email: 'andres.romero@demo.com', convenio: 'PP', categoria: 'TII-TA-VI' },
  { nombre: 'Pablo', apellido: 'Gutiérrez', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D015', email: 'pablo.gutierrez@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Eduardo', apellido: 'Ruiz', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D016', email: 'eduardo.ruiz@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Carlos', apellido: 'Medina', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D017', email: 'carlos.medina@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Ramón', apellido: 'Flores', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D018', email: 'ramon.flores@demo.com', convenio: 'PP', categoria: 'TII-TB-IV' },
  { nombre: 'Cristian', apellido: 'Suárez', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D019', email: 'cristian.suarez@demo.com', convenio: 'PP', categoria: 'TII-TB-III' },
  { nombre: 'Leandro', apellido: 'Ortiz', sectorNombre: 'Cabezales', rol: 'OPERADOR', legajo: 'D020', email: 'leandro.ortiz@demo.com', convenio: 'PP', categoria: 'TII-TA-III' },

  // ── LOGÍSTICA Y TRANSPORTE (10) ────────────
  { nombre: 'Jorge', apellido: 'Cabrera', sectorNombre: 'Logística y Transporte', rol: 'SUPERVISOR', legajo: 'D021', email: 'jorge.cabrera@demo.com', convenio: 'PP', categoria: 'TII-TB-VIII' },
  { nombre: 'Héctor', apellido: 'Ramos', sectorNombre: 'Logística y Transporte', rol: 'SUPERVISOR', legajo: 'D022', email: 'hector.ramos@demo.com', convenio: 'PP', categoria: 'TII-TB-VII' },
  { nombre: 'Oscar', apellido: 'Castro', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D023', email: 'oscar.castro@demo.com', convenio: 'PP', categoria: 'TII-TB-VI' },
  { nombre: 'Fernando', apellido: 'Vera', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D024', email: 'fernando.vera@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },
  { nombre: 'Daniel', apellido: 'Aguirre', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D025', email: 'daniel.aguirre@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },
  { nombre: 'Marcelo', apellido: 'Ríos', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D026', email: 'marcelo.rios@demo.com', convenio: 'PP', categoria: 'TII-TB-IV' },
  { nombre: 'Sergio', apellido: 'Luna', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D027', email: 'sergio.luna@demo.com', convenio: 'PP', categoria: 'TII-TB-IV' },
  { nombre: 'Walter', apellido: 'Molina', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D028', email: 'walter.molina@demo.com', convenio: 'PP', categoria: 'TII-TB-III' },
  { nombre: 'Rubén', apellido: 'Navarro', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D029', email: 'ruben.navarro@demo.com', convenio: 'PP', categoria: 'TII-TB-III' },
  { nombre: 'Claudio', apellido: 'Campos', sectorNombre: 'Logística y Transporte', rol: 'OPERADOR', legajo: 'D030', email: 'claudio.campos@demo.com', convenio: 'PP', categoria: 'TII-TB-II' },

  // ── ADMINISTRACIÓN (10) — roles variados, sin sector para RRHH/GERENTE ──
  { nombre: 'Laura', apellido: 'González', sectorNombre: null, rol: 'GERENTE', legajo: 'D031', email: 'laura.gonzalez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'María', apellido: 'Rodríguez', sectorNombre: null, rol: 'RRHH', legajo: 'D032', email: 'maria.rodriguez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Ana', apellido: 'Martínez', sectorNombre: null, rol: 'RRHH', legajo: 'D033', email: 'ana.martinez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Carolina', apellido: 'López', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D034', email: 'carolina.lopez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Patricia', apellido: 'Sánchez', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D035', email: 'patricia.sanchez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Gabriela', apellido: 'Pérez', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D036', email: 'gabriela.perez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Valeria', apellido: 'Domínguez', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D037', email: 'valeria.dominguez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Silvana', apellido: 'Muñoz', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D038', email: 'silvana.munoz@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Romina', apellido: 'Giménez', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D039', email: 'romina.gimenez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Damián', apellido: 'Quiroga', sectorNombre: 'Administración', rol: 'OPERADOR', legajo: 'D040', email: 'damian.quiroga@demo.com', convenio: 'PJ', categoria: 'SPJ' },

  // ── ALMACÉN (10) ───────────────────────────
  { nombre: 'Ricardo', apellido: 'Vargas', sectorNombre: 'Almacén', rol: 'SUPERVISOR', legajo: 'D041', email: 'ricardo.vargas@demo.com', convenio: 'PP', categoria: 'TII-TB-VI' },
  { nombre: 'Gustavo', apellido: 'Ponce', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D042', email: 'gustavo.ponce@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },
  { nombre: 'Adrián', apellido: 'Ledesma', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D043', email: 'adrian.ledesma@demo.com', convenio: 'PP', categoria: 'TII-TB-IV' },
  { nombre: 'Hugo', apellido: 'Figueroa', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D044', email: 'hugo.figueroa@demo.com', convenio: 'PP', categoria: 'TII-TB-IV' },
  { nombre: 'Maximiliano', apellido: 'Bravo', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D045', email: 'maximiliano.bravo@demo.com', convenio: 'PP', categoria: 'TII-TB-III' },
  { nombre: 'Alejandro', apellido: 'Villalba', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D046', email: 'alejandro.villalba@demo.com', convenio: 'PP', categoria: 'TII-TB-III' },
  { nombre: 'Emanuel', apellido: 'Rojas', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D047', email: 'emanuel.rojas@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Darío', apellido: 'Paz', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D048', email: 'dario.paz@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Néstor', apellido: 'Correa', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D049', email: 'nestor.correa@demo.com', convenio: 'PP', categoria: 'TII-TB-II' },
  { nombre: 'Ezequiel', apellido: 'Lucero', sectorNombre: 'Almacén', rol: 'OPERADOR', legajo: 'D050', email: 'ezequiel.lucero@demo.com', convenio: 'PP', categoria: 'TII-TB-II' },

  // ── INTENDENCIA (10) ───────────────────────
  { nombre: 'Alberto', apellido: 'Ojeda', sectorNombre: 'Intendencia', rol: 'SUPERVISOR', legajo: 'D051', email: 'alberto.ojeda@demo.com', convenio: 'PP', categoria: 'TIII-TS-VIII' },
  { nombre: 'Raúl', apellido: 'Carrizo', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D052', email: 'raul.carrizo@demo.com', convenio: 'PP', categoria: 'TIII-TS-III' },
  { nombre: 'Julio', apellido: 'Ibáñez', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D053', email: 'julio.ibanez@demo.com', convenio: 'PP', categoria: 'TIII-TS-III' },
  { nombre: 'Mario', apellido: 'Godoy', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D054', email: 'mario.godoy@demo.com', convenio: 'PP', categoria: 'TIII-TS-X' },
  { nombre: 'Pedro', apellido: 'Miranda', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D055', email: 'pedro.miranda@demo.com', convenio: 'PP', categoria: 'TIII-TS-III' },
  { nombre: 'Víctor', apellido: 'Cáceres', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D056', email: 'victor.caceres@demo.com', convenio: 'PP', categoria: 'TIII-TS-X' },
  { nombre: 'Enrique', apellido: 'Duarte', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D057', email: 'enrique.duarte@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Fabián', apellido: 'Benítez', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D058', email: 'fabian.benitez@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Ariel', apellido: 'Espinoza', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D059', email: 'ariel.espinoza@demo.com', convenio: 'PP', categoria: 'TIII-TS-III' },
  { nombre: 'Ignacio', apellido: 'Leiva', sectorNombre: 'Intendencia', rol: 'OPERADOR', legajo: 'D060', email: 'ignacio.leiva@demo.com', convenio: 'PP', categoria: 'TIII-TS-VIII' },

  // ── CMASS (10) ─────────────────────────────
  { nombre: 'Sandra', apellido: 'Montenegro', sectorNombre: 'CMASS', rol: 'CMASS', legajo: 'D061', email: 'sandra.montenegro@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Marcela', apellido: 'Vega', sectorNombre: 'CMASS', rol: 'CMASS', legajo: 'D062', email: 'marcela.vega@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Javier', apellido: 'Paredes', sectorNombre: 'CMASS', rol: 'SUPERVISOR', legajo: 'D063', email: 'javier.paredes@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Luis', apellido: 'Contreras', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D064', email: 'luis.contreras@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Alfredo', apellido: 'Soria', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D065', email: 'alfredo.soria@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Germán', apellido: 'Arias', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D066', email: 'german.arias@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Emilio', apellido: 'Barrios', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D067', email: 'emilio.barrios@demo.com', convenio: 'PJ', categoria: 'SPJ' },
  { nombre: 'Ramiro', apellido: 'Bustos', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D068', email: 'ramiro.bustos@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Iván', apellido: 'Cardozo', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D069', email: 'ivan.cardozo@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Agustín', apellido: 'Delgado', sectorNombre: 'CMASS', rol: 'OPERADOR', legajo: 'D070', email: 'agustin.delgado@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },

  // ── WIRELINE (10) ──────────────────────────
  { nombre: 'Jonathan', apellido: 'Núñez', sectorNombre: 'Wireline', rol: 'SUPERVISOR', legajo: 'D071', email: 'jonathan.nunez@demo.com', convenio: 'PP', categoria: 'TII-TA-IX' },
  { nombre: 'Maximiliano', apellido: 'Páez', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D072', email: 'maximiliano.paez@demo.com', convenio: 'PP', categoria: 'TII-TA-VIII' },
  { nombre: 'Exequiel', apellido: 'Quiroga', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D073', email: 'exequiel.quiroga@demo.com', convenio: 'PP', categoria: 'TII-TA-VII' },
  { nombre: 'Lautaro', apellido: 'Reyes', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D074', email: 'lautaro.reyes@demo.com', convenio: 'PP', categoria: 'TII-TA-VI' },
  { nombre: 'Kevin', apellido: 'Salinas', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D075', email: 'kevin.salinas@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Brian', apellido: 'Toledo', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D076', email: 'brian.toledo@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Nahuel', apellido: 'Valdez', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D077', email: 'nahuel.valdez@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Gastón', apellido: 'Zárate', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D078', email: 'gaston.zarate@demo.com', convenio: 'PP', categoria: 'TII-TA-III' },
  { nombre: 'Rodrigo', apellido: 'Ahumada', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D079', email: 'rodrigo.ahumada@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },
  { nombre: 'Santiago', apellido: 'Barreto', sectorNombre: 'Wireline', rol: 'OPERADOR', legajo: 'D080', email: 'santiago.barreto@demo.com', convenio: 'PJ', categoria: 'SPJ' },

  // ── TESTING (10) ───────────────────────────
  { nombre: 'Mauricio', apellido: 'Ceballos', sectorNombre: 'Testing', rol: 'COORDINADOR', legajo: 'D081', email: 'mauricio.ceballos@demo.com', convenio: 'PP', categoria: 'TII-TA-IX' },
  { nombre: 'Bruno', apellido: 'Duarte', sectorNombre: 'Testing', rol: 'SUPERVISOR', legajo: 'D082', email: 'bruno.duarte@demo.com', convenio: 'PP', categoria: 'TII-TA-VIII' },
  { nombre: 'Alexis', apellido: 'Echeverría', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D083', email: 'alexis.echeverria@demo.com', convenio: 'PP', categoria: 'TII-TA-VII' },
  { nombre: 'Kevin', apellido: 'Fuentes', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D084', email: 'kevin.fuentes@demo.com', convenio: 'PP', categoria: 'TII-TA-VI' },
  { nombre: 'Thiago', apellido: 'Gallardo', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D085', email: 'thiago.gallardo@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Joel', apellido: 'Heredia', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D086', email: 'joel.heredia@demo.com', convenio: 'PP', categoria: 'TII-TA-V' },
  { nombre: 'Valentín', apellido: 'Ibarra', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D087', email: 'valentin.ibarra@demo.com', convenio: 'PP', categoria: 'TII-TA-IV' },
  { nombre: 'Ulises', apellido: 'Jara', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D088', email: 'ulises.jara@demo.com', convenio: 'PP', categoria: 'TII-TA-III' },
  { nombre: 'Bautista', apellido: 'Klein', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D089', email: 'bautista.klein@demo.com', convenio: 'PP', categoria: 'TII-TB-V' },
  { nombre: 'Lisandro', apellido: 'Maldonado', sectorNombre: 'Testing', rol: 'OPERADOR', legajo: 'D090', email: 'lisandro.maldonado@demo.com', convenio: 'PJ', categoria: 'SPJ' },
];

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   RESET DEMO — Limpieza y Personal Demo  ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 1. Fetch empresa
  const empresa = await prisma.empresa.findFirst();
  if (!empresa) throw new Error('No se encontró empresa. Ejecute primero el seed principal.');
  console.log(`✅ Empresa: ${empresa.nombre} (${empresa.id})`);

  // 2. Delete all user-dependent transactional data (order matters for FK)
  console.log('\n🗑️  Eliminando datos transaccionales...');

  // Wentop
  const wFotos = await prisma.wentopFoto.deleteMany();
  const wGest = await prisma.wentopGestor.deleteMany();
  const wTarj = await prisma.wentopTarjeta.deleteMany();
  console.log(`   Wentop: ${wTarj.count} tarjetas, ${wFotos.count} fotos, ${wGest.count} gestores`);

  // Approval histories
  const ph = await prisma.planillaHistorial.deleteMany();
  const vh = await prisma.vacacionHistorial.deleteMany();
  const ah = await prisma.ausenciaHistorial.deleteMany();
  console.log(`   Historial: ${ph.count} planilla, ${vh.count} vacación, ${ah.count} ausencia`);

  // Registros de horas
  const rh = await prisma.registroHoras.deleteMany();
  console.log(`   Registros horas: ${rh.count}`);

  // Recibos (references Planilla without cascade — must go BEFORE planillas)
  const rec = await prisma.reciboSueldo.deleteMany();
  console.log(`   Recibos: ${rec.count}`);

  // Ausencias (has nullable planillaId FK — delete before planillas)
  const au = await prisma.ausencia.deleteMany();
  console.log(`   Ausencias: ${au.count}`);

  // Main documents
  const pl = await prisma.planilla.deleteMany();
  const vc = await prisma.vacacion.deleteMany();
  console.log(`   Documentos: ${pl.count} planillas, ${vc.count} vacaciones`);

  // Cambios diagrama
  const cdh = await prisma.cambioDiagramaHistorial.deleteMany();
  const cd = await prisma.solicitudCambioDiagrama.deleteMany();
  console.log(`   Cambios diagrama: ${cd.count} solicitudes, ${cdh.count} historial`);

  // Vacacion saldos
  const vs = await prisma.vacacionSaldo.deleteMany();
  console.log(`   Saldos vacaciones: ${vs.count}`);

  // Mensajes
  const mDest = await prisma.mensajeDestinatario.deleteMany();
  const mResp = await prisma.mensajeRespuesta.deleteMany();
  const msgs = await prisma.mensaje.deleteMany();
  console.log(`   Mensajes: ${msgs.count} mensajes, ${mDest.count} destinatarios, ${mResp.count} respuestas`);

  // Notificaciones
  const not = await prisma.notificacion.deleteMany();
  console.log(`   Notificaciones: ${not.count}`);

  // Capacitaciones
  const inv = await prisma.invitacionCapacitacion.deleteMany();
  const ec = await prisma.empleadoCapacitacion.deleteMany();
  const ses = await prisma.sesionCapacitacion.deleteMany();
  console.log(`   Capacitaciones: ${ec.count} empleados, ${ses.count} sesiones, ${inv.count} invitaciones`);

  // Exportaciones
  const exp = await prisma.exportacion.deleteMany();
  console.log(`   Exportaciones: ${exp.count}`);

  // Auditoría
  const audit = await prisma.auditoriaLog.deleteMany();
  console.log(`   Auditoría: ${audit.count} registros`);

  // Password reset tokens
  const prt = await prisma.passwordResetToken.deleteMany();
  console.log(`   Tokens reset: ${prt.count}`);

  // Usuario-Diagrama
  const ud = await prisma.usuarioDiagrama.deleteMany();
  console.log(`   Usuario-Diagrama: ${ud.count}`);

  // Concepto valores (depends on categoria, not user, but is transactional)
  // Keep these — they define salary structure

  // 3. Delete ALL users
  const users = await prisma.usuario.deleteMany();
  console.log(`\n🗑️  ${users.count} usuarios eliminados`);

  // 4. Verify preserved data
  const sectorCount = await prisma.sector.count();
  const rolCount = await prisma.rolConfig.count();
  const flujoCount = await prisma.flujoAprobacion.count();
  const pasoCount = await prisma.flujoPaso.count();
  const asignCount = await prisma.flujoAsignacion.count();
  const convCount = await prisma.convenio.count();
  const catCount = await prisma.categoria.count();
  const conceptoCount = await prisma.conceptoSalarial.count();
  const diagCount = await prisma.diagrama.count();

  console.log('\n✅ Datos preservados:');
  console.log(`   ${sectorCount} sectores`);
  console.log(`   ${rolCount} roles`);
  console.log(`   ${flujoCount} flujos de aprobación (${pasoCount} pasos, ${asignCount} asignaciones)`);
  console.log(`   ${convCount} convenios (${catCount} categorías, ${conceptoCount} conceptos)`);
  console.log(`   ${diagCount} diagramas`);

  // 5. Build lookup maps
  const sectoresDB = await prisma.sector.findMany({ where: { empresaId: empresa.id } });
  const sectorMap: Record<string, string> = {};
  for (const s of sectoresDB) sectorMap[s.nombre] = s.id;

  const conveniosDB = await prisma.convenio.findMany({ where: { empresaId: empresa.id }, include: { categorias: true } });
  const convenioPP = conveniosDB.find(c => c.tipo === 'PETROLEROS_PRIVADOS_644');
  const convenioPJ = conveniosDB.find(c => c.tipo === 'PETROLEROS_JERARQUICOS_637');
  if (!convenioPP || !convenioPJ) throw new Error('Convenios PP/PJ no encontrados');

  const catMapPP: Record<string, string> = {};
  for (const c of convenioPP.categorias) catMapPP[c.codigo] = c.id;
  const catMapPJ: Record<string, string> = {};
  for (const c of convenioPJ.categorias) catMapPJ[c.codigo] = c.id;

  // 6. Create admin user
  console.log('\n👤 Creando usuarios demo...');
  const adminHash = await hashPassword('Admin2026!');
  const demoHash = await hashPassword('Demo2026!');

  await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: null,
      nombre: 'Administrador',
      apellido: 'Sistema',
      email: 'admin@wenlen.com',
      passwordHash: adminHash,
      legajo: 'WL-SYS',
      rol: 'ADMIN',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2024-01-01'),
      convenioId: convenioPJ.id,
      categoriaId: catMapPJ['SPJ'],
      primerLogin: false,
    },
  });
  console.log('   ✅ admin@wenlen.com (ADMIN) — pass: Admin2026!');

  // 7. Create demo users
  let count = 0;
  const supervisorIds: Record<string, string> = {};
  const coordinadorIds: Record<string, string> = {};

  // First pass: create all users
  for (const u of DEMO_USERS) {
    const esPJ = u.convenio === 'PJ';
    const catMap = esPJ ? catMapPJ : catMapPP;
    const catId = catMap[u.categoria] ?? (esPJ ? catMapPJ['SPJ'] : catMapPP['TII-TA-VII']);

    const created = await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        sectorId: u.sectorNombre ? (sectorMap[u.sectorNombre] ?? null) : null,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        passwordHash: demoHash,
        legajo: u.legajo,
        rol: u.rol,
        tipoContrato: ContratoTipo.INDEFINIDO,
        fechaIngreso: new Date('2024-06-01'),
        convenioId: esPJ ? convenioPJ.id : convenioPP.id,
        categoriaId: catId,
        primerLogin: false,
      },
    });

    // Track supervisors and coordinators for hierarchy
    if (u.rol === 'SUPERVISOR' && u.sectorNombre) {
      supervisorIds[u.sectorNombre] = created.id;
    }
    if (u.rol === 'COORDINADOR' && u.sectorNombre) {
      coordinadorIds[u.sectorNombre] = created.id;
    }

    count++;
  }

  // Second pass: set supervisor/coordinator references
  for (const u of DEMO_USERS) {
    if (u.rol === 'OPERADOR' && u.sectorNombre) {
      const supId = supervisorIds[u.sectorNombre];
      const coordId = coordinadorIds[u.sectorNombre];
      if (supId || coordId) {
        await prisma.usuario.update({
          where: { email: u.email },
          data: {
            supervisorId: supId ?? null,
            coordinadorId: coordId ?? null,
          },
        });
      }
    }
  }

  console.log(`   ✅ ${count} usuarios demo creados — pass: Demo2026!`);

  // Summary
  const perSector: Record<string, number> = {};
  for (const u of DEMO_USERS) {
    const key = u.sectorNombre ?? 'Sin Sector (Admin/RRHH/Gerente)';
    perSector[key] = (perSector[key] ?? 0) + 1;
  }

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║             RESUMEN                       ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║  Total usuarios: ${count + 1} (1 admin + ${count} demo)`);
  for (const [sector, n] of Object.entries(perSector).sort()) {
    console.log(`║  ${sector}: ${n}`);
  }
  console.log('╠═══════════════════════════════════════════╣');
  console.log('║  Credenciales:                            ║');
  console.log('║  admin@wenlen.com    → Admin2026!         ║');
  console.log('║  *.@demo.com         → Demo2026!          ║');
  console.log('╚═══════════════════════════════════════════╝');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
