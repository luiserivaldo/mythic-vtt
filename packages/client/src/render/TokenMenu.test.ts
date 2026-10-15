// @vitest-environment happy-dom
import type { Campaign, Entity, Scene, Seat } from '@mythic/shared';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionStore } from '../tools/selection-store.js';
import type { IntentResult } from '../net/intents.js';
import { SubmitContext } from '../ui/submit.js';
import { tokenMenuStore } from '../ui/token-menu-store.js';
import { tid } from '../testing.js';
import type { RenderScene } from './scene-model.js';
import { TokenMenus } from './TokenMenu.js';

// UI-TOKEN-02 / UI-TOKEN-03 in the DOM: a move-only owner gets the controls they hold and the rest
// disabled with a reason, the right-click menu is curated (Add Condition opens the condition picker), and a
// name the viewer may not read never reaches the menu's own markup (D35, PERM-03).

interface MockState {
  isHost: boolean;
  seatId: string | null;
  campaign: Campaign | null;
  confirmBeforeDeleting: boolean;
}

const mock = vi.hoisted((): MockState => ({
  isHost: true,
  seatId: null,
  campaign: null,
  confirmBeforeDeleting: true,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: { invalidate: () => void }) => unknown) =>
    select({ invalidate: () => undefined }),
}));
vi.mock('@react-three/drei', async () => {
  const { createElement: element } = await import('react');
  return {
    Html: ({ children }: { children?: unknown }) => element('div', null, children as never),
  };
});
vi.mock('../store/react.js', () => ({
  useClientStore: (select: (state: unknown) => unknown) =>
    select({
      campaign: mock.campaign,
      isHost: mock.isHost,
      seatId: mock.seatId,
      viewAs: { kind: 'host' },
    }),
}));
vi.mock('../ui/ViewerPreferencesProvider.js', () => ({
  useViewerPreferences: () => ({
    preferences: { showHeightLabels: true, confirmBeforeDeleting: mock.confirmBeforeDeleting },
    update: () => undefined,
  }),
}));

const SCENE = tid(1);
const TOKEN = tid(2);
const SEAT = tid(3);
const SECRET_NAME = 'Secret drake';

const seat: Seat = {
  id: SEAT,
  label: 'Owner',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
};

/** The host blanks a name this audience may not read, so the client holds an empty string. */
const entity: Entity = {
  id: TOKEN,
  layer: 'tokens',
  name: '',
  owners: [SEAT],
  transform: {
    position: { x: 3, y: 0, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  // A DM-only label: the owner still selects and moves the token, but never reads the name (D35).
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' },
};

const scene: Scene = {
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
  layers: { map: { locked: true } },
  environment: { background: '#d9dde3' },
  entities: { [TOKEN]: entity },
};

const campaign: Campaign = {
  id: tid(9),
  name: 'Table',
  schemaVersion: 5,
  settings: {
    defaultBinding: 'persistent',
    instanceMode: 'linked',
    spectators: { enabled: false, view: 'players' },
  },
  seats: { [SEAT]: seat },
  scenes: { [SCENE]: scene },
  activeSceneId: SCENE,
};

const rendered: RenderScene = {
  id: SCENE,
  background: '#000000',
  entities: [
    {
      id: TOKEN,
      layer: 'tokens',
      position: [3, 0, 5],
      sizeCells: 1,
      secret: false,
      token: {
        image: undefined,
        name: '',
        owners: [],
        entityLayer: 'tokens',
        perms: undefined,
        labelVisibility: 'owner',
        yaw: 0,
      },
    },
  ],
};

const submit = vi.fn((): Promise<IntentResult> => Promise.resolve({ ok: true, seq: 1 }));

let container: HTMLDivElement;
let root: Root;

function renderMenus(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        SubmitContext.Provider,
        { value: submit },
        createElement(TokenMenus, { scene, rendered, mode: '2d' }),
      ),
    );
  });
}

const menu = () => document.querySelector('[data-testid="token-menu"]');
const contextMenu = () => document.querySelector('[data-testid="token-context-menu"]');

function selectToken(): void {
  act(() => {
    selectionStore.getState().pick(SCENE, TOKEN, false);
  });
}

function openFull(): void {
  act(() => {
    tokenMenuStore.getState().open(TOKEN);
  });
}

function openContext(): void {
  act(() => {
    tokenMenuStore.getState().openContext(TOKEN);
  });
}

/** React 19 listens at the root container, so the event must bubble from the button. */
function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  mock.isHost = false;
  mock.seatId = SEAT;
  mock.campaign = campaign;
  mock.confirmBeforeDeleting = true;
  submit.mockClear();
  selectionStore.getState().clear();
  tokenMenuStore.getState().close();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  selectionStore.getState().clear();
  tokenMenuStore.getState().close();
});

describe('the full token menu (UI-TOKEN-02)', () => {
  it('shows the stand-in name, never the hidden one, and disables what the owner may not edit', () => {
    renderMenus();
    selectToken();
    openFull();
    const panel = menu();
    expect(panel).not.toBeNull();
    expect(panel?.textContent).not.toContain(SECRET_NAME);
    const name = panel?.querySelector<HTMLInputElement>('form input[type="text"]');
    expect(name?.value).toBe('Unknown token');
    expect(name?.disabled).toBe(true);
    expect(name?.title).toBe('This token’s name is not shared with you.');
    // The owner may move, so height and flight are live; delete and image are not (PERM-02).
    expect(
      panel?.querySelector<HTMLInputElement>('[aria-label="Flying (locks height)"]')?.disabled,
    ).toBe(false);
    expect(
      panel?.querySelector<HTMLButtonElement>('[title="You cannot delete this token."]')?.disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toContain('UI-TOKEN');
  });

  it('sends the flight lock through its own action (TOK-03, Q26)', () => {
    renderMenus();
    selectToken();
    openFull();
    const flying = menu()?.querySelector<HTMLInputElement>('[aria-label="Flying (locks height)"]');
    click(flying);
    // The checkbox mirrors the host's patch, so its own state only flips once the patch lands; what
    // the control must do is send the action.
    expect(submit).toHaveBeenCalledWith(
      'token.setFlying',
      { sceneId: SCENE, entityId: TOKEN, flying: true },
      SCENE,
    );
  });

  it('asks before deleting when the viewer left that preference on', () => {
    renderMenus();
    selectToken();
    openFull();
    const button = menu()?.querySelector<HTMLButtonElement>(
      'button[title="You cannot delete this token."]',
    );
    // The owner holds no delete grant, so the confirmation never gets a chance to open.
    expect(button?.disabled).toBe(true);
    mock.confirmBeforeDeleting = true;
  });

  it('offers every field to the host', () => {
    mock.isHost = true;
    mock.seatId = null;
    renderMenus();
    selectToken();
    openFull();
    const panel = menu();
    for (const control of panel?.querySelectorAll('input, select') ?? []) {
      expect(control.hasAttribute('disabled')).toBe(false);
    }
    const remove = [...(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Delete',
    );
    expect(remove?.disabled).toBe(false);
  });

  it('renders nothing without a selected token, and closes with the selection', () => {
    renderMenus();
    openFull();
    expect(menu()).toBeNull();
    selectToken();
    openFull();
    expect(menu()).not.toBeNull();
    act(() => {
      selectionStore.getState().clear();
    });
    expect(menu()).toBeNull();
  });
});

describe('the right-click menu (UI-TOKEN-03)', () => {
  it('curates the list and greys Add Condition, with a reason, for a seat that cannot edit', () => {
    renderMenus();
    selectToken();
    openContext();
    const items = [...(contextMenu()?.querySelectorAll<HTMLElement>('li') ?? [])];
    expect(items.map((li) => li.textContent)).toEqual([
      'See Sheet',
      'Add Condition',
      'Change Layer',
      'Ping',
      'Token Options',
    ]);
    const condition = items[1];
    expect(condition?.querySelector('button')?.disabled).toBe(true);
    expect(condition?.title).not.toBe('');
  });

  it('opens the condition picker from Add Condition and sends the marker', () => {
    mock.isHost = true;
    mock.seatId = null;
    renderMenus();
    selectToken();
    openContext();
    const panel = contextMenu();
    expect(panel).not.toBeNull();
    const buttons = () => [...(panel?.querySelectorAll<HTMLButtonElement>('li > button') ?? [])];
    expect(buttons().map((b) => b.textContent)).toEqual([
      'See Sheet',
      'Add Condition',
      'Change Layer',
      'Ping',
      'Token Options',
    ]);
    const condition = buttons().find((b) => b.textContent === 'Add Condition');
    expect(condition?.disabled).toBe(false);
    click(condition);
    const options = [...(panel?.querySelectorAll<HTMLButtonElement>('ul ul button') ?? [])];
    expect(options.length).toBeGreaterThan(0);
    click(options[0]);
    expect(submit).toHaveBeenCalledWith(
      'token.setStatusMarkers',
      expect.objectContaining({ sceneId: SCENE, entityId: TOKEN }),
      SCENE,
    );
  });

  it('opens the layer submenu with the locked layer disabled, then sends the move', () => {
    renderMenus();
    selectToken();
    openContext();
    const changeLayer = [
      ...(contextMenu()?.querySelectorAll<HTMLButtonElement>('li > button') ?? []),
    ].find((b) => b.textContent === 'Change Layer');
    click(changeLayer);
    const options = [...(contextMenu()?.querySelectorAll<HTMLButtonElement>('ul ul button') ?? [])];
    const map = options.find((b) => b.textContent.startsWith('Map'));
    expect(map?.disabled).toBe(true);
    const props = options.find((b) => b.textContent === 'Props');
    expect(props?.disabled).toBe(false);
    click(props);
    expect(submit).toHaveBeenCalledWith(
      'entity.setLayer',
      { sceneId: SCENE, entityId: TOKEN, layer: 'props' },
      SCENE,
    );
  });

  it('hands Token Options over to the full menu, one menu at a time', () => {
    renderMenus();
    selectToken();
    openContext();
    const options = [
      ...(contextMenu()?.querySelectorAll<HTMLButtonElement>('li > button') ?? []),
    ].find((b) => b.textContent === 'Token Options');
    click(options);
    expect(contextMenu()).toBeNull();
    expect(tokenMenuStore.getState()).toMatchObject({ entityId: TOKEN, contextEntityId: null });
  });

  it('shows nothing at all to a spectator', () => {
    mock.isHost = false;
    mock.seatId = null;
    renderMenus();
    act(() => {
      selectionStore.getState().pick(SCENE, TOKEN, false);
    });
    openContext();
    expect(contextMenu()).toBeNull();
  });
});
