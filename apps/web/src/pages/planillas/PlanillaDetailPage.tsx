import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getUploadUrl } from '@/services/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { mensajeDeError } from '@/lib/errores';
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Loader2,
  Clock, MapPin, Car, Moon, Sun, AlertCircle, AlertTriangle, X, Download, Lock, Printer, Trash2, Copy, Eraser,
  CalendarDays, ChevronDown, Lightbulb, Check, Zap, ClipboardCopy, Upload, FileText
} from 'lucide-react';
import { ESTADO_STYLES, ESTADO_LABELS } from '@/constants/planillaConstants';
import {
  dateKey, esFeriadoNacional, nombreFeriado, cargarFeriados,
  buildCalendarDays, buildWeeks, cellStyle, etiquetaTipoSolicitud,
} from '@/utils/planillaHelpers';
import { diaKey, diaLocal, fmtDia, hoyKey } from '@/utils/fechaDia';
import { francoDelDia, tramoDelDia, esInicioDeTramo, diagramaHeaderText, type TramoDiagrama } from '@/utils/tramosDiagrama';
import { pasoActualDe, type PasoDocumento } from '@/utils/circuito';
import { avisarSinCircuito } from '@/lib/avisoCircuito';
import SuccessOverlay from '@/components/planilla/SuccessOverlay';
import DrumTimePicker from '@/components/planilla/DrumTimePicker';
import MiniCard from '@/components/planilla/MiniCard';
import BgBlobs from '@/components/planilla/BgBlobs';
import PeriodGridPicker, { type PeriodoItem } from '@/components/planilla/PeriodGridPicker';
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
  marcaManual?: {
    id: string;
    estado: string;
    tipo: string;
    cargadaPorId: string;
    aprobadaPorId: string | null;
    archivoUrl: string | null;
  } | null;
}

/**
 * Ausencia o vacación PENDIENTE / EN_REVISION que toca el período.
 *
 * No hay `RegistroHoras` para estos días —el bloqueo se materializa recién al
 * aprobar—, así que la marca del calendario se recalcula desde acá en cada carga:
 * no se persiste nada, y por eso sobrevive a borrar y recrear la planilla.
 */
interface SolicitudPendiente {
  id: string;
  clase: 'AUSENCIA' | 'VACACION';
  tipo: string;
  estado: string;
  fechaInicio: string;
  fechaFin: string;
  descripcion: string | null;
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
    diagramas: { diagrama: { nombre: string } }[];
  };
  /** El circuito congelado al enviar; JSON crudo, lo interpreta `pasoActualDe`. */
  circuitoSnapshot: unknown;
  /** Tramos de diagrama que cubren el período (uno por cada cambio aprobado). */
  tramosDiagrama?: TramoDiagrama[];
  /** Pedidos sin firmar que se solapan con el período (no bloquean el día). */
  solicitudesPendientes?: SolicitudPendiente[];
  flujo?: {
    nombre: string;
    pasos: PasoDocumento[];
  } | null;
}

const DOW_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Minutos desde medianoche de un "HH:MM". */
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Clasifica un turno como noche/día (informativo, port PWA §5.3):
 * es "noche" si cruza la medianoche (salida < entrada) o si ≥50% de las horas caen en 21:00–06:00.
 */
function clasificarTurno(entrada: string, salida: string): { noche: boolean; cruza: boolean } {
  if (!entrada || !salida) return { noche: false, cruza: false };
  const e = toMin(entrada);
  const s = toMin(salida);
  const cruza = s < e;
  const total = cruza ? 1440 - e + s : s - e;
  if (total <= 0) return { noche: false, cruza };
  let nocturnos = 0;
  for (let i = 0; i < total; i++) {
    const min = (e + i) % 1440;
    if (min >= 21 * 60 || min < 6 * 60) nocturnos++;
  }
  return { noche: cruza || nocturnos / total >= 0.5, cruza };
}

export default function PlanillaDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const dialog = useDialogStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // transform-origin del diálogo para "crecer desde la celda" (desktop); null = sin origen (móvil).
  const [dialogOrigin, setDialogOrigin] = useState<string | null>(null);
  const initialFormRef = useRef<string>(''); // snapshot del form al abrir → detecta cambios sin guardar
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [showRechazo, setShowRechazo] = useState(false);
  const [showConfirmApproval, setShowConfirmApproval] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [diasFaltantes, setDiasFaltantes] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const handleSuccessDone = useCallback(() => setShowSuccess(false), []);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  // Confirmación de la marca manual: tipo elegido, descripción y certificado opcional.
  const [marcaPendiente, setMarcaPendiente] = useState<{ tipo: string; label: string; reemplazaHoras: boolean } | null>(null);
  const [marcaDescripcion, setMarcaDescripcion] = useState('');
  const [marcaArchivo, setMarcaArchivo] = useState<File | null>(null);
  const marcaFileRef = useRef<HTMLInputElement>(null);
  const certFileRef = useRef<HTMLInputElement>(null);
  // Tip dismissable "mantené pulsado para copiar" (auto-oculto 5s; descarte persistido)
  const TIP_KEY = 'planilla-tip-copiar';
  const [tipHidden, setTipHidden] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(() => {
    try { return localStorage.getItem(TIP_KEY) === '1'; } catch { return false; }
  });

  // ── Modos de pintado (copiar / borrar días) ──
  const [paintMode, setPaintMode] = useState<'none' | 'copy' | 'delete'>('none');
  const [copySource, setCopySource] = useState<string | null>(null);
  const [painted, setPainted] = useState<Set<string>>(new Set());
  const [applyingPaint, setApplyingPaint] = useState(false);
  // Card-flip de reescritura: días recién copiados/borrados giran (puerta) al refrescarse el dato.
  const [flippingKeys, setFlippingKeys] = useState<Set<string>>(new Set());
  const [flipToken, setFlipToken] = useState(0);
  const paintingRef = useRef(false);
  const strokeActionRef = useRef<'add' | 'remove'>('add');
  const strokeTouchedRef = useRef<Set<string>>(new Set());

  // ── Long-press en una celda con datos → entra al modo copiar usándola como origen (port PWA) ──
  const [pressingKey, setPressingKey] = useState<string | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpRingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);
  const lpStart = useRef<{ x: number; y: number } | null>(null);

  // Feriados: refresco opcional desde la API (el seed offline siempre funciona)
  const [, setFeriadosVersion] = useState(0);

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
    esFrancoCompensatorio: false,
    observaciones: '',
  });

  const LAST_DEFAULTS_KEY = 'planilla-last-defaults';

  const { data: planilla, isLoading, isError, error } = useQuery<PlanillaDetalle>({
    queryKey: ['planilla', id],
    queryFn: async () => (await api.get(`/planillas/${id}`)).data,
    retry: 1,
  });

  // Flags de módulo de la empresa. El plan B nace apagado: sin esto el bloque de
  // marcar días se renderiza y el backend responde 403 al confirmar.
  const { data: modulos } = useQuery<{ marcaManualActiva: boolean }>({
    queryKey: ['config-modulos'],
    queryFn: async () => (await api.get('/config/modulos')).data,
    staleTime: 5 * 60 * 1000,
  });
  const marcaManualActiva = modulos?.marcaManualActiva ?? false;

  // Lista de planillas (para el selector de período 3×4) — cacheada con PlanillasPage.
  const { data: todasLasPlanillas = [] } = useQuery<Array<PeriodoItem & { usuario: { id: string } }>>({
    queryKey: ['planillas'],
    queryFn: () => api.get('/planillas').then((r) => r.data),
    staleTime: 60_000,
  });

  // Los tramos vienen con la planilla: un cambio de diagrama aprobado a mitad de
  // período parte el período, y el diagrama "actual" del usuario no sabe nada de
  // la primera mitad.
  const tramosDiagrama: TramoDiagrama[] = planilla?.tramosDiagrama ?? [];

  // Traer del servidor los feriados con los que se liquida (nacionales + los de la
  // empresa). El calendario los pinta; el flag del registro lo decide el backend.
  useEffect(() => {
    if (!planilla) return;
    cargarFeriados((url) => api.get(url).then((r) => r.data)).then((changed) => {
      if (changed) setFeriadosVersion((v) => v + 1);
    });
  }, [planilla?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tip "mantené pulsado para copiar": se auto-oculta a los 5 s.
  useEffect(() => {
    if (tipDismissed) return;
    const t = setTimeout(() => setTipHidden(true), 5000);
    return () => clearTimeout(t);
  }, [tipDismissed]);

  const enviarMutation = useMutation({
    mutationFn: () => api.post(`/planillas/${id}/enviar`),
    onSuccess: (res) => {
      avisarSinCircuito(res.data);
      setDiasFaltantes([]);
      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      queryClient.invalidateQueries({ queryKey: ['aprobaciones'] });
    },
    onError: (err: any) => {
      if (err.response?.status === 400 && err.response?.data?.diasFaltantes) {
        setDiasFaltantes(err.response.data.diasFaltantes);
      } else {
        toast({ title: 'Error', description: mensajeDeError(err).mensaje, variant: 'destructive' });
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
    onError: (err: any) => {
      toast({ title: 'Error', description: mensajeDeError(err).mensaje, variant: 'destructive' });
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
    onError: (err: any) => {
      toast({ title: 'Error', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const deletePlanillaMutation = useMutation({
    mutationFn: () => api.delete(`/planillas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planillas'] });
      toast({ title: 'Planilla eliminada', description: 'La planilla fue eliminada correctamente.' });
      navigate('/planillas');
    },
    onError: (err: any) => {
      toast({ title: 'No se puede eliminar', description: mensajeDeError(err).mensaje, variant: 'destructive' });
    },
  });

  const handleDeletePlanilla = async () => {
    const first = await dialog.confirm({
      title: '¿Eliminar planilla?',
      message: `Vas a eliminar la planilla del período ${planilla ? fmtDia(planilla.periodoInicio) + ' — ' + fmtDia(planilla.periodoFin) : ''}. Se perderán todos los registros de horas cargados.`,
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!first) return;

    const second = await dialog.confirm({
      title: '¿Estás seguro?',
      message: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar definitivamente',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!second) return;

    deletePlanillaMutation.mutate();
  };

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
        map[diaKey(r.fecha)] = r;
      }
    }
    return map;
  }, [planilla]);

  // Índice día → solicitud en revisión. La marca no se persiste: se recalcula
  // desde la solicitud en cada carga, así que sobrevive a borrar la planilla.
  // El recorrido va por `Date` local (`diaLocal` posiciona el día correcto sin
  // depender del huso) y la clave sale de `dateKey`, que es `claveLocal`.
  const pendientePorDia = useMemo(() => {
    const map: Record<string, SolicitudPendiente> = {};
    for (const s of planilla?.solicitudesPendientes ?? []) {
      const cur = diaLocal(s.fechaInicio);
      const fin = diaLocal(s.fechaFin);
      while (cur <= fin) {
        map[dateKey(cur)] = s;
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [planilla]);

  // El alta de la marca crea la Ausencia y, si el usuario eligió certificado, lo sube
  // en un segundo pedido: el endpoint de archivo necesita el id que recién existe acá.
  const marcarDiaMutation = useMutation({
    mutationFn: async (vars: { fecha: string; tipo: string; descripcion?: string; archivo?: File | null }) => {
      const { data } = await api.post(`/planillas/${id}/marcar-dia`, {
        fecha: vars.fecha, tipo: vars.tipo, descripcion: vars.descripcion || undefined,
      });
      if (vars.archivo && data?.marcaManual?.id) {
        const fd = new FormData();
        fd.append('archivo', vars.archivo);
        try {
          await api.post(`/ausencias/${data.marcaManual.id}/archivo`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          // La marca ya quedó creada: se avisa y se puede reintentar desde el día.
          toast({ title: 'La marca se creó, pero el certificado no subió', description: 'Probá adjuntarlo de nuevo desde el día marcado.', variant: 'destructive' });
        }
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      setSelectedDate(null);
      setMarcaPendiente(null);
    },
    onError: (err: any) => toast({ title: 'No se pudo marcar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });
  const quitarMarcaMutation = useMutation({
    mutationFn: (ausenciaId: string) => api.delete(`/planillas/${id}/marcas/${ausenciaId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['planilla', id] }); setSelectedDate(null); },
    onError: (err: any) => toast({ title: 'No se pudo quitar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });
  const adjuntarCertMutation = useMutation({
    mutationFn: async (vars: { ausenciaId: string; archivo: File }) => {
      const fd = new FormData();
      fd.append('archivo', vars.archivo);
      return api.post(`/ausencias/${vars.ausenciaId}/archivo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      toast({ title: 'Certificado adjuntado' });
    },
    onError: (err: any) => toast({ title: 'No se pudo adjuntar', description: mensajeDeError(err).mensaje, variant: 'destructive' }),
  });

  const TIPOS_MARCA: { value: string; label: string }[] = [
    { value: 'FRANCO_COMPENSATORIO', label: 'Franco compensatorio' },
    { value: 'FALTA_JUSTIFICADA', label: 'Falta justificada' },
    { value: 'FALTA_INJUSTIFICADA', label: 'Falta injustificada' },
    { value: 'CERTIFICADO_MEDICO', label: 'Certificado médico' },
    { value: 'LICENCIA_ESPECIAL', label: 'Licencia especial' },
  ];

  // Avisa (no bloquea) si quedaron certificados médicos sin el archivo: quien
  // todavía no tiene el papel en la mano no debería quedar trabado para enviar.
  const handleEnviar = async () => {
    if (certificadosSinArchivo > 0) {
      const ok = await dialog.confirm({
        title: 'Certificados sin adjuntar',
        message: `Hay ${certificadosSinArchivo} día(s) marcados como certificado médico sin el archivo adjunto. Podés enviar igual y adjuntarlo después si te la rechazan. ¿Enviar?`,
      });
      if (!ok) return;
    }
    enviarMutation.mutate();
  };

  // Abre el diálogo de confirmación en vez de marcar en el acto: marcar un día
  // crea una solicitud, y merece un paso donde revisar tipo, fecha y certificado.
  const handleMarcar = (tipo: string) => {
    if (!selectedDate) return;
    const existing = registroMap[selectedDate];
    const label = TIPOS_MARCA.find(t => t.value === tipo)?.label ?? tipo;
    setMarcaDescripcion('');
    setMarcaArchivo(null);
    setMarcaPendiente({
      tipo,
      label,
      reemplazaHoras: !!(existing && !existing.bloqueado && existing.entradaTurno1),
    });
  };

  // Build calendar
  const weeks = useMemo((): (Date | null)[][] => {
    if (!planilla) return [];
    const days = buildCalendarDays(planilla.periodoInicio, planilla.periodoFin);
    return buildWeeks(days);
  }, [planilla]);

  // Clave del día de hoy, izada fuera del render de celdas: es constante para
  // todo el calendario y adentro del `.map` construía un `Date` por cada celda.
  const claveHoy = hoyKey();

  // Orden cronológico de los días que están girando → escalona el card-flip.
  const flipRank = useMemo(() => {
    const m = new Map<string, number>();
    if (flippingKeys.size === 0) return m;
    let i = 0;
    for (const week of weeks) for (const d of week) {
      if (!d) continue;
      const k = dateKey(d);
      if (flippingKeys.has(k)) m.set(k, i++);
    }
    return m;
  }, [flippingKeys, weeks]);

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
  const canDelete = isOwner && ['BORRADOR', 'RECHAZADA', 'ENVIADA'].includes(planilla.estado);
  // canApprove: true only if this user's role matches the current approval step,
  // or RRHH/ADMIN (nivel >= 90) who can approve any step.
  // El paso sale del circuito CONGELADO de esta planilla: leer los pasos vivos
  // hace aparecer (o desaparecer) el botón de aprobar según una cadena que esta
  // planilla no recorre, porque el circuito se acorta con el nivel de quien envía.
  const currentStep = pasoActualDe(planilla);
  const userNivel = user?.rolNivel ?? 0;
  const canApprove = !isOwner &&
    !!currentStep &&
    (currentStep.rolAprobador === user?.rol
      || user?.rol === 'ADMIN'
      || (userNivel >= 90 && currentStep.rolAprobador === 'RRHH')) &&
    (planilla.estado === 'ENVIADA' || planilla.estado === 'EN_REVISION');
  // Marca manual (plan B): la pone y la saca solo el dueño, con la planilla editable.
  // Se aprueban junto con la planilla, así que el aprobador solo las mira.
  // Certificados médicos marcados sin el archivo: se avisa al enviar, no se bloquea.
  const certificadosSinArchivo = planilla.registros.filter(
    r => r.marcaManual?.tipo === 'CERTIFICADO_MEDICO' && !r.marcaManual.archivoUrl,
  ).length;
  const totalHoras = Number(planilla.totalHorasNormales) + Number(planilla.totalHorasExtra50) + Number(planilla.totalHorasExtra100);
  // Planillas del MISMO usuario → alimentan el selector de período 3×4.
  const ownerPlanillas: PeriodoItem[] = todasLasPlanillas
    .filter((p) => p.usuario.id === planilla.usuario.id)
    .map((p) => ({ id: p.id, periodoInicio: p.periodoInicio, periodoFin: p.periodoFin }));
  const showTip = canEdit && paintMode === 'none' && !tipDismissed && !tipHidden;

  /** Franco según el diagrama vigente ESE día (los tramos vienen con la planilla). */
  function isFranco(day: Date): boolean {
    return francoDelDia(tramosDiagrama, day);
  }

  // ═══════════════════════════════════════════════
  // Modos de pintado: copiar un día a otros / borrar días arrastrando
  // ═══════════════════════════════════════════════

  function startPaintMode(mode: 'copy' | 'delete') {
    setPaintMode(mode);
    setCopySource(null);
    setPainted(new Set());
  }

  function exitPaintMode() {
    setPaintMode('none');
    setCopySource(null);
    setPainted(new Set());
  }

  function cancelPress() {
    if (lpRingTimer.current) { clearTimeout(lpRingTimer.current); lpRingTimer.current = null; }
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
    setPressingKey((p) => (p === null ? p : null));
  }

  /** Entra al modo copiar usando `key` como día origen (disparado por long-press). */
  function startCopyFrom(key: string) {
    setPaintMode('copy');
    setCopySource(key);
    setPainted(new Set());
  }

  function dismissTip() {
    try { localStorage.setItem(TIP_KEY, '1'); } catch { /* ignore */ }
    setTipDismissed(true);
  }

  /** ¿La celda puede pintarse en el modo activo? */
  function cellPaintable(key: string): boolean {
    const reg = registroMap[key];
    if (reg?.bloqueado) return false;
    if (paintMode === 'copy') return !!copySource && key !== copySource;
    if (paintMode === 'delete') return !!reg; // sólo días con datos
    return false;
  }

  function keyFromPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-daykey]')?.getAttribute('data-daykey') ?? null;
  }

  function applyStroke(key: string) {
    setPainted((prev) => {
      const next = new Set(prev);
      if (strokeActionRef.current === 'add') next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handlePaintPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (paintMode === 'none') return;
    const key = keyFromPoint(e.clientX, e.clientY);
    if (!key) return;
    // En modo copiar, el primer toque elige el día origen
    if (paintMode === 'copy' && !copySource) {
      const reg = registroMap[key];
      if (reg && !reg.bloqueado) setCopySource(key);
      return;
    }
    if (!cellPaintable(key)) return;
    paintingRef.current = true;
    strokeTouchedRef.current = new Set([key]);
    // Un trazo decide al inicio si pinta o despinta y no re-togglea celdas ya tocadas
    strokeActionRef.current = painted.has(key) ? 'remove' : 'add';
    applyStroke(key);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePaintPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!paintingRef.current) return;
    const key = keyFromPoint(e.clientX, e.clientY);
    if (!key || strokeTouchedRef.current.has(key) || !cellPaintable(key)) return;
    strokeTouchedRef.current.add(key);
    applyStroke(key);
  }

  function handlePaintPointerUp() {
    paintingRef.current = false;
  }

  /** Dispara la animación de "reescritura" (card-flip) sobre los días afectados, ya con el dato fresco. */
  function triggerFlip(keys: Set<string>) {
    if (keys.size === 0) return;
    setFlipToken((t) => t + 1);
    setFlippingKeys(keys);
    const maxMs = 300 + keys.size * 80 + 600;
    setTimeout(() => setFlippingKeys(new Set()), maxMs);
  }

  /** Aplica el modo activo: copia el registro origen a los destinos, o borra los pintados */
  async function confirmPaint() {
    if (painted.size === 0) return;
    const affected = new Set(painted); // capturar antes de limpiar el modo
    setApplyingPaint(true);
    try {
      if (paintMode === 'copy' && copySource) {
        const src = registroMap[copySource];
        if (!src) return;
        const promises = [...painted].map((key) => {
          const [y, m, d] = key.split('-').map(Number);
          const sameClock = (iso: string | null) => {
            if (!iso) return null;
            const t = new Date(iso);
            return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), 0).toISOString();
          };
          const body = {
            fecha: key,
            entradaTurno1: sameClock(src.entradaTurno1),
            salidaTurno1: sameClock(src.salidaTurno1),
            entradaTurno2: null,
            salidaTurno2: null,
            lugarTrabajo: src.lugarTrabajo,
            pernocte: src.pernocte,
            maneja: src.maneja,
            horasViajeInput: Number(src.horasViajeInput) || 0,
            distanciaViaje: src.distanciaViaje ?? null,
            // El recargo lo resuelve el servidor por cada día destino: al pintar sobre
            // un feriado o un franco vale el del día pintado, no el del día origen.
            esFrancoCompensatorio: src.esFrancoCompensatorio,
            observaciones: src.observaciones ?? null,
          };
          const existing = registroMap[key];
          return existing
            ? api.put(`/planillas/${id}/registros/${existing.id}`, body)
            : api.post(`/planillas/${id}/registros`, body);
        });
        await Promise.all(promises);
      } else if (paintMode === 'delete') {
        const promises = [...painted]
          .map((key) => registroMap[key])
          .filter((reg): reg is Registro => !!reg && !reg.bloqueado)
          .map((reg) => api.delete(`/planillas/${id}/registros/${reg.id}`));
        await Promise.all(promises);
      }
      await queryClient.invalidateQueries({ queryKey: ['planilla', id] });
      exitPaintMode();
      triggerFlip(affected); // gira los días afectados con el dato ya refrescado
    } finally {
      setApplyingPaint(false);
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
        const periodoStr = `${fmtDia(planilla.periodoInicio)} — ${fmtDia(planilla.periodoFin)}`;
        doc.text(`Empleado: ${planilla.usuario.apellido.toUpperCase()} ${planilla.usuario.nombre.toUpperCase()}`, 14, 22);
        doc.text(`Legajo: ${planilla.usuario.legajo || '—'}`, 14, 27);
        doc.text(`Sector: ${planilla.usuario.sector?.nombre || '—'}`, 80, 22);
        doc.text(`Período: ${periodoStr}`, 160, 22);

        // Con un cambio de diagrama a mitad de período, `planilla.usuario.diagramas[0]`
        // (la asignación `activo: true`) sólo tenía el diagrama nuevo: el PDF mentía
        // sobre la primera mitad del período mientras el calendario de esta misma
        // pantalla y el Excel del backend ya mostraban el corte. `tramosDiagrama` viene
        // pre-armado por el backend (mismo criterio que el Excel, ver diagramaHeaderText).
        const diagramaTexto = `Diagrama: ${diagramaHeaderText(tramosDiagrama)}`;
        // El texto de dos tramos ("X hasta DD/MM · Y desde DD/MM") puede no entrar en
        // el ancho disponible desde x=160 con la fuente de 10pt: se achica hasta que
        // entre (piso 6pt) en vez de dejarlo desbordar sobre el margen derecho.
        const anchoDisponibleDiagrama = pageWidth - 14 - 160;
        let fontSizeDiagrama = 10;
        doc.setFontSize(fontSizeDiagrama);
        while (doc.getTextWidth(diagramaTexto) > anchoDisponibleDiagrama && fontSizeDiagrama > 6) {
          fontSizeDiagrama -= 1;
          doc.setFontSize(fontSizeDiagrama);
        }
        doc.text(diagramaTexto, 160, 27);
        doc.setFontSize(10); // restaurar: lo que sigue en el encabezado asume 10pt

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

  function openDay(key: string, rect?: DOMRect | null) {
    // Origen del "container transform": que el diálogo crezca desde el centro de la celda tocada.
    if (rect) {
      const ox = Math.round(rect.left + rect.width / 2 - window.innerWidth / 2);
      const oy = Math.round(rect.top + rect.height / 2 - window.innerHeight / 2);
      setDialogOrigin(`calc(50% + ${ox}px) calc(50% + ${oy}px)`);
    } else {
      setDialogOrigin(null);
    }
    const existing = registroMap[key];
    let form: typeof formData;
    if (existing) {
      const fmtTime = (iso: string | null) => {
        if (!iso) return '';
        return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      };
      form = {
        entradaTurno1: fmtTime(existing.entradaTurno1) || '07:00',
        salidaTurno1: fmtTime(existing.salidaTurno1) || '15:00',
        lugarTrabajo: existing.lugarTrabajo || 'CAMPO',
        pernocte: existing.pernocte || 'NO',
        maneja: existing.maneja,
        horasViajeInput: existing.horasViajeInput || '0',
        viaje: parseFloat(existing.horasViajeInput || '0') > 0,
        distanciaViaje: existing.distanciaViaje || '',
        esFrancoCompensatorio: existing.esFrancoCompensatorio,
        observaciones: existing.observaciones || '',
      };
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
      form = {
        entradaTurno1: lastEntry, salidaTurno1: lastExit,
        lugarTrabajo: lastLugar, pernocte: lastPernocte,
        viaje: false, distanciaViaje: '', maneja: false, horasViajeInput: '0',
        esFrancoCompensatorio: false, observaciones: '',
      };
    }
    setFormData(form);
    initialFormRef.current = JSON.stringify(form); // snapshot para detectar cambios sin guardar
    setSelectedDate(key);
  }

  /** Cierra el diálogo del día; si hay cambios sin guardar (y se puede editar), pide confirmar. */
  async function closeDay() {
    if (canEdit && selectedDate && !registroMap[selectedDate]?.bloqueado
        && JSON.stringify(formData) !== initialFormRef.current) {
      const ok = await dialog.confirm({
        title: '¿Descartar cambios?',
        message: 'Tenés cambios sin guardar en este día.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setSelectedDate(null);
  }

  /** Contexto del día seleccionado (no editable): franco por diagrama y feriado nacional */
  const selFranco = selectedDate
    ? isFranco(diaLocal(selectedDate))
    : false;
  const selFeriado = selectedDate ? esFeriadoNacional(selectedDate) : false;
  const selFeriadoNombre = selectedDate ? nombreFeriado(selectedDate) : null;
  // Auto-detección según horarios cargados: no hay botón "franco/feriado trabajado"
  const formHasWork = !formData.esFrancoCompensatorio && formData.entradaTurno1 !== formData.salidaTurno1;
  // Clasificación noche/día del turno cargado (informativo, port PWA).
  const turno = clasificarTurno(formData.entradaTurno1, formData.salidaTurno1);
  // Reloj sugerido: último día CON trabajo anterior al seleccionado (sólo para días nuevos sin registro).
  const sugerenciaReloj = (() => {
    if (!selectedDate || registroMap[selectedDate]) return null;
    const fmtTime = (iso: string | null) =>
      iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    let best: { entrada: string; salida: string; fecha: string } | null = null;
    for (const k of Object.keys(registroMap)) {
      const r = registroMap[k];
      if (!r.entradaTurno1 || !r.salidaTurno1 || r.bloqueado || r.esFrancoCompensatorio) continue;
      if (k >= selectedDate) continue;
      if (!best || k > best.fecha) best = { entrada: fmtTime(r.entradaTurno1), salida: fmtTime(r.salidaTurno1), fecha: k };
    }
    return best;
  })();

  function handleSaveDay() {
    const [y, m, d] = selectedDate!.split('-').map(Number);

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
      fecha: selectedDate,
      entradaTurno1: toIso(formData.entradaTurno1),
      salidaTurno1: toIso(formData.salidaTurno1),
      entradaTurno2: null,
      salidaTurno2: null,
      lugarTrabajo: formData.esFrancoCompensatorio ? 'FRANCO' : formData.lugarTrabajo,
      pernocte: formData.pernocte,
      maneja: formData.maneja,
      horasViajeInput: formData.esFrancoCompensatorio || !formData.viaje ? 0 : (parseFloat(formData.horasViajeInput) || 0),
      distanciaViaje: formData.viaje ? formData.distanciaViaje : null,
      // esFeriado y esFrancoTrabajado NO se mandan: los deriva el servidor de la
      // configuración de la empresa y del diagrama del usuario. Son los que
      // disparan el recargo al 100%, y el navegador no puede ser la autoridad.
      esFrancoCompensatorio: formData.esFrancoCompensatorio,
      observaciones: formData.observaciones || null,
    });
  }

  return (
    <div className="relative isolate space-y-5">
      <BgBlobs />
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
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setShowPeriodPicker(true)}
              className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:text-primary transition-colors"
              title="Cambiar de período"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {fmtDia(planilla.periodoInicio)} — {fmtDia(planilla.periodoFin)}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {planilla.usuario.sector && <span>• {planilla.usuario.sector.nombre}</span>}
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
        <MiniCard label="Total" animate={totalHoras} glow color="text-primary" />
        <MiniCard label="Normales" animate={Number(planilla.totalHorasNormales)} />
        <MiniCard label="E50%" animate={Number(planilla.totalHorasExtra50)} color="text-cal-amber" />
        <MiniCard label="E100%" animate={Number(planilla.totalHorasExtra100)} color="text-cal-red" />
        <MiniCard label="Viaje" animate={Number(planilla.totalHorasViaje)} color="text-cal-blue" />
        <MiniCard label="Campo/Base" value={`${planilla.totalDiasCampo}/${planilla.totalDiasBase}`} color="text-cal-emerald" />
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2 flex-wrap">
        {canSend && (
          <button onClick={handleEnviar} disabled={enviarMutation.isPending}
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
        {canEdit && (
          <button
            onClick={() => paintMode === 'copy' ? exitPaintMode() : startPaintMode('copy')}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              paintMode === 'copy'
                ? 'border-sky-400 text-sky-400 bg-sky-500/15'
                : 'border-sky-500/40 text-sky-500 bg-sky-500/5 hover:bg-sky-500/10',
            )}
            title="Elegí un día origen y pintá los días destino para copiarlo"
          >
            <Copy className="h-4 w-4" /> Copiar día
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => paintMode === 'delete' ? exitPaintMode() : startPaintMode('delete')}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              paintMode === 'delete'
                ? 'border-red-400 text-red-400 bg-red-500/15'
                : 'border-red-500/40 text-red-500 bg-red-500/5 hover:bg-red-500/10',
            )}
            title="Pintá los días con datos que quieras borrar"
          >
            <Eraser className="h-4 w-4" /> Borrar días
          </button>
        )}
        {(isOwner || userNivel >= 90) && (
        <button onClick={async () => {
            try { const res = await api.get(`/export/planilla/${id}`, { responseType: 'blob' }); const url = window.URL.createObjectURL(new Blob([res.data])); const a = document.createElement('a'); a.href = url; a.download = `planilla_${planilla.usuario.apellido}.xlsx`; a.click(); window.URL.revokeObjectURL(url); } catch { /* noop */ }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
          <Download className="h-4 w-4" /> Excel
        </button>
        )}
        <button onClick={handleExportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
          <Printer className="h-4 w-4" /> PDF
        </button>
        {canDelete && (
          <button onClick={handleDeletePlanilla} disabled={deletePlanillaMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/40 text-red-500 bg-red-500/5 text-sm font-medium hover:bg-red-500/10 disabled:opacity-50 transition-colors">
            {deletePlanillaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Eliminar
          </button>
        )}
      </div>

      {/* ── Barra del modo de pintado ── */}
      {paintMode !== 'none' && (
        <div className={cn(
          'sticky top-2 z-30 rounded-xl border p-3 flex flex-wrap items-center gap-3 backdrop-blur shadow-lg',
          'animate-[apply-bar-in_220ms_ease-out_both]',
          paintMode === 'copy' ? 'border-sky-400/40 bg-sky-500/15' : 'border-red-400/40 bg-red-500/15',
        )}>
          <p className="text-sm flex-1 min-w-[200px]">
            {paintMode === 'copy'
              ? !copySource
                ? '1. Tocá el día origen que querés copiar (debe tener datos)'
                : <>2. Pintá (tocá o arrastrá) los días destino — <strong>{painted.size}</strong> seleccionado{painted.size === 1 ? '' : 's'}</>
              : <>Pintá los días con datos que quieras borrar — <strong>{painted.size}</strong> seleccionado{painted.size === 1 ? '' : 's'}</>}
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmPaint}
              disabled={painted.size === 0 || applyingPaint}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-colors',
                paintMode === 'copy' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-red-600 hover:bg-red-700',
              )}
            >
              {applyingPaint ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {paintMode === 'copy' ? 'Aplicar' : 'Borrar'}
            </button>
            <button onClick={exitPaintMode}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tip: long-press para copiar (auto-oculto 5 s, descarte persistido) */}
      {showTip && (
        <div className="relative overflow-hidden rounded-xl border border-cal-blue/30 bg-blue-500/10 px-3 py-2 text-xs text-cal-blue flex items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0" />
          <span className="flex-1">Mantené pulsado un día con datos para copiarlo a otros, o usá «Copiar día».</span>
          <button onClick={dismissTip} aria-label="Descartar" className="p-0.5 rounded hover:bg-cal-blue/10">
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="absolute left-0 bottom-0 h-0.5 w-full bg-cal-blue/60 animate-[countdown-bar_5s_linear_forwards]" />
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* ── CALENDAR GRID (21→20) ──────────────────── */}
      {/* ══════════════════════════════════════════════ */}
      <div
        key={planilla.id}
        className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden"
        style={paintMode !== 'none' ? { touchAction: 'none' } : undefined}
        onPointerDown={handlePaintPointerDown}
        onPointerMove={handlePaintPointerMove}
        onPointerUp={handlePaintPointerUp}
        onPointerCancel={handlePaintPointerUp}
      >
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
              const isToday = key === claveHoy;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const hrs = reg ? Number(reg.horasTrabajadas) : 0;
              const hasData = !!reg;
              const francoDay = isFranco(day);
              const isLocked = reg?.bloqueado === true;
              // Pedido en revisión: se marca, pero el día sigue siendo editable.
              // El bloqueado gana: si ya está aprobado, manda el candado.
              const pendiente = !isLocked ? pendientePorDia[key] : undefined;
              const isFaltante = diasFaltantes.includes(key);
              const isFeriado = esFeriadoNacional(key);
              // Franco trabajado para la vista: se deriva del diagrama y de las horas cargadas,
              // no del flag guardado (que hasta el fix del backend puede venir manipulado).
              const francoTrabajado = francoDay && !!reg && !reg.bloqueado && !reg.esFrancoCompensatorio
                && !!reg.entradaTurno1 && !!reg.salidaTurno1;
              // El registro guardado dice "feriado" pero el calendario no: el aprobador tiene que verlo,
              // porque ese flag es el que manda todas las horas del día a extra 100%.
              const feriadoDiscrepante = !!reg?.esFeriado && !isFeriado;
              const isPainted = painted.has(key);
              const isCopySource = copySource === key;
              const dimmedByPaint = paintMode === 'delete' && (!hasData || isLocked);
              // Estilo "pintado" (relleno semántico full-cell) — port de la PWA, vía tokens.
              const vis = cellStyle(reg ? { ...reg, esFrancoTrabajado: francoTrabajado } : reg, { isFranco: francoDay, isFeriado });
              const francoTexture = !hasData && (francoDay || isWeekend);
              const isHighlighted = isPainted || isCopySource; // estados de pintado pisan el relleno
              const cellIdx = wi * 7 + di;
              const isFlipping = flippingKeys.has(key);
              const flipDelay = 300 + (flipRank.get(key) ?? 0) * 80;
              // Overlay de pintado: colores de ACCIÓN (no dependen del tema) — salpicadura + glow.
              const paint = isCopySource
                ? { c: 'rgba(56,189,248,0.95)', bg: 'rgba(56,189,248,0.14)' }
                : isPainted && paintMode === 'delete'
                  ? { c: 'rgba(248,113,113,0.96)', bg: 'rgba(248,113,113,0.18)' }
                  : isPainted && hasData
                    ? { c: 'rgba(251,191,36,0.96)', bg: 'rgba(251,191,36,0.16)' }
                    : isPainted
                      ? { c: 'rgba(52,211,153,0.96)', bg: 'rgba(52,211,153,0.16)' }
                      : null;

              return (
                <button
                  key={isFlipping ? `${di}-f${flipToken}` : di}
                  data-daykey={key}
                  onClick={(e) => {
                    if (paintMode !== 'none') return; // pintando: tap normal deshabilitado
                    if (lpFired.current) { lpFired.current = false; return; } // venía de un long-press
                    if (isLocked) return;
                    if (canEdit || hasData) openDay(key, e.currentTarget.getBoundingClientRect());
                  }}
                  onPointerDown={(e) => {
                    if (paintMode !== 'none' || !canEdit || !hasData || isLocked) return;
                    lpFired.current = false;
                    lpStart.current = { x: e.clientX, y: e.clientY };
                    lpRingTimer.current = setTimeout(() => setPressingKey(key), 140);
                    lpTimer.current = setTimeout(() => { lpFired.current = true; startCopyFrom(key); cancelPress(); }, 500);
                  }}
                  onPointerMove={(e) => {
                    const s = lpStart.current;
                    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
                  }}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onContextMenu={(e) => {
                    if (paintMode !== 'none' || !canEdit || !hasData || isLocked) return;
                    e.preventDefault();
                    lpFired.current = true;
                    startCopyFrom(key);
                  }}
                  style={{ animationDelay: isFlipping ? `${flipDelay}ms` : `${Math.min(cellIdx * 10, 360)}ms` }}
                  className={cn(
                    'min-h-[90px] p-2 text-left transition-all duration-150 relative group',
                    !isFlipping && 'animate-[cell-in_320ms_ease-out_both]',
                    isFlipping && 'animate-[day-flip-in_600ms_ease-in-out_both]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:z-10',
                    paintMode === 'none' && 'hover:bg-primary/5 active:scale-[0.98]',
                    !isHighlighted && vis.bgClass,
                    francoTexture && 'franco-stripes',
                    isLocked && 'cursor-not-allowed',
                    !isLocked && isWeekend && !hasData && !francoDay && !isFeriado && 'bg-muted/10',
                    isToday && paintMode === 'none' && 'ring-2 ring-inset ring-primary/50',
                    pendiente && 'bg-amber-500/[0.07]',
                    isFaltante && 'border-l-[3px] border-l-red-500/80',
                    dimmedByPaint && 'opacity-30',
                    isCopySource && 'ring-2 ring-inset ring-sky-400 z-10',
                    isPainted && paintMode === 'copy' && (hasData
                      ? 'ring-2 ring-inset ring-amber-400 z-10'
                      : 'ring-2 ring-inset ring-emerald-400 z-10'),
                    isPainted && paintMode === 'delete' && 'ring-2 ring-inset ring-red-400 z-10',
                  )}
                >
                  {/* Indicador de HOY: punto acentuado que late (port PWA) */}
                  {isToday && (
                    <span className="pointer-events-none absolute right-1 top-1 z-30 h-1.5 w-1.5 rounded-full bg-primary animate-[today-dot_2s_ease-in-out_infinite]" />
                  )}
                  {/* Anillo de long-press: se "dibuja" antes de entrar a copiar (port PWA) */}
                  {pressingKey === key && (
                    <span className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
                      <svg viewBox="0 0 36 36" className="h-[70%] w-[70%] -rotate-90">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(56,189,248,0.25)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(56,189,248)" strokeWidth="3" strokeLinecap="round"
                          style={{ strokeDasharray: 100.5, strokeDashoffset: 100.5, animation: 'tour-ring 360ms linear forwards' }} />
                      </svg>
                    </span>
                  )}
                  {/* Overlay de pintado (copiar/borrar): salpicadura + glow que respira (port PWA) */}
                  {paint && (
                    <>
                      <span
                        className="pointer-events-none absolute inset-0 animate-[paint-splash_360ms_cubic-bezier(.34,1.56,.64,1)_both]"
                        style={{ backgroundColor: paint.bg }}
                      />
                      <span
                        className="pointer-events-none absolute inset-0 animate-[paint-glow_2.2s_ease-in-out_infinite]"
                        style={{ color: paint.c, boxShadow: '0 0 0 1.5px currentColor, 0 0 12px 1px currentColor' }}
                      />
                    </>
                  )}
                  {/* Contorno punteado del pedido en revisión. Va como overlay y no
                      como borde de la celda para no correr el contenido 1px ni pelear
                      con el `focus:outline-none` del botón. */}
                  {pendiente && (
                    <span className="pointer-events-none absolute inset-0 z-20 border border-dashed border-cal-amber/70" />
                  )}
                  {/* Day number + badges row */}
                  <div className="relative z-10 flex items-start justify-between gap-0.5">
                    <span className={cn(
                      'text-[13px] font-semibold w-7 h-7 flex items-center justify-center rounded-full transition-colors',
                      isToday && 'bg-primary text-primary-foreground shadow-sm',
                      !isToday && isFeriado && 'text-cal-red',
                      !isToday && francoTrabajado && 'text-cal-amber',
                      !isToday && !isFeriado && !francoTrabajado && 'text-foreground/80',
                    )}>
                      {day.getDate()}
                    </span>
                    <div className="flex items-center gap-0.5 flex-wrap justify-end">
                      {francoDay && (
                        <span className={cn(
                          'text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full',
                          francoTrabajado
                            ? 'bg-amber-500/20 text-cal-amber'
                            : 'bg-orange-500/15 text-cal-orange',
                        )}>
                          {francoTrabajado ? 'FT' : 'F'}
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
                        <span className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-amber-500/20 text-cal-amber" title={nombreFeriado(key) ?? 'Feriado'}>
                          FER
                        </span>
                      )}
                      {feriadoDiscrepante && (
                        <span
                          className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-rose-500/20 text-cal-rose"
                          title="Este día está guardado como feriado pero no figura en el calendario: las horas se liquidan al 100%. Revisar antes de aprobar."
                        >
                          FER?
                        </span>
                      )}
                      {esInicioDeTramo(tramosDiagrama, day) && (
                        <span
                          className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-primary/20 text-primary"
                          title={`Desde este día rige el diagrama ${tramoDelDia(tramosDiagrama, day)?.diagrama.nombre ?? 'nuevo'}`}
                        >
                          NUEVO DIAG.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hour data */}
                  {hasData && !isLocked && (
                    <div className="relative z-10 mt-1.5 space-y-1">
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

                  {/* Mini-barra de horas (normales / 50% / 100%) — totales del backend (port PWA) */}
                  {hasData && !isLocked && hrs > 0 && (
                    <span className="pointer-events-none absolute inset-x-2 bottom-1 z-10 flex h-[3px] gap-px">
                      {Number(reg.horasNormales) > 0 && (
                        <span className="rounded-full bg-foreground/70" style={{ flex: Number(reg.horasNormales) }} />
                      )}
                      {Number(reg.horasExtra50) > 0 && (
                        <span className="rounded-full bg-cal-amber/85" style={{ flex: Number(reg.horasExtra50) }} />
                      )}
                      {Number(reg.horasExtra100) > 0 && (
                        <span className="rounded-full bg-cal-red/85" style={{ flex: Number(reg.horasExtra100) }} />
                      )}
                    </span>
                  )}

                  {/* Locked day (ausencia/vacación) */}
                  {isLocked && (
                    <div className="relative z-10 mt-1.5 space-y-0.5">
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
                      {reg?.marcaManual?.estado === 'PENDIENTE' && (
                        <span className="mt-0.5 block text-[9px] font-semibold text-cal-amber">con la planilla</span>
                      )}
                      {reg.observaciones && (
                        <p className="text-[8px] text-muted-foreground/70 leading-tight truncate max-w-full">
                          {reg.observaciones}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Pedido en revisión (no bloquea: el día se puede cargar) */}
                  {pendiente && (
                    <div className="relative z-10 mt-1.5 flex items-center gap-1">
                      <Clock className="h-3 w-3 shrink-0 text-cal-amber/80" />
                      <span className="text-[10px] font-semibold text-cal-amber leading-tight truncate">
                        {etiquetaTipoSolicitud(pendiente.tipo)} · en revisión
                      </span>
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
                      <span className="text-[8px] font-bold text-cal-red/90 inline-flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" />
                        Incompleto
                      </span>
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
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm sm:p-4 animate-[backdrop-fade-in_180ms_ease_both]"
          onClick={closeDay}
        >
          <div
            className={cn(
              'w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card/95 backdrop-blur shadow-2xl max-h-[92vh] sm:max-h-[90vh] overflow-y-auto',
              'animate-[dialog-slide-in_260ms_ease-out_both] sm:animate-[container-grow-in_220ms_cubic-bezier(0.34,1.56,0.64,1)_both]',
            )}
            style={{ transformOrigin: dialogOrigin ?? undefined }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header con degradé día/noche según el turno cargado */}
            <div className={cn(
              'flex items-center justify-between p-4 border-b border-border sticky top-0 z-10 bg-card/95 backdrop-blur',
              formHasWork && (turno.noche
                ? 'bg-gradient-to-r from-indigo-500/15 to-blue-500/10'
                : 'bg-gradient-to-r from-amber-400/15 to-orange-400/10'),
            )}>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold flex items-center gap-2 capitalize">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <span className="truncate">{fmtDia(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </h2>
                {formHasWork && (
                  <span className={cn(
                    'mt-1 inline-flex items-center gap-1 text-[11px] font-medium',
                    turno.noche ? 'text-cal-violet' : 'text-cal-amber',
                  )}>
                    {turno.noche ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                    {turno.noche ? 'Turno noche' : 'Turno día'}
                    {turno.cruza && ' · termina al día siguiente'}
                  </span>
                )}
              </div>
              <button onClick={closeDay} className="p-1 rounded-lg hover:bg-accent text-muted-foreground shrink-0">
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
                  {registroMap[selectedDate]?.motivoBloqueo === 'FRANCO_COMPENSATORIO' && !registroMap[selectedDate]?.marcaManual && isOwner && canEdit && (
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
                  {registroMap[selectedDate]?.marcaManual && (
                    <div className="mt-2 space-y-2">
                      {registroMap[selectedDate]!.marcaManual!.estado === 'PENDIENTE' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-cal-amber border border-cal-amber/30">
                          <Clock className="h-3 w-3" />
                          A aprobar con la planilla
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">
                          <Check className="h-3 w-3" />
                          Aprobada
                        </span>
                      )}

                      {registroMap[selectedDate]!.marcaManual!.tipo === 'CERTIFICADO_MEDICO' && (
                        <>
                          {registroMap[selectedDate]!.marcaManual!.archivoUrl && (
                            <a href={getUploadUrl(registroMap[selectedDate]!.marcaManual!.archivoUrl!)}
                              target="_blank" rel="noopener noreferrer"
                              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30">
                              <FileText className="h-4 w-4" /> Ver certificado
                            </a>
                          )}
                          {isOwner && canEdit && (
                            <>
                              <input ref={certFileRef} type="file" accept="image/*,.pdf" className="hidden"
                                onChange={e => {
                                  const f = e.target.files?.[0];
                                  if (f) adjuntarCertMutation.mutate({ ausenciaId: registroMap[selectedDate]!.marcaManual!.id, archivo: f });
                                  e.target.value = '';
                                }} />
                              <button type="button" onClick={() => certFileRef.current?.click()}
                                disabled={adjuntarCertMutation.isPending}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30 disabled:opacity-50">
                                <Upload className="h-4 w-4" />
                                {registroMap[selectedDate]!.marcaManual!.archivoUrl ? 'Reemplazar certificado' : 'Adjuntar certificado'}
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {/* Sin condicionar al estado de la marca: el dueño manda mientras
                          la planilla sea editable, esté aprobada o no. */}
                      {isOwner && canEdit && (
                        <button
                          onClick={async () => {
                            const ok = await dialog.confirm({
                              title: 'Quitar marca',
                              message: 'Se va a liberar el día y se cancela la solicitud asociada. Si adjuntaste un certificado, también se borra. ¿Continuar?',
                              variant: 'danger',
                            });
                            if (ok) quitarMarcaMutation.mutate(registroMap[selectedDate]!.marcaManual!.id);
                          }}
                          disabled={quitarMarcaMutation.isPending}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 disabled:opacity-50">
                          Quitar marca
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Time pickers */}
              {!registroMap[selectedDate]?.bloqueado && (<>
              {canEdit && marcaManualActiva && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/30 rounded-lg">
                    Marcar día especial (ausencia / compensatorio)
                  </summary>
                  <div className="p-2 grid grid-cols-1 gap-1">
                    {TIPOS_MARCA.map(t => (
                      <button key={t.value} type="button" onClick={() => handleMarcar(t.value)} disabled={marcarDiaMutation.isPending}
                        className="text-left px-3 py-2 rounded-md text-sm hover:bg-accent disabled:opacity-50">
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {/* Contexto del día (no editable): franco por diagrama / feriado nacional */}
              {(selFranco || selFeriado) && (
                <div className="flex flex-wrap gap-2">
                  {selFranco && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/20 text-cal-violet border border-cal-violet/30">
                      Día de Franco
                    </span>
                  )}
                  {selFeriado && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-cal-amber border border-cal-amber/30">
                      <CalendarDays className="h-3 w-3" />
                      Feriado nacional{selFeriadoNombre ? ` · ${selFeriadoNombre}` : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Avisos en vivo: se auto-detecta según los horarios cargados */}
              {selFranco && formHasWork && (
                <div className="rounded-lg border border-cal-violet/30 bg-violet-500/10 px-3 py-2 text-xs text-cal-violet font-medium flex items-center gap-1.5">
                  <Zap className="h-3 w-3" />
                  Franco trabajado — horas al 100%
                </div>
              )}
              {selFeriado && formHasWork && (
                <div className="rounded-lg border border-cal-amber/30 bg-amber-500/10 px-3 py-2 text-xs text-cal-amber font-medium flex items-center gap-1.5">
                  <Zap className="h-3 w-3" />
                  Feriado trabajado — horas al 100%
                </div>
              )}

              {/* Aviso: el turno cruza la medianoche (port PWA) */}
              {turno.cruza && formHasWork && (
                <div className="rounded-lg border border-cal-blue/30 bg-blue-500/10 px-3 py-2 text-xs text-cal-blue flex items-start gap-2">
                  <Moon className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>El turno cruza la medianoche: esas horas de la madrugada se cuentan en <strong>este</strong> día. No las vuelvas a cargar mañana.</span>
                </div>
              )}

              {/* Reloj sugerido: último día trabajado del período (port PWA) */}
              {canEdit && sugerenciaReloj && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, entradaTurno1: sugerenciaReloj.entrada, salidaTurno1: sugerenciaReloj.salida })}
                  className="w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Sugerido (último día): {sugerenciaReloj.entrada}–{sugerenciaReloj.salida}</span>
                  <span className="font-semibold text-primary">Usar</span>
                </button>
              )}

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
                    <ClipboardCopy className="h-3 w-3" />
                    Copiar día anterior ({prev.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })})
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

              {/* Franco compensatorio: sólo lectura — se otorga vía solicitud de ausencias aprobada */}
              {formData.esFrancoCompensatorio && (
                <div className="flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-cal-blue border border-cal-blue/30">
                    Franco compensatorio
                  </span>
                </div>
              )}

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

      {/* ── Selector de período 3×4 ── */}
      {showPeriodPicker && (
        <PeriodGridPicker
          planillas={ownerPlanillas}
          currentId={planilla.id}
          currentFin={planilla.periodoFin}
          onPick={(pid) => { if (pid !== planilla.id) navigate(`/planillas/${pid}`); }}
          onClose={() => setShowPeriodPicker(false)}
        />
      )}

      {/* ── Confirmación de la marca manual (plan B) ── */}
      {marcaPendiente && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setMarcaPendiente(null)}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-semibold">Confirmar ausencia</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {marcaPendiente.label} — {fmtDia(selectedDate, { weekday: 'long', day: '2-digit', month: '2-digit' })}
              </p>
            </div>

            {marcaPendiente.reemplazaHoras && (
              <p className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-cal-amber px-3 py-2">
                Este día tiene horas cargadas. Se reemplazan por la marca.
              </p>
            )}

            <div>
              <label className="text-xs text-muted-foreground">Descripción (opcional)</label>
              <input
                value={marcaDescripcion}
                onChange={e => setMarcaDescripcion(e.target.value)}
                maxLength={500}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Motivo o aclaración"
              />
            </div>

            {marcaPendiente.tipo === 'CERTIFICADO_MEDICO' && (
              <div>
                <input ref={marcaFileRef} type="file" accept="image/*,.pdf" className="hidden"
                  onChange={e => setMarcaArchivo(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => marcaFileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground">
                  <Upload className="h-4 w-4" />
                  {marcaArchivo ? marcaArchivo.name : 'Adjuntar certificado (opcional)'}
                </button>
                <p className="text-[10px] text-muted-foreground mt-1">Lo podés adjuntar después desde este mismo día.</p>
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setMarcaPendiente(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/30">
                Cancelar
              </button>
              <button type="button" disabled={marcarDiaMutation.isPending}
                onClick={() => marcarDiaMutation.mutate({
                  fecha: selectedDate, tipo: marcaPendiente.tipo,
                  descripcion: marcaDescripcion, archivo: marcaArchivo,
                })}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {marcarDiaMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
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

