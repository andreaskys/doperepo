import './globals.css';

export const metadata = {
  title: 'Espaços — aluguel para festas e eventos',
  description: 'Casamentos, festas e festivais. Alugue espaços direto com o anfitrião.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
