'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VenuesAPI, AMENITIES, type VenuePayload, type Photo } from '../lib';
import PhotoManager from '../photo-manager';
import LocateOnMap from '../locate-on-map';
import CepInput from '../cep-input';

const STEPS = ['Básico', 'Endereço', 'Mapa', 'Preço', 'Fotos', 'Revisão'];
const splitFeatures = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

interface VenueForm {
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
  latitude: string;
  longitude: string;
  amenities: string[];
  featuresText: string;
}

type StringField = Exclude<keyof VenueForm, 'amenities'>;

export default function NewVenuePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<VenueForm>({
    title: '', description: '', capacity: '', price_per_day: '', cep: '',
    address: '', neighborhood: '', city: '', state: '', complement: '',
    latitude: '', longitude: '', amenities: [], featuresText: '',
  });

  const set = (k: StringField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAmenity = (k: string) =>
    setF((s) => ({
      ...s,
      amenities: s.amenities.includes(k) ? s.amenities.filter((a) => a !== k) : [...s.amenities, k],
    }));

  const canNext = () => {
    if (step === 0) return f.title.trim().length >= 3 && Number(f.capacity) > 0;
    if (step === 1) return !!(f.address && f.city && f.state);
    if (step === 3) return Number(f.price_per_day) > 0;
    return true;
  };

  const payload = (): VenuePayload => ({
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
    latitude: f.latitude ? Number(f.latitude) : null,
    longitude: f.longitude ? Number(f.longitude) : null,
  });

  async function next() {
    setError('');
    // ao sair do passo Preço (3), cria/atualiza o rascunho (precisa do id pras fotos)
    if (step === 3) {
      setBusy(true);
      try {
        if (!venueId) {
          const v = await VenuesAPI.create(payload());
          setVenueId(v.id);
        } else {
          await VenuesAPI.update(venueId, payload());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar');
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

  async function finish(publish: boolean) {
    setBusy(true);
    setError('');
    try {
      if (publish && venueId) await VenuesAPI.publish(venueId);
      router.push('/venues/mine');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao finalizar');
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
            <CepInput
              cep={f.cep}
              onCepChange={(c) => setF((s) => ({ ...s, cep: c }))}
              onResolve={(r) => setF((s) => ({ ...s, address: r.address, neighborhood: r.neighborhood, city: r.city, state: r.state }))}
            />
            <label>Rua e número<input value={f.address} onChange={set('address')} placeholder="Ex: Av. das Flores, 100" /></label>
            <label>Bairro<input value={f.neighborhood} onChange={set('neighborhood')} placeholder="Ex: Centro" /></label>
            <div className="row">
              <label>Cidade<input value={f.city} onChange={set('city')} /></label>
              <label>Estado<input value={f.state} onChange={set('state')} maxLength={2} placeholder="UF" /></label>
            </div>
            <label>Complemento<input value={f.complement} onChange={set('complement')} placeholder="Ex: bloco B, sala 2 (opcional)" /></label>
          </>
        )}
        {step === 2 && (
          <LocateOnMap
            address={f.address}
            neighborhood={f.neighborhood}
            city={f.city}
            state={f.state}
            lat={f.latitude}
            lng={f.longitude}
            onPick={(la, ln) => setF((s) => ({ ...s, latitude: String(la), longitude: String(ln) }))}
          />
        )}
        {step === 3 && (
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
        {step === 4 && (
          <>
            <p className="field-label">Fotos do espaço</p>
            <PhotoManager venueId={venueId!} photos={photos} setPhotos={setPhotos} />
          </>
        )}
        {step === 5 && (
          <div className="review">
            <h2>{f.title}</h2>
            {f.description && <p>{f.description}</p>}
            <p><strong>{f.capacity}</strong> pessoas · <strong>R$ {f.price_per_day}</strong>/dia</p>
            <p>{[f.address, f.neighborhood, f.complement].filter(Boolean).join(' · ')}</p>
            <p>{f.city}/{f.state}</p>
            <p className="muted">{f.amenities.length} comodidades · {photos.length} fotos</p>
          </div>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="wizard-nav">
        {step > 0 && <button type="button" className="button ghost" onClick={back} disabled={busy}>Voltar</button>}
        {step < 5 && <button type="button" className="button" onClick={next} disabled={!canNext() || busy}>{busy ? '...' : 'Continuar'}</button>}
        {step === 5 && (
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
