import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Loader2,
  X,
  Trash2,
  Pencil,
  Camera,
  ChevronDown,
  ChevronUp,
  BarChart3,
  FileText,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ImageIcon,
  MapPin,
  SlidersHorizontal,
} from 'lucide-react';
import api, { getUploadUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useDialogStore } from '@/stores/dialogStore';
import { toast } from '@/stores/toastStore';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WentopTarjeta {
  id: string;
  empresaId: string;
  creadorId: string;
  sectorObservacionId: string | null;
  sectorTercero: boolean;
  estado: 'ABIERTA' | 'EN_PROGRESO' | 'CERRADA';
  fechaReporte: string;
  cliente: string | null;
  lugarPozoLocacion: string | null;
  tipoTarjeta: string;
  calidad: string[];
  medioambiente: string[];
  seguridadSalud: string[];
  descripcion: string;
  accionesInmediatas: string | null;
  recomendaciones: string | null;
  justificacionAbierta: string | null;
  accionCierre: string | null;
  fechaCierre: string | null;
  createdAt: string;
  updatedAt: string;
  creador: {
    id: string;
    nombre: string;
    apellido: string;
    legajo: string | null;
    sector: { id: string; nombre: string } | null;
  };
  sectorObservacion: { id: string; nombre: string } | null;
  fotos: { id: string; url: string; createdAt: string }[];
  _count?: { fotos: number };
}

interface WentopAnalytics {
  totales: { total: number; abierta: number; enProgreso: number; cerrada: number };
  porTipo: { tipo: string; count: number }[];
  porSector: { sectorId: string; sectorNombre: string; count: number }[];
  porMes: { mes: string; count: number }[];
  porCategoria: {
    calidad: { label: string; count: number }[];
    medioambiente: { label: string; count: number }[];
    seguridadSalud: { label: string; count: number }[];
  };
}

interface WentopGestor {
  id: string;
  usuarioId: string;
  sectorId: string;
  usuario: { nombre: string; apellido: string; email: string; legajo: string | null };
  sector: { nombre: string };
}

interface Sector {
  id: string;
  nombre: string;
}

interface Usuario {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  legajo: string | null;
}

interface DraftData {
  fechaReporte: string;
  tipoTarjeta: string;
  sectorObservacionId: string;
  sectorTercero: boolean;
  cliente: string;
  lugarPozoLocacion: string;
  descripcion: string;
  accionesInmediatas: string;
  recomendaciones: string;
  justificacionAbierta: string;
  calidad: string[];
  medioambiente: string[];
  seguridadSalud: string[];
  savedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIPO_LABELS: Record<string, string> = {
  DETENCION_TAREAS: 'Detención de Tareas',
  CONDICION_INSEGURA: 'Condición Insegura',
  ACTO_INSEGURO: 'Acto Inseguro',
  CASI_ACCIDENTE: 'Casi Accidente',
  OBSERVACION_POSITIVA: 'Observación Positiva',
};

const TIPO_COLORS: Record<string, string> = {
  DETENCION_TAREAS: 'bg-red-500/20 text-red-400 border-red-500/30',
  CONDICION_INSEGURA: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ACTO_INSEGURO: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CASI_ACCIDENTE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  OBSERVACION_POSITIVA: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const ESTADO_LABELS: Record<string, string> = {
  ABIERTA: 'Abierta',
  EN_PROGRESO: 'En Progreso',
  CERRADA: 'Cerrada',
};

const ESTADO_COLORS: Record<string, string> = {
  ABIERTA: 'bg-blue-500/20 text-blue-400',
  EN_PROGRESO: 'bg-amber-500/20 text-amber-400',
  CERRADA: 'bg-emerald-500/20 text-emerald-400',
};

const CALIDAD_OPTIONS = [
  'Posible error operativo',
  'Falla en el producto',
  'Falta de cumplimiento a los requisitos del cliente',
  'Mejora positiva',
  'Documentación habilitante',
  'Otro',
];

const MEDIOAMBIENTE_OPTIONS = [
  'Derrame',
  'Emisión al aire',
  'Afección a la flora/fauna',
  'Cuidado y protección del ambiente',
  'Otro',
];

const SEGURIDAD_SALUD_OPTIONS = [
  'Trabajo sin autorización',
  'No utilización de EPP / Uso incorrecto',
  'Superposición de tareas',
  'Operación peligrosa de izaje / Levantamiento de carga',
  'Manos o pies en zonas de riesgo',
  'Falta / Inadecuado bloqueo / Dispositivo de seguridad',
  'Inadecuada / Defectuosa máquina / Equipos',
  'Velocidad máxima superada',
  'Falta de ATS / Permiso de trabajo',
  'Posición insegura o mal esfuerzo / postura incorrecta',
  'Falta de Plan de contingencia / Llamada / Punto de reunión',
  'Aplica medidas proactivas / Preventivas',
  'Otro',
];

const TIPO_OPTIONS = Object.entries(TIPO_LABELS).map(([value, label]) => ({ value, label }));

const inputClass =
  'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const selectClass =
  'h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const DRAFT_KEY_NEW = 'wentop-draft';
const draftKeyEdit = (id: string) => `wentop-edit-draft-${id}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function saveDraft(key: string, data: Omit<DraftData, 'savedAt'>) {
  try {
    const draft: DraftData = { ...data, savedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(draft));
  } catch { /* quota exceeded — ignore */ }
}

function loadDraft(key: string): DraftData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function hasFormData(d: Omit<DraftData, 'savedAt'>): boolean {
  return !!(
    d.tipoTarjeta ||
    d.descripcion.trim() ||
    d.cliente.trim() ||
    d.lugarPozoLocacion.trim() ||
    d.accionesInmediatas.trim() ||
    d.recomendaciones.trim() ||
    d.justificacionAbierta.trim() ||
    d.calidad.length > 0 ||
    d.medioambiente.length > 0 ||
    d.seguridadSalud.length > 0
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function WentopPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const dialog = useDialogStore();

  const isHighLevel = (user?.rolNivel ?? 0) >= 75;
  const canManageGestores =
    user?.rol === 'CMASS' || user?.rol === 'RRHH' || user?.rol === 'ADMIN' || isHighLevel;

  const [activeTab, setActiveTab] = useState<'tarjetas' | 'analytics' | 'gestores'>('tarjetas');

  // Filters
  const [filterEstado, setFilterEstado] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterDesde, setFilterDesde] = useState('');
  const [filterHasta, setFilterHasta] = useState('');

  // Modals
  const [selectedTarjeta, setSelectedTarjeta] = useState<WentopTarjeta | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTarjeta, setEditingTarjeta] = useState<WentopTarjeta | null>(null);

  // Sectors query (shared)
  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/sectores');
      return data;
    },
  });

  // Gestores query — lightweight endpoint for current user's gestor sector assignments
  const { data: gestorSectorIds = [] } = useQuery<string[]>({
    queryKey: ['wentop', 'mis-gestores'],
    queryFn: async () => {
      const { data } = await api.get('/wentop/mis-gestores');
      return data;
    },
  });

  const canManageCard = useCallback(
    (tarjeta: WentopTarjeta) => {
      const nivel = user?.rolNivel ?? 0;
      return (
        user?.rol === 'CMASS' ||
        nivel >= 90 ||
        (nivel >= 70 && tarjeta.sectorObservacion?.id === user?.sectorId) ||
        (gestorSectorIds.length > 0 && tarjeta.sectorObservacion?.id != null && gestorSectorIds.includes(tarjeta.sectorObservacion.id))
      );
    },
    [user, gestorSectorIds],
  );

  // --- Tarjetas query ---
  const tarjetasQueryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (filterEstado) params.estado = filterEstado;
    if (filterTipo) params.tipoTarjeta = filterTipo;
    if (filterSector) params.sectorId = filterSector;
    if (filterDesde) params.desde = filterDesde;
    if (filterHasta) params.hasta = filterHasta;
    return params;
  }, [filterEstado, filterTipo, filterSector, filterDesde, filterHasta]);

  const { data: tarjetas = [], isLoading: loadingTarjetas } = useQuery<WentopTarjeta[]>({
    queryKey: ['wentop', 'tarjetas', tarjetasQueryParams],
    queryFn: async () => {
      const { data } = await api.get('/wentop', { params: tarjetasQueryParams });
      return data;
    },
  });

  // --- Mutations ---
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wentop/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wentop'] });
      toast({ title: 'Tarjeta eliminada', variant: 'success' });
      setShowDetail(false);
      setSelectedTarjeta(null);
    },
    onError: () => {
      toast({ title: 'Error al eliminar tarjeta', variant: 'destructive' });
    },
  });

  const estadoMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api.patch(`/wentop/${id}/estado`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wentop'] });
      toast({ title: 'Estado actualizado', variant: 'success' });
      setShowDetail(false);
      setSelectedTarjeta(null);
    },
    onError: () => {
      toast({ title: 'Error al cambiar estado', variant: 'destructive' });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: ({ tarjetaId, fotoId }: { tarjetaId: string; fotoId: string }) =>
      api.delete(`/wentop/${tarjetaId}/fotos/${fotoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wentop'] });
      toast({ title: 'Foto eliminada', variant: 'success' });
    },
    onError: () => {
      toast({ title: 'Error al eliminar foto', variant: 'destructive' });
    },
  });

  // --- Tab buttons ---
  const tabs = [
    { key: 'tarjetas' as const, label: 'Tarjetas', icon: FileText },
    { key: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
    ...(canManageGestores
      ? [{ key: 'gestores' as const, label: 'Gestores', icon: Users }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WENTOP</h1>
          <p className="text-sm text-muted-foreground">
            Tarjetas de observación de seguridad, calidad y medio ambiente
          </p>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === t.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'tarjetas' && (
        <TarjetasTab
          tarjetas={tarjetas}
          loading={loadingTarjetas}
          sectores={sectores}
          filterEstado={filterEstado}
          setFilterEstado={setFilterEstado}
          filterTipo={filterTipo}
          setFilterTipo={setFilterTipo}
          filterSector={filterSector}
          setFilterSector={setFilterSector}
          filterDesde={filterDesde}
          setFilterDesde={setFilterDesde}
          filterHasta={filterHasta}
          setFilterHasta={setFilterHasta}
          canManageGestores={canManageGestores}
          onSelect={(t) => {
            setSelectedTarjeta(t);
            setShowDetail(true);
          }}
          onNew={() => {
            setEditingTarjeta(null);
            setShowForm(true);
          }}
        />
      )}

      {activeTab === 'analytics' && <AnalyticsTab />}
      {activeTab === 'gestores' && canManageGestores && (
        <GestoresTab sectores={sectores} />
      )}

      {/* Detail modal */}
      {showDetail && selectedTarjeta && (
        <TarjetaDetailModal
          tarjeta={selectedTarjeta}
          canManage={canManageCard(selectedTarjeta)}
          isCreator={selectedTarjeta.creadorId === user?.id}
          onClose={() => {
            setShowDetail(false);
            setSelectedTarjeta(null);
          }}
          onEdit={() => {
            setShowDetail(false);
            setEditingTarjeta(selectedTarjeta);
            setShowForm(true);
          }}
          onDelete={async () => {
            if (
              await dialog.confirm({
                message: '¿Eliminar esta tarjeta? Esta acción no se puede deshacer.',
                variant: 'danger',
              })
            ) {
              deleteMutation.mutate(selectedTarjeta.id);
            }
          }}
          onEstadoChange={(estado, accionCierre) => {
            const body: Record<string, string> = { estado };
            if (accionCierre) body.accionCierre = accionCierre;
            if (estado === 'CERRADA') body.fechaCierre = new Date().toISOString().split('T')[0];
            estadoMutation.mutate({ id: selectedTarjeta.id, body });
          }}
          onDeletePhoto={async (fotoId) => {
            if (await dialog.confirm({ message: '¿Eliminar esta foto?', variant: 'danger' })) {
              deletePhotoMutation.mutate({ tarjetaId: selectedTarjeta.id, fotoId });
            }
          }}
        />
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <TarjetaFormModal
          tarjeta={editingTarjeta}
          sectores={sectores}
          onClose={() => {
            setShowForm(false);
            setEditingTarjeta(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Tarjetas (with collapsible filters, FAB, improved cards & empty state)
// ---------------------------------------------------------------------------

function TarjetasTab({
  tarjetas,
  loading,
  sectores,
  filterEstado,
  setFilterEstado,
  filterTipo,
  setFilterTipo,
  filterSector,
  setFilterSector,
  filterDesde,
  setFilterDesde,
  filterHasta,
  setFilterHasta,
  canManageGestores,
  onSelect,
  onNew,
}: {
  tarjetas: WentopTarjeta[];
  loading: boolean;
  sectores: Sector[];
  filterEstado: string;
  setFilterEstado: (v: string) => void;
  filterTipo: string;
  setFilterTipo: (v: string) => void;
  filterSector: string;
  setFilterSector: (v: string) => void;
  filterDesde: string;
  setFilterDesde: (v: string) => void;
  filterHasta: string;
  setFilterHasta: (v: string) => void;
  canManageGestores: boolean;
  onSelect: (t: WentopTarjeta) => void;
  onNew: () => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount = [filterEstado, filterTipo, filterSector, filterDesde, filterHasta].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterEstado('');
    setFilterTipo('');
    setFilterSector('');
    setFilterDesde('');
    setFilterHasta('');
  };

  return (
    <div className="space-y-4">
      {/* Filter bar — collapsible on mobile */}
      <div className="space-y-3">
        {/* Mobile: toggle + Nueva Tarjeta */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={cn(
              'relative flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
              activeFilterCount > 0
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted/30 text-muted-foreground',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
            {filtersOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="h-10 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Filter controls — always visible on md+, collapsible on mobile */}
        <div className={cn('flex-wrap items-end gap-3', filtersOpen ? 'flex' : 'hidden md:flex')}>
          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-xs text-muted-foreground">Estado</label>
            <select
              className={cn(selectClass, 'w-full sm:w-auto min-h-[44px] md:min-h-0')}
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(ESTADO_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-xs text-muted-foreground">Tipo</label>
            <select
              className={cn(selectClass, 'w-full sm:w-auto min-h-[44px] md:min-h-0')}
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value)}
            >
              <option value="">Todos</option>
              {TIPO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {canManageGestores && (
            <div className="w-full sm:w-auto">
              <label className="mb-1 block text-xs text-muted-foreground">Sector</label>
              <select
                className={cn(selectClass, 'w-full sm:w-auto min-h-[44px] md:min-h-0')}
                value={filterSector}
                onChange={(e) => setFilterSector(e.target.value)}
              >
                <option value="">Todos</option>
                {sectores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-xs text-muted-foreground">Desde</label>
            <input
              type="date"
              className={cn(inputClass, 'min-h-[44px] md:min-h-0')}
              value={filterDesde}
              onChange={(e) => setFilterDesde(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-auto">
            <label className="mb-1 block text-xs text-muted-foreground">Hasta</label>
            <input
              type="date"
              className={cn(inputClass, 'min-h-[44px] md:min-h-0')}
              value={filterHasta}
              onChange={(e) => setFilterHasta(e.target.value)}
            />
          </div>

          {/* Desktop: inline nueva tarjeta + limpiar filtros */}
          <div className="hidden md:flex items-end gap-2">
            <button
              onClick={onNew}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Nueva Tarjeta
            </button>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tarjetas.length === 0 ? (
        /* Enhanced empty state */
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted/50">
            <FileText className="h-10 w-10 opacity-40" />
          </div>
          <p className="mb-1 text-base font-medium text-foreground">Sin tarjetas</p>
          <p className="mb-6 text-sm text-center max-w-xs">
            No se encontraron tarjetas con los filtros seleccionados. Creá una nueva tarjeta de observación.
          </p>
          <button
            onClick={onNew}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nueva Tarjeta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tarjetas.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="rounded-xl border border-border bg-card p-3 md:p-4 text-left transition-colors hover:bg-accent/50"
            >
              {/* Badges */}
              <div className="mb-2 md:mb-3 flex flex-wrap items-center gap-1.5 md:gap-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] md:text-xs font-medium',
                    TIPO_COLORS[t.tipoTarjeta] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {TIPO_LABELS[t.tipoTarjeta] ?? t.tipoTarjeta}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] md:text-xs font-medium',
                    ESTADO_COLORS[t.estado] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {ESTADO_LABELS[t.estado] ?? t.estado}
                </span>
              </div>

              {/* Creator */}
              <p className="text-sm font-medium text-foreground">
                {t.creador.nombre} {t.creador.apellido}
                {t.creador.legajo && (
                  <span className="ml-1 text-muted-foreground">({t.creador.legajo})</span>
                )}
              </p>

              {/* Sector */}
              {t.sectorObservacion && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sector: {t.sectorObservacion.nombre}
                </p>
              )}

              {/* Location — shown when available */}
              {t.lugarPozoLocacion && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {truncate(t.lugarPozoLocacion, 40)}
                </p>
              )}

              {/* Date */}
              <p className="text-xs text-muted-foreground mt-1">{formatDate(t.fechaReporte)}</p>

              {/* Description */}
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed line-clamp-2 md:line-clamp-3">
                {truncate(t.descripcion, 120)}
              </p>

              {/* Photo count */}
              {(t.fotos?.length > 0 || (t._count?.fotos ?? 0) > 0) && (
                <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Camera className="h-3.5 w-3.5" />
                  {t.fotos?.length ?? t._count?.fotos} foto
                  {(t.fotos?.length ?? t._count?.fotos ?? 0) !== 1 ? 's' : ''}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Mobile FAB */}
      <button
        onClick={onNew}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-all md:hidden"
        aria-label="Nueva Tarjeta"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Analytics
// ---------------------------------------------------------------------------

function AnalyticsTab() {
  const { data: analytics, isLoading } = useQuery<WentopAnalytics>({
    queryKey: ['wentop', 'analytics'],
    queryFn: async () => {
      const { data } = await api.get('/wentop/analytics');
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Sin datos disponibles</p>
    );
  }

  const maxTipo = Math.max(...analytics.porTipo.map((i) => i.count), 1);
  const maxSector = Math.max(...analytics.porSector.map((i) => i.count), 1);
  const maxMes = Math.max(...analytics.porMes.map((i) => i.count), 1);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total" value={analytics.totales.total} />
        <StatCard label="Abiertas" value={analytics.totales.abierta} color="text-blue-400" />
        <StatCard label="En Progreso" value={analytics.totales.enProgreso} color="text-amber-400" />
        <StatCard label="Cerradas" value={analytics.totales.cerrada} color="text-emerald-400" />
      </div>

      {/* Bar charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BarSection
          title="Por Tipo de Tarjeta"
          items={analytics.porTipo.map((i) => ({
            label: TIPO_LABELS[i.tipo] ?? i.tipo,
            count: i.count,
            pct: (i.count / maxTipo) * 100,
            color: TIPO_COLORS[i.tipo]?.split(' ')[0] ?? 'bg-muted',
          }))}
        />
        <BarSection
          title="Por Sector"
          items={analytics.porSector.map((i) => ({
            label: i.sectorNombre,
            count: i.count,
            pct: (i.count / maxSector) * 100,
            color: 'bg-primary/60',
          }))}
        />
      </div>

      <BarSection
        title="Por Mes (últimos meses)"
        items={analytics.porMes.map((i) => ({
          label: i.mes,
          count: i.count,
          pct: (i.count / maxMes) * 100,
          color: 'bg-primary/60',
        }))}
      />

      {/* Category breakdown */}
      <div className="grid gap-6 md:grid-cols-3">
        <CategoryBreakdown title="Calidad" items={analytics.porCategoria.calidad} />
        <CategoryBreakdown title="Medioambiente" items={analytics.porCategoria.medioambiente} />
        <CategoryBreakdown
          title="Seguridad y Salud"
          items={analytics.porCategoria.seguridadSalud}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-3xl font-bold', color ?? 'text-foreground')}>{value}</p>
    </div>
  );
}

function BarSection({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number; pct: number; color: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.count}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className={cn('h-2 rounded-full transition-all', item.color)}
                style={{ width: `${Math.max(item.pct, 2)}%` }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">Sin datos</p>
        )}
      </div>
    </div>
  );
}

function CategoryBreakdown({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number }[];
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate mr-2">{item.label}</span>
              <span className="font-medium text-foreground shrink-0">{item.count}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary/60 transition-all"
                style={{ width: `${Math.max((item.count / max) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">Sin datos</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Gestores (fetches own data internally)
// ---------------------------------------------------------------------------

function GestoresTab({ sectores }: { sectores: Sector[] }) {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();

  const [nuevoUsuarioId, setNuevoUsuarioId] = useState('');
  const [nuevoSectorId, setNuevoSectorId] = useState('');

  const { data: gestores = [] } = useQuery<WentopGestor[]>({
    queryKey: ['wentop', 'gestores'],
    queryFn: async () => {
      const { data } = await api.get('/wentop/gestores');
      return data;
    },
  });

  const { data: usuarios = [] } = useQuery<Usuario[]>({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data } = await api.get('/usuarios');
      return data;
    },
  });

  const addMutation = useMutation({
    mutationFn: (body: { usuarioId: string; sectorId: string }) =>
      api.post('/wentop/gestores', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wentop', 'gestores'] });
      toast({ title: 'Gestor agregado', variant: 'success' });
      setNuevoUsuarioId('');
      setNuevoSectorId('');
    },
    onError: () => {
      toast({ title: 'Error al agregar gestor', variant: 'destructive' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/wentop/gestores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wentop', 'gestores'] });
      toast({ title: 'Gestor eliminado', variant: 'success' });
    },
    onError: () => {
      toast({ title: 'Error al eliminar gestor', variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-4">
      {/* Add gestor */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Agregar Gestor</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs text-muted-foreground">Usuario</label>
            <select
              className={cn(selectClass, 'w-full')}
              value={nuevoUsuarioId}
              onChange={(e) => setNuevoUsuarioId(e.target.value)}
            >
              <option value="">Seleccionar usuario…</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} {u.apellido} {u.legajo ? `(${u.legajo})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs text-muted-foreground">Sector</label>
            <select
              className={cn(selectClass, 'w-full')}
              value={nuevoSectorId}
              onChange={(e) => setNuevoSectorId(e.target.value)}
            >
              <option value="">Seleccionar sector…</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={!nuevoUsuarioId || !nuevoSectorId || addMutation.isPending}
            onClick={() => addMutation.mutate({ usuarioId: nuevoUsuarioId, sectorId: nuevoSectorId })}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Agregar
          </button>
        </div>
      </div>

      {/* Gestores table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usuario</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Legajo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sector</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {gestores.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No hay gestores asignados
                  </td>
                </tr>
              )}
              {gestores.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">
                    {g.usuario.nombre} {g.usuario.apellido}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{g.usuario.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{g.usuario.legajo ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{g.sector.nombre}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={async () => {
                        if (
                          await dialog.confirm({
                            message: `¿Quitar a ${g.usuario.nombre} ${g.usuario.apellido} como gestor?`,
                            variant: 'danger',
                          })
                        ) {
                          removeMutation.mutate(g.id);
                        }
                      }}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: Tarjeta Detail (full-screen on mobile)
// ---------------------------------------------------------------------------

function TarjetaDetailModal({
  tarjeta,
  canManage,
  isCreator,
  onClose,
  onEdit,
  onDelete,
  onEstadoChange,
  onDeletePhoto,
}: {
  tarjeta: WentopTarjeta;
  canManage: boolean;
  isCreator: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEstadoChange: (estado: string, accionCierre?: string) => void;
  onDeletePhoto: (fotoId: string) => void;
}) {
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const [showCierreForm, setShowCierreForm] = useState(false);
  const [accionCierre, setAccionCierre] = useState('');

  const canDelete = isCreator && tarjeta.estado === 'ABIERTA';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 md:p-4 md:overflow-y-auto">
      <div className="flex flex-col h-full w-full md:my-4 md:h-auto md:max-w-3xl md:rounded-xl border border-border bg-card md:shadow-2xl">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-3 md:p-4 md:rounded-t-xl">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap min-w-0">
            <h2 className="text-base md:text-lg font-semibold text-foreground shrink-0">Detalle</h2>
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] md:text-xs font-medium',
                TIPO_COLORS[tarjeta.tipoTarjeta] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {TIPO_LABELS[tarjeta.tipoTarjeta] ?? tarjeta.tipoTarjeta}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] md:text-xs font-medium',
                ESTADO_COLORS[tarjeta.estado] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {ESTADO_LABELS[tarjeta.estado] ?? tarjeta.estado}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-accent transition-colors shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-5">
          {/* General info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Creador">
              {tarjeta.creador.nombre} {tarjeta.creador.apellido}
              {tarjeta.creador.legajo && (
                <span className="text-muted-foreground"> ({tarjeta.creador.legajo})</span>
              )}
            </Field>
            <Field label="Sector del Creador">
              {tarjeta.creador.sector?.nombre ?? '—'}
            </Field>
            <Field label="Sector de Observación">
              {tarjeta.sectorObservacion?.nombre ?? '—'}
              {tarjeta.sectorTercero && (
                <span className="ml-1 text-xs text-amber-400">(Tercero)</span>
              )}
            </Field>
            <Field label="Fecha de Reporte">{formatDate(tarjeta.fechaReporte)}</Field>
            <Field label="Cliente">{tarjeta.cliente || '—'}</Field>
            <Field label="Lugar / Pozo / Locación">{tarjeta.lugarPozoLocacion || '—'}</Field>
          </div>

          {/* Categories */}
          <div className="space-y-3">
            {tarjeta.calidad.length > 0 && (
              <Field label="Calidad">
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tarjeta.calidad.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </Field>
            )}
            {tarjeta.medioambiente.length > 0 && (
              <Field label="Medioambiente">
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tarjeta.medioambiente.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </Field>
            )}
            {tarjeta.seguridadSalud.length > 0 && (
              <Field label="Seguridad y Salud">
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tarjeta.seguridadSalud.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </Field>
            )}
          </div>

          {/* Descriptions */}
          <Field label="Descripción">
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
              {tarjeta.descripcion}
            </p>
          </Field>

          {tarjeta.accionesInmediatas && (
            <Field label="Acciones Inmediatas">
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                {tarjeta.accionesInmediatas}
              </p>
            </Field>
          )}

          {tarjeta.recomendaciones && (
            <Field label="Recomendaciones">
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                {tarjeta.recomendaciones}
              </p>
            </Field>
          )}

          {tarjeta.justificacionAbierta && (
            <Field label="Justificación (Abierta)">
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                {tarjeta.justificacionAbierta}
              </p>
            </Field>
          )}

          {tarjeta.accionCierre && (
            <Field label="Acción de Cierre">
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                {tarjeta.accionCierre}
              </p>
            </Field>
          )}

          {tarjeta.fechaCierre && (
            <Field label="Fecha de Cierre">{formatDate(tarjeta.fechaCierre)}</Field>
          )}

          {/* Photos — 2 cols on mobile, 3 on sm+ */}
          {tarjeta.fotos.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Evidencia fotográfica
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {tarjeta.fotos.map((f) => (
                  <div key={f.id} className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    <img
                      src={getUploadUrl(f.url)}
                      alt=""
                      className="h-full w-full object-cover cursor-pointer"
                      onClick={() => setExpandedPhoto(getUploadUrl(f.url))}
                    />
                    {canManage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePhoto(f.id);
                        }}
                        className="absolute top-1 right-1 rounded-md bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/80"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* State change - cierre form */}
          {showCierreForm && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Acción de cierre
              </label>
              <textarea
                className={cn(inputClass, 'h-auto min-h-[80px] py-2')}
                value={accionCierre}
                onChange={(e) => setAccionCierre(e.target.value)}
                placeholder="Describa la acción de cierre…"
              />
              <div className="flex gap-2">
                <button
                  disabled={!accionCierre.trim()}
                  onClick={() => {
                    onEstadoChange('CERRADA', accionCierre.trim());
                    setShowCierreForm(false);
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Confirmar Cierre
                </button>
                <button
                  onClick={() => setShowCierreForm(false)}
                  className="h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer actions */}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card p-3 md:p-4 md:rounded-b-xl">
          <div className="flex flex-wrap gap-2">
            {canManage && tarjeta.estado === 'ABIERTA' && (
              <button
                onClick={() => onEstadoChange('EN_PROGRESO')}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
              >
                <Clock className="h-3.5 w-3.5" />
                En Progreso
              </button>
            )}
            {canManage && (tarjeta.estado === 'ABIERTA' || tarjeta.estado === 'EN_PROGRESO') && !showCierreForm && (
              <button
                onClick={() => setShowCierreForm(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cerrar
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {canManage && (
              <button
                onClick={onEdit}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/10 px-3 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded photo overlay */}
      {expandedPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpandedPhoto(null)}
        >
          <img
            src={expandedPhoto}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
          <button
            onClick={() => setExpandedPhoto(null)}
            className="absolute top-4 right-4 rounded-full bg-black/60 p-2 hover:bg-black/80 transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: Create / Edit Tarjeta (with draft auto-save, full-screen on mobile)
// ---------------------------------------------------------------------------

function TarjetaFormModal({
  tarjeta,
  sectores,
  onClose,
}: {
  tarjeta: WentopTarjeta | null;
  sectores: Sector[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!tarjeta;
  const draftKey = isEdit ? draftKeyEdit(tarjeta.id) : DRAFT_KEY_NEW;

  // Form state
  const [fechaReporte, setFechaReporte] = useState(
    tarjeta?.fechaReporte?.split('T')[0] ?? new Date().toISOString().split('T')[0],
  );
  const [tipoTarjeta, setTipoTarjeta] = useState(tarjeta?.tipoTarjeta ?? '');
  const [sectorObservacionId, setSectorObservacionId] = useState(tarjeta?.sectorObservacionId ?? '');
  const [sectorTercero, setSectorTercero] = useState(tarjeta?.sectorTercero ?? false);
  const [cliente, setCliente] = useState(tarjeta?.cliente ?? '');
  const [lugarPozoLocacion, setLugarPozoLocacion] = useState(tarjeta?.lugarPozoLocacion ?? '');
  const [descripcion, setDescripcion] = useState(tarjeta?.descripcion ?? '');
  const [accionesInmediatas, setAccionesInmediatas] = useState(tarjeta?.accionesInmediatas ?? '');
  const [recomendaciones, setRecomendaciones] = useState(tarjeta?.recomendaciones ?? '');
  const [justificacionAbierta, setJustificacionAbierta] = useState(
    tarjeta?.justificacionAbierta ?? '',
  );

  // Categories
  const [calidad, setCalidad] = useState<string[]>(tarjeta?.calidad ?? []);
  const [medioambiente, setMedioambiente] = useState<string[]>(tarjeta?.medioambiente ?? []);
  const [seguridadSalud, setSeguridadSalud] = useState<string[]>(tarjeta?.seguridadSalud ?? []);

  // Photos (new uploads)
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Draft system
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check for existing draft
  useEffect(() => {
    const existing = loadDraft(draftKey);
    if (existing && !tarjeta) {
      setShowDraftBanner(true);
    } else if (existing && tarjeta) {
      // For edits, silently check if there's a draft newer than the tarjeta
      const draftTime = new Date(existing.savedAt).getTime();
      const tarjetaTime = new Date(tarjeta.updatedAt).getTime();
      if (draftTime > tarjetaTime) {
        setShowDraftBanner(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDraft = () => {
    const draft = loadDraft(draftKey);
    if (!draft) return;
    setFechaReporte(draft.fechaReporte);
    setTipoTarjeta(draft.tipoTarjeta);
    setSectorObservacionId(draft.sectorObservacionId);
    setSectorTercero(draft.sectorTercero);
    setCliente(draft.cliente);
    setLugarPozoLocacion(draft.lugarPozoLocacion);
    setDescripcion(draft.descripcion);
    setAccionesInmediatas(draft.accionesInmediatas);
    setRecomendaciones(draft.recomendaciones);
    setJustificacionAbierta(draft.justificacionAbierta);
    setCalidad(draft.calidad);
    setMedioambiente(draft.medioambiente);
    setSeguridadSalud(draft.seguridadSalud);
    setShowDraftBanner(false);
    setDraftLoaded(true);
    toast({ title: 'Borrador restaurado', variant: 'success' });
  };

  const discardDraft = () => {
    clearDraft(draftKey);
    setShowDraftBanner(false);
  };

  // Auto-save draft on field changes (debounced 500ms)
  useEffect(() => {
    if (showDraftBanner && !draftLoaded) return; // don't overwrite draft before user decides
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const data = {
        fechaReporte,
        tipoTarjeta,
        sectorObservacionId,
        sectorTercero,
        cliente,
        lugarPozoLocacion,
        descripcion,
        accionesInmediatas,
        recomendaciones,
        justificacionAbierta,
        calidad,
        medioambiente,
        seguridadSalud,
      };
      if (hasFormData(data)) {
        saveDraft(draftKey, data);
      }
    }, 500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fechaReporte, tipoTarjeta, sectorObservacionId, sectorTercero,
    cliente, lugarPozoLocacion, descripcion, accionesInmediatas,
    recomendaciones, justificacionAbierta, calidad, medioambiente,
    seguridadSalud, draftKey, showDraftBanner, draftLoaded,
  ]);

  const toggleOption = (
    list: string[],
    setList: (v: string[]) => void,
    option: string,
  ) => {
    setList(
      list.includes(option) ? list.filter((i) => i !== option) : [...list, option],
    );
  };

  const handleCancel = () => {
    const data = {
      fechaReporte,
      tipoTarjeta,
      sectorObservacionId,
      sectorTercero,
      cliente,
      lugarPozoLocacion,
      descripcion,
      accionesInmediatas,
      recomendaciones,
      justificacionAbierta,
      calidad,
      medioambiente,
      seguridadSalud,
    };
    if (hasFormData(data)) {
      saveDraft(draftKey, data);
      toast({ title: 'Borrador guardado automáticamente', variant: 'default' });
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tipoTarjeta || !descripcion.trim()) {
      toast({ title: 'Complete los campos obligatorios', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        fechaReporte,
        tipoTarjeta,
        sectorObservacionId: sectorObservacionId || null,
        sectorTercero,
        cliente: cliente || null,
        lugarPozoLocacion: lugarPozoLocacion || null,
        descripcion: descripcion.trim(),
        accionesInmediatas: accionesInmediatas.trim() || null,
        recomendaciones: recomendaciones.trim() || null,
        justificacionAbierta: justificacionAbierta.trim() || null,
        calidad,
        medioambiente,
        seguridadSalud,
      };

      let tarjetaId: string;
      if (isEdit) {
        await api.put(`/wentop/${tarjeta.id}`, payload);
        tarjetaId = tarjeta.id;
      } else {
        const { data } = await api.post('/wentop', payload);
        tarjetaId = data.id;
      }

      // Upload new photos
      if (newFiles.length > 0) {
        const fd = new FormData();
        newFiles.forEach((f) => fd.append('fotos', f));
        await api.post(`/wentop/${tarjetaId}/fotos`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      // Clear draft on successful submit
      clearDraft(draftKey);

      queryClient.invalidateQueries({ queryKey: ['wentop'] });
      toast({ title: isEdit ? 'Tarjeta actualizada' : 'Tarjeta creada', variant: 'success' });
      onClose();
    } catch {
      toast({
        title: isEdit ? 'Error al actualizar tarjeta' : 'Error al crear tarjeta',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const removeNewFile = (index: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 md:p-4 md:overflow-y-auto">
      <div className="flex flex-col h-full w-full md:my-4 md:h-auto md:max-w-2xl md:rounded-xl border border-border bg-card md:shadow-2xl">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-3 md:p-4 md:rounded-t-xl">
          <h2 className="text-base md:text-lg font-semibold text-foreground">
            {isEdit ? 'Editar Tarjeta' : 'Nueva Tarjeta'}
          </h2>
          <button onClick={handleCancel} className="rounded-lg p-2 hover:bg-accent transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Draft banner */}
        {showDraftBanner && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 md:px-4">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-sm text-amber-300 flex-1 min-w-0">Tiene un borrador guardado</span>
            <button
              onClick={restoreDraft}
              className="h-7 rounded-md bg-amber-600 px-2.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
            >
              Continuar editando
            </button>
            <button
              onClick={discardDraft}
              className="h-7 rounded-md border border-amber-500/30 px-2.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              Descartar
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          {/* Scrollable form body */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-5">
            {/* Datos generales */}
            <FormSection title="Datos Generales">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Tipo de Tarjeta <span className="text-red-400">*</span>
                  </label>
                  <select
                    className={cn(selectClass, 'w-full min-h-[44px] md:min-h-0')}
                    value={tipoTarjeta}
                    onChange={(e) => setTipoTarjeta(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar…</option>
                    {TIPO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Fecha de Reporte</label>
                  <input
                    type="date"
                    className={cn(inputClass, 'min-h-[44px] md:min-h-0')}
                    value={fechaReporte}
                    onChange={(e) => setFechaReporte(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Sector de Observación
                  </label>
                  <select
                    className={cn(selectClass, 'w-full min-h-[44px] md:min-h-0')}
                    value={sectorObservacionId}
                    onChange={(e) => setSectorObservacionId(e.target.value)}
                  >
                    <option value="">Sin sector</option>
                    {sectores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer min-h-[44px] md:min-h-0">
                    <input
                      type="checkbox"
                      checked={sectorTercero}
                      onChange={(e) => setSectorTercero(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Sector tercero
                  </label>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Cliente</label>
                  <input
                    className={cn(inputClass, 'min-h-[44px] md:min-h-0')}
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    placeholder="Nombre del cliente"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Lugar / Pozo / Locación
                  </label>
                  <input
                    className={cn(inputClass, 'min-h-[44px] md:min-h-0')}
                    value={lugarPozoLocacion}
                    onChange={(e) => setLugarPozoLocacion(e.target.value)}
                    placeholder="Ubicación"
                  />
                </div>
              </div>
            </FormSection>

            {/* Categories */}
            <FormSection title="Categorías">
              <CheckboxGroup
                label="Calidad"
                options={CALIDAD_OPTIONS}
                selected={calidad}
                onToggle={(opt) => toggleOption(calidad, setCalidad, opt)}
              />
              <CheckboxGroup
                label="Medioambiente"
                options={MEDIOAMBIENTE_OPTIONS}
                selected={medioambiente}
                onToggle={(opt) => toggleOption(medioambiente, setMedioambiente, opt)}
              />
              <CheckboxGroup
                label="Seguridad y Salud"
                options={SEGURIDAD_SALUD_OPTIONS}
                selected={seguridadSalud}
                onToggle={(opt) => toggleOption(seguridadSalud, setSeguridadSalud, opt)}
                twoColumnMobile
              />
            </FormSection>

            {/* Description & Actions */}
            <FormSection title="Descripción y Acciones">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Descripción <span className="text-red-400">*</span>
                </label>
                <textarea
                  className={cn(inputClass, 'h-auto min-h-[100px] py-2')}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Describa la observación…"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Acciones Inmediatas
                </label>
                <textarea
                  className={cn(inputClass, 'h-auto min-h-[60px] py-2')}
                  value={accionesInmediatas}
                  onChange={(e) => setAccionesInmediatas(e.target.value)}
                  placeholder="Acciones tomadas de forma inmediata…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Recomendaciones</label>
                <textarea
                  className={cn(inputClass, 'h-auto min-h-[60px] py-2')}
                  value={recomendaciones}
                  onChange={(e) => setRecomendaciones(e.target.value)}
                  placeholder="Recomendaciones…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Justificación (si queda abierta)
                </label>
                <textarea
                  className={cn(inputClass, 'h-auto min-h-[60px] py-2')}
                  value={justificacionAbierta}
                  onChange={(e) => setJustificacionAbierta(e.target.value)}
                  placeholder="Justificación…"
                />
              </div>
            </FormSection>

            {/* Photos */}
            <FormSection title="Evidencia Fotográfica">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors min-w-[200px]">
                    <ImageIcon className="h-4 w-4" />
                    <span>Seleccionar fotos…</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          setNewFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {/* Mobile camera button */}
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm text-primary hover:bg-primary/10 transition-colors md:hidden">
                    <Camera className="h-4 w-4" />
                    <span>Tomar Foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          setNewFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {/* New file previews — 3 cols on mobile, 6 on sm+ */}
                {newFiles.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {newFiles.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                      >
                        <img
                          src={URL.createObjectURL(file)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeNewFile(i)}
                          className="absolute top-1 right-1 rounded-md bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/80"
                        >
                          <X className="h-3 w-3 text-white" />
                        </button>
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[10px] text-white text-center truncate">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Existing photos (edit mode) */}
                {isEdit && tarjeta.fotos.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Fotos existentes</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {tarjeta.fotos.map((f) => (
                        <div
                          key={f.id}
                          className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                        >
                          <img
                            src={getUploadUrl(f.url)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </FormSection>
          </div>

          {/* Sticky footer */}
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card p-3 md:p-4 md:rounded-b-xl">
            <button
              type="button"
              onClick={handleCancel}
              className="h-10 md:h-9 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 md:h-9 items-center gap-1.5 rounded-lg bg-primary px-5 md:px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar Cambios' : 'Crear Tarjeta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">{title}</h3>
      {children}
    </div>
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
  twoColumnMobile,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  twoColumnMobile?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div className={cn(
        'flex flex-wrap gap-2',
        twoColumnMobile && 'grid grid-cols-2 md:flex md:flex-wrap',
      )}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={cn(
                'rounded-lg border min-h-[40px] py-2 px-3 text-xs transition-colors text-left',
                active
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50',
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
