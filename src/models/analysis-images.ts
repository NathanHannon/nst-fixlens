import sharp from 'sharp';
import { UnprocessableEntityException } from '@nestjs/common';
import type { SelectionDto } from '../diagnosis/diagnosis.dto.js';
const options = { limitInputPixels: 16_000_000, failOn: 'error' as const };
export async function verifyPhoto(
  bytes: Buffer,
  width: number,
  height: number,
) {
  const metadata = await sharp(bytes, options).metadata();
  if (
    metadata.format !== 'jpeg' ||
    metadata.width !== width ||
    metadata.height !== height ||
    (metadata.orientation && metadata.orientation !== 1)
  )
    throw new UnprocessableEntityException(
      'The uploaded JPEG dimensions or orientation do not match the capture. Choose the photo again.',
    );
}
export async function brushPreview(
  bytes: Buffer,
  width: number,
  height: number,
  selection: SelectionDto,
): Promise<Buffer> {
  try {
    await verifyPhoto(bytes, width, height);
    const radius = Math.max(2, Math.round(Math.min(width, height) / 180));
    const dots = (selection.points ?? [])
      .map(
        (p) => `<circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="#00ffff"/>`,
      )
      .join('');
    const svg = Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${selection.x1}" y="${selection.y1}" width="${selection.x2 - selection.x1 + 1}" height="${selection.y2 - selection.y1 + 1}" fill="none" stroke="#00ffff" stroke-width="${radius}"/>${dots}</svg>`,
    );
    return await sharp(bytes, options)
      .composite([{ input: svg }])
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new UnprocessableEntityException(
      'Use a prepared JPEG whose dimensions and orientation match the capture. Please take or choose the photo again.',
    );
  }
}
export async function cropPhoto(
  bytes: Buffer,
  crop: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(bytes, options).extract(crop).jpeg({ quality: 95 }).toBuffer();
}
