# Planilla de Horas — Documentación del Módulo

## Descripción General

**Planilla de Horas** es un módulo de registro y seguimiento de horas de trabajo para empleados de campo. Permite registrar jornadas laborales diarias, calcular horas extras según el convenio CCT 637/11, exportar planillas mensuales a Excel, y proyectar el sueldo estimado del período.

La planilla opera con un **período de 21 a 20** (del día 21 del mes anterior al 20 del mes actual), alineado con el ciclo de liquidación salarial.

---

## Estructura de Archivos

```
planilla de horas/
├── DOCUMENTACION.md              ← Este archivo
├── src/
│   ├── screens/
│   │   ├── HorasTrabajoScreen.kt       ← Pantalla principal (calendario + registros)
│   │   ├── HorasTrabajoViewModel.kt    ← ViewModel con lógica de estado
│   │   ├── RegistroHorasDialog.kt      ← Diálogo para crear / editar un registro
│   │   └── HorasAnalyticsScreen.kt     ← Pantalla de proyección salarial y estadísticas
│   ├── data/
│   │   ├── HorasTrabajoEntity.kt       ← Entidad Room (tabla horas_trabajo)
│   │   ├── HorasTrabajoDao.kt          ← DAO Room con queries de acceso a datos
│   │   └── HorasTrabajoRepository.kt   ← Repositorio (capa de abstracción sobre el DAO)
│   ├── utils/
│   │   ├── CalculoSalarialUtil.kt      ← Motor de cálculo salarial (CCT 637/11)
│   │   └── ExcelHorasGenerator.kt      ← Generador de Excel desde template .xlsx
│   └── theme/
│       └── Color.kt                    ← Paleta de colores del tema
```

---

## Pantallas

### 1. HorasTrabajoScreen (Pantalla Principal)

La pantalla principal muestra:

- **Selector de mes/período**: Navegación entre meses con flechas ← →
- **Tarjetas resumen**: Días activos y horas totales del período
- **Calendario interactivo**: Cuadrícula de días del 21 al 20, codificados por color:
  - 🟢 **Verde**: Día trabajado (muestra horas totales)
  - 🟠 **Naranja**: Franco compensatorio
  - 🔴 **Rojo/Rosa**: Franco normal
  - 🔵 **Azul**: Franco trabajado (fin de semana con trabajo)
  - ⬜ **Vacío**: Sin registro
- **Registros detallados** (expandible): Lista cronológica de cada registro con detalles
- **FAB**: Botón flotante para agregar nuevo registro
- **Acciones de barra superior**:
  - 📊 Ir a Analytics/Proyección salarial
  - 📥 Exportar a Excel
  - 📋 Historial de exportaciones

### 2. RegistroHorasDialog (Formulario de Registro)

Diálogo modal de pantalla completa para crear o editar un registro diario:

| Campo | Descripción |
|-------|-------------|
| **Fecha** | Seleccionable con DatePicker |
| **Primer Turno** | Entrada y salida (HH:mm con redondeo a 15 min) |
| **Segundo Turno** | Entrada y salida (opcional, para jornadas partidas) |
| **Lugar de Trabajo** | Base / Campo / Franco |
| **Pernocte** | NO / Hotel / Trailer (solo en Campo) |
| **Maneja** | Switch — si manejó ese día (solo en Campo) |
| **Horas de viaje** | Switch — si aplica viáticos de viaje |
| **Franco trabajado** | Automático para fines de semana con horas cargadas (100% extra) |
| **Feriado** | Switch manual para días no hábiles |
| **Franco compensatorio** | Para pedir un día libre compensando guardia de fin de semana |
| **Observaciones** | Texto libre con autocompletado de nombres de proyecto activo |

**Lógica inteligente**:
- Si seleccionás "Franco", automáticamente limpia los horarios y los switches
- Si es fin de semana y cargás horas, marca "Franco Trabajado" automáticamente
- Si un turno cruza medianoche (ej: 19:00-07:00), se parte automáticamente en 2 turnos
- El campo Observaciones sugiere proyectos activos cuando el lugar es "Campo"

### 3. HorasAnalyticsScreen (Proyección Salarial)

Pantalla de análisis financiero que muestra:

- **Hero Card**: Neto estimado del período (valor promedio por hora + total de horas)
- **Mini Cards**: Desglose de horas por tipo: Normales, 50%, 100%, Viaje
- **Gráficos Donut**: Base vs Campo / Normal vs Extra
- **Francos compensatorios disponibles**: Balance global (ganados − usados)
- **Desglose salarial expandible**:
  1. Conceptos Fijos (básico + antigüedad + actas)
  2. Conceptos Variables (extras + viaje + desarraigo)
  3. No Remunerativos (viandas + desayuno + Vaca Muerta)
  4. Retenciones (Jubilación + PAMI + OS + Ganancias)

- **Configuración**: Permite ajustar el sueldo básico vigente (persiste en DataStore)

---

## Modelo de Datos

### HorasTrabajoEntity (tabla `horas_trabajo`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | String (PK) | UUID |
| `fechaMs` | Long | Fecha del registro en millis |
| `entradaInicioMs` | Long? | Hora de entrada turno 1 |
| `salidaInicioMs` | Long? | Hora de salida turno 1 |
| `entradaFinMs` | Long? | Hora de entrada turno 2 |
| `salidaFinMs` | Long? | Hora de salida turno 2 |
| `lugarTrabajo` | String | "Base", "Campo", "Franco" |
| `pernocte` | String | "NO", "Hotel", "Trailer" |
| `maneja` | Boolean | Si manejó ese día |
| `horasViaje` | Double | Horas de viaje (default 2.0 si aplica) |
| `observaciones` | String | Notas libres / nombre de proyecto |
| `esFeriado` | Boolean | Si es día feriado nacional |
| `esFrancoCompensatorio` | Boolean | Si usó un franco compensatorio |
| `esFrancoTrabajado` | Boolean | Si trabajó en día franco (100%) |
| `sincronizado` | Boolean | Flag de sincronización |

---

## Motor de Cálculo Salarial (CalculoSalarialUtil)

Implementa las reglas del **Convenio Colectivo de Trabajo 637/11** (Petroleros):

### Clasificación de horas por día:

| Condición | Normales | Extra 50% | Extra 100% |
|-----------|----------|-----------|------------|
| Día hábil ≤8h | Todas | — | — |
| Día hábil 9-12h | 8h | Excedente | — |
| Día hábil >12h | 8h | 4h | Excedente |
| Feriado / Fin de semana | — | — | Todas |

### Reglas especiales:
- **Base**: Se descuenta 1 hora de almuerzo automáticamente
- **Campo + Maneja**: Las horas de viaje se suman a la jornada laboral
- **Campo + No maneja**: Las horas de viaje se pagan al 47% de la hora base
- **Cap máximo**: 16 horas por día según convenio

### Componentes del sueldo:

1. **Fijos**: Básico + Antigüedad (2 años) + Presentismo + Bono Paz + Adicional Torre + Actas
2. **Variables**: Extras 50% + Extras 100% + Viaje + Desarraigo por pernocte
3. **No Remunerativos**: Viandas + Desayuno + Vaca Muerta + Acuerdos
4. **Retenciones**: ~24.62% (Jubilación 11%, PAMI 3%, OS 3%, Sindical 2.65%, Mutual 3.97%) + Ganancias ~1.8%

### Feriados precargados:
Argentina 2025-2026 cargados en `feriadosArgentina`. Se pueden actualizar editando el set.

---

## Exportación Excel (ExcelHorasGenerator)

Genera un archivo `.xlsx` basado en un template (`assets/template_horas.xlsx`), escribiendo:

- **Celda de mes** (Row 7, Col C): "mesAnterior-mesActual año"
- **Filas de datos** (desde Row 12): Una fila por día del período (21 al 20)
- **Columnas**: Fecha | Entrada1 | Salida1 | Entrada2 | Salida2 | Horas | Viaje | Lugar | Hotel | Trailer | Casa | Maneja | Obs

El archivo se guarda en `Documents/` con nombre: `Planilla de horas Vazquez Nicolas (mes1 - mes2 - año).xlsx`

**Funciones auxiliares**:
- `getExportedFiles()` — Lista planillas exportadas previamente
- `deleteExportedFile()` — Elimina una planilla exportada

---

## Dependencias Tecnológicas

| Librería | Uso |
|----------|-----|
| **Jetpack Compose** | UI declarativa (Material3) |
| **Room** | Persistencia local (SQLite) |
| **Hilt** | Inyección de dependencias (ViewModel) |
| **DataStore** | Preferencias de sueldo básico |
| **Apache POI** | Lectura/escritura de archivos .xlsx |
| **Kotlin Coroutines + Flow** | Operaciones asíncronas y streams de datos |

### Dependencias Gradle necesarias:

```groovy
// Room
implementation "androidx.room:room-runtime:2.6.1"
implementation "androidx.room:room-ktx:2.6.1"
kapt "androidx.room:room-compiler:2.6.1"

// Hilt
implementation "com.google.dagger:hilt-android:2.50"
kapt "com.google.dagger:hilt-android-compiler:2.50"
implementation "androidx.hilt:hilt-navigation-compose:1.1.0"

// DataStore
implementation "androidx.datastore:datastore-preferences:1.0.0"

// Apache POI (Excel)
implementation "org.apache.poi:poi:5.2.5"
implementation "org.apache.poi:poi-ooxml:5.2.5"

// Compose
implementation platform("androidx.compose:compose-bom:2024.02.00")
implementation "androidx.compose.material3:material3"
implementation "androidx.lifecycle:lifecycle-runtime-compose:2.7.0"
```

---

## Flujo de Navegación

```
HorasTrabajoScreen ─── (+) FAB ──────────► RegistroHorasDialog
       │                                         │
       │── 📊 Analytics ──► HorasAnalyticsScreen  │
       │── 📥 Exportar ───► ExcelHorasGenerator   │
       │── 📋 Historial ──► HistorialDialog        │
       │                                         │
       ◄──── Tap día calendario ──────────────────┘
       ◄──── Tap registro detallado ──────────────┘
```

---

## Notas para Integración Standalone

Para usar este módulo como app independiente, se necesita:

1. **Crear un proyecto Android Compose** con el setup de Room + Hilt estándar
2. **Copiar los archivos `src/`** al paquete correspondiente
3. **Crear la base de datos Room** con la entity `HorasTrabajoEntity`
4. **Agregar el template Excel** (`template_horas.xlsx`) en la carpeta `assets/`
5. **Registrar el FileProvider** en `AndroidManifest.xml` para compartir archivos
6. **Agregar la navegación** entre `HorasTrabajoScreen` y `HorasAnalyticsScreen`

El módulo tiene una sola dependencia externa al sistema principal: `TrabajoRepository` para sugerir nombres de proyectos activos en el campo de observaciones. Si no se usa esta funcionalidad, se puede reemplazar por una lista vacía fija.
