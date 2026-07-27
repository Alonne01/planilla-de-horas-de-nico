# Ausencias y vacaciones en la planilla — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los días pedidos aparezcan en la planilla en la fecha correcta — los aprobados bloqueados, los que están en revisión marcados pero editables — y que al aprobarse pisen lo cargado cuando la planilla todavía es editable.

**Architecture:** Tres fases. La 1 unifica la representación de "un día" en todo el sistema (medianoche UTC del día calendario argentino), normalizando en el borde de entrada del API y sacando del front todo `new Date()` sobre una fecha-día; incluye la migración de datos. La 2 agrega `solicitudesPendientes` al detalle de planilla y su pintado. La 3 hace que la inyección de días bloqueados respete el estado de la planilla y notifique cuando no puede aplicar.

**Tech Stack:** Node + Express + Prisma (PostgreSQL) en `apps/api`; React 19 + Vite + TanStack Query + Tailwind en `apps/web`. Tests: scripts `tsx` con `node:assert` (unitarios) y suites QA black-box contra la API viva en `localhost:4000`.

**Spec:** `docs/superpowers/specs/2026-07-27-ausencias-en-planilla-design.md`

---

## Estructura de archivos

**Se crean:**
- `apps/api/src/utils/fecha-dia.utils.ts` — helpers puros de fecha-día (sin Prisma, para que lo pueda importar `zod.utils.ts` sin arrastrar el cliente de base). Única autoridad de la convención.
- `apps/api/tests/fecha-dia.test.ts` — unitarios de esos helpers.
- `apps/web/src/utils/fechaDia.ts` — equivalente del front: clave y formateo sin construir `Date` locales.
- `apps/web/src/utils/fechaDia.test.ts` — unitarios del front.
- `apps/api/prisma/migrations/<timestamp>_normalizar_fechas_dia/migration.sql` — migración de datos.
- `apps/api/tests/qa/planilla-solicitudes.qa.ts` — suite QA de las fases 2 y 3.

**Se modifican (fase 1):** `apps/api/src/utils/contexto-dia.utils.ts` (pasa a re-exportar), `apps/api/src/utils/zod.utils.ts`, `apps/api/src/utils/ausencia-calendar.utils.ts`, las rutas que reciben fechas-día (`ausencias`, `vacaciones`, `planillas`, `usuarios`, `capacitaciones`, `sesiones-capacitacion`, `exportaciones`, `wentop`, `cambios-diagrama`), y en el front `PlanillaDetailPage.tsx`, `planillaHelpers.ts`, `AusenciasPage.tsx`, `VacacionesPage.tsx`, `MisSolicitudesPage.tsx`, `AprobacionesPage.tsx`, `EquipoPage.tsx`, `CapacitacionesPage.tsx`, `admin/UsuariosPage.tsx`, `admin/VacacionSaldosPage.tsx`, `calendario/CalendarioCompacto.tsx`, `calendario/shared.ts`.

**Se modifican (fases 2 y 3):** `apps/api/src/routes/planillas.routes.ts`, `apps/api/src/utils/ausencia-calendar.utils.ts`, `apps/api/src/routes/ausencias.routes.ts`, `apps/api/src/routes/vacaciones.routes.ts`, `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`, `apps/web/src/utils/planillaHelpers.ts`.

## Antes de empezar

- [ ] **Backup de la base**

```bash
cd "C:/dev/planilla de horas"
pg_dump "postgresql://planilla_user:PASSWORD@localhost:5432/planilla_horas" > backup-antes-fechas-dia-20260727.sql
```

La contraseña real está en `apps/api/.env` (`DATABASE_URL`). Verificá que el archivo pese más de 0 bytes antes de seguir.

---

# FASE 1 — Una sola convención de fecha-día

## Task 1: Helpers de fecha-día en el API

**Files:**
- Create: `apps/api/src/utils/fecha-dia.utils.ts`
- Test: `apps/api/tests/fecha-dia.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/tests/fecha-dia.test.ts`:

```ts
import assert from 'node:assert';
import {
  claveFecha,
  diaDesdeEntrada,
  mismoDia,
  dentroDelRango,
  diaLocalEmpresaDe,
  hoyLocalEmpresa,
} from '../src/utils/fecha-dia.utils.js';

async function run() {
  // 1. Fecha-sola: el día es literal, no se le aplica ningún offset.
  assert.strictEqual(diaDesdeEntrada('2026-07-31').toISOString(), '2026-07-31T00:00:00.000Z');

  // 2. Medianoche argentina (lo que manda hoy el front) → día 31, no 30.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T03:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 3. Mediodía argentino (lo que manda hoy la planilla) → mismo día.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T15:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 4. Medianoche UTC exacta YA es la convención de destino: se devuelve igual.
  //    Restarle el offset la correría al día anterior y rompería todo lo migrado.
  assert.strictEqual(diaDesdeEntrada('2026-07-31T00:00:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 5. Offset explícito -03:00 (formato que puede mandar un cliente).
  assert.strictEqual(diaDesdeEntrada('2026-07-31T00:00:00-03:00').toISOString(), '2026-07-31T00:00:00.000Z');

  // 6. Las últimas 3 horas del día argentino: en UTC ya es el día siguiente,
  //    pero para el usuario sigue siendo el 31.
  assert.strictEqual(diaDesdeEntrada('2026-08-01T02:59:00.000Z').toISOString(), '2026-07-31T00:00:00.000Z');

  // 7. Acepta Date además de string.
  assert.strictEqual(diaDesdeEntrada(new Date('2026-07-31T15:00:00.000Z')).toISOString(), '2026-07-31T00:00:00.000Z');

  // 8. Entrada inválida: falla fuerte, no devuelve Invalid Date.
  assert.throws(() => diaDesdeEntrada('no-es-fecha'), RangeError);

  // 9. claveFecha sigue funcionando con las tres convenciones viejas.
  assert.strictEqual(claveFecha(new Date('2026-07-31T00:00:00.000Z')), '2026-07-31');
  assert.strictEqual(claveFecha(new Date('2026-07-31T03:00:00.000Z')), '2026-07-31');
  assert.strictEqual(claveFecha(new Date('2026-07-31T15:00:00.000Z')), '2026-07-31');

  // 10. mismoDia compara por día calendario, no por instante.
  assert.strictEqual(mismoDia(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T15:00:00.000Z')), true);
  assert.strictEqual(mismoDia(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')), false);

  // 11. dentroDelRango es inclusivo en los dos extremos — el bug del primer día
  //     del período era exactamente esto (00:00Z < 03:00Z daba "afuera").
  const ini = new Date('2026-07-16T03:00:00.000Z');
  const fin = new Date('2026-08-15T03:00:00.000Z');
  assert.strictEqual(dentroDelRango(new Date('2026-07-16T00:00:00.000Z'), ini, fin), true);
  assert.strictEqual(dentroDelRango(new Date('2026-08-15T00:00:00.000Z'), ini, fin), true);
  assert.strictEqual(dentroDelRango(new Date('2026-07-15T00:00:00.000Z'), ini, fin), false);
  assert.strictEqual(dentroDelRango(new Date('2026-08-16T00:00:00.000Z'), ini, fin), false);

  // 12. El día de negocio de un instante: a las 00:00Z en Argentina todavía es
  //     ayer. Este borde se rompe si hoyLocalEmpresa reusa diaDesdeEntrada, cuyo
  //     atajo de medianoche-UTC-ya-normalizada no aplica a un instante real.
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T00:00:00.000Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T00:00:00.001Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T02:59:59.999Z'))), '2026-07-30');
  assert.strictEqual(claveFecha(diaLocalEmpresaDe(new Date('2026-07-31T03:00:00.000Z'))), '2026-07-31');
  assert.strictEqual(hoyLocalEmpresa().getTime() % 86_400_000, 0);

  // 13. El atajo de fecha-sola también valida: un día que no existe no puede
  //     colarse como el día siguiente.
  assert.throws(() => diaDesdeEntrada('2026-13-45'), RangeError);
  assert.throws(() => diaDesdeEntrada('2026-02-30'), RangeError);

  console.log('✓ fecha-dia: 13/13 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/fecha-dia.test.ts
```

Esperado: FAIL — `Cannot find module '../src/utils/fecha-dia.utils.js'`.

- [ ] **Step 3: Escribir la implementación**

Crear `apps/api/src/utils/fecha-dia.utils.ts`:

```ts
/**
 * Autoridad única de la convención de FECHA-DÍA del sistema.
 *
 * Regla: una fecha que representa un DÍA (no un instante) se guarda como
 * **medianoche UTC del día calendario argentino**. Todo lo que entra por el API
 * pasa por `diaDesdeEntrada`; toda comparación de días va por clave, nunca por
 * timestamp.
 *
 * Este módulo NO importa Prisma a propósito: lo usa `zod.utils.ts`, que se
 * carga en el borde de validación de todas las rutas.
 */

// Argentina es UTC-3 todo el año (no observa horario de verano desde 2009), así
// que un desplazamiento fijo alcanza sin tirar de una librería de zonas horarias.
// Si la empresa alguna vez opera en otro huso —o en uno con horario de verano—,
// este valor deja de alcanzar: hay que resolver el offset real del huso de la
// empresa en el momento de la consulta (por ejemplo con `Intl` y un `timeZone`
// guardado por empresa) en vez de un desplazamiento constante.
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

const MS_POR_DIA = 86_400_000;

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Clave YYYY-MM-DD de una fecha, en UTC. */
export function claveFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Medianoche UTC del día calendario argentino que corresponde a `valor`.
 *
 * Tres casos, en este orden:
 *   1. `"YYYY-MM-DD"` → ese día, literal. Aplicarle el offset lo correría un día.
 *   2. Medianoche UTC exacta → se devuelve igual: YA está en la convención de
 *      destino (es lo que hay guardado y lo que mandan los tests QA existentes).
 *   3. Cualquier otro instante → se mide su día calendario en Argentina. Así
 *      `03:00Z` (medianoche AR) y `15:00Z` (mediodía AR) caen en el mismo día, y
 *      las últimas 3 h del día argentino no se van al día siguiente.
 */
export function diaDesdeEntrada(valor: string | Date): Date {
  if (typeof valor === 'string' && SOLO_FECHA.test(valor.trim())) {
    const soloFecha = valor.trim();
    const dia = new Date(`${soloFecha}T00:00:00.000Z`);
    // El round-trip caza los días que no existen: '2026-02-30' se normalizaría
    // solo a marzo, y '2026-13-45' queda Invalid Date.
    if (Number.isNaN(dia.getTime()) || claveFecha(dia) !== soloFecha) {
      throw new RangeError(`Fecha inválida: ${valor}`);
    }
    return dia;
  }
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Fecha inválida: ${String(valor)}`);
  }
  if (d.getTime() % MS_POR_DIA === 0) return new Date(d.getTime());
  const local = new Date(d.getTime() - OFFSET_ARGENTINA_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * ¿Las dos fechas caen en el mismo día calendario?
 *
 * Normaliza antes de comparar: si midiera el día con `claveFecha` a secas, el
 * módulo tendría DOS nociones de "día" (la argentina de `diaDesdeEntrada` y la
 * UTC de `claveFecha`), que discrepan en la ventana (00:00Z, 03:00Z).
 */
export function mismoDia(a: Date, b: Date): boolean {
  return claveFecha(diaDesdeEntrada(a)) === claveFecha(diaDesdeEntrada(b));
}

/**
 * ¿`dia` cae dentro de [desde, hasta], comparando por día calendario?
 * Inclusivo en ambos extremos y a prueba de fechas con horas distintas.
 */
export function dentroDelRango(dia: Date, desde: Date, hasta: Date): boolean {
  const clave = claveFecha(diaDesdeEntrada(dia));
  return clave >= claveFecha(diaDesdeEntrada(desde)) && clave <= claveFecha(diaDesdeEntrada(hasta));
}

/**
 * Medianoche UTC del día calendario de HOY en el huso de la empresa (Argentina),
 * NO en el huso del servidor.
 *
 * El servidor puede correr en cualquier huso (en producción, típicamente UTC),
 * pero quien usa el sistema piensa las fechas en hora argentina. Tomar los
 * componentes UTC crudos de "ahora" mide el día calendario UTC, que difiere del
 * argentino durante las últimas 3 horas de cada día en Argentina (21:00–24:00).
 */
export function diaLocalEmpresaDe(instante: Date): Date {
  // NO pasa por `diaDesdeEntrada`: el atajo de "medianoche UTC ya normalizada"
  // que esa función aplica vale para fechas-día guardadas, pero acá el argumento
  // es un instante real, y a las 00:00:00Z en Argentina todavía son las 21:00 del
  // día anterior.
  const local = new Date(instante.getTime() - OFFSET_ARGENTINA_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

export function hoyLocalEmpresa(): Date {
  return diaLocalEmpresaDe(new Date());
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/fecha-dia.test.ts
```

Esperado: `✓ fecha-dia: 13/13 OK`

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/fecha-dia.utils.ts apps/api/tests/fecha-dia.test.ts
git commit -m "feat(api): helpers de fecha-dia con una convencion unica"
```

---

## Task 2: `contexto-dia.utils.ts` deja de definir la convención

`claveFecha` y `hoyLocalEmpresa` viven ahora en `fecha-dia.utils.ts`. Para no romper los importadores existentes (`cambios-diagrama.routes.ts:22`, `export.routes.ts:6`, `diagrama-vigencia.utils.ts:2`, `cambios-diagrama.service.ts:3`), `contexto-dia.utils.ts` las re-exporta.

**Files:**
- Modify: `apps/api/src/utils/contexto-dia.utils.ts:68-115`

- [ ] **Step 1: Reemplazar las definiciones por el re-export**

Borrar de `contexto-dia.utils.ts` el bloque que va desde el comentario `/** Clave YYYY-MM-DD de una fecha, en UTC. ... */` (línea 68) hasta el cierre de `hoyLocalEmpresa()` (línea 115) — incluida la constante `OFFSET_ARGENTINA_MS` y su comentario — y poner en su lugar:

```ts
// La convención de fecha-día (y su documentación) vive en fecha-dia.utils.ts.
// Se re-exporta acá porque medio código ya la importa desde este módulo.
export { claveFecha, hoyLocalEmpresa } from './fecha-dia.utils.js';
```

Sólo esos dos: son los únicos que alguien importa desde acá. Cada re-export de más
es un segundo camino sancionado para llegar a la API nueva, justo en contra de
tener una sola autoridad.

Agregar arriba, junto al resto de los imports del archivo:

```ts
import { claveFecha } from './fecha-dia.utils.js';
```

(`claveFecha` se usa dentro del propio módulo, en `esFeriado`, línea ~188.)

- [ ] **Step 2: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores. Si aparece `Duplicate identifier 'claveFecha'`, quedó una definición vieja sin borrar.

- [ ] **Step 3: Correr los tests unitarios que dependen de esto**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/diagrama-vigencia.test.ts && npx tsx tests/fecha-dia.test.ts
```

Esperado: `✓ diagrama-vigencia: 22/22 OK` y `✓ fecha-dia: 13/13 OK`

- [ ] **Step 4: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/contexto-dia.utils.ts
git commit -m "refactor(api): la convencion de fecha-dia vive en un solo modulo"
```

---

## Task 3: Schema zod `fechaDia`

**Files:**
- Modify: `apps/api/src/utils/zod.utils.ts`
- Test: `apps/api/tests/fecha-dia.test.ts` (se le agregan casos)

- [ ] **Step 1: Agregar los casos al test**

En `apps/api/tests/fecha-dia.test.ts`, agregar el import y los casos antes del `console.log` final:

```ts
import { fechaDia, spanDiasCalendario } from '../src/utils/zod.utils.js';
```

```ts
  // 14. fechaDia devuelve un Date ya normalizado, no un string.
  const parseado = fechaDia.parse('2026-07-31T03:00:00.000Z');
  assert.ok(parseado instanceof Date);
  assert.strictEqual(parseado.toISOString(), '2026-07-31T00:00:00.000Z');

  // 15. fechaDia rechaza basura con el mismo mensaje que fechaFlexible.
  assert.strictEqual(fechaDia.safeParse('31/07/2026').success, false);

  // 16. Una fecha malformada NO puede hacer explotar el refine que la consume:
  //     zod corre los refine de objeto aunque un campo ya haya fallado, así que
  //     un throw acá se escaparía de safeParse y la ruta contestaría 500.
  assert.ok(Number.isNaN(spanDiasCalendario('31/07/2026', '31/07/2026')));

  // 17. spanDiasCalendario acepta Date (además de string) y es inclusivo.
  assert.strictEqual(spanDiasCalendario('2026-07-28', '2026-07-29'), 2);
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-28T00:00:00.000Z'), new Date('2026-07-29T00:00:00.000Z')),
    2,
  );
  assert.strictEqual(
    spanDiasCalendario(new Date('2026-07-31T00:00:00.000Z'), new Date('2026-07-31T00:00:00.000Z')),
    1,
  );
```

Y actualizar la línea final a `console.log('✓ fecha-dia: 17/17 OK');`

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/fecha-dia.test.ts
```

Esperado: FAIL — `fechaDia` no existe en `zod.utils.js`.

- [ ] **Step 3: Implementar**

En `apps/api/src/utils/zod.utils.ts`, agregar el import arriba:

```ts
import { diaDesdeEntrada } from './fecha-dia.utils.js';
```

Agregar después de `fechaFlexible`:

```ts
/**
 * Fecha-DÍA: valida igual que `fechaFlexible` pero **devuelve un `Date` ya
 * normalizado** a medianoche UTC del día calendario argentino.
 *
 * Los handlers no tienen que decidir nada: da lo mismo si el cliente manda
 * "2026-07-31", "2026-07-31T00:00:00-03:00" o un ISO con hora.
 *
 * `fechaFlexible` sigue existiendo para lo que NO es una fecha-día: las horas de
 * entrada/salida de un registro (`horaOpcional` en planillas.routes.ts), que son
 * instantes reales y conservan su hora.
 */
export const fechaDia = fechaFlexible.transform((s, ctx) => {
  try {
    return diaDesdeEntrada(s);
  } catch {
    // `fechaFlexible` valida con Date.parse, que acepta días que no existen
    // rodándolos al mes siguiente ('2026-02-29' → 1 de marzo). El guard de
    // round-trip de `diaDesdeEntrada` los caza, pero si el throw sale de acá se
    // escapa de `safeParse` (que sólo atrapa ZodError) y la ruta contesta 500.
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha inválida (use formato YYYY-MM-DD o ISO 8601)' });
    return z.NEVER;
  }
});
```

Y reemplazar `spanDiasCalendario` para que acepte los dos tipos:

```ts
/**
 * Cantidad de días-calendario entre dos fechas, inclusive en ambos extremos
 * (el mismo día da 1). Acepta strings validados por `fechaFlexible` o los `Date`
 * que devuelve `fechaDia`.
 */
export function spanDiasCalendario(fechaInicio: string | Date, fechaFin: string | Date): number {
  try {
    const ini = diaDesdeEntrada(fechaInicio);
    const fin = diaDesdeEntrada(fechaFin);
    return Math.round((fin.getTime() - ini.getTime()) / 86_400_000) + 1;
  } catch {
    // Entrada inválida → NaN, que hace fallar el refine que la consume y termina
    // en un 400. Si esto lanzara, la excepción se escaparía de `safeParse` (zod
    // corre los refine de objeto aunque un campo interno ya haya fallado) y la
    // ruta contestaría 500.
    return NaN;
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/fecha-dia.test.ts
```

Esperado: `✓ fecha-dia: 17/17 OK`

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/zod.utils.ts apps/api/tests/fecha-dia.test.ts
git commit -m "feat(api): schema zod fechaDia que normaliza en el borde de entrada"
```

---

## Task 4: `ausencia-calendar.utils.ts` compara por día calendario

**Files:**
- Modify: `apps/api/src/utils/ausencia-calendar.utils.ts:29-46`, `:118-121`, `:158-162`, `:202-221`
- Test: `apps/api/tests/ausencia-calendar.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/tests/ausencia-calendar.test.ts`:

```ts
import assert from 'node:assert';
import { buildDaysBetween, clampDia } from '../src/utils/ausencia-calendar.utils.js';

const d = (iso: string) => new Date(iso);

async function run() {
  // 1. Rango de un día.
  const uno = buildDaysBetween(d('2026-07-31T00:00:00.000Z'), d('2026-07-31T00:00:00.000Z'));
  assert.strictEqual(uno.length, 1);
  assert.strictEqual(uno[0]!.toISOString(), '2026-07-31T00:00:00.000Z');

  // 2. Rango de dos días.
  const dos = buildDaysBetween(d('2026-07-28T00:00:00.000Z'), d('2026-07-29T00:00:00.000Z'));
  assert.deepStrictEqual(
    dos.map((x) => x.toISOString()),
    ['2026-07-28T00:00:00.000Z', '2026-07-29T00:00:00.000Z'],
  );

  // 3. Entradas con hora argentina (datos previos a la migración): mismo día.
  const conHora = buildDaysBetween(d('2026-07-31T03:00:00.000Z'), d('2026-07-31T03:00:00.000Z'));
  assert.strictEqual(conHora.length, 1);
  assert.strictEqual(conHora[0]!.toISOString(), '2026-07-31T00:00:00.000Z');

  // 4. clampDia recorta al piso del período aunque el período tenga hora.
  assert.strictEqual(
    clampDia(d('2026-07-10T00:00:00.000Z'), d('2026-07-16T03:00:00.000Z')).toISOString(),
    '2026-07-16T00:00:00.000Z',
  );

  // 5. El día que ya está dentro no se toca.
  assert.strictEqual(
    clampDia(d('2026-07-20T00:00:00.000Z'), d('2026-07-16T03:00:00.000Z')).toISOString(),
    '2026-07-20T00:00:00.000Z',
  );

  // 6. clampDia con techo.
  assert.strictEqual(
    clampDia(d('2026-08-20T00:00:00.000Z'), d('2026-08-15T03:00:00.000Z'), true).toISOString(),
    '2026-08-15T00:00:00.000Z',
  );

  console.log('✓ ausencia-calendar: 6/6 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/ausencia-calendar.test.ts
```

Esperado: FAIL — `buildDaysBetween` y `clampDia` no están exportados.

- [ ] **Step 3: Implementar**

En `apps/api/src/utils/ausencia-calendar.utils.ts`, agregar el import:

```ts
import { claveFecha, diaDesdeEntrada, dentroDelRango } from './fecha-dia.utils.js';
```

Reemplazar los helpers del final del archivo (`buildDaysBetween` y `clampDate`, líneas 202-221) por:

```ts
/**
 * Días calendario entre dos fechas, inclusive. Normaliza las puntas: da lo mismo
 * si vienen a medianoche UTC, a medianoche argentina o con la hora de la
 * aprobación.
 *
 * Exportada para poder testearla sin base de datos.
 */
export function buildDaysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = diaDesdeEntrada(start);
  const last = diaDesdeEntrada(end);
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Recorta un día contra un borde del período, comparando por día calendario.
 *
 * Antes comparaba timestamps: con el período guardado a las 03:00Z y el día a
 * las 00:00Z, el primer día del período quedaba afuera.
 */
export function clampDia(dia: Date, borde: Date, esTecho = false): Date {
  const d = diaDesdeEntrada(dia);
  const b = diaDesdeEntrada(borde);
  if (esTecho) return d > b ? b : d;
  return d < b ? b : d;
}
```

Reemplazar en `inyectarDiasBloqueados` la búsqueda de planilla (líneas 42-44) por:

```ts
    const planilla = planillas.find(
      (p) => dentroDelRango(day, p.periodoInicio, p.periodoFin)
    );
```

Y ampliar el pre-filtro del `findMany` que trae las planillas (líneas 33-39) con
`rangoConsultaDia(desde, hasta)` — un helper puro que vive en `fecha-dia.utils.ts`
y ensancha el rango al día completo. Sin
esto el arreglo no sirve: el filtro SQL compara timestamps, así que con una
ausencia que arranca `2026-07-31T03:00:00Z` y un `periodoFin` en
`2026-07-31T00:00:00Z` la planilla nunca entra al array y `dentroDelRango` no
llega a compararla. Mismo patrón que `tramosDeUsuario`
(`diagrama-vigencia.utils.ts:47`): se amplía al día completo y el recorte fino lo
hace la comparación por clave.

```ts
  const rango = rangoConsultaDia(range.fechaInicio, range.fechaFin);

  const planillas = await prisma.planilla.findMany({
    where: {
      usuarioId: range.usuarioId,
      periodoInicio: { lte: rango.hasta },
      periodoFin: { gte: rango.desde },
    },
    select: { id: true, periodoInicio: true, periodoFin: true },
  });
```

Aplicar el mismo criterio a los dos `findMany` de `backfillAusenciasEnPlanilla`
(el de ausencias y el de vacaciones), que filtran contra `periodoInicio`/`periodoFin`.

Y en `backfillAusenciasEnPlanilla`, reemplazar las cuatro llamadas a `clampDate` (líneas 119-120 y 160-161) por `clampDia`:

```ts
    const days = buildDaysBetween(
      clampDia(aus.fechaInicio, periodoInicio),
      clampDia(aus.fechaFin, periodoFin, true),
    );
```

```ts
    const days = buildDaysBetween(
      clampDia(vac.fechaInicio, periodoInicio),
      clampDia(vac.fechaFin, periodoFin, true),
    );
```

Verificar que no quede ninguna referencia a `clampDate`:

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -rn "clampDate" src/
```

Esperado: sin resultados.

- [ ] **Step 4: Correr los tests**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/ausencia-calendar.test.ts && npx tsc --noEmit
```

Esperado: `✓ ausencia-calendar: 6/6 OK` y compilación limpia.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/ausencia-calendar.utils.ts apps/api/tests/ausencia-calendar.test.ts
git commit -m "fix(api): la inyeccion de dias bloqueados compara por dia calendario"
```

---

## Task 5: Rutas de ausencias normalizan la entrada

**Files:**
- Modify: `apps/api/src/routes/ausencias.routes.ts:15,46-47,66-67,217-218,283-284,339-340,361,413-414,543-544`

- [ ] **Step 1: Cambiar el import**

```ts
import { fechaDia, spanDiasCalendario } from '../utils/zod.utils.js';
```

(Si quedara algún uso de `fechaFlexible` en el archivo, dejarlo también en el import; verificar con `grep -n "fechaFlexible" src/routes/ausencias.routes.ts` al terminar.)

- [ ] **Step 2: Cambiar los schemas**

Reemplazar **todas** las apariciones de `fechaInicio: fechaFlexible` por `fechaInicio: fechaDia` y `fechaFin: fechaFlexible` por `fechaFin: fechaDia` (líneas 46-47, 217-218, 339-340), y las variantes opcionales (líneas 66-67):

```ts
  fechaInicio: fechaDia.optional(),
  fechaFin: fechaDia.optional(),
```

Los `.refine()` que comparan fechas siguen funcionando, pero ahora reciben `Date`. Reemplazar en los tres schemas:

```ts
).refine(
  (d) => d.fechaFin >= d.fechaInicio,
  { message: 'fechaFin debe ser mayor o igual a fechaInicio', path: ['fechaFin'] },
).refine(
```

(En el schema de update, donde son opcionales, el refine correspondiente debe tolerar `undefined`: `(d) => !d.fechaInicio || !d.fechaFin || d.fechaFin >= d.fechaInicio`.)

- [ ] **Step 3: Sacar los `new Date(...)` de los handlers**

Reemplazar `fechaInicio: new Date(parsed.data.fechaInicio)` por `fechaInicio: parsed.data.fechaInicio` y `fechaFin: new Date(parsed.data.fechaFin)` por `fechaFin: parsed.data.fechaFin` (líneas 283-284, 413-414, 543-544).

En la línea 361, reemplazar:

```ts
    const anio = parsed.data.fechaInicio.getUTCFullYear();
```

**Y unificar el criterio en TODOS los sitios que tocan el mismo saldo**, o queda
una regresión: la reserva iría a un año y el consumo a otro. Con el proceso en
Argentina (UTC-3), `new Date('2026-01-01T00:00:00Z').getFullYear()` devuelve
**2025**. Pasar a `getUTCFullYear()` en: `ausencias.routes.ts:717,879,1035,1103`,
`planillas.routes.ts:695,1245,1274` y `marca-manual.utils.ts:26` — y reescribir el
comentario de `marca-manual.utils.ts:17-19`, que documenta el invariante viejo
("el año se toma con getFullYear() LOCAL a propósito").

La fecha ya está normalizada a medianoche UTC del día calendario argentino, así
que el año UTC ES el año del día que pidió el usuario; el año local es el que
puede equivocarse.

- [ ] **Step 4: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores. Los que aparezcan van a ser del tipo "`Date` no es asignable a `string`" y marcan exactamente los lugares que quedaron sin ajustar.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/ausencias.routes.ts
git commit -m "fix(api): las ausencias guardan la fecha normalizada al dia"
```

---

## Task 6: Rutas de vacaciones normalizan la entrada

**Files:**
- Modify: `apps/api/src/routes/vacaciones.routes.ts:27` y los handlers que hacen `new Date(...)` sobre esas fechas

- [ ] **Step 1: Cambiar el schema**

En la línea 27, reemplazar `fechaInicio: z.string()` (y el `fechaFin` que lo acompaña) por:

```ts
  fechaInicio: fechaDia,
  fechaFin: fechaDia,
```

Agregar el import arriba del archivo:

```ts
import { fechaDia } from '../utils/zod.utils.js';
```

- [ ] **Step 2: Sacar los `new Date(...)` de los handlers**

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -n "new Date(parsed.data.fecha\|new Date(data.fecha\|new Date(body.fecha" src/routes/vacaciones.routes.ts
```

Reemplazar cada uno por el valor directo (ya es `Date`).

- [ ] **Step 3: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/vacaciones.routes.ts
git commit -m "fix(api): las vacaciones guardan la fecha normalizada al dia"
```

---

## Task 7: Rutas de planillas normalizan la entrada

Ojo con `horaOpcional` (línea 70): **no se toca**. Las horas de entrada/salida son instantes reales, no fechas-día.

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:61-62,73,1014,1104,1382,1449,1471`

- [ ] **Step 1: Cambiar el import y los schemas**

```ts
import { fechaDia, fechaFlexible, spanDiasCalendario } from '../utils/zod.utils.js';
```

- Líneas 61-62 (`createPlanillaSchema`): `periodoInicio: fechaDia.optional()`, `periodoFin: fechaDia.optional()`.
- Línea 73 (`createRegistroSchema`): `fecha: fechaDia`.
- Línea 94 (`updateRegistroSchema`): `fecha: fechaDia.optional()`.
- Línea 1382 (`marcarDiaSchema`): `fecha: fechaDia`.
- Línea 70 (`horaOpcional`): **queda con `fechaFlexible`**.

- [ ] **Step 2: Sacar los `new Date(...)` de los handlers**

- Línea 1014: `const fecha = parsed.data.fecha;`
- Línea 1104: `const fecha = parsed.data.fecha ?? existingReg.fecha;`
- Línea 1449: `const fecha = parsed.data.fecha;` (el comentario de arriba sobre `setHours` ya no aplica; reemplazarlo por: `// La fecha llega normalizada por fechaDia: medianoche UTC del día calendario.`)
- Línea 1471: `const anio = fecha.getUTCFullYear();`

- [ ] **Step 3: Arreglar la guardia de rango de `marcar-dia`**

Reemplazar las líneas 1450-1455 por:

```ts
    if (!dentroDelRango(fecha, planilla.periodoInicio, planilla.periodoFin)) {
      res.status(400).json({ error: 'La fecha está fuera del período de la planilla' });
      return;
    }
```

Agregar el import:

```ts
import { dentroDelRango, claveFecha } from '../utils/fecha-dia.utils.js';
```

Directo al módulo, no vía `contexto-dia.utils.js`: ese re-exporta sólo
`claveFecha` y `hoyLocalEmpresa`, y no conviene dejar dos caminos de import para
el mismo símbolo en el mismo archivo.

- [ ] **Step 4: Usar la clave de día en la validación de faltantes**

En el bloque de envío, reemplazar las líneas 427-433 por:

```ts
    const registrosPorFecha = new Map<string, (typeof registros)[number]>();
    for (const r of registros) {
      const rDate = claveFecha(r.fecha);
      if (!registrosPorFecha.has(rDate)) registrosPorFecha.set(rDate, r);
    }

    for (let d = new Date(inicio); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = claveFecha(d);
```

- [ ] **Step 5: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/planillas.routes.ts
git commit -m "fix(api): la planilla guarda y compara las fechas por dia calendario"
```

---

## Task 8: Resto de las rutas con fechas-día

**Files:**
- Modify: `apps/api/src/routes/usuarios.routes.ts:34,37,38,53,56,57,58,67`
- Modify: `apps/api/src/routes/capacitaciones.routes.ts:26,27`
- Modify: `apps/api/src/routes/sesiones-capacitacion.routes.ts:21`
- Modify: `apps/api/src/routes/exportaciones.routes.ts:13,14`
- Modify: `apps/api/src/routes/wentop.routes.ts:62,82`
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts:57`

- [ ] **Step 1: Cambiar `fechaFlexible` por `fechaDia` en esos campos**

En cada archivo, cambiar el import a `import { fechaDia } from '../utils/zod.utils.js';` y reemplazar el schema del campo. Ejemplo en `usuarios.routes.ts`:

```ts
  fechaNacimiento: fechaDia.optional().nullable(),
  fechaIngreso: fechaDia,
  fechaFinPrueba: fechaDia.optional().nullable(),
  fechaEgreso: fechaDia.optional().nullable(),
```

- [ ] **Step 2: Sacar los `new Date(...)` correspondientes**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Cada error de tipo marca un `new Date(parsed.data.X)` que ahora sobra. Reemplazarlo por el valor directo. Repetir hasta que compile limpio.

- [ ] **Step 3: Verificar que no quedaron fechas-día sin normalizar**

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -rn "fechaFlexible" src/routes/
```

Esperado: sólo `planillas.routes.ts:70` (`horaOpcional`, que son horas reales) y el import que la acompaña.

- [ ] **Step 4: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/
git commit -m "fix(api): el resto de las rutas normaliza sus fechas-dia"
```

---

## Task 9: Helper de fecha-día en el front

**Files:**
- Create: `apps/web/src/utils/fechaDia.ts`
- Create: `apps/web/src/utils/fechaDia.test.ts`
- Modify: `apps/web/package.json:7` (agregar el test a `test:unit`)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/utils/fechaDia.test.ts`:

```ts
import assert from 'node:assert';
import { diaKey, fmtDia, diaLocal } from './fechaDia.js';

async function run() {
  // 1. La clave sale del string, sin construir un Date (que correría el día en UTC-3).
  assert.strictEqual(diaKey('2026-07-31T00:00:00.000Z'), '2026-07-31');

  // 2. Datos previos a la migración (medianoche argentina) → mismo día.
  assert.strictEqual(diaKey('2026-07-31T03:00:00.000Z'), '2026-07-31');

  // 3. Fecha-sola.
  assert.strictEqual(diaKey('2026-07-31'), '2026-07-31');

  // 4. diaLocal da un Date en el día correcto del huso del navegador.
  const d = diaLocal('2026-07-31T00:00:00.000Z');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 31);

  // 5. El formateo muestra el día pedido, no el anterior.
  assert.strictEqual(fmtDia('2026-07-31T00:00:00.000Z'), '31/7/2026');

  console.log('✓ fechaDia: 5/5 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsx src/utils/fechaDia.test.ts
```

Esperado: FAIL — no existe `./fechaDia.js`.

- [ ] **Step 3: Implementar**

Crear `apps/web/src/utils/fechaDia.ts`:

```ts
/**
 * Fechas-DÍA en el front.
 *
 * El backend las guarda como medianoche UTC del día calendario argentino y las
 * serializa con `.toISOString()`. Construir un `Date` con ese string y leerlo con
 * getters locales (`getDate()`, `toLocaleDateString()`) corre el día hacia atrás
 * en cualquier huso negativo: en Argentina (UTC-3), `2026-07-31T00:00:00.000Z`
 * es el 30 a las 21:00. Ese era el bug de la ausencia que se pintaba un día antes.
 *
 * Regla: la clave del día sale del STRING; si hace falta un `Date` (para
 * formatear o para calcular), se construye con los componentes ya extraídos.
 *
 * Esto NO aplica a horas reales (entrada/salida de un turno): esas sí se leen
 * con `new Date(iso)` porque su hora importa.
 */

/** Clave 'YYYY-MM-DD' de una fecha-día serializada por el backend. */
export function diaKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Componentes [año, mes 1-12, día] de una fecha-día. */
export function ymd(iso: string): [number, number, number] {
  const [y, m, d] = diaKey(iso).split('-').map(Number);
  return [y as number, m as number, d as number];
}

/** `Date` en el huso del navegador, posicionado en el día correcto (mediodía). */
export function diaLocal(iso: string): Date {
  const [y, m, d] = ymd(iso);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Formato es-AR de una fecha-día. */
export function fmtDia(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return diaLocal(iso).toLocaleDateString('es-AR', opts);
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsx src/utils/fechaDia.test.ts
```

Esperado: `✓ fechaDia: 5/5 OK`

- [ ] **Step 5: Sumarlo a la suite**

En `apps/web/package.json`, agregar al final del script `test:unit`:

```
 && tsx src/utils/fechaDia.test.ts
```

Correr `cd "C:/dev/planilla de horas/apps/web" && npm run test:unit` — esperado: todas las suites en OK.

- [ ] **Step 6: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src/utils/fechaDia.ts apps/web/src/utils/fechaDia.test.ts apps/web/package.json
git commit -m "feat(web): helper de fecha-dia que no corre el dia por timezone"
```

---

## Task 10: La planilla usa la clave de día

Este es el arreglo del bug reportado: la ausencia del 31 dejaba de pintarse el 30.

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:334-343,432,620-623,874-897`
- Modify: `apps/web/src/utils/planillaHelpers.ts:213-223`

- [ ] **Step 1: El índice de registros usa la clave del string**

Reemplazar el `registroMap` (líneas 334-343) por:

```ts
  // Build registro lookup map
  const registroMap = useMemo(() => {
    const map: Record<string, Registro> = {};
    if (planilla) {
      for (const r of planilla.registros) {
        map[diaKey(r.fecha)] = r;
      }
    }
    return map;
  }, [planilla]);
```

Agregar el import:

```ts
import { diaKey } from '@/utils/fechaDia';
```

- [ ] **Step 2: El calendario se arma desde las claves del período**

En `apps/web/src/utils/planillaHelpers.ts`, reemplazar `buildCalendarDays` (líneas 213-223) por:

```ts
/** Build all calendar days for a 21→20 period */
export function buildCalendarDays(periodoInicio: string, periodoFin: string): Date[] {
  // Las puntas son fechas-DÍA: se toman del string. `new Date(iso)` las correría
  // un día en cualquier huso negativo (ver utils/fechaDia.ts).
  const [yi, mi, di] = periodoInicio.slice(0, 10).split('-').map(Number);
  const [yf, mf, df] = periodoFin.slice(0, 10).split('-').map(Number);
  const start = new Date(yi as number, (mi as number) - 1, di as number, 12, 0, 0);
  const end = new Date(yf as number, (mf as number) - 1, df as number, 12, 0, 0);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
```

- [ ] **Step 3: Al guardar se manda la clave, no un instante**

En `handleSaveDay` (líneas 874-897), reemplazar:

```ts
  function handleSaveDay() {
    const [y, m, d] = selectedDate!.split('-').map(Number);

    const toIso = (time: string) => {
      if (!time) return null;
      const [h, min] = time.split(':').map(Number);
      return new Date(y, m - 1, d, h, min, 0).toISOString();
    };
```

y en el `mutate`:

```ts
      fecha: selectedDate,
```

(`toIso` se mantiene tal cual: las horas de entrada/salida son instantes reales.)

- [ ] **Step 4: El modo copiar manda la clave**

En el bloque de pintado (líneas 615-623), reemplazar la línea del body:

```ts
            fecha: key,
```

- [ ] **Step 5: Verificar que compila y que el lint no empeora**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b && npm run lint
```

Esperado: compila; el lint no supera los 31 problemas de baseline.

- [ ] **Step 6: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx apps/web/src/utils/planillaHelpers.ts
git commit -m "fix(web): la planilla ubica los registros por clave de dia"
```

---

## Task 11: Barrido del resto de las pantallas

**Files:**
- Modify: `apps/web/src/pages/ausencias/AusenciasPage.tsx`, `apps/web/src/pages/vacaciones/VacacionesPage.tsx`, `apps/web/src/pages/MisSolicitudesPage.tsx`, `apps/web/src/pages/aprobaciones/AprobacionesPage.tsx`, `apps/web/src/pages/EquipoPage.tsx`, `apps/web/src/pages/CapacitacionesPage.tsx`, `apps/web/src/pages/admin/UsuariosPage.tsx`, `apps/web/src/pages/admin/VacacionSaldosPage.tsx`, `apps/web/src/components/calendario/CalendarioCompacto.tsx`, `apps/web/src/components/calendario/shared.ts`

- [ ] **Step 1: Listar los usos a revisar**

```bash
cd "C:/dev/planilla de horas/apps/web/src" && grep -rnE "new Date\([^)]*[fF]echa" --include=*.tsx --include=*.ts .
```

**El compilador NO es red de seguridad acá.** `lib.es2015.core.d.ts` agrega la
sobrecarga `new (value: number | string | Date): Date`, así que `new Date(unDate)`
compila sin una queja aunque sobre. Esto salió en la tanda del API: el barrido hay
que hacerlo con grep, archivo por archivo, y `tsc` limpio no prueba nada sobre los
envoltorios que hayan quedado.

- [ ] **Step 2: Reemplazar caso por caso**

Para cada resultado, decidir con esta regla:

- Es una **fecha-día** (`fechaInicio`, `fechaFin`, `fechaIngreso`, `fechaEgreso`, `fechaNacimiento`, `fechaRealizacion`, `fechaVencimiento`, `fechaEfectiva`, `fechaReporte`, `fechaCierre`, `periodoInicio`, `periodoFin`, `registro.fecha`, `sesion.fecha`) → usar los helpers:
  - `new Date(x.fechaInicio).toLocaleDateString('es-AR')` → `fmtDia(x.fechaInicio)`
  - `new Date(x.fechaInicio).toLocaleDateString('es-AR', opts)` → `fmtDia(x.fechaInicio, opts)`
  - `new Date(x.fechaInicio).toISOString().split('T')[0]` (para inputs `type="date"`) → `diaKey(x.fechaInicio)`
  - comparaciones y aritmética de días → `diaLocal(x.fechaInicio)`
- Es un **instante** (`createdAt`, `aprobadaAt`, `enviadaAt`, horas de turno) → se deja como está.

Import a agregar en cada archivo tocado:

```ts
import { diaKey, fmtDia, diaLocal } from '@/utils/fechaDia';
```

En `components/calendario/shared.ts`, la función local `ymd` y `fmtDate` pasan a delegar (para no tener dos implementaciones):

```ts
export { ymd, fmtDia as fmtDate } from '@/utils/fechaDia';
```

y borrar las definiciones viejas de `ymd` y `fmtDate` de ese archivo (líneas 92-101).

- [ ] **Step 3: Verificar que no quedó ninguno**

```bash
cd "C:/dev/planilla de horas/apps/web/src" && grep -rnE "new Date\([^)]*[fF]echa(Inicio|Fin|Ingreso|Egreso|Nacimiento|Realizacion|Vencimiento|Efectiva|Reporte|Cierre)" --include=*.tsx --include=*.ts .
```

Esperado: sin resultados.

- [ ] **Step 4: Compilar y correr los tests del front**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b && npm run test:unit && npm run lint
```

Esperado: compila, todas las suites OK, lint sin superar el baseline de 31.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src
git commit -m "fix(web): todas las pantallas leen las fechas-dia por clave"
```

---

## Task 12: Migración de datos

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_normalizar_fechas_dia/migration.sql`

- [ ] **Step 1: Contar lo que se va a migrar (antes)**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma db execute --stdin <<'SQL'
SELECT 'ausencias' t, count(*) FROM ausencias WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'vacaciones', count(*) FROM vacaciones WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'planillas', count(*) FROM planillas WHERE (periodo_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'registros', count(*) FROM registros_horas WHERE (fecha AT TIME ZONE 'UTC')::time <> '00:00:00';
SQL
```

Anotar los números: al terminar tienen que ser todos 0.

- [ ] **Step 2: Verificar que el colapso no rompe el índice único**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma db execute --stdin <<'SQL'
SELECT count(*) AS colisiones FROM (
  SELECT planilla_id, date(fecha AT TIME ZONE 'UTC') d
  FROM registros_horas GROUP BY 1,2 HAVING count(*) > 1
) x;
SQL
```

Esperado: `0`. Si diera distinto de 0, **parar**: hay días con dos registros (uno con horas y otro bloqueado) y hay que decidir cuál sobrevive antes de migrar. La regla en ese caso es conservar el bloqueado y borrar el otro.

- [ ] **Step 3: Crear la migración vacía**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma migrate dev --name normalizar_fechas_dia --create-only
```

- [ ] **Step 4: Escribir el SQL**

En el `migration.sql` recién creado:

```sql
-- Normaliza todas las FECHAS-DÍA a medianoche UTC del día calendario argentino.
--
-- POR QUÉ EL `AT TIME ZONE 'UTC'` DEL FINAL (y no se puede sacar):
-- `ts AT TIME ZONE 'America/Argentina/Buenos_Aires'` sobre un `timestamptz`
-- devuelve un `timestamp` SIN huso. Al asignarlo de vuelta a una columna
-- `timestamptz`, Postgres lo reinterpreta EN LA ZONA DE LA SESIÓN. Con la sesión
-- en UTC sale bien; con la sesión en hora argentina es un no-op silencioso.
-- El `AT TIME ZONE 'UTC'` cierra el viaje de ida y vuelta explícitamente, así
-- que el resultado no depende de la configuración de la conexión.
--
-- POR QUÉ EL WHERE TAMBIÉN LLEVA `AT TIME ZONE 'UTC'`:
-- `col::time` sobre un `timestamptz` también se evalúa en la zona de la sesión.
-- Bajo una sesión en hora argentina, una fila YA correcta (00:00Z) castea a
-- 21:00:00 y entraría al UPDATE, que la correría un día. La guarda tiene que
-- preguntar por la hora EN UTC.
--
-- Sólo se tocan las filas cuya hora UTC no sea 00:00: las demás ya están en la
-- convención de destino, y aplicarles la conversión las correría al día anterior.
-- Escrito así, el script es idempotente: correrlo dos veces da el mismo estado.
--
-- No se tocan los instantes reales (created_at, aprobada_at, enviada_at,
-- entrada_turno*, salida_turno*, etc.).

UPDATE registros_horas SET fecha = date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE ausencias SET fecha_inicio = date_trunc('day', fecha_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE ausencias SET fecha_fin = date_trunc('day', fecha_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE vacaciones SET fecha_inicio = date_trunc('day', fecha_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE vacaciones SET fecha_fin = date_trunc('day', fecha_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE planillas SET periodo_inicio = date_trunc('day', periodo_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (periodo_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE planillas SET periodo_fin = date_trunc('day', periodo_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (periodo_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE usuarios_diagramas SET fecha_inicio = date_trunc('day', fecha_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE usuarios_diagramas SET fecha_fin = date_trunc('day', fecha_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_fin IS NOT NULL AND (fecha_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE usuarios SET fecha_ingreso = date_trunc('day', fecha_ingreso AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_ingreso AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE usuarios SET fecha_nacimiento = date_trunc('day', fecha_nacimiento AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_nacimiento IS NOT NULL AND (fecha_nacimiento AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE usuarios SET fecha_fin_prueba = date_trunc('day', fecha_fin_prueba AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_fin_prueba IS NOT NULL AND (fecha_fin_prueba AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE usuarios SET fecha_egreso = date_trunc('day', fecha_egreso AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_egreso IS NOT NULL AND (fecha_egreso AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE exportaciones SET periodo_inicio = date_trunc('day', periodo_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (periodo_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE exportaciones SET periodo_fin = date_trunc('day', periodo_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (periodo_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE proyectos SET fecha_inicio = date_trunc('day', fecha_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_inicio IS NOT NULL AND (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE proyectos SET fecha_fin = date_trunc('day', fecha_fin AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_fin IS NOT NULL AND (fecha_fin AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE empleado_capacitaciones SET fecha_realizacion = date_trunc('day', fecha_realizacion AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_realizacion AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE empleado_capacitaciones SET fecha_vencimiento = date_trunc('day', fecha_vencimiento AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_vencimiento IS NOT NULL AND (fecha_vencimiento AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE sesiones_capacitacion SET fecha = date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE solicitudes_cambio_diagrama SET fecha_efectiva = date_trunc('day', fecha_efectiva AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_efectiva IS NOT NULL AND (fecha_efectiva AT TIME ZONE 'UTC')::time <> '00:00:00';

UPDATE wentop_tarjetas SET fecha_reporte = date_trunc('day', fecha_reporte AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE (fecha_reporte AT TIME ZONE 'UTC')::time <> '00:00:00';
UPDATE wentop_tarjetas SET fecha_cierre = date_trunc('day', fecha_cierre AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC' WHERE fecha_cierre IS NOT NULL AND (fecha_cierre AT TIME ZONE 'UTC')::time <> '00:00:00';
```

- [ ] **Step 5: Aplicar la migración**

Bajar la API si está corriendo (con la API viva, `prisma generate` falla en Windows por el `.dll` tomado), y después:

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma migrate deploy
```

- [ ] **Step 6: Verificar el resultado**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma db execute --stdin <<'SQL'
SELECT 'ausencias' t, count(*) FROM ausencias WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'vacaciones', count(*) FROM vacaciones WHERE (fecha_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'planillas', count(*) FROM planillas WHERE (periodo_inicio AT TIME ZONE 'UTC')::time <> '00:00:00'
UNION ALL SELECT 'registros', count(*) FROM registros_horas WHERE (fecha AT TIME ZONE 'UTC')::time <> '00:00:00';
SQL
```

Esperado: los cuatro en 0. Además, la ausencia del reporte tiene que seguir diciendo 31 de julio:

```bash
cd "C:/dev/planilla de horas/apps/api" && npx prisma db execute --stdin <<'SQL'
SELECT tipo, estado, fecha_inicio, fecha_fin FROM ausencias
WHERE usuario_id = (SELECT id FROM usuarios WHERE email LIKE 'op2.testing%')
ORDER BY fecha_inicio;
SQL
```

Esperado: la `FALTA_JUSTIFICADA` en `2026-07-31 00:00:00` y el `CERTIFICADO_MEDICO` del `2026-07-28` al `2026-07-29`.

- [ ] **Step 7: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/prisma/migrations
git commit -m "fix(db): normaliza todas las fechas-dia a medianoche UTC del dia AR"
```

---

## Task 13: Verificación de la fase 1

- [ ] **Step 1: Levantar el entorno**

```bash
cd "C:/dev/planilla de horas" && ./start-dev.bat
```

- [ ] **Step 2: Correr las suites QA de las áreas tocadas**

```bash
cd "C:/dev/planilla de horas/apps/api"
npx tsx tests/qa/ausencias.qa.ts
npx tsx tests/qa/vacaciones.qa.ts
npx tsx tests/qa/planillas.qa.ts
npx tsx tests/qa/marca-manual.qa.ts
npx tsx tests/qa/diagrama-vigencia.qa.ts
```

Esperado: sin fallas nuevas. Las conocidas de `audit.qa.ts` (CD12/CD13/AUD9, por `/cambios-diagrama/:id/rechazar` sin circuito) son preexistentes y no cuentan.

- [ ] **Step 3: Verificar el bug original en la app**

Entrar como `op2.testing@test.wenlen.com`, abrir la planilla del período 16/7–15/8 y confirmar que la falta justificada aparece pintada **el 31**, no el 30.

- [ ] **Step 4: Commit del estado verificado**

```bash
cd "C:/dev/planilla de horas"
git commit --allow-empty -m "test(qa): fase 1 de fechas-dia verificada en el entorno"
```

---

# FASE 2 — Las solicitudes en revisión se ven en la planilla

## Task 14: `solicitudesPendientes` en el detalle de planilla

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:273-360` (handler `GET /:id`)
- Test: `apps/api/tests/qa/planilla-solicitudes.qa.ts` (nuevo)

- [ ] **Step 1: Escribir la suite QA que falla**

Crear `apps/api/tests/qa/planilla-solicitudes.qa.ts`:

```ts
/**
 * QA Suite — SOLICITUDES EN LA PLANILLA (KEY=planilla-solicitudes)
 *
 * Cubre: solicitudesPendientes en GET /planillas/:id, el pisado condicionado al
 * estado de la planilla al aprobar, y la reposición al recrear la planilla.
 *
 * Run: cd apps/api && npx tsx tests/qa/planilla-solicitudes.qa.ts
 */

const BASE = 'http://localhost:4000/api/v1';

let fallos = 0;
function check(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); }
  else { console.log(`  FAIL ${msg}`); fallos++; }
}

async function login(email: string, password = 'Test1234!') {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!data.accessToken) throw new Error(`login falló para ${email}: ${JSON.stringify(data)}`);
  return data.accessToken as string;
}

function auth(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function run() {
  const op = await login('op2.testing@test.wenlen.com');

  // La planilla del período corriente del operador
  const planillas = await (await fetch(`${BASE}/planillas`, { headers: auth(op) })).json();
  const planilla = planillas[0];
  check(!!planilla, 'el operador tiene una planilla');

  // Solicitar una ausencia dentro del período, que queda PENDIENTE
  const fecha = planilla.periodoInicio.slice(0, 10);
  const solicitud = await (await fetch(`${BASE}/ausencias/solicitar`, {
    method: 'POST',
    headers: auth(op),
    body: JSON.stringify({
      tipo: 'FALTA_JUSTIFICADA',
      fechaInicio: fecha,
      fechaFin: fecha,
      diasAusencia: 1,
      descripcion: 'QA solicitudes pendientes',
    }),
  })).json();
  check(!!solicitud.id, 'se creó la ausencia pendiente');

  // 1. El detalle de la planilla la reporta
  const detalle = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  check(Array.isArray(detalle.solicitudesPendientes), 'el detalle trae solicitudesPendientes');
  const pend = (detalle.solicitudesPendientes ?? []).find((s: any) => s.id === solicitud.id);
  check(!!pend, 'la ausencia pendiente figura en solicitudesPendientes');
  check(pend?.clase === 'AUSENCIA', 'la clase es AUSENCIA');
  check(pend?.fechaInicio?.slice(0, 10) === fecha, 'la fecha coincide con la pedida');

  // 2. El día NO está bloqueado: la solicitud todavía no se aprobó
  const reg = (detalle.registros ?? []).find((r: any) => r.fecha.slice(0, 10) === fecha);
  check(!reg?.bloqueado, 'el día de la solicitud pendiente no está bloqueado');

  // 3. Sólo viajan solicitudes sin firmar: nada aprobado ni rechazado se cuela
  const estados = (detalle.solicitudesPendientes ?? []).map((s: any) => s.estado);
  check(estados.every((e: string) => e === 'PENDIENTE' || e === 'EN_REVISION'),
    'solicitudesPendientes sólo trae PENDIENTE / EN_REVISION');

  // limpieza
  await fetch(`${BASE}/ausencias/${solicitud.id}`, { method: 'DELETE', headers: auth(op) });

  console.log(fallos === 0 ? '\n✓ planilla-solicitudes: todo OK' : `\n✗ planilla-solicitudes: ${fallos} fallas`);
  if (fallos > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr la suite para verificar que falla**

Con la API viva:

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/planilla-solicitudes.qa.ts
```

Esperado: FAIL en `el detalle trae solicitudesPendientes`.

- [ ] **Step 3: Implementar**

En `apps/api/src/routes/planillas.routes.ts`, dentro del handler `GET /:id`, después del bloque de autorización (línea ~331) y antes del `res.json`, agregar:

```ts
    // Solicitudes en revisión que tocan el período: la planilla sólo conoce lo
    // materializado como RegistroHoras (que existe recién al aprobar), así que
    // sin esto el operador no ve los días que ya pidió. Las marcas manuales
    // (cargaManual) quedan afuera: esas ya bloquean el día y viajan en el
    // registro, como `marcaManual`.
    const [ausenciasPend, vacacionesPend] = await Promise.all([
      prisma.ausencia.findMany({
        where: {
          usuarioId: planilla.usuarioId,
          cargaManual: false,
          estado: { in: ['PENDIENTE', 'EN_REVISION'] },
          fechaInicio: { lte: planilla.periodoFin },
          fechaFin: { gte: planilla.periodoInicio },
        },
        select: { id: true, tipo: true, estado: true, fechaInicio: true, fechaFin: true, descripcion: true },
      }),
      prisma.vacacion.findMany({
        where: {
          usuarioId: planilla.usuarioId,
          estado: { in: ['PENDIENTE', 'EN_REVISION'] },
          fechaInicio: { lte: planilla.periodoFin },
          fechaFin: { gte: planilla.periodoInicio },
        },
        select: { id: true, estado: true, fechaInicio: true, fechaFin: true, motivo: true },
      }),
    ]);

    const solicitudesPendientes = [
      ...ausenciasPend.map((a) => ({
        id: a.id,
        clase: 'AUSENCIA' as const,
        tipo: a.tipo as string,
        estado: a.estado as string,
        fechaInicio: a.fechaInicio,
        fechaFin: a.fechaFin,
        descripcion: a.descripcion,
      })),
      ...vacacionesPend.map((v) => ({
        id: v.id,
        clase: 'VACACION' as const,
        tipo: 'VACACION',
        estado: v.estado as string,
        fechaInicio: v.fechaInicio,
        fechaFin: v.fechaFin,
        descripcion: v.motivo,
      })),
    ];
```

Y en la respuesta, reemplazar `res.json(planilla)` por:

```ts
    res.json({ ...planilla, solicitudesPendientes });
```

- [ ] **Step 4: Correr la suite para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/planilla-solicitudes.qa.ts
```

Esperado: `✓ planilla-solicitudes: todo OK`

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/planilla-solicitudes.qa.ts
git commit -m "feat(api): el detalle de planilla informa las solicitudes en revision"
```

---

## Task 15: Pintado del día en revisión

**Files:**
- Modify: `apps/web/src/utils/planillaHelpers.ts` (nuevo helper de estilo)
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:29-60,1131-1160,1339-1360`

- [ ] **Step 1: Agregar el tipo y el índice por día**

En `PlanillaDetailPage.tsx`, junto a la interfaz `Registro` (línea 29), agregar:

```ts
interface SolicitudPendiente {
  id: string;
  clase: 'AUSENCIA' | 'VACACION';
  tipo: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
  descripcion: string | null;
}
```

Agregar `solicitudesPendientes?: SolicitudPendiente[]` a la interfaz de la planilla, y después del `registroMap` (línea ~343):

```ts
  // Índice día → solicitud en revisión. La marca no se persiste: se recalcula
  // desde la solicitud en cada carga, así que sobrevive a borrar la planilla.
  const pendientePorDia = useMemo(() => {
    const map: Record<string, SolicitudPendiente> = {};
    for (const s of planilla?.solicitudesPendientes ?? []) {
      const cur = diaLocal(s.fechaInicio);
      const fin = diaLocal(s.fechaFin);
      while (cur <= fin) {
        map[dateKey(cur)] = s;
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [planilla]);
```

Extender el import de fechaDia:

```ts
import { diaKey, diaLocal } from '@/utils/fechaDia';
```

- [ ] **Step 2: Etiqueta corta del tipo**

En `apps/web/src/utils/planillaHelpers.ts`, al final del archivo:

```ts
/** Etiqueta corta de un tipo de ausencia/vacación, para la celda del calendario. */
export function etiquetaTipoSolicitud(tipo: string): string {
  switch (tipo) {
    case 'VACACION': return 'Vacac.';
    case 'CERTIFICADO_MEDICO': return 'Cert. Méd.';
    case 'FALTA_JUSTIFICADA': return 'Falta Just.';
    case 'FALTA_INJUSTIFICADA': return 'Falta Inj.';
    case 'LICENCIA_ESPECIAL': return 'Licencia';
    case 'FRANCO_COMPENSATORIO': return 'F.Comp';
    default: return 'Ausencia';
  }
}
```

- [ ] **Step 3: Pintar la celda**

En el `map` de días (después de la línea 1138, donde se define `isLocked`):

```ts
              // Pedido en revisión: se marca, pero el día sigue siendo editable.
              // El bloqueado gana: si ya está aprobado, manda el candado.
              const pendiente = !isLocked ? pendientePorDia[key] : undefined;
```

En el `className` de la celda (junto a `isFaltante && ...`, línea 1210), agregar:

```ts
                    pendiente && 'ring-1 ring-inset ring-dashed ring-cal-amber/50 bg-amber-500/[0.06]',
```

Y después del bloque `{isLocked && (...)}` (línea ~1360), agregar el bloque de la marca pendiente:

```tsx
                  {/* Pedido en revisión (no bloquea: el día se puede cargar) */}
                  {pendiente && (
                    <div className="relative z-10 mt-1.5 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-cal-amber/80" />
                      <span className="text-[10px] font-semibold text-cal-amber leading-tight truncate">
                        {etiquetaTipoSolicitud(pendiente.tipo)} · en revisión
                      </span>
                    </div>
                  )}
```

Agregar `etiquetaTipoSolicitud` al import de `planillaHelpers`.

- [ ] **Step 4: Verificar en el navegador**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b
```

Con la app corriendo, entrar como `op2.testing@test.wenlen.com` y confirmar que el 28 y el 29 de julio aparecen con borde punteado y la leyenda `Cert. Méd. · en revisión`, y que se pueden abrir y cargar horas.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx apps/web/src/utils/planillaHelpers.ts
git commit -m "feat(web): el calendario marca los dias con pedido en revision"
```

---

## Task 16: Aviso en el diálogo del día

**Files:**
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:1431-1440`

- [ ] **Step 1: Agregar el cartel**

En el cuerpo del diálogo del día, **antes** del bloque `{registroMap[selectedDate]?.bloqueado && (...)}` (línea 1433), agregar:

```tsx
              {/* Pedido en revisión: se avisa, pero no se bloquea la carga */}
              {!registroMap[selectedDate]?.bloqueado && pendientePorDia[selectedDate] && (
                <div className="rounded-lg border border-cal-amber/30 bg-amber-500/10 p-3 space-y-1">
                  <p className="text-xs font-semibold text-cal-amber flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {etiquetaTipoSolicitud(pendientePorDia[selectedDate]!.tipo)} en revisión
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Tenés un pedido en revisión para este día. Si se aprueba, lo que cargues acá se va a reemplazar.
                  </p>
                </div>
              )}
```

- [ ] **Step 2: Verificar en el navegador**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b
```

Abrir el 28 de julio en la planilla del operador de prueba: tiene que aparecer el cartel ámbar arriba, con el formulario del día debajo, editable y guardable.

- [ ] **Step 3: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): el dia con pedido en revision avisa que puede pisarse"
```

---

## Task 17: Los días faltantes señalan el pedido pendiente

El día en revisión **sigue contando como faltante**; lo único que cambia es que el error explica cuáles tienen un pedido en curso.

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:449-454`
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:959-975`

- [ ] **Step 1: El API informa qué faltantes tienen pedido**

Reemplazar el bloque de respuesta de faltantes (líneas 449-454) por:

```ts
    if (diasFaltantes.length > 0) {
      // Un día pedido y todavía sin firmar sigue siendo un hueco (la planilla no
      // sale con huecos), pero conviene decir por qué se lo sigue pidiendo.
      const pendientes = await prisma.ausencia.findMany({
        where: {
          usuarioId: planilla.usuarioId,
          cargaManual: false,
          estado: { in: ['PENDIENTE', 'EN_REVISION'] },
          fechaInicio: { lte: planilla.periodoFin },
          fechaFin: { gte: planilla.periodoInicio },
        },
        select: { fechaInicio: true, fechaFin: true },
      });
      const conPedido = diasFaltantes.filter((dia) =>
        pendientes.some((p) => dia >= claveFecha(p.fechaInicio) && dia <= claveFecha(p.fechaFin))
      );
      res.status(400).json({
        error: `Faltan completar ${diasFaltantes.length} día(s) en la planilla`,
        diasFaltantes,
        diasConPedidoPendiente: conPedido,
      });
      return;
    }
```

- [ ] **Step 2: El front lo explica**

En `PlanillaDetailPage.tsx`, agregar el estado junto a `diasFaltantes` (línea 135):

```ts
  const [diasConPedido, setDiasConPedido] = useState<string[]>([]);
```

En el `catch` del envío (línea ~244):

```ts
        setDiasConPedido(err.response.data.diasConPedidoPendiente ?? []);
```

Y en el cartel de faltantes (línea ~964), debajo del texto existente:

```tsx
              {diasConPedido.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {diasConPedido.length} de esos días tienen un pedido en revisión. Hasta que se apruebe, hay que cargarlos igual.
                </p>
              )}
```

- [ ] **Step 3: Agregar el escenario a la suite QA**

En `apps/api/tests/qa/planilla-solicitudes.qa.ts`, justo antes del bloque de limpieza, agregar:

```ts
  // Un día pedido y sin cargar SIGUE contando como faltante al enviar
  const envio = await fetch(`${BASE}/planillas/${planilla.id}/enviar`, { method: 'POST', headers: auth(op) });
  const errEnvio = await envio.json();
  check(envio.status === 400, 'la planilla con huecos no se envía');
  check((errEnvio.diasFaltantes ?? []).includes(fecha), 'el día con pedido en revisión sigue siendo faltante');
  check((errEnvio.diasConPedidoPendiente ?? []).includes(fecha), 'el error marca que ese día tiene pedido en revisión');
```

- [ ] **Step 4: Verificar**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit && npx tsx tests/qa/planilla-solicitudes.qa.ts
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b
```

Esperado: la suite pasa, incluidos los tres checks nuevos.

Con la app viva: intentar enviar la planilla del operador con el 28/29 sin cargar → el error tiene que listar los días y aclarar cuántos tienen pedido en revisión.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/planillas.routes.ts apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat: el aviso de dias faltantes distingue los que tienen pedido"
```

---

# FASE 3 — Al aprobar, se pisa o se avisa

## Task 18: `inyectarDiasBloqueados` respeta el estado de la planilla

**Files:**
- Modify: `apps/api/src/utils/ausencia-calendar.utils.ts:28-84`
- Test: `apps/api/tests/qa/planilla-solicitudes.qa.ts` (se le agregan escenarios)

- [ ] **Step 1: Agregar los escenarios QA que fallan**

En `apps/api/tests/qa/planilla-solicitudes.qa.ts`, antes de la limpieza, agregar:

```ts
  // 3. Con la planilla en BORRADOR, aprobar pisa las horas cargadas
  const diaPisar = new Date(Date.parse(planilla.periodoInicio) + 86_400_000).toISOString().slice(0, 10);
  await fetch(`${BASE}/planillas/${planilla.id}/registros`, {
    method: 'POST',
    headers: auth(op),
    body: JSON.stringify({
      fecha: diaPisar,
      entradaTurno1: `${diaPisar}T08:00:00.000Z`,
      salidaTurno1: `${diaPisar}T16:00:00.000Z`,
      lugarTrabajo: 'BASE',
      pernocte: 'NO',
      maneja: false,
      horasViajeInput: 0,
    }),
  });

  // Helper: solicita una falta justificada de un día y la lleva hasta APROBADA
  // recorriendo el circuito (supervisor → coordinador → RRHH).
  async function solicitarYAprobar(dia: string, descripcion: string): Promise<string> {
    const aus = await (await fetch(`${BASE}/ausencias/solicitar`, {
      method: 'POST',
      headers: auth(op),
      body: JSON.stringify({
        tipo: 'FALTA_JUSTIFICADA', fechaInicio: dia, fechaFin: dia,
        diasAusencia: 1, descripcion,
      }),
    })).json();
    for (const email of ['sup2.testing@test.wenlen.com', 'coord2.testing@test.wenlen.com', 'rrhh1@test.wenlen.com']) {
      const token = await login(email);
      await fetch(`${BASE}/ausencias/${aus.id}/avanzar`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
    }
    return aus.id as string;
  }

  await solicitarYAprobar(diaPisar, 'QA pisado');

  const detalle2 = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const delDia = (detalle2.registros ?? []).filter((r: any) => r.fecha.slice(0, 10) === diaPisar);
  check(delDia.length === 1, 'el día pisado tiene UN solo registro (no se duplicó)');
  check(delDia[0]?.bloqueado === true, 'el día quedó bloqueado');
  check(Number(delDia[0]?.horasTrabajadas) === 0, 'las horas se pusieron en cero');
  check(delDia[0]?.entradaTurno1 === null, 'el horario cargado se limpió');

  // 4. Los bordes del período: el último día también se inyecta (antes se perdía
  //    porque 00:00Z quedaba fuera del filtro contra un período guardado a 03:00Z)
  const ultimoDia = planilla.periodoFin.slice(0, 10);
  await solicitarYAprobar(ultimoDia, 'QA borde fin de período');
  const detalleBorde = await (await fetch(`${BASE}/planillas/${planilla.id}`, { headers: auth(op) })).json();
  const regUltimo = (detalleBorde.registros ?? []).find((r: any) => r.fecha.slice(0, 10) === ultimoDia);
  check(!!regUltimo?.bloqueado, 'la ausencia del último día del período se inyectó');

  // 5. Borrar y recrear la planilla repone el día aprobado
  await fetch(`${BASE}/planillas/${planilla.id}`, { method: 'DELETE', headers: auth(op) });
  const nueva = await (await fetch(`${BASE}/planillas`, {
    method: 'POST', headers: auth(op), body: JSON.stringify({}),
  })).json();
  const detalle3 = await (await fetch(`${BASE}/planillas/${nueva.id}`, { headers: auth(op) })).json();
  const repuesto = (detalle3.registros ?? []).find((r: any) => r.fecha.slice(0, 10) === diaPisar);
  check(!!repuesto?.bloqueado, 'al recrear la planilla, el día aprobado vuelve bloqueado');
  check(repuesto?.fecha?.slice(0, 10) === diaPisar, 'vuelve en la fecha correcta');
```

- [ ] **Step 2: Correr la suite para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/planilla-solicitudes.qa.ts
```

Esperado: FAIL en los checks de pisado.

- [ ] **Step 3: Implementar**

En `apps/api/src/utils/ausencia-calendar.utils.ts`, reemplazar `inyectarDiasBloqueados` por:

```ts
/** Estados en los que la planilla todavía se puede tocar. */
const ESTADOS_EDITABLES = ['BORRADOR', 'RECHAZADA'];

export interface ResultadoInyeccion {
  /** Claves 'YYYY-MM-DD' que quedaron bloqueadas. */
  aplicados: string[];
  /** Días que tenían horas cargadas y fueron reemplazados. */
  pisados: string[];
  /** Días que NO se aplicaron porque la planilla ya salió del borrador. */
  omitidos: Array<{ dia: string; planillaId: string; estado: string }>;
}

/**
 * Materializa un rango de ausencia/vacación como días bloqueados.
 *
 * Si la planilla del día es editable (BORRADOR/RECHAZADA), el bloqueo **pisa** lo
 * que hubiera cargado. Si ya está ENVIADA/EN_REVISION/APROBADA no se toca nada:
 * un documento firmado no se modifica por atrás. El llamador avisa con la lista
 * de `omitidos` para que se rechace y reenvíe.
 *
 * Los días sin planilla se saltean: los repone `backfillAusenciasEnPlanilla`
 * cuando la planilla se cree.
 */
export async function inyectarDiasBloqueados(range: AusenciaRange): Promise<ResultadoInyeccion> {
  const days = buildDaysBetween(range.fechaInicio, range.fechaFin);
  const resultado: ResultadoInyeccion = { aplicados: [], pisados: [], omitidos: [] };

  const planillas = await prisma.planilla.findMany({
    where: {
      usuarioId: range.usuarioId,
      periodoInicio: { lte: range.fechaFin },
      periodoFin: { gte: range.fechaInicio },
    },
    select: { id: true, periodoInicio: true, periodoFin: true, estado: true },
  });

  const planillasTocadas = new Set<string>();

  for (const day of days) {
    const planilla = planillas.find(
      (p) => dentroDelRango(day, p.periodoInicio, p.periodoFin)
    );
    if (!planilla) continue;

    if (!ESTADOS_EDITABLES.includes(planilla.estado)) {
      resultado.omitidos.push({ dia: claveFecha(day), planillaId: planilla.id, estado: planilla.estado });
      continue;
    }

    const previo = await prisma.registroHoras.findUnique({
      where: { planillaId_fecha: { planillaId: planilla.id, fecha: day } },
      select: { entradaTurno1: true, horasTrabajadas: true, bloqueado: true },
    });
    const teniaHoras = !!previo && !previo.bloqueado
      && (!!previo.entradaTurno1 || Number(previo.horasTrabajadas) > 0);

    await prisma.registroHoras.upsert({
      where: {
        planillaId_fecha: { planillaId: planilla.id, fecha: day },
      },
      update: {
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        // Zero out hours — absence days have no worked hours
        entradaTurno1: null,
        salidaTurno1: null,
        entradaTurno2: null,
        salidaTurno2: null,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        lugarTrabajo: null,
      },
      create: {
        planillaId: planilla.id,
        fecha: day,
        bloqueado: true,
        motivoBloqueo: range.motivoBloqueo,
        marcaManualId: range.marcaManualId ?? null,
        observaciones: range.observaciones,
        horasTrabajadas: ZERO,
        horasNormales: ZERO,
        horasExtra50: ZERO,
        horasExtra100: ZERO,
        horasViajeCalc: ZERO,
        horasViajeInput: ZERO,
      },
    });

    resultado.aplicados.push(claveFecha(day));
    if (teniaHoras) resultado.pisados.push(claveFecha(day));
    planillasTocadas.add(planilla.id);
  }

  // Los totales de la cabecera se recalculan una vez por planilla tocada: pisar
  // horas cargadas las cambia.
  for (const planillaId of planillasTocadas) {
    await recalcularTotalesPlanilla(planillaId);
  }

  return resultado;
}
```

Agregar arriba el import (no genera ciclo: `calculo.utils.ts` no importa este módulo):

```ts
import { recalcularTotalesPlanilla } from './calculo.utils.js';
```

- [ ] **Step 4: Verificar que no quedó doble recálculo**

`planillas.routes.ts:1542` llama a `recalcularTotalesPlanilla` justo después de `inyectarDiasBloqueados` en `marcar-dia`. Ahora es redundante: borrar esa línea.

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

- [ ] **Step 5: Correr la suite**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/planilla-solicitudes.qa.ts
```

Esperado: `✓ planilla-solicitudes: todo OK`

- [ ] **Step 6: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/ausencia-calendar.utils.ts apps/api/src/routes/planillas.routes.ts apps/api/tests/qa/planilla-solicitudes.qa.ts
git commit -m "feat(api): el dia aprobado pisa las horas solo si la planilla es editable"
```

---

## Task 19: Notificaciones de pisado y de no-aplicado

**Files:**
- Modify: `apps/api/src/routes/ausencias.routes.ts:921-928`
- Modify: `apps/api/src/routes/vacaciones.routes.ts:917-926`
- Create: helper en `apps/api/src/utils/ausencia-calendar.utils.ts`

- [ ] **Step 1: Helper de aviso**

Al final de `apps/api/src/utils/ausencia-calendar.utils.ts`:

```ts
/**
 * Traduce el resultado de la inyección en notificaciones para el dueño de la
 * planilla y para quien aprobó. Sin esto, el operador se entera de que le
 * borraron las horas (o de que la ausencia no se aplicó) sólo si mira.
 */
export async function avisarResultadoInyeccion(params: {
  resultado: ResultadoInyeccion;
  usuarioId: string;
  aprobadorId: string;
  etiqueta: string;
}): Promise<void> {
  const { resultado, usuarioId, aprobadorId, etiqueta } = params;

  if (resultado.pisados.length > 0) {
    await crearNotificacion({
      usuarioId,
      tipo: 'PLANILLA',
      titulo: 'Se reemplazaron horas cargadas',
      cuerpo: `${etiqueta}: se aprobó y los días ${resultado.pisados.join(', ')} quedaron bloqueados. Las horas que tenías cargadas ahí se reemplazaron.`,
      link: '/planillas',
    });
  }

  if (resultado.omitidos.length > 0) {
    const dias = resultado.omitidos.map((o) => o.dia).join(', ');
    const estado = resultado.omitidos[0]!.estado;
    const cuerpo = `${etiqueta}: se aprobó, pero la planilla del período ya está ${estado} y no se modificó. Para que los días ${dias} queden bloqueados hay que rechazarla y reenviarla.`;
    await crearNotificacion({
      usuarioId, tipo: 'PLANILLA', titulo: 'La ausencia aprobada no se aplicó a la planilla', cuerpo, link: '/planillas',
    });
    await crearNotificacion({
      usuarioId: aprobadorId, tipo: 'PLANILLA', titulo: 'Ausencia aprobada sin aplicar a la planilla', cuerpo, link: '/aprobaciones',
    });
  }
}
```

Agregar el import arriba del archivo:

```ts
import { crearNotificacion } from './notificacion.utils.js';
```

- [ ] **Step 2: Usarlo al aprobar una ausencia**

En `apps/api/src/routes/ausencias.routes.ts`, reemplazar el bloque de la línea 921:

```ts
      const resultadoInyeccion = await inyectarDiasBloqueados({
        usuarioId: ausencia.usuario.id,
        fechaInicio: ausencia.fechaInicio,
        fechaFin: ausencia.fechaFin,
        motivoBloqueo: ausencia.tipo,
        observaciones: `${tipoLabel}${ausencia.descripcion ? ` — ${ausencia.descripcion}` : ''}`,
      });
      await avisarResultadoInyeccion({
        resultado: resultadoInyeccion,
        usuarioId: ausencia.usuarioId,
        aprobadorId: req.user!.userId,
        etiqueta: tipoLabel,
      });
```

Extender el import de la línea 12:

```ts
import { inyectarDiasBloqueados, avisarResultadoInyeccion, formatTipoAusencia } from '../utils/ausencia-calendar.utils.js';
```

- [ ] **Step 3: Usarlo al aprobar vacaciones**

En `apps/api/src/routes/vacaciones.routes.ts`, reemplazar el bloque de la línea 918:

```ts
    if (nuevoEstado === 'APROBADA') {
      const resultadoInyeccion = await inyectarDiasBloqueados({
        usuarioId: vacacion.usuario.id,
        fechaInicio: vacacion.fechaInicio,
        fechaFin: vacacion.fechaFin,
        motivoBloqueo: 'VACACION',
        observaciones: `Vacaciones${vacacion.motivo ? ` — ${vacacion.motivo}` : ''}`,
      });
      await avisarResultadoInyeccion({
        resultado: resultadoInyeccion,
        usuarioId: vacacion.usuarioId,
        aprobadorId: req.user!.userId,
        etiqueta: 'Vacaciones',
      });
    }
```

Extender el import de la línea 6:

```ts
import { inyectarDiasBloqueados, avisarResultadoInyeccion } from '../utils/ausencia-calendar.utils.js';
```

- [ ] **Step 4: Verificar**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit && npx tsx tests/qa/planilla-solicitudes.qa.ts && npx tsx tests/qa/notif.qa.ts
```

Esperado: compila y ambas suites pasan.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/ausencia-calendar.utils.ts apps/api/src/routes/ausencias.routes.ts apps/api/src/routes/vacaciones.routes.ts
git commit -m "feat(api): avisa cuando la aprobacion pisa horas o no puede aplicarse"
```

---

## Task 20: Verificación final

- [ ] **Step 1: Suite completa del API**

```bash
cd "C:/dev/planilla de horas/apps/api"
npx tsx tests/fecha-dia.test.ts
npx tsx tests/ausencia-calendar.test.ts
npx tsx tests/diagrama-vigencia.test.ts
npx tsx tests/qa/ausencias.qa.ts
npx tsx tests/qa/vacaciones.qa.ts
npx tsx tests/qa/planillas.qa.ts
npx tsx tests/qa/planilla-solicitudes.qa.ts
npx tsx tests/qa/marca-manual.qa.ts
npx tsx tests/qa/cancelaciones.qa.ts
```

Esperado: todo en OK. Documentar cualquier falla que quede junto con si es preexistente (comparar contra `git stash` del estado anterior si hace falta).

- [ ] **Step 2: Suite del front**

```bash
cd "C:/dev/planilla de horas/apps/web" && npm run test:unit && npx tsc -b && npm run lint
```

Esperado: suites OK, compila, lint sin superar el baseline de 31.

- [ ] **Step 3: Recorrido manual del escenario reportado**

Con `op2.testing@test.wenlen.com`:

1. La falta justificada aprobada del 31/07 se pinta **el 31**, con candado.
2. El certificado médico 28–29/07 en revisión se pinta esos dos días, con borde punteado y `Cert. Méd. · en revisión`.
3. Abrir el 28: aparece el cartel ámbar y el formulario editable. Cargar horas y guardar.
4. Aprobar el certificado con el circuito (supervisor → coordinador → RRHH).
5. Volver a la planilla: el 28 y el 29 quedan bloqueados, las horas del 28 desaparecieron, y hay una notificación de que se reemplazaron.
6. Borrar la planilla y crearla de nuevo: los tres días vuelven bloqueados y en su fecha.

- [ ] **Step 4: Commit final**

```bash
cd "C:/dev/planilla de horas"
git commit --allow-empty -m "test: verificacion end-to-end de ausencias en la planilla"
```
