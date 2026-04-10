import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);

const readEnvFile = (envPath) => {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const entries = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      if (!key) continue;

      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
  fail(`Node.js 18+ required. Current: ${process.versions.node}`);
}

const serverPath = path.join(rootDir, "src", "server.js");
if (!fs.existsSync(serverPath)) {
  fail(`Missing entry file: ${path.relative(rootDir, serverPath)}`);
}

const problems = [];

const nodeModulesPath = path.join(rootDir, "node_modules");
const hasNodeModules = fs.existsSync(nodeModulesPath);
if (!hasNodeModules) {
  problems.push("`node_modules` not found (run `npm install`).");
}

const requiredPkgs = [
  "express",
  "cors",
  "helmet",
  "express-rate-limit",
  "dotenv",
  "mongoose",
  "jsonwebtoken",
  "bcryptjs",
  "socket.io",
  "zod"
];

const mode = process.argv[2] || "start";
if (mode === "dev") requiredPkgs.push("nodemon");

if (hasNodeModules) {
  const missing = [];
  for (const pkg of requiredPkgs) {
    try {
      require.resolve(pkg);
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length) {
    problems.push(`Missing npm dependencies: ${missing.join(", ")} (run \`npm install\`).`);
  }
}

const envPath = path.join(rootDir, ".env");
const envFile = fs.existsSync(envPath) ? readEnvFile(envPath) : {};

const getEnv = (name) => {
  const fromShell = process.env[name];
  if (typeof fromShell === "string" && fromShell.length) return fromShell;
  const fromFile = envFile[name];
  if (typeof fromFile === "string" && fromFile.length) return fromFile;
  return "";
};

const mongoUri = getEnv("MONGO_URI");
const jwtSecret = getEnv("JWT_SECRET");

if (!mongoUri || !jwtSecret) {
  problems.push("Missing env vars `MONGO_URI` and/or `JWT_SECRET` (copy `.env.example` → `.env`).");
} else {
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    problems.push("`MONGO_URI` should start with `mongodb://` or `mongodb+srv://`.");
  }
  if (jwtSecret.length < 32) {
    problems.push("`JWT_SECRET` must be at least 32 characters.");
  }
}

if (problems.length) {
  console.error("Preflight failed:");
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
