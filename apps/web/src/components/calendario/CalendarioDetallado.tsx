import { useMemo, useState } from 'react';
import { Search, Users, Loader2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { esDiaFranco } from '@/utils/planillaHelpers';
import { francoDelDia, tramoDelDia } from '@/utils/tramosDiagrama';
import {
  type GanttData, type Empleado, type TramoEmp, type Bloque, type Cat,
  MESES, DOW_SHORT, CAT, CAT_LABEL, ESTADO_BADGE, COUNTABLE, CAT_ORDER,
  catOf, tipoLabel, ymd, daysInMonth, fmtDate, norm,
} from './shared';

// ── Turno derivation: se agrupa por el tramo vigente HOY (con un cambio a mitad
// de año, agrupar por el diagrama "de siempre" mezclaría gente que ya cambió con
// gente que todavía no) ──
function tramoVigenteHoy(tramos: TramoEmp[]): TramoEmp | null {
  return tramoDelDia(tramos, new Date());
}
function turnoKey(tramos: TramoEmp[]): string {
  const t = tramoVigenteHoy(tramos);
  if (!t) return 'SIN';
  return `${t.diagrama.id}|${t.fechaInicio.slice(0, 10)}`;
}
function turnoSubtitle(tramos: TramoEmp[], anio: number): string {
  const t = tramoVigenteHoy(tramos);
  if (!t) return 'Sin diagrama';
  const sufijo = tramos.length > 1 ? ' · cambia en el año' : '';
  if (t.diagrama.tipo === 'ROTATIVO') {
    const dt = t.diagrama.diasTrabajo ?? 0, dd = t.diagrama.diasDescanso ?? 0;
    const [fy, fm, fd] = ymd(t.fechaInicio);
    const fechaInicio = new Date(fy, fm - 1, fd);
    let desc = '';
    for (let i = 0; i < dt + dd; i++) {
      const day = new Date(anio, 0, 1 + i);
      if (esDiaFranco(day, t.diagrama, fechaInicio)) {
        desc = ` · desc. desde ${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
        break;
      }
    }
    return `${dt}×${dd}${desc}${sufijo}`;
  }
  if (t.diagrama.tipo === 'FIJO_SEMANA') {
    const rest = [0, 1, 2, 3, 4, 5, 6].filter((i) => !t.diagrama.diasSemana.includes(i)).map((i) => DOW_SHORT[i]);
    return `Semana fija · descansa ${rest.join(', ') || '—'}${sufijo}`;
  }
  return 'Sin diagrama';
}
function letterOf(i: number): string {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return i < 26 ? L[i] : `${L[i % 26]}${Math.floor(i / 26) + 1}`;
}

// Build an inline linear-gradient that tints just the rest-day runs of a month cell (0 DOM nodes).
function restGradient(runs: { d0: number; days: number }[], dim: number): string {
  const stops: string[] = [];
  let cursor = 0;
  for (const r of runs) {
    const a = (r.d0 / dim) * 100;
    const b = ((r.d0 + r.days) / dim) * 100;
    if (a > cursor) stops.push(`transparent ${cursor}% ${a}%`);
    stops.push(`var(--rest-tint) ${a}% ${b}%`);
    cursor = b;
  }
  if (cursor < 100) stops.push(`transparent ${cursor}% 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

interface Segment {
  key: string;
  cat: Cat;
  estado: string;
  monthIndex: number;
  d0: number;
  days: number;
  dim: number;
  edge: string;
  block: Bloque;
  emp: string;
  overlap?: boolean;
  overlapPeak?: number;
}
interface RowData {
  emp: Empleado;
  byMonth: Segment[][];
  restByMonth: { d0: number; days: number }[][] | null;
}



function edgeOf(roundL: boolean, roundR: boolean): string {
  if (roundL && roundR) return 'full';
  if (roundL) return 'open-r'; // square the right side → continues to the next month
  if (roundR) return 'open-l'; // square the left side → continued from previous month
  return 'open-both';
}

// Split one block into per-month segments, clamped to the visible year.
function buildSegments(block: Bloque, year: number, emp: string): Segment[] {
  const [y1, m1, d1] = ymd(block.fechaInicio);
  const [y2, m2, d2] = ymd(block.fechaFin);
  if (y1 > year || y2 < year) return [];
  const spillL = y1 < year;
  const spillR = y2 > year;
  const startMonth = spillL ? 0 : m1 - 1;
  const startDay = spillL ? 1 : d1;
  const endMonth = spillR ? 11 : m2 - 1;
  const endDay = spillR ? 31 : d2;
  const cat = catOf(block.tipo);
  const segs: Segment[] = [];
  for (let mo = startMonth; mo <= endMonth; mo++) {
    const dim = daysInMonth(year, mo);
    const segStart = mo === startMonth ? startDay : 1;
    const segEnd = Math.min(mo === endMonth ? endDay : dim, dim);
    const days = segEnd - segStart + 1;
    if (days <= 0) continue;
    const roundL = mo === startMonth && !spillL;
    const roundR = mo === endMonth && !spillR;
    segs.push({
      key: `${block.id}-${mo}`,
      cat,
      estado: block.estado,
      monthIndex: mo,
      d0: segStart - 1,
      days,
      dim,
      edge: edgeOf(roundL, roundR),
      block,
      emp,
    });
  }
  return segs;
}

const GRID_STYLE: React.CSSProperties = { gridTemplateColumns: 'minmax(180px,230px) repeat(12, minmax(56px,1fr))' };

interface Props {
  data?: GanttData;
  anio: number;
  isLoading: boolean;
  onOverlapSelect: (block: Bloque, empId: string, empName: string) => void;
}

export default function CalendarioDetallado({ data, anio, isLoading, onOverlapSelect }: Props) {
  const [q, setQ] = useState('');
  const [turnoSel, setTurnoSel] = useState('');
  const [vis, setVis] = useState<Record<Cat, boolean>>({
    VACACION: true, AUSENCIA: true, FRANCO: true, CAPACITACION: false, DESCANSO: false,
  });
  const [hover, setHover] = useState<{ seg: Segment; x: number; y: number } | null>(null);

  // Day-of-year offsets per month (leap-aware), used by the overlap pass.
  const { monthOffset } = useMemo(() => {
    const off: number[] = [];
    let acc = 0;
    for (let mi = 0; mi < 12; mi++) { off[mi] = acc; acc += daysInMonth(anio, mi); }
    return { monthOffset: off };
  }, [anio]);

  // One pass: per-employee segments (gated by vis) + rest-day runs (if DESCANSO) + overlap counts.
  const { rows, catCounts } = useMemo(() => {
    const cc: Record<Cat, number> = { VACACION: 0, AUSENCIA: 0, FRANCO: 0, CAPACITACION: 0, DESCANSO: 0 };
    if (!data) return { rows: [] as RowData[], catCounts: cc };

    const counts = new Int16Array(366);

    const built: RowData[] = data.empleados.map((emp) => {
      const byMonth: Segment[][] = Array.from({ length: 12 }, () => []);
      const name = `${emp.apellido}, ${emp.nombre}`;
      const doySet = new Set<number>();
      for (const b of emp.bloques) {
        const cat = catOf(b.tipo);
        cc[cat] += 1; // total available (before the visibility gate), for the chip badge
        if (!vis[cat]) continue;
        for (const seg of buildSegments(b, anio, name)) {
          byMonth[seg.monthIndex].push(seg);
          if (COUNTABLE[cat]) {
            for (let k = 0; k < seg.days; k++) doySet.add(monthOffset[seg.monthIndex] + seg.d0 + k);
          }
        }
      }
      for (const doy of doySet) counts[doy]++;

      let restByMonth: { d0: number; days: number }[][] | null = null;
      const tramos = emp.tramos ?? [];
      if (vis.DESCANSO && tramos.length > 0) {
        restByMonth = Array.from({ length: 12 }, () => [] as { d0: number; days: number }[]);
        for (let mi = 0; mi < 12; mi++) {
          const dim = daysInMonth(anio, mi);
          let start = -1;
          for (let d = 1; d <= dim; d++) {
            const isF = francoDelDia(tramos, new Date(anio, mi, d));
            if (isF && start === -1) start = d;
            else if (!isF && start !== -1) { restByMonth[mi].push({ d0: start - 1, days: d - start }); start = -1; }
          }
          if (start !== -1) restByMonth[mi].push({ d0: start - 1, days: dim - start + 1 });
        }
      }
      return { emp, byMonth, restByMonth };
    });

    // Mark overlap on countable segments (peak ≥ 2 ⇒ at least one other person off).
    for (const r of built) {
      for (const m of r.byMonth) {
        for (const s of m) {
          if (!COUNTABLE[s.cat]) continue;
          let peak = 0;
          const base = monthOffset[s.monthIndex] + s.d0;
          for (let k = 0; k < s.days; k++) { const c = counts[base + k]; if (c > peak) peak = c; }
          if (peak >= 2) { s.overlap = true; s.overlapPeak = peak; }
        }
      }
    }
    return { rows: built, catCounts: cc };
  }, [data, anio, vis, monthOffset]);

  // Turnos derived from diagramas (letters assigned over the present keys).
  const { turnoKeyByEmp, turnos, hasDiagramas } = useMemo(() => {
    const keyByEmp = new Map<string, string>();
    const groups = new Map<string, { count: number; tramos: TramoEmp[] }>();
    let hasDiag = false;
    for (const r of rows) {
      const tramos = r.emp.tramos ?? [];
      if (tramos.length > 0) hasDiag = true;
      const k = turnoKey(tramos);
      keyByEmp.set(r.emp.id, k);
      const g = groups.get(k);
      if (g) g.count++; else groups.set(k, { count: 1, tramos });
    }
    const entries = [...groups.entries()].filter(([k]) => k !== 'SIN').sort((a, b) => a[0].localeCompare(b[0]));
    const list = entries.map(([key, g], i) => ({ key, letra: letterOf(i), subtitle: turnoSubtitle(g.tramos, anio), count: g.count }));
    if (groups.has('SIN')) list.push({ key: 'SIN', letra: '—', subtitle: 'Sin diagrama', count: groups.get('SIN')!.count });
    return { turnoKeyByEmp: keyByEmp, turnos: list, hasDiagramas: hasDiag };
  }, [rows, anio]);

  const chipCats = useMemo(() => {
    const present = CAT_ORDER.filter((c) => (catCounts[c] ?? 0) > 0);
    if (hasDiagramas) present.push('DESCANSO');
    return present;
  }, [catCounts, hasDiagramas]);

  // Search + turno filter the row list only (no geometry recompute).
  const visibleRows = useMemo(() => {
    const needle = norm(q.trim());
    return rows.filter((r) => {
      if (turnoSel && turnoKeyByEmp.get(r.emp.id) !== turnoSel) return false;
      if (needle && !norm(`${r.emp.apellido} ${r.emp.nombre} ${r.emp.legajo ?? ''}`).includes(needle)) return false;
      return true;
    });
  }, [rows, q, turnoSel, turnoKeyByEmp]);


  const now = new Date();
  const isCurrentYear = anio === now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDay = now.getDate();
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  return (
    <div className="space-y-3">
      {/* Filtros propios del modo detallado (búsqueda + turno) */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre o legajo…"
            className="rounded-lg border border-border bg-card pl-8 pr-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={turnoSel}
          onChange={(e) => setTurnoSel(e.target.value)}
          aria-label="Filtrar por turno"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm max-w-[16rem]"
        >
          <option value="">Todos los turnos</option>
          {turnos.map((t) => (
            <option key={t.key} value={t.key}>
              {t.key === 'SIN' ? `Sin diagrama (${t.count})` : `Turno ${t.letra} — ${t.subtitle} (${t.count})`}
            </option>
          ))}
        </select>
      </div>

      {/* Eye-chips (show/hide categories) — double as the colour legend */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Mostrar:</span>
        {chipCats.map((c) => {
          const on = vis[c];
          return (
            <button
              key={c}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${on ? 'Ocultar' : 'Mostrar'} ${CAT_LABEL[c]}`}
              onClick={() => setVis((v) => ({ ...v, [c]: !v[c] }))}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none',
                on ? 'text-foreground' : 'opacity-50 text-muted-foreground',
              )}
            >
              {c === 'DESCANSO' ? (
                <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/70" />
              ) : (
                <span className={cn('w-2.5 h-2.5 rounded-full', CAT[c], !on && 'saturate-0')} style={{ backgroundColor: 'currentColor' }} />
              )}
              {CAT_LABEL[c]}
              {(catCounts[c] ?? 0) > 0 && <span className="tabular-nums text-[10px] opacity-70">{catCounts[c]}</span>}
              {on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          );
        })}
        <span className="text-[11px] text-muted-foreground flex items-center gap-2 ml-1">
          <span className="flex items-center gap-1">
            <span className="cal-estado relative inline-block w-3 h-3 text-muted-foreground" />
            aprobada
          </span>
          <span className="flex items-center gap-1">
            <span className="cal-estado relative inline-block w-3 h-3 text-muted-foreground" data-estado="EN_REVISION" />
            pend./revisión
          </span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-cal-rose" /> solape</span>
        </span>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !visibleRows.length ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              {rows.length ? 'Sin resultados para los filtros aplicados' : `No hay registros en ${anio}`}
            </p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[72vh]">
            <div className="min-w-[900px]">
              {/* Month header */}
              <div className="grid sticky top-0 z-20 bg-card border-b border-border" style={GRID_STYLE}>
                <div className="sticky left-0 z-30 bg-card px-3 py-2 text-xs font-semibold text-muted-foreground border-r border-border">
                  Empleado
                </div>
                {MESES.map((m, i) => (
                  <div key={i} className="text-center text-xs font-medium text-muted-foreground py-2 border-r border-border/40">
                    {m}
                  </div>
                ))}
              </div>

              {/* Employee rows */}
              {visibleRows.map((r) => {
                const tk = turnoKeyByEmp.get(r.emp.id) || 'SIN';
                const turno = turnos.find((t) => t.key === tk);
                return (
                  <div key={r.emp.id} className="av-row grid border-b border-border/40 hover:bg-muted/10 transition-colors" style={GRID_STYLE}>
                    <div className="sticky left-0 z-10 bg-card px-2 py-1.5 border-r border-border flex items-center gap-1.5 min-w-0">
                      {turno && tk !== 'SIN' ? (
                        <button
                          type="button"
                          onClick={() => setTurnoSel(tk)}
                          title={turno.subtitle}
                          aria-label={`Filtrar turno ${turno.letra}`}
                          className="shrink-0 rounded bg-muted text-muted-foreground text-[10px] font-semibold px-1.5 py-0.5 leading-none hover:bg-muted/70"
                        >
                          {turno.letra}
                        </button>
                      ) : (
                        <span className="shrink-0 rounded bg-muted/50 text-muted-foreground/60 text-[10px] px-1.5 py-0.5 leading-none" title="Sin diagrama">—</span>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{r.emp.apellido}, {r.emp.nombre}</span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {r.emp.legajo ? `#${r.emp.legajo}` : '#—'}
                          {r.emp.sector ? ` · ${r.emp.sector.nombre}` : ''}
                        </span>
                      </div>
                    </div>
                    {Array.from({ length: 12 }, (_, mi) => {
                      const dim = daysInMonth(anio, mi);
                      const runs = r.restByMonth?.[mi];
                      const cellStyle: React.CSSProperties = { ['--av-days']: dim } as React.CSSProperties;
                      if (runs && runs.length) (cellStyle as Record<string, string>)['--av-rest'] = restGradient(runs, dim);
                      return (
                        <div key={mi} className="av-daygrid relative h-9 border-r border-border/40" style={cellStyle}>
                          {r.byMonth[mi].map((s) => (
                            <div
                              key={s.key}
                              className={cn('av-seg absolute top-1/2 -translate-y-1/2 h-3.5 cursor-pointer outline-none focus:ring-2 focus:ring-ring', CAT[s.cat])}
                              data-estado={s.estado}
                              data-edge={s.edge}
                              data-overlap={s.overlap ? ((s.overlapPeak ?? 0) >= 3 ? '2' : '1') : undefined}
                              tabIndex={0}
                              role="button"
                              aria-label={`${CAT_LABEL[s.cat]} ${fmtDate(s.block.fechaInicio)} a ${fmtDate(s.block.fechaFin)} (${s.block.estado})${s.overlap ? ` · solape con ${(s.overlapPeak ?? 2) - 1} más — abrir detalle` : ''}`}
                              title={`${CAT_LABEL[s.cat]} · ${fmtDate(s.block.fechaInicio)}–${fmtDate(s.block.fechaFin)} · ${s.block.estado}`}
                              style={{ left: `${(s.d0 / s.dim) * 100}%`, width: `max(${(s.days / s.dim) * 100}%, 4px)` }}
                              onMouseEnter={(e) => setHover({ seg: s, x: e.clientX, y: e.clientY })}
                              onMouseMove={(e) => setHover((h) => (h && h.seg.key === s.key ? { ...h, x: e.clientX, y: e.clientY } : h))}
                              onMouseLeave={() => setHover(null)}
                              onFocus={(e) => {
                                const rc = e.currentTarget.getBoundingClientRect();
                                setHover({ seg: s, x: rc.left, y: rc.bottom });
                              }}
                              onBlur={() => setHover(null)}
                              onClick={() => { if (s.overlap) onOverlapSelect(s.block, r.emp.id, s.emp); }}
                              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && s.overlap) { e.preventDefault(); onOverlapSelect(s.block, r.emp.id, s.emp); } }}
                            >
                              {s.overlap && (s.overlapPeak ?? 0) >= 3 && (
                                <span className="absolute -top-1 -right-1 rounded-full bg-cal-rose text-card text-[8px] leading-none px-1 pointer-events-none" aria-hidden>
                                  {s.overlapPeak}
                                </span>
                              )}
                            </div>
                          ))}
                          {isCurrentYear && mi === todayMonth && (
                            <div
                              className="absolute top-0 bottom-0 w-px bg-primary/70 z-[5]"
                              style={{ left: `${((todayDay - 0.5) / dim) * 100}%` }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      {data && rows.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
          <span>{visibleRows.length} de {rows.length} empleados</span>
          <span>{rows.reduce((s, r) => s + r.byMonth.reduce((a, m) => a + m.length, 0), 0)} tramos</span>
          {turnos.filter((t) => t.key !== 'SIN').length > 0 && (
            <span>{turnos.filter((t) => t.key !== 'SIN').length} turnos</span>
          )}
        </div>
      )}

      {/* Shared hover/focus popover */}
      {hover && (
        <div
          className="fixed z-50 rounded-xl border border-border bg-card shadow-lg p-3 max-w-xs pointer-events-none"
          style={{ left: Math.min(hover.x + 14, vw - 264), top: Math.min(hover.y + 14, vh - 160) }}
        >
          <p className="font-semibold text-sm">{hover.seg.emp}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(hover.seg.block.fechaInicio)} — {fmtDate(hover.seg.block.fechaFin)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('w-2.5 h-2.5 rounded', CAT[hover.seg.cat])} style={{ backgroundColor: 'currentColor' }} />
            <span className="text-xs font-medium">{tipoLabel(hover.seg.block.tipo)}</span>
          </div>
          <p className="text-xs mt-1">
            <span className="font-medium">{hover.seg.block.dias} día{hover.seg.block.dias !== 1 ? 's' : ''}</span>
            <span className={cn('ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium', ESTADO_BADGE[hover.seg.block.estado] ?? 'bg-muted text-muted-foreground')}>
              {hover.seg.block.estado}
            </span>
          </p>
          {hover.seg.overlap && (
            <p className="text-xs text-cal-rose mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {(hover.seg.overlapPeak ?? 2) - 1} compañero(s) afuera en parte del período
            </p>
          )}
          {hover.seg.block.detalle && (
            <p className="text-xs text-muted-foreground mt-1 italic">"{hover.seg.block.detalle}"</p>
          )}
        </div>
      )}

    </div>
  );
}
