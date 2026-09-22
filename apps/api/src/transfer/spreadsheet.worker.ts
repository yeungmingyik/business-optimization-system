import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { validateUploadedFile } from './file-validation';
import {
  importColumns,
  spreadsheetEnums,
  type SpreadsheetResult,
  type TransferKind,
  XLSX_MIME,
} from './transfer.types';

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) throw new Error('不允许公式单元格');
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('hyperlink' in value || 'error' in value) throw new Error('单元格格式无效');
  }
  return String(value).trim();
}

async function parse(path: string, kind: TransferKind): Promise<SpreadsheetResult> {
  await validateUploadedFile(path, 'import.xlsx', XLSX_MIME, true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('数据');
  if (!sheet) throw new Error('缺少“数据”工作表');
  const errors: SpreadsheetResult['errors'] = [];
  workbook.eachSheet((current) =>
    current.eachRow((row) =>
      row.eachCell((cell) => {
        try {
          cellText(cell.value);
        } catch (error) {
          errors.push({ row: row.number, field: current.name, message: (error as Error).message });
        }
      }),
    ),
  );
  const columns = importColumns[kind];
  const header = sheet.getRow(1);
  const positions: Record<string, number> = {};
  const optionalColumns = new Set([
    'deliveryAddress',
    'taxRate',
    'taxFeeMode',
    'totalInclTaxOverride',
    'receivingAccount',
  ]);
  for (const [key, label] of Object.entries(columns)) {
    const matched: number[] = [];
    header.eachCell((cell, index) => {
      if (cellText(cell.value) === label) matched.push(index);
    });
    if (matched.length === 0 && optionalColumns.has(key)) continue;
    if (matched.length !== 1)
      errors.push({ row: 1, field: label, message: matched.length ? '列名重复' : '缺少字段列' });
    else positions[key] = matched[0];
  }
  if (errors.length) return { rows: [], errors, rowCount: 0 };
  const rows: SpreadsheetResult['rows'] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    for (const [key, position] of Object.entries(positions))
      values[key] = cellText(row.getCell(position).value);
    if (!Object.values(values).some(Boolean)) return;
    if (rows.length >= 5000) throw new Error('最多允许 5000 条数据行');
    for (const [key, value] of Object.entries(values)) {
      if (value.length > 10000)
        errors.push({ row: rowNumber, field: columns[key], message: '字段内容超出长度限制' });
      if (value && spreadsheetEnums[key] && !spreadsheetEnums[key].includes(value))
        errors.push({ row: rowNumber, field: columns[key], message: '请选择有效选项' });
    }
    rows.push({ row: rowNumber, values });
  });
  if (!rows.length && !errors.length)
    errors.push({ row: 2, field: '数据', message: '没有可导入的数据' });
  return { rows, errors, rowCount: rows.length };
}

async function template(kind: TransferKind, path: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.columns = Object.entries(importColumns[kind]).map(([key, header]) => ({
    key,
    header,
    width: 22,
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF1E293B' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  Object.keys(importColumns[kind]).forEach((key, index) => {
    sheet.getColumn(index + 1).numFmt = '@';
    const choices = spreadsheetEnums[key];
    if (choices)
      for (let row = 2; row <= 5001; row += 1)
        sheet.getCell(row, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${choices.join(',')}"`],
          showErrorMessage: true,
          error: '请选择有效选项',
          errorStyle: 'stop',
        };
  });
  await workbook.xlsx.writeFile(path);
}

async function write(
  path: string,
  columns: Array<{ key: string; header: string }>,
  rows: Array<Record<string, unknown>>,
) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: path,
    useStyles: true,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet('数据');
  sheet.columns = columns.map((column) => ({ ...column, width: 24, style: { numFmt: '@' } }));
  for (const row of rows) {
    const values: Record<string, string> = {};
    for (const { key } of columns) {
      const value = row[key];
      values[key] =
        value === undefined || value === null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
    }
    sheet.addRow(values).commit();
  }
  sheet.commit();
  await workbook.commit();
}

async function run() {
  const { action, path, kind, columns, rows, originalName, declaredMime } = workerData;
  if (action === 'parse') return parse(path, kind);
  if (action === 'template') return template(kind, path);
  if (action === 'validate') return validateUploadedFile(path, originalName, declaredMime);
  if (action === 'write') return write(path, columns, rows);
  throw new Error('无效任务');
}

run()
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((error) => parentPort?.postMessage({ ok: false, error: error.message || '文件处理失败' }));
