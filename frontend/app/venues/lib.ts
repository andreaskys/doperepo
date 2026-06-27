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
  neighborhood?: string;
  city: string;
  state: string;
  complement?: string;
  cep?: string;
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
  neighborhood?: string;
  city: string;
  state: string;
  complement?: string;
  cep?: string;
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

export interface ReceivedBooking extends Booking {
  venue_id: number;
  guest_name: string;
  guest_email: string;
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
  received: () => req<ReceivedBooking[]>('/bookings/received'),
  confirm: (id: string) => req<Booking>(`/bookings/${id}/confirm`, { method: 'POST' }),
  cancel: (id: string) => req<Booking>(`/bookings/${id}/cancel`, { method: 'POST' }),
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

export interface VenueSearchParams {
  city?: string;
  minCapacity?: number;
  maxPrice?: number;
  q?: string;
  amenities?: string[];
}

// Endpoint público (sem auth) — não passa pelo req()/401.
export const PublicAPI = {
  searchVenues: async (params: VenueSearchParams): Promise<Venue[]> => {
    const qs = new URLSearchParams();
    if (params.city?.trim()) qs.set('city', params.city.trim());
    if (params.minCapacity && params.minCapacity > 0) qs.set('min_capacity', String(params.minCapacity));
    if (params.maxPrice && params.maxPrice > 0) qs.set('max_price', String(params.maxPrice));
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.amenities?.length) qs.set('amenities', params.amenities.join(','));
    const query = qs.toString();
    const res = await fetch(`${API}/api/v1/public/venues${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error('Erro ao carregar espaços');
    return res.json();
  },
};

export type NotificationType = 'booking_requested' | 'booking_confirmed' | 'booking_cancelled';

export interface AppNotification {
  id: number;
  type: NotificationType;
  read: boolean;
  created_at: string;
  booking_id: number;
  venue_title: string;
  start_date: string;
  end_date: string;
}

// Fetch direto (NÃO usa req(): o sino não pode redirecionar pra /login no 401).
export const NotificationsAPI = {
  // null = não logado (401); número = contagem de não-lidas.
  unreadCount: async (): Promise<number | null> => {
    const res = await fetch(`${API}/api/v1/notifications/unread-count`, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('erro ao buscar notificações');
    return (await res.json()).count as number;
  },
  list: async (): Promise<AppNotification[]> => {
    const res = await fetch(`${API}/api/v1/notifications`, { credentials: 'include' });
    if (!res.ok) throw new Error('erro ao listar notificações');
    return res.json();
  },
  markRead: async (): Promise<void> => {
    await fetch(`${API}/api/v1/notifications/read`, { method: 'POST', credentials: 'include' });
  },
  clearAll: async (): Promise<void> => {
    await fetch(`${API}/api/v1/notifications`, { method: 'DELETE', credentials: 'include' });
  },
};
