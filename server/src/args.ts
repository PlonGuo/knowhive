// CLI arg parsing for the sidecar. Mirrors the contract the Rust shell spawns with:
// `--port <port> --data-dir <dir>` (see src-tauri/src/sidecar.rs:build_args).

export interface Args {
  port: number;
  dataDir: string;
}

const DEFAULT_PORT = 18200;

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  let port = DEFAULT_PORT;
  let dataDir = ".";
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--port" && argv[i + 1] !== undefined) {
      port = parseInt(argv[++i]!, 10);
    } else if (flag === "--data-dir" && argv[i + 1] !== undefined) {
      dataDir = argv[++i]!;
    }
  }
  return { port, dataDir };
}
