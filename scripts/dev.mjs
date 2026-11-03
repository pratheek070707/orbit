import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

nextEnv.loadEnvConfig(process.cwd());

const databaseName = process.env.MONGODB_DATABASE || "orbit";
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const uri = new URL(mongoUri);
const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(uri.hostname);
const appDataPath = path.resolve(process.cwd(), ".runtime", "appdata");
let localMongo;
let next;

async function hasReachableMongo() {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 1200 });
  try {
    await client.connect();
    await client.db(databaseName).command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

try {
  if (process.env.ORBIT_LOCAL_MONGO === "true" && isLoopback && !(await hasReachableMongo())) {
    const dataPath = path.resolve(process.cwd(), ".runtime", "mongodb");
    const binaryPath = path.resolve(process.cwd(), ".runtime", "mongodb-binaries");
    await mkdir(dataPath, { recursive: true });
    await mkdir(binaryPath, { recursive: true });
    try {
      localMongo = await MongoMemoryServer.create({
        binary: { downloadDir: binaryPath },
        instance: {
          args: ["--quiet"],
          ip: uri.hostname,
          port: Number(uri.port || 27017),
          dbName: databaseName,
          dbPath: dataPath,
          storageEngine: "wiredTiger",
        },
      });
      console.log(`Orbit local MongoDB is running at ${localMongo.getUri()} with persistent data in ${dataPath}`);
    } catch (error) {
      if (!(error instanceof Error) || !/DBPathInUse|lock file/i.test(error.message)) throw error;
      console.warn("An existing MongoDB process is using Orbit's data folder; continuing with that database.");
    }
  }

  await mkdir(appDataPath, { recursive: true });
  process.env.APPDATA = appDataPath;
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  next = spawn(process.execPath, [
    path.resolve("node_modules", "next", "dist", "bin", "next"),
    "dev",
    "--hostname",
    process.env.ORBIT_HOST || "127.0.0.1",
    "--port",
    process.env.PORT || "3002",
  ], { stdio: "inherit", env: process.env });

  const stopNext = () => {
    if (next && next.exitCode === null) next.kill("SIGINT");
  };
  process.on("SIGINT", stopNext);
  process.on("SIGTERM", stopNext);

  const exitCode = await new Promise((resolve, reject) => {
    next.once("error", reject);
    next.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  await localMongo?.stop();
  process.exitCode = exitCode;
} catch (error) {
  await localMongo?.stop().catch(() => undefined);
  console.error("Could not start Orbit development services.", error);
  process.exitCode = 1;
}
