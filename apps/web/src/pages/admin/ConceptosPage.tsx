import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import {
  DollarSign, Plus, Trash2, Loader2, X,
  ChevronRight, Percent, Hash, Pencil
} from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface ConceptoValor {
  id: string;
  monto: string | null;
  porcentaje: string | null;
  vigenteDesde: string;
  categoria: { codigo: string; nombre: string } | null;
}

interface Concepto {
  id: string;
  convenioId: string;
  codigo: string;
  nombre: string;
  tipo: string;
  descripcion: string | null;
  esPorcentual: boolean;
  porcentajeBase: string | null;
  montoFijo: string | null;
  esRemunerativo: boolean;
  aplicaSiempre: boolean;
  visibleEmpleado: boolean;
  editableRrhh: boolean;
  orden: number;
  activo: boolean;
  convenio: { nombre: string };
  valores: ConceptoValor[];
}

interface Convenio {
  id: string;
  nombre: string;
}

const TIPO_STYLES: Record<string, string> = {
  REMUNERATIVO: 'bg-emerald-500/20 text-emerald-400',
  NO_REMUNERATIVO: 'bg-blue-500/20 text-blue-400',
  DEDUCCION: 'bg-red-500/20 text-red-400',
  APORTE: 'bg-amber-500/20 text-amber-400',
  CONTRIBUCION: 'bg-purple-500/20 text-purple-400',
};

export default function ConceptosPage() {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Concepto | null>(null);
  const [filterConvenio, setFilterConvenio] = useState('');

  const { data: conceptos = [], isLoading } = useQuery<Concepto[]>({
    queryKey: ['admin-conceptos', filterConvenio],
    queryFn: async () => {
      const params = filterConvenio ? `?convenioId=${filterConvenio}` : '';
      return (await api.get(`/admin/conceptos${params}`)).data;
    },
  });

  const { data: convenios = [] } = useQuery<Convenio[]>({
    queryKey: ['convenios-for-conceptos'],
    queryFn: async () => (await api.get('/admin/convenios')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/conceptos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-conceptos'] });
      setSelectedId(null);
    },
  });

  const selected = conceptos.find((c) => c.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-emerald-400" /> Conceptos Salariales
          </h1>
          <p className="text-sm text-muted-foreground">{conceptos.length} concepto{conceptos.length !== 1 ? 's' : ''} configurados</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nuevo concepto
        </button>
      </div>

      {/* Convenio filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterConvenio('')}
          className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            filterConvenio === '' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          )}
        >Todos</button>
        {convenios.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilterConvenio(c.id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filterConvenio === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            )}
          >{c.nombre}</button>
        ))}
      </div>

      {/* Master-Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* List */}
        <div className="lg:col-span-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : conceptos.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground">Sin conceptos configurados</p>
            </div>
          ) : (
            conceptos.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'w-full text-left rounded-xl border p-3 transition-all',
                  selectedId === c.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{c.codigo}</span>
                      <span className="text-sm font-medium">{c.nombre}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', TIPO_STYLES[c.tipo] ?? 'bg-muted text-muted-foreground')}>
                        {c.tipo.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{c.convenio.nombre}</span>
                      {c.esPorcentual ? (
                        <span className="text-[10px] text-primary flex items-center gap-0.5"><Percent className="h-2.5 w-2.5" />{Number(c.porcentajeBase).toFixed(1)}%</span>
                      ) : c.montoFijo ? (
                        <span className="text-[10px] text-emerald-400">${Number(c.montoFijo).toLocaleString()}</span>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3">
          {selected ? (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{selected.codigo}</span>
                    {selected.nombre}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">{selected.convenio.nombre}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditing(selected)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => { if (await dialog.confirm({ message: '¿Eliminar concepto?', variant: 'danger' })) deleteMutation.mutate(selected.id); }}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {selected.descripcion && <p className="text-sm text-muted-foreground">{selected.descripcion}</p>}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <InfoCell label="Tipo" value={selected.tipo.replace('_', ' ')} />
                <InfoCell label="Cálculo" value={selected.esPorcentual ? `${Number(selected.porcentajeBase).toFixed(2)}%` : `$${Number(selected.montoFijo ?? 0).toLocaleString()}`} />
                <InfoCell label="Remunerativo" value={selected.esRemunerativo ? 'Sí' : 'No'} />
                <InfoCell label="Aplica siempre" value={selected.aplicaSiempre ? 'Sí' : 'Condicional'} />
                <InfoCell label="Visible empleado" value={selected.visibleEmpleado ? 'Sí' : 'No'} />
                <InfoCell label="Editable RRHH" value={selected.editableRrhh ? 'Sí' : 'No'} />
              </div>

              {/* Valores */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Hash className="h-3.5 w-3.5" /> Valores por categoría
                </h3>
                {selected.valores.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin valores específicos — usa el valor base</p>
                ) : (
                  <div className="space-y-1">
                    {selected.valores.map((v) => (
                      <div key={v.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/20">
                        <span>{v.categoria ? `${v.categoria.codigo} — ${v.categoria.nombre}` : 'General'}</span>
                        <div className="flex items-center gap-3">
                          {v.monto && <span className="font-mono">${Number(v.monto).toLocaleString()}</span>}
                          {v.porcentaje && <span className="font-mono">{Number(v.porcentaje)}%</span>}
                          <span className="text-xs text-muted-foreground">desde {new Date(v.vigenteDesde).toLocaleDateString('es-AR')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Seleccioná un concepto para ver detalles</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showForm && (
        <ConceptoFormModal
          convenios={convenios}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['admin-conceptos'] });
          }}
        />
      )}

      {/* Edit Modal */}
      {editing && (
        <ConceptoFormModal
          convenios={convenios}
          editingConcept={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['admin-conceptos'] });
          }}
        />
      )}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/20 p-2">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function ConceptoFormModal({ convenios, editingConcept, onClose, onSuccess }: { convenios: Convenio[]; editingConcept?: Concepto; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!editingConcept;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    convenioId: editingConcept?.convenioId ?? convenios[0]?.id ?? '',
    codigo: editingConcept?.codigo ?? '',
    nombre: editingConcept?.nombre ?? '',
    tipo: editingConcept?.tipo ?? 'REMUNERATIVO',
    descripcion: editingConcept?.descripcion ?? '',
    esPorcentual: editingConcept?.esPorcentual ?? false,
    porcentajeBase: editingConcept?.porcentajeBase ?? '',
    montoFijo: editingConcept?.montoFijo ?? '',
    esRemunerativo: editingConcept?.esRemunerativo ?? true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        porcentajeBase: form.esPorcentual ? parseFloat(String(form.porcentajeBase)) : undefined,
        montoFijo: !form.esPorcentual ? parseFloat(String(form.montoFijo)) : undefined,
        descripcion: form.descripcion || undefined,
      };
      if (isEdit) {
        await api.put(`/admin/conceptos/${editingConcept.id}`, payload);
      } else {
        await api.post('/admin/conceptos', payload);
      }
      onSuccess();
    } catch {
      setError(isEdit ? 'Error al guardar cambios' : 'Error al crear concepto');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar Concepto Salarial' : 'Nuevo Concepto Salarial'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Convenio *</label>
            <select className={inputClass} value={form.convenioId} onChange={(e) => setForm({ ...form, convenioId: e.target.value })}>
              {convenios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Código *</label>
              <input className={inputClass} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required placeholder="HE50" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo *</label>
              <select className={inputClass} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="REMUNERATIVO">Remunerativo</option>
                <option value="NO_REMUNERATIVO">No Remunerativo</option>
                <option value="DEDUCCION">Deducción</option>
                <option value="APORTE">Aporte</option>
                <option value="CONTRIBUCION">Contribución</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
            <input className={inputClass} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required placeholder="Hora Extra 50%" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input className={inputClass} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.esPorcentual} onChange={(e) => setForm({ ...form, esPorcentual: e.target.checked })} className="rounded border-input" />
              Es porcentual
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.esRemunerativo} onChange={(e) => setForm({ ...form, esRemunerativo: e.target.checked })} className="rounded border-input" />
              Remunerativo
            </label>
          </div>
          {form.esPorcentual ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Porcentaje base (%)</label>
              <input type="number" step="0.01" className={inputClass} value={form.porcentajeBase} onChange={(e) => setForm({ ...form, porcentajeBase: e.target.value })} />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Monto fijo ($)</label>
              <input type="number" step="0.01" className={inputClass} value={form.montoFijo} onChange={(e) => setForm({ ...form, montoFijo: e.target.value })} />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button type="submit" disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? 'Guardar cambios' : 'Crear concepto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
