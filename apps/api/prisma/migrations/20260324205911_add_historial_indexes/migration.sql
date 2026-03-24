-- CreateIndex
CREATE INDEX "ausencias_historial_usuario_id_estado_nuevo_created_at_idx" ON "ausencias_historial"("usuario_id", "estado_nuevo", "created_at");

-- CreateIndex
CREATE INDEX "planillas_historial_usuario_id_estado_nuevo_created_at_idx" ON "planillas_historial"("usuario_id", "estado_nuevo", "created_at");

-- CreateIndex
CREATE INDEX "vacaciones_historial_usuario_id_estado_nuevo_created_at_idx" ON "vacaciones_historial"("usuario_id", "estado_nuevo", "created_at");
