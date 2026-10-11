# Chat and dice message contract (M4-20 / ACT-01, ACT-02)

`chat.post` is a logged campaign action. Its strict intent payload is
`{ audience, text }`, where text is trimmed plain text, 1–4000 characters. Renderers must
render text as text, never HTML. No client may supply IDs, authors, timestamps, results or randomness.

Audience is `{ kind: "public" }`, `{ kind: "whisper", seatId }`, or `{ kind: "dm" }`.
Host and seated viewers can post; unseated spectators, unknown seats, view-disabled seats and mods
cannot. Whisper targets must exist. No scene is required: chat belongs to the campaign.

| Destination | Readers                                           |
| ----------- | ------------------------------------------------- |
| public      | Host, seats with view enabled, spectators         |
| whisper     | Sending seat, recipient seat, host                |
| dm          | Sending seat, host, co-DM seats with view enabled |

The host holds the complete campaign archive, including whispers. Co-DMs do not gain access to
other seats' whispers. A seat receives its history when occupied by a replacement identity;
this is explicitly seat-addressed chat. Role/view changes are applied to the current snapshot,
including history. Demotion or loss of view permission forces a new filtered snapshot on reconnect.
Already delivered text cannot be retracted from a client's memory.

`Campaign.chat?` is oldest-first recent scrollback, capped at 1000 messages. Absent means empty.
Every message carries host-assigned `id`, `sessionId`, `seq`, `ts`, `author`, `audience`, and `kind`.
The author is `{ kind: "host", label: "DM" }` or `{ kind: "seat", seatId, label }` using the
seat label captured at posting (at most 200 characters). No identity credentials are exposed.
Text messages add `text`; roll messages add `result`. IDs match the action envelope; ordering
uses `seq`. The append reducer evicts the oldest scrollback entries; the full action log retains them.
No edit/delete action or client pagination is introduced here.

## Host roll output

`dice.record` is an internal logged action. **All client intents of that type are forbidden,
including from the host browser.** The trusted server evaluator calls
`engine.recordRoll(actor, { audience, result }, rng)`. It rechecks the sender/destination,
validates the result and proof, appends the log, then publishes the ordinary filtered patches.
Failed validation or a failed log append publishes nothing and consumes no sequence number.

`result` is `{ notation, dice, modifier, total }`. Notation is 1–200 characters; `dice` holds
1–1000 draws, each `{ sides, value, kept, sign }`. Sides are 2–1,000,000; values are 1–sides;
`sign` is +1 or -1. Include dropped dice and each explosion draw in draw order. `modifier` is an
integer in ±1,000,000. The total must equal the modifier plus signed kept values.

The log's envelope `rng` contains one finite draw in [0,1) per die. Both recording and replay
verify `value === floor(rng[i] * sides) + 1`. The host evaluator owns notation interpretation,
keep/drop choices and explosion termination; arithmetic proof does not prove that a host is honest
or independently reparse notation. M4-21 supplies the pure parser/evaluator; M4-23 supplies the
host RNG integration and player `dice.roll` intent. This task provides their result/logging boundary,
not a second parser or a playable dice UI.

## Visibility, persistence and versions

Messages use the existing intent/snapshot/patch/ack protocol (D22); no unfiltered event broadcast
or raw action envelope is sent to clients. `visibleTo` removes unreadable messages entirely;
`patchesFor` uses its default-deny filtered diff for `chat`, including array trimming. Empty patches
retain global sequence continuity. The privileged local log/export retains all results and RNG proof.

Save schema **4** adds optional `Campaign.chat`; migration 3→4 preserves data and advances nested
snapshot campaign versions. Fixtures v1–v3 remain, and v4 adds text/roll scrollback and a roll log.
Protocol **4** requires matching clients to prevent older schema parsers silently dropping chat.
The action envelope and coordinates are unchanged. Client UI consumers use the shared exported
`ChatPost`, `ChatAudience`, `ChatMessage` and `RollResult` schemas; protocol remains independent of shared.
