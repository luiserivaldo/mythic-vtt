import { expect, test } from '@playwright/test';
import { encodeQrCode } from '../packages/client/src/net/qr.js';
import { openClient, startTable, type Table, claimSeat } from './harness.js';

/**
 * SES-09: an identity can leave the file system entirely and travel as a QR code. The reader is
 * stubbed (no camera in CI) but everything on the app's side of that boundary is real: the code is
 * drawn from the stored identity, and the payload it carries is installed the way a file is.
 */

type Detector = { detect(): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options?: { formats?: readonly string[] }) => Detector;

interface ReaderScope {
  BarcodeDetector: DetectorCtor | undefined;
  MediaStream: new () => unknown;
}

interface ReaderStub {
  /** Payload the stubbed reader reports, or `null` for a browser without a QR reader. */
  scanned: string | null;
  /** `'grant'` hands back an empty stream, anything else refuses like a blocked prompt. */
  camera: string;
  /** Milliseconds of blank frames before the code is readable, to exercise the polling loop. */
  delayMs?: number;
}

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

function stubReader(input: ReaderStub): void {
  const scope = globalThis as unknown as ReaderScope;
  const scanned = input.scanned;
  const delayMs = input.delayMs ?? 0;
  scope.BarcodeDetector =
    scanned === null
      ? undefined
      : class {
          // Counted from when the reader opens, not from page load: the test clicks in between.
          private readonly opened = Date.now();
          detect(): Promise<{ rawValue: string }[]> {
            if (Date.now() - this.opened < delayMs) return Promise.resolve([]);
            return Promise.resolve([{ rawValue: scanned }]);
          }
        };
  const nav = navigator as unknown as {
    mediaDevices?: { getUserMedia: () => Promise<unknown> };
  };
  if (nav.mediaDevices) {
    nav.mediaDevices.getUserMedia =
      input.camera === 'grant'
        ? () => Promise.resolve(new scope.MediaStream())
        : () => Promise.reject(new Error('camera refused'));
  }
}

/** Reads a drawn QR back: one `M{x} {y}h{h}v{v}h-{h}z` subpath per dark module. */
function modulesFromSvg(path: string, scale: number, quietZone: number): string {
  const cells: string[] = [];
  for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v\d+h-\d+z/g)) {
    const col = Number(match[1]) / scale - quietZone;
    const row = Number(match[2]) / scale - quietZone;
    cells.push(`${String(row)},${String(col)}`);
  }
  return [...new Set(cells)].sort().join(' ');
}

function modulesFromCode(modules: readonly (readonly boolean[])[]): string {
  const cells: string[] = [];
  modules.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cell) cells.push(`${String(rowIndex)},${String(colIndex)}`);
    });
  });
  return [...new Set(cells)].sort().join(' ');
}

test('shows the stored identity as a QR code and transfers it to another browser', async ({
  browser,
}) => {
  const running = table;
  if (!running) throw new Error('table not started');
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  await dm.goto(`${running.clientUrl.replace(/\/$/, '')}/#host=${running.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await dm.getByRole('tab', { name: 'Participants', exact: true }).click();
  await dm.getByPlaceholder('Custom participant name').fill('Wizard');
  await dm.getByRole('button', { name: 'Add custom participant' }).click();

  const source = await openClient(browser, running, 'source', { joinScreen: true });
  await claimSeat(source.page, 'Wizard', 'Alice');
  await expect(source.page.getByRole('dialog')).toHaveCount(0);
  await source.page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await source.page.getByText('Identity backup and transfer', { exact: true }).click();
  await expect(source.page.getByRole('img', { name: 'Identity QR code' })).toHaveCount(0);

  const stored = await source.page.evaluate(() => localStorage.getItem('mythic.identity.v1'));
  const identity = JSON.parse(stored ?? 'null') as { identityId: string; identitySecret: string };
  const payload = JSON.stringify(
    { identityId: identity.identityId, identitySecret: identity.identitySecret },
    null,
    2,
  );
  const requests: string[] = [];
  source.page.on('request', (request) => requests.push(request.url()));

  await source.page.getByRole('button', { name: 'Show QR code' }).click();
  const qr = source.page.getByRole('img', { name: 'Identity QR code' });
  await expect(qr).toBeVisible();
  // Version 7 is 45 modules; four modules of quiet zone at four pixels each.
  expect(await qr.getAttribute('viewBox')).toBe('0 0 212 212');
  const drawn = await qr.locator('path').getAttribute('d');
  const expected = encodeQrCode(payload);
  expect(expected.version).toBe(7);
  expect(modulesFromSvg(drawn ?? '', 4, 4)).toBe(modulesFromCode(expected.modules));

  // The code is drawn in this browser: the secret never leaves it.
  expect(requests.filter((url) => url.includes(identity.identitySecret))).toEqual([]);
  expect(requests.filter((url) => url.includes(identity.identityId))).toEqual([]);
  await source.page.getByRole('button', { name: 'Hide QR code' }).click();
  await expect(source.page.getByRole('img', { name: 'Identity QR code' })).toHaveCount(0);

  const destination = await openClient(browser, running, 'destination', { joinScreen: true });
  await destination.page.addInitScript(stubReader, {
    scanned: payload,
    camera: 'grant',
    delayMs: 1500,
  });
  await destination.page.reload();
  await destination.page.getByText('Identity backup and transfer', { exact: true }).click();
  const before = await destination.page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('mythic.identity.v1') ?? 'null') as { identityId: string })
        .identityId,
  );
  expect(before).not.toBe(identity.identityId);
  await destination.page.getByRole('button', { name: 'Scan an identity QR code' }).click();
  await expect(destination.page.getByLabel('Camera preview')).toBeVisible();
  await expect(
    destination.page.getByRole('button', { name: 'Replace identity and reload' }),
  ).toBeVisible();
  await destination.page.getByRole('button', { name: 'Replace identity and reload' }).click();
  await expect(destination.page.getByLabel('Display name')).toBeVisible();
  expect(await destination.page.evaluate(() => localStorage.getItem('mythic.identity.v1'))).toBe(
    payload,
  );
  await destination.page.getByLabel('Display name').fill('Alice transferred');
  await destination.page.getByRole('button', { name: 'Continue' }).click();
  await expect(destination.page.getByRole('dialog')).toHaveCount(0);
  await expect(destination.page.getByLabel('Current identity')).toContainText('Wizard');
  await expect(destination.page.getByLabel('Current identity')).toContainText('Player');

  await source.context.close();
  await destination.context.close();
  await dmContext.close();
});

test('explains a browser without a reader, a refused camera and a code that is not an identity', async ({
  browser,
}) => {
  const running = table;
  if (!running) throw new Error('table not started');
  const alertFor = async (stub: ReaderStub): Promise<string | null> => {
    const client = await openClient(browser, running, 'reader', { joinScreen: true });
    await client.page.addInitScript(stubReader, stub);
    await client.page.reload();
    await client.page.getByText('Identity backup and transfer', { exact: true }).click();
    await client.page.getByRole('button', { name: 'Scan an identity QR code' }).click();
    const alert = client.page.getByRole('alert');
    await expect(alert).toHaveCount(1);
    const message = await alert.textContent();
    await client.context.close();
    return message;
  };

  expect(await alertFor({ scanned: null, camera: 'grant' })).toBe(
    'This browser cannot scan QR codes. Use the identity file instead.',
  );
  expect(await alertFor({ scanned: 'not a mythic identity', camera: 'grant' })).toBe(
    'This QR code does not contain a Mythic identity.',
  );
  expect(await alertFor({ scanned: '{}', camera: 'deny' })).toBe(
    'The camera could not be started. Allow camera access or use the identity file.',
  );
});
