import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { Settings, Save, Loader2, Clock, Calendar, MapPin } from 'lucide-react';

interface EmpresaConfig {
  id: string;
  empresaId: string;
  periodoDiaInicio: number;
  periodoDiaFin: number;
  umbralExtra50: number;
  umbralExtra100: number;
  horasJornadaNormal: number;
  descuentoAlmuerzoMinutos: number;
  descuentoAlmuerzoCampo: boolean;
  redondeoMinutos: number;
  horasViajeDefault: number;
  tarifaViajeManeja: number;
  tarifaViajeSinManejar: number;
  zonaHoraria: string;
  moneda: string;
}

export default function ConfigPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery<EmpresaConfig>({
    queryKey: ['admin-config'],
    queryFn: async () => (await api.get('/admin/config')).data,
  });

  const [form, setForm] = useState<Partial<EmpresaConfig>>({});

  // Initialize form when data loads
  const currentConfig = { ...config, ...form };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<EmpresaConfig>) => api.put('/admin/config', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setForm({});
    },
  });

  const handleChange = (field: string, value: number | boolean | string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (Object.keys(form).length === 0) return;
    saveMutation.mutate(form);
  };

  if (isLoading || !config) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const inputClass = 'h-9 px-3 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring w-full';
  const hasChanges = Object.keys(form).length > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" /> Configuración
          </h1>
          <p className="text-sm text-muted-foreground">Parámetros de cálculo de horas y períodos</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? '✓ Guardado' : 'Guardar cambios'}
        </button>
      </div>

      {/* Período */}
      <Section title="Período de planilla" icon={<Calendar className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Día inicio del período">
            <input
              type="number" min="1" max="31" className={inputClass}
              value={currentConfig.periodoDiaInicio ?? ''}
              onChange={(e) => handleChange('periodoDiaInicio', parseInt(e.target.value))}
            />
          </Field>
          <Field label="Día fin del período">
            <input
              type="number" min="1" max="31" className={inputClass}
              value={currentConfig.periodoDiaFin ?? ''}
              onChange={(e) => handleChange('periodoDiaFin', parseInt(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      {/* Horas */}
      <Section title="Umbrales de horas" icon={<Clock className="h-4 w-4" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Jornada normal (hs)">
            <input
              type="number" min="0" max="24" step="0.5" className={inputClass}
              value={currentConfig.horasJornadaNormal ?? ''}
              onChange={(e) => handleChange('horasJornadaNormal', parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Umbral Extra 50% (hs)">
            <input
              type="number" min="0" max="24" step="0.5" className={inputClass}
              value={currentConfig.umbralExtra50 ?? ''}
              onChange={(e) => handleChange('umbralExtra50', parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Umbral Extra 100% (hs)">
            <input
              type="number" min="0" max="24" step="0.5" className={inputClass}
              value={currentConfig.umbralExtra100 ?? ''}
              onChange={(e) => handleChange('umbralExtra100', parseFloat(e.target.value))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Normal: 0 → {currentConfig.umbralExtra50}h · Extra 50%: {currentConfig.umbralExtra50} → {currentConfig.umbralExtra100}h · Extra 100%: &gt;{currentConfig.umbralExtra100}h
        </p>
      </Section>

      {/* Almuerzo y redondeo */}
      <Section title="Almuerzo y redondeo" icon={<Clock className="h-4 w-4" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Descuento almuerzo (min)">
            <input
              type="number" min="0" max="120" className={inputClass}
              value={currentConfig.descuentoAlmuerzoMinutos ?? ''}
              onChange={(e) => handleChange('descuentoAlmuerzoMinutos', parseInt(e.target.value))}
            />
          </Field>
          <Field label="¿Descuenta almuerzo en campo?">
            <label className="flex items-center gap-2 h-9 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={currentConfig.descuentoAlmuerzoCampo ?? false}
                onChange={(e) => handleChange('descuentoAlmuerzoCampo', e.target.checked)}
                className="rounded border-input"
              />
              {currentConfig.descuentoAlmuerzoCampo ? 'Sí' : 'No'}
            </label>
          </Field>
          <Field label="Redondeo (min)">
            <input
              type="number" min="1" max="60" className={inputClass}
              value={currentConfig.redondeoMinutos ?? ''}
              onChange={(e) => handleChange('redondeoMinutos', parseInt(e.target.value))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground mt-2">El descuento de almuerzo aplica solo en Base por defecto. Active la opción si también aplica en Campo.</p>
      </Section>

      {/* Viaje */}
      <Section title="Viaje" icon={<MapPin className="h-4 w-4" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Horas viaje default">
            <input
              type="number" min="0" max="24" step="0.5" className={inputClass}
              value={currentConfig.horasViajeDefault ?? ''}
              onChange={(e) => handleChange('horasViajeDefault', parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Tarifa viaje manejando ($/hr)">
            <input
              type="number" min="0" step="0.01" className={inputClass}
              value={currentConfig.tarifaViajeManeja ?? ''}
              onChange={(e) => handleChange('tarifaViajeManeja', parseFloat(e.target.value))}
            />
          </Field>
          <Field label="Tarifa viaje sin manejar ($/hr)">
            <input
              type="number" min="0" step="0.01" className={inputClass}
              value={currentConfig.tarifaViajeSinManejar ?? ''}
              onChange={(e) => handleChange('tarifaViajeSinManejar', parseFloat(e.target.value))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Las tarifas se usan para calcular el costo del viaje según si el empleado maneja o no.
        </p>
      </Section>

      {/* Zona */}
      <Section title="Zona y moneda" icon={<MapPin className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Zona horaria">
            <input
              className={inputClass}
              value={currentConfig.zonaHoraria ?? ''}
              onChange={(e) => handleChange('zonaHoraria', e.target.value)}
            />
          </Field>
          <Field label="Moneda">
            <input
              className={inputClass}
              value={currentConfig.moneda ?? ''}
              onChange={(e) => handleChange('moneda', e.target.value)}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-4">{icon} {title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
