-- CreateTable
CREATE TABLE "vacacion_saldos" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "dias_correspondientes" INTEGER NOT NULL,
    "dias_usados" INTEGER NOT NULL DEFAULT 0,
    "dias_pendientes" INTEGER NOT NULL DEFAULT 0,
    "dias_ajuste" INTEGER NOT NULL DEFAULT 0,
    "override" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacacion_saldos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacacion_saldos_usuario_id_anio_key" ON "vacacion_saldos"("usuario_id", "anio");

-- AddForeignKey
ALTER TABLE "vacacion_saldos" ADD CONSTRAINT "vacacion_saldos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
