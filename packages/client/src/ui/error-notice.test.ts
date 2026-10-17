import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../render/canvas-style.js';
import { ErrorNotice } from './ErrorNotice.js';

describe('ErrorNotice', () => {
  it('shows the message as an alert, and no disclosure without details', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { message: 'It broke.' }));
    expect(html).toContain('<p role="alert">It broke.</p>');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Error details');
  });

  it('folds the details under a collapsed "Error details" disclosure', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorNotice, { message: 'It broke.', details: 'Code: unauthorized' }),
    );
    // A real <details> without `open`: collapsed by default, and the browser makes it expandable.
    expect(html).toMatch(/<details class="error-notice-details"><summary>Error details<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('<pre>Code: unauthorized</pre>');
  });

  it('renders the actions slot after the message', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorNotice, { message: 'It broke.' }, createElement('button', null, 'Reload')),
    );
    expect(html.indexOf('It broke.')).toBeLessThan(html.indexOf('<button>Reload</button>'));
  });

  it('keeps the muted details text at WCAG AA on the card in every theme', () => {
    const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
    // Each theme block that sets both tokens: the default, the shell and the light theme.
    const blocks = [...css.matchAll(/\{([^}]*)\}/g)]
      .map(([, body = '']) => ({
        bg: /--ui-bg:\s*(#[0-9a-f]{6})/i.exec(body)?.[1],
        muted: /--ui-muted:\s*(#[0-9a-f]{6})/i.exec(body)?.[1],
      }))
      .filter((b) => b.bg && b.muted);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const { bg, muted } of blocks)
      expect(contrastRatio(muted ?? '', bg ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});
