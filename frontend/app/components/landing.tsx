'use client';

import { useEffect, useState } from 'react';
import HeroCarousel from './hero-carousel';
import HeroParallax from './hero-parallax';
import LandingScenes from './landing-scenes';
import { PublicAPI, type ShowcasePhoto } from '../venues/lib';

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [photos, setPhotos] = useState<ShowcasePhoto[]>([]);

  useEffect(() => {
    PublicAPI.showcasePhotos().then(setPhotos).catch(() => {});
  }, []);

  return (
    <div className="landing-scroll">
      <section className="landing">
        <HeroCarousel mode="bg" />
        <div className="landing-inner">
          <h1 className="landing-title">Espaços para eventos inesquecíveis</h1>
          <p className="landing-sub">Encontre, reserve e anuncie — tudo num lugar só.</p>
          <button type="button" className="button landing-cta" onClick={onEnter}>Entrar</button>
          <span className="landing-hint" aria-hidden="true">role para descobrir ↓</span>
        </div>
      </section>

      <HeroParallax photos={photos} />

      <LandingScenes />

      <section className="landing-cta-final">
        <h2>Pronto pra encontrar seu espaço?</h2>
        <button type="button" className="button landing-cta" onClick={onEnter}>Explorar espaços</button>
      </section>
    </div>
  );
}
