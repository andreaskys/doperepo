'use client';

import { useEffect, useState } from 'react';
import { VenuesAPI } from '../lib';

export default function MyVenuesPage() {
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setVenues(await VenuesAPI.listMine());
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function publish(id) {
    await VenuesAPI.publish(id);
    load();
  }
  async function remove(id) {
    if (!confirm('Excluir este anúncio? As fotos também serão removidas.')) return;
    await VenuesAPI.remove(id);
    load();
  }

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!venues) return <main className="container"><p className="muted">Carregando…</p></main>;

  return (
    <main className="container">
      <div className="list-head">
        <h1>Meus anúncios</h1>
        <a className="button" href="/venues/new">+ Anunciar</a>
      </div>
      {venues.length === 0 && (
        <p className="muted">Você ainda não tem anúncios. <a href="/venues/new">Criar o primeiro</a>.</p>
      )}
      <ul className="venue-list">
        {venues.map((v) => (
          <li key={v.id} className="venue-card">
            <div>
              <strong>{v.title}</strong>
              <span className={'badge ' + (v.status === 'PUBLISHED' ? 'pub' : 'draft')}>
                {v.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
              </span>
              <p className="muted">{v.city}/{v.state} · R$ {v.price_per_day}/dia · {v.capacity} pessoas</p>
            </div>
            <div className="venue-actions">
              <a className="button ghost" href={`/venues/${v.id}/edit`}>Editar</a>
              {v.status !== 'PUBLISHED' && <button className="button" onClick={() => publish(v.id)}>Publicar</button>}
              <button className="button danger" onClick={() => remove(v.id)}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
