import { helpSections } from './help-panel.js';

/**
 * UX-29 / UI-HELP-01: the static Help tab. Plain text, the same for every viewer on every visit:
 * it carries no first-time tooltips and reads no sign-in state. The board's old on-screen mouse
 * hint (`ui-camera-hint`) is gone; this tab is where that mapping lives now.
 */
export function HelpPanel() {
  return (
    <section className="ui-panel ui-help" aria-label="Help">
      <h2>Help</h2>
      {helpSections().map((section) => (
        <div key={section.id} className="ui-help-section">
          <h3>{section.title}</h3>
          <dl className="ui-help-list">
            {section.entries.map((entry) => (
              <div key={`${section.id}-${entry.input}`} className="ui-help-row">
                <dt>{entry.input}</dt>
                <dd>{entry.action}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
