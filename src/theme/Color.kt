package com.equiptrack.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

// ── Colores base (planos y opacos — diseño industrial) ──
val ColorFondo     = Color(0xFFF8F9FA) // Extra light gray
val ColorSuperficie  = Color(0xFFFFFFFF) // Pure white for better contrast
val ColorBorde     = Color(0xFFDDE1E6)

// ── Azules interactivos y vibrantes (primarios) ──
val ColorPrimario   = Color(0xFF0F52BA) // Zafiro brillante / Eléctrico interactivo
val ColorPrimarioClaro = Color(0xFF4C81DF)
val ColorPrimarioPale = Color(0xFFE5F0FF)

// ── Texto ──
val ColorTexto     = Color(0xFF1A2332)
val ColorTextoSec   = Color(0xFF5A6473)
val ColorTextoMuted  = Color(0xFF8A939E)

// ── Estados de equipos ──
val ColorOperativo   = Color(0xFF3D7A4F)
val ColorMantenimiento = Color(0xFF8B6914)
val ColorFueraServicio = Color(0xFFB03030)
val ColorVerdeOscuro   = Color(0xFF1E5631)

// ── Compatibilidad ──
val ColorCalibracion  = Color(0xFF2E6DA4)
val ColorEnBA     = Color(0xFF5C3D7A)
val ColorEnTransito  = Color(0xFF7A4F1A)
val ColorSlotVacio   = Color(0xFF5A6473)
val ColorBaja     = Color(0xFF555555)

// ── Materiales y Extras ──
val ColorMaterial   = Color(0xFF673AB7) // Deep Purple
val ColorMaterialFondo = Color(0xFFEDE7F6)
val ColorMaterialDark = Color(0xFFB39DDB)

// ── Alertas (Premium Soft) ──
val ColorAlertaRoja  = Color(0xFFD34545)
val ColorAlertaNaranja = Color(0xFFD67D3E)
val ColorAlertaAzul  = Color(0xFF3F72AF)

// ── Fondos de chips y badges (Premium Soft) ──
val ColorOperativoFondo   = Color(0xFFDDF0E3)
val ColorMantenimientoFondo = Color(0xFFF2E6C9)
val ColorFueraServicioFondo = Color(0xFFF7D9D9)
val ColorCalibracionFondo  = Color(0xFFDDE6EF)
val ColorEnBAFondo     = Color(0xFFE6DDF0)
val ColorEnTransitoFondo  = Color(0xFFF5E9D3)
val ColorAlertaRojaFondo  = Color(0xFFF7D9D9)
val ColorAlertaNaranjaFondo = Color(0xFFF9E8D1)
val ColorAlertaAzulFondo  = Color(0xFFD5E4F7)
val ColorSlotVacioFondo   = Color(0xFFE2E6E9)
val ColorBajaFondo     = Color(0xFFE0E0E0)

// ── Prioridades (Premium Soft) ──
val ColorPrioridadCritica   = Color(0xFFAA3333)
val ColorPrioridadCriticaFondo = Color(0xFFF7D9D9)
val ColorPrioridadAlta     = Color(0xFFA57321)
val ColorPrioridadAltaFondo  = Color(0xFFF4E5CA)
val ColorPrioridadMedia    = Color(0xFF3B7A3B)
val ColorPrioridadMediaFondo  = Color(0xFFD8EAD8)
val ColorPrioridadBaja     = Color(0xFF4C5D70)
val ColorPrioridadBajaFondo  = Color(0xFFD5DFE8)

// ── Dark Mode — constantes raw ──
val ColorFondoDark     = Color(0xFF000000) // OLED pure black
val ColorSuperficieDark  = Color(0xFF121212) // Material dark surface
val ColorFondoTarjetaDark = Color(0xFF1E1E1E) // For elevated cards
val ColorBordeDark     = Color(0xFF30363D)
val ColorPrimarioDark   = Color(0xFFC87A20)
val ColorTextoDark     = Color(0xFFE6EDF3)
val ColorTextoSecDark   = Color(0xFF8B949E)
val ColorTextoMutedDark  = Color(0xFF5A6B7E)
val ColorOperativoDark   = Color(0xFF3FB950)
val ColorMantenimientoDark = Color(0xFFD29922)
val ColorFueraServicioDark = Color(0xFFF85149)
val ColorAlertaRojaDark  = Color(0xFFF85149)
val ColorAlertaNaranjaDark = Color(0xFFDB6D28)
val ColorEnBADark     = Color(0xFF8B949E)

// ── Blanco para texto sobre fondos oscuros ──
val ColorBlanco = Color(0xFFFFFFFF)

// ══════════════════════════════════════════════════════════
// AppColors — tokens resueltos según tema (claro / oscuro)
// ══════════════════════════════════════════════════════════

@Immutable
data class AppColors(
  val fondo: Color,
  val superficie: Color,
  val borde: Color,
  val primario: Color,
  val texto: Color,
  val textoSec: Color,
  val textoMuted: Color,
  val operativo: Color,
  val mantenimiento: Color,
  val fueraServicio: Color,
  val alertaRoja: Color,
  val alertaNaranja: Color,
  val enBA: Color,
  val material: Color,
  val isDark: Boolean
)

fun lightAppColors() = AppColors(
  fondo     = ColorFondo,
  superficie  = ColorSuperficie,
  borde     = ColorBorde,
  primario   = ColorPrimario,
  texto     = ColorTexto,
  textoSec   = ColorTextoSec,
  textoMuted  = ColorTextoMuted,
  operativo   = ColorOperativo,
  mantenimiento = ColorMantenimiento,
  fueraServicio = ColorFueraServicio,
  alertaRoja  = ColorAlertaRoja,
  alertaNaranja = ColorAlertaNaranja,
  enBA     = ColorEnBA,
  material  = ColorMaterial,
  isDark    = false
)

fun darkAppColors() = AppColors(
  fondo     = ColorFondoDark,
  superficie  = ColorFondoTarjetaDark,
  borde     = ColorBordeDark,
  primario   = ColorPrimarioDark,
  texto     = ColorTextoDark,
  textoSec   = ColorTextoSecDark,
  textoMuted  = ColorTextoMutedDark,
  operativo   = ColorOperativoDark,
  mantenimiento = ColorMantenimientoDark,
  fueraServicio = ColorFueraServicioDark,
  alertaRoja  = ColorAlertaRojaDark,
  alertaNaranja = ColorAlertaNaranjaDark,
  enBA     = ColorEnBADark,
  material  = ColorMaterialDark,
  isDark    = true
)

/** Accede a los colores del tema activo desde cualquier composable */
val LocalAppColors = compositionLocalOf { lightAppColors() }
