'use client';

import { useEffect, useState } from 'react';
import { BookingsAPI } from '../venues/lib';

const STATUS_LABEL = { PENDING: 'Pendente', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada' };

export default function ReservasPage() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    BookingsAPI.mine().then(setBookings).catch((e) => setError(e.message));
  }, []);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!bookings) return <main className="container"><p className="muted">Carregando…</p></main>;

  return (
    <main className="container">
      <h1>Minhas reservas</h1>
      {bookings.length === 0 && <p className="muted">Você ainda não tem reservas. <a href="/">Explorar espaços</a>.</p>}
      <ul className="venue-list">
        {bookings.map((b) => (
          <li key={b.id} className="venue-card">
            <div>
              <strong>{b.venue_title}</strong>
              <span className={'badge ' + (b.status === 'CONFIRMED' ? 'pub' : 'draft')}>
                {STATUS_LABEL[b.status] || b.status}
              </span>
              <p className="muted">{b.venue_city}/{b.venue_state} · {b.start_date} → {b.end_date} · R$ {b.total_price}</p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
