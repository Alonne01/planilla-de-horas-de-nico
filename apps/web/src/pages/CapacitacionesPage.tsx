import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  Loader2, GraduationCap, Plus, Trash2, Pencil, X, Save,
  AlertTriangle, CheckCircle2, Clock, BookOpen, Filter,
} from 'lucide-react';

interface TipoCapacitacion {
  id: string;
  nombre: string;
  descripcion: string | null;
  vigenciaDias: number | null;
  esObligatoria: boolean;
  alertaDias: number;
  activo: boolean;
  _count?: { capacitaciones: number };
}

interface EmpleadoCapacitacion {
  id: string;
  usuarioId: string;
  tipoId: string;
  fechaRealizacion: string;
  fechaVencimiento: string | null;
  institucion: string | null;
  archivoUrl: string | null;
  observaciones: string | null;
  statusCap?: 'vigente' | 'vencida' | 'proxima' | 'sin_vencimiento';
  tipo: TipoCapacitacion;
  usuario?: { id: string; nombre: string; apellido: string; legajo: string };
}

interface Resumen {
  total: number;
  vigentes: number;
  vencidas: number;
  proximas: number;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: React.ElementType }> = {
  vigente: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Vigente', icon: CheckCircle2 },
  vencida: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Vencida', icon: AlertTriangle },
  proxima: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Próxima a vencer', icon: Clock },
  sin_vencimiento: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Sin vencimiento', icon: CheckCircle2 },
};

export default function CapacitacionesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;

  const [tab, setTab] = useState<'registros' | 'tipos'>('registros');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showTipoForm, setShowTipoForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ─── Data fetching ─────────────────────────────

  const { data: registros, isLoading: loadingReg } = useQuery<EmpleadoCapacitacion[]>({
    queryKey: ['capacitaciones-registros', statusFilter],
    queryFn: () => {
      const url = isRRHH
        ? `/capacitaciones/registros${statusFilter ? `?estado=${statusFilter}` : ''}`
        : '/capacitaciones/mis-capacitaciones';
      return api.get(url).then((r) => r.data);
    },
  });

  const { data: tipos } = useQuery<TipoCapacitacion[]>({
    queryKey: ['capacitaciones-tipos'],
    queryFn: () => api.get('/capacitaciones/tipos').then((r) => r.data),
    enabled: isRRHH,
  });

  const { data: resumen } = useQuery<Resumen>({
    queryKey: ['capacitaciones-resumen'],
    queryFn: () => api.get('/capacitaciones/resumen').then((r) => r.data),
    enabled: isRRHH,
  });

  const { data: usuarios } = useQuery<{ id: string; nombre: string; apellido: string }[]>({
    queryKey: ['usuarios-select'],
    queryFn: () => api.get('/usuarios').then((r) => r.data),
    enabled: isRRHH,
  });

  // ─── Registro form ────────────────────────────

  const [regForm, setRegForm] = useState({
    usuarioId: '', tipoId: '', fechaRealizacion: '', institucion: '', observaciones: '',
  });

  const regMut = useMutation({
    mutationFn: (body: any) => editingId
      ? api.put(`/capacitaciones/registros/${editingId}`, body)
      : api.post('/capacitaciones/registros', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capacitaciones-registros'] });
      qc.invalidateQueries({ queryKey: ['capacitaciones-resumen'] });
      resetRegForm();
    },
  });

  const deleteRegMut = useMutation({
    mutationFn: (id: string) => api.delete(`/capacitaciones/registros/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capacitaciones-registros'] });
      qc.invalidateQueries({ queryKey: ['capacitaciones-resumen'] });
    },
  });

  const resetRegForm = () => {
    setShowForm(false);
    setEditingId(null);
    setRegForm({ usuarioId: '', tipoId: '', fechaRealizacion: '', institucion: '', observaciones: '' });
  };

  // ─── Tipo form ────────────────────────────────

  const [tipoForm, setTipoForm] = useState({
    nombre: '', descripcion: '', vigenciaDias: '', esObligatoria: false, alertaDias: '30',
  });
  const [editingTipoId, setEditingTipoId] = useState<string | null>(null);

  const tipoMut = useMutation({
    mutationFn: (body: any) => editingTipoId
      ? api.put(`/capacitaciones/tipos/${editingTipoId}`, body)
      : api.post('/capacitaciones/tipos', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capacitaciones-tipos'] });
      resetTipoForm();
    },
  });

  const deleteTipoMut = useMutation({
    mutationFn: (id: string) => api.delete(`/capacitaciones/tipos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capacitaciones-tipos'] }),
  });

  const resetTipoForm = () => {
    setShowTipoForm(false);
    setEditingTipoId(null);
    setTipoForm({ nombre: '', descripcion: '', vigenciaDias: '', esObligatoria: false, alertaDias: '30' });
  };

  const openEditTipo = (t: TipoCapacitacion) => {
    setEditingTipoId(t.id);
    setTipoForm({
      nombre: t.nombre,
      descripcion: t.descripcion ?? '',
      vigenciaDias: t.vigenciaDias?.toString() ?? '',
      esObligatoria: t.esObligatoria,
      alertaDias: t.alertaDias.toString(),
    });
    setShowTipoForm(true);
  };

  // Compute status for employee view
  const enrichedRegistros = (registros ?? []).map((r) => {
    if (r.statusCap) return r;
    const now = new Date();
    let statusCap: string = 'sin_vencimiento';
    if (r.fechaVencimiento) {
      const diff = Math.ceil((new Date(r.fechaVencimiento).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff < 0) statusCap = 'vencida';
      else if (diff <= (r.tipo?.alertaDias ?? 30)) statusCap = 'proxima';
      else statusCap = 'vigente';
    }
    return { ...r, statusCap };
  });

  if (loadingReg) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          {isRRHH ? 'Capacitaciones' : 'Mis Capacitaciones'}
        </h1>
      </div>

      {/* KPI cards (RRHH only) */}
      {isRRHH && resumen && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: resumen.total, color: 'text-foreground' },
            { label: 'Vigentes', value: resumen.vigentes, color: 'text-emerald-400' },
            { label: 'Próximas', value: resumen.proximas, color: 'text-amber-400' },
            { label: 'Vencidas', value: resumen.vencidas, color: 'text-red-400' },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4 text-center">
              <p className={cn('text-2xl font-bold', k.color)}>{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs (RRHH) */}
      {isRRHH && (
        <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setTab('registros')}
            className={cn('px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === 'registros' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            Registros
          </button>
          <button
            onClick={() => setTab('tipos')}
            className={cn('px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === 'tipos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            Tipos de capacitación
          </button>
        </div>
      )}

      {/* ═══ REGISTROS TAB ═══ */}
      {tab === 'registros' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            {isRRHH && (
              <>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <option value="">Todos los estados</option>
                  <option value="vigente">Vigentes</option>
                  <option value="proxima">Próximas a vencer</option>
                  <option value="vencida">Vencidas</option>
                </select>
                <button
                  onClick={() => { resetRegForm(); setShowForm(true); }}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ml-auto"
                >
                  <Plus className="h-4 w-4" /> Nuevo registro
                </button>
              </>
            )}
          </div>

          {/* Create/Edit form */}
          {showForm && isRRHH && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editingId ? 'Editar registro' : 'Nuevo registro'}</h2>
                <button onClick={resetRegForm} className="p-1 rounded hover:bg-muted/50"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Empleado</label>
                  <select
                    value={regForm.usuarioId}
                    onChange={(e) => setRegForm((f) => ({ ...f, usuarioId: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {(usuarios ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.apellido}, {u.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de capacitación</label>
                  <select
                    value={regForm.tipoId}
                    onChange={(e) => setRegForm((f) => ({ ...f, tipoId: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {(tipos ?? []).filter((t) => t.activo).map((t) => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Fecha realización</label>
                  <input
                    type="date"
                    value={regForm.fechaRealizacion}
                    onChange={(e) => setRegForm((f) => ({ ...f, fechaRealizacion: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Institución</label>
                  <input
                    type="text"
                    value={regForm.institucion}
                    onChange={(e) => setRegForm((f) => ({ ...f, institucion: e.target.value }))}
                    placeholder="Ej: IRAM, UTN..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Observaciones</label>
                <input
                  type="text"
                  value={regForm.observaciones}
                  onChange={(e) => setRegForm((f) => ({ ...f, observaciones: e.target.value }))}
                  placeholder="Notas adicionales..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={resetRegForm} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">Cancelar</button>
                <button
                  onClick={() => regMut.mutate(regForm)}
                  disabled={regMut.isPending || !regForm.usuarioId || !regForm.tipoId || !regForm.fechaRealizacion}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {regMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingId ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          {/* Records list */}
          {enrichedRegistros.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <BookOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">No hay capacitaciones registradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {enrichedRegistros.map((r) => {
                const st = STATUS_STYLES[r.statusCap ?? 'sin_vencimiento'];
                const Icon = st.icon;
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                    <div className={cn('p-2 rounded-lg', st.bg)}>
                      <Icon className={cn('h-4 w-4', st.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.tipo?.nombre ?? 'Capacitación'}</p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {r.usuario && (
                          <span className="text-xs text-muted-foreground">
                            {r.usuario.apellido}, {r.usuario.nombre}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.fechaRealizacion).toLocaleDateString('es-AR')}
                        </span>
                        {r.fechaVencimiento && (
                          <span className={cn('text-[10px] px-2 py-0.5 rounded', st.bg, st.text)}>
                            Vence: {new Date(r.fechaVencimiento).toLocaleDateString('es-AR')}
                          </span>
                        )}
                        {r.institucion && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-muted/30 text-muted-foreground">
                            {r.institucion}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={cn('px-2 py-1 rounded-lg text-[10px] font-medium', st.bg, st.text)}>
                      {st.label}
                    </span>
                    {isRRHH && (
                      <button
                        onClick={() => { if (confirm('¿Eliminar este registro?')) deleteRegMut.mutate(r.id); }}
                        className="p-2 rounded-lg text-red-400 hover:bg-red-500/15 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ TIPOS TAB ═══ */}
      {tab === 'tipos' && isRRHH && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => { resetTipoForm(); setShowTipoForm(true); }}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Nuevo tipo
            </button>
          </div>

          {/* Tipo form */}
          {showTipoForm && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editingTipoId ? 'Editar tipo' : 'Nuevo tipo'}</h2>
                <button onClick={resetTipoForm} className="p-1 rounded hover:bg-muted/50"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre</label>
                  <input
                    type="text"
                    value={tipoForm.nombre}
                    onChange={(e) => setTipoForm((f) => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Seguridad e Higiene"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Vigencia (días)</label>
                  <input
                    type="number"
                    value={tipoForm.vigenciaDias}
                    onChange={(e) => setTipoForm((f) => ({ ...f, vigenciaDias: e.target.value }))}
                    placeholder="Vacío = sin vencimiento"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Descripción</label>
                  <input
                    type="text"
                    value={tipoForm.descripcion}
                    onChange={(e) => setTipoForm((f) => ({ ...f, descripcion: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Alerta (días antes)</label>
                  <input
                    type="number"
                    value={tipoForm.alertaDias}
                    onChange={(e) => setTipoForm((f) => ({ ...f, alertaDias: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={tipoForm.esObligatoria}
                  onChange={(e) => setTipoForm((f) => ({ ...f, esObligatoria: e.target.checked }))}
                  className="rounded"
                />
                Es obligatoria
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={resetTipoForm} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">Cancelar</button>
                <button
                  onClick={() => tipoMut.mutate({
                    nombre: tipoForm.nombre,
                    descripcion: tipoForm.descripcion || null,
                    vigenciaDias: tipoForm.vigenciaDias ? Number(tipoForm.vigenciaDias) : null,
                    esObligatoria: tipoForm.esObligatoria,
                    alertaDias: Number(tipoForm.alertaDias) || 30,
                  })}
                  disabled={tipoMut.isPending || !tipoForm.nombre}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {tipoMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingTipoId ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          {/* Types list */}
          {!(tipos?.length) ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <GraduationCap className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">No hay tipos de capacitación</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tipos.map((t) => (
                <div
                  key={t.id}
                  className={cn('rounded-xl border border-border bg-card p-4 flex items-center gap-4', !t.activo && 'opacity-50')}
                >
                  <GraduationCap className={cn('h-5 w-5', t.esObligatoria ? 'text-red-400' : 'text-primary')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {t.nombre}
                      {t.esObligatoria && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Obligatoria</span>
                      )}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {t.descripcion && <span className="text-xs text-muted-foreground">{t.descripcion}</span>}
                      <span className="text-[10px] text-muted-foreground">
                        {t.vigenciaDias ? `Vigencia: ${t.vigenciaDias} días` : 'Sin vencimiento'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {t._count?.capacitaciones ?? 0} registros
                      </span>
                    </div>
                  </div>
                  <button onClick={() => openEditTipo(t)} className="p-2 rounded-lg hover:bg-muted/50">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => { if (confirm('¿Desactivar este tipo?')) deleteTipoMut.mutate(t.id); }}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-500/15"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
