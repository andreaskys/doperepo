'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ProfileAPI, VenuesAPI, type User, type Venue } from '../venues/lib';

const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();
const memberSince = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export default function ProfilePage() {
  const reduce = useReducedMotion();
  const [user, setUser] = useState<User | null>(null);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    ProfileAPI.me()
      .then(setUser)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar perfil'));
    VenuesAPI.listMine()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!user) return <main className="container"><p className="muted">Carregando…</p></main>;

  const fade = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28 } };

  return (
    <main className="container profile">
      <motion.header className="profile-head" {...fade}>
        <div className="profile-avatar">
          {user.avatar_url ? <img src={user.avatar_url} alt={user.name} /> : <span>{initial(user.name)}</span>}
        </div>
        <div className="profile-id">
          <h1>{user.name}</h1>
          <p className="muted">{user.email}</p>
          <div className="profile-meta">
            <span className="badge pub">{user.role === 'HOST' ? 'Anfitrião' : 'Convidado'}</span>
            {user.created_at && <span className="muted">Membro desde {memberSince(user.created_at)}</span>}
          </div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
        </div>
      </motion.header>

      <EditAccount user={user} onUser={setUser} />

      <section className="profile-section">
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
      </section>
    </main>
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
