import { expect, it } from 'vitest';
import { Campaign } from './index.js';

it('exports the core schemas', () => {
  expect(typeof Campaign.parse).toBe('function');
});
