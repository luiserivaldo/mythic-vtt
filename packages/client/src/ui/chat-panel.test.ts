import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { contrastRatio, LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from '../render/canvas-style.js';
import { ChatPanel } from './ChatPanel.js';
import {
  CHAT_COMING_SOON,
  CHAT_EMPTY_STATE,
  NEUTRAL_ROLL_COLOR,
  rollColor,
  rollTextColor,
  seatColorsOf,
  type ChatEntry,
} from './chat-panel.js';

// The dock backgrounds the shell sets for each theme (shell.css: `.ui-app` and `[data-theme=light]`).
const THEME_BACKGROUNDS = ['#17212b', '#f4f8fc'];

const SEAT = 'seat-aria';

const roll = (over: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 'entry-1',
  kind: 'roll',
  author: 'Aria',
  text: '1d20 + 3 = 17',
  seatId: SEAT,
  ...over,
});

const render = (entries: ChatEntry[], seatColors?: Record<string, string | undefined>): string =>
  renderToStaticMarkup(
    (seatColors === undefined
      ? createElement(ChatPanel, { entries })
      : createElement(ChatPanel, { entries, seatColors })) as ReactElement,
  );

it('resolves a roll colour from the roller, the seat, or the neutral fallback', () => {
  expect(rollColor(roll({ color: '#C04E32' }), { [SEAT]: '#4f86c6' })).toBe('#C04E32');
  expect(rollColor(roll(), { [SEAT]: '#4f86c6' })).toBe('#4f86c6');
  expect(rollColor(roll({ color: 'red' }), { [SEAT]: '#4f86c6' })).toBe('#4f86c6');
  // An unknown or archived seat has no colour this viewer knows: neutral, never a broken value.
  expect(rollColor(roll({ seatId: 'archived-seat' }), { [SEAT]: '#4f86c6' })).toBe(
    NEUTRAL_ROLL_COLOR,
  );
  expect(rollColor(roll(), {})).toBe(NEUTRAL_ROLL_COLOR);
  expect(rollColor({})).toBe(NEUTRAL_ROLL_COLOR);
  expect(rollColor(roll(), { [SEAT]: 'not-a-colour' })).toBe(NEUTRAL_ROLL_COLOR);
});

it('picks a roll text colour that reads on the seat colour in both themes', () => {
  for (const color of [NEUTRAL_ROLL_COLOR, '#4f86c6', '#f4f8fc', '#0b1118', '#c04e32']) {
    const chosen = rollTextColor(color);
    const other = chosen === LABEL_TEXT_COLOR ? LABEL_BACKGROUND_COLOR : LABEL_TEXT_COLOR;
    const best = contrastRatio(chosen, color) ?? 0;
    expect([LABEL_TEXT_COLOR, LABEL_BACKGROUND_COLOR]).toContain(chosen);
    expect(best).toBeGreaterThanOrEqual(contrastRatio(other, color) ?? 0);
  }
  expect(rollTextColor('#f4f8fc')).toBe(LABEL_BACKGROUND_COLOR);
  expect(rollTextColor('#0b1118')).toBe(LABEL_TEXT_COLOR);
  for (const background of THEME_BACKGROUNDS)
    expect(contrastRatio(NEUTRAL_ROLL_COLOR, background) ?? 0).toBeGreaterThanOrEqual(3);
});

it('maps seat colours for the seats this viewer knows, ignoring the rest', () => {
  expect(seatColorsOf([{ seatId: SEAT, color: '#4f86c6' }, { seatId: 'silent' }])).toEqual({
    [SEAT]: '#4f86c6',
    silent: undefined,
  });
  expect(seatColorsOf(null)).toEqual({});
  expect(seatColorsOf(undefined)).toEqual({});
});

it('renders the empty state, a disabled composer and the coming-soon note', () => {
  const html = render([]);
  expect(html).toContain('role="log"');
  expect(html).toContain('aria-label="Chat messages"');
  expect(html).toContain(CHAT_EMPTY_STATE);
  expect(html).toMatch(/<input[^>]*aria-label="Message"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/);
  expect(html).toContain(CHAT_COMING_SOON);
});

it('offers a greyed game-log toggle above the composer, and no requirement IDs in view', () => {
  const html = render([]);
  const toggle = /<button[^>]*ui-chat-log-toggle[^>]*>.*?<\/button>/.exec(html)?.[0] ?? '';
  expect(toggle).not.toBe('');
  expect(toggle).toContain('disabled=""');
  expect(toggle).toContain('aria-label="Game log (work in progress)"');
  expect(toggle).toContain('title="Game log: work in progress"');
  // The icon is decoration: the WIP text is what a sighted viewer reads, the label names the button.
  expect(toggle).toContain('aria-hidden="true"');
  expect(toggle).toMatch(/>\s*WIP\s*<\/button>/);
  expect(html.indexOf('ui-chat-log-toggle')).toBeLessThan(html.indexOf('ui-chat-composer'));
  expect(html).not.toMatch(/UI-CHAT-02|UX-35|HIST|§10/);
});

it('colours a roll row with the roller seat colour, giving it props', () => {
  const html = render([roll()], { [SEAT]: '#c04e32' });
  expect(html).not.toContain(CHAT_EMPTY_STATE);
  expect(html).toContain('1d20 + 3 = 17');
  expect(html).toContain('background:#c04e32');
  // The roller's colour is light, so the row text flips to the light label colour to stay readable.
  expect(contrastRatio(LABEL_TEXT_COLOR, '#c04e32') ?? 0).toBeGreaterThanOrEqual(4.5);
  expect(html).toContain(`color:${LABEL_TEXT_COLOR}`);
  expect(render([roll({ seatId: 'archived-seat' })], { [SEAT]: '#c04e32' })).toContain(
    `background:${NEUTRAL_ROLL_COLOR}`,
  );
});
