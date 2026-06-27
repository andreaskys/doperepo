'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { PublicAPI, type Venue } from '../venues/lib';

const HeroText = () => (
  <section className="hero">
    <h1>Encontre o espaço perfeito para o seu evento</h1>
    <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
  </section>
);

export default function HeroCarousel({ mode = 'hero' }: { mode?: 'hero' | 'bg' }) {
  const reduce = useReducedMotion();
  const [slides, setSlides] = useState<Venue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    PublicAPI.searchVenues({})
      .then((vs) => setSlides(vs.filter((v) => !!v.cover_url).slice(0, 8)))
      .catch(() => setFailed(true));
  }, []);

  const count = slides?.length ?? 0;

  useEffect(() => {
    if (reduce || paused || count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [reduce, paused, count, idx]);

  if (failed || (slides && slides.length === 0)) return <HeroText />;
  if (!slides) return <HeroText />;

  const go = (i: number) => setIdx(((i % count) + count) % count);
  const active = slides[idx];

  return (
    <section
      className={'hero-carousel' + (mode === 'bg' ? ' bg' : '')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence>
        <motion.div
          key={active.id}
          className="hc-slide"
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? {} : { opacity: 1 }}
          exit={reduce ? {} : { opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.6 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={active.cover_url} alt={active.title} />
        </motion.div>
      </AnimatePresence>

      <div className="hc-scrim" />

      {mode === 'hero' && (
        <>
          <div className="hc-overlay">
            <h1>Encontre o espaço perfeito para o seu evento</h1>
            <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
          </div>

          <a className="hc-chip" href={`/venues/${active.id}/reservar`}>
            <span className="hc-chip-title">{active.title} · {active.city}/{active.state}</span>
            <span className="hc-chip-cta">Ver espaço →</span>
          </a>

          {count > 1 && (
            <>
              <button className="hc-arrow left" aria-label="Anterior" onClick={() => go(idx - 1)}>‹</button>
              <button className="hc-arrow right" aria-label="Próximo" onClick={() => go(idx + 1)}>›</button>
              <div className="hc-dots">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    className={i === idx ? 'on' : ''}
                    aria-label={`Ir para o espaço ${i + 1}`}
                    onClick={() => go(i)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
