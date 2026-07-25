import assert from 'node:assert';
import { z } from 'zod';
import { instalarMensajesEnCastellano } from '../src/utils/zod-es.js';

async function run() {
  instalarMensajesEnCastellano();

  // 1. Campo faltante
  {
    const r = z.object({ nombre: z.string() }).safeParse({});
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.nombre?.[0] ?? '';
    assert.ok(!/required/i.test(msg), `no debe decir "Required": "${msg}"`);
    assert.ok(msg.length > 0, 'debe haber un mensaje');
  }
  // 2. Tipo equivocado
  {
    const r = z.object({ edad: z.number() }).safeParse({ edad: 'x' });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.edad?.[0] ?? '';
    assert.ok(!/expected|received/i.test(msg), `no debe estar en inglés: "${msg}"`);
  }
  // 3. Email inválido
  {
    const r = z.object({ email: z.string().email() }).safeParse({ email: 'no-es-mail' });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.email?.[0] ?? '';
    assert.ok(!/invalid email/i.test(msg), `no debe decir "Invalid email": "${msg}"`);
  }
  // 4. UUID inválido
  {
    const r = z.object({ sectorId: z.string().uuid() }).safeParse({ sectorId: 'abc' });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.sectorId?.[0] ?? '';
    assert.ok(!/invalid uuid/i.test(msg), `no debe decir "Invalid uuid": "${msg}"`);
  }
  // 5. Longitud mínima
  {
    const r = z.object({ p: z.string().min(8) }).safeParse({ p: 'abc' });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.p?.[0] ?? '';
    assert.ok(/8/.test(msg), `debe mencionar el 8: "${msg}"`);
    assert.ok(!/String must contain/i.test(msg), `no debe estar en inglés: "${msg}"`);
  }
  // 6. Un mensaje explícito del schema SIEMPRE gana sobre el map global
  {
    const r = z.object({ p: z.string().min(8, 'Mínimo 8 caracteres') }).safeParse({ p: 'a' });
    assert.ok(!r.success);
    assert.strictEqual(r.error.flatten().fieldErrors.p?.[0], 'Mínimo 8 caracteres');
  }
  // 7. Unión sin ninguna rama que matchee (como entradaTurno1 en planillas.routes.ts:
  // z.union([fechaFlexible, z.literal('')]) — acá replicado con string/literal)
  {
    const horaOpcional = z.union([z.string(), z.literal('')]);
    const r = z.object({ entradaTurno1: horaOpcional }).safeParse({ entradaTurno1: 123 });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.entradaTurno1?.[0] ?? '';
    assert.ok(!/invalid input/i.test(msg), `no debe decir "Invalid input": "${msg}"`);
    assert.ok(msg.length > 0, 'debe haber un mensaje útil');
  }
  // 8. Límite exclusivo (.gt): 0 está rechazado, no puede decir "el mínimo es 0"
  {
    const r = z.object({ n: z.number().gt(0) }).safeParse({ n: 0 });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.n?.[0] ?? '';
    assert.ok(!/mínimo es 0/i.test(msg), `no debe decir que 0 es válido cuando .gt(0) lo rechaza: "${msg}"`);
  }
  // 9. Nombres de tipo traducidos (no "boolean"/"string" crudos en inglés)
  {
    const r = z.object({ activo: z.boolean() }).safeParse({ activo: 'x' });
    assert.ok(!r.success);
    const msg = r.error.flatten().fieldErrors.activo?.[0] ?? '';
    assert.ok(/booleano/i.test(msg) && /texto/i.test(msg), `debe traducir los nombres de tipo: "${msg}"`);
  }
  console.log('✓ zod-es: 9/9 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
