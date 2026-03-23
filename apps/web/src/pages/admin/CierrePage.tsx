import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  Lock, FileText, Loader2, CheckCircle2,
  DollarSign, Download, Eye, FileSpreadsheet,
  AlertTriangle, Users, Filter
} from 'lucide-react';
import PeriodSelector, { getCurrentPeriod } from '@/components/layout/PeriodSelector';

interface Sector {
  id: string;
  nombre: string;
}

interface ReciboPreview {
  usuario: { nombre: string; apellido: string; legajo: string; categoria: string; convenio: string };
  periodo: { inicio: string; fin: string };
  horas: { normales: number; extra50: number; extra100: number; viaje: number; diasCampo: number; diasBase: number };
  conceptos: { codigo: string; nombre: string; tipo: string; monto: number; esRemunerativo: boolean }[];
  retenciones: { codigo: string; nombre: string; monto: number }[];
  totales: { remunerativo: number; noRemunerativo: number; bruto: number; retenciones: number; neto: number };
}

interface Planilla {
  id: string;
  estado: string;
  usuario: { id: string; nombre: string; apellido: string; legajo: string; sector?: { id: string; nombre: string } };
  totalHorasNormales: string;
  periodoInicio: string;
  periodoFin: string;
}

interface PendienteUser {
  id: string;
  nombre: string;
  apellido: string;
  legajo: string | null;
  sector: string;
  rol: string;
}

type TabKey = 'exportar' | 'pendientes' | 'aprobadas';

export default function CierrePage() {
  const user = useAuthStore((s) => s.user);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>('exportar');

  // Export tab state
  const [exportMode, setExportMode] = useState<'todos' | 'sector'>('todos');
  const [selectedSectorIds, setSelectedSectorIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showPendientesModal, setShowPendientesModal] = useState(false);
  const [pendientes, setPendientes] = useState<PendienteUser[]>([]);
  const [pendientesInfo, setPendientesInfo] = useState<{ totalAprobadas: number; totalPendientes: number } | null>(null);

  // Pendientes tab state
  const [pendientesFilter, setPendientesFilter] = useState('');

  // Aprobadas tab state
  const [previewPlanillaId, setPreviewPlanillaId] = useState<string | null>(null);

  // Period selector state
  const [periodo, setPeriodo] = useState(getCurrentPeriod());

  const isRRHH = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');

  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores-cierre'],
    queryFn: async () => (await api.get('/analytics/sectores')).data,
    enabled: isRRHH,
  });

  const { data: allPlanillas = [], isLoading: loadingPlanillas } = useQuery<Planilla[]>({
    queryKey: ['planillas-cierre', periodo.inicio, periodo.fin],
    queryFn: async () => (await api.get(`/planillas?periodoInicio=${encodeURIComponent(periodo.inicio)}&periodoFin=${encodeURIComponent(periodo.fin)}`)).data,
    enabled: isRRHH,
  });

  const planillasAprobadas = allPlanillas.filter((p) => p.estado === 'APROBADA');

  const { data: allUsers = [] } = useQuery<{ id: string; nombre: string; apellido: string; legajo: string | null; activo: boolean; rol: string; sector?: { id: string; nombre: string } }[]>({
    queryKey: ['usuarios-cierre'],
    queryFn: async () => (await api.get('/admin/usuarios')).data,
    enabled: isRRHH,
  });

  // Users without approved/closed planilla
  const usersWithApproved = new Set(allPlanillas.filter(p => ['APROBADA', 'CERRADA'].includes(p.estado)).map(p => p.usuario.id));
  const pendientesTab = allUsers
    .filter(u => u.activo && !usersWithApproved.has(u.id))
    .filter(u => !pendientesFilter || u.sector?.id === pendientesFilter)
    .map(u => {
      const planilla = allPlanillas.find(p => p.usuario.id === u.id);
      return { ...u, estadoPlanilla: planilla?.estado ?? 'Sin planilla' };
    });

  const { data: preview } = useQuery<ReciboPreview>({
    queryKey: ['recibo-preview', previewPlanillaId],
    queryFn: async () => (await api.get(`/recibos/preview/${previewPlanillaId}`)).data,
    enabled: !!previewPlanillaId,
  });

  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Toggle sector selection
  const toggleSector = (id: string) => {
    setSelectedSectorIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const toggleAllSectors = () => {
    if (selectedSectorIds.length === sectores.length) {
      setSelectedSectorIds([]);
    } else {
      setSelectedSectorIds(sectores.map(s => s.id));
    }
  };

  // Export handler
  const handleExport = async (forzar = false) => {
    setExporting(true);
    setExportError(null);
    try {
      const body = {
        sectorIds: exportMode === 'sector' ? selectedSectorIds : [],
        exportarTodos: exportMode === 'todos',
        forzar,
      };
      const res = await api.post('/export/cierre', body, { responseType: 'blob' });

      // Download the file
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Extract filename from content-disposition header or use default
      const disposition = res.headers['content-disposition'];
      let filename = 'cierre_planillas.xlsx';
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setShowPendientesModal(false);
      setPendientes([]);
    } catch (err: any) {
      if (err.response?.status === 409) {
        try {
          const text = await err.response.data.text();
          const data = JSON.parse(text);
          setPendientes(data.pendientes);
          setPendientesInfo({ totalAprobadas: data.totalAprobadas, totalPendientes: data.totalPendientes });
          setShowPendientesModal(true);
        } catch {
          setExportError('Error al procesar la respuesta del servidor');
        }
      } else if (err.response?.status === 400) {
        try {
          const text = await err.response.data.text();
          const data = JSON.parse(text);
          setExportError(data.error ?? 'No hay planillas para exportar');
        } catch {
          setExportError('No hay planillas para exportar');
        }
      } else {
        setExportError('Error al exportar. Intente nuevamente.');
      }
    } finally {
      setExporting(false);
    }
  };

  if (!isRRHH) {
    return (
      <div className="text-center py-12">
        <Lock className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-muted-foreground">Requiere rol RRHH o ADMIN</p>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'exportar', label: 'Exportar', icon: <FileSpreadsheet className="h-4 w-4" /> },
    { key: 'pendientes', label: 'Pendientes', icon: <AlertTriangle className="h-4 w-4" /> },
    { key: 'aprobadas', label: 'Aprobadas', icon: <CheckCircle2 className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Lock className="h-6 w-6 text-amber-400" /> Cierre de Período
          </h1>
          <p className="text-sm text-muted-foreground">
            Período: {new Date(periodo.inicio).toLocaleDateString('es-AR')} — {new Date(periodo.fin).toLocaleDateString('es-AR')}
          </p>
        </div>
        <PeriodSelector value={periodo} onChange={setPeriodo} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.key === 'pendientes' && pendientesTab.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-400">
                {pendientesTab.length}
              </span>
            )}
            {tab.key === 'aprobadas' && planillasAprobadas.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-400">
                {planillasAprobadas.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Tab: Exportar ─── */}
      {activeTab === 'exportar' && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-400" />
            Exportar planillas a Excel
          </h2>

          {/* Export mode */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Modo de exportación</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'todos'}
                  onChange={() => setExportMode('todos')}
                  className="accent-primary"
                />
                <span className="text-sm">Todos los sectores</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'sector'}
                  onChange={() => setExportMode('sector')}
                  className="accent-primary"
                />
                <span className="text-sm">Por sector</span>
              </label>
            </div>
          </div>

          {/* Sector selection */}
          {exportMode === 'sector' && (
            <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/10">
              <label className="flex items-center gap-2 cursor-pointer pb-2 border-b border-border">
                <input
                  type="checkbox"
                  checked={selectedSectorIds.length === sectores.length && sectores.length > 0}
                  onChange={toggleAllSectors}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">Seleccionar todos</span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                {sectores.map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSectorIds.includes(s.id)}
                      onChange={() => toggleSector(s.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm">{s.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {exportError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <p className="text-sm text-red-400">{exportError}</p>
            </div>
          )}

          {/* Export button */}
          <button
            onClick={() => handleExport(false)}
            disabled={exporting || (exportMode === 'sector' && selectedSectorIds.length === 0)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar Excel
          </button>
        </div>
      )}

      {/* ─── Tab: Pendientes ─── */}
      {activeTab === 'pendientes' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-400" />
              Pendientes de aprobación ({pendientesTab.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const res = await api.get('/export/pendientes', { responseType: 'blob' });
                    const url = window.URL.createObjectURL(new Blob([res.data]));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Pendientes de aprobacion.xlsx';
                    a.click();
                    window.URL.revokeObjectURL(url);
                  } catch { /* noop */ }
                }}
                disabled={pendientesTab.length === 0}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Descargar Excel
              </button>
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm"
                value={pendientesFilter}
                onChange={(e) => setPendientesFilter(e.target.value)}
              >
                <option value="">Todos los sectores</option>
                {sectores.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingPlanillas ? (
            <div className="flex items-center justify-center h-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : pendientesTab.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-400" />
              <p className="text-sm text-muted-foreground">Todos los empleados tienen planilla aprobada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Empleado</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Legajo</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Sector</th>
                    <th className="pb-2 font-medium text-muted-foreground">Estado planilla</th>
                  </tr>
                </thead>
                <tbody>
                  {pendientesTab.map(u => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 pr-4 font-medium">{u.apellido} {u.nombre}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{u.legajo ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{u.sector?.nombre ?? '—'}</td>
                      <td className="py-2.5">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-medium',
                          u.estadoPlanilla === 'Sin planilla'
                            ? 'bg-red-500/20 text-red-400'
                            : u.estadoPlanilla === 'BORRADOR'
                            ? 'bg-zinc-500/20 text-zinc-400'
                            : u.estadoPlanilla === 'ENVIADA'
                            ? 'bg-blue-500/20 text-blue-400'
                            : u.estadoPlanilla === 'EN_REVISION'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-zinc-500/20 text-zinc-400'
                        )}>
                          {u.estadoPlanilla}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Aprobadas ─── */}
      {activeTab === 'aprobadas' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-400" />
              Planillas aprobadas ({planillasAprobadas.length})
            </h2>
          </div>

          {loadingPlanillas ? (
            <div className="flex items-center justify-center h-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : planillasAprobadas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No hay planillas aprobadas pendientes de cierre</p>
          ) : (
            <div className="space-y-1">
              {planillasAprobadas.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/20 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{p.usuario.apellido} {p.usuario.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.usuario.legajo && `Legajo ${p.usuario.legajo} · `}
                      {Number(p.totalHorasNormales).toFixed(0)}h normales
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewPlanillaId(p.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border border-border"
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const res = await api.get(`/export/planilla/${p.id}`, { responseType: 'blob' });
                          const url = window.URL.createObjectURL(new Blob([res.data]));
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `planilla_${p.usuario.apellido}.csv`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch { /* noop */ }
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border border-border"
                    >
                      <Download className="h-3 w-3" /> CSV
                    </button>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-400">APROBADA</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Pendientes Modal (from export 409) ─── */}
      {showPendientesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" /> Planillas pendientes
              </h2>
              <button onClick={() => setShowPendientesModal(false)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                <p className="text-sm text-amber-400">
                  Hay <strong>{pendientesInfo?.totalPendientes ?? pendientes.length}</strong> usuario(s) sin planilla aprobada.
                  {pendientesInfo?.totalAprobadas != null && (
                    <> Se exportarán <strong>{pendientesInfo.totalAprobadas}</strong> planilla(s) aprobadas.</>
                  )}
                </p>
              </div>

              <div className="space-y-1 max-h-60 overflow-y-auto">
                {pendientes.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/20 text-sm">
                    <div>
                      <span className="font-medium">{u.apellido} {u.nombre}</span>
                      {u.legajo && <span className="text-muted-foreground ml-2">· Legajo {u.legajo}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{u.sector}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-border">
                <button
                  onClick={() => setShowPendientesModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors border border-border"
                >
                  Volver
                </button>
                <button
                  onClick={() => handleExport(true)}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Exportar de todas formas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Recibo Preview Modal ─── */}
      {previewPlanillaId && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-400" /> Recibo de Sueldo (Preview)
              </h2>
              <button onClick={() => setPreviewPlanillaId(null)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Empleado</p>
                  <p className="text-sm font-medium">{preview.usuario.apellido} {preview.usuario.nombre}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Categoría</p>
                  <p className="text-sm font-medium">{preview.usuario.categoria ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Período</p>
                  <p className="text-sm">{new Date(preview.periodo.inicio).toLocaleDateString('es-AR')} — {new Date(preview.periodo.fin).toLocaleDateString('es-AR')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Convenio</p>
                  <p className="text-sm">{preview.usuario.convenio ?? '—'}</p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/20 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">HORAS</p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Normales:</span> <span className="font-mono font-bold">{preview.horas.normales.toFixed(1)}</span></div>
                  <div><span className="text-amber-400">E50%:</span> <span className="font-mono font-bold">{preview.horas.extra50.toFixed(1)}</span></div>
                  <div><span className="text-red-400">E100%:</span> <span className="font-mono font-bold">{preview.horas.extra100.toFixed(1)}</span></div>
                  <div><span className="text-muted-foreground">Viaje:</span> <span className="font-mono">{preview.horas.viaje.toFixed(1)}</span></div>
                  <div><span className="text-emerald-400">Campo:</span> <span className="font-mono">{preview.horas.diasCampo}d</span></div>
                  <div><span className="text-blue-400">Base:</span> <span className="font-mono">{preview.horas.diasBase}d</span></div>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">HABERES</p>
                <div className="space-y-1">
                  {preview.conceptos.map((c, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className={cn(c.esRemunerativo ? 'text-foreground' : 'text-blue-400')}>{c.nombre}</span>
                      <span className="font-mono">${fmt(c.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">RETENCIONES</p>
                <div className="space-y-1">
                  {preview.retenciones.map((r, i) => (
                    <div key={i} className="flex justify-between text-sm py-1 text-red-400">
                      <span>{r.nombre}</span>
                      <span className="font-mono">-${fmt(r.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Remunerativo</span>
                  <span className="font-mono">${fmt(preview.totales.remunerativo)}</span>
                </div>
                {preview.totales.noRemunerativo > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">No Remunerativo</span>
                    <span className="font-mono">${fmt(preview.totales.noRemunerativo)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Bruto</span>
                  <span className="font-mono">${fmt(preview.totales.bruto)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-400">Retenciones</span>
                  <span className="font-mono text-red-400">-${fmt(preview.totales.retenciones)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-border">
                  <span className="text-emerald-400">NETO A COBRAR</span>
                  <span className="font-mono text-emerald-400">${fmt(preview.totales.neto)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
