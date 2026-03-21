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
  setAuth: (user: User, accessToken: string) => void;
  updateToken: (accessToken: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  setAuth: (user, accessToken) =>
    set({ user, accessToken, isAuthenticated: true }),
  updateToken: (accessToken) =>
    set({ accessToken }),
  clearAuth: () =>
    set({ user: null, accessToken: null, isAuthenticated: false }),
}));
