import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { Bell, Check, X } from 'lucide-react';
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

export default function NotificationBell() {
  const queryClient = useQueryClient();
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

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 rounded-xl border border-border bg-card shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="text-sm font-semibold">Notificaciones</h3>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  className="text-[10px] text-primary hover:underline flex items-center gap-1"
                >
                  <Check className="h-3 w-3" /> Marcar todas
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-accent rounded">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-72">
            {notifs.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">Sin notificaciones</p>
              </div>
            ) : (
              notifs.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.leida) markReadMutation.mutate(n.id);
                    if (n.link) window.location.href = n.link;
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left p-3 border-b border-border/50 hover:bg-muted/20 transition-colors',
                    !n.leida && 'bg-primary/5'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.leida && <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm', !n.leida && 'font-medium')}>{n.titulo}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{n.cuerpo}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
