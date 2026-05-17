import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const stateDir = path.resolve(
  process.env.GBRAIN_STATE_DIR ?? path.join(process.cwd(), "state"),
);

// Serialize concurrent writes per file path to avoid torn reads
const writeLocks = new Map<string, Promise<void>>();
function serializedWrite(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeLocks.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(filePath, next.then(() => {}, () => {}));
  return next;
}

export function statePath(fileName: string): string {
  return path.join(stateDir, fileName);
}

export async function ensureStateDir(): Promise<void> {
  await mkdir(stateDir, { recursive: true });
}

export async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  await ensureStateDir();

  try {
    const raw = await readFile(statePath(fileName), "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT" || error instanceof SyntaxError) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson<T>(fileName: string, value: T): Promise<void> {
  await ensureStateDir();
  const filePath = statePath(fileName);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await serializedWrite(filePath, () => writeFile(filePath, serialized, "utf8"));
}

export async function upsertRecord<T extends Record<string, unknown>>(
  fileName: string,
  key: string,
  record: T,
): Promise<Record<string, T>> {
  const data = await readJson<Record<string, T>>(fileName, {});
  data[key] = record;
  await writeJson(fileName, data);
  return data;
}
