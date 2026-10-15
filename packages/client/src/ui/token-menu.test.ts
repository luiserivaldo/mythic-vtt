import {
  StatusIcon,
  type Actor,
  type AssetRef,
  type Campaign,
  type Entity,
  type Scene,
  type Seat,
} from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { HIDDEN_TOKEN_NAME } from '../render/token-labels.js';
import type { SelectionActor } from '../tools/selection.js';
import { tid } from '../testing.js';
import { entityDeleteIntent, entityRenameIntent } from './entity-panel.js';
import { LAYER_ORDER, moveTargets } from './layer-panel.js';
import {
  INVALID_HEIGHT_MESSAGE,
  TOKEN_CONTEXT_LABELS,
  TOKEN_MENU_FIELD_IDS,
  TOKEN_MENU_LABELS,
  tokenConditionIntent,
  tokenConditionTargets,
  tokenContextMenu,
  tokenDeleteIntent,
  tokenFlyingIntent,
  tokenHeightIntent,
  tokenImageIntent,
  tokenLayerIntent,
  tokenMenuAnchor,
  tokenMenuHeight,
  tokenMenuName,
  tokenMenuModel,
  type TokenMenuFieldId,
  type TokenMenuInput,
} from './token-menu.js';

const SCENE = tid(1);
const TOKEN = tid(2);
const SECRET = tid(3);
const DM_TOKEN = tid(4);
const OWNER = tid(5);
const EDITOR = tid(6);
const CODM = tid(7);
const OUTSIDER = tid(8);

const seed = (over: Partial<Seat> = {}): Seat => ({
  id: OWNER,
  label: 'Owner',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
  ...over,
});
const ownerSeat = seed();
const editorSeat = seed({
  id: EDITOR,
  label: 'Editor',
  permissions: { view: true, move: true, edit: true, delete: true },
});
const codmSeat = seed({
  id: CODM,
  label: 'Co-DM',
  role: 'codm',
  permissions: { view: true, move: true, edit: true, delete: true },
});
const outsiderSeat = seed({
  id: OUTSIDER,
  label: 'Outsider',
  permissions: { view: true, move: true, edit: false, delete: false },
});

const unitTransform = {
  position: { x: 3, y: 0, z: 5 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};
const tokenEntity = (over: Partial<Entity> = {}): Entity => ({
  id: TOKEN,
  layer: 'tokens',
  name: 'Goblin',
  owners: [OWNER],
  // The owner holds move; the entity itself grants edit and delete (PERM-02).
  perms: { edit: true, delete: true },
  transform: unitTransform,
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  ...over,
});

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    id: SCENE,
    name: 'Table',
    grid: {
      type: 'square',
      sizePx: 64,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'chebyshev',
      snap: true,
    },
    layers: {},
    entities: {
      [TOKEN]: tokenEntity(),
      // The host blanks a name this audience may not read (PERM-03); this fixture keeps the raw
      // name on purpose to prove the menu still never prints it (D35).
      [SECRET]: tokenEntity({
        id: SECRET,
        name: 'Secret drake',
        owners: [],
        perms: { move: true, edit: true },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
      }),
      [DM_TOKEN]: tokenEntity({ id: DM_TOKEN, layer: 'dm', owners: [], perms: undefined }),
    },
    ...over,
  }) as Scene;

const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: tid(9),
  name: 'Table',
  schemaVersion: 5,
  settings: {
    defaultBinding: 'persistent',
    instanceMode: 'linked',
    spectators: { enabled: false, view: 'players' },
  },
  seats: { [OWNER]: ownerSeat, [EDITOR]: editorSeat, [CODM]: codmSeat, [OUTSIDER]: outsiderSeat },
  scenes: { [SCENE]: scene() },
  activeSceneId: SCENE,
  ...over,
});

const host: Actor = { kind: 'host' };
const seatActor = (seatId: string): Actor => ({ kind: 'seat', seatId });
const viewerOf = (seat: Seat): SelectionActor => ({ kind: 'seat', seat });

/** One input per viewer, always against a scene held by the campaign it is checked with. */
function inputOf(
  state: Campaign,
  entityId: string = TOKEN,
  over: Partial<TokenMenuInput> = {},
): TokenMenuInput {
  const scene = state.scenes[SCENE] as Scene;
  return {
    campaign: state,
    scene,
    entity: JSON.parse(JSON.stringify(scene.entities[entityId])) as Entity,
    actor: host,
    viewer: { kind: 'host' },
    ...over,
  };
}

const input = (over: Partial<TokenMenuInput> = {}): TokenMenuInput =>
  inputOf(campaign(), TOKEN, over);

const fieldOf = (model: ReturnType<typeof tokenMenuModel>, id: TokenMenuFieldId) => {
  const field = model.fields.find((f) => f.id === id);
  if (!field) throw new Error(`missing field ${id}`);
  return field;
};

describe('tokenMenuName (UI-TOKEN-02, D35)', () => {
  it('prints the name a host or co-DM may read, whatever the label mode', () => {
    for (const labelVisibility of ['all', 'owner', 'dm'] as const) {
      const entity = tokenEntity({
        name: 'Goblin',
        token: { sizeCells: 1, heightCells: 1, labelVisibility },
      });
      expect(tokenMenuName(entity, { kind: 'host' })).toBe('Goblin');
      expect(tokenMenuName(entity, viewerOf(codmSeat))).toBe('Goblin');
    }
  });

  it('prints the stand-in, never the name, for a label this viewer may not read', () => {
    const entity = tokenEntity({
      name: 'Secret drake',
      owners: [],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
    });
    expect(tokenMenuName(entity, viewerOf(outsiderSeat))).toBe(HIDDEN_TOKEN_NAME);
    // D35: a spectator gets an owner name only while it follows the owning seat (SES-11).
    expect(tokenMenuName({ ...entity, name: '' }, { kind: 'spectator' })).toBe(HIDDEN_TOKEN_NAME);
    // The owner of an owner-only label reads it, so the field is theirs to edit.
    expect(tokenMenuName(tokenEntity({ ...entity, owners: [OWNER] }), viewerOf(ownerSeat))).toBe(
      'Secret drake',
    );
  });

  it('keeps a host-blanked name blank so the field can be filled in', () => {
    expect(tokenMenuName(tokenEntity({ name: '' }), { kind: 'host' })).toBe('');
    // A blank name the viewer cannot read is still the stand-in, never an empty claim.
    expect(
      tokenMenuName(
        tokenEntity({
          name: '',
          owners: [],
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' },
        }),
        viewerOf(ownerSeat),
      ),
    ).toBe(HIDDEN_TOKEN_NAME);
  });
});

describe('tokenMenuModel (UI-TOKEN-02, TOK-01/03, LAY-07, PERM-02)', () => {
  it('offers every field with its user-facing label, in the UI order', () => {
    const model = tokenMenuModel(input());
    expect(model.fields.map((f) => f.id)).toEqual([...TOKEN_MENU_FIELD_IDS]);
    for (const field of model.fields) expect(field.label).toBe(TOKEN_MENU_LABELS[field.id]);
  });

  it('enables every field for the host and carries no reason', () => {
    const model = tokenMenuModel(input());
    expect(model.name).toBe('Goblin');
    for (const field of model.fields) {
      expect(field.enabled).toBe(true);
      expect(field.disabledReason).toBeNull();
    }
    expect(model.layers.length).toBe(LAYER_ORDER.length - 1);
  });

  it('disables exactly what a move-only owner may not do, with a reason', () => {
    const model = tokenMenuModel(input({ actor: seatActor(OWNER), viewer: viewerOf(ownerSeat) }));
    expect(fieldOf(model, 'name').enabled).toBe(false);
    expect(fieldOf(model, 'name').disabledReason).not.toBeNull();
    expect(fieldOf(model, 'image').enabled).toBe(false);
    expect(fieldOf(model, 'height').enabled).toBe(true);
    expect(fieldOf(model, 'flying').enabled).toBe(true);
    expect(fieldOf(model, 'layer').enabled).toBe(true);
    expect(fieldOf(model, 'delete').enabled).toBe(false);
  });

  it('enables edit and delete for a seat that holds those grants', () => {
    const model = tokenMenuModel(input({ actor: seatActor(EDITOR), viewer: viewerOf(editorSeat) }));
    expect(fieldOf(model, 'name').enabled).toBe(true);
    expect(fieldOf(model, 'image').enabled).toBe(true);
    expect(fieldOf(model, 'delete').enabled).toBe(true);
  });

  it('disables every field when the seat has interaction switched off', () => {
    const state = campaign({
      seats: {
        [OWNER]: { ...ownerSeat, interactionEnabled: false },
        [EDITOR]: editorSeat,
        [CODM]: codmSeat,
        [OUTSIDER]: outsiderSeat,
      },
    });
    const model = tokenMenuModel({
      ...input({ actor: seatActor(OWNER), viewer: viewerOf(ownerSeat) }),
      campaign: state,
      scene: state.scenes[SCENE] as Scene,
    });
    for (const field of model.fields) expect(field.enabled).toBe(false);
  });

  it('disables every field on a locked layer, naming the lock as the reason', () => {
    const locked = campaign({
      scenes: { [SCENE]: scene({ layers: { tokens: { locked: true } } }) },
    });
    const model = tokenMenuModel(inputOf(locked));
    for (const field of model.fields) {
      expect(field.enabled).toBe(false);
      expect(field.disabledReason).toBe('That layer is locked.');
    }
  });

  it('never lets a viewer rename a name they cannot read', () => {
    // The editor holds edit on this token (entity perms), so only the label rule can stop a rename.
    const model = tokenMenuModel(
      inputOf(campaign(), SECRET, {
        actor: seatActor(EDITOR),
        viewer: viewerOf(editorSeat),
      }),
    );
    expect(model.name).toBe(HIDDEN_TOKEN_NAME);
    expect(model.name).not.toContain('Secret');
    expect(fieldOf(model, 'name').enabled).toBe(false);
    expect(fieldOf(model, 'name').disabledReason).toBe('This token’s name is not shared with you.');
    expect(fieldOf(model, 'height').enabled).toBe(true);
    expect(fieldOf(model, 'delete').enabled).toBe(false);
  });

  it('keeps a co-DM off the DM layer but on every other target (D32)', () => {
    const model = tokenMenuModel(input({ actor: seatActor(CODM), viewer: viewerOf(codmSeat) }));
    const dm = model.layers.find((t) => t.layer === 'dm');
    expect(dm?.enabled).toBe(false);
    expect(dm?.reason).toBe('Not allowed');
    for (const target of model.layers) {
      if (target.layer !== 'dm') expect(target.enabled).toBe(true);
    }
  });

  it('mirrors the layer picker’s own reasons so the two never disagree', () => {
    const locked = campaign({
      scenes: { [SCENE]: scene({ layers: { props: { locked: true } } }) },
    });
    const world = locked.scenes[SCENE] as Scene;
    const model = tokenMenuModel(inputOf(locked));
    const expected = moveTargets(world, world.entities[TOKEN] as Entity);
    expect(model.layers.map((t) => t.layer)).toEqual(expected.map((t) => t.layer));
    const props = model.layers.find((t) => t.layer === 'props');
    expect(props?.enabled).toBe(false);
    expect(props?.reason).toBe('Props is locked');
  });

  it('keeps a co-DM off a DM-layer token but in charge of a public one (D32)', () => {
    const codm = { actor: seatActor(CODM), viewer: viewerOf(codmSeat) } as const;
    const onDmLayer = tokenMenuModel(inputOf(campaign(), DM_TOKEN, codm));
    expect(fieldOf(onDmLayer, 'height').enabled).toBe(false);
    expect(fieldOf(onDmLayer, 'name').enabled).toBe(false);
    expect(fieldOf(onDmLayer, 'height').disabledReason).toBe('You cannot move this token.');
    const publicToken = tokenMenuModel(inputOf(campaign(), TOKEN, codm));
    expect(fieldOf(publicToken, 'height').enabled).toBe(true);
  });

  it('disables the token-only fields for an entity that has no token component', () => {
    const prop = tokenEntity({ token: undefined, shape: undefined });
    const model = tokenMenuModel(input({ entity: prop }));
    expect(fieldOf(model, 'image').enabled).toBe(false);
    expect(fieldOf(model, 'height').enabled).toBe(false);
    expect(fieldOf(model, 'flying').enabled).toBe(false);
    expect(fieldOf(model, 'name').enabled).toBe(true);
  });
});

describe('tokenContextMenu (UI-TOKEN-03, PERM-02, LAY-07)', () => {
  it('shows nothing at all to a viewer who may not select the token', () => {
    expect(
      tokenContextMenu(input({ actor: seatActor(OUTSIDER), viewer: { kind: 'spectator' } })),
    ).toEqual([]);
  });

  it('offers the five curated items, in order, with Add Condition enabled for the host', () => {
    const items = tokenContextMenu(input());
    expect(items.map((i) => i.id)).toEqual([
      'see-sheet',
      'add-condition',
      'change-layer',
      'ping',
      'token-options',
    ]);
    for (const item of items) expect(item.label).toBe(TOKEN_CONTEXT_LABELS[item.id]);
    const condition = items.find((i) => i.id === 'add-condition');
    expect(condition?.enabled).toBe(true);
    expect(condition?.reason).toBeNull();
  });

  it('greys Add Condition, with a reason, for a seat that may not set markers (TOK-06)', () => {
    const items = tokenContextMenu(input({ actor: seatActor(OWNER), viewer: viewerOf(ownerSeat) }));
    const condition = items.find((i) => i.id === 'add-condition');
    expect(condition?.enabled).toBe(false);
    expect(condition?.reason).toBe('You cannot change this token’s conditions.');
  });

  it('greys an icon the token already holds, and Add Condition once every icon is held', () => {
    const held = tokenEntity({
      token: {
        sizeCells: 1,
        heightCells: 1,
        labelVisibility: 'all',
        statusMarkers: [
          { kind: 'icon', icon: 'prone' },
          { kind: 'text', text: 'Hexed' },
        ],
      },
    });
    const targets = tokenConditionTargets(held);
    expect(targets.map((t) => t.icon)).toEqual(StatusIcon.options);
    expect(targets.find((t) => t.icon === 'prone')).toMatchObject({
      enabled: false,
      reason: 'Already on this token.',
    });
    expect(targets.filter((t) => t.enabled)).toHaveLength(StatusIcon.options.length - 1);

    const full = tokenEntity({
      token: {
        sizeCells: 1,
        heightCells: 1,
        labelVisibility: 'all',
        statusMarkers: StatusIcon.options.map((icon) => ({ kind: 'icon' as const, icon })),
      },
    });
    const state = campaign({ scenes: { [SCENE]: scene({ entities: { [TOKEN]: full } }) } });
    const condition = tokenContextMenu(inputOf(state)).find((i) => i.id === 'add-condition');
    expect(condition?.enabled).toBe(false);
    expect(condition?.reason).toBe('This token has the most conditions it can hold.');
  });

  it('appends the picked icon to the markers the token already holds', () => {
    const markers = [{ kind: 'text' as const, text: 'Hexed' }];
    const entity = tokenEntity({
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', statusMarkers: markers },
    });
    expect(tokenConditionIntent(SCENE, entity, 'stunned')).toEqual({
      type: 'token.setStatusMarkers',
      sceneId: SCENE,
      payload: {
        sceneId: SCENE,
        entityId: TOKEN,
        markers: [...markers, { kind: 'icon', icon: 'stunned' }],
      },
    });
  });

  it('keeps See Sheet and Token Options for everyone who can open the menu', () => {
    const items = tokenContextMenu(input({ actor: seatActor(OWNER), viewer: viewerOf(ownerSeat) }));
    expect(items.map((i) => i.id)).toContain('see-sheet');
    expect(items.find((i) => i.id === 'see-sheet')?.enabled).toBe(true);
    expect(items.find((i) => i.id === 'token-options')?.enabled).toBe(true);
    // The owner holds move on this token, so Change Layer stays.
    expect(items.map((i) => i.id)).toContain('change-layer');
  });

  it('hides Change Layer from a viewer who may not move the token', () => {
    const viewerSeat = seed({
      id: OWNER,
      permissions: { view: true, move: false, edit: false, delete: false },
    });
    const state = campaign({
      seats: {
        [OWNER]: viewerSeat,
        [EDITOR]: editorSeat,
        [CODM]: codmSeat,
        [OUTSIDER]: outsiderSeat,
      },
    });
    const items = tokenContextMenu({
      campaign: state,
      scene: state.scenes[SCENE] as Scene,
      entity: (state.scenes[SCENE] as Scene).entities[TOKEN] as Entity,
      actor: seatActor(OWNER),
      viewer: viewerOf(viewerSeat),
    });
    expect(items.map((i) => i.id)).toEqual(['see-sheet', 'add-condition', 'ping', 'token-options']);
  });

  it('offers nothing for a token the viewer may not select, a locked layer included', () => {
    const locked = campaign({
      scenes: { [SCENE]: scene({ layers: { tokens: { locked: true } } }) },
    });
    expect(
      tokenContextMenu(
        inputOf(locked, TOKEN, { actor: seatActor(OWNER), viewer: viewerOf(ownerSeat) }),
      ),
    ).toEqual([]);
    // And nothing for a spectator, who only ever moves the camera (PERM-01).
    expect(
      tokenContextMenu(
        inputOf(campaign(), TOKEN, { actor: seatActor(OWNER), viewer: { kind: 'spectator' } }),
      ),
    ).toEqual([]);
  });
});

describe('token menu intents (TOK-01/03, LAY-07)', () => {
  const image: AssetRef = { source: 'local', hash: 'a'.repeat(64), kind: 'image', name: 'Goblin' };

  it('renames through the shared entity.update contract', () => {
    expect(
      tokenImageIntent(
        SCENE,
        TOKEN,
        { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        image,
      ),
    ).toEqual({
      type: 'entity.update',
      sceneId: SCENE,
      payload: {
        sceneId: SCENE,
        entityId: TOKEN,
        changes: {
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', image },
        },
      },
    });
  });

  it('reuses the panel’s rename and delete intents unchanged', () => {
    expect(tokenDeleteIntent(SCENE, TOKEN)).toEqual(entityDeleteIntent(SCENE, TOKEN));
    expect(entityRenameIntent(SCENE, TOKEN, 'Goblin')).toEqual({
      type: 'entity.update',
      sceneId: SCENE,
      payload: { sceneId: SCENE, entityId: TOKEN, changes: { name: 'Goblin' } },
    });
  });

  it('sets height and flight through their own actions', () => {
    expect(tokenHeightIntent(SCENE, TOKEN, 2.5)).toEqual({
      type: 'token.setElevation',
      sceneId: SCENE,
      payload: { sceneId: SCENE, entityId: TOKEN, elevation: 2.5 },
    });
    expect(tokenFlyingIntent(SCENE, TOKEN, true)).toEqual({
      type: 'token.setFlying',
      sceneId: SCENE,
      payload: { sceneId: SCENE, entityId: TOKEN, flying: true },
    });
  });

  it('moves between layers through entity.setLayer', () => {
    expect(tokenLayerIntent(SCENE, TOKEN, 'props')).toEqual({
      type: 'entity.setLayer',
      sceneId: SCENE,
      payload: { sceneId: SCENE, entityId: TOKEN, layer: 'props' },
    });
  });
});

describe('tokenMenuHeight (TOK-03, D25)', () => {
  const grid = { snap: true, unitsPerCell: 5 } as const;

  it('reads a typed height in scene units as whole cells on a snapping grid', () => {
    expect(tokenMenuHeight('10', grid)).toEqual({ ok: true, cells: 2 });
    expect(tokenMenuHeight('15', grid)).toEqual({ ok: true, cells: 3 });
    expect(tokenMenuHeight('-10', grid)).toEqual({ ok: true, cells: -2 });
    // A snapping grid rounds a typed value to the nearest whole cell.
    expect(tokenMenuHeight('11', grid)).toEqual({ ok: true, cells: 2 });
  });

  it('keeps a continuous value when the grid does not snap', () => {
    expect(tokenMenuHeight('12.5', { snap: false, unitsPerCell: 5 })).toEqual({
      ok: true,
      cells: 2.5,
    });
  });

  it('accepts exactly the elevation limit and rejects past it or anything unreadable', () => {
    expect(tokenMenuHeight('5000', grid)).toEqual({ ok: true, cells: 1000 });
    expect(tokenMenuHeight('-5000', grid)).toEqual({ ok: true, cells: -1000 });
    for (const bad of ['', '  ', 'abc', 'NaN', 'Infinity', '1e999', '6000']) {
      expect(tokenMenuHeight(bad, grid)).toEqual({
        ok: false,
        reason: INVALID_HEIGHT_MESSAGE,
      });
    }
  });
});

describe('tokenMenuAnchor (UI-TOKEN-02)', () => {
  it('sits to the right of a token in 2D, at the token’s own height', () => {
    expect(tokenMenuAnchor('2d', [4, 2, 7], 1)).toEqual([4.6, 2, 7]);
    // A Huge token (3 cells) pushes the anchor half its own footprint further out.
    expect(tokenMenuAnchor('2d', [4, 0, 7], 3)).toEqual([5.6, 0, 7]);
  });

  it('sits beside the 3D standee, above its base', () => {
    const [x, y, z] = tokenMenuAnchor('3d', [4, 2, 7], 1);
    expect(x).toBeCloseTo(4.6);
    expect(z).toBe(7);
    expect(y).toBeGreaterThan(2);
  });

  it('clamps a malformed footprint to one cell instead of anchoring at NaN', () => {
    for (const sizeCells of [Number.NaN, Infinity, -Infinity, 0, -3]) {
      for (const mode of ['2d', '3d'] as const) {
        const anchor = tokenMenuAnchor(mode, [1, 0, 2], sizeCells);
        expect(anchor.every(Number.isFinite)).toBe(true);
        expect(anchor).toEqual(tokenMenuAnchor(mode, [1, 0, 2], 1));
      }
    }
  });
});

describe('the field and label tables stay exhaustive', () => {
  it('labels every field and every context item with text that carries no task ID', () => {
    for (const id of TOKEN_MENU_FIELD_IDS) expect(TOKEN_MENU_LABELS[id]).not.toMatch(/[A-Z]+-\d+/);
    for (const label of Object.values(TOKEN_CONTEXT_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/[A-Z]+-\d+/);
    }
  });
});
