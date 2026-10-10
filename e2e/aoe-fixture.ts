import { expect } from '@playwright/test';
import { RawClient, testUlid, type Table } from './harness.js';

/** Each measuring AoE belongs to its placing identity (M3-14); co-DMs can place on effects. */
export async function connectAoEPlacer(
  table: Table,
  host: RawClient,
  identityId: string,
  index: number,
): Promise<RawClient> {
  const seatId = testUlid('AOESEAT', index);
  expect(
    await host.intent('seat.create', { seatId, label: `AoE ${String(index)}`, role: 'codm' }),
  ).toMatchObject({ t: 'ack' });
  expect(await host.intent('seat.assign', { seatId, identityId })).toMatchObject({ t: 'ack' });
  const client = await RawClient.connect(table, {
    name: `aoe-placer-${String(index)}`,
    identityId,
    identitySecret: `synthetic-aoe-secret-${String(index)}`,
  });
  await client.waitFor('co-DM snapshot', () => client.state !== undefined);
  return client;
}
