import { test } from "bun:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_AMBIENT_RULES, assertSeam } from "@bounded-systems/seam-check";

// Flat layout (no src/): the SDK lives in lib/ + the vendored guest-room/ protocol.
const ROOT = dirname(fileURLToPath(import.meta.url));

// @bounded-systems/door-kit is the in-box door-CLIENT SDK (keeper/scout/concierge/
// spawn over the guest-room protocol). Like the capability *seams* themselves, it
// sits at the bootstrap layer: it reads the ambient environment to discover its
// own door sockets (CONCIERGE_SOCK, LAUNCHERD_SOCK, XDG_RUNTIME_DIR, ROOM_ID, …),
// so it declares that one ambient — env — as legitimate, and pins the rest. Its
// production surface is exactly four node builtins; the harness fails CI if a new
// import or any *spawn* (still forbidden) creeps in.
test("@bounded-systems/door-kit upholds its seam claim", () => {
  assertSeam({
    root: ROOT,
    // "bun" is the Bun socket API, imported by the vendored guest-room/protocol.ts
    // (an older copy than upstream, which now declares Bun locally to stay
    // JSR-resolvable); re-vendoring would drop it from this surface.
    prod: ["node:buffer", "node:crypto", "node:fs", "node:process", "bun"],
    test: ["@bounded-systems/seam-check"],
    // Drop only the ambient-env rule (env is door-kit's declared bootstrap
    // surface); keep subprocess spawning forbidden.
    forbidAmbient: DEFAULT_AMBIENT_RULES.filter(([, label]) => label !== "ambient env / auth"),
  });
});
