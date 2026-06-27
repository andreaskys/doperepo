# Landing imersiva — Fase 3 (app inline + queda do Dock) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A listagem/busca fica inline no fim da intro; ao chegar nela por scroll o Dock cai do topo e o app funciona normalmente.

**Architecture:** Frontend-only. `SiteNav` passa a renderizar sempre, animando a queda do Dock conforme `DockReveal.hidden`. A seção do app é extraída (`VenueExplore`) e a `Landing` a inclui no fim, revelando o Dock via `useInView` e gravando `intro_seen`.

**Tech Stack:** Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-landing-fase3.md`.
- **Sem backend.** Encerra a landing (Fases 1–3).
- **Queda do Dock** só na transição da intro (`initial={false}`); páginas normais não animam.
- **`prefers-reduced-motion`:** queda instantânea; scroll dos CTAs `behavior:'auto'`.
- **Reveal** = `useInView` na seção do app → `setHidden(false)` + `intro_seen` (uma vez).
- **Gates:** `npm run typecheck` (em `frontend/`) + build no container `docker compose exec -T frontend npm run build`.

---

### Task 1: `SiteNav` — Dock que cai do topo

**Files:**
- Modify: `frontend/app/components/site-nav.tsx`

**Interfaces:**
- Consumes: `hidden` do `useDockReveal()` (já presente).

- [ ] **Step 1: Remover o early-return e envolver o Dock**

Em `frontend/app/components/site-nav.tsx`:

1a. Remover a linha:
```tsx
  // intro/landing esconde o Dock até o usuário entrar no app (DockReveal context)
  if (hidden) return null;
```

1b. Trocar o `<Dock ... />` (dentro do `return`) por um wrapper animado:
```tsx
      <motion.div
        initial={false}
        animate={hidden ? { y: -160, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 26 }}
        style={{ pointerEvents: hidden ? 'none' : 'auto' }}
      >
        <Dock items={items} panelHeight={64} baseItemSize={44} magnification={64} dockHeight={140} distance={160} />
      </motion.div>
```
(O `if (pathname === '/login' || pathname === '/signup') return null;` continua.)

- [ ] **Step 2: Typecheck + build**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error"
```
Expected: sem erros. (Dock em páginas normais aparece parado — `hidden` default false, `initial={false}`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/site-nav.tsx
git commit -m "feat(landing): Dock cai do topo ao revelar (DockReveal)"
```

---

### Task 2: Extrair `VenueExplore` + usar no `AppHome`

**Files:**
- Create: `frontend/app/components/venue-explore.tsx`
- Modify: `frontend/app/components/app-home.tsx`

**Interfaces:**
- Produces (Task 3): `export default function VenueExplore()` (seção de busca + grid).

- [ ] **Step 1: Criar `VenueExplore`**

`frontend/app/components/venue-explore.tsx`:
```tsx
import { Suspense } from 'react';
import VenueFilters from './venue-filters';
import VenueGrid from './venue-grid';

export default function VenueExplore() {
  return (
    <section className="home-section">
      <h2>Espaços em destaque</h2>
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <VenueFilters />
        <VenueGrid />
      </Suspense>
    </section>
  );
}
```

- [ ] **Step 2: `AppHome` usa `VenueExplore`**

Substituir `frontend/app/components/app-home.tsx` por:
```tsx
import HeroCarousel from './hero-carousel';
import VenueExplore from './venue-explore';
import Footer from './footer';

export default function AppHome() {
  return (
    <>
      <main className="home">
        <HeroCarousel />
        <VenueExplore />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error"
git add frontend/app/components/venue-explore.tsx frontend/app/components/app-home.tsx
git commit -m "refactor(landing): extrai VenueExplore (reuso intro/app)"
```
Expected: typecheck/build sem erros; home do app igual.

---

### Task 3: `Landing` com app inline + reveal; `HomeGate` sem `onEnter`

**Files:**
- Modify: `frontend/app/components/landing.tsx`
- Modify: `frontend/app/components/home-gate.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: `VenueExplore`, `Footer`, `useDockReveal`, `useInView` (motion).

- [ ] **Step 1: Reescrever a `Landing`**

Substituir `frontend/app/components/landing.tsx` por:
```tsx
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
```

- [ ] **Step 2: `HomeGate` sem `onEnter`**

Substituir `frontend/app/components/home-gate.tsx` por:
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

  if (mode === 'checking') return <div className="landing-splash" />;
  if (mode === 'intro') return <Landing />;
  return <AppHome />;
}
```

- [ ] **Step 3: Estilos do app inline**

Append em `frontend/app/globals.css`:
```css
/* ===== Landing — app inline (fim da intro) ===== */
.landing-app { position: relative; z-index: 1; background: #faf9fc; border-radius: 24px 24px 0 0; }
.landing-app .home { padding-top: 96px; }
```

- [ ] **Step 4: Typecheck + build no container**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled successfully|Type error|/ "
```
Expected: typecheck/build sem erros.

- [ ] **Step 5: Smoke**

```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 1; done
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
No navegador (deslogado, `localStorage` limpo): rolar a intro até os anúncios → **Dock cai** do topo e a busca funciona; "Explorar espaços" rola até lá; recarregar → app direto (Dock parado). Reduced-motion → Dock sem animação.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/landing.tsx frontend/app/components/home-gate.tsx frontend/app/globals.css
git commit -m "feat(landing): app inline no fim da intro + reveal do Dock por scroll"
```

---

## Self-Review

- **Cobertura da spec:** Dock cai via motion+`initial={false}` (T1) · `VenueExplore` reuso (T2) · app inline na Landing + `useInView` reveal + `intro_seen` (T3) · CTAs rolam até o app (T3) · HomeGate sem onEnter (T3) · app inline claro com padding p/ o Dock (T3) · reduced-motion (T1/T3). ✔
- **Consistência:** `useDockReveal` (T1 SiteNav, T3 Landing/HomeGate); `VenueExplore` (T2) usado em AppHome (T2) e Landing (T3); `setHidden` estável (sem conflito HomeGate×Landing). ✔
- **Sem placeholders:** código real em todos os passos. ✔
- **Risco conhecido:** o efeito do HomeGate seta `hidden=true` no mount da intro; a Landing seta `false` no reveal — como as deps do efeito (`mode`,`setHidden`) não mudam, ele não re-roda e não sobrescreve. O `initial={false}` garante que páginas normais não animem a queda.
