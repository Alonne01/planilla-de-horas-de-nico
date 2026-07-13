package com.equiptrack.ui.screens.horas

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import com.equiptrack.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegistroHorasDialog(
    registroEdicion: HorasTrabajoEntity?,
    initialDateMs: Long,
    proyectosSugeridos: List<String> = emptyList(),
    onDismiss: () -> Unit,
    onSave: (
        fechaMs: Long,
        eInst: Long?, sInst: Long?,
        eFin: Long?, sFin: Long?,
        lugar: String, pernocte: String,
        maneja: Boolean, horasViaje: Double, esFeriado: Boolean, 
        esFrancoCompensatorio: Boolean, esFrancoTrabajado: Boolean,
        obs: String
    ) -> Unit
) {
    // State variables
    var fechaMs by remember { mutableStateOf(registroEdicion?.fechaMs ?: initialDateMs) }
    
    var eInstMs by remember { mutableStateOf(registroEdicion?.entradaInicioMs) }
    var sInstMs by remember { mutableStateOf(registroEdicion?.salidaInicioMs) }
    
    var eFinMs by remember { mutableStateOf(registroEdicion?.entradaFinMs) }
    var sFinMs by remember { mutableStateOf(registroEdicion?.salidaFinMs) }

    var lugar by remember { mutableStateOf(registroEdicion?.lugarTrabajo ?: "Base") }
    var pernocte by remember { mutableStateOf(registroEdicion?.pernocte ?: "NO") }
    var maneja by remember { mutableStateOf(registroEdicion?.maneja ?: false) }
    val hvInicial = registroEdicion?.horasViaje ?: 0.0
    var horasViajeActivo by remember { mutableStateOf(hvInicial > 0.0) }
    var distanciaViaje by remember {
        mutableStateOf(
            when {
                hvInicial == 3.0 -> "CORTA"
                hvInicial == 5.0 -> "MEDIA"
                hvInicial > 0.0 -> "LARGA"
                else -> ""
            }
        )
    }
    var horasViajeManual by remember { mutableStateOf(if (hvInicial > 0.0) hvInicial.toString() else "") }
    var esFeriado by remember { mutableStateOf(registroEdicion?.esFeriado ?: false) }
    var esFrancoCompensatorio by remember { mutableStateOf(registroEdicion?.esFrancoCompensatorio ?: false) }
    var esFrancoTrabajado by remember { mutableStateOf(registroEdicion?.esFrancoTrabajado ?: false) }
    var obs by remember { mutableStateOf(registroEdicion?.observaciones ?: "") }

    // Dialog state for pickers
    var showDatePicker by remember { mutableStateOf(false) }
    var timePickerTarget by remember { mutableStateOf<String?>(null) } // "eInst", "sInst", "eFin", "sFin"

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.9f)
                .padding(vertical = 16.dp),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.background
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
            ) {
                Text(
                    text = if (registroEdicion == null) "Nuevo Registro" else "Editar Registro",
                    style = MaterialTheme.typography.titleLarge,
                    color = ColorTexto,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Fecha
                    OutlinedTextField(
                        value = SimpleDateFormat("EEE dd/MM/yyyy", Locale.getDefault()).format(Date(fechaMs)).replaceFirstChar { it.uppercase() },
                        onValueChange = {},
                        label = { Text("Fecha") },
                        readOnly = true,
                        trailingIcon = { Icon(Icons.Filled.CalendarMonth, null) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showDatePicker = true },
                        enabled = false,
                        colors = OutlinedTextFieldDefaults.colors(
                            disabledTextColor = ColorTexto,
                            disabledBorderColor = ColorBorde,
                            disabledTrailingIconColor = ColorPrimario,
                            disabledLabelColor = ColorTextoSec
                        )
                    )

                    Divider(color = ColorBorde)

                    // Primer Turno
                    Text("Primer Turno", style = MaterialTheme.typography.titleMedium, color = ColorTexto)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TimeField(label = "Entrada", timeMs = eInstMs, onClick = { timePickerTarget = "eInst" }, modifier = Modifier.weight(1f))
                        TimeField(label = "Salida", timeMs = sInstMs, onClick = { timePickerTarget = "sInst" }, modifier = Modifier.weight(1f))
                    }

                    // Segundo Turno
                    Text("Segundo Turno (Opcional)", style = MaterialTheme.typography.titleMedium, color = ColorTexto)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TimeField(label = "Entrada", timeMs = eFinMs, onClick = { timePickerTarget = "eFin" }, modifier = Modifier.weight(1f))
                        TimeField(label = "Salida", timeMs = sFinMs, onClick = { timePickerTarget = "sFin" }, modifier = Modifier.weight(1f))
                    }

                    Divider(color = ColorBorde)

                    // Lugar Trabajo
                    Text("Lugar de Trabajo", style = MaterialTheme.typography.labelMedium, color = ColorTextoSec)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Base", "Campo", "Franco").forEach { opt ->
                            FilterChip(
                                selected = lugar == opt,
                                onClick = { 
                                    lugar = opt 
                                    if (opt == "Base") {
                                        maneja = false
                                        pernocte = "NO"
                                        horasViajeActivo = false
                                    }
                                    if (opt == "Franco") {
                                        esFrancoTrabajado = false 
                                        val calD = Calendar.getInstance().apply { timeInMillis = fechaMs }
                                        val isWeekend = calD.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || calD.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
                                        if (!isWeekend) {
                                            esFrancoCompensatorio = true
                                            obs = "Franco compensatorio"
                                        } else {
                                            esFrancoCompensatorio = false
                                        }
                                    } else {
                                        esFrancoCompensatorio = false
                                    }
                                },
                                label = { Text(opt) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = if(opt == "Franco") ColorAlertaNaranjaFondo else ColorPrimarioPale,
                                    selectedLabelColor = if(opt == "Franco") ColorAlertaNaranja else ColorPrimario
                                )
                            )
                        }
                    }

                    if (lugar != "Franco") {
                        if (lugar != "Base") {
                            // Pernocte
                            Text("Pernocte", style = MaterialTheme.typography.labelMedium, color = ColorTextoSec)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("NO", "Hotel", "Trailer").forEach { opt ->
                                    FilterChip(
                                        selected = pernocte == opt,
                                        onClick = { pernocte = opt },
                                        label = { Text(opt) },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = ColorPrimarioPale,
                                            selectedLabelColor = ColorPrimario
                                        )
                                    )
                                }
                            }

                            // Maneja
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Switch(
                                    checked = maneja, 
                                    onCheckedChange = { 
                                        maneja = it 
                                        if (it) horasViajeActivo = true
                                    }
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Manejó este día", color = ColorTexto)
                            }
                        }

                        // Horas Viaje
                        if (lugar == "Base") {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Switch(
                                    checked = horasViajeActivo,
                                    onCheckedChange = { horasViajeActivo = it }
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Viaje a base (+1h)", color = ColorTexto)
                            }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Switch(
                                    checked = horasViajeActivo,
                                    onCheckedChange = {
                                        horasViajeActivo = it
                                        if (!it) {
                                            distanciaViaje = ""
                                            horasViajeManual = ""
                                            maneja = false
                                        }
                                    }
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Viaje (Sí/No)", color = ColorTexto)
                            }

                            if (horasViajeActivo) {
                                Text("Distancia", style = MaterialTheme.typography.labelMedium, color = ColorTextoSec)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    listOf("CORTA" to "-250km (3h)", "MEDIA" to "+350km (5h)", "LARGA" to "+500km").forEach { (value, label) ->
                                        FilterChip(
                                            selected = distanciaViaje == value,
                                            onClick = { distanciaViaje = value },
                                            label = { Text(label) },
                                            colors = FilterChipDefaults.filterChipColors(
                                                selectedContainerColor = ColorPrimarioPale,
                                                selectedLabelColor = ColorPrimario
                                            )
                                        )
                                    }
                                }
                                if (distanciaViaje == "LARGA") {
                                    OutlinedTextField(
                                        value = horasViajeManual,
                                        onValueChange = { horasViajeManual = it },
                                        label = { Text("Horas de viaje") },
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = true
                                    )
                                }
                            }
                        }

                            // Opciones de Franco (Trabajado vs No Trabajado)
                            val calD = Calendar.getInstance().apply { timeInMillis = fechaMs }
                            val isWeekend = calD.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || calD.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY

                            if (isWeekend) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Switch(checked = esFrancoTrabajado, onCheckedChange = { 
                                        esFrancoTrabajado = it 
                                        if (it) obs = "FRANCO TRABAJADO"
                                    })
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Franco Trabajado (100%)", color = ColorTexto)
                                }
                            } else {
                                // Feriado Manual (solo días hábiles)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Switch(checked = esFeriado, onCheckedChange = { 
                                        esFeriado = it 
                                        if (it) {
                                            val hasHours = eInstMs != null || eFinMs != null
                                            obs = if (hasHours) "FERIADO TRABAJADO" else "feriado"
                                        }
                                    })
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Día no hábil (Feriado Nacional)", color = ColorTexto)
                                }
                            }
                        } else {
                            // Si el lugar ES "Franco", mostramos la opción de Compensatorio
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Switch(checked = esFrancoCompensatorio, onCheckedChange = { esFrancoCompensatorio = it })
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Franco Compensatorio (Me pido el día)", color = ColorTexto)
                            }
                        }

                        // Observaciones
                        var expandedObs by remember { mutableStateOf(false) }

                        ExposedDropdownMenuBox(
                            expanded = expandedObs,
                            onExpandedChange = { expandedObs = it }
                        ) {
                            OutlinedTextField(
                                value = obs,
                                onValueChange = { 
                                    obs = it
                                    if (lugar == "Campo" && proyectosSugeridos.isNotEmpty()) {
                                        expandedObs = true
                                    }
                                },
                                label = { Text("Observaciones / Proyecto") },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .menuAnchor()
                                    .onFocusChanged { 
                                        if (it.isFocused && lugar == "Campo" && proyectosSugeridos.isNotEmpty()) {
                                            expandedObs = true 
                                        }
                                    },
                                maxLines = 3,
                                trailingIcon = {
                                    if (lugar == "Campo" && proyectosSugeridos.isNotEmpty()) {
                                        ExposedDropdownMenuDefaults.TrailingIcon(expanded = expandedObs)
                                    }
                                }
                            )

                            if (lugar == "Campo" && proyectosSugeridos.isNotEmpty()) {
                                val filtered = if (obs.isBlank()) {
                                    proyectosSugeridos
                                } else {
                                    proyectosSugeridos.filter { it.contains(obs, ignoreCase = true) }
                                }
                                
                                if (filtered.isNotEmpty()) {
                                    ExposedDropdownMenu(
                                        expanded = expandedObs,
                                        onDismissRequest = { expandedObs = false }
                                    ) {
                                        filtered.forEach { proyecto ->
                                            DropdownMenuItem(
                                                text = { Text(proyecto) },
                                                onClick = {
                                                    obs = proyecto
                                                    expandedObs = false
                                                }
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancelar", color = ColorTextoSec)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val hv = if (!horasViajeActivo) 0.0 else when {
                                lugar == "Base" -> 1.0
                                distanciaViaje == "CORTA" -> 3.0
                                distanciaViaje == "MEDIA" -> 5.0
                                distanciaViaje == "LARGA" -> horasViajeManual.replace(',', '.').toDoubleOrNull() ?: 0.0
                                else -> 0.0
                            }
                            if (lugar == "Franco") {
                                // Clear times if franco
                                onSave(fechaMs, null, null, null, null, lugar, "NO", false, 0.0, esFeriado, esFrancoCompensatorio, false, obs)
                            } else {
                                onSave(fechaMs, eInstMs, sInstMs, eFinMs, sFinMs, lugar, pernocte, maneja, hv, esFeriado, false, esFrancoTrabajado, obs)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ColorPrimario)
                    ) {
                        Text("Guardar")
                    }
                }
            }
        }
    }

    if (showDatePicker) {
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = fechaMs)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { fechaMs = it }
                    showDatePicker = false
                }) { Text("Aceptar") }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text("Cancelar") }
            }
        ) {
            DatePicker(state = datePickerState)
        }
    }

    if (timePickerTarget != null) {
        val initialMs = when (timePickerTarget) {
            "eInst" -> eInstMs
            "sInst" -> sInstMs
            "eFin" -> eFinMs
            "sFin" -> sFinMs
            else -> null
        }
        val cal = Calendar.getInstance()
        if (initialMs != null) cal.timeInMillis = initialMs

        val timePickerState = rememberTimePickerState(
            initialHour = cal.get(Calendar.HOUR_OF_DAY),
            initialMinute = cal.get(Calendar.MINUTE),
            is24Hour = true
        )

        AlertDialog(
            onDismissRequest = { timePickerTarget = null },
            confirmButton = {
                TextButton(onClick = {
                    var finalMinute = timePickerState.minute
                    val rem = finalMinute % 15
                    finalMinute = if (rem >= 8) finalMinute + (15 - rem) else finalMinute - rem
                    
                    var finalHour = timePickerState.hour
                    if (finalMinute == 60) {
                        finalMinute = 0
                        finalHour = (finalHour + 1) % 24
                    }

                    val targetCal = Calendar.getInstance().apply {
                        timeInMillis = fechaMs
                        set(Calendar.HOUR_OF_DAY, finalHour)
                        set(Calendar.MINUTE, finalMinute)
                        set(Calendar.SECOND, 0)
                    }
                    val pickedMs = targetCal.timeInMillis
                    val hasHoursBefore = eInstMs != null || eFinMs != null || sInstMs != null || sFinMs != null
                    when (timePickerTarget) {
                        "eInst" -> eInstMs = pickedMs
                        "sInst" -> sInstMs = pickedMs
                        "eFin" -> eFinMs = pickedMs
                        "sFin" -> sFinMs = pickedMs
                    }
                    val hasHoursAfter = eInstMs != null || eFinMs != null || sInstMs != null || sFinMs != null
                    
                    if (!hasHoursBefore && hasHoursAfter) {
                        val calD = Calendar.getInstance().apply { timeInMillis = fechaMs }
                        val isWeekend = calD.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || calD.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
                        
                        if (esFeriado) {
                            obs = "FERIADO TRABAJADO"
                        } else if (isWeekend) {
                            esFrancoTrabajado = true
                            obs = "FRANCO TRABAJADO"
                        }
                    }
                    timePickerTarget = null
                }) { Text("Confirmar") }
            },
            dismissButton = {
                TextButton(onClick = { timePickerTarget = null }) { Text("Cancelar") }
            },
            text = {
                TimePicker(state = timePickerState)
            }
        )
    }
}

@Composable
private fun TimeField(label: String, timeMs: Long?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = if (timeMs != null) SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timeMs)) else "",
        onValueChange = {},
        label = { Text(label) },
        readOnly = true,
        trailingIcon = {
            if (timeMs != null) {
                Icon(Icons.Filled.AccessTime, null)
            } else {
                Text("--:--", color = ColorTextoMuted, modifier = Modifier.padding(end = 12.dp))
            }
        },
        modifier = modifier.clickable { onClick() },
        enabled = false,
        colors = OutlinedTextFieldDefaults.colors(
            disabledTextColor = ColorTexto,
            disabledBorderColor = ColorBorde,
            disabledTrailingIconColor = ColorPrimario,
            disabledLabelColor = ColorTextoSec
        )
    )
}
