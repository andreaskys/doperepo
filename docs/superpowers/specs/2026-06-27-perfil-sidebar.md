# Design — Sidebar no Perfil

**Data:** 2026-06-27
**Objetivo:** reestruturar a tela `/perfil` num layout com **menu lateral** que
alterna entre 4 seções, em vez de uma página que rola tudo.
**Escopo:** **frontend-only** (sem backend). Reaproveita os componentes já
existentes (`Dashboard`, `EditAccount`) e os dados já buscados.

## Decisões (do brainstorming)
| Tema | Escolha |
| --- | --- |
| Seções | **Bio · Dashboard · Anúncios · Conta** (4 itens). |
| Mini-perfil | Avatar + nome + badge de papel no **topo do sidebar**, sempre visível. |
| Bio | **Read-only** (e-mail, membro desde, texto da bio); botão "Editar" leva à seção Conta. |
| Aba ativa | `useState` sincronizado com o **hash da URL** (`/perfil#dashboard`). |
| Animação | Troca de seção com `motion`/`AnimatePresence`; pílula do item ativo com `layoutId`. |

> Isto é sub-navegação **interna** da página — não afeta o Dock do topo nem a
> regra "todas as opções de menu no Dock".

## Arquitetura (componentes em `app/perfil/page.tsx`)

### Estado e dados
- `ProfilePage` mantém o fetch atual no mount: `ProfileAPI.me()`,
  `VenuesAPI.listMine()`, `ProfileAPI.metrics()`.
- Novo estado: `const [tab, setTab] = useState<Tab>('bio')` onde
  `type Tab = 'bio' | 'dashboard' | 'anuncios' | 'conta'`.
- **Sync com hash:** no mount, ler `window.location.hash` (sem o `#`) e, se for
  uma `Tab` válida, iniciar nela. `setTab(t)` também faz
  `history.replaceState(null, '', '#' + t)` (não cria entrada nova no histórico).
  Guardado num helper `isTab(s): s is Tab`.

### Layout
- `<div className="profile-layout">` com dois filhos:
  - `<aside className="profile-sidebar">`:
    - mini-perfil: avatar (foto ou inicial), nome, badge de papel.
    - `<nav className="profile-nav">` com 4 `<button className="pnav-item">`
      (classe `on` no ativo); cada um com ícone inline + label e `onClick`
      chamando `setTab`. O item ativo renderiza uma `motion.span` com
      `layoutId="pnav-pill"` (a pílula desliza). `prefers-reduced-motion` →
      sem `layout` (a pílula só aparece/some).
  - `<div className="profile-content">`: `AnimatePresence mode="wait"` com uma
    `motion.section key={tab}` (fade/slide curto) que renderiza a seção ativa.

### Seções (componentes no mesmo arquivo)
- **`BioView`** (novo): mostra e-mail, "Membro desde {created_at}" e o texto da
  bio (ou um placeholder "Você ainda não escreveu uma bio."). Botão
  "Editar perfil" chama `onEdit()` que faz `setTab('conta')`.
- **`Dashboard`** (existente): KPIs + gráfico; recebe `metrics`, `error`,
  `publishedCount`, `reduce` como hoje.
- **`VenuesPreview`** (extraído do JSX atual de "Meus anúncios"): grid de
  `vcard`s + link "Gerenciar"; recebe `venues` e `reduce`.
- **`EditAccount`** (existente): nome/bio, upload de avatar, trocar senha.

### Ícones
Quatro ícones inline (mesmo padrão SVG `stroke=currentColor` usado no
`site-nav.tsx`), definidos localmente: Bio (pessoa), Dashboard (gráfico/colunas),
Anúncios (lista/grid), Conta (engrenagem).

## Animações (padrão do site, `docs/design.md`)
- Pílula do item ativo: `layoutId` (spring suave). Troca de seção: `opacity`+`y`
  curto (<300ms). Tudo desligado sob `prefers-reduced-motion`.

## Responsivo
- `>= 760px`: sidebar à esquerda (sticky, ~220px), conteúdo à direita.
- `< 760px`: `.profile-layout` vira coluna; mini-perfil no topo; `.profile-nav`
  vira **barra horizontal rolável** (`overflow-x:auto`, itens lado a lado);
  conteúdo abaixo, largura cheia.

## Estados de borda
- Carregando (`!user`): mantém o "Carregando…" atual antes de montar o layout.
- Erro do `me()` → tela de erro atual.
- Erro/loading das métricas e dos anúncios continuam tratados **dentro** das
  suas seções (Dashboard já trata; Anúncios mostra "Carregando…"/vazio).
- Hash inválido → cai em `bio`.

## Testes
- **Sem unit novo** (UI/estado puro de navegação). Verificação por:
  - `npm run typecheck` + build no container.
  - **Smoke visual:** abrir `/perfil` logado; clicar nos 4 itens troca a seção
    com animação; `/perfil#dashboard` abre direto no Dashboard; refresh mantém a
    aba; em viewport estreito o menu vira abas horizontais.

## Fora de escopo
Nenhuma mudança de backend, rota ou dado. Não adiciona novas seções além das 4.
Persistência da aba é via hash (não em localStorage).
