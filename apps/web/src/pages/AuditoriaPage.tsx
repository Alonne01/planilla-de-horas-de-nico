import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  Loader2, Shield, FileText, Palmtree, AlertTriangle, PenLine,
  Filter, ChevronDown, Clock, Settings,
} from 'lucide-react';

interface AuditEntry {
  id: string;
  tipo: 'PLANILLA' | 'VACACION' | 'AUSENCIA' | 'RECIBO_FIRMA' | 'ADMIN';
  entidadId: string;
  entidadLabel: string;
  estadoAnterior: string | null;
  estadoNuevo: string;
  paso: number | null;
  comentario: string | null;
  usuario: { id: string; nombre: string; apellido: string };
  createdAt: string;
}

interface AuditStats {
  ultimos30Dias: { planillas: number; vacaciones: number; ausencias: number; recibos: number; admin: number; total: number };
}

const TIPO_ICONS: Record<string, React.ElementType> = {
  PLANILLA: FileText,
  VACACION: Palmtree,
  AUSENCIA: AlertTriangle,
  RECIBO_FIRMA: PenLine,
  ADMIN: Settings,
};

const TIPO_COLORS: Record<string, string> = {
  PLANILLA: 'bg-blue-500/15 text-blue-400',
  VACACION: 'bg-emerald-500/15 text-emerald-400',
  AUSENCIA: 'bg-amber-500/15 text-amber-400',
  RECIBO_FIRMA: 'bg-purple-500/15 text-purple-400',
  ADMIN: 'bg-rose-500/15 text-rose-400',
};

export default function AuditoriaPage() {
  const [tipo, setTipo] = useState('');
  const [limit, setLimit] = useState(50);

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ['auditoria-stats'],
    queryFn: () => api.get('/auditoria/stats').then((r) => r.data),
  });

  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['auditoria', tipo, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tipo) params.set('tipo', tipo);
      params.set('limit', String(limit));
      return api.get(`/auditoria?${params}`).then((r) => r.data);
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Shield className="h-6 w-6 text-primary" />
        Auditoría
      </h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total (30d)', value: stats.ultimos30Dias.total, color: 'text-foreground' },
            { label: 'Planillas', value: stats.ultimos30Dias.planillas, color: 'text-blue-400' },
            { label: 'Vacaciones', value: stats.ultimos30Dias.vacaciones, color: 'text-emerald-400' },
            { label: 'Ausencias', value: stats.ultimos30Dias.ausencias, color: 'text-amber-400' },
            { label: 'Recibos', value: stats.ultimos30Dias.recibos, color: 'text-purple-400' },
            { label: 'Admin', value: stats.ultimos30Dias.admin, color: 'text-rose-400' },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4 text-center">
              <p className={cn('text-2xl font-bold', k.color)}>{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">Todos los tipos</option>
          <option value="planilla">Planillas</option>
          <option value="vacacion">Vacaciones</option>
          <option value="ausencia">Ausencias</option>
          <option value="recibo">Recibos</option>
          <option value="admin">Admin (Sueldos/Conceptos)</option>
        </select>
      </div>

      {/* Log entries */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !entries?.length ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Shield className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">No hay registros de auditoría</p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => {
            const Icon = TIPO_ICONS[e.tipo] ?? FileText;
            const colors = TIPO_COLORS[e.tipo] ?? 'bg-slate-500/15 text-slate-400';
            return (
              <div key={e.id} className="rounded-lg border border-border/50 bg-card p-3 flex items-start gap-3">
                <div className={cn('p-1.5 rounded-lg mt-0.5', colors)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{e.usuario.apellido}, {e.usuario.nombre}</span>
                    {' · '}
                    <span className="text-muted-foreground">{e.entidadLabel}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {e.estadoAnterior && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
                        {e.estadoAnterior}
                      </span>
                    )}
                    {e.estadoAnterior && <span className="text-[10px] text-muted-foreground">→</span>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                      {e.estadoNuevo}
                    </span>
                    {e.paso != null && (
                      <span className="text-[10px] text-muted-foreground">Paso {e.paso}</span>
                    )}
                    {e.comentario && (
                      <span className="text-[10px] text-muted-foreground italic truncate max-w-xs">
                        "{e.comentario}"
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(e.createdAt).toLocaleDateString('es-AR')}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(e.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Load more */}
          {entries.length >= limit && (
            <button
              onClick={() => setLimit((l) => l + 50)}
              className="w-full py-3 text-sm text-primary hover:underline flex items-center justify-center gap-1"
            >
              <ChevronDown className="h-4 w-4" /> Cargar más
            </button>
          )}
        </div>
      )}
    </div>
  );
}
