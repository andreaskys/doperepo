# Design — Landing imersiva, Fase 3 (app inline + queda do Dock)

**Data:** 2026-06-27
**Objetivo:** fechar a intro — a **listagem/busca real** fica no fim da mesma
página e, ao chegar nela por scroll, o **Dock cai do topo** e o app passa a
funcionar normalmente.
**Escopo:** **frontend-only**. Fase 3 de 3. Ver `2026-06-27-landing-fase1.md`
(gating/DockReveal) e `2026-06-27-landing-fase2.md` (parallax/cenas).

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| App | **Inline** no fim da intro (filtros + grid + footer), não troca de tela. |
| Reveal do Dock | `useInView` na seção do app → `DockReveal.hidden=false` + grava `intro_seen`. |
| Animação | Dock **cai do topo** (`y:-160→0`, spring) só nessa transição; páginas normais não animam. |
| CTAs | "Entrar" (topo) e "Explorar espaços" (fim) **rolam até** a seção do app (que dispara o reveal). |

## Arquitetura

### 1. `SiteNav` — Dock que cai (`app/components/site-nav.tsx`)
- **Remover** o `if (hidden) return null;`.
- Envolver o `<Dock/>` num `motion.div`:
  ```tsx
  <motion.div
    initial={false}
    animate={hidden ? { y: -160, opacity: 0 } : { y: 0, opacity: 1 }}
    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 26 }}
    style={{ pointerEvents: hidden ? 'none' : 'auto' }}
  >
    <Dock ... />
  </motion.div>
  ```
- `initial={false}`: em páginas normais (`hidden` já `false` no mount) o Dock aparece
  parado (sem queda). Na intro, `hidden` começa `true` → Dock fica fora de tela
  (`y:-160`); quando o reveal vira `false`, anima a **queda**. O painel de
  notificações (AnimatePresence) fica como está.

### 2. Reuso do explorador (`app/components/venue-explore.tsx`)
- Extrair a seção "Espaços em destaque" (h2 + `Suspense`/`VenueFilters`/`VenueGrid`)
  num componente `VenueExplore`. Usado por `AppHome` e pela `Landing`.
- `AppHome` passa a ser `HeroCarousel` (contido) + `VenueExplore` + `Footer`.

### 3. `Landing` ganha o app inline + reveal (`app/components/landing.tsx`)
- Estrutura: hero → `HeroParallax` → `LandingScenes` → **CTA "Explorar espaços"** →
  **seção do app** (`<div className="landing-app" ref={appRef}>` com `VenueExplore` + `Footer`).
- `const inView = useInView(appRef, { amount: 0.2 });` + efeito: quando `inView`
  vira `true` (uma vez), `setHidden(false)` e `localStorage.setItem('intro_seen','1')`.
- CTAs chamam `appRef.current?.scrollIntoView(...)`: "Entrar" (topo) jump direto;
  "Explorar espaços" (fim) com `behavior:'smooth'`. O `useInView` cuida do reveal.
- A `Landing` consome `useDockReveal()` (não precisa mais do `onEnter`).
- **Fundo do app inline** é claro (contraste com a intro escura), com cantos
  superiores arredondados (sensação de "painel subindo") e `padding-top` que
  limpa o Dock fixo.

### 4. `HomeGate` (`app/components/home-gate.tsx`)
- Some o `onEnter`/`enterApp` (o app agora é inline). `mode==='intro'` →
  `<Landing/>`; `mode==='app'` → `<AppHome/>`. Mantém o `setHidden(mode==='intro'||'checking')`
  com cleanup `setHidden(false)` (a `Landing` reabre via reveal; sem conflito,
  pois o efeito não re-roda com `mode` estável).

### 5. Estilos (`app/globals.css`)
- `.landing-app { background: var(--bg, #faf9fc); border-radius: 24px 24px 0 0; }`
- `.landing-app .home { padding-top: 96px; }` (limpa o Dock fixo ao revelar).
- `.landing-app` herda o container `.home` (largura 1100px) — texto volta ao tom claro.

## Acessibilidade & detalhes
- `prefers-reduced-motion`: a queda do Dock é instantânea (`duration:0`); o scroll
  dos CTAs usa `behavior:'auto'`.
- Dock escondido tem `pointer-events:none` (não captura clique fora de tela).
- `intro_seen` gravado ao alcançar o app → próxima visita vai direto pro `AppHome`.

## Testes
- `npm run typecheck` + build no container.
- **Smoke visual** (deslogado/1ª vez): rolar a intro até os anúncios → o **Dock cai**
  do topo e a busca funciona; clicar "Explorar espaços" rola até lá e revela; recarregar
  → vai direto pro app (Dock normal, sem queda). Páginas internas: Dock aparece parado.
  Reduced-motion → Dock sem animação.

## Fora de escopo
Nada de backend. Encerra a landing (Fases 1–3). Refinos visuais finos ficam a critério.
