import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { RawClient, testUlid } from './harness.js';

// UX-05 / UI-HOST-02: campaigns are listed last played first, each with a thumbnail: the DM's
// upload, else a capture of the board taken when the DM signs out. The capture may be shown on
// the public join screen, so it must never contain DM-only content (PERM-03).
//
// Like texture-tiling.spec, the host serves the built client so the upload is same-origin (D36).

const hostDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/host');
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/client/dist/app');
// 1x1 PNG: the smallest valid upload the image pipeline accepts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Running {
  child: ChildProcess;
  hostPort: number;
  hostToken: string;
}

function start(dataDir: string, args: string[]): Promise<Running> {
  const child = spawn(process.execPath, ['dist/main.js', ...args], {
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
      resolve({ child, hostPort: Number(match[1]), hostToken: match[2] ?? '' });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`host exited during startup (${String(code)}): ${output}`));
    });
  });
}

async function stop(running: Running): Promise<void> {
  const { child } = running;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGTERM');
  });
}

/** Strongly magenta and strongly green pixels in an image (data URL or same-origin path). */
function colourCounts(page: Page, src: string): Promise<{ magenta: number; green: number }> {
  // A string expression: the e2e project has no DOM typings, and this runs in the page.
  // Hue, not brightness: inactive layers are drawn in a darker shade (MV-244).
  return page.evaluate<{ magenta: number; green: number }>(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(src)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let magenta = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > g + 80 && b > g + 80) magenta += 1;
      else if (g > r + 50 && g > b + 50) green += 1;
    }
    return { magenta, green };
  })()`);
}

test('the campaign list is last played first and shows the DM thumbnail or a public capture', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-thumbnail-'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let running: Running | undefined;
  const base = () => `http://127.0.0.1:${String(running?.hostPort)}`;
  const openAsDm = async (name: string) => {
    if (!running) throw new Error('host not running');
    await page.goto(`${base()}/#host=${running.hostToken}`);
    await expect(page.getByRole('status')).toHaveText(`Connected to ${name}`);
  };
  const identity = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
  const auth = async () => {
    const { identityId, identitySecret } = await identity();
    return { authorization: `Mythic ${identityId}.${identitySecret}` };
  };
  const list = async () => {
    const response = await fetch(`${base()}/api/campaigns`, { headers: await auth() });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      current: string;
      campaigns: { id: string; name: string; lastPlayedAt?: number; thumbnail?: string }[];
    };
  };
  const listCampaigns = () =>
    spawnSync(process.execPath, ['dist/main.js', '--list-campaigns'], {
      cwd: hostDir,
      env: { ...process.env, MYTHIC_DATA_DIR: dataDir },
      encoding: 'utf8',
    }).stdout;

  try {
    // Alpha: a DM-layer secret (magenta) and a public hero (green) on its active scene.
    running = await start(dataDir, ['--new-campaign', 'Alpha']);
    await openAsDm('Alpha');
    const setup = await RawClient.connect(running, { name: 'setup', ...(await identity()) });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const { id: alphaId, activeSceneId: sceneId } = setup.state as {
      id: string;
      activeSceneId: string;
    };
    for (const [n, layer, name, color, x] of [
      [1, 'dm', 'Secret lich', '#ff00ff', 12],
      [2, 'tokens', 'Hero', '#00ff00', 28],
    ] as const) {
      expect(
        await setup.intent('entity.create', {
          sceneId,
          entity: {
            id: testUlid('TOKEN', n),
            layer,
            name,
            owners: [],
            transform: {
              position: { x, y: 0, z: 15 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            token: { sizeCells: 6, heightCells: 1, labelVisibility: 'all', color },
          },
        }),
      ).toMatchObject({ t: 'ack' });
    }
    await setup.close();
    await stop(running);

    // Beta is played after Alpha, so it leads the list.
    running = await start(dataDir, ['--new-campaign', 'Beta']);
    await openAsDm('Beta');
    await stop(running);
    const before = listCampaigns();
    expect(before.indexOf('Beta')).toBeLessThan(before.indexOf('Alpha'));
    expect(before).not.toContain('thumbnail');

    // Playing Alpha again puts it first.
    running = await start(dataDir, ['--campaign', 'Alpha']);
    await openAsDm('Alpha');
    expect((await list()).campaigns.map((c) => c.name)).toEqual(['Alpha', 'Beta']);

    // The DM uploads a thumbnail.
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Upload thumbnail').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const shown = page.getByRole('img', { name: 'Campaign thumbnail' });
    await expect(shown).toHaveAttribute('src', /^\/assets\/[0-9a-f]{64}$/);
    const uploaded = ((await shown.getAttribute('src')) ?? '').slice('/assets/'.length);
    const listed = await list();
    expect(listed.current).toBe(alphaId);
    expect(listed.campaigns[0]).toMatchObject({ id: alphaId, thumbnail: uploaded });
    expect(listed.campaigns[1]).not.toHaveProperty('thumbnail');
    const served = await fetch(`${base()}/api/campaigns/${alphaId}/thumbnail`, {
      headers: await auth(),
    });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(
      (
        (await (await fetch(`${base()}/api/join`)).json()) as {
          campaign: { screenshot?: string };
        }
      ).campaign.screenshot,
    ).toBe(uploaded);

    // The DM's own board shows the secret; the sign-out capture must not.
    const dmView = await page.locator('.ui-board canvas').screenshot();
    const dmColours = await colourCounts(
      page,
      `data:image/png;base64,${dmView.toString('base64')}`,
    );
    expect(dmColours.magenta).toBeGreaterThan(0);
    expect(dmColours.green).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Signed out' })).toBeVisible();

    const watcher = await RawClient.connect(running, { name: 'watcher', ...(await identity()) });
    await watcher.waitFor(
      'auto screenshot',
      () =>
        (watcher.state as { autoScreenshot?: string } | undefined)?.autoScreenshot !== undefined,
    );
    const auto = (watcher.state as { autoScreenshot: string }).autoScreenshot;
    await watcher.close();
    expect(auto).not.toBe(uploaded);
    const captured = await colourCounts(page, `/assets/${auto}`);
    expect(captured.green).toBeGreaterThan(0);
    expect(captured.magenta).toBe(0);
    // The DM's upload still wins.
    expect((await list()).campaigns[0]?.thumbnail).toBe(uploaded);

    // Signing back in and removing the upload falls back to the capture everywhere.
    await page.getByRole('button', { name: 'Sign back in' }).click();
    await expect(page.getByRole('status')).toHaveText('Connected to Alpha');
    // The Settings tab is still the open one.
    await page.getByRole('button', { name: 'Remove uploaded thumbnail' }).click();
    await expect(shown).toHaveAttribute('src', `/assets/${auto}`);
    expect((await list()).campaigns[0]?.thumbnail).toBe(auto);
    expect(
      (
        (await (await fetch(`${base()}/api/join`)).json()) as {
          campaign: { screenshot?: string };
        }
      ).campaign.screenshot,
    ).toBe(auto);
    // A first-time visitor sees the public capture on the join screen (UI-JOIN-01).
    const visitor = await browser.newContext();
    try {
      const join = await visitor.newPage();
      await join.goto(base());
      await expect(join.getByRole('img', { name: 'Campaign screenshot' })).toHaveAttribute(
        'src',
        `/assets/${auto}`,
      );
    } finally {
      await visitor.close();
    }
    await stop(running);
    running = undefined;

    // The start-up picker agrees: Alpha first, with its thumbnail.
    const after = listCampaigns();
    expect(after.indexOf('Alpha')).toBeLessThan(after.indexOf('Beta'));
    expect(after).toMatch(/Alpha {2}\(\w+, last played [\d-]+ [\d:]+ UTC, thumbnail\)/);
  } finally {
    await context.close();
    if (running) await stop(running);
    await rm(dataDir, { recursive: true, force: true });
  }
});
