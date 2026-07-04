/**
 * @module
 * wire conformance — each in-box client is verified against the PUBLISHED wire
 * agreement it implements, imported directly from JSR
 * (@bounded-systems/{keeper,scout,concierge}-wire), not a vendored copy. The
 * agreement is the single source of truth; drift here fails door-kit's own CI.
 *
 * The client's method surface is read from source (the string it dispatches:
 * keeper/scout via `request("m", …)`, concierge via `call(sock, "m", …)`) and
 * asserted equal to the agreement's method set (`Object.keys(SPEC)`).
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KEEPER_WIRE } from "@bounded-systems/keeper-wire";
import { SCOUT_WIRE } from "@bounded-systems/scout-wire";
import { CONCIERGE_WIRE } from "@bounded-systems/concierge-wire";

const ROOT = dirname(fileURLToPath(import.meta.url));

// strip block comments so a call("fetch") sample in a JSDoc header isn't taken
// for real dispatch.
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const requestMethods = (s: string): string[] =>
  [...strip(s).matchAll(/request(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]);
const callMethods = (s: string): string[] =>
  [...strip(s).matchAll(/\bcall(?:<[^>]*>)?\(\s*[^,]+,\s*["']([^"']+)["']/g)]
    .map((m) => m[1]);

function conforms(
  file: string,
  spec: Record<string, unknown>,
  parse: (s: string) => string[],
): void {
  const src = readFileSync(join(ROOT, file), "utf8");
  const client = new Set(parse(src));
  const want = new Set(Object.keys(spec));
  const missing = [...want].filter((m) => !client.has(m));
  const extra = [...client].filter((m) => !want.has(m));
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
}

test("keeper client matches @bounded-systems/keeper-wire", () => {
  conforms("lib/keeper.ts", KEEPER_WIRE, requestMethods);
});

test("scout client matches @bounded-systems/scout-wire", () => {
  conforms("lib/scout.ts", SCOUT_WIRE, requestMethods);
});

test("concierge client matches @bounded-systems/concierge-wire", () => {
  conforms("lib/concierge.ts", CONCIERGE_WIRE, callMethods);
});
