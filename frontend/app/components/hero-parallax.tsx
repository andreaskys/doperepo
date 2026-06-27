'use client';

import React from 'react';
import { motion, useScroll, useTransform, useSpring, useReducedMotion, type MotionValue } from 'motion/react';
import type { ShowcasePhoto } from '../venues/lib';

export default function HeroParallax({ photos }: { photos: ShowcasePhoto[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = !!useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const spring = { stiffness: 300, damping: 30, bounce: 100 };
  const translateX = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1000]), spring);
  const translateXReverse = useSpring(useTransform(scrollYProgress, [0, 1], [0, -1000]), spring);
  const rotateX = useSpring(useTransform(scrollYProgress, [0, 0.2], [15, 0]), spring);
  const opacity = useSpring(useTransform(scrollYProgress, [0, 0.2], [0.2, 1]), spring);
  const rotateZ = useSpring(useTransform(scrollYProgress, [0, 0.2], [20, 0]), spring);
  const translateY = useSpring(useTransform(scrollYProgress, [0, 0.2], [-700, 500]), spring);

  if (!photos.length) return null;

  const pick = (start: number) =>
    Array.from({ length: 5 }, (_, i) => photos[(start + i) % photos.length]);
  const firstRow = pick(0);
  const secondRow = pick(5);
  const thirdRow = pick(10);

  return (
    <div ref={ref} className="hpx">
      <header className="hpx-header">
        <h1>Espaços que viram experiências</h1>
        <p>Uma seleção de lugares reais já anunciados na plataforma — role para conhecer.</p>
      </header>
      <motion.div style={reduce ? {} : { rotateX, rotateZ, translateY, opacity }}>
        <div className="hpx-row reverse">
          {firstRow.map((p, i) => <ParallaxCard key={`a${i}`} photo={p} translate={translateX} reduce={reduce} />)}
        </div>
        <div className="hpx-row">
          {secondRow.map((p, i) => <ParallaxCard key={`b${i}`} photo={p} translate={translateXReverse} reduce={reduce} />)}
        </div>
        <div className="hpx-row reverse">
          {thirdRow.map((p, i) => <ParallaxCard key={`c${i}`} photo={p} translate={translateX} reduce={reduce} />)}
        </div>
      </motion.div>
    </div>
  );
}

function ParallaxCard({ photo, translate, reduce }: { photo: ShowcasePhoto; translate: MotionValue<number>; reduce: boolean }) {
  return (
    <motion.div
      style={reduce ? {} : { x: translate }}
      whileHover={reduce ? undefined : { y: -20 }}
      className="hpx-card"
    >
      <a href={`/venues/${photo.venue_id}/reservar`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.title} loading="lazy" />
      </a>
      <div className="hpx-card-overlay" />
      <h2 className="hpx-card-title">{photo.title}</h2>
    </motion.div>
  );
}
