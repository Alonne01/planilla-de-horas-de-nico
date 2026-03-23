"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma = new client_1.PrismaClient();
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
async function hashPassword(password) {
    return bcrypt_1.default.hash(password, 12);
}
// ═══════════════════════════════════════════════════════════════
// EMPLEADOS — Nómina completa beta 1.0
// ═══════════════════════════════════════════════════════════════
const EMPLEADOS = [
    // -- FRACTURA --
    { nombre: 'Axel Alexis', apellido: 'Alegría', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0001', email: 'axel.alegria@wenlen.com' },
    { nombre: 'Diego Alfonso', apellido: 'Almonacid', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0002', email: 'diego.almonacid@wenlen.com' },
    { nombre: 'Germán Alejandro', apellido: 'Altamirano', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0003', email: 'german.altamirano@wenlen.com' },
    { nombre: 'Sergio Andrés', apellido: 'Álvarez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0004', email: 'sergio.alvarez@wenlen.com' },
    { nombre: 'Luis Marcelo', apellido: 'Anabalón', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0005', email: 'luis.anabalon@wenlen.com' },
    { nombre: 'Nicolás Víctor', apellido: 'Anobile', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0006', email: 'nicolas.anobile@wenlen.com' },
    { nombre: 'Diego Sebastián', apellido: 'Aramendi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0007', email: 'diego.aramendi@wenlen.com' },
    { nombre: 'Roberto Horacio', apellido: 'Aravena', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0008', email: 'roberto.aravena@wenlen.com' },
    { nombre: 'Rubén Antonio', apellido: 'Arcieri', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0009', email: 'ruben.arcieri@wenlen.com' },
    { nombre: 'Sergio Alejandro', apellido: 'Ariza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0010', email: 'sergio.ariza@wenlen.com' },
    { nombre: 'Tomás Alejandro', apellido: 'Aroca Fernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0011', email: 'tomas.aroca@wenlen.com' },
    { nombre: 'Matías Ezequiel', apellido: 'Ava Bonnot', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0012', email: 'matias.ava@wenlen.com' },
    { nombre: 'Roberto Fabián', apellido: 'Balmaceda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0013', email: 'roberto.balmaceda@wenlen.com' },
    { nombre: 'Gonzalo Tomás Jesús', apellido: 'Bañak', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0014', email: 'gonzalo.banak@wenlen.com' },
    { nombre: 'Juan Pablo', apellido: 'Bastida', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0015', email: 'juan.bastida@wenlen.com' },
    { nombre: 'Milton Edgardo', apellido: 'Berra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0016', email: 'milton.berra@wenlen.com' },
    { nombre: 'Maximiliano Joaquín', apellido: 'Biagini', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0017', email: 'maximiliano.biagini@wenlen.com' },
    { nombre: 'Facundo Nicolás', apellido: 'Blanco', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0018', email: 'facundo.blanco@wenlen.com' },
    { nombre: 'Javier Alfredo', apellido: 'Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0019', email: 'javier.bravo@wenlen.com' },
    { nombre: 'Juan Darío', apellido: 'Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0020', email: 'juan.bravo@wenlen.com' },
    { nombre: 'Pablo Enrique', apellido: 'Bustos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0021', email: 'pablo.bustos@wenlen.com' },
    { nombre: 'Fernando Raúl', apellido: 'Caballero', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0022', email: 'fernando.caballero@wenlen.com' },
    { nombre: 'Roberto Carlos', apellido: 'Caberlotti Bravo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0023', email: 'roberto.caberlotti@wenlen.com' },
    { nombre: 'Javier Alejandro', apellido: 'Cáceres', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0024', email: 'javier.caceres@wenlen.com' },
    { nombre: 'Néstor Fabián', apellido: 'Campos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0025', email: 'nestor.campos@wenlen.com' },
    { nombre: 'Leonardo Gastón', apellido: 'Carrizo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0026', email: 'leonardo.carrizo@wenlen.com' },
    { nombre: 'Braian Emmanuel', apellido: 'Carroza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0027', email: 'braian.carroza@wenlen.com' },
    { nombre: 'Lucas Nami', apellido: 'Carvajal', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0028', email: 'lucas.carvajal@wenlen.com' },
    { nombre: 'Geraldine Alejandra', apellido: 'Castillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0029', email: 'geraldine.castillo@wenlen.com' },
    { nombre: 'Luciano Nicolás', apellido: 'Castro', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0030', email: 'luciano.castro@wenlen.com' },
    { nombre: 'Rafael Horacio', apellido: 'Cerdán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0031', email: 'rafael.cerdan@wenlen.com' },
    { nombre: 'Alejandro Nicolás', apellido: 'Chávez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0032', email: 'alejandro.chavez@wenlen.com' },
    { nombre: 'Miguel Ángel', apellido: 'Cofré', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0033', email: 'miguel.cofre@wenlen.com' },
    { nombre: 'Gerardo Andrés', apellido: 'Contreras Cares', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0034', email: 'gerardo.contreras@wenlen.com' },
    { nombre: 'Esteban Maximiliano', apellido: 'Cortez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0035', email: 'esteban.cortez@wenlen.com' },
    { nombre: 'Manuel Gustavo', apellido: 'Cortez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0036', email: 'manuel.cortez@wenlen.com' },
    { nombre: 'Sebastián Daniel', apellido: 'Díaz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0037', email: 'sebastian.diaz@wenlen.com' },
    { nombre: 'Braian Nicolás', apellido: 'Enrique', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0038', email: 'braian.enrique@wenlen.com' },
    { nombre: 'Matías Nicolás', apellido: 'Félix', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0039', email: 'matias.felix@wenlen.com' },
    { nombre: 'David Ezequiel', apellido: 'Fernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0040', email: 'david.fernandez@wenlen.com' },
    { nombre: 'Lucas Mario', apellido: 'Figueroa', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0041', email: 'lucas.figueroa@wenlen.com' },
    { nombre: 'Sebastián Omar', apellido: 'Forquera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0042', email: 'sebastian.forquera@wenlen.com' },
    { nombre: 'Sergio Oscar', apellido: 'Fuster', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0043', email: 'sergio.fuster@wenlen.com' },
    { nombre: 'Silvio Leonardo', apellido: 'Gallo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0044', email: 'silvio.gallo@wenlen.com' },
    { nombre: 'José Nicolás', apellido: 'García', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0045', email: 'jose.garcia@wenlen.com' },
    { nombre: 'Rodrigo Ariel', apellido: 'Gimenez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0046', email: 'rodrigo.gimenez@wenlen.com' },
    { nombre: 'Cristhian Daniel', apellido: 'González', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0047', email: 'cristhian.gonzalez@wenlen.com' },
    { nombre: 'Miguel Ángel', apellido: 'Guzmán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0048', email: 'miguel.guzman@wenlen.com' },
    { nombre: 'Gastón Alejandro', apellido: 'Halicki', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0049', email: 'gaston.halicki@wenlen.com' },
    { nombre: 'Julio César', apellido: 'Halicki', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0050', email: 'julio.halicki@wenlen.com' },
    { nombre: 'Cristian Agustín', apellido: 'Hermosilla', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0051', email: 'cristian.hermosilla@wenlen.com' },
    { nombre: 'Martín Facundo', apellido: 'Hernández', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0052', email: 'martin.hernandez@wenlen.com' },
    { nombre: 'Juan Francisco', apellido: 'Huenuhueque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0053', email: 'juan.huenuhueque@wenlen.com' },
    { nombre: 'Tomás Ezequiel', apellido: 'Inostroza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0054', email: 'tomas.inostroza@wenlen.com' },
    { nombre: 'Alfredo Renzo', apellido: 'Jordán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0055', email: 'alfredo.jordan@wenlen.com' },
    { nombre: 'Lautaro Ángel', apellido: 'Lambrecht', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0056', email: 'lautaro.lambrecht@wenlen.com' },
    { nombre: 'Facundo Emmanuel', apellido: 'Larena', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0057', email: 'facundo.larena@wenlen.com' },
    { nombre: 'Claudio Nicolás', apellido: 'Lillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0058', email: 'claudio.lillo@wenlen.com' },
    { nombre: 'Martín Iván', apellido: 'Lillo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0059', email: 'martin.lillo@wenlen.com' },
    { nombre: 'Ariel Orlando', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0060', email: 'ariel.lopez@wenlen.com' },
    { nombre: 'Juan Carlos', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0061', email: 'juan.lopez@wenlen.com' },
    { nombre: 'Matías Alejandro', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0062', email: 'matias.lopez@wenlen.com' },
    { nombre: 'Osama Amín', apellido: 'Luján', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0063', email: 'osama.lujan@wenlen.com' },
    { nombre: 'Néstor Fabián', apellido: 'Maidana', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0064', email: 'nestor.maidana@wenlen.com' },
    { nombre: 'Kevin Matías', apellido: 'Maissani', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0065', email: 'kevin.maissani@wenlen.com' },
    { nombre: 'Marcos David', apellido: 'Manca', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0066', email: 'marcos.manca@wenlen.com' },
    { nombre: 'Jonatan Emanuel', apellido: 'Mardonez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0067', email: 'jonatan.mardonez@wenlen.com' },
    { nombre: 'Pablo Ariel', apellido: 'Marifil', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0068', email: 'pablo.marifil@wenlen.com' },
    { nombre: 'Facundo Nayit', apellido: 'Méndez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0069', email: 'facundo.mendez@wenlen.com' },
    { nombre: 'Luis Marcelo', apellido: 'Méndez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0070', email: 'luis.mendez@wenlen.com' },
    { nombre: 'Joaquín Fernando', apellido: 'Meza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0071', email: 'joaquin.meza@wenlen.com' },
    { nombre: 'Carlos Alberto', apellido: 'Miranda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0072', email: 'carlos.miranda@wenlen.com' },
    { nombre: 'Diego Eduardo', apellido: 'Miranda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0073', email: 'diego.miranda@wenlen.com' },
    { nombre: 'Carlos Darío', apellido: 'Mora', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0074', email: 'carlos.mora@wenlen.com' },
    { nombre: 'Luca Julián', apellido: 'Morales', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0075', email: 'luca.morales@wenlen.com' },
    { nombre: 'Héctor David', apellido: 'Moreno', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0076', email: 'hector.moreno@wenlen.com' },
    { nombre: 'Emiliano Marcos Miguel', apellido: 'Muñoz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0077', email: 'emiliano.munoz@wenlen.com' },
    { nombre: 'Neri Iván', apellido: 'Muñoz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0078', email: 'neri.munoz@wenlen.com' },
    { nombre: 'Jorge Iván', apellido: 'Neyroud', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0079', email: 'jorge.neyroud@wenlen.com' },
    { nombre: 'Iván Facundo', apellido: 'Obreque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0080', email: 'ivan.obreque@wenlen.com' },
    { nombre: 'Emmanuel Sebastián', apellido: 'Ojeda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0081', email: 'emmanuel.ojeda@wenlen.com' },
    { nombre: 'Gastón Elías', apellido: 'Oroeta', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0082', email: 'gaston.oroeta@wenlen.com' },
    { nombre: 'Héctor Alejandro', apellido: 'Ortíz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0083', email: 'hector.ortiz@wenlen.com' },
    { nombre: 'Martín', apellido: 'Pailaleo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0084', email: 'martin.pailaleo@wenlen.com' },
    { nombre: 'Marcelo Matías', apellido: 'Palavecino', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0085', email: 'marcelo.palavecino@wenlen.com' },
    { nombre: 'César Andrés', apellido: 'Parada', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0086', email: 'cesar.parada@wenlen.com' },
    { nombre: 'Emilio Ariel', apellido: 'Pardo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0087', email: 'emilio.pardo@wenlen.com' },
    { nombre: 'Denis Ramiro', apellido: 'Paredes', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0088', email: 'denis.paredes@wenlen.com' },
    { nombre: 'Tomás Agustín', apellido: 'Pautasso', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0089', email: 'tomas.pautasso@wenlen.com' },
    { nombre: 'Omar Maximiliano', apellido: 'Pereyra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0090', email: 'omar.pereyra@wenlen.com' },
    { nombre: 'Mario Arnoldo', apellido: 'Perloz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0091', email: 'mario.perloz@wenlen.com' },
    { nombre: 'Gabriel Alberto', apellido: 'Pilato González', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0092', email: 'gabriel.pilato@wenlen.com' },
    { nombre: 'Mariano Serafín', apellido: 'Pino', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0093', email: 'mariano.pino@wenlen.com' },
    { nombre: 'Carlos Andrés', apellido: 'Pituch', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0094', email: 'carlos.pituch@wenlen.com' },
    { nombre: 'Yoel', apellido: 'Querci Giménez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0095', email: 'yoel.querci@wenlen.com' },
    { nombre: 'Daniel Ezequiel', apellido: 'Quintulaf', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0096', email: 'daniel.quintulaf@wenlen.com' },
    { nombre: 'Antonio Tomás', apellido: 'Ramírez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0097', email: 'antonio.ramirez@wenlen.com' },
    { nombre: 'Emiliano Martín', apellido: 'Ramos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0098', email: 'emiliano.ramos@wenlen.com' },
    { nombre: 'Emanuelle Rodrigo', apellido: 'Rascovich', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0099', email: 'emanuelle.rascovich@wenlen.com' },
    { nombre: 'Víctor Hugo', apellido: 'Rebolledo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0100', email: 'victor.rebolledo@wenlen.com' },
    { nombre: 'Nicolás Nahuel', apellido: 'Retamal', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0101', email: 'nicolas.retamal@wenlen.com' },
    { nombre: 'Juan Domingo', apellido: 'Reuque', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0102', email: 'juan.reuque@wenlen.com' },
    { nombre: 'Martín Nicolás', apellido: 'Reyes', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0103', email: 'martin.reyes@wenlen.com' },
    { nombre: 'Ramiro Walter Hugo', apellido: 'Rinaldi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0104', email: 'ramiro.rinaldi@wenlen.com' },
    { nombre: 'Raúl Osmar', apellido: 'Ríos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0105', email: 'raul.rios@wenlen.com' },
    { nombre: 'Walter Martín', apellido: 'Rivera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0106', email: 'walter.rivera@wenlen.com' },
    { nombre: 'Emiliano Nicolás', apellido: 'Rocha', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0107', email: 'emiliano.rocha@wenlen.com' },
    { nombre: 'Marcelo Nicolás', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0108', email: 'marcelo.rodriguez@wenlen.com' },
    { nombre: 'Mario Alberto', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0109', email: 'mario.rodriguez@wenlen.com' },
    { nombre: 'Ricardo Javier', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0110', email: 'ricardo.rodriguez@wenlen.com' },
    { nombre: 'Cristian Eladio', apellido: 'Rojas', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0111', email: 'cristian.rojas@wenlen.com' },
    { nombre: 'Tomás Joaquín', apellido: 'Romeo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0112', email: 'tomas.romeo@wenlen.com' },
    { nombre: 'Gustavo Germán', apellido: 'Romero', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0113', email: 'gustavo.romero@wenlen.com' },
    { nombre: 'Jesús Juan Martín', apellido: 'Ruiz', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0114', email: 'jesus.ruiz@wenlen.com' },
    { nombre: 'Jonatan Santiago', apellido: 'Sáez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0115', email: 'jonatan.saez@wenlen.com' },
    { nombre: 'Bernabé Antonio', apellido: 'Sajama', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0116', email: 'bernabe.sajama@wenlen.com' },
    { nombre: 'Sergio Eduardo', apellido: 'Salamanca', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0117', email: 'sergio.salamanca@wenlen.com' },
    { nombre: 'Alexis Emanuel', apellido: 'Salazar', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0118', email: 'alexis.salazar@wenlen.com' },
    { nombre: 'Hugo Martín Francisco', apellido: 'Sánchez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0119', email: 'hugo.sanchez@wenlen.com' },
    { nombre: 'Franco Martín', apellido: 'Schofer', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0120', email: 'franco.schofer@wenlen.com' },
    { nombre: 'Lucas Gabriel', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0121', email: 'lucas.sepulveda@wenlen.com' },
    { nombre: 'Marcelo Alfonso', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0122', email: 'marcelo.sepulveda@wenlen.com' },
    { nombre: 'Maximilano Gabriel', apellido: 'Sepúlveda', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0123', email: 'maximilano.sepulveda@wenlen.com' },
    { nombre: 'Matías Ismael', apellido: 'Sierra', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0124', email: 'matias.sierra@wenlen.com' },
    { nombre: 'Franco Delvis', apellido: 'Silva', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0125', email: 'franco.silva@wenlen.com' },
    { nombre: 'Jonathan Maximiliano', apellido: 'Simon Pitripan', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0126', email: 'jonathan.simon@wenlen.com' },
    { nombre: 'Santiago Agustín', apellido: 'Soria', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0127', email: 'santiago.soria@wenlen.com' },
    { nombre: 'Enzo Elías', apellido: 'Soto', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0128', email: 'enzo.soto@wenlen.com' },
    { nombre: 'Juan Ignacio', apellido: 'Spanu', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0129', email: 'juan.spanu@wenlen.com' },
    { nombre: 'Sergio Rolando', apellido: 'Strevensky', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0130', email: 'sergio.strevensky@wenlen.com' },
    { nombre: 'Alejandro David', apellido: 'Stubbia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0131', email: 'alejandro.stubbia@wenlen.com' },
    { nombre: 'Luis Martín', apellido: 'Tapia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0132', email: 'luis.tapia@wenlen.com' },
    { nombre: 'Juan Pedro', apellido: 'Tear', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0133', email: 'juan.tear@wenlen.com' },
    { nombre: 'Nicolás Agustín', apellido: 'Tkaczek', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0134', email: 'nicolas.tkaczek@wenlen.com' },
    { nombre: 'Nicolás Alexander', apellido: 'Troncoso', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0135', email: 'nicolas.troncoso@wenlen.com' },
    { nombre: 'Sergio Maximiliano', apellido: 'Trussi', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0136', email: 'sergio.trussi@wenlen.com' },
    { nombre: 'Agustín Julián', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0137', email: 'agustin.urrutia@wenlen.com' },
    { nombre: 'Francisco Cristian', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0138', email: 'francisco.urrutia@wenlen.com' },
    { nombre: 'Matías Luis', apellido: 'Valenzuela', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0139', email: 'matias.valenzuela@wenlen.com' },
    { nombre: 'Joaquín Ariel', apellido: 'Vallejos', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0140', email: 'joaquin.vallejos@wenlen.com' },
    { nombre: 'Héctor Mariano', apellido: 'Vargas', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0141', email: 'hector.vargas@wenlen.com' },
    { nombre: 'Ángel Franco', apellido: 'Vázquez', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0142', email: 'angel.vazquez@wenlen.com' },
    { nombre: 'Benjamín Sebastián', apellido: 'Vera', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0143', email: 'benjamin.vera@wenlen.com' },
    { nombre: 'José Octavio', apellido: 'Vergara', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0144', email: 'jose.vergara@wenlen.com' },
    { nombre: 'Matías Delmar', apellido: 'Vigna', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0145', email: 'matias.vigna@wenlen.com' },
    { nombre: 'Lautaro Nicolás', apellido: 'Vivanco', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0146', email: 'lautaro.vivanco@wenlen.com' },
    { nombre: 'Maximiliano', apellido: 'Ybañez Pastene', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0147', email: 'maximiliano.ybanez@wenlen.com' },
    { nombre: 'Sebastián Miguel', apellido: 'Zuñiga', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0148', email: 'sebastian.zuniga@wenlen.com' },
    { nombre: 'Cristian Rubén', apellido: 'Alegría', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0149', email: 'cristian.alegria@wenlen.com' },
    { nombre: 'Germán Nicolás', apellido: 'Banek', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0150', email: 'german.banek@wenlen.com' },
    { nombre: 'Gabriel Raúl', apellido: 'Besada', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0151', email: 'gabriel.besada@wenlen.com' },
    { nombre: 'Antonio', apellido: 'Campos Giusti', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0152', email: 'antonio.campos@wenlen.com' },
    { nombre: 'Alexis Evans', apellido: 'Carrizo', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0153', email: 'alexis.carrizo@wenlen.com' },
    { nombre: 'Damián Alejandro', apellido: 'Guayrán', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0154', email: 'damian.guayran@wenlen.com' },
    { nombre: 'Gastón Micael', apellido: 'Hirschfeldt', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0155', email: 'gaston.hirschfeldt@wenlen.com' },
    { nombre: 'Maximiliano Alejandro', apellido: 'Hurstel', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0156', email: 'maximiliano.hurstel@wenlen.com' },
    { nombre: 'Pablo Damián', apellido: 'Jara', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0157', email: 'pablo.jara@wenlen.com' },
    { nombre: 'Guillermo Mauricio', apellido: 'López', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0158', email: 'guillermo.lopez@wenlen.com' },
    { nombre: 'Federico Alberto', apellido: 'Maranghello', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0159', email: 'federico.maranghello@wenlen.com' },
    { nombre: 'Juan Martín', apellido: 'Melchior', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0160', email: 'juan.melchior@wenlen.com' },
    { nombre: 'Nicolás Manuel', apellido: 'Perello', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0161', email: 'nicolas.perello@wenlen.com' },
    { nombre: 'Julián Martín', apellido: 'Pérez Ibargoyen', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0162', email: 'julian.perez@wenlen.com' },
    { nombre: 'Juan Pablo David', apellido: 'Quiroga', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0163', email: 'juan.quiroga@wenlen.com' },
    { nombre: 'Héctor Fabio', apellido: 'Ravagnani', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0164', email: 'hector.ravagnani@wenlen.com' },
    { nombre: 'Guillermo Nicolás', apellido: 'Sanhueza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0165', email: 'guillermo.sanhueza@wenlen.com' },
    { nombre: 'Matías Sebastián', apellido: 'Santoro', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0166', email: 'matias.santoro@wenlen.com' },
    { nombre: 'Kevin Ezequiel', apellido: 'Solorza', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0167', email: 'kevin.solorza@wenlen.com' },
    { nombre: 'Ricardo Andrés', apellido: 'Urrutia', sector: 'FRACTURA', rol: 'OPERADOR', legajo: 'WL-0168', email: 'ricardo.urrutia@wenlen.com' },
    { nombre: 'Carlos Marcelo Gabriel', apellido: 'Castañeira', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0169', email: 'carlos.castaneira@wenlen.com' },
    { nombre: 'Andrés', apellido: 'Centeno', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0170', email: 'andres.centeno@wenlen.com' },
    { nombre: 'Emanuel Gonzalo', apellido: 'Cuevas', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0171', email: 'emanuel.cuevas@wenlen.com' },
    { nombre: 'Ramiro Matías', apellido: 'Díaz Soto', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0172', email: 'ramiro.diaz@wenlen.com' },
    { nombre: 'Héctor Ariel', apellido: 'Ferraris', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0173', email: 'hector.ferraris@wenlen.com' },
    { nombre: 'César Walter Ariel', apellido: 'Figueroa', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0174', email: 'cesar.figueroa@wenlen.com' },
    { nombre: 'Miguel Ángel', apellido: 'Forchino', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0175', email: 'miguel.forchino@wenlen.com' },
    { nombre: 'Uriel Osvaldo', apellido: 'Haedo', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0176', email: 'uriel.haedo@wenlen.com' },
    { nombre: 'Juan Marcelo', apellido: 'Infante Inostroza', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0177', email: 'juan.infante@wenlen.com' },
    { nombre: 'Pablo David', apellido: 'Jara', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0178', email: 'pablo.jara2@wenlen.com' },
    { nombre: 'Mariano Sebastián', apellido: 'Kloberdanz', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0179', email: 'mariano.kloberdanz@wenlen.com' },
    { nombre: 'Martín Carlos Alberto', apellido: 'Luna', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0180', email: 'martin.luna@wenlen.com' },
    { nombre: 'Luciano Miguel', apellido: 'Quinchao', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0181', email: 'luciano.quinchao@wenlen.com' },
    { nombre: 'Nicolás Catriel', apellido: 'Sander', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0182', email: 'nicolas.sander@wenlen.com' },
    { nombre: 'Gastón Alejandro', apellido: 'Sieben', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0183', email: 'gaston.sieben@wenlen.com' },
    { nombre: 'Carlos Daniel', apellido: 'Tripainao', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0184', email: 'carlos.tripainao@wenlen.com' },
    { nombre: 'Javier Andrés', apellido: 'Vargas', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0185', email: 'javier.vargas@wenlen.com' },
    { nombre: 'Marcos Anselmo', apellido: 'Waiman', sector: 'FRACTURA', rol: 'SUPERVISOR', legajo: 'WL-0186', email: 'marcos.waiman@wenlen.com' },
    { nombre: 'José Norberto', apellido: 'Cirica', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: 'WL-0187', email: 'jose.cirica@wenlen.com' },
    { nombre: 'Luis Alberto', apellido: 'Flores', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: 'WL-0188', email: 'luis.flores@wenlen.com' },
    { nombre: 'Rodrigo Iván', apellido: 'Pailaleo', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: 'WL-0189', email: 'rodrigo.pailaleo@wenlen.com' },
    { nombre: 'Diego Nicolás', apellido: 'Rodríguez', sector: 'FRACTURA', rol: 'COORDINADOR', legajo: 'WL-0190', email: 'diego.rodriguez@wenlen.com' },
    // -- CABEZALES --
    { nombre: 'Claudio José Gabriel', apellido: 'Achares', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0191', email: 'claudio.achares@wenlen.com' },
    { nombre: 'Omar Luis', apellido: 'Aguirre', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0192', email: 'omar.aguirre@wenlen.com' },
    { nombre: 'Mariano Andrés', apellido: 'Albornoz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0193', email: 'mariano.albornoz@wenlen.com' },
    { nombre: 'Hernán Martín', apellido: 'Arranz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0194', email: 'hernan.arranz@wenlen.com' },
    { nombre: 'Eduardo Fabián', apellido: 'Atencio', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0195', email: 'eduardo.atencio@wenlen.com' },
    { nombre: 'Lucas Javier', apellido: 'Avilés', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0196', email: 'lucas.aviles@wenlen.com' },
    { nombre: 'Elías Israel', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0197', email: 'elias.barros@wenlen.com' },
    { nombre: 'Jonatan Gabriel', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0198', email: 'jonatan.barros@wenlen.com' },
    { nombre: 'Pablo Andrés', apellido: 'Barros', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0199', email: 'pablo.barros@wenlen.com' },
    { nombre: 'Milena', apellido: 'Borja', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0200', email: 'milena.borja@wenlen.com' },
    { nombre: 'Héctor Fabián', apellido: 'Cárcamo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0201', email: 'hector.carcamo@wenlen.com' },
    { nombre: 'David Ezequiel', apellido: 'Cerda', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0202', email: 'david.cerda@wenlen.com' },
    { nombre: 'Richard Omar', apellido: 'Cid Sandoval', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0203', email: 'richard.cid@wenlen.com' },
    { nombre: 'Mario Ricardo', apellido: 'Cilleruelo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0204', email: 'mario.cilleruelo@wenlen.com' },
    { nombre: 'Gonzalo Julián', apellido: 'Escobar De La Vega', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0205', email: 'gonzalo.escobar@wenlen.com' },
    { nombre: 'Miguel Ángel', apellido: 'Falcón', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0206', email: 'miguel.falcon@wenlen.com' },
    { nombre: 'Pablo César', apellido: 'Fuentes', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0207', email: 'pablo.fuentes@wenlen.com' },
    { nombre: 'Edgardo Guillermo', apellido: 'García', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0208', email: 'edgardo.garcia@wenlen.com' },
    { nombre: 'Matías Nicolás', apellido: 'García', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0209', email: 'matias.garcia@wenlen.com' },
    { nombre: 'Jorge Luis', apellido: 'Gazzola', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0210', email: 'jorge.gazzola@wenlen.com' },
    { nombre: 'Jorge Leonardo', apellido: 'González', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0211', email: 'jorge.gonzalez@wenlen.com' },
    { nombre: 'Andrés Fabián', apellido: 'Huilipan Vergara', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0212', email: 'andres.huilipan@wenlen.com' },
    { nombre: 'Claudio Alejandro', apellido: 'Maldonado', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0213', email: 'claudio.maldonado@wenlen.com' },
    { nombre: 'Luis Alejandro', apellido: 'Medel Chávez', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0214', email: 'luis.medel@wenlen.com' },
    { nombre: 'Néstor Facundo', apellido: 'Millaqueo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0215', email: 'nestor.millaqueo@wenlen.com' },
    { nombre: 'Carlos Fabián', apellido: 'Morales Aroca', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0216', email: 'carlos.morales@wenlen.com' },
    { nombre: 'Ramiro Ulises', apellido: 'Moreno Wantnud', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0217', email: 'ramiro.moreno@wenlen.com' },
    { nombre: 'Roberto Daniel', apellido: 'Muñoz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0218', email: 'roberto.munoz@wenlen.com' },
    { nombre: 'Matías Ezequiel', apellido: 'Ormea', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0219', email: 'matias.ormea@wenlen.com' },
    { nombre: 'Darío Armando Nahuel', apellido: 'Ortíz', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0220', email: 'dario.ortiz@wenlen.com' },
    { nombre: 'Aldo', apellido: 'Paillalef', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0221', email: 'aldo.paillalef@wenlen.com' },
    { nombre: 'Lucas Nahuel', apellido: 'Pareja Baeza', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0222', email: 'lucas.pareja@wenlen.com' },
    { nombre: 'Rubén Isaí', apellido: 'Parra', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0223', email: 'ruben.parra@wenlen.com' },
    { nombre: 'José Domingo', apellido: 'Pino', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0224', email: 'jose.pino@wenlen.com' },
    { nombre: 'Gustavo Javier', apellido: 'Ponce', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0225', email: 'gustavo.ponce@wenlen.com' },
    { nombre: 'Carlos Alberto', apellido: 'Ríos', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0226', email: 'carlos.rios@wenlen.com' },
    { nombre: 'Gastón Rodrigo', apellido: 'Rivera', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0227', email: 'gaston.rivera@wenlen.com' },
    { nombre: 'Cristian Alejandro', apellido: 'Román', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0228', email: 'cristian.roman@wenlen.com' },
    { nombre: 'Jorge Mauricio', apellido: 'Rosales', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0229', email: 'jorge.rosales@wenlen.com' },
    { nombre: 'Sebastián Alejandro', apellido: 'Ruilova', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0230', email: 'sebastian.ruilova@wenlen.com' },
    { nombre: 'Lucas Emanuel', apellido: 'Russo', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0231', email: 'lucas.russo@wenlen.com' },
    { nombre: 'Carlos', apellido: 'Syme', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0232', email: 'carlos.syme@wenlen.com' },
    { nombre: 'Rodolfo Ricardo Luis', apellido: 'Uribe', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0233', email: 'rodolfo.uribe@wenlen.com' },
    { nombre: 'Walter Alexander', apellido: 'Uribe', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0234', email: 'walter.uribe@wenlen.com' },
    { nombre: 'Sergio Maximiliano', apellido: 'Vásquez', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0235', email: 'sergio.vasquez@wenlen.com' },
    { nombre: 'Emanuel Alejandro', apellido: 'Vera', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0236', email: 'emanuel.vera@wenlen.com' },
    { nombre: 'Gabriel Orlando', apellido: 'Vergara', sector: 'CABEZALES', rol: 'OPERADOR', legajo: 'WL-0237', email: 'gabriel.vergara@wenlen.com' },
    { nombre: 'Daniel Nicolás', apellido: 'Ávila', sector: 'CABEZALES', rol: 'COORDINADOR', legajo: 'WL-0238', email: 'daniel.avila@wenlen.com' },
    { nombre: 'Rodrigo Andrés', apellido: 'Cerda', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: 'WL-0239', email: 'rodrigo.cerda@wenlen.com' },
    { nombre: 'Abelardo Aurelio', apellido: 'Kloberdanz', sector: 'CABEZALES', rol: 'COORDINADOR', legajo: 'WL-0240', email: 'abelardo.kloberdanz@wenlen.com' },
    { nombre: 'Fernando Edison', apellido: 'Martínez Peña', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: 'WL-0241', email: 'fernando.martinez@wenlen.com' },
    { nombre: 'Cristian Rubén', apellido: 'Merino', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: 'WL-0242', email: 'cristian.merino@wenlen.com' },
    { nombre: 'Daniel Gaspar', apellido: 'Romero', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: 'WL-0243', email: 'daniel.romero@wenlen.com' },
    { nombre: 'Danilo Alexis', apellido: 'Vergara Mena', sector: 'CABEZALES', rol: 'SUPERVISOR', legajo: 'WL-0244', email: 'danilo.vergara@wenlen.com' },
    // -- LOGISTICA --
    { nombre: 'Santiago Mario', apellido: 'Aguilar', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0245', email: 'santiago.aguilar@wenlen.com' },
    { nombre: 'Víctor Alexis', apellido: 'Acevedo', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0246', email: 'victor.acevedo@wenlen.com' },
    { nombre: 'Emiliano Gastón', apellido: 'Araoz González', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0247', email: 'emiliano.araoz@wenlen.com' },
    { nombre: 'Rubén Darío', apellido: 'Azúa', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0248', email: 'ruben.azua@wenlen.com' },
    { nombre: 'Gerardo Darián', apellido: 'Cau', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0249', email: 'gerardo.cau@wenlen.com' },
    { nombre: 'Roberto Pablo', apellido: 'Luqui', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0250', email: 'roberto.luqui@wenlen.com' },
    { nombre: 'Leonardo Jonatan', apellido: 'Maulén', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0251', email: 'leonardo.maulen@wenlen.com' },
    { nombre: 'Segundo Rolando', apellido: 'Melian', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0252', email: 'segundo.melian@wenlen.com' },
    { nombre: 'Mauro Raúl Ceferino', apellido: 'Montero', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0253', email: 'mauro.montero@wenlen.com' },
    { nombre: 'Walter Ariel', apellido: 'Pacheco', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0254', email: 'walter.pacheco@wenlen.com' },
    { nombre: 'Mauricio Aníbal', apellido: 'Beltrame', sector: 'LOGISTICA', rol: 'COORDINADOR', legajo: 'WL-0255', email: 'mauricio.beltrame@wenlen.com' },
    { nombre: 'Nicolás Rafael', apellido: 'Figueroa', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: 'WL-0256', email: 'nicolas.figueroa@wenlen.com' },
    { nombre: 'Nicolás', apellido: 'Palma Mc Kidd', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: 'WL-0257', email: 'nicolas.palma@wenlen.com' },
    { nombre: 'Darío Rubén', apellido: 'Pascucci', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: 'WL-0258', email: 'dario.pascucci@wenlen.com' },
    { nombre: 'Sergio Alejandro', apellido: 'Rivera', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: 'WL-0259', email: 'sergio.rivera@wenlen.com' },
    { nombre: 'Marcelo Andrés', apellido: 'Saiz', sector: 'LOGISTICA', rol: 'SUPERVISOR', legajo: 'WL-0260', email: 'marcelo.saiz@wenlen.com' },
    { nombre: 'Martin', apellido: 'Beltrame', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0261', email: 'martin.beltrame@wenlen.com' },
    { nombre: 'Diego Nicolás', apellido: 'Vanzella', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0262', email: 'diego.vanzella@wenlen.com' },
    { nombre: 'Maximiliano Oscar', apellido: 'Wimberger', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0263', email: 'maximiliano.wimberger@wenlen.com' },
    { nombre: 'Diego Pablo', apellido: 'Castro', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0264', email: 'diego.castro@wenlen.com' },
    { nombre: 'Fernando Ezequiel', apellido: 'Espriu Ávila', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0265', email: 'fernando.espriu@wenlen.com' },
    { nombre: 'Juan Cruz', apellido: 'Ferrucci', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0266', email: 'juan.ferrucci@wenlen.com' },
    { nombre: 'Nery Osmar', apellido: 'Gerez', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0267', email: 'nery.gerez@wenlen.com' },
    { nombre: 'Denise Gabriel', apellido: 'Girardi', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0268', email: 'denise.girardi@wenlen.com' },
    { nombre: 'Sergio Oscar', apellido: 'Guardia', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0269', email: 'sergio.guardia@wenlen.com' },
    { nombre: 'Sergio Fabián', apellido: 'Lara', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0270', email: 'sergio.lara@wenlen.com' },
    { nombre: 'Juan Osvaldo', apellido: 'Maulén', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0271', email: 'juan.maulen@wenlen.com' },
    { nombre: 'Juan Julián', apellido: 'Morales', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0272', email: 'juan.morales@wenlen.com' },
    { nombre: 'David Emiliano', apellido: 'Obreque', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0273', email: 'david.obreque@wenlen.com' },
    { nombre: 'Leandro Andrés', apellido: 'Ojeda Torres', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0274', email: 'leandro.ojeda@wenlen.com' },
    { nombre: 'Gregorio Nicolás', apellido: 'Sánchez Díaz', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0275', email: 'gregorio.sanchez@wenlen.com' },
    { nombre: 'Maximiliano Hernán', apellido: 'Urrutia', sector: 'LOGISTICA', rol: 'OPERADOR', legajo: 'WL-0276', email: 'maximiliano.urrutia@wenlen.com' },
    // -- ADMINISTRACION --
    { nombre: 'Mariela Luciana', apellido: 'Agüero', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: 'WL-0277', email: 'mariela.aguero@wenlen.com' },
    { nombre: 'Angelo Alexis', apellido: 'Araneda Rivas', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0278', email: 'angelo.araneda@wenlen.com' },
    { nombre: 'Bruno', apellido: 'Bianchi', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0279', email: 'bruno.bianchi@wenlen.com' },
    { nombre: 'Eliana Soledad', apellido: 'Cejas', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: 'WL-0280', email: 'eliana.cejas@wenlen.com' },
    { nombre: 'Noelia Elizabeth', apellido: 'Colombres', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0281', email: 'noelia.colombres@wenlen.com' },
    { nombre: 'Carlos Jorge', apellido: 'Díaz', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: 'WL-0282', email: 'carlos.diaz@wenlen.com' },
    { nombre: 'José Luis', apellido: 'Domínguez', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0283', email: 'jose.dominguez@wenlen.com' },
    { nombre: 'César Sebastián', apellido: 'Duboscq', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0284', email: 'cesar.duboscq@wenlen.com' },
    { nombre: 'Amalia Rosario', apellido: 'González', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: 'WL-0285', email: 'amalia.gonzalez@wenlen.com' },
    { nombre: 'Damiana Sabrina', apellido: 'Herrera', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0286', email: 'damiana.herrera@wenlen.com' },
    { nombre: 'Rosana Elizabeth', apellido: 'Juricich', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0287', email: 'rosana.juricich@wenlen.com' },
    { nombre: 'Gustavo Andrés', apellido: 'Muñoz', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0288', email: 'gustavo.munoz@wenlen.com' },
    { nombre: 'Nicolás Alejandro', apellido: 'Pressello', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0289', email: 'nicolas.pressello@wenlen.com' },
    { nombre: 'Leopoldo', apellido: 'Silveira', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: 'WL-0290', email: 'leopoldo.silveira@wenlen.com' },
    { nombre: 'Pablo Gerónimo Andrés', apellido: 'Sin', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0291', email: 'pablo.sin@wenlen.com' },
    { nombre: 'Carlos Alberto', apellido: 'Solís', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0292', email: 'carlos.solis@wenlen.com' },
    { nombre: 'Florencia Anabela', apellido: 'Spagnolo', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0293', email: 'florencia.spagnolo@wenlen.com' },
    { nombre: 'Alicia', apellido: 'Strillevsky', sector: 'ADMINISTRACION', rol: 'RRHH', legajo: 'WL-0294', email: 'alicia.strillevsky@wenlen.com' },
    { nombre: 'David Ariel', apellido: 'Valenzuela', sector: 'ADMINISTRACION', rol: 'OPERADOR', legajo: 'WL-0295', email: 'david.valenzuela@wenlen.com' },
    { nombre: 'Ricardo Leopoldo', apellido: 'Winkler', sector: 'ADMINISTRACION', rol: 'GERENTE', legajo: 'WL-0296', email: 'ricardo.winkler@wenlen.com' },
    // -- ALMACEN --
    { nombre: 'Jorge Ricardo', apellido: 'Alegría', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0297', email: 'jorge.alegria@wenlen.com' },
    { nombre: 'Luciano', apellido: 'Angelino', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0298', email: 'luciano.angelino@wenlen.com' },
    { nombre: 'Joaquín Antonio', apellido: 'Barrionuevo', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0299', email: 'joaquin.barrionuevo@wenlen.com' },
    { nombre: 'Juan Ignacio', apellido: 'Demarco', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0300', email: 'juan.demarco@wenlen.com' },
    { nombre: 'Pedro Fabián', apellido: 'González', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0301', email: 'pedro.gonzalez@wenlen.com' },
    { nombre: 'Franco Emanuel', apellido: 'Hernandorena', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0302', email: 'franco.hernandorena@wenlen.com' },
    { nombre: 'Gabriel Iván', apellido: 'Mercado', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0303', email: 'gabriel.mercado@wenlen.com' },
    { nombre: 'Juan Pablo', apellido: 'Muñoz', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0304', email: 'juan.munoz@wenlen.com' },
    { nombre: 'Néstor Emiliano', apellido: 'Rivas', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0305', email: 'nestor.rivas@wenlen.com' },
    { nombre: 'Ricardo Alberto', apellido: 'Sueldo', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0306', email: 'ricardo.sueldo@wenlen.com' },
    { nombre: 'Elvio Alfredo', apellido: 'Taux', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0307', email: 'elvio.taux@wenlen.com' },
    { nombre: 'José Luis', apellido: 'Velázquez', sector: 'ALMACEN', rol: 'OPERADOR', legajo: 'WL-0308', email: 'jose.velazquez@wenlen.com' },
    // -- INTENDENCIA --
    { nombre: 'Néstor', apellido: 'Alegría', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0309', email: 'nestor.alegria@wenlen.com' },
    { nombre: 'Andrés Fidel', apellido: 'Badilla Rubilar', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0310', email: 'andres.badilla@wenlen.com' },
    { nombre: 'Catherine Luciana', apellido: 'García', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0311', email: 'catherine.garcia@wenlen.com' },
    { nombre: 'Néstor Fabián', apellido: 'Gutiérrez', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0312', email: 'nestor.gutierrez@wenlen.com' },
    { nombre: 'Andrea Carolina', apellido: 'Holzmann', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0313', email: 'andrea.holzmann@wenlen.com' },
    { nombre: 'Andrés', apellido: 'Toth', sector: 'INTENDENCIA', rol: 'OPERADOR', legajo: 'WL-0314', email: 'andres.toth@wenlen.com' },
    // -- CMASS --
    { nombre: 'Alberto Daniel', apellido: 'Atienza', sector: 'CMASS', rol: 'SUPERVISOR', legajo: 'WL-0315', email: 'alberto.atienza@wenlen.com' },
    { nombre: 'Fabiana Aylén', apellido: 'Bascur', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0316', email: 'fabiana.bascur@wenlen.com' },
    { nombre: 'Saúl Hernán', apellido: 'Ceballo', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0317', email: 'saul.ceballo@wenlen.com' },
    { nombre: 'Rubén Omar', apellido: 'Ciccarelli Arrieta', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0318', email: 'ruben.ciccarelli@wenlen.com' },
    { nombre: 'Pablo Miguel', apellido: 'Fernández Sastre', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0319', email: 'pablo.fernandez@wenlen.com' },
    { nombre: 'Silvia Andrea', apellido: 'Ferretti', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0320', email: 'silvia.ferretti@wenlen.com' },
    { nombre: 'Juana', apellido: 'García', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0321', email: 'juana.garcia@wenlen.com' },
    { nombre: 'Walter Eduardo', apellido: 'Garrido', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0322', email: 'walter.garrido@wenlen.com' },
    { nombre: 'Damián Esteban', apellido: 'González', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0323', email: 'damian.gonzalez@wenlen.com' },
    { nombre: 'María Belén', apellido: 'Ilardo', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0324', email: 'maria.ilardo@wenlen.com' },
    { nombre: 'Ximena Belén', apellido: 'Martínez', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0325', email: 'ximena.martinez@wenlen.com' },
    { nombre: 'Julio Alberto', apellido: 'Meriño', sector: 'CMASS', rol: 'SUPERVISOR', legajo: 'WL-0326', email: 'julio.merino@wenlen.com' },
    { nombre: 'Fernando Martín', apellido: 'Ramírez', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0327', email: 'fernando.ramirez@wenlen.com' },
    { nombre: 'Natalia Andrea', apellido: 'Ramírez', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0328', email: 'natalia.ramirez@wenlen.com' },
    { nombre: 'Osvaldo Gabriel', apellido: 'Ríos', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0329', email: 'osvaldo.rios@wenlen.com' },
    { nombre: 'Julio César', apellido: 'Vásquez', sector: 'CMASS', rol: 'OPERADOR', legajo: 'WL-0330', email: 'julio.vasquez@wenlen.com' },
    // -- WIRELINE --
    { nombre: 'Sergio Gabriel', apellido: 'Abregú', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0331', email: 'sergio.abregu@wenlen.com' },
    { nombre: 'Fernando', apellido: 'Arriagada Guerrero', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0332', email: 'fernando.arriagada@wenlen.com' },
    { nombre: 'Franco Julián', apellido: 'Bercovich', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0333', email: 'franco.bercovich@wenlen.com' },
    { nombre: 'Dante Daniel', apellido: 'Bracco', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0334', email: 'dante.bracco@wenlen.com' },
    { nombre: 'Pablo Gabriel', apellido: 'Chiuchiarelli', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0335', email: 'pablo.chiuchiarelli@wenlen.com' },
    { nombre: 'Esteban Leonardo', apellido: 'Fernández', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0336', email: 'esteban.fernandez@wenlen.com' },
    { nombre: 'Hernán Osvaldo', apellido: 'Maturana', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0337', email: 'hernan.maturana@wenlen.com' },
    { nombre: 'Marcelo Alejandro', apellido: 'Mendoza', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0338', email: 'marcelo.mendoza@wenlen.com' },
    { nombre: 'Luis Ángel', apellido: 'Rodríguez', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0339', email: 'luis.rodriguez@wenlen.com' },
    { nombre: 'Luis Alfredo', apellido: 'Traiman', sector: 'WIRELINE', rol: 'OPERADOR', legajo: 'WL-0340', email: 'luis.traiman@wenlen.com' },
    // -- TESTING --
    { nombre: 'Luis Ceferino', apellido: 'Almeira', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0341', email: 'luis.almeira@wenlen.com' },
    { nombre: 'Fernando Ariel', apellido: 'Arriagada', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0342', email: 'fernando.arriagada2@wenlen.com' },
    { nombre: 'Cristian Daniel', apellido: 'Ávalos', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0343', email: 'cristian.avalos@wenlen.com' },
    { nombre: 'Patricio Andrés', apellido: 'Badilla', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0344', email: 'patricio.badilla@wenlen.com' },
    { nombre: 'Marcelo Ubaldo', apellido: 'Barrera', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0345', email: 'marcelo.barrera@wenlen.com' },
    { nombre: 'Arnaldo Andrés', apellido: 'Benítez', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0346', email: 'arnaldo.benitez@wenlen.com' },
    { nombre: 'Claudio Fernando', apellido: 'Berra', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0347', email: 'claudio.berra@wenlen.com' },
    { nombre: 'Pablo Antonio', apellido: 'Bucolo', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0348', email: 'pablo.bucolo@wenlen.com' },
    { nombre: 'Brandon Sebastián', apellido: 'Bustos', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0349', email: 'brandon.bustos@wenlen.com' },
    { nombre: 'Carlos Jesús Andrés', apellido: 'Camargo', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0350', email: 'carlos.camargo@wenlen.com' },
    { nombre: 'Agustín Rodrigo', apellido: 'Cattaneo', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0351', email: 'agustin.cattaneo@wenlen.com' },
    { nombre: 'Emanuel Alejandro', apellido: 'Cepeda', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0352', email: 'emanuel.cepeda@wenlen.com' },
    { nombre: 'Mauro Gabriel', apellido: 'Contreras', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0353', email: 'mauro.contreras@wenlen.com' },
    { nombre: 'Leonardo Damián', apellido: 'Cuitiño', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0354', email: 'leonardo.cuitino@wenlen.com' },
    { nombre: 'Miguel Ángel', apellido: 'Curihuinca', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0355', email: 'miguel.curihuinca@wenlen.com' },
    { nombre: 'Rodrigo Nahuel', apellido: 'Elías', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0356', email: 'rodrigo.elias@wenlen.com' },
    { nombre: 'Emanuel Sergio David', apellido: 'Fernández', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0357', email: 'emanuel.fernandez@wenlen.com' },
    { nombre: 'Jorge Luis', apellido: 'Figueroa', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0358', email: 'jorge.figueroa@wenlen.com' },
    { nombre: 'Diego Lautaro', apellido: 'Fuentealba', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0359', email: 'diego.fuentealba@wenlen.com' },
    { nombre: 'Maximiliano Andrés', apellido: 'Fuentes', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0360', email: 'maximiliano.fuentes@wenlen.com' },
    { nombre: 'Nicolás Ricardo', apellido: 'García', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0361', email: 'nicolas.garcia@wenlen.com' },
    { nombre: 'Rubén Eduardo', apellido: 'Garrido', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0362', email: 'ruben.garrido@wenlen.com' },
    { nombre: 'Giuliano Marcos', apellido: 'Giusti', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0363', email: 'giuliano.giusti@wenlen.com' },
    { nombre: 'Carlos Martín', apellido: 'Guinder', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0364', email: 'carlos.guinder@wenlen.com' },
    { nombre: 'Javier Alejandro', apellido: 'Hazeldine', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0365', email: 'javier.hazeldine@wenlen.com' },
    { nombre: 'Juan Ignacio', apellido: 'Jofré Krause', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0366', email: 'juan.jofre@wenlen.com' },
    { nombre: 'Emanuel Matías', apellido: 'Kastli', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0367', email: 'emanuel.kastli@wenlen.com' },
    { nombre: 'Lucas Fernando', apellido: 'Liempe', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0368', email: 'lucas.liempe@wenlen.com' },
    { nombre: 'Diego Heraldo', apellido: 'Lizama', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0369', email: 'diego.lizama@wenlen.com' },
    { nombre: 'Rodrigo Emmanuel', apellido: 'López Villena', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0370', email: 'rodrigo.lopez@wenlen.com' },
    { nombre: 'Nashif Aaron', apellido: 'Mansur', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0371', email: 'nashif.mansur@wenlen.com' },
    { nombre: 'Ezequias Emanuel', apellido: 'Morales Fernández', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0372', email: 'ezequias.morales@wenlen.com' },
    { nombre: 'Diego Ezequiel', apellido: 'Morales Ramos', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0373', email: 'diego.morales@wenlen.com' },
    { nombre: 'Juan Manuel', apellido: 'Moreno', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0374', email: 'juan.moreno@wenlen.com' },
    { nombre: 'Vicente Víctor', apellido: 'Moreno', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0375', email: 'vicente.moreno@wenlen.com' },
    { nombre: 'Alan Yusef', apellido: 'Muñoz', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0376', email: 'alan.munoz@wenlen.com' },
    { nombre: 'Marvin Paolo', apellido: 'Navarro', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0377', email: 'marvin.navarro@wenlen.com' },
    { nombre: 'Facundo', apellido: 'Paez', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0378', email: 'facundo.paez@wenlen.com' },
    { nombre: 'Daniel Enrique', apellido: 'Palma', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0379', email: 'daniel.palma@wenlen.com' },
    { nombre: 'Valentín', apellido: 'Palomar Serrano', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0380', email: 'valentin.palomar@wenlen.com' },
    { nombre: 'Braian Alexander', apellido: 'Peña', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0381', email: 'braian.pena@wenlen.com' },
    { nombre: 'Eduardo Alejandro', apellido: 'Perea', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0382', email: 'eduardo.perea@wenlen.com' },
    { nombre: 'Matías Facundo', apellido: 'Provoste', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0383', email: 'matias.provoste@wenlen.com' },
    { nombre: 'Vito Martín', apellido: 'Riquelme', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0384', email: 'vito.riquelme@wenlen.com' },
    { nombre: 'Lucas Nicolás', apellido: 'Salatino', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0385', email: 'lucas.salatino@wenlen.com' },
    { nombre: 'Félix Darío', apellido: 'San Martín', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0386', email: 'felix.san@wenlen.com' },
    { nombre: 'Héctor Mauricio', apellido: 'Tejerina', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0387', email: 'hector.tejerina@wenlen.com' },
    { nombre: 'Nicolás Alejandro', apellido: 'Vázquez', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0388', email: 'nicolas.vazquez@wenlen.com' },
    { nombre: 'Germán Agustín', apellido: 'Zwenger', sector: 'TESTING', rol: 'OPERADOR', legajo: 'WL-0389', email: 'german.zwenger@wenlen.com' },
    { nombre: 'Alberto Daniel', apellido: 'Arismendi', sector: 'TESTING', rol: 'COORDINADOR', legajo: 'WL-0390', email: 'alberto.arismendi@wenlen.com' },
    { nombre: 'Cristian Darío', apellido: 'Baez', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0391', email: 'cristian.baez@wenlen.com' },
    { nombre: 'Juan Pablo', apellido: 'Corachan', sector: 'TESTING', rol: 'COORDINADOR', legajo: 'WL-0392', email: 'juan.corachan@wenlen.com' },
    { nombre: 'Veronica', apellido: 'Ibañez Ybañez', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0393', email: 'veronica.ibanez@wenlen.com' },
    { nombre: 'Diego Emanuel', apellido: 'Mondaca', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0394', email: 'diego.mondaca@wenlen.com' },
    { nombre: 'Bernard Jean Gabriel', apellido: 'Piller', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0395', email: 'bernard.piller@wenlen.com' },
    { nombre: 'Rodrigo Alexis', apellido: 'Reyes', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0396', email: 'rodrigo.reyes@wenlen.com' },
    { nombre: 'Nicolás Emmanuel', apellido: 'Zaragoza', sector: 'TESTING', rol: 'SUPERVISOR', legajo: 'WL-0397', email: 'nicolas.zaragoza@wenlen.com' },
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
        { codigo: 'SUPERVISOR', nombre: 'Supervisor', descripcion: 'Supervisión de operaciones en campo', color: '#10B981', nivel: 60, esSistema: true },
        { codigo: 'OPERADOR', nombre: 'Operador', descripcion: 'Carga de horas y solicitudes', color: '#64748B', nivel: 10, esSistema: true },
    ];
    for (const r of rolesData) {
        await prisma.rolConfig.create({ data: { empresaId: empresa.id, ...r } });
    }
    console.log('✅ 6 roles del sistema creados');
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
    const sectores = {};
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
            tipo: client_1.CctTipo.PETROLEROS_PRIVADOS_644,
            vigenteDesde: new Date('2012-01-01'),
        },
    });
    console.log('✅ Convenio PP creado:', convenioPP.nombre);
    // ── Categorías CCT 644/12 ──
    const catsPP = [
        // Título II — Producción y Mantenimiento
        { codigo: 'TII-A1', nombre: 'Título II — Oficial Especializado 1ra A', orden: 1 },
        { codigo: 'TII-A2', nombre: 'Título II — Oficial Especializado 1ra B', orden: 2 },
        { codigo: 'TII-B1', nombre: 'Título II — Oficial 2da A', orden: 3 },
        { codigo: 'TII-B2', nombre: 'Título II — Oficial 2da B', orden: 4 },
        { codigo: 'TII-C1', nombre: 'Título II — Oficial 3ra A', orden: 5 },
        { codigo: 'TII-C2', nombre: 'Título II — Oficial 3ra B', orden: 6 },
        { codigo: 'TII-D', nombre: 'Título II — Medio Oficial', orden: 7 },
        { codigo: 'TII-E', nombre: 'Título II — Ayudante / Peón Especializado', orden: 8 },
        { codigo: 'TII-F', nombre: 'Título II — Ayudante General', orden: 9 },
        // Título III — Operaciones Especiales
        { codigo: 'TIII-A', nombre: 'Título III — Operador Principal / Jefe de Equipo', orden: 10 },
        { codigo: 'TIII-B', nombre: 'Título III — Operador 1ro / Técnico Principal', orden: 11 },
        { codigo: 'TIII-C', nombre: 'Título III — Operador 2do / Técnico', orden: 12 },
        { codigo: 'TIII-D', nombre: 'Título III — Asistente de Operaciones', orden: 13 },
        { codigo: 'TIII-E', nombre: 'Título III — Ayudante de Operaciones', orden: 14 },
        { codigo: 'TIII-F', nombre: 'Título III — Ayudante General Especial', orden: 15 },
    ];
    const categoriasPP = {};
    for (const c of catsPP) {
        const cat = await prisma.categoria.create({
            data: { convenioId: convenioPP.id, ...c },
        });
        categoriasPP[c.codigo] = cat.id;
    }
    console.log('✅ 15 categorías CCT 644/12 creadas');
    // ── Conceptos salariales CCT 644/12 ──
    const conceptosPP = [
        // REMUNERATIVOS FIJOS
        { codigo: 'BASICO_PP', nombre: 'Sueldo Básico CCT 644/12', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente por categoría', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 1 },
        { codigo: 'TURNO_A', nombre: 'Adicional Turno A (33%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turno rotativo cubriendo 24h', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 2 },
        { codigo: 'TURNO_B', nombre: 'Adicional Turno B (22%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turnos sin cubrir 24h', esPorcentual: true, porcentajeBase: 0.22, baseCalculo: 'BASICO', esRemunerativo: true, orden: 3 },
        { codigo: 'TURNO_S', nombre: 'Adicional Turno S (33%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Operaciones especiales campo', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 4 },
        { codigo: 'ZNC', nombre: 'Zona No Convencional — Vaca Muerta (85%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Adicional zona no convencional Vaca Muerta', esPorcentual: true, porcentajeBase: 0.85, baseCalculo: 'BASICO', esRemunerativo: true, orden: 5 },
        { codigo: 'ADICIONAL_YAC', nombre: 'Adicional Yacimiento (5%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Operaciones de producción en campo', esPorcentual: true, porcentajeBase: 0.05, baseCalculo: 'BASICO', esRemunerativo: true, orden: 6 },
        { codigo: 'ANTIGUEDAD_PP', nombre: 'Antigüedad (1% por año)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '1% del básico por año de antigüedad', esPorcentual: true, porcentajeBase: 0.01, baseCalculo: 'BASICO', esRemunerativo: true, orden: 7 },
        { codigo: 'PRESENTISMO_PP', nombre: 'Presentismo (6%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '6% sobre remunerativos normales y habituales', esPorcentual: true, porcentajeBase: 0.06, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: true, orden: 8 },
        { codigo: 'BONO_PAZ_PP', nombre: 'Bono Paz Social', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 9 },
        { codigo: 'ADICIONAL_DISPONIB', nombre: 'Adicional Disponibilidad', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 10 },
        // REMUNERATIVOS VARIABLES
        { codigo: 'HORAS_EXTRA_50_PP', nombre: 'Horas Extra 50%', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 1.5 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_1.5', esRemunerativo: true, orden: 20 },
        { codigo: 'HORAS_EXTRA_100_PP', nombre: 'Horas Extra 100%', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 2.0 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_2.0', esRemunerativo: true, orden: 21 },
        { codigo: 'HORAS_VIAJE_PP', nombre: 'Horas de Viaje (47%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico / 192) × 0.47 × hs (no maneja)', esPorcentual: false, baseCalculo: 'HORA_BASE_X_0.47', esRemunerativo: true, orden: 22 },
        { codigo: 'DESARRAIGO_HOTEL', nombre: 'Desarraigo — Hotel', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día — pernocte hotel', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 23 },
        { codigo: 'DESARRAIGO_TRAILER', nombre: 'Desarraigo — Trailer/Campamento', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día — pernocte trailer', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 24 },
        { codigo: 'ADICIONAL_MANEJO', nombre: 'Adicional por Manejo en Campo', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día cuando maneja en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 25 },
        // NO REMUNERATIVOS
        { codigo: 'VIANDA_PP', nombre: 'Vianda — Ayuda Alimentaria', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Art. 34 CCT 644/12, monto por día campo', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 40 },
        { codigo: 'DESAYUNO_PP', nombre: 'Desayuno / Merienda', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Monto por día', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 41 },
        { codigo: 'AVC_FIJA_PP', nombre: 'Asignación Vianda Compl. — Fija', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: '$440.000/mes total (desde mar/abr 2025)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 42 },
        { codigo: 'AVC_VAR_PP', nombre: 'Asignación Vianda Compl. — Variable', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Reintegro ganancias (Tít II: 100%, Tít III: tope)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 43 },
        // RETENCIONES
        { codigo: 'RET_JUB', nombre: 'Jubilación (11%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte jubilatorio SIJP', esPorcentual: true, porcentajeBase: 0.11, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 60 },
        { codigo: 'RET_PAMI', nombre: 'PAMI — Ley 19.032 (3%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte PAMI', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 61 },
        { codigo: 'RET_OS', nombre: 'Obra Social (3%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte obra social', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 62 },
        { codigo: 'RET_SINDICAL', nombre: 'Cuota Sindical (2%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Cuota sindical (actualizable según acta)', esPorcentual: true, porcentajeBase: 0.02, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 63 },
        { codigo: 'RET_MUTUAL', nombre: 'Mutual (~3.97%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Mutual (actualizable según acta)', esPorcentual: true, porcentajeBase: 0.0397, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 64 },
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
            tipo: client_1.CctTipo.PETROLEROS_JERARQUICOS_637,
            vigenteDesde: new Date('2011-01-01'),
        },
    });
    console.log('✅ Convenio PJ creado:', convenioPJ.nombre);
    // ── Categorías CCT 637/11 ──
    const catsPJ = [
        { codigo: 'JER-A', nombre: 'Jerárquico Banda A — Jefes y Coordinadores Senior', orden: 1 },
        { codigo: 'JER-B', nombre: 'Jerárquico Banda B — Supervisores y Técnicos Senior', orden: 2 },
        { codigo: 'JER-C', nombre: 'Jerárquico Banda C — Técnicos Calificados / Company Man', orden: 3 },
        { codigo: 'JER-D', nombre: 'Jerárquico Banda D — Asistentes Técnicos', orden: 4 },
    ];
    const categoriasPJ = {};
    for (const c of catsPJ) {
        const cat = await prisma.categoria.create({
            data: { convenioId: convenioPJ.id, ...c },
        });
        categoriasPJ[c.codigo] = cat.id;
    }
    console.log('✅ 4 categorías CCT 637/11 creadas');
    // ── Conceptos salariales CCT 637/11 ──
    const conceptosPJ = [
        // REMUNERATIVOS FIJOS
        { codigo: 'BASICO_PJ', nombre: 'Sueldo Básico CCT 637/11', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT 637/11 por categoría (superior a PP)', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 1 },
        { codigo: 'TURNO_A_PJ', nombre: 'Adicional Turno A (33%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turno rotativo 24h — Jerárquicos', esPorcentual: true, porcentajeBase: 0.33, baseCalculo: 'BASICO', esRemunerativo: true, orden: 2 },
        { codigo: 'TURNO_B_PJ', nombre: 'Adicional Turno B (22%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Turnos sin 24h — Jerárquicos', esPorcentual: true, porcentajeBase: 0.22, baseCalculo: 'BASICO', esRemunerativo: true, orden: 3 },
        { codigo: 'ZNC_PJ', nombre: 'Zona No Convencional (VM) — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Derivado del ZNC de PP + Art. 63 solapamiento', esPorcentual: true, porcentajeBase: 0.85, baseCalculo: 'BASICO', esRemunerativo: true, orden: 5 },
        { codigo: 'ANTIGUEDAD_PJ', nombre: 'Antigüedad (1% por año)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '1% del básico PJ por año', esPorcentual: true, porcentajeBase: 0.01, baseCalculo: 'BASICO', esRemunerativo: true, orden: 7 },
        { codigo: 'PRESENTISMO_PJ', nombre: 'Presentismo (6%)', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '6% sobre remunerativos normales', esPorcentual: true, porcentajeBase: 0.06, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: true, orden: 8 },
        { codigo: 'BONO_PAZ_PJ', nombre: 'Bono Paz Social — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Planilla CCT vigente', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 9 },
        { codigo: 'ADICIONAL_PERS_8H', nombre: 'Adicional Personal 8 Horas', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: 'Concepto específico PJ — jornada especial 8h', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 10 },
        { codigo: 'FUN_JERARQUICA', nombre: 'Adicional Función Jerárquica', tipo: client_1.ConceptoTipo.REMUNERATIVO_FIJO, descripcion: '% por nivel de jefatura, configurable', esPorcentual: true, porcentajeBase: 0.10, baseCalculo: 'BASICO', esRemunerativo: true, orden: 11 },
        // REMUNERATIVOS VARIABLES
        { codigo: 'HORAS_EXTRA_50_PJ', nombre: 'Horas Extra 50% — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico PJ / 192) × 1.5 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_1.5', esRemunerativo: true, orden: 20 },
        { codigo: 'HORAS_EXTRA_100_PJ', nombre: 'Horas Extra 100% — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: '(Básico PJ / 192) × 2.0 × hs', esPorcentual: false, baseCalculo: 'HORA_BASE_X_2.0', esRemunerativo: true, orden: 21 },
        { codigo: 'DESARRAIGO_PJ', nombre: 'Desarraigo — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Monto por día campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 23 },
        { codigo: 'BONO_CAMPO_PJ', nombre: 'Bono Campo — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Adicional cuando trabaja en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 26 },
        { codigo: 'GUARDIA_PASIVA_PJ', nombre: 'Guardia Pasiva — Jerárquicos', tipo: client_1.ConceptoTipo.REMUNERATIVO_VARIABLE, descripcion: 'Médicos/enfermeros en yacimiento', esPorcentual: false, baseCalculo: null, esRemunerativo: true, orden: 27 },
        // NO REMUNERATIVOS
        { codigo: 'VIANDA_PJ', nombre: 'Vianda Campo — Jerárquicos', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Monto por día en campo', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 40 },
        { codigo: 'AVC_FIJA_PJ', nombre: 'Asignación Vianda Compl. Fija — Jerárquicos', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: '$440.000/mes total (igual PP, desde abr 2025)', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 42 },
        { codigo: 'AVC_VAR_PJ', nombre: 'Asignación Vianda Compl. Variable — Jerárquicos', tipo: client_1.ConceptoTipo.NO_REMUNERATIVO, descripcion: 'Reintegro 50% ganancias hasta tope', esPorcentual: false, baseCalculo: null, esRemunerativo: false, orden: 43 },
        // RETENCIONES (misma estructura que PP)
        { codigo: 'RET_JUB_PJ', nombre: 'Jubilación (11%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte jubilatorio SIJP', esPorcentual: true, porcentajeBase: 0.11, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 60 },
        { codigo: 'RET_PAMI_PJ', nombre: 'PAMI — Ley 19.032 (3%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte PAMI', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 61 },
        { codigo: 'RET_OS_PJ', nombre: 'Obra Social (3%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Aporte obra social', esPorcentual: true, porcentajeBase: 0.03, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 62 },
        { codigo: 'RET_SINDICAL_PJ', nombre: 'Cuota Sindical (2%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Cuota sindical', esPorcentual: true, porcentajeBase: 0.02, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 63 },
        { codigo: 'RET_MUTUAL_PJ', nombre: 'Mutual (~3.97%)', tipo: client_1.ConceptoTipo.RETENCION, descripcion: 'Mutual', esPorcentual: true, porcentajeBase: 0.0397, baseCalculo: 'REMUNERATIVO_TOTAL', esRemunerativo: false, orden: 64 },
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
        { nombre: 'Lun-Vier', tipo: client_1.DiagramaTipo.FIJO_SEMANA, diasSemana: [1, 2, 3, 4, 5], descripcion: 'Lunes a Viernes' },
        { nombre: '7×7', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 7, diasDescanso: 7, descripcion: '7 días trabajo, 7 días franco' },
        { nombre: '10×5', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 10, diasDescanso: 5, descripcion: '10 días trabajo, 5 días franco' },
        { nombre: '14×14', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 14, diasDescanso: 14, descripcion: '14 días trabajo, 14 días franco' },
        { nombre: '8×6', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 8, diasDescanso: 6, descripcion: '8 días trabajo, 6 días franco' },
        { nombre: '21×7', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 21, diasDescanso: 7, descripcion: '21 días trabajo, 7 días franco' },
        { nombre: '2×1 (8×4)', tipo: client_1.DiagramaTipo.ROTATIVO, diasTrabajo: 8, diasDescanso: 4, descripcion: 'Perforación 2×1 máx 8×4 (Acta 2024)' },
    ];
    const diagramas = {};
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
    console.log('✅ 7 diagramas creados');
    const accionCierreRRHH = {
        PLANILLA: 'CERRAR',
        VACACION: 'CONFIRMAR',
        AUSENCIA: 'APROBAR',
    };
    const tipoDocLabels = {
        PLANILLA: 'Planillas',
        VACACION: 'Vacaciones',
        AUSENCIA: 'Ausencias',
    };
    const flujosConfig = [];
    for (const tipo of ['PLANILLA', 'VACACION', 'AUSENCIA']) {
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
    const flujos = {};
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
        let patron;
        if (fc.nombre.includes('Coordinador'))
            patron = 'A';
        else if (fc.nombre.includes('Supervisor'))
            patron = 'B';
        else
            patron = 'C';
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
            tipoContrato: client_1.ContratoTipo.INDEFINIDO,
            fechaIngreso: new Date('2024-01-01'),
            convenioId: convenioPJ.id,
            categoriaId: categoriasPJ['JER-B'],
            primerLogin: true,
        },
    });
    console.log('✅ Cuenta admin del sistema creada: admin@wenlen.com');
    const sectorMap = {
        'FRACTURA': sectores['Fractura'],
        'CABEZALES': sectores['Cabezales'],
        'LOGISTICA': sectores['Logística y Transporte'],
        'ADMINISTRACION': sectores['Administración'],
        'ALMACEN': sectores['Almacén'],
        'INTENDENCIA': sectores['Intendencia'],
        'CMASS': sectores['CMASS'],
        'WIRELINE': sectores['Wireline'],
        'TESTING': sectores['Testing'],
    };
    const JERARQUICOS = ['ADMIN', 'RRHH', 'GERENTE', 'COORDINADOR', 'SUPERVISOR'];
    let userCount = 0;
    for (const emp of EMPLEADOS) {
        const esJerarquico = JERARQUICOS.includes(emp.rol);
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
                tipoContrato: client_1.ContratoTipo.INDEFINIDO,
                fechaIngreso: new Date('2024-01-01'),
                convenioId: esJerarquico ? convenioPJ.id : convenioPP.id,
                categoriaId: esJerarquico ? categoriasPJ['JER-B'] : categoriasPP['TIII-C'],
                primerLogin: true,
            },
        });
        userCount++;
        if (userCount % 50 === 0)
            console.log(`  ... ${userCount} usuarios creados`);
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
    for (const tipo of ['PLANILLA', 'VACACION', 'AUSENCIA']) {
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
    console.log('✅ 27 asignaciones de flujo creadas (9 sectores × 3 tipos)');
    // ═════════════════════════════════════════════════
    // RESUMEN
    // ═════════════════════════════════════════════════
    console.log('\n🎉 Seed beta 1.0 completado exitosamente!');
    console.log('═══════════════════════════════════════════');
    console.log('  9 sectores');
    console.log('  9 flujos de aprobación (3 patrones × 3 tipos documento)');
    console.log(`  ${userCount + 1} usuarios (1 admin sistema + ${userCount} empleados)`);
    console.log('  Convenios: CCT 644/12 PP (15 cats, 25 conceptos) + CCT 637/11 PJ (4 cats, 22 conceptos)');
    console.log('  7 diagramas de trabajo');
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
//# sourceMappingURL=seed.js.map