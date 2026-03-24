import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Loader2, Bell, Plus, Trash2, Power, Pencil, X, Save } from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

interface AlertaConfig {
  id: string;
  tipo: string;
  activa: boolean;
  diasAnticipacion: number | null;
  horasLimite: number | null;
  rolesDestino: string[];
  descripcion: string | null;
  createdAt: string;
}

const TIPOS_ALERTA = [
  { value: 'RECORDATORIO_CARGA_PLANILLA', label: 'Recordatorio carga planilla', desc: 'Recuerda cargar la planilla X días antes del cierre' },
  { value: 'PLANILLA_SIN_REVISAR', label: 'Planilla sin revisar', desc: 'Alerta si una planilla lleva X horas sin ser revisada' },
  { value: 'CIERRE_SIN_APROBAR', label: 'Cierre sin aprobar', desc: 'Avisa si quedan planillas sin aprobar antes del cierre' },
  { value: 'VACACIONES_VENCIDAS', label: 'Vacaciones no usadas', desc: 'Alerta si un empleado tiene más de X días sin usar' },
  { value: 'CAPACITACION_VENCIDA', label: 'Capacitación por vencer', desc: 'Avisa X días antes de que venza una capacitación' },
  { value: 'AUSENCIAS_FRECUENTES', label: 'Ausencias frecuentes', desc: 'Alerta si un empleado supera X ausencias en el período' },
  { value: 'EXCESO_HORAS_EXTRA', label: 'Exceso horas extra', desc: 'Alerta si un empleado supera X horas extra en el período' },
  { value: 'VENCIMIENTO_CONTRATO', label: 'Vencimiento de contrato', desc: 'Avisa X días antes de que venza un contrato' },
];

const ROLES = ['OPERADOR', 'SUPERVISOR', 'COORDINADOR', 'GERENTE', 'RRHH', 'ADMIN'];

export default function AlertasPage() {
  const qc = useQueryClient();
  const dialog = useDialogStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    tipo: TIPOS_ALERTA[0].value,
    diasAnticipacion: '',
    horasLimite: '',
    rolesDestino: ['RRHH'] as string[],
    descripcion: '',
  });

  const { data: alertas, isLoading } = useQuery<AlertaConfig[]>({
    queryKey: ['alertas-config'],
    queryFn: () => api.get('/admin/alertas').then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => editingId
      ? api.put(`/admin/alertas/${editingId}`, body)
      : api.post('/admin/alertas', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertas-config'] });
      resetForm();
    },
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/alertas/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas-config'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/alertas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas-config'] }),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ tipo: TIPOS_ALERTA[0].value, diasAnticipacion: '', horasLimite: '', rolesDestino: ['RRHH'], descripcion: '' });
  };

  const openEdit = (a: AlertaConfig) => {
    setEditingId(a.id);
    setForm({
      tipo: a.tipo,
      diasAnticipacion: a.diasAnticipacion?.toString() ?? '',
      horasLimite: a.horasLimite?.toString() ?? '',
      rolesDestino: a.rolesDestino,
      descripcion: a.descripcion ?? '',
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    createMut.mutate({
      tipo: form.tipo,
      diasAnticipacion: form.diasAnticipacion ? Number(form.diasAnticipacion) : null,
      horasLimite: form.horasLimite ? Number(form.horasLimite) : null,
      rolesDestino: form.rolesDestino,
      descripcion: form.descripcion || null,
    });
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      rolesDestino: f.rolesDestino.includes(role)
        ? f.rolesDestino.filter((r) => r !== role)
        : [...f.rolesDestino, role],
    }));
  };

  const tipoInfo = (tipo: string) => TIPOS_ALERTA.find((t) => t.value === tipo);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          Alertas Configurables
        </h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nueva alerta
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{editingId ? 'Editar alerta' : 'Nueva alerta'}</h2>
            <button onClick={resetForm} className="p-1 rounded hover:bg-muted/50">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de alerta</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {TIPOS_ALERTA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">{tipoInfo(form.tipo)?.desc}</p>
            </div>

            {/* Días anticipación */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Días de anticipación</label>
              <input
                type="number"
                min={0}
                value={form.diasAnticipacion}
                onChange={(e) => setForm((f) => ({ ...f, diasAnticipacion: e.target.value }))}
                placeholder="Ej: 7"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Horas límite */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Horas límite</label>
              <input
                type="number"
                min={0}
                value={form.horasLimite}
                onChange={(e) => setForm((f) => ({ ...f, horasLimite: e.target.value }))}
                placeholder="Ej: 48"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            {/* Descripción */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Descripción</label>
              <input
                type="text"
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Roles destino */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Roles destino</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    form.rolesDestino.includes(role)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="px-4 py-2 rounded-lg text-sm hover:bg-muted/50">
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={createMut.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? 'Guardar cambios' : 'Crear alerta'}
            </button>
          </div>
        </div>
      )}

      {/* Alertas list */}
      {!alertas?.length ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">No hay alertas configuradas</p>
          <p className="text-xs text-muted-foreground mt-1">Creá una alerta para recibir notificaciones automáticas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alertas.map((a) => {
            const info = tipoInfo(a.tipo);
            return (
              <div
                key={a.id}
                className={cn(
                  'rounded-xl border border-border bg-card p-4 flex items-center gap-4 transition-opacity',
                  !a.activa && 'opacity-50'
                )}
              >
                {/* Status indicator */}
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', a.activa ? 'bg-emerald-500' : 'bg-slate-500')} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{info?.label ?? a.tipo}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {a.descripcion || info?.desc}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    {a.diasAnticipacion != null && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">{a.diasAnticipacion} días</span>
                    )}
                    {a.horasLimite != null && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">{a.horasLimite}h límite</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      → {a.rolesDestino.join(', ')}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleMut.mutate(a.id)}
                    className={cn(
                      'p-2 rounded-lg transition-colors',
                      a.activa ? 'text-emerald-400 hover:bg-emerald-500/15' : 'text-muted-foreground hover:bg-muted/50'
                    )}
                    title={a.activa ? 'Desactivar' : 'Activar'}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openEdit(a)}
                    className="p-2 rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => { if (await dialog.confirm({ message: '¿Eliminar esta alerta?', variant: 'danger' })) deleteMut.mutate(a.id); }}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-500/15 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
