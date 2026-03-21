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

async function main() {
  console.log('🌱 Iniciando seed...');

  // ─────────────────────────────────
  // 1. EMPRESA
  // ─────────────────────────────────
  const empresa = await prisma.empresa.create({
    data: {
      nombre: 'TechOil Demo',
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
    { nombre: 'Well Testing', color: '#3B82F6', descripcion: 'Pruebas de pozo' },
    { nombre: 'Servicios Well Head', color: '#10B981', descripcion: 'Servicios de boca de pozo' },
    { nombre: 'Mantenimiento Mecánico', color: '#F59E0B', descripcion: 'Mantenimiento de equipos mecánicos' },
    { nombre: 'END', color: '#8B5CF6', descripcion: 'Ensayos No Destructivos' },
    { nombre: 'Wireline', color: '#EC4899', descripcion: 'Servicios de wireline' },
    { nombre: 'Pañol', color: '#06B6D4', descripcion: 'Gestión de pañol y herramientas' },
    { nombre: 'PH', color: '#6366F1', descripcion: 'Pruebas hidráulicas' },
    { nombre: 'Certificaciones', color: '#D946EF', descripcion: 'Certificaciones y documentación' },
    { nombre: 'Mantenimiento de Trailers', color: '#F97316', descripcion: 'Mantenimiento de trailers y vehículos' },
  ];

  const sectores: Record<string, string> = {};
  for (const s of sectoresData) {
    const sector = await prisma.sector.create({
      data: { empresaId: empresa.id, ...s },
    });
    sectores[s.nombre] = sector.id;
  }
  console.log('✅ 10 sectores creados');

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

  const categoriasPP: Record<string, string> = {};
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
    { codigo: 'JER-A', nombre: 'Jerárquico Banda A — Jefes y Coordinadores Senior', orden: 1 },
    { codigo: 'JER-B', nombre: 'Jerárquico Banda B — Supervisores y Técnicos Senior', orden: 2 },
    { codigo: 'JER-C', nombre: 'Jerárquico Banda C — Técnicos Calificados / Company Man', orden: 3 },
    { codigo: 'JER-D', nombre: 'Jerárquico Banda D — Asistentes Técnicos', orden: 4 },
  ];

  const categoriasPJ: Record<string, string> = {};
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
  console.log('✅ 7 diagramas creados');

  // ─────────────────────────────────
  // 6. FLUJOS DE APROBACIÓN
  // ─────────────────────────────────
  const flujoPlanillas = await prisma.flujoAprobacion.create({
    data: {
      empresaId: empresa.id,
      nombre: 'Flujo Estándar Planillas',
      tipoDocumento: 'PLANILLA',
      descripcion: 'Flujo de aprobación estándar para planillas de horas',
      pasos: {
        create: [
          { orden: 1, nombrePaso: 'Revisión Coordinador', rolAprobador: 'COORDINADOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['RRHH', 'OPERADOR'] },
          { orden: 2, nombrePaso: 'Aprobación RRHH', rolAprobador: 'RRHH', accionAprobar: 'CERRAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
        ],
      },
    },
  });

  const flujoVacaciones = await prisma.flujoAprobacion.create({
    data: {
      empresaId: empresa.id,
      nombre: 'Flujo Estándar Vacaciones',
      tipoDocumento: 'VACACION',
      descripcion: 'Flujo de aprobación estándar para vacaciones',
      pasos: {
        create: [
          { orden: 1, nombrePaso: 'Revisión Coordinador', rolAprobador: 'COORDINADOR', accionAprobar: 'APROBAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['RRHH'] },
          { orden: 2, nombrePaso: 'Confirmación RRHH', rolAprobador: 'RRHH', accionAprobar: 'CONFIRMAR', accionRechazar: 'RECHAZAR', requiereComentarioRechazo: true, notificarRoles: ['OPERADOR'] },
        ],
      },
    },
  });
  console.log('✅ 2 flujos de aprobación creados');

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
  // 9. USUARIOS DE PRUEBA
  // ─────────────────────────────────
  const passwordHash = await hashPassword('Admin1234!');

  const adminUser = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      nombre: 'Admin', apellido: 'Sistema',
      email: 'admin@demo.com', passwordHash,
      rol: 'ADMIN',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2020-01-01'),
      convenioId: convenioPJ.id,
      categoriaId: categoriasPJ['JER-A'],
    },
  });

  await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      nombre: 'María', apellido: 'González',
      email: 'rrhh@demo.com', passwordHash,
      rol: 'RRHH',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2021-03-15'),
      convenioId: convenioPJ.id,
      categoriaId: categoriasPJ['JER-B'],
    },
  });

  await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      nombre: 'Carlos', apellido: 'Rodríguez',
      email: 'gerente@demo.com', passwordHash,
      rol: 'GERENTE',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2019-06-01'),
      convenioId: convenioPJ.id,
      categoriaId: categoriasPJ['JER-A'],
    },
  });

  const coordinadorUser = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: sectores['Well Testing'],
      nombre: 'Juan', apellido: 'López',
      email: 'coordinador@demo.com', passwordHash,
      rol: 'COORDINADOR',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2020-08-10'),
      convenioId: convenioPJ.id,
      categoriaId: categoriasPJ['JER-C'],
    },
  });

  const supervisorUser = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: sectores['Well Testing'],
      nombre: 'Pedro', apellido: 'Martínez',
      email: 'supervisor@demo.com', passwordHash,
      rol: 'SUPERVISOR',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2021-01-15'),
      convenioId: convenioPP.id,
      categoriaId: categoriasPP['TII-B1'],
      coordinadorId: coordinadorUser.id,
    },
  });

  const operadorUser = await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: sectores['Fractura'],
      nombre: 'Luciano', apellido: 'Vázquez',
      email: 'operador@demo.com', passwordHash,
      rol: 'OPERADOR',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2022-04-01'),
      convenioId: convenioPP.id,
      categoriaId: categoriasPP['TIII-C'],
      coordinadorId: coordinadorUser.id,
    },
  });

  // Extra operator in different sector
  await prisma.usuario.create({
    data: {
      empresaId: empresa.id,
      sectorId: sectores['Wireline'],
      nombre: 'Diego', apellido: 'Fernández',
      email: 'operador2@demo.com', passwordHash,
      rol: 'OPERADOR',
      tipoContrato: ContratoTipo.INDEFINIDO,
      fechaIngreso: new Date('2023-01-10'),
      convenioId: convenioPP.id,
      categoriaId: categoriasPP['TII-D'],
    },
  });

  console.log('✅ 7 usuarios creados');

  // ─────────────────────────────────
  // 10. DIAGRAMA 7×7 PARA EL OPERADOR
  // ─────────────────────────────────
  const now = new Date();
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1);

  await prisma.usuarioDiagrama.create({
    data: { usuarioId: operadorUser.id, diagramaId: diagramas['7×7'], fechaInicio: primerDiaMes },
  });
  console.log('✅ Diagrama 7×7 asignado al operador');

  // ─────────────────────────────────
  // 11. ASIGNACIÓN DE FLUJOS
  // ─────────────────────────────────
  await prisma.flujoAsignacion.create({ data: { flujoId: flujoPlanillas.id, tipoDocumento: 'PLANILLA' } });
  await prisma.flujoAsignacion.create({ data: { flujoId: flujoVacaciones.id, tipoDocumento: 'VACACION' } });
  console.log('✅ Flujos asignados a la empresa');

  console.log('\n🎉 Seed completado exitosamente!');
  console.log('─────────────────────────────────');
  console.log('Convenios: CCT 644/12 PP (15 cats, 25 conceptos) + CCT 637/11 PJ (4 cats, 22 conceptos)');
  console.log('Usuarios de prueba:');
  console.log('  admin@demo.com       / Admin1234!  → ADMIN    (PJ JER-A)');
  console.log('  rrhh@demo.com        / Admin1234!  → RRHH     (PJ JER-B)');
  console.log('  gerente@demo.com     / Admin1234!  → GERENTE  (PJ JER-A)');
  console.log('  coordinador@demo.com / Admin1234!  → COORD    (PJ JER-C)');
  console.log('  supervisor@demo.com  / Admin1234!  → SUPER    (PP TII-B1)');
  console.log('  operador@demo.com    / Admin1234!  → OPER     (PP TIII-C)');
  console.log('  operador2@demo.com   / Admin1234!  → OPER     (PP TII-D)');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
