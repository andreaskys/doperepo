'use client';

import { motion, useReducedMotion } from 'motion/react';

const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const SCENES = [
  {
    icon: <Ico><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Ico>,
    title: 'Descubra',
    text: 'Salões, chácaras, rooftops e galpões. Filtre por cidade, capacidade e preço e ache o espaço certo pro seu evento.',
  },
  {
    icon: <Ico><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /><path d="M9 16l2 2 4-4" /></Ico>,
    title: 'Reserve',
    text: 'Veja a disponibilidade em tempo real, escolha as datas e feche direto com o anfitrião — com confirmação e notificações.',
  },
  {
    icon: <Ico><path d="M3 21h18" /><path d="M5 21V8l7-5 7 5v13" /><path d="M9 21v-6h6v6" /></Ico>,
    title: 'Anuncie',
    text: 'Tem um espaço? Cadastre fotos, defina a diária e comece a receber reservas. Você vira anfitrião ao publicar o primeiro.',
  },
];

export default function LandingScenes() {
  const reduce = useReducedMotion();
  return (
    <div className="landing-scenes">
      {SCENES.map((s, i) => (
        <section className="scene" key={s.title}>
          <motion.div
            className="scene-inner"
            initial={reduce ? false : { opacity: 0, y: 40 }}
            whileInView={reduce ? {} : { opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.55 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5 }}
          >
            <span className="scene-ico">{s.icon}</span>
            <span className="scene-step">0{i + 1}</span>
            <h2 className="scene-title">{s.title}</h2>
            <p className="scene-text">{s.text}</p>
          </motion.div>
        </section>
      ))}
    </div>
  );
}
