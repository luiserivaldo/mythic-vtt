import type { RenderEntity } from './scene-model.js';
import { DEFAULT_TOKEN_COLOR, SELECTION_COLOR } from './canvas-style.js';

const FILL = {
  token: DEFAULT_TOKEN_COLOR,
  secret: '#a577ce',
  selected: SELECTION_COLOR,
  layers: {
    map: '#51637a',
    'props-under': '#8a96a5',
    'props-over': '#a8b5c3',
    effects: '#f0ae55',
    ui: '#ffffff',
  },
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface TokenFill {
  color: string;
  /** Selection is shown by a ring (not by recolouring) whenever the fill carries meaning. */
  ring: boolean;
}

/**
 * Placeholder fill for an entity drawn as a flat quad. D38: a token's own `color` wins over the
 * default for image-less tokens, and selection then uses the ring so the colour stays readable.
 */
export function entityFill(entity: RenderEntity, selected: boolean): TokenFill {
  const token = entity.token;
  if (token?.image) return { color: FILL.token, ring: selected };
  if (token?.color && HEX.test(token.color)) return { color: token.color, ring: selected };
  if (selected) return { color: FILL.selected, ring: false };
  if (entity.secret) return { color: FILL.secret, ring: false };
  return { color: entity.layer === 'tokens' ? FILL.token : FILL.layers[entity.layer], ring: false };
}
