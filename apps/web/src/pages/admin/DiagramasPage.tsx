import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { Plus, Pencil, Trash2, Loader2, X, Calendar } from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface Diagrama {
  id: string;
  nombre: string;
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
  descripcion: string | null;
  activo: boolean;
  asignacionesCount: number;
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function formatDiagrama(d: Diagrama): string {
  if (d.tipo === 'ROTATIVO') return `${d.diasTrabajo}×${d.diasDescanso}`;
  return d.diasSemana.map((n) => DIAS_SEMANA[n]).join(', ');
}

export default function DiagramasPage() {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Diagrama | null>(null);

  const { data: diagramas = [], isLoading } = useQuery<Diagrama[]>({
    queryKey: ['diagramas'],
    queryFn: async () => (await api.get('/admin/diagramas')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/diagramas/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagramas'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Diagramas de Trabajo</h1>
          <p className="text-sm text-muted-foreground">{diagramas.length} diagrama{diagramas.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo diagrama
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {diagramas.map((d) => (
            <div key={d.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-foreground">{d.nombre}</h3>
                  <span className={cn(
                    'inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    d.tipo === 'ROTATIVO' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                  )}>
                    {d.tipo === 'ROTATIVO' ? 'Rotativo' : 'Fijo Semana'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditing(d); setShowForm(true); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (await dialog.confirm({ message: `¿Eliminar diagrama "${d.nombre}"?`, variant: 'danger' })) deleteMutation.mutate(d.id);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <p className="text-lg font-bold text-primary mb-1">{formatDiagrama(d)}</p>
              {d.descripcion && <p className="text-xs text-muted-foreground mb-3">{d.descripcion}</p>}

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {d.asignacionesCount} asignación{d.asignacionesCount !== 1 ? 'es' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <DiagramaFormModal
          diagrama={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['diagramas'] });
          }}
        />
      )}
    </div>
  );
}

function DiagramaFormModal({
  diagrama,
  onClose,
  onSuccess,
}: {
  diagrama: Diagrama | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!diagrama;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nombre: diagrama?.nombre ?? '',
    tipo: diagrama?.tipo ?? 'ROTATIVO',
    diasTrabajo: diagrama?.diasTrabajo?.toString() ?? '7',
    diasDescanso: diagrama?.diasDescanso?.toString() ?? '7',
    diasSemana: diagrama?.diasSemana ?? [1, 2, 3, 4, 5],
    descripcion: diagrama?.descripcion ?? '',
  });

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      diasSemana: prev.diasSemana.includes(day)
        ? prev.diasSemana.filter((d) => d !== day)
        : [...prev.diasSemana, day].sort(),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        nombre: form.nombre,
        descripcion: form.descripcion || undefined,
      };

      if (!isEdit) {
        body.tipo = form.tipo;
        if (form.tipo === 'ROTATIVO') {
          body.diasTrabajo = parseInt(form.diasTrabajo);
          body.diasDescanso = parseInt(form.diasDescanso);
        } else {
          body.diasSemana = form.diasSemana;
        }
      }

      if (isEdit) {
        await api.put(`/admin/diagramas/${diagrama.id}`, body);
      } else {
        await api.post('/admin/diagramas', body);
      }
      onSuccess();
    } catch (err: unknown) {
      setError(mensajeDeError(err).mensaje);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar diagrama' : 'Nuevo diagrama'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
            <input className={inputClass} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo *</label>
              <select className={inputClass} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="ROTATIVO">Rotativo (Ej: 7×7, 14×14)</option>
                <option value="FIJO_SEMANA">Fijo Semana (Ej: Lun-Vie)</option>
              </select>
            </div>
          )}

          {!isEdit && form.tipo === 'ROTATIVO' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Días trabajo</label>
                <input type="number" min={1} max={60} className={inputClass} value={form.diasTrabajo} onChange={(e) => setForm({ ...form, diasTrabajo: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Días descanso</label>
                <input type="number" min={1} max={60} className={inputClass} value={form.diasDescanso} onChange={(e) => setForm({ ...form, diasDescanso: e.target.value })} />
              </div>
            </div>
          )}

          {!isEdit && form.tipo === 'FIJO_SEMANA' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Días de la semana</label>
              <div className="flex gap-1.5 mt-2">
                {DIAS_SEMANA.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={cn(
                      'w-10 h-10 rounded-lg text-xs font-medium transition-colors',
                      form.diasSemana.includes(i)
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input className={inputClass} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
