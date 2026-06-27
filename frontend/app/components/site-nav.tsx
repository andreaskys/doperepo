'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import Dock, { type DockItemData } from './Dock';
import { NotificationsAPI, type AppNotification, type NotificationType } from '../venues/lib';

// Ícones inline (sem dep react-icons) — herdam currentColor.
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = () => <Svg><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></Svg>;
const PlusIcon = () => <Svg><path d="M12 5v14" /><path d="M5 12h14" /></Svg>;
const ListIcon = () => <Svg><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></Svg>;
const CalendarIcon = () => <Svg><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></Svg>;
const UserIcon = () => <Svg><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Svg>;
const BellIcon = () => <Svg><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></Svg>;

const NOTIF_LABEL: Record<NotificationType, string> = {
  booking_requested: 'Nova solicitação de reserva',
  booking_confirmed: 'Reserva confirmada',
  booking_cancelled: 'Reserva cancelada',
};

export default function SiteNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [loggedIn, setLoggedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<AppNotification[] | null>(null);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const navRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  // Poll do unread-count (também detecta login: 401 → deslogado).
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const c = await NotificationsAPI.unreadCount();
        if (!active) return;
        if (c === null) {
          setLoggedIn(false);
          if (timer) clearInterval(timer);
          return;
        }
        setLoggedIn(true);
        setCount(c);
      } catch {
        /* mantém o estado atual */
      }
    };
    tick();
    timer = setInterval(tick, 30000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [pathname]);

  // Clique FORA do nav (Dock + painel) fecha. Clicar no próprio sino não conta
  // como "fora" — assim o onClick do sino alterna sem o handler reabrir.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggleBell() {
    const next = !open;
    if (next) {
      // ancora o painel embaixo do ícone do sino (no Dock), clampado na tela.
      const r = bellRef.current?.getBoundingClientRect();
      if (r) {
        const cx = Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170);
        setPanelPos({ left: cx, top: r.bottom + 10 });
      }
    }
    setOpen(next);
    if (next) {
      try {
        setNotifs(await NotificationsAPI.list());
        await NotificationsAPI.markRead();
        setCount(0);
      } catch {
        /* ignore */
      }
    }
  }

  function goNotif(n: AppNotification) {
    setOpen(false);
    router.push(n.type === 'booking_requested' ? '/reservas/recebidas' : '/reservas');
  }

  // telas de auth são full-screen (60/40 com a animação) — sem dock nelas
  if (pathname === '/login' || pathname === '/signup') return null;

  // Sino: ícone com badge, dentro do Dock. Logado → substitui o "Entrar".
  const bellIcon = (
    <span className="dock-bell" ref={bellRef}>
      <BellIcon />
      {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
    </span>
  );

  const items: DockItemData[] = [
    { icon: <HomeIcon />, label: 'Home', onClick: () => router.push('/') },
    { icon: <PlusIcon />, label: 'Anunciar', onClick: () => router.push('/venues/new') },
    { icon: <ListIcon />, label: 'Meus anúncios', onClick: () => router.push('/venues/mine') },
    { icon: <CalendarIcon />, label: 'Reservas', onClick: () => router.push('/reservas') },
    loggedIn
      ? { icon: bellIcon, label: 'Notificações', onClick: toggleBell }
      : { icon: <UserIcon />, label: 'Entrar', onClick: () => router.push('/login') },
  ];

  return (
    <div className="site-nav" ref={navRef}>
      <Dock items={items} panelHeight={64} baseItemSize={44} magnification={64} dockHeight={140} distance={160} />
      <AnimatePresence>
        {open && loggedIn && (
          <motion.div
            className="notif-panel"
            style={{ left: panelPos.left, top: panelPos.top }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            <p className="notif-head">Notificações</p>
            {!notifs ? (
              <p className="notif-empty">Carregando…</p>
            ) : notifs.length === 0 ? (
              <p className="notif-empty">Nenhuma notificação ainda.</p>
            ) : (
              <ul className="notif-list">
                {notifs.map((n) => (
                  <li key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => goNotif(n)}>
                    <strong>{NOTIF_LABEL[n.type]}</strong>
                    <span className="muted">{n.venue_title} · {n.start_date} → {n.end_date}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
