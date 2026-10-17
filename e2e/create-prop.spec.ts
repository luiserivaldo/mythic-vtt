import { expect, test, type Page } from '@playwright/test';
import { createPropForm } from './create-prop.js';
import { RawClient, startTable } from './harness.js';

// UX-39 (UI-TOOL-04, MV-246): Create Prop's quick settings open in the left pane beside the rail,
// not in the right dock or the Entities tab. Every shape is an icon, and one click on it creates a
// grey, collidable 1x1x1 prop named "Prop N" on the Props layer (MV-266), on the cell centre in the
// middle of the view, in 2D and in 3D.

interface PropState {
  activeSceneId: string;
  scenes: Record<
    string,
    {
      entities: Record<
        string,
        {
          name: string;
          layer: string;
          transform: {
            position: { x: number; y: number; z: number };
            scale: { x: number; y: number; z: number };
          };
          shape?: { kind: string; color: string; walkable?: boolean; texture?: unknown };
        }
      >;
    }
  >;
}

const SHAPES = ['Box', 'Cylinder', 'Cone', 'Pyramid', 'Sphere', 'Plane', 'Wedge'];
/** The first four shapes are created in 2D, the rest in 3D. */
const IN_2D = 4;
/** The default scene is 40 x 30 cells. */
const BOARD = { width: 40, height: 30 };

/** Dev-build camera diagnostics (see packages/client/src/vite-env.d.ts). */
interface CameraDiagnostics {
  __mythicFocus?: { getView2d(): { centerX: number; centerZ: number } };
  __mythicCamera?: { getPose(): { targetX: number; targetZ: number } };
}

/** The ground point in the middle of the view, from the dev camera diagnostics. */
async function viewCentre(page: Page, mode: '2d' | '3d'): Promise<{ x: number; z: number }> {
  return page.evaluate((m) => {
    const diagnostics = globalThis as typeof globalThis & CameraDiagnostics;
    if (m === '2d') {
      const view = diagnostics.__mythicFocus?.getView2d();
      if (!view) throw new Error('2D camera diagnostics are not mounted');
      return { x: view.centerX, z: view.centerZ };
    }
    const pose = diagnostics.__mythicCamera?.getPose();
    if (!pose) throw new Error('3D camera diagnostics are not mounted');
    return { x: pose.targetX, z: pose.targetZ };
  }, mode);
}

test('the DM creates every shape with one click, at the view centre in 2D and 3D', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let reader: RawClient | undefined;
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    reader = await RawClient.connect(table, { name: 'ux39-reader', ...identity });
    await reader.waitFor('snapshot', () => reader?.state !== undefined);

    // The Entities tab is a dashboard of what is on the board; it no longer creates props.
    const dock = page.getByRole('complementary', { name: 'Right dock' });
    await page.getByRole('tab', { name: 'Entities', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Create token' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Create prop' })).toHaveCount(0);

    await page
      .getByRole('toolbar', { name: 'Board controls' })
      .getByRole('button', { name: 'Create Prop', exact: true })
      .click();
    const form = createPropForm(page);
    await expect(form).toBeVisible();
    await expect(dock.getByRole('form', { name: 'Create prop' })).toHaveCount(0);
    const shapes = form.getByRole('group', { name: 'Shape' }).getByRole('button');
    await expect(shapes).toHaveCount(SHAPES.length);
    // MV-266: the shape icon creates; there is no separate Create button.
    await expect(form.getByRole('button')).toHaveCount(SHAPES.length);
    // No texture field in the alpha; textures are set from the entity's own row.
    await expect(form.locator('input[type="file"]')).toHaveCount(0);

    // Pan the 2D view off the map centre, so the prop must follow the view, not the map.
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(mid.x + 150, mid.y + 100, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const centre2d = await viewCentre(page, '2d');
    expect(Math.hypot(centre2d.x - BOARD.width / 2, centre2d.z - BOARD.height / 2)).toBeGreaterThan(
      1,
    );

    const centres: { x: number; z: number }[] = [];
    for (const [index, shape] of SHAPES.entries()) {
      if (index === IN_2D) {
        await page.getByRole('button', { name: '3D view' }).click();
        await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (globalThis as typeof globalThis & CameraDiagnostics).__mythicCamera !== undefined,
            ),
          )
          .toBe(true);
        await expect(form).toBeVisible();
      }
      const name = `Prop ${String(index + 1)}`;
      await expect(form.getByLabel('Prop name')).toHaveValue(name);
      centres.push(await viewCentre(page, index < IN_2D ? '2d' : '3d'));
      // One click on the icon creates the prop.
      await form.getByRole('button', { name: shape, exact: true }).click();
      await expect(dock.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

    const props = () => {
      const state = reader?.state as PropState | undefined;
      return Object.values(state?.scenes[state.activeSceneId]?.entities ?? {});
    };
    await expect.poll(() => props().length, { timeout: 10_000 }).toBe(SHAPES.length);
    for (const [index, shape] of SHAPES.entries()) {
      const entity = props().find((e) => e.name === `Prop ${String(index + 1)}`);
      expect(entity, shape).toMatchObject({
        layer: 'props',
        transform: { position: { y: 0 }, scale: { x: 1, y: 1, z: 1 } },
        shape: { kind: shape.toLowerCase(), color: '#808080', walkable: true },
      });
      expect(entity?.shape).not.toHaveProperty('texture');
      // On a cell centre inside the board, within a cell of the view centre it was created at.
      const { x, z } = entity?.transform.position ?? { x: NaN, z: NaN };
      const centre = centres[index] ?? { x: NaN, z: NaN };
      expect(x, shape).toBeGreaterThan(0);
      expect(x, shape).toBeLessThan(BOARD.width);
      expect(z, shape).toBeGreaterThan(0);
      expect(z, shape).toBeLessThan(BOARD.height);
      expect(x % 1, shape).toBe(0.5);
      expect(z % 1, shape).toBe(0.5);
      expect(Math.abs(x - centre.x), shape).toBeLessThanOrEqual(1);
      expect(Math.abs(z - centre.z), shape).toBeLessThanOrEqual(1);
    }

    // Leaving the tool closes its panel. UI-TOKEN-07 (MV-266): under Select the pane holds the
    // selected prop's Transform; deselecting gives the width back to the board.
    const pane = page.getByRole('complementary', { name: 'Left pane' });
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(pane.getByRole('form', { name: 'Create prop' })).toHaveCount(0);
    await expect(
      pane.getByRole('region', { name: `Transform: Prop ${String(SHAPES.length)}` }),
    ).toBeVisible();
    await page.getByLabel('Scene board').focus();
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await reader?.close();
    await context.close();
    await table.stop();
  }
});
