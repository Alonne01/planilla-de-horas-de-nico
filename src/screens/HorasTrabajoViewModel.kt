package com.equiptrack.ui.screens.horas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import com.equiptrack.data.repository.HorasTrabajoRepository
import com.equiptrack.data.repository.TrabajoRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import java.util.Calendar
import java.util.UUID
import javax.inject.Inject

import com.equiptrack.utils.CalculoSalarialUtil
import com.equiptrack.utils.CalculoSalarialUtil.SalaryEstimate
import android.content.Context
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext

data class HorasTrabajoUiState(
    val registrosMesActual: List<HorasTrabajoEntity> = emptyList(),
    val mesSeleccionado: Int = Calendar.getInstance().get(Calendar.MONTH),
    val anioSeleccionado: Int = Calendar.getInstance().get(Calendar.YEAR),
    val isLoading: Boolean = false,
    val sueldoBasico: Double = 1705258.43,
    val salaryEstimate: SalaryEstimate? = null,
    val francosCompensatoriosDisponibles: Int = 0
)



private val Context.salaryPref by preferencesDataStore("salary_prefs")

@HiltViewModel
class HorasTrabajoViewModel @Inject constructor(
    private val horasRepo: HorasTrabajoRepository,
    private val trabajoRepo: TrabajoRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val KEY_SUELDO_BASICO = doublePreferencesKey("sueldo_basico")

    private val _uiState = MutableStateFlow(HorasTrabajoUiState())
    val uiState: StateFlow<HorasTrabajoUiState> = _uiState.asStateFlow()

    val nombresProyectosActivos: StateFlow<List<String>> = trabajoRepo.getAllTrabajos()
        .map { trabajos ->
            trabajos.filter { it.estadoGeneral in listOf("en_curso", "preparacion") }
                .map { it.nombre }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        // Cargar sueldo base desde datastore antes de calcular
        viewModelScope.launch {
            context.salaryPref.data.map { preferences ->
                preferences[KEY_SUELDO_BASICO] ?: 1705258.43
            }.collect { basico ->
                _uiState.update { it.copy(sueldoBasico = basico) }
                // Recalcular el estimado existente con el nuevo básico
                recargarSueldo()
            }
        }

        viewModelScope.launch {
            horasRepo.getAllRegistros().collect { todos ->
                val ganados = todos.count { it.esFrancoTrabajado }
                val usados = todos.count { it.esFrancoCompensatorio }
                _uiState.update { it.copy(francosCompensatoriosDisponibles = ganados - usados) }
            }
        }

        cargarRegistrosDelMes(_uiState.value.mesSeleccionado, _uiState.value.anioSeleccionado)
    }

    fun setSueldoBasico(nuevoSueldo: Double) {
        viewModelScope.launch {
            context.salaryPref.edit { prefs ->
                prefs[KEY_SUELDO_BASICO] = nuevoSueldo
            }
        }
    }

    private fun recargarSueldo() {
        val state = _uiState.value
        if (state.registrosMesActual.isNotEmpty()) {
            val estimate = CalculoSalarialUtil.calcularSueldoMensual(state.registrosMesActual, state.sueldoBasico)
            _uiState.update { it.copy(salaryEstimate = estimate) }
        } else {
            _uiState.update { it.copy(salaryEstimate = null) }
        }
    }

    fun cambiarMes(delta: Int) {
        val actual = _uiState.value
        var nuevoMes = actual.mesSeleccionado + delta
        var nuevoAnio = actual.anioSeleccionado
        if (nuevoMes > 11) {
            nuevoMes = 0
            nuevoAnio++
        } else if (nuevoMes < 0) {
            nuevoMes = 11
            nuevoAnio--
        }
        _uiState.update { it.copy(mesSeleccionado = nuevoMes, anioSeleccionado = nuevoAnio) }
        cargarRegistrosDelMes(nuevoMes, nuevoAnio)
    }

    private var cargarRegistrosJob: Job? = null

    private fun cargarRegistrosDelMes(mes: Int, anio: Int) {
        cargarRegistrosJob?.cancel()
        cargarRegistrosJob = viewModelScope.launch {
            // Un "mes de planilla" va desde el 21 del mes ANTERIOR al 20 del mes ACTUAL.
            // Ej: "Marzo 2026" (mes=2, anio=2026) -> 21 Feb 2026 a 20 Mar 2026.
            
            val cal = Calendar.getInstance().apply {
                set(Calendar.YEAR, anio)
                set(Calendar.MONTH, mes)
                
                // Vamos al mes anterior
                add(Calendar.MONTH, -1)
                
                // Día 21 a las 00:00:00
                set(Calendar.DAY_OF_MONTH, 21)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val inicioMs = cal.timeInMillis

            // Ahora el fin es el día 20 del mes actual a las 23:59:59
            cal.add(Calendar.MONTH, 1) // Volvemos al mes seleccionado
            cal.set(Calendar.DAY_OF_MONTH, 20)
            cal.set(Calendar.HOUR_OF_DAY, 23)
            cal.set(Calendar.MINUTE, 59)
            cal.set(Calendar.SECOND, 59)
            cal.set(Calendar.MILLISECOND, 999)
            val finMs = cal.timeInMillis

            horasRepo.getRegistrosPorRango(inicioMs, finMs).collect { registros ->
                val basico = _uiState.value.sueldoBasico
                val estimate = CalculoSalarialUtil.calcularSueldoMensual(registros, basico)
                _uiState.update { it.copy(
                    registrosMesActual = registros,
                    salaryEstimate = estimate
                ) }
            }
        }
    }

    fun guardarRegistro(
        fechaMs: Long,
        entradaInicioMs: Long?,
        salidaInicioMs: Long?,
        entradaFinMs: Long?,
        salidaFinMs: Long?,
        lugarTrabajo: String,
        pernocte: String,
        maneja: Boolean,
        horasViaje: Double,
        esFeriado: Boolean,
        esFrancoCompensatorio: Boolean,
        esFrancoTrabajado: Boolean,
        observaciones: String,
        modoEdicionId: String? = null
    ) {
        viewModelScope.launch {
            var eInst = entradaInicioMs
            var sInst = salidaInicioMs
            var eFin = entradaFinMs
            var sFin = salidaFinMs

            val hasTurno1Split = eInst != null && sInst != null && sInst < eInst
            val hasTurno2Split = eFin != null && sFin != null && sFin < eFin

            if (hasTurno1Split) {
                // El turno 1 cruzó la medianoche, ej 19:00 a 07:00
                // Lo partimos para que Turno 1 sea 19:00 a 24:00 y Turno 2 sea 00:00 a 07:00
                val mananaMs = fechaMs + 24 * 60 * 60 * 1000L
                val medianocheMs = Calendar.getInstance().apply {
                    timeInMillis = mananaMs
                    set(Calendar.HOUR_OF_DAY, 0)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis

                sInst = medianocheMs
                eFin = medianocheMs
                sFin = salidaInicioMs!! + 24 * 60 * 60 * 1000L
            } else if (hasTurno2Split) {
                // Si el turno 2 cruzó la medianoche (y turno 1 estaba normal antes)
                // Ajustamos la salida del turno 2 para que sea del día siguiente en ms
                // aunque en la UI siga cayendo en Turno 2
                sFin = salidaFinMs!! + 24 * 60 * 60 * 1000L
            }

            val entity = HorasTrabajoEntity(
                id = modoEdicionId ?: UUID.randomUUID().toString(),
                fechaMs = fechaMs,
                entradaInicioMs = eInst,
                salidaInicioMs = sInst,
                entradaFinMs = eFin,
                salidaFinMs = sFin,
                lugarTrabajo = lugarTrabajo,
                pernocte = pernocte,
                maneja = maneja,
                horasViaje = horasViaje,
                observaciones = observaciones,
                esFeriado = esFeriado,
                esFrancoCompensatorio = esFrancoCompensatorio,
                esFrancoTrabajado = esFrancoTrabajado,
                sincronizado = false
            )

            if (modoEdicionId != null) {
                horasRepo.updateRegistro(entity)
            } else {
                horasRepo.insertRegistro(entity)
            }
        }
    }

    fun borrarRegistro(registroId: String) {
        viewModelScope.launch {
            horasRepo.getRegistroById(registroId)?.let {
                horasRepo.deleteRegistro(it)
            }
        }
    }
}
