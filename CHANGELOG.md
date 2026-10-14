# Changelog

## 0.0.1 — pre-alpha (2026-10-15)

First tagged version of Mythic VTT. This is a pre-alpha for playtesting, not for real campaigns: expect rough edges and keep backups of your data directory.

### Play at the table

- Join by link with a name, colour and avatar. No accounts, no installs.
- Tokens: place, drag, resize and rotate them, set their height, add image art, status markers, and see a quick preview card.
- Ping a spot on the board (alt-click or the Ping button) so everyone sees where you mean.
- Draw freehand on the effects layer to sketch ideas on the map.
- Measure distance with the ruler, including waypoints and vertical distance in 3D.
- Area-of-effect shapes (sphere, cylinder, cone, cube, line) show which tokens and cells they touch. The DM sets how many lasting AoEs each player can keep.
- Switch between a 2D board and a 3D view at any time. Tokens can be elevated, with platforms and shapes in 3D.
- Seats show avatars and connection quality, so you can see who is online and how well.
- Move a seat to another browser by scanning a QR code, or by exporting and importing an identity file.
- Chat panel, dice notation and a Help tab inside the app.

### For the DM

- Initiative tracker with rounds. Private combatants stay hidden from players.
- Pull players to my view, or let them follow the DM's view.
- Seats and spectators: invite links for players, read-only spectator links, role templates, and "View as" to preview what a seat or spectator sees.
- Archive a seat you no longer need: its tokens stay on the board and are handed back to the DM.
- Layers and hidden information: DM-only content is never sent to players.
- Scenes, battlemaps calibrated to the grid, scene filters, image skyboxes and textures, and saved prefabs.
- History panel with filters, undo of your own last action, and rollback to an earlier point.
- Run several campaigns from one host, with a start-up picker.

### Under the hood

- Save format v8 and protocol v9. Older saves are migrated automatically.
- Campaigns save automatically with crash recovery and can be exported and imported as a verified zip.
- Run it on your own computer with one command; see the README for setup and internet play.
