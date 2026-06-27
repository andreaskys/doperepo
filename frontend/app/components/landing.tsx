'use client';

import HeroCarousel from './hero-carousel';

export default function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="landing">
      <HeroCarousel mode="bg" />
      <div className="landing-inner">
        <h1 className="landing-title">Espaços para eventos inesquecíveis</h1>
        <p className="landing-sub">Encontre, reserve e anuncie — tudo num lugar só.</p>
        <button type="button" className="button landing-cta" onClick={onEnter}>Entrar</button>
        <span className="landing-hint" aria-hidden="true">role para descobrir ↓</span>
      </div>
    </section>
  );
}
