'use client';

import { useEffect, useRef, useState } from 'react';
import './date-range-picker.css';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dm = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface Props { start: string; end: string; onChange: (start: string, end: string) => void; }

export default function DateRangePicker({ start, end, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const base = start ? new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);

  const pick = (ds: string) => {
    if (!start || (start && end)) onChange(ds, '');
    else if (ds < start) onChange(ds, '');
    else { onChange(start, ds); setOpen(false); }
  };

  const move = (delta: number) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const firstWd = new Date(view.y, view.m, 1).getDay();
  const nDays = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= nDays; d++) cells.push(ymd(new Date(view.y, view.m, d)));

  const label = start || end ? `${dm(start) || '…'} – ${dm(end) || '…'}` : 'Selecione as datas';

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="filter-input drp-field" onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <div className="drp-pop">
          <div className="drp-head">
            <button type="button" onClick={() => move(-1)} aria-label="Mês anterior">‹</button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => move(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="drp-wd">{WD.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div className="drp-grid">
            {cells.map((c, i) =>
              c === null ? <span key={i} /> : (
                <button
                  type="button" key={i} disabled={c < todayStr}
                  className={'drp-day' + (c === start ? ' on' : '') + (c === end ? ' on' : '') + (start && end && c > start && c < end ? ' mid' : '')}
                  onClick={() => pick(c)}
                >
                  {Number(c.slice(8, 10))}
                </button>
              )
            )}
          </div>
          <div className="drp-foot"><button type="button" onClick={() => onChange('', '')}>Limpar datas</button></div>
        </div>
      )}
    </div>
  );
}
