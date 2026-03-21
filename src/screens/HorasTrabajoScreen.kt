package com.equiptrack.ui.screens.horas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.compose.ui.graphics.graphicsLayer
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import com.equiptrack.ui.theme.*
import com.equiptrack.utils.ExcelHorasGenerator
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HorasTrabajoScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAnalytics: () -> Unit,
    viewModel: HorasTrabajoViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val proyectosActivos by viewModel.nombresProyectosActivos.collectAsStateWithLifecycle()
    var showDialog by remember { mutableStateOf(false) }
    var showHistorialExportaciones by remember { mutableStateOf(false) }
    var selectedRegistro by remember { mutableStateOf<HorasTrabajoEntity?>(null) }
    var expandRegistros by remember { mutableStateOf(false) }

    // Defaulting to today if modifying nothing
    var initialDateMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Planilla de Horas") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    IconButton(onClick = { showHistorialExportaciones = true }) {
                        Icon(Icons.Filled.List, contentDescription = "Historial de Exportaciones")
                    }
                    IconButton(onClick = onNavigateToAnalytics) {
                        Icon(Icons.Filled.Analytics, contentDescription = "Ver Estadísticas y Proyección Salarial")
                    }
                    IconButton(onClick = {
                        val file = ExcelHorasGenerator.generarExcelHoras(
                            context = context,
                            mes = uiState.mesSeleccionado,
                            anio = uiState.anioSeleccionado,
                            registros = uiState.registrosMesActual
                        )
                        if (file != null) {
                            val uri = FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file
                            )
                            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            context.startActivity(android.content.Intent.createChooser(intent, "Compartir Excel"))
                        } else {
                            android.widget.Toast.makeText(context, "Error al generar el Excel.", android.widget.Toast.LENGTH_SHORT).show()
                        }
                    }) {
                        Icon(Icons.Filled.Download, contentDescription = "Exportar a Excel")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = ColorFondo,
                    titleContentColor = ColorTexto
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    initialDateMs = System.currentTimeMillis()
                    selectedRegistro = null
                    showDialog = true
                },
                containerColor = ColorPrimario
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Nuevo Registro", tint = ColorBlanco)
            }
        },
        containerColor = ColorFondo
    ) { paddingValues ->
        // Animación de entrada
        var visible by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { visible = true }
        val enterAlpha by animateFloatAsState(
            targetValue = if (visible) 1f else 0f,
            animationSpec = tween(400, easing = FastOutSlowInEasing), label = "horas_alpha"
        )
        val enterOffset by animateDpAsState(
            targetValue = if (visible) 0.dp else 30.dp,
            animationSpec = tween(400, easing = FastOutSlowInEasing), label = "horas_offset"
        )

        Column(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .graphicsLayer { alpha = enterAlpha }
                .offset(y = enterOffset)
        ) {
            // Month Selector
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { viewModel.cambiarMes(-1) }) {
                    Icon(Icons.Filled.ChevronLeft, "Mes Anterior")
                }
                val calActual = Calendar.getInstance().apply {
                    set(Calendar.MONTH, uiState.mesSeleccionado)
                    set(Calendar.YEAR, uiState.anioSeleccionado)
                }
                val calAnterior = Calendar.getInstance().apply {
                    set(Calendar.MONTH, uiState.mesSeleccionado)
                    set(Calendar.YEAR, uiState.anioSeleccionado)
                    add(Calendar.MONTH, -1)
                }
                
                val formatMes = SimpleDateFormat("MMMM", Locale.getDefault())
                val mesAnteriorStr = formatMes.format(calAnterior.time).replaceFirstChar { it.uppercase() }
                val mesActualStr = formatMes.format(calActual.time).replaceFirstChar { it.uppercase() }
                val añoStr = calActual.get(Calendar.YEAR)
                
                val mesStr = "$mesAnteriorStr - $mesActualStr $añoStr"
                
                Text(
                    text = mesStr,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                
                IconButton(onClick = { viewModel.cambiarMes(1) }) {
                    Icon(Icons.Filled.ChevronRight, "Mes Siguiente")
                }
            }

            // Summary Cards
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                val diasTrabajados = uiState.registrosMesActual.count { it.lugarTrabajo != "Franco" }
                SummaryCard(
                    title = "Días Activos",
                    value = "$diasTrabajados",
                    icon = Icons.Filled.Event,
                    modifier = Modifier.weight(1f)
                )

                // Horas Totales
                val horasTotales = uiState.registrosMesActual.sumOf { reg ->
                    val inicio = calcularHoras(reg.entradaInicioMs, reg.salidaInicioMs, reg.lugarTrabajo)
                    val fin = calcularHoras(reg.entradaFinMs, reg.salidaFinMs, reg.lugarTrabajo)
                    inicio + fin
                }
                
                SummaryCard(
                    title = "Hs. Totales",
                    value = String.format(Locale.US, "%.1f", horasTotales),
                    icon = Icons.Filled.AccessTime,
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            AnimatedVisibility(visible = !expandRegistros) {
                Column {
                    // -- NEW INTERACTIVE CALENDAR (21 to 20) --
                    val calDates = mutableListOf<Long>()
                    val calLoop = Calendar.getInstance().apply {
                        set(Calendar.YEAR, uiState.anioSeleccionado)
                        set(Calendar.MONTH, uiState.mesSeleccionado)
                        add(Calendar.MONTH, -1) // Go to previous month
                        set(Calendar.DAY_OF_MONTH, 21)
                        set(Calendar.HOUR_OF_DAY, 12)
                    }
                    while (true) {
                        if (calLoop.get(Calendar.MONTH) == uiState.mesSeleccionado && calLoop.get(Calendar.DAY_OF_MONTH) == 21) {
                            break
                        }
                        calDates.add(calLoop.timeInMillis)
                        calLoop.add(Calendar.DAY_OF_MONTH, 1)
                    }

                    Text(
                        text = "Calendario del Período",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = ColorTextoSec,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )

                    val rows = calDates.chunked(7)
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        rows.forEach { week ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                for (i in 0 until 7) {
                                    if (i < week.size) {
                                        val dateMs = week[i]
                                        val calDay = Calendar.getInstance().apply { timeInMillis = dateMs }
                                        val dayNum = calDay.get(Calendar.DAY_OF_MONTH)
                                        
                                        val reg = uiState.registrosMesActual.find { r ->
                                            val cr = Calendar.getInstance().apply { timeInMillis = r.fechaMs }
                                            cr.get(Calendar.YEAR) == calDay.get(Calendar.YEAR) &&
                                            cr.get(Calendar.DAY_OF_YEAR) == calDay.get(Calendar.DAY_OF_YEAR)
                                        }

                                        CalendarDayItem(
                                            dateMs = dateMs,
                                            dayNum = dayNum,
                                            registro = reg,
                                            modifier = Modifier.weight(1f),
                                            onClick = {
                                                selectedRegistro = reg
                                                initialDateMs = dateMs
                                                showDialog = true
                                            }
                                        )
                                    } else {
                                        Spacer(modifier = Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))
                    HorizontalDivider(color = ColorBorde)
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expandRegistros = !expandRegistros }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Registros Detallados",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = ColorTextoSec,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    imageVector = if (expandRegistros) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    contentDescription = "Expandir/Colapsar",
                    tint = ColorTextoSec
                )
            }

            // List of Registros
            AnimatedVisibility(visible = expandRegistros) {
                if (uiState.registrosMesActual.isEmpty()) {
                    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        Text("No hay horas registradas en este mes", color = ColorTextoMuted)
                    }
                } else {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(PaddingValues(start = 16.dp, end = 16.dp, bottom = 80.dp)),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.registrosMesActual.sortedBy { it.fechaMs }.forEach { registro ->
                            RegistroCard(
                                registro = registro,
                                onClick = {
                                    selectedRegistro = registro
                                    initialDateMs = registro.fechaMs
                                    showDialog = true
                                },
                                onDelete = { viewModel.borrarRegistro(registro.id) }
                            )
                        }
                    }
                }
            }
            // Explicit bottom spacer so scrolling can push the content above the FAB and Nav bar
            Spacer(modifier = Modifier.height(100.dp))
        }
    }

    if (showDialog) {
        RegistroHorasDialog(
            registroEdicion = selectedRegistro,
            initialDateMs = initialDateMs,
            proyectosSugeridos = proyectosActivos,
            onDismiss = { showDialog = false },
            onSave = { fechaMs, eInst, sInst, eFin, sFin, lugar, pernocte, maneja, horasViaje, esFeriado, esFrancoCompensatorio, esFrancoTrabajado, obs ->
                viewModel.guardarRegistro(
                    fechaMs, eInst, sInst, eFin, sFin, lugar, pernocte, maneja, horasViaje, esFeriado, esFrancoCompensatorio, esFrancoTrabajado, obs, selectedRegistro?.id
                )
                showDialog = false
            }
        )
    }

    if (showHistorialExportaciones) {
        HistorialExportacionesDialog(
            context = context,
            onDismiss = { showHistorialExportaciones = false }
        )
    }
}

@Composable
fun SummaryCard(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, ColorBorde)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(icon, contentDescription = null, tint = ColorPrimario)
            Spacer(modifier = Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.bodySmall, color = ColorTextoSec)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = ColorTexto)
        }
    }
}

@Composable
fun CalendarDayItem(
    dateMs: Long,
    dayNum: Int,
    registro: HorasTrabajoEntity?,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val cal = Calendar.getInstance().apply { timeInMillis = dateMs }
    val isWeekend = cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY

    val bgColor = when {
        registro == null -> if (isWeekend) Color(0xFFF0F0F0) else ColorFondo // Light gray for empty weekends
        registro.lugarTrabajo == "Franco" && !registro.esFrancoCompensatorio -> ColorFueraServicioFondo
        registro.lugarTrabajo == "Franco" && registro.esFrancoCompensatorio -> ColorAlertaNaranjaFondo // Naranja para compensatorio
        registro.esFrancoTrabajado -> ColorPrimarioPale // Weekend worked
        else -> ColorOperativoFondo
    }
    
    val borderColor = when {
        registro == null -> ColorBorde
        registro.lugarTrabajo == "Franco" && !registro.esFrancoCompensatorio -> ColorFueraServicio.copy(alpha = 0.5f)
        registro.lugarTrabajo == "Franco" && registro.esFrancoCompensatorio -> ColorAlertaNaranja.copy(alpha = 0.5f)
        registro.esFrancoTrabajado -> ColorPrimario.copy(alpha = 0.5f)
        else -> ColorOperativo.copy(alpha = 0.5f)
    }

    val textColor = when {
        registro == null -> if (isWeekend) ColorTextoSec else ColorTexto
        registro.lugarTrabajo == "Franco" && !registro.esFrancoCompensatorio -> ColorFueraServicio
        registro.lugarTrabajo == "Franco" && registro.esFrancoCompensatorio -> ColorAlertaNaranja
        registro.esFrancoTrabajado -> ColorPrimario
        else -> ColorOperativo
    }

    Surface(
        shape = RoundedCornerShape(8.dp),
        color = bgColor,
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
        modifier = modifier
            .aspectRatio(1f)
            .clickable(onClick = onClick)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val dayColor = if (isWeekend) Color(0xFFE53935) else textColor
                Text(
                    text = dayNum.toString(),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = dayColor
                )
                if (registro != null) {
                    val label = if (registro.lugarTrabajo == "Franco" && !registro.esFrancoCompensatorio) "Fr" 
                                else if (registro.lugarTrabajo == "Franco") "Fr(C)"
                                else "${(calcularHoras(registro.entradaInicioMs, registro.salidaInicioMs, registro.lugarTrabajo) + calcularHoras(registro.entradaFinMs, registro.salidaFinMs, registro.lugarTrabajo)).toInt()}"
                    Text(
                        text = if (label.startsWith("Fr")) label else "${label}h",
                        style = MaterialTheme.typography.labelSmall,
                        color = textColor,
                        textAlign = TextAlign.Center
                    )
                }
            }
            // Small badge for pernocte/maneja
            if (registro != null) {
                Row(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    if (registro.maneja) {
                        Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(ColorPrimario))
                    }
                    if (registro.pernocte != "NO") {
                        Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(ColorMantenimiento))
                    }
                }
            }
        }
    }
}

@Composable
fun RegistroCard(
    registro: HorasTrabajoEntity,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    val dfDia = SimpleDateFormat("dd", Locale.getDefault())
    val dfDiaSem = SimpleDateFormat("E", Locale.getDefault())

    val totalDayHours = calcularHoras(registro.entradaInicioMs, registro.salidaInicioMs, registro.lugarTrabajo) + 
                        calcularHoras(registro.entradaFinMs, registro.salidaFinMs, registro.lugarTrabajo)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, ColorBorde)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Fecha
            val cal = Calendar.getInstance().apply { timeInMillis = registro.fechaMs }
            val isWeekend = cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY
            val badgeBgColor = if (isWeekend) Color(0xFFFFEBEE) else ColorPrimarioPale
            val badgeTextColor = if (isWeekend) Color(0xFFE53935) else ColorPrimario

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(badgeBgColor)
                    .padding(8.dp)
                    .width(40.dp)
            ) {
                Text(dfDiaSem.format(Date(registro.fechaMs)).take(3).uppercase(), style = MaterialTheme.typography.labelSmall, color = badgeTextColor)
                Text(dfDia.format(Date(registro.fechaMs)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = badgeTextColor)
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            // Detalles
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(registro.lugarTrabajo, fontWeight = FontWeight.Bold, color = ColorTexto)

                    if (registro.esFrancoCompensatorio) {
                        Spacer(Modifier.width(8.dp))
                        Badge(containerColor = ColorAlertaNaranja) { Text("Comp.", color = ColorBlanco) }
                    }
                    if (registro.esFeriado) {
                        Spacer(Modifier.width(8.dp))
                        Badge(containerColor = ColorFueraServicio) { Text("Feriado", color = ColorBlanco) }
                    }
                    if (registro.esFrancoTrabajado) {
                        Spacer(Modifier.width(8.dp))
                        Badge(containerColor = ColorPrimario) { Text("Trabajado", color = ColorBlanco) }
                    }

                    if (registro.maneja) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(Icons.Filled.DirectionsCar, null, tint = ColorOperativo, modifier = Modifier.size(16.dp))
                    }
                    if (registro.pernocte != "NO") {
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(Icons.Filled.Hotel, null, tint = ColorTextoSec, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(registro.pernocte, style = MaterialTheme.typography.labelSmall, color = ColorTextoSec)
                    }
                }
                
                Spacer(modifier = Modifier.height(4.dp))
                
                val turnosData = mutableListOf<String>()
                if (registro.entradaInicioMs != null && registro.salidaInicioMs != null) {
                    turnosData.add("${formatHora(registro.entradaInicioMs)} - ${formatHora(registro.salidaInicioMs)}")
                }
                if (registro.entradaFinMs != null && registro.salidaFinMs != null) {
                    turnosData.add("${formatHora(registro.entradaFinMs)} - ${formatHora(registro.salidaFinMs)}")
                }
                
                
                if (turnosData.isNotEmpty()) {
                    Text(turnosData.joinToString(" | "), style = MaterialTheme.typography.bodySmall, color = ColorTextoMuted)
                }
            }
            
            // Horas
            Column(horizontalAlignment = Alignment.End) {
                Text(totalDayHours.toInt().toString(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("hs", style = MaterialTheme.typography.labelSmall, color = ColorTextoMuted)
            }
        }
    }
}

private fun calcularHoras(inicioMs: Long?, finMs: Long?, lugar: String): Double {
    if (inicioMs == null || finMs == null) return 0.0
    var diff = finMs - inicioMs
    if (diff < 0) {
        // Handle next-day split implicitly just for duration (24h rollover)
        diff += 24 * 60 * 60 * 1000L
    }
    var hsBrutas = diff / (1000.0 * 60 * 60)
    
    if (lugar == "Base" && hsBrutas > 4.0) {
        hsBrutas -= 1.0
    }
    return Math.round(hsBrutas).toDouble()
}

private fun formatHora(ms: Long): String {
    return SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}

@Composable
fun HistorialExportacionesDialog(
    context: android.content.Context,
    onDismiss: () -> Unit
) {
    var files by remember { mutableStateOf(ExcelHorasGenerator.getExportedFiles(context)) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Historial de Planillas") },
        text = {
            if (files.isEmpty()) {
                Box(modifier = Modifier.fillMaxWidth().height(100.dp), contentAlignment = Alignment.Center) {
                    Text("No hay planillas guardadas.", color = ColorTextoMuted)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(files, key = { it.absolutePath }) { file ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = androidx.compose.foundation.BorderStroke(1.dp, ColorBorde)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = file.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = ColorTexto
                                    )
                                    Text(
                                        text = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).format(Date(file.lastModified())),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = ColorTextoSec
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.End) {
                                    IconButton(onClick = {
                                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                            type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                            putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                        }
                                        context.startActivity(android.content.Intent.createChooser(intent, "Compartir Excel"))
                                    }) {
                                        Icon(Icons.Filled.Share, contentDescription = "Compartir", tint = ColorPrimario)
                                    }
                                    IconButton(onClick = {
                                        if (ExcelHorasGenerator.deleteExportedFile(file)) {
                                            files = ExcelHorasGenerator.getExportedFiles(context)
                                        }
                                    }) {
                                        Icon(Icons.Filled.Delete, contentDescription = "Eliminar", tint = ColorMantenimiento)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Cerrar")
            }
        }
    )
}
