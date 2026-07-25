import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import {
  GitBranch, Plus, Trash2, Loader2, X,
  Users, FileText, Pencil, ChevronUp, ChevronDown,
  Link2,
} from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface FlujoPaso {
  id: string;
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
  notificarRoles: string[];
}

interface Flujo {
  id: string;
  nombre: string;
  tipoDocumento: string;
  descripcion: string | null;
  activo: boolean;
  pasos: FlujoPaso[];
  _count: { asignaciones: number; planillas: number; vacaciones: number };
}

interface Asignacion {
  id: string;
  flujoId: string;
  tipoDocumento: string;
  sectorId: string | null;
  usuarioId: string | null;
  activo: boolean;
  flujo: { nombre: string; tipoDocumento: string };
  sector: { id: string; nombre: string } | null;
  usuario: { id: string; nombre: string; apellido: string } | null;
}

interface Sector {
  id: string;
  nombre: string;
  activo: boolean;
}

interface Rol {
  codigo: string;
  nombre: string;
  color: string;
  activo: boolean;
}

// Respaldo de presentación: solo se usa si un paso ya guardado referencia un
// código de rol que ya no está entre los roles activos del servidor (por
// ejemplo, un rol borrado). El selector de aprobador se arma con los roles
// reales via GET /admin/roles, no con esta lista fija.
const ROL_LABELS: Record<string, string> = {
  OPERADOR: 'Operador',
  SUPERVISOR: 'Supervisor',
  COORDINADOR: 'Coordinador',
  GERENTE: 'Gerente',
  RRHH: 'RRHH',
  ADMIN: 'Admin',
};

const ROL_COLORS: Record<string, string> = {
  OPERADOR: 'bg-slate-500/20 text-slate-400',
  SUPERVISOR: 'bg-blue-500/20 text-blue-400',
  COORDINADOR: 'bg-purple-500/20 text-purple-400',
  GERENTE: 'bg-amber-500/20 text-amber-400',
  RRHH: 'bg-emerald-500/20 text-emerald-400',
  ADMIN: 'bg-red-500/20 text-red-400',
};

// ─── Local type for editable steps (no id yet) ────────────────────

interface PasoForm {
  orden: number;
  nombrePaso: string;
  rolAprobador: string;
  requiereComentarioRechazo: boolean;
  tiempoLimiteHoras: number | null;
}

// ─── Shared step form row ─────────────────────────────────────────

function StepRow({
  paso,
  idx,
  total,
  roles,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  paso: PasoForm;
  idx: number;
  total: number;
  roles: Rol[];
  onChange: (idx: number, field: string, value: unknown) => void;
  onRemove: (idx: number) => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
}) {
  const inputCls =
    'h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        {/* Order badge */}
        <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {paso.orden}
        </span>

        {/* Nombre */}
        <input
          className={cn(inputCls, 'flex-1')}
          placeholder="Nombre del paso"
          value={paso.nombrePaso}
          onChange={(e) => onChange(idx, 'nombrePaso', e.target.value)}
          required
        />

        {/* Rol */}
        <select
          className={cn(inputCls, 'min-w-[7rem]')}
          value={paso.rolAprobador}
          onChange={(e) => onChange(idx, 'rolAprobador', e.target.value)}
        >
          {roles.filter((r) => r.activo).map((r) => (
            <option key={r.codigo} value={r.codigo}>{r.nombre}</option>
          ))}
        </select>

        {/* Reorder buttons */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onMoveUp(idx)}
            disabled={idx === 0}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(idx)}
            disabled={idx === total - 1}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Delete */}
        {total > 1 && (
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="p-1 rounded text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Extra options row */}
      <div className="flex items-center gap-4 pl-8 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={paso.requiereComentarioRechazo}
            onChange={(e) => onChange(idx, 'requiereComentarioRechazo', e.target.checked)}
          />
          Requiere comentario en rechazo
        </label>
        <label className="flex items-center gap-1.5">
          ⏰ Límite
          <input
            type="number"
            min={1}
            placeholder="horas"
            value={paso.tiempoLimiteHoras ?? ''}
            onChange={(e) =>
              onChange(idx, 'tiempoLimiteHoras', e.target.value ? parseInt(e.target.value) : null)
            }
            className="w-16 h-7 px-2 rounded border border-input bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          h
        </label>
      </div>
    </div>
  );
}

// ─── Step form helpers ────────────────────────────────────────────

function usePasosEditor(initial: PasoForm[]) {
  const [pasos, setPasos] = useState<PasoForm[]>(initial);

  const addPaso = () =>
    setPasos((prev) => [
      ...prev,
      {
        orden: prev.length + 1,
        nombrePaso: '',
        rolAprobador: 'RRHH',
        requiereComentarioRechazo: true,
        tiempoLimiteHoras: null,
      },
    ]);

  const removePaso = (idx: number) =>
    setPasos((prev) =>
      prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, orden: i + 1 }))
    );

  const updatePaso = (idx: number, field: string, value: unknown) =>
    setPasos((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setPasos((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((p, i) => ({ ...p, orden: i + 1 }));
    });
  };

  const moveDown = (idx: number) => {
    setPasos((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((p, i) => ({ ...p, orden: i + 1 }));
    });
  };

  return { pasos, addPaso, removePaso, updatePaso, moveUp, moveDown };
}

// ─── Create Modal ─────────────────────────────────────────────────

function CreateFlujoModal({ roles, onClose, onSuccess }: { roles: Rol[]; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState('PLANILLA');
  const [descripcion, setDescripcion] = useState('');

  const { pasos, addPaso, removePaso, updatePaso, moveUp, moveDown } = usePasosEditor([
    { orden: 1, nombrePaso: 'Supervisión', rolAprobador: 'COORDINADOR', requiereComentarioRechazo: true, tiempoLimiteHoras: null },
    { orden: 2, nombrePaso: 'RRHH', rolAprobador: 'RRHH', requiereComentarioRechazo: true, tiempoLimiteHoras: null },
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/admin/flujos', { nombre, tipoDocumento, descripcion: descripcion || undefined, pasos });
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
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Nuevo Flujo de Aprobación</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo documento *</label>
              <select className={inputClass} value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                <option value="PLANILLA">Planilla</option>
                <option value="VACACION">Vacación</option>
                <option value="AUSENCIA">Ausencia</option>
                <option value="COMPENSATORIO">Compensatorio</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input className={inputClass} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Pasos de aprobación</label>
              <button type="button" onClick={addPaso} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Agregar nivel
              </button>
            </div>
            <div className="space-y-2">
              {pasos.map((paso, idx) => (
                <StepRow
                  key={idx}
                  paso={paso}
                  idx={idx}
                  total={pasos.length}
                  roles={roles}
                  onChange={updatePaso}
                  onRemove={removePaso}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button
              type="submit"
              disabled={loading || !nombre || pasos.some((p) => !p.nombrePaso)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear flujo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────

function EditFlujoModal({
  flujo,
  roles,
  onClose,
  onSuccess,
}: {
  flujo: Flujo;
  roles: Rol[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nombre, setNombre] = useState(flujo.nombre);
  const [descripcion, setDescripcion] = useState(flujo.descripcion ?? '');
  const [activo, setActivo] = useState(flujo.activo);

  const { pasos, addPaso, removePaso, updatePaso, moveUp, moveDown } = usePasosEditor(
    flujo.pasos.map((p) => ({
      orden: p.orden,
      nombrePaso: p.nombrePaso,
      rolAprobador: p.rolAprobador,
      requiereComentarioRechazo: p.requiereComentarioRechazo,
      tiempoLimiteHoras: p.tiempoLimiteHoras,
    }))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.put(`/admin/flujos/${flujo.id}`, {
        nombre,
        descripcion: descripcion || undefined,
        activo,
        pasos,
      });
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
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Editar Flujo de Aprobación</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo documento</label>
              <input
                className={cn(inputClass, 'opacity-60 cursor-not-allowed')}
                value={flujo.tipoDocumento}
                readOnly
                title="El tipo de documento no puede cambiar porque hay registros vinculados"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <input className={inputClass} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
            />
            Flujo activo
          </label>

          {/* Steps editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Niveles de aprobación <span className="text-primary font-bold">{pasos.length}</span>
              </label>
              <button type="button" onClick={addPaso} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Agregar nivel
              </button>
            </div>
            <div className="space-y-2">
              {pasos.map((paso, idx) => (
                <StepRow
                  key={idx}
                  paso={paso}
                  idx={idx}
                  total={pasos.length}
                  roles={roles}
                  onChange={updatePaso}
                  onRemove={removePaso}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button
              type="submit"
              disabled={loading || !nombre || pasos.some((p) => !p.nombrePaso)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────

export default function FlujosPage() {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFlujo, setEditingFlujo] = useState<Flujo | null>(null);
  const [showAsignForm, setShowAsignForm] = useState(false);
  const [asignSectorId, setAsignSectorId] = useState('');

  const selectFlujo = useCallback((id: string | null) => {
    setSelectedId(id);
    setShowAsignForm(false);
    setAsignSectorId('');
  }, []);

  const { data: flujos = [], isLoading } = useQuery<Flujo[]>({
    queryKey: ['admin-flujos'],
    queryFn: async () => (await api.get('/admin/flujos')).data,
  });

  // Roles reales de la empresa: alimentan el selector de aprobador. Esta
  // pantalla es nivel 100 y GET /admin/roles exige nivel 90+, así que el
  // acceso está garantizado.
  const { data: roles = [] } = useQuery<Rol[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/admin/roles')).data,
  });

  // Nombre a mostrar para un código de rol. Un paso ya guardado puede
  // referenciar un código que ya no está entre los roles activos (por
  // ejemplo, un rol borrado); en ese caso cae al respaldo fijo y, si tampoco
  // está ahí, muestra el código crudo en vez de romper o dejar vacío.
  const nombreDeRol = useCallback(
    (codigo: string) => roles.find((r) => r.codigo === codigo)?.nombre ?? ROL_LABELS[codigo] ?? codigo,
    [roles],
  );

  const { data: sectores = [], isError: sectoresError } = useQuery<Sector[]>({
    queryKey: ['admin-sectores'],
    queryFn: async () => (await api.get('/admin/sectores')).data,
  });

  const { data: asignaciones = [], isError: asignError, isLoading: asignLoading } = useQuery<Asignacion[]>({
    queryKey: ['admin-flujos-asignaciones'],
    queryFn: async () => (await api.get('/admin/flujos/asignaciones/list')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/flujos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
      selectFlujo(null);
    },
  });

  const createAsignMut = useMutation({
    mutationFn: (body: { flujoId: string; tipoDocumento: string; sectorId?: string | null }) =>
      api.post('/admin/flujos/asignaciones', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-flujos-asignaciones'] });
      queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
      setShowAsignForm(false);
      setAsignSectorId('');
    },
  });

  const deleteAsignMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/flujos/asignaciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-flujos-asignaciones'] });
      queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
    },
  });

  const selected = flujos.find((f) => f.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Flujos de Aprobación</h1>
          <p className="text-sm text-muted-foreground">{flujos.length} flujo{flujos.length !== 1 ? 's' : ''} configurados</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nuevo flujo
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Flow list */}
          <div className="lg:col-span-1 space-y-2">
            {flujos.length === 0 ? (
              <div className="text-center py-8">
                <GitBranch className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No hay flujos configurados</p>
              </div>
            ) : (
              flujos.map((f) => (
                <button
                  key={f.id}
                  onClick={() => selectFlujo(f.id)}
                  className={cn(
                    'w-full text-left rounded-xl border p-4 transition-all',
                    selectedId === f.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">{f.nombre}</span>
                    </div>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                      f.tipoDocumento === 'PLANILLA'
                        ? 'bg-blue-500/20 text-blue-400'
                        : f.tipoDocumento === 'AUSENCIA'
                        ? 'bg-amber-500/20 text-amber-400'
                        : f.tipoDocumento === 'COMPENSATORIO'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                    )}>
                      {f.tipoDocumento}
                    </span>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{f.pasos.length} paso{f.pasos.length !== 1 ? 's' : ''}</span>
                    <span>{f._count.asignaciones} asig.</span>
                    {!f.activo && <span className="text-red-400">Inactivo</span>}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="rounded-xl border border-border bg-card p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.nombre}</h2>
                    {selected.descripcion && (
                      <p className="text-sm text-muted-foreground mt-1">{selected.descripcion}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Edit button */}
                    <button
                      onClick={() => setEditingFlujo(selected)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground border border-border hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    {/* Delete button */}
                    <button
                      onClick={async () => {
                        if (await dialog.confirm({ message: '¿Eliminar este flujo?', variant: 'danger' })) deleteMutation.mutate(selected.id);
                      }}
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Steps pipeline */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">
                    Pipeline de aprobación — {selected.pasos.length} nivel{selected.pasos.length !== 1 ? 'es' : ''}
                  </h3>
                  <div className="space-y-2">
                    {selected.pasos.map((paso) => (
                      <div key={paso.id} className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          {paso.orden}
                        </div>
                        <div className="flex-1 rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{paso.nombrePaso}</span>
                            <span className={cn('text-xs px-2 py-0.5 rounded-full', ROL_COLORS[paso.rolAprobador] ?? 'bg-muted text-muted-foreground')}>
                              {nombreDeRol(paso.rolAprobador)}
                            </span>
                          </div>
                          <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                            {paso.requiereComentarioRechazo && <span>📝 Requiere comentario</span>}
                            {paso.tiempoLimiteHoras && <span>⏰ {paso.tiempoLimiteHoras}h límite</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border p-3 text-center">
                    <p className="text-lg font-bold text-foreground">{selected._count.asignaciones}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                      <Users className="h-3 w-3" /> Asignaciones
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3 text-center">
                    <p className="text-lg font-bold text-foreground">{selected._count.planillas}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                      <FileText className="h-3 w-3" /> Planillas
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3 text-center">
                    <p className="text-lg font-bold text-foreground">{selected._count.vacaciones}</p>
                    <p className="text-xs text-muted-foreground">Vacaciones</p>
                  </div>
                </div>

                {/* Asignaciones (sector assignments) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5" />
                      Asignaciones por sector
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setShowAsignForm(true); setAsignSectorId(''); }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Asignar sector
                    </button>
                  </div>

                  {/* Inline create form */}
                  {showAsignForm && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 mb-3 space-y-3">
                      {sectoresError ? (
                        <p className="text-xs text-destructive">Error al cargar sectores. Intente recargar.</p>
                      ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1 block">Sector</label>
                          <select
                            value={asignSectorId}
                            onChange={(e) => setAsignSectorId(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">Global (todos los sectores)</option>
                            {sectores.filter(s => s.activo).map(s => (
                              <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            disabled={createAsignMut.isPending}
                            onClick={() => createAsignMut.mutate({
                              flujoId: selected.id,
                              tipoDocumento: selected.tipoDocumento,
                              sectorId: asignSectorId || null,
                            })}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                          >
                            {createAsignMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Asignar
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAsignForm(false)}
                            className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                      )}
                    </div>
                  )}

                  {/* Existing assignments list */}
                  {asignError ? (
                    <p className="text-xs text-destructive italic py-2">
                      Error al cargar asignaciones — intente recargar la página.
                    </p>
                  ) : asignLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando asignaciones...
                    </div>
                  ) : (() => {
                    const flujoAsign = asignaciones.filter(a => a.flujoId === selected.id);
                    if (flujoAsign.length === 0) {
                      return (
                        <p className="text-xs text-muted-foreground italic py-2">
                          Sin asignaciones — este flujo no se aplica a ningún sector.
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-1.5">
                        {flujoAsign.map(a => (
                          <div key={a.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                                a.sector ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                              )}>
                                {a.sector ? a.sector.nombre : 'Global'}
                              </span>
                              {a.usuario && (
                                <span className="text-xs text-muted-foreground">
                                  → {a.usuario.nombre} {a.usuario.apellido}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={async () => { if (await dialog.confirm({ message: '¿Eliminar esta asignación?', variant: 'danger' })) deleteAsignMut.mutate(a.id); }}
                              className="p-1 rounded text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <GitBranch className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-muted-foreground">Seleccioná un flujo para ver sus detalles</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateFlujoModal
          roles={roles}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
          }}
        />
      )}

      {/* Edit Modal */}
      {editingFlujo && (
        <EditFlujoModal
          flujo={editingFlujo}
          roles={roles}
          onClose={() => setEditingFlujo(null)}
          onSuccess={() => {
            setEditingFlujo(null);
            queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
          }}
        />
      )}
    </div>
  );
}
