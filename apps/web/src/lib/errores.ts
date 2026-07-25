/**
 * Traduce cualquier error de una llamada a la API en algo que el usuario pueda
 * accionar.
 *
 * El backend responde los errores de validación como
 * `{ error, details: { formErrors, fieldErrors } }`, pero las pantallas leían
 * solo `.error` y mostraban "Datos inválidos" sin decir qué campo estaba mal.
 */

export interface ErrorLegible {
  mensaje: string;
  fieldErrors: Record<string, string[]>;
}

/** Nombres de campo de la API → etiquetas que el usuario reconoce del formulario. */
const ETIQUETAS: Record<string, string> = {
  nombre: 'Nombre',
  apellido: 'Apellido',
  email: 'Email',
  password: 'Contraseña',
  rol: 'Rol',
  sectorId: 'Sector',
  legajo: 'Legajo',
  tipoContrato: 'Contrato',
  fechaIngreso: 'Fecha de ingreso',
  fechaFinPrueba: 'Fin del período de prueba',
  diagramaColor: 'Color de diagrama',
  diagramaId: 'Diagrama',
  diagramaFechaInicio: 'Fecha de inicio del ciclo',
  coordinadorId: 'Coordinador',
  supervisorId: 'Supervisor',
  dni: 'DNI',
  telefono: 'Teléfono',
  fechaDesde: 'Fecha desde',
  fechaHasta: 'Fecha hasta',
  motivo: 'Motivo',
  observaciones: 'Observaciones',
  nivel: 'Nivel',
  codigo: 'Código',
};

/** Forma esperada de zod: `parsed.error.flatten()`. */
interface DetallesFlatten {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

/** Forma cruda de zod: un array de issues (p. ej. `err.errors` o `err.issues` sin `.flatten()`). */
interface ZodIssueCrudo {
  path?: Array<string | number>;
  message?: string;
}

interface CuerpoDeError {
  error?: string;
  details?: DetallesFlatten | ZodIssueCrudo[];
}

/**
 * Si `details` es un array de issues crudos de zod (en vez del `{ formErrors,
 * fieldErrors }` que produce `.flatten()`), lo convierte a esa forma. Algún
 * endpoint puede desviarse del patrón del repo (ya pasó); esto evita que la
 * información del error se pierda en silencio cuando eso ocurre.
 */
function normalizarDetails(details: CuerpoDeError['details']): DetallesFlatten {
  if (!details) return {};
  if (!Array.isArray(details)) return details;

  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of details) {
    const mensaje = issue?.message ?? 'Valor inválido';
    if (issue?.path && issue.path.length > 0) {
      const campo = String(issue.path[0]);
      (fieldErrors[campo] ??= []).push(mensaje);
    } else {
      formErrors.push(mensaje);
    }
  }
  return { formErrors, fieldErrors };
}

export function mensajeDeError(err: unknown): ErrorLegible {
  const e = err as {
    code?: string;
    response?: { data?: CuerpoDeError };
    message?: string;
  };

  // Sin respuesta del servidor: es un problema de red, no de datos.
  if (!e?.response) {
    if (e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED') {
      return { mensaje: 'No se pudo conectar con el servidor. Revisá tu conexión.', fieldErrors: {} };
    }
    // Excepción de JS del cliente. Decirlo, no disfrazarla de error de conexión.
    return { mensaje: e?.message ? `Error inesperado: ${e.message}` : 'Error inesperado', fieldErrors: {} };
  }

  const data = e.response.data;
  if (!data) return { mensaje: 'El servidor respondió sin detalle', fieldErrors: {} };

  const { fieldErrors = {}, formErrors = [] } = normalizarDetails(data.details);

  const partes = [
    ...Object.entries(fieldErrors).map(([campo, msgs]) => `${ETIQUETAS[campo] ?? campo}: ${msgs.join('; ')}`),
    ...formErrors,
  ];

  if (partes.length > 0) {
    return { mensaje: `Revisá estos campos — ${partes.join(' · ')}`, fieldErrors };
  }
  return { mensaje: data.error ?? 'Ocurrió un error', fieldErrors };
}
