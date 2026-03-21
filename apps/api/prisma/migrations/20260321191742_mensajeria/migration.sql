-- CreateTable
CREATE TABLE "mensajes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "remitente_id" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "archivo_url" TEXT,
    "archivo_nombre" TEXT,
    "permite_respuesta" BOOLEAN NOT NULL DEFAULT false,
    "es_difusion" BOOLEAN NOT NULL DEFAULT false,
    "destino_tipo" TEXT,
    "destino_valor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje_destinatarios" (
    "id" TEXT NOT NULL,
    "mensaje_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "leido_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_destinatarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje_respuestas" (
    "id" TEXT NOT NULL,
    "mensaje_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "archivo_url" TEXT,
    "archivo_nombre" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_respuestas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mensaje_destinatarios_mensaje_id_usuario_id_key" ON "mensaje_destinatarios"("mensaje_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_remitente_id_fkey" FOREIGN KEY ("remitente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_destinatarios" ADD CONSTRAINT "mensaje_destinatarios_mensaje_id_fkey" FOREIGN KEY ("mensaje_id") REFERENCES "mensajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_destinatarios" ADD CONSTRAINT "mensaje_destinatarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_respuestas" ADD CONSTRAINT "mensaje_respuestas_mensaje_id_fkey" FOREIGN KEY ("mensaje_id") REFERENCES "mensajes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje_respuestas" ADD CONSTRAINT "mensaje_respuestas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
