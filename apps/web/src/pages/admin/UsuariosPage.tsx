import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import {
  Pencil, Trash2, Search, UserPlus,
  Loader2, X, ChevronDown, ChevronUp, KeyRound, Copy, Check
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useDialogStore } from '@/stores/dialogStore';
import { toast } from '@/stores/toastStore';

interface User {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
  legajo: string | null;
  activo: boolean;
  tipoContrato: string;
  fechaIngreso: string;
  primerLogin: boolean;
  diagramaColor: string | null;
  sector: { id: string; nombre: string } | null;
}

interface Sector { id: string; nombre: string }
interface RolConfig { id: string; codigo: string; nombre: string; color: string | null }
interface Diagrama {
  id: string;
  nombre: string;
  tipo: string; // 'ROTATIVO' | 'FIJO_SEMANA'
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
  descripcion: string | null;
  activo: boolean;
}

const ROL_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-500/20 text-red-400',
  RRHH: 'bg-purple-500/20 text-purple-400',
  GERENTE: 'bg-amber-500/20 text-amber-400',
  COORDINADOR: 'bg-blue-500/20 text-blue-400',
  SUPERVISOR: 'bg-emerald-500/20 text-emerald-400',
  OPERADOR: 'bg-slate-500/20 text-slate-400',
};

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const dialog = useDialogStore();
  const [search, setSearch] = useState('');
  const [filterRol, setFilterRol] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterActivo, setFilterActivo] = useState('true');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ nombre: string; tempPassword: string } | null>(null);

  const canEdit = currentUser?.rol === 'ADMIN' || currentUser?.rol === 'RRHH';

  // ─── Queries ────────────────────────────────────

  const { data: usuarios = [], isLoading } = useQuery<User[]>({
    queryKey: ['usuarios', search, filterRol, filterSector, filterActivo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterRol) params.set('rol', filterRol);
      if (filterActivo) params.set('activo', filterActivo);
      const { data } = await api.get(`/usuarios?${params.toString()}`);
      // Client-side sector filter (API doesn't support it natively)
      if (filterSector) {
        return data.filter((u: User) => u.sector?.id === filterSector);
      }
      return data;
    },
  });

  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
    enabled: canEdit,
  });

  const { data: rolesConfig = [] } = useQuery<RolConfig[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/admin/roles')).data,
  });

  const { data: diagramas = [] } = useQuery<Diagrama[]>({
    queryKey: ['diagramas'],
    queryFn: async () => (await api.get('/analytics/diagramas')).data,
    enabled: canEdit,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/usuarios/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/usuarios/${id}/reset-password`);
      return data as { tempPassword: string; usuario: { nombre: string; apellido: string } };
    },
    onSuccess: (data) => {
      setResetResult({
        nombre: `${data.usuario.nombre} ${data.usuario.apellido}`,
        tempPassword: data.tempPassword,
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditingUser(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Nuevo usuario
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nombre, email o legajo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={filterRol}
          onChange={(e) => setFilterRol(e.target.value)}
          className="h-10 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los roles</option>
          {rolesConfig.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
        </select>
        <select
          value={filterSector}
          onChange={(e) => setFilterSector(e.target.value)}
          className="h-10 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los sectores</option>
          {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select
          value={filterActivo}
          onChange={(e) => setFilterActivo(e.target.value)}
          className="h-10 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="">Todos</option>
        </select>
      </div>

      {/* Users List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : usuarios.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No se encontraron usuarios
        </div>
      ) : (
        <div className="space-y-2">
          {usuarios.map((u) => (
            <div
              key={u.id}
              className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/20 transition-colors"
            >
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
              >
                {/* Avatar */}
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  u.activo ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  {u.nombre.charAt(0)}{u.apellido.charAt(0)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium text-sm', !u.activo && 'line-through opacity-50')}>
                      {u.apellido}, {u.nombre}
                    </span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ROL_COLORS[u.rol])}>
                      {u.rol}
                    </span>

                    {!u.activo && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-destructive/20 text-destructive">INACTIVO</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>

                {/* Sector */}
                <div className="hidden sm:block text-right">
                  <p className="text-xs text-muted-foreground">{u.sector?.nombre ?? '—'}</p>
                </div>

                {/* Expand arrow */}
                {expandedUser === u.id ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>

              {/* Expanded details */}
              {expandedUser === u.id && (
                <div className="px-4 pb-4 pt-0 border-t border-border">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Legajo:</span>
                      <p className="font-medium">{u.legajo || '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sector:</span>
                      <p className="font-medium">{u.sector?.nombre || '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Contrato:</span>
                      <p className="font-medium">{u.tipoContrato}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ingreso:</span>
                      <p className="font-medium">{new Date(u.fechaIngreso).toLocaleDateString('es-AR')}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Primer login:</span>
                      <p className="font-medium">{u.primerLogin ? 'Sí' : 'No'}</p>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingUser(u); setShowForm(true); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </button>
                      {u.id !== currentUser?.id && u.activo && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (await dialog.confirm({ message: `¿Desactivar a ${u.nombre} ${u.apellido}?`, variant: 'danger' })) {
                              deleteMutation.mutate(u.id);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          Desactivar
                        </button>
                      )}
                      {u.id !== currentUser?.id && u.activo && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (await dialog.confirm({ message: `¿Restablecer la contraseña de ${u.nombre} ${u.apellido}? Se generará una contraseña temporal.` })) {
                              resetPasswordMutation.mutate(u.id);
                            }
                          }}
                          disabled={resetPasswordMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                        >
                          <KeyRound className="h-3 w-3" />
                          {resetPasswordMutation.isPending ? 'Restableciendo...' : 'Restablecer contraseña'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <UserFormModal
          user={editingUser}
          sectores={sectores}
          roles={rolesConfig}
          diagramas={diagramas}
          onClose={() => { setShowForm(false); setEditingUser(null); }}
          onSuccess={() => {
            setShowForm(false);
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: ['usuarios'] });
          }}
        />
      )}

      {/* Password Reset Result Modal */}
      {resetResult && (
        <TempPasswordModal
          nombre={resetResult.nombre}
          tempPassword={resetResult.tempPassword}
          onClose={() => setResetResult(null)}
        />
      )}
    </div>
  );
}

// ─── User Form Modal ──────────────────────────────

function UserFormModal({
  user,
  sectores,
  roles,
  diagramas,
  onClose,
  onSuccess,
}: {
  user: User | null;
  sectores: Sector[];
  roles: RolConfig[];
  diagramas: Diagrama[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const isEdit = !!user;

  // Diagram state — loaded from GET /usuarios/:id when editing
  const [diagramaId, setDiagramaId] = useState('');
  const [diagramaFechaInicio, setDiagramaFechaInicio] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [originalDiagramaId, setOriginalDiagramaId] = useState('');
  const [originalFechaInicio, setOriginalFechaInicio] = useState('');

  // Load current diagram assignment when editing
  useQuery({
    queryKey: ['usuario-detail', user?.id],
    queryFn: async () => {
      const { data } = await api.get(`/usuarios/${user!.id}`);
      if (data.diagramaActual) {
        setDiagramaId(data.diagramaActual.id);
        setOriginalDiagramaId(data.diagramaActual.id);
      }
      if (data.diagramas?.[0]?.fechaInicio) {
        const fi = new Date(data.diagramas[0].fechaInicio).toISOString().split('T')[0];
        setDiagramaFechaInicio(fi);
        setOriginalFechaInicio(fi);
      }
      return data;
    },
    enabled: isEdit && !!user?.id,
    staleTime: 0,
  });

  const [form, setForm] = useState({
    nombre: user?.nombre ?? '',
    apellido: user?.apellido ?? '',
    email: user?.email ?? '',
    password: '',
    rol: user?.rol ?? 'OPERADOR',
    sectorId: user?.sector?.id ?? '',
    legajo: user?.legajo ?? '',
    tipoContrato: user?.tipoContrato ?? 'INDEFINIDO',
    fechaIngreso: user?.fechaIngreso ? new Date(user.fechaIngreso).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    diagramaColor: user?.diagramaColor ?? '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    // El input de fecha no tiene `required`, solo `disabled={!diagramaId}`: se
    // puede elegir un diagrama y después borrar la fecha. Sin este chequeo,
    // `new Date('' + 'T00:00:00').toISOString()` más abajo tira un RangeError
    // que el catch disfraza de "Error de conexión".
    if (diagramaId && !diagramaFechaInicio) {
      setFieldErrors({ diagramaFechaInicio: ['Elegí la fecha de inicio del ciclo'] });
      setError('Falta la fecha de inicio del ciclo del diagrama');
      setLoading(false);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        nombre: form.nombre,
        apellido: form.apellido,
        email: form.email,
        rol: form.rol,
        sectorId: form.sectorId || null,
        legajo: form.legajo || null,
        tipoContrato: form.tipoContrato,
        fechaIngreso: new Date(form.fechaIngreso).toISOString(),
        diagramaColor: form.diagramaColor || null,
      };

      if (!isEdit) {
        body.password = form.password;
      }

      if (isEdit) {
        await api.put(`/usuarios/${user.id}`, body);
        // If diagram changed, assign it separately
        const diagramChanged = diagramaId !== originalDiagramaId || diagramaFechaInicio !== originalFechaInicio;
        if (diagramaId && diagramChanged) {
          await api.patch(`/usuarios/${user.id}/diagrama`, {
            diagramaId,
            fechaInicio: new Date(diagramaFechaInicio + 'T00:00:00').toISOString(),
          });
        }
      } else {
        const creado = await api.post('/usuarios', body);
        // El usuario YA quedó creado en este punto. Si el PATCH de abajo falla,
        // no hay que dejar el modal abierto: un reintento del POST se comería
        // un 409 "Ya existe un usuario con ese email" sin que el admin entienda
        // por qué, porque el usuario ya existe en la base.
        if (diagramaId) {
          try {
            await api.patch(`/usuarios/${creado.data.id}/diagrama`, {
              diagramaId,
              fechaInicio: new Date(diagramaFechaInicio + 'T00:00:00').toISOString(),
            });
          } catch (errDiagrama) {
            toast({
              title: 'Usuario creado, pero no se pudo asignar el diagrama',
              description: mensajeDeError(errDiagrama).mensaje,
              variant: 'destructive',
            });
            onSuccess();
            return;
          }
        }
      }

      onSuccess();
    } catch (err: unknown) {
      const { mensaje, fieldErrors: fe } = mensajeDeError(err);
      setFieldErrors(fe);
      setError(mensaje);
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">
            {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div ref={errorRef} className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input className={cn(inputClass, fieldErrors.nombre && 'border-destructive')} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
              {fieldErrors.nombre && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.nombre.join('. ')}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Apellido *</label>
              <input className={cn(inputClass, fieldErrors.apellido && 'border-destructive')} value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} required />
              {fieldErrors.apellido && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.apellido.join('. ')}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Email *</label>
            <input type="email" className={cn(inputClass, fieldErrors.email && 'border-destructive')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            {fieldErrors.email && (
              <p className="text-xs text-destructive mt-1">{fieldErrors.email.join('. ')}</p>
            )}
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Contraseña inicial *</label>
              <input type="password" className={cn(inputClass, fieldErrors.password && 'border-destructive')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
              {fieldErrors.password && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.password.join('. ')}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Mín. 8 caracteres, 1 mayúscula, 1 número</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Rol</label>
              <select className={inputClass} value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
                {roles.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Legajo</label>
              <input className={cn(inputClass, fieldErrors.legajo && 'border-destructive')} value={form.legajo} onChange={(e) => setForm({ ...form, legajo: e.target.value })} />
              {fieldErrors.legajo && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.legajo.join('. ')}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sector</label>
              <select className={inputClass} value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
                <option value="">Sin sector</option>
                {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Contrato</label>
              <select className={inputClass} value={form.tipoContrato} onChange={(e) => setForm({ ...form, tipoContrato: e.target.value })}>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="PRUEBA">Prueba</option>
                <option value="PLAZO_FIJO">Plazo fijo</option>
                <option value="EVENTUAL">Eventual</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Fecha ingreso *</label>
            <input type="date" className={inputClass} value={form.fechaIngreso} onChange={(e) => setForm({ ...form, fechaIngreso: e.target.value })} required />
          </div>

          {/* ── Diagrama de trabajo ─────────── */}
          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Diagrama de trabajo</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Diagrama</label>
                <select
                  className={inputClass}
                  value={diagramaId}
                  onChange={(e) => setDiagramaId(e.target.value)}
                >
                  <option value="">Sin diagrama</option>
                  {diagramas.filter(d => d.activo).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                      {d.tipo === 'ROTATIVO' ? ` (${d.diasTrabajo}x${d.diasDescanso})` : ' (Semanal)'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Fecha inicio ciclo</label>
                <input
                  type="date"
                  className={cn(inputClass, fieldErrors.diagramaFechaInicio && 'border-destructive')}
                  value={diagramaFechaInicio}
                  onChange={(e) => setDiagramaFechaInicio(e.target.value)}
                  disabled={!diagramaId}
                />
                {fieldErrors.diagramaFechaInicio && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.diagramaFechaInicio.join('. ')}</p>
                )}
              </div>
            </div>
            {diagramaId && (() => {
              const d = diagramas.find(x => x.id === diagramaId);
              if (!d) return null;
              return (
                <p className="text-xs text-muted-foreground">
                  {d.tipo === 'ROTATIVO'
                    ? `🔄 Rotativo: ${d.diasTrabajo} días trabajo → ${d.diasDescanso} días franco, ciclo continuo`
                    : `📅 Fijo semanal — dias libres: ${[0,1,2,3,4,5,6].filter(i => !d.diasSemana.includes(i)).map(i => ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][i]).join(', ')}`
                  }
                </p>
              );
            })()}


          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Temp Password Modal ──────────────────────────

function TempPasswordModal({
  nombre,
  tempPassword,
  onClose,
}: {
  nombre: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Contraseña restablecida</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Se generó una contraseña temporal para <strong className="text-foreground">{nombre}</strong>.
            El usuario deberá cambiarla en su próximo inicio de sesión.
          </p>

          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-muted text-foreground font-mono text-sm select-all">
              {tempPassword}
            </code>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg hover:bg-accent transition-colors shrink-0"
              title="Copiar contraseña"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
            ⚠️ Esta contraseña solo se muestra una vez. Copiala y compartila de forma segura con el usuario.
          </div>

          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
