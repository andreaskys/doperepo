# Design — Carrossel na Home (hero)

**Data:** 2026-06-27
**Objetivo:** transformar o topo da home num **carrossel hero** que fica passando
as fotos de capa dos anúncios publicados.
**Escopo:** **frontend-only** (reusa o endpoint público existente).

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Posição | **Hero do topo** — substitui a `<section className="hero">` de texto. |
| Estilo | **Banner único** com **crossfade** (uma foto por vez). |
| Largura | **Contido** no container (1100px), arredondado — não full-bleed. |
| Conteúdo | Título da marca constante sobreposto + **chip por slide** (espaço · cidade) clicável. |
| Autoplay | ~5s, pausa no hover; `prefers-reduced-motion` desliga. |

## Arquitetura

### 1. Dados (`app/components/hero-carousel.tsx`)
- Componente client. No mount: `PublicAPI.searchVenues({})` → filtra
  `v.cover_url` truthy → `slice(0, 8)`. Cada slide usa `{id, cover_url, title, city, state}`.
- Estado: `slides: Venue[] | null` (null = carregando), `idx: number` (slide ativo),
  `paused: boolean` (hover).
- **Fallback:** se a busca falhar **ou** não houver nenhum espaço com capa,
  renderiza o hero de texto atual (`<section className="hero">` com h1+p), sem carrossel.

### 2. Autoplay
- `useEffect` com `setInterval(5000)` que faz `idx = (idx+1) % slides.length`,
  só quando `slides.length > 1`, `!paused` e `!reduce` (`useReducedMotion`).
  Limpa o intervalo no cleanup e quando as deps mudam (reinicia o timer ao
  navegar manualmente — `idx` nas deps).
- `go(i)` seta `idx` (clampado por módulo) — usado por dots e setas.

### 3. Layout (markup)
```
<section className="hero-carousel" onMouseEnter={pause} onMouseLeave={resume}>
  <AnimatePresence>            // crossfade do slide ativo (key={slide.id})
    <motion.div className="hc-slide" style={{backgroundImage}} ... />  // ou <img>
  </AnimatePresence>
  <div className="hc-scrim" />
  <div className="hc-overlay">  // título da marca + subtítulo (constante)
    <h1>Encontre o espaço perfeito para o seu evento</h1>
    <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
  </div>
  <a className="hc-chip" href={`/venues/${slide.id}/reservar`}>   // por slide
    {slide.title} · {slide.city}/{slide.state} <span>Ver espaço →</span>
  </a>
  <button className="hc-arrow left"  aria-label="Anterior" onClick={()=>go(idx-1)}>‹</button>
  <button className="hc-arrow right" aria-label="Próximo"  onClick={()=>go(idx+1)}>›</button>
  <div className="hc-dots">         // 1 botão por slide
    {slides.map((s,i)=><button key={s.id} className={i===idx?'on':''} aria-label={`Ir para ${i+1}`} onClick={()=>go(i)} />)}
  </div>
</section>
```
- A imagem é `<img src={cover_url} alt={title}>` dentro de `.hc-slide` (object-fit:cover),
  envolta por `AnimatePresence mode="popLayout"`/`"sync"` com `key` do slide para crossfade
  (opacity 0→1, ~0.6s). Com `reduce`, sem animação (troca seca).

### 4. Estilos (`app/globals.css`)
- `.hero-carousel`: `position:relative; height:clamp(360px,56vh,520px); border-radius:18px; overflow:hidden;`
- `.hc-slide`, `.hc-slide img`: `position:absolute; inset:0; width/height:100%; object-fit:cover;`
- `.hc-scrim`: gradiente escuro (transparente no topo → ~rgba(0,0,0,.55) embaixo).
- `.hc-overlay`: centralizado, texto branco, `text-shadow`/z acima do scrim; reusa o tom do `.hero` mas em branco.
- `.hc-chip`: canto inferior-esquerdo, pílula translúcida, link branco; `Ver espaço →` em destaque.
- `.hc-arrow`: círculos translúcidos nas laterais (aparecem sempre; em telas finas podem sumir).
- `.hc-dots`: centro inferior, bolinhas; `.on` usa branco sólido.
- Responsivo (<640px): altura menor (`clamp(260px,48vh,360px)`), h1 menor, setas opcionais escondidas.

## Acessibilidade
- Dots e setas são `<button>` com `aria-label`; imagens com `alt={title}`; o chip é um link focável.
- Sob `prefers-reduced-motion`: sem autoplay e sem fade; usuário navega pelos dots/setas.

## Integração na página (`app/page.tsx`)
- Trocar a `<section className="hero">…</section>` por `<HeroCarousel />`.
- A seção "Espaços em destaque" (filtros + grid) permanece igual, abaixo.

## Testes
- Sem unit novo (UI). Verificação:
  - `npm run typecheck` + build no container.
  - **Smoke visual:** home com espaços publicados com capa → banner passa sozinho a
    cada ~5s com fade; hover pausa; dots/setas navegam; chip leva ao `/venues/:id/reservar`.
    Sem capas → cai no hero de texto.

## Fora de escopo
Sem backend/rota nova. Não altera o grid "Espaços em destaque". Sem vídeo, sem
upload. Carrossel mostra só espaços **publicados** (o que o endpoint público já retorna).
