'use client';

import { useEffect, useState } from 'react';
import { BookingsAPI, type ReceivedBooking } from '../../venues/lib';
import { ReservasTabs, STATUS_LABEL, statusBadge } from '../shared';

export default function RecebidasPage() {
  const [bookings, setBookings] = useState<ReceivedBooking[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setBookings(await BookingsAPI.received());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar reservas');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, fn: (id: string) => Promise<unknown>) {
    setBusyId(id);
    setError('');
    try {
      await fn(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro na ação');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="container">
      <ReservasTabs />
      <h1>Reservas recebidas</h1>
      {error && <p className="error">{error}</p>}
      {!bookings ? (
        <p className="muted">Carregando…</p>
      ) : bookings.length === 0 ? (
        <p className="muted">Você ainda não recebeu reservas.</p>
      ) : (
        <ul className="venue-list">
          {bookings.map((b) => (
            <li key={b.id} className="venue-card">
              <div>
                <strong>{b.venue_title}</strong>
                <span className={statusBadge(b.status)}>{STATUS_LABEL[b.status]}</span>
                <p className="muted">{b.guest_name} · {b.venue_city}/{b.venue_state} · {b.start_date} → {b.end_date} · R$ {b.total_price}</p>
              </div>
              <div className="venue-actions">
                {b.status === 'PENDING' && (
                  <>
                    <button className="button" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.confirm)}>
                      {busyId === b.id ? '...' : 'Confirmar'}
                    </button>
                    <button className="button ghost" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.cancel)}>
                      Recusar
                    </button>
                  </>
                )}
                {b.status === 'CONFIRMED' && (
                  <button className="button danger" disabled={busyId === b.id} onClick={() => act(b.id, BookingsAPI.cancel)}>
                    {busyId === b.id ? '...' : 'Cancelar'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
