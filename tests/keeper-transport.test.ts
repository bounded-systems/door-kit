/**
 * lib/keeper.ts reaches keeperd over BOTH transports keeperd's env var may
 * hold: a unix socket path, or (TCP mode) a `host:port` string — exactly what
 * claude-box.ts's planDoorMounts sets KEEPERD_SOCK to. This is the concrete
 * regression test for the "scout dead in TCP mode" bug (DOORS.md, "The
 * TCP-mode door gap"): the client used to only recognize a separate
 * KEEPERD_HOST var for TCP, so a bare host:port value in KEEPERD_SOCK was
 * misread as a literal (nonexistent) unix path.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { commit } from "../lib/keeper.ts";
import { createDoorHandlers } from "../guest-room/protocol.ts";

function noop(): void {}

describe("lib/keeper reaches keeperd over either shape KEEPERD_SOCK may hold", () => {
  let server: { stop: () => void } | undefined;
  let sockPath = "";
  const savedSock = process.env.KEEPERD_SOCK;

  afterEach(() => {
    server?.stop();
    server = undefined;
    if (sockPath) { try { unlinkSync(sockPath); } catch {} }
    if (savedSock === undefined) delete process.env.KEEPERD_SOCK;
    else process.env.KEEPERD_SOCK = savedSock;
  });

  test("unix socket mode: KEEPERD_SOCK=/path/to.sock", async () => {
    sockPath = `${tmpdir()}/keeper-transport-${crypto.randomUUID()}.sock`;
    server = Bun.listen({
      unix: sockPath,
      socket: createDoorHandlers("keeper", {
        commit: (p) => ({ commit: `sha-for-${(p as { message: string }).message}` }),
      }, noop),
    });
    process.env.KEEPERD_SOCK = sockPath;

    const result = await commit({ repo: "/work", message: "unix-mode", all: true });
    expect(result.commit).toBe("sha-for-unix-mode");
  });

  test("TCP mode: KEEPERD_SOCK=host:port (what claude-box.ts's TCP mode sets)", async () => {
    const srv = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: createDoorHandlers("keeper", {
        commit: (p) => ({ commit: `sha-for-${(p as { message: string }).message}` }),
      }, noop),
    }) as unknown as { stop: () => void; port: number };
    server = srv;
    process.env.KEEPERD_SOCK = `127.0.0.1:${srv.port}`;

    const result = await commit({ repo: "/work", message: "tcp-mode", all: true });
    expect(result.commit).toBe("sha-for-tcp-mode");
  });
});
