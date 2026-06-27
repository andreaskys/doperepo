'use client';

import { useState } from 'react';

interface Resolved {
  address: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface CepInputProps {
  cep: string;
  onCepChange: (cep: string) => void;
  onResolve: (r: Resolved) => void;
}

export default function CepInput({ cep, onCepChange, onResolve }: CepInputProps) {
  const [status, setStatus] = useState('');

  async function onChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    onCepChange(digits);
    if (digits.length !== 8) {
      setStatus('');
      return;
    }
    setStatus('Buscando endereço…');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await res.json();
      if (d.erro) {
        setStatus('CEP não encontrado — preencha manualmente.');
        return;
      }
      onResolve({
        address: d.logradouro || '',
        neighborhood: d.bairro || '',
        city: d.localidade || '',
        state: d.uf || '',
      });
      setStatus('Endereço preenchido — confira e complete o número.');
    } catch {
      setStatus('Não consegui buscar o CEP — preencha manualmente.');
    }
  }

  return (
    <label>
      CEP
      <input
        value={cep}
        inputMode="numeric"
        maxLength={8}
        placeholder="Só números (8 dígitos)"
        onChange={(e) => onChange(e.target.value)}
      />
      {status && <span className="muted">{status}</span>}
    </label>
  );
}
