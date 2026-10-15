import { expect, type Locator, type Page } from '@playwright/test';

export interface PropOptions {
  shape?: string;
  name?: string;
  width?: number;
  height?: number;
  depth?: number;
  walkable?: boolean;
  layer?: string;
}

/** UI-TOOL-04: the Create Prop quick settings, in the left pane beside the rail. */
export function createPropForm(page: Page): Locator {
  return page
    .getByRole('complementary', { name: 'Left pane' })
    .getByRole('form', { name: 'Create prop' });
}

/**
 * UI-TOOL-04: picks Create Prop on the rail (unless its panel is already open), applies the given
 * quick settings over the defaults, then clicks the shape icon (Box by default), which creates the
 * prop at once (MV-266). It lands selected, on the cell centre in the middle of the view.
 */
export async function createProp(page: Page, options: PropOptions = {}): Promise<Locator> {
  const form = createPropForm(page);
  if ((await form.count()) === 0)
    await page
      .getByRole('toolbar', { name: 'Board controls' })
      .getByRole('button', { name: 'Create Prop', exact: true })
      .click();
  await expect(form).toBeVisible();
  if (options.name !== undefined) await form.getByLabel('Prop name').fill(options.name);
  if (options.width !== undefined)
    await form.getByLabel('Width (cells)').fill(String(options.width));
  if (options.height !== undefined)
    await form.getByLabel('Height (cells)').fill(String(options.height));
  if (options.depth !== undefined)
    await form.getByLabel('Depth (cells)').fill(String(options.depth));
  if (options.walkable !== undefined)
    await form.getByLabel('Collidable (walkable)').setChecked(options.walkable);
  if (options.layer) await form.getByLabel('Layer').selectOption(options.layer);
  await form.getByRole('button', { name: options.shape ?? 'Box', exact: true }).click();
  return form;
}

/** Moves the selected entity through the 2D Transform panel's typed fields (scene units). */
export async function moveSelectedTo(page: Page, x: number, z: number): Promise<void> {
  // MV-239: a new selection starts with Transform collapsed to its chip; open it if so.
  const chip = page.getByRole('button', { name: 'Restore Transform panel' });
  if ((await chip.count()) > 0) await chip.click();
  const xField = page.getByLabel(/^X \(/);
  const zField = page.getByLabel(/^Z \(/);
  await xField.fill(String(x));
  await zField.fill(String(z));
  await zField.press('Enter');
  // Escape drops any typed draft, so the fields show the stored transform once it has landed.
  await expect(async () => {
    await zField.press('Escape');
    await expect(xField).toHaveValue(String(x), { timeout: 500 });
    await expect(zField).toHaveValue(String(z), { timeout: 500 });
  }).toPass();
}
