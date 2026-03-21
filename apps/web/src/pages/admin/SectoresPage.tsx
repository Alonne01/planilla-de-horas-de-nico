import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2, Loader2, X, Users } from 'lucide-react';

interface Sector {
  id: string;
  nombre: string;
  descripcion: string | null;
  color: string | null;
  activo: boolean;
  usuariosCount: number;
}

export default function SectoresPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);

  const { data: sectores = [], isLoading } = useQuery<Sector[]>({
    queryKey: ['sectores'],
    queryFn: async () => (await api.get('/admin/sectores')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/sectores/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sectores'] }),
    onError: (err: unknown) => {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        alert(axiosErr.response?.data?.error ?? 'Error al eliminar');
      }
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sectores</h1>
          <p className="text-sm text-muted-foreground">{sectores.length} sector{sectores.length !== 1 ? 'es' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo sector
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sectores.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color ?? '#6B7280' }}
                  />
                  <h3 className="font-semibold text-foreground">{s.nombre}</h3>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditing(s); setShowForm(true); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`¿Eliminar sector "${s.nombre}"?`)) {
                        deleteMutation.mutate(s.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {s.descripcion && (
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{s.descripcion}</p>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {s.usuariosCount} usuario{s.usuariosCount !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <SectorFormModal
          sector={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['sectores'] });
          }}
        />
      )}
    </div>
  );
}

function SectorFormModal({
  sector,
  onClose,
  onSuccess,
}: {
  sector: Sector | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!sector;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nombre: sector?.nombre ?? '',
    descripcion: sector?.descripcion ?? '',
    color: sector?.color ?? '#3B82F6',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/admin/sectores/${sector.id}`, form);
      } else {
        await api.post('/admin/sectores', form);
      }
      onSuccess();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error');
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
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar sector' : 'Nuevo sector'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
            <input className={inputClass} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <textarea
              className={cn(inputClass, 'h-20 py-2 resize-none')}
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-input cursor-pointer"
              />
              <input className={cn(inputClass, 'flex-1')} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
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
