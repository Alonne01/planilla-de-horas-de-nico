import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  Plus, FileText, Clock, XCircle, Loader2, Calendar, MapPin, Activity,
  Search, Users, Building2,
} from 'lucide-react';
import { ESTADO_STYLES, ESTADO_LABELS } from '@/constants/planillaConstants';
import { toast } from '@/stores/toastStore';
import { mensajeDeError } from '@/lib/errores';
import { fmtDia } from '@/utils/fechaDia';

interface Planilla {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  estado: string;
  totalHorasNormales: string;
  totalHorasExtra50: string;
  totalHorasExtra100: string;
  totalHorasViaje: string;
  totalDiasCampo: number;
  totalDiasBase: number;
  registrosCount: number;
  enviadaAt: string | null;
  aprobadaAt: string | null;
  obsRechazo: string | null;
  usuario: { id: string; nombre: string; apellido: string; legajo: string | null; sector?: { nombre: string } | null };
}



function formatPeriodo(inicio: string, fin: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${fmtDia(inicio, opts)} — ${fmtDia(fin, opts)}`;
}

// ─── Shared sub-components ───────────────────────

function PlanillaCard({ p, navigate, showNombre }: {
  p: Planilla; navigate: (path: string) => void; showNombre?: boolean;
}) {
  const totalHoras = Number(p.totalHorasNormales) + Number(p.totalHorasExtra50) + Number(p.totalHorasExtra100);
  return (
    <button
      onClick={() => navigate(`/planillas/${p.id}`)}
      className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-all"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-foreground">
              {formatPeriodo(p.periodoInicio, p.periodoFin)}
            </span>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[p.estado])}>
              {ESTADO_LABELS[p.estado]}
            </span>
          </div>
          {showNombre && (
            <p className="text-xs text-muted-foreground">
              {p.usuario.apellido}, {p.usuario.nombre}
              {p.usuario.legajo ? ` · Leg. ${p.usuario.legajo}` : ''}
            </p>
          )}
          {p.obsRechazo && (
            <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
              <XCircle className="h-3 w-3" /> {p.obsRechazo}
            </p>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground shrink-0">
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{totalHoras.toFixed(1)}</p>
            <p>horas total</p>
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="font-semibold text-foreground">{Number(p.totalHorasNormales).toFixed(1)}</p>
              <p>normales</p>
            </div>
            <div className="text-center">
              <p className="font-semibold text-amber-400">{Number(p.totalHorasExtra50).toFixed(1)}</p>
              <p>extra 50%</p>
            </div>
            <div className="text-center">
              <p className="font-semibold text-red-400">{Number(p.totalHorasExtra100).toFixed(1)}</p>
              <p>extra 100%</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex items-center gap-1" title="Días en campo">
              <MapPin className="h-3 w-3" /> {p.totalDiasCampo}
            </div>
            <div className="flex items-center gap-1" title="Registros">
              <Activity className="h-3 w-3" /> {p.registrosCount}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function EstadoFilters({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {(['', 'BORRADOR', 'ENVIADA', 'EN_REVISION', 'APROBADA', 'RECHAZADA', 'CERRADA'] as const).map((e) => (
        <button
          key={e}
          onClick={() => onChange(e)}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            value === e ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          )}
        >
          {e === '' ? 'Todas' : ESTADO_LABELS[e]}
        </button>
      ))}
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Buscar...'}
        className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function EmptyPlanillas() {
  return (
    <div className="text-center py-16">
      <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-muted-foreground">No hay planillas</p>
    </div>
  );
}

// ─── Main page ───────────────────────────────────

export default function PlanillasPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const nivel = user?.rolNivel ?? 0;

  const isManager = nivel >= 60 && nivel < 90;
  const isRRHH = nivel >= 90;
  const hasSubTabs = isManager || isRRHH;

  type TabType = 'mias' | 'equipo' | 'sectores';
  const [tab, setTab] = useState<TabType>('mias');
  const [estadoMias, setEstadoMias] = useState('');
  const [estadoEquipo, setEstadoEquipo] = useState('');
  const [searchEquipo, setSearchEquipo] = useState('');
  const [searchSectores, setSearchSectores] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');

  const { data: planillas = [], isLoading } = useQuery<Planilla[]>({
    queryKey: ['planillas'],
    queryFn: () => api.get('/planillas').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/planillas', {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      navigate(`/planillas/${res.data.id}`);
    },
    onError: (err: unknown) => {
      // Caso especial: el backend agrega planillaId cuando el 409 es "ya existe una
      // planilla para este período" — redirige en vez de mostrar un error, porque la
      // acción de crear ya cumplió su objetivo (llevar al usuario a esa planilla).
      const planillaId = (err as { response?: { data?: { planillaId?: string } } })?.response?.data?.planillaId;
      if (planillaId) {
        navigate(`/planillas/${planillaId}`);
        return;
      }
      toast({ title: 'Error', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const misPlanillas = useMemo(() =>
    planillas
      .filter(p => p.usuario.id === user?.id)
      .filter(p => !estadoMias || p.estado === estadoMias),
    [planillas, user?.id, estadoMias]
  );

  const otherPlanillas = useMemo(() =>
    planillas.filter(p => p.usuario.id !== user?.id),
    [planillas, user?.id]
  );

  const equipoPlanillas = useMemo(() => {
    const q = searchEquipo.toLowerCase().trim();
    return otherPlanillas
      .filter(p => !q || `${p.usuario.apellido} ${p.usuario.nombre} ${p.usuario.legajo ?? ''}`.toLowerCase().includes(q))
      .filter(p => !estadoEquipo || p.estado === estadoEquipo);
  }, [otherPlanillas, searchEquipo, estadoEquipo]);

  const sectors = useMemo(() => {
    if (!isRRHH) return [] as [string, Planilla[]][];
    const q = searchSectores.toLowerCase().trim();
    const map = new Map<string, Planilla[]>();
    otherPlanillas
      .filter(p => !q || `${p.usuario.apellido} ${p.usuario.nombre} ${p.usuario.legajo ?? ''}`.toLowerCase().includes(q))
      .forEach(p => {
        const s = p.usuario.sector?.nombre ?? 'Sin sector';
        if (!map.has(s)) map.set(s, []);
        map.get(s)!.push(p);
      });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [isRRHH, otherPlanillas, searchSectores]);

  const sectorNames = useMemo(() => sectors.map(([n]) => n), [sectors]);
  const visibleSectors = useMemo(() =>
    sectorFilter ? sectors.filter(([n]) => n === sectorFilter) : sectors,
    [sectors, sectorFilter]
  );

  const effectiveTab: TabType = hasSubTabs ? tab : 'mias';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Planillas de Horas</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Cargando...' : `${misPlanillas.length} planilla${misPlanillas.length !== 1 ? 's' : ''} propias`}
          </p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Nueva planilla
        </button>
      </div>

      {/* Tabs */}
      {hasSubTabs && (
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-1 bg-muted/20 rounded-lg p-1 w-fit">
            <button
              onClick={() => setTab('mias')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
                tab === 'mias' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Clock className="h-4 w-4 hidden sm:block" /> Mis Planillas
            </button>
            {isManager && (
              <button
                onClick={() => setTab('equipo')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
                  tab === 'equipo' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Users className="h-4 w-4 hidden sm:block" /> Mi Equipo
                {otherPlanillas.length > 0 && (
                  <span className="bg-muted text-muted-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                    {otherPlanillas.length}
                  </span>
                )}
              </button>
            )}
            {isRRHH && (
              <button
                onClick={() => setTab('sectores')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
                  tab === 'sectores' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Building2 className="h-4 w-4 hidden sm:block" /> Por Sector
                {otherPlanillas.length > 0 && (
                  <span className="bg-muted text-muted-foreground rounded-full text-xs px-1.5 min-w-[20px] text-center">
                    {otherPlanillas.length}
                  </span>
                )}
            </button>
          )}
        </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : effectiveTab === 'mias' ? (
        <div className="space-y-4">
          <EstadoFilters value={estadoMias} onChange={setEstadoMias} />
          {misPlanillas.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground">No hay planillas</p>
              <p className="text-xs text-muted-foreground mt-1">Creá una nueva para el período actual</p>
            </div>
          ) : (
            <div className="space-y-3">
              {misPlanillas.map(p => <PlanillaCard key={p.id} p={p} navigate={navigate} />)}
            </div>
          )}
        </div>
      ) : effectiveTab === 'equipo' ? (
        <div className="space-y-4">
          <SearchInput value={searchEquipo} onChange={setSearchEquipo} placeholder="Buscar por nombre o legajo..." />
          <EstadoFilters value={estadoEquipo} onChange={setEstadoEquipo} />
          {equipoPlanillas.length === 0 ? <EmptyPlanillas /> : (
            <div className="space-y-3">
              {equipoPlanillas.map(p => <PlanillaCard key={p.id} p={p} navigate={navigate} showNombre />)}
            </div>
          )}
        </div>
      ) : (
        /* Por Sector — RRHH / Admin */
        <div className="space-y-4">
          <SearchInput value={searchSectores} onChange={setSearchSectores} placeholder="Buscar por nombre o legajo..." />
          {sectorNames.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSectorFilter('')}
                className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  sectorFilter === '' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted')}
              >
                Todos los sectores
              </button>
              {sectorNames.map(s => (
                <button
                  key={s}
                  onClick={() => setSectorFilter(s)}
                  className={cn('px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                    sectorFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:bg-muted')}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {visibleSectors.length === 0 ? <EmptyPlanillas /> : (
            <div className="space-y-8">
              {visibleSectors.map(([sNombre, sPlanillas]) => (
                <section key={sNombre}>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">{sNombre}</h2>
                    <span className="text-xs text-muted-foreground">({sPlanillas.length})</span>
                  </div>
                  <div className="space-y-2">
                    {sPlanillas.map(p => <PlanillaCard key={p.id} p={p} navigate={navigate} showNombre />)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
