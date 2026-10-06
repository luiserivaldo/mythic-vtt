# Orchestration hand-off

Snapshot taken 2026-10-06 ~14:10 WIB. `develop` is at the commit that adds this file; the last verified state
was 641 unit tests and 14 e2e tests passing. Usage limits paused work: Claude resets in about 2 hours, Codex at
3:50 PM. Hermes is out of scope until its Ollama issues are debugged.

## Progress: 36 of 70 MVP tasks done

| Milestone  | Done                                              | Remaining                                    |
| ---------- | ------------------------------------------------- | -------------------------------------------- |
| M0 (12/14) | 01-10, 12, 13                                     | M0-11 autosave and recovery, M0-14 exit test |
| M1 (18/25) | 01, 02, 03, 05, 06, 08, 09, 10, 12-17, 19, 22, 23 | 04, 07, 11, 18, 20 (in flight), 21, 24, 25   |
| M2 (5/11)  | 02, 03, 04, 06, 09                                | 01, 05, 07, 08, 10, 11                       |
| M3 (1/8)   | 02                                                | 01, 03-08                                    |

(An earlier status message overstated this as 41. This count comes from listing each merged task.)

## In flight when work paused

Nothing. Every Claude subagent finished and was merged (D36 HTTP auth and M1-20 gizmo were the last two).
D36 is now in `develop`, so uploads work for the host and co-DM and the host-only export and import routes exist.

## Codex work waiting for its reset (3:50 PM)

Uncommitted partial work sits in these worktrees. Resume each with a new `codex exec` that tells the agent to continue from the worktree state, read `git status` and `git diff`, finish, then run the checks.

| Task                              | Model         | Worktree              | State                |
| --------------------------------- | ------------- | --------------------- | -------------------- |
| M0-11 autosave and crash recovery | `gpt-6-sol`   | `m0-11-recovery`      | partial, uncommitted |
| M3-01 AoE schema and actions      | `gpt-5.6-sol` | `m3-01-aoe-actions`   | partial, uncommitted |
| M1-04 token actions               | `gpt-5.6-sol` | `m1-04-token-actions` | partial, uncommitted |

Worktrees all live in `../mythic-vtt-worktrees/<name>`. Launch pattern used so far:

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -s workspace-write \
  --add-dir <repo>/.git -C <worktree> "<brief>"
```

Model slugs: `gpt-6-sol` for higher-risk work, `gpt-5.6-sol` for regular tasks. Codex stopped twice for
reasons worth remembering: missing docs in a fresh worktree (see "Worktree setup") and the usage limit.

## Ready next (Needs all merged)

- Resume Codex: M0-11, M1-04, M3-01.
- M1-07 presence and ephemeral relay (engine area, so do it after M0-11 lands).
- M1-11 join screen. It needs a host-visible list of unseated identities for `seat.assign`.
- M2-05 2D/3D toggle. M2-07 drop lines and shadows. M3-07 grid on elevated surfaces.
- After M1-04: M1-18 token drag, M2-01 elevation action. After M3-01: M3-03 and M3-04.
- After M0-11: M0-14 exit test. M1-24 load test and M1-25 playtest come last.

## Decisions

Recorded in `TECHNICAL.md` §20 (a local, gitignored file): D19-D35. Accepted by the user: D23 (props host-only),
D24 (host authority), D25 (elevation snaps by default), D26 (AoE centre inclusion), D27 (AGPL-3.0 + DCO),
D32 (co-DM sees DM layer read-only), D33 (host rebind on a fresh token), D34 (server order wins), D35 (names
withheld from audiences that may not see them). D29 is partly superseded by D33.

Proposed decisions from agent reports that are **not** yet in the decision log (each agent's final message has the text):

- M2-02 primitive sizing and 2D footprint rules; M2-06 standee proportions; M2-09 `environment.zenith`.
- D36 HTTP auth scheme and rate limits; M1-20 gizmo snapping rules (rotate 15 degrees, whole-unit scale when `grid.snap`);
  M1-19 map-image maths; M2-04 default 3D view and the temporary `?camera=3d` flag.
- M2-03 surface-height step rules (`maxStepUp` default 0.5 cells, dome sphere profile).
- M1-10 `assetsDir: static`; M1-09 archive layout, conflict policy and identity scrubbing.

## Open questions for the user

1. Per-seat "DM-layer write" grant: needs a `SeatPermissions` schema change. Today a co-DM can only be granted
   write access per entity.
2. Should the internet-play guide keep recommending Tailscale Funnel (it contradicts the fleet's own rule)?
3. A snapshot `role` flag (`host | seat | spectator`) would replace the client's `localStorage` host hint. It is
   an additive protocol change.
4. Free-control tables (everyone admin) under server-order-wins: explore in the M1-24 load test.
5. `pin.text` and `token.image` are sent to every audience that can see an entity. Only names are label-gated.

## Worktree setup (gotchas)

- `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `TECHNICAL.md`, `TASKS.md` and `.claude/` are gitignored. A fresh worktree
  has none of them, so symlink them from the main checkout. `.claude` is excluded through `.git/info/exclude`.
- Run `pnpm install --frozen-lockfile` and `pnpm build` in a new worktree. `pnpm check` needs the built protocol.
- Merge conflicts so far are almost always `pnpm-lock.yaml` (take develop's, then `pnpm install --no-frozen-lockfile`)
  and the shared render files (`BoardCanvas.tsx`, `PickableEntities.tsx`, `scene-model.ts`).

## Verification gate for every merge

1. Merge `develop` into the feature branch first and resolve conflicts there. Never merge a conflicted branch into
   `develop`. If a merge conflicts, abort it.
2. `pnpm build`, `pnpm check` and `pnpm test:e2e` all pass. The e2e suite is the real gate for client changes:
   M1-16 once passed every unit test and still blanked the client at runtime, because a store selector returned a
   fresh object on each call. Always use stable fallbacks in selectors.
3. Merge with `--no-ff` into `develop` and re-run the same checks.

## Known gaps and risks

- Almost nothing has been checked by eye in a browser. Rendering, gestures, pan/zoom feel, gizmos and the 3D view
  rest on unit tests and "mounts without errors" e2e checks. A manual playtest is needed before M1-25.
- D36 (merged) authenticates uploads with `Authorization: Mythic <identityId>.<secret>`. Failed-auth throttling is per IP,
  so one NAT'd table shares a budget, and export does not flush a live room first. Still unverified with a real image.
- `log.jsonl` lines carry no `schemaVersion` (§8.3 says every JSON root should).
- There is no campaign or session id on the wire. `lastSeq` alone could match the wrong campaign if a client switches
  campaigns on one host. Adding one would be a protocol change.
- The engine rate-limits nothing yet (§18).
