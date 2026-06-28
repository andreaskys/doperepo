'use client';

import './range-slider.css';

interface Props {
  min: number;
  max: number;
  ceil: number;
  step?: number;
  onChange: (min: number, max: number) => void;
}

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`;

export default function RangeSlider({ min, max, ceil, step = 1, onChange }: Props) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const pct = (v: number) => (ceil === 0 ? 0 : (v / ceil) * 100);
  return (
    <div className="rs">
      <div className="rs-track">
        <div className="rs-fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
      </div>
      <input
        type="range" className="rs-input" min={0} max={ceil} step={step} value={min}
        onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)}
        aria-label="Valor mínimo"
      />
      <input
        type="range" className="rs-input" min={0} max={ceil} step={step} value={max}
        onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))}
        aria-label="Valor máximo"
      />
      <div className="rs-values"><span>{brl(lo)}</span><span>{brl(hi)}</span></div>
    </div>
  );
}
