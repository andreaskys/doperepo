# Landing imersiva — Fase 2 (storytelling parallax) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar corpo à intro: endpoint de fotos dos publicados, parede parallax (HeroParallax portado pra CSS), 3 cenas "como funciona" e CTA final que entra no app.

**Architecture:** Backend ganha `GET /public/photos` (fotos dos espaços publicados). Frontend porta o HeroParallax (lógica `motion` idêntica, Tailwind→CSS), adiciona `LandingScenes` e integra tudo na `Landing` (hero → parallax → cenas → CTA). Dock segue escondido (Fase 1); app inline + queda do Dock = Fase 3.

**Tech Stack:** Go + sqlc; Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-landing-fase2.md`.
- **HeroParallax portado pra CSS puro** — NÃO instalar Tailwind/shadcn. Lógica `motion` idêntica ao original.
- **Imagens:** galerias dos publicados via `GET /public/photos` (1 chamada). Parede = 15 cards (3×5), repetindo o pool se faltar. Cada card → `/venues/:venue_id/reservar`.
- **Rota nova separada** de `/public/venues/:id` (usar `/public/photos`) pra não colidir com o param no Gin.
- **sqlc:** após editar `.sql`, `sqlc generate` de `./backend` e `git add internal/db/sqlc/`.
- **Acessibilidade:** `prefers-reduced-motion` desliga o parallax (grade/texto estáticos); imagens `loading="lazy"`; CTA/links focáveis.
- **Dock:** continua escondido na intro (não mexer no DockReveal aqui).
- **Gates:** backend `docker compose exec -T backend go test ./...` / `go build ./...`; frontend `npm run typecheck` + build no container.

---

### Task 1: Endpoint `GET /public/photos`

**Files:**
- Modify: `backend/internal/db/queries/venues.sql`
- Regenerate: `backend/internal/db/sqlc/`
- Modify: `backend/internal/venues/service.go`
- Modify: `backend/internal/venues/handler.go`

**Interfaces:**
- Produces: `GET /api/v1/public/photos` → `[{venue_id, title, url}]` (espaços publicados).

- [ ] **Step 1: Query**

Acrescentar ao final de `backend/internal/db/queries/venues.sql`:
```sql
-- name: ListPublishedPhotos :many
SELECT p.venue_id, v.title AS venue_title, p.url
FROM venue_photos p
JOIN venues v ON v.id = p.venue_id
WHERE v.status = 'PUBLISHED'
ORDER BY p.venue_id, p.position
LIMIT 30;
```

- [ ] **Step 2: Regerar sqlc + conferir o tipo**

Run (de `backend/`):
```bash
"$(go env GOPATH)/bin/sqlc" generate
grep -n "ListPublishedPhotosRow" internal/db/sqlc/venues.sql.go
```
Expected: existe `type ListPublishedPhotosRow struct { VenueID int64; VenueTitle string; Url string }`.

- [ ] **Step 3: Service passthrough**

Em `backend/internal/venues/service.go`, após `Photos`:
```go
// PublishedPhotos lista fotos dos espaços publicados (vitrine da landing).
func (s *Service) PublishedPhotos(ctx context.Context) ([]sqlc.ListPublishedPhotosRow, error) {
	return s.q.ListPublishedPhotos(ctx)
}
```

- [ ] **Step 4: Rota + handler + DTO**

Em `backend/internal/venues/handler.go`:

4a. Na `Routes`, após `rg.GET("/public/venues/:id", h.getPublic)`:
```go
	rg.GET("/public/photos", h.listShowcasePhotos) // vitrine da landing (parallax)
```
4b. Adicionar o handler + DTO (perto do `listPublic`):
```go
type showcasePhotoDTO struct {
	VenueID int64  `json:"venue_id"`
	Title   string `json:"title"`
	URL     string `json:"url"`
}

func (h *Handler) listShowcasePhotos(c *gin.Context) {
	rows, err := h.svc.PublishedPhotos(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao listar fotos"})
		return
	}
	out := make([]showcasePhotoDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, showcasePhotoDTO{VenueID: r.VenueID, Title: r.VenueTitle, URL: r.Url})
	}
	c.JSON(http.StatusOK, out)
}
```

- [ ] **Step 5: Build + smoke**

Run:
```bash
docker compose exec -T backend go build ./... && docker compose restart backend >/dev/null 2>&1
for i in $(seq 1 20); do curl -sf http://localhost:8080/health >/dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:8080/api/v1/public/photos
echo
```
Expected: array `[{"venue_id":...,"title":"...","url":"http://localhost:19000/..."}]`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/db/queries/venues.sql backend/internal/db/sqlc/ backend/internal/venues/service.go backend/internal/venues/handler.go
git commit -m "feat(landing): GET /public/photos (vitrine dos espaços publicados)"
```

---

### Task 2: Frontend lib — `ShowcasePhoto` + `PublicAPI.showcasePhotos`

**Files:**
- Modify: `frontend/app/venues/lib.ts`

**Interfaces:**
- Produces: `ShowcasePhoto`, `PublicAPI.showcasePhotos(): Promise<ShowcasePhoto[]>`.

- [ ] **Step 1: Tipo + método**

Em `frontend/app/venues/lib.ts`:

1a. Adicionar o tipo (perto dos outros tipos públicos):
```ts
export interface ShowcasePhoto {
  venue_id: number;
  title: string;
  url: string;
}
```
1b. Dentro do objeto `PublicAPI` (após `searchVenues`):
```ts
  showcasePhotos: async (): Promise<ShowcasePhoto[]> => {
    try {
      const res = await fetch(`${API}/api/v1/public/photos`);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo
git add frontend/app/venues/lib.ts
git commit -m "feat(landing): ShowcasePhoto + PublicAPI.showcasePhotos"
```
Expected: typecheck sem erros.

---

### Task 3: `HeroParallax` portado (CSS puro) + estilos

**Files:**
- Create: `frontend/app/components/hero-parallax.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes (Task 2): `ShowcasePhoto`.
- Produces (Task 5): `export default function HeroParallax({ photos })`.

- [ ] **Step 1: Componente portado**

`frontend/app/components/hero-parallax.tsx`:
```tsx
'use client';

import React from 'react';
import { motion, useScroll, useTransform, useSpring, useReducedMotion, type MotionValue } from 'motion/react';
import type { ShowcasePhoto } from '../venues/lib';

export default function HeroParallax({ photos }: { photos: ShowcasePhoto[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
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
```

- [ ] **Step 2: Estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== HeroParallax (landing) ===== */
.hpx {
  height: 300vh; padding: 10rem 0; overflow: hidden; position: relative;
  display: flex; flex-direction: column;
  perspective: 1000px; transform-style: preserve-3d;
}
.hpx-header { max-width: 80rem; margin: 0 auto; padding: 2rem 1.5rem 4rem; width: 100%; }
.hpx-header h1 { font-family: var(--font-display, inherit); font-size: clamp(30px, 5vw, 60px); font-weight: 700; margin: 0; color: #fff; }
.hpx-header p { max-width: 40rem; font-size: clamp(15px, 2vw, 20px); margin-top: 1.25rem; color: rgba(255,255,255,0.8); }
.hpx-row { display: flex; gap: 4rem; margin-bottom: 4rem; justify-content: center; }
.hpx-row.reverse { flex-direction: row-reverse; }
.hpx-card { height: 24rem; width: 30rem; position: relative; flex-shrink: 0; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.3); }
.hpx-card a { display: block; height: 100%; }
.hpx-card img { object-fit: cover; position: absolute; inset: 0; height: 100%; width: 100%; }
.hpx-card-overlay { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.hpx-card:hover .hpx-card-overlay { opacity: 0.5; }
.hpx-card-title { position: absolute; bottom: 1rem; left: 1rem; margin: 0; color: #fff; opacity: 0; transition: opacity 0.3s; z-index: 2; }
.hpx-card:hover .hpx-card-title { opacity: 1; }
@media (max-width: 760px) {
  .hpx { height: 200vh; padding: 5rem 0; }
  .hpx-row { gap: 1.5rem; margin-bottom: 1.5rem; }
  .hpx-card { height: 14rem; width: 18rem; }
}
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror"
git add frontend/app/components/hero-parallax.tsx frontend/app/globals.css
git commit -m "feat(landing): HeroParallax portado pra CSS puro"
```
Expected: typecheck/build sem erros.

---

### Task 4: `LandingScenes` (3 cenas) + estilos

**Files:**
- Create: `frontend/app/components/landing-scenes.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Produces (Task 5): `export default function LandingScenes()`.

- [ ] **Step 1: Componente**

`frontend/app/components/landing-scenes.tsx`:
```tsx
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
```

- [ ] **Step 2: Estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== Landing — cenas "como funciona" ===== */
.landing-scenes { position: relative; z-index: 1; }
.scene { min-height: 80vh; display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
.scene-inner { max-width: 620px; text-align: center; color: #fff; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.scene-ico { color: var(--brand-blue); }
.scene-step { font-size: 13px; letter-spacing: 0.18em; color: rgba(255,255,255,0.55); }
.scene-title { font-family: var(--font-display, inherit); font-size: clamp(28px, 4vw, 44px); margin: 0; }
.scene-text { font-size: clamp(16px, 2vw, 20px); color: rgba(255,255,255,0.85); margin: 0; }
```

- [ ] **Step 3: Typecheck + build + commit**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror"
git add frontend/app/components/landing-scenes.tsx frontend/app/globals.css
git commit -m "feat(landing): 3 cenas 'como funciona'"
```
Expected: typecheck/build sem erros.

---

### Task 5: Integrar na `Landing` (parallax + cenas + CTA)

**Files:**
- Modify: `frontend/app/components/landing.tsx`
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: `HeroParallax`, `LandingScenes`, `PublicAPI.showcasePhotos`, `ShowcasePhoto`.

- [ ] **Step 1: Reescrever a Landing**

Substituir `frontend/app/components/landing.tsx` por:
```tsx
'use client';

import { useEffect, useState } from 'react';
import HeroCarousel from './hero-carousel';
import HeroParallax from './hero-parallax';
import LandingScenes from './landing-scenes';
import { PublicAPI, type ShowcasePhoto } from '../venues/lib';

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [photos, setPhotos] = useState<ShowcasePhoto[]>([]);

  useEffect(() => {
    PublicAPI.showcasePhotos().then(setPhotos).catch(() => {});
  }, []);

  return (
    <div className="landing-scroll">
      <section className="landing">
        <HeroCarousel mode="bg" />
        <div className="landing-inner">
          <h1 className="landing-title">Espaços para eventos inesquecíveis</h1>
          <p className="landing-sub">Encontre, reserve e anuncie — tudo num lugar só.</p>
          <button type="button" className="button landing-cta" onClick={onEnter}>Entrar</button>
          <span className="landing-hint" aria-hidden="true">role para descobrir ↓</span>
        </div>
      </section>

      <HeroParallax photos={photos} />

      <LandingScenes />

      <section className="landing-cta-final">
        <h2>Pronto pra encontrar seu espaço?</h2>
        <button type="button" className="button landing-cta" onClick={onEnter}>Explorar espaços</button>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Estilos do wrapper + CTA final**

Append em `frontend/app/globals.css`:
```css
/* ===== Landing — wrapper do scroll + CTA final ===== */
.landing-scroll { background: #11102a; }
.landing-cta-final {
  min-height: 70vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; text-align: center; padding: 60px 24px; color: #fff;
}
.landing-cta-final h2 { font-family: var(--font-display, inherit); font-size: clamp(26px, 4vw, 44px); margin: 0; }
```

- [ ] **Step 3: Typecheck + build no container**

```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror|/ "
```
Expected: typecheck/build sem erros.

- [ ] **Step 4: Smoke**

```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/ && break; sleep 1; done
curl -s -o /dev/null -w "GET /: %{http_code}\n" http://localhost:3100/
```
No navegador (deslogado, `localStorage` limpo): a intro mostra hero → **parede parallax** passando ao scroll → **3 cenas** revelando texto → CTA **"Explorar espaços"** que entra no app. Sem Dock até entrar. Reduced-motion → versão estática.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/landing.tsx frontend/app/globals.css
git commit -m "feat(landing): integra parallax + cenas + CTA na intro"
```

---

## Self-Review

- **Cobertura da spec:** endpoint `/public/photos` (T1) · lib showcasePhotos (T2) · HeroParallax portado c/ lógica motion idêntica + repetição do pool + links + lazy (T3) · 3 cenas whileInView (T4) · integração hero→parallax→cenas→CTA (T5) · reduced-motion em parallax/cenas (T3/T4) · dock intocado (todas). ✔
- **Consistência:** `ListPublishedPhotosRow{VenueID,VenueTitle,Url}` (T1) → DTO `{venue_id,title,url}` (T1) → `ShowcasePhoto` (T2) → `HeroParallax photos` (T3) → `Landing` (T5). ✔
- **Sem placeholders:** código real em todos os passos. ✔
- **Risco conhecido:** Gin — `/public/photos` é caminho fixo distinto de `/public/venues/:id`, sem colisão de param. Poucas fotos no QA → a repetição do pool preenche as 3 fileiras (visual ok; enche de verdade quando houver mais anúncios).

## Fora desta fase (Fase 3)
App inline no fim + Dock caindo (IntersectionObserver → `DockReveal.hidden=false` com animação) + refinos de parallax/mobile.
