import { Suspense } from 'react';
import VenueFilters from './venue-filters';
import VenueGrid from './venue-grid';

export default function VenueExplore() {
  return (
    <section className="home-section">
      <h2>Espaços em destaque</h2>
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <VenueFilters />
        <VenueGrid />
      </Suspense>
    </section>
  );
}
