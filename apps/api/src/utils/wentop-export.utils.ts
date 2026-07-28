/**
 * Armado del Excel de tarjetas WENTOP, con las fotos incrustadas.
 *
 * Vive separado de `wentop.routes.ts` porque son ~200 líneas de geometría de
 * planilla y ese archivo ya pasa las 900.
 */
import ExcelJS from 'exceljs';
import { claveFecha } from './fecha-dia.utils.js';
import { miniaturaDe } from './miniaturas.service.js';

// ── Geometría de las celdas de foto ─────────────────────────────────────────
//
// Las celdas de foto son CUADRADAS a propósito. Una tarjeta trae fotos
// apaisadas (16:9) y verticales (9:16); cualquier celda rectangular deforma una
// de las dos o desperdicia media planilla. Con la celda cuadrada, cada foto se
// escala para ENTRAR conservando su proporción y se centra. Las fotos
// siguientes ocupan las columnas de al lado.
export const LADO_FOTO_PX = 140;
// Unidades de la planilla. El ancho de columna se mide en caracteres de la fuente
// por defecto y Excel lo lleva a píxeles como `ancho * 7 + 5`; el alto de fila va
// en puntos (1 px = 0,75 pt). Se despeja el ancho para que la celda quede
// CUADRADA de verdad: con `LADO / 7` sobran esos 5 px y el cuadrado sale
// rectangular por poco.
const PX_POR_CARACTER = 7;
const RELLENO_COL_PX = 5;
const PT_POR_PX = 0.75;
const EMU_POR_PX = 9525;
const ANCHO_COL_FOTO = (LADO_FOTO_PX - RELLENO_COL_PX) / PX_POR_CARACTER;
const ALTO_FILA_FOTO = LADO_FOTO_PX * PT_POR_PX;

/**
 * Posición y tamaño de una foto dentro de su celda cuadrada.
 *
 * El anclaje va en unidades NATIVAS (EMU), no con el `tl` fraccionario que
 * documenta ExcelJS. La razón es que su conversión de fracción a offset trata
 * `ancho_en_caracteres * 10000` como si fueran EMU (ver `colWidth` en
 * `exceljs/lib/doc/anchor.js`), cuando un carácter son ~66.675 EMU: el margen
 * calculado sale 6,7 veces más chico y la foto queda pegada al borde izquierdo
 * en vez de centrada. Con `nativeColOff`/`nativeRowOff` el número que se escribe
 * es exactamente el que se pidió.
 */
export function ubicarFoto(anchoReal: number, altoReal: number, col: number, fila: number) {
  const escala = Math.min(LADO_FOTO_PX / anchoReal, LADO_FOTO_PX / altoReal);
  const ancho = Math.round(anchoReal * escala);
  const alto = Math.round(altoReal * escala);
  return {
    tl: {
      nativeCol: col,
      nativeColOff: Math.round(((LADO_FOTO_PX - ancho) / 2) * EMU_POR_PX),
      nativeRow: fila,
      nativeRowOff: Math.round(((LADO_FOTO_PX - alto) / 2) * EMU_POR_PX),
    },
    ext: { width: ancho, height: alto },
    editAs: 'oneCell' as const,
  };
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  DETENCION_TAREAS: 'Detención de tareas',
  CONDICION_INSEGURA: 'Condición insegura',
  ACTO_INSEGURO: 'Acto inseguro',
  CASI_ACCIDENTE: 'Casi accidente',
  OBSERVACION_POSITIVA: 'Observación positiva',
};

const ESTADO_LABELS: Record<string, string> = {
  ABIERTA: 'Abierta',
  EN_PROGRESO: 'En progreso',
  CERRADA: 'Cerrada',
};

/** Las categorías son arrays JSON en el schema; pueden venir null o con basura. */
function listaCategorias(valor: unknown): string {
  if (!Array.isArray(valor)) return '';
  return valor.filter((v): v is string => typeof v === 'string').join(', ');
}

/** Fecha-día a texto. `claveFecha` lee en UTC, que es donde está el día real. */
function fechaTexto(fecha: Date | null | undefined): string {
  if (!fecha) return '';
  return claveFecha(fecha).split('-').reverse().join('/');
}

// ── Columnas ────────────────────────────────────────────────────────────────

interface ColumnaTexto {
  encabezado: string;
  ancho: number;
  largo?: boolean;
  valor: (t: TarjetaExport) => string;
}

/** Lo que el armado necesita de una tarjeta. Coincide con `tarjetaDetailInclude`. */
export interface TarjetaExport {
  fechaReporte: Date;
  estado: string;
  tipoTarjeta: string;
  sectorTercero: boolean;
  cliente: string | null;
  lugarPozoLocacion: string | null;
  calidad: unknown;
  medioambiente: unknown;
  seguridadSalud: unknown;
  descripcion: string;
  accionesInmediatas: string | null;
  recomendaciones: string | null;
  justificacionAbierta: string | null;
  accionCierre: string | null;
  fechaCierre: Date | null;
  creador: { nombre: string; apellido: string; legajo: string | null };
  sectorObservacion: { nombre: string } | null;
  fotos: { url: string }[];
}

const COLUMNAS: ColumnaTexto[] = [
  { encabezado: 'Fecha de reporte', ancho: 16, valor: (t) => fechaTexto(t.fechaReporte) },
  { encabezado: 'Estado', ancho: 13, valor: (t) => ESTADO_LABELS[t.estado] ?? t.estado },
  { encabezado: 'Tipo', ancho: 22, valor: (t) => TIPO_LABELS[t.tipoTarjeta] ?? t.tipoTarjeta },
  { encabezado: 'Sector de observación', ancho: 22, valor: (t) => t.sectorObservacion?.nombre ?? '' },
  { encabezado: '¿Tercero?', ancho: 10, valor: (t) => (t.sectorTercero ? 'Sí' : 'No') },
  { encabezado: 'Cliente', ancho: 18, valor: (t) => t.cliente ?? '' },
  { encabezado: 'Lugar / Pozo / Locación', ancho: 24, valor: (t) => t.lugarPozoLocacion ?? '' },
  { encabezado: 'Creador', ancho: 24, valor: (t) => `${t.creador.apellido}, ${t.creador.nombre}` },
  { encabezado: 'Legajo', ancho: 10, valor: (t) => t.creador.legajo ?? '' },
  { encabezado: 'Calidad', ancho: 26, largo: true, valor: (t) => listaCategorias(t.calidad) },
  { encabezado: 'Medioambiente', ancho: 26, largo: true, valor: (t) => listaCategorias(t.medioambiente) },
  { encabezado: 'Seguridad y Salud', ancho: 26, largo: true, valor: (t) => listaCategorias(t.seguridadSalud) },
  { encabezado: 'Descripción', ancho: 50, largo: true, valor: (t) => t.descripcion },
  { encabezado: 'Acciones inmediatas', ancho: 40, largo: true, valor: (t) => t.accionesInmediatas ?? '' },
  { encabezado: 'Recomendaciones', ancho: 40, largo: true, valor: (t) => t.recomendaciones ?? '' },
  { encabezado: 'Justificación de apertura', ancho: 40, largo: true, valor: (t) => t.justificacionAbierta ?? '' },
  { encabezado: 'Acción de cierre', ancho: 40, largo: true, valor: (t) => t.accionCierre ?? '' },
  { encabezado: 'Fecha de cierre', ancho: 16, valor: (t) => fechaTexto(t.fechaCierre) },
];

// ── Armado ──────────────────────────────────────────────────────────────────

export async function construirWorkbookWentop(tarjetas: TarjetaExport[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Planilla de Horas';
  workbook.created = new Date();

  const hoja = workbook.addWorksheet('Tarjetas WENTOP');

  // Cuántas columnas de foto hacen falta: el máximo que tenga alguna tarjeta. Si
  // ninguna tiene fotos, no se agrega ninguna columna vacía.
  const maxFotos = tarjetas.reduce((m, t) => Math.max(m, t.fotos.length), 0);

  hoja.columns = [
    { width: 5 }, // N°
    ...COLUMNAS.map((c) => ({ width: c.ancho })),
    ...Array.from({ length: maxFotos }, () => ({ width: ANCHO_COL_FOTO })),
  ];

  const encabezados = ['N°', ...COLUMNAS.map((c) => c.encabezado)];
  for (let i = 0; i < maxFotos; i++) encabezados.push(`Foto ${i + 1}`);

  const filaEncabezado = hoja.addRow(encabezados);
  filaEncabezado.font = { bold: true };
  filaEncabezado.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  filaEncabezado.height = 28;
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  for (const [indice, tarjeta] of tarjetas.entries()) {
    const fila = hoja.addRow([indice + 1, ...COLUMNAS.map((c) => c.valor(tarjeta))]);
    fila.alignment = { vertical: 'top', wrapText: true };

    if (tarjeta.fotos.length === 0) continue;

    // La fila tiene que ser tan alta como el cuadrado de la foto; si el texto
    // pedía más, gana el texto.
    fila.height = Math.max(fila.height ?? 0, ALTO_FILA_FOTO);

    for (const [i, foto] of tarjeta.fotos.entries()) {
      const colFoto = 1 + COLUMNAS.length + i; // 0-based: la col 0 es "N°"
      const celda = fila.getCell(colFoto + 1);  // getCell es 1-based
      celda.alignment = { vertical: 'middle', horizontal: 'center' };

      const mini = await miniaturaDe(foto.url);
      if (!mini) {
        // Un archivo perdido o corrupto no puede tumbar la exportación entera:
        // se deja constancia en la celda y se sigue.
        celda.value = 'foto no disponible';
        celda.font = { italic: true, size: 9, color: { argb: 'FF999999' } };
        continue;
      }

      // Por ruta y no por buffer: ExcelJS lee el archivo él mismo, así que no hay
      // que sostener cientos de miniaturas en memoria a la vez.
      const imageId = workbook.addImage({ filename: mini.ruta, extension: 'jpeg' });
      // `as never`: los tipos de ExcelJS declaran el anclaje sólo en su forma
      // fraccionaria, pero el constructor de Anchor acepta la nativa (y es la
      // única que centra bien, ver `ubicarFoto`).
      hoja.addImage(imageId, ubicarFoto(mini.ancho, mini.alto, colFoto, fila.number - 1) as never);
    }
  }

  // Autofiltro sobre las columnas de texto (las de foto no se filtran).
  if (tarjetas.length > 0) {
    hoja.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COLUMNAS.length + 1 },
    };
  }

  return workbook;
}
