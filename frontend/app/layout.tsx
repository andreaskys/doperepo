import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Fraunces } from 'next/font/google';
import './globals.css';
import SiteNav from './components/site-nav';
import { DockRevealProvider } from './components/dock-reveal';

// Corpo/UI: sans moderna com personalidade. Títulos: serifa suave (clima de evento).
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'Espaços — aluguel para festas e eventos',
  description: 'Casamentos, festas e festivais. Alugue espaços direto com o anfitrião.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${display.variable}`}>
      <body>
        <DockRevealProvider>
          <SiteNav />
          {children}
        </DockRevealProvider>
      </body>
    </html>
  );
}
