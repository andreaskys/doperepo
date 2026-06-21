'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VenuesAPI, AMENITIES } from '../lib';
import PhotoManager from '../photo-manager';
import MapPicker from '../../components/MapPicker';

const STEPS = ['Básico', 'Localização', 'Preço', 'Fotos', 'Revisão'];
const splitFeatures = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function NewVenuePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [venueId, setVenueId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    title: '', description: '', capacity: '', price_per_day: '',
    address: '', city: '', state: '', latitude: '', longitude: '', amenities: [], featuresText: '',
  });

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAmenity = (k) =>
    setF((s) => ({
      ...s,
      amenities: s.amenities.includes(k) ? s.amenities.filter((a) => a !== k) : [...s.amenities, k],
    }));

  function handleMapSelect({ lat, lng, address, city, state }) {
    setF((s) => ({
      ...s,
      latitude: String(lat),
      longitude: String(lng),
      address: address || s.address,
      city: city || s.city,
      state: state || s.state,
    }));
  }

  const canNext = () => {
    if (step === 0) return f.title.trim().length >= 3 && Number(f.capacity) > 0;
    if (step === 1) return f.address && f.city && f.state;
    if (step === 2) return Number(f.price_per_day) > 0;
    return true;
  };

  const payload = () => ({
    title: f.title,
    description: f.description,
    capacity: Number(f.capacity),
    price_per_day: f.price_per_day,
    address: f.address,
    city: f.city,
    state: f.state,
    amenities: f.amenities,
    features: splitFeatures(f.featuresText),
    latitude: f.latitude ? Number(f.latitude) : null,
    longitude: f.longitude ? Number(f.longitude) : null,
  });

  async function next() {
    setError('');
    // ao sair do passo Preço, cria/atualiza o rascunho (precisa do id pras fotos)
    if (step === 2) {
      setBusy(true);
      try {
        if (!venueId) {
          const v = await VenuesAPI.create(payload());
          setVenueId(v.id);
        } else {
          await VenuesAPI.update(venueId, payload());
        }
      } catch (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const back = () => {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  };

  async function finish(publish) {
    setBusy(true);
    setError('');
    try {
      if (publish) await VenuesAPI.publish(venueId);
      router.push('/venues/mine');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="container wizard">
      <h1>Anunciar espaço</h1>
      <div className="wizard-card">
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>{label}</li>
        ))}
      </ol>

      <div key={step} className="step">
        {step === 0 && (
          <>
            <label>Título<input value={f.title} onChange={set('title')} placeholder="Ex: Salão Vista Verde" /></label>
            <label>Descrição<textarea value={f.description} onChange={set('description')} rows={4} placeholder="Conte como é o espaço" /></label>
            <label>Capacidade (pessoas)<input type="number" min={1} value={f.capacity} onChange={set('capacity')} /></label>
          </>
        )}
        {step === 1 && (
          <>
            <label>Endereço<input value={f.address} onChange={set('address')} placeholder="Rua, número" /></label>
            <div className="row">
              <label>Cidade<input value={f.city} onChange={set('city')} /></label>
              <label>Estado<input value={f.state} onChange={set('state')} maxLength={2} placeholder="UF" /></label>
            </div>
            <p className="field-label">Marque o local no mapa (clica e arrasta pra navegar)</p>
            <MapPicker
              lat={f.latitude ? Number(f.latitude) : null}
              lng={f.longitude ? Number(f.longitude) : null}
              onSelect={handleMapSelect}
            />
            {f.latitude && f.longitude && (
              <p className="muted">📍 {Number(f.latitude).toFixed(5)}, {Number(f.longitude).toFixed(5)} — clique no mapa pra ajustar</p>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <label>Preço por dia (R$)<input type="number" min={0} step="0.01" value={f.price_per_day} onChange={set('price_per_day')} /></label>
            <p className="field-label">Comodidades</p>
            <div className="chips">
              {AMENITIES.map((a) => (
                <button type="button" key={a.key} className={'chip' + (f.amenities.includes(a.key) ? ' on' : '')} onClick={() => toggleAmenity(a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
            <p className="field-label">O que tem no espaço? (separe por vírgula)</p>
            <input value={f.featuresText} onChange={set('featuresText')} placeholder="Ex: piscina aquecida, 3 quartos, churrasqueira" />
            {splitFeatures(f.featuresText).length > 0 && (
              <div className="tags">
                {splitFeatures(f.featuresText).map((x, i) => <span key={i} className="tag">{x}</span>)}
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <p className="field-label">Fotos do espaço</p>
            <PhotoManager venueId={venueId} photos={photos} setPhotos={setPhotos} />
          </>
        )}
        {step === 4 && (
          <div className="review">
            <h2>{f.title}</h2>
            {f.description && <p>{f.description}</p>}
            <p><strong>{f.capacity}</strong> pessoas · <strong>R$ {f.price_per_day}</strong>/dia</p>
            <p>{f.address} — {f.city}/{f.state}</p>
            <p className="muted">{f.amenities.length} comodidades · {photos.length} fotos</p>
          </div>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="wizard-nav">
        {step > 0 && <button type="button" className="button ghost" onClick={back} disabled={busy}>Voltar</button>}
        {step < 4 && <button type="button" className="button" onClick={next} disabled={!canNext() || busy}>{busy ? '...' : 'Continuar'}</button>}
        {step === 4 && (
          <>
            <button type="button" className="button ghost" onClick={() => finish(false)} disabled={busy}>Salvar rascunho</button>
            <button type="button" className="button" onClick={() => finish(true)} disabled={busy}>{busy ? '...' : 'Publicar'}</button>
          </>
        )}
      </div>
      </div>
    </main>
  );
}
