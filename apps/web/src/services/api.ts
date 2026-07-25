import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { useServerStatus } from '@/stores/serverStatusStore';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

/** Resolve a relative /uploads/… path to a full API URL */
export function getUploadUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${API_BASE_URL}${path}`;
}

const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach access token
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor: auto-refresh on 401
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

/**
 * ¿Este error significa que el servidor no está contestando?
 *
 * Sí en tres casos:
 *   - No hay respuesta (ERR_NETWORK): la máquina está apagada o sin red.
 *   - El service worker devolvió su 503 de cortesía porque el fetch no llegó.
 *   - nginx contestó 502/503/504: está vivo pero el API que tiene detrás no.
 *
 * No: cualquier otro 4xx/5xx — ahí el API está vivo y respondió, aunque sea
 * con un error. Un 500 puntual no debe bloquear la aplicación entera.
 */
export function esServidorCaido(error: {
  code?: string;
  response?: { status?: number; data?: { error?: string } };
}): boolean {
  const status = error.response?.status;
  if (status !== undefined) {
    return status === 502 || status === 503 || status === 504;
  }
  // Sin respuesta: solo los errores de red cuentan. Un timeout puede ser un
  // servidor lento pero vivo, y bloquear la app por eso sería peor.
  return error.code === 'ERR_NETWORK';
}

api.interceptors.response.use(
  (response) => {
    useServerStatus.getState().marcarActivo();
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (esServidorCaido(error)) {
      useServerStatus.getState().marcarInactivo();
      return Promise.reject(error);
    }
    // Hubo respuesta del servidor: está vivo aunque haya devuelto un error
    useServerStatus.getState().marcarActivo();

    // Don't retry auth endpoints or already-retried requests
    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { data } = await api.post('/auth/refresh');
      const newToken = data.accessToken as string;
      useAuthStore.getState().updateToken(newToken);
      processQueue(null, newToken);
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
