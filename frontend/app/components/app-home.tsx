import { Suspense } from 'react';
import HeroCarousel from './hero-carousel';
import VenueGrid from './venue-grid';
import VenueFilters from './venue-filters';
import Footer from './footer';

export default function AppHome() {
  return (
    <>
      <main className="home">
        <HeroCarousel />
        <section className="home-section">
          <h2>Espaços em destaque</h2>
          <Suspense fallback={<p className="muted">Carregando…</p>}>
            <VenueFilters />
            <VenueGrid />
          </Suspense>
        </section>
      </main>
      <Footer />
    </>
  );
}
