import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  AlertTriangle, Plus, Trash2, Loader2, X,
  Calendar, FileText, CheckCircle2
} from 'lucide-react';

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
  usuario: { id: string; nombre: string; apellido: string };
}

const TIPO_STYLES: Record<string, string> = {
  CERTIFICADO_MEDICO: 'bg-blue-500/20 text-blue-400',
  FALTA_JUSTIFICADA: 'bg-amber-500/20 text-amber-400',
  FALTA_INJUSTIFICADA: 'bg-red-500/20 text-red-400',
  LICENCIA_ESPECIAL: 'bg-purple-500/20 text-purple-400',
};

const TIPO_LABELS: Record<string, string> = {
  CERTIFICADO_MEDICO: 'Certificado Médico',
  FALTA_JUSTIFICADA: 'Falta Justificada',
  FALTA_INJUSTIFICADA: 'Falta Injustificada',
  LICENCIA_ESPECIAL: 'Licencia Especial',
};

export default function AusenciasPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);
  const [filterTipo, setFilterTipo] = useState('');

  const { data: ausencias = [], isLoading } = useQuery<Ausencia[]>({
    queryKey: ['ausencias', filterTipo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterTipo) params.set('tipo', filterTipo);
      return (await api.get(`/ausencias?${params.toString()}`)).data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ausencias/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ausencias'] }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/ausencias/${id}`, { aprobada: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ausencias'] }),
  });

  const isAdmin = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');

  // Stats
  const totalDias = ausencias.reduce((acc, a) => acc + a.diasAusencia, 0);
  const byTipo: Record<string, number> = {};
  ausencias.forEach((a) => { byTipo[a.tipo] = (byTipo[a.tipo] ?? 0) + 1; });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-400" /> Ausencias
          </h1>
          <p className="text-sm text-muted-foreground">{ausencias.length} registro{ausencias.length !== 1 ? 's' : ''} — {totalDias} días total</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Registrar ausencia
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {['', 'CERTIFICADO_MEDICO', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA', 'LICENCIA_ESPECIAL'].map((t) => (
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
        <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : ausencias.length === 0 ? (
        <div className="text-center py-16">
          <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">No hay ausencias registradas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ausencias.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TIPO_STYLES[a.tipo])}>
                      {TIPO_LABELS[a.tipo]}
                    </span>
                    <span className="text-sm font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(a.fechaInicio).toLocaleDateString('es-AR')} — {new Date(a.fechaFin).toLocaleDateString('es-AR')}
                    </span>
                    <span className="text-xs text-muted-foreground">{a.diasAusencia} día{a.diasAusencia !== 1 ? 's' : ''}</span>
                    {a.aprobada ? (
                      <span className="text-xs text-emerald-400 flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" /> Aprobada</span>
                    ) : a.requiereAprobacion ? (
                      <span className="text-xs text-amber-400">Pendiente aprobación</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {isAdmin && <span>{a.usuario.apellido}, {a.usuario.nombre}</span>}
                    {a.numeroCertificado && <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Cert. {a.numeroCertificado}</span>}
                    {a.descripcion && <span>{a.descripcion}</span>}
                    {a.descuentaSueldo && <span className="text-red-400">💰 Descuenta sueldo</span>}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-2 shrink-0">
                    {!a.aprobada && a.requiereAprobacion && (
                      <button
                        onClick={() => approveMutation.mutate(a.id)}
                        className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                        title="Aprobar"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm('¿Eliminar esta ausencia?')) deleteMutation.mutate(a.id); }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showForm && (
        <AusenciaFormModal
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['ausencias'] });
          }}
        />
      )}
    </div>
  );
}

function AusenciaFormModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState('CERTIFICADO_MEDICO');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [diasAusencia, setDiasAusencia] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [numeroCertificado, setNumeroCertificado] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/ausencias', {
        tipo,
        fechaInicio: new Date(fechaInicio).toISOString(),
        fechaFin: new Date(fechaFin).toISOString(),
        diasAusencia: parseInt(diasAusencia),
        descripcion: descripcion || undefined,
        numeroCertificado: numeroCertificado || undefined,
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

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Registrar Ausencia</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha inicio *</label>
              <input type="date" className={inputClass} value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha fin *</label>
              <input type="date" className={inputClass} value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Días de ausencia *</label>
            <input type="number" min="1" className={inputClass} value={diasAusencia} onChange={(e) => setDiasAusencia(e.target.value)} required />
          </div>
          {tipo === 'CERTIFICADO_MEDICO' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">N° Certificado</label>
              <input className={inputClass} value={numeroCertificado} onChange={(e) => setNumeroCertificado(e.target.value)} placeholder="Opcional" />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input className={inputClass} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button
              type="submit"
              disabled={loading}
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
