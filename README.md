# Mythic VTT

**The 2D virtual tabletop you already know, with a 3D button that makes height real.**

Mythic VTT is a lightweight, open-source, browser-based virtual tabletop for TTRPGs. Players join with a link, no install or account. It plays like a normal 2D VTT, and switches to 3D at any moment to show and measure flying creatures, cliffs, multi-level dungeons and area effects accurately.

Built by **MythicTomes**. Self-hosting is free and fully featured; optional hosted services (Mythic Cloud) fund development.

> **Status:** pre-alpha. The core table works, but it has had little real-world play so far. Expect rough edges and breaking changes to saved campaigns. A playable alpha release is the next milestone.

---

## Features

- **Join by link.** Players enter a name and sit down. No accounts, no installs.
- **Seats and permissions.** One DM and up to 10 players, with per-token control over who can move what.
- **Grid and measuring.** Square grid, custom units, diagonal rules, and a ruler that reports horizontal, vertical and total distance.
- **Battlemaps.** Upload an image, calibrate it to the grid and place tokens.
- **Layers and secrets.** Map, token and DM-only layers. Hidden information is never sent to players.
- **Safe by default.** Every change is recorded: autosave, crash recovery and JSON export.
- **2D ↔ 3D in one click.** Elevation, platforms, primitive shapes, drop lines and a clamped camera. Everything works in 2D too; 3D only adds information.
- **Area templates.** Sphere, cylinder, cone, cube and line.

## Running a game

Mythic VTT runs as a small server on your own computer. You start it, share the link, and your players join from their browsers. You need [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/).

```sh
pnpm install && pnpm build                 # once, and again after updating
node packages/host/dist/main.js --lan      # start the table
```

The command prints two things:

- the **address players open** in their browser, and
- your **DM link** (it contains `#host=…`). Open it once; that browser becomes the host. Restart the server for a fresh link.

By default the server only listens on the computer it runs on. `--lan` lets players on the same Wi-Fi join, using the address it prints, for example `http://192.168.1.5:8787`.

### Playing over the internet

See the **[Internet Play Guide](docs/internet-play.md)** for tunnels (recommended), port forwarding and VPS options. This is a pre-alpha build, so avoid leaving it exposed to the internet longer than a session.

### Your campaign data

Campaigns are saved automatically in the data directory (set with `--data-dir`). The server checkpoints regularly and on a clean shutdown, and replays its action log after a crash. Log writes are synced to disk every 500 ms, so a sudden power loss can lose up to half a second of recent actions. Stop the server normally when you can, and keep backups of the data directory.

### Configuration

| Setting                     | Flag         | Env var                   | Config file key |
| --------------------------- | ------------ | ------------------------- | --------------- |
| Port (default 8787)         | `--port`     | `MYTHIC_PORT`             | `port`          |
| Bind address                | `--host`     | `MYTHIC_HOST`             | `host`          |
| Listen on LAN               | `--lan`      | `MYTHIC_LAN=1`            | `lan`           |
| Data directory              | `--data-dir` | `MYTHIC_DATA_DIR`         | n/a             |
| Autosave interval (actions) | n/a          | `MYTHIC_AUTOSAVE_ACTIONS` | n/a             |
| Public URL for the DM link  | n/a          | `MYTHIC_PUBLIC_URL`       | `publicUrl`     |

Precedence is flags, then environment variables, then the config file, then defaults. The config file is `mythic.config.json` in the data directory, or the path given to `--config`.

## Feedback and contributing

Found a bug or have an idea? Please open an issue. If you want to help build Mythic VTT, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Mythic VTT is licensed under the [GNU Affero General Public License v3.0](LICENSE). "Mythic VTT" and "MythicTomes" are trademarks of MythicTomes.

Identity backup and transfer is available on the join screen and while connected. Download the JSON backup and import it in another browser to keep the same identity and campaign seat. The file contains your identity secret: keep it private. Import replaces this browser’s identity and reloads; the file is handled locally and never uploaded.
