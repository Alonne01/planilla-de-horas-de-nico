# Vigencia del diagrama por día — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un cambio de diagrama aprobado a mitad de período parta el período en dos —diagrama viejo hasta la fecha de inicio, nuevo desde ahí— en el cálculo, en la planilla, en el calendario de equipo y en el export, y que la solicitud venza si no se aprueba antes de esa fecha.

**Architecture:** `UsuarioDiagrama` ya es un historial con `fechaInicio`/`fechaFin`, pero todo el código resuelve la vigencia por el flag `activo`, que sólo apunta a la asignación corriente. Se agrega un módulo único (`diagrama-vigencia.utils.ts`) que devuelve los **tramos** que cubren un rango y decide el tramo de cada día; todo lo demás —cálculo del recargo, validación de envío, detalle de planilla, gantt, export— pasa a consultarlo. El front recibe esos tramos y los aplica con un helper espejo. Sobre esa base, la solicitud de cambio pide fecha de inicio obligatoria y futura, vence al llegar esa fecha sin aprobación, y al aplicarse recalcula los días afectados de las planillas todavía editables.

**Tech Stack:** Express 4 + Prisma 5 (PostgreSQL) en `apps/api`; React + Vite + TanStack Query + Tailwind en `apps/web`. Tests unitarios con `node:assert` corridos por `tsx`; suites QA black-box contra la API viva en `http://localhost:4000`.

**Spec:** `docs/superpowers/specs/2026-07-26-vigencia-diagrama-por-dia-design.md`

---

## Convenciones del repo (leer antes de empezar)

- **Comentarios en español**, explicando *por qué*, no *qué*. El código existente lo hace; seguirlo.
- **Fechas siempre en UTC.** `RegistroHoras.fecha`, `Ausencia.fecha*`, `Planilla.periodo*` y `UsuarioDiagrama.fecha*` se guardan como medianoche UTC del día calendario. Usar `getUTCFullYear/Month/Date` y `Date.UTC(...)`; nunca `setHours`/`getDate` locales, que en un servidor con TZ negativa corren el día.
- **Tests unitarios del API**: archivos `apps/api/tests/*.test.ts`, self-running, terminan con
  `run().catch((e) => { console.error(e); process.exit(1); });` e imprimen `✓ nombre: N/N OK`.
  Se corren con `cd apps/api && npx tsx tests/<archivo>.test.ts`.
- **Tests unitarios del front**: `apps/web/src/**/*.test.ts`, mismo estilo, registrados en el script `test:unit` de `apps/web/package.json`.
- **Suites QA**: `apps/api/tests/qa/*.qa.ts`, black-box HTTP contra la API viva. Usuarios placeholder con password `Test1234!` (`admin@wenlen.com`, `rrhh1@test.wenlen.com`, `sup1.testing@test.wenlen.com`, `ope1.testing@test.wenlen.com`).
- **`npx prisma generate` falla si la API está corriendo** (Windows bloquea el .dll). Este plan no cambia el schema, así que no hace falta.
- **Baseline de eslint: 31 warnings.** Si `npm run lint` en `apps/web` da más de 31, algo se agregó.

---

## Estructura de archivos

**Se crea:**

| Archivo | Responsabilidad |
|---|---|
| `apps/api/src/utils/diagrama-vigencia.utils.ts` | Única fuente de verdad del backend: tramos de diagrama de un usuario en un rango, tramo de un día, franco de un día. |
| `apps/api/src/utils/recalculo-diagrama.utils.ts` | Recalcular los registros afectados por un cambio de diagrama y reportar qué planillas no se pudieron tocar. |
| `apps/api/src/utils/cambios-diagrama.service.ts` | Barrido periódico que vence las solicitudes cuya fecha de inicio llegó sin aprobación. |
| `apps/api/tests/diagrama-vigencia.test.ts` | Test unitario de la selección de tramo y del franco por tramo. |
| `apps/api/tests/qa/diagrama-vigencia.qa.ts` | Suite QA end-to-end: cambio a mitad de período, vencimiento, recálculo. |
| `apps/web/src/utils/tramosDiagrama.ts` | Espejo en el front: tramo de un día y franco de un día. |
| `apps/web/src/utils/tramosDiagrama.test.ts` | Test unitario del espejo. |

**Se modifica:**

| Archivo | Cambio |
|---|---|
| `apps/api/src/utils/contexto-dia.utils.ts:205-219` | `esFrancoPorDiagrama` se reescribe sobre el módulo nuevo (misma firma). |
| `apps/api/src/routes/planillas.routes.ts:47-88, 327-392, 445-462` | Extraer `calcularConContexto` a utils; `tramosDiagrama` en el detalle; tramos en la validación de envío. |
| `apps/api/src/routes/cambios-diagrama.routes.ts:46-51, 382-398` | Fecha obligatoria y futura, guardia de vencimiento, cierre sin solape, recálculo, notificaciones. |
| `apps/api/src/routes/usuarios.routes.ts:536-548` | Cerrar la asignación anterior sin dejar hueco. |
| `apps/api/src/routes/vacaciones.routes.ts:278-300` | El gantt devuelve `tramos` en lugar de un `diagrama` único. |
| `apps/api/src/routes/export.routes.ts:25-56, 118` | Encabezado con los dos diagramas cuando el período tiene corte. |
| `apps/api/src/app.ts:11, 343` | Arrancar el barrido de vencidas. |
| `apps/web/src/utils/planillaHelpers.ts` | Re-exportar el helper de tramos (los consumidores ya importan de acá). |
| `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:194-221, 510-514` | Usar `tramosDiagrama` de la planilla; marcar el día del corte. |
| `apps/web/src/pages/CambiosDiagramaPage.tsx:112-114, 167-170, 252-271` | Campo de fecha de inicio, obligatorio y futuro. |
| `apps/web/src/components/calendario/shared.ts:5-23` | Tipo `Empleado` con `tramos`. |
| `apps/web/src/components/calendario/CalendarioDetallado.tsx:27-47, 182-200` | Pintar descansos por tramo. |
| `apps/web/package.json` | Registrar el test nuevo en `test:unit`. |

**El orden de las tareas importa:** 1-3 dejan el cálculo correcto (lo que toca plata), 4-6 la planilla, 7-9 la solicitud y su vencimiento, 10-12 las vistas restantes.

---

## Task 1: Módulo de vigencia por tramos

**Files:**
- Create: `apps/api/src/utils/diagrama-vigencia.utils.ts`
- Test: `apps/api/tests/diagrama-vigencia.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/tests/diagrama-vigencia.test.ts`:

```ts
import assert from 'node:assert';
import {
  tramoDelDia,
  esFrancoEnFecha,
  type TramoDiagrama,
} from '../src/utils/diagrama-vigencia.utils.js';

/** Medianoche UTC de un 'YYYY-MM-DD', igual que guarda la base. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const LUN_VIE = {
  id: 'diag-lv', nombre: 'Lunes a Viernes', tipo: 'FIJO_SEMANA',
  diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5],
};
const SIETE_X_SIETE = {
  id: 'diag-77', nombre: '7x7', tipo: 'ROTATIVO',
  diasTrabajo: 7, diasDescanso: 7, diasSemana: [],
};

/** L-V hasta el 31/07 inclusive; 7x7 desde el 01/08, sin solape. */
const TRAMOS: TramoDiagrama[] = [
  { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: d('2026-07-31') },
  { diagrama: SIETE_X_SIETE, fechaInicio: d('2026-08-01'), fechaFin: null },
];

async function run() {
  // 1. Un día de la primera mitad cae en el tramo viejo
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-07-20'))?.diagrama.id, 'diag-lv');

  // 2. Un día posterior al corte cae en el nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-08-05'))?.diagrama.id, 'diag-77');

  // 3. El día del corte pertenece al tramo NUEVO
  assert.strictEqual(tramoDelDia(TRAMOS, d('2026-08-01'))?.diagrama.id, 'diag-77');

  // 4. Con datos viejos que solapan el día del corte, sigue ganando el nuevo:
  //    la asignación anterior se cerraba con la misma fecha en que abre la nueva.
  const solapados: TramoDiagrama[] = [
    { diagrama: LUN_VIE, fechaInicio: d('2026-01-01'), fechaFin: d('2026-08-01') },
    { diagrama: SIETE_X_SIETE, fechaInicio: d('2026-08-01'), fechaFin: null },
  ];
  assert.strictEqual(tramoDelDia(solapados, d('2026-08-01'))?.diagrama.id, 'diag-77');

  // 5. Antes del primer tramo no hay diagrama (no inventar el más viejo)
  assert.strictEqual(tramoDelDia(TRAMOS, d('2025-12-31')), null);

  // 6. Sin tramos, ningún día es franco
  assert.strictEqual(esFrancoEnFecha([], d('2026-07-20')), false);

  // 7. FIJO_SEMANA: el domingo 26/07/2026 es franco, el lunes 27 no
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-26')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-27')), false);

  // 8. ROTATIVO: el ciclo se cuenta desde el fechaInicio DEL TRAMO (01/08).
  //    01–07/08 trabaja, 08–14/08 descansa.
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-07')), false);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-08')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-14')), true);
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-08-15')), false);

  // 9. Un día anterior al corte NO usa el ancla del tramo nuevo: sigue siendo L-V.
  //    (sábado 25/07 franco por semana fija, no por el ciclo 7x7)
  assert.strictEqual(esFrancoEnFecha(TRAMOS, d('2026-07-25')), true);

  // 10. Tramo sin fechaFin cubre hacia adelante indefinidamente
  assert.strictEqual(tramoDelDia(TRAMOS, d('2027-03-01'))?.diagrama.id, 'diag-77');

  console.log('✓ diagrama-vigencia: 10/10 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/diagrama-vigencia.test.ts
```

Esperado: FAIL — `Cannot find module '../src/utils/diagrama-vigencia.utils.js'`.

- [ ] **Step 3: Implementar el módulo**

Crear `apps/api/src/utils/diagrama-vigencia.utils.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { esDiaFrancoSegunDiagrama } from './contexto-dia.utils.js';

const prisma = new PrismaClient();

/**
 * Un período de vigencia de un diagrama para una persona.
 *
 * `UsuarioDiagrama` siempre fue un historial (tiene fechaInicio y fechaFin), pero
 * el resto del código resolvía la vigencia por el flag `activo`. Apenas se aprueba
 * un cambio, la asignación anterior queda en `activo: false` y los días previos
 * al corte se quedaban sin diagrama: un franco trabajado de la primera mitad del
 * período perdía el recargo del 100% al recalcularse. Acá la vigencia la deciden
 * las fechas, y `activo` sólo dice cuál es la asignación corriente.
 */
export type TramoDiagrama = {
  diagrama: {
    id: string;
    nombre: string;
    tipo: string;
    diasTrabajo: number | null;
    diasDescanso: number | null;
    diasSemana: number[];
  };
  fechaInicio: Date;
  fechaFin: Date | null;
};

const SELECT_DIAGRAMA = {
  id: true, nombre: true, tipo: true,
  diasTrabajo: true, diasDescanso: true, diasSemana: true,
} as const;

/**
 * Tramos que cubren algún día de [desde, hasta], ordenados por fechaInicio.
 * Se incluye el tramo que arranca antes del rango y sigue abierto (o termina
 * dentro), porque es el que rige los primeros días.
 */
export async function tramosDeUsuario(
  usuarioId: string,
  desde: Date,
  hasta: Date,
): Promise<TramoDiagrama[]> {
  const asignaciones = await prisma.usuarioDiagrama.findMany({
    where: {
      usuarioId,
      fechaInicio: { lte: hasta },
      OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
    },
    select: { fechaInicio: true, fechaFin: true, diagrama: { select: SELECT_DIAGRAMA } },
    orderBy: { fechaInicio: 'asc' },
  });
  return asignaciones.map((a) => ({
    diagrama: a.diagrama,
    fechaInicio: a.fechaInicio,
    fechaFin: a.fechaFin,
  }));
}

/**
 * El tramo vigente en una fecha: el que la cubre y, si hay más de uno, el que
 * arrancó más tarde.
 *
 * El desempate no es decorativo: hasta ahora la asignación vieja se cerraba con
 * la MISMA fecha en que abría la nueva, así que el día del corte queda cubierto
 * por las dos en todos los datos ya guardados. Gana la nueva.
 */
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null {
  let elegido: TramoDiagrama | null = null;
  for (const t of tramos) {
    if (t.fechaInicio > fecha) continue;
    if (t.fechaFin && t.fechaFin < fecha) continue;
    if (!elegido || t.fechaInicio >= elegido.fechaInicio) elegido = t;
  }
  return elegido;
}

/**
 * Si esa fecha es franco según el tramo que la cubre.
 *
 * El ciclo de un ROTATIVO se cuenta desde el `fechaInicio` DEL TRAMO: usar el de
 * otra asignación corre todos los francos del período.
 */
export function esFrancoEnFecha(tramos: TramoDiagrama[], fecha: Date): boolean {
  const tramo = tramoDelDia(tramos, fecha);
  if (!tramo) return false;
  return esDiaFrancoSegunDiagrama(fecha, tramo.diagrama, tramo.fechaInicio);
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/diagrama-vigencia.test.ts
```

Esperado: `✓ diagrama-vigencia: 10/10 OK`.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/diagrama-vigencia.utils.ts apps/api/tests/diagrama-vigencia.test.ts
git commit -m "feat(api): la vigencia del diagrama se resuelve por fecha, no por el flag activo"
```

---

## Task 2: El cálculo del recargo usa los tramos

Repara el problema que toca plata: hoy `esFrancoPorDiagrama` filtra por `activo: true` y devuelve `false` para todos los días anteriores a un cambio ya aprobado.

**Files:**
- Modify: `apps/api/src/utils/contexto-dia.utils.ts:204-219`

- [ ] **Step 1: Reemplazar la implementación**

En `apps/api/src/utils/contexto-dia.utils.ts`, reemplazar el bloque:

```ts
/** Diagrama activo del usuario que cubre esa fecha, si tiene alguno. */
export async function esFrancoPorDiagrama(usuarioId: string, fecha: Date): Promise<boolean> {
  const asignacion = await prisma.usuarioDiagrama.findFirst({
    where: {
      usuarioId,
      activo: true,
      fechaInicio: { lte: fecha },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fecha } }],
    },
    include: { diagrama: true },
    orderBy: { fechaInicio: 'desc' },
  });
  if (!asignacion) return false;

  return esDiaFrancoSegunDiagrama(fecha, asignacion.diagrama, asignacion.fechaInicio);
}
```

por:

```ts
/**
 * Si a esa persona le tocaba franco ese día, según el diagrama vigente ESE día.
 *
 * Antes se filtraba por `activo: true`, y como aprobar un cambio apaga la
 * asignación anterior, cualquier día previo al cambio se quedaba sin diagrama y
 * daba `false`: recalcular un día viejo le borraba el recargo del 100%. La
 * vigencia la deciden las fechas; ver diagrama-vigencia.utils.ts.
 */
export async function esFrancoPorDiagrama(usuarioId: string, fecha: Date): Promise<boolean> {
  const tramos = await tramosDeUsuario(usuarioId, fecha, fecha);
  return esFrancoEnFecha(tramos, fecha);
}
```

Y agregar el import al principio del archivo, después de `import { PrismaClient } from '@prisma/client';`:

```ts
import { tramosDeUsuario, esFrancoEnFecha } from './diagrama-vigencia.utils.js';
```

> Nota: `diagrama-vigencia.utils.ts` importa `esDiaFrancoSegunDiagrama` de este archivo y este importa dos funciones de aquél. El ciclo es sólo de tipos y funciones ya inicializadas al momento de la llamada (ninguna se usa en el cuerpo del módulo), así que ESM lo resuelve sin problema. Verificarlo es justamente el Step 2.

- [ ] **Step 2: Verificar que compila y que el ciclo de imports no rompe**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit && npx tsx tests/diagrama-vigencia.test.ts
```

Esperado: `tsc` sin salida (0 errores) y `✓ diagrama-vigencia: 10/10 OK`.

- [ ] **Step 3: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/contexto-dia.utils.ts
git commit -m "fix(api): el franco por diagrama deja de perder el historico al aprobar un cambio"
```

---

## Task 3: Cerrar asignaciones sin solape ni hueco

**Files:**
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts:382-398`
- Modify: `apps/api/src/routes/usuarios.routes.ts:536-548`

- [ ] **Step 1: Agregar el helper de "día anterior" al módulo de vigencia**

Al final de `apps/api/src/utils/diagrama-vigencia.utils.ts`:

```ts
/**
 * El día anterior, en UTC. Se usa para cerrar la asignación saliente el día antes
 * de que arranque la entrante, en vez de dejar las dos cubriendo el día del corte.
 */
export function diaAnterior(fecha: Date): Date {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
```

- [ ] **Step 2: Usarlo al aplicar un cambio aprobado**

En `apps/api/src/routes/cambios-diagrama.routes.ts`, dentro de la transacción, reemplazar:

```ts
        // On final approval: apply the diagram change
        if (nuevoEstado === 'APROBADA') {
          // Close current diagram assignment
          await tx.usuarioDiagrama.updateMany({
            where: { usuarioId: solicitud.usuarioId, activo: true },
            data: { activo: false, fechaFin: solicitud.fechaEfectiva ?? new Date() },
          });

          // Create new diagram assignment
          await tx.usuarioDiagrama.create({
            data: {
              usuarioId: solicitud.usuarioId,
              diagramaId: solicitud.diagramaNuevoId,
              fechaInicio: solicitud.fechaEfectiva ?? new Date(),
              activo: true,
            },
          });
        }
```

por:

```ts
        // On final approval: apply the diagram change
        if (nuevoEstado === 'APROBADA') {
          const desde = solicitud.fechaEfectiva ?? new Date();
          // La saliente se cierra el día ANTERIOR al arranque de la entrante: si
          // ambas cubren el día del corte, ese día queda con dos diagramas
          // vigentes y el franco depende de un desempate.
          await tx.usuarioDiagrama.updateMany({
            where: { usuarioId: solicitud.usuarioId, activo: true },
            data: { activo: false, fechaFin: diaAnterior(desde) },
          });

          await tx.usuarioDiagrama.create({
            data: {
              usuarioId: solicitud.usuarioId,
              diagramaId: solicitud.diagramaNuevoId,
              fechaInicio: desde,
              activo: true,
            },
          });
        }
```

Agregar a los imports del archivo:

```ts
import { diaAnterior } from '../utils/diagrama-vigencia.utils.js';
```

- [ ] **Step 3: Corregir el hueco en la asignación manual**

En `apps/api/src/routes/usuarios.routes.ts`, reemplazar el bloque de la transacción:

```ts
    // Atomic: deactivate the current assignment and create the new one together.
    const assignment = await prisma.$transaction(async (tx) => {
      await tx.usuarioDiagrama.updateMany({
        where: { usuarioId: req.params.id as string, activo: true },
        data: { activo: false, fechaFin: new Date() },
      });
```

por:

```ts
    // Atomic: deactivate the current assignment and create the new one together.
    const inicioNuevo = new Date(parsed.data.fechaInicio);
    const assignment = await prisma.$transaction(async (tx) => {
      // Se cierra el día antes de que arranque la nueva, no "hoy": con una
      // fechaInicio futura, cerrar hoy dejaba los días del medio sin diagrama, y
      // sin diagrama ningún día es franco.
      await tx.usuarioDiagrama.updateMany({
        where: { usuarioId: req.params.id as string, activo: true },
        data: { activo: false, fechaFin: diaAnterior(inicioNuevo) },
      });
```

y más abajo, en el `create`, dejar `fechaInicio: inicioNuevo` en lugar de `new Date(parsed.data.fechaInicio)`.

Agregar a los imports del archivo:

```ts
import { diaAnterior } from '../utils/diagrama-vigencia.utils.js';
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/diagrama-vigencia.utils.ts apps/api/src/routes/cambios-diagrama.routes.ts apps/api/src/routes/usuarios.routes.ts
git commit -m "fix(api): las asignaciones de diagrama se encadenan sin solape ni hueco"
```

---

## Task 4: La validación de envío usa los tramos

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:437-462`

- [ ] **Step 1: Reemplazar la consulta de la asignación activa por los tramos**

En `apps/api/src/routes/planillas.routes.ts`, dentro de `POST /:id/enviar`, reemplazar:

```ts
    const diagramaAsignacion = await prisma.usuarioDiagrama.findFirst({
      where: { usuarioId: req.user!.userId, activo: true },
      include: { diagrama: true },
      orderBy: { fechaInicio: 'desc' },
    });
```

por:

```ts
    // Tramos que cubren el período: un cambio de diagrama aprobado a mitad de
    // ciclo parte el período, y con una sola asignación la validación reclama
    // días que eran franco (o deja pasar días laborables sin cargar).
    const tramos = await tramosDeUsuario(
      req.user!.userId,
      new Date(planilla.periodoInicio),
      new Date(planilla.periodoFin),
    );
```

y reemplazar el helper local:

```ts
    // Franco por diagrama: misma función que deriva esFrancoTrabajado al guardar.
    function esDiaFranco(fecha: Date): boolean {
      if (!diagramaAsignacion) return false;
      return esDiaFrancoSegunDiagrama(fecha, diagramaAsignacion.diagrama, diagramaAsignacion.fechaInicio);
    }
```

por:

```ts
    // Franco por diagrama: misma fuente que deriva esFrancoTrabajado al guardar.
    function esDiaFranco(fecha: Date): boolean {
      return esFrancoEnFecha(tramos, fecha);
    }
```

Agregar a los imports del archivo:

```ts
import { tramosDeUsuario, esFrancoEnFecha } from '../utils/diagrama-vigencia.utils.js';
```

Si `esDiaFrancoSegunDiagrama` queda sin usarse en este archivo, sacarlo del import de `contexto-dia.utils.js` (`tsc` lo marca si `noUnusedLocals` está activo; si no, revisarlo con `grep -n "esDiaFrancoSegunDiagrama" apps/api/src/routes/planillas.routes.ts`).

- [ ] **Step 2: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/planillas.routes.ts
git commit -m "fix(api): la validacion de dias faltantes respeta el diagrama vigente de cada dia"
```

---

## Task 5: `GET /planillas/:id` devuelve los tramos

**Files:**
- Modify: `apps/api/src/routes/planillas.routes.ts:327-392`

- [ ] **Step 1: Adjuntar los tramos a la respuesta del detalle**

En `apps/api/src/routes/planillas.routes.ts`, en `GET /:id`, reemplazar la línea final del handler:

```ts
    res.json(planilla);
```

por:

```ts
    // Los tramos de diagrama que cubren el período: el calendario del front pinta
    // los francos con ellos, así una planilla partida por un cambio de diagrama se
    // ve igual que se liquida.
    const tramosDiagrama = await tramosDeUsuario(
      planilla.usuarioId,
      planilla.periodoInicio,
      planilla.periodoFin,
    );

    res.json({ ...planilla, tramosDiagrama });
```

- [ ] **Step 2: Verificar contra la API viva**

Levantar la app con `start-dev.bat` si no está corriendo. Después:

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx -e "
const BASE='http://localhost:4000/api/v1';
(async () => {
  const r = await fetch(BASE+'/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'ope1.testing@test.wenlen.com',password:'Test1234!'})});
  const { accessToken } = await r.json();
  const ps = await (await fetch(BASE+'/planillas',{headers:{Authorization:'Bearer '+accessToken}})).json();
  if (!ps.length) { console.log('El operador no tiene planillas; crear una desde la app y repetir.'); return; }
  const det = await (await fetch(BASE+'/planillas/'+ps[0].id,{headers:{Authorization:'Bearer '+accessToken}})).json();
  console.log('tramosDiagrama:', JSON.stringify(det.tramosDiagrama, null, 2));
})();
"
```

Esperado: un array (con un tramo si el usuario nunca cambió de diagrama, vacío si no tiene ninguno asignado). Lo que importa es que el campo exista y no rompa el endpoint.

- [ ] **Step 3: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/planillas.routes.ts
git commit -m "feat(api): el detalle de planilla incluye los tramos de diagrama del periodo"
```

---

## Task 6: El calendario de la planilla pinta por tramo

**Files:**
- Create: `apps/web/src/utils/tramosDiagrama.ts`
- Create: `apps/web/src/utils/tramosDiagrama.test.ts`
- Modify: `apps/web/src/utils/planillaHelpers.ts`
- Modify: `apps/web/src/pages/planillas/PlanillaDetailPage.tsx:194-221, 510-514`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/utils/tramosDiagrama.test.ts`:

```ts
import assert from 'node:assert';
import { tramoDelDia, francoDelDia, esInicioDeTramo, type TramoDiagrama } from './tramosDiagrama';

/** El backend serializa las fechas de vigencia en ISO; el front las recibe así. */
const LUN_VIE = {
  id: 'diag-lv', nombre: 'Lunes a Viernes', tipo: 'FIJO_SEMANA',
  diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5],
};
const SIETE_X_SIETE = {
  id: 'diag-77', nombre: '7x7', tipo: 'ROTATIVO',
  diasTrabajo: 7, diasDescanso: 7, diasSemana: [],
};

const TRAMOS: TramoDiagrama[] = [
  { diagrama: LUN_VIE, fechaInicio: '2026-01-01T00:00:00.000Z', fechaFin: '2026-07-31T00:00:00.000Z' },
  { diagrama: SIETE_X_SIETE, fechaInicio: '2026-08-01T00:00:00.000Z', fechaFin: null },
];

/** El calendario del front construye los días con `new Date(a, m, d)` (hora local). */
const dia = (y: number, m: number, d: number) => new Date(y, m - 1, d);

async function run() {
  // 1. Sin tramos no hay franco (usuario sin diagrama asignado)
  assert.strictEqual(francoDelDia([], dia(2026, 7, 20)), false);

  // 2. Un día de la primera mitad usa el tramo viejo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 7, 20))?.diagrama.id, 'diag-lv');

  // 3. Un día posterior al corte usa el nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 8, 5))?.diagrama.id, 'diag-77');

  // 4. El día del corte pertenece al tramo nuevo
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2026, 8, 1))?.diagrama.id, 'diag-77');

  // 5. FIJO_SEMANA en la primera mitad: domingo franco, lunes no
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 26)), true);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 27)), false);

  // 6. ROTATIVO desde el 01/08: 01–07 trabaja, 08–14 descansa
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 7)), false);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 8)), true);
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 8, 15)), false);

  // 7. El sábado previo al corte sigue siendo franco por semana fija, no por ciclo
  assert.strictEqual(francoDelDia(TRAMOS, dia(2026, 7, 25)), true);

  // 8. Antes del primer tramo no hay diagrama
  assert.strictEqual(tramoDelDia(TRAMOS, dia(2025, 12, 31)), null);

  // 9. El día del corte se detecta para marcarlo en el calendario
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 8, 1)), true);
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 8, 2)), false);
  // El primer tramo no marca corte: no hay nada antes con qué comparar.
  assert.strictEqual(esInicioDeTramo(TRAMOS, dia(2026, 1, 1)), false);

  console.log('✓ tramosDiagrama: 9/9 OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsx src/utils/tramosDiagrama.test.ts
```

Esperado: FAIL — no existe `./tramosDiagrama`.

- [ ] **Step 3: Implementar el helper**

Crear `apps/web/src/utils/tramosDiagrama.ts`:

```ts
import { esDiaFranco, type DiagramaInfo } from './planillaHelpers';

/**
 * Un período de vigencia de un diagrama, tal como lo manda el backend en
 * `GET /planillas/:id` y en el gantt. Las fechas llegan en ISO.
 *
 * Espejo de `diagrama-vigencia.utils.ts` del API: si los dos no eligen el mismo
 * tramo para un día, el calendario pinta un franco que la liquidación no paga.
 */
export interface TramoDiagrama {
  diagrama: DiagramaInfo;
  fechaInicio: string;
  fechaFin: string | null;
}

/**
 * Día calendario de una fecha, comparable entre un `Date` local (los que arma el
 * calendario) y un ISO del backend (medianoche UTC). Se compara por componentes
 * de día, nunca por timestamp: en UTC-3 la medianoche UTC del 01/08 es el 31/07
 * a las 21:00 local, y el corte se correría un día.
 */
function claveLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function claveIso(iso: string): string {
  return iso.slice(0, 10);
}

/** El tramo vigente ese día: el que lo cubre y, si hay varios, el que arrancó más tarde. */
export function tramoDelDia(tramos: TramoDiagrama[], fecha: Date): TramoDiagrama | null {
  const k = claveLocal(fecha);
  let elegido: TramoDiagrama | null = null;
  for (const t of tramos) {
    if (claveIso(t.fechaInicio) > k) continue;
    if (t.fechaFin && claveIso(t.fechaFin) < k) continue;
    if (!elegido || claveIso(t.fechaInicio) >= claveIso(elegido.fechaInicio)) elegido = t;
  }
  return elegido;
}

/**
 * Si ese día es franco según el tramo que lo cubre. El ciclo de un ROTATIVO se
 * cuenta desde el inicio DEL TRAMO, no desde la asignación corriente.
 *
 * El orden de los parámetros es `(tramos, fecha)` en todo el módulo y en su
 * espejo del backend: mezclarlo con el de `esDiaFranco(fecha, ...)` es una fuente
 * de errores silenciosos, porque los dos tipos son objetos.
 */
export function francoDelDia(tramos: TramoDiagrama[], fecha: Date): boolean {
  const tramo = tramoDelDia(tramos, fecha);
  if (!tramo) return false;
  const [y, m, d] = claveIso(tramo.fechaInicio).split('-').map(Number);
  return esDiaFranco(fecha, tramo.diagrama, new Date(y!, m! - 1, d!));
}

/**
 * Si ese día arranca un tramo que NO es el primero: es el día donde cambia el
 * diagrama, y el calendario lo marca para que el corte de francos se entienda.
 */
export function esInicioDeTramo(tramos: TramoDiagrama[], fecha: Date): boolean {
  if (tramos.length < 2) return false;
  const k = claveLocal(fecha);
  const ordenados = [...tramos].sort((a, b) => claveIso(a.fechaInicio).localeCompare(claveIso(b.fechaInicio)));
  return ordenados.slice(1).some((t) => claveIso(t.fechaInicio) === k);
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsx src/utils/tramosDiagrama.test.ts
```

Esperado: `✓ tramosDiagrama: 9/9 OK`.

- [ ] **Step 5: Registrar el test en el script del front**

En `apps/web/package.json`, cambiar la línea de `test:unit` agregando el archivo nuevo al final:

```json
    "test:unit": "tsx src/utils/periodos.test.ts && tsx src/lib/errores.test.ts && tsx src/utils/circuito.test.ts && tsx src/utils/recorrido.test.ts && tsx src/utils/asignaciones.test.ts && tsx src/utils/tramosDiagrama.test.ts"
```

Correr toda la batería:

```bash
cd "C:/dev/planilla de horas/apps/web" && npm run test:unit
```

Esperado: todas las líneas `✓ ... OK`, incluida `✓ tramosDiagrama: 9/9 OK`.

- [ ] **Step 6: Consumir los tramos en la página de la planilla**

En `apps/web/src/pages/planillas/PlanillaDetailPage.tsx`:

a) Agregar el campo a la interfaz `PlanillaDetalle`, después de `circuitoSnapshot: unknown;`:

```ts
  /** Tramos de diagrama que cubren el período (uno por cada cambio aprobado). */
  tramosDiagrama?: TramoDiagrama[];
```

b) Agregar el import:

```ts
import { francoDelDia, esInicioDeTramo, type TramoDiagrama } from '@/utils/tramosDiagrama';
```

c) Reemplazar el cálculo del diagrama único:

```ts
  const diagramaActual: DiagramaInfo | null = usuarioDetalle?.diagramaActual ?? null;
  const fechaInicioDiagrama: Date | null = usuarioDetalle?.diagramaFechaInicio
    ? new Date(usuarioDetalle.diagramaFechaInicio)
    : null;
```

por:

```ts
  // Los tramos vienen con la planilla: un cambio de diagrama aprobado a mitad de
  // período parte el período, y el diagrama "actual" del usuario no sabe nada de
  // la primera mitad.
  const tramosDiagrama: TramoDiagrama[] = planilla?.tramosDiagrama ?? [];
```

d) Reemplazar el helper `isFranco`:

```ts
  /** Check if a date is a franco day according to the user's current diagram */
  function isFranco(day: Date): boolean {
    if (!diagramaActual || !fechaInicioDiagrama) return false;
    return esDiaFranco(day, diagramaActual, fechaInicioDiagrama);
  }
```

por:

```ts
  /** Franco según el diagrama vigente ESE día (los tramos vienen con la planilla). */
  function isFranco(day: Date): boolean {
    return francoDelDia(tramosDiagrama, day);
  }
```

e) Sacar `esDiaFranco` y `type DiagramaInfo` del import de `@/utils/planillaHelpers` si quedaron sin uso, y borrar la query `usuario-detail-planilla` **sólo si `usuarioDetalle` no se usa en ningún otro lado**. Verificarlo antes:

```bash
cd "C:/dev/planilla de horas/apps/web" && grep -n "usuarioDetalle\|diagramaActual\|esDiaFranco\|DiagramaInfo" src/pages/planillas/PlanillaDetailPage.tsx
```

Si aparecen otros usos, dejar la query y quitar sólo lo que quedó huérfano.

f) Marcar el día del corte. En la celda del calendario, dentro del bloque de badges (el `<div className="flex items-center gap-0.5 flex-wrap justify-end">`, junto al badge `FER`), agregar:

```tsx
                      {esInicioDeTramo(tramosDiagrama, day) && (
                        <span
                          className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-primary/20 text-primary"
                          title={`Desde este día rige el diagrama ${tramoDelDia(tramosDiagrama, day)?.diagrama.nombre ?? 'nuevo'}`}
                        >
                          NUEVO DIAG.
                        </span>
                      )}
```

y sumar `tramoDelDia` al import de `@/utils/tramosDiagrama`.

- [ ] **Step 7: Verificar que compila y que el lint no empeora**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b --noEmit && npm run lint 2>&1 | tail -5
```

Esperado: `tsc` sin errores; el lint no debe superar los **31 warnings** del baseline.

- [ ] **Step 8: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/web/src/utils/tramosDiagrama.ts apps/web/src/utils/tramosDiagrama.test.ts apps/web/package.json apps/web/src/pages/planillas/PlanillaDetailPage.tsx
git commit -m "feat(web): el calendario de la planilla pinta los francos por tramo de diagrama"
```

---

## Task 7: Fecha de inicio obligatoria y futura

**Files:**
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts:46-51`
- Modify: `apps/web/src/pages/CambiosDiagramaPage.tsx:70-76, 112-114, 167-170, 252-271`

- [ ] **Step 1: Hacer obligatoria y futura la fecha en el schema del API**

En `apps/api/src/routes/cambios-diagrama.routes.ts`, reemplazar:

```ts
const createSolicitudSchema = z.object({
  usuarioId: z.string().uuid(),
  diagramaNuevoId: z.string().uuid(),
  motivo: z.string().min(1).max(500).optional(),
  fechaEfectiva: fechaFlexible.optional(),
});
```

por:

```ts
/** Medianoche UTC de hoy: el piso contra el que se compara la fecha de inicio. */
function hoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

const createSolicitudSchema = z.object({
  usuarioId: z.string().uuid(),
  diagramaNuevoId: z.string().uuid(),
  motivo: z.string().min(1).max(500).optional(),
  // Obligatoria y futura: el diagrama nuevo rige desde este día, y la solicitud
  // vence si no se termina de aprobar antes. Aceptarla vacía o pasada dejaría el
  // cambio aplicándose retroactivo sobre días ya cargados.
  fechaEfectiva: fechaFlexible,
}).refine(
  (d) => new Date(d.fechaEfectiva) > hoyUTC(),
  { message: 'La fecha de inicio del diagrama debe ser posterior a hoy', path: ['fechaEfectiva'] },
);
```

- [ ] **Step 2: Verificar el rechazo contra la API viva**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx -e "
const BASE='http://localhost:4000/api/v1';
(async () => {
  const r = await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'rrhh1@test.wenlen.com',password:'Test1234!'})});
  const { accessToken } = await r.json();
  const post = (b) => fetch(BASE+'/cambios-diagrama',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken},body:JSON.stringify(b)}).then(x=>x.status);
  const u = '00000000-0000-0000-0000-000000000000';
  console.log('sin fecha      →', await post({usuarioId:u,diagramaNuevoId:u}));
  console.log('fecha pasada   →', await post({usuarioId:u,diagramaNuevoId:u,fechaEfectiva:'2020-01-01'}));
})();
"
```

Esperado: `400` en los dos casos (la validación de zod corre antes de tocar la base, así que los UUID inexistentes no importan).

- [ ] **Step 3: Agregar el campo al formulario del front**

En `apps/web/src/pages/CambiosDiagramaPage.tsx`:

a) Estado nuevo, junto a `const [motivo, setMotivo] = useState('');`:

```ts
  const [fechaEfectiva, setFechaEfectiva] = useState('');
```

b) Tipo de la mutación:

```ts
  const createMutation = useMutation({
    mutationFn: (data: { usuarioId: string; diagramaNuevoId: string; motivo?: string; fechaEfectiva: string }) =>
      api.post('/cambios-diagrama', data),
```

c) `handleSubmit`:

```ts
  const handleSubmit = () => {
    if (!selectedUserId || !selectedDiagramaId || !fechaEfectiva) return;
    createMutation.mutate({
      usuarioId: selectedUserId,
      diagramaNuevoId: selectedDiagramaId,
      motivo: motivo || undefined,
      fechaEfectiva,
    });
  };
```

d) Campo en el formulario, entre el select de diagrama nuevo y el textarea de motivo:

```tsx
          {/* Fecha de inicio del diagrama nuevo */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Desde qué día rige
            </label>
            <input
              type="date"
              value={fechaEfectiva}
              min={manana()}
              onChange={(e) => setFechaEfectiva(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              La solicitud vence si no queda aprobada antes de esta fecha: ese día se
              rechaza sola y hay que pedirla de nuevo con otra fecha.
            </p>
          </div>
```

e) Helper `manana()`, arriba del componente (junto a `diagramaLabel`):

```ts
/** Mañana en formato YYYY-MM-DD: el primer día que el backend acepta. */
function manana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

f) Deshabilitar el botón sin fecha:

```tsx
            disabled={!selectedUserId || !selectedDiagramaId || !fechaEfectiva || createMutation.isPending}
```

g) Limpiar el campo al cerrar el formulario con éxito: en el `onSuccess` de `createMutation`, junto a los `setSelected...` existentes, agregar `setFechaEfectiva('');`. Verificar cómo se limpian los otros campos:

```bash
cd "C:/dev/planilla de horas/apps/web" && grep -n "onSuccess" -A 12 src/pages/CambiosDiagramaPage.tsx | head -20
```

- [ ] **Step 4: Verificar compilación y lint**

```bash
cd "C:/dev/planilla de horas/apps/web" && npx tsc -b --noEmit && npm run lint 2>&1 | tail -5
```

Esperado: sin errores de tipos; lint ≤ 31 warnings.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/cambios-diagrama.routes.ts apps/web/src/pages/CambiosDiagramaPage.tsx
git commit -m "feat: la solicitud de cambio de diagrama pide fecha de inicio obligatoria y futura"
```

---

## Task 8: Vencimiento — guardia al aprobar

**Files:**
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts` (handler `POST /:id/avanzar`)

- [ ] **Step 1: Extraer el motivo de vencimiento a una constante compartida**

Al principio de `apps/api/src/routes/cambios-diagrama.routes.ts`, después de los imports:

```ts
/**
 * Motivo con el que se cierra una solicitud que llegó a su fecha de inicio sin
 * terminar de aprobarse. No se usa un estado nuevo: RECHAZADA + motivo evita
 * tocar el enum y todas las pantallas que lo interpretan.
 */
export const MOTIVO_VENCIDA =
  'Vencida: la fecha de inicio del diagrama pasó sin completarse la aprobación';
```

- [ ] **Step 2: Agregar la guardia antes de aplicar el cambio**

En el handler `POST /:id/avanzar`, **justo antes** de `// Atomic: optimistic concurrency + duplicate check` (o sea, después de resolver `nuevoEstado`), insertar:

```ts
    // Si esta firma es la última y la fecha de inicio ya llegó, el cambio no se
    // aplica: quedaría rigiendo sobre días ya cargados con el diagrama viejo. La
    // solicitud se cierra vencida y hay que pedirla de nuevo con otra fecha.
    // Es la red del barrido diario: sin esto, una aprobación entre dos corridas
    // aplicaría un cambio retroactivo.
    if (nuevoEstado === 'APROBADA' && solicitud.fechaEfectiva && solicitud.fechaEfectiva <= hoyUTC()) {
      await prisma.solicitudCambioDiagrama.update({
        where: { id: solId },
        data: { estado: 'RECHAZADA', obsRechazo: MOTIVO_VENCIDA },
      });
      await prisma.cambioDiagramaHistorial.create({
        data: {
          solicitudId: solId,
          usuarioId: req.user!.userId,
          estadoAnterior: solicitud.estado,
          estadoNuevo: 'RECHAZADA',
          pasoFlujo: pasoActual,
          rolAprobador: rolPasoAprobado,
          comentario: MOTIVO_VENCIDA,
        },
      });
      await notificarVencida(solicitud);
      res.status(409).json({ error: MOTIVO_VENCIDA });
      return;
    }
```

- [ ] **Step 3: Escribir el helper de notificación**

En el mismo archivo, antes del handler:

```ts
/**
 * Aviso de vencimiento al empleado y a quien la pidió (si es otra persona). Va
 * fuera de cualquier transacción: un fallo del aviso no puede revertir el cierre.
 */
async function notificarVencida(solicitud: {
  id: string;
  usuarioId: string;
  solicitanteId: string;
  fechaEfectiva: Date | null;
}): Promise<void> {
  const cuerpo = solicitud.fechaEfectiva
    ? `Llegó el ${solicitud.fechaEfectiva.toISOString().slice(0, 10).split('-').reverse().join('/')} sin que se completara la aprobación. Hay que pedirla de nuevo con otra fecha de inicio.`
    : 'La solicitud venció sin completarse la aprobación.';

  for (const usuarioId of new Set([solicitud.usuarioId, solicitud.solicitanteId])) {
    await crearNotificacion({
      usuarioId,
      tipo: 'CAMBIO_DIAGRAMA',
      titulo: 'Solicitud de cambio de diagrama vencida',
      cuerpo,
      link: '/cambios-diagrama',
    });
  }
}
```

Verificar que `crearNotificacion` ya esté importado en el archivo (lo usa la notificación de aprobación):

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -n "crearNotificacion" src/routes/cambios-diagrama.routes.ts | head -3
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores. Si `solicitud` no trae `solicitanteId` o `fechaEfectiva` en el `select`/`include` del handler, agregarlos —`tsc` lo marca.

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/cambios-diagrama.routes.ts
git commit -m "feat(api): no se aplica un cambio de diagrama cuya fecha de inicio ya paso"
```

---

## Task 9: Vencimiento — barrido diario

**Files:**
- Create: `apps/api/src/utils/cambios-diagrama.service.ts`
- Modify: `apps/api/src/app.ts:11, 343`

- [ ] **Step 1: Escribir el servicio**

Crear `apps/api/src/utils/cambios-diagrama.service.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { crearNotificacion } from './notificacion.utils.js';

const prisma = new PrismaClient();

export const MOTIVO_VENCIDA =
  'Vencida: la fecha de inicio del diagrama pasó sin completarse la aprobación';

/** Medianoche UTC de hoy. Una solicitud con fecha de inicio <= hoy ya no sirve. */
function hoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Cierra las solicitudes que llegaron a su fecha de inicio sin terminar de
 * aprobarse y avisa a los interesados. Devuelve cuántas venció.
 *
 * Las viejas sin fecha de inicio (el campo era opcional) no se tocan: nunca
 * tuvieron plazo.
 */
export async function vencerCambiosDiagrama(): Promise<number> {
  const vencidas = await prisma.solicitudCambioDiagrama.findMany({
    where: {
      estado: { in: ['PENDIENTE', 'EN_REVISION'] },
      fechaEfectiva: { not: null, lte: hoyUTC() },
    },
    select: { id: true, usuarioId: true, solicitanteId: true, fechaEfectiva: true, estado: true },
  });
  if (vencidas.length === 0) return 0;

  for (const s of vencidas) {
    await prisma.$transaction([
      prisma.solicitudCambioDiagrama.update({
        where: { id: s.id },
        data: { estado: 'RECHAZADA', obsRechazo: MOTIVO_VENCIDA },
      }),
      prisma.cambioDiagramaHistorial.create({
        data: {
          solicitudId: s.id,
          usuarioId: s.usuarioId,
          estadoAnterior: s.estado,
          estadoNuevo: 'RECHAZADA',
          pasoFlujo: 0,
          rolAprobador: null,
          comentario: MOTIVO_VENCIDA,
        },
      }),
    ]);

    const fecha = s.fechaEfectiva
      ? s.fechaEfectiva.toISOString().slice(0, 10).split('-').reverse().join('/')
      : '';
    for (const usuarioId of new Set([s.usuarioId, s.solicitanteId])) {
      await crearNotificacion({
        usuarioId,
        tipo: 'CAMBIO_DIAGRAMA',
        titulo: 'Solicitud de cambio de diagrama vencida',
        cuerpo: `Llegó el ${fecha} sin que se completara la aprobación. Hay que pedirla de nuevo con otra fecha de inicio.`,
        link: '/cambios-diagrama',
      });
    }
  }

  console.log(`⏳ Cambios de diagrama vencidos: ${vencidas.length}`);
  return vencidas.length;
}

// ─── Scheduler ───────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;

/**
 * Barrido diario, con una corrida al minuto del arranque para no depender de que
 * el proceso viva 24 h. El catch es obligatorio: el callback de un timer no tiene
 * a quién propagarle el rechazo y tumbaría el proceso por unhandledRejection.
 */
export function startCambiosDiagramaScheduler(): void {
  const seguro = () => {
    vencerCambiosDiagrama().catch((err) =>
      console.error('Error venciendo cambios de diagrama:', err),
    );
  };
  setTimeout(seguro, 60_000);
  timer = setInterval(seguro, VEINTICUATRO_HORAS);
  console.log('🕐 Vencimiento de cambios de diagrama: cada 24 horas');
}

export function stopCambiosDiagramaScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
```

> `pasoFlujo: 0` y `rolAprobador: null` marcan que el cierre no lo firmó nadie: fue el vencimiento. Si el schema no acepta `rolAprobador: null`, revisar `model CambioDiagramaHistorial` y usar el valor que corresponda.

- [ ] **Step 2: Que la ruta use la constante del servicio**

En `apps/api/src/routes/cambios-diagrama.routes.ts`, borrar la constante `MOTIVO_VENCIDA` local que se creó en la Task 8 e importarla:

```ts
import { MOTIVO_VENCIDA } from '../utils/cambios-diagrama.service.js';
```

- [ ] **Step 3: Arrancar el barrido con la app**

En `apps/api/src/app.ts`, junto al import de backups:

```ts
import { startCambiosDiagramaScheduler, stopCambiosDiagramaScheduler } from './utils/cambios-diagrama.service.js';
```

Después de `startBackupScheduler(prisma);` dentro del callback de `app.listen`:

```ts
  startCambiosDiagramaScheduler();
```

Y donde se llame a `stopBackupScheduler()` (apagado ordenado), agregar al lado:

```ts
  stopCambiosDiagramaScheduler();
```

Ubicarlo con:

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -n "stopBackupScheduler" src/app.ts
```

- [ ] **Step 4: Probar el barrido a mano**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx -e "
import('./src/utils/cambios-diagrama.service.js').then(async (m) => {
  console.log('vencidas:', await m.vencerCambiosDiagrama());
  process.exit(0);
});
"
```

Esperado: `vencidas: 0` en una base limpia, sin excepciones. (La Task 11 lo prueba con una solicitud real.)

- [ ] **Step 5: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/cambios-diagrama.service.ts apps/api/src/routes/cambios-diagrama.routes.ts apps/api/src/app.ts
git commit -m "feat(api): barrido diario que vence los cambios de diagrama sin aprobar a tiempo"
```

---

## Task 10: Recálculo de los días afectados

**Files:**
- Create: `apps/api/src/utils/recalculo-diagrama.utils.ts`
- Modify: `apps/api/src/routes/planillas.routes.ts:47-88` (extraer `calcularConContexto`)
- Modify: `apps/api/src/routes/cambios-diagrama.routes.ts` (llamar al recálculo tras aplicar)

- [ ] **Step 1: Mover `calcularConContexto` a `calculo.utils.ts`**

Cortar de `apps/api/src/routes/planillas.routes.ts` el tipo `DatosRegistro` y la función `calcularConContexto` completos (líneas 30-88 aproximadamente; incluir el bloque de comentario) y pegarlos al final de `apps/api/src/utils/calculo.utils.ts`, exportando la función:

```ts
export async function calcularConContexto(
```

En `calculo.utils.ts` hacen falta estos imports (verificar cuáles ya están):

```ts
import { contextoDelDia } from './contexto-dia.utils.js';
import type { LugarTrabajo } from '@prisma/client';
```

En `planillas.routes.ts`, agregar `calcularConContexto` al import existente de `../utils/calculo.utils.js`:

```ts
import {
  calcularHorasRegistro,
  calcularConContexto,
  getEmpresaConfig,
  recalcularTotalesPlanilla,
  getPeriodoActual,
} from '../utils/calculo.utils.js';
```

Si `DatosRegistro` se usa en otro lado de `planillas.routes.ts`, exportarlo también desde `calculo.utils.ts` e importarlo. Verificar:

```bash
cd "C:/dev/planilla de horas/apps/api" && grep -n "DatosRegistro" src/routes/planillas.routes.ts
```

- [ ] **Step 2: Verificar que nada se rompió con el movimiento**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit del movimiento (aislado, para que un fallo sea fácil de ubicar)**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/calculo.utils.ts apps/api/src/routes/planillas.routes.ts
git commit -m "refactor(api): calcularConContexto pasa a calculo.utils para poder reusarla"
```

- [ ] **Step 4: Escribir el módulo de recálculo**

Crear `apps/api/src/utils/recalculo-diagrama.utils.ts`:

```ts
import { PrismaClient, Prisma } from '@prisma/client';
import { calcularConContexto, getEmpresaConfig, recalcularTotalesPlanilla } from './calculo.utils.js';

const prisma = new PrismaClient();

/** Planillas que todavía se pueden tocar: las demás ya se firmaron. */
const EDITABLES = ['BORRADOR', 'RECHAZADA'];

export type ResultadoRecalculo = {
  /** Días recalculados en planillas editables. */
  diasRecalculados: number;
  /**
   * Planillas ya enviadas/aprobadas/cerradas con días afectados: no se tocan,
   * se informan para que RRHH decida.
   */
  planillasCongeladas: Array<{
    planillaId: string;
    estado: string;
    periodoInicio: Date;
    periodoFin: Date;
    dias: number;
  }>;
};

/**
 * Recalcula los días del usuario desde `desde` en adelante, porque el diagrama
 * que rige esos días cambió y con él el franco —y el recargo del 100% de un
 * franco trabajado—.
 *
 * Sólo toca planillas en BORRADOR o RECHAZADA: las enviadas, aprobadas o
 * cerradas ya se firmaron con esos números y corregirlas por atrás sería peor
 * que informarlas.
 */
export async function recalcularDesde(
  usuarioId: string,
  empresaId: string,
  desde: Date,
): Promise<ResultadoRecalculo> {
  const planillas = await prisma.planilla.findMany({
    where: { usuarioId, periodoFin: { gte: desde } },
    select: { id: true, estado: true, periodoInicio: true, periodoFin: true },
  });

  const config = await getEmpresaConfig(empresaId);
  let diasRecalculados = 0;
  const planillasCongeladas: ResultadoRecalculo['planillasCongeladas'] = [];

  for (const p of planillas) {
    const registros = await prisma.registroHoras.findMany({
      where: { planillaId: p.id, fecha: { gte: desde }, bloqueado: false },
    });
    if (registros.length === 0) continue;

    if (!EDITABLES.includes(p.estado)) {
      planillasCongeladas.push({
        planillaId: p.id,
        estado: p.estado,
        periodoInicio: p.periodoInicio,
        periodoFin: p.periodoFin,
        dias: registros.length,
      });
      continue;
    }

    for (const r of registros) {
      const { calculo, esFeriado, esFrancoTrabajado } = await calcularConContexto(
        {
          entradaTurno1: r.entradaTurno1,
          salidaTurno1: r.salidaTurno1,
          entradaTurno2: r.entradaTurno2,
          salidaTurno2: r.salidaTurno2,
          lugarTrabajo: r.lugarTrabajo,
          esFrancoCompensatorio: r.esFrancoCompensatorio,
          horasViajeInput: Number(r.horasViajeInput),
          maneja: r.maneja,
        },
        r.fecha,
        usuarioId,
        empresaId,
        config,
      );

      await prisma.registroHoras.update({
        where: { id: r.id },
        data: {
          esFeriado,
          esFrancoTrabajado,
          horasTrabajadas: new Prisma.Decimal(calculo.horasTrabajadas),
          horasNormales: new Prisma.Decimal(calculo.horasNormales),
          horasExtra50: new Prisma.Decimal(calculo.horasExtra50),
          horasExtra100: new Prisma.Decimal(calculo.horasExtra100),
          horasViajeCalc: new Prisma.Decimal(calculo.horasViajeCalc),
        },
      });
      diasRecalculados++;
    }

    await recalcularTotalesPlanilla(p.id);
  }

  return { diasRecalculados, planillasCongeladas };
}
```

> Los nombres de los campos de `calculo` deben coincidir con lo que devuelve `calcularHorasRegistro`. Verificar antes de correr:
> ```bash
> cd "C:/dev/planilla de horas/apps/api" && grep -n "return {" -A 10 src/utils/calculo.utils.ts | head -30
> ```
> Si difieren (p. ej. `horasViaje` en vez de `horasViajeCalc`), ajustar el mapeo — `tsc` los marca.

- [ ] **Step 5: Llamarlo al aplicar el cambio**

En `apps/api/src/routes/cambios-diagrama.routes.ts`, en el bloque posterior a la transacción donde ya se notifica la aprobación (`if (nuevoEstado === 'APROBADA') { await crearNotificacion(...)`), agregar **antes** de las notificaciones existentes:

```ts
      // El diagrama nuevo cambia qué días son franco desde su fecha de inicio: los
      // días ya cargados de ahí en adelante tienen el recargo calculado con el
      // diagrama viejo. Se recalculan los que todavía se pueden tocar; los que ya
      // se firmaron se informan a RRHH.
      const desde = solicitud.fechaEfectiva ?? new Date();
      const { diasRecalculados, planillasCongeladas } = await recalcularDesde(
        solicitud.usuarioId, req.user!.empresaId, desde,
      );
      if (diasRecalculados > 0) {
        console.log(`↻ Cambio de diagrama ${solId}: ${diasRecalculados} día(s) recalculado(s)`);
      }
      if (planillasCongeladas.length > 0) {
        const detalle = planillasCongeladas
          .map((p) => `${p.periodoInicio.toISOString().slice(0, 10)} a ${p.periodoFin.toISOString().slice(0, 10)} (${p.estado}, ${p.dias} día/s)`)
          .join('; ')
        const rrhh = await prisma.usuario.findMany({
          where: { empresaId: req.user!.empresaId, activo: true, rol: 'RRHH' },
          select: { id: true },
        });
        for (const u of rrhh) {
          await crearNotificacion({
            usuarioId: u.id,
            tipo: 'CAMBIO_DIAGRAMA',
            titulo: 'Cambio de diagrama sobre planillas ya firmadas',
            cuerpo: `El cambio de diagrama afecta días de planillas que ya no se editan: ${detalle}. Revisar si hay que corregirlas a mano.`,
            link: '/aprobaciones',
          });
        }
      }
```

Agregar el import:

```ts
import { recalcularDesde } from '../utils/recalculo-diagrama.utils.js';
```

- [ ] **Step 6: Verificar que compila**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/utils/recalculo-diagrama.utils.ts apps/api/src/routes/cambios-diagrama.routes.ts
git commit -m "feat(api): aprobar un cambio de diagrama recalcula los dias afectados y avisa de los congelados"
```

---

## Task 11: Suite QA end-to-end

**Files:**
- Create: `apps/api/tests/qa/diagrama-vigencia.qa.ts`

- [ ] **Step 1: Escribir la suite**

Crear `apps/api/tests/qa/diagrama-vigencia.qa.ts` copiando el andamiaje de `apps/api/tests/qa/cancelaciones.qa.ts` (líneas 1-50: constantes `C`/`TS`, `results`, `cleanupQueue`, `scenario`, `assert`, `assertStatus`, `info`, `apiCall`, `get`/`post`/`put`/`del`, `login` y el tipo `Session`) y agregando estos escenarios:

```ts
const BASE = 'http://localhost:4000/api/v1';
const KEY = 'diagvig';

// ── Escenarios ──────────────────────────────────────────────────────────────
async function main() {
  const rrhh = await login('rrhh1@test.wenlen.com');

  await scenario('la fecha de inicio es obligatoria', async () => {
    const { status } = await post('/cambios-diagrama', {
      usuarioId: '00000000-0000-0000-0000-000000000000',
      diagramaNuevoId: '00000000-0000-0000-0000-000000000000',
    }, rrhh.token);
    assertStatus(status, 400, 'sin fechaEfectiva debería rechazar');
  });

  await scenario('la fecha de inicio no puede ser pasada ni hoy', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    for (const fecha of ['2020-01-01', hoy]) {
      const { status } = await post('/cambios-diagrama', {
        usuarioId: '00000000-0000-0000-0000-000000000000',
        diagramaNuevoId: '00000000-0000-0000-0000-000000000000',
        fechaEfectiva: fecha,
      }, rrhh.token);
      assertStatus(status, 400, `fechaEfectiva=${fecha} debería rechazar`);
    }
  });

  await scenario('el detalle de planilla trae los tramos de diagrama', async () => {
    const { body: planillas } = await get('/planillas', rrhh.token);
    assert(Array.isArray(planillas) && planillas.length > 0, 'no hay planillas para inspeccionar');
    const { status, body } = await get(`/planillas/${planillas[0].id}`, rrhh.token);
    assertStatus(status, 200);
    assert(Array.isArray(body.tramosDiagrama), 'falta tramosDiagrama en el detalle');
    info(`tramos: ${body.tramosDiagrama.length}`);
  });

  await scenario('el barrido vence una solicitud con la fecha de inicio cumplida', async () => {
    // La solicitud se crea con Prisma, no por la API: la ruta ya no acepta fechas
    // pasadas (y está bien que no lo haga), pero en la base pueden existir por
    // haber quedado sin aprobar. Eso es exactamente lo que el barrido tiene que
    // encontrar.
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    {
      const empleado = await prisma.usuario.findFirst({
        where: { email: 'ope1.testing@test.wenlen.com' },
        select: { id: true },
      });
      assert(!!empleado, 'falta el usuario placeholder ope1.testing@test.wenlen.com');
      const diagrama = await prisma.diagrama.findFirst({ select: { id: true } });
      assert(!!diagrama, 'no hay diagramas cargados');

      const ayer = new Date();
      ayer.setUTCDate(ayer.getUTCDate() - 1);
      const sol = await prisma.solicitudCambioDiagrama.create({
        data: {
          solicitanteId: empleado!.id,
          usuarioId: empleado!.id,
          diagramaNuevoId: diagrama!.id,
          estado: 'PENDIENTE',
          fechaEfectiva: new Date(Date.UTC(ayer.getUTCFullYear(), ayer.getUTCMonth(), ayer.getUTCDate())),
          motivo: `QA ${KEY} ${TS}`,
        },
        select: { id: true },
      });
      cleanupQueue.push(async () => {
        await prisma.cambioDiagramaHistorial.deleteMany({ where: { solicitudId: sol.id } });
        await prisma.solicitudCambioDiagrama.delete({ where: { id: sol.id } }).catch(() => {});
        await prisma.$disconnect();
      });

      const { vencerCambiosDiagrama } = await import('../../src/utils/cambios-diagrama.service.js');
      const n = await vencerCambiosDiagrama();
      assert(n >= 1, `el barrido debería vencer al menos la solicitud creada, venció ${n}`);

      const despues = await prisma.solicitudCambioDiagrama.findUnique({
        where: { id: sol.id },
        select: { estado: true, obsRechazo: true },
      });
      assert(despues?.estado === 'RECHAZADA', `esperaba RECHAZADA, quedó ${despues?.estado}`);
      assert(
        (despues?.obsRechazo ?? '').startsWith('Vencida'),
        `esperaba el motivo de vencimiento, quedó "${despues?.obsRechazo}"`,
      );

      // Y no crea la asignación de diagrama: vencer no es aplicar.
      const asignada = await prisma.usuarioDiagrama.findFirst({
        where: { usuarioId: empleado!.id, diagramaId: diagrama!.id, fechaInicio: { gte: ayer } },
        select: { id: true },
      });
      assert(asignada === null, 'una solicitud vencida no debe dejar asignación nueva');
      info('vencida, sin asignación nueva');
    }
  });

  await scenario('el barrido no toca las solicitudes sin fecha de inicio', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const empleado = await prisma.usuario.findFirst({
      where: { email: 'ope1.testing@test.wenlen.com' },
      select: { id: true },
    });
    const diagrama = await prisma.diagrama.findFirst({ select: { id: true } });
    const sol = await prisma.solicitudCambioDiagrama.create({
      data: {
        solicitanteId: empleado!.id,
        usuarioId: empleado!.id,
        diagramaNuevoId: diagrama!.id,
        estado: 'PENDIENTE',
        fechaEfectiva: null,
        motivo: `QA ${KEY} ${TS} sin fecha`,
      },
      select: { id: true },
    });
    cleanupQueue.push(async () => {
      await prisma.cambioDiagramaHistorial.deleteMany({ where: { solicitudId: sol.id } });
      await prisma.solicitudCambioDiagrama.delete({ where: { id: sol.id } }).catch(() => {});
      await prisma.$disconnect();
    });

    const { vencerCambiosDiagrama } = await import('../../src/utils/cambios-diagrama.service.js');
    await vencerCambiosDiagrama();

    const despues = await prisma.solicitudCambioDiagrama.findUnique({
      where: { id: sol.id }, select: { estado: true },
    });
    assert(despues?.estado === 'PENDIENTE', `las viejas sin plazo no vencen; quedó ${despues?.estado}`);
  });

  // Limpieza de todo lo creado, pase o falle cada escenario.
  for (const limpiar of cleanupQueue) {
    await limpiar().catch((e) => console.error('cleanup:', e));
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  const pasaron = results.filter((r) => r.passed).length;
  console.log(`\n${pasaron}/${results.length} escenarios OK`);
  for (const r of results.filter((x) => !x.passed)) console.log(`  FAIL ${r.name}: ${r.detail}`);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr la suite con la API viva**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/diagrama-vigencia.qa.ts
```

Esperado: todos los escenarios en PASS. Si el tercero falla por falta de planillas, crear una desde la app con el usuario de RRHH y repetir.

- [ ] **Step 3: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/tests/qa/diagrama-vigencia.qa.ts
git commit -m "test(qa): suite de vigencia del diagrama y vencimiento de solicitudes"
```

---

## Task 12: Calendario de equipo y export

**Files:**
- Modify: `apps/api/src/routes/vacaciones.routes.ts:278-300`
- Modify: `apps/api/src/routes/export.routes.ts:25-56, 118`
- Modify: `apps/web/src/components/calendario/shared.ts:5-23`
- Modify: `apps/web/src/components/calendario/CalendarioDetallado.tsx:27-47, 182-200`

- [ ] **Step 1: El gantt devuelve tramos**

En `apps/api/src/routes/vacaciones.routes.ts`, reemplazar el bloque que adjunta el diagrama (el que empieza con `// Attach each employee's active diagrama`) por:

```ts
    // Cada empleado va con TODOS sus tramos de diagrama del año: con uno solo, un
    // cambio a mitad de año pinta los descansos del diagrama nuevo también en los
    // meses anteriores.
    if (empleados.length > 0) {
      const asignaciones = await prisma.usuarioDiagrama.findMany({
        where: {
          usuarioId: { in: empleados.map((e) => e.id) },
          fechaInicio: { lte: endDate },
          OR: [{ fechaFin: null }, { fechaFin: { gte: startDate } }],
        },
        orderBy: { fechaInicio: 'asc' },
        select: {
          usuarioId: true, fechaInicio: true, fechaFin: true,
          diagrama: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
        },
      });
      const tramosByUser = new Map<string, TramoGantt[]>();
      for (const a of asignaciones) {
        const lista = tramosByUser.get(a.usuarioId) ?? [];
        lista.push({
          diagrama: a.diagrama,
          fechaInicio: (a.fechaInicio as Date).toISOString(),
          fechaFin: a.fechaFin ? (a.fechaFin as Date).toISOString() : null,
        });
        tramosByUser.set(a.usuarioId, lista);
      }
      for (const e of empleados) e.tramos = tramosByUser.get(e.id) ?? [];
    }
```

Reemplazar el tipo `DiagramaInfo` local por:

```ts
    type TramoGantt = {
      diagrama: {
        id: string; nombre: string; tipo: string;
        diasTrabajo: number | null; diasDescanso: number | null; diasSemana: number[];
      };
      fechaInicio: string;
      fechaFin: string | null;
    };
```

y en `EmpleadoGantt` reemplazar `diagrama?: DiagramaInfo | null;` por `tramos?: TramoGantt[];`.

- [ ] **Step 2: Actualizar los tipos del front**

En `apps/web/src/components/calendario/shared.ts`, reemplazar:

```ts
export type EmpDiagrama = DiagramaInfo & { fechaInicio: string };
```

por:

```ts
/** Un tramo de vigencia, tal como lo manda el gantt. */
export interface TramoEmp {
  diagrama: DiagramaInfo;
  fechaInicio: string;
  fechaFin: string | null;
}
```

y en `Empleado`, reemplazar `diagrama?: EmpDiagrama | null;` por `tramos?: TramoEmp[];`.

- [ ] **Step 3: Pintar los descansos por tramo**

En `apps/web/src/components/calendario/CalendarioDetallado.tsx`:

a) Reemplazar el cálculo de bandas de descanso:

```ts
      let restByMonth: { d0: number; days: number }[][] | null = null;
      const diag = emp.diagrama;
      if (vis.DESCANSO && diag) {
        const [fy, fm, fd] = ymd(diag.fechaInicio);
        const fechaInicio = new Date(fy, fm - 1, fd);
```

por:

```ts
      let restByMonth: { d0: number; days: number }[][] | null = null;
      const tramos = emp.tramos ?? [];
      if (vis.DESCANSO && tramos.length > 0) {
```

y dentro del bucle de días, reemplazar:

```ts
            const isF = esDiaFranco(new Date(anio, mi, d), diag, fechaInicio);
```

por:

```ts
            const isF = francoDelDia(tramos, new Date(anio, mi, d));
```

b) `turnoKey` y `turnoSubtitle` pasan a describir el tramo vigente hoy. Reemplazar sus firmas y cuerpos:

```ts
function tramoVigenteHoy(tramos: TramoEmp[]): TramoEmp | null {
  return tramoDelDia(tramos, new Date());
}
function turnoKey(tramos: TramoEmp[]): string {
  const t = tramoVigenteHoy(tramos);
  if (!t) return 'SIN';
  return `${t.diagrama.id}|${t.fechaInicio.slice(0, 10)}`;
}
function turnoSubtitle(tramos: TramoEmp[], anio: number): string {
  const t = tramoVigenteHoy(tramos);
  if (!t) return 'Sin diagrama';
  const sufijo = tramos.length > 1 ? ' · cambia en el año' : '';
  if (t.diagrama.tipo === 'ROTATIVO') {
    const dt = t.diagrama.diasTrabajo ?? 0, dd = t.diagrama.diasDescanso ?? 0;
    const [fy, fm, fd] = ymd(t.fechaInicio);
    const fechaInicio = new Date(fy, fm - 1, fd);
    let desc = '';
    for (let i = 0; i < dt + dd; i++) {
      const day = new Date(anio, 0, 1 + i);
      if (esDiaFranco(day, t.diagrama, fechaInicio)) {
        desc = ` · desc. desde ${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
        break;
      }
    }
    return `${dt}×${dd}${desc}${sufijo}`;
  }
  if (t.diagrama.tipo === 'FIJO_SEMANA') {
    const rest = [0, 1, 2, 3, 4, 5, 6].filter((i) => !t.diagrama.diasSemana.includes(i)).map((i) => DOW_SHORT[i]);
    return `Semana fija · descansa ${rest.join(', ') || '—'}${sufijo}`;
  }
  return 'Sin diagrama';
}
```

c) Actualizar las llamadas: donde diga `turnoKey(diag)` / `r.emp.diagrama ?? null`, usar `turnoKey(r.emp.tramos ?? [])` y `turnoSubtitle(g.tramos, anio)`. Ubicarlas con:

```bash
cd "C:/dev/planilla de horas/apps/web" && grep -n "turnoKey\|turnoSubtitle\|emp.diagrama\|\.diagrama" src/components/calendario/CalendarioDetallado.tsx
```

d) Imports del archivo:

```ts
import { esDiaFranco } from '@/utils/planillaHelpers';
import { francoDelDia, tramoDelDia } from '@/utils/tramosDiagrama';
import { type TramoEmp } from './shared';
```

> `TramoEmp` y `TramoDiagrama` tienen la misma forma (`diagrama` + `fechaInicio` + `fechaFin`), así que `francoDelDia` los acepta por tipado estructural.

e) Revisar `CalendarioCompacto.tsx`: si también lee `emp.diagrama`, aplicarle el mismo cambio. Verificar con:

```bash
cd "C:/dev/planilla de horas/apps/web" && grep -n "diagrama" src/components/calendario/CalendarioCompacto.tsx
```

- [ ] **Step 4: Encabezado del export con el corte**

En `apps/api/src/routes/export.routes.ts`, reemplazar el select del diagrama:

```ts
            diagramas: {
              where: { activo: true },
              take: 1,
              select: { 
                diagrama: { select: { nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
                fechaInicio: true,
              },
            },
```

por:

```ts
            diagramas: {
              select: {
                diagrama: { select: { nombre: true } },
                fechaInicio: true,
                fechaFin: true,
              },
              orderBy: { fechaInicio: 'asc' },
            },
```

y reemplazar:

```ts
    const diagramaAsignacion = u.diagramas[0] ?? null;
    const diagramaNombre = diagramaAsignacion?.diagrama?.nombre ?? null;
```

por:

```ts
    // Los tramos que tocan el período. Con un cambio a mitad de ciclo, poner un
    // solo nombre en el encabezado contradice los francos de la propia planilla.
    const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
    const tramosPeriodo = u.diagramas.filter(
      (a) => a.fechaInicio <= planilla.periodoFin && (!a.fechaFin || a.fechaFin >= planilla.periodoInicio),
    );
    const diagramaNombre = tramosPeriodo.length === 0
      ? null
      : tramosPeriodo.length === 1
        ? tramosPeriodo[0]!.diagrama.nombre
        : tramosPeriodo
            .map((a, i) =>
              i === 0 && a.fechaFin
                ? `${a.diagrama.nombre} hasta ${fmt(a.fechaFin)}`
                : `${a.diagrama.nombre} desde ${fmt(a.fechaInicio)}`,
            )
            .join(' · ');
```

- [ ] **Step 5: Verificar compilación de las dos apps**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit && cd ../web && npx tsc -b --noEmit && npm run lint 2>&1 | tail -5
```

Esperado: sin errores de tipos; lint ≤ 31 warnings.

- [ ] **Step 6: Prueba manual con la app**

Con la app levantada (`start-dev.bat`):

1. Crear una solicitud de cambio de diagrama con fecha de inicio a mitad del período en curso y aprobarla con todos los pasos del circuito.
2. Abrir la planilla del empleado: los francos anteriores a esa fecha deben seguir el diagrama viejo, los posteriores el nuevo, y el día del corte debe mostrar el badge `NUEVO DIAG.`.
3. Abrir el Calendario de Equipo del año: las bandas de descanso deben cambiar en la misma fecha.
4. Exportar la planilla a Excel: el encabezado debe nombrar los dos diagramas.

- [ ] **Step 7: Commit**

```bash
cd "C:/dev/planilla de horas"
git add apps/api/src/routes/vacaciones.routes.ts apps/api/src/routes/export.routes.ts apps/web/src/components/calendario/
git commit -m "feat: el calendario de equipo y el export reflejan el cambio de diagrama a mitad de periodo"
```

---

## Cierre

- [ ] **Correr todo lo automatizable**

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsc --noEmit && npx tsx tests/diagrama-vigencia.test.ts && npx tsx tests/circuito.test.ts && npx tsx tests/recorrido.test.ts
cd "C:/dev/planilla de horas/apps/web" && npm run test:unit && npx tsc -b --noEmit && npm run lint 2>&1 | tail -3
cd "C:/dev/planilla de horas/apps/api" && npx tsx tests/qa/diagrama-vigencia.qa.ts && npx tsx tests/qa/planillas.qa.ts
```

Todo en verde y el lint del front en 31 warnings o menos.

- [ ] **Probar a mano la guardia de vencimiento al aprobar**

Es lo único que las suites no cubren, porque hace falta que el tiempo pase entre
el alta y la aprobación. Con la app levantada:

1. Crear una solicitud con fecha de inicio mañana y aprobarla hasta el anteúltimo
   paso del circuito (dejarla sin la firma final).
2. Correr la fecha de inicio al pasado:

```bash
cd "C:/dev/planilla de horas/apps/api" && npx tsx -e "
import('@prisma/client').then(async ({ PrismaClient }) => {
  const p = new PrismaClient();
  const s = await p.solicitudCambioDiagrama.findFirst({
    where: { estado: { in: ['PENDIENTE','EN_REVISION'] } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  const ayer = new Date(); ayer.setUTCDate(ayer.getUTCDate() - 1);
  await p.solicitudCambioDiagrama.update({ where: { id: s.id }, data: { fechaEfectiva: ayer } });
  console.log('solicitud', s.id, 'con fecha de ayer');
  await p.\$disconnect();
});
"
```

3. Dar la firma final desde la app. Esperado: error "Vencida: la fecha de inicio
   del diagrama pasó sin completarse la aprobación", la solicitud queda
   RECHAZADA, **no** se crea asignación de diagrama nueva, y llegan las
   notificaciones al empleado y al solicitante.

- [ ] **Actualizar la memoria del proyecto**

La memoria `circuitos-aprobacion.md` describe el circuito; conviene una nota nueva sobre la vigencia por tramos, porque es contraintuitiva (el flag `activo` existe pero no manda). Escribir `C:\Users\alonn\.claude\projects\C--dev-planilla-de-horas\memory\diagrama-vigencia.md` y su línea en `MEMORY.md`.
