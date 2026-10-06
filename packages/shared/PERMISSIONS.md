# Default permission table

The game host is authoritative. The host and seats with role `codm` are admins; spectators,
unknown seats and mods cannot submit these actions.

Player permissions use two gates. The seat's permission must be enabled, and the entity must be
owned by that seat or explicitly grant the same permission in `entity.perms`. Ownership always
grants access at the entity gate, while the seat gate lets the host disable a capability for that
player across the campaign. Players can never act on the `dm` layer.

New player seats default to `{ view: true, move: true, edit: false, delete: false }`. Entities are
visible outside the `dm` layer unless `perms.view` is false; owners still see their own entities.
Entities have no mutation grants by default. In particular, props are created without an implicit
player owner, so only the host and co-DMs can create, move or edit them until ownership or an
entity grant is assigned (D23).

| Action                           | Host / co-DM | Player default                            | Explicit player grant                        |
| -------------------------------- | ------------ | ----------------------------------------- | -------------------------------------------- |
| `entity.create`                  | Yes          | No                                        | No                                           |
| `entity.update` (transform only) | Yes          | Owned entity, if seat `move` is enabled   | Entity `move`, if seat `move` is enabled     |
| `entity.update` (other fields)   | Yes          | Owned entity, if seat `edit` is enabled   | Entity `edit`, if seat `edit` is enabled     |
| `entity.delete`                  | Yes          | Owned entity, if seat `delete` is enabled | Entity `delete`, if seat `delete` is enabled |
| `entity.setLayer`                | Yes          | Owned entity, if seat `move` is enabled   | Entity `move`, if seat `move` is enabled     |
| `entity.setOwners`               | Yes          | No                                        | No                                           |
| `layer.lock`                     | Yes          | No                                        | No                                           |
| `permission.update`              | Yes          | No                                        | No                                           |

A locked source or destination layer blocks entity creation, update, deletion and layer movement
for everyone, including admins. Ownership and permission administration remain available so the
host can repair access without changing scene content.
