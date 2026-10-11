import { createHash } from 'node:crypto';
import sharp from 'sharp';

function parseHexColor(value) {
  const normalized = value.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export async function validateGeneratedAsset(buffer, requirements) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set();
  let transparentPixels = 0;
  let opaquePixels = 0;
  let partialPixels = 0;
  let chromaPixels = 0;
  const chroma = requirements.forbiddenChroma
    ? parseHexColor(requirements.forbiddenChroma)
    : null;
  const chromaThreshold = (requirements.chromaTolerance || 45) ** 2;

  for (let offset = 0; offset < decoded.data.length; offset += 4) {
    const alpha = decoded.data[offset + 3];
    if (alpha === 0) transparentPixels += 1;
    else if (alpha === 255) opaquePixels += 1;
    else partialPixels += 1;
    if (alpha > 0) {
      colors.add(`${decoded.data[offset]},${decoded.data[offset + 1]},${decoded.data[offset + 2]},${alpha}`);
      if (chroma) {
        const distance = ((decoded.data[offset] - chroma.r) ** 2)
          + ((decoded.data[offset + 1] - chroma.g) ** 2)
          + ((decoded.data[offset + 2] - chroma.b) ** 2);
        if (distance <= chromaThreshold) chromaPixels += 1;
      }
    }
  }

  const totalPixels = decoded.info.width * decoded.info.height;
  const transparentRatio = transparentPixels / totalPixels;
  const chromaRatio = chromaPixels / totalPixels;
  const checks = [
    { name: 'format', passed: metadata.format === 'png', actual: metadata.format, expected: 'png' },
    { name: 'width', passed: metadata.width === requirements.width, actual: metadata.width, expected: requirements.width },
    { name: 'height', passed: metadata.height === requirements.height, actual: metadata.height, expected: requirements.height },
    { name: 'alpha_channel', passed: metadata.hasAlpha === true, actual: metadata.hasAlpha, expected: true },
    {
      name: 'transparency',
      passed: transparentRatio >= requirements.minimumTransparentRatio,
      actual: Number(transparentRatio.toFixed(4)),
      expected: `>=${requirements.minimumTransparentRatio}`,
    },
    {
      name: 'palette',
      passed: colors.size <= requirements.maxPaletteColors,
      actual: colors.size,
      expected: `<=${requirements.maxPaletteColors}`,
    },
    {
      name: 'chroma_spill',
      passed: !chroma || chromaRatio <= (requirements.maximumChromaRatio ?? 0.05),
      actual: Number(chromaRatio.toFixed(4)),
      expected: `<=${requirements.maximumChromaRatio ?? 0.05}`,
    },
    { name: 'non_empty', passed: opaquePixels + partialPixels > 0, actual: opaquePixels + partialPixels, expected: '>0' },
  ];

  return {
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    metrics: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      palette_colors: colors.size,
      transparent_pixels: transparentPixels,
      opaque_pixels: opaquePixels,
      partial_alpha_pixels: partialPixels,
      chroma_pixels: chromaPixels,
      chroma_ratio: Number(chromaRatio.toFixed(4)),
      transparent_ratio: Number(transparentRatio.toFixed(4)),
      content_sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}
