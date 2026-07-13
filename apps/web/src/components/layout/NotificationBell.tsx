import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { Bell, Check, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  link: string | null;
  leida: boolean;
  createdAt: string;
}

export default function NotificationBell({ collapsed = false }: { collapsed?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ['notif-count'],
    queryFn: async () => (await api.get('/notificaciones/count')).data,
    refetchInterval: 30000,
  });

  const { data: notifs = [] } = useQuery<Notificacion[]>({
    queryKey: ['notificaciones'],
    queryFn: async () => (await api.get('/notificaciones')).data,
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notificaciones/${id}/leer`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.put('/notificaciones/leer-todas'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notificaciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => api.delete('/notificaciones'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['notif-count'] });
    },
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unread = countData?.count ?? 0;

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[99] transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setOpen(false)}
      />

      {/* Panel — viewport-anchored on desktop so the header (with mark/clear all) is always visible */}
      <div
        className={cn(
          'fixed left-2 right-2 top-[3.75rem] z-[100] mx-auto max-w-sm flex flex-col',
          'lg:fixed lg:top-auto lg:right-auto lg:bottom-4 lg:mx-0 lg:w-96 lg:max-w-none',
          collapsed ? 'lg:left-[4.5rem]' : 'lg:left-[16.5rem]',
          'max-h-[80vh] lg:max-h-[calc(100dvh-2rem)] rounded-xl border border-border bg-card shadow-2xl overflow-hidden',
          'transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'origin-top lg:origin-bottom-left',
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 -translate-y-2 lg:translate-y-2 pointer-events-none'
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold">Notificaciones</h3>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                <Check className="h-3 w-3" /> Marcar todo leído
              </button>
            )}
            {notifs.length > 0 && (
              <button
                onClick={() => clearAllMutation.mutate()}
                title="Borrar todas"
                className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Borrar todas
              </button>
            )}
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-accent rounded">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {notifs.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Sin notificaciones</p>
            </div>
          ) : (
            notifs.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'group relative flex items-start gap-1 p-3 border-b border-border/50 hover:bg-muted/20 transition-colors',
                  !n.leida && 'bg-primary/5'
                )}
              >
                <button
                  onClick={() => {
                    if (!n.leida) markReadMutation.mutate(n.id);
                    if (n.link) navigate(n.link);
                    setOpen(false);
                  }}
                  className="flex items-start gap-2 flex-1 min-w-0 text-left"
                >
                  {!n.leida && <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm truncate', !n.leida && 'font-medium')}>{n.titulo}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">{n.cuerpo}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
                <div className="flex items-center gap-0.5 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                  {!n.leida && (
                    <button
                      onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(n.id); }}
                      title="Marcar como leída"
                      aria-label="Marcar como leída"
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(n.id); }}
                    title="Borrar notificación"
                    aria-label="Borrar notificación"
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
