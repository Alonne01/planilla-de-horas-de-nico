-- CreateTable
CREATE TABLE "sesiones_capacitacion" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "organizador_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "hora_inicio" TEXT,
    "hora_fin" TEXT,
    "lugar" TEXT,
    "vacantes" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_capacitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones_capacitacion" (
    "id" TEXT NOT NULL,
    "sesion_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "respondido_at" TIMESTAMP(3),
    "motivo_rechazo" TEXT,
    "asistio" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_capacitacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_capacitacion_sesion_id_usuario_id_key" ON "invitaciones_capacitacion"("sesion_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "sesiones_capacitacion" ADD CONSTRAINT "sesiones_capacitacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_capacitacion" ADD CONSTRAINT "sesiones_capacitacion_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_capacitacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_capacitacion" ADD CONSTRAINT "sesiones_capacitacion_organizador_id_fkey" FOREIGN KEY ("organizador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_capacitacion" ADD CONSTRAINT "invitaciones_capacitacion_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones_capacitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_capacitacion" ADD CONSTRAINT "invitaciones_capacitacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
