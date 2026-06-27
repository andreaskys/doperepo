# Sidebar no Perfil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar `/perfil` num layout com menu lateral (Bio · Dashboard · Anúncios · Conta), alternando seções com animação e hash na URL.

**Architecture:** Frontend-only. `ProfilePage` ganha estado `tab` (sincronizado com `window.location.hash`), um `<aside>` com mini-perfil + nav, e um `<div>` de conteúdo que renderiza a seção ativa via `AnimatePresence`. Extrai `BioView` e `VenuesPreview`; reusa `Dashboard` e `EditAccount` sem alterá-los.

**Tech Stack:** Next.js 15 + React 19 + TS strict + `motion/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-perfil-sidebar.md`.
- **Sem backend:** nenhuma rota/tipo/dado muda. Dados seguem buscados no mount (`me`/`listMine`/`metrics`).
- **Sub-navegação interna:** não toca no Dock do topo (regra "tudo no Dock" não se aplica aqui).
- **Design/animação (`docs/design.md`):** pílula do item ativo via `layoutId`; troca de seção `opacity`+`y` <300ms; tudo desligado sob `prefers-reduced-motion` (`useReducedMotion`); só `transform`/`opacity`.
- **Seções:** exatamente 4 — `bio` (read-only, manda editar na Conta), `dashboard`, `anuncios`, `conta`. Hash inválido → `bio`.
- **Gates:** `npm run typecheck` (em `frontend/`) e build no container `docker compose exec -T frontend npm run build`.

---

### Task 1: Reestruturar `page.tsx` (estado tab + sidebar + seções)

**Files:**
- Modify: `frontend/app/perfil/page.tsx`

**Interfaces:**
- Consumes: `Dashboard`, `EditAccount` (já no arquivo), `ProfileAPI`, `VenuesAPI`, tipos `User`/`Venue`/`HostMetrics`.
- Produces: componentes `BioView`, `VenuesPreview`, ícones locais, e o tipo `Tab`.

- [ ] **Step 1: Ajustar o import do motion (adicionar `AnimatePresence`)**

Trocar:
```tsx
import { motion, useReducedMotion } from 'motion/react';
```
por:
```tsx
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
```

- [ ] **Step 2: Adicionar os ícones e o tipo `Tab` (logo após os helpers `initial`/`memberSince`)**

Inserir após a função `memberSince` (antes de `export default function ProfilePage`):
```tsx
const NavSvg = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const BioIcon = () => <NavSvg><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></NavSvg>;
const ChartIcon = () => <NavSvg><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="11" width="3" height="6" /><rect x="13" y="7" width="3" height="10" /></NavSvg>;
const GridIcon = () => <NavSvg><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></NavSvg>;
const GearIcon = () => <NavSvg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></NavSvg>;

type Tab = 'bio' | 'dashboard' | 'anuncios' | 'conta';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'bio', label: 'Bio', icon: <BioIcon /> },
  { key: 'dashboard', label: 'Dashboard', icon: <ChartIcon /> },
  { key: 'anuncios', label: 'Anúncios', icon: <GridIcon /> },
  { key: 'conta', label: 'Conta', icon: <GearIcon /> },
];
const isTab = (s: string): s is Tab => s === 'bio' || s === 'dashboard' || s === 'anuncios' || s === 'conta';
```

- [ ] **Step 3: Substituir o corpo de `ProfilePage`**

Trocar a função `ProfilePage` inteira (de `export default function ProfilePage() {` até o `}` que fecha ela, logo antes de `function EditAccount`) por:
```tsx
export default function ProfilePage() {
  const reduce = useReducedMotion();
  const [user, setUser] = useState<User | null>(null);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [metricsErr, setMetricsErr] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('bio');

  useEffect(() => {
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (isTab(h)) setTab(h);
    ProfileAPI.me()
      .then(setUser)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar perfil'));
    VenuesAPI.listMine()
      .then(setVenues)
      .catch(() => setVenues([]));
    ProfileAPI.metrics()
      .then(setMetrics)
      .catch(() => setMetricsErr(true));
  }, []);

  function go(t: Tab) {
    setTab(t);
    if (typeof window !== 'undefined') history.replaceState(null, '', '#' + t);
  }

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!user) return <main className="container"><p className="muted">Carregando…</p></main>;

  return (
    <main className="container profile-layout">
      <aside className="profile-sidebar">
        <div className="profile-mini">
          <div className="profile-avatar sm">
            {user.avatar_url ? <img src={user.avatar_url} alt={user.name} /> : <span>{initial(user.name)}</span>}
          </div>
          <div>
            <strong>{user.name}</strong>
            <span className="badge pub">{user.role === 'HOST' ? 'Anfitrião' : 'Convidado'}</span>
          </div>
        </div>
        <nav className="profile-nav">
          {TABS.map((t) => (
            <button key={t.key} className={'pnav-item' + (tab === t.key ? ' on' : '')} onClick={() => go(t.key)}>
              {tab === t.key && (
                <motion.span
                  layoutId="pnav-pill"
                  className="pnav-pill"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="pnav-ico">{t.icon}</span>
              <span className="pnav-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="profile-content">
        <AnimatePresence mode="wait">
          <motion.section
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            exit={reduce ? {} : { opacity: 0, y: -8 }}
            transition={reduce ? { duration: 0 } : { duration: 0.22 }}
          >
            {tab === 'bio' && <BioView user={user} onEdit={() => go('conta')} />}
            {tab === 'dashboard' && (
              <Dashboard
                metrics={metrics}
                error={metricsErr}
                publishedCount={(venues ?? []).filter((v) => v.status === 'PUBLISHED').length}
                reduce={!!reduce}
              />
            )}
            {tab === 'anuncios' && <VenuesPreview venues={venues} reduce={!!reduce} />}
            {tab === 'conta' && <EditAccount user={user} onUser={setUser} />}
          </motion.section>
        </AnimatePresence>
      </div>
    </main>
  );
}

function BioView({ user, onEdit }: { user: User; onEdit: () => void }) {
  return (
    <div className="bio-view">
      <h2>Bio</h2>
      <dl className="bio-list">
        <div><dt>E-mail</dt><dd>{user.email}</dd></div>
        <div><dt>Papel</dt><dd>{user.role === 'HOST' ? 'Anfitrião' : 'Convidado'}</dd></div>
        {user.created_at && <div><dt>Membro desde</dt><dd>{memberSince(user.created_at)}</dd></div>}
      </dl>
      <p className="profile-bio">{user.bio || 'Você ainda não escreveu uma bio.'}</p>
      <button type="button" className="button ghost" onClick={onEdit}>Editar perfil</button>
    </div>
  );
}

function VenuesPreview({ venues, reduce }: { venues: Venue[] | null; reduce: boolean }) {
  return (
    <div className="profile-section">
      <div className="list-head">
        <h2>Meus anúncios</h2>
        <a className="button ghost" href="/venues/mine">Gerenciar</a>
      </div>
      {!venues ? (
        <p className="muted">Carregando…</p>
      ) : venues.length === 0 ? (
        <p className="muted">Você ainda não anunciou. <a href="/venues/new">Criar o primeiro</a>.</p>
      ) : (
        <div className="profile-venues">
          {venues.map((v, i) => (
            <motion.a
              key={v.id}
              href={`/venues/${v.id}/edit`}
              className="vcard"
              initial={reduce ? undefined : { opacity: 0, y: 10 }}
              animate={reduce ? undefined : { opacity: 1, y: 0 }}
              transition={reduce ? undefined : { duration: 0.24, delay: Math.min(i * 0.05, 0.3) }}
            >
              <div className="vcard-cover">
                {v.cover_url ? <img src={v.cover_url} alt={v.title} /> : <div className="vcard-cover-ph" />}
              </div>
              <div className="vcard-body">
                <strong>{v.title}</strong>
                <span className={'badge ' + (v.status === 'PUBLISHED' ? 'pub' : 'draft')}>
                  {v.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
                </span>
                <span className="muted">{v.city}/{v.state} · R$ {v.price_per_day}/dia</span>
              </div>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}
```
(Os componentes `EditAccount`, `Dashboard`, `KpiValue`, `useCountUp` e os helpers `brl`/`monthLabel` permanecem inalterados abaixo no arquivo.)

- [ ] **Step 4: Typecheck + build no container**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo/frontend && npm run typecheck
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "perfil|Compiled|rror"
```
Expected: typecheck sem erros; "Compiled successfully" e a rota `/perfil` listada.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/perfil/page.tsx
git commit -m "feat(perfil): sidebar com seções Bio/Dashboard/Anúncios/Conta"
```

---

### Task 2: Estilos do layout + responsivo

**Files:**
- Modify: `frontend/app/globals.css` (append)

**Interfaces:**
- Consumes: as classes usadas no Task 1 (`profile-layout`, `profile-sidebar`, `profile-mini`, `profile-nav`, `pnav-item`/`.on`, `pnav-pill`, `pnav-ico`, `pnav-label`, `profile-content`, `bio-view`, `bio-list`, `profile-avatar.sm`).

- [ ] **Step 1: Adicionar os estilos**

Append em `frontend/app/globals.css`:
```css
/* ===== Perfil — sidebar ===== */
.profile-layout { display: grid; grid-template-columns: 220px 1fr; gap: 28px; align-items: start; }
.profile-sidebar { position: sticky; top: 88px; display: flex; flex-direction: column; gap: 16px; }
.profile-mini { display: flex; align-items: center; gap: 10px; }
.profile-avatar.sm { width: 48px; height: 48px; font-size: 18px; }
.profile-mini strong { display: block; line-height: 1.2; }
.profile-nav { display: flex; flex-direction: column; gap: 4px; }
.pnav-item {
  position: relative; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: none; background: none; cursor: pointer;
  border-radius: 10px; font: inherit; color: #1f2430; text-align: left;
}
.pnav-item.on { color: var(--brand-purple); font-weight: 600; }
.pnav-pill { position: absolute; inset: 0; background: var(--brand-tint); border-radius: 10px; z-index: 0; }
.pnav-ico, .pnav-label { position: relative; z-index: 1; display: inline-flex; align-items: center; }
@media (hover: hover) and (pointer: fine) { .pnav-item:not(.on):hover { background: #f6f5fb; } }
.profile-content { min-width: 0; }
.bio-view { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
.bio-list { display: flex; flex-direction: column; gap: 10px; margin: 0; }
.bio-list > div { display: flex; gap: 8px; }
.bio-list dt { min-width: 110px; color: #6b7280; }
.bio-list dd { margin: 0; font-weight: 500; }
@media (max-width: 760px) {
  .profile-layout { grid-template-columns: 1fr; }
  .profile-sidebar { position: static; }
  .profile-nav { flex-direction: row; overflow-x: auto; gap: 6px; }
  .pnav-item { white-space: nowrap; }
}
```

- [ ] **Step 2: Build no container**

Run:
```bash
cd /home/andreas/Documents/dope/doperepo && docker compose exec -T frontend npm run build 2>&1 | grep -E "Compiled|rror"
```
Expected: "Compiled successfully".

- [ ] **Step 3: Smoke visual**

Reiniciar o frontend e validar:
```bash
docker compose restart frontend >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/perfil && break; sleep 1; done
curl -s -o /dev/null -w "GET /perfil: %{http_code}\n" http://localhost:3100/perfil
```
Abrir `http://localhost:3100/perfil` logado (`host@dope.local`): sidebar à esquerda com mini-perfil + 4 itens; clicar troca a seção com fade e a pílula desliza; `/perfil#dashboard` abre no Dashboard; refresh mantém a aba; viewport estreito → menu vira abas horizontais.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(perfil): estilos do sidebar e responsivo"
```

---

## Self-Review

- **Cobertura da spec:** 4 seções (T1) · mini-perfil no sidebar (T1) · Bio read-only + botão editar→Conta (T1) · tab via hash + `isTab` + `replaceState` (T1) · pílula `layoutId` + troca `AnimatePresence` + reduced-motion (T1) · extração `BioView`/`VenuesPreview`, reuso `Dashboard`/`EditAccount` (T1) · layout sticky + responsivo abas horizontais (T2). ✔
- **Consistência:** `Tab`/`isTab`/`go` definidos e usados no mesmo arquivo (T1); classes do T1 todas estilizadas no T2; `Dashboard`/`EditAccount` mantêm as mesmas props já existentes. ✔
- **Sem placeholders:** todo passo traz código real + comando/saída esperada. ✔
- **Risco conhecido:** `motion.span` com `layoutId` dentro de `<button>` — animação de layout ok; se piscar, o `transition` spring já suaviza. Sem backend, nenhum risco de dado.
