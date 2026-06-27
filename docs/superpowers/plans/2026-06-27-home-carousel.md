# Carrossel hero na Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o hero de texto da home por um carrossel que passa as fotos de capa dos anúncios publicados, com autoplay/crossfade, clicável e acessível.

**Architecture:** Frontend-only. Novo `HeroCarousel` (client) busca `PublicAPI.searchVenues({})`, filtra os que têm `cover_url` e cicla com `AnimatePresence`/`setInterval`. `page.tsx` troca a `<section className="hero">` por `<HeroCarousel />`. Sem capas/erro → fallback pro hero de texto.

**Tech Stack:** Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-home-carousel.md`.
- **Sem backend:** reusa `PublicAPI.searchVenues` (já existe). Só espaços publicados (o endpoint público já filtra).
- **Banner contido** no container (1100px), arredondado — não full-bleed.
- **Design/animação (`docs/design.md`):** crossfade ~0.6s; autoplay 5s com pausa no hover; `prefers-reduced-motion` (`useReducedMotion`) desliga autoplay e fade; só `transform`/`opacity`.
- **Acessibilidade:** dots/setas são `<button aria-label>`; `<img alt={title}>`; chip é link focável.
- **Gates:** `npm run typecheck` (em `frontend/`) e build no container `docker compose exec -T frontend npm run build`.

---

### Task 1: Componente `HeroCarousel` + estilos

**Files:**
- Create: `frontend/app/components/hero-carousel.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: `PublicAPI.searchVenues`, tipo `Venue` (de `../venues/lib`).
- Produces: `export default function HeroCarousel()` (consumido pela Task 2).

- [ ] **Step 1: Criar o componente**

`frontend/app/components/hero-carousel.tsx`:
```tsx
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

export default function HeroCarousel() {
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
      className="hero-carousel"
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
    </section>
  );
}
```

- [ ] **Step 2: Adicionar os estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== Hero carousel (home) ===== */
.hero-carousel {
  position: relative; height: clamp(360px, 56vh, 520px);
  border-radius: 18px; overflow: hidden; margin-bottom: 40px;
  background: #11102a;
}
.hc-slide { position: absolute; inset: 0; }
.hc-slide img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hc-scrim {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.6) 100%);
}
.hc-overlay {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  text-align: center; color: #fff; padding: 0 24px;
}
.hc-overlay h1 { font-size: 38px; margin: 0 0 12px; text-shadow: 0 2px 16px rgba(0,0,0,0.4); }
.hc-overlay p { font-size: 18px; margin: 0; opacity: 0.95; text-shadow: 0 1px 10px rgba(0,0,0,0.4); }
.hc-chip {
  position: absolute; left: 18px; bottom: 18px; z-index: 3;
  display: inline-flex; flex-direction: column; gap: 2px;
  padding: 10px 14px; border-radius: 12px;
  background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);
  color: #fff; text-decoration: none;
}
.hc-chip-title { font-weight: 600; }
.hc-chip-cta { font-size: 13px; opacity: 0.9; }
@media (hover: hover) and (pointer: fine) { .hc-chip:hover { background: rgba(0,0,0,0.6); } }
.hc-arrow {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 3;
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(255,255,255,0.85); color: #1f2430; font-size: 22px; line-height: 1;
  display: grid; place-items: center;
}
.hc-arrow.left { left: 14px; }
.hc-arrow.right { right: 14px; }
.hc-dots { position: absolute; left: 0; right: 0; bottom: 16px; z-index: 3; display: flex; justify-content: center; gap: 8px; }
.hc-dots button {
  width: 9px; height: 9px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
  background: rgba(255,255,255,0.5);
}
.hc-dots button.on { background: #fff; }
@media (max-width: 640px) {
  .hero-carousel { height: clamp(260px, 48vh, 360px); }
  .hc-overlay h1 { font-size: 26px; }
  .hc-overlay p { font-size: 15px; }
  .hc-arrow { display: none; }
}
```

- [ ] **Step 3: Typecheck**

Run (em `frontend/`):
```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/hero-carousel.tsx frontend/app/globals.css
git commit -m "feat(home): componente HeroCarousel + estilos"
```

---

### Task 2: Plugar o carrossel na home

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes (da Task 1): `HeroCarousel`.

- [ ] **Step 1: Trocar o hero de texto pelo carrossel**

Em `frontend/app/page.tsx`:

1a. Adicionar o import:
```tsx
import HeroCarousel from './components/hero-carousel';
```

1b. Substituir o bloco:
```tsx
        <section className="hero">
          <h1>Encontre o espaço perfeito para o seu evento</h1>
          <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
        </section>
```
por:
```tsx
        <HeroCarousel />
```

- [ ] **Step 2: Typecheck + build no container**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror|/ "
```
Expected: typecheck sem erros; "Compiled successfully".

- [ ] **Step 3: Smoke visual**

Reiniciar o frontend e validar:
```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 1; done
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
Abrir `http://localhost:3100/`: o topo mostra o banner passando as capas sozinho (~5s) com fade; hover pausa; setas/dots navegam; o chip leva ao `/venues/:id/reservar`. Sem espaços com capa → hero de texto.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(home): carrossel hero no lugar do hero de texto"
```

---

## Self-Review

- **Cobertura da spec:** dados via `searchVenues` + filtro `cover_url` + slice 8 (T1) · autoplay 5s/pausa hover/reduced-motion (T1) · crossfade `AnimatePresence` (T1) · overlay título + chip clicável + setas + dots (T1) · fallback hero de texto sem capas/erro (T1) · banner contido arredondado + responsivo (T1) · troca na `page.tsx` (T2). ✔
- **Consistência:** `HeroCarousel` default export (T1) importado em `page.tsx` (T2); `go`/`idx`/`count` coerentes; classes do T1 todas estilizadas. ✔
- **Sem placeholders:** todo passo traz código real + comando/saída. ✔
- **Risco conhecido:** `AnimatePresence` com troca de `key` faz o slide antigo sair enquanto o novo entra (crossfade) — ambos `position:absolute; inset:0`, então se sobrepõem corretamente. Sob `reduce`, sem animação (troca seca).
