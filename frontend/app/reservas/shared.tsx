'use client';

import { usePathname } from 'next/navigation';
import type { BookingStatus } from '../venues/lib';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};

export function statusBadge(status: BookingStatus): string {
  return 'badge ' + (status === 'CONFIRMED' ? 'pub' : status === 'CANCELLED' ? 'cancelled' : 'draft');
}

export function ReservasTabs() {
  const path = usePathname();
  const cls = (href: string) => 'reservas-tab' + (path === href ? ' on' : '');
  return (
    <nav className="reservas-tabs">
      <a className={cls('/reservas')} href="/reservas">Minhas reservas</a>
      <a className={cls('/reservas/recebidas')} href="/reservas/recebidas">Reservas recebidas</a>
    </nav>
  );
}
