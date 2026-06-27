import { Suspense } from 'react';
import VenueGrid from './components/venue-grid';
import VenueFilters from './components/venue-filters';
import Footer from './components/footer';

export default function Home() {
  return (
    <>
      <main className="home">
        <section className="hero">
          <h1>Encontre o espaço perfeito para o seu evento</h1>
          <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
        </section>
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
