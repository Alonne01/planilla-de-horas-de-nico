# Correcciones del recorrido por la app — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 8 frentes del spec `docs/superpowers/specs/2026-07-25-recorrido-app-correcciones-design.md`: 4 bugs reales (períodos, WENTOP, errores mudos, seed no idempotente) y 4 mejoras de UI (emojis, layout de Cierre, permisos por nivel, limpieza de datos).

**Architecture:** Monorepo sin workspaces: `apps/api` (Express + Prisma + tsx) y `apps/web` (React + Vite + Tailwind v4), cada uno con su `package.json`. Los cambios de lógica pura se extraen a módulos `.ts` testeables; la UI se verifica con `tsc` + `eslint` + navegador. El orden de tareas está pensado para que los frentes no colisionen entre sí: primero base de datos, después lógica, y los emojis al final porque tocan 11 archivos de forma superficial.

**Tech Stack:** TypeScript, Express 4, Prisma, PostgreSQL 16, React 19, Vite, TanStack Query, Tailwind CSS v4, zod 3.25, tsx.

---

## Convenciones de este proyecto (leer antes de empezar)

**No hay framework de tests.** No existe vitest/jest/mocha. Hay dos estilos ya establecidos y este plan usa los dos:

1. **Test unitario puro** — `node:assert` + una función `run()`, sin servidor ni base.
   Referencia: `apps/api/tests/calendario-access.test.ts`. Se corre con `npx tsx <archivo>`.
2. **Suite de integración** — `fetch` contra `http://localhost:4000/api/v1` con helpers `check()`/`assert()`.
   Referencia: `apps/api/tests/qa/_verify-fixes.qa.ts`. Requiere el servidor levantado y la base sembrada.

**No inventes un framework de tests.** Si una tarea no dice "escribí un test", es porque el cambio es de presentación pura y se verifica con `tsc -b`, `eslint` y el navegador.

**Comandos de verificación siempre disponibles:**

```bash
cd apps/web && npx tsc -b --noEmit    # typecheck del front
cd apps/web && npx eslint .           # lint del front
cd apps/api && npx tsc --noEmit       # typecheck del API
```

**Advertencia sobre las suites QA existentes:** `apps/api/tests/qa/*.qa.ts` hacen login con usuarios `@demo.com` que **no existen** después del reset de la Tarea 5. No las uses como criterio de éxito en este plan; están rotas por diseño hasta que se vuelva a sembrar.

---

## Estructura de archivos

**Archivos nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `apps/web/src/utils/periodos.ts` | Matemática pura de ciclos de planilla (hoy embebida en un componente React) |
| `apps/web/src/utils/periodos.test.ts` | Tests unitarios de lo anterior |
| `apps/web/src/hooks/usePeriodoConfig.ts` | Lee la config de período del servidor y expone el período actual |
| `apps/web/src/lib/errores.ts` | Traduce un error de axios a `{ mensaje, fieldErrors }` |
| `apps/web/src/lib/errores.test.ts` | Tests unitarios de lo anterior |
| `apps/api/src/routes/config.routes.ts` | `GET /config/periodo` para cualquier usuario autenticado |
| `apps/api/src/utils/zod-es.ts` | Error map global de zod en castellano |
| `apps/api/tests/zod-es.test.ts` | Tests unitarios del error map |
| `apps/api/tests/seed-idempotente.test.ts` | Verifica que sembrar dos veces no duplique |

**Archivos modificados de fondo:** `apps/web/src/components/layout/PeriodSelector.tsx`, `apps/web/src/pages/WentopPage.tsx`, `apps/web/src/pages/admin/UsuariosPage.tsx`, `apps/web/src/pages/admin/CierrePage.tsx`, `apps/web/src/pages/admin/RolesPage.tsx`, `apps/web/src/pages/admin/FlujosPage.tsx`, `apps/api/prisma/seed.ts`, `apps/api/prisma/reset-testing.ts`.

---

## Fase 0 — Preparación

### Task 1: Respaldo y foto del estado inicial

**Files:** ninguno (operativo)

- [ ] **Step 1: Respaldar la base**

```bash
cd "C:/dev/planilla de horas"
pg_dump "postgresql://postgres:postgres@localhost:5432/planilla_horas" > "backup-pre-correcciones-2026-07-25.sql"
```

Si la `DATABASE_URL` real difiere, tomarla de `apps/api/.env`. **No continuar sin un dump válido:** la Tarea 5 es destructiva e irreversible.

- [ ] **Step 2: Verificar que el dump no está vacío**

```bash
ls -la "backup-pre-correcciones-2026-07-25.sql"
```

Esperado: tamaño mayor a 100 KB.

- [ ] **Step 3: Registrar los conteos de partida**

```bash
psql "postgresql://postgres:postgres@localhost:5432/planilla_horas" -c "SELECT (SELECT count(*) FROM empresas) AS empresas, (SELECT count(*) FROM diagramas) AS diagramas, (SELECT count(*) FROM usuarios) AS usuarios;"
```

Esperado hoy: `empresas=3, diagramas=48, usuarios=2`. Anotar el resultado real: la Tarea 5 lo compara.

- [ ] **Step 4: Confirmar que el dump está fuera del control de versiones**

```bash
git status --short
```

Esperado: el `.sql` **no** aparece como archivo nuevo a commitear. Si aparece, agregar `backup-*.sql` a `.gitignore` y commitear solo el `.gitignore`.

---

## Frente H — Seed idempotente

### Task 2: Test que demuestra que el seed duplica

**Files:**
- Create: `apps/api/tests/seed-idempotente.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Este test no llama al seed (tarda minutos y crea 200 usuarios): verifica la **función de búsqueda-o-creación** que el seed va a usar. Empezamos por el helper porque es la pieza que hoy no existe.

```ts
// apps/api/tests/seed-idempotente.test.ts
import assert from 'node:assert';
import { buscarOCrear } from '../prisma/seed-helpers.js';

// Delegado falso: simula una tabla en memoria con findFirst/create de Prisma.
function tablaFalsa(filasIniciales: Record<string, unknown>[] = []) {
  const filas = [...filasIniciales];
  let creaciones = 0;
  return {
    creaciones: () => creaciones,
    filas: () => filas,
    delegado: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        filas.find((f) => Object.entries(where).every(([k, v]) => f[k] === v)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creaciones++;
        const fila = { id: `id-${filas.length + 1}`, ...data };
        filas.push(fila);
        return fila;
      },
    },
  };
}

async function run() {
  // 1. Tabla vacía → crea, y lo informa
  {
    const t = tablaFalsa();
    const { fila, creada } = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    assert.strictEqual(t.creaciones(), 1, 'debe crear cuando no existe');
    assert.strictEqual(creada, true, 'debe informar que la creó');
    assert.strictEqual(fila.nombre, 'WENLEN');
  }
  // 2. Segunda llamada con la misma clave → NO crea, devuelve la existente
  {
    const t = tablaFalsa();
    const a = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    const b = await buscarOCrear(t.delegado, { nombre: 'WENLEN' }, { nombre: 'WENLEN', cuit: '30-1' });
    assert.strictEqual(t.creaciones(), 1, 'la segunda llamada NO debe crear');
    assert.strictEqual(b.creada, false, 'debe informar que ya existía');
    assert.strictEqual(a.fila.id, b.fila.id, 'debe devolver la misma fila');
    assert.strictEqual(t.filas().length, 1, 'la tabla debe quedar con una sola fila');
  }
  // 3. Clave compuesta: mismo nombre en otra empresa SÍ crea
  {
    const t = tablaFalsa();
    await buscarOCrear(t.delegado, { empresaId: 'e1', nombre: 'Fractura' }, { empresaId: 'e1', nombre: 'Fractura' });
    await buscarOCrear(t.delegado, { empresaId: 'e2', nombre: 'Fractura' }, { empresaId: 'e2', nombre: 'Fractura' });
    assert.strictEqual(t.creaciones(), 2, 'misma clave en otra empresa es otra fila');
  }
  // 4. No pisa los datos existentes: si la fila existe, `data` se ignora
  {
    const t = tablaFalsa([{ id: 'x', empresaId: 'e1', nombre: 'Cfg', valor: 'ORIGINAL' }]);
    const { fila, creada } = await buscarOCrear(t.delegado, { empresaId: 'e1', nombre: 'Cfg' }, { empresaId: 'e1', nombre: 'Cfg', valor: 'NUEVO' });
    assert.strictEqual(fila.valor, 'ORIGINAL', 'no debe pisar el valor existente');
    assert.strictEqual(creada, false);
    assert.strictEqual(t.creaciones(), 0);
  }
  console.log('✓ seed-idempotente: 4/4 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd apps/api && npx tsx tests/seed-idempotente.test.ts
```

Esperado: FALLA con `Cannot find module '../prisma/seed-helpers.js'`.

- [ ] **Step 3: Implementar el helper**

```ts
// apps/api/prisma/seed-helpers.ts
/**
 * Búsqueda-o-creación para el seed. Hace idempotente cualquier tabla, incluso
 * las que no tienen restricción única sobre su clave natural (sector, diagrama,
 * flujo), sin necesidad de migrar el schema.
 *
 * Si la fila ya existe se devuelve tal cual: NUNCA se pisa con `data`. Eso evita
 * revertir configuración que el usuario o el servidor hayan cambiado después
 * del primer sembrado.
 *
 * Devuelve `creada` para que el seed pueda informar cuántas filas creó de
 * verdad, en vez de imprimir cantidades fijas que serían mentira en una
 * segunda corrida.
 */
export interface DelegadoBuscable {
  findFirst(args: { where: Record<string, unknown> }): Promise<any>;
  create(args: { data: Record<string, unknown> }): Promise<any>;
}

export async function buscarOCrear(
  delegado: DelegadoBuscable,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ fila: any; creada: boolean }> {
  const existente = await delegado.findFirst({ where });
  if (existente) return { fila: existente, creada: false };
  return { fila: await delegado.create({ data }), creada: true };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
cd apps/api && npx tsx tests/seed-idempotente.test.ts
```

Esperado: `✓ seed-idempotente: 4/4 OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed-helpers.ts apps/api/tests/seed-idempotente.test.ts
git commit -m "test(api): helper de busqueda-o-creacion para el seed"
```

---

### Task 3: Aplicar el helper a las 12 escrituras del seed

**Files:**
- Modify: `apps/api/prisma/seed.ts:469`, `:490`, `:511`, `:535`, `:630`, `:652`, `:666`, `:689`, `:722`, `:758`, `:763`, `:768`

**Contexto:** hoy las 12 escrituras son `.create()` puro. `Empresa.cuit` no es único (`schema.prisma:83-117`), así que se duplica la empresa; `Usuario.email` sí lo es (`:295`), así que la corrida explota con P2002 al llegar al admin y deja la empresa huérfana.

- [ ] **Step 1: Importar el helper**

Agregar al bloque de imports del principio de `apps/api/prisma/seed.ts`:

```ts
import { buscarOCrear } from './seed-helpers.js';
```

- [ ] **Step 2: Empresa — reutilizar si ya existe (`:469-475`)**

```ts
  const { fila: empresa } = await buscarOCrear(
    prisma.empresa,
    { cuit: '30-12345678-9' },
    { nombre: 'WENLEN', cuit: '30-12345678-9' },
  );
  console.log('✅ Empresa:', empresa.nombre, `(${empresa.id})`);
```

- [ ] **Step 3: Roles (`:489-491`)**

`RolConfig` tiene `@@unique([empresaId, codigo])` (`schema.prisma:131`), así que la clave natural es esa.

```ts
  let rolesCreados = 0;
  for (const r of rolesData) {
    const { creada } = await buscarOCrear(
      prisma.rolConfig,
      { empresaId: empresa.id, codigo: r.codigo },
      { empresaId: empresa.id, ...r },
    );
    if (creada) rolesCreados++;
  }
  console.log(`✅ Roles del sistema: ${rolesCreados} creados, ${rolesData.length - rolesCreados} ya existían`);
```

- [ ] **Step 4: Sectores (`:509-516`)**

El mapa `sectores` tiene que poblarse exista o no la fila, porque las etapas 6 y 10 lo usan.

```ts
  const sectores: Record<string, string> = {};
  let sectoresCreados = 0;
  for (const s of sectoresData) {
    const { fila, creada } = await buscarOCrear(
      prisma.sector,
      { empresaId: empresa.id, nombre: s.nombre },
      { empresaId: empresa.id, ...s },
    );
    if (creada) sectoresCreados++;
    sectores[s.nombre] = fila.id;
  }
  console.log(`✅ Sectores: ${sectoresCreados} creados, ${sectoresData.length - sectoresCreados} ya existían`);
```

- [ ] **Step 5: Diagramas (`:533-545`)**

```ts
  const diagramas: Record<string, string> = {};
  let diagramasCreados = 0;
  for (const d of diagramasData) {
    const { fila, creada } = await buscarOCrear(
      prisma.diagrama,
      { empresaId: empresa.id, nombre: d.nombre },
      {
        empresaId: empresa.id,
        nombre: d.nombre,
        tipo: d.tipo,
        diasTrabajo: d.diasTrabajo ?? null,
        diasDescanso: d.diasDescanso ?? null,
        diasSemana: d.diasSemana ?? [],
        descripcion: d.descripcion,
      },
    );
    if (creada) diagramasCreados++;
    diagramas[d.nombre] = fila.id;
  }
  console.log(`✅ Diagramas: ${diagramasCreados} creados, ${diagramasData.length - diagramasCreados} ya existían`);
```

**Ojo:** la asignación al mapa `diagramas` de la línea 546 original queda cubierta por este bloque; verificar que no quede duplicada al editar.

- [ ] **Step 6: Flujos de aprobación (`:629-646`)**

El `create` anidado de `pasos` solo debe correr cuando el flujo se crea.

```ts
  let flujosCreados = 0;
  for (const fc of flujosConfig) {
    const { fila, creada } = await buscarOCrear(
      prisma.flujoAprobacion,
      { empresaId: empresa.id, nombre: fc.nombre },
      {
        empresaId: empresa.id,
        nombre: fc.nombre,
        tipoDocumento: fc.tipoDocumento,
        descripcion: fc.descripcion,
        pasos: { create: fc.pasos },
      },
    );
    if (creada) flujosCreados++;

    let patron: string;
    if (fc.nombre.includes('Coordinador')) patron = 'A';
    else if (fc.nombre.includes('Supervisor')) patron = 'B';
    else patron = 'C';
    flujos[`${fc.tipoDocumento}_${patron}`] = fila.id;
  }
  console.log(`✅ Flujos de aprobación: ${flujosCreados} creados, ${flujosConfig.length - flujosCreados} ya existían`);
```

El `create` anidado de `pasos` solo corre cuando `buscarOCrear` decide crear, así que un flujo existente no acumula pasos duplicados.

- [ ] **Step 7: Las dos configs (`:652-678`)**

`EmpresaConfig` y `VacacionesConfig` tienen `empresaId @unique` (`schema.prisma:504`, `:626`), así que acá sí se puede `upsert`. **El `update` va vacío a propósito:** si la config ya existe no se toca, para no revertir los días de período que configuró el usuario ni los feriados que sincronizó el servidor.

```ts
  await prisma.empresaConfig.upsert({
    where: { empresaId: empresa.id },
    update: {},
    create: { empresaId: empresa.id, feriadosPersonalizados: FERIADOS_PETROLEROS },
  });
  console.log('✅ Config de empresa (no se pisa si ya existía)');

  await prisma.vacacionesConfig.upsert({
    where: { empresaId: empresa.id },
    update: {},
    create: {
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
  console.log('✅ Config de vacaciones (no se pisa si ya existía)');
```

- [ ] **Step 8: Usuarios (`:689-703` y `:721-743`)**

**Nunca actualizar un usuario existente:** pisaría el `passwordHash` de alguien que ya cambió su contraseña y revertiría `primerLogin`.

Admin:

```ts
  const { creada: adminCreado } = await buscarOCrear(
    prisma.usuario,
    { email: 'admin@wenlen.com' },
    {
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
      primerLogin: true,
    },
  );
  console.log(adminCreado
    ? '✅ Cuenta admin del sistema creada: admin@wenlen.com'
    : '↩️  admin@wenlen.com ya existía, no se toca');
```

Nómina — reemplazar el cuerpo del `for` de la línea 721:

```ts
  let userCount = 0;
  let userSkipped = 0;
  for (const emp of EMPLEADOS) {
    const { creada } = await buscarOCrear(
      prisma.usuario,
      { email: emp.email },
      {
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
        primerLogin: true,
      },
    );
    if (!creada) { userSkipped++; continue; }
    userCount++;
    if (userCount % 50 === 0) console.log(`  ... ${userCount} usuarios creados`);
  }
  console.log(`✅ Usuarios: ${userCount} creados, ${userSkipped} ya existían`);
```

**Un usuario existente nunca se actualiza:** pisaría el `passwordHash` de alguien que ya cambió su contraseña y revertiría `primerLogin`. `buscarOCrear` garantiza esto por construcción.

- [ ] **Step 9: Asignaciones de flujo (`:756-772`)**

```ts
  let asignacionesCreadas = 0;
  const asignar = async (flujoId: string, tipo: string, sectorId: string) => {
    const { creada } = await buscarOCrear(
      prisma.flujoAsignacion,
      { flujoId, tipoDocumento: tipo, sectorId },
      { flujoId, tipoDocumento: tipo, sectorId },
    );
    if (creada) asignacionesCreadas++;
  };

  for (const tipo of ['PLANILLA', 'VACACION', 'AUSENCIA', 'CAMBIO_DIAGRAMA'] as const) {
    for (const s of sectoresPatronA) await asignar(flujos[`${tipo}_A`], tipo, sectores[s]);
    for (const s of sectoresPatronB) await asignar(flujos[`${tipo}_B`], tipo, sectores[s]);
    for (const s of sectoresPatronC) await asignar(flujos[`${tipo}_C`], tipo, sectores[s]);
  }
  console.log(`✅ Asignaciones de flujo: ${asignacionesCreadas} creadas`);
```

- [ ] **Step 10: Resumen honesto (`:775-781` y siguientes)**

El resumen actual imprime cantidades fijas («9 sectores», «12 flujos») que serían mentira en una corrida parcial. Reemplazar esos `console.log` de cantidades fijas por los contadores reales ya calculados (`sectoresCreados`, `flujosCreados`, `userCount`, `asignacionesCreadas`).

- [ ] **Step 11: Actualizar el encabezado del archivo**

Agregar arriba de todo, documentando la decisión y su límite:

```ts
/**
 * seed.ts — Siembra los datos base de la empresa.
 *
 * ES IDEMPOTENTE: correrlo dos veces no duplica nada. Cada entidad se busca por
 * su clave natural antes de crearse, y las filas existentes NUNCA se pisan.
 *
 * Límite conocido: sectores, diagramas y flujos se identifican por `nombre`.
 * Si alguien renombra uno desde la UI, una corrida posterior del seed lo vuelve
 * a crear con el nombre original.
 */
```

- [ ] **Step 12: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 13: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "fix(prisma): hacer idempotente el seed

Las 12 escrituras eran .create() puro. Como Empresa.cuit no es unico se creaba
una empresa duplicada, y como Usuario.email si lo es la corrida explotaba con
P2002 al llegar al admin, dejando la empresa a medio sembrar y sin usuarios."
```

---

## Frente E — Reset completo de la base

### Task 4: Sumar los prefijos de simulación al reset

**Files:**
- Modify: `apps/api/prisma/reset-testing.ts:27`

- [ ] **Step 1: Agregar los prefijos**

```ts
// apps/api/prisma/reset-testing.ts:27
const PREFIJOS_DE_PRUEBA = ['qa-', 'Verif', 'verif-', 'hunt-', 'smoke-', 'sim-', 'sim3-'];
```

La comparación de la línea 30 es case-insensitive, así que `'sim3-'` cubre `SIM3-`. Verificado que ninguno de los 9 nombres reales (`Lun-Vier`, `7×7`, `10×5`, `14×14`, `8×6`, `21×7`, `2×1 (8×4)`, `14×7`, `10×4`) empieza con estos prefijos.

- [ ] **Step 2: Actualizar el comentario del encabezado (`:9-10`)**

```ts
 *   - La configuración creada por corridas de prueba: sectores, flujos y
 *     diagramas cuyo nombre empieza con "qa-", "Verif", "hunt-", "smoke-" o "sim-"
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/reset-testing.ts
git commit -m "fix(prisma): reconocer los diagramas SIM3 como datos de prueba"
```

---

### Task 5: Ejecutar el reset

**Files:** ninguno (operativo). **Destructivo e irreversible sin el dump de la Tarea 1.**

- [ ] **Step 1: Confirmar que existe el dump**

```bash
ls -la "C:/dev/planilla de horas/backup-pre-correcciones-2026-07-25.sql"
```

**Si no existe, volver a la Tarea 1. No continuar.**

- [ ] **Step 2: Simulacro**

```bash
cd apps/api && npx tsx prisma/reset-testing.ts --dry-run
```

Esperado en la salida:
- `Admin preservado: Administrador Sistema (admin@wenlen.com)`
- `diagramas de prueba: 21 → SIM3-Rotativo-..., sim-admin-config-...`
- `empresas a borrar: 2`

**Si el conteo de diagramas de prueba no es 21, parar y revisar el regex antes de seguir.**

- [ ] **Step 3: Ejecutar el reset de verdad**

```bash
cd apps/api && npx tsx prisma/reset-testing.ts
```

Esperado: tabla de resumen con las cantidades borradas.

- [ ] **Step 4: Verificar el estado final**

```bash
psql "postgresql://postgres:postgres@localhost:5432/planilla_horas" -c "SELECT (SELECT count(*) FROM empresas) AS empresas, (SELECT count(*) FROM diagramas) AS diagramas, (SELECT count(*) FROM usuarios) AS usuarios, (SELECT concat(periodo_dia_inicio,'/',periodo_dia_fin) FROM empresa_config) AS periodo;"
```

Esperado: `empresas=1, diagramas=9, usuarios=1, periodo=16/15`.

**El `periodo=16/15` es la verificación clave:** confirma que el reset conservó la configuración y que el guardado del frente B efectivamente había persistido. Si dijera `21/20`, el `PUT /admin/config` nunca había funcionado y hay que revisar eso antes de la Tarea 8.

- [ ] **Step 5: Verificar que el seed idempotente funciona sobre la base limpia**

```bash
cd apps/api && npm run db:seed && npm run db:seed
```

Esperado: la segunda corrida termina sin error y con mensajes «ya existían». Después:

```bash
psql "postgresql://postgres:postgres@localhost:5432/planilla_horas" -c "SELECT count(*) FROM empresas;"
```

Esperado: `1`. **Antes de este arreglo, acá habría 3.**

---

### Task 6: Tapar el hueco del DELETE de diagramas

**Files:**
- Modify: `apps/api/src/routes/admin.diagramas.routes.ts:131-160`
- Modify: `apps/web/src/pages/admin/DiagramasPage.tsx:38-41`

**Contexto:** el DELETE valida asignaciones activas e históricas, pero **no** consulta `solicitudes_cambio_diagrama`, cuya FK `diagrama_nuevo_id` es `RESTRICT`. Un diagrama referenciado por una solicitud tira P2003 y el catch lo devuelve como 500 opaco. Y `DiagramasPage` no tiene `onError`, así que ni el 409 ni el 500 se ven.

- [ ] **Step 1: Agregar el chequeo antes del borrado físico**

Insertar antes del `prisma.diagrama.delete(...)` de la línea ~155:

```ts
    const solicitudes = await prisma.solicitudCambioDiagrama.count({
      where: { OR: [{ diagramaNuevoId: id }, { diagramaActualId: id }] },
    });
    if (solicitudes > 0) {
      await prisma.diagrama.update({ where: { id }, data: { activo: false } });
      res.status(200).json({
        mensaje: 'El diagrama tiene solicitudes de cambio asociadas, se desactivó en lugar de borrarse',
        desactivado: true,
      });
      return;
    }
```

- [ ] **Step 2: Agregar `onError` en el front**

```ts
// apps/web/src/pages/admin/DiagramasPage.tsx:38-41
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/admin/diagramas/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['diagramas'] }); },
    onError: (err) => { toast.error(mensajeDeError(err).mensaje); },
  });
```

**Dependencia:** `mensajeDeError` se crea en la Tarea 17. Si esta tarea se ejecuta antes, usar
`(err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'No se pudo borrar el diagrama'`
y volver acá después de la Tarea 17.

- [ ] **Step 3: Typecheck de ambos lados**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin.diagramas.routes.ts apps/web/src/pages/admin/DiagramasPage.tsx
git commit -m "fix(api,web): no devolver un 500 opaco al borrar un diagrama con solicitudes"
```

---

## Frente B — Los períodos ignoran la configuración

### Task 7: Extraer y testear la matemática de períodos

**Files:**
- Create: `apps/web/src/utils/periodos.ts`
- Create: `apps/web/src/utils/periodos.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/components/layout/PeriodSelector.tsx:1-68`

**Por qué extraer:** `generateCycles` y `getCurrentPeriod` son matemática pura de fechas, pero viven dentro de un componente React que importa `lucide-react` y `useMemo`. Así son imposibles de testear sin montar React. Sacarlas a un `.ts` plano es el prerrequisito para poder escribir el test que demuestra el bug.

- [ ] **Step 1: Habilitar tests en `apps/web`**

`apps/web` hoy no tiene forma de correr un `.ts` suelto. Agregar `tsx` como dependencia de desarrollo y un script, replicando la convención de `apps/api`:

```bash
cd apps/web && npm install --save-dev tsx
```

Y en `apps/web/package.json`, dentro de `"scripts"`:

```json
    "test:unit": "tsx src/utils/periodos.test.ts && tsx src/lib/errores.test.ts",
```

**Nota:** `src/lib/errores.test.ts` se crea en la Tarea 17. Hasta entonces `npm run test:unit` va a fallar en la segunda mitad; correr los tests de a uno con `npx tsx <archivo>` mientras tanto.

- [ ] **Step 2: Escribir el test que falla**

```ts
// apps/web/src/utils/periodos.test.ts
import assert from 'node:assert';
import { generateCycles, getCurrentPeriod } from './periodos.js';

async function run() {
  // 1. EL BUG REPORTADO: con 16/15 el ciclo actual debe ser 16 Jul - 15 Ago
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '16 Jul - 15 Ago 2026', `esperaba 16/15, fue "${c.label}"`);
  }
  // 2. El comportamiento viejo sigue siendo correcto cuando se piden 21/20
  {
    const [c] = generateCycles(1, 21, 20, new Date(2026, 6, 25));
    assert.strictEqual(c.label, '21 Jul - 20 Ago 2026', `esperaba 21/20, fue "${c.label}"`);
  }
  // 3. Antes del día de inicio, el ciclo vigente es el que arrancó el mes pasado
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 6, 10));
    assert.strictEqual(c.label, '16 Jun - 15 Jul 2026', `esperaba el ciclo anterior, fue "${c.label}"`);
  }
  // 4. Cruce de año: el año se muestra en el inicio solo si difiere del fin
  {
    const [c] = generateCycles(1, 16, 15, new Date(2026, 0, 5));
    assert.strictEqual(c.label, '16 Dic 2025 - 15 Ene 2026', `esperaba cruce de año, fue "${c.label}"`);
  }
  // 5. CLAMP: día 31 en febrero no debe desbordar a marzo
  {
    const [c] = generateCycles(1, 31, 30, new Date(2026, 2, 5));
    assert.ok(c.label.startsWith('28 Feb'), `dia 31 en feb debe caer al 28, fue "${c.label}"`);
  }
  // 6. Devuelve exactamente la cantidad pedida, en orden descendente
  {
    const cs = generateCycles(12, 16, 15, new Date(2026, 6, 25));
    assert.strictEqual(cs.length, 12, 'deben ser 12 ciclos');
    assert.ok(new Date(cs[0].inicio) > new Date(cs[1].inicio), 'el más reciente va primero');
  }
  // 7. getCurrentPeriod respeta los días que recibe
  {
    const p = getCurrentPeriod(16, 15, new Date(2026, 6, 25));
    assert.strictEqual(new Date(p.inicio).getDate(), 16, 'el período actual debe empezar el 16');
  }
  console.log('✓ periodos: 7/7 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Correr y verificar que falla**

```bash
cd apps/web && npx tsx src/utils/periodos.test.ts
```

Esperado: FALLA con `Cannot find module './periodos.js'`.

- [ ] **Step 4: Crear el módulo**

Mover el código de `PeriodSelector.tsx:5-68` sin cambiarle la lógica, salvo dos cosas: el parámetro `hoy` (para poder testear) y el clamp de fin de mes.

```ts
// apps/web/src/utils/periodos.ts
/**
 * Matemática de los ciclos de planilla. Sin React a propósito: es lógica pura
 * y así se puede testear con `npx tsx src/utils/periodos.test.ts`.
 *
 * Los días de inicio y fin del ciclo los configura el usuario en Administración
 * > Configuración y los sirve `GET /config/periodo`. Los defaults 21/20 son solo
 * un último recurso para el primer render, antes de que llegue la respuesta.
 */

const MESES_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

export const DIA_INICIO_POR_DEFECTO = 21;
export const DIA_FIN_POR_DEFECTO = 20;

export interface Cycle {
  inicio: string;
  fin: string;
  label: string;
}

/**
 * Construye una fecha sin desbordar al mes siguiente. `new Date(2026, 1, 31)`
 * devuelve el 3 de marzo; esto devuelve el 28 de febrero. Hace falta porque el
 * día de inicio del período lo elige el usuario y el backend acepta hasta 31.
 */
function fechaEnMes(anio: number, mes: number, dia: number): Date {
  const base = new Date(anio, mes, 1); // normaliza meses fuera de rango (negativos o >11)
  const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(dia, ultimoDia));
}

export function generateCycles(
  count: number,
  diaInicio: number = DIA_INICIO_POR_DEFECTO,
  diaFin: number = DIA_FIN_POR_DEFECTO,
  hoy: Date = new Date(),
): Cycle[] {
  const cycles: Cycle[] = [];
  let startYear = hoy.getFullYear();
  let startMonth = hoy.getMonth();

  if (hoy.getDate() < diaInicio) {
    // Todavía no arrancó el ciclo de este mes: el vigente empezó el mes pasado.
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  for (let i = 0; i < count; i++) {
    const inicioDate = fechaEnMes(startYear, startMonth - i, diaInicio);
    const finDate = fechaEnMes(startYear, startMonth - i + 1, diaFin);

    const fYear = finDate.getFullYear();
    // El año en el inicio solo se muestra si difiere del año del fin.
    const iYearStr = inicioDate.getFullYear() !== fYear ? ` ${inicioDate.getFullYear()}` : '';

    cycles.push({
      inicio: inicioDate.toISOString(),
      fin: finDate.toISOString(),
      label: `${inicioDate.getDate()} ${MESES_ES[inicioDate.getMonth()]}${iYearStr} - ${finDate.getDate()} ${MESES_ES[finDate.getMonth()]} ${fYear}`,
    });
  }

  return cycles;
}

export function getCurrentPeriod(
  diaInicio: number = DIA_INICIO_POR_DEFECTO,
  diaFin: number = DIA_FIN_POR_DEFECTO,
  hoy: Date = new Date(),
): { inicio: string; fin: string } {
  const [current] = generateCycles(1, diaInicio, diaFin, hoy);
  return { inicio: current.inicio, fin: current.fin };
}
```

- [ ] **Step 5: Correr y verificar que pasa**

```bash
cd apps/web && npx tsx src/utils/periodos.test.ts
```

Esperado: `✓ periodos: 7/7 OK`

- [ ] **Step 6: Dejar `PeriodSelector` re-exportando**

Borrar de `PeriodSelector.tsx` las líneas 5-68 (constantes, `Cycle`, `generateCycles`, `getCurrentPeriod`) y poner arriba:

```ts
import { useMemo, useRef, useState, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { generateCycles, getCurrentPeriod, type Cycle } from '../../utils/periodos';

// Re-exportadas por compatibilidad: las 5 páginas las importan desde acá.
export { generateCycles, getCurrentPeriod };
```

Así los 5 imports existentes (`AprobacionesPage:14`, `CierrePage:12`, `VacacionesPage:14`, `AnalyticsPage:11`, `AusenciasPage:15`) siguen funcionando sin tocarlos.

- [ ] **Step 7: Typecheck**

```bash
cd apps/web && npx tsc -b --noEmit
```

Esperado: sin errores.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/utils/periodos.ts apps/web/src/utils/periodos.test.ts apps/web/src/components/layout/PeriodSelector.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "refactor(web): extraer la matematica de periodos a un modulo testeable

Agrega el clamp de fin de mes: con dia 31, new Date(2026,1,31) desbordaba al
3 de marzo. No se disparaba con 21/20 pero el backend acepta hasta 31."
```

---

### Task 8: Endpoint `GET /config/periodo`

**Files:**
- Create: `apps/api/src/routes/config.routes.ts`
- Modify: `apps/api/src/routes/index.ts`
- Create: `apps/api/tests/config-periodo.qa.ts`

**Por qué un endpoint nuevo:** `GET /admin/config` está detrás de `requireLevel(LEVEL_ADMIN)` aplicado a todo el router (`admin.config.routes.ts:11`) y devuelve el objeto completo, incluidas `tarifaViajeManeja` y `tarifaViajeSinManejar`. `PeriodSelector` corre en 5 pantallas accesibles por RRHH (nivel 90), Coordinador (70) y Supervisor (60): todos recibirían 403. Abrir ese router obligaría a filtrar campos sensibles; un endpoint nuevo de solo lectura con dos campos no tiene esa superficie.

- [ ] **Step 1: Crear la ruta**

```ts
// apps/api/src/routes/config.routes.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

/**
 * GET /config/periodo — Días de inicio y fin del ciclo de planilla.
 *
 * Deliberadamente separado de /admin/config, que es ADMIN-only y devuelve
 * también las tarifas. Esto lo necesita cualquier usuario autenticado porque
 * el selector de períodos aparece en Cierre, Aprobaciones, Analytics,
 * Ausencias y Vacaciones.
 */
router.get('/periodo', async (req, res) => {
  const config = await prisma.empresaConfig.findUnique({
    where: { empresaId: req.user!.empresaId },
    select: { periodoDiaInicio: true, periodoDiaFin: true },
  });
  if (!config) {
    res.status(404).json({ error: 'Configuración de empresa no encontrada' });
    return;
  }
  res.json(config);
});

export default router;
```

**Verificar antes de escribir:** que el nombre exportado del middleware sea `authMiddleware` y que `req.user` tenga `empresaId`, abriendo `apps/api/src/middleware/auth.middleware.ts`. Si difiere, adaptar.

- [ ] **Step 2: Montar la ruta**

En `apps/api/src/routes/index.ts`, junto a los otros `router.use` (el de admin/config está en la línea 72):

```ts
import configRoutes from './config.routes.js';
// ...
router.use('/config', configRoutes);
```

- [ ] **Step 3: Escribir la verificación de integración**

```ts
// apps/api/tests/config-periodo.qa.ts
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
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234!';
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
```

- [ ] **Step 4: Levantar el servidor y correr la verificación**

```bash
cd apps/api && npm run dev
```

En otra terminal:

```bash
cd apps/api && npx tsx tests/config-periodo.qa.ts
```

Esperado: `✓ config-periodo: 3/3 OK`

Si el login del admin falla, tomar la contraseña real de `SEED_ADMIN_PASSWORD` en `apps/api/.env`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/config.routes.ts apps/api/src/routes/index.ts apps/api/tests/config-periodo.qa.ts
git commit -m "feat(api): endpoint GET /config/periodo para cualquier usuario autenticado

El selector de periodos corre en 5 pantallas accesibles por RRHH, Coordinador y
Supervisor, y /admin/config es ADMIN-only y ademas expone las tarifas."
```

---

### Task 9: Hook `usePeriodoConfig` y `PeriodSelector`

**Files:**
- Create: `apps/web/src/hooks/usePeriodoConfig.ts`
- Modify: `apps/web/src/components/layout/PeriodSelector.tsx:86-88`

- [ ] **Step 1: Crear el hook**

```ts
// apps/web/src/hooks/usePeriodoConfig.ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import {
  getCurrentPeriod,
  DIA_INICIO_POR_DEFECTO,
  DIA_FIN_POR_DEFECTO,
} from '../utils/periodos';

export interface Periodo {
  inicio: string;
  fin: string;
}

/**
 * Días de inicio y fin del ciclo de planilla, según la configuración de la
 * empresa. Cacheado 5 minutos: cambia muy de vez en cuando y lo consultan
 * cinco pantallas.
 */
export function usePeriodoConfig() {
  const { data } = useQuery({
    queryKey: ['config', 'periodo'],
    queryFn: async () => {
      const { data } = await api.get('/config/periodo');
      return data as { periodoDiaInicio: number; periodoDiaFin: number };
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    diaInicio: data?.periodoDiaInicio ?? DIA_INICIO_POR_DEFECTO,
    diaFin: data?.periodoDiaFin ?? DIA_FIN_POR_DEFECTO,
    listo: !!data,
  };
}

/**
 * Período seleccionado en una pantalla. Arranca en `null` a propósito: si
 * devolviera un período calculado con los defaults, la primera query saldría
 * con las fechas equivocadas antes de que llegue la configuración.
 *
 * Las pantallas deben gatear su query con `enabled: !!periodo`.
 */
export function usePeriodoActual() {
  const { diaInicio, diaFin, listo } = usePeriodoConfig();
  const [periodo, setPeriodo] = useState<Periodo | null>(null);

  useEffect(() => {
    if (listo && !periodo) setPeriodo(getCurrentPeriod(diaInicio, diaFin));
  }, [listo, diaInicio, diaFin, periodo]);

  return { periodo, setPeriodo, listo };
}
```

**Verificar antes de escribir:** cómo se exporta el cliente HTTP en `apps/web/src/services/api.ts` (default o nombrado) y adaptar el import.

- [ ] **Step 2: Que `PeriodSelector` consuma la config**

Reemplazar las líneas 86 y 88 de `PeriodSelector.tsx`:

```ts
  const { diaInicio, diaFin } = usePeriodoConfig();

  const cycles = useMemo(() => generateCycles(12, diaInicio, diaFin), [diaInicio, diaFin]);

  const currentPeriod = useMemo(() => getCurrentPeriod(diaInicio, diaFin), [diaInicio, diaFin]);
```

y agregar el import:

```ts
import { usePeriodoConfig } from '../../hooks/usePeriodoConfig';
```

**Las dependencias de los `useMemo` son la mitad del arreglo.** Hoy son `[]`: sin cambiarlas, los ciclos se calculan una sola vez con los defaults y nunca se recalculan cuando llega la configuración.

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/usePeriodoConfig.ts apps/web/src/components/layout/PeriodSelector.tsx
git commit -m "fix(web): que el selector de periodos lea la configuracion de la empresa

Los 21/20 eran defaults de parametro que nunca se sobrescribian, porque el
componente invocaba generateCycles(12) y getCurrentPeriod() sin argumentos."
```

---

### Task 10: Las 5 pantallas que usan el selector

**Files:**
- Modify: `apps/web/src/pages/admin/CierrePage.tsx:12,71,84-85`
- Modify: `apps/web/src/pages/aprobaciones/AprobacionesPage.tsx:14,165`
- Modify: `apps/web/src/pages/analytics/AnalyticsPage.tsx:11,85`
- Modify: `apps/web/src/pages/ausencias/AusenciasPage.tsx:15,99`
- Modify: `apps/web/src/pages/vacaciones/VacacionesPage.tsx:14,218`

Las 5 tienen exactamente el mismo patrón: `const [periodo, setPeriodo] = useState(getCurrentPeriod());`. Se corrigen las 5 y no solo Cierre: comparten la misma función y arreglar una sola las dejaría mostrando ventanas distintas entre sí.

- [ ] **Step 1: Aplicar la misma transformación en cada archivo**

Import — reemplazar:

```ts
import PeriodSelector, { getCurrentPeriod } from '@/components/layout/PeriodSelector';
```

por:

```ts
import PeriodSelector from '@/components/layout/PeriodSelector';
import { usePeriodoActual } from '@/hooks/usePeriodoConfig';
```

El hook se llama `usePeriodoActual` pero vive en `usePeriodoConfig.ts`, junto a `usePeriodoConfig`, que es el que usa `PeriodSelector` por dentro.

Estado — reemplazar:

```ts
  const [periodo, setPeriodo] = useState(getCurrentPeriod());
```

por:

```ts
  const { periodo, setPeriodo } = usePeriodoActual();
```

Queries — agregar `!!periodo` a la condición `enabled` de toda query que use `periodo.inicio` o `periodo.fin`, y cambiar los accesos a `periodo!.inicio` dentro del `queryFn` (que solo corre si `enabled` es verdadero). Ejemplo sobre `CierrePage.tsx:84-85`:

```ts
    queryFn: async () => {
      const { data } = await api.get('/planillas', {
        params: { periodoInicio: periodo!.inicio, periodoFin: periodo!.fin },
      });
      return data;
    },
    enabled: isRRHH && !!periodo,
```

JSX — envolver el bloque que usa `periodo` con una guarda. Donde hoy dice:

```tsx
        <PeriodSelector value={periodo} onChange={setPeriodo} />
```

poner:

```tsx
        {periodo && <PeriodSelector value={periodo} onChange={setPeriodo} />}
```

Y en `CierrePage.tsx:235`, donde el título imprime las fechas, envolver igual:

```tsx
        {periodo && (
          <p className="...">
            Período: {new Date(periodo.inicio).toLocaleDateString()} — {new Date(periodo.fin).toLocaleDateString()}
          </p>
        )}
```

- [ ] **Step 2: Quitar el `useState` huérfano**

Si tras el cambio `useState` ya no se usa en el archivo, sacarlo del import de React. `eslint` lo va a marcar.

- [ ] **Step 3: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

Esperado: sin errores. Los errores de `periodo` posiblemente `null` señalan un lugar donde faltó la guarda.

- [ ] **Step 4: Verificar en el navegador**

Levantar la app, entrar como admin a **Cierre de Período** y confirmar que el título y el desplegable dicen **«16 Jul - 15 Ago 2026»**. Repetir en Aprobaciones, Analytics, Ausencias y Vacaciones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/CierrePage.tsx apps/web/src/pages/aprobaciones/AprobacionesPage.tsx apps/web/src/pages/analytics/AnalyticsPage.tsx apps/web/src/pages/ausencias/AusenciasPage.tsx apps/web/src/pages/vacaciones/VacacionesPage.tsx
git commit -m "fix(web): que las 5 pantallas con selector de periodo esperen la configuracion"
```

---

### Task 11: Avisar cuando falla el guardado de Configuración

**Files:**
- Modify: `apps/web/src/pages/admin/ConfigPage.tsx:41-49`

**Contexto:** la mutación tiene solo `onSuccess`. Si el PUT falla no hay toast ni mensaje y el formulario sigue mostrando lo tipeado: la pantalla se ve **idéntica** haya persistido o no. Es la razón por la que no se podía saber si los 16/15 se habían guardado.

- [ ] **Step 1: Agregar `onError`**

```ts
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<Config>) => { await api.put('/admin/config', data); },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      toast.error(mensajeDeError(err).mensaje);
    },
  });
```

**Dependencia:** `mensajeDeError` viene de la Tarea 17. Ejecutar esta tarea **después** de la 17, o usar el fallback provisorio descrito en la Tarea 6 Step 2.

Verificar el nombre real del helper de toast abriendo `apps/web/src/stores/toastStore.ts`.

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/ConfigPage.tsx
git commit -m "fix(web): avisar cuando falla el guardado de configuracion"
```

---

## Frente C — WENTOP

### Task 12: Guardas defensivas contra los datos faltantes

**Files:**
- Modify: `apps/web/src/pages/WentopPage.tsx:1223,1237,1251,1311,1317,1660,2126,2130`

**Contexto:** el modal de detalle recibe el objeto del **listado**, y `tarjetaInclude` (`wentop.routes.ts:157-161`) trae `_count.fotos` pero **no** la relación `fotos`. Por eso el contador «1 foto» funciona (`WentopPage.tsx:786-790` ya es defensivo) y el detalle revienta. Esto solo arregla el crash; que las fotos se vean es la Tarea 13.

- [ ] **Step 1: Guardar los accesos a `fotos`**

| Línea | Antes | Después |
|---|---|---|
| 1311 | `{tarjeta.fotos.length > 0 && (` | `{(tarjeta.fotos?.length ?? 0) > 0 && (` |
| 1317 | `{tarjeta.fotos.map((f) => (` | `{tarjeta.fotos?.map((f) => (` |
| 1660 | `const fotosExistentes = isEdit ? tarjeta.fotos.length : 0;` | `const fotosExistentes = isEdit ? (tarjeta.fotos?.length ?? tarjeta._count?.fotos ?? 0) : 0;` |
| 2126 | `{isEdit && tarjeta.fotos.length > 0 && (` | `{isEdit && (tarjeta.fotos?.length ?? 0) > 0 && (` |
| 2130 | `{tarjeta.fotos.map((f) => (` | `{tarjeta.fotos?.map((f) => (` |

- [ ] **Step 2: Guardar los tres campos JSON nullable**

`calidad`, `medioambiente` y `seguridadSalud` son `Json?` en `schema.prisma:980-982` pero el front los tipa `string[]` no-nulo (`WentopPage.tsx:46-48`). Por la API nunca quedan NULL (`wentop.routes.ts:490-492` usa `?? []`), pero una fila creada por seed o SQL directo reproduce el mismo «Algo salió mal».

| Línea | Antes | Después |
|---|---|---|
| 1223 | `tarjeta.calidad.length` | `(tarjeta.calidad?.length ?? 0)` |
| 1237 | `tarjeta.medioambiente.length` | `(tarjeta.medioambiente?.length ?? 0)` |
| 1251 | `tarjeta.seguridadSalud.length` | `(tarjeta.seguridadSalud?.length ?? 0)` |

Si dentro de esos bloques hay un `.map()` sobre el mismo campo, guardarlo también con `?.`.

- [ ] **Step 3: Corregir el tipo, que hoy miente**

En la interfaz de `WentopPage.tsx:40-70`, marcar como opcional lo que el backend puede no mandar:

```ts
  fotos?: { id: string; url: string }[];
  calidad?: string[];
  medioambiente?: string[];
  seguridadSalud?: string[];
  _count?: { fotos: number };
```

Verificar los nombres de campo reales de `fotos` leyendo la interfaz antes de editar. Con `fotos` opcional, `tsc` va a marcar cualquier acceso sin guarda que se haya escapado: **eso es deseable**, es la red de seguridad de esta tarea.

- [ ] **Step 4: Typecheck**

```bash
cd apps/web && npx tsc -b --noEmit
```

Esperado: sin errores. Si aparece alguno sobre `fotos`, es un acceso sin guarda que faltó.

- [ ] **Step 5: Verificar en el navegador**

Crear una tarjeta WENTOP con una foto y abrirla. Ya **no** debe aparecer «Algo salió mal». La sección de evidencia fotográfica va a estar vacía todavía: eso lo arregla la Tarea 13.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/WentopPage.tsx
git commit -m "fix(web): que el detalle de una tarjeta WENTOP no reviente sin fotos

El modal recibia el objeto del listado, que trae _count.fotos pero no la
relacion fotos. Rompia para cualquier usuario, no solo para el creador."
```

---

### Task 13: Que el detalle traiga las fotos

**Files:**
- Modify: `apps/web/src/pages/WentopPage.tsx:1143-1180`

**Contexto:** `GET /wentop/:id` ya existe (`wentop.routes.ts:426`), ya usa `tarjetaDetailInclude` con `fotos: true` (`:163-167`) y ya está bien autorizado — pero el front nunca lo llama. Se prefiere esto a agregar `fotos: true` al include del listado, que engordaría la respuesta de hasta 500 tarjetas × 10 fotos, justo lo que el comentario de `wentop.routes.ts:28-30` quiso evitar.

- [ ] **Step 1: Consumir el endpoint de detalle**

Dentro de `TarjetaDetailModal`, junto a los otros hooks (~línea 1162):

```ts
  const { data: detalle } = useQuery({
    queryKey: ['wentop', 'tarjeta', tarjeta.id],
    queryFn: async () => {
      const { data } = await api.get(`/wentop/${tarjeta.id}`);
      return data as WentopTarjeta;
    },
    placeholderData: tarjeta,
  });
  const t = detalle ?? tarjeta;
```

`placeholderData` hace que el modal pinte instantáneo con lo que ya tenemos y se complete al llegar la respuesta. El `invalidateQueries({ queryKey: ['wentop'] })` que ya hacen las mutations (`:360`, `:374`, `:388`) cubre esta key por prefijo, así que borrar una foto refresca solo.

- [ ] **Step 2: Usar `t` en todo el cuerpo del modal**

Reemplazar **todas** las referencias a `tarjeta.` por `t.` en el cuerpo del modal (aproximadamente líneas 1178 a 1420), incluidas las que gatean los botones por estado. Si se olvida alguna quedan dos objetos mezclados y aparecen desincronizaciones sutiles, como el badge de estado con el valor viejo.

**Alternativa menos frágil, preferida si el diff se vuelve grande:** renombrar la prop entrante en la desestructuración y no tocar el cuerpo:

```ts
function TarjetaDetailModal({ tarjeta: tarjetaDelListado, canManage, isCreator, onClose }: Props) {
  const { data: detalle } = useQuery({ /* ... como arriba, usando tarjetaDelListado.id ... */ });
  const tarjeta = detalle ?? tarjetaDelListado;
  // el resto del componente queda intacto
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 4: Verificar en el navegador**

Abrir la tarjeta creada en la Tarea 12: ahora **sí** debe mostrarse la foto en «Evidencia fotográfica».

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WentopPage.tsx
git commit -m "fix(web): que el detalle de WENTOP consuma GET /wentop/:id

El endpoint ya existia, ya incluia las fotos y ya estaba bien autorizado, pero
el front nunca lo llamaba."
```

---

### Task 14: Que el creador pueda cerrar y editar su tarjeta

**Files:**
- Modify: `apps/web/src/pages/WentopPage.tsx:1166,1325,1380,1389,1401`

**Contexto:** el backend contempla al creador en **todas** las operaciones (`wentop.routes.ts:601-607` cerrar, `:527-538` editar, `:709-716` subir fotos, `:779-785` borrar foto). El front las esconde porque gatea con `canManage` a secas, y `canManageCard` (`:324-335`) replica `canManageWentop` del backend, que no incluye al creador — por eso cada ruta le suma `isCreator` aparte.

- [ ] **Step 1: Definir las dos condiciones**

Junto a `canDelete` (~línea 1166):

```ts
  // Espeja PATCH /:id/estado y PUT /:id: el backend acepta al creador además del gestor.
  const puedeGestionar = canManage || isCreator;
  // El backend rechaza editar una tarjeta CERRADA solo si el nivel es menor a 90
  // (wentop.routes.ts:535), así que un admin sí puede.
  const puedeEditar = puedeGestionar && (tarjeta.estado !== 'CERRADA' || (rolNivel ?? 0) >= 90);
```

`TarjetaDetailModal` **no** tiene el usuario en scope (sus props están en `:1143-1161`). Agregar `rolNivel` a las props y pasarlo desde el render de `:470-474`, o importar `useAuthStore` dentro del modal. Verificar el nombre del campo en `apps/web/src/stores/authStore.ts` — puede ser `rolNivel` o venir anidado en `user`.

- [ ] **Step 2: Aplicar a los cuatro botones**

| Línea | Antes | Después |
|---|---|---|
| 1325 | `{canManage && (` (borrar foto) | `{puedeGestionar && (` |
| 1380 | `{canManage && tarjeta.estado === 'ABIERTA' && (` | `{puedeGestionar && tarjeta.estado === 'ABIERTA' && (` |
| 1389 | `{canManage && (tarjeta.estado === 'ABIERTA' \|\| tarjeta.estado === 'EN_PROGRESO') && !showCierreForm && (` | `{puedeGestionar && (tarjeta.estado === 'ABIERTA' \|\| tarjeta.estado === 'EN_PROGRESO') && !showCierreForm && (` |
| 1401 | `{canManage && (` (Editar) | `{puedeEditar && (` |

**No tocar `canDelete` (`:1166`):** ya coincide con la regla del backend (`wentop.routes.ts:661`, el creador solo borra si está ABIERTA).

**No simplificar `puedeEditar` a `puedeGestionar && estado !== 'CERRADA'`:** eso le sacaría a un admin el botón Editar en tarjetas cerradas, que hoy tiene y el backend le acepta.

- [ ] **Step 3: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 4: Verificar en el navegador**

Con un usuario **OPERADOR** que no sea gestor del sector: crear una tarjeta, abrirla, y confirmar que aparecen «Cerrar», «En Progreso» y «Editar». Cerrarla y confirmar que la operación se completa (el backend ya la aceptaba).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WentopPage.tsx
git commit -m "fix(web): que el creador de una tarjeta WENTOP vea los botones que ya podia usar

El backend acepta al creador en cerrar, editar, subir y borrar fotos desde el
primer commit; solo la UI se los escondia."
```

---

## Frente D — Errores de validación mudos

### Task 15: Error map global de zod en castellano

**Files:**
- Create: `apps/api/src/utils/zod-es.ts`
- Create: `apps/api/tests/zod-es.test.ts`
- Modify: `apps/api/src/app.ts`

**Por qué global:** hay 39 usos de `parsed.error.flatten()` en 18 archivos de `apps/api/src/routes`. Traducirlos a mano es inviable y frágil. Un error map global traduce todos los mensajes por defecto de una vez. **Este paso va primero:** sin él, aplicar el helper compartido del front haría aparecer «Invalid uuid» y «Required» en 15 pantallas, que es un empeoramiento real.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/api/tests/zod-es.test.ts
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
  console.log('✓ zod-es: 6/6 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd apps/api && npx tsx tests/zod-es.test.ts
```

Esperado: FALLA con `Cannot find module '../src/utils/zod-es.js'`.

- [ ] **Step 3: Implementar el error map**

```ts
// apps/api/src/utils/zod-es.ts
import { z } from 'zod';

/**
 * Mensajes por defecto de zod en castellano.
 *
 * Se instala una sola vez al arrancar el servidor y afecta a los 39 usos de
 * `parsed.error.flatten()` que hay en las rutas. Un mensaje explícito en el
 * schema (`z.string().min(8, 'Mínimo 8 caracteres')`) siempre tiene prioridad
 * sobre esto.
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
      return { message: `Se esperaba ${issue.expected} y llegó ${issue.received}` };

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
      if (issue.type === 'number') return { message: `El valor mínimo es ${issue.minimum}` };
      if (issue.type === 'array') return { message: `Mínimo ${issue.minimum} elementos` };
      if (issue.type === 'date') return { message: 'La fecha es anterior al mínimo permitido' };
      return { message: 'Valor demasiado chico' };

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo ${issue.maximum} caracteres` };
      if (issue.type === 'number') return { message: `El valor máximo es ${issue.maximum}` };
      if (issue.type === 'array') return { message: `Máximo ${issue.maximum} elementos` };
      if (issue.type === 'date') return { message: 'La fecha es posterior al máximo permitido' };
      return { message: 'Valor demasiado grande' };

    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Valor inválido. Opciones: ${issue.options.join(', ')}` };

    case z.ZodIssueCode.invalid_date:
      return { message: 'Fecha inválida' };

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
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd apps/api && npx tsx tests/zod-es.test.ts
```

Esperado: `✓ zod-es: 6/6 OK`

Si alguna rama falla, ajustar contra la forma real de los issues de zod 3.25.76 — no cambiar el test para que pase.

- [ ] **Step 5: Instalarlo al arrancar**

En `apps/api/src/app.ts`, entre los imports y la creación de la app:

```ts
import { instalarMensajesEnCastellano } from './utils/zod-es.js';

instalarMensajesEnCastellano();
```

Tiene que correr **antes** de que se importe cualquier router que construya schemas.

- [ ] **Step 6: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/utils/zod-es.ts apps/api/tests/zod-es.test.ts apps/api/src/app.ts
git commit -m "feat(api): mensajes de validacion de zod en castellano

Un error map global cubre los 39 usos de error.flatten() de una vez. Sin esto,
exponer los detalles de validacion en el front mostraria 'Invalid uuid' y
'Required' en 15 pantallas."
```

---

### Task 16: Mensajes explícitos donde el map global no llega

**Files:**
- Modify: `apps/api/src/routes/usuarios.routes.ts:19-23`, `:38-57`, `:59-62`

**Contexto:** la regla de contraseña usa dos `.regex()` sin mensaje. Un map global no puede saber qué valida una regex, así que devolvería «El formato no es válido» dos veces. `auth.routes.ts:79-84` ya tiene los mensajes correctos escritos: se copia ese patrón.

- [ ] **Step 1: `createUsuarioSchema` (`:19-23`)**

```ts
const createUsuarioSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio').max(100, 'Máximo 100 caracteres'),
  apellido: z.string().min(1, 'El apellido es obligatorio').max(100, 'Máximo 100 caracteres'),
  email: z.string().email('Email inválido'),
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .max(72, 'Máximo 72 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número'),
  // ...el resto de los campos, sin cambios
});
```

El `.max(72)` es porque bcrypt trunca en silencio a 72 bytes: sin él, dos contraseñas distintas de más de 72 caracteres son equivalentes al iniciar sesión.

- [ ] **Step 2: Repetir en los otros dos schemas**

`updateUsuarioSchema` (`:38-57`) y `assignDiagramaSchema` (`:59-62`) los usa **el mismo modal**: el primero en el guardado de edición y el segundo en el PATCH del diagrama que corre después del alta. Sin esto, editar un usuario seguiría dando mensajes genéricos.

En `updateUsuarioSchema`, aplicar a los campos que existan (todos son opcionales acá):

```ts
  email: z.string().email('Email inválido').optional(),
  nombre: z.string().min(1, 'El nombre es obligatorio').max(100, 'Máximo 100 caracteres').optional(),
  apellido: z.string().min(1, 'El apellido es obligatorio').max(100, 'Máximo 100 caracteres').optional(),
  legajo: z.string().max(20, 'Máximo 20 caracteres').optional().nullable(),
```

En `assignDiagramaSchema`:

```ts
  diagramaId: z.string().uuid('Diagrama inválido'),
  fechaInicioCiclo: z.string().datetime('Fecha de inicio del ciclo inválida'),
```

Antes de escribir, abrir las líneas `:38-62` y respetar los nombres y la forma real de cada campo: acá solo se agregan los mensajes, **no se cambia ninguna regla de validación**.

- [ ] **Step 3: Verificar que nada dependía de los mensajes viejos**

```bash
cd apps/api && grep -rn "String must contain\|Invalid uuid\|fieldErrors" tests/ | head -20
```

Esperado: sin resultados relevantes. Ninguna suite afirma sobre los mensajes en inglés.

- [ ] **Step 4: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/usuarios.routes.ts
git commit -m "fix(api): mensajes de contrasena explicitos al crear y editar usuarios

Las dos regex sin mensaje devolvian literalmente la palabra 'Invalid'."
```

---

### Task 17: Helper `mensajeDeError` en el front

**Files:**
- Create: `apps/web/src/lib/errores.ts`
- Create: `apps/web/src/lib/errores.test.ts`

**Contexto:** el interceptor de `services/api.ts:73-126` no pierde nada; rechaza con el `AxiosError` intacto. La información se tira en cada pantalla, que castea a `{ response?: { data?: { error?: string } } }` y solo lee `.error`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/web/src/lib/errores.test.ts
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
  console.log('✓ errores: 7/7 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd apps/web && npx tsx src/lib/errores.test.ts
```

Esperado: FALLA con `Cannot find module './errores.js'`.

- [ ] **Step 3: Implementar el helper**

```ts
// apps/web/src/lib/errores.ts
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

interface CuerpoDeError {
  error?: string;
  details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
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

  const fieldErrors = data.details?.fieldErrors ?? {};
  const formErrors = data.details?.formErrors ?? [];

  const partes = [
    ...Object.entries(fieldErrors).map(([campo, msgs]) => `${ETIQUETAS[campo] ?? campo}: ${msgs.join('; ')}`),
    ...formErrors,
  ];

  if (partes.length > 0) {
    return { mensaje: `Revisá estos campos — ${partes.join(' · ')}`, fieldErrors };
  }
  return { mensaje: data.error ?? 'Ocurrió un error', fieldErrors };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd apps/web && npx tsx src/lib/errores.test.ts
```

Esperado: `✓ errores: 7/7 OK`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/errores.ts apps/web/src/lib/errores.test.ts
git commit -m "feat(web): helper para traducir errores de la API a mensajes accionables"
```

---

### Task 18: Aplicar el helper en el modal de usuarios

**Files:**
- Modify: `apps/web/src/pages/admin/UsuariosPage.tsx:1,353-354,401-402,427,431-438,442-448,470,494-495,558-564`

- [ ] **Step 1: Estado y refs**

Agregar `useRef` al import de la línea 1 (hoy solo trae `useState`), e importar el helper:

```ts
import { useState, useRef } from 'react';
import { mensajeDeError } from '@/lib/errores';
```

Junto al estado de `:353-354`:

```ts
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const errorRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Limpiar al reintentar (`:401-402`)**

```ts
    setError('');
    setFieldErrors({});
```

- [ ] **Step 3: Validar la fecha del diagrama antes de enviar**

`new Date(diagramaFechaInicio + 'T00:00:00').toISOString()` (`:427` y `:436`) tira `RangeError` si la fecha está vacía, y el input (`:558-564`) no tiene `required`, solo `disabled={!diagramaId}`: se puede elegir un diagrama y después borrar la fecha. Antes del `try`:

```ts
    if (diagramaId && !diagramaFechaInicio) {
      setFieldErrors({ diagramaFechaInicio: ['Elegí la fecha de inicio del ciclo'] });
      setError('Falta la fecha de inicio del ciclo del diagrama');
      setLoading(false);
      return;
    }
```

- [ ] **Step 4: Separar los dos requests del alta (`:431-438`)**

Si el `POST /usuarios` devuelve 201 y el `PATCH /usuarios/:id/diagrama` falla, el usuario **ya quedó creado**: hoy `onSuccess()` nunca corre, el modal queda abierto y el reintento se come un 409 «Ya existe un usuario con ese email».

```ts
      const creado = await api.post('/usuarios', payload);

      if (diagramaId) {
        try {
          await api.patch(`/usuarios/${creado.data.id}/diagrama`, {
            diagramaId,
            fechaInicioCiclo: new Date(diagramaFechaInicio + 'T00:00:00').toISOString(),
          });
        } catch (errDiagrama) {
          // El usuario YA existe. Cerrar el modal igual y avisar qué quedó pendiente.
          toast.error(`Usuario creado, pero no se pudo asignar el diagrama: ${mensajeDeError(errDiagrama).mensaje}`);
          onSuccess();
          return;
        }
      }
      onSuccess();
```

Verificar los nombres reales del payload del PATCH (`fechaInicioCiclo` u otro) leyendo `usuarios.routes.ts:504-551` antes de escribir.

- [ ] **Step 5: Reemplazar el catch (`:442-448`)**

```ts
    } catch (err: unknown) {
      const { mensaje, fieldErrors: fe } = mensajeDeError(err);
      setFieldErrors(fe);
      setError(mensaje);
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } finally {
      setLoading(false);
    }
```

- [ ] **Step 6: Cartel de error con ref (`:470`)**

Agregar `ref={errorRef}` al div del cartel de error.

- [ ] **Step 7: Error inline bajo cada campo**

Para `password` (después de `:495`), y lo mismo para `email`, `nombre`, `apellido` y `legajo`:

```tsx
{fieldErrors.password && (
  <p className="text-xs text-destructive mt-1">{fieldErrors.password.join('. ')}</p>
)}
```

Y borde rojo en el input correspondiente:

```tsx
className={cn(inputClass, fieldErrors.password && 'border-destructive')}
```

`cn` ya está importado en `:4`. Verificar el nombre real de la constante de clases del input.

- [ ] **Step 8: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 9: Verificar en el navegador**

1. Crear usuario con contraseña `abcdefgh` → el cartel debe decir **«Contraseña: Debe contener al menos una mayúscula; Debe contener al menos un número»** y el campo debe quedar con borde rojo.
2. Crear usuario con un email ya existente → «Ya existe un usuario con ese email».
3. Elegir un diagrama y borrar la fecha → debe frenar antes de enviar, sin crear nada.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/admin/UsuariosPage.tsx
git commit -m "fix(web): decir que campo corregir al fallar la creacion de un usuario

Ademas: si el POST crea el usuario y falla el PATCH del diagrama, el usuario ya
existia pero el modal no se cerraba y el reintento daba 409."
```

---

### Task 19: Aplicar el helper a las 14 pantallas restantes

**Files:**
- Modify: `apps/web/src/pages/admin/DiagramasPage.tsx:181`
- Modify: `apps/web/src/pages/admin/SectoresPage.tsx:143`
- Modify: `apps/web/src/pages/admin/RolesPage.tsx:149`
- Modify: `apps/web/src/pages/admin/FlujosPage.tsx:263`, `:384`
- Modify: `apps/web/src/pages/ausencias/AusenciasPage.tsx:489`, `:688`, `:831`
- Modify: `apps/web/src/pages/vacaciones/VacacionesPage.tsx:453`
- Modify: `apps/web/src/pages/auth/ChangePasswordPage.tsx:68`
- Modify: `apps/web/src/pages/auth/ResetPasswordPage.tsx:82`
- Modify: `apps/web/src/pages/auth/LoginPage.tsx:93`
- Modify: `apps/web/src/pages/WentopPage.tsx:1754`
- Modify: `apps/web/src/App.tsx:51`

- [ ] **Step 1: Aplicar la misma transformación en cada sitio**

El patrón actual en todos es una variante de:

```ts
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error ?? 'Error al guardar');
```

Reemplazar por:

```ts
      setError(mensajeDeError(err).mensaje);
```

agregando en cada archivo:

```ts
import { mensajeDeError } from '@/lib/errores';
```

Donde en vez de `setError` se llame a un toast, mantener el toast y cambiar solo el texto: `toast.error(mensajeDeError(err).mensaje)`.

- [ ] **Step 2: Cuidado especial en `LoginPage.tsx:93`**

Un 401 de credenciales debe seguir diciendo «Email o contraseña incorrectos», no enumerar campos. Verificar qué devuelve `auth.routes.ts` para credenciales inválidas y, si hace falta, dejar ese caso como está.

- [ ] **Step 3: Cuidado especial en `App.tsx:51`**

Es manejo de error a nivel de aplicación, no de formulario. Confirmar que el cambio tiene sentido en ese contexto antes de aplicarlo; si es un error de arranque de sesión, puede convenir dejarlo.

- [ ] **Step 4: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 5: Verificar que no quedó ninguno**

```bash
cd apps/web && grep -rn "data?.error ??" src/ | grep -v "lib/errores.ts"
```

Esperado: sin resultados, o solo los casos que se decidió dejar como están en los pasos 2 y 3.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): usar el helper de errores en las pantallas restantes"
```

---

## Frente F — UI de Cierre de Período

### Task 20: Arreglar el layout de la pestaña Pendientes

**Files:**
- Modify: `apps/web/src/pages/admin/CierrePage.tsx:356,361,375,379-389,401-402,408,417`

**Contexto:** el desborde no es un ancho fijo ni `position: absolute`, es el `min-width: auto` de flex item: un `<select>` se dimensiona al `<option>` más ancho y como flex item no puede encogerse por debajo de eso. `AprobacionesPage.tsx:296` tiene el select con la cadena de clases **idéntica** y no se desborda, porque ahí los filtros viven en su propia línea con `flex flex-wrap` (`:289`).

- [ ] **Step 1: Header que se parte en mobile (`:356`)**

```tsx
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
```

- [ ] **Step 2: Fila de controles que envuelve (`:361`)**

```tsx
<div className="flex flex-wrap items-center gap-2">
```

- [ ] **Step 3: Botón que no parte su texto (`:375`)**

Agregar `shrink-0` y `whitespace-nowrap` a la cadena de clases existente, sin tocar el resto.

- [ ] **Step 4: Agrupar el ícono con el select (`:379-389`)**

```tsx
  <div className="flex w-full items-center gap-2 sm:w-auto">
    <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
    <select
      className="h-9 w-full min-w-0 px-3 rounded-lg border border-input bg-background text-foreground text-sm sm:w-auto sm:min-w-[180px]"
      value={pendientesFilter}
      onChange={(e) => setPendientesFilter(e.target.value)}
    >
      <option value="">Todos los sectores</option>
      {sectores.map((s) => (
        <option key={s.id} value={s.id}>{s.nombre}</option>
      ))}
    </select>
  </div>
```

`min-w-0` es la clave: anula el `min-width: auto` que hoy impide que el select se encoja.

- [ ] **Step 5: Que el scroll de la tabla sirva (`:401-402`)**

```tsx
<div className="overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0">
  <table className="w-full min-w-[520px] text-sm">
```

Hoy la tabla es `w-full` sin `min-w`, así que se ajusta al contenedor y el `overflow-x-auto` nunca se activa. Agregar además `whitespace-nowrap` al `<th>` (`:408`) y al `<td>` (`:417`) de «Estado planilla».

- [ ] **Step 6: Aplicar lo mismo a la pestaña Aprobadas (`:461`, `:511`)**

Tiene el bug idéntico. Repetir los pasos 1, 2 y 5 en esas líneas.

- [ ] **Step 7: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 8: Verificar en el navegador a 360px de ancho**

Con las herramientas de desarrollo en 360px: el filtro **no** debe sangrar fuera de la card, el título y los controles deben quedar en renglones separados, y la tabla debe scrollear horizontalmente en vez de comprimirse. Repetir en la pestaña Aprobadas.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/admin/CierrePage.tsx
git commit -m "fix(web): que el filtro de sectores no se desborde en Cierre de Periodo

El select no podia encogerse por el min-width auto de flex item. Se sigue el
patron que ya usa AprobacionesPage con el mismo control."
```

---

## Frente G — Permisos por nivel de rol

### Task 21: Bloque que explica qué habilita cada nivel

**Files:**
- Modify: `apps/web/src/pages/admin/RolesPage.tsx:202-207`

**Contexto verificado:** el acceso a endpoints es 100% por nivel numérico (`requireLevel` + comparaciones inline), pero **aprobar depende del código literal del rol** (`approval-auth.utils.ts:41-67`, cuyo parámetro `_approverNivel` está deliberadamente sin usar). Un rol nuevo con nivel 95 pasa todos los `requireLevel` y no puede aprobar nada. El bloque tiene que decir las dos cosas o miente.

- [ ] **Step 1: Definir los escalones**

Arriba del componente del modal:

```tsx
const ESCALONES = [
  {
    min: 0, max: 59, titulo: '0-59 · Solo lo propio',
    items: [
      'Sus propias planillas, ausencias y vacaciones',
      'Sus mensajes y capacitaciones',
      'Crear tarjetas WENTOP propias',
      'La bandeja de Aprobaciones le aparece vacía',
    ],
  },
  {
    min: 60, max: 69, titulo: '60-69 · Supervisión (como SUPERVISOR)',
    items: [
      'Aprobar y rechazar planillas, ausencias, vacaciones y cambios de diagrama',
      'Cargar ausencias en nombre de otro',
      'Marcar compensatorios y validar marcas manuales',
      'Ver analytics de su sector',
      'Alcance: sus subordinados directos',
    ],
  },
  {
    min: 70, max: 74, titulo: '70-74 · Coordinación (como COORDINADOR)',
    items: [
      'Todo lo anterior, con alcance a TODO su sector y no solo a sus directos',
      'Analytics por sector y gestión de diagramas',
      'Capacitaciones y sesiones',
      'Gestionar las tarjetas WENTOP de su sector',
    ],
  },
  {
    min: 75, max: 79, titulo: '75-79 · Sin permisos adicionales',
    items: [
      'A nivel numérico no agrega nada sobre 70-74',
      'El poder de CMASS viene de su código de rol, no de este nivel',
    ],
  },
  {
    min: 80, max: 89, titulo: '80-89 · Gerencia (como GERENTE)',
    items: [
      'A nivel numérico es idéntico a 70-74',
      'GERENTE se distingue por su CÓDIGO en los pasos de flujo y en las notificaciones, no por el número',
    ],
  },
  {
    min: 90, max: 99, titulo: '90-99 · Recursos Humanos (como RRHH)',
    items: [
      'Ve y gestiona a TODA la empresa',
      'Alta, baja y modificación de usuarios; resetear contraseñas',
      'Cerrar planillas; exportaciones y liquidación',
      'Saldos de vacaciones, auditoría, alertas y feriados',
      'Mensajes masivos y Calendario de Equipo siempre',
      'Puede avanzar pasos aunque el sector no tenga flujo configurado',
    ],
  },
  {
    min: 100, max: 100, titulo: '100 · Administrador (no asignable acá)',
    items: [
      'Sectores, Diagramas, Flujos, Roles y Configuración',
      'Backups, reabrir planillas, borrar usuarios y cambiar de sector',
      'Este formulario admite hasta 99: el nivel 100 no se puede asignar',
    ],
  },
];
```

- [ ] **Step 2: Renderizar el bloque bajo el campo Nivel**

Después del input de nivel (`:202-207`), dentro del mismo contenedor:

```tsx
<details className="mt-3 rounded-lg border border-border bg-background/50">
  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
    ¿Qué habilita cada nivel?
  </summary>
  <div className="px-3 pb-3 space-y-2">
    {ESCALONES.map((e) => {
      const activo = form.nivel >= e.min && form.nivel <= e.max;
      return (
        <div
          key={e.titulo}
          className={cn(
            'rounded-md border p-2 text-xs',
            activo ? 'border-primary bg-primary/10' : 'border-transparent opacity-60',
            e.min === 100 && 'opacity-40',
          )}
        >
          <p className="font-medium text-foreground">{e.titulo}</p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {e.items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </div>
      );
    })}

    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <p className="font-medium text-foreground">El nivel no alcanza para todo</p>
      <ul className="mt-1 list-disc pl-4 text-muted-foreground">
        <li>
          <strong>Aprobar depende del código del rol</strong>, no del nivel: el rol tiene que
          figurar como aprobador en algún paso de un flujo (Administración &gt; Flujos).
        </li>
        <li>Ver todas las tarjetas WENTOP es exclusivo del código CMASS o de nivel 90 o más.</li>
        <li>El nivel se lee al iniciar sesión: si lo cambiás, el usuario tiene que volver a entrar.</li>
      </ul>
    </div>
  </div>
</details>
```

Va colapsado por defecto para no romper el `max-w-md` del modal (`:162`). Verificar que `cn` esté importado en el archivo; si no, agregarlo desde `@/lib/utils`.

- [ ] **Step 3: Que el bloque aparezca también al editar**

Confirmar si el modal de creación y el de edición son el mismo componente. Si son distintos, repetir el bloque en el de edición.

- [ ] **Step 4: Deshabilitar el nivel en roles de sistema**

`admin.roles.routes.ts:97-106` rechaza cambiar el nivel de un rol de sistema, pero el modal lo muestra editable y el guardado falla con 403.

```tsx
<input
  type="number"
  min={0}
  max={99}
  value={form.nivel}
  disabled={!!rolEditando?.esSistema}
  onChange={(e) => setForm({ ...form, nivel: Number(e.target.value) })}
  className={cn(inputClass, rolEditando?.esSistema && 'opacity-50 cursor-not-allowed')}
/>
{rolEditando?.esSistema && (
  <p className="text-xs text-muted-foreground mt-1">
    Los roles del sistema no permiten cambiar el nivel.
  </p>
)}
```

Verificar el nombre real de la variable del rol en edición y del campo `esSistema` antes de escribir.

- [ ] **Step 5: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 6: Verificar en el navegador**

Abrir «Nuevo rol», desplegar el bloque y mover el nivel entre 10, 65, 72, 95: el escalón resaltado debe cambiar en cada salto.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/RolesPage.tsx
git commit -m "feat(web): explicar que habilita cada nivel al crear o editar un rol"
```

---

### Task 22: Que el selector de aprobador ofrezca los roles reales

**Files:**
- Modify: `apps/web/src/pages/admin/FlujosPage.tsx:50-57`, `:123`

**Contexto:** `ROL_LABELS` es una lista fija de 6 códigos y el `<select>` de `rolAprobador` se arma con ella. El backend acepta cualquier string (`admin.flujos.routes.ts:19`, `z.string().min(1)`). Sin esto, un rol creado en la pantalla de Roles **nunca** puede aprobar nada, y el aviso de la Tarea 21 describiría una limitación evitable.

- [ ] **Step 1: Traer los roles del servidor**

`GET /admin/roles` ya existe y está gateado en nivel 90 (`admin.roles.routes.ts:13`); esta pantalla es nivel 100, así que el acceso está garantizado.

```ts
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await api.get('/admin/roles');
      return data as { codigo: string; nombre: string; color: string; activo: boolean }[];
    },
  });
```

- [ ] **Step 2: Armar el select con esos roles**

Reemplazar en `:123` el `Object.entries(ROL_LABELS)` por:

```tsx
{roles.filter((r) => r.activo).map((r) => (
  <option key={r.codigo} value={r.codigo}>{r.nombre}</option>
))}
```

- [ ] **Step 3: Conservar `ROL_LABELS` solo como respaldo de presentación**

El pipeline muestra el nombre del rol de pasos ya guardados. Si un paso referencia un código que ya no está en la lista, hay que mostrar el código crudo en vez de romper:

```ts
const nombreDeRol = (codigo: string) =>
  roles.find((r) => r.codigo === codigo)?.nombre ?? ROL_LABELS[codigo] ?? codigo;
```

y usar `nombreDeRol(paso.rolAprobador)` donde hoy se lee de `ROL_LABELS` directo.

- [ ] **Step 4: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 5: Verificar en el navegador**

Crear un rol nuevo (por ejemplo `CAPATAZ`, nivel 65) en Administración > Roles, ir a Flujos, editar un flujo y confirmar que «Capataz» aparece entre los roles aprobadores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/FlujosPage.tsx
git commit -m "fix(web): que el selector de rol aprobador ofrezca los roles reales

La lista fija de 6 codigos hacia que un rol creado desde la UI nunca pudiera
ser aprobador, aunque el backend acepta cualquier codigo."
```

---

## Frente A — Emojis

### Task 23: Quitar los emojis de la web

**Files:**
- Modify: los 11 archivos de la tabla de abajo

**Criterio:** se elimina el emoji. Si aportaba significado se reemplaza por el icono `lucide-react` equivalente (`className="h-3 w-3"` en chips, `h-4 w-4` en encabezados), que ya es el estilo dominante del proyecto: lo importan 44 archivos. Si era decorativo, se borra sin reemplazo.

**Forma del reemplazo.** Ejemplo trabajado sobre `FlujosPage.tsx:657`, que es el de la captura. Antes:

```tsx
{paso.requiereComentarioRechazo && <span>📝 Requiere comentario</span>}
```

Después (el contenedor padre de `:656` ya es `flex` con `gap-3`, así que no hay que tocar el layout):

```tsx
{paso.requiereComentarioRechazo && (
  <span className="flex items-center gap-1">
    <MessageSquare className="h-3 w-3" />
    Requiere comentario
  </span>
)}
```

agregando `MessageSquare` al import de `lucide-react` que ya existe en `:5-9`. Todos los reemplazos de la tabla siguen esta misma forma.

- [ ] **Step 1: Aplicar archivo por archivo**

| Archivo | Líneas | Acción |
|---|---|---|
| `pages/dashboard/DashboardPage.tsx` | 137 | Borrar ` 👋` del final del `<h1>`. Sin reemplazo. |
| `pages/admin/FlujosPage.tsx` | 172, 657, 658 | 657: `📝` → icono `MessageSquare`. 658 y 172: `⏰` → icono `Clock`. `lucide-react` ya está importado en `:5-9`; agregar los dos nombres. |
| `pages/CapacitacionesPage.tsx` | 613, 617-619, 701, 787-789, 796-798 | `✅❌⏳` → `CheckCircle`/`XCircle`/`Clock`. `📅🕐📍` → `Calendar`/`Clock`/`MapPin`. En `:701` el emoji está dentro de un `<option>` de un `<select>` nativo: **ahí no se puede poner un icono**, dejar solo el texto «Crear nuevo tipo...». |
| `pages/planillas/PlanillaDetailPage.tsx` | 1291, 1373, 1377, 1435, 1444, 1449, 1503 | `⚠`→`AlertTriangle`, `⏳`→`Clock`, `✓`→`Check`, `🗓`→`CalendarDays`, `⚡`→`Zap` (2 usos), `📋`→`ClipboardCopy`. |
| `pages/EquipoPage.tsx` | 40-42, 47-49 | Sacar `🔵🟡🏢` de los strings. **Están duplicados** en `DIAGRAMA_LABEL` y `DIAGRAMA_OPTIONS`: hay que tocar los dos bloques o quedan inconsistentes. |
| `pages/admin/UsuariosPage.tsx` | 573, 574, 655 | `🔄`/`📅` fuera de los template strings. `:655` es `U+26A0 U+FE0F`: **el match exacto necesita los dos codepoints**; reemplazar por el icono `AlertTriangle`. |
| `pages/ausencias/AusenciasPage.tsx` | 343, 536 | `💰`→`DollarSign`. `✓` (`:536`) → `Check`. |
| `pages/auth/ForgotPasswordPage.tsx` | 82 | `🛠️` es `U+1F6E0 U+FE0F`. Borrar; es un aviso de modo desarrollo, no necesita icono. |
| `pages/admin/ConfigPage.tsx` | 82 | `{saved ? '✓ Guardado' : 'Guardar cambios'}` → usar el icono `Check` junto al texto «Guardado». |
| `components/calendario/CalendarioCompacto.tsx` | 68 | **NO borrar el `▓`.** Es un swatch que identifica un patrón en la leyenda. Reemplazar por `<span className="inline-block h-3 w-3 rounded-sm" style={{ background: <el color de esa celda> }} />`. |
| `components/calendario/CalendarioDetallado.tsx` | 320-321 | Igual que el anterior, con `▓` y `▨`. |

- [ ] **Step 2: Verificar que no quedó ninguno**

```bash
cd apps/web && node -e "const fs=require('fs'),p=require('path');function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,f.name);if(f.isDirectory())w(q);else if(/\.(ts|tsx)$/.test(f.name)){const t=fs.readFileSync(q,'utf8');t.split('\n').forEach((l,i)=>{for(const c of l){const cp=c.codePointAt(0);if(cp>0x2190&&cp!==0x2192&&cp!==0x2500&&cp!==0x2550)console.log(q+':'+(i+1)+': U+'+cp.toString(16).toUpperCase()+' '+c)}})}}}w('src')"
```

Esperado: solo los swatches del calendario si se decidió dejarlos como caracteres, y nada más. Cualquier otra línea es un emoji que se pasó por alto.

- [ ] **Step 3: Typecheck y lint**

```bash
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

- [ ] **Step 4: Verificar en el navegador**

Dashboard (saludo sin emoji), Flujos (chips del pipeline), Capacitaciones y el detalle de una planilla. Las leyendas de los calendarios deben seguir siendo legibles.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "style(web): reemplazar los emojis hardcodeados por iconos lucide"
```

---

### Task 24: Quitar los emojis de los títulos de notificación

**Files:**
- Modify: `apps/api/src/utils/notificacion.utils.ts:32-34,58-60,84-86,116,180`
- Modify: `apps/api/src/routes/sesiones-capacitacion.routes.ts:246,342,503,609`
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts:357,365,443`
- Modify: `apps/api/src/routes/mensajes.routes.ts:268,349`

**Contexto:** estos títulos se guardan en la tabla de notificaciones y la web los muestra crudos en `NotificationBell.tsx:177`. Aunque se limpie todo `apps/web`, la campanita seguiría mostrando emojis sin este cambio.

- [ ] **Step 1: Sacar el emoji de cada título**

Quitar el emoji y el espacio que lo sigue, dejando el texto. **No cambiar la redacción**: hay filas viejas en la base con el título anterior y conviene que sigan siendo comparables.

- [ ] **Step 2: No tocar los logs de consola**

`app.ts:329-331`, `backup.service.ts`, `feriados-sync.service.ts`, `debug-auth.utils.ts` y `seed.ts` usan emojis en logs del servidor. **No son UI**, quedan como están. Tampoco se toca el HTML del mail de reset (`email.utils.ts:42`).

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src
git commit -m "style(api): quitar los emojis de los titulos de notificacion

Se ven crudos en la campanita. Las notificaciones ya guardadas conservan el
suyo: esto solo aplica a las nuevas."
```

---

## Task 25: Verificación final

**Files:** ninguno (verificación)

- [ ] **Step 1: Typecheck y lint completos**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit && npx eslint .
```

Esperado: sin errores en ninguno.

- [ ] **Step 2: Correr todos los tests unitarios**

```bash
cd apps/api && npx tsx tests/seed-idempotente.test.ts && npx tsx tests/zod-es.test.ts && npx tsx tests/calendario-access.test.ts
cd apps/web && npx tsx src/utils/periodos.test.ts && npx tsx src/lib/errores.test.ts
```

Esperado: las 5 suites en OK. `calendario-access.test.ts` es preexistente y sirve de control: si se rompió, algo de este trabajo lo afectó.

- [ ] **Step 3: Verificación de integración**

Con el servidor levantado:

```bash
cd apps/api && npx tsx tests/config-periodo.qa.ts
```

- [ ] **Step 4: Recorrido manual, capturas 1 a 10**

Repetir el recorrido original y confirmar cada punto:

1. Dashboard — el saludo no tiene emoji
2. Flujos — el pipeline no tiene emojis
3. Nuevo usuario con contraseña inválida — dice qué campo corregir
4. Nuevo usuario > Diagrama — solo los 9 diagramas reales, ningún `SIM3-`
5. Cierre de Período — «16 Jul - 15 Ago 2026» en título y desplegable
6. Cierre > Pendientes a 360px — el filtro no se desborda
7. Nuevo rol — el bloque explica qué habilita cada nivel
8. WENTOP — la tarjeta abre y muestra su foto
9. WENTOP como creador — se ven «Cerrar» y «Editar», y cerrar funciona

- [ ] **Step 5: Revisar el historial**

```bash
git log --oneline main..HEAD
```

Esperado: un commit por tarea, en el orden del plan.

---

## Notas para quien ejecute

- **Dependencias entre tareas:** la Tarea 6 y la 11 usan `mensajeDeError`, que se crea en la 17. Si se ejecutan antes, usar el fallback provisorio indicado y volver después.
- **La Tarea 5 es irreversible.** No ejecutarla sin haber verificado el dump de la Tarea 1.
- **Las suites `apps/api/tests/qa/*.qa.ts` quedan rotas** tras el reset porque hacen login con usuarios `@demo.com` que dejan de existir. No es una regresión de este trabajo.
- **Verificar los nombres reales antes de escribir**, en los lugares marcados: el helper de toast, el campo `rolNivel` en el store de autenticación, la exportación del cliente de API, el payload del PATCH de diagrama y los nombres de campo de la interfaz de WENTOP. El plan indica el lugar exacto donde confirmarlos.
