/**
 * keeper.ts — in-box client for keeperd
 *
 * A box with the `--keeper` door can use this to make signed commits and pushes.
 * The box holds no keys — it asks keeperd to sign.
 *
 * Usage:
 *   import { commit, push, sign } from "./lib/keeper";
 *
 *   const result = await commit({
 *     repo: "/work",
 *     message: "feat: add feature X",
 *     all: true,
 *   });
 *   console.log(`Committed ${result.commit}`);
 *
 *   await push({ repo: "/work" });
 */

// Bun.connect via the global (no `import … from "bun"`) so the package resolves
// on JSR/Deno publish — the same way the guest-room protocol uses Bun globals.
// (Full Deno/Bun-agnostic abstraction is tracked separately.)
const connect = Bun.connect;

// ── Types ────────────────────────────────────────────────────────────────────

export type CommitOptions = {
  /** Repository path */
  repo: string;
  /** Commit message */
  message: string;
  /** Author string (e.g., "Name <email>") */
  author?: string;
  /** Specific files to add */
  files?: string[];
  /** Add all changes (git add -A) */
  all?: boolean;
  /** Amend the last commit */
  amend?: boolean;
};

export type CommitResult = {
  commit: string;
  attestation?: {
    statement: unknown;
    statementDigest: string;
    signature: string;
    keyId: string;
  };
};

export type PushOptions = {
  /** Repository path */
  repo: string;
  /** Remote name (default: "origin") */
  remote?: string;
  /** Branch name (default: current branch) */
  branch?: string;
  /** Force push */
  force?: boolean;
  /** Set upstream tracking */
  setUpstream?: boolean;
};

export type PushResult = {
  pushed: string;
  commits: string[];
};

export type SignResult = {
  signature: string;
  keyId: string;
};

export type VerifyResult = {
  valid: boolean;
  keyId?: string;
};

export type KeeperStatus = {
  version: string;
  uptime: number;
  signing: { enabled: boolean; keyId?: string };
};

export class KeeperError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "KeeperError";
  }
}

// ── Client ───────────────────────────────────────────────────────────────────

type KeeperTarget =
  | { type: "unix"; path: string }
  | { type: "tcp"; host: string; port: number };

/** Get keeperd connection target from environment or default. */
function getTarget(): KeeperTarget {
  // TCP mode: KEEPERD_HOST=host:port (e.g., "host.containers.internal:9999")
  const tcpHost = process.env.KEEPERD_HOST;
  if (tcpHost) {
    const [host, portStr] = tcpHost.split(":");
    return { type: "tcp", host: host || "127.0.0.1", port: Number(portStr) || 9999 };
  }

  // Unix socket mode: KEEPERD_SOCK=/path/to/socket
  const sockPath = process.env.KEEPERD_SOCK;
  if (sockPath) return { type: "unix", path: sockPath };

  // In-box default: socket at /run/keeperd.sock
  if (Bun.file("/run/keeperd.sock").size !== undefined) {
    return { type: "unix", path: "/run/keeperd.sock" };
  }

  // Fallback for testing outside a box
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return { type: "unix", path: `${runtime}/keeperd.sock` };
  const home = process.env.HOME ?? "/tmp";
  return { type: "unix", path: `${home}/.claude-box/keeperd.sock` };
}

type RequestEnvelope = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type ResponseEnvelope = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

/** Send a request to keeperd and wait for response. */
async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const target = getTarget();
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    let buffer = "";
    let resolved = false;

    const socketHandler = {
      open(sock: ReturnType<typeof connect> extends Promise<infer S> ? S : never) {
        const req: RequestEnvelope = { id, method, params };
        sock.write(JSON.stringify(req) + "\n");
      },
      data(sock: ReturnType<typeof connect> extends Promise<infer S> ? S : never, data: Buffer) {
        buffer += data.toString();
        const newline = buffer.indexOf("\n");
        if (newline >= 0 && !resolved) {
          resolved = true;
          const line = buffer.slice(0, newline);
          sock.end();
          try {
            const resp = JSON.parse(line) as ResponseEnvelope;
            if (resp.ok) {
              resolve(resp.result as T);
            } else {
              reject(new KeeperError(
                resp.error?.code ?? "UNKNOWN",
                resp.error?.message ?? "keeperd error"
              ));
            }
          } catch (e) {
            reject(new KeeperError("PARSE_ERROR", "invalid response from keeperd"));
          }
        }
      },
      error(_sock: unknown, err: Error) {
        if (!resolved) {
          resolved = true;
          reject(new KeeperError("CONNECTION_ERROR", `failed to connect to keeperd: ${err}`));
        }
      },
      close() {
        if (!resolved) {
          resolved = true;
          reject(new KeeperError("CONNECTION_CLOSED", "connection closed before response"));
        }
      },
    };

    const connectPromise = target.type === "unix"
      ? connect({ unix: target.path, socket: socketHandler })
      : connect({ hostname: target.host, port: target.port, socket: socketHandler });

    connectPromise.catch((err) => {
      if (!resolved) {
        resolved = true;
        reject(new KeeperError("CONNECTION_ERROR", `failed to connect to keeperd: ${err}`));
      }
    });
  });
}

// ── Path translation ──────────────────────────────────────────────────────────
// The box sees the repo at /work, but keeperd runs on the host where the repo
// is at a different path (e.g., the host worktree root). CLAUDE_BOX_HOST_REPO
// tells us the host path so we can translate /work → the actual host path.

/**
 * Translate a repo path from in-box (/work) to host path.
 * If CLAUDE_BOX_HOST_REPO is set and repo starts with /work, translate it.
 */
export function translateRepoPath(repo: string): string {
  const hostRepo = process.env.CLAUDE_BOX_HOST_REPO;
  if (!hostRepo) return repo;

  // Translate /work or /work/... to the host path
  if (repo === "/work" || repo === "/work/") {
    return hostRepo;
  }
  if (repo.startsWith("/work/")) {
    return hostRepo + repo.slice(5); // replace /work with hostRepo
  }
  // Also handle "." when cwd is /work
  if (repo === "." && process.cwd() === "/work") {
    return hostRepo;
  }

  return repo;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a signed commit via keeperd.
 *
 * Requires the `--keeper` door. The box holds no keys — keeperd signs.
 */
export async function commit(options: CommitOptions): Promise<CommitResult> {
  return request<CommitResult>("commit", {
    repo: translateRepoPath(options.repo),
    message: options.message,
    author: options.author,
    files: options.files,
    all: options.all ?? false,
    amend: options.amend ?? false,
  });
}

/**
 * Push to remote via keeperd.
 *
 * Requires the `--keeper` door. The box holds no SSH keys — keeperd pushes.
 */
export async function push(options: PushOptions): Promise<PushResult> {
  return request<PushResult>("push", {
    repo: translateRepoPath(options.repo),
    remote: options.remote ?? "origin",
    branch: options.branch,
    force: options.force ?? false,
    setUpstream: options.setUpstream ?? false,
  });
}

/** Model-A keeper write input: the host has already done the local, keyless
 *  `commit-tree` and ships the new commits as a commit-range bundle; keeperd
 *  imports them and performs ONLY the signed push. The host never grants the
 *  daemon commit authorship — that asymmetry is the isolation. */
export type ImportAndPushOptions = {
  /** Commit-range git bundle (base64) carrying the new commits the host built. */
  bundleBase64: string;
  /** The already-materialized commit the daemon imports as the tip and pushes. */
  commitSha: string;
  /** Branch to point at the imported commit and push. */
  branch: string;
  /** Push remote (e.g. `origin`). */
  remote: string;
  /** Extra `git push` args after `<remote> <branch>` (e.g. `--force-with-lease`). */
  pushArgs?: string[];
  /** Opt-in attestation: keeperd emits a signed `push/v1` derivation here. */
  ledgerRef?: string;
};

/** keeperd's verdict for an import-and-push: `ok` carries the pushed identity
 *  (and the signed derivation when a ledger was requested); `error` carries a
 *  branchable code. A non-`ok` verdict is data, not an exception. */
export type ImportAndPushResult =
  | { status: "ok"; commitSha: string; pushedRef: string; signedDerivation?: unknown }
  | { status: "error"; code: string; message: string; exitCode?: number };

/**
 * Ask keeperd to import the host-built commit-range bundle and signed-push its
 * branch (object-transfer "model A"). Use this when the host commits locally
 * (keyless) and the daemon must hold ONLY the push credential + signing key.
 */
export async function importAndPush(
  options: ImportAndPushOptions,
): Promise<ImportAndPushResult> {
  return request<ImportAndPushResult>("import-and-push", {
    kind: "import-and-push",
    bundleBase64: options.bundleBase64,
    commitSha: options.commitSha,
    branch: options.branch,
    remote: options.remote,
    ...(options.pushArgs !== undefined ? { pushArgs: options.pushArgs } : {}),
    ...(options.ledgerRef !== undefined ? { ledgerRef: options.ledgerRef } : {}),
  });
}

/**
 * Sign arbitrary data via keeperd.
 *
 * The data should be base64 encoded.
 */
export async function signData(data: string): Promise<SignResult> {
  return request<SignResult>("sign", { data });
}

/**
 * Verify a signature via keeperd.
 *
 * Both data and signature should be base64 encoded.
 */
export async function verifySignature(data: string, signature: string, publicKey?: string): Promise<VerifyResult> {
  return request<VerifyResult>("verify", { data, signature, publicKey });
}

/**
 * Get keeperd status (health check).
 */
export async function status(): Promise<KeeperStatus> {
  return request<KeeperStatus>("status");
}

/**
 * Get the signing public key.
 */
export async function getPublicKey(): Promise<{ publicKey: string; keyId: string }> {
  return request<{ publicKey: string; keyId: string }>("getPublicKey");
}

/**
 * Check if keeperd is reachable.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    await status();
    return true;
  } catch {
    return false;
  }
}

// ── CLI (for testing) ────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const [cmd, ...args] = Bun.argv.slice(2);

  switch (cmd) {
    case "status": {
      const s = await status();
      console.log(JSON.stringify(s, null, 2));
      return 0;
    }
    case "commit": {
      const repo = args[0] ?? ".";
      const message = args[1] ?? "commit via keeper";
      const result = await commit({ repo, message, all: true });
      console.log(`committed ${result.commit}`);
      if (result.attestation) {
        console.log(`attestation: ${result.attestation.statementDigest}`);
      }
      return 0;
    }
    case "push": {
      const repo = args[0] ?? ".";
      const result = await push({ repo });
      console.log(`pushed to ${result.pushed}`);
      console.log(`commits: ${result.commits.join(", ") || "(none)"}`);
      return 0;
    }
    case "key": {
      const key = await getPublicKey();
      console.log(key.publicKey);
      return 0;
    }
    default:
      console.log(`keeper — in-box client for keeperd

Usage:
  keeper status              show keeperd status
  keeper commit [REPO] [MSG] create a signed commit
  keeper push [REPO]         push to remote
  keeper key                 show signing public key

This command only works inside a box with the --keeper door.`);
      return cmd === "-h" || cmd === "--help" ? 0 : 1;
  }
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (e) {
    if (e instanceof KeeperError) {
      console.error(`error: ${e.code}: ${e.message}`);
    } else {
      console.error(`error: ${e}`);
    }
    process.exit(1);
  }
}
