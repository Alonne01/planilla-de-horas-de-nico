import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import '@/stores/themeStore'; // initialize theme on load
import LoginPage from '@/pages/auth/LoginPage';
import ChangePasswordPage from '@/pages/auth/ChangePasswordPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import DashboardPage from '@/pages/dashboard/DashboardPage';
import AppShell from '@/components/layout/AppShell';
import UsuariosPage from '@/pages/admin/UsuariosPage';
import SectoresPage from '@/pages/admin/SectoresPage';
import DiagramasPage from '@/pages/admin/DiagramasPage';
import ConveniosPage from '@/pages/admin/ConveniosPage';
import PlanillasPage from '@/pages/planillas/PlanillasPage';
import PlanillaDetailPage from '@/pages/planillas/PlanillaDetailPage';
import FlujosPage from '@/pages/admin/FlujosPage';
import VacacionesPage from '@/pages/vacaciones/VacacionesPage';
import AusenciasPage from '@/pages/ausencias/AusenciasPage';
import AnalyticsPage from '@/pages/analytics/AnalyticsPage';
import ConfigPage from '@/pages/admin/ConfigPage';
import ConceptosPage from '@/pages/admin/ConceptosPage';
import RolesPage from '@/pages/admin/RolesPage';
import CierrePage from '@/pages/admin/CierrePage';
import VacacionSaldosPage from '@/pages/admin/VacacionSaldosPage';
import AprobacionesPage from '@/pages/aprobaciones/AprobacionesPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function PrivateRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function PublicOnlyRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function RequirePrimerLogin() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const primerLogin = useAuthStore((s) => s.user?.primerLogin);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!primerLogin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>

          {/* Primer login route */}
          <Route element={<RequirePrimerLogin />}>
            <Route path="/cambiar-password" element={<ChangePasswordPage />} />
          </Route>

          {/* Protected routes with AppShell */}
          <Route element={<PrivateRoute />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/planillas" element={<PlanillasPage />} />
              <Route path="/planillas/:id" element={<PlanillaDetailPage />} />
              <Route path="/vacaciones" element={<VacacionesPage />} />
              <Route path="/ausencias" element={<AusenciasPage />} />
              <Route path="/aprobaciones" element={<AprobacionesPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              {/* Admin routes — Phase 2 */}
              <Route path="/admin/usuarios" element={<UsuariosPage />} />
              <Route path="/admin/sectores" element={<SectoresPage />} />
              <Route path="/admin/diagramas" element={<DiagramasPage />} />
              <Route path="/admin/convenios" element={<ConveniosPage />} />
              <Route path="/admin/config" element={<ConfigPage />} />
              <Route path="/admin/flujos" element={<FlujosPage />} />
              <Route path="/admin/conceptos" element={<ConceptosPage />} />
              <Route path="/admin/roles" element={<RolesPage />} />
              <Route path="/admin/cierre" element={<CierrePage />} />
              <Route path="/admin/vacacion-saldos" element={<VacacionSaldosPage />} />
            </Route>
          </Route>

          {/* Catch-all redirect */}
          <Route path="*" element={<CatchAll />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function CatchAll() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />;
}

