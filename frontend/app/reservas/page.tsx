'use client';

import { useEffect, useState } from 'react';
import { BookingsAPI, type Booking } from '../venues/lib';
import { ReservasTabs, STATUS_LABEL, statusBadge } from './shared';

export default function ReservasPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setBookings(await BookingsAPI.mine());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function cancel(id: string) {
    setBusyId(id);
    setError('');
    try {
      await BookingsAPI.cancel(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="container">
      <ReservasTabs />
      <h1>Minhas reservas</h1>
      {error && <p className="error">{error}</p>}
      {!bookings ? (
        <p className="muted">Carregando…</p>
      ) : bookings.length === 0 ? (
        <p className="muted">Você ainda não tem reservas. <a href="/">Explorar espaços</a>.</p>
      ) : (
        <ul className="venue-list">
          {bookings.map((b) => (
            <li key={b.id} className="venue-card">
              <div>
                <strong>{b.venue_title}</strong>
                <span className={statusBadge(b.status)}>{STATUS_LABEL[b.status]}</span>
                <p className="muted">{b.venue_city}/{b.venue_state} · {b.start_date} → {b.end_date} · R$ {b.total_price}</p>
              </div>
              {b.status !== 'CANCELLED' && (
                <div className="venue-actions">
                  <button className="button danger" disabled={busyId === b.id} onClick={() => cancel(b.id)}>
                    {busyId === b.id ? '...' : 'Cancelar'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
