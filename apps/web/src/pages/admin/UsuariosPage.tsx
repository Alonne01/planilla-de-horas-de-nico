import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import {
  Pencil, Trash2, Search, UserPlus,
  Loader2, X, ChevronDown, ChevronUp, KeyRound, Copy, Check
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

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
  categoria: { id: string; codigo: string; nombre: string } | null;
  convenio: { id: string; nombre: string } | null;
}

interface Sector { id: string; nombre: string }
interface Categoria { id: string; codigo: string; nombre: string }
interface Convenio { id: string; nombre: string }
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
    queryFn: async () => (await api.get('/admin/sectores')).data,
    enabled: canEdit,
  });

  const { data: convenios = [] } = useQuery<Convenio[]>({
    queryKey: ['convenios'],
    queryFn: async () => (await api.get('/admin/convenios')).data,
    enabled: canEdit,
  });

  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ['categorias'],
    queryFn: async () => (await api.get('/admin/categorias')).data,
    enabled: canEdit,
  });

  const { data: rolesConfig = [] } = useQuery<RolConfig[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/admin/roles')).data,
  });

  const { data: diagramas = [] } = useQuery<Diagrama[]>({
    queryKey: ['diagramas'],
    queryFn: async () => (await api.get('/admin/diagramas')).data,
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
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      alert(axiosErr.response?.data?.error ?? 'Error al restablecer la contraseña');
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
                  <p className="text-xs text-muted-foreground">{u.categoria?.codigo ?? ''}</p>
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
                      <span className="text-muted-foreground">Categoría:</span>
                      <p className="font-medium">{u.categoria?.nombre || '—'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Convenio:</span>
                      <p className="font-medium">{u.convenio?.nombre || '—'}</p>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`¿Desactivar a ${u.nombre} ${u.apellido}?`)) {
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
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`¿Restablecer la contraseña de ${u.nombre} ${u.apellido}? Se generará una contraseña temporal.`)) {
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
          convenios={convenios}
          categorias={categorias}
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
  convenios,
  categorias,
  roles,
  diagramas,
  onClose,
  onSuccess,
}: {
  user: User | null;
  sectores: Sector[];
  convenios: Convenio[];
  categorias: Categoria[];
  roles: RolConfig[];
  diagramas: Diagrama[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
    categoriaId: user?.categoria?.id ?? '',
    convenioId: user?.convenio?.id ?? '',
    legajo: user?.legajo ?? '',
    tipoContrato: user?.tipoContrato ?? 'INDEFINIDO',
    fechaIngreso: user?.fechaIngreso ? new Date(user.fechaIngreso).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    diagramaColor: user?.diagramaColor ?? '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const body: Record<string, unknown> = {
        nombre: form.nombre,
        apellido: form.apellido,
        email: form.email,
        rol: form.rol,
        sectorId: form.sectorId || null,
        categoriaId: form.categoriaId || null,
        convenioId: form.convenioId || null,
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
        const created = await api.post('/usuarios', body);
        // Assign diagram to new user if selected
        if (diagramaId) {
          await api.patch(`/usuarios/${created.data.id}/diagrama`, {
            diagramaId,
            fechaInicio: new Date(diagramaFechaInicio + 'T00:00:00').toISOString(),
          });
        }
      }

      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al guardar');
      } else {
        setError('Error de conexión');
      }
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
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input className={inputClass} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Apellido *</label>
              <input className={inputClass} value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} required />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Email *</label>
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Contraseña inicial *</label>
              <input type="password" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
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
              <input className={inputClass} value={form.legajo} onChange={(e) => setForm({ ...form, legajo: e.target.value })} />
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
              <label className="text-xs font-medium text-muted-foreground">Convenio</label>
              <select className={inputClass} value={form.convenioId} onChange={(e) => setForm({ ...form, convenioId: e.target.value })}>
                <option value="">Sin convenio</option>
                {convenios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <select className={inputClass} value={form.categoriaId} onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}>
                <option value="">Sin categoría</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
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
                  className={inputClass}
                  value={diagramaFechaInicio}
                  onChange={(e) => setDiagramaFechaInicio(e.target.value)}
                  disabled={!diagramaId}
                />
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
