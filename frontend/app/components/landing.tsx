'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView } from 'motion/react';
import HeroCarousel from './hero-carousel';
import HeroParallax from './hero-parallax';
import LandingScenes from './landing-scenes';
import VenueExplore from './venue-explore';
import Footer from './footer';
import { useDockReveal } from './dock-reveal';
import { PublicAPI, type ShowcasePhoto } from '../venues/lib';

export default function Landing() {
  const { setHidden } = useDockReveal();
  const [photos, setPhotos] = useState<ShowcasePhoto[]>([]);
  const appRef = useRef<HTMLDivElement>(null);
  const inView = useInView(appRef, { amount: 0.2 });
  const revealed = useRef(false);

  useEffect(() => {
    PublicAPI.showcasePhotos().then(setPhotos).catch(() => {});
  }, []);

  useEffect(() => {
    if (inView && !revealed.current) {
      revealed.current = true;
      setHidden(false);
      if (typeof window !== 'undefined') localStorage.setItem('intro_seen', '1');
    }
  }, [inView, setHidden]);

  const goToApp = (smooth: boolean) =>
    appRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });

  return (
    <div className="landing-scroll">
      <section className="landing">
        <HeroCarousel mode="bg" />
        <div className="landing-inner">
          <h1 className="landing-title">Espaços para eventos inesquecíveis</h1>
          <p className="landing-sub">Encontre, reserve e anuncie — tudo num lugar só.</p>
          <button type="button" className="button landing-cta" onClick={() => goToApp(false)}>Entrar</button>
          <span className="landing-hint" aria-hidden="true">role para descobrir ↓</span>
        </div>
      </section>

      <HeroParallax photos={photos} />

      <LandingScenes />

      <section className="landing-cta-final">
        <h2>Pronto pra encontrar seu espaço?</h2>
        <button type="button" className="button landing-cta" onClick={() => goToApp(true)}>Explorar espaços</button>
      </section>

      <div className="landing-app" ref={appRef}>
        <main className="home">
          <VenueExplore />
        </main>
        <Footer />
      </div>
    </div>
  );
}
