import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSpectatorView } from './spectator-view.js';

it('defaults to the player view, persists across reopen and isolates campaigns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mythic-view-'));
  const path = join(dir, 'index.sqlite');
  let a = createSpectatorView(path, 'campaign-a');
  const b = createSpectatorView(path, 'campaign-b');
  try {
    expect(a.get()).toBeNull();
    a.set('seat-1');
    expect(a.get()).toBe('seat-1');
    expect(b.get()).toBeNull();
    a.close();
    a = createSpectatorView(path, 'campaign-a');
    expect(a.get()).toBe('seat-1');
    a.set(null);
    expect(a.get()).toBeNull();
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
