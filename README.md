# door-kit — the in-box door-client SDK

`door-kit` is the client side of [claude-box](https://github.com/bounded-systems/claude-box)'s
capability doors: one small in-box client per door, plus shared runtime helpers. A boxed agent
imports these to *call* the doors over the
[guest-room](https://github.com/bounded-systems/guest-room) protocol — it never holds
credentials or speaks to the daemons directly.

## Clients

| Module | Door | Talks to |
|---|---|---|
| `lib/keeper.ts` | keeper | keeperd (git writes / signing) |
| `lib/scout.ts` | scout | scoutd (external reads) |
| `lib/concierge.ts` | concierge | concierged (capability resolution) |
| `lib/spawn.ts` | launcher | launcherd (child boxes) |
| `lib/runtime.ts` | — | shared runtime helpers for daemons |

## guest-room is vendored

`lib/` imports the guest-room engine (`../guest-room/{mod,protocol,daemon}.ts`). `./guest-room/`
here is a **generated mirror** pinned to `bounded-systems/guest-room@e8cbeaa`, kept in lockstep
the same way claude-box does — bump the pin and re-vendor the files together.

_Extracted from claude-box `lib/` — decomposition epic `prx-ii01`, card 1b._
