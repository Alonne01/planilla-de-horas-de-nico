# Analytics por sector, difusión segmentada, zoom del calendario y seguimiento WENTOP — Plan de implementación

> **Para quien lo ejecute:** las tareas van en orden y cada una termina en un commit que
> deja el árbol verde. Se puede frenar entre dos partes sin dejar nada a medias.

**Diseño:** `docs/superpowers/specs/2026-07-28-wentop-difusion-calendario-design.md`
**Rama:** `anvil/wentop-sector-difusion-calendario`
**Objetivo:** que el sector sea la unidad de alcance en analytics WENTOP, difusión de
mensajes y seguimiento de tarjetas; y que el calendario de equipo se pueda mirar de cerca.

**Stack:** API Express + Prisma 5 + PostgreSQL + zod 3 · Web React 19 + Vite + TanStack
Query + Tailwind 4 · tests `tsx` con `node:assert`, suites QA por HTTP contra `:4000`.

---

## Reglas que valen para todas las tareas

Esto no es relleno: cada punto ya rompió algo en este repo.

1. **Fechas-día.** Una fecha que representa un DÍA se guarda como medianoche UTC del día
   calendario argentino. Se lee con getters **UTC** (`getUTCFullYear`, `getUTCDay`), nunca
   locales: los contenedores corren con `TZ=America/Argentina/Buenos_Aires` y un getter
   local devuelve el día anterior **siempre**. Autoridad: `apps/api/src/utils/fecha-dia.utils.ts`
   y `apps/web/src/utils/fechaDia.ts`. En el front nunca `new Date(iso)` sobre una fecha-día.
2. **`start-dev.bat` no se toca ni se commitea.** Tiene una modificación local ajena a esto.
3. **`npx prisma generate` falla con la API viva.** Bajarla, generar, levantarla.
4. **`prisma migrate` y cualquier `UPDATE`/`DELETE` a mano: preguntar antes.** Nunca correr
   `db:seed`, `reset-testing.ts` ni `limpiar-para-testing.ts`.
5. **Usuarios de test = placeholders** (`rrhh1@test.wenlen.com` y compañía). El fixture
   `op2.testing@test.wenlen.com` no se toca.
6. **Antes de cada commit:** `cd apps/api && npm run test:unit` (incluye `tsc --noEmit`) y
   `cd apps/web && npm run test:unit && npx tsc -b --noEmit`. Baseline de eslint: 31.
7. **Las suites QA necesitan la API viva en `:4000`** y hay que reiniciarla cada ~6 suites:
   cada módulo de rutas abre su propio pool de Prisma y a la sexta se agota
   `max_connections`. El síntoma es `PrismaClientInitializationError`, no un bug del código.
8. **Multer escribe el archivo antes de que corra el handler.** En cada rama que rechaza
   hay que llamar a `descartarArchivos(files)`.

---

# PARTE 1 — Zoom del calendario de equipo

Sin cambios de API. Todo pasa por reemplazar el eje "día-del-año" por una **ventana de meses**.

## Tarea 1: el módulo `ventana.ts`

**Archivos:**
- Crear: `apps/web/src/components/calendario/ventana.ts`
- Crear: `apps/web/src/components/calendario/ventana.test.ts`
- Modificar: `apps/web/package.json`

- [ ] **Paso 1.1: escribir el test primero**

`apps/web/src/components/calendario/ventana.test.ts`:

```ts
import assert from 'node:assert';
import { ventanaDeMeses, ventanaAnual, rangoEnVentana, indiceDeDiaAcotado } from './ventana';

function fd(clave: string) { return `${clave}T00:00:00.000Z`; }

async function run() {
  // 1. La ventana anual es el eje viejo: 365 días y un offset por mes.
  const anual = ventanaAnual(2026);
  assert.strictEqual(anual.meses.length, 12);
  assert.strictEqual(anual.totalDias, 365);
  assert.deepStrictEqual(anual.offset.slice(0, 3), [0, 31, 59]);

  // 2. Bisiesto.
  assert.strictEqual(ventanaAnual(2028).totalDias, 366);
  assert.strictEqual(ventanaDeMeses(2028, 2, 1).totalDias, 29);

  // 3. La ventana cruza diciembre: nov 2026 + 2 = nov, dic, ene 2027.
  const cruce = ventanaDeMeses(2026, 11, 3);
  assert.deepStrictEqual(cruce.meses, [
    { anio: 2026, mes: 11 }, { anio: 2026, mes: 12 }, { anio: 2027, mes: 1 },
  ]);
  assert.strictEqual(cruce.totalDias, 30 + 31 + 31);

  // 4. Un bloque que arranca en diciembre y termina en enero se ve entero.
  assert.deepStrictEqual(
    rangoEnVentana(fd('2026-12-28'), fd('2027-01-05'), cruce),
    [30 + 27, 30 + 31 + 4],
  );

  // 5. Un bloque que empieza antes y termina después se recorta a la ventana.
  const marzo = ventanaDeMeses(2026, 3, 1);
  assert.deepStrictEqual(rangoEnVentana(fd('2026-01-10'), fd('2026-12-20'), marzo), [0, 30]);

  // 6. Un bloque enteramente fuera no existe para la ventana.
  assert.strictEqual(rangoEnVentana(fd('2026-01-10'), fd('2026-01-20'), marzo), null);
  assert.strictEqual(rangoEnVentana(fd('2026-05-01'), fd('2026-05-02'), marzo), null);

  // 7. Un bloque de un solo día.
  assert.deepStrictEqual(rangoEnVentana(fd('2026-03-15'), fd('2026-03-15'), marzo), [14, 14]);

  // 8. `indiceDeDiaAcotado` pega contra las puntas en vez de devolver null
  //    (lo usa el marcador de "hoy", que siempre tiene que caer en algún lado).
  assert.strictEqual(indiceDeDiaAcotado(fd('2026-01-01'), marzo), 0);
  assert.strictEqual(indiceDeDiaAcotado(fd('2026-12-31'), marzo), 30);
  assert.strictEqual(indiceDeDiaAcotado(fd('2026-03-02'), marzo), 1);

  console.log('✓ ventana: 8 grupos OK');
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Paso 1.2: correr el test y verlo fallar**

```
cd apps/web && npx tsx src/components/calendario/ventana.test.ts
```
Esperado: `Cannot find module './ventana'`.

- [ ] **Paso 1.3: implementar `ventana.ts`**

```ts
/**
 * La ventana de meses del calendario de equipo.
 *
 * Antes todo el calendario estaba expresado en DÍA-DEL-AÑO: `monthOffsets(anio)`,
 * `blockDoyRange(..., year, ...)`. Con eso, mirar noviembre + dos meses era
 * imposible: enero pertenece a otro año y el eje no lo podía nombrar.
 *
 * Acá el eje es una lista contigua de meses `{anio, mes}` — de 1, 3 o 12 — y el
 * índice de un día es su posición dentro de esa lista. El modo "año" pasa a ser
 * `ventanaDeMeses(anio, 1, 12)`, o sea el mismo cálculo de siempre con otro
 * nombre: por eso la vista anual no cambia de comportamiento.
 */
import { ymd } from '@/utils/fechaDia';

export interface MesVentana {
  anio: number;
  /** 1-12, NO el `getMonth()` 0-based de Date. */
  mes: number;
}

export interface Ventana {
  meses: MesVentana[];
  /** Índice del primer día de cada mes de `meses`. */
  offset: number[];
  totalDias: number;
}

/** Días de un mes 1-12. Sólo cuenta días, así que el huso no interviene. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/** Clave ordenable de un mes, para comparar sin restar fechas. */
function claveMes(anio: number, mes: number): number {
  return anio * 12 + (mes - 1);
}

export function ventanaDeMeses(anioAncla: number, mesAncla: number, cantidad: number): Ventana {
  const meses: MesVentana[] = [];
  let anio = anioAncla;
  let mes = mesAncla;
  for (let i = 0; i < cantidad; i++) {
    meses.push({ anio, mes });
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  const offset: number[] = [];
  let acc = 0;
  for (const m of meses) {
    offset.push(acc);
    acc += diasDelMes(m.anio, m.mes);
  }
  return { meses, offset, totalDias: acc };
}

export function ventanaAnual(anio: number): Ventana {
  return ventanaDeMeses(anio, 1, 12);
}

/** Los años distintos que toca la ventana: uno, o dos si cruza diciembre. */
export function aniosDeVentana(v: Ventana): number[] {
  return [...new Set(v.meses.map((m) => m.anio))];
}

/** Índice del día dentro de la ventana, o `null` si el mes no está en ella. */
export function indiceDeDia(anio: number, mes: number, dia: number, v: Ventana): number | null {
  const i = v.meses.findIndex((m) => m.anio === anio && m.mes === mes);
  if (i === -1) return null;
  return v.offset[i]! + (dia - 1);
}

/**
 * Como `indiceDeDia`, pero un día fuera de la ventana se pega a la punta más
 * cercana en vez de desaparecer. Es lo que necesita el marcador de "hoy": tiene
 * que dibujarse en algún lado aunque se esté mirando otro mes.
 */
export function indiceDeDiaAcotado(iso: string, v: Ventana): number {
  const [y, m, d] = ymd(iso);
  const clave = claveMes(y, m);
  const primero = v.meses[0]!;
  const ultimo = v.meses[v.meses.length - 1]!;
  if (clave < claveMes(primero.anio, primero.mes)) return 0;
  if (clave > claveMes(ultimo.anio, ultimo.mes)) return v.totalDias - 1;
  return Math.min(indiceDeDia(y, m, d, v)!, v.totalDias - 1);
}

/**
 * Rango `[desde, hasta]` de un bloque dentro de la ventana, recortado a sus
 * puntas. `null` si el bloque no la toca en ningún día.
 *
 * Las dos fechas son fechas-día serializadas por el backend: se leen por
 * componentes con `ymd`, nunca construyendo un `Date` con el ISO.
 */
export function rangoEnVentana(fechaInicio: string, fechaFin: string, v: Ventana): [number, number] | null {
  const [y1, m1, d1] = ymd(fechaInicio);
  const [y2, m2, d2] = ymd(fechaFin);
  const primero = v.meses[0]!;
  const ultimo = v.meses[v.meses.length - 1]!;
  const desdeVentana = claveMes(primero.anio, primero.mes);
  const hastaVentana = claveMes(ultimo.anio, ultimo.mes);
  const inicio = claveMes(y1, m1);
  const fin = claveMes(y2, m2);
  if (inicio > hastaVentana || fin < desdeVentana) return null;
  const desde = inicio < desdeVentana ? 0 : indiceDeDia(y1, m1, d1, v)!;
  const hasta = fin > hastaVentana ? v.totalDias - 1 : indiceDeDia(y2, m2, d2, v)!;
  return [Math.max(0, desde), Math.min(v.totalDias - 1, hasta)];
}
```

- [ ] **Paso 1.4: correr el test y verlo pasar**

```
cd apps/web && npx tsx src/components/calendario/ventana.test.ts
```
Esperado: `✓ ventana: 8 grupos OK`.

- [ ] **Paso 1.5: sumarlo a la suite**

En `apps/web/package.json`, agregar al final de `test:unit`:
` && tsx src/components/calendario/ventana.test.ts`

- [ ] **Paso 1.6: commit**

```bash
git add apps/web/src/components/calendario/ventana.ts apps/web/src/components/calendario/ventana.test.ts apps/web/package.json
git commit -m "feat(web): el calendario de equipo gana un eje de ventana de meses"
```

---

## Tarea 2: `shared.ts` sobre la ventana

**Archivos:** Modificar `apps/web/src/components/calendario/shared.ts`

- [ ] **Paso 2.1: reemplazar la sección de solapes**

Borrar `monthOffsets`, `blockDoyRange` y `daysInMonth`, y reescribir las dos funciones de
solape contra la ventana. Re-exportar lo de `ventana.ts` para que los componentes importen
de un solo lugar:

```ts
export * from './ventana';
import { type Ventana, rangoEnVentana } from './ventana';

// Pico de ocupación por bloque countable DENTRO DE LA VENTANA. Cada empleado
// cuenta 1 por día. Devuelve sólo los bloques con pico ≥ 2.
//
// Con zoom, el pico se mide sobre lo visible: en la vista de un mes el badge
// cuenta la gente que se pisa ESE mes, no en todo el año. Es lo que el zoom
// tiene que responder, pero es un cambio observable respecto de la vista anual.
export function computeOverlapPeaks(empleados: Empleado[], v: Ventana): Map<string, number> {
  const counts = new Int16Array(v.totalDias);
  for (const emp of empleados) {
    const dias = new Set<number>();
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg) continue;
      for (let d = rg[0]; d <= rg[1]; d++) dias.add(d);
    }
    for (const d of dias) counts[d]!++;
  }
  const peaks = new Map<string, number>();
  for (const emp of empleados) {
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg) continue;
      let peak = 0;
      for (let d = rg[0]; d <= rg[1]; d++) if (counts[d]! > peak) peak = counts[d]!;
      if (peak >= 2) peaks.set(b.id, peak);
    }
  }
  return peaks;
}

export function overlappingEmployeeIds(
  empleados: Empleado[], block: Bloque, clickedEmpId: string, v: Ventana,
): Set<string> {
  const ids = new Set<string>();
  const range = rangoEnVentana(block.fechaInicio, block.fechaFin, v);
  if (!range) return ids;
  const [s0, s1] = range;
  for (const emp of empleados) {
    if (emp.id === clickedEmpId) continue;
    for (const b of emp.bloques) {
      if (!COUNTABLE[catOf(b.tipo)]) continue;
      const rg = rangoEnVentana(b.fechaInicio, b.fechaFin, v);
      if (!rg || rg[0] > s1 || rg[1] < s0) continue;
      ids.add(emp.id);
      break;
    }
  }
  return ids;
}
```

`daysInMonth` desaparece: los dos llamadores pasan a `diasDelMes(anio, mes)` de
`ventana.ts` (ojo: el mes es 1-12, no 0-based). `fetchCalendar` y `calendarQueryKey` no
cambian.

- [ ] **Paso 2.2: verificar que todavía no compila**

```
cd apps/web && npx tsc -b --noEmit
```
Esperado: errores en `CalendarioCompacto.tsx` y `CalendarioDetallado.tsx` por las firmas
viejas. Es lo que corrigen las tareas 3 y 4; sin commit hasta entonces.

---

## Tarea 3: `CalendarioCompacto` sobre la ventana

**Archivos:** Modificar `apps/web/src/components/calendario/CalendarioCompacto.tsx`

- [ ] **Paso 3.1: cambiar la prop y la geometría**

`anio: number` → `ventana: Ventana` en `Props`. Y:

```tsx
// Los meses de la ventana, con su ancho proporcional. Cuando la ventana cruza
// diciembre se agrega el año a la etiqueta: si no, aparecen dos "Ene" sin
// forma de distinguirlos.
const cruzaAnios = useMemo(() => aniosDeVentana(ventana).length > 1, [ventana]);
const months = useMemo(
  () => ventana.meses.map((m, i) => ({
    key: `${m.anio}-${m.mes}`,
    label: cruzaAnios ? `${MESES[m.mes - 1]} ${String(m.anio).slice(2)}` : MESES[m.mes - 1]!,
    days: diasDelMes(m.anio, m.mes),
    offset: ventana.offset[i]!,
  })),
  [ventana, cruzaAnios],
);
const totalDays = ventana.totalDias;
```

- [ ] **Paso 3.2: reemplazar `dateToDayOffset`**

Se va la función local entera; en su lugar `indiceDeDiaAcotado(dateStr, ventana)`. El
comentario largo que la acompaña se conserva **en `ventana.ts`**, no acá: explica por qué
se lee por componentes y por qué "hoy" tiene que entrar con `hoyKey()` y no con
`new Date().toISOString()`, y eso sigue siendo verdad.

- [ ] **Paso 3.3: los tres usos restantes de `anio`**

1. `computeOverlapPeaks(data.empleados, ventana)`.
2. Las gridlines: `left: (m.offset / totalDays) * 100` (ya no hay que sumar meses previos).
3. El marcador de hoy: la condición `anio === new Date().getFullYear()` pasa a
   `indiceDeDiaAcotado` sin condición previa — pero sólo se dibuja si hoy cae **dentro** de
   la ventana, para no clavar una línea falsa en la punta:

```tsx
{(() => {
  const hoy = hoyKey();
  const [hy, hm] = ymd(hoy);
  const dentro = ventana.meses.some((m) => m.anio === hy && m.mes === hm);
  if (!dentro) return null;
  const off = indiceDeDiaAcotado(hoy, ventana);
  return <div className="absolute top-0 bottom-0 w-px bg-primary/60 z-10" style={{ left: `${(off / totalDays) * 100}%` }} />;
})()}
```

4. El cartel de vacío: `No hay registros en {anio}` → `No hay registros en el período elegido`.

---

## Tarea 4: `CalendarioDetallado` sobre la ventana

**Archivos:** Modificar `apps/web/src/components/calendario/CalendarioDetallado.tsx`

- [ ] **Paso 4.1: `buildSegments` contra la ventana**

Hoy recorre `mo` de 0 a 11 y usa `daysInMonth(year, mo)`. Pasa a recorrer las posiciones de
la ventana. `Segment.monthIndex` deja de ser el mes 0-based y pasa a ser la **posición en
la ventana** (renombrar a `mesIdx` para que no quede un nombre que miente):

```tsx
function buildSegments(block: Bloque, v: Ventana, emp: string): Segment[] {
  const rango = rangoEnVentana(block.fechaInicio, block.fechaFin, v);
  if (!rango) return [];
  const [desde, hasta] = rango;
  const cat = catOf(block.tipo);
  const segs: Segment[] = [];
  for (let i = 0; i < v.meses.length; i++) {
    const base = v.offset[i]!;
    const dim = diasDelMes(v.meses[i]!.anio, v.meses[i]!.mes);
    const segStart = Math.max(desde, base);
    const segEnd = Math.min(hasta, base + dim - 1);
    if (segEnd < segStart) continue;
    segs.push({
      key: `${block.id}-${i}`,
      cat,
      estado: block.estado,
      mesIdx: i,
      d0: segStart - base,
      days: segEnd - segStart + 1,
      dim,
      // Se redondea la punta sólo si el bloque REALMENTE empieza/termina ahí y no
      // porque lo cortó la ventana: una barra que sigue fuera de la vista tiene
      // que verse cortada, no terminada.
      edge: edgeOf(segStart === desde && !recortadoIzq(block, v), segEnd === hasta && !recortadoDer(block, v)),
      block,
      emp,
    });
  }
  return segs;
}
```

donde `recortadoIzq`/`recortadoDer` comparan la fecha del bloque contra las puntas de la
ventana (helpers locales de tres líneas usando `ymd` y las claves de mes).

- [ ] **Paso 4.2: los arreglos de largo 12**

`byMonth`, `restByMonth` y `monthOffset` pasan a largo `ventana.meses.length`:

```tsx
const byMonth: Segment[][] = Array.from({ length: ventana.meses.length }, () => []);
// ...
const counts = new Int16Array(ventana.totalDias);   // en vez de 366
// ...
for (let k = 0; k < seg.days; k++) doySet.add(ventana.offset[seg.mesIdx]! + seg.d0 + k);
```

El bucle de francos (`restByMonth`) recorre `ventana.meses` y arma el `Date` del día con
`new Date(m.anio, m.mes - 1, d)` — igual que hoy, porque `francoDelDia` espera un `Date`
local, no una fecha-día.

- [ ] **Paso 4.3: la grilla**

`GRID_STYLE` es una constante con `repeat(12, ...)`; pasa a calcularse:

```tsx
const gridStyle = useMemo<React.CSSProperties>(
  () => ({ gridTemplateColumns: `minmax(180px,230px) repeat(${ventana.meses.length}, minmax(56px,1fr))` }),
  [ventana.meses.length],
);
```

Con 1 o 3 meses las columnas se ensanchan solas por el `1fr` — que es exactamente el zoom
que se pidió.

Los encabezados de mes salen de `ventana.meses` (con año si cruza), y `turnoSubtitle(tramos, anio)`
recibe `ventana.meses[0].anio`.

- [ ] **Paso 4.4: compilar y commitear las tareas 2-4 juntas**

```
cd apps/web && npx tsc -b --noEmit && npm run test:unit && npm run lint
git add apps/web/src/components/calendario/
git commit -m "refactor(web): los dos calendarios dibujan sobre una ventana de meses"
```

Esperado: `tsc` limpio, tests verdes, eslint en 31 warnings.

---

## Tarea 5: el selector de zoom

**Archivos:** Modificar `apps/web/src/pages/CalendarioEquipoPage.tsx`

- [ ] **Paso 5.1: estado de la ventana**

```tsx
type Zoom = 'anio' | 'trimestre' | 'mes';
const ZOOM_KEY = 'calendario-equipo-zoom';
const MESES_POR_ZOOM: Record<Zoom, number> = { anio: 12, trimestre: 3, mes: 1 };

function loadZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    return v === 'trimestre' || v === 'mes' ? v : 'anio';
  } catch { return 'anio'; }
}
```

El ancla arranca en el mes de hoy, leído con `hoyKey()` para no depender del huso:

```tsx
const [hoyAnio, hoyMes] = ymd(`${hoyKey()}T00:00:00.000Z`);
const [zoom, setZoomState] = useState<Zoom>(loadZoom);
const [ancla, setAncla] = useState({ anio: hoyAnio, mes: hoyMes });

const ventana = useMemo(
  () => (zoom === 'anio'
    ? ventanaAnual(ancla.anio)
    : ventanaDeMeses(ancla.anio, ancla.mes, MESES_POR_ZOOM[zoom])),
  [zoom, ancla],
);
```

Las flechas mueven un año en modo `anio` y un mes en los otros dos:

```tsx
function mover(pasos: number) {
  setAncla((a) => {
    if (zoom === 'anio') return { ...a, anio: a.anio + pasos };
    const total = a.anio * 12 + (a.mes - 1) + pasos;
    return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
  });
}
```

La etiqueta del medio: el año en modo `anio`, `"jul 2026"` en modo `mes`, y
`"jul – sep 2026"` (o `"nov 2026 – ene 2027"`) en trimestre.

- [ ] **Paso 5.2: pedir uno o dos años y fusionarlos**

```tsx
const anios = useMemo(() => aniosDeVentana(ventana), [ventana]);

const resultados = useQueries({
  queries: anios.map((a) => ({
    queryKey: calendarQueryKey(a, sectorId),
    queryFn: () => fetchCalendar(a, sectorId),
    enabled: puedeVer,
  })),
});

const isLoading = resultados.some((r) => r.isLoading);

// Fusión: un bloque que cruza el 31 de diciembre viene en las dos respuestas, y
// los tramos de diagrama también. Se deduplica por id (y los tramos por
// diagrama+inicio, que no tienen id propio en el gantt).
const data = useMemo<GanttData | undefined>(() => {
  const partes = resultados.map((r) => r.data).filter(Boolean) as GanttData[];
  if (partes.length === 0) return undefined;
  if (partes.length === 1) return partes[0];
  const porEmpleado = new Map<string, Empleado>();
  for (const parte of partes) {
    for (const emp of parte.empleados) {
      const acc = porEmpleado.get(emp.id);
      if (!acc) { porEmpleado.set(emp.id, { ...emp, bloques: [...emp.bloques], tramos: [...(emp.tramos ?? [])] }); continue; }
      const vistos = new Set(acc.bloques.map((b) => b.id));
      for (const b of emp.bloques) if (!vistos.has(b.id)) acc.bloques.push(b);
      const tramosVistos = new Set((acc.tramos ?? []).map((t) => `${t.diagrama.id}|${t.fechaInicio}`));
      for (const t of emp.tramos ?? []) {
        const k = `${t.diagrama.id}|${t.fechaInicio}`;
        if (!tramosVistos.has(k)) { acc.tramos!.push(t); tramosVistos.add(k); }
      }
    }
  }
  const empleados = [...porEmpleado.values()].sort((a, b) => a.apellido.localeCompare(b.apellido));
  for (const e of empleados) e.bloques.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  return { anio: partes[0]!.anio, sectores: partes[0]!.sectores, empleados };
}, [resultados]);
```

`import { useQueries } from '@tanstack/react-query'`.

- [ ] **Paso 5.3: el toggle en la barra**

Tres botones al lado del toggle Compacto/Detallado que ya existe, con el mismo estilo
(`inline-flex rounded-lg border border-border bg-card p-0.5`, `aria-pressed`): **Año ·
Trimestre · Mes**. El `useEffect` que limpia el filtro de solape suma `ventana` a sus
dependencias — con otra ventana, el bloque seleccionado puede no estar más.

`viewData` y `overlappingEmployeeIds` reciben `ventana` en vez de `anio`.

- [ ] **Paso 5.4: probar a mano**

Levantar el front, entrar como RRHH a `/calendario` y verificar:
- Año: idéntico a antes del cambio.
- Trimestre parado en noviembre: se ve enero del año siguiente y las barras que lo cruzan
  aparecen enteras.
- Mes: las columnas se ensanchan y el marcador de hoy cae en el día correcto.
- El contador de solapes cambia al cambiar de ventana (esperado).

- [ ] **Paso 5.5: commit**

```bash
cd apps/web && npx tsc -b --noEmit && npm run test:unit && npm run lint
git add apps/web/src/pages/CalendarioEquipoPage.tsx
git commit -m "feat(web): el calendario de equipo se puede mirar por mes o por trimestre"
```

---

# PARTE 2 — Analytics WENTOP por sector

## Tarea 6: alcance y filtros en la API

**Archivos:** Modificar `apps/api/src/routes/wentop.routes.ts`

- [ ] **Paso 6.1: extraer los sectores visibles**

Arriba de `buildVisibilityWhere`:

```ts
/** Los sectores cuyas tarjetas puede ver el usuario, y si su alcance es global. */
async function alcanceDeSectores(user: { userId: string; empresaId: string; rol: string; rolNivel: number }) {
  if (user.rol === 'CMASS' || user.rolNivel >= 90) {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: user.empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return { global: true, sectores };
  }
  const [usuario, gestorDe] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: user.userId }, select: { sectorId: true } }),
    prisma.wentopGestor.findMany({ where: { usuarioId: user.userId, activo: true }, select: { sectorId: true } }),
  ]);
  const ids = new Set<string>();
  if (usuario?.sectorId) ids.add(usuario.sectorId);
  for (const g of gestorDe) ids.add(g.sectorId);
  const sectores = await prisma.sector.findMany({
    where: { id: { in: [...ids] }, empresaId: user.empresaId },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
  return { global: false, sectores };
}
```

- [ ] **Paso 6.2: `buildAnalyticsWhere`**

```ts
/**
 * Alcance del TABLERO, que no es el del listado.
 *
 * `buildVisibilityWhere` incluye `{ creadorId: vos }` para que siempre puedas
 * encontrar una tarjeta tuya, aunque la hayas cargado sobre otro sector. En un
 * tablero que dice "sector X" esa rama mete tarjetas de otros sectores y los
 * números dejan de coincidir con los que ve el gestor de X. Por eso son dos
 * funciones y no una con un flag: el flag se termina pasando mal.
 */
async function buildAnalyticsWhere(
  user: { userId: string; empresaId: string; rol: string; rolNivel: number },
  sectorId?: string,
): Promise<{ where: any } | { error: string; status: number }> {
  const alcance = await alcanceDeSectores(user);
  if (sectorId) {
    if (!alcance.global && !alcance.sectores.some((s) => s.id === sectorId)) {
      return { status: 403, error: 'Sin permiso para ver ese sector' };
    }
    return { where: { empresaId: user.empresaId, sectorObservacionId: sectorId } };
  }
  if (alcance.global) return { where: { empresaId: user.empresaId } };
  return {
    where: {
      empresaId: user.empresaId,
      sectorObservacionId: { in: alcance.sectores.map((s) => s.id) },
    },
  };
}
```

Un 403 explícito y no un tablero en cero: los dos se ven igual en pantalla, y el segundo
se reporta como bug.

- [ ] **Paso 6.3: parámetros de `/analytics`**

Al principio del handler, antes del `findMany`:

```ts
const { sectorId, desde, hasta } = req.query;
const resultado = await buildAnalyticsWhere(req.user!, sectorId as string | undefined);
if ('error' in resultado) { res.status(resultado.status).json({ error: resultado.error }); return; }
const where: any = resultado.where;
if (desde || hasta) {
  where.fechaReporte = {};
  if (desde) {
    const d = new Date(desde as string);
    if (isNaN(d.getTime())) { res.status(400).json({ error: 'Parámetro "desde" inválido' }); return; }
    where.fechaReporte.gte = d;
  }
  if (hasta) {
    const h = new Date(hasta as string);
    if (isNaN(h.getTime())) { res.status(400).json({ error: 'Parámetro "hasta" inválido' }); return; }
    where.fechaReporte.lte = h;
  }
}
```

Es el mismo bloque que ya valida `desde`/`hasta` en `GET /wentop`; extraerlo a un helper
`filtroFechaReporte(query)` en el mismo archivo y usarlo en los dos.

- [ ] **Paso 6.4: los dos endpoints nuevos**

Antes de `GET /wentop/:id` (si no, `:id` se los come):

```ts
// ─── GET /wentop/sectores ────────────────────────
// Catálogo de sectores SIN guardia de nivel. `/analytics/sectores` exige nivel 70,
// así que un operador recibía 403 y se quedaba sin lista — y como el mismo array
// alimenta el formulario de alta, tampoco podía elegir el sector de observación de
// su propia tarjeta. Son id y nombre, que ya viajan dentro de cada tarjeta.
router.get('/sectores', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectores = await prisma.sector.findMany({
      where: { empresaId: req.user!.empresaId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(sectores);
  } catch (error) {
    console.error('Error listing sectores wentop:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /wentop/mi-alcance ──────────────────────
router.get('/mi-alcance', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(await alcanceDeSectores(req.user!));
  } catch (error) {
    console.error('Error fetching alcance wentop:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
```

- [ ] **Paso 6.5: verificar y commitear**

```
cd apps/api && npm run test:unit
```

```bash
git add apps/api/src/routes/wentop.routes.ts
git commit -m "feat(api): el tablero WENTOP filtra por sector y por fechas"
```

---

## Tarea 7: QA del alcance

**Archivos:** Modificar `apps/api/tests/qa/wentop.qa.ts`

- [ ] **Paso 7.1: casos**

Con la API viva en `:4000`, agregar al final de la suite:

1. Un operador del sector A ve en `/wentop/analytics` sólo tarjetas de A (crear una en A y
   otra en B con un usuario de nivel alto, y comprobar `totales.total`).
2. El mismo operador con `?sectorId=<B>` recibe **403**.
3. RRHH sin `sectorId` ve las dos; con `?sectorId=<A>` ve una sola.
4. Un gestor de A y B ve las dos y puede filtrar cada una.
5. `?desde=` y `?hasta=` recortan por `fechaReporte`.
6. `GET /wentop/sectores` responde 200 **para un operador** (es el bug que se arregla).

- [ ] **Paso 7.2: correr**

```
cd apps/api && npx tsx tests/qa/wentop.qa.ts
```
Esperado: todo verde, con los casos nuevos sumados al total.

- [ ] **Paso 7.3: commit**

```bash
git add apps/api/tests/qa/wentop.qa.ts
git commit -m "test(qa): el tablero WENTOP respeta el alcance por sector"
```

---

## Tarea 8: el filtro en pantalla

**Archivos:** Modificar `apps/web/src/pages/WentopPage.tsx`

- [ ] **Paso 8.1: cambiar la fuente de sectores**

En `WentopPage`, la query `['sectores']` pasa de `/analytics/sectores` a `/wentop/sectores`.
Con eso el formulario de alta vuelve a funcionar para un operador.

- [ ] **Paso 8.2: `AnalyticsTab` con filtros**

```tsx
function AnalyticsTab() {
  const [sectorId, setSectorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const { data: alcance } = useQuery<{ global: boolean; sectores: Sector[] }>({
    queryKey: ['wentop', 'mi-alcance'],
    queryFn: async () => (await api.get('/wentop/mi-alcance')).data,
  });

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (sectorId) p.sectorId = sectorId;
    if (desde) p.desde = desde;
    if (hasta) p.hasta = hasta;
    return p;
  }, [sectorId, desde, hasta]);

  const { data: analytics, isLoading } = useQuery<WentopAnalytics>({
    queryKey: ['wentop', 'analytics', params],
    queryFn: async () => (await api.get('/wentop/analytics', { params })).data,
  });
  // …
}
```

Arriba de las tarjetas de totales, una barra de filtros:

- El `<select>` de sector se muestra **sólo si** `alcance.global || alcance.sectores.length > 1`.
  La opción "Todos los sectores" (valor `''`) sólo si `alcance.global`; si no es global,
  el valor inicial es `alcance.sectores[0].id` para que nunca quede un tablero mezclando
  sus dos sectores sin decirlo.
- Con un solo sector, en vez del selector va el nombre como subtítulo:
  `Analytics de {alcance.sectores[0].nombre}`.
- Dos `<input type="date">` con las mismas clases que los de `TarjetasTab`.

- [ ] **Paso 8.3: verificar y commitear**

```
cd apps/web && npx tsc -b --noEmit && npm run lint
git add apps/web/src/pages/WentopPage.tsx
git commit -m "feat(web): el tablero WENTOP se filtra por sector y por fechas"
```

---

# PARTE 3 — Difusión

## Tarea 9: `turnos.utils.ts` en la API

**Archivos:**
- Crear: `apps/api/src/utils/turnos.utils.ts`
- Crear: `apps/api/tests/turnos.test.ts`
- Modificar: `apps/api/package.json`

- [ ] **Paso 9.1: el test primero**

Espejo de `apps/web/src/utils/turnos.test.ts` (mismos cuatro casos) más los de la etiqueta:

```ts
import assert from 'node:assert';
import { turnoKey, proximoInicioDeCiclo, etiquetaTurno } from '../src/utils/turnos.utils.js';

const LUN_VIE = { tipo: 'FIJO_SEMANA', diasTrabajo: null, diasDescanso: null, diasSemana: [1, 2, 3, 4, 5] };
const SIETE = { tipo: 'ROTATIVO', diasTrabajo: 7, diasDescanso: 7, diasSemana: [] };
const CATORCE = { tipo: 'ROTATIVO', diasTrabajo: 14, diasDescanso: 7, diasSemana: [] };
const dia = (clave: string) => new Date(`${clave}T00:00:00.000Z`);
const tramo = (diagrama: any, inicio: string) => ({ diagrama, fechaInicio: dia(inicio) });

async function run() {
  // 1-4: mismos casos que el test del front (misma clave ⇒ mismo patrón de descanso).
  assert.strictEqual(turnoKey(tramo(LUN_VIE, '2019-06-01')), turnoKey(tramo(LUN_VIE, '2021-11-23')));
  assert.strictEqual(turnoKey(tramo(SIETE, '2020-01-01')), turnoKey(tramo(SIETE, '2020-01-15')));
  assert.notStrictEqual(turnoKey(tramo(SIETE, '2020-01-01')), turnoKey(tramo(SIETE, '2020-01-08')));
  assert.strictEqual(turnoKey(null), 'SIN');

  // 5. El próximo inicio de ciclo cae en el día que corresponde, no en el siguiente.
  //    14x7 arrancado el 2/7/2026: los inicios son 2/7, 23/7, 13/8…
  const t = tramo(CATORCE, '2026-07-02');
  assert.strictEqual(proximoInicioDeCiclo(t, dia('2026-07-24'))!.toISOString().slice(0, 10), '2026-08-13');
  // 6. Si hoy ES un inicio de ciclo, el próximo es hoy.
  assert.strictEqual(proximoInicioDeCiclo(t, dia('2026-07-23'))!.toISOString().slice(0, 10), '2026-07-23');
  // 7. FIJO_SEMANA no tiene ciclo.
  assert.strictEqual(proximoInicioDeCiclo(tramo(LUN_VIE, '2020-01-01'), dia('2026-07-28')), null);

  // 8. El día de la semana sale de getUTCDay: con getters locales, bajo TZ=AR,
  //    una fecha-día se lee como el día ANTERIOR y la etiqueta diría "miércoles".
  assert.match(etiquetaTurno(t, dia('2026-07-24')).etiqueta, /jueves 13\/08/);

  console.log('✓ turnos: 8/8 OK');
}
run().catch((e) => { console.error(e); process.exit(1); });
```

> Verificar a mano que el 13/08/2026 cae jueves antes de fijar la aserción; si no, ajustar
> el caso (no la implementación).

- [ ] **Paso 9.2: correr y ver fallar**

```
cd apps/api && npx tsx tests/turnos.test.ts
```
Esperado: no resuelve el módulo.

- [ ] **Paso 9.3: implementar**

```ts
/**
 * Agrupación de personal por TURNO — espejo de `apps/web/src/utils/turnos.ts`.
 *
 * Dos personas comparten turno si comparten DÍAS DE DESCANSO. Por eso la clave no
 * puede ser el id de la asignación ni "diagrama + fechaInicio": dos personas con
 * el mismo Lunes-Viernes pero altas distintas —lo normal— son el mismo turno.
 * Para ROTATIVO la fecha sí importa, pero sólo por su FASE dentro del ciclo.
 *
 * Hay dos copias a propósito. La del front alimenta el filtro del calendario
 * detallado, que trabaja sobre datos ya cargados. Ésta es la AUTORIDAD: es la que
 * resuelve a quién le llega una difusión, y nunca confía en lo que mande el
 * cliente. Si cambia el criterio, hay que cambiar las dos — y los dos tests.
 */
import { claveFecha } from './fecha-dia.utils.js';

const MS_POR_DIA = 86_400_000;
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export interface DiagramaTurno {
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
}
export interface TramoTurno {
  diagrama: DiagramaTurno;
  fechaInicio: Date;
}

/** Días enteros desde la época, leídos de la CLAVE del día (nunca del timestamp). */
function diaEpoch(fecha: Date): number {
  return Math.round(Date.parse(`${claveFecha(fecha)}T00:00:00Z`) / MS_POR_DIA);
}

export function turnoKey(tramo: TramoTurno | null): string {
  if (!tramo) return 'SIN';
  const { diagrama, fechaInicio } = tramo;
  if (diagrama.tipo === 'ROTATIVO') {
    const dt = diagrama.diasTrabajo ?? 0;
    const dd = diagrama.diasDescanso ?? 0;
    const ciclo = dt + dd;
    if (ciclo <= 0) return 'SIN';
    const fase = ((diaEpoch(fechaInicio) % ciclo) + ciclo) % ciclo;
    return `R|${dt}|${dd}|${fase}`;
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    return `F|${[...diagrama.diasSemana].sort((a, b) => a - b).join(',')}`;
  }
  return 'SIN';
}

/**
 * El primer día ≥ `hoy` en que arranca un ciclo de trabajo. Es lo que la gente
 * dice cuando dice "los que empiezan el jueves 30". `null` para FIJO_SEMANA, que
 * no tiene ciclo que empiece.
 */
export function proximoInicioDeCiclo(tramo: TramoTurno, hoy: Date): Date | null {
  const { diagrama, fechaInicio } = tramo;
  if (diagrama.tipo !== 'ROTATIVO') return null;
  const ciclo = (diagrama.diasTrabajo ?? 0) + (diagrama.diasDescanso ?? 0);
  if (ciclo <= 0) return null;
  const desfase = ((diaEpoch(hoy) - diaEpoch(fechaInicio)) % ciclo + ciclo) % ciclo;
  const proximo = desfase === 0 ? diaEpoch(hoy) : diaEpoch(hoy) + (ciclo - desfase);
  return new Date(proximo * MS_POR_DIA);
}

/** Etiqueta legible del turno, para que el remitente sepa a quién le está por escribir. */
export function etiquetaTurno(tramo: TramoTurno | null, hoy: Date): { etiqueta: string; proximoInicio: string | null } {
  if (!tramo) return { etiqueta: 'Sin diagrama asignado', proximoInicio: null };
  const { diagrama } = tramo;
  if (diagrama.tipo === 'ROTATIVO') {
    const prox = proximoInicioDeCiclo(tramo, hoy);
    const dt = diagrama.diasTrabajo ?? 0;
    const dd = diagrama.diasDescanso ?? 0;
    if (!prox) return { etiqueta: `Rotativo ${dt}×${dd}`, proximoInicio: null };
    // getUTCDay/getUTCDate: es una fecha-día. Con getters locales y TZ=AR se lee
    // el día anterior y la etiqueta nombraría el día equivocado.
    const nombre = DIAS_SEMANA[prox.getUTCDay()]!;
    const dd2 = String(prox.getUTCDate()).padStart(2, '0');
    const mm = String(prox.getUTCMonth() + 1).padStart(2, '0');
    return { etiqueta: `Rotativo ${dt}×${dd} — arrancan el ${nombre} ${dd2}/${mm}`, proximoInicio: claveFecha(prox) };
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    const dias = [...diagrama.diasSemana].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d]!);
    return { etiqueta: `Semana fija — trabajan ${dias.join(', ') || '—'}`, proximoInicio: null };
  }
  return { etiqueta: 'Sin diagrama asignado', proximoInicio: null };
}
```

- [ ] **Paso 9.4: verde, sumar a la suite y commitear**

```
cd apps/api && npx tsx tests/turnos.test.ts
```
Agregar ` && tsx tests/turnos.test.ts` a `test:unit` en `apps/api/package.json`.

```bash
git add apps/api/src/utils/turnos.utils.ts apps/api/tests/turnos.test.ts apps/api/package.json
git commit -m "feat(api): la agrupación por turno vive también en el backend"
```

---

## Tarea 10: `difusion.utils.ts`

**Archivos:**
- Crear: `apps/api/src/utils/difusion.utils.ts`
- Modificar: `apps/api/tests/turnos.test.ts` (mismo archivo, sección nueva)

- [ ] **Paso 10.1: el test del alcance**

```ts
import { alcanceDeDifusion } from '../src/utils/difusion.utils.js';

// RRHH y ADMIN: toda la empresa.
assert.strictEqual(alcanceDeDifusion({ rol: 'RRHH', rolNivel: 90, sectorId: 's1' }), 'EMPRESA');
// CMASS elige: su sector o toda la empresa ⇒ alcance EMPRESA aunque tenga sector.
assert.strictEqual(alcanceDeDifusion({ rol: 'CMASS', rolNivel: 75, sectorId: 's1' }), 'EMPRESA');
// Gerente general: nivel alto SIN sector ⇒ transversal, no mal configurado.
assert.strictEqual(alcanceDeDifusion({ rol: 'GERENTE', rolNivel: 80, sectorId: null }), 'EMPRESA');
// Gerente de sector y coordinador: su sector.
assert.strictEqual(alcanceDeDifusion({ rol: 'GERENTE', rolNivel: 80, sectorId: 's1' }), 'SECTOR');
assert.strictEqual(alcanceDeDifusion({ rol: 'COORDINADOR', rolNivel: 70, sectorId: 's1' }), 'SECTOR');
// Supervisor y operador: no difunden.
assert.strictEqual(alcanceDeDifusion({ rol: 'SUPERVISOR', rolNivel: 60, sectorId: 's1' }), 'NINGUNO');
assert.strictEqual(alcanceDeDifusion({ rol: 'OPERADOR', rolNivel: 10, sectorId: null }), 'NINGUNO');
```

- [ ] **Paso 10.2: implementar**

```ts
/**
 * Quién puede difundir y hasta dónde.
 *
 * En vez de una tabla de excepciones por rol, cada remitente tiene un ALCANCE
 * MÁXIMO y todo lo demás se deriva de ahí. Un rol de nivel ≥ 70 SIN sector no
 * está mal configurado: es transversal — la misma convención que ya rige los
 * circuitos de aprobación, donde un GERENTE sin sector aprueba para toda la
 * empresa. El gerente general es ese caso: no tiene sector porque su alcance es
 * la compañía.
 */
export type AlcanceDifusion = 'EMPRESA' | 'SECTOR' | 'NINGUNO';

export const NIVEL_MINIMO_DIFUSION = 70;

export function alcanceDeDifusion(u: { rol: string; rolNivel: number; sectorId: string | null }): AlcanceDifusion {
  if (u.rolNivel >= 90) return 'EMPRESA';
  if (u.rol === 'CMASS') return 'EMPRESA';
  if (u.rolNivel >= NIVEL_MINIMO_DIFUSION && !u.sectorId) return 'EMPRESA';
  if (u.rolNivel >= NIVEL_MINIMO_DIFUSION) return 'SECTOR';
  return 'NINGUNO';
}

/** Los `destinoTipo` que ese alcance habilita. `ROL` sólo para nivel ≥ 90. */
export function destinosPermitidos(alcance: AlcanceDifusion, rolNivel: number): string[] {
  if (alcance === 'NINGUNO') return [];
  if (alcance === 'SECTOR') return ['SECTOR', 'TURNO', 'USUARIO'];
  return rolNivel >= 90
    ? ['TODOS', 'SECTOR', 'ROL', 'TURNO', 'USUARIO']
    : ['TODOS', 'SECTOR', 'TURNO', 'USUARIO'];
}
```

- [ ] **Paso 10.3: verde y commit**

```bash
cd apps/api && npx tsx tests/turnos.test.ts && npm run test:unit
git add apps/api/src/utils/difusion.utils.ts apps/api/tests/turnos.test.ts
git commit -m "feat(api): el alcance de difusión sale del nivel y del sector, no del rol"
```

---

## Tarea 11: la migración

**PARAR ACÁ Y PEDIR AUTORIZACIÓN ANTES DE CORRER NADA.** Esta tarea toca el esquema y borra
dos columnas.

**Archivos:**
- Modificar: `apps/api/prisma/schema.prisma`
- Crear: `apps/api/prisma/migrations/20260728XXXXXX_difusion_adjuntos_confirmacion/migration.sql`

- [ ] **Paso 11.1: respaldo**

```
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" <DATABASE_URL> -Fc -f respaldo-antes-difusion.dump
```

- [ ] **Paso 11.2: el schema**

En `model Mensaje`: sacar `archivoUrl`/`archivoNombre`, agregar

```prisma
  destinoSectorId      String?  @map("destino_sector_id")
  requiereConfirmacion Boolean  @default(false) @map("requiere_confirmacion")
  adjuntos             MensajeAdjunto[]
```

En `model MensajeRespuesta`: sacar `archivoUrl`/`archivoNombre`, agregar
`adjuntos MensajeAdjunto[]`.

En `model MensajeDestinatario`: agregar `confirmadoAt DateTime? @map("confirmado_at")`.

Y el modelo nuevo:

```prisma
model MensajeAdjunto {
  id           String   @id @default(uuid())
  mensajeId    String?  @map("mensaje_id")
  respuestaId  String?  @map("respuesta_id")
  url          String
  nombre       String
  tipo         String   // 'IMAGEN' | 'ARCHIVO'
  tamanioBytes Int      @default(0) @map("tamanio_bytes")
  createdAt    DateTime @default(now()) @map("created_at")

  mensaje   Mensaje?          @relation(fields: [mensajeId], references: [id], onDelete: Cascade)
  respuesta MensajeRespuesta? @relation(fields: [respuestaId], references: [id], onDelete: Cascade)

  @@index([mensajeId])
  @@index([respuestaId])
  @@map("mensaje_adjuntos")
}
```

- [ ] **Paso 11.3: el SQL**

```sql
-- Adjuntos múltiples, alcance del destino y confirmación explícita de recepción.
--
-- El backfill y el DROP van en la MISMA migración a propósito: partirlos deja una
-- ventana donde el mismo adjunto vive en dos lugares y cualquier escritura de esa
-- ventana se pierde. Al momento de escribir esto son 3 filas en mensajes y 3 en
-- mensaje_respuestas (sobre 19 mensajes).

CREATE TABLE "mensaje_adjuntos" (
  "id" TEXT NOT NULL,
  "mensaje_id" TEXT,
  "respuesta_id" TEXT,
  "url" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "tamanio_bytes" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensaje_adjuntos_pkey" PRIMARY KEY ("id"),
  -- Un adjunto cuelga de un mensaje O de una respuesta, nunca de los dos ni de
  -- ninguno: sin esto, una fila huérfana no la ve nadie hasta que rompe un JOIN.
  CONSTRAINT "mensaje_adjuntos_uno_u_otro" CHECK (
    ("mensaje_id" IS NOT NULL AND "respuesta_id" IS NULL)
    OR ("mensaje_id" IS NULL AND "respuesta_id" IS NOT NULL)
  )
);

CREATE INDEX "mensaje_adjuntos_mensaje_id_idx" ON "mensaje_adjuntos"("mensaje_id");
CREATE INDEX "mensaje_adjuntos_respuesta_id_idx" ON "mensaje_adjuntos"("respuesta_id");

ALTER TABLE "mensaje_adjuntos" ADD CONSTRAINT "mensaje_adjuntos_mensaje_id_fkey"
  FOREIGN KEY ("mensaje_id") REFERENCES "mensajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mensaje_adjuntos" ADD CONSTRAINT "mensaje_adjuntos_respuesta_id_fkey"
  FOREIGN KEY ("respuesta_id") REFERENCES "mensaje_respuestas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill. `tamanio_bytes` queda en 0 en lo histórico: el archivo puede ya no
-- estar en disco y no vale la pena tocar el filesystem desde una migración.
INSERT INTO "mensaje_adjuntos" ("id", "mensaje_id", "url", "nombre", "tipo", "tamanio_bytes", "created_at")
SELECT gen_random_uuid()::text, "id", "archivo_url", COALESCE("archivo_nombre", 'adjunto'),
       CASE WHEN lower("archivo_url") LIKE '%.pdf' THEN 'ARCHIVO' ELSE 'IMAGEN' END,
       0, "created_at"
FROM "mensajes" WHERE "archivo_url" IS NOT NULL;

INSERT INTO "mensaje_adjuntos" ("id", "respuesta_id", "url", "nombre", "tipo", "tamanio_bytes", "created_at")
SELECT gen_random_uuid()::text, "id", "archivo_url", COALESCE("archivo_nombre", 'adjunto'),
       CASE WHEN lower("archivo_url") LIKE '%.pdf' THEN 'ARCHIVO' ELSE 'IMAGEN' END,
       0, "created_at"
FROM "mensaje_respuestas" WHERE "archivo_url" IS NOT NULL;

ALTER TABLE "mensajes" DROP COLUMN "archivo_url", DROP COLUMN "archivo_nombre";
ALTER TABLE "mensaje_respuestas" DROP COLUMN "archivo_url", DROP COLUMN "archivo_nombre";

ALTER TABLE "mensajes"
  ADD COLUMN "destino_sector_id" TEXT,
  ADD COLUMN "requiere_confirmacion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "mensaje_destinatarios" ADD COLUMN "confirmado_at" TIMESTAMP(3);
```

> `gen_random_uuid()` viene de `pgcrypto`, que en PostgreSQL 13+ ya está en el core. Si la
> instancia lo rechaza, reemplazar por `md5(random()::text || clock_timestamp()::text)`.

- [ ] **Paso 11.4: aplicar**

Bajar la API (`prisma generate` falla con ella viva), después:

```
cd apps/api && npx prisma migrate dev --name difusion_adjuntos_confirmacion && npx prisma generate
```

Verificar el backfill antes de seguir:

```sql
SELECT count(*) FROM mensaje_adjuntos;   -- esperado: 6
```

- [ ] **Paso 11.5: commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): adjuntos múltiples, alcance del destino y confirmación de recepción"
```

---

## Tarea 12: alcance y turno en `POST /mensajes`

**Archivos:** Modificar `apps/api/src/routes/mensajes.routes.ts`

- [ ] **Paso 12.1: resolver el alcance del remitente**

```ts
import { alcanceDeDifusion, destinosPermitidos, NIVEL_MINIMO_DIFUSION } from '../utils/difusion.utils.js';
import { turnoKey, etiquetaTurno, type TramoTurno } from '../utils/turnos.utils.js';
import { tramoDelDia, tramosDeUsuario } from '../utils/diagrama-vigencia.utils.js';
import { hoyLocalEmpresa } from '../utils/fecha-dia.utils.js';

async function contextoDeDifusion(user: { userId: string; empresaId: string; rol: string; rolNivel: number }) {
  const remitente = await prisma.usuario.findUnique({
    where: { id: user.userId },
    select: { sectorId: true },
  });
  const sectorId = remitente?.sectorId ?? null;
  const alcance = alcanceDeDifusion({ rol: user.rol, rolNivel: user.rolNivel, sectorId });
  return { sectorId, alcance, permitidos: destinosPermitidos(alcance, user.rolNivel) };
}
```

- [ ] **Paso 12.2: el turno de cada usuario del alcance**

```ts
/**
 * Agrupa a los usuarios del alcance por turno, evaluando el tramo VIGENTE HOY.
 * Si alguien cambió de diagrama la semana pasada, cae en su grupo nuevo — que es
 * lo que espera quien manda el mensaje.
 */
async function turnosDeUsuarios(usuarioIds: string[]): Promise<Map<string, { clave: string; tramo: TramoTurno | null }>> {
  const hoy = hoyLocalEmpresa();
  const salida = new Map<string, { clave: string; tramo: TramoTurno | null }>();
  const asignaciones = await prisma.usuarioDiagrama.findMany({
    where: { usuarioId: { in: usuarioIds }, fechaInicio: { lte: hoy }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }] },
    orderBy: { fechaInicio: 'asc' },
    select: {
      usuarioId: true, fechaInicio: true, fechaFin: true,
      diagrama: { select: { id: true, nombre: true, tipo: true, diasTrabajo: true, diasDescanso: true, diasSemana: true } },
    },
  });
  const porUsuario = new Map<string, typeof asignaciones>();
  for (const a of asignaciones) {
    const lista = porUsuario.get(a.usuarioId) ?? [];
    lista.push(a);
    porUsuario.set(a.usuarioId, lista);
  }
  for (const uid of usuarioIds) {
    // El `select` de arriba trae exactamente los campos de `TramoDiagrama`
    // (id, nombre, tipo, diasTrabajo, diasDescanso, diasSemana + fechaInicio y
    // fechaFin), así que la lista entra sin conversión.
    const tramos: TramoDiagrama[] = (porUsuario.get(uid) ?? []).map((a) => ({
      diagrama: a.diagrama, fechaInicio: a.fechaInicio, fechaFin: a.fechaFin,
    }));
    const vigente = tramoDelDia(tramos, hoy);
    salida.set(uid, { clave: turnoKey(vigente), tramo: vigente });
  }
  return salida;
}
```

`TramoDiagrama` (de `diagrama-vigencia.utils.ts`) es estructuralmente un `TramoTurno`: tiene
`diagrama` con los cinco campos que mira `turnoKey` y `fechaInicio`. Los campos de más no
molestan. Importar `type TramoDiagrama` junto con `tramoDelDia`.

- [ ] **Paso 12.3: `GET /mensajes/grupos-difusion`**

Antes de `GET /mensajes/:id`. Devuelve `alcance`, `sectorPropio`, `sectores` (vacío si el
alcance es `SECTOR`) y `turnos` con clave, etiqueta, cantidad y próximo inicio. Los turnos
salen de agrupar `turnosDeUsuarios` sobre los activos del alcance (acotado por el
`sectorId` opcional si el alcance es `EMPRESA`), ordenados por cantidad descendente, con
`SIN` siempre al final.

- [ ] **Paso 12.4: `POST /mensajes`**

- `requireLevel(LEVEL_RRHH)` → `requireLevel(NIVEL_MINIMO_DIFUSION)`.
- El schema suma `TURNO` al enum de `destinoTipo` y un `destinoSectorId` opcional (uuid).
- Al entrar: `const { sectorId, alcance, permitidos } = await contextoDeDifusion(req.user!)`.
  Si `!permitidos.includes(destinoTipo)` → 403 `'No podés difundir con ese destino'`.
- La resolución de destinatarios queda así:

```ts
// Sector efectivo: con alcance SECTOR nunca es otro que el propio, mande lo que
// mande el cliente. Es la única línea que impide que un coordinador le escriba a
// otro sector poniendo un id a mano.
const sectorEfectivo = alcance === 'SECTOR' ? sectorId : (destinoSectorId ?? null);
const baseWhere: any = { empresaId, activo: true, id: { not: remitenteId } };
if (alcance === 'SECTOR' || sectorEfectivo) baseWhere.sectorId = sectorEfectivo;
```

y después, según `destinoTipo`: `TODOS` usa `baseWhere` tal cual; `SECTOR` fuerza
`baseWhere.sectorId = destinoValor` (validando que sea de la empresa, y que sea el propio
si el alcance es `SECTOR`); `ROL` agrega `rol: destinoValor`; `USUARIO` intersecta los ids
recibidos con `baseWhere`; y `TURNO` trae los usuarios de `baseWhere` y filtra por
`turnosDeUsuarios(...)` contra `destinoValor`.

- Al crear el mensaje se guarda `destinoSectorId: sectorEfectivo`.

- [ ] **Paso 12.5: `GET /mensajes/enviados`**

`requireLevel(LEVEL_RRHH)` → `requireLevel(NIVEL_MINIMO_DIFUSION)`. Ya filtra por
`remitenteId`, así que no expone nada ajeno.

- [ ] **Paso 12.6: commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/mensajes.routes.ts
git commit -m "feat(api): coordinadores, gerentes y CMASS difunden según su alcance"
```

---

## Tarea 13: adjuntos múltiples

**Archivos:** Modificar `apps/api/src/routes/mensajes.routes.ts`

- [ ] **Paso 13.1: el helper**

```ts
export const MAX_ADJUNTOS_POR_MENSAJE = 4;

/** El tipo sale del mimetype que ya validó el fileFilter, no de la extensión. */
function tipoDeAdjunto(file: Express.Multer.File): 'IMAGEN' | 'ARCHIVO' {
  return file.mimetype.startsWith('image/') ? 'IMAGEN' : 'ARCHIVO';
}

function adjuntosDesdeFiles(files: Express.Multer.File[] | undefined) {
  return (files ?? []).map((f) => ({
    url: `/uploads/${f.filename}`,
    nombre: f.originalname,
    tipo: tipoDeAdjunto(f),
    tamanioBytes: f.size,
  }));
}
```

- [ ] **Paso 13.2: cambiar el middleware**

`upload.single('archivo')` → `upload.array('adjuntos', MAX_ADJUNTOS_POR_MENSAJE)` en
`POST /` y en `POST /:id/responder`. En **cada** rama que responde 4xx antes de crear el
registro hay que llamar a `descartarArchivos(req.files as Express.Multer.File[])` — multer
ya escribió los archivos en disco. Son seis ramas en `POST /` (schema inválido, destino no
permitido, falta el sector, falta el rol, falta el usuario, sin destinatarios).

- [ ] **Paso 13.3: crear y devolver**

En el `prisma.mensaje.create`, `adjuntos: { create: adjuntosDesdeFiles(files) }`, y sumar
`adjuntos: true` a los `include` de `GET /`, `GET /:id` y `POST /:id/responder`.

- [ ] **Paso 13.4: commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/mensajes.routes.ts
git commit -m "feat(api): un mensaje puede llevar hasta cuatro adjuntos"
```

---

## Tarea 14: confirmación de recepción

**Archivos:** Modificar `apps/api/src/routes/mensajes.routes.ts`

- [ ] **Paso 14.1: el flag al crear**

`createMensajeSchema` suma `requiereConfirmacion: z.boolean().optional().default(false)`,
parseado desde el multipart igual que `permiteRespuesta`
(`req.body.requiereConfirmacion === 'true'`). Se guarda tal cual en el `create`.

- [ ] **Paso 14.2: el endpoint**

```ts
// ─── POST /mensajes/:id/confirmar ────────────────
// El "leído" se marca solo al abrir el mensaje y por eso no prueba nada. Esto es
// un acto explícito del destinatario, y es lo único que sirve para mostrar
// después que el comunicado se recibió.
router.post('/:id/confirmar', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const mensaje = await prisma.mensaje.findFirst({
      where: { id: req.params.id, empresaId: req.user!.empresaId },
      select: { id: true, requiereConfirmacion: true },
    });
    if (!mensaje) { res.status(404).json({ error: 'Mensaje no encontrado' }); return; }
    if (!mensaje.requiereConfirmacion) {
      res.status(400).json({ error: 'Este mensaje no pide confirmación de recepción' });
      return;
    }
    // Idempotente: `confirmadoAt: null` en el where hace que reconfirmar no mueva
    // la fecha original, que es justamente el dato que se quiere conservar.
    const { count } = await prisma.mensajeDestinatario.updateMany({
      where: { mensajeId: mensaje.id, usuarioId: req.user!.userId, confirmadoAt: null },
      data: { confirmadoAt: new Date(), leido: true, leidoAt: new Date() },
    });
    if (count === 0) {
      const esDestinatario = await prisma.mensajeDestinatario.count({
        where: { mensajeId: mensaje.id, usuarioId: req.user!.userId },
      });
      if (esDestinatario === 0) { res.status(403).json({ error: 'No sos destinatario de este mensaje' }); return; }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error confirmando mensaje:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
```

- [ ] **Paso 14.3: exponer el estado**

- `GET /:id`: el `select` de `destinatarios` suma `confirmadoAt` y el nombre del usuario
  (sigue viéndolo sólo el remitente o RRHH, por el `canSeeRecipients` que ya está).
- `GET /`: cada mensaje suma `requiereConfirmacion` y el `confirmadoAt` del propio
  destinatario.
- `GET /no-leidos`: pasa a `{ count, pendientesConfirmacion }`, donde el segundo cuenta
  `{ usuarioId, confirmadoAt: null, mensaje: { requiereConfirmacion: true } }`.

- [ ] **Paso 14.4: commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/routes/mensajes.routes.ts
git commit -m "feat(api): el remitente puede pedir confirmación de recepción"
```

---

## Tarea 15: QA de la difusión

**Archivos:** Modificar `apps/api/tests/qa/mensajes.qa.ts`

> Esta suite **nunca corrió verde**: asigna un rol que no crea, y `POST /usuarios` valida
> contra `RolConfig` desde `4ecc71f`. El arreglo (crear el rol antes) ya está en el commit
> `826a8be`; verificar que sigue estando antes de sumar casos.

- [ ] **Paso 15.1: casos nuevos**

1. Coordinador de A difunde con `destinoTipo: 'SECTOR'` a A → llega a los activos de A y a
   nadie de B.
2. Coordinador de A con `TODOS` → 403. Con `ROL` → 403.
3. Coordinador de A con `USUARIO` y un id de B → 400 sin destinatarios.
4. Coordinador de A con `TURNO` → llega sólo a los del turno.
5. CMASS con `TODOS` → llega a toda la empresa. CMASS con `SECTOR` = B → sólo B.
6. Gerente **sin sector** con `SECTOR` = B → llega a B (es transversal).
7. Supervisor (nivel 60) → 403.
8. Mensaje con dos adjuntos (una imagen y un PDF) → `GET /:id` los devuelve con `tipo`
   `IMAGEN` y `ARCHIVO`.
9. `POST /:id/confirmar` sobre un mensaje sin `requiereConfirmacion` → 400.
10. Con `requiereConfirmacion`: confirma un destinatario → `ok`; confirma de nuevo → `ok` y
    la fecha no cambió; lo intenta alguien que no es destinatario → 403.
11. El remitente ve en `GET /:id` quién confirmó y quién no.

- [ ] **Paso 15.2: correr y commitear**

```
cd apps/api && npx tsx tests/qa/mensajes.qa.ts
```

```bash
git add apps/api/tests/qa/mensajes.qa.ts
git commit -m "test(qa): alcance de difusión, adjuntos y confirmación de recepción"
```

---

## Tarea 16: la pantalla de mensajes

**Archivos:** Modificar `apps/web/src/pages/MensajesPage.tsx`

- [ ] **Paso 16.1: quién ve el botón de redactar**

`const isRRHH = (user?.rolNivel ?? 0) >= 90` → `const puedeDifundir = (user?.rolNivel ?? 0) >= 70`,
y actualizar los usos (el botón de redactar y la pestaña de enviados).

- [ ] **Paso 16.2: el formulario contra `grupos-difusion`**

Query nueva `['mensajes', 'grupos-difusion', sectorElegido]` → `GET /mensajes/grupos-difusion`.
Las opciones de destino se arman con lo que devuelve, no con una lista fija:

- `alcance === 'EMPRESA'`: botones **Toda la empresa · Sector · Turno · Personas** (y
  **Rol** sólo si `rolNivel >= 90`). Con "Sector" aparece el `<select>` de `sectores`, y al
  elegir uno se vuelve a pedir `grupos-difusion?sectorId=` para que los turnos y sus
  conteos sean los de ese sector.
- `alcance === 'SECTOR'`: botones **Mi sector · Turno · Personas**, sin selector de sector.

El `<select>` de turnos muestra `${t.etiqueta} (${t.cantidad})`.

- [ ] **Paso 16.3: adjuntos**

El `<input type="file">` pasa a `multiple` con `accept="image/*,application/pdf"`, tope de
4 con aviso si se pasan, y una tira de vistas previas (miniatura para imágenes, ícono y
nombre para PDF) con una cruz para sacar cada uno antes de enviar. En el `FormData`, un
`append('adjuntos', f)` por archivo.

En la vista del mensaje, los adjuntos `IMAGEN` se muestran embebidos (`<img>` con
`max-h-80 rounded-lg`) y los `ARCHIVO` como enlace de descarga con el nombre y el peso
(`formatFileSize` ya existe en `WentopPage`; moverlo a `apps/web/src/lib/utils.ts` para no
duplicarlo).

- [ ] **Paso 16.4: confirmación**

- En el formulario: casilla **"Pedir confirmación de recepción"**, con una ayuda al lado —
  *"Sin esto, sólo se marca como leído al abrirlo."*
- En la vista del mensaje, si `requiereConfirmacion && !confirmadoAt`: cartel fijo arriba
  (fondo ámbar, no bloqueante) con el botón **Confirmar recepción** → `POST /:id/confirmar`
  e invalidar `['mensajes']`. Si ya confirmó: línea gris *"Confirmaste la recepción el …"*.
- En la bandeja, distintivo en los mensajes con confirmación pendiente.
- Para el remitente, en `GET /:id`: barra **"12 de 34 confirmaron"** y lista desplegable de
  quiénes faltan.

- [ ] **Paso 16.5: probar a mano y commitear**

Entrar como coordinador y verificar que sólo puede elegir su sector; como CMASS, que puede
elegir empresa o sector; mandar un mensaje con una imagen y un PDF pidiendo confirmación,
y confirmarlo desde la cuenta de un destinatario.

```bash
cd apps/web && npx tsc -b --noEmit && npm run lint
git add apps/web/src/pages/MensajesPage.tsx apps/web/src/lib/utils.ts apps/web/src/pages/WentopPage.tsx
git commit -m "feat(web): difusión por alcance, adjuntos múltiples y confirmación de recepción"
```

---

# PARTE 4 — Seguimiento WENTOP

## Tarea 17: listado paginado y ordenable

**Archivos:** Modificar `apps/api/src/routes/wentop.routes.ts`, `apps/api/tests/qa/wentop.qa.ts`,
`apps/web/src/pages/WentopPage.tsx`

- [ ] **Paso 17.1: la API**

En `GET /wentop`, después de armar el `where`:

```ts
const page = Math.max(1, parseInt(req.query.page as string) || 1);
const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 100));
const ORDENES: Record<string, any> = {
  fechaReporte: { fechaReporte: 'desc' },
  estado: { estado: 'asc' },
  tipoTarjeta: { tipoTarjeta: 'asc' },
  sector: { sectorObservacion: { nombre: 'asc' } },
  creador: { creador: { apellido: 'asc' } },
};
const campo = (req.query.orden as string) || 'fechaReporte';
if (!ORDENES[campo]) { res.status(400).json({ error: 'Parámetro "orden" inválido' }); return; }
const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
// Se toma la forma del orden elegido y se le pisa la dirección; la lista blanca de
// arriba es lo que impide que un `orden` arbitrario llegue al ORDER BY.
const orderBy = Object.fromEntries(
  Object.entries(ORDENES[campo]).map(([k, v]) => [k, typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k2]) => [k2, dir])) : dir]),
);

const [tarjetas, total] = await Promise.all([
  prisma.wentopTarjeta.findMany({ where, include: tarjetaInclude, orderBy, skip: (page - 1) * limit, take: limit }),
  prisma.wentopTarjeta.count({ where }),
]);
res.json({ tarjetas, total, page, pages: Math.ceil(total / limit) });
```

Se borra `MAX_TARJETAS_LISTADO` y su comentario: con paginado real el tope ya no protege
nada, y era justo el que impedía ver todas las tarjetas del sector.

- [ ] **Paso 17.2: el front y la suite**

Todos los `data` del listado pasan de `WentopTarjeta[]` a `{ tarjetas, total, page, pages }`.
Es un solo consumidor (`WentopPage`) y una sola suite. En `wentop.qa.ts`, cambiar los
`res.body.length` por `res.body.tarjetas.length` y agregar: página 2 devuelve otras
tarjetas, `limit` se topea en 100, `orden` inválido → 400.

- [ ] **Paso 17.3: commit**

```bash
cd apps/api && npm run test:unit && npx tsx tests/qa/wentop.qa.ts
cd ../web && npx tsc -b --noEmit
git add apps/api/src/routes/wentop.routes.ts apps/api/tests/qa/wentop.qa.ts apps/web/src/pages/WentopPage.tsx
git commit -m "feat(api): el listado de tarjetas WENTOP se pagina y se ordena"
```

---

## Tarea 18: miniaturas en un worker

**Archivos:**
- Modificar: `apps/api/package.json` (dependencia `jimp`)
- Crear: `apps/api/src/utils/miniaturas.worker.ts`
- Crear: `apps/api/src/utils/miniaturas.service.ts`

- [ ] **Paso 18.1: instalar**

```
cd apps/api && npm install jimp@^1.6.1
```

- [ ] **Paso 18.2: el worker**

```ts
/**
 * Redimensionado de imágenes, fuera del hilo principal.
 *
 * `jimp` es JavaScript puro: decodificar un JPEG de 5 MB cuesta entre 300 y 600 ms
 * de CPU BLOQUEANTE. Trescientas fotos son varios minutos con la API sin responder
 * ni el /health — no lenta: caída. Por eso vive acá y no en el proceso principal.
 */
import { parentPort } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { Jimp } from 'jimp';

export interface PedidoMiniatura {
  id: number;
  origen: string;
  /** Ruta SIN extensión: el worker le agrega `_<ancho>x<alto>.jpg`. */
  destinoBase: string;
  lado: number;
}
export interface RespuestaMiniatura {
  id: number;
  ok: boolean;
  ruta?: string;
  ancho?: number;
  alto?: number;
  error?: string;
}

parentPort!.on('message', async (pedido: PedidoMiniatura) => {
  try {
    const img = await Jimp.read(pedido.origen);
    img.scaleToFit({ w: pedido.lado, h: pedido.lado });
    const buffer = await img.getBuffer('image/jpeg', { quality: 70 });
    // Las dimensiones van en el NOMBRE: es el único que las sabe sin volver a
    // decodificar la imagen, y quien lea la caché después las necesita.
    const ancho = img.bitmap.width;
    const alto = img.bitmap.height;
    const ruta = `${pedido.destinoBase}_${ancho}x${alto}.jpg`;
    await writeFile(ruta, buffer);
    parentPort!.postMessage({ id: pedido.id, ok: true, ruta, ancho, alto });
  } catch (e) {
    parentPort!.postMessage({ id: pedido.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
```

- [ ] **Paso 18.3: el servicio**

```ts
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR_PATH } from '../middleware/upload.middleware.js';

export const LADO_MINIATURA = 600;
const DIR_MINIATURAS = path.join(UPLOAD_DIR_PATH, 'thumbs');

let worker: Worker | null = null;
let siguienteId = 1;
const pendientes = new Map<number, (r: any) => void>();

/**
 * Índice de miniaturas ya generadas, con sus dimensiones.
 *
 * Las dimensiones se guardan EN EL NOMBRE del archivo (`<base>_600x338.jpg`) y no
 * se leen de la imagen: para saber cuánto mide una miniatura habría que
 * decodificarla, que es justamente el trabajo caro que este módulo existe para
 * evitar. Con el nombre alcanza un `readdir`, una sola vez por arranque.
 */
const indice = new Map<string, { ruta: string; ancho: number; alto: number }>();
let indiceListo = false;

async function cargarIndice(): Promise<void> {
  if (indiceListo) return;
  await mkdir(DIR_MINIATURAS, { recursive: true });
  for (const archivo of await readdir(DIR_MINIATURAS)) {
    const m = /^(.+)_(\d+)x(\d+)\.jpg$/.exec(archivo);
    if (!m) continue;
    indice.set(m[1]!, {
      ruta: path.join(DIR_MINIATURAS, archivo),
      ancho: Number(m[2]),
      alto: Number(m[3]),
    });
  }
  indiceListo = true;
}

function obtenerWorker(): Worker {
  if (worker) return worker;
  // En desarrollo el archivo es .ts y lo carga tsx; compilado es .js. Se deduce
  // de la extensión de ESTE módulo en vez de cablearla.
  const aqui = fileURLToPath(import.meta.url);
  const ext = path.extname(aqui);
  const ruta = path.join(path.dirname(aqui), `miniaturas.worker${ext}`);
  worker = new Worker(ruta, { execArgv: ext === '.ts' ? ['--import', 'tsx'] : [] });
  worker.on('message', (r: any) => { pendientes.get(r.id)?.(r); pendientes.delete(r.id); });
  worker.on('error', (e) => { console.error('Worker de miniaturas caído:', e); worker = null; });
  worker.unref();   // no impide que el proceso termine
  return worker;
}

/**
 * Ruta de la miniatura de una foto, generándola si hace falta. `null` si el
 * original no existe o no se pudo procesar: una foto perdida no puede tumbar una
 * exportación entera.
 */
export async function miniaturaDe(urlPublica: string): Promise<{ ruta: string; ancho: number; alto: number } | null> {
  await cargarIndice();
  const nombre = path.basename(urlPublica);
  const base = path.parse(nombre).name;

  const cacheada = indice.get(base);
  if (cacheada) return cacheada;

  const origen = path.join(UPLOAD_DIR_PATH, nombre);
  // El original puede no estar (borrado a mano, respaldo restaurado a medias).
  // Devolver null en vez de tirar: una foto perdida no puede tumbar el export.
  try { await stat(origen); } catch { return null; }

  const id = siguienteId++;
  const respuesta: RespuestaMiniatura = await new Promise((resolve) => {
    pendientes.set(id, resolve);
    obtenerWorker().postMessage({
      id, origen, destinoBase: path.join(DIR_MINIATURAS, base), lado: LADO_MINIATURA,
    });
  });
  if (!respuesta.ok || !respuesta.ruta) {
    console.warn(`No se pudo generar la miniatura de ${nombre}: ${respuesta.error}`);
    return null;
  }
  const entrada = { ruta: respuesta.ruta, ancho: respuesta.ancho!, alto: respuesta.alto! };
  indice.set(base, entrada);
  return entrada;
}

/** Encola la miniatura sin esperarla. Para el alta de fotos: la subida no se frena. */
export function calentarMiniatura(urlPublica: string): void {
  miniaturaDe(urlPublica).catch(() => { /* se generará en la exportación */ });
}

/** Borra la miniatura de una foto que se elimina, y la saca del índice. */
export async function borrarMiniatura(urlPublica: string): Promise<void> {
  await cargarIndice();
  const base = path.parse(path.basename(urlPublica)).name;
  const entrada = indice.get(base);
  indice.delete(base);
  if (!entrada) return;
  try {
    await unlink(entrada.ruta);
  } catch {
    /* ya no está: nada que hacer */
  }
}
```

Imports del servicio: `stat`, `mkdir`, `readdir` y `unlink` de `node:fs/promises`, más el
tipo `RespuestaMiniatura` del worker.

**Concurrencia:** dos pedidos simultáneos de la misma foto la generan dos veces y escriben
el mismo archivo — inofensivo (el contenido es idéntico) y raro. No vale la pena un mapa de
promesas en vuelo; si aparece en los logs, se agrega.

- [ ] **Paso 18.4: probar el worker aislado**

Script temporal en el scratchpad que llame a `miniaturaDe` sobre una foto real de
`uploads/` y verifique que el archivo aparece en `uploads/thumbs/` con lado ≤ 600.
**Verificar además que el `execArgv` con tsx funciona**: si el worker no arranca en
desarrollo, ajustar antes de seguir.

- [ ] **Paso 18.5: commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/package.json apps/api/package-lock.json apps/api/src/utils/miniaturas.*
git commit -m "feat(api): miniaturas de fotos en un worker, con caché en disco"
```

---

## Tarea 19: el workbook

**Archivos:** Crear `apps/api/src/utils/wentop-export.utils.ts`

- [ ] **Paso 19.1: la geometría de las celdas de foto**

```ts
/**
 * Las celdas de foto son CUADRADAS a propósito.
 *
 * Una tarjeta trae fotos apaisadas (16:9) y verticales (9:16). Cualquier celda
 * rectangular deforma una de las dos o desperdicia media planilla. Con la celda
 * cuadrada, cada foto se escala para ENTRAR conservando su proporción y se centra
 * con un `tl` fraccionario. Las fotos siguientes ocupan las columnas de al lado.
 */
const LADO_FOTO_PX = 140;
const PX_POR_CARACTER = 7;   // ancho de columna de ExcelJS, fuente por defecto
const PT_POR_PX = 0.75;      // alto de fila

function ubicarFoto(anchoReal: number, altoReal: number, col: number, fila: number) {
  const escala = Math.min(LADO_FOTO_PX / anchoReal, LADO_FOTO_PX / altoReal);
  const ancho = Math.round(anchoReal * escala);
  const alto = Math.round(altoReal * escala);
  return {
    tl: {
      col: col + (1 - ancho / LADO_FOTO_PX) / 2,
      row: fila + (1 - alto / LADO_FOTO_PX) / 2,
    },
    ext: { width: ancho, height: alto },
    editAs: 'oneCell' as const,
  };
}
```

- [ ] **Paso 19.2: `construirWorkbookWentop(tarjetas, opciones)`**

Encabezado con las 19 columnas de texto del diseño más `Foto 1..N`, donde `N` es el máximo
de fotos de las tarjetas exportadas (0 ⇒ ninguna columna de foto). Las de texto largo con
`wrapText` y ancho fijo; las de foto con `width = LADO_FOTO_PX / PX_POR_CARACTER`. Cada
fila con `height = max(alto del texto, LADO_FOTO_PX * PT_POR_PX)` cuando tiene fotos.

Las categorías (`calidad`, `medioambiente`, `seguridadSalud`) son arrays JSON: se unen con
`', '`. Las fechas se formatean con `claveFecha` (fecha-día, getters UTC).

Por cada foto: `await miniaturaDe(url)`; si da `null`, la celda queda con el texto
`'foto no disponible'` y sigue. Si no, `workbook.addImage({ buffer, extension: 'jpeg' })` y
`worksheet.addImage(imageId, ubicarFoto(ancho, alto, colFoto + i, fila.number - 1))`.

- [ ] **Paso 19.3: commit**

```bash
cd apps/api && npm run test:unit
git add apps/api/src/utils/wentop-export.utils.ts
git commit -m "feat(api): armado del Excel de tarjetas WENTOP con fotos en celdas cuadradas"
```

---

## Tarea 20: el endpoint de exportación

**Archivos:** Modificar `apps/api/src/routes/wentop.routes.ts`

- [ ] **Paso 20.1: la ruta**

Antes de `GET /wentop/:id`:

```ts
// ─── GET /wentop/export.xlsx ─────────────────────
router.get('/export.xlsx', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alcance = await alcanceDeSectores(req.user!);
    const esGestor = alcance.sectores.length > 0 && !alcance.global;
    // Un operador no exporta: el Excel junta las descripciones de todas las
    // tarjetas del sector en un archivo que se puede llevar, que es otra cosa que
    // verlas de a una en pantalla.
    if (!alcance.global && !esGestor && req.user!.rolNivel < LEVEL_COORDINADOR) {
      res.status(403).json({ error: 'No tenés permiso para exportar tarjetas' });
      return;
    }
    // Mismo where y mismos filtros que el listado.
    const where = await buildVisibilityWhere(req.user!);
    // … aplicar estado / tipoTarjeta / sectorId / desde / hasta …
    const tarjetas = await prisma.wentopTarjeta.findMany({
      where, include: { ...tarjetaDetailInclude }, orderBy: { fechaReporte: 'desc' },
    });
    const workbook = await construirWorkbookWentop(tarjetas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="wentop-${claveFecha(hoyLocalEmpresa())}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exportando tarjetas wentop:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
  }
});
```

El `if (!res.headersSent)` no es decorativo: si falla a mitad del stream ya se mandaron los
encabezados y un `res.status()` ahí revienta.

- [ ] **Paso 20.2: enganchar las miniaturas al ciclo de vida**

- `POST /:id/fotos`: después del `res.status(201).json(fotos)`, un
  `for (const f of fotos) calentarMiniatura(f.url)`.
- `DELETE /:id/fotos/:fotoId`: `await borrarMiniatura(foto.url)` junto al `unlink` del
  original.
- `DELETE /:id`: lo mismo dentro del bucle de limpieza.

- [ ] **Paso 20.3: probar a mano**

Con la API viva, `curl` autenticado a `/wentop/export.xlsx`, abrir el archivo y verificar:
fotos apaisadas y verticales sin deformar, centradas, varias fotos en columnas contiguas,
texto largo con salto de línea.

- [ ] **Paso 20.4: commit**

```bash
git add apps/api/src/routes/wentop.routes.ts
git commit -m "feat(api): exportación de tarjetas WENTOP a Excel con fotos"
```

---

## Tarea 21: la tabla y el botón de descarga

**Archivos:** Modificar `apps/web/src/pages/WentopPage.tsx`

- [ ] **Paso 21.1: el toggle**

En `TarjetasTab`, estado `vista: 'grilla' | 'tabla'` persistido en `localStorage`
(`wentop-vista`), con el mismo par de botones que usa el calendario.

- [ ] **Paso 21.2: la tabla**

Columnas: Fecha · Tipo · Estado · Sector · Creador · Fotos. Encabezados clickeables que
mandan `orden`/`dir` a la query. Paginado abajo (`« Anterior · Página X de Y · Siguiente »`)
con `page` en el estado. Cada fila abre el mismo modal de detalle.

- [ ] **Paso 21.3: descarga**

Botón **Exportar a Excel** al lado de los filtros, visible sólo si
`alcance.global || alcance.sectores.length > 0 || rolNivel >= 70`. Descarga con
`api.get('/wentop/export.xlsx', { params, responseType: 'blob' })` y un `<a download>`
temporal. Estado de "generando…" mientras responde: la primera exportación de un sector
grande tarda, porque genera todas las miniaturas.

- [ ] **Paso 21.4: commit**

```bash
cd apps/web && npx tsc -b --noEmit && npm run lint
git add apps/web/src/pages/WentopPage.tsx
git commit -m "feat(web): vista de tabla y exportación a Excel de las tarjetas WENTOP"
```

---

## Tarea 22: cierre

- [ ] **Paso 22.1: barrido completo**

Con la API recién reiniciada, correr las suites QA de a seis y reiniciar entre tandas.
Baseline conocido: **673/679**, con seis rojos que son aserciones obsoletas (`usuarios`
44/46, `admin` 64/65, `mensajes` M3, `audit` CD12/CD13). Cualquier rojo nuevo es de este
trabajo.

- [ ] **Paso 22.2: actualizar la memoria**

Nuevas trampas que valen para la próxima sesión: el worker de miniaturas y su `execArgv`,
el cambio de forma de `GET /wentop`, y que `mensajes` ya no tiene `archivoUrl`.

- [ ] **Paso 22.3: cerrar la rama**

Usar la skill `superpowers:finishing-a-development-branch`.
