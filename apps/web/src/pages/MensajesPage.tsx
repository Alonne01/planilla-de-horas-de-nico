import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import api, { getUploadUrl } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Send,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  Users,
  Building2,
  Shield,
  ArrowLeft,
  Loader2,
  X,
  Check,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────
interface Remitente {
  id: string;
  nombre: string;
  apellido: string;
  rol: string;
}

interface MensajeInbox {
  id: string;
  asunto: string;
  cuerpo: string;
  archivoUrl: string | null;
  archivoNombre: string | null;
  permiteRespuesta: boolean;
  esDifusion: boolean;
  destinoTipo: string | null;
  createdAt: string;
  remitente: Remitente;
  _count: { respuestas: number };
  leido: boolean;
  leidoAt: string | null;
  destinatarioId: string;
}

interface MensajeEnviado {
  id: string;
  asunto: string;
  cuerpo: string;
  destinoTipo: string | null;
  destinoValor: string | null;
  permiteRespuesta: boolean;
  createdAt: string;
  _count: { destinatarios: number; respuestas: number };
}

interface Respuesta {
  id: string;
  cuerpo: string;
  archivoUrl: string | null;
  archivoNombre: string | null;
  createdAt: string;
  usuario: Remitente;
}

interface MensajeDetalle {
  id: string;
  asunto: string;
  cuerpo: string;
  archivoUrl: string | null;
  archivoNombre: string | null;
  permiteRespuesta: boolean;
  esDifusion: boolean;
  destinoTipo: string | null;
  createdAt: string;
  remitenteId: string;
  remitente: Remitente;
  respuestas: Respuesta[];
  destinatarios: { usuarioId: string; leido: boolean }[];
}

interface Sector {
  id: string;
  nombre: string;
}

interface UsuarioOption {
  id: string;
  nombre: string;
  apellido: string;
  rol: string;
  legajo?: string;
}

const ROLES = ['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH', 'ADMIN'];

// ─── Helpers ────────────────────────────────────────
function formatDate(date: string) {
  const d = new Date(date);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateFull(date: string) {
  return new Date(date).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function destinoLabel(tipo: string | null, valor: string | null) {
  if (!tipo) return '';
  if (tipo === 'TODOS') return 'Todos';
  if (tipo === 'ROL') return `Rol: ${valor}`;
  if (tipo === 'SECTOR') return 'Sector';
  if (tipo === 'USUARIO') return 'Individual';
  return tipo;
}

// ─── Component ──────────────────────────────────────
export default function MensajesPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isRRHH = (user?.rolNivel ?? 0) >= 90;

  const [activeTab, setActiveTab] = useState<'inbox' | 'enviados'>('inbox');
  const [selectedMensajeId, setSelectedMensajeId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  // ─── Inbox Query ──────────────────────────────────
  const { data: inboxData, isLoading: loadingInbox } = useQuery({
    queryKey: ['mensajes', 'inbox'],
    queryFn: () => api.get('/mensajes').then(r => r.data),
  });

  // ─── Enviados Query ───────────────────────────────
  const { data: enviadosData, isLoading: loadingEnviados } = useQuery({
    queryKey: ['mensajes', 'enviados'],
    queryFn: () => api.get('/mensajes/enviados').then(r => r.data),
    enabled: isRRHH && activeTab === 'enviados',
  });

  // ─── Detalle Query ────────────────────────────────
  const { data: mensajeDetalle, isLoading: loadingDetalle } = useQuery({
    queryKey: ['mensajes', 'detalle', selectedMensajeId],
    queryFn: () => api.get(`/mensajes/${selectedMensajeId}`).then(r => r.data),
    enabled: !!selectedMensajeId,
  });

  // ─── Mark all read ────────────────────────────────
  const markAllRead = useMutation({
    mutationFn: () => api.put('/mensajes/leer-todas'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mensajes'] });
    },
  });

  const mensajes: MensajeInbox[] = inboxData?.mensajes ?? [];
  const noLeidos: number = inboxData?.noLeidos ?? 0;
  const enviados: MensajeEnviado[] = enviadosData ?? [];

  // ─── View message ─────────────────────────────────
  const handleSelectMensaje = (id: string) => {
    setSelectedMensajeId(id);
    setShowCompose(false);
    queryClient.invalidateQueries({ queryKey: ['mensajes', 'inbox'] });
  };

  const handleBack = () => {
    setSelectedMensajeId(null);
    setShowCompose(false);
    queryClient.invalidateQueries({ queryKey: ['mensajes'] });
  };

  // ─── Render ───────────────────────────────────────
  // If viewing a message detail
  if (selectedMensajeId) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a bandeja
        </button>
        {loadingDetalle ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : mensajeDetalle ? (
          <MensajeDetalleView
            mensaje={mensajeDetalle}
            currentUserId={user?.id ?? ''}
          />
        ) : (
          <p className="text-muted-foreground text-center py-12">Mensaje no encontrado</p>
        )}
      </div>
    );
  }

  // If composing
  if (showCompose) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a bandeja
        </button>
        <ComposeForm
          onSuccess={() => {
            setShowCompose(false);
            queryClient.invalidateQueries({ queryKey: ['mensajes'] });
          }}
          onCancel={() => setShowCompose(false)}
        />
      </div>
    );
  }

  // Main view — Inbox / Enviados tabs
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Mensajes</h1>
            <p className="text-sm text-muted-foreground">
              {noLeidos > 0 ? `${noLeidos} sin leer` : 'Sin mensajes nuevos'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {noLeidos > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border text-foreground hover:bg-accent transition-colors"
            >
              <Check className="h-4 w-4" />
              Marcar todas leídas
            </button>
          )}
          {isRRHH && (
            <button
              onClick={() => setShowCompose(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Send className="h-4 w-4" />
              Redactar
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('inbox')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'inbox'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Inbox className="h-4 w-4" />
          Bandeja de entrada
          {noLeidos > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-primary text-primary-foreground">
              {noLeidos}
            </span>
          )}
        </button>
        {isRRHH && (
          <button
            onClick={() => setActiveTab('enviados')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === 'enviados'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Send className="h-4 w-4" />
            Enviados
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === 'inbox' ? (
        loadingInbox ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : mensajes.length === 0 ? (
          <div className="text-center py-16">
            <Inbox className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No tenés mensajes</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {mensajes.map((m) => (
              <button
                key={m.id}
                onClick={() => handleSelectMensaje(m.id)}
                className={cn(
                  'w-full flex items-start gap-3 p-4 text-left hover:bg-accent/50 transition-colors',
                  !m.leido && 'bg-primary/5'
                )}
              >
                <div className="pt-1 shrink-0">
                  {m.leido ? (
                    <MailOpen className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Mail className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn('text-sm truncate', !m.leido ? 'font-semibold text-foreground' : 'text-foreground')}>
                      {m.remitente.nombre} {m.remitente.apellido}
                    </span>
                    {m.esDifusion && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">
                        {destinoLabel(m.destinoTipo, null)}
                      </span>
                    )}
                    {m.archivoUrl && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </div>
                  <p className={cn('text-sm truncate', !m.leido ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {m.asunto}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {m.cuerpo.substring(0, 100)}{m.cuerpo.length > 100 ? '...' : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs text-muted-foreground">{formatDate(m.createdAt)}</span>
                  {m._count.respuestas > 0 && (
                    <div className="flex items-center gap-1 mt-1 justify-end text-xs text-muted-foreground">
                      <Reply className="h-3 w-3" />
                      {m._count.respuestas}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        // Enviados tab
        loadingEnviados ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : enviados.length === 0 ? (
          <div className="text-center py-16">
            <Send className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No enviaste mensajes aún</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {enviados.map((m) => (
              <button
                key={m.id}
                onClick={() => handleSelectMensaje(m.id)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="pt-1 shrink-0">
                  <Send className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-foreground truncate">{m.asunto}</span>
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/20 text-violet-400">
                      {destinoLabel(m.destinoTipo, m.destinoValor)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m._count.destinatarios} destinatario{m._count.destinatarios !== 1 ? 's' : ''}
                    {m._count.respuestas > 0 && ` · ${m._count.respuestas} respuesta${m._count.respuestas !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{formatDate(m.createdAt)}</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── Message Detail View ────────────────────────────
function MensajeDetalleView({ mensaje, currentUserId }: { mensaje: MensajeDetalle; currentUserId: string }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const replyMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('cuerpo', replyText);
      if (replyFile) formData.append('archivo', replyFile);
      return api.post(`/mensajes/${mensaje.id}/responder`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      setReplyText('');
      setReplyFile(null);
      queryClient.invalidateQueries({ queryKey: ['mensajes', 'detalle', mensaje.id] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Message header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{mensaje.asunto}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">
                De: <span className="text-foreground font-medium">{mensaje.remitente.nombre} {mensaje.remitente.apellido}</span>
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {mensaje.remitente.rol}
              </span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{formatDateFull(mensaje.createdAt)}</span>
        </div>

        {mensaje.esDifusion && (
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Mensaje de difusión · {destinoLabel(mensaje.destinoTipo, null)}
            {mensaje.destinatarios && ` · ${mensaje.destinatarios.length} destinatarios`}
          </div>
        )}

        {/* Body */}
        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
          {mensaje.cuerpo}
        </div>

        {/* Attachment */}
        {mensaje.archivoUrl && (
          <div className="mt-4 pt-3 border-t border-border">
            <a
              href={getUploadUrl(mensaje.archivoUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-sm text-foreground hover:bg-accent/80 transition-colors"
            >
              <Paperclip className="h-4 w-4" />
              {mensaje.archivoNombre ?? 'Archivo adjunto'}
            </a>
          </div>
        )}

        {/* Read status for sender */}
        {mensaje.remitenteId === currentUserId && mensaje.destinatarios && (
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
            {mensaje.destinatarios.filter(d => d.leido).length} de {mensaje.destinatarios.length} leídos
          </div>
        )}
      </div>

      {/* Replies */}
      {mensaje.respuestas.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Reply className="h-4 w-4" />
            Respuestas ({mensaje.respuestas.length})
          </h3>
          {mensaje.respuestas.map((r) => (
            <div key={r.id} className={cn(
              'rounded-xl border border-border p-4',
              r.usuario.id === currentUserId ? 'bg-primary/5 ml-4' : 'bg-card mr-4'
            )}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {r.usuario.nombre} {r.usuario.apellido}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                    {r.usuario.rol}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateFull(r.createdAt)}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{r.cuerpo}</p>
              {r.archivoUrl && (
                <a
                  href={getUploadUrl(r.archivoUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary hover:underline"
                >
                  <Paperclip className="h-3 w-3" />
                  {r.archivoNombre ?? 'Archivo adjunto'}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reply form */}
      {mensaje.permiteRespuesta && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Reply className="h-4 w-4" />
            Responder
          </h3>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Escribí tu respuesta..."
            rows={3}
            className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)}
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Adjuntar
              </button>
              {replyFile && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {replyFile.name}
                  <button onClick={() => setReplyFile(null)} className="hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
            <button
              onClick={() => replyMutation.mutate()}
              disabled={!replyText.trim() || replyMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {replyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar
            </button>
          </div>
          {replyMutation.isError && (
            <p className="text-xs text-red-400 mt-2">Error al enviar respuesta</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compose Form ───────────────────────────────────
function ComposeForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [destinoTipo, setDestinoTipo] = useState<string>('TODOS');
  const [destinoValor, setDestinoValor] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [permiteRespuesta, setPermiteRespuesta] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch sectores
  const { data: sectores } = useQuery<Sector[]>({
    queryKey: ['sectores-for-mensajes'],
    queryFn: () => api.get('/analytics/sectores').then(r => r.data),
    enabled: destinoTipo === 'SECTOR',
  });

  // Fetch usuarios
  const { data: usuarios } = useQuery<UsuarioOption[]>({
    queryKey: ['usuarios-for-mensajes'],
    queryFn: () => api.get('/usuarios').then(r => {
      const data = r.data;
      return Array.isArray(data) ? data : data.usuarios ?? [];
    }),
    enabled: destinoTipo === 'USUARIO',
  });

  const filteredUsers = (usuarios ?? []).filter((u) => {
    if (!userSearch) return true;
    const search = userSearch.toLowerCase();
    return (
      u.nombre.toLowerCase().includes(search) ||
      u.apellido.toLowerCase().includes(search) ||
      (u.legajo && u.legajo.toLowerCase().includes(search))
    );
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('asunto', asunto);
      formData.append('cuerpo', cuerpo);
      formData.append('destinoTipo', destinoTipo);
      if (destinoTipo === 'USUARIO') {
        formData.append('destinoValor', selectedUserIds.join(','));
      } else if (destinoValor) {
        formData.append('destinoValor', destinoValor);
      }
      formData.append('permiteRespuesta', String(permiteRespuesta));
      if (archivo) formData.append('archivo', archivo);
      return api.post('/mensajes', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Send className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Redactar mensaje</h2>
      </div>

      {/* Destination type */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Destinatario</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { value: 'TODOS', label: 'Todos', icon: Users },
            { value: 'SECTOR', label: 'Sector', icon: Building2 },
            { value: 'ROL', label: 'Rol', icon: Shield },
            { value: 'USUARIO', label: 'Usuario', icon: Mail },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setDestinoTipo(opt.value); setDestinoValor(''); setSelectedUserIds([]); }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
                destinoTipo === opt.value
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <opt.icon className="h-4 w-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Destination value */}
      {destinoTipo === 'SECTOR' && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Sector</label>
          <select
            value={destinoValor}
            onChange={(e) => setDestinoValor(e.target.value)}
            className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Seleccionar sector...</option>
            {(sectores ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {destinoTipo === 'ROL' && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Rol</label>
          <select
            value={destinoValor}
            onChange={(e) => setDestinoValor(e.target.value)}
            className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Seleccionar rol...</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      {destinoTipo === 'USUARIO' && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Usuarios ({selectedUserIds.length} seleccionado{selectedUserIds.length !== 1 ? 's' : ''})
          </label>
          {selectedUserIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedUserIds.map(uid => {
                const u = (usuarios ?? []).find(x => x.id === uid);
                if (!u) return null;
                return (
                  <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
                    {u.nombre} {u.apellido}
                    <button type="button" onClick={() => setSelectedUserIds(prev => prev.filter(id => id !== uid))} className="hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <button type="button" onClick={() => setSelectedUserIds([])} className="text-[10px] text-muted-foreground hover:text-red-400 ml-1">
                Limpiar
              </button>
            </div>
          )}
          <input
            type="text"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Buscar por nombre o legajo..."
            className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {filteredUsers.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">Sin resultados</p>
            ) : (
              filteredUsers.slice(0, 30).map((u) => {
                const isSelected = selectedUserIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserIds(prev =>
                        isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]
                      );
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent'
                    )}
                  >
                    <div className={cn(
                      'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                      isSelected ? 'bg-primary border-primary' : 'border-input'
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                      {u.nombre.charAt(0)}{u.apellido.charAt(0)}
                    </div>
                    <span className="truncate">{u.nombre} {u.apellido}</span>
                    {u.legajo && <span className="text-xs text-muted-foreground shrink-0">#{u.legajo}</span>}
                    <span className="text-[10px] text-muted-foreground shrink-0">{u.rol}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Asunto</label>
        <input
          type="text"
          value={asunto}
          onChange={(e) => setAsunto(e.target.value)}
          placeholder="Asunto del mensaje..."
          maxLength={200}
          className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Body */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Mensaje</label>
        <textarea
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder="Escribí el mensaje..."
          rows={6}
          maxLength={5000}
          className="w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
        <p className="text-xs text-muted-foreground text-right mt-1">{cuerpo.length}/5000</p>
      </div>

      {/* Options row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* File upload */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Paperclip className="h-4 w-4" />
            Adjuntar archivo
          </button>
          {archivo && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {archivo.name}
              <button onClick={() => setArchivo(null)} className="hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>

        {/* Allow replies toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setPermiteRespuesta(!permiteRespuesta)}
            className={cn(
              'relative w-10 h-5 rounded-full transition-colors',
              permiteRespuesta ? 'bg-primary' : 'bg-muted-foreground/30'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                permiteRespuesta && 'translate-x-5'
              )}
            />
          </button>
          <span className="text-sm text-foreground">Permitir respuestas</span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={() => sendMutation.mutate()}
          disabled={
            !asunto.trim() ||
            !cuerpo.trim() ||
            (destinoTipo === 'USUARIO' && selectedUserIds.length === 0) ||
            (destinoTipo !== 'TODOS' && destinoTipo !== 'USUARIO' && !destinoValor) ||
            sendMutation.isPending
          }
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar mensaje
        </button>
      </div>

      {sendMutation.isError && (
        <p className="text-sm text-red-400">
          Error al enviar: {(sendMutation.error as any)?.response?.data?.error ?? 'Error desconocido'}
        </p>
      )}
    </div>
  );
}
