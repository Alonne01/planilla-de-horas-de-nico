package com.equiptrack.utils

import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

object CalculoSalarialUtil {

    // --- Feriados Nacionales Argentina 2025-2026 ---
    private val feriadosArgentina = setOf(
        // 2025
        "2025-01-01", "2025-03-03", "2025-03-04", "2025-04-02",
        "2025-04-17", "2025-04-18", "2025-05-01", "2025-05-25",
        "2025-06-20", "2025-07-09", "2025-08-17", "2025-10-12",
        "2025-11-20", "2025-11-21", "2025-12-08", "2025-12-25",
        // 2026
        "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-02",
        "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-20",
        "2026-07-09", "2026-08-17", "2026-10-12", "2026-11-20",
        "2026-12-08", "2026-12-25"
    )

    // --- Componentes Fijos CCT 637/11 ---
    private const val DIVISOR = 147.78

    // Data class to hold processed day metrics
    data class DiaProcesado(
        val fechaMs: Long,
        val hsNormales: Double,
        val hsExtra50: Double,
        val hsExtra100: Double,
        val hsViaje: Double,
        val esBase: Boolean,
        val esCampo: Boolean,
        val esFrancoOAusente: Boolean
    )

    data class SalaryEstimate(
        val totalNormales: Double,
        val totalExtra50: Double,
        val totalExtra100: Double,
        val totalViaje: Double,
        val diasTrabajados: Int,
        val diasCampo: Int,
        val diasBase: Int,
        val diasPernocte: Int,
        
        // Monetario
        val subtotalFijos: Double,
        val subtotalVariables: Double,
        val subtotalNoRemunerativo: Double,
        val bruto: Double,
        val retenciones: Double,
        val netoEstimado: Double
    )

    fun esFeriado(fechaMs: Long): Boolean {
        val format = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        return feriadosArgentina.contains(format.format(Date(fechaMs)))
    }

    fun esFinDeSemana(fechaMs: Long): Boolean {
        val cal = Calendar.getInstance().apply { timeInMillis = fechaMs }
        val day = cal.get(Calendar.DAY_OF_WEEK)
        return day == Calendar.SATURDAY || day == Calendar.SUNDAY
    }

    private fun calcularHorasTotales(reg: HorasTrabajoEntity): Double {
        var h1 = if (reg.entradaInicioMs != null && reg.salidaInicioMs != null) {
            var diff = reg.salidaInicioMs - reg.entradaInicioMs
            if (diff < 0) diff += 24L * 60 * 60 * 1000 // Cruza medianoche
            diff / (1000.0 * 60 * 60)
        } else 0.0

        var h2 = if (reg.entradaFinMs != null && reg.salidaFinMs != null) {
            var diff = reg.salidaFinMs - reg.entradaFinMs
            if (diff < 0) diff += 24L * 60 * 60 * 1000 // Cruza medianoche
            diff / (1000.0 * 60 * 60)
        } else 0.0

        return h1 + h2
    }

    fun procesarDia(reg: HorasTrabajoEntity): DiaProcesado {
        if (reg.lugarTrabajo.equals("Franco", ignoreCase = true) || reg.lugarTrabajo.equals("Ausente", ignoreCase = true)) {
            return DiaProcesado(reg.fechaMs, 0.0, 0.0, 0.0, 0.0, false, false, true)
        }

        val esCampo = reg.lugarTrabajo.equals("Campo", ignoreCase = true)
        val esBase = reg.lugarTrabajo.equals("Base", ignoreCase = true)
        val esFeriadoOFranco = esFeriado(reg.fechaMs) || esFinDeSemana(reg.fechaMs)

        var hsBrutas = calcularHorasTotales(reg)
        if (esBase) {
            hsBrutas -= 1.0 // Descuento de almuerzo en Base
        }

        // Si maneja, las horas de viaje se consideran jornada laboral
        if (esCampo && reg.maneja && reg.horasViaje > 0.0) {
            hsBrutas += reg.horasViaje
        }
        
        // Cap máximo de 16 horas diarias por convenio general
        val hsTrabajadas = max(0.0, min(hsBrutas, 16.0))

        var normal = 0.0
        var extra50 = 0.0
        var extra100 = 0.0
        var viaje = 0.0

        if (esFeriadoOFranco) {
            // Si trabajó en fin de semana o feriado, TODAS las horas van al 100%
            extra100 = hsTrabajadas
        } else {
            // Día hábil normal
            normal = min(hsTrabajadas, 8.0)
            extra50 = max(0.0, min(hsTrabajadas - 8.0, 4.0)) // Horas 9 a 12
            extra100 = max(0.0, hsTrabajadas - 12.0)         // Hora 13 en adelante
        }

        // Horas de viaje separadas SOLO si no maneja (se pagan al 47%).
        // Incluye el viaje a Base (+1h).
        if ((esBase || (esCampo && !reg.maneja)) && reg.horasViaje > 0.0) {
            viaje = reg.horasViaje
        }

        return DiaProcesado(
            fechaMs = reg.fechaMs,
            hsNormales = normal,
            hsExtra50 = extra50,
            hsExtra100 = extra100,
            hsViaje = viaje,
            esBase = esBase,
            esCampo = esCampo,
            esFrancoOAusente = false
        )
    }

    fun calcularSueldoMensual(
        registros: List<HorasTrabajoEntity>,
        sueldoBasico: Double = 1705258.43
    ): SalaryEstimate {
        val procesados = registros.map { procesarDia(it) }

        val totalNormal = procesados.sumOf { it.hsNormales }
        val total50 = procesados.sumOf { it.hsExtra50 }
        val total100 = procesados.sumOf { it.hsExtra100 }
        val totalViaje = procesados.sumOf { it.hsViaje }

        val diasTrabajados = procesados.count { !it.esFrancoOAusente }
        val diasCampo = procesados.count { it.esCampo }
        val diasBase = procesados.count { it.esBase }
        val pernoctes = registros.count { it.pernocte != "NO" }

        // --- PASO 2: Componentes Fijos ---
        val antiguedad = (sueldoBasico / 157.04) * 2.0 // 2 años
        val presentismo = sueldoBasico / 16.0
        val bonoPaz = sueldoBasico * 0.1336
        val adicTorre = sueldoBasico * 0.2135
        val antActa1 = 556457.02
        val antActa2 = 83468.55

        val totalFijos = sueldoBasico + antiguedad + presentismo + bonoPaz + adicTorre + antActa1 + antActa2

        // --- PASO 3: Variables Acumuladas ---
        val horaBase = sueldoBasico / DIVISOR
        val varExtra50 = total50 * (horaBase * 1.5)
        val varExtra100 = total100 * (horaBase * 2.0)
        val varViaje = totalViaje * (horaBase * 0.4705) // Exacto histórico
        val desarraigoEstimado = pernoctes * 16000.0 // Solo aplica por días DE PERNOCTE (hotel/trailer)

        val totalVariables = varExtra50 + varExtra100 + varViaje + desarraigoEstimado

        // --- PASO 4: Base Imponible y Retenciones ---
        // (Jubilación 11%, Pami 3%, ObraSocial 3%, Sindical 2.65%, Mutual 3.97%) = 24.62% + Ganancias
        val baseImponible = totalFijos + varExtra50 + varExtra100 + varViaje
        val retencionesRegulares = baseImponible * 0.2462
        val gananciasAprox = baseImponible * 0.018 // ~1.8% según el historial
        val retencionesTotales = retencionesRegulares + gananciasAprox

        // --- PASO 5: No Remunerativos ---
        val viandas = diasTrabajados * 32401.0
        val viandasCampo = diasCampo * 16901.0
        val desayuno = diasTrabajados * 4756.0
        val snr3 = baseImponible * 0.03 // Acuerdo 3% Remunerativo
        val snr3Norem = 3.0 * 27608.0 // Fijo 3 unidades sobre no rem
        val vacaMuerta = 380000.0
        val viandaCompFija = 493661.0

        val totalNoRem = viandas + viandasCampo + desayuno + snr3 + snr3Norem + vacaMuerta + viandaCompFija

        val bruto = totalFijos + totalVariables + totalNoRem
        val netoFin = bruto - retencionesTotales

        return SalaryEstimate(
            totalNormales = totalNormal,
            totalExtra50 = total50,
            totalExtra100 = total100,
            totalViaje = totalViaje,
            diasTrabajados = diasTrabajados,
            diasCampo = diasCampo,
            diasBase = diasBase,
            diasPernocte = pernoctes,
            subtotalFijos = totalFijos,
            subtotalVariables = totalVariables,
            subtotalNoRemunerativo = totalNoRem,
            bruto = bruto,
            retenciones = retencionesTotales,
            netoEstimado = netoFin
        )
    }

}
