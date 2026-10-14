// G1 / T1 benchmark: per-audience patch translation (`patchesFor` with raw patches) vs per-audience
// state diffing (`diffPatchesFor`). Parity is asserted; timings are logged. See D21.
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { IDS, makeCampaign, makeEntity } from '../actions/testing.js';
import type { Campaign } from '../schema/index.js';
import type { Audience } from './audience.js';
import { diffPatchesFor, patchesFor } from './patches-for.js';
import { visibleTo } from './visible-to.js';

enablePatches();

const N = 2000;
const SEATS = 10;
const eid = (i: number) =>
  i
    .toString(32)
    .toUpperCase()
    .padStart(26, '0')
    .replaceAll('I', 'J')
    .replaceAll('L', 'M')
    .replaceAll('O', 'P')
    .replaceAll('U', 'V');

function bigCampaign(): Campaign {
  const base = makeCampaign();
  return {
    ...base,
    scenes: {
      [IDS.scene]: {
        ...(base.scenes[IDS.scene] as Campaign['scenes'][string]),
        entities: Object.fromEntries(
          Array.from({ length: N }, (_, i) => [
            eid(i),
            makeEntity(eid(i), { layer: i % 10 === 0 ? 'dm' : 'tokens' }),
          ]),
        ),
      },
    },
  };
}

const audiences: Audience[] = [
  ...Array.from({ length: SEATS }, (_, i): Audience => ({ kind: 'seat', seatId: eid(5000 + i) })),
  { kind: 'spectators' },
];

describe('G1 benchmark', () => {
  it('translation and diffing agree; timings recorded', () => {
    let state = bigCampaign();
    const ids = Object.keys(state.scenes[IDS.scene]?.entities ?? {});
    for (const a of audiences) visibleTo(a, state); // warm caches like a running host would

    const ACTIONS = 100;
    let tDiff = 0;
    let tTrans = 0;
    for (let k = 0; k < ACTIONS; k++) {
      const target = ids[(k * 7) % N] as string;
      const [next, raw] = produceWithPatches(state, (d) => {
        const e = d.scenes[IDS.scene]?.entities[target];
        if (!e) return;
        if (k % 25 === 0) e.layer = e.layer === 'dm' ? 'tokens' : 'dm';
        else e.transform.position.x = k;
      });
      let t = performance.now();
      const diffed = audiences.map((a) => diffPatchesFor(a, state, next));
      tDiff += performance.now() - t;
      t = performance.now();
      const translated = audiences.map((a) => patchesFor(a, state, next, raw));
      tTrans += performance.now() - t;
      audiences.forEach((a, i) => {
        const view = visibleTo(a, state);
        expect(applyPatches(view, translated[i] as Patch[])).toEqual(
          applyPatches(view, diffed[i] as Patch[]),
        );
      });
      state = next;
    }
    const perAction = (ms: number) => (ms / ACTIONS).toFixed(3);
    console.log(
      `G1: ${String(N)} entities, ${String(audiences.length)} audiences, ${String(ACTIONS)} actions -> ` +
        `diff ${perAction(tDiff)} ms/action, translate ${perAction(tTrans)} ms/action`,
    );
    // Generous bound (CI machines vary): fan-out must stay far below the 150 ms budget (§6.5).
    expect(tTrans / ACTIONS).toBeLessThan(5);
  }, 30_000);
});
