import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Globe } from 'lucide-react';
import api from '@/services/api';
import { cn } from '@/lib/utils';
import { mensajeDeError } from '@/lib/errores';
import { toast } from '@/stores/toastStore';
import { asignacionDeAlcance, flujoVigente } from '@/utils/asignaciones';
import {
  TIPOS_DOCUMENTO,
  cadenaDe,
  type Asignacion,
  type Flujo,
  type Rol,
  type Sector,
} from './flujos.shared';

/**
 * Qué flujo rige cada sector, para cada tipo de trámite, en una sola vista.
 *
 * La pantalla de flujos mira desde el otro lado —un flujo y los sectores que lo
 * usan—, y para responder "¿qué circuito tiene Logística para vacaciones?" hay
 * que abrir los flujos de a uno. Acá la pregunta se responde de un vistazo, y el
 * cambio se hace en el mismo lugar donde se ve el problema.
 *
 * Cada celda se guarda contra `PUT /admin/flujos/asignaciones/alcance`, que
 * reemplaza la asignación anterior en una transacción. Con el DELETE + POST que
 * había antes, el sector se quedaba sin flujo entre los dos pedidos.
 */

interface Props {
  flujos: Flujo[];
  sectores: Sector[];
  asignaciones: Asignacion[];
  roles: Rol[];
}

/** Identifica una celda, para saber cuál está guardando. */
const claveCelda = (tipoDocumento: string, sectorId: string | null) => `${tipoDocumento}:${sectorId ?? ''}`;

/** El alcance global se dibuja como una fila más, arriba de todo. */
const FILA_GLOBAL = { id: null, nombre: 'Todos los sectores' };

export default function MatrizFlujos({ flujos, sectores, asignaciones, roles }: Props) {
  const queryClient = useQueryClient();
  const [guardando, setGuardando] = useState<string | null>(null);

  const setAlcance = useMutation({
    mutationFn: (v: { tipoDocumento: string; sectorId: string | null; flujoId: string | null }) =>
      api.put('/admin/flujos/asignaciones/alcance', v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-flujos-asignaciones'] });
      queryClient.invalidateQueries({ queryKey: ['admin-flujos'] });
    },
    onError: (err) => {
      toast({
        title: 'No se pudo cambiar el flujo',
        description: mensajeDeError(err).mensaje,
        variant: 'destructive',
      });
    },
    onSettled: () => setGuardando(null),
  });

  const filas = [FILA_GLOBAL, ...sectores.filter((s) => s.activo)];

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Qué flujo rige cada sector</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Un sector puede usar un circuito distinto para cada trámite. Lo que elijas acá es la
          cadena completa; al enviar un documento se saltean los pasos de nivel menor o igual al
          de quien lo envía.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-background/50">
              <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 sticky left-0 bg-card z-10 min-w-[11rem]">
                Sector
              </th>
              {TIPOS_DOCUMENTO.map((t) => (
                <th key={t.valor} className="text-left text-xs font-medium text-muted-foreground px-3 py-2 min-w-[15rem]">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((sector) => (
              <tr
                key={sector.id ?? 'global'}
                className={cn(
                  'align-top',
                  // El global no es un sector más: es de lo que heredan todos
                  // los que no tienen flujo propio, así que se separa del resto
                  // con una línea más marcada en vez de con un fondo (la primera
                  // columna es sticky y necesita fondo opaco propio).
                  sector.id === null
                    ? 'border-b-2 border-primary/40'
                    : 'border-b border-border/50 last:border-0',
                )}
              >
                <td className="px-3 py-2 font-medium sticky left-0 z-10 bg-card">
                  <span className="flex items-center gap-1.5">
                    {sector.id === null && <Globe className="h-3.5 w-3.5 text-primary shrink-0" />}
                    {sector.nombre}
                  </span>
                  {sector.id === null && (
                    <span className="block text-[10px] font-normal text-muted-foreground mt-0.5">
                      se aplica a los que no tengan uno propio
                    </span>
                  )}
                </td>

                {TIPOS_DOCUMENTO.map((t) => (
                  <td key={t.valor} className="px-3 py-2">
                    <Celda
                      tipoDocumento={t.valor}
                      sectorId={sector.id}
                      flujos={flujos}
                      asignaciones={asignaciones}
                      roles={roles}
                      guardando={guardando === claveCelda(t.valor, sector.id)}
                      onElegir={(flujoId) => {
                        setGuardando(claveCelda(t.valor, sector.id));
                        setAlcance.mutate({ tipoDocumento: t.valor, sectorId: sector.id, flujoId });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Un sector sin flujo propio usa el global. Si tampoco hay global, el documento se envía sin
        circuito y solo lo puede aprobar RRHH o un administrador.
      </p>
    </div>
  );
}

// ─── Una celda ────────────────────────────────────────────────────

function Celda({
  tipoDocumento,
  sectorId,
  flujos,
  asignaciones,
  roles,
  guardando,
  onElegir,
}: {
  tipoDocumento: string;
  sectorId: string | null;
  flujos: Flujo[];
  asignaciones: Asignacion[];
  roles: Rol[];
  guardando: boolean;
  onElegir: (flujoId: string | null) => void;
}) {
  // Lo CONFIGURADO y lo VIGENTE no siempre coinciden: una asignación a un flujo
  // desactivado sigue existiendo (y hay que poder verla para corregirla), pero
  // el servidor la ignora y el sector cae al global.
  const configurada = asignacionDeAlcance(asignaciones, tipoDocumento, sectorId);
  const vigente = flujoVigente(flujos, asignaciones, tipoDocumento, sectorId);

  // Los inactivos no se ofrecen, pero el que ya está elegido tiene que estar en
  // la lista: sin su <option>, el <select> caería solo en otro valor y el
  // próximo cambio guardaría un flujo que nadie eligió.
  const opciones = flujos.filter(
    (f) => f.tipoDocumento === tipoDocumento && (f.activo || f.id === configurada?.flujoId),
  );

  const flujoConfigurado = flujos.find((f) => f.id === configurada?.flujoId);
  const configuradaRota = !!configurada && (!flujoConfigurado || !flujoConfigurado.activo);

  return (
    <div className="space-y-1">
      <div className="relative">
        <select
          value={configurada?.flujoId ?? ''}
          disabled={guardando}
          onChange={(e) => onElegir(e.target.value || null)}
          className={cn(
            'w-full h-8 pl-2 pr-7 rounded-lg border bg-background text-foreground text-xs',
            'focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
            configuradaRota ? 'border-amber-500/60' : 'border-input',
          )}
        >
          <option value="">
            {sectorId === null ? '— sin flujo global —' : '— hereda el global —'}
          </option>
          {opciones.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre}{f.activo ? '' : ' (desactivado)'}
            </option>
          ))}
        </select>
        {guardando && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>

      {configuradaRota && (
        <p className="text-[10px] text-amber-500 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
          {flujoConfigurado
            ? 'El flujo elegido está desactivado, así que no rige.'
            : 'El flujo elegido ya no existe.'}
        </p>
      )}

      {vigente ? (
        <p className="text-[10px] text-muted-foreground leading-snug">
          {vigente.heredado && <span className="text-primary">hereda: </span>}
          {cadenaDe(roles, vigente.flujo.pasos) || 'sin pasos'}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground leading-snug italic">
          sin circuito — solo RRHH
        </p>
      )}
    </div>
  );
}
