import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Loader2,
  Clock, MapPin, Car, Moon, AlertCircle, AlertTriangle, X, Download, CalendarClock, Lock, Zap
} from 'lucide-react';

// ─── Argentine public holidays (fixed + movable approx.) ─────────────────────
function buildArgHolidays(year: number): Set<string> {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const fixed = [
    fmt(1,1), fmt(2,24), fmt(2,25), // Carnaval (approx – varies each year)
    fmt(3,24), fmt(4,2), fmt(5,1), fmt(5,25),
    fmt(6,20), fmt(7,9), fmt(8,17), fmt(10,12),
    fmt(11,20), fmt(12,8), fmt(12,25),
  ];
  // Easter-based (approx for several years)
  const easterOffsets: Record<number, [number,number]> = {
    2024:[3,29], 2025:[4,18], 2026:[4,3], 2027:[3,26], 2028:[4,14],
  };
  const easter = easterOffsets[year];
  if (easter) {
    const [em, ed] = easter;
    fixed.push(fmt(em, ed-2)); // Viernes Santo
    fixed.push(fmt(em, ed));   // Domingo Pascua
  }
  return new Set(fixed);
}

// Días no laborables: el empleador decide si se trabaja o no (distinto de feriado)
function buildDiasNoLaborables(year: number): Set<string> {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  // Easter-based
  const easterOffsets: Record<number, [number,number]> = {
    2024:[3,29], 2025:[4,18], 2026:[4,3], 2027:[3,26], 2028:[4,14],
  };
  const easter = easterOffsets[year];
  const dias = [
    fmt(3,23), // Puente día no laborable (previo al 24/3)
    fmt(12,24), // Nochebuena (no laborable desde mediodía)
    fmt(12,31), // Fin de año (no laborable desde mediodía)
  ];
  if (easter) {
    const [em, ed] = easter;
    dias.push(fmt(em, ed-1)); // Jueves Santo (no laborable)
  }
  return new Set(dias);
}

// ─── Diagrama types ───────────────────────────────
interface DiagramaInfo {
  id: string;
  tipo: string;
  diasTrabajo: number | null;
  diasDescanso: number | null;
  diasSemana: number[];
}

/**
 * Returns true if the given date falls on a REST (franco) day
 * based on the diagram cycle starting from fechaInicioDiagrama.
 *
 * ROTATIVO: cycles work days then rest days from the start date.
 * FIJO_SEMANA: days NOT in diasSemana (0=Sun..6=Sat) are rest days.
 */
function esDiaFranco(fecha: Date, diagrama: DiagramaInfo, fechaInicio: Date): boolean {
  if (diagrama.tipo === 'ROTATIVO') {
    const ciclo = (diagrama.diasTrabajo ?? 0) + (diagrama.diasDescanso ?? 0);
    if (ciclo === 0) return false;
    // Normalize both to midnight UTC using date-only arithmetic
    const msPerDay = 86400000;
    const startMs = Date.UTC(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate());
    const fechaMs = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const diffDias = Math.round((fechaMs - startMs) / msPerDay);
    const pos = ((diffDias % ciclo) + ciclo) % ciclo;
    return pos >= (diagrama.diasTrabajo ?? 0);
  }
  if (diagrama.tipo === 'FIJO_SEMANA') {
    return !diagrama.diasSemana.includes(fecha.getDay());
  }
  return false;
}

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
  };
}

const ESTADO_STYLES: Record<string, string> = {
  BORRADOR: 'bg-slate-500/20 text-slate-400',
  ENVIADA: 'bg-blue-500/20 text-blue-400',
  EN_REVISION: 'bg-amber-500/20 text-amber-400',
  APROBADA: 'bg-emerald-500/20 text-emerald-400',
  RECHAZADA: 'bg-red-500/20 text-red-400',
  CERRADA: 'bg-purple-500/20 text-purple-400',
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  EN_REVISION: 'En Revisión',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  CERRADA: 'Cerrada',
};

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Build all calendar days for a 21→20 period */
function buildCalendarDays(periodoInicio: string, periodoFin: string) {
  const start = new Date(periodoInicio);
  const end = new Date(periodoFin);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Group days into weeks (Mon=0 → Sun=6) */
function buildWeeks(days: Date[]) {
  const weeks: (Date | null)[][] = [];
  let currentWeek: (Date | null)[] = [];

  // Pad the first week with nulls for days before start
  const firstDow = (days[0].getDay() + 6) % 7; // Mon=0
  for (let i = 0; i < firstDow; i++) currentWeek.push(null);

  for (const d of days) {
    currentWeek.push(d);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Pad the last week with nulls
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return weeks;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlanillaDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [showRechazo, setShowRechazo] = useState(false);
  const [showConfirmApproval, setShowConfirmApproval] = useState(false);
  const [applyingDiagram, setApplyingDiagram] = useState(false);
  const [quickFilling, setQuickFilling] = useState(false);
  const [diasFaltantes, setDiasFaltantes] = useState<string[]>([]);

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

  const { data: planilla, isLoading } = useQuery<PlanillaDetalle>({
    queryKey: ['planilla', id],
    queryFn: async () => (await api.get(`/planillas/${id}`)).data,
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
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
    },
    onError: (err: any) => {
      if (err.response?.status === 400 && err.response?.data?.diasFaltantes) {
        setDiasFaltantes(err.response.data.diasFaltantes);
      }
    },
  });

  const avanzarMutation = useMutation({
    mutationFn: () => api.post(`/planillas/${id}/avanzar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planilla', id] }),
  });

  const rechazarMutation = useMutation({
    mutationFn: (motivo: string) => api.post(`/planillas/${id}/rechazar`, { motivo }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); setShowRechazo(false); },
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

  if (isLoading || !planilla) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isOwner = planilla.usuario.id === user?.id;
  const canEdit = isOwner && (planilla.estado === 'BORRADOR' || planilla.estado === 'RECHAZADA');
  const canSend = canEdit && planilla.registros.length > 0;
  const canApprove = ['COORDINADOR', 'RRHH', 'ADMIN'].includes(user?.rol ?? '') &&
    (planilla.estado === 'ENVIADA' || planilla.estado === 'EN_REVISION');
  const totalHoras = Number(planilla.totalHorasNormales) + Number(planilla.totalHorasExtra50) + Number(planilla.totalHorasExtra100);

  /** Check if a date is a franco day according to the user's current diagram */
  function isFranco(day: Date): boolean {
    if (!diagramaActual || !fechaInicioDiagrama) return false;
    return esDiaFranco(day, diagramaActual, fechaInicioDiagrama);
  }

  /**
   * Apply diagram to all days in the planilla period:
   * - Days that are 'work' days: skip (no auto-create, user fills them in)
   * - Days that already have a registro AND are franco: mark esFrancoTrabajado = true
   * - Days that are franco and have no registro: no action (we don't create empty franco records)
   * When user loads a day that is classified as franco, esFrancoTrabajado is pre-checked.
   */
  async function handleApplyDiagram() {
    if (!diagramaActual || !fechaInicioDiagrama || !planilla) return;
    setApplyingDiagram(true);
    try {
      const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
      const promises: Promise<unknown>[] = [];
      for (const day of days) {
        const key = dateKey(day);
        const reg = registroMap[key];
        const franco = isFranco(day);
        if (franco && reg && !reg.esFrancoTrabajado) {
          // Existing registro on a franco day → mark as franco trabajado
          promises.push(api.put(`/planillas/${id}/registros/${reg.id}`, {
            ...reg,
            fecha: reg.fecha,
            esFrancoTrabajado: true,
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
          observaciones: null,
        }));
      }
      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
    } finally {
      setQuickFilling(false);
    }
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
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Rechazada</p>
            <p className="text-sm text-muted-foreground">{planilla.obsRechazo}</p>
          </div>
        </div>
      )}

      {/* Missing days warning banner */}
      {diasFaltantes.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">
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
        <MiniCard label="E50%" value={Number(planilla.totalHorasExtra50).toFixed(1)} color="text-amber-400" />
        <MiniCard label="E100%" value={Number(planilla.totalHorasExtra100).toFixed(1)} color="text-red-400" />
        <MiniCard label="Viaje" value={Number(planilla.totalHorasViaje).toFixed(1)} color="text-blue-400" />
        <MiniCard label="Campo/Base" value={`${planilla.totalDiasCampo}/${planilla.totalDiasBase}`} color="text-emerald-400" />
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-500/40 text-amber-400 bg-amber-500/5 text-sm font-medium hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
            title="Llena todos los días laborables vacíos con el último horario usado"
          >
            {quickFilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Llenar días laborables
          </button>
        )}
        <button onClick={async () => {
            try { const res = await api.get(`/export/planilla/${id}`, { responseType: 'blob' }); const url = window.URL.createObjectURL(new Blob([res.data])); const a = document.createElement('a'); a.href = url; a.download = `planilla_${planilla.usuario.apellido}.csv`; a.click(); window.URL.revokeObjectURL(url); } catch { /* noop */ }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* ── CALENDAR GRID (21→20) ──────────────────── */}
      {/* ══════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-border">
          {DOW_LABELS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((day, di) => {
              if (!day) {
                return <div key={di} className="min-h-[80px] bg-muted/5" />;
              }
              const key = dateKey(day);
              const reg = registroMap[key];
              const isToday = key === dateKey(new Date());
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const hrs = reg ? Number(reg.horasTrabajadas) : 0;
              const hasData = !!reg;
              const francoDay = isFranco(day); // from diagram cycle
              const isLocked = reg?.bloqueado === true;
              const isFaltante = diasFaltantes.includes(key);
              const isFeriado = buildArgHolidays(day.getFullYear()).has(key);
              const isNoLaborable = buildDiasNoLaborables(day.getFullYear()).has(key);

              return (
                <button
                  key={di}
                  onClick={() => isLocked ? undefined : (canEdit ? openDay(key) : (hasData ? openDay(key) : undefined))}
                  className={cn(
                    'min-h-[80px] p-1.5 text-left transition-all relative group',
                    'hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:z-10',
                    isLocked && 'bg-violet-500/10 cursor-not-allowed hover:bg-violet-500/10',
                    !isLocked && francoDay && !hasData && 'bg-orange-500/5',
                    !isLocked && isWeekend && !hasData && !francoDay && 'bg-muted/10',
                    isToday && 'ring-1 ring-primary/40',
                    isFaltante && 'border-l-2 border-l-red-500 bg-red-500/5',
                  )}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full',
                      isToday && 'bg-primary text-primary-foreground',
                      reg?.esFeriado && 'text-red-400',
                      reg?.esFrancoTrabajado && 'text-amber-400',
                    )}>
                      {day.getDate()}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {/* Franco badge from diagram */}
                      {francoDay && (
                        <span className={cn(
                          'text-[8px] font-bold px-1 rounded',
                          reg?.esFrancoTrabajado
                            ? 'bg-amber-500/30 text-amber-400' // franco but worked
                            : 'bg-orange-500/20 text-orange-400', // franco, not worked
                        )}>
                          {reg?.esFrancoTrabajado ? 'FT' : 'F'}
                        </span>
                      )}
                      {reg?.lugarTrabajo && !reg?.esFrancoCompensatorio && (
                        <span className={cn(
                          'text-[9px] font-medium px-1 rounded',
                          reg.lugarTrabajo === 'CAMPO' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400',
                        )}>
                          {reg.lugarTrabajo === 'CAMPO' ? 'C' : 'B'}
                        </span>
                      )}
                      {reg?.esFrancoCompensatorio && (
                        <span className="text-[8px] font-bold px-1 rounded bg-blue-500/20 text-blue-400">
                          CC
                        </span>
                      )}
                      {isFeriado && (
                        <span className="text-[8px] font-bold px-1 rounded bg-red-500/20 text-red-400">
                          FE
                        </span>
                      )}
                      {isNoLaborable && !isFeriado && (
                        <span className="text-[8px] font-bold px-1 rounded bg-amber-500/20 text-amber-400">
                          NL
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hour data */}
                  {hasData && !isLocked && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-sm font-bold text-foreground leading-none">{hrs.toFixed(1)}h</p>
                      <div className="flex gap-1 flex-wrap">
                        {Number(reg.horasNormales) > 0 && (
                          <span className="text-[9px] text-muted-foreground">{Number(reg.horasNormales).toFixed(0)}N</span>
                        )}
                        {Number(reg.horasExtra50) > 0 && (
                          <span className="text-[9px] text-amber-400">{Number(reg.horasExtra50).toFixed(0)}E50</span>
                        )}
                        {Number(reg.horasExtra100) > 0 && (
                          <span className="text-[9px] text-red-400">{Number(reg.horasExtra100).toFixed(0)}E100</span>
                        )}
                      </div>
                      {reg.maneja && <Car className="h-3 w-3 text-muted-foreground/50" />}
                    </div>
                  )}

                  {/* Locked day (ausencia/vacación) */}
                  {isLocked && (
                    <div className="mt-1 space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Lock className="h-3 w-3 text-violet-400" />
                        <span className="text-[9px] font-semibold text-violet-400 leading-tight">
                          {reg.motivoBloqueo === 'VACACION' ? 'Vacaciones'
                            : reg.motivoBloqueo === 'CERTIFICADO_MEDICO' ? 'Cert. Médico'
                            : reg.motivoBloqueo === 'FALTA_JUSTIFICADA' ? 'Falta Just.'
                            : reg.motivoBloqueo === 'FALTA_INJUSTIFICADA' ? 'Falta Inj.'
                            : reg.motivoBloqueo === 'LICENCIA_ESPECIAL' ? 'Licencia'
                            : reg.motivoBloqueo ?? 'Ausencia'}
                        </span>
                      </div>
                      {reg.observaciones && (
                        <p className="text-[8px] text-muted-foreground leading-tight truncate max-w-full">
                          {reg.observaciones}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Empty day indicator for editable planillas */}
                  {!hasData && canEdit && (
                    <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-muted-foreground/50">+ agregar</span>
                    </div>
                  )}

                  {/* Missing day badge */}
                  {isFaltante && (
                    <div className="mt-1">
                      <span className="text-[8px] font-semibold text-red-400">⚠️ Incompleto</span>
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
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4 text-center space-y-1">
                  <Lock className="h-6 w-6 mx-auto text-violet-400" />
                  <p className="text-sm font-semibold text-violet-400">Día bloqueado</p>
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
                        return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
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
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/30 text-blue-400 bg-blue-500/5 text-xs font-medium hover:bg-blue-500/10 transition-colors"
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
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                    🗓 Feriado
                  </span>
                )}

                {/* Día no laborable: auto-detected */}
                {formData.esNoLaborable && !formData.esFeriado && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    📋 Día no laborable
                  </span>
                )}

                {/* Franco trabajado: read-only indicator (auto-set when opening a franco day) */}
                {formData.esFrancoTrabajado && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    ⚡ Franco trabajado
                  </span>
                )}

                {/* Franco compensatorio: selectable, zeroes hours */}
                {canEdit && (
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
                          // Restore last used defaults
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
                    <span className="text-sm text-blue-400">Franco comp.</span>
                  </label>
                )}
                {!canEdit && formData.esFrancoCompensatorio && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
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
                    <div><span className="text-amber-400">E50:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasExtra50).toFixed(1)}</span></div>
                    <div><span className="text-red-400">E100:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasExtra100).toFixed(1)}</span></div>
                    <div><span className="text-blue-400">Viaje:</span> <span className="font-mono font-bold">{Number(registroMap[selectedDate].horasViajeCalc).toFixed(1)}</span></div>
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
                      onClick={() => { if (confirm('¿Eliminar este registro?')) deleteRegistroMutation.mutate(registroMap[selectedDate].id); }}
                      className="px-4 py-2 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors">
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
            <h3 className="font-semibold text-emerald-400">¿Confirmar aprobación?</h3>
            <p className="text-sm text-muted-foreground">
              Estás por aprobar esta planilla de <strong>{planilla.usuario.nombre} {planilla.usuario.apellido}</strong>.
              Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirmApproval(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm">Cancelar</button>
              <button onClick={() => { setShowConfirmApproval(false); avanzarMutation.mutate(); }}
                disabled={avanzarMutation.isPending}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
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
    </div>
  );
}

// ─── DrumTimePicker ──────────────────────────────────────────────────────────
// Mobile-friendly time picker with drum/scroll wheels (minutes: 0/15/30/45)
function DrumTimePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const MINUTE_STEPS = [0, 15, 30, 45];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  const [h, m] = value.split(':').map(Number);
  const currentHour = isNaN(h) ? 7 : h;
  const currentMin = isNaN(m) ? 0 : Math.round(m / 15) * 15 % 60;

  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);

  const ITEM_H = 40;

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, index: number) => {
    if (!ref.current) return;
    ref.current.scrollTo({ top: index * ITEM_H, behavior: 'smooth' });
  };

  // Sync scroll position when value changes externally
  useEffect(() => { scrollTo(hourRef, currentHour); }, [currentHour]);
  useEffect(() => { scrollTo(minRef, MINUTE_STEPS.indexOf(currentMin)); }, [currentMin]);

  const handleHourScroll = () => {
    if (!hourRef.current) return;
    const idx = Math.round(hourRef.current.scrollTop / ITEM_H);
    const newH = HOURS[Math.min(idx, HOURS.length - 1)];
    if (newH !== currentHour) onChange(`${String(newH).padStart(2,'0')}:${String(currentMin).padStart(2,'0')}`);
  };

  const handleMinScroll = () => {
    if (!minRef.current) return;
    const idx = Math.round(minRef.current.scrollTop / ITEM_H);
    const newM = MINUTE_STEPS[Math.min(idx, MINUTE_STEPS.length - 1)];
    if (newM !== currentMin) onChange(`${String(currentHour).padStart(2,'0')}:${String(newM).padStart(2,'0')}`);
  };

  if (disabled) {
    return (
      <div className="flex items-center justify-center h-10 px-3 rounded-lg border border-input bg-muted/30 text-sm font-mono text-muted-foreground">
        {String(currentHour).padStart(2,'0')}:{String(currentMin).padStart(2,'0')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 justify-center">
      {/* Hour drum */}
      <div
        ref={hourRef}
        onScroll={handleHourScroll}
        className="h-[120px] overflow-y-scroll snap-y snap-mandatory scrollbar-none rounded-lg border border-input bg-background text-foreground relative w-16 cursor-grab"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* padding top/bottom so first/last item centers */}
        <div style={{ height: ITEM_H }} />
        {HOURS.map((hr) => (
          <div
            key={hr}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              hr === currentHour ? 'text-primary font-bold text-xl' : 'text-muted-foreground',
            )}
          >
            {String(hr).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>

      <span className="text-xl font-bold text-foreground">:</span>

      {/* Minute drum */}
      <div
        ref={minRef}
        onScroll={handleMinScroll}
        className="h-[120px] overflow-y-scroll snap-y snap-mandatory scrollbar-none rounded-lg border border-input bg-background text-foreground relative w-16 cursor-grab"
        style={{ scrollbarWidth: 'none' }}
      >
        <div style={{ height: ITEM_H }} />
        {MINUTE_STEPS.map((mn) => (
          <div
            key={mn}
            className={cn(
              'flex items-center justify-center snap-center h-10 text-lg font-mono transition-colors select-none',
              mn === currentMin ? 'text-primary font-bold text-xl' : 'text-muted-foreground',
            )}
          >
            {String(mn).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-center">
      <p className={cn('text-lg font-bold font-mono', color ?? 'text-foreground')}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
