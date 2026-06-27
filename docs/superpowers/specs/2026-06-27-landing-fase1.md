# Design — Landing imersiva, Fase 1 (estrutura + gating)

**Data:** 2026-06-27
**Objetivo:** fundar a experiência de intro para quem não está logado: gating
(quem vê), a **tela hero full-bleed** com o carrossel de fundo, botão "Entrar",
e **esconder o Dock** durante a intro.
**Escopo:** **frontend-only**. Fase 1 de 3 (storytelling parallax = Fase 2;
animação de queda do Dock + refinos = Fase 3). Ver
`docs/superpowers/specs/2026-06-27-home-carousel.md` (carrossel base).

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Quem vê | **Deslogado e só na 1ª vez** (`localStorage['intro_seen']`). Logado/retornante → app home atual. |
| Estrutura | **Página única em `/`** (sem rota nova). Fase 1 entrega a 1ª tela + gating. |
| Dock | Escondido durante a intro via **Context**; aparece ao entrar no app. |
| Carrossel | Reusado em modo **`bg`** (full-bleed, só fotos + scrim) como fundo da landing. |

## Arquitetura

### 1. Detecção de login (`app/venues/lib.ts`)
- `AuthAPI.isLoggedIn(): Promise<boolean>` — **fetch direto** a `/auth/me`
  (NÃO usa `req()`, que redireciona no 401). 200 → `true`; 401/erro → `false`.
  ```ts
  export const AuthAPI = {
    isLoggedIn: async (): Promise<boolean> => {
      try {
        const res = await fetch(`${API}/api/v1/auth/me`, { credentials: 'include' });
        return res.ok;
      } catch { return false; }
    },
  };
  ```

### 2. Context de visibilidade do Dock (`app/components/dock-reveal.tsx`)
- Provider com `{ hidden: boolean, setHidden: (b:boolean)=>void }`, default `hidden:false`.
- `DockRevealProvider` + hook `useDockReveal()`.
- Vai no `layout.tsx` envolvendo `<SiteNav/>` + `{children}`. Default não muda
  nenhuma página existente.

### 3. `layout.tsx`
- Envolver com `<DockRevealProvider>`:
  ```tsx
  <body>
    <DockRevealProvider>
      <SiteNav />
      {children}
    </DockRevealProvider>
  </body>
  ```

### 4. `SiteNav` consome o context (`app/components/site-nav.tsx`)
- Lê `hidden` do `useDockReveal()`.
- Quando `hidden` é `true`, o Dock **não renderiza** (ou renderiza com
  `opacity:0; translateY(-140px)` — sem animação fina ainda; a queda vem na Fase 3).
- Quando `hidden` vira `false`, aparece. Mantém todo o comportamento atual
  (login, sino, `/login`/`/signup` escondem).

### 5. Gate (`app/components/home-gate.tsx`)
- Client. Estado `mode: 'checking' | 'intro' | 'app'` (inicia `'checking'`).
- No mount:
  ```
  const seen = localStorage.getItem('intro_seen');
  const logged = await AuthAPI.isLoggedIn();
  setMode(!logged && !seen ? 'intro' : 'app');
  ```
- Render:
  - `'checking'` → splash neutro (`<div className="landing-splash" />`, fundo gradiente da marca) — evita flicker do app home.
  - `'intro'` → `<Landing onEnter={enterApp} />` e `setHidden(true)` (esconde o Dock).
  - `'app'` → `<AppHome />` e `setHidden(false)`.
- `enterApp()`: `localStorage.setItem('intro_seen','1')`; `setHidden(false)`; `setMode('app')`.

### 6. App home extraída (`app/components/app-home.tsx`)
- Move o conteúdo atual de `page.tsx` (carrossel **contido** + seção "Espaços em
  destaque" com `Suspense`/`VenueFilters`/`VenueGrid` + `Footer`). Sem mudança de
  comportamento — é o "else" do gate.

### 7. Landing (`app/components/landing.tsx`) — escopo da Fase 1
- Seção full-bleed `.landing` (min-height 100vh), colada no topo:
  - **Fundo:** `<HeroCarousel mode="bg" />` (full-bleed, fotos + scrim, sem overlay/chip/dots).
  - **Conteúdo (centro):** título "Espaços para eventos inesquecíveis" + subtítulo
    "Encontre, reserve e anuncie — tudo num lugar só." + botão **"Entrar"**
    (`onClick={onEnter}`) + dica "role para descobrir ↓".
  - (As cenas "como funciona" e o app no fim entram na Fase 2; por ora o botão
    Entrar é o caminho pro app.)

### 8. Carrossel com modo `bg` (`app/components/hero-carousel.tsx`)
- Nova prop `mode?: 'hero' | 'bg'` (default `'hero'` — comportamento atual intacto).
- `mode==='bg'`: renderiza só a camada de fotos (`AnimatePresence` crossfade) +
  `.hc-scrim`, **sem** `.hc-overlay`, `.hc-chip`, `.hc-arrow`, `.hc-dots`. Preenche
  o pai (`position:absolute; inset:0`). Mantém o autoplay/reduced-motion.

### 9. `page.tsx`
- Vira: `export default function Home(){ return <HomeGate />; }`.

## Estilos (`app/globals.css`)
- `.landing` (full-bleed, relativo, min-height 100vh, overflow hidden, fundo escuro).
- `.landing > .hero-carousel` em modo bg ocupa `position:absolute; inset:0; border-radius:0; height:100%`.
- `.landing-inner` (conteúdo centralizado, z acima do scrim, texto branco).
- `.landing-cta` (botão grande), `.landing-hint` (seta com leve bounce — respeita reduced-motion).
- `.landing-splash` (fundo `--brand-gradient`, 100vh).
- Full-bleed: como `.landing` é renderizada direto pelo `HomeGate` (fora do
  `.home`/`.container`), ocupa 100vw naturalmente.

## Acessibilidade
- Botão "Entrar" é o escape sempre disponível (foco/teclado).
- `prefers-reduced-motion`: a dica "↓" não pulsa; carrossel bg já não autoplay.
- O Dock escondido não deixa armadilha de foco (não está no DOM quando `hidden`).

## Testes
- Sem unit novo (UI/estado). Verificação:
  - `npm run typecheck` + build no container.
  - **Smoke:** deslogado e sem `intro_seen` → vê a landing (carrossel de fundo,
    sem Dock); clicar "Entrar" → app home aparece **com** Dock e grava `intro_seen`;
    recarregar → vai direto pro app (Dock presente). Logado → app direto.
    `localStorage.removeItem('intro_seen')` volta a intro.

## Fora desta fase
- **Fase 2:** cenas parallax "como funciona" + app no fim da mesma página + reveal por scroll.
- **Fase 3:** animação de **queda** do Dock + refinos de parallax + mobile.
- Sem backend/rota nova. App home atual permanece intacto.
