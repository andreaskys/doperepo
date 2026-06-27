# Design — Landing imersiva, Fase 2 (storytelling parallax)

**Data:** 2026-06-27
**Objetivo:** dar corpo à intro — uma **parede parallax** (HeroParallax portado)
com as fotos dos espaços + **3 cenas** "como funciona" (Descubra/Reserve/Anuncie),
terminando num CTA pra entrar no app.
**Escopo:** Fase 2 de 3. Ver `2026-06-27-landing-fase1.md` (gating/landing) e
`2026-06-27-home-carousel.md` (carrossel). A queda do Dock + app inline = **Fase 3**.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Componente | **HeroParallax (Aceternity) PORTADO pra CSS puro** — lógica `motion` idêntica, classes Tailwind → nossas. Sem instalar Tailwind/shadcn. |
| Posição | **Peça central**, logo após o hero; as 3 cenas vêm depois. |
| Imagens | **Galerias dos espaços publicados**, via **endpoint novo** `GET /public/photos` (1 chamada). Repete pra preencher se faltar. |
| Fim da intro | Termina num **CTA "Explorar espaços"** que entra no app (reusa o `onEnter` da Fase 1). App inline + Dock caindo = Fase 3. |
| Dock | Continua **escondido** durante toda a intro (comportamento da Fase 1). |

## Arquitetura

### 1. Backend — endpoint de fotos (showcase)
- **Query (`internal/db/queries/venues.sql`)** `ListPublishedPhotos :many`:
  ```sql
  -- name: ListPublishedPhotos :many
  SELECT p.venue_id, v.title AS venue_title, p.url
  FROM venue_photos p
  JOIN venues v ON v.id = p.venue_id
  WHERE v.status = 'PUBLISHED'
  ORDER BY p.venue_id, p.position
  LIMIT 30;
  ```
- **Service (`venues.Service`)** passthrough `ListPublishedPhotos(ctx) ([]sqlc.ListPublishedPhotosRow, error)`.
- **Handler:** rota **pública** `GET /public/photos` (caminho separado de `/public/venues/:id` pra não colidir com o param `:id` no Gin). DTO: `[{ venue_id, title, url }]`. Sem auth, sem cache novo (lista curta).

### 2. Frontend — lib (`app/venues/lib.ts`)
- `interface ShowcasePhoto { venue_id: number; title: string; url: string }`.
- `PublicAPI.showcasePhotos = () => fetch público` (não passa por `req()`), retorna `ShowcasePhoto[]` (vazio em erro).

### 3. Frontend — HeroParallax portado (`app/components/hero-parallax.tsx`)
- **Mantém a lógica do componente original** (`useScroll({target, offset:["start start","end start"]})`,
  `useSpring`/`useTransform` para `translateX`/`translateXReverse`/`rotateX`/`rotateZ`/`translateY`/`opacity`,
  3 fileiras, `ProductCard` com `whileHover`).
- **Tailwind → CSS:** todas as classes utilitárias viram classes nossas
  (`.hpx`, `.hpx-header`, `.hpx-rows`, `.hpx-row`, `.hpx-card`, `.hpx-card-overlay`, `.hpx-card-title`).
  O contêiner mantém `perspective:1000px` e `transform-style:preserve-3d` via CSS.
- **Dados:** recebe `photos: ShowcasePhoto[]`. Monta um **pool** e preenche 3 fileiras de 5
  (15 cards); se vierem menos, **repete ciclando** (`pool[i % pool.length]`). Cada card é
  link pra `/venues/${venue_id}/reservar`; `img alt={title}`; `loading="lazy"`.
- **Header (copy nossa):** título "Espaços que viram experiências" + parágrafo
  "Uma seleção de lugares reais já anunciados na plataforma — role para conhecer."
- **Fallback:** sem fotos (`photos.length === 0`) → não renderiza a parede (a landing
  segue com hero + cenas).
- **Reduced-motion:** com `useReducedMotion`, os `MotionValue` ficam estáticos
  (sem translate/rotate por scroll) — a parede vira uma grade simples.

### 4. Frontend — 3 cenas "como funciona" (`app/components/landing-scenes.tsx`)
- Componente com 3 blocos `.scene` (cada `min-height` generoso). Cada cena tem um
  `ref` + `useScroll({target, offset})` e `useTransform` ligando o progresso a
  `opacity`/`y` do texto (entra ao aproximar do centro, sai ao passar). Copy:
  - **Descubra** — "Salões, chácaras, rooftops e galpões. Filtre por cidade, capacidade e preço e ache o espaço certo pro seu evento."
  - **Reserve** — "Veja a disponibilidade em tempo real, escolha as datas e feche direto com o anfitrião — com confirmação e notificações."
  - **Anuncie** — "Tem um espaço? Cadastre fotos, defina a diária e comece a receber reservas. Você vira anfitrião ao publicar o primeiro."
- Ícone simples por cena (SVG inline, padrão do site). `prefers-reduced-motion` → textos estáticos (sem transform por scroll).

### 5. Frontend — CTA final + Landing (`app/components/landing.tsx`)
- A `Landing` passa a buscar `PublicAPI.showcasePhotos()` no mount e a renderizar, em scroll:
  1. **Hero** (Fase 1) — título/sub + Entrar + dica "↓".
  2. **`<HeroParallax photos={photos} />`** (se houver fotos).
  3. **`<LandingScenes />`** (as 3 cenas).
  4. **CTA final:** "Pronto pra encontrar seu espaço?" + botão **"Explorar espaços"** (`onClick={onEnter}`).
- O botão Entrar do hero e o "Explorar espaços" do fim chamam o mesmo `onEnter` (grava `intro_seen` + vai pro app — lógica da Fase 1).

### 6. Estilos (`app/globals.css`)
- `.hpx` (altura ~`300vh`, `overflow:hidden`, `perspective`, `preserve-3d`), `.hpx-header`,
  `.hpx-rows`, `.hpx-row` (flex, gap), `.hpx-card` (~30rem × 24rem, `shrink:0`, hover sombra/overlay/título),
  `.hpx-card img` (cover, absolute).
- `.scene` (full-width, padding vertical grande, centralizado), `.scene-ico`, `.scene-title`, `.scene-text`.
- `.landing-cta-final` (bloco final centralizado com botão grande).
- Responsivo: cards menores no mobile; `.hpx` com menos altura; cenas com menos padding.

## Acessibilidade & performance
- `prefers-reduced-motion`: parallax desliga (grade/texto estáticos); nada de scroll-jacking.
- Imagens `loading="lazy"`; a parede limita a 15 cards e o endpoint a 30 fotos.
- Botões/links focáveis; o "Explorar espaços" é um escape claro no fim; o Entrar do topo continua.

## Testes
- **Smoke backend:** `GET /public/photos` retorna `[{venue_id,title,url}]` dos publicados.
- **Frontend:** `npm run typecheck` + build no container; **smoke visual** (deslogado/1ª vez):
  intro mostra hero → parede parallax passando ao scroll → 3 cenas revelando texto →
  CTA "Explorar espaços" que entra no app. Reduced-motion → versão estática.

## Fora desta fase (Fase 3)
- App **inline** no fim da intro + **Dock caindo** (IntersectionObserver vira `DockReveal.hidden=false`
  com animação de queda) ao chegar nos anúncios.
- Refinos finos de parallax e mobile.
