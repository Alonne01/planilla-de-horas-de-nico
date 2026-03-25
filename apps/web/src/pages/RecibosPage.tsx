import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import {
  FileText, CheckCircle2, Clock, Loader2, Eye, PenLine,
  AlertCircle, Search, ThumbsUp, ThumbsDown, X, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SignaturePad from '@/components/SignaturePad';

interface Recibo {
  id: string;
  planillaId: string;
  usuarioId: string;
  pdfUrl: string | null;
  firmadoEmpleadoAt: string | null;
  conforme: boolean | null;
  observacionFirma: string | null;
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
  const [firmaStep, setFirmaStep] = useState<'choice' | 'observacion' | 'firma'>('choice');
  const [firmaConforme, setFirmaConforme] = useState<boolean | null>(null);
  const [firmaObservacion, setFirmaObservacion] = useState('');

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

  // Sign recibo with conforme/desconforme
  const firmarMutation = useMutation({
    mutationFn: ({ reciboId, firmaImg, conforme, observacion }: { reciboId: string; firmaImg?: string; conforme: boolean; observacion?: string }) =>
      api.post(`/recibos/${reciboId}/firmar`, { firmaImg, conforme, observacion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recibos'] });
      queryClient.invalidateQueries({ queryKey: ['recibo-detail'] });
      closeFirmaModal();
    },
  });

  function openFirmaModal(reciboId: string) {
    setConfirmFirma(reciboId);
    setFirmaStep('choice');
    setFirmaConforme(null);
    setFirmaObservacion('');
  }

  function closeFirmaModal() {
    setConfirmFirma(null);
    setFirmaStep('choice');
    setFirmaConforme(null);
    setFirmaObservacion('');
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  function generateReciboPDF(snap: ReciboPreview, recibo: Recibo) {
    import('jspdf').then(({ jsPDF }) => {
      import('jspdf-autotable').then(({ default: autoTable }) => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();

        // Header
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('RECIBO DE SUELDO', pageWidth / 2, 18, { align: 'center' });

        doc.setDrawColor(45, 95, 138);
        doc.setLineWidth(0.5);
        doc.line(14, 22, pageWidth - 14, 22);

        // Employee info
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Empleado:', 14, 30);
        doc.setFont('helvetica', 'normal');
        doc.text(`${snap.usuario.apellido}, ${snap.usuario.nombre}`, 42, 30);

        doc.setFont('helvetica', 'bold');
        doc.text('Legajo:', 14, 36);
        doc.setFont('helvetica', 'normal');
        doc.text(snap.usuario.legajo || '—', 32, 36);

        doc.setFont('helvetica', 'bold');
        doc.text('Categoría:', 80, 30);
        doc.setFont('helvetica', 'normal');
        doc.text(snap.usuario.categoria || '—', 104, 30);

        doc.setFont('helvetica', 'bold');
        doc.text('Convenio:', 80, 36);
        doc.setFont('helvetica', 'normal');
        doc.text(snap.usuario.convenio || '—', 102, 36);

        // Period
        const periodoStr = `${new Date(snap.periodo.inicio).toLocaleDateString('es-AR')} — ${new Date(snap.periodo.fin).toLocaleDateString('es-AR')}`;
        doc.setFont('helvetica', 'bold');
        doc.text('Período:', 14, 43);
        doc.setFont('helvetica', 'normal');
        doc.text(periodoStr, 35, 43);

        doc.setDrawColor(200);
        doc.line(14, 47, pageWidth - 14, 47);

        // Conceptos / Haberes table
        const conceptosBody = snap.conceptos.map((c) => [
          c.codigo,
          c.nombre,
          c.esRemunerativo ? 'REM' : 'NO REM',
          fmtMoney(c.monto),
        ]);

        autoTable(doc, {
          startY: 50,
          head: [['Código', 'Concepto', 'Tipo', 'Monto']],
          body: conceptosBody,
          theme: 'striped',
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [45, 95, 138], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 25 },
            3: { halign: 'right', cellWidth: 35 },
          },
          margin: { left: 14, right: 14 },
        });

        let nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 100;
        nextY += 4;

        // Retenciones table
        if (snap.retenciones && snap.retenciones.length > 0) {
          const retencionesBody = snap.retenciones.map((r) => [
            r.codigo,
            r.nombre,
            `-${fmtMoney(r.monto)}`,
          ]);

          autoTable(doc, {
            startY: nextY,
            head: [['Código', 'Retención', 'Monto']],
            body: retencionesBody,
            theme: 'striped',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [160, 50, 50], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
              0: { cellWidth: 25 },
              2: { halign: 'right', cellWidth: 35 },
            },
            margin: { left: 14, right: 14 },
          });

          nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? nextY + 30;
          nextY += 6;
        }

        // Totals section
        if (snap.totales) {
          doc.setFillColor(240, 240, 240);
          doc.rect(14, nextY, pageWidth - 28, 36, 'F');
          doc.setDrawColor(45, 95, 138);
          doc.setLineWidth(0.3);
          doc.rect(14, nextY, pageWidth - 28, 36, 'S');

          const leftCol = 20;
          const rightCol = pageWidth - 20;
          let ty = nextY + 7;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.text('Remunerativo:', leftCol, ty);
          doc.text(fmtMoney(snap.totales.remunerativo), rightCol, ty, { align: 'right' });
          ty += 6;

          doc.text('No Remunerativo:', leftCol, ty);
          doc.text(fmtMoney(snap.totales.noRemunerativo), rightCol, ty, { align: 'right' });
          ty += 6;

          doc.text('Retenciones:', leftCol, ty);
          doc.setTextColor(180, 40, 40);
          doc.text(`-${fmtMoney(snap.totales.retenciones)}`, rightCol, ty, { align: 'right' });
          doc.setTextColor(0);
          ty += 2;

          doc.setDrawColor(100);
          doc.line(leftCol, ty, rightCol, ty);
          ty += 6;

          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.text('NETO:', leftCol, ty);
          doc.text(fmtMoney(snap.totales.neto), rightCol, ty, { align: 'right' });

          nextY += 42;
        }

        // Signature status
        if (recibo.firmadoEmpleadoAt) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'italic');
          const sigText = recibo.conforme === true ? 'Firmado — Conforme'
            : recibo.conforme === false ? 'Firmado — Disconforme'
            : 'Firmado';
          doc.text(`${sigText} el ${new Date(recibo.firmadoEmpleadoAt).toLocaleString('es-AR')}`, 14, nextY);
          if (recibo.conforme === false && recibo.observacionFirma) {
            nextY += 5;
            doc.text(`Motivo: ${recibo.observacionFirma}`, 14, nextY);
          }
          nextY += 8;
        }

        // Generated date
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130);
        doc.text(`Generado: ${new Date(recibo.createdAt).toLocaleString('es-AR')} — Descargado: ${new Date().toLocaleString('es-AR')}`, 14, nextY);
        doc.setTextColor(0);

        // File name
        const apellido = (snap.usuario.apellido || 'empleado').replace(/\s+/g, '_');
        const legajo = snap.usuario.legajo || 'sin_legajo';
        const pInicio = new Date(snap.periodo.inicio).toISOString().slice(0, 10);
        doc.save(`recibo_${apellido}_${legajo}_${pInicio}.pdf`);
      });
    });
  }

  async function handleDownloadFromList(recibo: Recibo) {
    const snap = recibo.planilla.snapshotCalculo as unknown as ReciboPreview | null;
    if (snap?.conceptos) {
      generateReciboPDF(snap, recibo);
      return;
    }
    // Fetch detail to get snapshotCalculo
    setDownloadingId(recibo.id);
    try {
      const res = await api.get(`/recibos/detalle/${recibo.id}`);
      const detail = res.data as Recibo;
      const detailSnap = detail.planilla.snapshotCalculo as unknown as ReciboPreview | null;
      if (detailSnap?.conceptos) {
        generateReciboPDF(detailSnap, detail);
      }
    } finally {
      setDownloadingId(null);
    }
  }

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
                    r.conforme === false ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/15 text-red-400 text-[10px] font-medium">
                        <ThumbsDown className="h-3 w-3" /> Disconforme
                      </span>
                    ) : r.conforme === true ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-400 text-[10px] font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Conforme
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 text-blue-400 text-[10px] font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Firmado
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 text-[10px] font-medium">
                      <AlertCircle className="h-3 w-3" /> Pendiente
                    </span>
                  )}
                  <button
                    onClick={() => handleDownloadFromList(r)}
                    disabled={downloadingId === r.id}
                    className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
                    title="Descargar PDF"
                  >
                    {downloadingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </button>
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
                reciboDetail.firmadoEmpleadoAt
                  ? reciboDetail.conforme === false
                    ? 'bg-red-500/10 border border-red-500/30'
                    : reciboDetail.conforme === true
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-blue-500/10 border border-blue-500/30'
                  : 'bg-amber-500/10 border border-amber-500/30'
              )}>
                {reciboDetail.firmadoEmpleadoAt ? (
                  <>
                    {reciboDetail.conforme === false ? (
                      <ThumbsDown className="h-6 w-6 mx-auto text-red-400 mb-1" />
                    ) : (
                      <CheckCircle2 className={cn('h-6 w-6 mx-auto mb-1', reciboDetail.conforme === true ? 'text-emerald-400' : 'text-blue-400')} />
                    )}
                    <p className={cn('text-sm font-medium',
                      reciboDetail.conforme === false ? 'text-red-400'
                        : reciboDetail.conforme === true ? 'text-emerald-400'
                        : 'text-blue-400'
                    )}>
                      {reciboDetail.conforme === false ? 'Firmado — Disconforme'
                        : reciboDetail.conforme === true ? 'Firmado — Conforme'
                        : 'Firmado'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(reciboDetail.firmadoEmpleadoAt).toLocaleString('es-AR')}
                    </p>
                    {reciboDetail.conforme === false && reciboDetail.observacionFirma && (
                      <div className="mt-2 p-2 rounded-md bg-red-500/10 text-left">
                        <p className="text-[10px] font-medium text-red-400 mb-0.5">Motivo de disconformidad:</p>
                        <p className="text-xs text-red-300">{reciboDetail.observacionFirma}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <PenLine className="h-6 w-6 mx-auto text-amber-400 mb-1" />
                    <p className="text-sm font-medium text-amber-400">Pendiente de firma</p>
                    {reciboDetail.usuarioId === user?.id && (
                      <button
                        onClick={() => openFirmaModal(reciboDetail.id)}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <PenLine className="h-4 w-4" /> Firmar Recibo
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Download PDF button */}
              {reciboDetail.planilla.snapshotCalculo && (() => {
                const snap = reciboDetail.planilla.snapshotCalculo as unknown as ReciboPreview;
                if (!snap.conceptos) return null;
                return (
                  <button
                    onClick={() => generateReciboPDF(snap, reciboDetail)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/15 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Descargar PDF
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Confirm firma modal — multi-step: choice → observacion (if desconforme) → signature */}
      {confirmFirma && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Firma de recibo</h3>
              <button onClick={closeFirmaModal} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Step 1: Conforme / Desconforme choice */}
            {firmaStep === 'choice' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  ¿Estás conforme con el contenido de este recibo de sueldo?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setFirmaConforme(true); setFirmaStep('firma'); }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors"
                  >
                    <ThumbsUp className="h-8 w-8 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Conforme</span>
                  </button>
                  <button
                    onClick={() => { setFirmaConforme(false); setFirmaStep('observacion'); }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-red-500/30 bg-red-500/5 hover:bg-red-500/15 transition-colors"
                  >
                    <ThumbsDown className="h-8 w-8 text-red-400" />
                    <span className="text-sm font-medium text-red-400">Disconforme</span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Observación (only for desconforme) */}
            {firmaStep === 'observacion' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Indicá el motivo de tu disconformidad:
                </p>
                <textarea
                  value={firmaObservacion}
                  onChange={(e) => setFirmaObservacion(e.target.value)}
                  placeholder="Describí el motivo..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setFirmaStep('choice')}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => setFirmaStep('firma')}
                    disabled={!firmaObservacion.trim()}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    Continuar a firma
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Signature pad */}
            {firmaStep === 'firma' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {firmaConforme
                    ? 'Dibujá tu firma para confirmar que estás conforme con el recibo.'
                    : 'Dibujá tu firma para dejar constancia de tu disconformidad.'
                  }
                  {' '}Esta acción no se puede deshacer.
                </p>
                {!firmaConforme && firmaObservacion && (
                  <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20">
                    <p className="text-[10px] font-medium text-red-400 mb-0.5">Motivo:</p>
                    <p className="text-xs text-red-300">{firmaObservacion}</p>
                  </div>
                )}
                <SignaturePad
                  width={Math.min(440, window.innerWidth - 80)}
                  height={180}
                  onCancel={() => setFirmaStep(firmaConforme ? 'choice' : 'observacion')}
                  onSave={(dataUrl) => firmarMutation.mutate({
                    reciboId: confirmFirma,
                    firmaImg: dataUrl,
                    conforme: firmaConforme!,
                    observacion: firmaConforme ? undefined : firmaObservacion,
                  })}
                />
                {firmarMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Firmando...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
