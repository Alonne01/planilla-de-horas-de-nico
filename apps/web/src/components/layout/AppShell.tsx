import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import ErrorBoundary from '@/components/ErrorBoundary';
import NotificationBell from './NotificationBell';
import ThemeSwitcher from './ThemeSwitcher';
import InstallPWA from '../InstallPWA';
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  FileBarChart,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Palmtree,
  FileX,
  Building2,
  Layers,
  GitBranch,
  BookOpen,
  // DollarSign, // used by Conceptos nav item (currently hidden)
  Lock,
  Shield,
  ClipboardList,
  CheckCircle2,
  RefreshCw,
  MessageSquare,
  // FileText, // used by Recibos nav item (currently hidden)
  CalendarRange,
  GraduationCap,
  Bell,
  FileSpreadsheet,
  ShieldCheck,
  ArrowLeftRight,
  AlertTriangle,
} from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCanApprove } from '@/hooks/useCanApprove';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  minLevel?: number;
  requireApprover?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Planillas', path: '/planillas', icon: Clock },
  { label: 'Ausencias y Vac.', path: '/ausencias', icon: FileX },
  { label: 'Mis Solicitudes', path: '/mis-solicitudes', icon: ClipboardList },
  { label: 'Aprobaciones', path: '/aprobaciones', icon: CheckCircle2, minLevel: 60, requireApprover: true },
  { label: 'Mensajes', path: '/mensajes', icon: MessageSquare },
  // { label: 'Recibos', path: '/recibos', icon: FileText }, // RRHH only — oculto hasta nueva definición
  { label: 'Calendario Vac.', path: '/vacaciones/gantt', icon: CalendarRange, minLevel: 70 },
  { label: 'Capacitaciones', path: '/capacitaciones', icon: GraduationCap },
  { label: 'Mi Equipo', path: '/equipo', icon: Users },
  { label: 'Cambios Diagrama', path: '/cambios-diagrama', icon: ArrowLeftRight, minLevel: 70 },
  { label: 'WENTOP', path: '/wentop', icon: AlertTriangle },
  { label: 'Analytics', path: '/analytics', icon: FileBarChart },
];

const adminItems: NavItem[] = [
  { label: 'Usuarios', path: '/admin/usuarios', icon: Users, minLevel: 90 },
  { label: 'Sectores', path: '/admin/sectores', icon: Building2, minLevel: 100 },
  { label: 'Diagramas', path: '/admin/diagramas', icon: CalendarDays, minLevel: 100 },
  { label: 'Flujos', path: '/admin/flujos', icon: GitBranch, minLevel: 100 },
  { label: 'Convenios', path: '/admin/convenios', icon: BookOpen, minLevel: 90 },
  // { label: 'Conceptos', path: '/admin/conceptos', icon: DollarSign, minLevel: 90 }, // RRHH only — oculto hasta nueva definición
  { label: 'Roles', path: '/admin/roles', icon: Shield, minLevel: 100 },
  { label: 'Cierre', path: '/admin/cierre', icon: Lock, minLevel: 90 },
  { label: 'Saldos Vac.', path: '/admin/vacacion-saldos', icon: Palmtree, minLevel: 90 },
  { label: 'Alertas', path: '/admin/alertas', icon: Bell, minLevel: 90 },
  { label: 'Auditoría', path: '/admin/auditoria', icon: ShieldCheck, minLevel: 90 },
  { label: 'Liquidación', path: '/admin/liquidacion', icon: FileSpreadsheet, minLevel: 90 },
  { label: 'Configuración', path: '/admin/config', icon: Settings, minLevel: 100 },
];

const PULL_THRESHOLD = 80;

export default function AppShell() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const queryClient = useQueryClient();
  const canApprove = useCanApprove();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const pullDistanceRef = useRef(0);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setIsRefreshing(false);
  }, [isRefreshing, queryClient]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (sidebarOpen) return;
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [sidebarOpen]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling.current) return;
    const distance = e.touches[0].clientY - pullStartY.current;
    if (distance > 0) {
      const clamped = Math.min(distance, PULL_THRESHOLD * 1.5);
      setPullDistance(clamped);
      pullDistanceRef.current = clamped;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isPulling.current && pullDistanceRef.current >= PULL_THRESHOLD) {
      handleRefresh();
    }
    setPullDistance(0);
    pullDistanceRef.current = 0;
    isPulling.current = false;
  }, [handleRefresh]);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore logout errors
    }
    clearAuth();
    navigate('/login');
  };

  const filteredNavItems = navItems.filter(
    (item) => {
      if (item.minLevel && (!user || (user.rolNivel ?? 0) < item.minLevel)) return false;
      if (item.requireApprover && canApprove === false) return false;
      return true;
    }
  );

  const filteredAdminItems = adminItems.filter(
    (item) => !item.minLevel || (user && (user.rolNivel ?? 0) >= item.minLevel)
  );

  const renderNavLink = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      onClick={() => setSidebarOpen(false)}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-card/95 backdrop-blur-sm px-4 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <h1 className="text-sm font-semibold text-foreground">Planilla de Horas</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Actualizar datos"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </button>
          <NotificationBell />
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-dvh w-64 bg-card border-r border-border flex flex-col transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Sidebar header */}
        <div className="h-14 lg:h-16 flex items-center gap-3 px-4 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground truncate">
              {user?.empresaNombre ?? 'Planilla'}
            </h2>
            <p className="text-xs text-muted-foreground truncate">{user?.rol}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          <div className="space-y-1">
            {filteredNavItems.map(renderNavLink)}
          </div>

          {filteredAdminItems.length > 0 && (
            <>
              <div className="my-4 border-t border-border" />
              <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Administración
              </p>
              <div className="space-y-1">
                {filteredAdminItems.map(renderNavLink)}
              </div>
            </>
          )}
        </nav>

        {/* User info + Logout */}
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {user?.nombre?.charAt(0)}{user?.apellido?.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.nombre} {user?.apellido}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <NotificationBell />
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Actualizando...' : 'Actualizar datos'}
          </button>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-muted-foreground">Tema</span>
            <ThemeSwitcher />
          </div>
          <button
            onClick={handleLogout}
            id="logout-button"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Pull-to-refresh indicator (mobile only) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="lg:hidden fixed left-0 right-0 z-40 flex justify-center pointer-events-none"
          style={{
            top: '56px',
            transform: `translateY(${isRefreshing ? 36 : Math.min(pullDistance * 0.4, 36)}px)`,
            transition: isRefreshing ? 'none' : 'transform 0.1s',
          }}
        >
          <div className="bg-card border border-border rounded-full p-2 shadow-md">
            <RefreshCw
              className={cn('h-5 w-5 text-primary', isRefreshing && 'animate-spin')}
              style={!isRefreshing ? { transform: `rotate(${pullDistance * 2}deg)` } : undefined}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        <div className="p-4 lg:p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* PWA install prompt */}
      <InstallPWA />
    </div>
  );
}
