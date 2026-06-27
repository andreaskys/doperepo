'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NotificationsAPI, type AppNotification, type NotificationType } from '../venues/lib';

const LABEL: Record<NotificationType, string> = {
  booking_requested: 'Nova solicitação de reserva',
  booking_confirmed: 'Reserva confirmada',
  booking_cancelled: 'Reserva cancelada',
};

export default function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const c = await NotificationsAPI.unreadCount();
        if (!active) return;
        if (c === null) {
          setShow(false);
          if (timer) clearInterval(timer);
          return;
        }
        setShow(true);
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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setItems(await NotificationsAPI.list());
        await NotificationsAPI.markRead();
        setCount(0);
      } catch {
        /* ignore */
      }
    }
  }

  function go(n: AppNotification) {
    setOpen(false);
    router.push(n.type === 'booking_requested' ? '/reservas/recebidas' : '/reservas');
  }

  if (!show) return null;

  return (
    <div className="notif-bell" ref={ref}>
      <button className="notif-trigger" onClick={toggle} aria-label="Notificações">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <p className="notif-head">Notificações</p>
          {!items ? (
            <p className="notif-empty">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="notif-empty">Nenhuma notificação ainda.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id} className={'notif-item' + (n.read ? '' : ' unread')} onClick={() => go(n)}>
                  <strong>{LABEL[n.type]}</strong>
                  <span className="muted">{n.venue_title} · {n.start_date} → {n.end_date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
