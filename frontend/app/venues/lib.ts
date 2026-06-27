const API = process.env.NEXT_PUBLIC_API_URL;

// --- Tipos de domínio (espelham os payloads do backend Go) ---

export interface Photo {
  id: string;
  url: string;
}

export type VenueStatus = 'DRAFT' | 'PUBLISHED';

export interface Venue {
  id: string;
  title: string;
  description: string;
  capacity: number;
  price_per_day: string;
  address: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  amenities: string[];
  features: string[];
  photos: Photo[];
  status: VenueStatus;
  cover_url?: string;
}

export interface VenuePayload {
  title: string;
  description: string;
  capacity: number;
  price_per_day: string;
  address: string;
  city: string;
  state: string;
  amenities: string[];
  features: string[];
  latitude: number | null;
  longitude: number | null;
}

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface Booking {
  id: string;
  venue_title: string;
  venue_city: string;
  venue_state: string;
  start_date: string;
  end_date: string;
  total_price: string;
  status: BookingStatus;
}

export interface BookedRange {
  start_date: string;
  end_date: string;
}

export interface BookingPayload {
  start_date: string;
  end_date: string;
}

export interface Amenity {
  key: string;
  label: string;
}

async function req<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API + '/api/v1' + path, { credentials: 'include', ...opts });
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('não autenticado');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Erro inesperado');
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const VenuesAPI = {
  create: (body: VenuePayload) => req<Venue>('/venues', { method: 'POST', ...json(body) }),
  update: (id: string, body: VenuePayload) => req<Venue>(`/venues/${id}`, { method: 'PUT', ...json(body) }),
  listMine: () => req<Venue[]>('/venues'),
  get: (id: string) => req<Venue>(`/venues/${id}`),
  publish: (id: string) => req<Venue>(`/venues/${id}/publish`, { method: 'POST' }),
  remove: (id: string) => req<null>(`/venues/${id}`, { method: 'DELETE' }),
  uploadPhoto: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return req<Photo>(`/venues/${id}/photos`, { method: 'POST', body: fd });
  },
  deletePhoto: (id: string, photoId: string) =>
    req<null>(`/venues/${id}/photos/${photoId}`, { method: 'DELETE' }),
};

export const BookingsAPI = {
  publicVenue: (id: string) => req<Venue>(`/public/venues/${id}`),
  bookedRanges: (id: string) => req<BookedRange[]>(`/public/venues/${id}/booked`),
  create: (id: string, body: BookingPayload) =>
    req<Booking>(`/venues/${id}/bookings`, { method: 'POST', ...json(body) }),
  mine: () => req<Booking[]>('/bookings'),
};

// Espelha a allowlist do backend (internal/venues/service.go).
export const AMENITIES: Amenity[] = [
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
