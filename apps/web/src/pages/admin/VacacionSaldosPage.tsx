import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import {
  Palmtree, RefreshCw, Loader2, ChevronLeft, ChevronRight,
  Edit3, Check, X, Users, Search, Building2
} from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface SaldoRow {
  id: string;
  anio: number;
  diasCorrespondientes: number;
  diasUsados: number;
  diasPendientes: number;
  diasAjuste: number;
  compensatoriosAcumulados: number;
  compensatoriosUsados: number;
  compensatoriosPendientes: number;
  override: boolean;
  observaciones: string | null;
  usuario: {
    id: string;
    nombre: string;
    apellido: string;
    legajo: string | null;
    fechaIngreso: string;
    rol: string;
    sector?: { id: string; nombre: string } | null;
  };
}

interface Sector {
  id: string;
  nombre: string;
}

export default function VacacionSaldosPage() {
  const qc = useQueryClient();
  const dialog = useDialogStore();
  const currentYear = new Date().getFullYear();
  const [anio, setAnio] = useState(currentYear);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDias, setEditDias] = useState(0);
  const [editAjuste, setEditAjuste] = useState(0);
  const [editCompAcum, setEditCompAcum] = useState(0);
  const [editObs, setEditObs] = useState('');
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');

  const { data: saldos = [], isLoading } = useQuery<SaldoRow[]>({
    queryKey: ['vacacion-saldos', anio],
    queryFn: () => api.get(`/vacacion-saldos?anio=${anio}`).then(r => r.data),
  });

  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores'],
    queryFn: () => api.get('/analytics/sectores').then(r => r.data),
  });

  const generarMutation = useMutation({
    mutationFn: () => api.post('/vacacion-saldos/generar', { anio }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vacacion-saldos', anio] });
      dialog.alert({ title: 'Saldos generados', message: `Generados: ${res.data.created} nuevos, ${res.data.skipped} ya existían` });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.put(`/vacacion-saldos/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vacacion-saldos', anio] });
      setEditingId(null);
    },
  });

  function startEdit(s: SaldoRow) {
    setEditingId(s.id);
    setEditDias(s.diasCorrespondientes);
    setEditAjuste(s.diasAjuste);
    setEditCompAcum(s.compensatoriosAcumulados);
    setEditObs(s.observaciones || '');
  }

  function saveEdit(id: string) {
    updateMutation.mutate({
      id,
      data: {
        diasCorrespondientes: editDias,
        diasAjuste: editAjuste,
        compensatoriosAcumulados: editCompAcum,
        observaciones: editObs || null,
      },
    });
  }

  // Stats
  const filteredSaldos = useMemo(() => {
    let filtered = saldos;
    if (sectorFilter) {
      filtered = filtered.filter(s => s.usuario.sector?.id === sectorFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(s =>
        `${s.usuario.apellido} ${s.usuario.nombre}`.toLowerCase().includes(q) ||
        s.usuario.legajo?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [saldos, sectorFilter, search]);

  const stats = useMemo(() => {
    const total = filteredSaldos.length;
    const totalDias = filteredSaldos.reduce((s, r) => s + r.diasCorrespondientes + r.diasAjuste, 0);
    const totalUsados = filteredSaldos.reduce((s, r) => s + r.diasUsados, 0);
    const overrides = filteredSaldos.filter(r => r.override).length;
    const totalCompDisponibles = filteredSaldos.reduce((s, r) => s + r.compensatoriosAcumulados - r.compensatoriosUsados - r.compensatoriosPendientes, 0);
    return { total, totalDias, totalUsados, overrides, totalCompDisponibles };
  }, [filteredSaldos]);

  function getAntiguedad(fechaIngreso: string) {
    const ingreso = new Date(fechaIngreso);
    const now = new Date();
    let y = now.getFullYear() - ingreso.getFullYear();
    if (now < new Date(now.getFullYear(), ingreso.getMonth(), ingreso.getDate())) y--;
    return Math.max(0, y);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Palmtree className="h-6 w-6 text-emerald-400" />
          <h1 className="text-xl font-bold text-foreground">Saldos de Vacaciones</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Year selector */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-1">
            <button onClick={() => setAnio(a => a - 1)}
              className="p-1.5 hover:bg-accent rounded transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold w-12 text-center">{anio}</span>
            <button onClick={() => setAnio(a => a + 1)}
              className="p-1.5 hover:bg-accent rounded transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => generarMutation.mutate()}
            disabled={generarMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {generarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Generar saldos {anio}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-lg font-bold font-mono text-foreground">{stats.total}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Usuarios</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-lg font-bold font-mono text-emerald-400">{stats.totalDias}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Días totales</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-lg font-bold font-mono text-blue-400">{stats.totalUsados}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Usados</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-lg font-bold font-mono text-amber-400">{stats.overrides}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ajustados</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-lg font-bold font-mono text-purple-400">{stats.totalCompDisponibles}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Comp. Disp.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o legajo..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground"
          />
        </div>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="h-9 pl-9 pr-8 rounded-lg border border-input bg-background text-foreground text-sm appearance-none min-w-[180px]"
          >
            <option value="">Todos los sectores</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : filteredSaldos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{saldos.length > 0 ? 'No se encontraron resultados con los filtros actuales' : `No hay saldos generados para ${anio}`}</p>
          {saldos.length === 0 && <p className="text-xs mt-1">Hacé clic en "Generar saldos" para crear automáticamente</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Empleado</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Antigüedad</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Corresponden</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Ajuste</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Usados</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Pend.</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground text-emerald-400">Disponible</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Comp. Acum.</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Comp. Usados</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Comp. Pend.</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground text-purple-400">Comp. Disp.</th>
                  <th className="text-center px-3 py-3 font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredSaldos.map((s) => {
                  const total = s.diasCorrespondientes + s.diasAjuste;
                  const disponible = total - s.diasUsados - s.diasPendientes;
                  const isEditing = editingId === s.id;
                  const ant = getAntiguedad(s.usuario.fechaIngreso);

                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      {/* User info */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{s.usuario.apellido}, {s.usuario.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.usuario.legajo && `#${s.usuario.legajo} • `}
                          {s.usuario.sector?.nombre || s.usuario.rol}
                        </p>
                      </td>
                      {/* Seniority */}
                      <td className="text-center px-3 py-3">
                        <span className="text-xs">{ant} año{ant !== 1 ? 's' : ''}</span>
                      </td>
                      {/* Corresponden */}
                      <td className="text-center px-3 py-3">
                        {isEditing ? (
                          <input type="number" min="0" max="60"
                            value={editDias} onChange={(e) => setEditDias(parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-center rounded border border-input bg-background text-foreground text-sm"
                          />
                        ) : (
                          <span className={cn('font-mono font-bold', s.override && 'text-amber-400')}>
                            {s.diasCorrespondientes}
                          </span>
                        )}
                      </td>
                      {/* Ajuste */}
                      <td className="text-center px-3 py-3">
                        {isEditing ? (
                          <input type="number" min="-30" max="30"
                            value={editAjuste} onChange={(e) => setEditAjuste(parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-center rounded border border-input bg-background text-foreground text-sm"
                          />
                        ) : (
                          <span className={cn('font-mono text-xs', s.diasAjuste > 0 ? 'text-emerald-400' : s.diasAjuste < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                            {s.diasAjuste > 0 ? `+${s.diasAjuste}` : s.diasAjuste}
                          </span>
                        )}
                      </td>
                      {/* Usados */}
                      <td className="text-center px-3 py-3">
                        <span className="font-mono">{s.diasUsados}</span>
                      </td>
                      {/* Pendientes */}
                      <td className="text-center px-3 py-3">
                        <span className={cn('font-mono', s.diasPendientes > 0 && 'text-amber-400')}>
                          {s.diasPendientes}
                        </span>
                      </td>
                      {/* Disponible */}
                      <td className="text-center px-3 py-3">
                        <span className={cn('font-mono font-bold', disponible > 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {disponible}
                        </span>
                      </td>
                      {/* Comp. Acumulados */}
                      <td className="text-center px-3 py-3">
                        {isEditing ? (
                          <input type="number" min="0" max="365"
                            value={editCompAcum} onChange={(e) => setEditCompAcum(parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-center rounded border border-input bg-background text-foreground text-sm"
                          />
                        ) : (
                          <span className="font-mono">{s.compensatoriosAcumulados}</span>
                        )}
                      </td>
                      {/* Comp. Usados */}
                      <td className="text-center px-3 py-3">
                        <span className="font-mono">{s.compensatoriosUsados}</span>
                      </td>
                      {/* Comp. Pendientes */}
                      <td className="text-center px-3 py-3">
                        <span className={cn('font-mono', s.compensatoriosPendientes > 0 && 'text-amber-400')}>
                          {s.compensatoriosPendientes}
                        </span>
                      </td>
                      {/* Comp. Disponible */}
                      <td className="text-center px-3 py-3">
                        {(() => {
                          const compDisp = s.compensatoriosAcumulados - s.compensatoriosUsados - s.compensatoriosPendientes;
                          return (
                            <span className={cn('font-mono font-bold', compDisp > 0 ? 'text-purple-400' : 'text-muted-foreground')}>
                              {compDisp}
                            </span>
                          );
                        })()}
                      </td>
                      {/* Actions */}
                      <td className="text-center px-3 py-3">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => saveEdit(s.id)}
                              disabled={updateMutation.isPending}
                              className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400">
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(s)}
                            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            title="Ajustar días">
                            <Edit3 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
