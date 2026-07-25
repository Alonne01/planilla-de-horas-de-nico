import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { Shield, Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface RolConfig {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  color: string | null;
  nivel: number;
  esSistema: boolean;
  activo: boolean;
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const dialog = useDialogStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RolConfig | null>(null);

  const { data: roles = [], isLoading } = useQuery<RolConfig[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/admin/roles')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Roles</h1>
          <p className="text-sm text-muted-foreground">
            {roles.length} rol{roles.length !== 1 ? 'es' : ''} configurado{roles.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo rol
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: r.color || '#6B7280' }}
                  >
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{r.nombre}</p>
                    <p className="text-xs font-mono text-muted-foreground">{r.codigo}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditing(r); setShowForm(true); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!r.esSistema && (
                    <button
                      onClick={async () => { if (await dialog.confirm({ message: `¿Eliminar rol "${r.nombre}"?`, variant: 'danger' })) deleteMutation.mutate(r.id); }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{r.descripcion || 'Sin descripción'}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Nivel {r.nivel}</span>
                {r.esSistema && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">SISTEMA</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <RolFormModal
          rol={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['roles'] });
          }}
        />
      )}
    </div>
  );
}

const ESCALONES = [
  {
    min: 0, max: 59, titulo: '0-59 · Solo lo propio',
    items: [
      'Sus propias planillas, ausencias y vacaciones',
      'Sus mensajes y capacitaciones',
      'Crear tarjetas WENTOP propias',
      'La bandeja de Aprobaciones le aparece vacía',
    ],
  },
  {
    min: 60, max: 69, titulo: '60-69 · Supervisión (como SUPERVISOR)',
    items: [
      'Aprobar y rechazar planillas, ausencias, vacaciones y cambios de diagrama',
      'Cargar ausencias en nombre de otro',
      'Marcar compensatorios y validar marcas manuales',
      'Ver analytics de su sector',
      'Alcance: sus subordinados directos',
    ],
  },
  {
    min: 70, max: 74, titulo: '70-74 · Coordinación (como COORDINADOR)',
    items: [
      'Todo lo anterior, con alcance a TODO su sector y no solo a sus directos',
      'Analytics por sector y gestión de diagramas',
      'Capacitaciones y sesiones',
      'Gestionar las tarjetas WENTOP de su sector',
    ],
  },
  {
    min: 75, max: 79, titulo: '75-79 · Sin permisos adicionales',
    items: [
      'A nivel numérico no agrega nada sobre 70-74',
      'El poder de CMASS viene de su código de rol, no de este nivel',
    ],
  },
  {
    min: 80, max: 89, titulo: '80-89 · Gerencia (como GERENTE)',
    items: [
      'A nivel numérico es idéntico a 70-74',
      'GERENTE se distingue por su CÓDIGO en los pasos de flujo y en las notificaciones, no por el número',
    ],
  },
  {
    min: 90, max: 99, titulo: '90-99 · Recursos Humanos (como RRHH)',
    items: [
      'Ve y gestiona a TODA la empresa',
      'Alta, baja y modificación de usuarios; resetear contraseñas',
      'Cerrar planillas; exportaciones y liquidación',
      'Saldos de vacaciones, auditoría, alertas y feriados',
      'Mensajes masivos y Calendario de Equipo siempre',
      'Puede avanzar pasos aunque el sector no tenga flujo configurado',
    ],
  },
  {
    min: 100, max: 100, titulo: '100 · Administrador (no asignable acá)',
    items: [
      'Sectores, Diagramas, Flujos, Roles y Configuración',
      'Backups, reabrir planillas, borrar usuarios y cambiar de sector',
      'Este formulario admite hasta 99: el nivel 100 no se puede asignar',
    ],
  },
];

function NivelHelp({ nivel }: { nivel: number }) {
  return (
    <details className="mt-3 rounded-lg border border-border bg-background/50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
        ¿Qué habilita cada nivel?
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {ESCALONES.map((e) => {
          const activo = nivel >= e.min && nivel <= e.max;
          return (
            <div
              key={e.titulo}
              className={cn(
                'rounded-md border p-2 text-xs',
                activo ? 'border-primary bg-primary/10' : 'border-transparent opacity-60',
                e.min === 100 && 'opacity-40',
              )}
            >
              <p className="font-medium text-foreground">{e.titulo}</p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {e.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          );
        })}

        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <p className="font-medium text-foreground">El nivel no alcanza para todo</p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            <li>
              <strong>Aprobar depende del código del rol</strong>, no del nivel: el rol tiene que
              figurar como aprobador en algún paso de un flujo (Administración &gt; Flujos).
            </li>
            <li>Ver todas las tarjetas WENTOP es exclusivo del código CMASS o de nivel 90 o más.</li>
            <li>El nivel se lee al iniciar sesión: si lo cambiás, el usuario tiene que volver a entrar.</li>
          </ul>
        </div>
      </div>
    </details>
  );
}

function RolFormModal({ rol, onClose, onSuccess }: { rol: RolConfig | null; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!rol;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    codigo: rol?.codigo ?? '',
    nombre: rol?.nombre ?? '',
    descripcion: rol?.descripcion ?? '',
    color: rol?.color ?? '#6B7280',
    nivel: rol?.nivel ?? 50,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/admin/roles/${rol.id}`, {
          nombre: form.nombre,
          descripcion: form.descripcion || null,
          color: form.color,
          nivel: form.nivel,
        });
      } else {
        await api.post('/admin/roles', form);
      }
      onSuccess();
    } catch (err: unknown) {
      setError(mensajeDeError(err).mensaje);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar rol' : 'Nuevo rol'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Código *</label>
              <input className={inputClass} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required placeholder="Ej: CAPATAZ" />
              <p className="text-[10px] text-muted-foreground mt-1">Se convierte automáticamente a mayúsculas</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
            <input className={inputClass} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required placeholder="Ej: Capataz de Operaciones" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción</label>
            <textarea className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground text-sm resize-none" rows={2}
              value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Permisos y funciones del rol" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-input cursor-pointer" />
                <input className={inputClass} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nivel (0-99)</label>
              <input type="number" min="0" max="99" className={cn(inputClass, rol?.esSistema && 'opacity-50 cursor-not-allowed')}
                disabled={!!rol?.esSistema}
                value={form.nivel} onChange={(e) => setForm({ ...form, nivel: parseInt(e.target.value) || 0 })} />
              {rol?.esSistema ? (
                <p className="text-[10px] text-muted-foreground mt-1">Los roles del sistema no permiten cambiar el nivel.</p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">Mayor = más permisos</p>
              )}
            </div>
          </div>

          <NivelHelp nivel={form.nivel} />

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar' : 'Crear rol'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
