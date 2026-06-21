# Diretrizes de Design (UI/Animação)

Fonte da verdade: a skill **emil-design-eng** (filosofia do Emil Kowalski).
Não duplico o conteúdo aqui — leio direto da skill:

- [SKILL.md](../.agents/skills/emil-design-eng/SKILL.md)
- [Padrões de animação (STANDARDS.md)](../.agents/skills/review-animations/STANDARDS.md)

## Paleta da marca (padrão do site)
Site **branco**; o contraste é um **gradiente roxo→azul** (alinhado à animação
Iridescence do login). Tokens em `:root` de `globals.css`:
- `--brand-purple: #6b4fd0` · `--brand-blue: #3b82f6`
- `--brand-gradient: linear-gradient(135deg, purple, blue)` — fundo dos botões primários
- `--brand-tint` — anel de foco dos inputs

Aplicado em: botão primário, links, foco de input, chips ativos, passos do wizard.
Vermelho fica reservado a ações destrutivas; verde a "publicado".

## Já aplicado no front (`frontend/app/globals.css`)
- Easing custom fortes: `--ease-out: cubic-bezier(0.23,1,0.32,1)` etc. (as nativas são fracas)
- Durações de UI **< 300ms**
- Só `transform`/`opacity` (GPU)
- `scale(0.97)` no `:active` (feedback de press)
- Hover atrás de `@media (hover: hover) and (pointer: fine)`
- `prefers-reduced-motion` respeitado

## Regras-chave a seguir sempre
- Nunca `transition: all` nem `scale(0)` na entrada (começa em `scale(0.95)` + opacity)
- Nunca `ease-in` em UI
- Popover/dropdown escala da origem do trigger, não do centro (modal é exceção)
- Ação de teclado / 100+x ao dia → **sem animação**

Voltar: [[Home]] · contexto: [[architecture]]
