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
    prod: ["node:buffer", "node:crypto", "node:fs", "node:process"],
    test: [
      "@bounded-systems/seam-check",
      // the wire agreements the conformance test verifies each client against
      "@bounded-systems/keeper-wire",
      "@bounded-systems/scout-wire",
      "@bounded-systems/concierge-wire",
    ],
    // Drop only the ambient-env rule (env is door-kit's declared bootstrap
    // surface); keep subprocess spawning forbidden.
    forbidAmbient: DEFAULT_AMBIENT_RULES.filter(([, label]) => label !== "ambient env / auth"),
  });
});
