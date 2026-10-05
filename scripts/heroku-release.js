const { spawnSync } = require("node:child_process");

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  const value = process.env[name];
  if (!value || value.includes("sslmode=")) continue;
  if (value.includes("localhost") || value.includes("127.0.0.1")) continue;
  process.env[name] = `${value}${value.includes("?") ? "&" : "?"}sslmode=require`;
}

const result = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
