# CCT PETROLEROS — ESPECIFICACIÓN COMPLETA PARA IMPLEMENTACIÓN
## CCT 644/12 Petroleros Privados + CCT 637/11 Petroleros Jerárquicos
### Jurisdicción: Neuquén, Río Negro y La Pampa

**Versión:** 1.0  
**Fecha:** Marzo 2025  
**Fuentes:** Textos convencionales homologados + Actas paritarias 2024/2025  
**Uso:** Instrucción para agente de IA — seed de base de datos y motor de cálculo

> ⚠️ **IMPORTANTE PARA EL AGENTE:** Los montos en pesos ($) cambian con cada paritaria.
> Todos los valores monetarios deben cargarse en la tabla `conceptos_valores` con `vigente_desde`
> y `vigente_hasta`, nunca hardcodeados. Los que figuren aquí son los vigentes a la fecha de
> este documento (marzo 2025) y deben poder actualizarse desde el panel de RRHH/ADMIN sin tocar código.

---

## ÍNDICE

1. [CCT 644/12 — Petroleros Privados Neuquén](#1-cct-64412--petroleros-privados-neuquén)
2. [CCT 637/11 — Petroleros Jerárquicos Neuquén](#2-cct-63711--petroleros-jerárquicos-neuquén)
3. [Paritaria vigente (ambos CCT)](#3-paritaria-vigente-ambos-cct)
4. [Retenciones y aportes (ambos CCT)](#4-retenciones-y-aportes-ambos-cct)
5. [Motor de cálculo — diferencias entre CCT](#5-motor-de-cálculo--diferencias-entre-cct)
6. [Seed SQL completo para la base de datos](#6-seed-sql-completo-para-la-base-de-datos)
7. [Feriados especiales petroleros](#7-feriados-especiales-petroleros)
8. [Reglas de implementación para el agente](#8-reglas-de-implementación-para-el-agente)

---

## 1. CCT 644/12 — PETROLEROS PRIVADOS NEUQUÉN

### 1.1 Datos generales

| Campo | Valor |
|---|---|
| Número CCT | 644/12 |
| Nombre | Petroleros Privados Neuquén, Río Negro y La Pampa |
| Sindicato | Sindicato de Petróleo y Gas Privado de Río Negro, Neuquén y La Pampa |
| Cámaras empleadoras | CEPH (Cámara de Exploración y Producción de Hidrocarburos) + CEOPE (Cámara de Empresas de Operaciones Petroleras Especiales) |
| Jurisdicción | Provincias de Neuquén, Río Negro y La Pampa |
| Actividad | Perforación, terminación, reparación, intervención, producción, movimiento de suelos, ecología, operaciones especiales, exploración geofísica |
| Personal comprendido | Todo el personal en relación de dependencia NO jerárquico |
| Período paritario vigente | Abril 2025 a Marzo 2026 |

### 1.2 Estructura del convenio — Títulos

El CCT 644/12 se organiza en cuatro títulos que definen categorías y reglas diferentes:

| Título | Nombre | Tipo de trabajo | Jornada |
|---|---|---|---|
| Título I | General | Disposiciones comunes | — |
| Título II | Producción y Mantenimiento | Tareas operativas de producción en yacimiento | D (diurna) o Y (yacimiento) |
| Título III | Operaciones Especiales | Perforación, terminación, reparación, well testing, fractura, wireline | D o S (especiales) |
| Título IV | Exploración Geofísica y otros | Geofísica, movimiento de suelos | Específica |

### 1.3 Tipos de jornada y adicionales de turno

| Código | Nombre | Adicional sobre básico | Descripción |
|---|---|---|---|
| D | Jornada Diurna | 0% | No excede 8 horas diarias / 48 semanales |
| Y | Jornada Yacimiento | — | Tareas operativas de producción en campo |
| A | Turno A | 33% sobre básico | Régimen de turnos rotativos cubriendo 24 horas |
| B | Turno B | 22% sobre básico | Turnos sin cubrir 24h o semana no calendario con fines de semana |
| S | Turno S | 33% sobre básico | Operaciones especiales con tareas operativas en campo |

**Adicional yacimiento:** 5% sobre el sueldo básico. Solo para trabajadores que presten habitualmente tareas operativas de producción en el campo (jornada Y).

### 1.4 Categorías — Título II (Producción y Mantenimiento)

Las categorías se expresan en letras de A (mayor) a F o similar, con subcategorías numérica. Los montos exactos están en la planilla salarial del CCT actualizada por paritaria.

| Código | Descripción de categoría | Nivel |
|---|---|---|
| II-A1 | Oficial Especializado 1ra A | Máxima calificación técnica |
| II-A2 | Oficial Especializado 1ra B | |
| II-B1 | Oficial 2da A | |
| II-B2 | Oficial 2da B | |
| II-C1 | Oficial 3ra A | |
| II-C2 | Oficial 3ra B | |
| II-D | Medio Oficial | |
| II-E | Ayudante / Peón Especializado | |
| II-F | Ayudante General | Mínima calificación |

> **Nota para el agente:** Los nombres exactos de las categorías del Título II deben cargarse según la planilla oficial del CCT 644/12 vigente. Las denominaciones anteriores son representativas. Implementar como registros en `categorias` con `convenio_id` apuntando al CCT 644/12.

### 1.5 Categorías — Título III (Operaciones Especiales)

El Título III cubre: Perforación, Terminación, Reparación/Pulling, Well Testing, Fractura Hidráulica, Wireline, Cementación, Mud Logging, Workover.

| Código | Descripción | Nivel |
|---|---|---|
| III-A | Operador Principal / Jefe de Equipo | Máximo |
| III-B | Operador 1ro / Técnico Principal | |
| III-C | Operador 2do / Técnico | |
| III-D | Asistente de Operaciones | |
| III-E | Ayudante de Operaciones | |
| III-F | Ayudante General Especial | Mínimo |

### 1.6 Zona no convencional — Vaca Muerta

**Adicional zona no convencional:** Se aplica a trabajadores que presten servicios en yacimientos no convencionales (shale/tight), incluyendo Vaca Muerta.

| Período | Porcentaje sobre básico |
|---|---|
| Hasta sept 2025 | 80% |
| Desde oct 2025 | 85% |

Este adicional se llama "Zona No Convencional" o "ZNC" y se suma al básico antes de calcular el resto de los adicionales porcentuales.

### 1.7 Conceptos remunerativos fijos — CCT 644/12

| Código | Nombre | Base de cálculo | Porcentaje / Monto | Tipo |
|---|---|---|---|---|
| BASICO_PP | Sueldo Básico | — | Planilla CCT vigente por categoría | REMUNERATIVO_FIJO |
| TURNO_A | Adicional Turno A | Básico | 33% | REMUNERATIVO_FIJO |
| TURNO_B | Adicional Turno B | Básico | 22% | REMUNERATIVO_FIJO |
| TURNO_S | Adicional Turno S | Básico | 33% | REMUNERATIVO_FIJO |
| ZNC_80 | Zona No Convencional (Vaca Muerta) | Básico | 85% (vigente oct 2025) | REMUNERATIVO_FIJO |
| ADICIONAL_YAC | Adicional Yacimiento | Básico | 5% | REMUNERATIVO_FIJO |
| ANTIGUEDAD_PP | Antigüedad | Básico | 1% por año de antigüedad | REMUNERATIVO_FIJO |
| PRESENTISMO_PP | Presentismo | Total remun. normales y habituales | 6% | REMUNERATIVO_FIJO |
| BONO_PAZ_PP | Bono Paz Social | — | Planilla CCT vigente | REMUNERATIVO_FIJO |
| ADICIONAL_DISPONIB | Adicional Disponibilidad | — | Planilla CCT vigente | REMUNERATIVO_FIJO |

### 1.8 Conceptos remunerativos variables — CCT 644/12

| Código | Nombre | Cálculo | Tipo |
|---|---|---|---|
| HRAS_EXTRA_50_PP | Horas Extra 50% | (Básico / 192) × 1.5 × cantidad_horas | REMUNERATIVO_VARIABLE |
| HRAS_EXTRA_100_PP | Horas Extra 100% | (Básico / 192) × 2.0 × cantidad_horas | REMUNERATIVO_VARIABLE |
| HRAS_VIAJE_PP | Horas de Viaje (no maneja) | (Básico / 192) × 0.47 × cantidad_horas | REMUNERATIVO_VARIABLE |
| GUARDIA_PASIVA | Guardia Pasiva | (Básico / 192) × porcentaje_convenio | REMUNERATIVO_VARIABLE |
| DESARRAIGO_PP | Desarraigo / Pernocte | Monto por día según tipo (hotel/trailer) | REMUNERATIVO_VARIABLE |
| MANEJO_PP | Adicional por Manejo en Campo | Monto por día | REMUNERATIVO_VARIABLE |

### 1.9 Conceptos no remunerativos — CCT 644/12

| Código | Nombre | Cálculo | Vigente desde | Notas |
|---|---|---|---|---|
| VIANDA_PP | Vianda / Ayuda Alimentaria | Monto por día en campo | Oct 2024 | Art. 34 CCT 644/12 |
| AVC_FIJA_PP | Asignación Vianda Complementaria — Fija | Monto fijo mensual | Ene 2025 | Reintegro ganancias |
| AVC_VAR_PP | Asignación Vianda Complementaria — Variable | % del impuesto a las ganancias | Vigente | Tít II: 100% sin límite; Tít III: hasta tope |
| DESAYUNO_PP | Desayuno / Merienda | Monto por día | Vigente | |
| CONTRIB_SIND_EXT | Contribución Extraordinaria Sindical | Por trabajador, cuotas | Según acta | Pagado por empresa al sindicato |
| SEGURO_VIDA_PP | Seguro de Vida Colectivo | Mensual, a cargo empleador | Oct 2025 | Art. 24 bis CCT 644/12 |

**Valores vigentes AVC (referencia marzo 2025 — ACTUALIZAR vía ADMIN):**
- Componente fijo: $300.000/mes (vigente desde ene/feb 2025) + $140.000 de suba = **$440.000/mes total fijo** (desde mar/abr 2025)
- Componente variable: Según liquidación de Impuesto a las Ganancias de cada trabajador

### 1.10 Reglas especiales CCT 644/12

**Jornada máxima:** No está explícitamente limitada en el CCT a 16 horas, pero la empresa_config mantiene el máximo configurable.

**Turno rotativo / diagrama 2×1:** El acta de 2024 ratifica el diagrama 2×1 en modalidad máxima de 8×4 para equipo de perforación.

**Multiplicidad de tareas:** El personal desarrollará únicamente las tareas propias de su especialidad.

**Día del Petróleo:** 13 de diciembre — no laborable y pago. Se agrega automáticamente como feriado.

**Contratos a demanda (on call):** Erradicados según acta de 2022. No se permite este tipo de contrato.

**Jubilación:** Al jubilarse, el trabajador recibe una gratificación de 13 sueldos calculada como Art. 245 LCT, pagada 30 días corridos después de la baja.

---

## 2. CCT 637/11 — PETROLEROS JERÁRQUICOS NEUQUÉN

### 2.1 Datos generales

| Campo | Valor |
|---|---|
| Número CCT | 637/11 |
| Nombre | Petroleros Jerárquicos — Personal Jerárquico y Profesional — Neuquén, Río Negro y La Pampa |
| Sindicato | Sindicato del Personal Jerárquico y Profesional del Petróleo y Gas Privado de Neuquén, Río Negro y La Pampa (Sec. Gral.: Manuel Arévalo) |
| Cámaras empleadoras | CEPH + CEOPE |
| Jurisdicción | Neuquén, Río Negro y La Pampa |
| Actividad | Igual que 644/12 — pero para personal idóneo, jerárquico y profesional |
| Personal comprendido | Personal jerárquico, idóneo y profesional de la industria hidrocarburífera |
| Excluidos | "Superintendente" cuando es la más alta autoridad en su especialidad (conflicto de intereses) |
| Período paritario vigente | Abril 2025 a Marzo 2026 |

### 2.2 Día del gremio

**12 de agosto** — "Día del Petrolero Jerárquico y Profesional". Instaurado en conmemoración al 12 de agosto del año 2000, fecha de fundación del sindicato. Se comporta como feriado del sector.

### 2.3 Grilla de posiciones — Anexo I CCT 637/11

El CCT 637/11 usa una grilla de posiciones (roles) en lugar de categorías alfanuméricas. Estas posiciones están homologadas en el Acuerdo 76/12 (Resolución ST 522/2012).

#### Posiciones de Producción y Mantenimiento

| Código | Posición |
|---|---|
| PJ-PM-01 | Administrador de Personal |
| PJ-PM-02 | Administrador de Recursos Humanos |
| PJ-PM-03 | Analista de Recursos Humanos |
| PJ-PM-04 | Asistente de Gerencia |
| PJ-PM-05 | Asistente Técnico Calibrador de Instrumentos |
| PJ-PM-06 | Asistente Técnico en Perforación |
| PJ-PM-07 | Asistente Técnico en Terminación |
| PJ-PM-08 | Calculista de Instalaciones |
| PJ-PM-09 | Company Man de Perforación |
| PJ-PM-10 | Company Man de Pulling / Workover |
| PJ-PM-11 | Company Man de Terminación |
| PJ-PM-12 | Comprador |
| PJ-PM-13 | Contador Analista |
| PJ-PM-14 | Coordinador de Calidad y Medio Ambiente |
| PJ-PM-15 | Coordinador de Despacho de Almacenes |
| PJ-PM-16 | Coordinador de Instalaciones de Superficie |
| PJ-PM-17 | Coordinador de Operaciones |
| PJ-PM-18 | Coordinador de Operaciones de Mantenimiento |
| PJ-PM-19 | Coordinador de Producción |
| PJ-PM-20 | Coordinador de Seguridad e Higiene |
| PJ-PM-21 | Coordinador de Transporte |
| PJ-PM-22 | Coordinador de Turno |
| PJ-PM-23 | Coordinador Operativo / Encargado de Operadores de Estaciones de Compresión |
| PJ-PM-24 | Diseñador / Proyectista CAD |
| PJ-PM-25 | Encargado de Almacén |
| PJ-PM-26 | Encargado de Mantenimiento |
| PJ-PM-27 | Encargado de Turno / Jefe de Turno |
| PJ-PM-28 | Enfermero / Paramédico |
| PJ-PM-29 | Geólogo de Yacimiento |
| PJ-PM-30 | Ingeniero de Campo |
| PJ-PM-31 | Jefe de Base |
| PJ-PM-32 | Jefe de Equipo (Torre) |
| PJ-PM-33 | Jefe de Instalaciones |
| PJ-PM-34 | Jefe de Mantenimiento |
| PJ-PM-35 | Jefe de Perforación |
| PJ-PM-36 | Jefe de Producción |
| PJ-PM-37 | Jefe de Seguridad e Higiene |
| PJ-PM-38 | Médico |
| PJ-PM-39 | Supervisor de Campo |
| PJ-PM-40 | Supervisor de Mantenimiento |
| PJ-PM-41 | Supervisor de Operaciones |
| PJ-PM-42 | Supervisor de Perforación |
| PJ-PM-43 | Supervisor de Producción |
| PJ-PM-44 | Supervisor de Seguridad e Higiene |
| PJ-PM-45 | Supervisor de Turno |
| PJ-PM-46 | Técnico Analista |
| PJ-PM-47 | Técnico de Mantenimiento Especializado |
| PJ-PM-48 | Técnico de Producción |
| PJ-PM-49 | Técnico en Instrumentación |
| PJ-PM-50 | Técnico en Mecánica |
| PJ-PM-51 | Técnico en Sistemas |

#### Posiciones de Operaciones Especiales

| Código | Posición |
|---|---|
| PJ-OE-01 | Coordinador de Operaciones Especiales |
| PJ-OE-02 | Jefe de Equipo de Fractura |
| PJ-OE-03 | Jefe de Equipo de Well Testing |
| PJ-OE-04 | Jefe de Equipo de Wireline |
| PJ-OE-05 | Jefe de Equipo de Cementación |
| PJ-OE-06 | Jefe de Equipo de Coiled Tubing |
| PJ-OE-07 | Jefe de Equipo de Mud Logging |
| PJ-OE-08 | Supervisor de Fractura |
| PJ-OE-09 | Supervisor de Well Testing |
| PJ-OE-10 | Supervisor de Wireline |
| PJ-OE-11 | Supervisor de Cementación |
| PJ-OE-12 | Técnico de Fractura |
| PJ-OE-13 | Técnico de Well Testing |
| PJ-OE-14 | Técnico de Wireline |
| PJ-OE-15 | Técnico de Mud Logging |
| PJ-OE-16 | Técnico de Cementación |
| PJ-OE-17 | Técnico de Coiled Tubing |
| PJ-OE-18 | Técnico de END (Ensayos No Destructivos) |
| PJ-OE-19 | Coordinador de Seguridad e Higiene (OOEE) |
| PJ-OE-20 | Técnico en Seguridad e Higiene (OOEE) |

### 2.4 Categorías del CCT 637/11

A diferencia del 644/12, el CCT 637/11 organiza las posiciones en bandas de categoría que determinan el salario. Las bandas son:

| Categoría | Nivel | Descripción |
|---|---|---|
| JER-A | Superior | Jefes y Coordinadores de área / Supervisores senior |
| JER-B | Avanzado | Supervisores / Técnicos especializados senior |
| JER-C | Intermedio | Técnicos calificados / Company Man / Encargados |
| JER-D | Inicial | Asistentes técnicos / Técnicos junior |

> **Nota para el agente:** Cada posición de la grilla se ubica en una de estas 4 bandas. La banda determina el básico. Implementar en `categorias` con `codigo` = la banda (JER-A, JER-B, etc.) y un campo adicional `posicion_descripcion` en el perfil del usuario para registrar la posición específica dentro de la banda.

### 2.5 Conceptos remunerativos fijos — CCT 637/11

| Código | Nombre | Base de cálculo | Porcentaje / Monto | Notas |
|---|---|---|---|---|
| BASICO_PJ | Sueldo Básico Jerárquico | — | Planilla CCT 637/11 por categoría | Escala propia, superior al 644/12 |
| TURNO_A_PJ | Adicional Turno A | Básico PJ | 33% | Igual mecánica que PP |
| TURNO_B_PJ | Adicional Turno B | Básico PJ | 22% | |
| ZNC_PJ | Zona No Convencional (Vaca Muerta) | Básico PJ | Derivado del ZNC de PP | Art. 63: solapamiento salarial |
| ANTIGUEDAD_PJ | Antigüedad | Básico PJ | 1% por año | |
| PRESENTISMO_PJ | Presentismo | Total remun. normales y habituales | 6% | |
| BONO_PAZ_PJ | Bono Paz Social | — | Planilla CCT vigente | |
| ADICIONAL_PERS_8H | Adicional Personal 8 Horas | — | Planilla CCT vigente | Específico PJ — ver nota |
| BONO_CAMPO_PJ | Bono Campo | — | Planilla CCT vigente | Mencionado en actas 2017 |
| FUN_JERARQUICA | Adicional Función Jerárquica | Básico PJ | % por nivel de jefatura | Configurable por categoría |

> **Adicional Personal 8hs:** Es un concepto específico del CCT 637/11. Se devenga por las horas que el personal jerárquico trabaja en jornada especial de 8 horas. El CCT estableció una mesa técnica para homogeneizar su liquidación (comenzando por Jefes de Equipo Torre). Implementar como concepto configurable hasta que se conozca el valor exacto actualizado.

> **Solapamiento salarial (Art. 63):** El CCT 637/11 garantiza que el personal jerárquico siempre gane más que el personal privado que supervisa. Si el salario de un privado supera al del jerárquico, la empresa debe actualizar el básico del jerárquico para mantener la consistencia. Implementar como validación en el motor salarial.

### 2.6 Conceptos remunerativos variables — CCT 637/11

| Código | Nombre | Cálculo | Notas |
|---|---|---|---|
| HRAS_EXTRA_50_PJ | Horas Extra 50% | (Básico PJ / 192) × 1.5 × hs | Se está homogeneizando con mesa técnica |
| HRAS_EXTRA_100_PJ | Horas Extra 100% | (Básico PJ / 192) × 2.0 × hs | |
| GUARDIA_PASIVA_PJ | Guardia Pasiva | Porcentaje por hora | Para médicos/enfermeros en yacimiento |
| DESARRAIGO_PJ | Desarraigo | Monto por día campo | |

> **Nota sobre horas extras PJ:** El sindicato acordó con las empresas una mesa técnica de 60 días para homogeneizar cómo se liquidan las horas extras de los jerárquicos. Hay empresas que aún no las liquidan correctamente. El sistema debe permitir registrar y calcular las horas extras para todos los jerárquicos aunque la empresa no las haya liquidado previamente.

### 2.7 Conceptos no remunerativos — CCT 637/11

| Código | Nombre | Descripción | Vigente desde |
|---|---|---|---|
| VIANDA_PJ | Vianda Campo | Monto por día en campo | Vigente |
| AVC_FIJA_PJ | Asignación Vianda Compl. — Fija | $440.000/mes total (igual que PP, desde abr 2025) | Mar 2025 |
| AVC_VAR_PJ | Asignación Vianda Compl. — Variable | Reintegro 50% del impuesto a ganancias hasta tope | Vigente |
| CONTRIB_SIND_PJ | Contribución Sindical Extraordinaria | $55.000 por trabajador (jun 2025) | Jun 2025 |

**Diferencia clave AVC entre CCT:**
- **CCT 644/12 Privados Tít. II:** Reintegra el 100% del impuesto a las ganancias sin límite
- **CCT 644/12 Privados Tít. III:** Reintegra hasta un tope
- **CCT 637/11 Jerárquicos:** Reintegra el 50% del impuesto hasta un tope (actualizable)

### 2.8 Reglas especiales CCT 637/11

**Período de evaluación:** Antes del período de evaluación, las empresas deben informar a los trabajadores los sistemas formales y criterios objetivos de evaluación de desempeño.

**Dotaciones mínimas:** Las empresas deben contar con dotaciones suficientes del personal jerárquico en cada instalación, respetando períodos de descanso.

**Well service / Fractura:** Al menos 1 Supervisor de Seguridad e Higiene + 1 Coordinador de Operaciones por equipo (según acta 2017).

**Médicos y enfermeros:** Si descansan en yacimiento y son convocados fuera de su jornada, devengan guardia pasiva.

**Servicio de dirección (direccional):** Diagrama 1×1 acordado exclusivamente para servicio direccional.

---

## 3. PARITARIA VIGENTE (AMBOS CCT)

### 3.1 Paritaria Abril 2025 — Marzo 2026

Firmada el 3 y 4 de junio de 2025 entre CEPH, Sindicato Jerárquico y Sindicato Privados (Neuquén, Río Negro y La Pampa).

| Concepto | Detalle | Fecha |
|---|---|---|
| **Aumento paritario 2025/2026** | **12% mensual acumulativo** sobre base enero 2025 | Abril 2025 en adelante |
| Gratificación NR de cierre | 4.3% mensual (base enero 2025) por única vez | Haberes abril 2025 (pagada con haberes marzo 2025) |
| **AVC Fija — suba** | +$140.000 (componente fijo sube a $440.000 total) | Desde marzo 2025 |
| Contribución sindical extraordinaria | $55.000 por trabajador | Pago junio 2025 |

### 3.2 Historial paritario reciente (para cargar en conceptos_valores)

| Período paritario | Incremento remunerativo | Base |
|---|---|---|
| Abr 2023 → Mar 2024 | +287.5% (IPC acumulado) → ajuste 69.1% en abr24 | Base abr 2023 |
| Abr 2024 → Mar 2025 | +6% SNR sep-nov24 → rem dic24 + 6% SNR dic24 → rem ene25 + 4.3% cierre | Base abr 2024 |
| Abr 2025 → Mar 2026 | +12% mensual acumulativo | Base ene 2025 |

> **Para el agente:** Cargar estos incrementos como registros en `conceptos_valores` con sus fechas de vigencia. El motor salarial debe seleccionar automáticamente el valor vigente para el período que se está calculando.

### 3.3 AVC — Historial de valores (componente fijo)

| Período | Monto fijo mensual |
|---|---|
| Hasta sept 2024 | Según acta anterior |
| Oct – dic 2024 | $365.960 (Privados NQN) |
| Ene – feb 2025 | $300.000 (nueva base fija acordada) |
| Desde mar 2025 | $440.000 ($300.000 + suba de $140.000) |

---

## 4. RETENCIONES Y APORTES (AMBOS CCT)

Las retenciones son idénticas para ambos convenios:

### 4.1 Aportes del trabajador (sobre remunerativo)

| Código | Concepto | Porcentaje | Base |
|---|---|---|---|
| JUB | Jubilación (SIJP) | 11% | Total remunerativo |
| LEY19032 | PAMI (Ley 19.032) | 3% | Total remunerativo |
| OS | Obra Social | 3% | Total remunerativo |
| SIND | Cuota Sindical | 2% | Total remunerativo |
| MUTUAL | Mutual | Según acta vigente | Total remunerativo |
| GANANCIAS | Impuesto a las Ganancias 4ta categ. | Tabla progresiva AFIP | Remunerativo neto de deducciones |

> **Cuota sindical:** El porcentaje exacto varía entre 2% y 2.65% según el acta vigente. Implementar como concepto configurable.

> **Mutual:** El porcentaje varía (históricamente ~3.97%). Implementar como concepto configurable.

### 4.2 Contribuciones del empleador (sobre remunerativo del trabajador)

| Concepto | Porcentaje | Base |
|---|---|---|
| Contribución Jubilación empleador | 16% | Total remunerativo |
| PAMI empleador | 2% | Total remunerativo |
| Obra Social empleador | 6% | Total remunerativo |
| ART | Variable | Según contrato ART |
| Contribución Sindical empleador | 2% o según acta | Total remunerativo |

> **Nota:** Las contribuciones del empleador no aparecen en el recibo del trabajador pero son útiles para el dashboard de costos laborales del GERENTE/RRHH.

### 4.3 Exención Ley 26.176 (horas extras)

La Ley 26.176 establece que las horas extraordinarias en el sector petrolero están exentas del Impuesto a las Ganancias. Esta exención es la base del concepto AVC variable.

---

## 5. MOTOR DE CÁLCULO — DIFERENCIAS ENTRE CCT

### 5.1 Tabla comparativa de reglas

| Regla | CCT 644/12 Privados | CCT 637/11 Jerárquicos |
|---|---|---|
| Básico | Planilla propia por categoría | Planilla propia superior (Art. 63 garantiza superioridad) |
| Horas normales/mes | 192 | 192 |
| Extra 50% (umbral) | Desde hora 9 del día | Igual |
| Extra 100% (umbral) | Desde hora 13 del día | Igual |
| Feriado | 100% extra sobre todo | Igual |
| Franco trabajado | 100% extra sobre todo | Igual |
| Viaje no maneja | 47% hora base | Igual |
| Zona VM | 85% sobre básico | Derivado del básico de privados + solapamiento |
| AVC variable | Tít II: 100% sin límite / Tít III: con tope | 50% hasta tope |
| Día especial | 13-dic (Día del Petróleo) | 12-ago (Día Gremio Jerárquico) + 13-dic |
| Presentismo | 6% sobre remun. normales | 6% sobre remun. normales |
| Diagrama típico | 14×14, 7×7, 2×1 (máx 8×4) | 1×1 solo para direccional, resto igual PP |

### 5.2 Algoritmo del motor para CCT 644/12

```typescript
function calcularJornadaDia(registro: RegistroHoras, config: EmpresaConfig, usuario: Usuario): ResultadoJornada {
  // 1. Calcular horas brutas
  const horasBrutas = calcularHorasBrutas(registro);

  // 2. Descuento almuerzo (solo BASE y si está configurado)
  const horasNetas = registro.lugar_trabajo === 'BASE' && config.descuento_almuerzo_base
    ? Math.max(0, horasBrutas - 1)
    : horasBrutas;

  // 3. Si maneja en campo: sumar horas de viaje a la jornada antes de clasificar
  const horasParaClasificar = registro.maneja
    ? Math.min(horasNetas + registro.horas_viaje_input, config.max_horas_diarias)
    : horasNetas;

  // 4. Clasificar según tipo de día
  const esFrancoOFeriado = registro.es_feriado || registro.es_franco_trabajado;

  let normales = 0, extra50 = 0, extra100 = 0;

  if (esFrancoOFeriado) {
    extra100 = horasParaClasificar; // Todo al 100%
  } else {
    normales = Math.min(horasParaClasificar, config.umbral_extra_50);  // 0-8h = normales
    extra50 = Math.max(0, Math.min(horasParaClasificar - config.umbral_extra_50,
                       config.umbral_extra_100 - config.umbral_extra_50)); // 9-12h = 50%
    extra100 = Math.max(0, horasParaClasificar - config.umbral_extra_100); // 13h+ = 100%
  }

  // 5. Horas de viaje si NO maneja (tarifa especial 47%)
  const horasViajeCalc = !registro.maneja && registro.horas_viaje_input > 0
    ? registro.horas_viaje_input
    : 0;

  return { normales, extra50, extra100, horasViajeCalc };
}

function calcularSueldo(planilla: Planilla, conceptos: ConceptoSalarial[], usuario: Usuario): CalculoSalarial {
  const totales = agregarRegistros(planilla.registros); // suma normales, extra50, extra100, viaje

  const basico = getConceptoValor('BASICO_PP', usuario.categoria_id);
  const horaBase = basico / 192;

  // Conceptos remunerativos fijos
  const turno = getConceptoValor(`TURNO_${usuario.tipo_turno}`, usuario.categoria_id);
  const znc = planilla.tiene_dias_vm ? basico * 0.85 : 0; // solo si trabaja en Vaca Muerta
  const adicYac = planilla.tiene_dias_campo ? basico * 0.05 : 0;
  const antiguedad = basico * (usuario.antiguedad_anos * 0.01);
  const bonoPaz = getConceptoValor('BONO_PAZ_PP');

  const subtotalFijoSinPresentismo = basico + turno + znc + adicYac + antiguedad + bonoPaz;
  const presentismo = subtotalFijoSinPresentismo * 0.06;
  const totalRemunerativoFijo = subtotalFijoSinPresentismo + presentismo;

  // Conceptos remunerativos variables
  const extra50 = horaBase * 1.5 * totales.extra50;
  const extra100 = horaBase * 2.0 * totales.extra100;
  const horasViaje = horaBase * 0.47 * totales.horasViajeCalc;
  const desarraigo = calcularDesarraigo(planilla.registros, getConceptoValor('DESARRAIGO_PP'));

  const totalRemunerativoVariable = extra50 + extra100 + horasViaje + desarraigo;
  const totalRemunerativo = totalRemunerativoFijo + totalRemunerativoVariable;

  // No remunerativos
  const vianda = calcularVianda(planilla.registros, getConceptoValor('VIANDA_PP'));
  const avcFija = getConceptoValor('AVC_FIJA_PP'); // $440.000/mes
  const totalNoRemunerativo = vianda + avcFija;

  // Retenciones
  const jubilacion = totalRemunerativo * 0.11;
  const pami = totalRemunerativo * 0.03;
  const obraSocial = totalRemunerativo * 0.03;
  const sindical = totalRemunerativo * 0.02; // actualizar según acta
  const mutual = totalRemunerativo * 0.0397; // actualizar según acta
  const ganancias = calcularGanancias(totalRemunerativo, usuario); // tabla progresiva AFIP

  const totalRetenciones = jubilacion + pami + obraSocial + sindical + mutual + ganancias;

  // Descuentos por ausencias
  const descuentoAusencias = calcularDescuentoAusencias(planilla, basico);

  const neto = totalRemunerativo + totalNoRemunerativo - totalRetenciones - descuentoAusencias;

  return {
    conceptos: [...todos los conceptos detallados...],
    totales: {
      remunerativo_fijo: totalRemunerativoFijo,
      remunerativo_variable: totalRemunerativoVariable,
      no_remunerativo: totalNoRemunerativo,
      total_bruto: totalRemunerativo,
      total_retenciones: totalRetenciones,
      descuentos_ausencias: descuentoAusencias,
      neto
    }
  };
}
```

### 5.3 Diferencias de cálculo para CCT 637/11

El motor para jerárquicos es igual al de privados con estas diferencias:

```typescript
// Para CCT 637/11:
// 1. El básico se toma de la planilla propia (conceptos_valores donde convenio_id = CCT_637)
// 2. Validar solapamiento (Art. 63): basico_pj > basico_pp del subordinado más alto
// 3. AVC variable: reintegra el 50% del impuesto a ganancias (no el 100%)
// 4. Adicional Personal 8hs: concepto adicional (monto fijo configurable)
// 5. Bono campo: monto adicional cuando trabaja en campo
// 6. Día gremial adicional: 12 de agosto (se comporta como feriado)
```

---

## 6. SEED SQL COMPLETO PARA LA BASE DE DATOS

El agente debe ejecutar este seed en `apps/api/prisma/seed.ts`.

### 6.1 Convenios a insertar

```typescript
// En seed.ts
const convenios = [
  {
    nombre: "CCT 644/12 — Petroleros Privados Neuquén, Río Negro y La Pampa",
    tipo: "PETROLEROS_PRIVADOS_644",   // agregar este enum
    vigente_desde: new Date("2012-01-01"),
    activo: true,
  },
  {
    nombre: "CCT 637/11 — Petroleros Jerárquicos Neuquén, Río Negro y La Pampa",
    tipo: "PETROLEROS_JERARQUICOS_637",  // agregar este enum
    vigente_desde: new Date("2011-01-01"),
    activo: true,
  }
];
```

> **IMPORTANTE:** Actualizar el enum `cct_tipo_enum` en el schema Prisma:
> ```
> PETROLEROS_PRIVADOS_637    → renombrar a PETROLEROS_PRIVADOS_644
> JERARQUICOS_592            → renombrar a PETROLEROS_JERARQUICOS_637
> PERSONALIZADO              → mantener
> ```

### 6.2 Categorías a insertar — CCT 644/12

```typescript
// Categorías CCT 644/12 (básico referencial a actualizar vía admin)
const categorias_pp = [
  // Título II
  { codigo: "TII-A1", nombre: "Título II — Oficial Especializado 1ra A", orden: 1 },
  { codigo: "TII-A2", nombre: "Título II — Oficial Especializado 1ra B", orden: 2 },
  { codigo: "TII-B1", nombre: "Título II — Oficial 2da A", orden: 3 },
  { codigo: "TII-B2", nombre: "Título II — Oficial 2da B", orden: 4 },
  { codigo: "TII-C1", nombre: "Título II — Oficial 3ra A", orden: 5 },
  { codigo: "TII-C2", nombre: "Título II — Oficial 3ra B", orden: 6 },
  { codigo: "TII-D",  nombre: "Título II — Medio Oficial", orden: 7 },
  { codigo: "TII-E",  nombre: "Título II — Ayudante / Peón Especializado", orden: 8 },
  { codigo: "TII-F",  nombre: "Título II — Ayudante General", orden: 9 },
  // Título III
  { codigo: "TIII-A", nombre: "Título III — Operador Principal / Jefe de Equipo", orden: 10 },
  { codigo: "TIII-B", nombre: "Título III — Operador 1ro / Técnico Principal", orden: 11 },
  { codigo: "TIII-C", nombre: "Título III — Operador 2do / Técnico", orden: 12 },
  { codigo: "TIII-D", nombre: "Título III — Asistente de Operaciones", orden: 13 },
  { codigo: "TIII-E", nombre: "Título III — Ayudante de Operaciones", orden: 14 },
  { codigo: "TIII-F", nombre: "Título III — Ayudante General Especial", orden: 15 },
];
```

### 6.3 Categorías a insertar — CCT 637/11

```typescript
const categorias_pj = [
  { codigo: "JER-A", nombre: "Jerárquico Banda A — Jefes y Coordinadores Senior", orden: 1 },
  { codigo: "JER-B", nombre: "Jerárquico Banda B — Supervisores y Técnicos Senior", orden: 2 },
  { codigo: "JER-C", nombre: "Jerárquico Banda C — Técnicos Calificados / Company Man", orden: 3 },
  { codigo: "JER-D", nombre: "Jerárquico Banda D — Asistentes Técnicos", orden: 4 },
];
```

### 6.4 Conceptos salariales a insertar — CCT 644/12

```typescript
const conceptos_pp = [
  // ── REMUNERATIVOS FIJOS ──
  {
    codigo: "BASICO_PP", nombre: "Sueldo Básico CCT 644/12", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: false, base_calculo: null, aplica_siempre: true,
    es_remunerativo: true, visible_empleado: true, orden: 1,
  },
  {
    codigo: "TURNO_A", nombre: "Adicional Turno A (33%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.33, base_calculo: "BASICO",
    aplica_siempre: false, condicion_formula: "usuario.tipo_turno === 'A'",
    orden: 2,
  },
  {
    codigo: "TURNO_B", nombre: "Adicional Turno B (22%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.22, base_calculo: "BASICO",
    aplica_siempre: false, condicion_formula: "usuario.tipo_turno === 'B'",
    orden: 3,
  },
  {
    codigo: "TURNO_S", nombre: "Adicional Turno S (33%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.33, base_calculo: "BASICO",
    aplica_siempre: false, condicion_formula: "usuario.tipo_turno === 'S'",
    orden: 4,
  },
  {
    codigo: "ZNC", nombre: "Zona No Convencional — Vaca Muerta (85%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.85, base_calculo: "BASICO",
    aplica_siempre: false, condicion_formula: "planilla.tiene_dias_vaca_muerta === true",
    orden: 5,
  },
  {
    codigo: "ADICIONAL_YAC", nombre: "Adicional Yacimiento (5%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.05, base_calculo: "BASICO",
    aplica_siempre: false, condicion_formula: "planilla.tiene_dias_campo === true",
    orden: 6,
  },
  {
    codigo: "ANTIGUEDAD", nombre: "Antigüedad (1% por año)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, base_calculo: "BASICO",
    aplica_siempre: true, condicion_formula: "usuario.antiguedad_anos * 0.01",
    orden: 7,
  },
  {
    codigo: "PRESENTISMO", nombre: "Presentismo (6%)", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: true, porcentaje_base: 0.06, base_calculo: "REMUNERATIVO_FIJO_SIN_PRESENTISMO",
    aplica_siempre: false, condicion_formula: "calcular_presentismo", // depende de ausencias
    orden: 8,
  },
  {
    codigo: "BONO_PAZ", nombre: "Bono Paz Social", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: false, aplica_siempre: true, orden: 9,
    // monto en conceptos_valores
  },
  {
    codigo: "ADICIONAL_DISPONIB", nombre: "Adicional Disponibilidad", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: false, aplica_siempre: false, orden: 10,
  },
  // ── REMUNERATIVOS VARIABLES ──
  {
    codigo: "HORAS_EXTRA_50", nombre: "Horas Extra al 50%", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, base_calculo: "HORA_BASE_X_1.5", aplica_siempre: false,
    orden: 20,
  },
  {
    codigo: "HORAS_EXTRA_100", nombre: "Horas Extra al 100%", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, base_calculo: "HORA_BASE_X_2.0", aplica_siempre: false,
    orden: 21,
  },
  {
    codigo: "HORAS_VIAJE", nombre: "Horas de Viaje (47%)", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, base_calculo: "HORA_BASE_X_0.47", aplica_siempre: false,
    condicion_formula: "registro.horas_viaje > 0 && !registro.maneja",
    orden: 22,
  },
  {
    codigo: "DESARRAIGO_HOTEL", nombre: "Desarraigo — Hotel", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "registro.pernocte === 'HOTEL'",
    orden: 23,
  },
  {
    codigo: "DESARRAIGO_TRAILER", nombre: "Desarraigo — Trailer / Campamento", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "registro.pernocte === 'TRAILER'",
    orden: 24,
  },
  {
    codigo: "ADICIONAL_MANEJO", nombre: "Adicional por Manejo en Campo", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "registro.maneja === true && registro.lugar_trabajo === 'CAMPO'",
    orden: 25,
  },
  // ── NO REMUNERATIVOS ──
  {
    codigo: "VIANDA", nombre: "Vianda — Ayuda Alimentaria", tipo: "NO_REMUNERATIVO",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "registro.lugar_trabajo === 'CAMPO'",
    es_remunerativo: false, orden: 40,
  },
  {
    codigo: "DESAYUNO", nombre: "Desayuno / Merienda", tipo: "NO_REMUNERATIVO",
    es_porcentual: false, aplica_siempre: true,
    es_remunerativo: false, orden: 41,
  },
  {
    codigo: "AVC_FIJA", nombre: "Asignación Vianda Complementaria — Fija", tipo: "NO_REMUNERATIVO",
    es_porcentual: false, aplica_siempre: true,
    es_remunerativo: false, orden: 42,
    // monto actual: $440.000 (actualizar vía admin)
  },
  {
    codigo: "AVC_VARIABLE", nombre: "Asignación Vianda Complementaria — Variable (Ganancias)", tipo: "NO_REMUNERATIVO",
    es_porcentual: false, aplica_siempre: false,
    es_remunerativo: false, orden: 43,
    // calculada externamente según impuesto retenido
  },
  // ── RETENCIONES ──
  {
    codigo: "RET_JUB", nombre: "Jubilación (11%)", tipo: "RETENCION",
    es_porcentual: true, porcentaje_base: 0.11, base_calculo: "REMUNERATIVO_TOTAL",
    orden: 60,
  },
  {
    codigo: "RET_PAMI", nombre: "PAMI — Ley 19.032 (3%)", tipo: "RETENCION",
    es_porcentual: true, porcentaje_base: 0.03, base_calculo: "REMUNERATIVO_TOTAL",
    orden: 61,
  },
  {
    codigo: "RET_OS", nombre: "Obra Social (3%)", tipo: "RETENCION",
    es_porcentual: true, porcentaje_base: 0.03, base_calculo: "REMUNERATIVO_TOTAL",
    orden: 62,
  },
  {
    codigo: "RET_SINDICAL", nombre: "Cuota Sindical (2%)", tipo: "RETENCION",
    es_porcentual: true, porcentaje_base: 0.02, base_calculo: "REMUNERATIVO_TOTAL",
    orden: 63,
  },
  {
    codigo: "RET_MUTUAL", nombre: "Mutual (~3.97%)", tipo: "RETENCION",
    es_porcentual: true, porcentaje_base: 0.0397, base_calculo: "REMUNERATIVO_TOTAL",
    orden: 64,
  },
  {
    codigo: "RET_GANANCIAS", nombre: "Impuesto a las Ganancias 4ta Categoría", tipo: "RETENCION",
    es_porcentual: false, aplica_siempre: false, base_calculo: "TABLA_PROGRESIVA_AFIP",
    condicion_formula: "calcular_ganancias_tabla_progresiva",
    orden: 65,
  },
];
```

### 6.5 Conceptos adicionales exclusivos de CCT 637/11

```typescript
const conceptos_pj = [
  {
    codigo: "BASICO_PJ", nombre: "Sueldo Básico CCT 637/11", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: false, orden: 1,
  },
  {
    codigo: "ADICIONAL_PERS_8H", nombre: "Adicional Personal 8 Horas", tipo: "REMUNERATIVO_FIJO",
    es_porcentual: false, aplica_siempre: true, orden: 9,
  },
  {
    codigo: "BONO_CAMPO_PJ", nombre: "Bono Campo", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "planilla.tiene_dias_campo === true",
    orden: 26,
  },
  {
    codigo: "GUARDIA_PASIVA_PJ", nombre: "Guardia Pasiva", tipo: "REMUNERATIVO_VARIABLE",
    es_porcentual: false, aplica_siempre: false,
    condicion_formula: "registro.guardia_pasiva === true",
    orden: 27,
  },
  {
    codigo: "AVC_FIJA_PJ", nombre: "Asignación Vianda Complementaria Fija — Jerárquicos", tipo: "NO_REMUNERATIVO",
    es_porcentual: false, aplica_siempre: true, es_remunerativo: false, orden: 42,
  },
  // Las retenciones son iguales — se comparten los mismos registros de retenciones del 644
];
```

---

## 7. FERIADOS ESPECIALES PETROLEROS

Además de los feriados nacionales argentinos (ya en el spec principal), agregar:

```typescript
// Feriados especiales del sector petrolero
const feriadosEspecialesPetroleros = [
  // Día del Petróleo — 13 de diciembre (CCT 644/12 y 637/11)
  // Aplica todos los años. Pago aunque no se trabaje.
  { fecha: "2025-12-13", nombre: "Día del Petróleo", tipo: "SECTORIAL", cct: ["644/12", "637/11"] },
  { fecha: "2026-12-13", nombre: "Día del Petróleo", tipo: "SECTORIAL", cct: ["644/12", "637/11"] },

  // Día del Petrolero Jerárquico — 12 de agosto (solo CCT 637/11)
  { fecha: "2025-08-12", nombre: "Día del Petrolero Jerárquico", tipo: "SECTORIAL", cct: ["637/11"] },
  { fecha: "2026-08-12", nombre: "Día del Petrolero Jerárquico", tipo: "SECTORIAL", cct: ["637/11"] },
];
```

> **Implementación:** Guardar en `empresa_config.feriados_personalizados` con un campo adicional `cct_aplicable` que filtra según el convenio del empleado. En el calendario de planilla, marcar automáticamente estos días como feriado si el CCT del usuario aplica.

---

## 8. REGLAS DE IMPLEMENTACIÓN PARA EL AGENTE

### 8.1 Cambios al schema Prisma requeridos

```prisma
// 1. Actualizar enum CctTipo
enum CctTipo {
  PETROLEROS_PRIVADOS_644   // antes PETROLEROS_PRIVADOS_637
  PETROLEROS_JERARQUICOS_637 // antes JERARQUICOS_592
  PERSONALIZADO
}

// 2. Agregar campo tipo_turno al modelo Usuario
model Usuario {
  // ... campos existentes ...
  tipo_turno    String?   @map("tipo_turno")  // 'A' | 'B' | 'S' | null (diurno)
  posicion_pj   String?   @map("posicion_pj")  // código de posición para CCT 637/11, ej: 'PJ-OE-08'
  trabaja_vaca_muerta Boolean @default(false) @map("trabaja_vaca_muerta")
}

// 3. Agregar campo cct_tipo al modelo Planilla (para saber qué motor usar al calcular)
model Planilla {
  // ... campos existentes ...
  cct_tipo_snapshot String? @map("cct_tipo_snapshot") // guardado al crear la planilla
}
```

### 8.2 Validaciones de negocio a implementar

1. **Solapamiento salarial PJ (Art. 63):** Al calcular el sueldo de un jerárquico, verificar que su básico total sea mayor al del empleado privado de mayor categoría que supervisa. Si no, emitir una alerta a RRHH.

2. **Zona Vaca Muerta:** Solo aplicar el adicional ZNC (85%) en los meses en que el trabajador efectivamente tuvo días en campo en zona no convencional. Si trabajó solo en base o en zona convencional, no aplica.

3. **Presentismo:** No pagar presentismo si el trabajador tuvo faltas injustificadas en el período. Aplicar regla del CCT: si faltó algún día sin justificar, no cobra presentismo ese mes.

4. **AVC variable:** Calcular solo cuando se conoce el monto de retención de ganancias. Si no hay retención de ganancias, AVC variable = 0.

5. **Horas extras Jerárquicos:** Marcar en el sistema que la empresa debe liquidarlas (el sindicato lo exige). Si el usuario es jerárquico y tiene horas extra registradas, mostrar alerta a RRHH si no están incluidas en el cálculo.

6. **Día del Petróleo (13-dic):** Si se trabaja ese día, el salario base ya está incluido (el día es pago). Las horas trabajadas se pagan al 100% adicional (total 200%).

7. **Contribución sindical extraordinaria:** No es mensual regular. Se carga como concepto de período específico. El sistema debe soportar conceptos "por única vez" con fecha de pago puntual.

### 8.3 Pantalla de configuración del convenio (ADMIN/RRHH)

La pantalla `ConveniosPage` debe permitir:

- Seleccionar si la empresa usa CCT 644/12, CCT 637/11, o ambos
- Para el CCT 637/11: activar/desactivar la validación de solapamiento salarial (Art. 63)
- Configurar si la empresa aplica Zona No Convencional (Vaca Muerta) para ese convenio
- Ver el historial de actualizaciones paritarias con fecha y monto
- Botón "Actualizar paritaria" que abre un formulario para cargar el nuevo porcentaje de aumento y la fecha de vigencia (crea nuevo registro en `conceptos_valores`)

### 8.4 Perfil del usuario — campos específicos CCT

Agregar a la ficha del empleado (`FichaEmpleadoPage`):

**Si convenio = CCT 644/12:**
- Tipo de jornada: D / Y
- Adicional de turno: A / B / S / ninguno
- Trabaja en Vaca Muerta: Sí / No
- Título del CCT: II / III / IV

**Si convenio = CCT 637/11:**
- Posición específica: Select con todas las posiciones del Anexo I (listadas en sección 2.3)
- Banda de categoría: A / B / C / D
- Trabaja en Vaca Muerta: Sí / No

---

## APÉNDICE — GUÍA RÁPIDA DE DIFERENCIAS PARA LIQUIDACIÓN

| Concepto | CCT 644/12 (Privados) | CCT 637/11 (Jerárquicos) |
|---|---|---|
| Básico | Planilla 644/12 | Planilla 637/11 (mayor) |
| Turno A/B/S | ✓ (33%/22%/33%) | ✓ (mismos %) |
| Adicional Yacimiento | ✓ (5%) | Incluido en básico |
| Zona VM | ✓ (85%) | Derivado de privados + solapamiento |
| Presentismo | ✓ (6%) | ✓ (6%) |
| Antigüedad | ✓ (1%/año) | ✓ (1%/año) |
| Horas extra 50% | ✓ | ✓ (en proceso de homogeneización) |
| Horas extra 100% | ✓ | ✓ |
| Viaje no maneja | ✓ (47%) | ✓ (47%) |
| Guardia pasiva | Solo Tít IV (médicos) | ✓ (médicos y enfermeros campo) |
| Adicional Pers. 8h | ✗ | ✓ |
| Bono Campo | ✗ | ✓ |
| AVC fija | ✓ ($440k/mes) | ✓ ($440k/mes) |
| AVC variable | Tít II: 100% / Tít III: con tope | 50% hasta tope |
| Retenciones | JUB 11%/PAMI 3%/OS 3%/SIND 2% | Igual |
| Día del Petróleo | ✓ (13-dic) | ✓ (13-dic) |
| Día del Gremio | ✗ | ✓ (12-ago) |

---

*Fin del documento de CCT*  
*Fuentes: CCT 644/12, CCT 637/11, actas paritarias 2024-2025, Res. ST 522/2012, consultora Pérez Marzo, Tributum, Diario Río Negro*  
*Los valores monetarios deben verificarse y actualizarse con las planillas salariales oficiales vigentes antes de la puesta en producción*
