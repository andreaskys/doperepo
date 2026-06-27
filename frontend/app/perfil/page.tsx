'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ProfileAPI, VenuesAPI, type User, type Venue, type HostMetrics, type MonthRevenue } from '../venues/lib';

const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();
const memberSince = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

const NavSvg = ({ children }: { children: React.ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
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
    <main className="profile-layout">
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

function EditAccount({ user, onUser }: { user: User; onUser: (u: User) => void }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');

  const [avatarMsg, setAvatarMsg] = useState('');

  async function saveInfo() {
    setSavingInfo(true);
    setInfoMsg('');
    try {
      const u = await ProfileAPI.updateProfile({ name, bio });
      onUser(u);
      setInfoMsg('Salvo.');
    } catch (e) {
      setInfoMsg(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSavingInfo(false);
    }
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarMsg('Enviando…');
    try {
      const u = await ProfileAPI.uploadAvatar(file);
      onUser(u);
      setAvatarMsg('Foto atualizada.');
    } catch (err) {
      setAvatarMsg(err instanceof Error ? err.message : 'Erro ao enviar');
    }
  }

  async function savePwd() {
    setSavingPwd(true);
    setPwdMsg('');
    try {
      await ProfileAPI.changePassword({ current_password: cur, new_password: next });
      setCur('');
      setNext('');
      setPwdMsg('Senha alterada.');
    } catch (e) {
      setPwdMsg(e instanceof Error ? e.message : 'Erro ao trocar senha');
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <section className="profile-section profile-edit">
      <h2>Editar conta</h2>
      <div className="form">
        <label className="avatar-upload">
          Foto de perfil
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatar} />
        </label>
        {avatarMsg && <span className="muted">{avatarMsg}</span>}
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Bio<textarea value={bio} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="Fale um pouco sobre você (opcional)" /></label>
        <label>E-mail<input value={user.email} disabled /></label>
        <button className="button" onClick={saveInfo} disabled={savingInfo || name.trim().length < 2}>
          {savingInfo ? '...' : 'Salvar'}
        </button>
        {infoMsg && <span className="muted">{infoMsg}</span>}
      </div>

      <div className="form">
        <h3>Trocar senha</h3>
        <label>Senha atual<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label>Nova senha<input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Ao menos 8 caracteres" /></label>
        <button className="button" onClick={savePwd} disabled={savingPwd || !cur || next.length < 8}>
          {savingPwd ? '...' : 'Trocar senha'}
        </button>
        {pwdMsg && <span className="muted">{pwdMsg}</span>}
      </div>
    </section>
  );
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
};

function useCountUp(target: number, reduce: boolean) {
  const [val, setVal] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) { setVal(target); return; }
    let raf = 0;
    const start = performance.now();
    const dur = 600;
    const tick = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      setVal(target * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return val;
}

function KpiValue({ target, format, reduce }: { target: number; format: (n: number) => string; reduce: boolean }) {
  const v = useCountUp(target, reduce);
  return <span className="kpi-value">{format(v)}</span>;
}

function Dashboard({ metrics, error, publishedCount, reduce }: {
  metrics: HostMetrics | null;
  error: boolean;
  publishedCount: number;
  reduce: boolean;
}) {
  if (error) {
    return (
      <section className="profile-section dash">
        <h2>Resumo financeiro</h2>
        <p className="muted">Não foi possível carregar o resumo financeiro.</p>
      </section>
    );
  }
  if (!metrics) {
    return (
      <section className="profile-section dash">
        <h2>Resumo financeiro</h2>
        <p className="muted">Carregando…</p>
      </section>
    );
  }

  const intFmt = (n: number) => String(Math.round(n));
  const months: MonthRevenue[] = metrics.by_month;
  const max = months.reduce((acc, m) => Math.max(acc, Number(m.revenue)), 0);

  return (
    <section className="profile-section dash">
      <h2>Resumo financeiro</h2>
      {metrics.total_bookings === 0 ? (
        <p className="chart-empty">Você ainda não tem reservas — <a href="/venues/new">publique um espaço</a> para começar a faturar.</p>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card feature">
              <KpiValue target={Number(metrics.confirmed_revenue)} format={brl} reduce={reduce} />
              <span className="kpi-label">Receita confirmada</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={Number(metrics.pending_revenue)} format={brl} reduce={reduce} />
              <span className="kpi-label">Pendente (pipeline)</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={metrics.confirmed_count} format={intFmt} reduce={reduce} />
              <span className="kpi-label">Reservas confirmadas</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={Number(metrics.avg_ticket)} format={brl} reduce={reduce} />
              <span className="kpi-label">Ticket médio</span>
            </div>
            <div className="kpi-card">
              <KpiValue target={publishedCount} format={intFmt} reduce={reduce} />
              <span className="kpi-label">Espaços publicados</span>
            </div>
          </div>

          {months.length > 0 && (
            <div className="chart-wrap">
              <span className="kpi-label">Receita confirmada por mês</span>
              <div className="chart">
                {months.map((m, i) => {
                  const v = Number(m.revenue);
                  const h = max > 0 ? Math.max(Math.round((v / max) * 100), 2) : 2;
                  return (
                    <div className="chart-col" key={m.month} title={brl(v)}>
                      <motion.div
                        className="chart-bar"
                        style={{ height: `${h}%` }}
                        initial={reduce ? undefined : { scaleY: 0 }}
                        animate={reduce ? undefined : { scaleY: 1 }}
                        transition={reduce ? undefined : { duration: 0.4, delay: Math.min(i * 0.06, 0.4) }}
                      />
                      <span className="chart-month">{monthLabel(m.month)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
