package com.equiptrack.ui.screens.horas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.equiptrack.ui.theme.*
import com.equiptrack.utils.CalculoSalarialUtil
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HorasAnalyticsScreen(
    onNavigateBack: () -> Unit,
    viewModel: HorasTrabajoViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val estimate = uiState.salaryEstimate
    
    var showSettingsDialog by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.sueldoBasico) {
        if (uiState.sueldoBasico <= 0.0) {
            showSettingsDialog = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Proyección Salarial") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Volver")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = ColorFondo,
                    titleContentColor = ColorTexto
                ),
                actions = {
                    IconButton(onClick = { showSettingsDialog = true }) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Configurar Salario")
                    }
                }
            )
        },
        containerColor = ColorFondo
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            // -- DATE HEADER (Navegable) — always shown even with no data --
            val mesStr = SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(
                Calendar.getInstance().apply {
                    set(Calendar.MONTH, uiState.mesSeleccionado)
                    set(Calendar.YEAR, uiState.anioSeleccionado)
                }.time
            ).replaceFirstChar { it.uppercase() }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = { viewModel.cambiarMes(-1) }) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Mes anterior", tint = ColorPrimario)
                }
                Text(
                    text = "Período 21 al 20 • $mesStr",
                    style = MaterialTheme.typography.titleSmall,
                    color = ColorTextoSec
                )
                IconButton(onClick = { viewModel.cambiarMes(1) }) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Mes siguiente", tint = ColorPrimario)
                }
            }

            if (estimate == null) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(top = 64.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Sin registros para este período",
                        style = MaterialTheme.typography.bodyMedium,
                        color = ColorTextoSec
                    )
                }
            } else {

            // -- HERO CARD: NETO ESTIMADO --
            NetoHeroCard(estimate = estimate)

            Spacer(modifier = Modifier.height(24.dp))

            // -- MINI CARDS: HORAS --
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                HoraMiniCard("Normales", estimate.totalNormales, ColorPrimarioPale, ColorPrimario, Modifier.weight(1f))
                HoraMiniCard("50%", estimate.totalExtra50, ColorOperativoFondo, ColorOperativo, Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                HoraMiniCard("100%", estimate.totalExtra100, ColorMantenimientoFondo, ColorMantenimiento, Modifier.weight(1f))
                val viajeColor = Color(0xFF673AB7)
                HoraMiniCard("Viaje", estimate.totalViaje, viajeColor.copy(alpha = 0.1f), viajeColor, Modifier.weight(1f))
            }

            Spacer(modifier = Modifier.height(24.dp))

            // -- VISUAL CHARTS --
            Text(
                text = "Distribución Operativa",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = ColorTextoSec,
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp)
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                // Chart 1: Base vs Campo
                val totalDias = estimate.diasBase + estimate.diasCampo
                val campoPct = if (totalDias > 0) estimate.diasCampo.toFloat() / totalDias else 0f
                DonutChart(
                    percentage = campoPct * 100,
                    label = "Días Campo",
                    subLabel = "${estimate.diasCampo}/${totalDias}",
                    color = ColorOperativo
                )

                // Chart 2: Normal vs Extra
                val totalHs = estimate.totalNormales + estimate.totalExtra50 + estimate.totalExtra100
                val extraPct = if (totalHs > 0) (estimate.totalExtra50 + estimate.totalExtra100).toFloat() / totalHs.toFloat() else 0f
                DonutChart(
                    percentage = extraPct * 100,
                    label = "Hs Extras",
                    subLabel = String.format(Locale.US, "%.0f%%", extraPct * 100),
                    color = ColorMantenimiento
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // -- FRANCOS COMPENSATORIOS SUMMARY --
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = androidx.compose.foundation.BorderStroke(1.dp, ColorBorde)
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Francos Compensatorios Disponibles", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold, color = ColorTexto)
                        Text("Disponibles de guardias fin de semana", style = MaterialTheme.typography.bodySmall, color = ColorTextoSec)
                    }
                    Text(
                        text = uiState.francosCompensatoriosDisponibles.toString(),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = ColorAlertaNaranja
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // -- EXPANDABLE BREAKDOWN --
            Text(
                text = "Desglose Salarial",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = ColorTextoSec,
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)
            )
            
            // Concepts
            BreakdownSection("1. Conceptos Fijos", formatMoney(estimate.subtotalFijos)) {
                BreakdownRow("Sueldo Básico Configur.", formatMoney(uiState.sueldoBasico))
                BreakdownRow("Otros Fijos (Antig. y Actas)", formatMoney(estimate.subtotalFijos - uiState.sueldoBasico))
            }
            
            BreakdownSection("2. Conceptos Variables", formatMoney(estimate.subtotalVariables)) {
                val horaBase = uiState.sueldoBasico / 147.78
                BreakdownRow("Horas viaje", formatMoney(estimate.totalViaje * (horaBase * 0.47)))
                BreakdownRow("Extras 50%", formatMoney(estimate.totalExtra50 * (horaBase * 1.5)))
                BreakdownRow("Extras 100%", formatMoney(estimate.totalExtra100 * (horaBase * 2.0)))
                BreakdownRow("Proy. Desarraigo", formatMoney(estimate.diasCampo * 16000.0))
            }

            BreakdownSection("3. No Remunerativos (Sin Desc.)", formatMoney(estimate.subtotalNoRemunerativo)) {
                BreakdownRow("Proy. Viandas/Desayuno", formatMoney((estimate.diasTrabajados * 32400.0) + (estimate.diasCampo * 16900.0) + (estimate.diasTrabajados * 4756.0)))
                BreakdownRow("Otros (Fijos + Vaca Muerta)", formatMoney(380000.0 + 493661.0))
            }

            BreakdownSection("4. Retenciones Ley y Ganancias", "-${formatMoney(estimate.retenciones)}", isNegative = true) {
                BreakdownRow("Jubilación/Obra Social/Mutual", "-${formatMoney(estimate.retenciones * 0.9)}") // Approximate split for visualization
                BreakdownRow("Ganancias (Aprox)", "-${formatMoney(estimate.retenciones * 0.1)}")
            }
            
            Spacer(modifier = Modifier.height(40.dp))
            } // end else (estimate != null)
        }
    }

    if (showSettingsDialog) {
        var sueldoStr by remember { mutableStateOf(if (uiState.sueldoBasico <= 0.0) "" else uiState.sueldoBasico.toLong().toString()) }

        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            title = { Text("Configuración Salarial") },
            text = {
                Column {
                    Text("Ingresá el Sueldo Básico vigente de Paritarias para re-calcular las Proyecciones.", style = MaterialTheme.typography.bodyMedium, color = ColorTextoSec)
                    Spacer(modifier = Modifier.height(16.dp))
                    OutlinedTextField(
                        value = sueldoStr,
                        onValueChange = { newValue -> 
                            if (newValue.isEmpty() || newValue.all { it.isDigit() }) {
                                sueldoStr = newValue
                            }
                        },
                        label = { Text("Sueldo Básico") },
                        leadingIcon = { Text("$", color = ColorTextoSec, modifier = Modifier.padding(start = 12.dp)) },
                        singleLine = true,
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    sueldoStr.toDoubleOrNull()?.let {
                        viewModel.setSueldoBasico(it)
                    }
                    showSettingsDialog = false
                }) { Text("Guardar") }
            },
            dismissButton = {
                TextButton(onClick = { showSettingsDialog = false }) { Text("Cancelar") }
            }
        )
    }
}

@Composable
fun NetoHeroCard(estimate: CalculoSalarialUtil.SalaryEstimate) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(containerColor = ColorPrimario),
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.cardElevation(8.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "NETO ESTIMADO",
                style = MaterialTheme.typography.labelLarge,
                color = ColorBlanco.copy(alpha = 0.8f),
                letterSpacing = 2.sp
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = formatMoney(estimate.netoEstimado),
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Bold,
                color = ColorBlanco
            )
            
            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider(color = ColorBlanco.copy(alpha = 0.2f))
            Spacer(modifier = Modifier.height(16.dp))
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Valor Hora Promedio", style = MaterialTheme.typography.labelSmall, color = ColorBlanco.copy(alpha = 0.7f))
                    val totalHs = estimate.totalNormales + estimate.totalExtra50 + estimate.totalExtra100
                    val vhProm = if (totalHs > 0) estimate.netoEstimado / totalHs else 0.0
                    Text(formatMoney(vhProm), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = ColorBlanco)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Hs Activas", style = MaterialTheme.typography.labelSmall, color = ColorBlanco.copy(alpha = 0.7f))
                    val totalHs = estimate.totalNormales + estimate.totalExtra50 + estimate.totalExtra100
                    Text("${totalHs}h", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = ColorBlanco)
                }
            }
            
            Text(
                text = "Los cálculos son estimaciones según la estructura CCT 637/11.\nEl valor real lo emite RRHH.",
                style = MaterialTheme.typography.labelSmall,
                color = ColorBlanco.copy(alpha = 0.5f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp)
            )
        }
    }
}

@Composable
fun HoraMiniCard(title: String, horas: Double, bgColor: Color, fgColor: Color, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = bgColor,
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                color = fgColor.copy(alpha = 0.8f)
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = String.format(Locale.US, "%.1f hs", horas),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = fgColor
            )
        }
    }
}

@Composable
fun DonutChart(
    percentage: Float,
    label: String,
    subLabel: String,
    color: Color
) {
    Box(
        modifier = Modifier.size(120.dp),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.size(100.dp)) {
            val strokeWidth = 12.dp.toPx()
            // Backgound Track
            drawArc(
                color = color.copy(alpha = 0.2f),
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                style = Stroke(strokeWidth, cap = StrokeCap.Round)
            )
            // Foreground Progress
            drawArc(
                color = color,
                startAngle = -90f,
                sweepAngle = (percentage / 100f) * 360f,
                useCenter = false,
                style = Stroke(strokeWidth, cap = StrokeCap.Round)
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text = subLabel, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = ColorTexto)
            Text(text = label, style = MaterialTheme.typography.labelSmall, color = ColorTextoSec)
        }
    }
}

@Composable
fun BreakdownSection(
    title: String,
    amount: String,
    isNegative: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    var isExpanded by remember { mutableStateOf(false) }
    
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable { isExpanded = !isExpanded },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, ColorBorde)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                    color = ColorTexto
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = amount,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Bold,
                        color = if (isNegative) ColorMantenimiento else ColorTexto
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Icon(
                        imageVector = if (isExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = "Expandir",
                        tint = ColorTextoSec
                    )
                }
            }
            
            AnimatedVisibility(visible = isExpanded) {
                Column(modifier = Modifier.padding(top = 16.dp)) {
                    content()
                }
            }
        }
    }
}

@Composable
fun BreakdownRow(label: String, amount: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium, color = ColorTextoSec)
        Text(text = amount, style = MaterialTheme.typography.bodyMedium, color = ColorTextoSec)
    }
}

private fun formatMoney(value: Double): String {
    val format = NumberFormat.getCurrencyInstance(Locale("es", "AR"))
    return format.format(value)
}
