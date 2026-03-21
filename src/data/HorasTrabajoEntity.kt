package com.equiptrack.data.local.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "horas_trabajo")
data class HorasTrabajoEntity(
    @PrimaryKey val id: String,
    val fechaMs: Long,
    val entradaInicioMs: Long?,
    val salidaInicioMs: Long?,
    val entradaFinMs: Long?,
    val salidaFinMs: Long?,
    val lugarTrabajo: String, // "Base", "Campo", "Franco"
    val pernocte: String,     // "NO", "Hotel", "Trailer"
    val maneja: Boolean,
    val horasViaje: Double = 0.0,
    val observaciones: String,
    val esFeriado: Boolean = false,
    @ColumnInfo(defaultValue = "0") val esFrancoCompensatorio: Boolean = false,
    @ColumnInfo(defaultValue = "0") val esFrancoTrabajado: Boolean = false,
    val fechaCreacion: Long = System.currentTimeMillis(),
    val sincronizado: Boolean = false
)
