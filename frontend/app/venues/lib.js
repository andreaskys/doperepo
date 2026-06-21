const API = process.env.NEXT_PUBLIC_API_URL;

async function req(path, opts = {}) {
  const res = await fetch(API + '/api/v1' + path, { credentials: 'include', ...opts });
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('não autenticado');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Erro inesperado');
  }
  return res.status === 204 ? null : res.json();
}

const json = (body) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const VenuesAPI = {
  create: (body) => req('/venues', { method: 'POST', ...json(body) }),
  update: (id, body) => req(`/venues/${id}`, { method: 'PUT', ...json(body) }),
  listMine: () => req('/venues'),
  get: (id) => req(`/venues/${id}`),
  publish: (id) => req(`/venues/${id}/publish`, { method: 'POST' }),
  remove: (id) => req(`/venues/${id}`, { method: 'DELETE' }),
  uploadPhoto: (id, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return req(`/venues/${id}/photos`, { method: 'POST', body: fd });
  },
  deletePhoto: (id, photoId) => req(`/venues/${id}/photos/${photoId}`, { method: 'DELETE' }),
};

export const BookingsAPI = {
  publicVenue: (id) => req(`/public/venues/${id}`),
  bookedRanges: (id) => req(`/public/venues/${id}/booked`),
  create: (id, body) => req(`/venues/${id}/bookings`, { method: 'POST', ...json(body) }),
  mine: () => req('/bookings'),
};

// Espelha a allowlist do backend (internal/venues/service.go).
export const AMENITIES = [
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'estacionamento', label: 'Estacionamento' },
  { key: 'som', label: 'Sistema de som' },
  { key: 'cozinha', label: 'Cozinha' },
  { key: 'piscina', label: 'Piscina' },
  { key: 'ar_condicionado', label: 'Ar-condicionado' },
  { key: 'acessibilidade', label: 'Acessibilidade' },
  { key: 'mesas_cadeiras', label: 'Mesas e cadeiras' },
  { key: 'banheiros', label: 'Banheiros' },
  { key: 'gerador', label: 'Gerador' },
  { key: 'churrasqueira', label: 'Churrasqueira' },
  { key: 'palco', label: 'Palco' },
];
