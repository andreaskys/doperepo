'use client';

import { useEffect, useState } from 'react';
import { AuthAPI } from '../venues/lib';
import { useDockReveal } from './dock-reveal';
import Landing from './landing';
import AppHome from './app-home';

type Mode = 'checking' | 'intro' | 'app';

export default function HomeGate() {
  const { setHidden } = useDockReveal();
  const [mode, setMode] = useState<Mode>('checking');

  useEffect(() => {
    let active = true;
    AuthAPI.isLoggedIn().then((logged) => {
      if (!active) return;
      setMode(logged ? 'app' : 'intro');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setHidden(mode === 'intro' || mode === 'checking');
    return () => setHidden(false);
  }, [mode, setHidden]);

  if (mode === 'checking') return <div className="landing-splash" />;
  if (mode === 'intro') return <Landing />;
  return <AppHome />;
}
