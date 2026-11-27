import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const source = readFileSync('public/favicon.svg', 'utf8');
const square = source.replace(/ rx="\d+"/, ' rx="0"');
const padded = square.replace(/(<rect[^>]*\/>)([\s\S]*)<\/svg>/, '$1<g transform="translate(2.4 2.4) scale(.85)">$2</g></svg>');

const icons = [
  ['public/apple-touch-icon.png', square, 180],
  ['public/icon-192.png', source, 192],
  ['public/icon-512.png', source, 512],
  ['public/icon-maskable-512.png', padded, 512]
];

for (const [file, svg, size] of icons) await sharp(Buffer.from(svg), { density: (72 * size) / 32 }).resize(size, size).png().toFile(file);
