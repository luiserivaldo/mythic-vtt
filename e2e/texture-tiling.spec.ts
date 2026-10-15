import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createProp } from './create-prop.js';

// M4-32 (ENV-05): a prop takes an uploaded image texture. The image tiles once per cell over the
// 2D footprint and the 3D mesh, and the DM sets, replaces or clears it from the Entities panel
// (Create Prop has no texture field in the alpha, UX-39).
//
// This spec starts its own host with the built client (MYTHIC_CLIENT_DIR) instead of the usual Vite
// dev server: the dev proxy rewrites the Host header for /assets, so a browser upload there is
// refused as cross-origin (D36). Same-origin, the upload path is exercised end to end.

// 1x1 PNG: the smallest valid upload the image pipeline accepts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const HASH_URL = /\/assets\/[0-9a-f]{64}$/;
const hostDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/host');
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/client/dist/app');

interface Host {
  child: ChildProcess;
  port: number;
  token: string;
  dataDir: string;
}

async function startHost(): Promise<Host> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-texture-'));
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: hostDir,
    env: {
      ...process.env,
      MYTHIC_PORT: '0',
      MYTHIC_DATA_DIR: dataDir,
      MYTHIC_CLIENT_DIR: clientDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`host startup timed out: ${output}`));
    }, 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on [^\s:]+:(\d+)[\s\S]*DM link: \S+#host=([\w-]+)/.exec(output);
      if (!match) return;
      clearTimeout(timer);
      resolve({
        child,
        port: Number(match[1]),
        token: match[2] ?? '',
        dataDir,
      });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`host exited during startup (${String(code)}): ${output}`));
    });
  });
}

async function stopHost(host: Host): Promise<void> {
  if (host.child.exitCode === null && host.child.signalCode === null) {
    await new Promise<void>((resolve) => {
      host.child.once('exit', () => {
        resolve();
      });
      host.child.kill('SIGTERM');
    });
  }
  await rm(host.dataDir, { recursive: true, force: true });
}

let host: Host | undefined;

test.beforeAll(async () => {
  host = await startHost();
});

test.afterAll(async () => {
  if (host) await stopHost(host);
});

test('a prop carries an uploaded texture in 2D and 3D and the DM can replace or clear it', async ({
  browser,
}) => {
  if (!host) throw new Error('host not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://127.0.0.1:${String(host.port)}/#host=${host.token}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Vault');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  const propForm = await createProp(page, {
    name: 'Stone platform',
    width: 2,
    depth: 3,
    walkable: true,
  });
  await expect(propForm.locator('input[type="file"]')).toHaveCount(0);
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await expect(list.getByRole('button', { name: 'Stone platform', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const row = page.getByRole('group', { name: /^Texture for Stone platform/ });
  await expect(row.locator('.ui-file-button')).toHaveText('Set texture');

  // The upload is stored content-addressed, then the renderer fetches it for the prop.
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/assets/images') && r.request().method() === 'POST',
  );
  const fetched = page.waitForResponse(
    (r) => HASH_URL.test(new URL(r.url()).pathname) && r.status() === 200,
  );
  await row
    .locator('input[type="file"]')
    .setInputFiles({ name: 'stone.png', mimeType: 'image/png', buffer: PNG });
  expect((await uploaded).status()).toBe(201);
  expect((await fetched).status()).toBe(200);
  await expect(row.locator('.ui-file-button')).toHaveText('Replace texture');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);

  // 3D draws the same primitive as a mesh, still with no page error.
  const threeD = page.getByRole('button', { name: '3D view' });
  await threeD.click();
  await expect(threeD).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: '2D view' }).click();
  await expect(threeD).toHaveAttribute('aria-pressed', 'false');

  // The selected prop's row clears its texture, then takes another image.
  await expect(row).toBeVisible();
  await expect(row.locator('.ui-file-button')).toHaveText('Replace texture');
  await page.getByRole('button', { name: 'Remove texture from Stone platform' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove texture from Stone platform' }),
  ).toHaveCount(0);
  await expect(row.locator('.ui-file-button')).toHaveText('Set texture');
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);

  // Re-picking the same bytes deduplicates to the stored image (200, not 201).
  const reuploaded = page.waitForResponse(
    (r) => r.url().includes('/assets/images') && r.request().method() === 'POST',
  );
  await row
    .locator('input[type="file"]')
    .setInputFiles({ name: 'stone.png', mimeType: 'image/png', buffer: PNG });
  expect((await reuploaded).status()).toBe(200);
  await expect(row.locator('.ui-file-button')).toHaveText('Replace texture');

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await context.close();
});
