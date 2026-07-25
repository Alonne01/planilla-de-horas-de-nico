import { z } from 'zod';

/**
 * Nombres de tipo de zod (`ZodParsedType` / `expected`/`received` de
 * `invalid_type`) traducidos. Son siempre nombres internos en inglés; sin
 * esto un usuario ve literalmente "se esperaba number y llegó string".
 * Fallback al nombre crudo para cualquier variante no contemplada.
 */
const NOMBRES_TIPO: Record<string, string> = {
  string: 'texto',
  number: 'número',
  integer: 'entero',
  float: 'decimal',
  nan: 'no numérico',
  boolean: 'booleano',
  array: 'lista',
  object: 'objeto',
  date: 'fecha',
  bigint: 'entero grande',
  symbol: 'símbolo',
  function: 'función',
  map: 'mapa',
  set: 'conjunto',
  promise: 'promesa',
  void: 'vacío',
  never: 'nunca',
  unknown: 'desconocido',
  null: 'nulo',
  undefined: 'nada',
};

function nombreTipo(tipo: string): string {
  return NOMBRES_TIPO[tipo] ?? tipo;
}

/**
 * Mensajes por defecto de zod en castellano.
 *
 * Se instala una sola vez al arrancar el servidor y afecta a los 39 usos de
 * `parsed.error.flatten()` que hay en las rutas. Un mensaje explícito en el
 * schema (`z.string().min(8, 'Mínimo 8 caracteres')`) siempre tiene prioridad
 * sobre esto: zod resuelve el mensaje explícito del issue antes de consultar
 * cualquier error map (ver `makeIssue` en zod/v3/helpers/parseUtil.js), así
 * que este mapa global solo se usa quando no hay mensaje explícito.
 *
 * Nota: un mapa global no puede saber qué significa una regex, así que las
 * reglas por regex necesitan su mensaje escrito a mano o devuelven el genérico.
 */
const mapaEnCastellano: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Campo obligatorio' };
      }
      return { message: `Se esperaba ${nombreTipo(issue.expected)} y llegó ${nombreTipo(issue.received)}` };

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Email inválido' };
      if (issue.validation === 'uuid') return { message: 'Identificador inválido' };
      if (issue.validation === 'url') return { message: 'URL inválida' };
      if (issue.validation === 'datetime') return { message: 'Fecha inválida' };
      if (issue.validation === 'regex') return { message: 'El formato no es válido' };
      return { message: 'Texto inválido' };

    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return issue.minimum === 1
          ? { message: 'Campo obligatorio' }
          : { message: `Mínimo ${issue.minimum} caracteres` };
      }
      if (issue.type === 'number') {
        return issue.inclusive
          ? { message: `El valor mínimo es ${issue.minimum}` }
          : { message: `El valor debe ser mayor a ${issue.minimum}` };
      }
      if (issue.type === 'array') return { message: `Mínimo ${issue.minimum} elementos` };
      if (issue.type === 'date') {
        return issue.inclusive
          ? { message: 'La fecha es anterior al mínimo permitido' }
          : { message: 'La fecha debe ser posterior a la fecha mínima permitida' };
      }
      return { message: 'Valor demasiado chico' };

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo ${issue.maximum} caracteres` };
      if (issue.type === 'number') {
        return issue.inclusive
          ? { message: `El valor máximo es ${issue.maximum}` }
          : { message: `El valor debe ser menor a ${issue.maximum}` };
      }
      if (issue.type === 'array') return { message: `Máximo ${issue.maximum} elementos` };
      if (issue.type === 'date') {
        return issue.inclusive
          ? { message: 'La fecha es posterior al máximo permitido' }
          : { message: 'La fecha debe ser anterior a la fecha máxima permitida' };
      }
      return { message: 'Valor demasiado grande' };

    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Valor inválido. Opciones: ${issue.options.join(', ')}` };

    case z.ZodIssueCode.invalid_date:
      return { message: 'Fecha inválida' };

    case z.ZodIssueCode.invalid_union:
      // No hay forma genérica de saber qué representa cada rama de la unión
      // (fecha, cadena vacía, etc.), así que el mensaje describe la situación
      // sin inventar detalle que el map no tiene: alcanza para que un usuario
      // de RRHH entienda que el valor no tiene un formato aceptado.
      return { message: 'El valor no tiene ninguno de los formatos permitidos para este campo' };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campos no reconocidos: ${issue.keys.join(', ')}` };

    case z.ZodIssueCode.not_multiple_of:
      return { message: `Debe ser múltiplo de ${issue.multipleOf}` };

    default:
      return { message: ctx.defaultError };
  }
};

export function instalarMensajesEnCastellano() {
  z.setErrorMap(mapaEnCastellano);
}
