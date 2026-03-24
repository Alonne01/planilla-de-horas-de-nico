import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { DIAGRAMA_CARD_BG } from '@/constants/planillaConstants';
import { useAuthStore } from '@/stores/authStore';
import { Users, Search, Mail, Calendar, Briefcase, ChevronDown } from 'lucide-react';

interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  rol: string;
  legajo: string | null;
  activo: boolean;
  tipoContrato: string;
  fechaIngreso: string;
  primerLogin: boolean;
  diagramaColor: string | null;
  sector: { id: string; nombre: string } | null;
  categoria: { id: string; codigo: string; nombre: string } | null;
  convenio: { id: string; nombre: string } | null;
}

const ROL_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-500/20 text-red-400',
  RRHH: 'bg-purple-500/20 text-purple-400',
  GERENTE: 'bg-amber-500/20 text-amber-400',
  COORDINADOR: 'bg-blue-500/20 text-blue-400',
  SUPERVISOR: 'bg-emerald-500/20 text-emerald-400',
  OPERADOR: 'bg-slate-500/20 text-slate-400',
};

const DIAGRAMA_BADGE: Record<string, string> = {
  AZUL: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  AMARILLO: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  BASE: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const DIAGRAMA_LABEL: Record<string, string> = {
  AZUL: '🔵 Azul',
  AMARILLO: '🟡 Amarillo',
  BASE: '🏢 Base',
};

const DIAGRAMA_OPTIONS = [
  { value: '', label: 'Sin asignar' },
  { value: 'AZUL', label: '🔵 Azul' },
  { value: 'AMARILLO', label: '🟡 Amarillo' },
  { value: 'BASE', label: '🏢 Base' },
];

export default function EquipoPage() {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const isWellTesting = user?.sectorNombre?.toLowerCase().includes('testing');
  const canEditDiagrama = isWellTesting && user?.rol === 'COORDINADOR';

  const { data: empleados = [], isLoading } = useQuery<Empleado[]>({
    queryKey: ['equipo'],
    queryFn: async () => (await api.get('/usuarios?activo=true')).data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const filtered = empleados.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.nombre.toLowerCase().includes(q) ||
      e.apellido.toLowerCase().includes(q) ||
      e.legajo?.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      e.rol.toLowerCase().includes(q)
    );
  });

  const handleDiagramaChange = async (empId: string, value: string) => {
    setSaving(empId);
    try {
      await api.patch(`/usuarios/${empId}/diagrama-color`, { diagramaColor: value || null });
      queryClient.setQueryData<Empleado[]>(['equipo'], (old) =>
        old?.map((e) => (e.id === empId ? { ...e, diagramaColor: value || null } : e))
      );
    } catch (err) {
      console.error('Error updating diagrama color:', err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Mi Equipo
        </h1>
        <span className="text-sm text-muted-foreground">{filtered.length} empleados</span>
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por nombre, legajo, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">No se encontraron empleados</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp) => (
            <div
              key={emp.id}
              className={cn(
                'rounded-xl border p-4 space-y-2 transition-colors',
                isWellTesting && emp.diagramaColor && DIAGRAMA_CARD_BG[emp.diagramaColor]
                  ? DIAGRAMA_CARD_BG[emp.diagramaColor]
                  : 'border-border bg-card hover:border-primary/30',
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{emp.apellido}, {emp.nombre}</p>
                  {emp.legajo && (
                    <p className="text-[10px] text-muted-foreground">Legajo: {emp.legajo}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', ROL_COLORS[emp.rol])}>
                    {emp.rol}
                  </span>
                  {isWellTesting && emp.diagramaColor && !canEditDiagrama && (
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', DIAGRAMA_BADGE[emp.diagramaColor])}>
                      {DIAGRAMA_LABEL[emp.diagramaColor] ?? emp.diagramaColor}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Mail className="h-3 w-3" /> {emp.email}
                </p>
                {emp.sector && (
                  <p className="flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3" /> {emp.sector.nombre}
                  </p>
                )}
                {emp.categoria && (
                  <p className="flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3" /> {emp.categoria.nombre}
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" /> Ingreso: {new Date(emp.fechaIngreso).toLocaleDateString('es-AR')}
                </p>
              </div>

              {/* Diagrama color selector — only for COORDINADOR of Well Testing */}
              {canEditDiagrama && (
                <div className="pt-1 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">Diagrama:</span>
                    <div className="relative flex-1">
                      <select
                        value={emp.diagramaColor ?? ''}
                        onChange={(e) => handleDiagramaChange(emp.id, e.target.value)}
                        disabled={saving === emp.id}
                        className={cn(
                          'w-full h-7 pl-2 pr-6 rounded-md border text-[11px] font-medium appearance-none bg-card focus:outline-none focus:ring-1 focus:ring-ring',
                          emp.diagramaColor === 'AZUL' && 'border-blue-500/40 text-blue-400',
                          emp.diagramaColor === 'AMARILLO' && 'border-yellow-500/40 text-yellow-400',
                          emp.diagramaColor === 'BASE' && 'border-slate-500/40 text-slate-300',
                          !emp.diagramaColor && 'border-border text-muted-foreground',
                          saving === emp.id && 'opacity-50',
                        )}
                      >
                        {DIAGRAMA_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
              )}

              {/* Diagrama badge for non-coordinadores in Well Testing (read-only) */}
              {isWellTesting && !canEditDiagrama && emp.diagramaColor && (
                <div className="pt-1 border-t border-border/50">
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border', DIAGRAMA_BADGE[emp.diagramaColor])}>
                    {DIAGRAMA_LABEL[emp.diagramaColor] ?? emp.diagramaColor}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
