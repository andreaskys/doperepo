'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VenuesAPI, AMENITIES } from '../../lib';
import PhotoManager from '../../photo-manager';

export default function EditVenuePage() {
  const { id } = useParams();
  const router = useRouter();
  const [f, setF] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    VenuesAPI.get(id)
      .then((v) => {
        setF({
          title: v.title,
          description: v.description,
          capacity: String(v.capacity),
          price_per_day: v.price_per_day,
          address: v.address,
          city: v.city,
          state: v.state,
          amenities: v.amenities || [],
        });
        setPhotos(v.photos || []);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!f) return <main className="container"><p className="muted">Carregando…</p></main>;

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAmenity = (k) =>
    setF((s) => ({
      ...s,
      amenities: s.amenities.includes(k) ? s.amenities.filter((a) => a !== k) : [...s.amenities, k],
    }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      await VenuesAPI.update(id, {
        title: f.title,
        description: f.description,
        capacity: Number(f.capacity),
        price_per_day: f.price_per_day,
        address: f.address,
        city: f.city,
        state: f.state,
        amenities: f.amenities,
        latitude: null,
        longitude: null,
      });
      router.push('/venues/mine');
      router.refresh();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>Editar anúncio</h1>
      <div className="form">
        <label>Título<input value={f.title} onChange={set('title')} /></label>
        <label>Descrição<textarea value={f.description} onChange={set('description')} rows={4} /></label>
        <div className="row">
          <label>Capacidade<input type="number" min={1} value={f.capacity} onChange={set('capacity')} /></label>
          <label>Preço/dia (R$)<input type="number" min={0} step="0.01" value={f.price_per_day} onChange={set('price_per_day')} /></label>
        </div>
        <label>Endereço<input value={f.address} onChange={set('address')} /></label>
        <div className="row">
          <label>Cidade<input value={f.city} onChange={set('city')} /></label>
          <label>Estado<input value={f.state} onChange={set('state')} maxLength={2} /></label>
        </div>
        <p className="field-label">Comodidades</p>
        <div className="chips">
          {AMENITIES.map((a) => (
            <button type="button" key={a.key} className={'chip' + (f.amenities.includes(a.key) ? ' on' : '')} onClick={() => toggleAmenity(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
        <p className="field-label">Fotos</p>
        <PhotoManager venueId={id} photos={photos} setPhotos={setPhotos} />
        {error && <p className="error">{error}</p>}
        <button className="button" onClick={save} disabled={busy}>{busy ? '...' : 'Salvar'}</button>
      </div>
    </main>
  );
}
