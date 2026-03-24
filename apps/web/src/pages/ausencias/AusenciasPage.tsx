import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import api, { getUploadUrl } from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useCanApprove } from '@/hooks/useCanApprove';
import CalendarRangePicker from '@/components/layout/CalendarRangePicker';
import VacacionesPage from '@/pages/vacaciones/VacacionesPage';
import {
  AlertTriangle, Plus, Trash2, Loader2, X,
  Calendar, FileText, Send, Upload, Palmtree,
  Clock, UserCheck, RotateCcw, Filter, XCircle,
} from 'lucide-react';
import PeriodSelector, { getCurrentPeriod } from '@/components/layout/PeriodSelector';
import ScopeToggle from '@/components/layout/ScopeToggle';
import { useDialogStore } from '@/stores/dialogStore';

interface Ausencia {
  id: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasAusencia: number;
  descripcion: string | null;
  numeroCertificado: string | null;
  descuentaSueldo: boolean;
  aprobada: boolean;
  requiereAprobacion: boolean;
  estado: string;
  archivoUrl: string | null;
  obsRechazo?: string | null;
  usuarioId: string;
  usuario: { id: string; nombre: string; apellido: string; sector?: { id: string; nombre: string } | null };
  cargadaPor?: { id: string; nombre: string; apellido: string } | null;
}

interface Subordinado {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string | null;
  sector?: { nombre: string } | null;
}

interface CompensatorioSaldo {
  compensatoriosAcumulados: number;
  compensatoriosUsados: number;
  compensatoriosPendientes: number;
  compensatoriosDisponible: number;
}

const TIPO_STYLES: Record<string, string> = {
  CERTIFICADO_MEDICO: 'bg-blue-500/20 text-blue-400',
  FALTA_JUSTIFICADA: 'bg-amber-500/20 text-amber-400',
  FALTA_INJUSTIFICADA: 'bg-red-500/20 text-red-400',
  LICENCIA_ESPECIAL: 'bg-purple-500/20 text-purple-400',
  FRANCO_COMPENSATORIO: 'bg-cyan-500/20 text-cyan-400',
};

const TIPO_LABELS: Record<string, string> = {
  CERTIFICADO_MEDICO: 'Certificado Médico',
  FALTA_JUSTIFICADA: 'Falta Justificada',
  FALTA_INJUSTIFICADA: 'Falta Injustificada',
  LICENCIA_ESPECIAL: 'Licencia Especial',
  FRANCO_COMPENSATORIO: 'Franco Compensatorio',
};

const ESTADO_STYLES: Record<string, string> = {
  BORRADOR: 'bg-muted/30 text-muted-foreground',
  PENDIENTE: 'bg-blue-500/20 text-blue-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE: 'Pendiente',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
};

export default function AusenciasPage() {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') === 'vacaciones') ? 'vacaciones' : 'ausencias';
  const setActiveTab = (tab: 'ausencias' | 'vacaciones') => {
    setSearchParams(tab === 'ausencias' ? {} : { tab: 'vacaciones' }, { replace: true });
  };
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);
  const [showCompForm, setShowCompForm] = useState(false);
  const [showSolicitarForm, setShowSolicitarForm] = useState(false);
  const [filterTipo, setFilterTipo] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [periodo, setPeriodo] = useState(getCurrentPeriod());
  const [scope, setScope] = useState<'mio' | 'equipo'>('equipo');
  const isRRHH = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');
  const canApprove = useCanApprove();
  const showScopeToggle = canApprove === true && (user?.rolNivel ?? 0) >= 70 && !isRRHH;

  interface Sector { id: string; nombre: string; }
  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores-ausencias'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
    enabled: isRRHH,
  });

  const isSuperior = (user?.rolNivel ?? 0) >= 60;

  const { data: ausencias = [], isLoading } = useQuery<Ausencia[]>({
    queryKey: ['ausencias', filterTipo, periodo.inicio, periodo.fin, scope],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterTipo) params.set('tipo', filterTipo);
      params.set('periodoInicio', periodo.inicio);
      params.set('periodoFin', periodo.fin);
      if (showScopeToggle && scope === 'mio') params.set('scope', 'mio');
      else if (!showScopeToggle && canApprove !== true) params.set('scope', 'mio');
      return (await api.get(`/ausencias?${params.toString()}`)).data;
    },
  });

  const { data: saldo } = useQuery<CompensatorioSaldo>({
    queryKey: ['compensatorio-saldo'],
    queryFn: async () => {
      const res = await api.get('/vacacion-saldos/mi-saldo');
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ausencias/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ausencias'] }),
  });

  const enviarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ausencias/${id}/enviar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ausencias'] }),
  });

  const revocarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ausencias/${id}/revocar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ausencias'] });
      queryClient.invalidateQueries({ queryKey: ['compensatorio-saldo'] });
    },
  });

  const filteredAusencias = filterSector
    ? ausencias.filter(a => a.usuario.sector?.id === filterSector)
    : ausencias;

  const filteredTotalDias = filteredAusencias.reduce((acc, a) => acc + a.diasAusencia, 0);

  const canRevocar = (a: Ausencia) => {
    if (a.tipo !== 'FRANCO_COMPENSATORIO') return false;
    if (a.usuarioId !== user?.id) return false;
    if (!['PENDIENTE', 'EN_REVISION', 'APROBADA'].includes(a.estado)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(a.fechaInicio) >= today;
  };

  return (
    <div className="space-y-6">
      {/* Page header with tabs */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 mb-4">
          <AlertTriangle className="h-6 w-6 text-amber-400" /> Ausencias y Vacaciones
        </h1>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('ausencias')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
              activeTab === 'ausencias'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <AlertTriangle className="h-4 w-4" /> Ausencias
          </button>
          <button
            onClick={() => setActiveTab('vacaciones')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
              activeTab === 'vacaciones'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Palmtree className="h-4 w-4" /> Vacaciones
          </button>
        </div>
      </div>

      {activeTab === 'vacaciones' ? (
        <VacacionesPage embedded />
      ) : (
      <>
      {/* Compensatorio balance card */}
      {saldo && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-semibold text-cyan-400">Compensatorios</span>
          </div>
          <p className="text-lg font-bold text-foreground">
            {saldo.compensatoriosDisponible} disponible{saldo.compensatoriosDisponible !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {saldo.compensatoriosAcumulados} acumulados · {saldo.compensatoriosUsados} usados · {saldo.compensatoriosPendientes} pendientes
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {filteredAusencias.length} registro{filteredAusencias.length !== 1 ? 's' : ''} — {filteredTotalDias} días total
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowSolicitarForm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 rounded-lg bg-amber-600 text-white text-xs sm:text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            <FileText className="h-4 w-4" /> Solicitar ausencia
          </button>
          <button
            onClick={() => setShowCompForm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 sm:px-4 rounded-lg bg-cyan-600 text-white text-xs sm:text-sm font-medium hover:bg-cyan-700 transition-colors"
          >
            <Calendar className="h-4 w-4" /> Pedir compensatorio
          </button>
          {isSuperior && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> Cargar ausencia
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector value={periodo} onChange={setPeriodo} />
        {showScopeToggle && <ScopeToggle value={scope} onChange={setScope} />}
        {isRRHH && sectores.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              className="h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm"
              value={filterSector}
              onChange={(e) => setFilterSector(e.target.value)}
            >
              <option value="">Todos los sectores</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {['', 'CERTIFICADO_MEDICO', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA', 'LICENCIA_ESPECIAL', 'FRANCO_COMPENSATORIO'].map((t) => (
          <button
            key={t}
            onClick={() => setFilterTipo(t)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filterTipo === t ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            )}
          >
            {t === '' ? 'Todas' : TIPO_LABELS[t]}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredAusencias.length === 0 ? (
        <div className="text-center py-16">
          <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">No hay ausencias registradas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAusencias.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TIPO_STYLES[a.tipo])}>
                      {TIPO_LABELS[a.tipo]}
                    </span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[a.estado])}>
                      {ESTADO_LABELS[a.estado] ?? a.estado}
                    </span>
                    <span className="text-sm font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(a.fechaInicio).toLocaleDateString('es-AR')} — {new Date(a.fechaFin).toLocaleDateString('es-AR')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.diasAusencia} día{a.diasAusencia !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <UserCheck className="h-3 w-3" />
                      {a.usuario.apellido}, {a.usuario.nombre}
                    </span>
                    {a.cargadaPor && (
                      <span>cargada por {a.cargadaPor.apellido}, {a.cargadaPor.nombre}</span>
                    )}
                    {a.numeroCertificado && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" /> Cert. {a.numeroCertificado}
                      </span>
                    )}
                    {a.archivoUrl && (
                      <a
                        href={getUploadUrl(a.archivoUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" /> Ver archivo
                      </a>
                    )}
                    {a.descripcion && <span>{a.descripcion}</span>}
                    {a.descuentaSueldo && <span className="text-red-400">💰 Descuenta sueldo</span>}
                  </div>
                  {a.obsRechazo && a.estado === 'RECHAZADA' && (
                    <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                      <XCircle className="h-3 w-3 shrink-0" /> {a.obsRechazo}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {canRevocar(a) && (
                    <button
                      onClick={async () => {
                        if (await dialog.confirm({ message: '¿Estás seguro de revocar este franco compensatorio? Los días volverán a tu saldo.', variant: 'danger' }))
                          revocarMutation.mutate(a.id);
                      }}
                      disabled={revocarMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/80 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                      title="Revocar compensatorio"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Revocar
                    </button>
                  )}
                  {a.estado === 'BORRADOR' && isSuperior && (
                    <button
                      onClick={() => enviarMutation.mutate(a.id)}
                      disabled={enviarMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      title="Enviar a aprobación"
                    >
                      <Send className="h-3.5 w-3.5" /> Enviar
                    </button>
                  )}
                  {a.estado === 'BORRADOR' && (
                    <button
                      onClick={async () => { if (await dialog.confirm({ message: '¿Eliminar esta ausencia?', variant: 'danger' })) deleteMutation.mutate(a.id); }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Ausencia Modal (superior) */}
      {showForm && (
        <AusenciaFormModal
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['ausencias'] });
          }}
        />
      )}

      {/* Create Compensatorio Modal (any user) */}
      {showCompForm && (
        <CompensatorioFormModal
          saldo={saldo}
          onClose={() => setShowCompForm(false)}
          onSuccess={() => {
            setShowCompForm(false);
            queryClient.invalidateQueries({ queryKey: ['ausencias'] });
            queryClient.invalidateQueries({ queryKey: ['compensatorio-saldo'] });
          }}
        />
      )}

      {/* Employee Self-Service Ausencia Modal */}
      {showSolicitarForm && (
        <SolicitarAusenciaModal
          onClose={() => setShowSolicitarForm(false)}
          onSuccess={() => {
            setShowSolicitarForm(false);
            queryClient.invalidateQueries({ queryKey: ['ausencias'] });
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

// ─── Create Modal ────────────────────────────────

function AusenciaFormModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState('CERTIFICADO_MEDICO');
  const [usuarioId, setUsuarioId] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [numeroCertificado, setNumeroCertificado] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: subordinados = [] } = useQuery<Subordinado[]>({
    queryKey: ['ausencias-subordinados'],
    queryFn: () => api.get('/ausencias/subordinados').then(r => r.data),
  });

  function calcDias(s: Date | null, e: Date | null) {
    if (!s || !e) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  }

  const diasAusencia = calcDias(startDate, endDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuarioId || !startDate || !endDate) {
      setError('Completá empleado y rango de fechas');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/ausencias', {
        usuarioId,
        tipo,
        fechaInicio: startDate.toISOString(),
        fechaFin: endDate.toISOString(),
        diasAusencia,
        descripcion: descripcion || undefined,
        numeroCertificado: numeroCertificado || undefined,
      });

      // Upload file if selected
      if (archivo && res.data?.id) {
        const fd = new FormData();
        fd.append('archivo', archivo);
        await api.post(`/ausencias/${res.data.id}/archivo`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al crear');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl my-8">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Cargar Ausencia de Subordinado</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Empleado selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Empleado *</label>
            <select className={inputClass} value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} required>
              <option value="">Seleccioná un empleado...</option>
              {subordinados.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.apellido}, {s.nombre} {s.legajo ? `(${s.legajo})` : ''} {s.sector ? `— ${s.sector.nombre}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Tipo */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tipo *</label>
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(TIPO_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            {tipo === 'CERTIFICADO_MEDICO' && (
              <p className="text-xs text-emerald-400 mt-1">✓ Los certificados médicos se aprueban automáticamente</p>
            )}
          </div>

          {/* Calendar date picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Rango de fechas *</label>
            <div className="rounded-lg border border-border p-3 bg-background">
              <CalendarRangePicker
                startDate={startDate}
                endDate={endDate}
                onSelect={(s, e) => { setStartDate(s); setEndDate(e); }}
                allowPast={true}
              />
            </div>
            {startDate && endDate && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {startDate.toLocaleDateString('es-AR')} — {endDate.toLocaleDateString('es-AR')} · {diasAusencia} día{diasAusencia !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {tipo === 'CERTIFICADO_MEDICO' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">N° Certificado</label>
              <input
                className={inputClass}
                value={numeroCertificado}
                onChange={(e) => setNumeroCertificado(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          )}

          {/* File upload */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Certificado médico (imagen o PDF)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed transition-colors',
                archivo
                  ? 'border-primary/50 bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
              )}
            >
              <Upload className="h-4 w-4" />
              {archivo ? archivo.name : 'Subir archivo'}
            </button>
            {archivo && (
              <button
                type="button"
                onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="text-xs text-red-400 mt-1 hover:underline"
              >
                Quitar archivo
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input
              className={inputClass}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !usuarioId || !startDate || !endDate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Compensatorio Request Modal ─────────────────

function CompensatorioFormModal({
  saldo,
  onClose,
  onSuccess,
}: {
  saldo?: CompensatorioSaldo;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [descripcion, setDescripcion] = useState('');

  function calcDias(s: Date | null, e: Date | null) {
    if (!s || !e) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  }

  const diasAusencia = calcDias(startDate, endDate);
  const disponible = saldo?.compensatoriosDisponible ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      setError('Seleccioná un rango de fechas');
      return;
    }
    if (diasAusencia > disponible) {
      setError(`Saldo insuficiente. Disponible: ${disponible} días`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/ausencias/compensatorio', {
        fechaInicio: startDate.toISOString(),
        fechaFin: endDate.toISOString(),
        diasAusencia,
        descripcion: descripcion || undefined,
      });
      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al crear');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl my-8">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Pedir Franco Compensatorio</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
            <p className="text-sm text-cyan-400 font-medium">
              Saldo disponible: {disponible} día{disponible !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Calendar date picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Rango de fechas *</label>
            <div className="rounded-lg border border-border p-3 bg-background">
              <CalendarRangePicker
                startDate={startDate}
                endDate={endDate}
                onSelect={(s, e) => { setStartDate(s); setEndDate(e); }}
                allowPast={false}
              />
            </div>
            {startDate && endDate && (
              <p className={cn(
                'text-xs mt-1 flex items-center gap-1',
                diasAusencia > disponible ? 'text-red-400' : 'text-muted-foreground'
              )}>
                <Clock className="h-3 w-3" />
                {startDate.toLocaleDateString('es-AR')} — {endDate.toLocaleDateString('es-AR')} · {diasAusencia} día{diasAusencia !== 1 ? 's' : ''}
                {diasAusencia > disponible && ' (excede saldo)'}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input
              className={inputClass}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !startDate || !endDate || diasAusencia > disponible}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Solicitar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Employee Self-Service Ausencia Modal ─────────

const EMPLOYEE_TIPO_OPTIONS: Record<string, string> = {
  CERTIFICADO_MEDICO: 'Certificado Médico',
  FALTA_JUSTIFICADA: 'Falta Justificada',
  LICENCIA_ESPECIAL: 'Licencia Especial',
};

function SolicitarAusenciaModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState('CERTIFICADO_MEDICO');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [numeroCertificado, setNumeroCertificado] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function calcDias(s: Date | null, e: Date | null) {
    if (!s || !e) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  }

  const diasAusencia = calcDias(startDate, endDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      setError('Seleccioná un rango de fechas');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/ausencias/solicitar', {
        tipo,
        fechaInicio: startDate.toISOString(),
        fechaFin: endDate.toISOString(),
        diasAusencia,
        descripcion: descripcion || undefined,
        numeroCertificado: numeroCertificado || undefined,
      });

      if (archivo && res.data?.id) {
        const fd = new FormData();
        fd.append('archivo', archivo);
        await api.post(`/ausencias/${res.data.id}/archivo`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al crear');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl my-8">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Solicitar Ausencia</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-400">
              Tu solicitud será enviada automáticamente a la cadena de aprobación. Recibirás una notificación cuando sea aprobada o rechazada.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Tipo de ausencia *</label>
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(EMPLOYEE_TIPO_OPTIONS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Rango de fechas *</label>
            <div className="rounded-lg border border-border p-3 bg-background">
              <CalendarRangePicker
                startDate={startDate}
                endDate={endDate}
                onSelect={(s, e) => { setStartDate(s); setEndDate(e); }}
                allowPast={true}
              />
            </div>
            {startDate && endDate && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {startDate.toLocaleDateString('es-AR')} — {endDate.toLocaleDateString('es-AR')} · {diasAusencia} día{diasAusencia !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {tipo === 'CERTIFICADO_MEDICO' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">N° Certificado</label>
              <input
                className={inputClass}
                value={numeroCertificado}
                onChange={(e) => setNumeroCertificado(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Certificado (imagen o PDF)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed transition-colors',
                archivo
                  ? 'border-primary/50 bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
              )}
            >
              <Upload className="h-4 w-4" />
              {archivo ? archivo.name : 'Subir certificado'}
            </button>
            {archivo && (
              <button
                type="button"
                onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="text-xs text-red-400 mt-1 hover:underline"
              >
                Quitar archivo
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción / Motivo</label>
            <input
              className={inputClass}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Describí el motivo de la ausencia..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !startDate || !endDate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar solicitud
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}