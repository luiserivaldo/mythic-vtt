import {
  CHAT_COMING_SOON,
  CHAT_EMPTY_STATE,
  CHAT_LOG_ICON,
  CHAT_LOG_TEXT,
  rollColor,
  rollTextColor,
  type ChatEntry,
  type SeatColors,
} from './chat-panel.js';

interface Props {
  /** Chat and roll entries, oldest first. Empty until M4-22/M4-23 feed the feed. */
  entries: readonly ChatEntry[];
  /** Seat colours this viewer knows (presence); players see the neutral fallback. */
  seatColors?: SeatColors | undefined;
}

/**
 * UI-CHAT-01: the message list with rolls colour-coded to the roller's seat colour. The composer
 * stays disabled until chat and dice behaviour land (M4-22/M4-23); no dice hotkey chips.
 */
export function ChatPanel({ entries, seatColors }: Props) {
  return (
    <section className="ui-panel ui-chat" aria-label="Chat">
      <div role="log" aria-label="Chat messages" className="ui-chat-log">
        {entries.length === 0 ? (
          <p className="ui-chat-empty">{CHAT_EMPTY_STATE}</p>
        ) : (
          <ul className="ui-chat-rows">
            {entries.map((entry) => {
              const color = entry.kind === 'roll' ? rollColor(entry, seatColors) : undefined;
              return (
                <li
                  key={entry.id}
                  className={`ui-chat-row ui-chat-${entry.kind}`}
                  style={
                    color === undefined
                      ? undefined
                      : { background: color, color: rollTextColor(color) }
                  }
                >
                  <strong>{entry.author}</strong> <span>{entry.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="ui-chat-note">{CHAT_COMING_SOON}</p>
      {/* UI-CHAT-02: the game-log view arrives with the variable API; until then the toggle is inert. */}
      <button
        type="button"
        className="ui-chat-log-toggle"
        aria-label="Game log (work in progress)"
        title="Game log: work in progress"
        disabled
      >
        <span aria-hidden="true">{CHAT_LOG_ICON}</span> {CHAT_LOG_TEXT}
      </button>
      <div className="ui-chat-composer">
        <input type="text" aria-label="Message" placeholder="Chat unlocks later" disabled />
        <button type="button" disabled>
          Send
        </button>
      </div>
    </section>
  );
}
