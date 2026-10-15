import { canPerform, type Campaign, type Entity } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import { tokenCreateIntent } from './entity-panel.js';
import { explainFailure, type RejectContext } from './reject-reason.js';

const S = tid(2);
const P = tid(4);
const Q = tid(5);
const E = tid(30);

function world(opts: { locked?: boolean; owner?: string; interaction?: boolean } = {}): Campaign {
  const base = makeCampaign();
  const grid = {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'alternating',
    snap: true,
  } as const;
  const spec = tokenCreateIntent(
    { id: S, name: 'Cave', grid, environment: { background: '#000000' }, layers: {}, entities: {} },
    {
      sceneId: S,
      entityId: E,
      name: 'Goblin',
      size: 'medium',
      layer: 'tokens',
      labelVisibility: 'all',
      ownerId: opts.owner ?? null,
      imageHash: null,
    },
  );
  const entity = (spec.payload as { entity: Entity }).entity;
  const seat = (id: string, label: string) => ({
    id,
    label,
    binding: 'persistent' as const,
    identityId: null,
    role: 'player' as const,
    permissions: { view: true, move: true, edit: true, delete: true },
    ...(opts.interaction === false ? { interactionEnabled: false } : {}),
  });
  return {
    ...base,
    seats: { [P]: seat(P, 'Pia'), [Q]: seat(Q, 'Quin') },
    scenes: {
      [S]: {
        id: S,
        name: 'Cave',
        grid,
        environment: { background: '#000000' },
        layers: { tokens: { locked: opts.locked ?? false } },
        entities: { [E]: entity },
      },
    },
    activeSceneId: S,
  };
}

const move = { sceneId: S, entityId: E, to: { x: 21, y: 0, z: 15 } };

function explain(campaign: Campaign, seatId: string | null, payload: unknown = move): string {
  const ctx: RejectContext = { campaign, seatId, isHost: false, type: 'token.move', payload };
  return explainFailure('forbidden', ctx);
}

describe('forbidden reject reasons', () => {
  it('names ownership when a player moves a token they do not own', () => {
    const state = world({ owner: Q });
    expect(canPerform(state, { kind: 'seat', seatId: P }, 'token.move', move)).toBe(false);
    expect(explain(state, P)).toBe('That token is not yours.');
  });

  it('names the locked layer even for the owner', () => {
    const state = world({ owner: P, locked: true });
    expect(canPerform(state, { kind: 'seat', seatId: P }, 'token.move', move)).toBe(false);
    expect(explain(state, P)).toBe('That layer is locked.');
  });

  it('names disabled interaction before anything else', () => {
    const state = world({ owner: P, locked: true, interaction: false });
    expect(explain(state, P)).toBe('The DM has turned off interaction for your seat.');
  });

  it('tells a seatless spectator they need a seat', () => {
    expect(explain(world(), null)).toContain('Spectators');
  });

  it('gives an entity missing from the view the same generic answer (no leak)', () => {
    const state = world();
    const missing = { ...move, entityId: tid(99) };
    expect(explain(state, P, missing)).toBe('You do not have permission to do that.');
  });

  it('has a plain sentence for every other code a player can hit', () => {
    const ctx: RejectContext = {
      campaign: null,
      seatId: null,
      isHost: false,
      type: 'x',
      payload: {},
    };
    for (const reason of [
      'invalid-payload',
      'unknown-action',
      'rate-limited',
      'conflict',
      'connection-lost',
      'timeout',
      'queue-full',
    ] as const) {
      const text = explainFailure(reason, ctx);
      expect(text).toMatch(/^[A-Z].*[.]$/);
      expect(text).not.toContain(reason);
    }
  });
});
