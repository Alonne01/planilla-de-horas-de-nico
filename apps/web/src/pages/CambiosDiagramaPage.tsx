import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { avisarSinCircuito } from '@/lib/avisoCircuito';
import { claveLocal } from '@/utils/fechaDia';
import {
  ArrowLeftRight, Plus, Loader2, X, Check, XCircle,
  ChevronRight, CheckCircle2, AlertTriangle,
} from 'lucide-react';

interface Diagrama {
  id: string;
  nombre: string;
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
}

interface Solicitud {
  id: string;
  estado: string;
  motivo: string | null;
  obsRechazo: string | null;
  fechaEfectiva: string | null;
  createdAt: string;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; sector?: { nombre: string } | null };
  solicitante: { id: string; nombre: string; apellido: string };
  diagramaActual: Diagrama | null;
  diagramaNuevo: Diagrama;
  aprobadaPor: { id: string; nombre: string; apellido: string } | null;
}

interface TeamMember {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string | null;
  sector?: { nombre: string } | null;
  diagramas?: { diagrama: Diagrama; activo: boolean }[];
}

const ESTADO_STYLES: Record<string, string> = {
  PENDIENTE: 'bg-amber-500/20 text-amber-400',
  EN_REVISION: 'bg-blue-500/20 text-blue-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
};

const ESTADO_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
};

function diagramaLabel(d: Diagrama | null) {
  if (!d) return 'Sin diagrama';
  if (d.diasTrabajo && d.diasDescanso) return `${d.nombre} (${d.diasTrabajo}×${d.diasDescanso})`;
  return d.nombre;
}

/** Mañana en formato YYYY-MM-DD: el primer día que el backend acepta. */
function manana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return claveLocal(d);
}

export default function CambiosDiagramaPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const isRRHH = (user?.rolNivel ?? 0) >= 90;
  const isCoordOrHigher = (user?.rolNivel ?? 0) >= 70;

  const [showForm, setShowForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedDiagramaId, setSelectedDiagramaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fechaEfectiva, setFechaEfectiva] = useState('');
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [filter, setFilter] = useState<'all' | 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'>('all');

  // Fetch solicitudes
  const { data: solicitudes = [], isLoading } = useQuery<Solicitud[]>({
    queryKey: ['cambios-diagrama'],
    queryFn: () => api.get('/cambios-diagrama').then(r => r.data),
  });

  // Fetch pending (for RRHH approval queue)
  const { data: pendientes = [] } = useQuery<Solicitud[]>({
    queryKey: ['cambios-diagrama-pendientes'],
    queryFn: () => api.get('/cambios-diagrama/pendientes').then(r => r.data),
    enabled: isRRHH,
  });

  // Fetch team members (for creating requests)
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['equipo-members'],
    queryFn: () => api.get('/usuarios?activo=true').then(r => r.data),
    enabled: isCoordOrHigher && showForm,
  });

  // Fetch selected user detail (to get current diagrama)
  const { data: selectedUserDetail } = useQuery<{ diagramaActual: Diagrama | null }>({
    queryKey: ['user-detail', selectedUserId],
    queryFn: () => api.get(`/usuarios/${selectedUserId}`).then(r => r.data),
    enabled: !!selectedUserId,
  });

  // Fetch available diagramas
  const { data: diagramas = [] } = useQuery<Diagrama[]>({
    queryKey: ['diagramas-list'],
    queryFn: () => api.get('/cambios-diagrama/diagramas').then(r => r.data),
    enabled: showForm,
  });

  const createMutation = useMutation({
    mutationFn: (data: { usuarioId: string; diagramaNuevoId: string; motivo?: string; fechaEfectiva: string }) =>
      api.post('/cambios-diagrama', data),
    onSuccess: (res) => {
      // El alta ES el envío: si el sector del empleado no tiene circuito, el
      // servidor lo avisa acá y hay que decírselo a quien la creó.
      avisarSinCircuito(res.data);
      qc.invalidateQueries({ queryKey: ['cambios-diagrama'] });
      qc.invalidateQueries({ queryKey: ['cambios-diagrama-pendientes'] });
      setShowForm(false);
      setSelectedUserId('');
      setSelectedDiagramaId('');
      setMotivo('');
      setFechaEfectiva('');
      toast({ title: 'Solicitud creada', variant: 'success' });
    },
  });

  const aprobarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/cambios-diagrama/${id}/avanzar`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cambios-diagrama'] });
      qc.invalidateQueries({ queryKey: ['cambios-diagrama-pendientes'] });
      toast({ title: 'Solicitud aprobada', variant: 'success' });
    },
  });

  const rechazarMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.post(`/cambios-diagrama/${id}/rechazar`, { motivo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cambios-diagrama'] });
      qc.invalidateQueries({ queryKey: ['cambios-diagrama-pendientes'] });
      setRechazandoId(null);
      setMotivoRechazo('');
      toast({ title: 'Solicitud rechazada' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/cambios-diagrama/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cambios-diagrama'] });
      toast({ title: 'Solicitud cancelada' });
    },
  });

  const currentDiagrama = selectedUserDetail?.diagramaActual ?? null;

  // Merge: RRHH sees pendientes queue + own history, coordinadores see their own
  const displayList = isRRHH
    ? [...pendientes, ...solicitudes.filter(s => !pendientes.find(p => p.id === s.id))]
    : solicitudes;

  const filtered = filter === 'all' ? displayList : displayList.filter(s => s.estado === filter);

  const handleSubmit = () => {
    if (!selectedUserId || !selectedDiagramaId || !fechaEfectiva) return;
    createMutation.mutate({
      usuarioId: selectedUserId,
      diagramaNuevoId: selectedDiagramaId,
      motivo: motivo || undefined,
      fechaEfectiva,
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Cambios de Diagrama</h1>
            <p className="text-xs text-muted-foreground">
              {isRRHH ? 'Aprobá solicitudes de cambio de diagrama' : 'Solicitá cambios de diagrama para tu equipo'}
            </p>
          </div>
        </div>
        {isCoordOrHigher && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Nueva solicitud
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Nueva solicitud de cambio</h2>
            <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Select employee */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Empleado</label>
            <select
              value={selectedUserId}
              onChange={(e) => { setSelectedUserId(e.target.value); setSelectedDiagramaId(''); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Seleccionar empleado...</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.apellido}, {m.nombre} {m.legajo ? `#${m.legajo}` : ''} — {m.sector?.nombre ?? 'Sin sector'}
                </option>
              ))}
            </select>
          </div>

          {/* Current diagrama (readonly) */}
          {selectedUserId && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Diagrama actual</label>
              <div className="rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {currentDiagrama ? diagramaLabel(currentDiagrama) : 'Sin diagrama asignado'}
              </div>
            </div>
          )}

          {/* Select new diagrama */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Nuevo diagrama</label>
            <select
              value={selectedDiagramaId}
              onChange={(e) => setSelectedDiagramaId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              disabled={!selectedUserId}
            >
              <option value="">Seleccionar diagrama...</option>
              {diagramas
                .filter(d => d.id !== currentDiagrama?.id)
                .map(d => (
                  <option key={d.id} value={d.id}>{diagramaLabel(d)}</option>
                ))}
            </select>
          </div>

          {/* Fecha de inicio del diagrama nuevo */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Desde qué día rige
            </label>
            <input
              type="date"
              value={fechaEfectiva}
              min={manana()}
              onChange={(e) => setFechaEfectiva(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              La solicitud vence si no queda aprobada antes de esta fecha: ese día se
              rechaza sola y hay que pedirla de nuevo con otra fecha.
            </p>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Motivo (opcional)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Razón del cambio de diagrama..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
              rows={2}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!selectedUserId || !selectedDiagramaId || !fechaEfectiva || createMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            Enviar solicitud
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 overflow-x-auto">
        {[
          { key: 'all' as const, label: 'Todas' },
          { key: 'PENDIENTE' as const, label: 'Pendientes' },
          { key: 'APROBADA' as const, label: 'Aprobadas' },
          { key: 'RECHAZADA' as const, label: 'Rechazadas' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap',
              filter === key ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            {key !== 'all' && (
              <span className="ml-1">
                ({displayList.filter(s => s.estado === key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay solicitudes de cambio de diagrama</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.usuario.apellido}, {s.usuario.nombre}</span>
                    {s.usuario.legajo && <span className="text-xs text-muted-foreground">#{s.usuario.legajo}</span>}
                    <span className="text-xs text-muted-foreground">{s.usuario.sector?.nombre}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Solicitado por {s.solicitante.nombre} {s.solicitante.apellido} · {new Date(s.createdAt).toLocaleDateString('es-AR')}
                  </p>
                </div>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', ESTADO_STYLES[s.estado] ?? 'bg-muted text-muted-foreground')}>
                  {ESTADO_LABELS[s.estado] ?? s.estado}
                </span>
              </div>

              {/* Diagram change */}
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 rounded-lg bg-muted/50 text-muted-foreground text-xs">
                  {diagramaLabel(s.diagramaActual)}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                  {diagramaLabel(s.diagramaNuevo)}
                </span>
              </div>

              {/* Motivo */}
              {s.motivo && (
                <p className="text-xs text-muted-foreground italic">"{s.motivo}"</p>
              )}

              {/* Rejection reason */}
              {s.obsRechazo && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-400">{s.obsRechazo}</p>
                </div>
              )}

              {/* Approval info */}
              {s.aprobadaPor && s.estado === 'APROBADA' && (
                <p className="text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
                  Aprobada por {s.aprobadaPor.nombre} {s.aprobadaPor.apellido}
                </p>
              )}

              {/* Actions */}
              {(s.estado === 'PENDIENTE' || s.estado === 'EN_REVISION') && (
                <div className="flex items-center gap-2 pt-1">
                  {/* RRHH can approve/reject */}
                  {isRRHH && (
                    <>
                      <button
                        onClick={() => aprobarMutation.mutate(s.id)}
                        disabled={aprobarMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {aprobarMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Aprobar
                      </button>
                      {rechazandoId === s.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            value={motivoRechazo}
                            onChange={(e) => setMotivoRechazo(e.target.value)}
                            placeholder="Motivo de rechazo..."
                            className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                            autoFocus
                          />
                          <button
                            onClick={() => { rechazarMutation.mutate({ id: s.id, motivo: motivoRechazo }); }}
                            disabled={!motivoRechazo || rechazarMutation.isPending}
                            className="px-2 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                          <button onClick={() => { setRechazandoId(null); setMotivoRechazo(''); }} className="p-1 rounded hover:bg-muted">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRechazandoId(s.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Rechazar
                        </button>
                      )}
                    </>
                  )}

                  {/* Solicitante can cancel pending */}
                  {s.solicitante.id === user?.id && s.estado === 'PENDIENTE' && (
                    <button
                      onClick={() => cancelMutation.mutate(s.id)}
                      disabled={cancelMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-xs hover:bg-muted transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Cancelar
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
