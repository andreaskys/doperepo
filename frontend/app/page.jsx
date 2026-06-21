import SiteNav from './components/site-nav';
import VenueGrid from './components/venue-grid';
import Footer from './components/footer';

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="home">
        <section className="hero">
          <h1>Encontre o espaço perfeito para o seu evento</h1>
          <p>Casamentos, festas e festivais — alugue direto com o anfitrião.</p>
        </section>
        <section className="home-section">
          <h2>Espaços em destaque</h2>
          <VenueGrid />
        </section>
      </main>
      <Footer />
    </>
  );
}
