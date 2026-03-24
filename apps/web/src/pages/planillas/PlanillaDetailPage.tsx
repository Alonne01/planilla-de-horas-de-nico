import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Loader2,
  Clock, MapPin, Car, Moon, AlertCircle, AlertTriangle, X, Download, CalendarClock, Lock, Zap, Printer
} from 'lucide-react';
import { ESTADO_STYLES, ESTADO_LABELS } from '@/constants/planillaConstants';
import {
  dateKey, buildArgHolidays, buildDiasNoLaborables,
  esDiaFranco, buildCalendarDays, buildWeeks,
  type DiagramaInfo,
} from '@/utils/planillaHelpers';
import SuccessOverlay from '@/components/planilla/SuccessOverlay';
import DrumTimePicker from '@/components/planilla/DrumTimePicker';
import MiniCard from '@/components/planilla/MiniCard';
import { useDialogStore } from '@/stores/dialogStore';

interface Registro {
  id: string;
  fecha: string;
  entradaTurno1: string | null;
  salidaTurno1: string | null;
  entradaTurno2: string | null;
  salidaTurno2: string | null;
  lugarTrabajo: string | null;
  pernocte: string;
  maneja: boolean;
  distanciaViaje?: string | null;
  horasViajeInput: string;
  esFeriado: boolean;
  esFrancoTrabajado: boolean;
  esFrancoCompensatorio: boolean;
  horasTrabajadas: string;
  horasNormales: string;
  horasExtra50: string;
  horasExtra100: string;
  horasViajeCalc: string;
  observaciones: string | null;
  bloqueado: boolean;
  motivoBloqueo: string | null;
}

interface PlanillaDetalle {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  estado: string;
  pasoActual: number;
  totalHorasNormales: string;
  totalHorasExtra50: string;
  totalHorasExtra100: string;
  totalHorasViaje: string;
  totalDiasCampo: number;
  totalDiasBase: number;
  obsRechazo: string | null;
  registros: Registro[];
  usuario: {
    id: string;
    nombre: string;
    apellido: string;
    legajo: string | null;
    sector: { nombre: string } | null;
    categoria: { codigo: string; nombre: string } | null;
    diagramas: { diagrama: { nombre: string } }[];
  };
  flujo?: {
    nombre: string;
    pasos: { orden: number; rolAprobador: string; nombrePaso: string }[];
  } | null;
}

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function PlanillaDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const dialog = useDialogStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [showRechazo, setShowRechazo] = useState(false);
  const [showConfirmApproval, setShowConfirmApproval] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [applyingDiagram, setApplyingDiagram] = useState(false);
  const [quickFilling, setQuickFilling] = useState(false);
  const [diasFaltantes, setDiasFaltantes] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const handleSuccessDone = useCallback(() => setShowSuccess(false), []);

  // Form state for the day editor
  const [formData, setFormData] = useState({
    entradaTurno1: '07:00',
    salidaTurno1: '15:00',
    lugarTrabajo: 'CAMPO',
    pernocte: 'NO',
    viaje: false,
    distanciaViaje: '' as string,
    maneja: false,
    horasViajeInput: '0',
    esFeriado: false,
    esNoLaborable: false,
    esFrancoTrabajado: false,
    esFrancoCompensatorio: false,
    observaciones: '',
  });

  const LAST_DEFAULTS_KEY = 'planilla-last-defaults';

  const { data: planilla, isLoading, isError, error } = useQuery<PlanillaDetalle>({
    queryKey: ['planilla', id],
    queryFn: async () => (await api.get(`/planillas/${id}`)).data,
    retry: 1,
  });

  // Load owner's diagram assignment for cycle calculation
  const { data: usuarioDetalle } = useQuery({
    queryKey: ['usuario-detail-planilla', planilla?.usuario.id],
    queryFn: async () => (await api.get(`/usuarios/${planilla!.usuario.id}`)).data,
    enabled: !!planilla?.usuario.id,
    staleTime: 60_000,
  });

  const diagramaActual: DiagramaInfo | null = usuarioDetalle?.diagramaActual ?? null;
  const fechaInicioDiagrama: Date | null = usuarioDetalle?.diagramaFechaInicio
    ? new Date(usuarioDetalle.diagramaFechaInicio)
    : null;

  const enviarMutation = useMutation({
    mutationFn: () => api.post(`/planillas/${id}/enviar`),
    onSuccess: () => {
      setDiasFaltantes([]);
      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      queryClient.invalidateQueries({ queryKey: ['aprobaciones'] });
    },
    onError: (err: any) => {
      if (err.response?.status === 400 && err.response?.data?.diasFaltantes) {
        setDiasFaltantes(err.response.data.diasFaltantes);
      }
    },
  });

  const avanzarMutation = useMutation({
    mutationFn: () => api.post(`/planillas/${id}/avanzar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      queryClient.invalidateQueries({ queryKey: ['aprobaciones'] });
    },
  });

  const rechazarMutation = useMutation({
    mutationFn: (motivo: string) => api.post(`/planillas/${id}/rechazar`, { motivo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      queryClient.invalidateQueries({ queryKey: ['aprobaciones'] });
      setShowRechazo(false);
    },
  });

  const saveRegistroMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const existingReg = registroMap[selectedDate!];
      if (existingReg) {
        return api.put(`/planillas/${id}/registros/${existingReg.id}`, data);
      }
      return api.post(`/planillas/${id}/registros`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      setSelectedDate(null);
    },
  });

  const deleteRegistroMutation = useMutation({
    mutationFn: (rid: string) => api.delete(`/planillas/${id}/registros/${rid}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      setSelectedDate(null);
    },
  });

  // Build registro lookup map
  const registroMap = useMemo(() => {
    const map: Record<string, Registro> = {};
    if (planilla) {
      for (const r of planilla.registros) {
        const d = new Date(r.fecha);
        map[dateKey(d)] = r;
      }
    }
    return map;
  }, [planilla]);

  // Build calendar
  const weeks = useMemo((): (Date | null)[][] => {
    if (!planilla) return [];
    const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
    return buildWeeks(days);
  }, [planilla]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !planilla) {
    const status = (error as any)?.response?.status;
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-muted-foreground">
          {status === 403 ? 'No tenés permisos para ver esta planilla' :
           status === 404 ? 'Planilla no encontrada' :
           'Error al cargar la planilla'}
        </p>
        <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
          ← Volver
        </button>
      </div>
    );
  }

  const isOwner = planilla.usuario.id === user?.id;
  const canEdit = isOwner && (planilla.estado === 'BORRADOR' || planilla.estado === 'RECHAZADA');
  const canSend = canEdit && planilla.registros.length > 0;
  // canApprove: true only if this user's role matches the current approval step,
  // or RRHH/ADMIN (nivel >= 90) who can approve any step
  const currentStep = planilla.flujo?.pasos.find(p => p.orden === planilla.pasoActual);
  const userNivel = user?.rolNivel ?? 0;
  const canApprove = !isOwner &&
    !!currentStep &&
    (currentStep.rolAprobador === user?.rol || userNivel >= 90) &&
    (planilla.estado === 'ENVIADA' || planilla.estado === 'EN_REVISION');
  const totalHoras = Number(planilla.totalHorasNormales) + Number(planilla.totalHorasExtra50) + Number(planilla.totalHorasExtra100);

  /** Check if a date is a franco day according to the user's current diagram */
  function isFranco(day: Date): boolean {
    if (!diagramaActual || !fechaInicioDiagrama) return false;
    return esDiaFranco(day, diagramaActual, fechaInicioDiagrama);
  }

  /**
   * Apply diagram to all days in the planilla period:
   * - Work days without registro: create with saved defaults + observaciones
   * - Franco days with existing registro: mark esFrancoTrabajado = true
   * - Holidays and blocked days: skip
   */
  async function handleApplyDiagram() {
    if (!diagramaActual || !fechaInicioDiagrama || !planilla) return;
    setApplyingDiagram(true);
    try {
      // Load last saved defaults for creating work day registros
      let lastEntry = '07:00';
      let lastExit = '15:00';
      let lastLugar = 'CAMPO';
      let lastPernocte = 'NO';
      try {
        const saved = JSON.parse(localStorage.getItem(LAST_DEFAULTS_KEY) || '{}');
        if (saved.entrada) lastEntry = saved.entrada;
        if (saved.salida) lastExit = saved.salida;
        if (saved.lugarTrabajo) lastLugar = saved.lugarTrabajo;
        if (saved.pernocte) lastPernocte = saved.pernocte;
      } catch { /* ignore */ }

      const diagramaLabel = diagramaActual.nombre
        ? `Diagrama ${diagramaActual.nombre}`
        : diagramaActual.tipo === 'ROTATIVO'
          ? `Diagrama ${diagramaActual.diasTrabajo}×${diagramaActual.diasDescanso}`
          : 'Diagrama fijo semanal';
      const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
      const promises: Promise<unknown>[] = [];

      for (const day of days) {
        const key = dateKey(day);
        const reg = registroMap[key];
        const franco = isFranco(day);

        if (franco && reg && !reg.esFrancoTrabajado) {
          // Existing registro on a franco day → mark as franco trabajado
          promises.push(api.put(`/planillas/${id}/registros/${reg.id}`, {
            fecha: reg.fecha,
            entradaTurno1: reg.entradaTurno1,
            salidaTurno1: reg.salidaTurno1,
            entradaTurno2: reg.entradaTurno2 ?? null,
            salidaTurno2: reg.salidaTurno2 ?? null,
            lugarTrabajo: reg.lugarTrabajo,
            pernocte: reg.pernocte,
            maneja: reg.maneja,
            horasViajeInput: Number(reg.horasViajeInput) || 0,
            esFeriado: reg.esFeriado,
            esFrancoCompensatorio: reg.esFrancoCompensatorio,
            esFrancoTrabajado: true,
            distanciaViaje: reg.distanciaViaje ?? null,
            observaciones: reg.observaciones || `Franco trabajado — ${diagramaLabel}`,
          }));
        } else if (!franco && !reg) {
          // Work day without registro → create with defaults
          const y = day.getFullYear();
          const holidays = buildArgHolidays(y);
          if (holidays.has(key)) continue;

          const [h1, m1] = lastEntry.split(':').map(Number);
          const [h2, m2] = lastExit.split(':').map(Number);

          promises.push(api.post(`/planillas/${id}/registros`, {
            fecha: new Date(y, day.getMonth(), day.getDate(), 12, 0, 0).toISOString(),
            entradaTurno1: new Date(y, day.getMonth(), day.getDate(), h1, m1, 0).toISOString(),
            salidaTurno1: new Date(y, day.getMonth(), day.getDate(), h2, m2, 0).toISOString(),
            entradaTurno2: null,
            salidaTurno2: null,
            lugarTrabajo: lastLugar,
            pernocte: lastPernocte,
            maneja: false,
            horasViajeInput: 0,
            distanciaViaje: null,
            esFeriado: false,
            esFrancoTrabajado: false,
            esFrancoCompensatorio: false,
            observaciones: `Jornada normal — ${diagramaLabel}`,
          }));
        }
      }
      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
    } finally {
      setApplyingDiagram(false);
    }
  }

  /**
   * Quick-fill all working days that don't have a registro yet.
   * Uses the last saved defaults (hours, location, pernocte).
   * Skips: franco days, feriados, days already with a registro, blocked days.
   */
  async function handleQuickFill() {
    if (!planilla) return;
    setQuickFilling(true);
    try {
      let lastEntry = '07:00';
      let lastExit = '15:00';
      let lastLugar = 'CAMPO';
      let lastPernocte = 'NO';
      try {
        const saved = JSON.parse(localStorage.getItem(LAST_DEFAULTS_KEY) || '{}');
        if (saved.entrada) lastEntry = saved.entrada;
        if (saved.salida) lastExit = saved.salida;
        if (saved.lugarTrabajo) lastLugar = saved.lugarTrabajo;
        if (saved.pernocte) lastPernocte = saved.pernocte;
      } catch { /* ignore */ }

      const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
      const promises: Promise<unknown>[] = [];

      for (const day of days) {
        const key = dateKey(day);
        const reg = registroMap[key];
        // Skip if already has a registro
        if (reg) continue;
        // Skip franco days
        const franco = isFranco(day);
        if (franco) continue;
        // Skip feriados
        const y = day.getFullYear();
        const holidays = buildArgHolidays(y);
        if (holidays.has(key)) continue;

        const [h1, m1] = lastEntry.split(':').map(Number);
        const [h2, m2] = lastExit.split(':').map(Number);

        promises.push(api.post(`/planillas/${id}/registros`, {
          fecha: new Date(y, day.getMonth(), day.getDate(), 12, 0, 0).toISOString(),
          entradaTurno1: new Date(y, day.getMonth(), day.getDate(), h1, m1, 0).toISOString(),
          salidaTurno1: new Date(y, day.getMonth(), day.getDate(), h2, m2, 0).toISOString(),
          entradaTurno2: null,
          salidaTurno2: null,
          lugarTrabajo: lastLugar,
          pernocte: lastPernocte,
          maneja: false,
          horasViajeInput: 0,
          distanciaViaje: null,
          esFeriado: false,
          esFrancoTrabajado: false,
          esFrancoCompensatorio: false,
          observaciones: 'Jornada normal',
        }));
      }
      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
    } finally {
      setQuickFilling(false);
    }
  }

  function handleExportPDF() {
    if (!planilla) return;
    import('jspdf').then(({ jsPDF }) => {
      import('jspdf-autotable').then(({ default: autoTable }) => {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();

        // Header
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Planilla de Horas', 14, 15);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const periodoStr = `${new Date(planilla.periodoInicio).toLocaleDateString('es-AR')} — ${new Date(planilla.periodoFin).toLocaleDateString('es-AR')}`;
        doc.text(`Empleado: ${planilla.usuario.apellido.toUpperCase()} ${planilla.usuario.nombre.toUpperCase()}`, 14, 22);
        doc.text(`Legajo: ${planilla.usuario.legajo || '—'}`, 14, 27);
        doc.text(`Sector: ${planilla.usuario.sector?.nombre || '—'}`, 80, 22);
        doc.text(`Categoría: ${planilla.usuario.categoria?.codigo || '—'}`, 80, 27);
        doc.text(`Período: ${periodoStr}`, 160, 22);
        doc.text(`Diagrama: ${planilla.usuario.diagramas[0]?.diagrama?.nombre || '—'}`, 160, 27);

        // Table data
        const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
        const fmtT = (iso: string | null) => {
          if (!iso) return '';
          const d = new Date(iso);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        };

        const bodyRows = days.map((d) => {
          const key = dateKey(d);
          const r = registroMap[key];
          if (!r) return [d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }), '', '', '', '', '', '', '', '', '', '', ''];

          const hsTrabajadas = Number(r.horasNormales) + Number(r.horasExtra50) + Number(r.horasExtra100);
          const lugar = r.bloqueado ? (r.motivoBloqueo ?? 'AUS') : (r.lugarTrabajo === 'CAMPO' ? 'Campo' : r.lugarTrabajo === 'BASE' ? 'Base' : r.lugarTrabajo ?? '');

          return [
            d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
            fmtT(r.entradaTurno1),
            fmtT(r.salidaTurno1),
            hsTrabajadas > 0 ? hsTrabajadas.toFixed(1) : '',
            Number(r.horasNormales) > 0 ? Number(r.horasNormales).toFixed(1) : '',
            Number(r.horasExtra50) > 0 ? Number(r.horasExtra50).toFixed(1) : '',
            Number(r.horasExtra100) > 0 ? Number(r.horasExtra100).toFixed(1) : '',
            Number(r.horasViajeCalc) > 0 ? Number(r.horasViajeCalc).toFixed(1) : '',
            lugar,
            r.pernocte !== 'NO' ? r.pernocte : '',
            r.maneja ? 'Sí' : '',
            r.bloqueado ? (r.motivoBloqueo ?? '') : (r.observaciones ?? ''),
          ];
        });

        // Totals row
        bodyRows.push([
          'TOTALES', '', '',
          (Number(planilla.totalHorasNormales) + Number(planilla.totalHorasExtra50) + Number(planilla.totalHorasExtra100)).toFixed(1),
          Number(planilla.totalHorasNormales).toFixed(1),
          Number(planilla.totalHorasExtra50).toFixed(1),
          Number(planilla.totalHorasExtra100).toFixed(1),
          Number(planilla.totalHorasViaje).toFixed(1),
          `C:${planilla.totalDiasCampo} B:${planilla.totalDiasBase}`,
          '', '', '',
        ]);

        autoTable(doc, {
          startY: 32,
          head: [['Día', 'Entró', 'Salió', 'Hs Trab.', 'Normal', 'E50%', 'E100%', 'Viaje', 'Lugar', 'Pernoc.', 'Maneja', 'Observaciones']],
          body: bodyRows,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.5, halign: 'center', valign: 'middle' },
          headStyles: { fillColor: [45, 95, 138], textColor: 255, fontSize: 7, fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 22 },
            11: { cellWidth: 40, halign: 'left' },
          },
          didParseCell: (data: any) => {
            if (data.row.index === bodyRows.length - 1) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [230, 230, 230];
            }
          },
          margin: { left: 14, right: 14 },
        });

        // Signature area
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 180;
        const sigY = Math.min(finalY + 15, doc.internal.pageSize.getHeight() - 20);
        doc.setDrawColor(80);
        doc.line(14, sigY, 80, sigY);
        doc.line(120, sigY, 186, sigY);
        doc.line(pageWidth - 80, sigY, pageWidth - 14, sigY);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text('Firma del Trabajador', 47, sigY + 4, { align: 'center' });
        doc.text('Firma del Supervisor', 153, sigY + 4, { align: 'center' });
        doc.text('Firma RRHH', pageWidth - 47, sigY + 4, { align: 'center' });

        doc.save(`Planilla de horas ${planilla.usuario.apellido} ${planilla.usuario.nombre}.pdf`);
      });
    });
  }

  function openDay(key: string) {
    const [y, m, d] = key.split('-').map(Number);
    const dayDate = new Date(y, m - 1, d, 12, 0, 0);
    const holidays = buildArgHolidays(y);
    const noLaborables = buildDiasNoLaborables(y);
    const autoFeriado = holidays.has(key);
    const autoNoLaborable = noLaborables.has(key);
    const autoFranco = isFranco(dayDate);

    const existing = registroMap[key];
    if (existing) {
      const fmtTime = (iso: string | null) => {
        if (!iso) return '';
        return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      };
      setFormData({
        entradaTurno1: fmtTime(existing.entradaTurno1) || '07:00',
        salidaTurno1: fmtTime(existing.salidaTurno1) || '15:00',
        lugarTrabajo: existing.lugarTrabajo || 'CAMPO',
        pernocte: existing.pernocte || 'NO',
        maneja: existing.maneja,
        horasViajeInput: existing.horasViajeInput || '0',
        viaje: parseFloat(existing.horasViajeInput || '0') > 0,
        distanciaViaje: existing.distanciaViaje || '',
        esFeriado: existing.esFeriado || autoFeriado,
        esNoLaborable: autoNoLaborable,
        esFrancoTrabajado: existing.esFrancoTrabajado,
        esFrancoCompensatorio: existing.esFrancoCompensatorio,
        observaciones: existing.observaciones || '',
      });
    } else {
      // Remember last used defaults (times + location)
      let lastEntry = '07:00';
      let lastExit = '15:00';
      let lastLugar = 'CAMPO';
      let lastPernocte = 'NO';
      try {
        const saved = JSON.parse(localStorage.getItem(LAST_DEFAULTS_KEY) || '{}');
        if (saved.entrada) lastEntry = saved.entrada;
        if (saved.salida) lastExit = saved.salida;
        if (saved.lugarTrabajo) lastLugar = saved.lugarTrabajo;
        if (saved.pernocte) lastPernocte = saved.pernocte;
      } catch { /* ignore */ }
      setFormData({
        entradaTurno1: lastEntry, salidaTurno1: lastExit,
        lugarTrabajo: lastLugar, pernocte: lastPernocte,
        viaje: false, distanciaViaje: '', maneja: false, horasViajeInput: '0',
        esFeriado: autoFeriado,
        esNoLaborable: autoNoLaborable,
        esFrancoTrabajado: autoFranco,
        esFrancoCompensatorio: false, observaciones: '',
      });
    }
    setSelectedDate(key);
  }

  function handleSaveDay() {
    const [y, m, d] = selectedDate!.split('-').map(Number);
    const fecha = new Date(y, m - 1, d, 12, 0, 0);

    const toIso = (time: string) => {
      if (!time) return null;
      const [h, min] = time.split(':').map(Number);
      return new Date(y, m - 1, d, h, min, 0).toISOString();
    };

    // Save last used defaults for next entry (skip if franco compensatorio)
    if (!formData.esFrancoCompensatorio) {
      try {
        localStorage.setItem(LAST_DEFAULTS_KEY, JSON.stringify({
          entrada: formData.entradaTurno1,
          salida: formData.salidaTurno1,
          lugarTrabajo: formData.lugarTrabajo,
          pernocte: formData.pernocte,
        }));
      } catch { /* ignore */ }
    }

    saveRegistroMutation.mutate({
      fecha: fecha.toISOString(),
      entradaTurno1: toIso(formData.entradaTurno1),
      salidaTurno1: toIso(formData.salidaTurno1),
      entradaTurno2: null,
      salidaTurno2: null,
      lugarTrabajo: formData.esFrancoCompensatorio ? 'FRANCO' : formData.lugarTrabajo,
      pernocte: formData.pernocte,
      maneja: formData.maneja,
      horasViajeInput: formData.esFrancoCompensatorio || !formData.viaje ? 0 : (parseFloat(formData.horasViajeInput) || 0),
      distanciaViaje: formData.viaje ? formData.distanciaViaje : null,
      esFeriado: formData.esFeriado,
      esFrancoTrabajado: formData.esFrancoTrabajado,
      esFrancoCompensatorio: formData.esFrancoCompensatorio,
      observaciones: formData.observaciones || null,
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/planillas')} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">
              {planilla.usuario.apellido}, {planilla.usuario.nombre}
            </h1>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_STYLES[planilla.estado])}>
              {ESTADO_LABELS[planilla.estado]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {new Date(planilla.periodoInicio).toLocaleDateString('es-AR')} — {new Date(planilla.periodoFin).toLocaleDateString('es-AR')}
            {planilla.usuario.sector && ` • ${planilla.usuario.sector.nombre}`}
            {planilla.usuario.categoria && ` • ${planilla.usuario.categoria.codigo}`}
          </p>
        </div>
      </div>

      {/* Rejection notice */}
      {planilla.obsRechazo && (
        <div className="rounded-xl border border-cal-red/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-cal-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-cal-red">Rechazada</p>
            <p className="text-sm text-muted-foreground">{planilla.obsRechazo}</p>
          </div>
        </div>
      )}

      {/* Missing days warning banner */}
      {diasFaltantes.length > 0 && (
        <div className="rounded-xl border border-cal-red/30 bg-red-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-cal-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-cal-red">
              Faltan completar {diasFaltantes.length} día(s) para enviar la planilla
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Los días incompletos están marcados en rojo. Completá todos los días del período antes de enviar.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <MiniCard label="Total" value={totalHoras.toFixed(1)} color="text-primary" />
        <MiniCard label="Normales" value={Number(planilla.totalHorasNormales).toFixed(1)} />
        <MiniCard label="E50%" value={Number(planilla.totalHorasExtra50).toFixed(1)} color="text-cal-amber" />
        <MiniCard label="E100%" value={Number(planilla.totalHorasExtra100).toFixed(1)} color="text-cal-red" />
        <MiniCard label="Viaje" value={Number(planilla.totalHorasViaje).toFixed(1)} color="text-cal-blue" />
        <MiniCard label="Campo/Base" value={`${planilla.totalDiasCampo}/${planilla.totalDiasBase}`} color="text-cal-emerald" />
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2 flex-wrap">
        {canSend && (
          <button onClick={() => enviarMutation.mutate()} disabled={enviarMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {enviarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        )}
        {canApprove && (
          <>
            <button onClick={() => setShowConfirmApproval(true)} disabled={avanzarMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {avanzarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aprobar
            </button>
            <button onClick={() => setShowRechazo(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
              <XCircle className="h-4 w-4" /> Rechazar
            </button>
          </>
        )}
        {/* Apply diagram button: only shown when user has a diagram assigned and planilla is editable */}
        {canEdit && diagramaActual && (
          <button
            onClick={handleApplyDiagram}
            disabled={applyingDiagram}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/40 text-primary bg-primary/5 text-sm font-medium hover:bg-primary/10 disabled:opacity-50 transition-colors"
            title="Marca los registros cargados en días de franco como 'Franco trabajado'"
          >
            {applyingDiagram ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Aplicar diagrama
          </button>
        )}
        {canEdit && (
          <button
            onClick={handleQuickFill}
            disabled={quickFilling}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-cal-amber/40 text-cal-amber bg-amber-500/5 text-sm font-medium hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
            title="Llena todos los días laborables vacíos con el último horario usado"
          >
            {quickFilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Llenar días laborables
          </button>
        )}
        <button onClick={async () => {
            try { const res = await api.get(`/export/planilla/${id}`, { responseType: 'blob' }); const url = window.URL.createObjectURL(new Blob([res.data])); const a = document.createElement('a'); a.href = url; a.download = `planilla_${planilla.usuario.apellido}.xlsx`; a.click(); window.URL.revokeObjectURL(url); } catch { /* noop */ }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
          <Download className="h-4 w-4" /> Excel
        </button>
        <button onClick={handleExportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
          <Printer className="h-4 w-4" /> PDF
        </button>
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* ── CALENDAR GRID (21→20) ──────────────────── */}
      {/* ══════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 bg-muted/30 border-b border-border/60">
          {DOW_LABELS.map((d, i) => (
            <div key={d} className={cn(
              'py-2.5 text-center text-[11px] font-semibold uppercase tracking-widest',
              i >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground',
            )}>
              {d}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-border/40 border-b border-border/40 last:border-b-0">
            {week.map((day, di) => {
              if (!day) {
                return <div key={di} className="min-h-[90px] bg-muted/5" />;
              }
              const key = dateKey(day);
              const reg = registroMap[key];
              const isToday = key === dateKey(new Date());
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const hrs = reg ? Number(reg.horasTrabajadas) : 0;
              const hasData = !!reg;
              const francoDay = isFranco(day);
              const isLocked = reg?.bloqueado === true;
              const isFaltante = diasFaltantes.includes(key);
              const isFeriado = buildArgHolidays(day.getFullYear()).has(key);
              const isNoLaborable = buildDiasNoLaborables(day.getFullYear()).has(key);

              return (
                <button
                  key={di}
                  onClick={() => isLocked ? undefined : (canEdit ? openDay(key) : (hasData ? openDay(key) : undefined))}
                  className={cn(
                    'min-h-[90px] p-2 text-left transition-all duration-150 relative group',
                    'hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:z-10',
                    isLocked && 'bg-violet-500/8 cursor-not-allowed hover:bg-violet-500/8',
                    !isLocked && francoDay && !hasData && 'bg-orange-500/[0.03]',
                    !isLocked && isWeekend && !hasData && !francoDay && 'bg-muted/8',
                    isToday && 'ring-2 ring-inset ring-primary/50 bg-primary/[0.03]',
                    isFaltante && 'border-l-[3px] border-l-red-500/80 bg-red-500/[0.04]',
                  )}
                >
                  {/* Day number + badges row */}
                  <div className="flex items-start justify-between gap-0.5">
                    <span className={cn(
                      'text-[13px] font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors',
                      isToday && 'bg-primary text-primary-foreground shadow-sm',
                      !isToday && reg?.esFeriado && 'text-cal-red',
                      !isToday && reg?.esFrancoTrabajado && 'text-cal-amber',
                      !isToday && !reg?.esFeriado && !reg?.esFrancoTrabajado && 'text-foreground/80',
                    )}>
                      {day.getDate()}
                    </span>
                    <div className="flex items-center gap-0.5 flex-wrap justify-end">
                      {francoDay && (
                        <span className={cn(
                          'text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full',
                          reg?.esFrancoTrabajado
                            ? 'bg-amber-500/20 text-cal-amber'
                            : 'bg-orange-500/15 text-cal-orange',
                        )}>
                          {reg?.esFrancoTrabajado ? 'FT' : 'F'}
                        </span>
                      )}
                      {reg?.lugarTrabajo && !reg?.esFrancoCompensatorio && (
                        <span className={cn(
                          'text-[8px] font-semibold leading-none px-1.5 py-0.5 rounded-full',
                          reg.lugarTrabajo === 'CAMPO' ? 'bg-emerald-500/15 text-cal-emerald' : 'bg-blue-500/15 text-cal-blue',
                        )}>
                          {reg.lugarTrabajo === 'CAMPO' ? 'C' : 'B'}
                        </span>
                      )}
                      {reg?.esFrancoCompensatorio && (
                        <span className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-blue-500/15 text-cal-blue">
                          CC
                        </span>
                      )}
                      {isFeriado && (
                        <span className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-red-500/15 text-cal-red">
                          FE
                        </span>
                      )}
                      {isNoLaborable && !isFeriado && (
                        <span className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-amber-500/15 text-cal-amber">
                          NL
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hour data */}
                  {hasData && !isLocked && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[15px] font-bold text-foreground leading-none tracking-tight">{hrs.toFixed(1)}<span className="text-[11px] font-medium text-muted-foreground ml-0.5">h</span></p>
                      <div className="flex gap-1 flex-wrap">
                        {Number(reg.horasNormales) > 0 && (
                          <span className="text-[9px] font-medium px-1 py-px rounded bg-muted/40 text-muted-foreground">{Number(reg.horasNormales).toFixed(0)}N</span>
                        )}
                        {Number(reg.horasExtra50) > 0 && (
                          <span className="text-[9px] font-medium px-1 py-px rounded bg-amber-500/10 text-cal-amber">{Number(reg.horasExtra50).toFixed(0)}E50</span>
                        )}
                        {Number(reg.horasExtra100) > 0 && (
                          <span className="text-[9px] font-medium px-1 py-px rounded bg-red-500/10 text-cal-red">{Number(reg.horasExtra100).toFixed(0)}E100</span>
                        )}
                      </div>
                      {reg.maneja && <Car className="h-3 w-3 text-muted-foreground/40 mt-0.5" />}
                    </div>
                  )}

                  {/* Locked day (ausencia/vacación) */}
                  {isLocked && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Lock className="h-3 w-3 text-cal-violet/80" />
                        <span className="text-[10px] font-semibold text-cal-violet leading-tight">
                          {reg.motivoBloqueo === 'VACACION' ? 'Vacaciones'
                            : reg.motivoBloqueo === 'CERTIFICADO_MEDICO' ? 'Cert. Médico'
                            : reg.motivoBloqueo === 'FALTA_JUSTIFICADA' ? 'Falta Just.'
                            : reg.motivoBloqueo === 'FALTA_INJUSTIFICADA' ? 'Falta Inj.'
                            : reg.motivoBloqueo === 'LICENCIA_ESPECIAL' ? 'Licencia'
                            : reg.motivoBloqueo ?? 'Ausencia'}
                        </span>
                      </div>
                      {reg.observaciones && (
                        <p className="text-[8px] text-muted-foreground/70 leading-tight truncate max-w-full">
                          {reg.observaciones}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Empty day indicator */}
                  {!hasData && canEdit && (
                    <div className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <span className="text-[10px] text-muted-foreground/40 font-medium">+ agregar</span>
                    </div>
                  )}

                  {/* Missing day badge */}
                  {isFaltante && (
                    <div className="absolute bottom-1.5 left-2">
                      <span className="text-[8px] font-bold text-cal-red/90">⚠ Incompleto</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* ── DAY EDITOR MODAL ─────────────────────── */}
      {/* ══════════════════════════════════════════════ */}
      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedDate(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h2>
              <button onClick={() => setSelectedDate(null)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Locked day notice */}
              {registroMap[selectedDate]?.bloqueado && (
                <div className="rounded-lg border border-cal-violet/30 bg-violet-500/10 p-4 text-center space-y-1">
                  <Lock className="h-6 w-6 mx-auto text-cal-violet" />
                  <p className="text-sm font-semibold text-cal-violet">Día bloqueado</p>
                  <p className="text-xs text-muted-foreground">
                    {registroMap[selectedDate].observaciones ?? registroMap[selectedDate].motivoBloqueo ?? 'Ausencia / Vacación'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-2">Este día no se puede modificar.</p>
                  {registroMap[selectedDate]?.motivoBloqueo === 'FRANCO_COMPENSATORIO' && user && (user.rolNivel ?? 0) >= 60 && (
                    <button
                      onClick={async () => {
                        try {
                          await api.patch(`/planillas/${id}/registros/${registroMap[selectedDate]!.id}/compensatorio`, { activar: false });
                          queryClient.invalidateQueries({ queryKey: ['planilla', id] });
                          setSelectedDate(null);
                        } catch { /* ignore */ }
                      }}
                      className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                    >
                      Revocar compensatorio
                    </button>
                  )}
                </div>
              )}

              {/* Time pickers */}
              {!registroMap[selectedDate]?.bloqueado && (<>
              {/* Quick-copy from previous day */}
              {canEdit && (() => {
                const [y, m, d] = selectedDate.split('-').map(Number);
                const prev = new Date(y, m - 1, d - 1, 12, 0, 0);
                const prevKey = dateKey(prev);
                const prevReg = registroMap[prevKey];
                if (!prevReg || prevReg.bloqueado || prevReg.esFrancoCompensatorio) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const fmtTime = (iso: string | null) => {
                        if (!iso) return '';
                        const d = new Date(iso);
                        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                      };
                      setFormData({
                        ...formData,
                        entradaTurno1: fmtTime(prevReg.entradaTurno1) || formData.entradaTurno1,
                        salidaTurno1: fmtTime(prevReg.salidaTurno1) || formData.salidaTurno1,
                        lugarTrabajo: prevReg.lugarTrabajo || formData.lugarTrabajo,
                        pernocte: prevReg.pernocte || formData.pernocte,
                        maneja: prevReg.maneja,
                        horasViajeInput: prevReg.horasViajeInput || '0',
                        viaje: parseFloat(prevReg.horasViajeInput || '0') > 0,
                        distanciaViaje: prevReg.distanciaViaje || '',
                      });
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-cal-blue/30 text-cal-blue bg-blue-500/5 text-xs font-medium hover:bg-blue-500/10 transition-colors"
                  >
                    📋 Copiar día anterior ({prev.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })})
                  </button>
                );
              })()}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Entrada</label>
                  <DrumTimePicker
                    value={formData.entradaTurno1}
                    onChange={(v) => setFormData({ ...formData, entradaTurno1: v })}
                    disabled={!canEdit || formData.esFrancoCompensatorio}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">Salida</label>
                  <DrumTimePicker
                    value={formData.salidaTurno1}
                    onChange={(v) => setFormData({ ...formData, salidaTurno1: v })}
                    disabled={!canEdit || formData.esFrancoCompensatorio}
                  />
                </div>
              </div>

              {/* Lugar + Pernocte */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Lugar
                  </label>
                  <select value={formData.lugarTrabajo}
                    onChange={(e) => setFormData({ ...formData, lugarTrabajo: e.target.value })}
                    disabled={!canEdit}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-foreground text-sm">
                    <option value="CAMPO">Campo</option>
                    <option value="BASE">Base</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Moon className="h-3 w-3" /> Pernocte
                  </label>
                  <select value={formData.pernocte}
                    onChange={(e) => setFormData({ ...formData, pernocte: e.target.value })}
                    disabled={!canEdit}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-foreground text-sm">
                    <option value="NO">No</option>
                    <option value="HOTEL">Hotel</option>
                    <option value="TRAILER">Trailer</option>
                  </select>
                </div>
              </div>

              {/* Viaje */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.viaje}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData({
                        ...formData,
                        viaje: checked,
                        ...(!checked ? { distanciaViaje: '', horasViajeInput: '0', maneja: false } : {}),
                      });
                    }}
                    disabled={!canEdit || formData.esFrancoCompensatorio}
                    className="rounded border-input" />
                  <span className="text-sm flex items-center gap-1"><Car className="h-3 w-3" /> Viaje</span>
                </label>

                {formData.viaje && !formData.esFrancoCompensatorio && (
                  <div className="space-y-2 pl-6 border-l-2 border-primary/20">
                    {/* Distance */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Distancia</label>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { value: 'CORTA', label: '-250km', hours: '3' },
                          { value: 'MEDIA', label: '+350km', hours: '5' },
                          { value: 'LARGA', label: '+500km', hours: '' },
                        ].map((opt) => (
                          <button key={opt.value} type="button"
                            onClick={() => {
                              if (!canEdit) return;
                              setFormData({
                                ...formData,
                                distanciaViaje: opt.value,
                                horasViajeInput: opt.hours || formData.horasViajeInput,
                              });
                            }}
                            className={cn(
                              'px-2 py-1.5 rounded-lg border text-xs font-medium transition-all',
                              formData.distanciaViaje === opt.value
                                ? 'border-primary bg-primary/15 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/50',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Manual hours for +500km */}
                    {formData.distanciaViaje === 'LARGA' && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Horas de viaje</label>
                        <input type="number" step="0.5" min="0" max="24"
                          value={formData.horasViajeInput}
                          onChange={(e) => setFormData({ ...formData, horasViajeInput: e.target.value })}
                          disabled={!canEdit}
                          className="w-full h-9 px-2 rounded-lg border border-input bg-background text-foreground text-sm" />
                      </div>
                    )}

                    {/* Hours display for auto distances */}
                    {formData.distanciaViaje && formData.distanciaViaje !== 'LARGA' && (
                      <p className="text-xs text-muted-foreground">
                        Horas de viaje: <span className="font-bold text-foreground">{formData.horasViajeInput}h</span>
                      </p>
                    )}

                    {/* Maneja checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formData.maneja}
                        onChange={(e) => setFormData({ ...formData, maneja: e.target.checked })}
                        disabled={!canEdit}
                        className="rounded border-input" />
                      <span className="text-sm">Maneja</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Flags */}
              <div className="flex flex-wrap gap-3">
                {/* Feriado: auto-detected, read-only */}
                {formData.esFeriado && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-cal-red border border-cal-red/30">
                    🗓 Feriado
                  </span>
                )}

                {/* Día no laborable: auto-detected */}
                {formData.esNoLaborable && !formData.esFeriado && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-cal-amber border border-cal-amber/30">
                    📋 Día no laborable
                  </span>
                )}

                {/* Franco trabajado: read-only indicator (auto-set when opening a franco day) */}
                {formData.esFrancoTrabajado && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-cal-amber border border-cal-amber/30">
                    ⚡ Franco trabajado
                  </span>
                )}

                {/* Franco compensatorio: selectable, zeroes hours */}
                {canEdit && (() => {
                  const saved = selectedDate ? registroMap[selectedDate] : null;
                  const hasSavedWork = saved && !saved.esFrancoCompensatorio && (saved.entradaTurno1 || saved.salidaTurno1);
                  return hasSavedWork ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/30 text-muted-foreground border border-border">
                      Franco comp. no disponible (tiene horario)
                    </span>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formData.esFrancoCompensatorio}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          if (checked) {
                            setFormData({
                              ...formData,
                              esFrancoCompensatorio: true,
                              entradaTurno1: '00:00', salidaTurno1: '00:00',
                            });
                          } else {
                            let lastEntry = '07:00';
                            let lastExit = '15:00';
                            try {
                              const saved = JSON.parse(localStorage.getItem(LAST_DEFAULTS_KEY) || '{}');
                              if (saved.entrada) lastEntry = saved.entrada;
                              if (saved.salida) lastExit = saved.salida;
                            } catch { /* ignore */ }
                            setFormData({
                              ...formData,
                              esFrancoCompensatorio: false,
                              entradaTurno1: lastEntry, salidaTurno1: lastExit,
                            });
                          }
                        }}
                        className="rounded border-input" />
                      <span className="text-sm text-cal-blue">Franco comp.</span>
                    </label>
                  );
                })()}
                {!canEdit && formData.esFrancoCompensatorio && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-cal-blue border border-cal-blue/30">
                    Franco compensatorio
                  </span>
                )}
              </div>

              {/* Observaciones */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Observaciones</label>
                <textarea value={formData.observaciones}
                  onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                  disabled={!canEdit}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm resize-none" />
              </div>

              {/* Existing data summary (read-only view) */}
              {registroMap[selectedDate] && (
                <div className="rounded-lg bg-muted/20 p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">CÁLCULO</p>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Norm:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasNormales).toFixed(1)}</span></div>
                    <div><span className="text-cal-amber">E50:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasExtra50).toFixed(1)}</span></div>
                    <div><span className="text-cal-red">E100:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasExtra100).toFixed(1)}</span></div>
                    <div><span className="text-cal-blue">Viaje:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasViajeCalc).toFixed(1)}</span></div>
                  </div>
                </div>
              )}

              </>)}

              {/* Actions */}
              {canEdit && !registroMap[selectedDate]?.bloqueado && (
                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveDay}
                    disabled={saveRegistroMutation.isPending}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {saveRegistroMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {registroMap[selectedDate] ? 'Actualizar' : 'Guardar'}
                  </button>
                  {registroMap[selectedDate] && (
                    <button
                      onClick={async () => { if (await dialog.confirm({ message: '¿Eliminar este registro?', variant: 'danger' })) deleteRegistroMutation.mutate(registroMap[selectedDate].id); }}
                      className="px-4 py-2 rounded-lg border border-cal-red/30 text-cal-red text-sm font-medium hover:bg-red-500/10 transition-colors">
                      Eliminar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Approval confirmation modal ── */}
      {showConfirmApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl p-4 space-y-4">
            <h3 className="font-semibold text-cal-emerald">¿Confirmar aprobación?</h3>
            <p className="text-sm text-muted-foreground">
              Estás por aprobar esta planilla de <strong>{planilla.usuario.nombre} {planilla.usuario.apellido}</strong>.
              Una vez aprobada, la planilla no podrá ser editada por el empleado.
            </p>
            <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-lg border border-border hover:bg-muted/20 transition-colors">
              <input
                type="checkbox"
                checked={approvalChecked}
                onChange={(e) => setApprovalChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-emerald-500"
              />
              <span className="text-sm font-medium">
                Confirmo que revisé la planilla y es correcta
              </span>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowConfirmApproval(false); setApprovalChecked(false); }}
                className="px-4 py-2 rounded-lg border border-border text-sm">Cancelar</button>
              <button onClick={() => { setShowConfirmApproval(false); setApprovalChecked(false); avanzarMutation.mutate(); }}
                disabled={!approvalChecked || avanzarMutation.isPending}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {avanzarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aprobar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rechazo modal ── */}
      {showRechazo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl p-4 space-y-4">
            <h3 className="font-semibold">Motivo de rechazo</h3>
            <textarea value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)}
              rows={3} placeholder="Describí el motivo del rechazo..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRechazo(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm">Cancelar</button>
              <button onClick={() => rechazarMutation.mutate(motivoRechazo)}
                disabled={!motivoRechazo.trim() || rechazarMutation.isPending}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {rechazarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success animation overlay ── */}
      <SuccessOverlay show={showSuccess} onDone={handleSuccessDone} />
    </div>
  );
}

