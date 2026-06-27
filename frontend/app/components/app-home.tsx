import HeroCarousel from './hero-carousel';
import VenueExplore from './venue-explore';
import Footer from './footer';

export default function AppHome() {
  return (
    <>
      <main className="home">
        <HeroCarousel />
        <VenueExplore />
      </main>
      <Footer />
    </>
  );
}
