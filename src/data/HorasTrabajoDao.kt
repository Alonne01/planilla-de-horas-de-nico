package com.equiptrack.data.local.database.dao

import androidx.room.*
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface HorasTrabajoDao {
    @Query("SELECT * FROM horas_trabajo ORDER BY fechaMs DESC")
    fun getAllRegistros(): Flow<List<HorasTrabajoEntity>>

    @Query("SELECT * FROM horas_trabajo WHERE fechaMs >= :desdeMs AND fechaMs <= :hastaMs ORDER BY fechaMs ASC")
    fun getRegistrosPorRango(desdeMs: Long, hastaMs: Long): Flow<List<HorasTrabajoEntity>>

    @Query("SELECT * FROM horas_trabajo WHERE id = :id")
    suspend fun getRegistroById(id: String): HorasTrabajoEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRegistro(registro: HorasTrabajoEntity)

    @Update
    suspend fun updateRegistro(registro: HorasTrabajoEntity)

    @Delete
    suspend fun deleteRegistro(registro: HorasTrabajoEntity)
}
