/**
 * Verifica que GET /config/periodo sirva los días de ciclo a un rol no-admin.
 * Requiere el servidor en :4000 y la base sembrada.
 * Correr: cd apps/api && npx tsx tests/config-periodo.qa.ts
 */
const BASE = 'http://localhost:4000/api/v1';
const TS = Date.now();

function assert(c: boolean, m: string): asserts c { if (!c) throw new Error(m); }

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('application/json') ? await res.json() : await res.text() };
}

(async () => {
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? 'Admin2026!';
  const login = await api('POST', '/auth/login', { body: { email: 'admin@wenlen.com', password: adminPass } });
  assert(login.status === 200, `login admin → ${login.status} ${JSON.stringify(login.body)}`);
  const adminToken = login.body.accessToken as string;

  // 1. El admin lo lee
  const comoAdmin = await api('GET', '/config/periodo', { token: adminToken });
  assert(comoAdmin.status === 200, `admin → ${comoAdmin.status}`);
  assert(typeof comoAdmin.body.periodoDiaInicio === 'number', 'falta periodoDiaInicio');
  assert(typeof comoAdmin.body.periodoDiaFin === 'number', 'falta periodoDiaFin');
  console.log(`  ✓ admin lee ${comoAdmin.body.periodoDiaInicio}/${comoAdmin.body.periodoDiaFin}`);

  // 2. Un rol NO admin también — este es el caso que hoy daría 403
  const email = `qa.periodo.${TS}@wenlen.com`;
  const nuevo = await api('POST', '/usuarios', {
    token: adminToken,
    body: { nombre: 'Qa', apellido: 'Periodo', email, password: 'Test1234!', rol: 'SUPERVISOR', fechaIngreso: '2024-01-01T00:00:00.000Z' },
  });
  assert(nuevo.status === 201, `crear supervisor → ${nuevo.status} ${JSON.stringify(nuevo.body)}`);

  const loginSup = await api('POST', '/auth/login', { body: { email, password: 'Test1234!' } });
  assert(loginSup.status === 200, `login supervisor → ${loginSup.status}`);

  const comoSup = await api('GET', '/config/periodo', { token: loginSup.body.accessToken });
  assert(comoSup.status === 200, `supervisor → ${comoSup.status} (si es 403, la ruta quedó detrás de requireLevel)`);
  console.log('  ✓ supervisor lee la config de período');

  // 3. NO debe filtrar nada más que los dos campos
  const claves = Object.keys(comoSup.body).sort();
  assert(
    JSON.stringify(claves) === JSON.stringify(['periodoDiaFin', 'periodoDiaInicio']),
    `solo deben venir los dos campos de período, vinieron: ${claves.join(', ')}`,
  );
  console.log('  ✓ no filtra tarifas ni otros campos');

  await api('DELETE', `/usuarios/${nuevo.body.id}`, { token: adminToken });
  console.log('✓ config-periodo: 3/3 OK');
})().catch((e) => { console.error(e); process.exit(1); });
