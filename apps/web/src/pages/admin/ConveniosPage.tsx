import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { Loader2, BookOpen, ChevronRight, DollarSign, Layers } from 'lucide-react';

interface Convenio {
  id: string;
  nombre: string;
  tipo: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  _count: { categorias: number; conceptos: number; usuarios: number };
}

interface ConvenioDetalle extends Convenio {
  categorias: Array<{ id: string; codigo: string; nombre: string; orden: number }>;
  conceptos: Array<{ id: string; codigo: string; nombre: string; tipo: string; orden: number }>;
}

export default function ConveniosPage() {

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: convenios = [], isLoading } = useQuery<Convenio[]>({
    queryKey: ['convenios'],
    queryFn: async () => (await api.get('/admin/convenios')).data,
  });

  const { data: detalle } = useQuery<ConvenioDetalle>({
    queryKey: ['convenio', selectedId],
    queryFn: async () => (await api.get(`/admin/convenios/${selectedId}`)).data,
    enabled: !!selectedId,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Convenios y Categorías</h1>
          <p className="text-sm text-muted-foreground">{convenios.length} convenio{convenios.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Convenios list */}
          <div className="space-y-2">
            {convenios.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'w-full text-left rounded-xl border p-4 transition-colors',
                  selectedId === c.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/20'
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">{c.nombre}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vigente desde {new Date(c.vigenteDesde).toLocaleDateString('es-AR')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {c._count.categorias} cat.</span>
                  <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> {c._count.conceptos} conc.</span>
                </div>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          {detalle ? (
            <div className="lg:col-span-2 space-y-6">
              {/* Categorías */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" />
                  Categorías
                </h2>
                {detalle.categorias.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin categorías</p>
                ) : (
                  <div className="space-y-2">
                    {detalle.categorias.map((cat) => (
                      <div key={cat.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30">
                        <span className="text-xs font-mono font-bold text-primary w-12">{cat.codigo}</span>
                        <span className="text-sm text-foreground">{cat.nombre}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Conceptos */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-400" />
                  Conceptos Salariales
                </h2>
                {detalle.conceptos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin conceptos</p>
                ) : (
                  <div className="space-y-1">
                    {detalle.conceptos.map((con) => (
                      <div key={con.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors">
                        <span className="text-xs font-mono font-bold text-emerald-400 w-12">{con.codigo}</span>
                        <span className="text-sm text-foreground flex-1">{con.nombre}</span>
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs',
                          con.tipo === 'REMUNERATIVO' ? 'bg-emerald-500/20 text-emerald-400' :
                          con.tipo === 'NO_REMUNERATIVO' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        )}>
                          {con.tipo}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2 flex items-center justify-center h-64 text-muted-foreground">
              <div className="text-center">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Seleccioná un convenio para ver sus detalles</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
