import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const formats: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return;
  let offset = 2;
  let frame: { width: number; height: number; components: number } | undefined;
  let scanning = false;
  let scanSeen = false;
  let scanHasData = false;
  while (offset < bytes.length) {
    if (scanning) {
      const markerOffset = bytes.indexOf(0xff, offset);
      if (markerOffset < 0) return;
      if (markerOffset > offset) scanHasData = true;
      offset = markerOffset;
    }
    if (bytes[offset] !== 0xff) return;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return;
    const marker = bytes[offset++];
    if (scanning && marker === 0x00) {
      scanHasData = true;
      continue;
    }
    if (scanning && ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01)) continue;
    if (scanning && !scanHasData) return;
    scanning = false;
    if (marker === 0xd9) {
      if (frame && scanSeen && scanHasData) return { width: frame.width, height: frame.height };
      return;
    }
    if (marker === 0x01) continue;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) return;
    if (offset + 2 > bytes.length) return;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || size < 11) return;
      const components = bytes[offset + 7];
      if (!components || components > 4 || size !== 8 + 3 * components) return;
      frame = {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
        components,
      };
    }
    if (marker === 0xda) {
      if (!frame || size < 8) return;
      const components = bytes[offset + 2];
      if (!components || components > frame.components || size !== 6 + 2 * components) return;
      scanning = true;
      scanSeen = true;
      scanHasData = false;
    }
    offset += size;
  }
}

export function imageDimensions(bytes: Buffer, mediaType: string) {
  let width = 0;
  let height = 0;
  if (
    mediaType === 'image/png' &&
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mediaType === 'image/jpeg') {
    const dimensions = jpegDimensions(bytes);
    width = dimensions?.width ?? 0;
    height = dimensions?.height ?? 0;
  } else if (
    mediaType === 'image/webp' &&
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && (bytes[20] & 2) === 0) {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunk === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const dimensions = bytes.readUInt32LE(21);
      width = 1 + (dimensions & 0x3fff);
      height = 1 + ((dimensions >>> 14) & 0x3fff);
    }
  }
  if (!width || !height) throw new Error('运单图片格式无效');
  if (width > 10000 || height > 10000 || width * height > 24000000)
    throw new Error('图片尺寸不能超过2400万像素');
  return { width, height };
}

export async function inspectWaybillImage(file: Express.Multer.File) {
  const mediaType = formats[extname(file.originalname).toLowerCase()];
  if (!mediaType || file.mimetype !== mediaType) throw new Error('仅支持 JPG、PNG、WebP 图片');
  const size = (await stat(file.path)).size;
  if (!size || size > 10 * 1024 * 1024) throw new Error('运单图片不能超过10MB');
  const dimensions = imageDimensions(await readFile(file.path), mediaType);
  return { ...dimensions, mediaType, bytes: size };
}
