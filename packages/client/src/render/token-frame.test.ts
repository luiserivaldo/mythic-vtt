import { Euler, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TOKEN_GROUND_FRAME } from './token-frame.js';

describe('TOKEN_GROUND_FRAME (M1-34)', () => {
  it('maps the default label anchor onto the ground plane below the token, not onto its centre', () => {
    // TokenLabel's default anchor for a 2-cell token is [0, -sizeCells / 2 - 0.2, 0].
    const [rx, ry, rz] = TOKEN_GROUND_FRAME;
    const anchor = new Vector3(0, -1.2, 0).applyEuler(new Euler(rx, ry, rz));
    expect(anchor.y).toBeCloseTo(0);
    expect(anchor.z).toBeCloseTo(1.2);
  });
});
