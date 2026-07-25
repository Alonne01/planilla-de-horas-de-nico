import { create } from 'zustand';

/**
 * Estado de conexión con el servidor.
 *
 * Se marca inactivo cuando una llamada al API no obtiene respuesta: el servidor
 * está apagado, sin red, o el service worker devolvió el 503 de cortesía.
 * Un error 4xx/5xx real NO cuenta: ahí el servidor está vivo y contestando.
 */
interface ServerStatusState {
  inactivo: boolean;
  desde: number | null;
  marcarInactivo: () => void;
  marcarActivo: () => void;
}

export const useServerStatus = create<ServerStatusState>((set, get) => ({
  inactivo: false,
  desde: null,
  marcarInactivo: () => {
    if (get().inactivo) return;
    set({ inactivo: true, desde: Date.now() });
  },
  marcarActivo: () => {
    if (!get().inactivo) return;
    set({ inactivo: false, desde: null });
  },
}));
