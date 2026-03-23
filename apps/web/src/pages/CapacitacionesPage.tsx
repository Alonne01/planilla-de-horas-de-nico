import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  Loader2, GraduationCap, Plus, Trash2, Pencil, X, Save,
  AlertTriangle, CheckCircle2, Clock, BookOpen, Filter,
  CalendarPlus, Users, Send, Check, XCircle, UserCheck, Search,
} from 'lucide-react';
import ScopeToggle from '@/components/layout/ScopeToggle';

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

interface Invitacion {
  id: string;
  sesionId: string;
  usuarioId: string;
  estado: string;
  respondidoAt: string | null;
  motivoRechazo: string | null;
  asistio: boolean;
  usuario: { id: string; nombre: string; apellido: string; legajo: string };
}

interface Sesion {
  id: string;
  tipoId: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  horaInicio: string | null;
  horaFin: string | null;
  lugar: string | null;
  vacantes: number;
  estado: string;
  tipo: { id: string; nombre: string };
  organizador: { id: string; nombre: string; apellido: string };
  invitaciones: Invitacion[];
  stats: { aceptadas: number; pendientes: number; rechazadas: number; total: number };
}

interface MiInvitacion {
  id: string;
  estado: string;
  respondidoAt: string | null;
  asistio: boolean;
  sesion: {
    id: string;
    titulo: string;
    descripcion: string | null;
    fecha: string;
    horaInicio: string | null;
    horaFin: string | null;
    lugar: string | null;
    vacantes: number;
    estado: string;
    tipo: { nombre: string };
    organizador: { nombre: string; apellido: string };
  };
}

interface Subordinado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string;
  sector?: { nombre: string } | null;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: React.ElementType }> = {
  vigente: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Vigente', icon: CheckCircle2 },
  vencida: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Vencida', icon: AlertTriangle },
  proxima: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Próxima a vencer', icon: Clock },
  sin_vencimiento: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Sin vencimiento', icon: CheckCircle2 },
};

const SESION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ABIERTA: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Abierta' },
  COMPLETA: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Vacantes completas' },
  EN_CURSO: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: 'En curso' },
  FINALIZADA: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Finalizada' },
  CANCELADA: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Cancelada' },
};

export default function CapacitacionesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userNivel = user?.rolNivel ?? 0;
  const isManager = userNivel >= 70; // COORDINADOR+
  const isRRHH = userNivel >= 90;

  const [tab, setTab] = useState<'registros' | 'sesiones' | 'tipos' | 'mis-invitaciones'>('registros');
  const [statusFilter, setStatusFilter] = useState('');
  const [scope, setScope] = useState<'mio' | 'equipo'>('equipo');
  const showScopeToggle = isManager && !isRRHH;
  const [showForm, setShowForm] = useState(false);
  const [showTipoForm, setShowTipoForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSesionForm, setShowSesionForm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState<string | null>(null);
  const [selectedInvitees, setSelectedInvitees] = useState<string[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [showFinalizarModal, setShowFinalizarModal] = useState<string | null>(null);
  const [asistieronIds, setAsistieronIds] = useState<string[]>([]);

  // ─── Data fetching ─────────────────────────────

  const { data: registros, isLoading: loadingReg } = useQuery<EmpleadoCapacitacion[]>({
    queryKey: ['capacitaciones-registros', statusFilter, scope],
    queryFn: () => {
      const useMio = showScopeToggle && scope === 'mio';
      if (!isManager || useMio) return api.get('/capacitaciones/mis-capacitaciones').then((r) => r.data);
      const url = `/capacitaciones/registros${statusFilter ? `?estado=${statusFilter}` : ''}`;
      return api.get(url).then((r) => r.data);
    },
  });

  const { data: tipos } = useQuery<TipoCapacitacion[]>({
    queryKey: ['capacitaciones-tipos'],
    queryFn: () => api.get('/capacitaciones/tipos').then((r) => r.data),
    enabled: isManager,
  });

  const { data: resumen } = useQuery<Resumen>({
    queryKey: ['capacitaciones-resumen'],
    queryFn: () => api.get('/capacitaciones/resumen').then((r) => r.data),
    enabled: isManager,
  });

  const { data: usuarios } = useQuery<{ id: string; nombre: string; apellido: string }[]>({
    queryKey: ['usuarios-select'],
    queryFn: () => api.get('/usuarios').then((r) => r.data),
    enabled: isRRHH,
  });

  const { data: sesiones } = useQuery<Sesion[]>({
    queryKey: ['sesiones-capacitacion'],
    queryFn: () => api.get('/sesiones-capacitacion').then((r) => r.data),
    enabled: isManager,
  });

  const { data: subordinados } = useQuery<Subordinado[]>({
    queryKey: ['sesion-subordinados'],
    queryFn: () => api.get('/sesiones-capacitacion/subordinados').then((r) => r.data),
    enabled: isManager,
  });

  const { data: misInvitaciones } = useQuery<MiInvitacion[]>({
    queryKey: ['mis-invitaciones'],
    queryFn: () => api.get('/sesiones-capacitacion/mis-invitaciones').then((r) => r.data),
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

  // ─── Sesion form ──────────────────────────────

  const [sesionForm, setSesionForm] = useState({
    tipoId: '', titulo: '', descripcion: '', fecha: '', horaInicio: '', horaFin: '', lugar: '', vacantes: '3',
  });

  const sesionMut = useMutation({
    mutationFn: (body: any) => api.post('/sesiones-capacitacion', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sesiones-capacitacion'] });
      setShowSesionForm(false);
      setSesionForm({ tipoId: '', titulo: '', descripcion: '', fecha: '', horaInicio: '', horaFin: '', lugar: '', vacantes: '3' });
    },
  });

  const invitarMut = useMutation({
    mutationFn: ({ sesionId, usuarioIds }: { sesionId: string; usuarioIds: string[] }) =>
      api.post(`/sesiones-capacitacion/${sesionId}/invitar`, { usuarioIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sesiones-capacitacion'] });
      setShowInviteModal(null);
      setSelectedInvitees([]);
    },
  });

  const cancelarSesionMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sesiones-capacitacion/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sesiones-capacitacion'] }),
  });

  const finalizarMut = useMutation({
    mutationFn: ({ id, asistieron }: { id: string; asistieron: string[] }) =>
      api.post(`/sesiones-capacitacion/${id}/finalizar`, { asistieron }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sesiones-capacitacion'] });
      qc.invalidateQueries({ queryKey: ['capacitaciones-registros'] });
      setShowFinalizarModal(null);
    },
  });

  const responderMut = useMutation({
    mutationFn: ({ invId, aceptar, motivoRechazo }: { invId: string; aceptar: boolean; motivoRechazo?: string }) =>
      api.post(`/sesiones-capacitacion/mis-invitaciones/${invId}/responder`, { aceptar, motivoRechazo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mis-invitaciones'] });
      qc.invalidateQueries({ queryKey: ['sesiones-capacitacion'] });
    },
  });

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

  const pendingInvitations = (misInvitaciones ?? []).filter(i => i.estado === 'PENDIENTE');

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          Capacitaciones
        </h1>
        {showScopeToggle && <ScopeToggle value={scope} onChange={setScope} />}
      </div>

      {/* KPI cards (COORDINADOR+) */}
      {isManager && resumen && (
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

      {/* Tabs */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setTab('registros')}
            className={cn('px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap',
              tab === 'registros' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {isManager ? 'Registros' : 'Mis Cap.'}
          </button>
          <button
            onClick={() => setTab('mis-invitaciones')}
            className={cn('px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors relative whitespace-nowrap',
              tab === 'mis-invitaciones' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            Invitaciones
            {pendingInvitations.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
                {pendingInvitations.length}
              </span>
            )}
          </button>
          {isManager && (
            <button
              onClick={() => setTab('sesiones')}
              className={cn('px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap',
                tab === 'sesiones' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Sesiones
            </button>
          )}
          {isRRHH && (
            <button
              onClick={() => setTab('tipos')}
              className={cn('px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap',
                tab === 'tipos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Tipos
            </button>
          )}
        </div>
      </div>

      {/* ═══ REGISTROS TAB ═══ */}
      {tab === 'registros' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3">
            {isManager && (
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
                {isRRHH && (
                  <button
                    onClick={() => { resetRegForm(); setShowForm(true); }}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ml-auto"
                  >
                    <Plus className="h-4 w-4" /> Nuevo registro
                  </button>
                )}
              </>
            )}
          </div>

          {/* Create/Edit form (RRHH only) */}
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

      {/* ═══ MIS INVITACIONES TAB ═══ */}
      {tab === 'mis-invitaciones' && (
        <>
          {!(misInvitaciones?.length) ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Send className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">No tenés invitaciones a capacitaciones</p>
            </div>
          ) : (
            <div className="space-y-3">
              {misInvitaciones.map((inv) => {
                const s = inv.sesion;
                const isPending = inv.estado === 'PENDIENTE';
                const isFuture = new Date(s.fecha) >= new Date(new Date().toDateString());
                return (
                  <div key={inv.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold">{s.titulo}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.tipo.nombre}</p>
                      </div>
                      <span className={cn('px-2 py-1 rounded text-[10px] font-medium',
                        inv.estado === 'ACEPTADA' ? 'bg-emerald-500/15 text-emerald-400' :
                        inv.estado === 'RECHAZADA' ? 'bg-red-500/15 text-red-400' :
                        'bg-blue-500/15 text-blue-400'
                      )}>
                        {inv.estado === 'ACEPTADA' ? '✅ Aceptada' : inv.estado === 'RECHAZADA' ? '❌ Rechazada' : '⏳ Pendiente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>📅 {new Date(s.fecha).toLocaleDateString('es-AR')}</span>
                      {s.horaInicio && <span>🕐 {s.horaInicio}{s.horaFin ? `–${s.horaFin}` : ''}</span>}
                      {s.lugar && <span>📍 {s.lugar}</span>}
                      <span>Organiza: {s.organizador.nombre} {s.organizador.apellido}</span>
                    </div>
                    {s.descripcion && <p className="text-xs text-muted-foreground">{s.descripcion}</p>}
                    {isPending && isFuture && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => responderMut.mutate({ invId: inv.id, aceptar: true })}
                          disabled={responderMut.isPending}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" /> Aceptar
                        </button>
                        <button
                          onClick={() => {
                            const motivo = prompt('Motivo del rechazo (opcional):');
                            responderMut.mutate({ invId: inv.id, aceptar: false, motivoRechazo: motivo || undefined });
                          }}
                          disabled={responderMut.isPending}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600/20 text-red-400 text-sm font-medium hover:bg-red-600/30 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" /> Rechazar
                        </button>
                      </div>
                    )}
                    {inv.asistio && (
                      <p className="text-xs text-emerald-400 flex items-center gap-1"><UserCheck className="h-3 w-3" /> Asistencia confirmada</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══ SESIONES TAB (COORDINADOR+) ═══ */}
      {tab === 'sesiones' && isManager && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowSesionForm(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <CalendarPlus className="h-4 w-4" /> Nueva sesión
            </button>
          </div>

          {/* Create session form */}
          {showSesionForm && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Nueva sesión de capacitación</h2>
                <button onClick={() => setShowSesionForm(false)} className="p-1 rounded hover:bg-muted/50"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Título</label>
                  <input type="text" value={sesionForm.titulo}
                    onChange={(e) => setSesionForm(f => ({ ...f, titulo: e.target.value }))}
                    placeholder="Ej: Manejo Defensivo"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de capacitación</label>
                  <select value={sesionForm.tipoId}
                    onChange={(e) => setSesionForm(f => ({ ...f, tipoId: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Seleccionar...</option>
                    {(tipos ?? []).filter(t => t.activo).map(t => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Fecha</label>
                  <input type="date" value={sesionForm.fecha}
                    onChange={(e) => setSesionForm(f => ({ ...f, fecha: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Vacantes</label>
                  <input type="number" min="1" value={sesionForm.vacantes}
                    onChange={(e) => setSesionForm(f => ({ ...f, vacantes: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Hora inicio</label>
                  <input type="time" value={sesionForm.horaInicio}
                    onChange={(e) => setSesionForm(f => ({ ...f, horaInicio: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Hora fin</label>
                  <input type="time" value={sesionForm.horaFin}
                    onChange={(e) => setSesionForm(f => ({ ...f, horaFin: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Lugar</label>
                  <input type="text" value={sesionForm.lugar}
                    onChange={(e) => setSesionForm(f => ({ ...f, lugar: e.target.value }))}
                    placeholder="Ej: Sala de reuniones, Campo..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Descripción</label>
                  <input type="text" value={sesionForm.descripcion}
                    onChange={(e) => setSesionForm(f => ({ ...f, descripcion: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSesionForm(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">Cancelar</button>
                <button
                  onClick={() => sesionMut.mutate({
                    tipoId: sesionForm.tipoId,
                    titulo: sesionForm.titulo,
                    descripcion: sesionForm.descripcion || null,
                    fecha: sesionForm.fecha,
                    horaInicio: sesionForm.horaInicio || null,
                    horaFin: sesionForm.horaFin || null,
                    lugar: sesionForm.lugar || null,
                    vacantes: Number(sesionForm.vacantes) || 1,
                  })}
                  disabled={sesionMut.isPending || !sesionForm.titulo || !sesionForm.tipoId || !sesionForm.fecha}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {sesionMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                  Crear sesión
                </button>
              </div>
            </div>
          )}

          {/* Sessions list */}
          {!(sesiones?.length) ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <CalendarPlus className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">No hay sesiones de capacitación</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sesiones.map((s) => {
                const est = SESION_STYLES[s.estado] ?? SESION_STYLES.ABIERTA;
                const isFinalizable = ['ABIERTA', 'COMPLETA', 'EN_CURSO'].includes(s.estado);
                const canInvite = ['ABIERTA', 'COMPLETA'].includes(s.estado);
                return (
                  <div key={s.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold">{s.titulo}</p>
                        <p className="text-xs text-muted-foreground">{s.tipo.nombre} — Organiza: {s.organizador.nombre} {s.organizador.apellido}</p>
                      </div>
                      <span className={cn('px-2 py-1 rounded text-[10px] font-medium', est.bg, est.text)}>{est.label}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>📅 {new Date(s.fecha).toLocaleDateString('es-AR')}</span>
                      {s.horaInicio && <span>🕐 {s.horaInicio}{s.horaFin ? `–${s.horaFin}` : ''}</span>}
                      {s.lugar && <span>📍 {s.lugar}</span>}
                      <span>Vacantes: {s.vacantes}</span>
                    </div>
                    {s.descripcion && <p className="text-xs text-muted-foreground">{s.descripcion}</p>}

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">✅ {s.stats.aceptadas} aceptadas</span>
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">⏳ {s.stats.pendientes} pendientes</span>
                      <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">❌ {s.stats.rechazadas} rechazadas</span>
                    </div>

                    {/* Invitees */}
                    {s.invitaciones.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {s.invitaciones.map((inv) => (
                          <span key={inv.id} className={cn('text-[10px] px-2 py-1 rounded-lg flex items-center gap-1',
                            inv.estado === 'ACEPTADA' ? 'bg-emerald-500/10 text-emerald-400' :
                            inv.estado === 'RECHAZADA' ? 'bg-red-500/10 text-red-400 line-through' :
                            'bg-muted/30 text-muted-foreground'
                          )}>
                            {inv.usuario.apellido}, {inv.usuario.nombre}
                            {inv.asistio && <UserCheck className="h-3 w-3" />}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {canInvite && (
                        <button
                          onClick={() => { setShowInviteModal(s.id); setSelectedInvitees([]); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 text-xs font-medium hover:bg-blue-600/30"
                        >
                          <Users className="h-3.5 w-3.5" /> Invitar
                        </button>
                      )}
                      {isFinalizable && s.stats.aceptadas > 0 && (
                        <button
                          onClick={() => {
                            setShowFinalizarModal(s.id);
                            setAsistieronIds(s.invitaciones.filter(i => i.estado === 'ACEPTADA').map(i => i.usuarioId));
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
                        </button>
                      )}
                      {s.estado !== 'FINALIZADA' && s.estado !== 'CANCELADA' && (
                        <button
                          onClick={() => { if (confirm('¿Cancelar esta sesión? Se notificará a los invitados.')) cancelarSesionMut.mutate(s.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 text-xs font-medium hover:bg-red-600/30"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Invite Modal */}
          {showInviteModal && (() => {
            const currentSesion = sesiones?.find(s => s.id === showInviteModal);
            const alreadyCount = currentSesion?.invitaciones.length ?? 0;
            const vacantesDisp = (currentSesion?.vacantes ?? 0) - alreadyCount;
            const limitReached = selectedInvitees.length >= vacantesDisp;

            return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setShowInviteModal(null); setInviteSearch(''); }}>
              <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md max-h-[80vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-semibold">Invitar empleados</h2>
                <p className="text-xs text-muted-foreground">
                  Vacantes disponibles: <span className="font-semibold text-foreground">{vacantesDisp}</span> de {currentSesion?.vacantes ?? 0}
                  {selectedInvitees.length > 0 && <span className="ml-1">· Seleccionados: {selectedInvitees.length}</span>}
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar empleado..."
                    value={inviteSearch}
                    onChange={(e) => setInviteSearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(subordinados ?? [])
                    .filter((sub) => {
                      if (!inviteSearch) return true;
                      const q = inviteSearch.toLowerCase();
                      return sub.nombre.toLowerCase().includes(q) || sub.apellido.toLowerCase().includes(q);
                    })
                    .map((sub) => {
                    const alreadyInvited = currentSesion?.invitaciones.some(i => i.usuarioId === sub.id);
                    const isSelected = selectedInvitees.includes(sub.id);
                    const disabled = alreadyInvited || (!isSelected && limitReached);
                    return (
                      <label key={sub.id} className={cn('flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer text-sm', disabled && 'opacity-40')}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={isSelected}
                          onChange={(e) => setSelectedInvitees(prev =>
                            e.target.checked ? [...prev, sub.id] : prev.filter(id => id !== sub.id)
                          )}
                          className="rounded"
                        />
                        {sub.apellido}, {sub.nombre}
                        {sub.sector?.nombre && <span className="text-[10px] text-muted-foreground">({sub.sector.nombre})</span>}
                        {alreadyInvited && <span className="text-[10px] text-amber-400 ml-auto">Ya invitado</span>}
                      </label>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowInviteModal(null)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">Cancelar</button>
                  <button
                    onClick={() => invitarMut.mutate({ sesionId: showInviteModal, usuarioIds: selectedInvitees })}
                    disabled={invitarMut.isPending || selectedInvitees.length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    {invitarMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar invitaciones ({selectedInvitees.length})
                  </button>
                </div>
              </div>
            </div>
          )})()}

          {/* Finalizar Modal */}
          {showFinalizarModal && (() => {
            const sesion = sesiones?.find(s => s.id === showFinalizarModal);
            if (!sesion) return null;
            const aceptadas = sesion.invitaciones.filter(i => i.estado === 'ACEPTADA');
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowFinalizarModal(null)}>
                <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                  <h2 className="text-lg font-semibold">Finalizar sesión</h2>
                  <p className="text-xs text-muted-foreground">Marcá quién asistió a "{sesion.titulo}":</p>
                  <div className="space-y-1">
                    {aceptadas.map((inv) => (
                      <label key={inv.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={asistieronIds.includes(inv.usuarioId)}
                          onChange={(e) => setAsistieronIds(prev =>
                            e.target.checked ? [...prev, inv.usuarioId] : prev.filter(id => id !== inv.usuarioId)
                          )}
                          className="rounded"
                        />
                        {inv.usuario.apellido}, {inv.usuario.nombre}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowFinalizarModal(null)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">Cancelar</button>
                    <button
                      onClick={() => finalizarMut.mutate({ id: showFinalizarModal, asistieron: asistieronIds })}
                      disabled={finalizarMut.isPending || asistieronIds.length === 0}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {finalizarMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Finalizar ({asistieronIds.length} asistentes)
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
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
