import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { XLSX_MIME } from './transfer.types';

const mimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': XLSX_MIME,
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function inspectZip(path: string, kind: string, rejectProtection = false) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, file) =>
      error || !file ? reject(new Error('文件格式无效')) : resolve(file),
    ),
  );
  return new Promise<void>((resolve, reject) => {
    let declaredBytes = 0;
    let actualBytes = 0;
    let entries = 0;
    let hasContentTypes = false;
    let hasMain = false;
    let ended = false;
    const fail = (message: string) => {
      if (ended) return;
      ended = true;
      zip.close();
      reject(new Error(message));
    };
    zip.on('error', () => fail('压缩文件损坏'));
    zip.on('end', () => {
      if (ended) return;
      ended = true;
      if (!hasContentTypes || !hasMain) reject(new Error('文件格式无效'));
      else resolve();
    });
    zip.on('entry', (entry: Entry) => {
      entries += 1;
      declaredBytes += entry.uncompressedSize;
      if (
        entries > 20000 ||
        declaredBytes > 200 * 1024 * 1024 ||
        entry.uncompressedSize > Math.max(entry.compressedSize, 1) * 1000
      )
        return fail('压缩文件超出限制');
      if (
        (entry.generalPurposeBitFlag & 1) !== 0 ||
        /(?:^|\/)\.\.(?:\/|$)|^\/|^[a-z]:|\\/i.test(entry.fileName)
      )
        return fail('文件格式无效');
      if (/vbaProject|encryptedPackage|externalLinks|activeX|embeddings/i.test(entry.fileName))
        return fail('文件包含不允许的内容');
      hasContentTypes ||= entry.fileName === '[Content_Types].xml';
      hasMain ||=
        entry.fileName ===
        {
          '.xlsx': 'xl/workbook.xml',
          '.docx': 'word/document.xml',
          '.pptx': 'ppt/presentation.xml',
        }[kind];
      if (entry.fileName.endsWith('/')) return zip.readEntry();
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail('压缩文件损坏');
        let tail = '';
        stream.on('error', () => fail('压缩文件损坏'));
        stream.on('data', (chunk: Buffer) => {
          actualBytes += chunk.byteLength;
          if (actualBytes > 200 * 1024 * 1024) {
            stream.destroy();
            fail('压缩文件超出限制');
          }
          if (rejectProtection && kind === '.xlsx' && /\.xml$/i.test(entry.fileName)) {
            const text = tail + chunk.toString('utf8');
            if (/<(?:[a-z]+:)?(?:sheetProtection|workbookProtection)\b/i.test(text)) {
              stream.destroy();
              fail('不允许密码保护文件');
            }
            tail = text.slice(-256);
          }
        });
        stream.on('end', () => {
          if (!ended) zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

export async function validateUploadedFile(
  path: string,
  originalName: string,
  declaredMime: string,
  importOnly = false,
) {
  const extension = extname(originalName).toLowerCase();
  const mediaType = mimeTypes[extension];
  if (!mediaType || (importOnly && extension !== '.xlsx')) throw new Error('不支持此文件类型');
  if (declaredMime !== mediaType && declaredMime !== 'application/octet-stream')
    throw new Error('文件类型与内容不一致');
  const fileStat = await stat(path);
  if (fileStat.size < 8) throw new Error('文件内容为空或无效');
  if (fileStat.size > (importOnly ? 20 : 200) * 1024 * 1024) throw new Error('文件超出大小限制');
  const handle = await open(path, 'r');
  const bytes = Buffer.alloc(32);
  try {
    await handle.read(bytes, 0, 32, 0);
  } finally {
    await handle.close();
  }
  const valid =
    extension === '.pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : extension === '.png'
        ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : ['.jpg', '.jpeg'].includes(extension)
          ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
          : extension === '.webp'
            ? bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP'
            : extension === '.mp4'
              ? bytes.subarray(4, 8).toString() === 'ftyp' && bytes.readUInt32BE(0) >= 16
              : bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  if (!valid) throw new Error('文件类型与内容不一致');
  if (['.xlsx', '.docx', '.pptx'].includes(extension))
    await inspectZip(path, extension, importOnly);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { mediaType, bytes: fileStat.size, checksum: hash.digest('hex'), extension };
}
