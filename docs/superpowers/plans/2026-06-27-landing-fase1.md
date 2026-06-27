# Landing imersiva — Fase 1 (estrutura + gating) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar uma intro full-bleed (carrossel de fundo + hero + botão Entrar) só para quem está deslogado e na 1ª visita; logado/retornante vê o app home atual. Esconder o Dock durante a intro.

**Architecture:** Frontend-only. `HomeGate` (client) decide intro vs app via login + `localStorage`. Um Context `DockReveal` no `layout` permite a `Landing` esconder o Dock global (`SiteNav`). O conteúdo atual da home vira `AppHome`. O carrossel ganha um modo `bg` full-bleed.

**Tech Stack:** Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-landing-fase1.md`.
- **Sem backend/rota nova.** App home atual permanece intacto (é o "else" do gate).
- **Gating:** intro só se `!loggedIn && !localStorage['intro_seen']`. Entrar grava `intro_seen`.
- **Dock:** default `hidden:false` (nenhuma página existente muda). Só a intro seta `hidden:true`. A animação de **queda** é da Fase 3 — aqui some/aparece direto.
- **Detecção de login** via fetch direto a `/auth/me` (NÃO `req()`, que redireciona no 401).
- **Acessibilidade:** botão Entrar sempre focável; `prefers-reduced-motion` sem pulsos; Dock escondido = fora do DOM.
- **Gates:** `npm run typecheck` (em `frontend/`) e build no container `docker compose exec -T frontend npm run build`.

---

### Task 1: Context `DockReveal` + layout + `SiteNav`

**Files:**
- Create: `frontend/app/components/dock-reveal.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/components/site-nav.tsx`

**Interfaces:**
- Produces (consumido pelas Tasks 3): `DockRevealProvider`, `useDockReveal(): { hidden: boolean; setHidden: (b: boolean) => void }`.

- [ ] **Step 1: Criar o context**

`frontend/app/components/dock-reveal.tsx`:
```tsx
'use client';

import { createContext, useContext, useState } from 'react';

type DockRevealCtx = { hidden: boolean; setHidden: (b: boolean) => void };
const Ctx = createContext<DockRevealCtx>({ hidden: false, setHidden: () => {} });

export function DockRevealProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return <Ctx.Provider value={{ hidden, setHidden }}>{children}</Ctx.Provider>;
}

export const useDockReveal = () => useContext(Ctx);
```

- [ ] **Step 2: Envolver o layout**

Em `frontend/app/layout.tsx`, importar e envolver:
```tsx
import SiteNav from './components/site-nav';
import { DockRevealProvider } from './components/dock-reveal';
```
e trocar o corpo do `<body>`:
```tsx
      <body>
        <DockRevealProvider>
          <SiteNav />
          {children}
        </DockRevealProvider>
      </body>
```

- [ ] **Step 3: `SiteNav` esconde quando `hidden`**

Em `frontend/app/components/site-nav.tsx`:

3a. Importar o hook (após os imports existentes):
```tsx
import { useDockReveal } from './dock-reveal';
```

3b. Dentro do componente, junto aos outros hooks (ex.: após `const reduce = useReducedMotion();`):
```tsx
  const { hidden } = useDockReveal();
```

3c. Adicionar o early-return logo após a linha `if (pathname === '/login' || pathname === '/signup') return null;`:
```tsx
  if (hidden) return null;
```

- [ ] **Step 4: Typecheck + build**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror"
```
Expected: sem erros; "Compiled successfully". (Dock segue visível — `hidden` default false.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/dock-reveal.tsx frontend/app/layout.tsx frontend/app/components/site-nav.tsx
git commit -m "feat(landing): context DockReveal para esconder o Dock"
```

---

### Task 2: Prep — modo `bg` no carrossel + `AuthAPI.isLoggedIn`

**Files:**
- Modify: `frontend/app/components/hero-carousel.tsx`
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces (consumido pela Task 3): `HeroCarousel` aceita `mode?: 'hero' | 'bg'`; `AuthAPI.isLoggedIn(): Promise<boolean>`.

- [ ] **Step 1: `AuthAPI.isLoggedIn` no lib**

Em `frontend/app/venues/lib.ts`, adicionar (perto dos outros `*API`, ex.: após `ProfileAPI`):
```ts
// Fetch direto (NÃO usa req(): não pode redirecionar pra /login no 401).
export const AuthAPI = {
  isLoggedIn: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API}/api/v1/auth/me`, { credentials: 'include' });
      return res.ok;
    } catch {
      return false;
    }
  },
};
```

- [ ] **Step 2: Modo `bg` no `HeroCarousel`**

Em `frontend/app/components/hero-carousel.tsx`:

2a. Trocar a assinatura para receber `mode`:
```tsx
export default function HeroCarousel({ mode = 'hero' }: { mode?: 'hero' | 'bg' }) {
```

2b. Trocar o `return` do carrossel (o `<section className="hero-carousel" ...>`) para condicionar os overlays ao modo. Substituir o bloco que vai de `<div className="hc-scrim" />` até o fechamento do `{count > 1 && ( ... )}` por:
```tsx
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
```
2c. Também trocar a classe da `<section>` para incluir o modo:
```tsx
    <section
      className={'hero-carousel' + (mode === 'bg' ? ' bg' : '')}
```

- [ ] **Step 3: Typecheck + build**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror"
```
Expected: sem erros; o carrossel contido (modo hero) na home continua igual.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/hero-carousel.tsx frontend/app/venues/lib.ts
git commit -m "feat(landing): HeroCarousel modo bg + AuthAPI.isLoggedIn"
```

---

### Task 3: `AppHome` + `Landing` + `HomeGate` + página + estilos

**Files:**
- Create: `frontend/app/components/app-home.tsx`
- Create: `frontend/app/components/landing.tsx`
- Create: `frontend/app/components/home-gate.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: `HeroCarousel` (modo bg), `AuthAPI.isLoggedIn`, `useDockReveal`, `VenueFilters`, `VenueGrid`, `Footer`.

- [ ] **Step 1: Extrair o app home**

`frontend/app/components/app-home.tsx`:
```tsx
import { Suspense } from 'react';
import HeroCarousel from './hero-carousel';
import VenueGrid from './venue-grid';
import VenueFilters from './venue-filters';
import Footer from './footer';

export default function AppHome() {
  return (
    <>
      <main className="home">
        <HeroCarousel />
        <section className="home-section">
          <h2>Espaços em destaque</h2>
          <Suspense fallback={<p className="muted">Carregando…</p>}>
            <VenueFilters />
            <VenueGrid />
          </Suspense>
        </section>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Criar a Landing**

`frontend/app/components/landing.tsx`:
```tsx
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
```

- [ ] **Step 3: Criar o gate**

`frontend/app/components/home-gate.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { AuthAPI } from '../venues/lib';
import { useDockReveal } from './dock-reveal';
import Landing from './landing';
import AppHome from './app-home';

type Mode = 'checking' | 'intro' | 'app';

export default function HomeGate() {
  const { setHidden } = useDockReveal();
  const [mode, setMode] = useState<Mode>('checking');

  useEffect(() => {
    let active = true;
    const seen = typeof window !== 'undefined' && localStorage.getItem('intro_seen');
    AuthAPI.isLoggedIn().then((logged) => {
      if (!active) return;
      setMode(!logged && !seen ? 'intro' : 'app');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setHidden(mode === 'intro' || mode === 'checking');
    return () => setHidden(false);
  }, [mode, setHidden]);

  function enterApp() {
    if (typeof window !== 'undefined') localStorage.setItem('intro_seen', '1');
    setMode('app');
  }

  if (mode === 'checking') return <div className="landing-splash" />;
  if (mode === 'intro') return <Landing onEnter={enterApp} />;
  return <AppHome />;
}
```

- [ ] **Step 4: Trocar a página**

Substituir todo o conteúdo de `frontend/app/page.tsx` por:
```tsx
import HomeGate from './components/home-gate';

export default function Home() {
  return <HomeGate />;
}
```

- [ ] **Step 5: Estilos da landing**

Append em `frontend/app/globals.css`:
```css
/* ===== Landing (intro) ===== */
.landing-splash { min-height: 100vh; background: var(--brand-gradient); }
.landing {
  position: relative; min-height: 100vh; width: 100%;
  overflow: hidden; background: #11102a;
  display: flex; align-items: center; justify-content: center; text-align: center;
}
.landing > .hero-carousel.bg {
  position: absolute; inset: 0; height: 100%; width: 100%;
  border-radius: 0; margin: 0; z-index: 0;
}
.landing-inner {
  position: relative; z-index: 2; color: #fff; padding: 0 24px; max-width: 760px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.landing-title {
  font-family: var(--font-display, inherit);
  font-size: clamp(34px, 6vw, 64px); margin: 0; text-shadow: 0 2px 24px rgba(0,0,0,0.45);
}
.landing-sub { font-size: clamp(16px, 2.4vw, 22px); margin: 0; opacity: 0.95; text-shadow: 0 1px 12px rgba(0,0,0,0.45); }
.landing-cta { margin-top: 10px; padding: 14px 32px; font-size: 17px; }
.landing-hint { margin-top: 18px; font-size: 14px; opacity: 0.85; animation: landing-bounce 1.8s ease-in-out infinite; }
@keyframes landing-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .landing-hint { animation: none; } }
```

- [ ] **Step 6: Typecheck + build no container**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror|/ "
```
Expected: sem erros; "Compiled successfully".

- [ ] **Step 7: Smoke**

Reiniciar o frontend e validar o gating:
```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 1; done
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
No navegador (aba anônima/deslogado, `localStorage` limpo): `http://localhost:3100/` mostra a **landing** (carrossel de fundo, **sem Dock**, título + Entrar + dica). Clicar **Entrar** → app home aparece **com Dock** e grava `intro_seen`; recarregar → vai direto pro app. Logado → app direto. `localStorage.removeItem('intro_seen')` + reload → volta a intro.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/app-home.tsx frontend/app/components/landing.tsx frontend/app/components/home-gate.tsx frontend/app/page.tsx frontend/app/globals.css
git commit -m "feat(landing): gating intro/app + landing hero full-bleed"
```

---

## Self-Review

- **Cobertura da spec:** `AuthAPI.isLoggedIn` (T2) · context DockReveal + layout + SiteNav (T1) · gate login+localStorage+splash (T3) · Landing full-bleed com carrossel bg + Entrar + hint (T3) · AppHome extraída (T3) · HeroCarousel modo bg (T2) · page.tsx (T3) · esconder Dock na intro / aparecer no app (T1+T3) · reduced-motion no hint (T3). ✔
- **Consistência:** `useDockReveal`/`DockRevealProvider` (T1) usados em SiteNav (T1) e HomeGate (T3); `HeroCarousel mode` (T2) usado pela Landing (T3); `AuthAPI` (T2) usado pelo gate (T3). ✔
- **Sem placeholders:** todo passo traz código real + comando/saída. ✔
- **Risco conhecido:** setHidden em efeito do HomeGate com cleanup `setHidden(false)` evita o Dock ficar preso escondido ao sair de `/`. A animação de queda do Dock fica pra Fase 3 (aqui some/aparece direto, aceitável).
