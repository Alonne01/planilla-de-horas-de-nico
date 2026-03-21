import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import {
  FileText, CheckCircle2, Clock, Loader2, Eye, PenLine,
  AlertCircle, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SignaturePad from '@/components/SignaturePad';

interface Recibo {
  id: string;
  planillaId: string;
  usuarioId: string;
  pdfUrl: string | null;
  firmadoEmpleadoAt: string | null;
  createdAt: string;
  usuario?: { nombre: string; apellido: string; legajo: string | null };
  planilla: {
    periodoInicio: string;
    periodoFin: string;
    estado: string;
    snapshotCalculo: Record<string, unknown> | null;
  };
}

interface ReciboPreview {
  usuario: { nombre: string; apellido: string; legajo: string | null; categoria: string | null; convenio: string | null };
  periodo: { inicio: string; fin: string };
  horas: { normales: number; extra50: number; extra100: number; viaje: number; diasCampo: number; diasBase: number };
  conceptos: { codigo: string; nombre: string; tipo: string; monto: number; esRemunerativo: boolean }[];
  retenciones: { codigo: string; nombre: string; monto: number }[];
  totales: { remunerativo: number; noRemunerativo: number; bruto: number; retenciones: number; neto: number };
}

const fmtMoney = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtPeriodo = (ini: string, fin: string) => {
  const d1 = new Date(ini);
  const d2 = new Date(fin);
  return `${d1.getDate()}/${d1.getMonth() + 1} — ${d2.getDate()}/${d2.getMonth() + 1}/${d2.getFullYear()}`;
};

export default function RecibosPage() {
  const user = useAuthStore((s) => s.user);
  const isRRHH = (user?.rolNivel ?? 0) >= 90;
  const queryClient = useQueryClient();

  const [viewingRecibo, setViewingRecibo] = useState<string | null>(null);
  const [previewPlanillaId, setPreviewPlanillaId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFirmados, setFilterFirmados] = useState<'all' | 'firmados' | 'pendientes'>('all');
  const [confirmFirma, setConfirmFirma] = useState<string | null>(null);

  // Fetch recibos
  const { data: recibos = [], isLoading } = useQuery<Recibo[]>({
    queryKey: ['recibos', isRRHH ? 'all' : 'mine'],
    queryFn: async () => {
      const endpoint = isRRHH ? '/recibos' : '/recibos/mis-recibos';
      const res = await api.get(endpoint);
      return res.data;
    },
  });

  // Fetch preview
  const { data: preview, isLoading: previewLoading } = useQuery<ReciboPreview>({
    queryKey: ['recibo-preview', previewPlanillaId],
    queryFn: async () => {
      const res = await api.get(`/recibos/preview/${previewPlanillaId}`);
      return res.data;
    },
    enabled: !!previewPlanillaId,
  });

  // Fetch detail
  const { data: reciboDetail } = useQuery<Recibo>({
    queryKey: ['recibo-detail', viewingRecibo],
    queryFn: async () => {
      const res = await api.get(`/recibos/detalle/${viewingRecibo}`);
      return res.data;
    },
    enabled: !!viewingRecibo,
  });

  // Generate recibo
  const generarMutation = useMutation({
    mutationFn: (planillaId: string) => api.post(`/recibos/generar/${planillaId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recibos'] });
      setPreviewPlanillaId(null);
    },
  });

  // Sign recibo (with optional signature image)
  const firmarMutation = useMutation({
    mutationFn: ({ reciboId, firmaImg }: { reciboId: string; firmaImg?: string }) =>
      api.post(`/recibos/${reciboId}/firmar`, { firmaImg }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recibos'] });
      queryClient.invalidateQueries({ queryKey: ['recibo-detail'] });
      setConfirmFirma(null);
    },
  });

  // RRHH: Fetch planillas for generating recibos
  const { data: planillasAprobadas = [] } = useQuery({
    queryKey: ['planillas-para-recibos'],
    queryFn: async () => {
      const res = await api.get('/planillas?estado=APROBADA,CERRADA');
      return res.data;
    },
    enabled: isRRHH,
  });

  const filteredRecibos = recibos.filter((r) => {
    if (filterFirmados === 'firmados' && !r.firmadoEmpleadoAt) return false;
    if (filterFirmados === 'pendientes' && r.firmadoEmpleadoAt) return false;
    if (searchTerm && r.usuario) {
      const name = `${r.usuario.apellido} ${r.usuario.nombre} ${r.usuario.legajo || ''}`.toLowerCase();
      if (!name.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Recibos de Sueldo</h1>
        <p className="text-sm text-muted-foreground">
          {isRRHH ? 'Gestionar recibos de todos los empleados' : 'Mis recibos de sueldo'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {isRRHH && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar empleado..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background text-foreground text-sm"
            />
          </div>
        )}
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(['all', 'pendientes', 'firmados'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterFirmados(f)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                filterFirmados === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              )}
            >
              {f === 'all' ? 'Todos' : f === 'pendientes' ? 'Pendientes' : 'Firmados'}
            </button>
          ))}
        </div>
      </div>

      {/* Recibos list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {filteredRecibos.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No hay recibos disponibles</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRecibos.map((r) => (
              <div key={r.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                <div className={cn(
                  'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
                  r.firmadoEmpleadoAt ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                )}>
                  {r.firmadoEmpleadoAt ? <CheckCircle2 className="h-5 w-5" /> : <PenLine className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {r.usuario && (
                      <span className="font-medium text-sm">{r.usuario.apellido}, {r.usuario.nombre}</span>
                    )}
                    {!r.usuario && !isRRHH && (
                      <span className="font-medium text-sm">Mi recibo</span>
                    )}
                    {r.usuario?.legajo && (
                      <span className="text-xs text-muted-foreground">#{r.usuario.legajo}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{fmtPeriodo(r.planilla.periodoInicio, r.planilla.periodoFin)}</span>
                    <span>·</span>
                    <span>Generado {fmtDate(r.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.firmadoEmpleadoAt ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-400 text-[10px] font-medium">
                      <CheckCircle2 className="h-3 w-3" /> Firmado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 text-[10px] font-medium">
                      <AlertCircle className="h-3 w-3" /> Pendiente
                    </span>
                  )}
                  <button
                    onClick={() => setViewingRecibo(r.id)}
                    className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
                    title="Ver detalle"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RRHH: Generate new recibos */}
      {isRRHH && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Generar Recibos
          </h2>
          <p className="text-xs text-muted-foreground">
            Seleccioná una planilla aprobada/cerrada para previsualizar y generar su recibo.
          </p>
          {planillasAprobadas.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No hay planillas aprobadas disponibles.</p>
          ) : (
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {planillasAprobadas.slice(0, 20).map((p: Record<string, unknown>) => {
                const pid = p.id as string;
                const u = p.usuario as Record<string, unknown> | undefined;
                const hasRecibo = recibos.some((r) => r.planillaId === pid);
                return (
                  <div key={pid} className="flex items-center gap-3 p-2 rounded-lg border border-border/50">
                    <div className="flex-1 text-xs">
                      <span className="font-medium">{u ? `${u.apellido}, ${u.nombre}` : 'N/A'}</span>
                      <span className="text-muted-foreground ml-2">
                        {fmtPeriodo(p.periodoInicio as string, p.periodoFin as string)}
                      </span>
                    </div>
                    {hasRecibo ? (
                      <span className="text-[10px] text-emerald-400 font-medium">✓ Generado</span>
                    ) : (
                      <button
                        onClick={() => setPreviewPlanillaId(pid)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                      >
                        <Eye className="h-3 w-3" /> Previsualizar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewPlanillaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewPlanillaId(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Previsualización de Recibo
              </h3>
              <button onClick={() => setPreviewPlanillaId(null)} className="p-1 rounded-lg hover:bg-accent">✕</button>
            </div>
            {previewLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : preview ? (
              <div className="p-4 space-y-4">
                {/* Employee info */}
                <div className="rounded-lg bg-accent/30 p-3 text-sm">
                  <p className="font-medium">{preview.usuario.apellido}, {preview.usuario.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    Legajo: {preview.usuario.legajo || '—'} · Cat: {preview.usuario.categoria || '—'} · CCT: {preview.usuario.convenio || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Período: {fmtPeriodo(preview.periodo.inicio, preview.periodo.fin)}
                  </p>
                </div>

                {/* Hours summary */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Normales', value: `${preview.horas.normales}h` },
                    { label: 'Extra 50%', value: `${preview.horas.extra50}h` },
                    { label: 'Extra 100%', value: `${preview.horas.extra100}h` },
                    { label: 'Viaje', value: `${preview.horas.viaje}h` },
                    { label: 'Días Campo', value: preview.horas.diasCampo },
                    { label: 'Días Base', value: preview.horas.diasBase },
                  ].map((h) => (
                    <div key={h.label} className="rounded-lg border border-border p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">{h.label}</p>
                      <p className="text-sm font-semibold">{h.value}</p>
                    </div>
                  ))}
                </div>

                {/* Conceptos */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Haberes</h4>
                  <div className="space-y-1">
                    {preview.conceptos.map((c) => (
                      <div key={c.codigo} className="flex justify-between text-sm">
                        <span>{c.nombre}</span>
                        <span className="font-medium text-emerald-400">{fmtMoney(c.monto)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Retenciones */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Retenciones</h4>
                  <div className="space-y-1">
                    {preview.retenciones.map((r) => (
                      <div key={r.codigo} className="flex justify-between text-sm">
                        <span>{r.nombre}</span>
                        <span className="font-medium text-red-400">-{fmtMoney(r.monto)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Remunerativo</span><span>{fmtMoney(preview.totales.remunerativo)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">No Remunerativo</span><span>{fmtMoney(preview.totales.noRemunerativo)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Retenciones</span><span className="text-red-400">-{fmtMoney(preview.totales.retenciones)}</span>
                  </div>
                  <hr className="border-border" />
                  <div className="flex justify-between text-sm font-bold">
                    <span>NETO</span>
                    <span className="text-emerald-400">{fmtMoney(preview.totales.neto)}</span>
                  </div>
                </div>

                {/* Generate button */}
                <button
                  onClick={() => generarMutation.mutate(previewPlanillaId)}
                  disabled={generarMutation.isPending}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {generarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Generar Recibo
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* View recibo detail modal */}
      {viewingRecibo && reciboDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setViewingRecibo(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Detalle del Recibo
              </h3>
              <button onClick={() => setViewingRecibo(null)} className="p-1 rounded-lg hover:bg-accent">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-accent/30 p-3 text-sm">
                {reciboDetail.usuario && (
                  <p className="font-medium">{reciboDetail.usuario.apellido}, {reciboDetail.usuario.nombre}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Período: {fmtPeriodo(reciboDetail.planilla.periodoInicio, reciboDetail.planilla.periodoFin)}
                </p>
                <p className="text-xs text-muted-foreground">Generado: {fmtDate(reciboDetail.createdAt)}</p>
              </div>

              {/* Snapshot data if available */}
              {reciboDetail.planilla.snapshotCalculo && (() => {
                const snap = reciboDetail.planilla.snapshotCalculo as unknown as ReciboPreview;
                if (!snap.conceptos) return null;
                return (
                  <>
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Haberes</h4>
                      <div className="space-y-1">
                        {snap.conceptos.map((c: { codigo: string; nombre: string; monto: number }) => (
                          <div key={c.codigo} className="flex justify-between text-sm">
                            <span>{c.nombre}</span>
                            <span className="font-medium text-emerald-400">{fmtMoney(c.monto)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {snap.retenciones && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Retenciones</h4>
                        <div className="space-y-1">
                          {snap.retenciones.map((r: { codigo: string; nombre: string; monto: number }) => (
                            <div key={r.codigo} className="flex justify-between text-sm">
                              <span>{r.nombre}</span>
                              <span className="font-medium text-red-400">-{fmtMoney(r.monto)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {snap.totales && (
                      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
                        <div className="flex justify-between text-sm font-bold">
                          <span>NETO</span>
                          <span className="text-emerald-400">{fmtMoney(snap.totales.neto)}</span>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Signature status */}
              <div className={cn(
                'rounded-lg p-3 text-center',
                reciboDetail.firmadoEmpleadoAt ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'
              )}>
                {reciboDetail.firmadoEmpleadoAt ? (
                  <>
                    <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-400 mb-1" />
                    <p className="text-sm font-medium text-emerald-400">Firmado por el empleado</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(reciboDetail.firmadoEmpleadoAt).toLocaleString('es-AR')}
                    </p>
                  </>
                ) : (
                  <>
                    <PenLine className="h-6 w-6 mx-auto text-amber-400 mb-1" />
                    <p className="text-sm font-medium text-amber-400">Pendiente de firma</p>
                    {reciboDetail.usuarioId === user?.id && (
                      <button
                        onClick={() => setConfirmFirma(reciboDetail.id)}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <PenLine className="h-4 w-4" /> Firmar Recibo
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm firma modal with signature pad */}
      {confirmFirma && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl p-5 space-y-4">
            <h3 className="font-semibold text-emerald-400">Firma digital</h3>
            <p className="text-sm text-muted-foreground">
              Dibujá tu firma abajo para confirmar que revisaste el recibo y estás de acuerdo con su contenido.
              Esta acción no se puede deshacer.
            </p>
            <SignaturePad
              width={Math.min(440, window.innerWidth - 80)}
              height={180}
              onCancel={() => setConfirmFirma(null)}
              onSave={(dataUrl) => firmarMutation.mutate({ reciboId: confirmFirma, firmaImg: dataUrl })}
            />
            {firmarMutation.isPending && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Firmando...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
