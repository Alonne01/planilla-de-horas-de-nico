package com.equiptrack.data.repository

import com.equiptrack.data.local.database.dao.HorasTrabajoDao
import com.equiptrack.data.local.database.entity.HorasTrabajoEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HorasTrabajoRepository @Inject constructor(
    private val dao: HorasTrabajoDao
) {
    fun getAllRegistros(): Flow<List<HorasTrabajoEntity>> = dao.getAllRegistros()

    fun getRegistrosPorRango(desdeMs: Long, hastaMs: Long): Flow<List<HorasTrabajoEntity>> =
        dao.getRegistrosPorRango(desdeMs, hastaMs)

    suspend fun getRegistroById(id: String): HorasTrabajoEntity? = dao.getRegistroById(id)

    suspend fun insertRegistro(registro: HorasTrabajoEntity) = dao.insertRegistro(registro)

    suspend fun updateRegistro(registro: HorasTrabajoEntity) = dao.updateRegistro(registro)

    suspend fun deleteRegistro(registro: HorasTrabajoEntity) = dao.deleteRegistro(registro)
}
