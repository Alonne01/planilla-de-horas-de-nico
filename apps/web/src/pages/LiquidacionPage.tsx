import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Download, Loader2, FileSpreadsheet } from 'lucide-react';

interface Sector { id: string; nombre: string }
interface Usuario { id: string; nombre: string; apellido: string; legajo: string | null; sector: { id: string; nombre: string } | null }

const FORMATOS = [
  { id: 'tango', label: 'Tango', desc: 'Archivo TXT delimitado por pipes (|)', ext: '.txt' },
  { id: 'bejerman', label: 'Bejerman', desc: 'Archivo CSV delimitado por punto y coma (;)', ext: '.csv' },
  { id: 'general', label: 'General CSV', desc: 'CSV completo con todos los datos del período', ext: '.csv' },
];

export default function LiquidacionPage() {
  const [formato, setFormato] = useState('general');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFin, setPeriodoFin] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const { data: sectores } = useQuery<Sector[]>({
    queryKey: ['sectores-liq'],
    queryFn: () => api.get('/admin/sectores').then((r) => r.data),
  });

  const { data: usuarios } = useQuery<Usuario[]>({
    queryKey: ['usuarios-liq'],
    queryFn: () => api.get('/usuarios?activo=true').then((r) => r.data),
  });

  const filteredUsuarios = (usuarios ?? []).filter(
    (u) => !sectorId || u.sector?.id === sectorId
  );

  const handleExport = async () => {
    if (!periodoInicio || !periodoFin) {
      setError('Seleccioná el período');
      return;
    }
    setError('');
    setDownloading(true);
    try {
      const res = await api.post(`/liquidacion/${formato}`, {
        periodoInicio,
        periodoFin,
        ...(sectorId ? { sectorId } : {}),
        ...(usuarioId ? { usuarioId } : {}),
      }, { responseType: 'blob' });

      // Download
      const blob = new Blob([res.data], { type: res.headers['content-type'] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = FORMATOS.find((f) => f.id === formato)?.ext ?? '.csv';
      a.download = `liquidacion_${formato}_${periodoInicio.slice(0, 10)}${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Error al exportar');
    } finally {
      setDownloading(false);
    }
  };

  const selectedFormato = FORMATOS.find((f) => f.id === formato)!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <FileSpreadsheet className="h-6 w-6 text-primary" />
        Integración Liquidación
      </h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-6">
        {/* Formato selector */}
        <div>
          <label className="text-sm font-medium text-foreground mb-3 block">Formato de exportación</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FORMATOS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormato(f.id)}
                className={cn(
                  'p-4 rounded-xl border text-left transition-all',
                  formato === f.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border hover:border-muted-foreground/30'
                )}
              >
                <p className="text-sm font-semibold">{f.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Period */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Período inicio</label>
            <input
              type="date"
              value={periodoInicio}
              onChange={(e) => setPeriodoInicio(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Período fin</label>
            <input
              type="date"
              value={periodoFin}
              onChange={(e) => setPeriodoFin(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Sector filter */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Sector (opcional)</label>
          <select
            value={sectorId}
            onChange={(e) => { setSectorId(e.target.value); setUsuarioId(''); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm w-full sm:w-auto"
          >
            <option value="">Todos los sectores</option>
            {(sectores ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Employee filter */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Empleado (opcional)</label>
          <select
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm w-full sm:w-auto"
          >
            <option value="">Todos los empleados</option>
            {filteredUsuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.apellido} {u.nombre}{u.legajo ? ` (${u.legajo})` : ''}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={downloading}
          className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Exportar {selectedFormato.label}
        </button>
      </div>

      {/* Info section */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Formatos disponibles</h2>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Tango Gestión</p>
            <p className="text-xs text-muted-foreground">
              Archivo TXT con campos separados por pipe (|). Incluye: legajo, CUIL, nombre, concepto, cantidad, monto, sector.
              Compatible con la importación de novedades de Tango.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Bejerman ERP</p>
            <p className="text-xs text-muted-foreground">
              Archivo CSV con campos separados por punto y coma (;). Incluye: CUIL, legajo, código concepto, cantidad, importe.
              Usar los códigos de concepto para mapear en Bejerman.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">General CSV</p>
            <p className="text-xs text-muted-foreground">
              CSV completo con todos los datos: legajo, CUIL, DNI, sector, categoría, convenio, horas desglosadas,
              días campo/base, neto estimado, estado de firma de recibo. Apto para cualquier sistema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
