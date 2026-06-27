'use client';

import { createContext, useContext, useState } from 'react';

type DockRevealCtx = { hidden: boolean; setHidden: (b: boolean) => void };
const Ctx = createContext<DockRevealCtx>({ hidden: false, setHidden: () => {} });

export function DockRevealProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return <Ctx.Provider value={{ hidden, setHidden }}>{children}</Ctx.Provider>;
}

export const useDockReveal = () => useContext(Ctx);
