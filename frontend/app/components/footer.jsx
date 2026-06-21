export default function Footer() {
  // ponytail: ano fixo (sem render não-determinístico). Ajuste quando virar 2027.
  const year = 2026;
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <strong className="footer-brand">Espaços</strong>
          <p className="muted">Aluguel de espaços para festas e eventos.</p>
        </div>
        <nav className="footer-links">
          <a href="/venues/new">Anunciar</a>
          <a href="/venues/mine">Meus anúncios</a>
          <a href="/login">Entrar</a>
        </nav>
      </div>
      <p className="footer-copy">© {year} Espaços · feito para festas memoráveis.</p>
    </footer>
  );
}
