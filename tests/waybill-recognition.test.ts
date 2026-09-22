import { expect, test } from 'vitest';
import { parseWaybillText } from '../apps/api/src/waybills/waybill-text';
import { imageDimensions } from '../apps/api/src/waybills/waybill-image';
import { baselineJpeg, invalidJpegs, jpegFixtures } from './waybill-fixtures';

test('运单识别提取带标签号码、全角字符及承运商', () => {
  expect(
    parseWaybillText('顺 丰 速 运\n运 单 号：ＳＦ１２３４５６７８９０１２３\n收件人 王先生'),
  ).toEqual({ carrier: '顺丰速运', trackingNo: 'SF1234567890123' });
  expect(parseWaybillText('YTO EXPRESS\nTracking No: YT1234567890123')).toEqual({
    carrier: '圆通速递',
    trackingNo: 'YT1234567890123',
  });
  expect(parseWaybillText('中通快递\n快递单号: 73123456789012')).toEqual({
    carrier: '中通快递',
    trackingNo: '73123456789012',
  });
  expect(parseWaybillText('JD1234567890123')).toEqual({
    carrier: '京东物流',
    trackingNo: 'JD1234567890123',
  });
});

test('无单号标签的电话号码与日期不冒充物流单号', () => {
  expect(parseWaybillText('收件电话 13800138000\n日期 2026-09-22')).toEqual({
    carrier: undefined,
    trackingNo: undefined,
  });
  expect(parseWaybillText('Tracking No: 1234')).toEqual({
    carrier: undefined,
    trackingNo: undefined,
  });
});

test('单号不会吞入同一行的英文物流字段', () => {
  expect(parseWaybillText('SF EXPRESS Tracking No: SF1234567890123 Weight 1KG')).toEqual({
    carrier: '顺丰速运',
    trackingNo: 'SF1234567890123',
  });
  expect(parseWaybillText('EMS Waybill No: EA123456789CN')).toEqual({
    carrier: '中国邮政',
    trackingNo: 'EA123456789CN',
  });
});

test('图片尺寸解析拒绝格式伪装、损坏尾部和过大像素', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=',
    'base64',
  );
  expect(imageDimensions(png, 'image/png')).toEqual({ width: 1, height: 1 });
  expect(() => imageDimensions(png, 'image/jpeg')).toThrow('格式无效');
  expect(() => imageDimensions(png.subarray(0, png.length - 1), 'image/png')).toThrow('格式无效');
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(6000, 16);
  oversized.writeUInt32BE(6000, 20);
  expect(() => imageDimensions(oversized, 'image/png')).toThrow('2400万像素');
});

test.each(jpegFixtures)('JPEG $name 解析真实图像尺寸', ({ bytes }) => {
  expect(imageDimensions(bytes, 'image/jpeg')).toEqual({ width: 1200, height: 380 });
});

test.each(invalidJpegs)('JPEG $name 拒绝损坏结构', ({ bytes }) => {
  expect(() => imageDimensions(bytes, 'image/jpeg')).toThrow('运单图片格式无效');
});

test('JPEG 拒绝截断标记、尺寸越界和缺少扫描数据', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 6, 19, 20, baselineJpeg.length - 1])
    expect(() => imageDimensions(baselineJpeg.subarray(0, length), 'image/jpeg')).toThrow(
      '格式无效',
    );
  const oversized = Buffer.from(baselineJpeg);
  const frameOffset = oversized.indexOf(Buffer.from('ffc0', 'hex'));
  oversized.writeUInt16BE(6000, frameOffset + 5);
  oversized.writeUInt16BE(6000, frameOffset + 7);
  expect(() => imageDimensions(oversized, 'image/jpeg')).toThrow('2400万像素');
  const scanOffset = baselineJpeg.indexOf(Buffer.from('ffda', 'hex'));
  const scanDataOffset = scanOffset + 2 + baselineJpeg.readUInt16BE(scanOffset + 2);
  const emptyScan = Buffer.concat([
    baselineJpeg.subarray(0, scanDataOffset),
    Buffer.from('ffd9', 'hex'),
  ]);
  expect(() => imageDimensions(emptyScan, 'image/jpeg')).toThrow('格式无效');
});
