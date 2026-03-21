import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  Lock, FileText, Loader2, CheckCircle2,
  DollarSign, Download, Eye
} from 'lucide-react';

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
  usuario: { nombre: string; apellido: string; legajo: string };
  totalHorasNormales: string;
  periodoInicio: string;
  periodoFin: string;
}

export default function CierrePage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [selectedSector, setSelectedSector] = useState('');
  const [previewPlanillaId, setPreviewPlanillaId] = useState<string | null>(null);

  const isRRHH = ['RRHH', 'ADMIN'].includes(user?.rol ?? '');

  // Get the current period (21st of previous month to 20th of current month)
  const now = new Date();
  const periodoFin = new Date(now.getFullYear(), now.getMonth(), 20);
  const periodoInicio = new Date(periodoFin.getFullYear(), periodoFin.getMonth() - 1, 21);

  const { data: sectores = [] } = useQuery<Sector[]>({
    queryKey: ['sectores-cierre'],
    queryFn: async () => (await api.get('/admin/sectores')).data,
    enabled: isRRHH,
  });

  const { data: planillasAprobadas = [], isLoading } = useQuery<Planilla[]>({
    queryKey: ['planillas-aprobadas'],
    queryFn: async () => {
      const res = await api.get('/planillas');
      return res.data.filter((p: Planilla) => p.estado === 'APROBADA');
    },
    enabled: isRRHH,
  });

  const cierreMutation = useMutation({
    mutationFn: async () => {
      return (await api.post('/exportaciones/cierre', {
        periodoInicio: periodoInicio.toISOString(),
        periodoFin: periodoFin.toISOString(),
        sectorId: selectedSector || undefined,
      })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planillas-aprobadas'] });
    },
  });

  const { data: preview } = useQuery<ReciboPreview>({
    queryKey: ['recibo-preview', previewPlanillaId],
    queryFn: async () => (await api.get(`/recibos/preview/${previewPlanillaId}`)).data,
    enabled: !!previewPlanillaId,
  });

  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!isRRHH) {
    return (
      <div className="text-center py-12">
        <Lock className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-muted-foreground">Requiere rol RRHH o ADMIN</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Lock className="h-6 w-6 text-amber-400" /> Cierre de Período
        </h1>
        <p className="text-sm text-muted-foreground">
          Período: {periodoInicio.toLocaleDateString('es-AR')} — {periodoFin.toLocaleDateString('es-AR')}
        </p>
      </div>

      {/* Sector filter */}
      <div className="flex gap-3 items-center">
        <select
          className="h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm"
          value={selectedSector}
          onChange={(e) => setSelectedSector(e.target.value)}
        >
          <option value="">Todos los sectores</option>
          {sectores.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>

      {/* Planillas list */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            Planillas aprobadas ({planillasAprobadas.length})
          </h2>
          {planillasAprobadas.length > 0 && (
            <button
              onClick={() => {
                if (confirm(`¿Cerrar ${planillasAprobadas.length} planilla(s) y generar recibos?`)) {
                  cierreMutation.mutate();
                }
              }}
              disabled={cierreMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {cierreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Cerrar período
            </button>
          )}
        </div>

        {cierreMutation.isSuccess && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-400">
                Período cerrado: {(cierreMutation.data as { planillasCerradas: number }).planillasCerradas} planillas
              </p>
              <p className="text-xs text-muted-foreground">
                {(cierreMutation.data as { recibosCreados: number }).recibosCreados} recibos generados
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
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

      {/* Recibo Preview Modal */}
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
              {/* Header info */}
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

              {/* Horas */}
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

              {/* Conceptos */}
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

              {/* Retenciones */}
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

              {/* Totales */}
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
