import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { env } from "../config/env";

let server: PGLiteSocketServer | null = null;
let database: PGlite | null = null;

function localPort(): { host: string; port: number } | null {
  const url = new URL(env.DATABASE_URL);
  const host = url.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  return { host: "127.0.0.1", port: Number(url.port || 5432) };
}

function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function ensureLocalPostgres(): Promise<void> {
  const target = localPort();
  if (!target) return;
  if (await portOpen(target.host, target.port)) {
    console.log(`[db] PostgreSQL ${target.host}:${target.port} allaqachon ochiq`);
    return;
  }

  const dataDir = path.join(process.cwd(), "data", "pglite");
  await fs.mkdir(dataDir, { recursive: true });
  database = await PGlite.create(dataDir);
  server = new PGLiteSocketServer({
    db: database,
    host: target.host,
    port: target.port,
    maxConnections: 10,
  });
  await server.start();
  console.log(`[db] ichki PostgreSQL ${target.host}:${target.port}`);
}

export async function pushSchema(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["prisma", "db", "push", "--skip-generate"], {
      cwd: process.cwd(),
      shell: true,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma db push xato bilan tugadi: ${code ?? "unknown"}`));
    });
  });
}

export async function stopLocalPostgres(): Promise<void> {
  try {
    await server?.stop();
  } finally {
    server = null;
    await database?.close();
    database = null;
  }
}
