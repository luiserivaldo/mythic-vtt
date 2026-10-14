import { createInterface } from 'node:readline/promises';
import type { CampaignMeta } from './storage/index.js';

/** One line per campaign, newest first: `  1) Name  (id, last saved 2026-10-12 04:40)`. */
export function formatCampaignList(campaigns: readonly CampaignMeta[]): string[] {
  return campaigns.map((c, i) => {
    const saved = new Date(c.updatedAt).toISOString().slice(0, 16).replace('T', ' ');
    return `  ${String(i + 1)}) ${c.name}  (${c.id}, last saved ${saved} UTC)`;
  });
}

/**
 * HOST-03 start-up picker. Enter takes the first (most recently saved) campaign; an unusable
 * answer asks again, and a closed input falls back to the first rather than hanging the host.
 */
export async function pickCampaignInteractively(
  campaigns: readonly CampaignMeta[],
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<string | undefined> {
  const rl = createInterface({ input, output });
  const input$ = { closed: false };
  rl.once('close', () => {
    input$.closed = true;
  });
  try {
    output.write(`Campaigns on this host:\n${formatCampaignList(campaigns).join('\n')}\n`);
    while (!input$.closed) {
      const answer = (
        await rl.question(`Open which campaign? [1-${String(campaigns.length)}, Enter = 1] `)
      ).trim();
      if (answer === '') return campaigns[0]?.id;
      const picked = campaigns[Number(answer) - 1];
      if (Number.isInteger(Number(answer)) && picked) return picked.id;
      output.write('Enter a number from the list.\n');
    }
    return campaigns[0]?.id;
  } catch {
    return campaigns[0]?.id;
  } finally {
    rl.close();
  }
}
