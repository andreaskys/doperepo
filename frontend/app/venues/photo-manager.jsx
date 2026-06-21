'use client';

import { useState } from 'react';
import { VenuesAPI } from './lib';

// Upload/listagem/remoção de fotos de uma venue. Sobe uma a uma (até 10).
export default function PhotoManager({ venueId, photos, setPhotos }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setError('');
    setBusy(true);
    try {
      for (const file of files) {
        if (photos.length >= 10) break;
        const p = await VenuesAPI.uploadPhoto(venueId, file);
        setPhotos((cur) => [...cur, p]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await VenuesAPI.deletePhoto(venueId, id);
      setPhotos((cur) => cur.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" />
            <button type="button" className="photo-del" onClick={() => remove(p.id)} aria-label="Remover foto">×</button>
          </div>
        ))}
        {photos.length < 10 && (
          <label className="photo-add">
            {busy ? '...' : '+ Foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={onPick} />
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted">{photos.length}/10 fotos</p>
    </div>
  );
}
