# Mythic VTT

**The 2D virtual tabletop you already know, with a 3D button that makes height real.**

Mythic VTT is a lightweight, open-source, browser-based virtual tabletop for TTRPGs. Players join with a link, no install or account. It plays like a normal 2D VTT, and switches to 3D at any moment to show and measure flying creatures, cliffs, multi-level dungeons and area effects accurately.

Built by **MythicTomes**. Self-hosting is free and fully featured; optional hosted services (Mythic Cloud) fund development.

> **Status:** early development. The first milestone is a usable table for live sessions. There is nothing to download or run yet.

---

## Features (first release)

- **Join by link.** Players enter a name and sit down. No accounts, no installs.
- **Seats and permissions.** One DM and up to 10 players, with per-token control over who can move what.
- **Grid and measuring.** Square grid, custom units, diagonal rules, and a ruler that reports horizontal, vertical and total distance.
- **Battlemaps.** Upload an image, calibrate it to the grid and place tokens.
- **Layers and secrets.** Map, token and DM-only layers. Hidden information is never sent to players.
- **Safe by default.** Every change is recorded: autosave, crash recovery and JSON export.
- **2D ↔ 3D in one click.** Elevation, platforms, primitive shapes, drop lines and a clamped camera. Everything works in 2D too; 3D only adds information.
- **Area templates.** Sphere, cylinder, cone, cube and line.

## Hosting a game

Mythic VTT runs as a small server on your own machine. You start it, share the link, and your players join from their browsers.

```sh
pnpm install && pnpm build      # once
node packages/host/dist/main.js --lan   # or: mythic-host --lan
```

The command serves the built client and the game host on one port (default 8787) and prints the address players open and your single-use DM link (`#host=...`). By default it only listens on this machine (`127.0.0.1`); `--lan` listens on your network so players on the same Wi-Fi can join.

### Local play (same Wi-Fi)

```sh
mythic-host --lan
```

Prints: `http://192.168.1.5:8787` (your local IP). Players on the same network open this address.

### Internet play (anywhere)

See **[Internet Play Guide](docs/internet-play.md)** for tunnels (recommended), port forwarding, and VPS options.

### Configuration

| Setting                    | Flag         | Env var             | Config file key |
| -------------------------- | ------------ | ------------------- | --------------- |
| Port                       | `--port`     | `MYTHIC_PORT`       | `port`          |
| Bind address               | `--host`     | `MYTHIC_HOST`       | `host`          |
| Listen on LAN              | `--lan`      | `MYTHIC_LAN=1`      | `lan`           |
| Data directory             | `--data-dir` | `MYTHIC_DATA_DIR`   | n/a             |
| Public URL for the DM link | n/a          | `MYTHIC_PUBLIC_URL` | `publicUrl`     |

Precedence is flags, then environment, then the config file, then defaults. The config file is `mythic.config.json` in the data directory, or the path given to `--config`.

## Contributing

Contributions are welcome once the project's contributor terms are finalised. Watch this repository for an announcement. In the meantime, feel free to open an issue with feedback or ideas.

## Licence

Mythic VTT is licensed under the [GNU Affero General Public License v3.0](LICENSE). "Mythic VTT" and "MythicTomes" are trademarks of MythicTomes.
