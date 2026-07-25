import assert from 'node:assert';
import { mensajeDeError } from './errores.js';

async function run() {
  // 1. Error de validación: enumera los campos con etiquetas en castellano
  {
    const err = {
      response: { data: { error: 'Datos inválidos', details: {
        formErrors: [],
        fieldErrors: { password: ['Debe contener al menos una mayúscula'], email: ['Email inválido'] },
      } } },
    };
    const { mensaje, fieldErrors } = mensajeDeError(err);
    assert.ok(mensaje.includes('Contraseña'), `debe usar la etiqueta en castellano: "${mensaje}"`);
    assert.ok(mensaje.includes('Debe contener al menos una mayúscula'), `debe incluir el detalle: "${mensaje}"`);
    assert.deepStrictEqual(fieldErrors.password, ['Debe contener al menos una mayúscula']);
  }
  // 2. Error simple del servidor: se usa .error tal cual
  {
    const err = { response: { data: { error: 'Ya existe un usuario con ese email' } } };
    assert.strictEqual(mensajeDeError(err).mensaje, 'Ya existe un usuario con ese email');
  }
  // 3. Sin conexión: mensaje de red, NO el genérico
  {
    const err = { code: 'ERR_NETWORK', message: 'Network Error' };
    const { mensaje } = mensajeDeError(err);
    assert.ok(/conexión|conexion/i.test(mensaje), `debe hablar de conexión: "${mensaje}"`);
  }
  // 4. Excepción de JS del cliente: NO debe disfrazarse de error de conexión
  {
    const { mensaje } = mensajeDeError(new RangeError('Invalid time value'));
    assert.ok(!/conexión|conexion/i.test(mensaje), `no debe mentir sobre la conexión: "${mensaje}"`);
    assert.ok(mensaje.length > 0, 'debe haber un mensaje');
  }
  // 5. Campo sin etiqueta conocida: se usa el nombre crudo, no se rompe
  {
    const err = { response: { data: { error: 'Datos inválidos', details: {
      formErrors: [], fieldErrors: { campoRaro: ['algo'] },
    } } } };
    assert.ok(mensajeDeError(err).mensaje.includes('campoRaro'));
  }
  // 6. formErrors (errores que no son de un campo) también se muestran
  {
    const err = { response: { data: { error: 'Datos inválidos', details: {
      formErrors: ['La fecha de fin es anterior a la de inicio'], fieldErrors: {},
    } } } };
    assert.ok(mensajeDeError(err).mensaje.includes('anterior a la de inicio'));
  }
  // 7. Respuesta vacía del servidor: no explota
  {
    const { mensaje, fieldErrors } = mensajeDeError({ response: { data: undefined } });
    assert.ok(mensaje.length > 0);
    assert.deepStrictEqual(fieldErrors, {});
  }
  // 8. `details` como array crudo de issues de zod (endpoint desviado del patrón
  // `.flatten()`, como capacitaciones.routes.ts/admin.alertas.routes.ts antes del fix):
  // no debe perderse en silencio y caer en "Datos inválidos" a secas.
  {
    const err = {
      response: { data: { error: 'Datos inválidos', details: [
        { path: ['nombre'], message: 'Mínimo 2 caracteres' },
        { path: [], message: 'Error general del formulario' },
      ] } },
    };
    const { mensaje, fieldErrors } = mensajeDeError(err);
    assert.ok(mensaje.includes('Nombre'), `debe usar la etiqueta en castellano: "${mensaje}"`);
    assert.ok(mensaje.includes('Mínimo 2 caracteres'), `debe incluir el detalle: "${mensaje}"`);
    assert.ok(mensaje.includes('Error general del formulario'), `debe incluir el error sin campo: "${mensaje}"`);
    assert.deepStrictEqual(fieldErrors.nombre, ['Mínimo 2 caracteres']);
  }
  console.log('✓ errores: 8/8 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
