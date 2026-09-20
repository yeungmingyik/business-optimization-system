import { beforeAll, describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateUploadedFile } from '../apps/api/src/transfer/file-validation';
import { spreadsheetTask } from '../apps/api/src/transfer/storage';
import { importColumns, XLSX_MIME } from '../apps/api/src/transfer/transfer.types';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const ExcelJS = apiRequire('exceljs');
const JSZip = createRequire(apiRequire.resolve('exceljs'))('jszip');
const root = resolve('.artifacts/tests/transfer-files');

beforeAll(async () => {
  await mkdir(root, { recursive: true });
});

async function saved(bytes: Uint8Array) {
  const path = resolve(root, `${randomUUID()}.xlsx`);
  await writeFile(path, bytes);
  return path;
}

async function base(rows = 1) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.columns = Object.entries(importColumns.products).map(([key, header]) => ({ key, header }));
  for (let index = 0; index < rows; index += 1)
    sheet.addRow({ sku: `LIMIT-${index}`, name: '测试', unit: '件', priceExTax: '1.00' });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe('文件边界', () => {
  test('拒绝宏工作簿和密码保护工作表', async () => {
    const archive = await JSZip.loadAsync(await base());
    archive.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3]));
    const macro = await saved(await archive.generateAsync({ type: 'uint8array' }));
    await expect(validateUploadedFile(macro, 'macro.xlsx', XLSX_MIME, true)).rejects.toThrow(
      '不允许',
    );
    const protectedArchive = await JSZip.loadAsync(await base());
    const sheet = await protectedArchive.file('xl/worksheets/sheet1.xml').async('string');
    protectedArchive.file(
      'xl/worksheets/sheet1.xml',
      sheet.replace('</worksheet>', '<sheetProtection password="ABCD"/></worksheet>'),
    );
    const protectedPath = await saved(await protectedArchive.generateAsync({ type: 'uint8array' }));
    await expect(
      validateUploadedFile(protectedPath, 'protected.xlsx', XLSX_MIME, true),
    ).rejects.toThrow('密码保护');
  });

  test('拒绝高压缩比内容及超出导入文件大小', async () => {
    const archive = await JSZip.loadAsync(await base());
    archive.file('xl/bomb.xml', '0'.repeat(4 * 1024 * 1024));
    const bomb = await saved(
      await archive.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      }),
    );
    await expect(validateUploadedFile(bomb, 'bomb.xlsx', XLSX_MIME, true)).rejects.toThrow(
      '超出限制',
    );
    const tooLarge = new Uint8Array(20 * 1024 * 1024 + 1);
    tooLarge.set([0x50, 0x4b, 0x03, 0x04]);
    const oversize = await saved(tooLarge);
    await expect(validateUploadedFile(oversize, 'large.xlsx', XLSX_MIME, true)).rejects.toThrow(
      '大小限制',
    );
  });

  test('5000 行通过解析，5001 行拒绝', async () => {
    const allowed = await saved(await base(5000));
    const result = await spreadsheetTask<any>({ action: 'parse', path: allowed, kind: 'products' });
    expect(result.rowCount).toBe(5000);
    expect(result.errors).toEqual([]);
    const overflow = await saved(await base(5001));
    await expect(
      spreadsheetTask({ action: 'parse', path: overflow, kind: 'products' }),
    ).rejects.toThrow('5000');
  });
});
