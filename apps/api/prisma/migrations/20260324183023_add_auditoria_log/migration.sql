-- CreateTable
CREATE TABLE "auditoria_log" (
    "id" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "campo" TEXT,
    "valor_anterior" TEXT,
    "valor_nuevo" TEXT,
    "descripcion" TEXT,
    "usuario_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditoria_log_entidad_entidad_id_idx" ON "auditoria_log"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "auditoria_log_usuario_id_idx" ON "auditoria_log"("usuario_id");

-- AddForeignKey
ALTER TABLE "auditoria_log" ADD CONSTRAINT "auditoria_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
