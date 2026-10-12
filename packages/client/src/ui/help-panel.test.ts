import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpPanel } from './HelpPanel.js';
import { HELP_SECTIONS, HELP_TOPICS, helpSections, type HelpTopic } from './help-panel.js';

/** Everything a topic says, lowercased, for phrase-level assertions. */
const textOf = (topic: HelpTopic) =>
  HELP_SECTIONS[topic].entries.map((entry) => `${entry.input} ${entry.action}`).join('\n');

describe('UI-HELP-01 help content', () => {
  it('covers the three topics the issue names, in order', () => {
    expect(HELP_TOPICS).toEqual(['moving', 'camera', 'token']);
    expect(helpSections().map((section) => section.title)).toEqual([
      'Moving and measuring',
      'Camera controls',
      'Token interaction',
    ]);
  });

  it('has one section per topic: no missing, no repeated, keys match the ids', () => {
    for (const topic of HELP_TOPICS)
      expect(HELP_TOPICS.filter((other) => other === topic)).toHaveLength(1);
    for (const section of helpSections()) {
      expect(section.id in HELP_SECTIONS).toBe(true);
      expect(HELP_SECTIONS[section.id]).toBe(section);
    }
    // The Record type keys are exactly the topic union, so an unlisted topic is a compile error.
    expect(Object.keys(HELP_SECTIONS).sort()).toEqual([...HELP_TOPICS].sort());
  });

  it('has a non-empty, traceable row per input and no duplicate input in a section', () => {
    for (const section of helpSections()) {
      expect(section.entries.length).toBeGreaterThan(0);
      const inputs = section.entries.map((entry) => entry.input);
      expect(new Set(inputs).size).toBe(inputs.length);
      for (const entry of section.entries) {
        // Boundary: no blank or whitespace-padded copy reaches the panel.
        expect(entry.input.trim()).toBe(entry.input);
        expect(entry.action.trim()).toBe(entry.action);
        expect(entry.input.length).toBeGreaterThan(0);
        expect(entry.action.length).toBeGreaterThan(0);
        // Every row names the UI item it comes from, so the panel stays reviewable.
        expect(entry.action).toMatch(/UI-[A-Z]+-\d+/);
      }
    }
  });

  it('documents the UX-16 input mapping (UIUX §5.3)', () => {
    const moving = textOf('moving').toLowerCase();
    const camera = textOf('camera').toLowerCase();
    const token = textOf('token').toLowerCase();
    // Left button selects and moves and never moves the camera unless Pan is active.
    expect(moving).toContain('without selecting it first');
    expect(moving).toContain('never moves the camera unless the pan tool is active');
    // Wheel zooms; middle drag pans; right drag orbits in 3D.
    expect(camera).toContain('wheel');
    expect(camera).toContain('zoom');
    expect(camera).toContain('middle drag');
    expect(camera).toContain('pans');
    expect(camera).toContain('right drag in 3d');
    expect(camera).toContain('orbits');
    // Middle click on a selected token toggles the flying lock (separated from the drag).
    expect(token).toContain('middle click');
    expect(token).toContain('flying lock');
    // Right click opens the menu / the tool's right-click action.
    expect(token).toContain('right click');
    expect(token).toContain('see sheet');
    // The three token levels survive in the copy (UI-TOKEN-01..03).
    expect(token).toContain('not shared');
  });

  it('states 2D and 3D behaviour separately (AGENTS rule 5)', () => {
    const camera = textOf('camera').toLowerCase();
    expect(camera).toContain('2d');
    expect(camera).toContain('3d');
  });

  it('is static: the same help for a first and a later visit, with no tracking', () => {
    // helpSections() takes no viewer and holds no state, so repeated calls cannot differ and a
    // first-time flag has nowhere to live (UI-HELP-01: no first-sign-in tracking).
    expect(helpSections()).toEqual(helpSections());
    expect(
      helpSections().every((section) => section.entries === HELP_SECTIONS[section.id].entries),
    ).toBe(true);
  });

  it('renders every section, input and action into the panel', () => {
    const markup = renderToStaticMarkup(createElement(HelpPanel));
    for (const section of helpSections()) {
      expect(markup).toContain(section.title);
      for (const entry of section.entries) {
        expect(markup).toContain(entry.input);
      }
    }
    const rows = helpSections().reduce((total, section) => total + section.entries.length, 0);
    expect(markup.match(/<dt>/g)).toHaveLength(rows);
    expect(markup.match(/<dd>/g)).toHaveLength(rows);
  });
});
