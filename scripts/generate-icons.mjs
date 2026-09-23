import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const publicRoot = new URL('../web/public/', import.meta.url);
const svg = readFileSync(new URL('jelly.svg', publicRoot), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [filename, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    const png = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      // Opaque, full-bleed background; keep the lizard inside the OS icon mask.
      context.fillStyle = '#b6eed1';
      context.fillRect(0, 0, size, size);
      context.drawImage(image, size * 0.1, size * 0.1, size * 0.8, size * 0.8);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    writeFileSync(new URL(filename, publicRoot), Buffer.from(png, 'base64'));
    console.log(`${filename}: ${size}×${size}`);
  }
} finally {
  await browser.close();
}
