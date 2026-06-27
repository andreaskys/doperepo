'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { VenuesAPI, AMENITIES, type Photo } from '../../lib';
import PhotoManager from '../../photo-manager';
import MapPicker, { type MapSelection } from '../../../components/MapPicker';
import CepInput from '../../cep-input';

const splitFeatures = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

interface EditForm {
  title: string;
  description: string;
  capacity: string;
  price_per_day: string;
  cep: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  complement: string;
  amenities: string[];
  latitude: string | number;
  longitude: string | number;
  featuresText: string;
}

// Campos editados via <input>/<textarea>.
type StringField = 'title' | 'description' | 'capacity' | 'price_per_day' | 'cep' | 'address' | 'neighborhood' | 'city' | 'state' | 'complement' | 'featuresText';

export default function EditVenuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [f, setF] = useState<EditForm | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
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
          cep: v.cep ?? '',
          address: v.address,
          neighborhood: v.neighborhood ?? '',
          city: v.city,
          state: v.state,
          complement: v.complement ?? '',
          amenities: v.amenities || [],
          latitude: v.latitude ?? '',
          longitude: v.longitude ?? '',
          featuresText: (v.features || []).join(', '),
        });
        setPhotos(v.photos || []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erro ao carregar'));
  }, [id]);

  if (error) return <main className="container"><p className="error">{error}</p></main>;
  if (!f) return <main className="container"><p className="muted">Carregando…</p></main>;

  const set = (k: StringField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => (s ? { ...s, [k]: e.target.value } : s));
  const toggleAmenity = (k: string) =>
    setF((s) =>
      s
        ? {
            ...s,
            amenities: s.amenities.includes(k) ? s.amenities.filter((a) => a !== k) : [...s.amenities, k],
          }
        : s
    );

  function handleMapSelect({ lat, lng, address, city, state }: MapSelection) {
    setF((s) =>
      s
        ? {
            ...s,
            latitude: String(lat),
            longitude: String(lng),
            address: address || s.address,
            city: city || s.city,
            state: state || s.state,
          }
        : s
    );
  }

  async function save() {
    if (!f) return;
    setBusy(true);
    setError('');
    try {
      await VenuesAPI.update(id, {
        title: f.title,
        description: f.description,
        capacity: Number(f.capacity),
        price_per_day: f.price_per_day,
        address: f.address,
        neighborhood: f.neighborhood,
        city: f.city,
        state: f.state,
        complement: f.complement,
        cep: f.cep,
        amenities: f.amenities,
        features: splitFeatures(f.featuresText),
        latitude: f.latitude !== '' && f.latitude != null ? Number(f.latitude) : null,
        longitude: f.longitude !== '' && f.longitude != null ? Number(f.longitude) : null,
      });
      router.push('/venues/mine');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>Editar anúncio</h1>
      <div className="form">
        <CepInput
          cep={f.cep}
          onCepChange={(c) => setF((s) => (s ? { ...s, cep: c } : s))}
          onResolve={(r) => setF((s) => (s ? { ...s, address: r.address, neighborhood: r.neighborhood, city: r.city, state: r.state } : s))}
        />
        <label>Título<input value={f.title} onChange={set('title')} /></label>
        <label>Descrição<textarea value={f.description} onChange={set('description')} rows={4} /></label>
        <div className="row">
          <label>Capacidade<input type="number" min={1} value={f.capacity} onChange={set('capacity')} /></label>
          <label>Preço/dia (R$)<input type="number" min={0} step="0.01" value={f.price_per_day} onChange={set('price_per_day')} /></label>
        </div>
        <label>Rua e número<input value={f.address} onChange={set('address')} /></label>
        <label>Bairro<input value={f.neighborhood} onChange={set('neighborhood')} /></label>
        <div className="row">
          <label>Cidade<input value={f.city} onChange={set('city')} /></label>
          <label>Estado<input value={f.state} onChange={set('state')} maxLength={2} /></label>
        </div>
        <label>Complemento<input value={f.complement} onChange={set('complement')} placeholder="opcional" /></label>
        <p className="field-label">Local no mapa</p>
        <MapPicker
          lat={f.latitude !== '' ? Number(f.latitude) : null}
          lng={f.longitude !== '' ? Number(f.longitude) : null}
          onSelect={handleMapSelect}
        />
        <p className="field-label">O que tem no espaço? (separe por vírgula)</p>
        <input value={f.featuresText} onChange={set('featuresText')} placeholder="Ex: piscina aquecida, 3 quartos, churrasqueira" />
        {splitFeatures(f.featuresText).length > 0 && (
          <div className="tags">
            {splitFeatures(f.featuresText).map((x, i) => <span key={i} className="tag">{x}</span>)}
          </div>
        )}
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
