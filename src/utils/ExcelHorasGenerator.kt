package com.equiptrack.utils

import android.content.Context
import android.os.Environment
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import org.apache.poi.ss.usermodel.*
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object ExcelHorasGenerator {

    fun generarExcelHoras(context: Context, mes: Int, anio: Int, registros: List<HorasTrabajoEntity>): File? {
        try {
            // Cargar archivo original "Planilla de horas Vazquez Nicolas..." clonado a assets
            val inputStream = context.assets.open("template_horas.xlsx")
            val workbook = WorkbookFactory.create(inputStream)
            val sheet = workbook.getSheetAt(0)

            val calActual = Calendar.getInstance().apply { set(Calendar.MONTH, mes); set(Calendar.YEAR, anio) }
            val calAnterior = Calendar.getInstance().apply { set(Calendar.MONTH, mes); set(Calendar.YEAR, anio); add(Calendar.MONTH, -1) }
            val formatMes = SimpleDateFormat("MMMM", Locale("es", "ES"))
            val mesAnteriorStr = formatMes.format(calAnterior.time)
            val mesActualStr = formatMes.format(calActual.time)
            val añoStr = calActual.get(Calendar.YEAR)
            
            // "enero-febrero" / "julio-agosto" etc
            val mesStr = "$mesAnteriorStr-$mesActualStr $añoStr"

            // Escribir el mes en Row 7 (index 6), Col 3 (index 2) de la plantilla
            val rowMes = sheet.getRow(6) ?: sheet.createRow(6)
            var cellMes = rowMes.getCell(2)
            if (cellMes == null) cellMes = rowMes.createCell(2)
            cellMes.setCellValue(mesStr)

            // Determinar días del mes anterior (21 al fin de mes)
            val calDate = Calendar.getInstance().apply {
                set(Calendar.YEAR, anio)
                set(Calendar.MONTH, mes)
                add(Calendar.MONTH, -1) 
                set(Calendar.DAY_OF_MONTH, 1)
            }
            val daysInPrevMonth = calDate.getActualMaximum(Calendar.DAY_OF_MONTH)
            
            val registrosPorDiaDelAnio = registros.associateBy { 
                Calendar.getInstance().apply { timeInMillis = it.fechaMs }.get(Calendar.DAY_OF_YEAR) 
            }

            // Datos comienzan en Row 12 (Index 11) de la plantilla
            var startDataRow = 11 
            val dfTime = SimpleDateFormat("HH:mm", Locale.getDefault())
            val dfDateFull = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

            // 1. Días del 21 al fin de mes anterior
            for (day in 21..daysInPrevMonth) {
                calDate.set(Calendar.DAY_OF_MONTH, day)
                escribirFilaDiariaTemplate(sheet, startDataRow++, calDate, registrosPorDiaDelAnio[calDate.get(Calendar.DAY_OF_YEAR)], dfTime, dfDateFull)
            }

            // 2. Días del 1 al 20 del mes actual
            calDate.add(Calendar.MONTH, 1) 
            for (day in 1..20) {
                calDate.set(Calendar.DAY_OF_MONTH, day)
                escribirFilaDiariaTemplate(sheet, startDataRow++, calDate, registrosPorDiaDelAnio[calDate.get(Calendar.DAY_OF_YEAR)], dfTime, dfDateFull)
            }
            
            // 3. Limpiar filas sobrantes del template (meses con <31 días)
            // La plantilla puede tener hasta 31 filas de datos (índice 11 a 41).
            // Si el mes actual tiene menos días, las filas extras quedan con datos viejos.
            val maxDataRow = 11 + 31  // máximo posible (31 días)
            for (i in startDataRow until maxDataRow) {
                val row = sheet.getRow(i)
                if (row != null) {
                    // Limpiar todas las celdas de datos (B hasta N, index 1..13)
                    for (c in 1..13) {
                        val cell = row.getCell(c)
                        if (cell != null) {
                            try { cell.removeFormula() } catch (_: Exception) {}
                            try { cell.setCellFormula(null) } catch (_: Exception) {}
                            cell.setCellValue("")
                        }
                    }
                }
            }

            // Forzar actualización de las fórmulas de la plantilla (+ SUMHs) al abrir con Excel
            sheet.forceFormulaRecalculation = true

            val fileName = "Planilla de horas Vazquez Nicolas ($mesAnteriorStr - $mesActualStr - $añoStr).xlsx"
            val file = File(context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), fileName)
            val outputStream = FileOutputStream(file)
            workbook.write(outputStream)
            outputStream.close()
            workbook.close()
            return file
        } catch (e: Exception) {
            e.printStackTrace()
            return null
        }
    }

    private fun escribirFilaDiariaTemplate(
        sheet: Sheet,
        rowIdx: Int,
        calDate: Calendar, 
        reg: HorasTrabajoEntity?, 
        dfTime: SimpleDateFormat, 
        dfDateFull: SimpleDateFormat
    ) {
        val r = sheet.getRow(rowIdx) ?: sheet.createRow(rowIdx)

        fun getOrSet(c: Int, v: String) {
            val cell = r.getCell(c) ?: r.createCell(c)
            try { cell.removeFormula() } catch (e: Exception) {}
            try { cell.setCellFormula(null) } catch (e: Exception) {}
            cell.setCellValue(v)
        }
        fun getOrSetNum(c: Int, v: Double) {
            val cell = r.getCell(c) ?: r.createCell(c)
            try { cell.removeFormula() } catch (e: Exception) {}
            try { cell.setCellFormula(null) } catch (e: Exception) {}
            cell.setCellValue(v)
        }
        
        // Dia (Col B, index 1)
        getOrSet(1, dfDateFull.format(calDate.time))

        val dayOfWeek = calDate.get(Calendar.DAY_OF_WEEK)
        val isWeekend = dayOfWeek == Calendar.SATURDAY || dayOfWeek == Calendar.SUNDAY

        if (reg == null) {
            if (isWeekend) {
                getOrSet(2, "-")
                getOrSet(3, "")
                getOrSet(4, "")
                getOrSet(5, "-")
                getOrSetNum(6, 0.0)
                getOrSet(7, "-")
                getOrSet(8, "franco")
                getOrSet(9, "-")
                getOrSet(10, "-")
                getOrSet(11, "-")
                getOrSet(12, "-")
                getOrSet(13, "-")
            } else {
                getOrSet(2, "")
                getOrSet(3, "")
                getOrSet(4, "")
                getOrSet(5, "")
                getOrSetNum(6, 0.0)
                getOrSet(7, "")
                getOrSet(8, "")
                getOrSet(9, "")
                getOrSet(10, "")
                getOrSet(11, "")
                getOrSet(12, "")
                getOrSet(13, "")
            }
        } else if (reg.lugarTrabajo == "Franco") {
            if (reg.esFrancoCompensatorio) {
                getOrSet(2, "-")
                getOrSet(3, "")
                getOrSet(4, "")
                getOrSet(5, "-")
                getOrSetNum(6, 0.0)
                getOrSet(7, "-")
                getOrSet(8, "franco (comp.)")
                getOrSet(9, "-")
                getOrSet(10, "-")
                getOrSet(11, "-")
                getOrSet(12, "-")
                getOrSet(13, "-")
            } else {
                getOrSet(2, "-")
                getOrSet(3, "")
                getOrSet(4, "")
                getOrSet(5, "-")
                getOrSetNum(6, 0.0)
                getOrSet(7, "-")
                getOrSet(8, "franco")
                getOrSet(9, "-")
                getOrSet(10, "-")
                getOrSet(11, "-")
                getOrSet(12, "-")
                getOrSet(13, "-")
            }
        } else {
            val hasTurno2 = reg.entradaFinMs != null && reg.salidaFinMs != null
            if (!hasTurno2) {
                // Turno único mapea a Col C y Col F (idx 2 y 5) segun analisis del dump de layout.
                getOrSet(2, if (reg.entradaInicioMs != null) dfTime.format(Date(reg.entradaInicioMs)) else "")
                getOrSet(3, "")
                getOrSet(4, "")
                getOrSet(5, if (reg.salidaInicioMs != null) dfTime.format(Date(reg.salidaInicioMs)) else "")
            } else {
                getOrSet(2, if (reg.entradaInicioMs != null) dfTime.format(Date(reg.entradaInicioMs)) else "")
                getOrSet(3, if (reg.salidaInicioMs != null) dfTime.format(Date(reg.salidaInicioMs)) else "")
                getOrSet(4, if (reg.entradaFinMs != null) dfTime.format(Date(reg.entradaFinMs)) else "")
                getOrSet(5, if (reg.salidaFinMs != null) dfTime.format(Date(reg.salidaFinMs)) else "")
            }

            val h1 = calcularHoras(reg.entradaInicioMs, reg.salidaInicioMs, reg.lugarTrabajo)
            val h2 = calcularHoras(reg.entradaFinMs, reg.salidaFinMs, reg.lugarTrabajo)
            getOrSetNum(6, h1 + h2)
            getOrSet(7, if (reg.horasViaje > 0) "SI" else "NO")
            getOrSet(8, reg.lugarTrabajo)

            // Pernocte 
            // Hotel -> Col J idx 9, Trailer -> Col K idx 10, NO -> Col L idx 11.
            getOrSet(9, if (reg.pernocte == "Hotel") "x" else "")
            getOrSet(10, if (reg.pernocte == "Trailer") "x" else "")
            getOrSet(11, if (reg.pernocte == "NO") "x" else "")

            // Maneja -> Col M idx 12
            getOrSet(12, if (reg.maneja) "x" else "")

            // Obs -> Col N idx 13
            getOrSet(13, reg.observaciones)
        }
    }

    private fun calcularHoras(inicioMs: Long?, finMs: Long?, lugar: String): Double {
        if (inicioMs == null || finMs == null) return 0.0
        var diff = finMs - inicioMs
        if (diff < 0) {
            diff += 24 * 60 * 60 * 1000L
        }
        var hsBrutas = diff / (1000.0 * 60 * 60)
        // Convencion Base -1 hora
        if (lugar == "Base" && hsBrutas > 4.0) {
            hsBrutas -= 1.0
        }
        return Math.round(hsBrutas).toDouble()
    }

    fun getExportedFiles(context: Context): List<File> {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: return emptyList()
        return dir.listFiles { file ->
            file.isFile && file.name.startsWith("Planilla de horas") && file.name.endsWith(".xlsx")
        }?.sortedByDescending { it.lastModified() } ?: emptyList()
    }

    fun deleteExportedFile(file: File): Boolean {
        return if (file.exists()) file.delete() else false
    }
}
