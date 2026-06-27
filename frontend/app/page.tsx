import { Suspense } from 'react';
import HeroCarousel from './components/hero-carousel';
import VenueGrid from './components/venue-grid';
import VenueFilters from './components/venue-filters';
import Footer from './components/footer';

export default function Home() {
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
