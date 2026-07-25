import { useCallback, useEffect, useState } from 'react';
import { ServerOff, RefreshCw } from 'lucide-react';
import { useServerStatus } from '@/stores/serverStatusStore';
import { API_BASE_URL } from '@/services/api';

const INTERVALO_REINTENTO_MS = 10_000;

/**
 * Cartel bloqueante para cuando el servidor no responde.
 *
 * Aparece encima de todo para que nadie siga cargando datos que no se van a
 * guardar. No desmonta ni limpia nada: lo que el usuario ya había escrito sigue
 * ahí abajo, y cuando el servidor vuelve el cartel se cierra solo y puede
 * guardar normalmente.
 *
 * Funciona con el servidor completamente apagado gracias al service worker
 * (public/sw.js), que responde un 503 propio cuando el pedido no llega a destino.
 */
export default function ServidorInactivo() {
  const inactivo = useServerStatus((s) => s.inactivo);
  const desde = useServerStatus((s) => s.desde);
  const marcarActivo = useServerStatus((s) => s.marcarActivo);
  const [verificando, setVerificando] = useState(false);

  const verificar = useCallback(async () => {
    setVerificando(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/health`, { cache: 'no-store' });
      if (res.ok) marcarActivo();
    } catch {
      // sigue caído — el próximo intento llega solo
    } finally {
      setVerificando(false);
    }
  }, [marcarActivo]);

  useEffect(() => {
    if (!inactivo) return;
    const id = setInterval(verificar, INTERVALO_REINTENTO_MS);
    return () => clearInterval(id);
  }, [inactivo, verificar]);

  // Bloquear el scroll de fondo mientras el cartel está visible
  useEffect(() => {
    if (!inactivo) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [inactivo]);

  if (!inactivo) return null;

  const hora = desde
    ? new Date(desde).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="servidor-inactivo-titulo"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="rounded-full bg-destructive/15 p-3 text-destructive">
            <ServerOff className="h-7 w-7" />
          </div>

          <h2 id="servidor-inactivo-titulo" className="text-lg font-semibold text-foreground">
            Servidor inactivo
          </h2>

          <p className="text-sm text-muted-foreground">
            No se puede conectar con el sistema. Comuníquese con IT.
          </p>

          <div className="w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            No cargue datos mientras aparezca este mensaje: <b>no se van a guardar</b>.
          </div>

          <p className="text-xs text-muted-foreground">
            {hora && <>Sin conexión desde las {hora}. </>}
            Reintentando cada 10 segundos.
          </p>

          <button
            type="button"
            onClick={verificar}
            disabled={verificando}
            className="mt-1 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={verificando ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {verificando ? 'Verificando…' : 'Reintentar ahora'}
          </button>
        </div>
      </div>
    </div>
  );
}
