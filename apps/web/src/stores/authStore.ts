import { create } from 'zustand';

interface User {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
  rolNivel: number;
  empresaId: string;
  empresaNombre: string;
  sectorId: string | null;
  sectorNombre: string | null;
  primerLogin: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  rememberMe: boolean;
  setAuth: (user: User, accessToken: string) => void;
  updateToken: (accessToken: string) => void;
  setRememberMe: (value: boolean) => void;
  clearAuth: () => void;
}

const STORAGE_KEY = 'planilla-auth';

function loadPersistedState(): Partial<AuthState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { user: parsed.user, isAuthenticated: !!parsed.user, rememberMe: parsed.rememberMe ?? false };
    }
  } catch { /* ignore */ }
  return {};
}

function persistState(state: { user: User | null; rememberMe: boolean }) {
  const data = JSON.stringify({ user: state.user, rememberMe: state.rememberMe });
  if (state.rememberMe) {
    localStorage.setItem(STORAGE_KEY, data);
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, data);
    localStorage.removeItem(STORAGE_KEY);
  }
}

const persisted = loadPersistedState();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: persisted.user ?? null,
  accessToken: null,
  isAuthenticated: persisted.isAuthenticated ?? false,
  rememberMe: persisted.rememberMe ?? false,
  setAuth: (user, accessToken) => {
    const rememberMe = get().rememberMe;
    persistState({ user, rememberMe });
    set({ user, accessToken, isAuthenticated: true });
  },
  updateToken: (accessToken) =>
    set({ accessToken }),
  setRememberMe: (value) =>
    set({ rememberMe: value }),
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    set({ user: null, accessToken: null, isAuthenticated: false });
  },
}));
