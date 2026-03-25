import { PrismaClient, CctTipo, ConceptoTipo, DiagramaTipo, ContratoTipo } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const FERIADOS_ARGENTINA_2025 = [
  '2025-01-01', '2025-03-03', '2025-03-04', '2025-03-24',
  '2025-04-02', '2025-04-18', '2025-05-01', '2025-05-25',
  '2025-06-20', '2025-07-09', '2025-08-17', '2025-10-12',
  '2025-11-20', '2025-12-08', '2025-12-25',
];

const FERIADOS_ARGENTINA_2026 = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24',
  '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-25',
  '2026-06-19', '2026-07-09', '2026-08-16', '2026-10-12',
  '2026-11-20', '2026-12-08', '2026-12-25',
];

// Feriados especiales del sector petrolero
const FERIADOS_PETROLEROS = [
  '2025-12-13', // Día del Petróleo (CCT 644/12 y 637/11)
  '2026-12-13',
  '2025-08-12', // Día del Petrolero Jerárquico (CCT 637/11)
  '2026-08-12',
];

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// EMPLEADOS — Nómina completa generada desde Excel + PDF
// ═══════════════════════════════════════════════════════════════
const EMPLEADOS: {
  nombre: string; apellido: string; sector: string; rol: string;
  legajo: string; email: string; dni: string; telefono: string;
  fechaIngreso: string; categoria: string; convenio: string;
}[] = [
  // -- ADMINISTRACION --
  { nombre: 'Mariela Luciana', apellido: 'Agüero', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: '1150', email: 'mariela.aguero@wenlen.com', dni: '31.316.608', telefono: '299-6257163', fechaIngreso: '2024-08-16', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Angelo Alexis', apellido: 'Araneda Rivas', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '210', email: 'angelo.araneda@wenlen.com', dni: '94.904.285', telefono: '299-5128257', fechaIngreso: '2014-04-04', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Bruno', apellido: 'Bianchi', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '633', email: 'bruno.bianchi@wenlen.com', dni: '26.095.802', telefono: '299-6265336', fechaIngreso: '2019-01-16', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Eliana Soledad', apellido: 'Cejas', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: '1234', email: 'eliana.cejas@wenlen.com', dni: '27.892.981', telefono: '299-4692175', fechaIngreso: '2025-11-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Noelia Elizabeth', apellido: 'Colombres', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1064', email: 'noelia.colombres@wenlen.com', dni: '30.807.676', telefono: '299-4107273', fechaIngreso: '2023-08-07', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Carlos Jorge', apellido: 'Díaz', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: '136', email: 'carlos.diaz@wenlen.com', dni: '12.065.085', telefono: '299-4127993', fechaIngreso: '2013-08-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'José Luis', apellido: 'Domínguez', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1194', email: 'jose.dominguez@wenlen.com', dni: '37.149.643', telefono: '262-5528512', fechaIngreso: '2025-03-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'César Sebastián', apellido: 'Duboscq', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1094', email: 'cesar.duboscq@wenlen.com', dni: '27.719.839', telefono: '299-5495961', fechaIngreso: '2024-02-26', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Amalia Rosario', apellido: 'González', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: '436', email: 'amalia.gonzalez@wenlen.com', dni: '33.637.328', telefono: '299-4281567', fechaIngreso: '2017-08-14', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Damiana Sabrina', apellido: 'Herrera', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1231', email: 'damiana.herrera@wenlen.com', dni: '35.313.536', telefono: '299-4021758', fechaIngreso: '2025-11-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Rosana Elizabeth', apellido: 'Juricich', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1157', email: 'rosana.juricich@wenlen.com', dni: '22.473.296', telefono: '299-6324127', fechaIngreso: '2024-09-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Gustavo Andrés', apellido: 'Muñoz', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '831', email: 'gustavo.munoz@wenlen.com', dni: '37.946.259', telefono: '299-6567106', fechaIngreso: '2021-09-13', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Nicolás Alejandro', apellido: 'Pressello', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '1017', email: 'nicolas.pressello@wenlen.com', dni: '34.866.262', telefono: '299-5886870', fechaIngreso: '2022-12-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Leopoldo', apellido: 'Silveira', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: '607', email: 'leopoldo.silveira@wenlen.com', dni: '92.759.277', telefono: '299-4707463', fechaIngreso: '2018-10-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Pablo Gerónimo Andrés', apellido: 'Sin', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '353', email: 'pablo.sin@wenlen.com', dni: '36.514.465', telefono: '299-6002267', fechaIngreso: '2015-10-19', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Carlos Alberto', apellido: 'Solís', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '232', email: 'carlos.solis@wenlen.com', dni: '18.199.707', telefono: '299-6002001', fechaIngreso: '2014-07-21', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Florencia Anabela', apellido: 'Spagnolo', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '775', email: 'florencia.spagnolo@wenlen.com', dni: '33.472.990', telefono: '299-6233752', fechaIngreso: '2021-02-05', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Alicia', apellido: 'Strillevsky', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: '202', email: 'alicia.strillevsky@wenlen.com', dni: '20.676.695', telefono: '299-5795639', fechaIngreso: '2014-01-16', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'David Ariel', apellido: 'Valenzuela', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: '847', email: 'david.valenzuela@wenlen.com', dni: '30.500.310', telefono: '299-4019339', fechaIngreso: '2022-01-03', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Ricardo Leopoldo', apellido: 'Winkler', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: '1021', email: 'ricardo.winkler@wenlen.com', dni: '20.121.245', telefono: '299-6566284', fechaIngreso: '2023-02-01', categoria: 'SPJ', convenio: 'PJ' },
  // -- ALMACEN --
  { nombre: 'Jorge Ricardo', apellido: 'Alegría', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1159', email: 'jorge.alegria@wenlen.com', dni: '31.965.212', telefono: '299-5045446', fechaIngreso: '2024-10-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Luciano', apellido: 'Angelino', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1160', email: 'luciano.angelino@wenlen.com', dni: '37.173.475', telefono: '299-6127446', fechaIngreso: '2024-10-02', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Joaquín Antonio', apellido: 'Barrionuevo', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1189', email: 'joaquin.barrionuevo@wenlen.com', dni: '36.306.999', telefono: '299-5287357', fechaIngreso: '2025-02-24', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Juan Ignacio', apellido: 'Demarco', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '823', email: 'juan.demarco@wenlen.com', dni: '34.088.188', telefono: '299-4112089', fechaIngreso: '2021-06-22', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Pedro Fabián', apellido: 'González', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '749', email: 'pedro.gonzalez@wenlen.com', dni: '30.055.241', telefono: '299-4137578', fechaIngreso: '2019-07-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Franco Emanuel', apellido: 'Hernandorena', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1058', email: 'franco.hernandorena@wenlen.com', dni: '38.174.329', telefono: '299-4694814', fechaIngreso: '2023-08-01', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Gabriel Iván', apellido: 'Mercado', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1202', email: 'gabriel.mercado@wenlen.com', dni: '29.156.962', telefono: '298-4531746', fechaIngreso: '2025-05-05', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Juan Pablo', apellido: 'Muñoz', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1056', email: 'juan.munoz@wenlen.com', dni: '29.154.188', telefono: '299-6203195', fechaIngreso: '2023-07-03', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Néstor Emiliano', apellido: 'Rivas', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1204', email: 'nestor.rivas@wenlen.com', dni: '33.532.816', telefono: '299-5085699', fechaIngreso: '2025-05-14', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Ricardo Alberto', apellido: 'Sueldo', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1046', email: 'ricardo.sueldo@wenlen.com', dni: '20.643.754', telefono: '299-6213931', fechaIngreso: '2023-06-12', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Elvio Alfredo', apellido: 'Taux', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '745', email: 'elvio.taux@wenlen.com', dni: '14.777.697', telefono: '299-6050312', fechaIngreso: '2019-07-01', categoria: 'TII-TB-VI', convenio: 'PP' },
  { nombre: 'José Luis', apellido: 'Velázquez', sector: 'ALMACEN', rol: 'OPERADOR', legajo: '1246', email: 'jose.velazquez@wenlen.com', dni: '22.473.669', telefono: '299-5718778', fechaIngreso: '2026-03-02', categoria: 'SPJ', convenio: 'PJ' },
  // -- CABEZALES --
  { nombre: 'Claudio José Gabriel', apellido: 'Achares', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '863', email: 'claudio.achares@wenlen.com', dni: '29.313.268', telefono: '299-4207657', fechaIngreso: '2022-06-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Omar Luis', apellido: 'Aguirre', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '475', email: 'omar.aguirre@wenlen.com', dni: '21.847.540', telefono: '299-5755337', fechaIngreso: '2018-02-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Mariano Andrés', apellido: 'Albornoz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '601', email: 'mariano.albornoz@wenlen.com', dni: '36.152.031', telefono: '2942-414991', fechaIngreso: '2018-09-12', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Hernán Martín', apellido: 'Arranz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1221', email: 'hernan.arranz@wenlen.com', dni: '31.751.401', telefono: '261-6634513', fechaIngreso: '2025-09-15', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Eduardo Fabián', apellido: 'Atencio', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1212', email: 'eduardo.atencio@wenlen.com', dni: '29.548.325', telefono: '297-4272427', fechaIngreso: '2025-06-02', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Daniel Nicolás', apellido: 'Ávila', sector: 'CABEZALES', rol: 'COORDINADOR', legajo: '129', email: 'daniel.avila@wenlen.com', dni: '36.151.093', telefono: '299-5955476', fechaIngreso: '2013-08-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Lucas Javier', apellido: 'Avilés', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1217', email: 'lucas.aviles@wenlen.com', dni: '40.706.808', telefono: '299-5125036', fechaIngreso: '2025-09-01', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Elías Israel', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1034', email: 'elias.barros@wenlen.com', dni: '32.247.130', telefono: '299-4188595', fechaIngreso: '2023-05-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Jonatan Gabriel', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '365', email: 'jonatan.barros@wenlen.com', dni: '28.361.722', telefono: '299-5891974', fechaIngreso: '2016-02-16', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Pablo Andrés', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1117', email: 'pablo.barros@wenlen.com', dni: '33.316.070', telefono: '299-4181434', fechaIngreso: '2024-04-17', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Milena', apellido: 'Borja', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1235', email: 'milena.borja@wenlen.com', dni: '40.154.862', telefono: '387-3210080', fechaIngreso: '2025-12-09', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Héctor Fabián', apellido: 'Cárcamo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1196', email: 'hector.carcamo@wenlen.com', dni: '29.224.903', telefono: '299-5306318', fechaIngreso: '2025-04-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'David Ezequiel', apellido: 'Cerda', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '147', email: 'david.cerda@wenlen.com', dni: '37.102.033', telefono: '299-4163295', fechaIngreso: '2013-09-09', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Rodrigo Andrés', apellido: 'Cerda', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: '46', email: 'rodrigo.cerda@wenlen.com', dni: '31.465.587', telefono: '2942-568348', fechaIngreso: '2012-07-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Richard Omar', apellido: 'Cid Sandoval', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1198', email: 'richard.cid@wenlen.com', dni: '92.894.878', telefono: '299-5883592', fechaIngreso: '2025-05-05', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Mario Ricardo', apellido: 'Cilleruelo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '425', email: 'mario.cilleruelo@wenlen.com', dni: '21.012.527', telefono: '299-5480827', fechaIngreso: '2017-07-17', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Gonzalo Julián', apellido: 'Escobar de la Vega', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '783', email: 'gonzalo.escobar@wenlen.com', dni: '41.591.912', telefono: '299-5523651', fechaIngreso: '2020-12-14', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Miguel Ángel', apellido: 'Falcón', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '259', email: 'miguel.falcon@wenlen.com', dni: '22.116.002', telefono: '299-6353070', fechaIngreso: '2014-09-01', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Pablo César', apellido: 'Fuentes', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1033', email: 'pablo.fuentes@wenlen.com', dni: '25.655.064', telefono: '299-4632326', fechaIngreso: '2023-05-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Edgardo Guillermo', apellido: 'García', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '618', email: 'edgardo.garcia@wenlen.com', dni: '28.718.946', telefono: '2942-573172', fechaIngreso: '2018-11-01', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Matías Nicolás', apellido: 'García', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1097', email: 'matias.garcia@wenlen.com', dni: '42.848.264', telefono: '299-4047821', fechaIngreso: '2024-03-08', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Jorge Luis', apellido: 'Gazzola', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1186', email: 'jorge.gazzola@wenlen.com', dni: '38.415.205', telefono: '299-5686934', fechaIngreso: '2025-02-03', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Jorge Leonardo', apellido: 'González', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1181', email: 'jorge.gonzalez@wenlen.com', dni: '30.874.776', telefono: '299-6259231', fechaIngreso: '2025-01-02', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Andrés Fabián', apellido: 'Huilipan Vergara', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1018', email: 'andres.huilipan@wenlen.com', dni: '92.749.374', telefono: '299-4290691', fechaIngreso: '2023-01-11', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Abelardo Aurelio', apellido: 'Kloberdanz', sector: 'CABEZALES', rol: 'COORDINADOR', legajo: '329', email: 'abelardo.kloberdanz@wenlen.com', dni: '14.088.786', telefono: '4.477.482', fechaIngreso: '1991-07-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Claudio Alejandro', apellido: 'Maldonado', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1219', email: 'claudio.maldonado@wenlen.com', dni: '38.681.914', telefono: '299-4168938', fechaIngreso: '2025-09-01', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Fernando Edison', apellido: 'Martínez Peña', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: '396', email: 'fernando.martinez@wenlen.com', dni: '93.088.045', telefono: '299-5834593', fechaIngreso: '1996-02-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Luis Alejandro', apellido: 'Medel Chávez', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '651', email: 'luis.medel@wenlen.com', dni: '36.801.155', telefono: '299-5834223', fechaIngreso: '2019-04-15', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Cristian Rubén', apellido: 'Merino', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: '481', email: 'cristian.merino@wenlen.com', dni: '36.626.945', telefono: '299-4054601', fechaIngreso: '2024-05-07', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Néstor Facundo', apellido: 'Millaqueo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1019', email: 'nestor.millaqueo@wenlen.com', dni: '37.176.071', telefono: '299-6265402', fechaIngreso: '2023-01-23', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Carlos Fabián', apellido: 'Morales Aroca', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '165', email: 'carlos.morales@wenlen.com', dni: '27.323.284', telefono: '299-5050382', fechaIngreso: '2013-10-07', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Ramiro Ulises', apellido: 'Moreno Wantnud', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1032', email: 'ramiro.moreno@wenlen.com', dni: '29.734.073', telefono: '299-3270502', fechaIngreso: '2023-05-02', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Roberto Daniel', apellido: 'Muñoz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '212', email: 'roberto.munoz@wenlen.com', dni: '27.367.819', telefono: '299-3296299', fechaIngreso: '2014-05-05', categoria: 'TII-TB-IX', convenio: 'PP' },
  { nombre: 'Matías Ezequiel', apellido: 'Ormea', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '125', email: 'matias.ormea@wenlen.com', dni: '31.415.333', telefono: '299-5279264', fechaIngreso: '2013-07-01', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Darío Armando Nahuel', apellido: 'Ortíz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1167', email: 'dario.ortiz@wenlen.com', dni: '34.310.797', telefono: '299-5775393', fechaIngreso: '2024-11-01', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Aldo Ariel', apellido: 'Paillalef', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1183', email: 'aldo.paillalef@wenlen.com', dni: '28.559.917', telefono: '299-5571537', fechaIngreso: '2025-01-13', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Lucas Nahuel', apellido: 'Pareja Baeza', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1176', email: 'lucas.pareja@wenlen.com', dni: '41.911.237', telefono: '299-5758215', fechaIngreso: '2024-12-16', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Rubén Isaí', apellido: 'Parra Monsalve', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1031', email: 'ruben.parra@wenlen.com', dni: '32.779.045', telefono: '299-4150115', fechaIngreso: '2023-05-02', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'José Domingo', apellido: 'Pino', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '773', email: 'jose.pino@wenlen.com', dni: '35.493.420', telefono: '299-4133559', fechaIngreso: '2020-12-14', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Gustavo Javier', apellido: 'Ponce', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '620', email: 'gustavo.ponce@wenlen.com', dni: '21.883.443', telefono: '299-4130395', fechaIngreso: '2018-11-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Carlos Alberto', apellido: 'Ríos', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1126', email: 'carlos.rios@wenlen.com', dni: '27.674.864', telefono: '299-5889199', fechaIngreso: '2024-05-07', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Gastón Rodrigo', apellido: 'Rivera', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1127', email: 'gaston.rivera@wenlen.com', dni: '35.865.055', telefono: '299-4091801', fechaIngreso: '2024-05-07', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Cristian Alejandro', apellido: 'Román', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '613', email: 'cristian.roman@wenlen.com', dni: '36.151.982', telefono: '2942-627812', fechaIngreso: '2018-10-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Daniel Gaspar', apellido: 'Romero', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: '216', email: 'daniel.romero@wenlen.com', dni: '31.226.279', telefono: '299-5346651', fechaIngreso: '2014-05-05', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Jorge Mauricio', apellido: 'Rosales', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1172', email: 'jorge.rosales@wenlen.com', dni: '36.453.447', telefono: '299-4276125', fechaIngreso: '2024-11-19', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Sebastián Alejandro', apellido: 'Ruilova', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1213', email: 'sebastian.ruilova@wenlen.com', dni: '33.485.543', telefono: '299-5226724', fechaIngreso: '2025-06-09', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Lucas Emanuel', apellido: 'Russo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '599', email: 'lucas.russo@wenlen.com', dni: '37.962.697', telefono: '299-4659449', fechaIngreso: '2018-09-04', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Carlos', apellido: 'Syme', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1121', email: 'carlos.syme@wenlen.com', dni: '25.528.653', telefono: '299-6237125', fechaIngreso: '2024-04-17', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Rodolfo Ricardo Luis', apellido: 'Uribe', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '821', email: 'rodolfo.uribe@wenlen.com', dni: '36.626.662', telefono: '299-4628725', fechaIngreso: '2021-05-26', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Walter Alexander', apellido: 'Uribe', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1128', email: 'walter.uribe@wenlen.com', dni: '44.671.659', telefono: '294-2586643', fechaIngreso: '2024-05-07', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Sergio Maximiliano', apellido: 'Vásquez', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1178', email: 'sergio.vasquez@wenlen.com', dni: '36.257.187', telefono: '299-6722155', fechaIngreso: '2024-12-16', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Emanuel Alejandro', apellido: 'Vera', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1101', email: 'emanuel.vera@wenlen.com', dni: '41.977.681', telefono: '299-4646761', fechaIngreso: '2024-03-08', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Gabriel Orlando', apellido: 'Vergara', sector: 'CABEZALES', rol: 'OPERADOR', legajo: '1168', email: 'gabriel.vergara@wenlen.com', dni: '40.294.281', telefono: '299-6596756', fechaIngreso: '2024-11-01', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Danilo Alexis', apellido: 'Vergara Mena', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: '1063', email: 'danilo.vergara@wenlen.com', dni: '39.443.346', telefono: '294-4913335', fechaIngreso: '2023-08-01', categoria: 'SPJ', convenio: 'PJ' },
  // -- CAMIONEROS --
  { nombre: 'Víctor Alexis', apellido: 'Acevedo', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '1012', email: 'victor.acevedo@wenlen.com', dni: '33.291.720', telefono: '299-5277250', fechaIngreso: '2022-10-24', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Santiago Mario', apellido: 'Aguilar', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '1137', email: 'santiago.aguilar@wenlen.com', dni: '29.957.354', telefono: '299-4134544', fechaIngreso: '2024-07-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Emiliano Gastón', apellido: 'Araoz González', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '471', email: 'emiliano.araoz@wenlen.com', dni: '30.840.831', telefono: '299-5249577', fechaIngreso: '2018-02-20', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Rubén Darío', apellido: 'Azúa', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '231', email: 'ruben.azua@wenlen.com', dni: '27.327.335', telefono: '299-5470041', fechaIngreso: '2014-06-07', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Gerardo Darián', apellido: 'Cau', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '429', email: 'gerardo.cau@wenlen.com', dni: '36.771.097', telefono: '299-5850055', fechaIngreso: '2017-07-19', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Roberto Pablo', apellido: 'Luqui', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '853', email: 'roberto.luqui@wenlen.com', dni: '30.226.456', telefono: '299-6898173', fechaIngreso: '2022-02-11', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Leonardo Jonatan', apellido: 'Maulén', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '445', email: 'leonardo.maulen@wenlen.com', dni: '32.168.843', telefono: '299-6048564', fechaIngreso: '2017-10-09', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Segundo Rolando', apellido: 'Melian', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '855', email: 'segundo.melian@wenlen.com', dni: '23.189.803', telefono: '299-5243868', fechaIngreso: '2022-02-09', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Mauro Raúl Ceferino', apellido: 'Montero', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '1074', email: 'mauro.montero@wenlen.com', dni: '25.138.935', telefono: '299-4098521', fechaIngreso: '2023-10-02', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Walter Ariel', apellido: 'Pacheco', sector: 'CAMIONEROS', rol: 'OPERADOR', legajo: '1143', email: 'walter.pacheco@wenlen.com', dni: '32.139.313', telefono: '299-4580516', fechaIngreso: '2024-07-01', categoria: 'TII-TA-V', convenio: 'PP' },
  // -- CMASS --
  { nombre: 'Alberto Daniel', apellido: 'Atienza', sector: 'CMASS', rol: 'SUPERVISOR', legajo: '628', email: 'alberto.atienza@wenlen.com', dni: '14.916.338', telefono: '299-5769525', fechaIngreso: '2019-01-04', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Fabiana Aylén', apellido: 'Bascur', sector: 'CMASS', rol: 'OPERADOR', legajo: '1083', email: 'fabiana.bascur@wenlen.com', dni: '41.050.796', telefono: '299-6285562', fechaIngreso: '2024-02-05', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Saúl Hernán', apellido: 'Ceballo', sector: 'CMASS', rol: 'OPERADOR', legajo: '1156', email: 'saul.ceballo@wenlen.com', dni: '32.544.901', telefono: '299-4548231', fechaIngreso: '2024-09-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Rubén Omar', apellido: 'Ciccarelli Arrieta', sector: 'CMASS', rol: 'OPERADOR', legajo: '371', email: 'ruben.ciccarelli@wenlen.com', dni: '37.101.489', telefono: '299-6357109', fechaIngreso: '2016-05-30', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Pablo Miguel', apellido: 'Fernández Sastre', sector: 'CMASS', rol: 'OPERADOR', legajo: '1244', email: 'pablo.fernandez@wenlen.com', dni: '36.510.289', telefono: '299-5036555', fechaIngreso: '2026-03-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Silvia Andrea', apellido: 'Ferretti', sector: 'CMASS', rol: 'OPERADOR', legajo: '1233', email: 'silvia.ferretti@wenlen.com', dni: '23.918.318', telefono: '299-4620581', fechaIngreso: '2025-11-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Juana', apellido: 'García', sector: 'CMASS', rol: 'OPERADOR', legajo: '1014', email: 'juana.garcia@wenlen.com', dni: '36.784.415', telefono: '299-6001915', fechaIngreso: '2022-11-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Walter Eduardo', apellido: 'Garrido', sector: 'CMASS', rol: 'OPERADOR', legajo: '1158', email: 'walter.garrido@wenlen.com', dni: '35.655.760', telefono: '299-4720067', fechaIngreso: '2024-09-23', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Damián Esteban', apellido: 'González', sector: 'CMASS', rol: 'OPERADOR', legajo: '1230', email: 'damian.gonzalez@wenlen.com', dni: '36.945.470', telefono: '299-6269012', fechaIngreso: '2025-11-10', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'María Belén', apellido: 'Ilardo', sector: 'CMASS', rol: 'OPERADOR', legajo: '1187', email: 'maria.ilardo@wenlen.com', dni: '35.310.796', telefono: '299-5724482', fechaIngreso: '2025-02-03', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Ximena Belén', apellido: 'Martínez', sector: 'CMASS', rol: 'OPERADOR', legajo: '1067', email: 'ximena.martinez@wenlen.com', dni: '42.105.233', telefono: '299-5899484', fechaIngreso: '2023-08-14', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Julio Alberto', apellido: 'Meriño', sector: 'CMASS', rol: 'SUPERVISOR', legajo: '597', email: 'julio.merino@wenlen.com', dni: '31.166.325', telefono: '299-4511961', fechaIngreso: '2018-09-01', categoria: 'TII-TB-VIII', convenio: 'PP' },
  { nombre: 'Fernando Martín', apellido: 'Ramírez', sector: 'CMASS', rol: 'OPERADOR', legajo: '593', email: 'fernando.ramirez@wenlen.com', dni: '26.097.362', telefono: '299-6001950', fechaIngreso: '2018-08-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Natalia Andrea', apellido: 'Ramírez', sector: 'CMASS', rol: 'OPERADOR', legajo: '419', email: 'natalia.ramirez@wenlen.com', dni: '33.621.588', telefono: '299-6728051', fechaIngreso: '2017-07-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Osvaldo Gabriel', apellido: 'Ríos', sector: 'CMASS', rol: 'OPERADOR', legajo: '1171', email: 'osvaldo.rios@wenlen.com', dni: '35.664.080', telefono: '299-6253725', fechaIngreso: '2024-11-19', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Julio César', apellido: 'Vásquez', sector: 'CMASS', rol: 'OPERADOR', legajo: '482', email: 'julio.vasquez@wenlen.com', dni: '35.032.309', telefono: '299-5093212', fechaIngreso: '2018-03-01', categoria: 'SPJ', convenio: 'PJ' },
  // -- FRACTURA --
  { nombre: 'Cristian Rubén', apellido: 'Alegría', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1062', email: 'cristian.alegria@wenlen.com', dni: '26.810.798', telefono: '299-5572929', fechaIngreso: '2023-08-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Axel Alexis', apellido: 'Alegría', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1144', email: 'axel.alegria@wenlen.com', dni: '37.947.292', telefono: '299-6284290', fechaIngreso: '2024-07-22', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Diego Alfonso', apellido: 'Almonacid', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '260', email: 'diego.almonacid@wenlen.com', dni: '26.362.990', telefono: '299-4663051', fechaIngreso: '2014-09-01', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Germán Alejandro', apellido: 'Altamirano', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1110', email: 'german.altamirano@wenlen.com', dni: '39.129.728', telefono: '299-4511270', fechaIngreso: '2024-04-08', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Sergio Andrés', apellido: 'Álvarez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1010', email: 'sergio.alvarez@wenlen.com', dni: '40.439.421', telefono: '299-6302089', fechaIngreso: '2022-10-24', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Luis Marcelo', apellido: 'Anabalón', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1069', email: 'luis.anabalon@wenlen.com', dni: '32.428.200', telefono: '294-2959407', fechaIngreso: '2023-08-22', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Nicolás Víctor', apellido: 'Anobile', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1027', email: 'nicolas.anobile@wenlen.com', dni: '39.881.253', telefono: '299-517606', fechaIngreso: '2023-03-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Diego Sebastián', apellido: 'Aramendi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1238', email: 'diego.aramendi@wenlen.com', dni: '46.405.341', telefono: '299-6593064', fechaIngreso: '2026-03-02', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Roberto Horacio', apellido: 'Aravena', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '208', email: 'roberto.aravena@wenlen.com', dni: '26.331.118', telefono: '299-5343805', fechaIngreso: '2014-03-14', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Rubén Antonio', apellido: 'Arcieri', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '285', email: 'ruben.arcieri@wenlen.com', dni: '26.882.779', telefono: '299-4103613', fechaIngreso: '2015-01-05', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Sergio Alejandro', apellido: 'Ariza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '459', email: 'sergio.ariza@wenlen.com', dni: '29.347.296', telefono: '299-6212387', fechaIngreso: '2017-12-04', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Tomás Alejandro', apellido: 'Aroca Fernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1161', email: 'tomas.aroca@wenlen.com', dni: '45.509.858', telefono: '299-4562092', fechaIngreso: '2024-10-02', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Matías Ezequiel', apellido: 'Ava Bonnot', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1041', email: 'matias.ava@wenlen.com', dni: '33.124.577', telefono: '343-4517895', fechaIngreso: '2023-05-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Roberto Fabián', apellido: 'Balmaceda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '785', email: 'roberto.balmaceda@wenlen.com', dni: '28.485.880', telefono: '299-5230802', fechaIngreso: '2024-04-12', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Gonzalo Tomás Jesús', apellido: 'Bañak', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1240', email: 'gonzalo.banak@wenlen.com', dni: '46.232.360', telefono: '299-5813105', fechaIngreso: '2026-03-02', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Germán Nicolás', apellido: 'Banek', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '675', email: 'german.banek@wenlen.com', dni: '33.292.166', telefono: '299-6322212', fechaIngreso: '2020-01-22', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Juan Pablo', apellido: 'Bastida', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1151', email: 'juan.bastida@wenlen.com', dni: '29.262.403', telefono: '299-4566794', fechaIngreso: '2024-08-16', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Milton Edgardo', apellido: 'Berra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '498', email: 'milton.berra@wenlen.com', dni: '23.214.842', telefono: '299-5337657', fechaIngreso: '2018-06-14', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Gabriel Raúl', apellido: 'Besada', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '133', email: 'gabriel.besada@wenlen.com', dni: '31.789.109', telefono: '2923-427164', fechaIngreso: '2013-08-26', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Maximiliano Joaquín', apellido: 'Biagini', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1162', email: 'maximiliano.biagini@wenlen.com', dni: '42.653.749', telefono: '299-5866303', fechaIngreso: '2024-10-02', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Facundo Nicolás', apellido: 'Blanco', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '497', email: 'facundo.blanco@wenlen.com', dni: '35.355.008', telefono: '299-6739839', fechaIngreso: '2018-06-16', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Javier Alfredo', apellido: 'Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '771', email: 'javier.bravo@wenlen.com', dni: '30.412.873', telefono: '299-5466630', fechaIngreso: '2019-12-02', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Juan Darío', apellido: 'Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '252', email: 'juan.bravo@wenlen.com', dni: '29.159.468', telefono: '299-6243195', fechaIngreso: '2014-08-22', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Pablo Enrique', apellido: 'Bustos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1242', email: 'pablo.bustos@wenlen.com', dni: '27.595.588', telefono: '299-5244913', fechaIngreso: '2026-03-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Fernando Raúl', apellido: 'Caballero', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '487', email: 'fernando.caballero@wenlen.com', dni: '23.789.015', telefono: '299-5166801', fechaIngreso: '2018-05-16', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Roberto Carlos', apellido: 'Caberlotti Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '364', email: 'roberto.caberlotti@wenlen.com', dni: '92.792.655', telefono: '299-4286837', fechaIngreso: '2016-02-16', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Javier Alejandro', apellido: 'Cáceres', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '499', email: 'javier.caceres@wenlen.com', dni: '34.592.316', telefono: '299-4292472', fechaIngreso: '2018-06-19', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Néstor Fabián', apellido: 'Campos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1084', email: 'nestor.campos@wenlen.com', dni: '29.027.343', telefono: '299-5126054', fechaIngreso: '2024-02-05', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Antonio', apellido: 'Campos Giusti', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1030', email: 'antonio.campos@wenlen.com', dni: '38.810.191', telefono: '299-4294458', fechaIngreso: '2023-05-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Alexis Evans', apellido: 'Carrizo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '213', email: 'alexis.carrizo@wenlen.com', dni: '33.939.507', telefono: '299-4125830', fechaIngreso: '2014-05-07', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Leonardo Gastón', apellido: 'Carrizo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1154', email: 'leonardo.carrizo@wenlen.com', dni: '33.234.299', telefono: '299-4737462', fechaIngreso: '2024-08-23', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Braian Emmanuel', apellido: 'Carroza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '854', email: 'braian.carroza@wenlen.com', dni: '39.128.610', telefono: '299-5278327', fechaIngreso: '2022-02-11', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Lucas Nami', apellido: 'Carvajal', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1163', email: 'lucas.carvajal@wenlen.com', dni: '37.758.579', telefono: '299-3282700', fechaIngreso: '2024-10-02', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Carlos Marcelo Gabriel', apellido: 'Castañeira', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '1225', email: 'carlos.castaneira@wenlen.com', dni: '36.669.465', telefono: '299-4297282', fechaIngreso: '2025-10-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Geraldine Alejandra', apellido: 'Castillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1229', email: 'geraldine.castillo@wenlen.com', dni: '36.514.054', telefono: '299-5936634', fechaIngreso: '2025-11-10', categoria: 'TII-TB-VI', convenio: 'PP' },
  { nombre: 'Luciano Nicolás', apellido: 'Castro', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1085', email: 'luciano.castro@wenlen.com', dni: '44.780.497', telefono: '2942-407484', fechaIngreso: '2024-02-05', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Andrés', apellido: 'Centeno', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '357', email: 'andres.centeno@wenlen.com', dni: '24.180.745', telefono: '299-4675284', fechaIngreso: '2015-12-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Rafael Horacio', apellido: 'Cerdán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '182', email: 'rafael.cerdan@wenlen.com', dni: '30.387.923', telefono: '299-6309008', fechaIngreso: '2013-11-19', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Alejandro Nicolás', apellido: 'Chávez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '614', email: 'alejandro.chavez@wenlen.com', dni: '33.610.954', telefono: '299-6034432', fechaIngreso: '2018-10-17', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'José Norberto', apellido: 'Cirica', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: '217', email: 'jose.cirica@wenlen.com', dni: '24.746.028', telefono: '299-5871701', fechaIngreso: '2014-05-22', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Miguel Ángel', apellido: 'Cofré', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1145', email: 'miguel.cofre@wenlen.com', dni: '26.945.961', telefono: '299-5223338', fechaIngreso: '2024-07-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Gerardo Andrés', apellido: 'Contreras Cares', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1070', email: 'gerardo.contreras@wenlen.com', dni: '39.130.163', telefono: '299-5832887', fechaIngreso: '2023-09-01', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Esteban Maximiliano', apellido: 'Cortez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1038', email: 'esteban.cortez@wenlen.com', dni: '38.398.622', telefono: '299-5186391', fechaIngreso: '2023-05-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Manuel Gustavo', apellido: 'Cortez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '102', email: 'manuel.cortez@wenlen.com', dni: '24.413.230', telefono: '299-4069014', fechaIngreso: '2013-05-09', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Emanuel Gonzalo', apellido: 'Cuevas', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '415', email: 'emanuel.cuevas@wenlen.com', dni: '27.723.103', telefono: '299-4133638', fechaIngreso: '2017-05-22', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Sebastián Daniel', apellido: 'Díaz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1071', email: 'sebastian.diaz@wenlen.com', dni: '33.823.688', telefono: '299-5900582', fechaIngreso: '2023-09-01', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Ramiro Matías', apellido: 'Díaz Soto', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '218', email: 'ramiro.diaz@wenlen.com', dni: '34.122.184', telefono: '155-505246', fechaIngreso: '2014-05-13', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Braian Nicolás', apellido: 'Enrique', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '489', email: 'braian.enrique@wenlen.com', dni: '39.881.513', telefono: '299-5176436', fechaIngreso: '2018-05-16', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Matías Nicolás', apellido: 'Félix', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1206', email: 'matias.felix@wenlen.com', dni: '31.731.676', telefono: '11-70596803', fechaIngreso: '2025-05-19', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'David Ezequiel', apellido: 'Fernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1087', email: 'david.fernandez@wenlen.com', dni: '32.699.172', telefono: '299-4630680', fechaIngreso: '2024-02-05', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Héctor Ariel', apellido: 'Ferraris', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '86', email: 'hector.ferraris@wenlen.com', dni: '25.911.572', telefono: '299-6351961', fechaIngreso: '2013-01-29', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'César Walter Ariel', apellido: 'Figueroa', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '612', email: 'cesar.figueroa@wenlen.com', dni: '34.663.058', telefono: '299-5798504', fechaIngreso: '2018-10-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Lucas Mario', apellido: 'Figueroa', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1044', email: 'lucas.figueroa@wenlen.com', dni: '31.965.496', telefono: '299-5742397', fechaIngreso: '2023-06-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Luis Alberto', apellido: 'Flores', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: '50', email: 'luis.flores@wenlen.com', dni: '28.485.633', telefono: '299-4110932', fechaIngreso: '2012-10-15', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Miguel Ángel', apellido: 'Forchino', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '412', email: 'miguel.forchino@wenlen.com', dni: '27.674.822', telefono: '299-5330948', fechaIngreso: '2017-05-15', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Sebastián Omar', apellido: 'Forquera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1218', email: 'sebastian.forquera@wenlen.com', dni: '32.148.003', telefono: '298-4199135', fechaIngreso: '2025-09-01', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Sergio Oscar', apellido: 'Fuster', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '286', email: 'sergio.fuster@wenlen.com', dni: '29.548.556', telefono: '2921-408681', fechaIngreso: '2015-01-05', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Silvio Leonardo', apellido: 'Gallo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1102', email: 'silvio.gallo@wenlen.com', dni: '27.657.185', telefono: '3512-228180', fechaIngreso: '2024-03-18', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'José Nicolás', apellido: 'García', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '321', email: 'jose.garcia@wenlen.com', dni: '35.864.922', telefono: '299-5880009', fechaIngreso: '2015-06-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Rodrigo Ariel', apellido: 'Gimenez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1207', email: 'rodrigo.gimenez@wenlen.com', dni: '28.614.858', telefono: '299-4600386', fechaIngreso: '2025-05-19', categoria: 'TII-TB-I', convenio: 'PP' },
  { nombre: 'Cristhian Daniel', apellido: 'González', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '107', email: 'cristhian.gonzalez@wenlen.com', dni: '35.077.733', telefono: '299-5229614', fechaIngreso: '2013-05-24', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Damián Alejandro', apellido: 'Guayrán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '179', email: 'damian.guayran@wenlen.com', dni: '30.226.870', telefono: '299-5293041', fechaIngreso: '2013-11-11', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Miguel Ángel', apellido: 'Guzmán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '443', email: 'miguel.guzman@wenlen.com', dni: '33.180.120', telefono: '299-4523552', fechaIngreso: '2017-09-11', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Uriel Osvaldo', apellido: 'Haedo', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '131', email: 'uriel.haedo@wenlen.com', dni: '33.566.993', telefono: '299-4248542', fechaIngreso: '2013-08-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Gastón Alejandro', apellido: 'Halicki', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '214', email: 'gaston.halicki@wenlen.com', dni: '31.393.108', telefono: '299-6230731', fechaIngreso: '2014-05-05', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Julio César', apellido: 'Halicki', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1105', email: 'julio.halicki@wenlen.com', dni: '30.112.539', telefono: '299-4110268', fechaIngreso: '2024-03-27', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Cristian Agustín', apellido: 'Hermosilla', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1049', email: 'cristian.hermosilla@wenlen.com', dni: '43.156.386', telefono: '299-5941287', fechaIngreso: '2023-06-14', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Martín Facundo', apellido: 'Hernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1146', email: 'martin.hernandez@wenlen.com', dni: '34.960.931', telefono: '299-5177097', fechaIngreso: '2024-07-22', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Gastón Micael', apellido: 'Hirschfeldt', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1098', email: 'gaston.hirschfeldt@wenlen.com', dni: '42.518.393', telefono: '299-4595372', fechaIngreso: '2024-03-08', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Juan Francisco', apellido: 'Huenuhueque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1170', email: 'juan.huenuhueque@wenlen.com', dni: '45.259.152', telefono: '299-5865929', fechaIngreso: '2024-11-19', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Maximiliano Alejandro', apellido: 'Hurstel', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '819', email: 'maximiliano.hurstel@wenlen.com', dni: '30.284.603', telefono: '299-5173462', fechaIngreso: '2021-05-26', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Juan Marcelo', apellido: 'Infante Inostroza', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '617', email: 'juan.infante@wenlen.com', dni: '30.174.811', telefono: '299-4199105', fechaIngreso: '2018-10-18', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Tomás Ezequiel', apellido: 'Inostroza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1113', email: 'tomas.inostroza@wenlen.com', dni: '42.848.452', telefono: '299-5945750', fechaIngreso: '2024-04-12', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Pablo Damián', apellido: 'Jara', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '472', email: 'pablo.jara@wenlen.com', dni: '27.368.797', telefono: '299-4190511', fechaIngreso: '2018-02-20', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Pablo David', apellido: 'Jara', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '203', email: 'pablo.d.jara@wenlen.com', dni: '28.588.018', telefono: '299-5294641', fechaIngreso: '2014-01-16', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Alfredo Renzo', apellido: 'Jordán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '219', email: 'alfredo.jordan@wenlen.com', dni: '31.188.521', telefono: '299-6222472', fechaIngreso: '2014-05-07', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Mariano Sebastián', apellido: 'Kloberdanz', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '74', email: 'mariano.kloberdanz@wenlen.com', dni: '35.592.597', telefono: '299-5300370', fechaIngreso: '2012-10-22', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Lautaro Ángel', apellido: 'Lambrecht', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '786', email: 'lautaro.lambrecht@wenlen.com', dni: '41.591.705', telefono: '299-5867914', fechaIngreso: '2020-02-26', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Facundo Emmanuel', apellido: 'Larena', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '457', email: 'facundo.larena@wenlen.com', dni: '37.943.594', telefono: '299-5473691', fechaIngreso: '2017-12-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Claudio Nicolás', apellido: 'Lillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1107', email: 'claudio.lillo@wenlen.com', dni: '45.260.848', telefono: '299-5364660', fechaIngreso: '2024-03-27', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Martín Iván', apellido: 'Lillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '841', email: 'martin.lillo@wenlen.com', dni: '28.160.461', telefono: '299-4835882', fechaIngreso: '2021-11-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Guillermo Mauricio', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '460', email: 'guillermo.lopez@wenlen.com', dni: '24.825.694', telefono: '299-4042148', fechaIngreso: '2017-12-01', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Ariel Orlando', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '426', email: 'ariel.lopez@wenlen.com', dni: '23.348.774', telefono: '299-5351295', fechaIngreso: '2017-07-04', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Juan Carlos', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '824', email: 'juan.lopez@wenlen.com', dni: '35.601.785', telefono: '299-5484990', fechaIngreso: '2021-06-25', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Matías Alejandro', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1227', email: 'matias.lopez@wenlen.com', dni: '44.779.561', telefono: '299-5078553', fechaIngreso: '2025-10-01', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Osama Amín', apellido: 'Luján', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1205', email: 'osama.lujan@wenlen.com', dni: '46.068.614', telefono: '299-6273717', fechaIngreso: '2025-05-19', categoria: 'TII-TB-I', convenio: 'PP' },
  { nombre: 'Martín Carlos Alberto', apellido: 'Luna', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '177', email: 'martin.luna@wenlen.com', dni: '34.708.364', telefono: '299-6275669', fechaIngreso: '2013-10-22', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Néstor Fabián', apellido: 'Maidana', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '588', email: 'nestor.maidana@wenlen.com', dni: '33.144.714', telefono: '299-4103773', fechaIngreso: '2018-07-07', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Kevin Matías', apellido: 'Maissani', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1222', email: 'kevin.maissani@wenlen.com', dni: '35.492.789', telefono: '298-4649261', fechaIngreso: '2025-09-15', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Marcos David', apellido: 'Manca', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1042', email: 'marcos.manca@wenlen.com', dni: '28.387.967', telefono: '299-4223809', fechaIngreso: '2023-06-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Federico Alberto', apellido: 'Maranghello', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '413', email: 'federico.maranghello@wenlen.com', dni: '28.989.257', telefono: '299-5354041', fechaIngreso: '2017-05-15', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Jonatan Emanuel', apellido: 'Mardonez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1050', email: 'jonatan.mardonez@wenlen.com', dni: '32.518.412', telefono: '299-4206678', fechaIngreso: '2023-06-14', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Pablo Ariel', apellido: 'Marifil', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1005', email: 'pablo.marifil@wenlen.com', dni: '30.009.514', telefono: '299-5728311', fechaIngreso: '2022-10-17', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Juan Martín', apellido: 'Melchior', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '439', email: 'juan.melchior@wenlen.com', dni: '30.587.055', telefono: '292-3522865', fechaIngreso: '2017-08-17', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Facundo Nayit', apellido: 'Méndez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1142', email: 'facundo.mendez@wenlen.com', dni: '38.811.895', telefono: '299-5824328', fechaIngreso: '2024-07-01', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Luis Marcelo', apellido: 'Méndez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '473', email: 'luis.mendez@wenlen.com', dni: '26.541.356', telefono: '299-4721894', fechaIngreso: '2018-02-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Joaquín Fernando', apellido: 'Meza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '784', email: 'joaquin.meza@wenlen.com', dni: '38.044.851', telefono: '299-5833275', fechaIngreso: '2020-12-14', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Carlos Alberto', apellido: 'Miranda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '455', email: 'carlos.miranda@wenlen.com', dni: '30.144.719', telefono: '299-4132544', fechaIngreso: '2017-12-12', categoria: 'TII-TB-VIII', convenio: 'PP' },
  { nombre: 'Diego Eduardo', apellido: 'Miranda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '629', email: 'diego.miranda@wenlen.com', dni: '21.586.745', telefono: '299-4576837', fechaIngreso: '2019-01-02', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Carlos Darío', apellido: 'Mora', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1166', email: 'carlos.mora@wenlen.com', dni: '27.367.642', telefono: '299-5355671', fechaIngreso: '2024-10-23', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Luca Julián', apellido: 'Morales', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1099', email: 'luca.morales@wenlen.com', dni: '45.734.673', telefono: '294-4700963', fechaIngreso: '2024-03-08', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Héctor David', apellido: 'Moreno', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '287', email: 'hector.moreno@wenlen.com', dni: '32.247.442', telefono: '299-4544682', fechaIngreso: '2015-01-05', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Emiliano Marcos Miguel', apellido: 'Muñoz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '229', email: 'emiliano.munoz@wenlen.com', dni: '29.515.504', telefono: '299-4081853', fechaIngreso: '2014-06-02', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Neri Iván', apellido: 'Muñoz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1075', email: 'neri.munoz@wenlen.com', dni: '35.188.003', telefono: '299-5499085', fechaIngreso: '2023-10-02', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Jorge Iván', apellido: 'Neyroud', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '493', email: 'jorge.neyroud@wenlen.com', dni: '35.311.113', telefono: '299-5736824', fechaIngreso: '2018-05-05', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Iván Facundo', apellido: 'Obreque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1016', email: 'ivan.obreque@wenlen.com', dni: '38.493.985', telefono: '299-4619673', fechaIngreso: '2022-12-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Emmanuel Sebastián', apellido: 'Ojeda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '810', email: 'emmanuel.ojeda@wenlen.com', dni: '32.032.886', telefono: '263-4689332', fechaIngreso: '2021-04-05', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Gastón Elías', apellido: 'Oroeta', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '850', email: 'gaston.oroeta@wenlen.com', dni: '33.657.890', telefono: '299-5246115', fechaIngreso: '2022-01-24', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Héctor Alejandro', apellido: 'Ortíz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1026', email: 'hector.ortiz@wenlen.com', dni: '29.554.399', telefono: '299-4054751', fechaIngreso: '2023-03-06', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Rodrigo Iván', apellido: 'Pailaleo', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: '167', email: 'rodrigo.pailaleo@wenlen.com', dni: '30.725.688', telefono: '299-4202149', fechaIngreso: '2013-10-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Martín', apellido: 'Pailaleo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '253', email: 'martin.pailaleo@wenlen.com', dni: '28.945.901', telefono: '299-5053259', fechaIngreso: '2014-08-22', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Marcelo Matías', apellido: 'Palavecino', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '168', email: 'marcelo.palavecino@wenlen.com', dni: '32.518.553', telefono: '299-5706473', fechaIngreso: '2013-10-01', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'César Andrés', apellido: 'Parada', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1147', email: 'cesar.parada@wenlen.com', dni: '31.173.068', telefono: '299-5278535', fechaIngreso: '2024-07-22', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Emilio Ariel', apellido: 'Pardo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '132', email: 'emilio.pardo@wenlen.com', dni: '27.174.579', telefono: '299-6042418', fechaIngreso: '2013-08-26', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Denis Ramiro', apellido: 'Paredes', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '857', email: 'denis.paredes@wenlen.com', dni: '35.059.653', telefono: '2984-526572', fechaIngreso: '2022-02-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Tomás Agustín', apellido: 'Pautasso', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1076', email: 'tomas.pautasso@wenlen.com', dni: '44.430.342', telefono: '299-6251656', fechaIngreso: '2023-10-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Nicolás Manuel', apellido: 'Perello', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '170', email: 'nicolas.perello@wenlen.com', dni: '29.386.723', telefono: '299-6374544', fechaIngreso: '2013-10-01', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Omar Maximiliano', apellido: 'Pereyra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '842', email: 'omar.pereyra@wenlen.com', dni: '41.911.595', telefono: '299-4238034', fechaIngreso: '2021-11-23', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Julián Martín', apellido: 'Pérez Ibargoyen', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1047', email: 'julian.perez@wenlen.com', dni: '38.495.947', telefono: '299-5743553', fechaIngreso: '2023-06-14', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Mario Arnoldo', apellido: 'Perloz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '130', email: 'mario.perloz@wenlen.com', dni: '25.354.366', telefono: '299-5861419', fechaIngreso: '2013-08-02', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Gabriel Alberto', apellido: 'Pilato González', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1152', email: 'gabriel.pilato@wenlen.com', dni: '29.400.714', telefono: '299-5057133', fechaIngreso: '2024-08-16', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Mariano Serafín', apellido: 'Pino', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '466', email: 'mariano.pino@wenlen.com', dni: '31.524.364', telefono: '299-5491794', fechaIngreso: '2018-01-19', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Carlos Andrés', apellido: 'Pituch', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '581', email: 'carlos.pituch@wenlen.com', dni: '23.304.952', telefono: '299-4195684', fechaIngreso: '2018-07-07', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Yoel', apellido: 'Querci Giménez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1007', email: 'yoel.querci@wenlen.com', dni: '44.825.145', telefono: '299-5318792', fechaIngreso: '2022-10-17', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Luciano Miguel', apellido: 'Quinchao', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '826', email: 'luciano.quinchao@wenlen.com', dni: '40.322.561', telefono: '299-5468708', fechaIngreso: '2021-07-27', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Daniel Ezequiel', apellido: 'Quintulaf', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '846', email: 'daniel.quintulaf@wenlen.com', dni: '37.603.600', telefono: '299-6230429', fechaIngreso: '2022-01-07', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Juan Pablo David', apellido: 'Quiroga', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '178', email: 'juan.quiroga@wenlen.com', dni: '26.221.836', telefono: '299-6072124', fechaIngreso: '2013-11-11', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Antonio Tomás', apellido: 'Ramírez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '822', email: 'antonio.ramirez@wenlen.com', dni: '41.348.439', telefono: '299-5526126', fechaIngreso: '2021-06-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Emiliano Martín', apellido: 'Ramos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '360', email: 'emiliano.ramos@wenlen.com', dni: '30.874.398', telefono: '299-5723849', fechaIngreso: '2016-01-25', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Emanuelle Rodrigo', apellido: 'Rascovich', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '421', email: 'emanuelle.rascovich@wenlen.com', dni: '33.197.225', telefono: '299-4514813', fechaIngreso: '2017-07-17', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Héctor Fabio', apellido: 'Ravagnani', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '148', email: 'hector.ravagnani@wenlen.com', dni: '21.999.983', telefono: '299-4131112', fechaIngreso: '2013-09-09', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Víctor Hugo', apellido: 'Rebolledo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '840', email: 'victor.rebolledo@wenlen.com', dni: '35.835.247', telefono: '299-6252898', fechaIngreso: '2021-11-03', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Nicolás Nahuel', apellido: 'Retamal', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1148', email: 'nicolas.retamal@wenlen.com', dni: '33.823.555', telefono: '299-5158084', fechaIngreso: '2024-07-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Juan Domingo', apellido: 'Reuque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '839', email: 'juan.reuque@wenlen.com', dni: '22.863.142', telefono: '2920-568850', fechaIngreso: '2021-10-25', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Martín Nicolás', apellido: 'Reyes', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1079', email: 'martin.reyes@wenlen.com', dni: '45.389.697', telefono: '299-6057818', fechaIngreso: '2023-10-20', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Ramiro Walter Hugo', apellido: 'Rinaldi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1088', email: 'ramiro.rinaldi@wenlen.com', dni: '30.701.176', telefono: '299-4728881', fechaIngreso: '2024-02-05', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Raúl Osmar', apellido: 'Ríos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '169', email: 'raul.rios@wenlen.com', dni: '22.801.998', telefono: '299-4533626', fechaIngreso: '2013-10-01', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Walter Martín', apellido: 'Rivera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '627', email: 'walter.rivera@wenlen.com', dni: '31.314.359', telefono: '299-4277890', fechaIngreso: '2019-01-04', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Emiliano Nicolás', apellido: 'Rocha', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1220', email: 'emiliano.rocha@wenlen.com', dni: '43.555.002', telefono: '299-6243894', fechaIngreso: '2025-09-01', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Diego Nicolás', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: '1179', email: 'diego.rodriguez@wenlen.com', dni: '25.615.169', telefono: '299-6232800', fechaIngreso: '2024-12-16', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Marcelo Nicolás', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1149', email: 'marcelo.rodriguez@wenlen.com', dni: '31.226.215', telefono: '299-4187914', fechaIngreso: '2024-07-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Mario Alberto', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '804', email: 'mario.rodriguez@wenlen.com', dni: '28.503.754', telefono: '297-4277943', fechaIngreso: '2024-03-27', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Ricardo Javier', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1008', email: 'ricardo.rodriguez@wenlen.com', dni: '37.172.756', telefono: '299-4049931', fechaIngreso: '2022-10-17', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Cristian Eladio', apellido: 'Rojas', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1039', email: 'cristian.rojas@wenlen.com', dni: '28.624.139', telefono: '299-5235081', fechaIngreso: '2023-05-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Tomás Joaquín', apellido: 'Romeo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1208', email: 'tomas.romeo@wenlen.com', dni: '42.849.679', telefono: '299-6739960', fechaIngreso: '2025-05-19', categoria: 'TII-TB-I', convenio: 'PP' },
  { nombre: 'Gustavo Germán', apellido: 'Romero', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1223', email: 'gustavo.romero@wenlen.com', dni: '45.734.812', telefono: '299-6553973', fechaIngreso: '2025-09-15', categoria: 'TII-TB-I', convenio: 'PP' },
  { nombre: 'Jesús Juan Martín', apellido: 'Ruiz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '255', email: 'jesus.ruiz@wenlen.com', dni: '37.621.121', telefono: '2954-442619', fechaIngreso: '2014-08-15', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Jonatan Santiago', apellido: 'Sáez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1209', email: 'jonatan.saez@wenlen.com', dni: '34.658.216', telefono: '299-4617085', fechaIngreso: '2025-05-19', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Bernabé Antonio', apellido: 'Sajama', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1077', email: 'bernabe.sajama@wenlen.com', dni: '36.840.102', telefono: '299-4609910', fechaIngreso: '2023-10-02', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Sergio Eduardo', apellido: 'Salamanca', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1052', email: 'sergio.salamanca@wenlen.com', dni: '29.011.224', telefono: '299-5502472', fechaIngreso: '2023-07-03', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Alexis Emanuel', apellido: 'Salazar', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '856', email: 'alexis.salazar@wenlen.com', dni: '40.067.287', telefono: '299-5070455', fechaIngreso: '2022-02-15', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Hugo Martín Francisco', apellido: 'Sánchez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '744', email: 'hugo.sanchez@wenlen.com', dni: '30.731.349', telefono: '299-4642559', fechaIngreso: '2019-06-05', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Nicolás Catriel', apellido: 'Sander', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '88', email: 'nicolas.sander@wenlen.com', dni: '36.992.690', telefono: '299-5961179', fechaIngreso: '2013-01-29', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Guillermo Nicolás', apellido: 'Sanhueza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '583', email: 'guillermo.sanhueza@wenlen.com', dni: '28.485.188', telefono: '299-6566342', fechaIngreso: '2018-07-07', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Matías Sebastián', apellido: 'Santoro', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '83', email: 'matias.santoro@wenlen.com', dni: '33.037.929', telefono: '299-4194599', fechaIngreso: '2013-03-05', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Franco Martín', apellido: 'Schofer', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1228', email: 'franco.schofer@wenlen.com', dni: '31.755.320', telefono: '280-4854389', fechaIngreso: '2025-10-01', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Lucas Gabriel', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '363', email: 'lucas.sepulveda@wenlen.com', dni: '37.401.554', telefono: '299-5368975', fechaIngreso: '2016-02-16', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Marcelo Alfonso', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1013', email: 'marcelo.sepulveda@wenlen.com', dni: '26.132.049', telefono: '299-5530551', fechaIngreso: '2022-10-24', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Maximilano Gabriel', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1210', email: 'maximilano.sepulveda@wenlen.com', dni: '32.474.057', telefono: '294-2603950', fechaIngreso: '2025-05-19', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Gastón Alejandro', apellido: 'Sieben', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '89', email: 'gaston.sieben@wenlen.com', dni: '35.236.040', telefono: '2942-464456', fechaIngreso: '2013-01-29', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Matías Ismael', apellido: 'Sierra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '254', email: 'matias.sierra@wenlen.com', dni: '28.485.358', telefono: '299-6287295', fechaIngreso: '2014-08-22', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Franco Delvis', apellido: 'Silva', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '861', email: 'franco.silva@wenlen.com', dni: '33.532.722', telefono: '299-5247912', fechaIngreso: '2022-05-09', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Jonathan Maximiliano', apellido: 'Simon Pitripan', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '848', email: 'jonathan.simon@wenlen.com', dni: '42.449.376', telefono: '299-6063420', fechaIngreso: '2022-01-03', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Kevin Ezequiel', apellido: 'Solorza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1100', email: 'kevin.solorza@wenlen.com', dni: '38.811.848', telefono: '299-5118978', fechaIngreso: '2024-03-08', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Santiago Agustín', apellido: 'Soria', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '610', email: 'santiago.soria@wenlen.com', dni: '40.899.424', telefono: '299-5017225', fechaIngreso: '2018-10-01', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'Enzo Elías', apellido: 'Soto', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1111', email: 'enzo.soto@wenlen.com', dni: '30.272.626', telefono: '299-5185761', fechaIngreso: '2024-04-08', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Juan Ignacio', apellido: 'Spanu', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1078', email: 'juan.spanu@wenlen.com', dni: '36.816.885', telefono: '299-4217796', fechaIngreso: '2023-10-09', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Sergio Rolando', apellido: 'Strevensky', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '811', email: 'sergio.strevensky@wenlen.com', dni: '29.418.377', telefono: '299-5507000', fechaIngreso: '2021-04-05', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Alejandro David', apellido: 'Stubbia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1089', email: 'alejandro.stubbia@wenlen.com', dni: '34.749.672', telefono: '299-4056986', fechaIngreso: '2024-02-05', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Luis Martín', apellido: 'Tapia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '103', email: 'luis.tapia@wenlen.com', dni: '31.530.410', telefono: '299-5553897', fechaIngreso: '2013-05-09', categoria: 'TII-TA-XI', convenio: 'PP' },
  { nombre: 'Juan Pedro', apellido: 'Tear', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '351', email: 'juan.tear@wenlen.com', dni: '26.617.309', telefono: '299-6226785', fechaIngreso: '2015-11-02', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Nicolás Agustín', apellido: 'Tkaczek', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1155', email: 'nicolas.tkaczek@wenlen.com', dni: '44.462.635', telefono: '299-6291590', fechaIngreso: '2024-08-23', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Carlos Daniel', apellido: 'Tripainao', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '110', email: 'carlos.tripainao@wenlen.com', dni: '33.637.153', telefono: '299-5274398', fechaIngreso: '2013-06-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Nicolás Alexander', apellido: 'Troncoso', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1153', email: 'nicolas.troncoso@wenlen.com', dni: '39.882.204', telefono: '299-4651431', fechaIngreso: '2024-08-16', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Sergio Maximiliano', apellido: 'Trussi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '852', email: 'sergio.trussi@wenlen.com', dni: '33.041.914', telefono: '299-4069458', fechaIngreso: '2022-02-11', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Ricardo Andrés', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1068', email: 'ricardo.urrutia@wenlen.com', dni: '33.952.688', telefono: '299-4668927', fechaIngreso: '2023-08-22', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Agustín Julián', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1048', email: 'agustin.urrutia@wenlen.com', dni: '39.522.546', telefono: '294-2584761', fechaIngreso: '2023-06-14', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Francisco Cristian', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '332', email: 'francisco.urrutia@wenlen.com', dni: '22.601.652', telefono: '299-4387419', fechaIngreso: '2015-07-27', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Matías Luis', apellido: 'Valenzuela', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '478', email: 'matias.valenzuela@wenlen.com', dni: '36.372.080', telefono: '299-4678392', fechaIngreso: '2018-03-26', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Joaquín Ariel', apellido: 'Vallejos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1024', email: 'joaquin.vallejos@wenlen.com', dni: '44.014.897', telefono: '299-4659402', fechaIngreso: '2023-03-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Javier Andrés', apellido: 'Vargas', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '962', email: 'javier.vargas@wenlen.com', dni: '32.538.155', telefono: '299-3279870', fechaIngreso: '2011-07-12', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Héctor Mariano', apellido: 'Vargas', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '181', email: 'hector.vargas@wenlen.com', dni: '29.009.617', telefono: '299-6064380', fechaIngreso: '2013-11-14', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Ángel Franco', apellido: 'Vázquez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1164', email: 'angel.vazquez@wenlen.com', dni: '32.020.479', telefono: '299-5551026', fechaIngreso: '2024-10-02', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Benjamín Sebastián', apellido: 'Vera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '233', email: 'benjamin.vera@wenlen.com', dni: '31.949.144', telefono: '299-4028123', fechaIngreso: '2014-07-24', categoria: 'TII-TA-VIII', convenio: 'PP' },
  { nombre: 'José Octavio', apellido: 'Vergara', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '467', email: 'jose.vergara@wenlen.com', dni: '32.544.975', telefono: '299-6578910', fechaIngreso: '2018-01-23', categoria: 'TII-TA-IX', convenio: 'PP' },
  { nombre: 'Matías Delmar', apellido: 'Vigna', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '288', email: 'matias.vigna@wenlen.com', dni: '31.506.599', telefono: '299-4122771', fechaIngreso: '2015-01-05', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Lautaro Nicolás', apellido: 'Vivanco', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1037', email: 'lautaro.vivanco@wenlen.com', dni: '42.449.773', telefono: '294-4708605', fechaIngreso: '2023-05-22', categoria: 'TII-TA-IV', convenio: 'PP' },
  { nombre: 'Marcos Anselmo', apellido: 'Waiman', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: '480', email: 'marcos.waiman@wenlen.com', dni: '33.668.045', telefono: '299-5221009', fechaIngreso: '2018-03-26', categoria: 'TII-TA-X', convenio: 'PP' },
  { nombre: 'Maximiliano', apellido: 'Ybañez Pastene', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '1040', email: 'maximiliano.ybanez@wenlen.com', dni: '33.450.105', telefono: '299-5352603', fechaIngreso: '2023-05-22', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Sebastián Miguel', apellido: 'Zuñiga', sector: 'FRACTURA', rol: 'OPERADOR', legajo: '206', email: 'sebastian.zuniga@wenlen.com', dni: '33.041.911', telefono: '299-5136683', fechaIngreso: '2014-03-14', categoria: 'TII-TA-XI', convenio: 'PP' },
  // -- INTENDENCIA --
  { nombre: 'Néstor', apellido: 'Alegría', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '1188', email: 'nestor.alegria@wenlen.com', dni: '21.385.759', telefono: '299-5055534', fechaIngreso: '2025-02-24', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Andrés Fidel', apellido: 'Badilla Rubilar', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '1239', email: 'andres.badilla@wenlen.com', dni: '92.633.382', telefono: '299-5858541', fechaIngreso: '2026-03-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Catherine Luciana', apellido: 'García', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '1066', email: 'catherine.garcia@wenlen.com', dni: '39.128.748', telefono: '299-6598103', fechaIngreso: '2023-08-09', categoria: 'TII-TB-II', convenio: 'PP' },
  { nombre: 'Néstor Fabián', apellido: 'Gutiérrez', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '1065', email: 'nestor.gutierrez@wenlen.com', dni: '28.718.631', telefono: '299-5096657', fechaIngreso: '2023-08-09', categoria: 'TII-TB-II', convenio: 'PP' },
  { nombre: 'Andrea Carolina', apellido: 'Holzmann', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '293', email: 'andrea.holzmann@wenlen.com', dni: '36.801.232', telefono: '299-5119428', fechaIngreso: '2015-02-19', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Andrés', apellido: 'Toth', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: '587', email: 'andres.toth@wenlen.com', dni: '24.825.916', telefono: '299-5744995', fechaIngreso: '2023-11-06', categoria: 'SPJ', convenio: 'PJ' },
  // -- LOGISTICA --
  { nombre: 'Mauricio Aníbal', apellido: 'Beltrame', sector: 'LOGISTICA', rol: 'COORDINADOR', legajo: '1224', email: 'mauricio.beltrame@wenlen.com', dni: '29.386.798', telefono: '299-4386378', fechaIngreso: '2025-10-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Martín Javier', apellido: 'Beltrame', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: '1004', email: 'martin.beltrame@wenlen.com', dni: '32.292.943', telefono: '299-5708869', fechaIngreso: '2022-09-13', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Nicolás Rafael', apellido: 'Figueroa', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: '183', email: 'nicolas.figueroa@wenlen.com', dni: '29.386.886', telefono: '299-6239169', fechaIngreso: '2013-12-09', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Nicolás', apellido: 'Palma Mc Kidd', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: '474', email: 'nicolas.palma@wenlen.com', dni: '35.592.569', telefono: '299-5953454', fechaIngreso: '2018-02-01', categoria: 'TII-TB-X', convenio: 'PP' },
  { nombre: 'Darío Rubén', apellido: 'Pascucci', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: '340', email: 'dario.pascucci@wenlen.com', dni: '33.447.598', telefono: '299-5951170', fechaIngreso: '2015-08-03', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Sergio Alejandro', apellido: 'Rivera', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: '199', email: 'sergio.rivera@wenlen.com', dni: '17.627.428', telefono: '0351-3851512', fechaIngreso: '2014-01-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Marcelo Andrés', apellido: 'Saiz', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: '111', email: 'marcelo.saiz@wenlen.com', dni: '21.640.213', telefono: '299-5025621', fechaIngreso: '2013-06-10', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Diego Nicolás', apellido: 'Vanzella', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: '1129', email: 'diego.vanzella@wenlen.com', dni: '33.917.793', telefono: '299-5807547', fechaIngreso: '2024-05-07', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Maximiliano Oscar', apellido: 'Wimberger', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: '1197', email: 'maximiliano.wimberger@wenlen.com', dni: '34.095.537', telefono: '299-4587480', fechaIngreso: '2025-04-01', categoria: 'SPJ', convenio: 'PJ' },
  // -- MANTENIMIENTO --
  { nombre: 'Diego Pablo', apellido: 'Castro', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1184', email: 'diego.castro@wenlen.com', dni: '33.166.761', telefono: '299-4557760', fechaIngreso: '2025-01-20', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Fernando Ezequiel', apellido: 'Espriu Ávila', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '844', email: 'fernando.espriu@wenlen.com', dni: '37.771.467', telefono: '299-5522587', fechaIngreso: '2021-12-22', categoria: 'TII-TB-VIII', convenio: 'PP' },
  { nombre: 'Juan Cruz', apellido: 'Ferrucci', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1015', email: 'juan.ferrucci@wenlen.com', dni: '36.435.493', telefono: '299-4641370', fechaIngreso: '2023-06-03', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Nery Osmar', apellido: 'Gerez', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1122', email: 'nery.gerez@wenlen.com', dni: '35.310.455', telefono: '299-4023285', fechaIngreso: '2024-04-24', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Denise Gabriel', apellido: 'Girardi', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '770', email: 'denise.girardi@wenlen.com', dni: '25.619.280', telefono: '299-4107792', fechaIngreso: '2019-12-09', categoria: 'TII-TB-X', convenio: 'PP' },
  { nombre: 'Sergio Oscar', apellido: 'Guardia', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '653', email: 'sergio.guardia@wenlen.com', dni: '23.786.987', telefono: '299-6232584', fechaIngreso: '2019-04-12', categoria: 'TII-TB-IX', convenio: 'PP' },
  { nombre: 'Sergio Fabián', apellido: 'Lara', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1081', email: 'sergio.lara@wenlen.com', dni: '33.464.261', telefono: '299-5752084', fechaIngreso: '2023-12-18', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Juan Osvaldo', apellido: 'Maulén', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '648', email: 'juan.maulen@wenlen.com', dni: '14.175.882', telefono: '260-4387314', fechaIngreso: '2019-04-10', categoria: 'TII-TB-VII', convenio: 'PP' },
  { nombre: 'Juan Julián', apellido: 'Morales', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1226', email: 'juan.morales@wenlen.com', dni: '42.264.972', telefono: '299-6100023', fechaIngreso: '2025-10-01', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'David Emiliano', apellido: 'Obreque', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1193', email: 'david.obreque@wenlen.com', dni: '39.682.784', telefono: '299-6918738', fechaIngreso: '2025-02-24', categoria: 'TII-TB-III', convenio: 'PP' },
  { nombre: 'Leandro Andrés', apellido: 'Ojeda Torres', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1023', email: 'leandro.ojeda@wenlen.com', dni: '33.291.762', telefono: '299-4181563', fechaIngreso: '2023-03-01', categoria: 'TII-TB-VI', convenio: 'PP' },
  { nombre: 'Gregorio Nicolás', apellido: 'Sánchez Díaz', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1073', email: 'gregorio.sanchez@wenlen.com', dni: '34.866.951', telefono: '299-6014561', fechaIngreso: '2023-10-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Maximiliano Hernán', apellido: 'Urrutia', sector: 'MANTENIMIENTO', rol: 'OPERADOR', legajo: '1214', email: 'maximiliano.urrutia@wenlen.com', dni: '38.232.858', telefono: '299-4670462', fechaIngreso: '2025-06-09', categoria: 'TII-TB-V', convenio: 'PP' },
  // -- TESTING --
  { nombre: 'Luis Ceferino', apellido: 'Almeira', sector: 'TESTING', rol: 'OPERADOR', legajo: '1060', email: 'luis.almeira@wenlen.com', dni: '28.848.381', telefono: '299-4112187', fechaIngreso: '2023-08-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Alberto Daniel', apellido: 'Arismendi', sector: 'TESTING', rol: 'COORDINADOR', legajo: '1045', email: 'alberto.arismendi@wenlen.com', dni: '31.679.158', telefono: '299-5704955', fechaIngreso: '2023-06-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Fernando Ariel', apellido: 'Arriagada', sector: 'TESTING', rol: 'OPERADOR', legajo: '1180', email: 'fernando.arriagada@wenlen.com', dni: '35.659.088', telefono: '299-5345703', fechaIngreso: '2025-01-02', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Cristian Daniel', apellido: 'Ávalos', sector: 'TESTING', rol: 'OPERADOR', legajo: '1106', email: 'cristian.avalos@wenlen.com', dni: '36.150.531', telefono: '299-5887090', fechaIngreso: '2024-03-27', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Patricio Andrés', apellido: 'Badilla', sector: 'TESTING', rol: 'OPERADOR', legajo: '1104', email: 'patricio.badilla@wenlen.com', dni: '33.532.642', telefono: '299-5705304', fechaIngreso: '2024-03-27', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Cristian Darío', apellido: 'Baez', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1035', email: 'cristian.baez@wenlen.com', dni: '31.794.829', telefono: '299-4620000', fechaIngreso: '2023-05-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Marcelo Ubaldo', apellido: 'Barrera', sector: 'TESTING', rol: 'OPERADOR', legajo: '1138', email: 'marcelo.barrera@wenlen.com', dni: '25.196.079', telefono: '299-4537066', fechaIngreso: '2024-07-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Arnaldo Andrés', apellido: 'Benítez', sector: 'TESTING', rol: 'OPERADOR', legajo: '1130', email: 'arnaldo.benitez@wenlen.com', dni: '31.792.603', telefono: '299-4577168', fechaIngreso: '2024-05-20', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Claudio Fernando', apellido: 'Berra', sector: 'TESTING', rol: 'OPERADOR', legajo: '173', email: 'claudio.berra@wenlen.com', dni: '32.588.194', telefono: '299-4090467', fechaIngreso: '2024-04-08', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Pablo Antonio', apellido: 'Bucolo', sector: 'TESTING', rol: 'OPERADOR', legajo: '1134', email: 'pablo.bucolo@wenlen.com', dni: '28.688.895', telefono: '299-4555350', fechaIngreso: '2024-06-05', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Brandon Sebastián', apellido: 'Bustos', sector: 'TESTING', rol: 'OPERADOR', legajo: '1241', email: 'brandon.bustos@wenlen.com', dni: '46.257.339', telefono: '299-6252509', fechaIngreso: '2026-03-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Carlos Jesús Andrés', apellido: 'Camargo', sector: 'TESTING', rol: 'OPERADOR', legajo: '1243', email: 'carlos.camargo@wenlen.com', dni: '33.319.174', telefono: '299-3281917', fechaIngreso: '2026-03-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Agustín Rodrigo', apellido: 'Cattaneo', sector: 'TESTING', rol: 'OPERADOR', legajo: '1124', email: 'agustin.cattaneo@wenlen.com', dni: '44.825.200', telefono: '299-5934560', fechaIngreso: '2024-05-07', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Emanuel Alejandro', apellido: 'Cepeda', sector: 'TESTING', rol: 'OPERADOR', legajo: '1173', email: 'emanuel.cepeda@wenlen.com', dni: '38.476.545', telefono: '299-5248526', fechaIngreso: '2024-12-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Mauro Gabriel', apellido: 'Contreras', sector: 'TESTING', rol: 'OPERADOR', legajo: '1086', email: 'mauro.contreras@wenlen.com', dni: '32.614.002', telefono: '299-5795810', fechaIngreso: '2024-02-05', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Juan Pablo', apellido: 'Corachan', sector: 'TESTING', rol: 'COORDINADOR', legajo: '1080', email: 'juan.corachan@wenlen.com', dni: '30.072.689', telefono: '299-4205637', fechaIngreso: '2023-12-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Leonardo Damián', apellido: 'Cuitiño', sector: 'TESTING', rol: 'OPERADOR', legajo: '1199', email: 'leonardo.cuitino@wenlen.com', dni: '33.302.276', telefono: '299-5755531', fechaIngreso: '2025-05-05', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Miguel Ángel', apellido: 'Curihuinca', sector: 'TESTING', rol: 'OPERADOR', legajo: '1190', email: 'miguel.curihuinca@wenlen.com', dni: '34.662.791', telefono: '299-5166688', fechaIngreso: '2025-02-24', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Rodrigo Nahuel', apellido: 'Elías', sector: 'TESTING', rol: 'OPERADOR', legajo: '1174', email: 'rodrigo.elias@wenlen.com', dni: '41.790.474', telefono: '299-5310365', fechaIngreso: '2024-12-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Emanuel Sergio David', apellido: 'Fernández', sector: 'TESTING', rol: 'OPERADOR', legajo: '1118', email: 'emanuel.fernandez@wenlen.com', dni: '33.197.051', telefono: '299-5727057', fechaIngreso: '2024-04-17', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Jorge Luis', apellido: 'Figueroa', sector: 'TESTING', rol: 'OPERADOR', legajo: '1200', email: 'jorge.figueroa@wenlen.com', dni: '26.840.382', telefono: '299-5697676', fechaIngreso: '2025-05-05', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Diego Lautaro', apellido: 'Fuentealba', sector: 'TESTING', rol: 'OPERADOR', legajo: '1119', email: 'diego.fuentealba@wenlen.com', dni: '44.605.440', telefono: '299-6036683', fechaIngreso: '2024-04-17', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Maximiliano Andrés', apellido: 'Fuentes', sector: 'TESTING', rol: 'OPERADOR', legajo: '1140', email: 'maximiliano.fuentes@wenlen.com', dni: '35.968.985', telefono: '294-2474803', fechaIngreso: '2024-07-01', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Nicolás Ricardo', apellido: 'García', sector: 'TESTING', rol: 'OPERADOR', legajo: '1237', email: 'nicolas.garcia@wenlen.com', dni: '33.823.495', telefono: '299-5954084', fechaIngreso: '2025-12-09', categoria: 'TII-TB-IV', convenio: 'PP' },
  { nombre: 'Rubén Eduardo', apellido: 'Garrido', sector: 'TESTING', rol: 'OPERADOR', legajo: '1051', email: 'ruben.garrido@wenlen.com', dni: '33.673.132', telefono: '299-5857544', fechaIngreso: '2023-06-14', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Giuliano Marcos', apellido: 'Giusti', sector: 'TESTING', rol: 'OPERADOR', legajo: '1192', email: 'giuliano.giusti@wenlen.com', dni: '36.256.985', telefono: '299-4692067', fechaIngreso: '2025-02-24', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Carlos Martín', apellido: 'Guinder', sector: 'TESTING', rol: 'OPERADOR', legajo: '1195', email: 'carlos.guinder@wenlen.com', dni: '29.386.848', telefono: '299-4226148', fechaIngreso: '2025-03-17', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Javier Alejandro', apellido: 'Hazeldine', sector: 'TESTING', rol: 'OPERADOR', legajo: '1115', email: 'javier.hazeldine@wenlen.com', dni: '31.796.581', telefono: '294-4296400', fechaIngreso: '2024-04-12', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Eglhaydee Veronica', apellido: 'Ibañez Ybañez', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1185', email: 'eglhaydee.ibanez@wenlen.com', dni: '95.850.989', telefono: '2.996.830.878', fechaIngreso: '2025-01-20', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Juan Ignacio', apellido: 'Jofré Krause', sector: 'TESTING', rol: 'OPERADOR', legajo: '1141', email: 'juan.jofre@wenlen.com', dni: '41.911.701', telefono: '299-5110255', fechaIngreso: '2024-07-01', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Emanuel Matías', apellido: 'Kastli', sector: 'TESTING', rol: 'OPERADOR', legajo: '1201', email: 'emanuel.kastli@wenlen.com', dni: '37.348.636', telefono: '299-5817120', fechaIngreso: '2025-05-05', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Lucas Fernando', apellido: 'Liempe', sector: 'TESTING', rol: 'OPERADOR', legajo: '1055', email: 'lucas.liempe@wenlen.com', dni: '37.995.673', telefono: '299-6355301', fechaIngreso: '2023-07-03', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Diego Heraldo', apellido: 'Lizama', sector: 'TESTING', rol: 'OPERADOR', legajo: '1108', email: 'diego.lizama@wenlen.com', dni: '32.570.361', telefono: '299-5880039', fechaIngreso: '2024-04-03', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Rodrigo Emmanuel', apellido: 'López Villena', sector: 'TESTING', rol: 'OPERADOR', legajo: '1125', email: 'rodrigo.lopez@wenlen.com', dni: '40.613.740', telefono: '299-5041842', fechaIngreso: '2024-05-07', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Nashif Aaron', apellido: 'Mansur', sector: 'TESTING', rol: 'OPERADOR', legajo: '1120', email: 'nashif.mansur@wenlen.com', dni: '36.784.075', telefono: '299-5212335', fechaIngreso: '2024-04-17', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Diego Emanuel', apellido: 'Mondaca', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1059', email: 'diego.mondaca@wenlen.com', dni: '35.311.640', telefono: '294-2460834', fechaIngreso: '2023-08-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Ezequias Emanuel', apellido: 'Morales Fernández', sector: 'TESTING', rol: 'OPERADOR', legajo: '1053', email: 'ezequias.morales@wenlen.com', dni: '44.481.550', telefono: '299-5236111', fechaIngreso: '2023-07-03', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Diego Ezequiel', apellido: 'Morales Ramos', sector: 'TESTING', rol: 'OPERADOR', legajo: '1054', email: 'diego.morales@wenlen.com', dni: '31.962.116', telefono: '294-2641139', fechaIngreso: '2023-07-03', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Juan Manuel', apellido: 'Moreno', sector: 'TESTING', rol: 'OPERADOR', legajo: '1103', email: 'juan.moreno@wenlen.com', dni: '42.910.945', telefono: '299-6251196', fechaIngreso: '2024-03-27', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Vicente Víctor', apellido: 'Moreno', sector: 'TESTING', rol: 'OPERADOR', legajo: '1132', email: 'vicente.moreno@wenlen.com', dni: '27.323.738', telefono: '299-4106534', fechaIngreso: '2024-05-20', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Alan Yusef', apellido: 'Muñoz', sector: 'TESTING', rol: 'OPERADOR', legajo: '1203', email: 'alan.munoz@wenlen.com', dni: '36.434.994', telefono: '299-6115838', fechaIngreso: '2025-05-05', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Marvin Paolo', apellido: 'Navarro', sector: 'TESTING', rol: 'OPERADOR', legajo: '1109', email: 'marvin.navarro@wenlen.com', dni: '36.201.433', telefono: '299-5325392', fechaIngreso: '2024-04-08', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Facundo', apellido: 'Paez', sector: 'TESTING', rol: 'OPERADOR', legajo: '1092', email: 'facundo.paez@wenlen.com', dni: '37.172.701', telefono: '299-4279796', fechaIngreso: '2024-02-07', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Daniel Enrique', apellido: 'Palma', sector: 'TESTING', rol: 'OPERADOR', legajo: '1112', email: 'daniel.palma@wenlen.com', dni: '38.232.949', telefono: '299-5509426', fechaIngreso: '2024-04-08', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Valentín', apellido: 'Palomar Serrano', sector: 'TESTING', rol: 'OPERADOR', legajo: '1116', email: 'valentin.palomar@wenlen.com', dni: '45.978.678', telefono: '299-6328292', fechaIngreso: '2024-04-12', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Braian Alexander', apellido: 'Peña', sector: 'TESTING', rol: 'OPERADOR', legajo: '1245', email: 'braian.pena@wenlen.com', dni: '37.461.620', telefono: '299-5461621', fechaIngreso: '2026-03-02', categoria: 'TII-TB-V', convenio: 'PP' },
  { nombre: 'Eduardo Alejandro', apellido: 'Perea', sector: 'TESTING', rol: 'OPERADOR', legajo: '1236', email: 'eduardo.perea@wenlen.com', dni: '22.820.035', telefono: '298-4739803', fechaIngreso: '2025-12-09', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Bernard Jean Gabriel', apellido: 'Piller', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1001', email: 'bernard.piller@wenlen.com', dni: '96.008.596', telefono: '11-57390701', fechaIngreso: '2022-07-15', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Matías Facundo', apellido: 'Provoste', sector: 'TESTING', rol: 'OPERADOR', legajo: '1175', email: 'matias.provoste@wenlen.com', dni: '34.001.729', telefono: '299-5271869', fechaIngreso: '2024-12-02', categoria: 'TII-TA-V', convenio: 'PP' },
  { nombre: 'Rodrigo Alexis', apellido: 'Reyes', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1028', email: 'rodrigo.reyes@wenlen.com', dni: '32.588.109', telefono: '299-5695432', fechaIngreso: '2023-03-21', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Vito Martín', apellido: 'Riquelme', sector: 'TESTING', rol: 'OPERADOR', legajo: '1020', email: 'vito.riquelme@wenlen.com', dni: '33.823.377', telefono: '299-6112381', fechaIngreso: '2023-02-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Lucas Nicolás', apellido: 'Salatino', sector: 'TESTING', rol: 'OPERADOR', legajo: '1114', email: 'lucas.salatino@wenlen.com', dni: '36.669.091', telefono: '299-5331690', fechaIngreso: '2024-04-12', categoria: 'TII-TA-VI', convenio: 'PP' },
  { nombre: 'Félix Darío', apellido: 'San Martín', sector: 'TESTING', rol: 'OPERADOR', legajo: '1136', email: 'felix.san@wenlen.com', dni: '31.226.186', telefono: '299-5890175', fechaIngreso: '2024-06-05', categoria: 'TII-TA-VII', convenio: 'PP' },
  { nombre: 'Héctor Mauricio', apellido: 'Tejerina', sector: 'TESTING', rol: 'OPERADOR', legajo: '1090', email: 'hector.tejerina@wenlen.com', dni: '35.281.206', telefono: '299-5185662', fechaIngreso: '2024-02-05', categoria: 'TII-TA-III', convenio: 'PP' },
  { nombre: 'Nicolás Alejandro', apellido: 'Vázquez', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1061', email: 'nicolas.vazquez@wenlen.com', dni: '41.609.123', telefono: '299-5951066', fechaIngreso: '2023-08-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Nicolás Emmanuel', apellido: 'Zaragoza', sector: 'TESTING', rol: 'SUPERVISOR', legajo: '1057', email: 'nicolas.zaragoza@wenlen.com', dni: '29.732.247', telefono: '299-6552219', fechaIngreso: '2023-07-12', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Germán Agustín', apellido: 'Zwenger', sector: 'TESTING', rol: 'OPERADOR', legajo: '1093', email: 'german.zwenger@wenlen.com', dni: '40.840.315', telefono: '298-4907967', fechaIngreso: '2024-02-07', categoria: 'TII-TA-VII', convenio: 'PP' },
  // -- WIRELINE --
  { nombre: 'Sergio Gabriel', apellido: 'Abregú', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '1002', email: 'sergio.abregu@wenlen.com', dni: '29.461.981', telefono: '299-5338198', fechaIngreso: '2022-07-01', categoria: 'TIII-TS-VIII', convenio: 'PP' },
  { nombre: 'Fernando', apellido: 'Arriagada Guerrero', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '383', email: 'fernando.arriagada2@wenlen.com', dni: '92.599.078', telefono: '299-6258567', fechaIngreso: '2023-03-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Franco Julián', apellido: 'Bercovich', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '1165', email: 'franco.bercovich@wenlen.com', dni: '44.779.026', telefono: '299-4110824', fechaIngreso: '2024-10-23', categoria: 'TIII-TS-III', convenio: 'PP' },
  { nombre: 'Dante Daniel', apellido: 'Bracco', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '1169', email: 'dante.bracco@wenlen.com', dni: '27.411.751', telefono: '297-4611033', fechaIngreso: '2024-11-19', categoria: 'TIII-TS-VIII', convenio: 'PP' },
  { nombre: 'Pablo Gabriel', apellido: 'Chiuchiarelli', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '384', email: 'pablo.chiuchiarelli@wenlen.com', dni: '21.927.073', telefono: '299-6373496', fechaIngreso: '2016-08-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Esteban Leonardo', apellido: 'Fernández', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '434', email: 'esteban.fernandez@wenlen.com', dni: '24.777.546', telefono: '299-6228205', fechaIngreso: '2017-08-01', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Hernán Osvaldo', apellido: 'Maturana', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '1182', email: 'hernan.maturana@wenlen.com', dni: '31.985.670', telefono: '299-4109837', fechaIngreso: '2025-01-02', categoria: 'SPJ', convenio: 'PJ' },
  { nombre: 'Marcelo Alejandro', apellido: 'Mendoza', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '424', email: 'marcelo.mendoza@wenlen.com', dni: '25.087.060', telefono: '299-5109495', fechaIngreso: '2017-07-17', categoria: 'TIII-TS-X', convenio: 'PP' },
  { nombre: 'Luis Ángel', apellido: 'Rodríguez', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '1123', email: 'luis.rodriguez@wenlen.com', dni: '26.702.890', telefono: '299-5286054', fechaIngreso: '2024-04-24', categoria: 'TIII-TS-X', convenio: 'PP' },
  { nombre: 'Luis Alfredo', apellido: 'Traiman', sector: 'WIRELINE', rol: 'OPERADOR', legajo: '655', email: 'luis.traiman@wenlen.com', dni: '30.500.925', telefono: '2984-572710', fechaIngreso: '2019-05-20', categoria: 'SPJ', convenio: 'PJ' },
];

// ═══════════════════════════════════════════════════════════════
// MAIN SEED
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('🌱 Iniciando seed beta 1.0...');

  // ─────────────────────────────────
  // 1. EMPRESA
  // ─────────────────────────────────
  const empresa = await prisma.empresa.create({
    data: {
      nombre: 'WENLEN',
      cuit: '30-12345678-9',
    },
  });
  console.log('✅ Empresa creada:', empresa.nombre);

  // ─────────────────────────────────
  // 1b. ROLES (dynamic)
  // ─────────────────────────────────
  const rolesData = [
    { codigo: 'ADMIN', nombre: 'Administrador', descripcion: 'Acceso total al sistema', color: '#EF4444', nivel: 100, esSistema: true },
    { codigo: 'RRHH', nombre: 'Recursos Humanos', descripcion: 'Gestión de personal, recibos, cierre', color: '#8B5CF6', nivel: 90, esSistema: true },
    { codigo: 'GERENTE', nombre: 'Gerente', descripcion: 'Visualización de analytics y reportes', color: '#F59E0B', nivel: 80, esSistema: true },
    { codigo: 'COORDINADOR', nombre: 'Coordinador', descripcion: 'Aprobación de planillas y gestión de equipo', color: '#3B82F6', nivel: 70, esSistema: true },
    { codigo: 'CMASS', nombre: 'CMASS (Seg. e Higiene)', descripcion: 'Seguridad, higiene y medioambiente — gestión WENTOP cross-sector', color: '#F97316', nivel: 75, esSistema: true },
    { codigo: 'SUPERVISOR', nombre: 'Supervisor', descripcion: 'Supervisión de operaciones en campo', color: '#10B981', nivel: 60, esSistema: true },
    { codigo: 'OPERADOR', nombre: 'Operador', descripcion: 'Carga de horas y solicitudes', color: '#64748B', nivel: 10, esSistema: true },
  ];
  for (const r of rolesData) {
    await prisma.rolConfig.create({ data: { empresaId: empresa.id, ...r } });
  }
  console.log('✅ 7 roles del sistema creados');

  // ─────────────────────────────────
  // 2. SECTORES
  // ─────────────────────────────────
  const sectoresData = [
    { nombre: 'Fractura', color: '#EF4444', descripcion: 'Operaciones de fractura hidráulica' },
    { nombre: 'Cabezales', color: '#10B981', descripcion: 'Servicios de boca de pozo (SBDP)' },
    { nombre: 'Logística y Transporte', color: '#F59E0B', descripcion: 'Transporte, logística y mantenimiento' },
    { nombre: 'Administración', color: '#8B5CF6', descripcion: 'Administración y gerencia' },
    { nombre: 'Almacén', color: '#06B6D4', descripcion: 'Gestión de almacén y materiales' },
    { nombre: 'Intendencia', color: '#EC4899', descripcion: 'Mantenimiento edilicio y facilities' },
    { nombre: 'CMASS', color: '#3B82F6', descripcion: 'Calidad, Medio Ambiente, Salud y Seguridad' },
    { nombre: 'Wireline', color: '#6366F1', descripcion: 'Wireline y Slickline' },
    { nombre: 'Testing', color: '#A855F7', descripcion: 'Ensayos de pozo y testing' },
  ];

  const sectores: Record<string, string> = {};
  for (const s of sectoresData) {
    const sector = await prisma.sector.create({
      data: { empresaId: empresa.id, ...s },
    });
    sectores[s.nombre] = sector.id;
  }
  console.log('✅ 9 sectores creados');

  // ═════════════════════════════════════════════════
  // 3. CCT 644/12 — PETROLEROS PRIVADOS
  // ═════════════════════════════════════════════════
  const convenioPP = await prisma.convenio.create({
    data: {
      empresaId: empresa.id,
      nombre: 'CCT 644/12 Petroleros Privados',
      tipo: CctTipo.PETROLEROS_PRIVADOS_644,
      vigenteDesde: new Date('2012-01-01'),
    },
  });
  console.log('✅ Convenio PP creado:', convenioPP.nombre);

  // ── Categorías CCT 644/12 ──
  const catsPP = [
    // Título II — Tipo A (Producción y Mantenimiento)
    { codigo: 'TII-TA-III', nombre: 'Título II Tipo A — Categoría III', orden: 3 },
    { codigo: 'TII-TA-IV', nombre: 'Título II Tipo A — Categoría IV', orden: 4 },
    { codigo: 'TII-TA-V', nombre: 'Título II Tipo A — Categoría V', orden: 5 },
    { codigo: 'TII-TA-VI', nombre: 'Título II Tipo A — Categoría VI', orden: 6 },
    { codigo: 'TII-TA-VII', nombre: 'Título II Tipo A — Categoría VII', orden: 7 },
    { codigo: 'TII-TA-VIII', nombre: 'Título II Tipo A — Categoría VIII', orden: 8 },
    { codigo: 'TII-TA-IX', nombre: 'Título II Tipo A — Categoría IX', orden: 9 },
    { codigo: 'TII-TA-X', nombre: 'Título II Tipo A — Categoría X', orden: 10 },
    { codigo: 'TII-TA-XI', nombre: 'Título II Tipo A — Categoría XI', orden: 11 },
    // Título II — Tipo B
    { codigo: 'TII-TB-I', nombre: 'Título II Tipo B — Categoría I', orden: 21 },
    { codigo: 'TII-TB-II', nombre: 'Título II Tipo B — Categoría II', orden: 22 },
    { codigo: 'TII-TB-III', nombre: 'Título II Tipo B — Categoría III', orden: 23 },
    { codigo: 'TII-TB-IV', nombre: 'Título II Tipo B — Categoría IV', orden: 24 },
    { codigo: 'TII-TB-V', nombre: 'Título II Tipo B — Categoría V', orden: 25 },
    { codigo: 'TII-TB-VI', nombre: 'Título II Tipo B — Categoría VI', orden: 26 },
    { codigo: 'TII-TB-VII', nombre: 'Título II Tipo B — Categoría VII', orden: 27 },
    { codigo: 'TII-TB-VIII', nombre: 'Título II Tipo B — Categoría VIII', orden: 28 },
    { codigo: 'TII-TB-IX', nombre: 'Título II Tipo B — Categoría IX', orden: 29 },
    { codigo: 'TII-TB-X', nombre: 'Título II Tipo B — Categoría X', orden: 30 },
    // Título III — Técnicos y Servicios
    { codigo: 'TIII-TS-III', nombre: 'Título III Téc. y Serv. — Categoría III', orden: 43 },
    { codigo: 'TIII-TS-VIII', nombre: 'Título III Téc. y Serv. — Categoría VIII', orden: 48 },
    { codigo: 'TIII-TS-X', nombre: 'Título III Téc. y Serv. — Categoría X', orden: 50 },
  ];

  const categoriasPP: Record<string, string> = {};
  for (const c of catsPP) {
    const cat = await prisma.categoria.create({
      data: { convenioId: convenioPP.id, ...c },
    });
    categoriasPP[c.codigo] = cat.id;
  }
  console.log(`✅ ${catsPP.length} categorías CCT 644/12 creadas`);

  // ── Conceptos salariales CCT 644/12 ──
  const conceptosPP = [
    // REMUNERATIVOS FIJOS
    { codigo: 'BASICO_PP', nombre: 'Sueldo Básico CCT 644/12', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente por categoría', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 1 },
    { codigo: 'TURNO_A', nombre: 'Adicional Turno A (33%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turno rotativo cubriendo 24h', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 2 },
    { codigo: 'TURNO_B', nombre: 'Adicional Turno B (22%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turnos sin cubrir 24h', esPorcentual: true, porcentajeBase: 0.22, baseCalculo: 'BASICO', esRemunerativo: true, orden: 3 },
    { codigo: 'TURNO_S', nombre: 'Adicional Turno S (33%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Operaciones especiales campo', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 4 },
    { codigo: 'ZNC', nombre: 'Zona No Convencional — Vaca Muerta (85%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Adicional zona no convencional Vaca Muerta', esPorcentual: true, porcentajeBase: 0.85, baseCalculo: 'BASICO', esRemunerativo: true, orden: 5 },
    { codigo: 'ADICIONAL_YAC', nombre: 'Adicional Yacimiento (5%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Operaciones de producción en campo', esPorcentual: true, porcentajeBase: 0.05, baseCalculo: 'BASICO', esRemunerativo: true, orden: 6 },
    { codigo: 'ANTIGUEDAD_PP', nombre: 'Antigüedad (1% por año)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '1% del básico por año de antigüedad', esPorcentual: true, porcentajeBase: 0.01, baseCalculo: 'BASICO', esRemunerativo: true, orden: 7 },
    { codigo: 'PRESENTISMO_PP', nombre: 'Presentismo (6%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '6% sobre remunerativos normales y habituales', esPorcentual: true, porcentajeBase: 0.06, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: true, orden: 8 },
    { codigo: 'BONO_PAZ_PP', nombre: 'Bono Paz Social', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 9 },
    { codigo: 'ADICIONAL_DISPONIB', nombre: 'Adicional Disponibilidad', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 10 },
    // REMUNERATIVOS VARIABLES
    { codigo: 'HORAS_EXTRA_50_PP', nombre: 'Horas Extra 50%', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 1.5 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_1.5', esRemunerativo: true, orden: 20 },
    { codigo: 'HORAS_EXTRA_100_PP', nombre: 'Horas Extra 100%', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 2.0 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_2.0', esRemunerativo: true, orden: 21 },
    { codigo: 'HORAS_VIAJE_PP', nombre: 'Horas de Viaje (47%)', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 0.47 × hs (no maneja)', esPorcentual: false, baseCalculo: 'HORA_BASE_X_0.47', esRemunerativo: true, orden: 22 },
    { codigo: 'DESARRAIGO_HOTEL', nombre: 'Desarraigo — Hotel', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día — pernocte hotel', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 23 },
    { codigo: 'DESARRAIGO_TRAILER', nombre: 'Desarraigo — Trailer/Campamento', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día — pernocte trailer', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 24 },
    { codigo: 'ADICIONAL_MANEJO', nombre: 'Adicional por Manejo en Campo', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día cuando maneja en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 25 },
    // NO REMUNERATIVOS
    { codigo: 'VIANDA_PP', nombre: 'Vianda — Ayuda Alimentaria', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Art. 34 CCT 644/12, monto por día campo', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 40 },
    { codigo: 'DESAYUNO_PP', nombre: 'Desayuno / Merienda', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Monto por día', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 41 },
    { codigo: 'AVC_FIJA_PP', nombre: 'Asignación Vianda Compl. — Fija', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: '$440.000/mes total (desde mar/abr 2025)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 42 },
    { codigo: 'AVC_VAR_PP', nombre: 'Asignación Vianda Compl. — Variable', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Reintegro ganancias (Tít II: 100%, Tít III: tope)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 43 },
    // RETENCIONES
    { codigo: 'RET_JUB', nombre: 'Jubilación (11%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte jubilatorio SIJP', esPorcentual: true, porcentajeBase: 0.11, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 60 },
    { codigo: 'RET_PAMI', nombre: 'PAMI — Ley 19.032 (3%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte PAMI', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 61 },
    { codigo: 'RET_OS', nombre: 'Obra Social (3%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte obra social', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 62 },
    { codigo: 'RET_SINDICAL', nombre: 'Cuota Sindical (2%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Cuota sindical (actualizable según acta)', esPorcentual: true, porcentajeBase: 0.02, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 63 },
    { codigo: 'RET_MUTUAL', nombre: 'Mutual (~3.97%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Mutual (actualizable según acta)', esPorcentual: true, porcentajeBase: 0.0397, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 64 },
  ];

  for (const c of conceptosPP) {
    await prisma.conceptoSalarial.create({
      data: {
        convenioId: convenioPP.id,
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        descripcion: c.descripcion,
        esPorcentual: c.esPorcentual,
        porcentajeBase: c.porcentajeBase ?? null,
        baseCalculo: c.baseCalculo,
        esRemunerativo: c.esRemunerativo,
        orden: c.orden,
      },
    });
  }
  console.log(`✅ ${conceptosPP.length} conceptos CCT 644/12 creados`);

  // ═════════════════════════════════════════════════
  // 4. CCT 637/11 — PETROLEROS JERÁRQUICOS
  // ═════════════════════════════════════════════════
  const convenioPJ = await prisma.convenio.create({
    data: {
      empresaId: empresa.id,
      nombre: 'CCT 637/11 Petroleros Jerárquicos',
      tipo: CctTipo.PETROLEROS_JERARQUICOS_637,
      vigenteDesde: new Date('2011-01-01'),
    },
  });
  console.log('✅ Convenio PJ creado:', convenioPJ.nombre);

  // ── Categorías CCT 637/11 ──
  const catsPJ = [
    { codigo: 'SPJ', nombre: 'Sector Petrolero Jerárquico', orden: 1 },
  ];

  const categoriasPJ: Record<string, string> = {};
  for (const c of catsPJ) {
    const cat = await prisma.categoria.create({
      data: { convenioId: convenioPJ.id, ...c },
    });
    categoriasPJ[c.codigo] = cat.id;
  }
  console.log(`✅ ${catsPJ.length} categorías CCT 637/11 creadas`);

  // ── Conceptos salariales CCT 637/11 ──
  const conceptosPJ = [
    // REMUNERATIVOS FIJOS
    { codigo: 'BASICO_PJ', nombre: 'Sueldo Básico CCT 637/11', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT 637/11 por categoría (superior a PP)', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 1 },
    { codigo: 'TURNO_A_PJ', nombre: 'Adicional Turno A (33%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turno rotativo 24h — Jerárquicos', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 2 },
    { codigo: 'TURNO_B_PJ', nombre: 'Adicional Turno B (22%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turnos sin 24h — Jerárquicos', esPorcentual: true, porcentajeBase: 0.22, baseCalculo: 'BASICO', esRemunerativo: true, orden: 3 },
    { codigo: 'ZNC_PJ', nombre: 'Zona No Convencional (VM) — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Derivado del ZNC de PP + Art. 63 solapamiento', esPorcentual: true, porcentajeBase: 0.85, baseCalculo: 'BASICO', esRemunerativo: true, orden: 5 },
    { codigo: 'ANTIGUEDAD_PJ', nombre: 'Antigüedad (1% por año)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '1% del básico PJ por año', esPorcentual: true, porcentajeBase: 0.01, baseCalculo: 'BASICO', esRemunerativo: true, orden: 7 },
    { codigo: 'PRESENTISMO_PJ', nombre: 'Presentismo (6%)', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '6% sobre remunerativos normales', esPorcentual: true, porcentajeBase: 0.06, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: true, orden: 8 },
    { codigo: 'BONO_PAZ_PJ', nombre: 'Bono Paz Social — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 9 },
    { codigo: 'ADICIONAL_PERS_8H', nombre: 'Adicional Personal 8 Horas', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Concepto específico PJ — jornada especial 8h', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 10 },
    { codigo: 'FUN_JERARQUICA', nombre: 'Adicional Función Jerárquica', tipo: ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '% por nivel de jefatura, configurable', esPorcentual: true, porcentajeBase: 0.10, baseCalculo: 'BASICO', esRemunerativo: true, orden: 11 },
    // REMUNERATIVOS VARIABLES
    { codigo: 'HORAS_EXTRA_50_PJ', nombre: 'Horas Extra 50% — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico PJ / 192) × 1.5 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_1.5', esRemunerativo: true, orden: 20 },
    { codigo: 'HORAS_EXTRA_100_PJ', nombre: 'Horas Extra 100% — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico PJ / 192) × 2.0 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_2.0', esRemunerativo: true, orden: 21 },
    { codigo: 'DESARRAIGO_PJ', nombre: 'Desarraigo — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 23 },
    { codigo: 'BONO_CAMPO_PJ', nombre: 'Bono Campo — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Adicional cuando trabaja en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 26 },
    { codigo: 'GUARDIA_PASIVA_PJ', nombre: 'Guardia Pasiva — Jerárquicos', tipo: ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Médicos/enfermeros en yacimiento', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 27 },
    // NO REMUNERATIVOS
    { codigo: 'VIANDA_PJ', nombre: 'Vianda Campo — Jerárquicos', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Monto por día en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 40 },
    { codigo: 'AVC_FIJA_PJ', nombre: 'Asignación Vianda Compl. Fija — Jerárquicos', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: '$440.000/mes total (igual PP, desde abr 2025)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 42 },
    { codigo: 'AVC_VAR_PJ', nombre: 'Asignación Vianda Compl. Variable — Jerárquicos', tipo: ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Reintegro 50% ganancias hasta tope', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 43 },
    // RETENCIONES (misma estructura que PP)
    { codigo: 'RET_JUB_PJ', nombre: 'Jubilación (11%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte jubilatorio SIJP', esPorcentual: true, porcentajeBase: 0.11, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 60 },
    { codigo: 'RET_PAMI_PJ', nombre: 'PAMI — Ley 19.032 (3%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte PAMI', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 61 },
    { codigo: 'RET_OS_PJ', nombre: 'Obra Social (3%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Aporte obra social', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 62 },
    { codigo: 'RET_SINDICAL_PJ', nombre: 'Cuota Sindical (2%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Cuota sindical', esPorcentual: true, porcentajeBase: 0.02, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 63 },
    { codigo: 'RET_MUTUAL_PJ', nombre: 'Mutual (~3.97%)', tipo: ConceptoTipo.RETENCION, descripcion: 'Mutual', esPorcentual: true, porcentajeBase: 0.0397, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 64 },
  ];

  for (const c of conceptosPJ) {
    await prisma.conceptoSalarial.create({
      data: {
        convenioId: convenioPJ.id,
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        descripcion: c.descripcion,
        esPorcentual: c.esPorcentual,
        porcentajeBase: c.porcentajeBase ?? null,
        baseCalculo: c.baseCalculo,
        esRemunerativo: c.esRemunerativo,
        orden: c.orden,
      },
    });
  }
  console.log(`✅ ${conceptosPJ.length} conceptos CCT 637/11 creados`);

  // ─────────────────────────────────
  // 5. DIAGRAMAS DE TRABAJO
  // ─────────────────────────────────
  const diagramasData = [
    { nombre: 'Lun-Vier', tipo: DiagramaTipo.FIJO_SEMANA, diasSemana: [1, 2, 3, 4, 5], descripcion: 'Lunes a Viernes' },
    { nombre: '7×7', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 7, diasDescanso: 7, descripcion: '7 días trabajo, 7 días franco' },
    { nombre: '10×5', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 10, diasDescanso: 5, descripcion: '10 días trabajo, 5 días franco' },
    { nombre: '14×14', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 14, diasDescanso: 14, descripcion: '14 días trabajo, 14 días franco' },
    { nombre: '8×6', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 8, diasDescanso: 6, descripcion: '8 días trabajo, 6 días franco' },
    { nombre: '21×7', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 21, diasDescanso: 7, descripcion: '21 días trabajo, 7 días franco' },
    { nombre: '2×1 (8×4)', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 8, diasDescanso: 4, descripcion: 'Perforación 2×1 máx 8×4 (Acta 2024)' },
    { nombre: '14×7', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 14, diasDescanso: 7, descripcion: '14 días trabajo, 7 días franco' },
    { nombre: '10×4', tipo: DiagramaTipo.ROTATIVO, diasTrabajo: 10, diasDescanso: 4, descripcion: '10 días trabajo, 4 días franco' },
  ];

  const diagramas: Record<string, string> = {};
  for (const d of diagramasData) {
    const diagrama = await prisma.diagrama.create({
      data: {
        empresaId: empresa.id,
        nombre: d.nombre,
        tipo: d.tipo,
        diasTrabajo: d.diasTrabajo ?? null,
        diasDescanso: d.diasDescanso ?? null,
        diasSemana: d.diasSemana ?? [],
        descripcion: d.descripcion,
      },
    });
    diagramas[d.nombre] = diagrama.id;
  }
  console.log('✅ 9 diagramas creados');

  // ─────────────────────────────────
  // 6. FLUJOS DE APROBACIÓN
  // ─────────────────────────────────
  // Patrón A: 3 pasos (sectores con coordinadores: Fractura, Cabezales, Testing)
  // Patrón B: 2 pasos (supervisores sin coordinador: Logística y Transporte, CMASS)
  // Patrón C: 1 paso  (sin jerarquía operativa: Administración, Almacén, Intendencia, Wireline)

  type FlujoConfig = {
    nombre: string;
    tipoDocumento: string;
    descripcion: string;
    pasos: {
      orden: number;
      nombrePaso: string;
      rolAprobador: string;
      accionAprobar: string;
      accionRechazar: string;
      requiereComentarioRechazo: boolean;
      notificarRoles: string[];
    }[];
  };

  const accionCierreRRHH: Record<string, string> = {
    PLANILLA: 'CERRAR',
    VACACION: 'CONFIRMAR',
    AUSENCIA: 'APROBAR',
    CAMBIO_DIAGRAMA: 'AUTORIZAR',
  };

  const tipoDocLabels: Record<string, string> = {
    PLANILLA: 'Planillas',
    VACACION: 'Vacaciones',
    AUSENCIA: 'Ausencias',
    CAMBIO_DIAGRAMA: 'Cambios de Diagrama',
  };

  const flujosConfig: FlujoConfig[] = [];

  for (const tipo of ['PLANILLA', 'VACACION', 'AUSENCIA', 'CAMBIO_DIAGRAMA'] as const) {
    const label = tipoDocLabels[tipo];
    const accionRRHH = accionCierreRRHH[tipo];

    // Patrón A: 3 pasos
    flujosConfig.push({
      nombre: `${label} - Supervisor \u2192 Coordinador \u2192 RRHH`,
      tipoDocumento: tipo,
      descripcion: `Flujo 3 pasos para ${label.toLowerCase()} en sectores con coordinador`,
      pasos: [
        { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
        { orden: 2, nombrePaso: 'Aprobación Coordinador', rolAprobador: 'COORDINADOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
        { orden: 3, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH', accionAprobar: accionRRHH, accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
      ],
    });

    // Patrón B: 2 pasos
    flujosConfig.push({
      nombre: `${label} - Supervisor \u2192 RRHH`,
      tipoDocumento: tipo,
      descripcion: `Flujo 2 pasos para ${label.toLowerCase()} en sectores sin coordinador`,
      pasos: [
        { orden: 1, nombrePaso: 'Revisión Supervisor', rolAprobador: 'SUPERVISOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
        { orden: 2, nombrePaso: 'Cierre RRHH', rolAprobador: 'RRHH', accionAprobar: accionRRHH, accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
      ],
    });

    // Patrón C: 1 paso
    flujosConfig.push({
      nombre: `${label} - RRHH directo`,
      tipoDocumento: tipo,
      descripcion: `Flujo directo RRHH para ${label.toLowerCase()} en sectores administrativos`,
      pasos: [
        { orden: 1, nombrePaso: 'Aprobación RRHH', rolAprobador: 'RRHH', accionAprobar: accionRRHH, accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
      ],
    });
  }

  // Mapa para almacenar IDs de flujos: key = 'TIPO_PATRON' (e.g., 'PLANILLA_A')
  const flujos: Record<string, string> = {};

  for (const fc of flujosConfig) {
    const flujo = await prisma.flujoAprobacion.create({
      data: {
        empresaId: empresa.id,
        nombre: fc.nombre,
        tipoDocumento: fc.tipoDocumento,
        descripcion: fc.descripcion,
        pasos: { create: fc.pasos },
      },
    });

    // Determine pattern letter from name
    let patron: string;
    if (fc.nombre.includes('Coordinador')) patron = 'A';
    else if (fc.nombre.includes('Supervisor')) patron = 'B';
    else patron = 'C';
    flujos[`${fc.tipoDocumento}_${patron}`] = flujo.id;
  }
  console.log('✅ 9 flujos de aprobación creados');

  // ─────────────────────────────────
  // 7. CONFIG DE EMPRESA
  // ─────────────────────────────────
  const feriados = [...FERIADOS_ARGENTINA_2025, ...FERIADOS_ARGENTINA_2026, ...FERIADOS_PETROLEROS];

  await prisma.empresaConfig.create({
    data: {
      empresaId: empresa.id,
      feriadosPersonalizados: feriados,
    },
  });
  console.log('✅ Config de empresa creada con', feriados.length, 'feriados (incl. petroleros)');

  // ─────────────────────────────────
  // 8. CONFIG DE VACACIONES
  // ─────────────────────────────────
  await prisma.vacacionesConfig.create({
    data: {
      empresaId: empresa.id,
      reglasAntiguedad: [
        { desde_anos: 0, hasta_anos: 1, dias: 14 },
        { desde_anos: 1, hasta_anos: 5, dias: 14 },
        { desde_anos: 5, hasta_anos: 10, dias: 21 },
        { desde_anos: 10, hasta_anos: 20, dias: 28 },
        { desde_anos: 20, hasta_anos: null, dias: 35 },
      ],
    },
  });
  console.log('✅ Config de vacaciones creada');

  // ─────────────────────────────────
  // 9. USUARIOS (nómina completa)
  // ─────────────────────────────────
  const passwordHash = await hashPassword('Wenlen2026!');
  const adminPasswordHash = await hashPassword('Admin2026!');

  // Cuenta de sistema (superusuario)
  await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: null,
      nombre: 'Administrador',
      apellido: 'Sistema',
      email: 'admin@wenlen.com',
      passwordHash: adminPasswordHash,
      legajo: 'WL-SYS',
      rol: 'ADMIN',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2024-01-01'),
      convenioId: convenioPJ.id,
      categoriaId: categoriasPJ['SPJ'],
      primerLogin: true,
    },
  });
  console.log('✅ Cuenta admin del sistema creada: admin@wenlen.com');

  const sectorMap: Record<string, string> = {
    'FRACTURA': sectores['Fractura'],
    'CABEZALES': sectores['Cabezales'],
    'LOGISTICA': sectores['Logística y Transporte'],
    'MANTENIMIENTO': sectores['Logística y Transporte'],
    'CAMIONEROS': sectores['Logística y Transporte'],
    'ADMINISTRACION': sectores['Administración'],
    'ALMACEN': sectores['Almacén'],
    'INTENDENCIA': sectores['Intendencia'],
    'CMASS': sectores['CMASS'],
    'WIRELINE': sectores['Wireline'],
    'TESTING': sectores['Testing'],
  };

  // Merge all categories into a single lookup
  const allCategorias: Record<string, string> = { ...categoriasPP, ...categoriasPJ };

  let userCount = 0;
  for (const emp of EMPLEADOS) {
    const esPJ = emp.convenio === 'PJ';
    await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        sectorId: ['ADMIN', 'RRHH', 'GERENTE'].includes(emp.rol) && emp.sector === 'ADMINISTRACION'
          ? null
          : sectorMap[emp.sector] ?? null,
        nombre: emp.nombre,
        apellido: emp.apellido,
        email: emp.email,
        passwordHash,
        legajo: emp.legajo,
        rol: emp.rol,
        dni: emp.dni || null,
        telefono: emp.telefono || null,
        tipoContrato: ContratoTipo.INDEFINIDO,
        fechaIngreso: new Date(emp.fechaIngreso),
        convenioId: esPJ ? convenioPJ.id : convenioPP.id,
        categoriaId: allCategorias[emp.categoria] ?? (esPJ ? categoriasPJ['SPJ'] : categoriasPP['TII-TA-VII']),
        primerLogin: true,
      },
    });
    userCount++;
    if (userCount % 50 === 0) console.log(`  ... ${userCount} usuarios creados`);
  }
  console.log(`✅ ${userCount} usuarios creados`);

  // ─────────────────────────────────
  // 10. ASIGNACIÓN DE FLUJOS A SECTORES
  // ─────────────────────────────────
  // Patrón A (3 pasos): Fractura, Cabezales, Testing
  const sectoresPatronA = ['Fractura', 'Cabezales', 'Testing'];
  // Patrón B (2 pasos): Logística y Transporte, CMASS
  const sectoresPatronB = ['Logística y Transporte', 'CMASS'];
  // Patrón C (1 paso): Administración, Almacén, Intendencia, Wireline
  const sectoresPatronC = ['Administración', 'Almacén', 'Intendencia', 'Wireline'];

  for (const tipo of ['PLANILLA', 'VACACION', 'AUSENCIA', 'CAMBIO_DIAGRAMA'] as const) {
    for (const sectorNombre of sectoresPatronA) {
      await prisma.flujoAsignacion.create({
        data: { flujoId: flujos[`${tipo}_A`], tipoDocumento: tipo, sectorId: sectores[sectorNombre] },
      });
    }
    for (const sectorNombre of sectoresPatronB) {
      await prisma.flujoAsignacion.create({
        data: { flujoId: flujos[`${tipo}_B`], tipoDocumento: tipo, sectorId: sectores[sectorNombre] },
      });
    }
    for (const sectorNombre of sectoresPatronC) {
      await prisma.flujoAsignacion.create({
        data: { flujoId: flujos[`${tipo}_C`], tipoDocumento: tipo, sectorId: sectores[sectorNombre] },
      });
    }
  }
  console.log('✅ 36 asignaciones de flujo creadas (9 sectores × 4 tipos)');

  // ═════════════════════════════════════════════════
  // RESUMEN
  // ═════════════════════════════════════════════════
  console.log('\n🎉 Seed beta 2.0 completado exitosamente!');
  console.log('═══════════════════════════════════════════');
  console.log('  9 sectores');
  console.log('  12 flujos de aprobación (3 patrones × 4 tipos documento)');
  console.log(`  ${userCount + 1} usuarios (1 admin sistema + ${userCount} empleados)`);
  console.log('  Convenios: CCT 644/12 PP (22 cats) + CCT 637/11 PJ (1 cat SPJ)');
  console.log('  9 diagramas de trabajo');
  console.log('  ' + feriados.length + ' feriados configurados');
  console.log('───────────────────────────────────────────');
  console.log('Usuarios clave para login:');
  console.log('  admin@wenlen.com             → ADMIN (sistema) — Contraseña: Admin2026!');
  console.log('  ricardo.winkler@wenlen.com    → GERENTE (Gerente General)');
  console.log('  mariela.aguero@wenlen.com     → RRHH');
  console.log('  eliana.cejas@wenlen.com       → RRHH');
  console.log('  amalia.gonzalez@wenlen.com    → RRHH');
  console.log('  alicia.strillevsky@wenlen.com → RRHH');
  console.log('  carlos.diaz@wenlen.com        → GERENTE');
  console.log('  leopoldo.silveira@wenlen.com  → GERENTE');
  console.log('  Contraseña empleados: Wenlen2026!');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
