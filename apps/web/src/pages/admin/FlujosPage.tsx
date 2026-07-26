import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { circuitoPara } from '@/utils/circuito';
import {
  GitBranch, Plus, Trash2, Loader2, X,
  Users, FileText, Pencil, ChevronUp, ChevronDown,
  Link2, MessageSquare, Clock, ArrowRight, Table2,
} from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';
import { toast } from '@/stores/toastStore';
import MatrizFlujos from './MatrizFlujos';
import {
  TIPOS_DOCUMENTO, COLOR_TIPO_DOC, ROL_COLORS, nombreDeRol as nombreDeRolBase,
  type Asignacion, type Flujo, type Rol, type Sector,
} from './flujos.shared';

/**
 * El código HTTP de un error de axios, o undefined si nunca hubo respuesta.
 * Se lee con un cast como en `mensajeDeError`, para no arrastrar axios hasta
 * una pantalla que solo habla con el wrapper de `@/services/api`.
 */
function estadoHttp(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/** Texto de una opción del selector de alcance, avisando si ya está tomado. */
function etiquetaAlcance(nombre: string, flujoQueLoOcupa: string | undefined): string {
  return flujoQueLoOcupa ? `${nombre} — ocupado por «${flujoQueLoOcupa}»` : nombre;
}

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

  // El select solo lista roles activos, pero el paso puede referenciar un
  // código que ya no está entre ellos: un rol desactivado (sigue en `roles`
  // con activo:false), uno borrado del todo (ya no está en `roles`), o —
  // mientras la query ['roles'] todavía no resolvió — cualquier código con
  // `roles` vacío. Sin una opción de respaldo el <select> cae en el primer
  // <option> de la lista real y el próximo guardado persiste ese código
  // distinto sin que el onChange llegue a dispararse.
  const rolesActivos = roles.filter((r) => r.activo);
  const rolActualEntreActivos = rolesActivos.some((r) => r.codigo === paso.rolAprobador);

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
          {!rolActualEntreActivos && (
            <option value={paso.rolAprobador}>
              {nombreDeRolBase(roles, paso.rolAprobador)} (ya no existe)
            </option>
          )}
          {rolesActivos.map((r) => (
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
          <Clock className="h-3 w-3" /> Límite
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
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t.valor} value={t.valor}>{t.label}</option>
                ))}
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
  const [vista, setVista] = useState<'flujos' | 'matriz'>('flujos');
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

  const nombreDeRol = useCallback((codigo: string) => nombreDeRolBase(roles, codigo), [roles]);

  const { data: sectores = [], isError: sectoresError } = useQuery<Sector[]>({
    queryKey: ['admin-sectores'],
    queryFn: async () => (await api.get('/admin/sectores')).data,
  });

  const { data: asignaciones = [], isError: asignError, isLoading: asignLoading } = useQuery<Asignacion[]>({
    queryKey: ['admin-flujos-asignaciones'],
    queryFn: async () => (await api.get('/admin/flujos/asignaciones/list')).data,
  });

  // Los niveles con los que el back arma el circuito. `nivelesPorRol` del
  // servidor SOLO manda roles activos: un rol desactivado no tiene nivel con el
  // que comparar y `circuitoPara` lo trata como huérfano. Si acá incluyéramos
  // los inactivos, la vista previa mostraría un circuito que el back no arma.
  const nivelPorRol = useMemo(
    () => Object.fromEntries(roles.filter((r) => r.activo).map((r) => [r.codigo, r.nivel])),
    [roles],
  );

  // Una fila de vista previa por rol activo, de menor a mayor nivel: así se lee
  // de arriba hacia abajo cómo se va acortando el circuito.
  const rolesPorNivel = useMemo(
    () => [...roles.filter((r) => r.activo)].sort((a, b) => a.nivel - b.nivel),
    [roles],
  );

  const trasBorrarFlujo = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
    queryClient.invalidateQueries({ queryKey: ['admin-flujos-asignaciones'] });
    selectFlujo(null);
  }, [queryClient, selectFlujo]);

  // Segundo intento del borrado, con el flag que el back ya soportaba y la UI
  // no tenía forma de mandar. Va como mutación aparte y no como un parámetro de
  // `deleteMutation` porque el reintento se dispara desde el `onError` de esa
  // misma mutación, y referenciarla dentro de su propia definición deja el tipo
  // inferido en un ciclo.
  const forzarBorradoMut = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/admin/flujos/${id}`, { params: { forzarDesasignacion: 'true' } }),
    onSuccess: trasBorrarFlujo,
    onError: (err) => {
      toast({ title: 'No se pudo borrar el flujo', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/flujos/${id}`),
    onSuccess: trasBorrarFlujo,
    onError: async (err, id) => {
      // El 409 del borrado no es un fallo: es una pregunta. El back enumera los
      // alcances asignados y los documentos en curso que quedarían trabados, y
      // acepta repetir la operación con forzarDesasignacion=true.
      if (estadoHttp(err) === 409) {
        const ok = await dialog.confirm({
          title: 'El flujo está en uso',
          message: `${mensajeDeError(err).mensaje}\n\n¿Desasignarlo y borrarlo igual?`,
          confirmLabel: 'Borrar igual',
          variant: 'danger',
        });
        if (ok) forzarBorradoMut.mutate(id);
        return;
      }
      toast({ title: 'No se pudo borrar el flujo', description: mensajeDeError(err).mensaje, variant: 'destructive' });
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
    // Sin esto el 409 ("Ese alcance ya usa el flujo X…") no se veía en ningún
    // lado: el botón simplemente no hacía nada.
    onError: (err) => {
      toast({ title: 'No se pudo asignar el flujo', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const deleteAsignMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/flujos/asignaciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-flujos-asignaciones'] });
      queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
    },
    onError: (err) => {
      toast({ title: 'No se pudo quitar la asignación', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const selected = flujos.find((f) => f.id === selectedId);

  // Qué flujo ocupa ya cada alcance para el tipo del flujo seleccionado. La
  // clave '' es el alcance global. Solo mira las asignaciones SIN usuario: una
  // asignación por usuario no bloquea al sector, tiene su propio índice único.
  const flujoPorAlcance = useMemo(() => {
    const mapa = new Map<string, string>();
    if (!selected) return mapa;
    for (const a of asignaciones) {
      if (a.tipoDocumento !== selected.tipoDocumento || a.usuarioId) continue;
      mapa.set(a.sectorId ?? '', a.flujo.nombre);
    }
    return mapa;
  }, [asignaciones, selected]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Flujos de Aprobación</h1>
          <p className="text-sm text-muted-foreground">{flujos.length} flujo{flujos.length !== 1 ? 's' : ''} configurados</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Dos maneras de mirar lo mismo: la lista arma y edita las cadenas;
              la matriz responde qué usa cada sector para cada trámite. */}
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {([
              { valor: 'flujos', label: 'Por flujo', icono: GitBranch },
              { valor: 'matriz', label: 'Por sector', icono: Table2 },
            ] as const).map((v) => (
              <button
                key={v.valor}
                onClick={() => setVista(v.valor)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                  vista === v.valor
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <v.icono className="h-3.5 w-3.5" /> {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Nuevo flujo
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : vista === 'matriz' ? (
        <MatrizFlujos flujos={flujos} sectores={sectores} asignaciones={asignaciones} roles={roles} />
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
                    {/* El color sale del mismo mapa que arma el selector: antes era
                        una cadena de ternarios donde VACACION y CAMBIO_DIAGRAMA
                        caían en el mismo color y no se distinguían. */}
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                      COLOR_TIPO_DOC[f.tipoDocumento] ?? 'bg-muted text-muted-foreground',
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
                            {paso.requiereComentarioRechazo && (
                              <span className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                Requiere comentario
                              </span>
                            )}
                            {paso.tiempoLimiteHoras && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {paso.tiempoLimiteHoras}h límite
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vista previa del circuito según quién envía */}
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    Recorrido real según quién envía
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Al enviar el documento se saltea todo paso cuyo aprobador tenga un nivel
                    menor o igual al de quien lo envía, y el circuito queda congelado ahí.
                    Si no sobrevive ningún paso se conserva el último, para que nunca se
                    apruebe solo.
                  </p>
                  {rolesPorNivel.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2">
                      No se pudieron cargar los roles: sin sus niveles no se puede calcular el recorrido.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="text-left font-medium px-3 py-2">Si lo envía…</th>
                            <th className="text-left font-medium px-3 py-2">Nivel</th>
                            <th className="text-left font-medium px-3 py-2">Tiene que aprobarlo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rolesPorNivel.map((rol) => {
                            const recorrido = circuitoPara(selected.pasos, rol.nivel, nivelPorRol);
                            const salteados = selected.pasos.length - recorrido.length;
                            return (
                              <tr key={rol.codigo} className="border-b border-border/50 last:border-0">
                                <td className="px-3 py-2">
                                  <span className={cn('text-xs px-2 py-0.5 rounded-full', ROL_COLORS[rol.codigo] ?? 'bg-muted text-muted-foreground')}>
                                    {rol.nombre}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{rol.nivel}</td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {recorrido.map((paso, i) => (
                                      <span key={paso.id} className="flex items-center gap-1.5">
                                        {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                        <span
                                          className={cn('text-xs px-2 py-0.5 rounded-full', ROL_COLORS[paso.rolAprobador] ?? 'bg-muted text-muted-foreground')}
                                          title={paso.nombrePaso}
                                        >
                                          {nombreDeRol(paso.rolAprobador)}
                                        </span>
                                      </span>
                                    ))}
                                    {salteados > 0 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        ({salteados} paso{salteados !== 1 ? 's' : ''} salteado{salteados !== 1 ? 's' : ''})
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                          {/* Cada alcance admite un solo flujo por tipo de documento
                              (índice único en la base). Los que ya están tomados se
                              marcan acá para que el 409 no sea una sorpresa. */}
                          <select
                            value={asignSectorId}
                            onChange={(e) => setAsignSectorId(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">{etiquetaAlcance('Global (todos los sectores)', flujoPorAlcance.get(''))}</option>
                            {sectores.filter(s => s.activo).map(s => (
                              <option key={s.id} value={s.id}>{etiquetaAlcance(s.nombre, flujoPorAlcance.get(s.id))}</option>
                            ))}
                          </select>
                          {flujoPorAlcance.has(asignSectorId) && (
                            <p className="text-xs text-amber-500 mt-1">
                              Ese alcance ya usa «{flujoPorAlcance.get(asignSectorId)}» para {selected.tipoDocumento}.
                              Quitá esa asignación antes de crear otra.
                            </p>
                          )}
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
