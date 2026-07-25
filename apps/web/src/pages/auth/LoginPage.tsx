import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import api from '@/services/api';
import { Loader2, LogIn, Eye, EyeOff, Bug, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { claveDebug, olvidarClaveDebug } from '@/lib/debugClave';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

type LoginForm = z.infer<typeof loginSchema>;

interface DebugUser {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
  sector: { nombre: string } | null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const rememberMe = useAuthStore((s) => s.rememberMe);
  const setRememberMe = useAuthStore((s) => s.setRememberMe);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [debugUsers, setDebugUsers] = useState<DebugUser[]>([]);
  const [debugSearch, setDebugSearch] = useState('');
  const [debugLoggingIn, setDebugLoggingIn] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  // El selector de usuarios de debug ya no aparece solo: hay que traer la clave
  // compartida en la dirección una vez por dispositivo (…/?debug=LA_CLAVE). La
  // captura capturarClaveDebug() al arrancar la app, porque el router redirige a
  // /login descartando el query string. Sin clave el API responde 404 y el login
  // se ve como el normal, así que quien encuentre la URL del túnel no se lleva la
  // nómina ni entra a las cuentas.
  useEffect(() => {
    const clave = claveDebug();
    if (!clave) return;

    api.get('/auth/debug-users', { headers: { 'x-debug-clave': clave } })
      .then((res) => setDebugUsers(res.data))
      .catch(() => olvidarClaveDebug()); // 404 = clave vieja o modo apagado
  }, []);

  const debugLogin = async (email: string) => {
    setError('');
    setDebugLoggingIn(email);
    try {
      const res = await api.post('/auth/login', {
        email,
        password: claveDebug() ?? '',
      });
      setAuth(res.data.user, res.data.accessToken);
      navigate(res.data.user.primerLogin ? '/cambiar-password' : '/dashboard');
    } catch {
      setError('Error al ingresar en modo debug');
    } finally {
      setDebugLoggingIn(null);
    }
  };

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      const res = await api.post('/auth/login', data);
      setAuth(res.data.user, res.data.accessToken);

      if (res.data.user.primerLogin) {
        navigate('/cambiar-password');
      } else {
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      // Un 401 acá es "email o contraseña incorrectos" y nada más: el backend ya
      // responde con el mismo mensaje genérico exista o no la cuenta
      // (auth.routes.ts), pero fijamos el texto igual para no depender de eso ni
      // enumerar campos si el backend cambiara. mensajeDeError solo se usa para
      // los demás casos (red, error de servidor, JS del cliente).
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 401 ? 'Email o contraseña incorrectos' : mensajeDeError(err).mensaje);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Planilla de Horas</h1>
          <p className="text-muted-foreground mt-1">Gestión de jornadas laborales</p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" id="login-form">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="tu@email.com"
                className={cn(
                  'flex h-10 w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                  'transition-colors',
                  errors.email && 'border-destructive focus:ring-destructive'
                )}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={cn(
                    'flex h-10 w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 pr-10 text-sm',
                    'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                    'transition-colors',
                    errors.password && 'border-destructive focus:ring-destructive'
                  )}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-input bg-background text-primary accent-primary"
                />
                <span className="text-xs text-muted-foreground">Recuérdame</span>
              </label>
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              id="login-submit"
              className={cn(
                'w-full h-10 rounded-lg bg-primary text-primary-foreground font-medium text-sm',
                'hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
                'transition-all duration-200 flex items-center justify-center gap-2',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {isSubmitting ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        {/* Debug Mode User Picker */}
        {debugUsers.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3 px-1">
              <Bug className="h-4 w-4 text-yellow-400" />
              <span className="text-xs font-semibold text-yellow-400">MODO DEBUG — Click para ingresar</span>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nombre, email, rol o sector..."
                value={debugSearch}
                onChange={(e) => setDebugSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1 rounded-xl border border-border bg-card p-2">
              {(() => {
                const search = debugSearch.toLowerCase();
                const filtered = debugUsers.filter((u) =>
                  !search ||
                  `${u.nombre} ${u.apellido}`.toLowerCase().includes(search) ||
                  u.email.toLowerCase().includes(search) ||
                  u.rol.toLowerCase().includes(search) ||
                  (u.sector?.nombre ?? '').toLowerCase().includes(search)
                );

                const roleOrder = ['ADMIN', 'RRHH', 'GERENTE', 'COORDINADOR', 'SUPERVISOR', 'OPERADOR'];
                const grouped: { rol: string; users: DebugUser[] }[] = [];
                const seen = new Set<string>();

                for (const rol of roleOrder) {
                  const users = filtered.filter((u) => u.rol === rol);
                  if (users.length > 0) { grouped.push({ rol, users }); seen.add(rol); }
                }
                // Catch any roles not in the predefined order
                const otherUsers = filtered.filter((u) => !seen.has(u.rol));
                if (otherUsers.length > 0) grouped.push({ rol: 'OTROS', users: otherUsers });

                if (grouped.length === 0) {
                  return <p className="text-xs text-muted-foreground text-center py-3">Sin resultados</p>;
                }

                return grouped.map((g) => (
                  <div key={g.rol}>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-1">
                      {g.rol} ({g.users.length})
                    </p>
                    {g.users.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => debugLogin(u.email)}
                        disabled={debugLoggingIn !== null}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left text-xs',
                          'hover:bg-accent/50 transition-colors',
                          'disabled:opacity-50 disabled:cursor-wait',
                          debugLoggingIn === u.email && 'bg-primary/10'
                        )}
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-foreground truncate block">
                            {u.apellido}, {u.nombre}
                          </span>
                          <span className="text-muted-foreground truncate block">{u.email}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                          {u.sector?.nombre ?? '—'}
                        </span>
                        {debugLoggingIn === u.email && <Loader2 className="h-3 w-3 animate-spin ml-1 shrink-0" />}
                      </button>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
