# Contributing to Mythic VTT

Thanks for helping. This page covers how the project is laid out and how to get a change merged. If you only want to run the program, see the [README](README.md).

> **Contributor terms:** contributions are accepted under the project's licence (AGPL-3.0) and the [Developer Certificate of Origin](DCO). Sign off every commit; see [Signing off your commits](#signing-off-your-commits).

## Setup

You need Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm dev:table      # game host + client dev server for local testing
```

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm dev:table` | Rebuilds the host, then starts host and client   |
| `pnpm build`     | Builds all packages                              |
| `pnpm test`      | Unit tests (Vitest)                              |
| `pnpm test:e2e`  | Multi-client end-to-end tests (Playwright)       |
| `pnpm lint`      | ESLint and Prettier                              |
| `pnpm typecheck` | TypeScript                                       |
| `pnpm check`     | build + lint + typecheck + test. Run before a PR |

## Repository layout

```
packages/shared     pure types, schemas, actions, geometry, migrations
packages/protocol   wire message schemas
packages/host       game host server: engine, gateway, storage, assets
packages/client     browser app: net, store, ui, render, tools
packages/relay      relay for hosted play (stub)
e2e/                Playwright multi-client tests
fixtures/saves/     golden save files used by migration tests
docs/               user guides
```

Dependencies only point one way: `client` and `host` depend on `shared` and `protocol`; `relay` depends on `protocol`. Nothing imports from `client` or `host`.

## Architecture rules

These keep the project correct, so changes that break them will be sent back:

1. **Every state change is an action.** Actions go through one pipeline: validate the schema, check permission, reduce, log, filter per audience, broadcast, then ack or reject. Never change game state anywhere else.
2. **`@mythic/shared` is pure.** No DOM, Three.js, Node APIs, I/O, `Date.now()` or `Math.random()`. Time and randomness arrive on the action.
3. **The host is authoritative** and never sends a client anything that client may not see. Changes that touch state or messages need a test showing hidden information cannot leak.
4. **Everything works in 2D.** 3D adds information and never hides any.
5. **No world-space text.** Labels always face the camera.
6. **Contracts are versioned.** The action envelope, state schema, coordinates, save format and wire protocol need a `schemaVersion` bump, a migration and a golden fixture when they change. Call this out in your PR.
7. **No secrets** in code, tests or fixtures.
8. User-visible distances always go through the scene's units (`unitsPerCell`, `unitLabel`).

## Code conventions

- TypeScript strict. No `any` (use `unknown` and zod). No non-null assertions without a comment.
- Validate every boundary (network, files) with zod.
- One action per file in `packages/shared/src/actions/`. The action registry is an append-only list.
- Tests live next to the code as `*.test.ts`. Pure numeric functions get property tests (fast-check).
- Named exports only. No default exports.
- Comments explain why, not what.
- A new runtime dependency needs a justification in the PR.

## Workflow

1. Open or pick an issue, and say you're working on it.
2. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`). `main` only receives playable releases.
3. Keep PRs small: one change, ideally under about 400 lines.
4. Run `pnpm check`, and `pnpm test:e2e` if you touched sync, permissions or rendering.
5. Open a PR against `develop` and fill in the template.

### Why `pnpm build` comes first

Workspace packages expose their types from `dist/`, so the type-aware lint needs them built. On a fresh clone, `pnpm check` and CI both build first. If you run `pnpm lint` alone on a fresh clone, run `pnpm build` before it.

### Branches, reviews and CI

- **Everyone works on branches and opens pull requests.** Fork the repository, or push a branch if you have write access. Feature branches are free-form; they are deleted automatically when merged.
- **`develop`** is the integration branch, where features are merged and collaborated on. Changes arrive by pull request and must pass the `check` CI job. Reviews are done by the project's reviewer, and they are deliberately lighter here: experimental work is welcome as long as it is stable (CI green, no regressions, nothing half-broken).
- **`main`** only receives playable releases, by pull request from `develop`. It needs the `check` job to pass and a deep review by a maintainer or a high-capability reviewer.
- **Force-pushes and deleting `develop` or `main` are blocked.**
- Paths that define contracts or touch security (`.github/`, `packages/protocol/`, the schema, actions, visibility and migrations folders, the host gateway, and `fixtures/saves/`) list the maintainer as code owner, who will be asked to review.
- CI runs on pull requests from forks with a read-only token and no secrets. The first run from a new contributor needs a maintainer to approve it.

### Automated and AI-assisted contributions

Agents and bots are welcome, and follow the same rules as people:

- Work on a branch and open a pull request. Do not push directly to `develop` or `main`.
- Use a separate, repository-scoped token per host or agent, with the minimum permissions it needs. Never share a maintainer or admin token, and never give a worker the permission to set commit statuses (that is how reviews are recorded).
- Sign off your commits like anyone else. The maintainer who runs the agent is the responsible contributor.
- You are responsible for what your tool submits: review the diff, keep it small and focused, and make sure `pnpm check` passes.
- Do not add credentials, tokens or personal data to the repository, and do not disable CI, linting or tests to get a change through.

### Signing off your commits

Mythic VTT uses the [Developer Certificate of Origin](DCO) (DCO) instead of a contributor agreement. By signing off a commit you certify that you wrote the change or otherwise have the right to submit it under the project's licence. Your contribution stays under AGPL-3.0.

Add a `Signed-off-by` line to every commit, with the same name and email as the commit's author:

```sh
git commit -s -m "fix: describe the change"
```

To sign off commits you have already made on a branch, run `git rebase --signoff origin/develop` and push again. To have git add the line for you, run `git config core.hooksPath .githooks` once in your clone.

A `dco` check runs on every pull request and fails if a commit is not signed off. Merge commits and pull requests opened by bots such as Dependabot are exempt.

### Security and conduct

Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue. Be kind in reviews and issues.
