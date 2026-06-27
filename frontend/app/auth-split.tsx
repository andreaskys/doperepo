'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Iridescence from './components/Iridescence';

const API = process.env.NEXT_PUBLIC_API_URL;

// Const no escopo do módulo: referência estável, senão o useEffect do shader
// reiniciaria a cada render (ex.: ao digitar no formulário).
const IRIDESCENCE_COLOR: [number, number, number] = [0.4, 0.32, 0.7];

type Mode = 'login' | 'signup';

interface AuthForm {
  name: string;
  email: string;
  password: string;
}

export default function AuthSplit({ initialMode = 'login' }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const isSignup = mode === 'signup';
  const [form, setForm] = useState<AuthForm>({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  function switchMode(next: Mode) {
    setError('');
    setMode(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const path = isSignup ? '/api/v1/auth/register' : '/api/v1/auth/login';
    const body = isSignup ? form : { email: form.email, password: form.password };
    try {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Algo deu errado');
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={'auth-split' + (isSignup ? ' signup' : '')}>
      <div className="auth-visual">
        {/* Iridescence (React Bits) — sempre ativo, mesmo com reduced-motion
            (override do Emil autorizado pelo usuário). */}
        <Iridescence color={IRIDESCENCE_COLOR} mouseReact={false} amplitude={0.1} speed={1.0} />
        <div className="auth-visual-overlay">
          <h2>Espaços</h2>
          <p>Alugue o lugar perfeito para o seu evento.</p>
        </div>
      </div>

      <div className="auth-pane">
        <div className="auth-card">
          <h1>{isSignup ? 'Criar conta' : 'Entrar'}</h1>
          <form onSubmit={onSubmit} className="form">
            {isSignup && (
              <label>
                Nome
                <input name="name" value={form.name} onChange={onChange} required minLength={2} autoComplete="name" />
              </label>
            )}
            <label>
              E-mail
              <input name="email" type="email" value={form.email} onChange={onChange} required autoComplete="email" />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={onChange}
                required
                minLength={8}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="button" type="submit" disabled={loading}>
              {loading ? '...' : isSignup ? 'Criar conta' : 'Entrar'}
            </button>
          </form>
          <p className="muted">
            {isSignup ? (
              <>Já tem conta? <button type="button" className="link" onClick={() => switchMode('login')}>Entrar</button></>
            ) : (
              <>Não tem conta? <button type="button" className="link" onClick={() => switchMode('signup')}>Criar conta</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
