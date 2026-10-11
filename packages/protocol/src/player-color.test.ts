import { expect, it } from 'vitest';
import { Hello, PlayerColor, RulerPreview } from './messages.js';

it('allows bounded hex colours and rejects invalid profile/preview colours at the wire boundary', () => {
  for (const color of ['#123abc', '#ABCDEF'])
    expect(PlayerColor.safeParse(color).success).toBe(true);
  for (const color of ['red', '#abc', '#1234567', 'url(secret)', 123])
    expect(PlayerColor.safeParse(color).success).toBe(false);
  const hello = {
    t: 'hello',
    v: 4,
    identityId: '0'.repeat(26),
    identitySecret: 'fixture',
    displayName: 'Guest',
  };
  expect(Hello.safeParse(hello).success).toBe(true);
  expect(Hello.safeParse({ ...hello, color: '#123456' }).success).toBe(true);
  expect(Hello.safeParse({ ...hello, color: 'bad' }).success).toBe(false);
  const preview = {
    t: 'ephemeral',
    channel: 'ruler.preview',
    data: { sceneId: '0'.repeat(26), points: [], phase: 'cancelled', color: 'bad' },
  };
  expect(RulerPreview.safeParse(preview).success).toBe(false);
});
