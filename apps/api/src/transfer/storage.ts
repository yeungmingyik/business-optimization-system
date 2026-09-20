import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { diskStorage } from 'multer';

export function storageRoot() {
  const root = resolve(
    process.env.BOS_UPLOAD_ROOT || join(process.env.BOS_ROOT || process.cwd(), '.data/uploads'),
  );
  if (!isAbsolute(root) || !/^D:[\\/]/i.test(root)) throw new Error('D_DRIVE_STORAGE_REQUIRED');
  return root;
}

export function storagePath(key: string) {
  if (!/^[a-f0-9-]{36}(?:\.upload)?$/.test(key)) throw new Error('INVALID_STORAGE_KEY');
  return join(storageRoot(), key);
}

export function uploadStorage() {
  return diskStorage({
    destination: (_request, _file, callback) => {
      try {
        const root = storageRoot();
        mkdirSync(root, { recursive: true });
        callback(null, root);
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
  });
}

let activeWorkers = 0;
const pendingWorkers: Array<() => void> = [];

export async function spreadsheetTask<T>(workerData: Record<string, unknown>): Promise<T> {
  if (activeWorkers >= 2)
    await new Promise<void>((resolveTask) => pendingWorkers.push(resolveTask));
  activeWorkers += 1;
  try {
    return await new Promise<T>((resolveTask, reject) => {
      const compiled = join(__dirname, 'spreadsheet.worker.js');
      const source = join(__dirname, 'spreadsheet.worker.ts');
      const compiledExists = existsSync(compiled);
      const worker = new Worker(
        compiledExists
          ? compiled
          : "const { workerData } = require('node:worker_threads'); require(require('node:module').createRequire(workerData.entry).resolve('tsx/cjs')); require(workerData.entry);",
        {
          workerData: compiledExists ? workerData : { ...workerData, entry: source },
          eval: !compiledExists,
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64 },
        },
      );
      let finished = false;
      const timer = setTimeout(() => {
        finished = true;
        void worker.terminate();
        reject(new Error('文件处理超时'));
      }, 120000);
      worker.once('message', (message: { ok: boolean; result: T; error?: string }) => {
        finished = true;
        clearTimeout(timer);
        if (message.ok) resolveTask(message.result);
        else reject(new Error(message.error || '文件处理失败'));
      });
      worker.once('error', () => {
        finished = true;
        clearTimeout(timer);
        reject(new Error('文件处理失败'));
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        if (!finished && code !== 0) reject(new Error('文件处理超出限制'));
      });
    });
  } finally {
    activeWorkers -= 1;
    pendingWorkers.shift()?.();
  }
}
