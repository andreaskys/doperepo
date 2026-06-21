'use client';

import { useRouter } from 'next/navigation';
import Dock from './Dock';

// Ícones inline (sem dep react-icons) — herdam currentColor.
const Svg = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = () => <Svg><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></Svg>;
const PlusIcon = () => <Svg><path d="M12 5v14" /><path d="M5 12h14" /></Svg>;
const ListIcon = () => <Svg><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></Svg>;
const UserIcon = () => <Svg><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Svg>;

export default function SiteNav() {
  const router = useRouter();
  const items = [
    { icon: <HomeIcon />, label: 'Home', onClick: () => router.push('/') },
    { icon: <PlusIcon />, label: 'Anunciar', onClick: () => router.push('/venues/new') },
    { icon: <ListIcon />, label: 'Meus anúncios', onClick: () => router.push('/venues/mine') },
    { icon: <UserIcon />, label: 'Entrar', onClick: () => router.push('/login') },
  ];
  return (
    <div className="site-nav">
      <Dock items={items} panelHeight={64} baseItemSize={44} magnification={64} dockHeight={140} distance={160} />
    </div>
  );
}
