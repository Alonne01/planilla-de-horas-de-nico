-- CreateTable
CREATE TABLE "feriados_nacionales" (
    "fecha" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'API',
    "actualizado_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feriados_nacionales_pkey" PRIMARY KEY ("fecha")
);

-- CreateIndex
CREATE INDEX "feriados_nacionales_anio_idx" ON "feriados_nacionales"("anio");
