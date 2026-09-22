import { readFileSync } from 'node:fs';

export const baselineJpeg = readFileSync(
  new URL('./fixtures/waybills/baseline.jpg', import.meta.url),
);
export const jpegFixtures = [
  { name: 'baseline.jpg', bytes: baselineJpeg },
  {
    name: 'progressive.jpeg',
    bytes: readFileSync(new URL('./fixtures/waybills/progressive.jpg', import.meta.url)),
  },
  {
    name: 'exif.jpg',
    bytes: readFileSync(new URL('./fixtures/waybills/exif.jpg', import.meta.url)),
  },
  { name: '手机运单.JPG', bytes: Buffer.concat([baselineJpeg, Buffer.from('\r\n\0\0')]) },
  {
    name: 'comment.jpg',
    bytes: Buffer.concat([
      baselineJpeg.subarray(0, 2),
      Buffer.from('fffe000612ffd934', 'hex'),
      baselineJpeg.subarray(2),
    ]),
  },
];

const scanOffset = baselineJpeg.indexOf(Buffer.from('ffda', 'hex'));
const invalidLengthJpeg = Buffer.from(baselineJpeg);
invalidLengthJpeg.writeUInt16BE(0xffff, 4);
export const invalidJpegs = [
  { name: 'truncated.jpg', bytes: baselineJpeg.subarray(0, baselineJpeg.length - 20) },
  {
    name: 'missing-scan.jpg',
    bytes: Buffer.concat([baselineJpeg.subarray(0, scanOffset), Buffer.from('ffd9', 'hex')]),
  },
  { name: 'invalid-length.jpg', bytes: invalidLengthJpeg },
  {
    name: 'embedded-end-marker.jpg',
    bytes: Buffer.concat([
      baselineJpeg.subarray(0, baselineJpeg.length - 2),
      Buffer.from('fffe0004ffd9', 'hex'),
    ]),
  },
];
