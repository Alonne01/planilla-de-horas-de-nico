# Spec de porteo — Lógica de llenado de la Planilla de Horas (PWA → otra app)

> Documento autocontenido para implementar en otra aplicación la lógica de la PWA
> `planilla-horas` (React 19 + Dexie): calendario "pintado", ventana de ingreso de
> datos por día, tipos de ausencia, feriados/francos, conteo de horas y colores.
> Fuentes originales: `src/lib/{calculo-horas,diagrama,feriados}.ts`,
> `src/components/{CalendarGrid,RegistroDialog}.tsx`, `src/db/database.ts`.

---

## 1. Modelo de datos por día (`RegistroHoras`)

Un registro por fecha (no hay días con más de un registro). Campos relevantes:

| Campo | Tipo | Significado |
|---|---|---|
| `id` | string (uuid) | identidad |
| `fechaMs` | epoch ms | el día (medianoche local) |
| `entradaInicioMs` / `salidaInicioMs` | epoch ms \| null | turno principal (entrada/salida) |
| `entradaFinMs` / `salidaFinMs` | epoch ms \| null | 2º turno opcional (legado; el diálogo actual sólo carga el principal pero el cálculo suma ambos) |
| `lugarTrabajo` | `'Base' \| 'Campo' \| 'Franco'` | `'Franco'` se usa SOLO al guardar ausencias (sin horas); nunca es un botón |
| `pernocte` | `'NO' \| 'Hotel' \| 'Trailer'` | sólo aplica en Campo |
| `maneja` | boolean | sólo Campo; activarlo fuerza `horasViaje` ON |
| `horasViaje` | number | toggle → guarda `2` si está activo, `0` si no (sólo Campo) |
| `observaciones` / `proyecto` | string | el diálogo usa un solo campo de texto y lo guarda en ambos |
| `esFeriado` | boolean | la fecha es feriado nacional (se setea siempre que corresponda, trabajado o no) |
| `esFeriadoTrabajado` | boolean | feriado + horas cargadas → todo al 100% |
| `esFrancoTrabajado` | boolean | franco por diagrama + horas cargadas → todo al 100% |
| `esFrancoCompensatorio` | boolean | ausencia tipo "Compensatorio" |
| `esAusenciaJustificada` | boolean | ausencia justificada (0 horas) |
| `esFaltaInjustificada` | boolean | falta injustificada (0 horas; descuenta básico proporcional + presentismo) |

Settings globales que afectan esta lógica: `diagrama` (patrón de francos),
`diagramaInicioMs` (inicio del ciclo), `lineaTrabajo` (`SURFACE_WELL_TESTING | SBDP | FRACTURA`).

---

## 2. Período de liquidación

El período visible/calculado va del **21 del mes anterior al 20 del mes corriente** (31 días aprox.).

```ts
periodoStart(mes, anio) = día 21 del mes anterior   // mes 0-indexed = mes "actual" del período
periodoEnd(mes, anio)   = día 20 de (mes, anio)
// Período por defecto: si hoy es día >= 21 → el período del mes SIGUIENTE
// (con rollover de diciembre → enero del año siguiente).
```

---

## 3. Diagrama de trabajo (francos programados)

Patrones: `LUNES_VIERNES` (franco = sáb/dom), `10×5`, `7×7`, `10×4` (días trabajo × días franco).

```ts
esFrancoPorDiagrama(fechaMs, diagrama, inicioMs):
  if diagrama == LUNES_VIERNES: return dow == sábado || dow == domingo
  if inicioMs <= 0: return false            // ciclo no configurado → nunca franco
  ciclo = diasTrabajo + diasFranco
  diffDays = round((startOfDay(fecha) - startOfDay(inicio)) / 86_400_000)
  pos = ((diffDays % ciclo) + ciclo) % ciclo  // módulo positivo (funciona para fechas anteriores al inicio)
  return pos >= diasTrabajo                   // primeros N días = trabajo, el resto = franco
```

---

## 4. Feriados nacionales

- Sólo cuentan los feriados **inamovibles y trasladables** (se pagan al 100% si se trabajan).
  Los "puente" y "no laborables" NO cuentan: valen como día común.
- Fuente: seed offline 2025-2026 hardcodeado (mapa `'YYYY-MM-DD' → nombre`) + actualización
  opcional desde `https://api.argentinadatos.com/v1/feriados/{year}` filtrando
  `tipo ∈ {inamovible, trasladable}`. Cache persistente; el seed garantiza funcionamiento offline.
- API sincrónica: `esFeriadoNacional(fechaMs)` y `nombreFeriado(fechaMs)` (clave por fecha local).

Seed 2026 (referencia): 01-01, 02-16, 02-17, 03-24, 04-02, 04-03, 05-01, 05-25,
06-15 (Güemes trasladado), 06-20, 07-09, 08-17, 10-12, 11-23 (Soberanía trasladado), 12-08, 12-25.

---

## 5. Ventana de ingreso de datos (comportamiento clave)

Al abrir el diálogo para una fecha se computa **contexto externo** (no editable):
- `esFrancoHoy = esFrancoPorDiagrama(fecha)` → muestra chip "Día de Franco" (violeta).
- `esFeriadoHoy = esFeriadoNacional(fecha)` → muestra chip "Feriado nacional · {nombre}" (ámbar).

### 5.1 Estado derivado de los horarios (la regla central)

Todo se **auto-detecta** según si el usuario cargó horarios — no hay botón "franco trabajado" ni "feriado trabajado":

```
hasWork        = entrada && salida          (ambos cargados)
isPartialEntry = (entrada XOR salida)       → entrada incompleta: botón Guardar deshabilitado + error
isDayOff       = !entrada && !salida        → día de ausencia/franco
isFrancoWorked  = esFrancoHoy  && hasWork   → se guarda esFrancoTrabajado=true  (horas al 100%)
isFeriadoWorked = esFeriadoHoy && hasWork   → se guarda esFeriadoTrabajado=true (horas al 100%)
```

Avisos en vivo: "Franco trabajado — horas al 100%" (violeta) y "Feriado trabajado — horas al 100%" (ámbar).

### 5.2 Secciones condicionales del diálogo

- **Lugar de Trabajo**: sólo `Base` / `Campo` (botones). `'Franco'` jamás es opción; se guarda
  automáticamente como `lugarTrabajo='Franco'` cuando `isDayOff`.
- **Tipo de ausencia**: visible SOLO si `isDayOff && !esFrancoHoy` (en un franco programado no
  hace falta justificar nada). Tres opciones mutuamente excluyentes, toggleables (tocar de nuevo
  deselecciona): `Compensatorio` | `Ausencia just.` | `Falta injust.`. Si se elige Falta se
  muestra advertencia: "Se descuenta el día proporcional de básico y se pierde el presentismo".
  Sin selección + sin horas = franco simple.
- **Pernocte / Manejó / Horas de viaje**: visibles SOLO si `!isDayOff && lugar === 'Campo'`.
  Al guardar con `isDayOff` o `lugar='Base'` se fuerzan: `pernocte='NO'`, `maneja=false`, `horasViaje=0`.
  Activar "Manejó" enciende también "Horas de viaje". El toggle de viaje guarda 2 h fijas.
- **Proyecto/Observaciones**: input de texto con autocompletado por proyectos frecuentes; se
  guarda el mismo string en `proyecto` y `observaciones`.

### 5.3 Turno noche y ayudas

- Horarios en pasos de 15 min (snap al cuarto más cercano).
- **Clasificación noche/día** (informativa): es "noche" si el turno cruza la medianoche
  (`salida < entrada` en hora de reloj) o si ≥ 50% de las horas caen en la ventana 21:00–06:00.
  Se muestra chip "Turno noche"/"Turno día"; si cruza, agrega "termina al día siguiente".
- **Turnos que cruzan medianoche**: `minutesBetween` suma 24 h si `salida < entrada` — las horas
  de la madrugada se cuentan TODAS en el día de la entrada. Por eso, al abrir el día siguiente a
  un turno noche, se muestra un recordatorio (auto-oculto a los 5 s): "El día anterior fue turno
  noche (termina HH:MM hoy). Esas horas ya quedaron contadas — no las cargues de nuevo".
- **Reloj sugerido**: si el turno está vacío, se ofrece el horario del último día trabajado
  cargado ("Sugerido (último día): 07:00–19:00 · turno día" + botón "Usar"). No se aplica solo.

### 5.4 Guardado (mapeo exacto)

```ts
{
  entrada/salida: isDayOff ? null : horarios,
  lugarTrabajo: isDayOff ? 'Franco' : lugar,
  pernocte:  (isDayOff || lugar=='Base') ? 'NO' : pernocte,
  maneja:    (isDayOff || lugar=='Base') ? false : maneja,
  horasViaje:(isDayOff || lugar=='Base') ? 0 : (toggleViaje ? 2 : 0),
  esFeriado: esFeriadoHoy,
  esFeriadoTrabajado: isFeriadoWorked,
  esFrancoTrabajado:  isFrancoWorked,
  esFrancoCompensatorio: isDayOff && sub=='COMP',
  esAusenciaJustificada: isDayOff && sub=='AUSENCIA',
  esFaltaInjustificada:  isDayOff && sub=='FALTA',
}
```

---

## 6. Cálculo de horas por día

```ts
esDiaNoTrabajado(reg) = reg.lugarTrabajo=='Franco' && !esFrancoTrabajado && !esFeriadoTrabajado

calcularHorasDia(reg, linea):
  // 1) Día no trabajado o ausencia justificada → 0 en todo
  if (esDiaNoTrabajado(reg) || reg.esAusenciaJustificada) return ceros
  // (Falta injustificada también da 0 h porque no tiene horarios; su efecto es salarial.)

  // 2) Total = turno1 + turno2, con +24h si un turno cruza medianoche
  raw = minutos(entradaInicio→salidaInicio) + minutos(entradaFin→salidaFin)
  almuerzo = (lugarTrabajo=='Base') ? 1 : 0     // 1 h descontada UNA vez por día, sólo en Base
  total = clamp(raw/60 - almuerzo, 0, 16)        // tope 16 h, nunca negativo
  // (réplica exacta de la fórmula de la planilla oficial: MIN(16,(D-C)+(F-E)-base?1:0))

  // 3) Feriado trabajado o Franco trabajado → TODO al 100%
  if (esFeriadoTrabajado || esFrancoTrabajado)
    return { trabajadas: total, normales: 0, al50: 0, al100: total }

  // 4) Línea SBDP en Campo trabajado → SIEMPRE 12 h al 50% fijas, sin normales
  //    (no importa si trabajó 6, 8 o 16 h). Sólo si total > 0. Feriado/franco trabajado ya
  //    salieron por la regla anterior (mantienen el 100%).
  if (linea=='SBDP' && lugarTrabajo=='Campo' && total > 0)
    return { trabajadas: 12, normales: 0, al50: 12, al100: 0 }

  // 5) Día normal: hasta 8 h normales, el excedente al 50%; nunca 100%
  return { trabajadas: total, normales: min(total,8), al50: max(total-8,0), al100: 0 }
```

Resumen de período: suma de normales/50/100 de cada día + `Σ horasViaje` (aparte, no entra en
`totalHorasTrabajadas`).

Etiqueta de tipo por día (prioridad): `Franco Comp.` → `Franco Trab.` → `Feriado Trab.` →
`Falta injust.` → `Feriado` → `Ausencia` → (si nada aplica) el `lugarTrabajo`.

---

## 7. Calendario "pintado": colores de los días

Grilla semanal Lunes-primero. Prioridad de estilo por celda (primera regla que matchea gana):

**Sin registro guardado** (sólo contexto):
| Condición | Color fondo | Label |
|---|---|---|
| Feriado nacional | ámbar (`amber-900/40`) | "Feriado" (texto ámbar; el número del día también va ámbar) |
| Franco por diagrama | gris (`slate-700/30`) | "Franco" (gris tenue) |
| Día común | sin fondo | — |

**Con registro** (orden de prioridad):
| # | Condición | Color | Label |
|---|---|---|---|
| 1 | `esFaltaInjustificada` | rosa (`rose-900/40`) | "Falta" |
| 2 | `esAusenciaJustificada` | rojo (`red-900/40`) | "Ausencia" |
| 3 | `esFeriado` y NO trabajado | ámbar | "Feriado" |
| 4 | `esFrancoCompensatorio` | violeta (`purple-900/40`) | "F.Comp" |
| 5 | `esFrancoTrabajado` | cian (`cyan-900/40`) | "F.Trab" |
| 6 | `esFeriadoTrabajado` | naranja (`orange-900/40`) | "F.Trab" |
| 7 | franco simple (`esDiaNoTrabajado`) | gris | "Franco" |
| 8 | `lugarTrabajo=='Campo'` | verde (`emerald-900/40`) | "Campo" |
| 9 | `lugarTrabajo=='Base'` | azul (`blue-900/40`) | "Base" |

Cada celda muestra además: abreviatura del mes si es día 1, el número del día (blanco si tiene
registro, gris si no, ámbar si feriado sin registro) y las horas trabajadas (`12h`) si > 0.

Interacción: tap abre el diálogo del día; long-press (500 ms, tolerancia de movimiento 10 px)
o click derecho abre el menú contextual (aplicar/borrar).

---

## 8. Modos de pintado por arrastre

Dos modos que reutilizan el mismo gesto: tocar o arrastrar el dedo "pinta" celdas. Un trazo
decide al inicio si pinta o despinta (según el estado del primer día tocado) y no re-togglea
celdas ya tocadas en el mismo trazo. Mientras un modo está activo, el tap normal y el long-press
se deshabilitan y se bloquea el scroll (`touch-action: none`).

- **Aplicar a otro día**: se elige un día origen (anillo celeste `sky-400`); los días pintados
  como destino llevan anillo verde (`emerald-400`), o **ámbar** (`amber-400`) si ya tenían datos
  (aviso de sobrescritura). El origen no se puede pintar. Al confirmar, se copia el registro del
  origen a cada destino (con nueva fecha/id) y cada celda aplicada reproduce una animación de pulso.
- **Borrar días**: sólo se pueden pintar días **con datos** (los vacíos se atenúan al 30% y no
  responden). Seleccionados con anillo rojo (`red-400`); al confirmar se borran con pulso rojo.

---

## 9. Checklist de porteo

1. Modelo `RegistroHoras` + settings (`diagrama`, `diagramaInicioMs`, `lineaTrabajo`).
2. Período 21→20 con default según día ≥ 21.
3. `esFrancoPorDiagrama` (4 patrones, módulo positivo).
4. Feriados: seed + filtro inamovible/trasladable (API opcional).
5. Diálogo: auto-detección por horarios (5.1), secciones condicionales (5.2), guardado (5.4).
6. Turno noche: suma overnight, clasificación 21–06, recordatorio día siguiente, sugerencia.
7. `calcularHorasDia` con regla SBDP y almuerzo en Base.
8. Colores/labels del calendario con el orden de prioridad de §7.
9. (Opcional) modos de pintado "aplicar" y "borrar".
