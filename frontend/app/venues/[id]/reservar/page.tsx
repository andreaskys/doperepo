'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Stepper, { Step } from '../../../components/Stepper';
import { BookingsAPI, AMENITIES, type Venue, type Booking, type BookedRange } from '../../lib';

const AMENITY_LABEL: Record<string, string> = Object.fromEntries(AMENITIES.map((a) => [a.key, a.label]));

interface ReservaResult {
  ok?: boolean;
  booking?: Booking;
  error?: string;
}

export default function ReservarPage() {
  const { id } = useParams<{ id: string }>();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [booked, setBooked] = useState<BookedRange[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [step, setStep] = useState(1);
  const [result, setResult] = useState<ReservaResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    BookingsAPI.publicVenue(id).then(setVenue).catch((e: unknown) => setLoadErr(e instanceof Error ? e.message : 'Erro ao carregar'));
    BookingsAPI.bookedRanges(id).then(setBooked).catch(() => {});
  }, [id]);

  if (loadErr) return <main className="container"><p className="error">{loadErr}</p></main>;
  if (!venue) return <main className="container"><p className="muted">Carregando…</p></main>;

  const today = new Date().toISOString().slice(0, 10);
  const nights = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) : 0;
  const datesValid = !!start && !!end && nights >= 1 && start >= today;
  const total = (Number(venue.price_per_day) * (nights || 0)).toFixed(2);
  const cover = venue.photos?.[0]?.url;

  async function confirm() {
    setSubmitting(true);
    try {
      const b = await BookingsAPI.create(id, { start_date: start, end_date: end });
      setResult({ ok: true, booking: b });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Erro ao reservar' });
      setAttempt((a) => a + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container reservar">
      <a className="muted back-link" href="/">← Voltar para a home</a>

      <div className="reservar-grid">
        <section className="reservar-showcase">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="reservar-cover" src={cover} alt={venue.title} />
          ) : (
            <div className="reservar-cover-ph" />
          )}
          <div className="reservar-info">
            <h1>{venue.title}</h1>
            <p className="muted">{venue.city}/{venue.state} · {venue.capacity} pessoas</p>
            <p className="reservar-price">R$ {venue.price_per_day}<span>/dia</span></p>
            {venue.description && <p>{venue.description}</p>}
            {venue.amenities?.length > 0 && (
              <>
                <p className="field-label">Comodidades</p>
                <div className="tags">
                  {venue.amenities.map((a) => (
                    <span key={a} className="tag">{AMENITY_LABEL[a] || a}</span>
                  ))}
                </div>
              </>
            )}
            {venue.features?.length > 0 && (
              <>
                <p className="field-label">O espaço tem</p>
                <div className="tags">
                  {venue.features.map((x) => (
                    <span key={x} className="tag feature">{x}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="reservar-booking">
          {result?.ok ? (
            <div className="booking-done">
              <h2>Reserva solicitada! 🎉</h2>
              <p>{result.booking!.start_date} → {result.booking!.end_date} · {nights} diária(s) · <strong>R$ {result.booking!.total_price}</strong></p>
              <p className="muted">Status: <strong>{result.booking!.status}</strong>. Acompanhe em <a href="/reservas">Minhas reservas</a>.</p>
            </div>
          ) : (
            <>
              {result?.error && <p className="error" role="alert">{result.error}</p>}
              <Stepper
                key={attempt}
                initialStep={attempt === 0 ? 1 : 2}
                onStepChange={setStep}
                onFinalStepCompleted={confirm}
                backButtonText="Voltar"
                nextButtonText="Continuar"
                completeButtonText={submitting ? 'Enviando…' : 'Confirmar reserva'}
                nextButtonProps={{ disabled: (step === 1 && !datesValid) || submitting }}
              >
                <Step>
                  <h2>Escolha as datas</h2>
                  <div className="row">
                    <label>Check-in
                      <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} />
                    </label>
                    <label>Check-out
                      <input type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} />
                    </label>
                  </div>
                  {nights >= 1 && <p className="muted">{nights} diária(s) · total <strong>R$ {total}</strong></p>}
                  {booked.length > 0 && (
                    <p className="muted">Indisponível: {booked.map((b) => `${b.start_date}→${b.end_date}`).join(' · ')}</p>
                  )}
                </Step>
                <Step>
                  <h2>Revisão</h2>
                  <p><strong>{venue.title}</strong> — {venue.city}/{venue.state}</p>
                  <p>{start} → {end} · {nights} diária(s)</p>
                  <p>Total: <strong>R$ {total}</strong></p>
                  <p className="muted">Ao confirmar, sua reserva fica <strong>PENDENTE</strong>.</p>
                </Step>
              </Stepper>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
