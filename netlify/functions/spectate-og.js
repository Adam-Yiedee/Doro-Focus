import { deflateSync } from 'node:zlib';

const WIDTH = 1200;
const HEIGHT = 630;

const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data = Buffer.alloc(0)) => {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const makePng = (rawPixels) => {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawPixels)),
    pngChunk('IEND'),
  ]);
};

const makeCanvas = () => {
  const stride = WIDTH * 4 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const t = (x / WIDTH) * 0.52 + (y / HEIGHT) * 0.48;
      const r = Math.round(222 * (1 - t) + 133 * t);
      const g = Math.round(151 * (1 - t) + 207 * t);
      const b = Math.round(166 * (1 - t) + 196 * t);
      const i = row + 1 + (x * 4);
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  return raw;
};

const blendPixel = (raw, x, y, color) => {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const index = y * (WIDTH * 4 + 1) + 1 + (x * 4);
  const alpha = color[3] / 255;
  raw[index] = Math.round((color[0] * alpha) + (raw[index] * (1 - alpha)));
  raw[index + 1] = Math.round((color[1] * alpha) + (raw[index + 1] * (1 - alpha)));
  raw[index + 2] = Math.round((color[2] * alpha) + (raw[index + 2] * (1 - alpha)));
  raw[index + 3] = 255;
};

const fillRect = (raw, x, y, w, h, color) => {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(WIDTH, Math.ceil(x + w));
  const y1 = Math.min(HEIGHT, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      blendPixel(raw, xx, yy, color);
    }
  }
};

const fillRoundRect = (raw, x, y, w, h, radius, color) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.ceil(x + w);
  const y1 = Math.ceil(y + h);
  const r = Math.max(0, radius);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const dx = xx < x + r ? x + r - xx : xx > x + w - r ? xx - (x + w - r) : 0;
      const dy = yy < y + r ? y + r - yy : yy > y + h - r ? yy - (y + h - r) : 0;
      if ((dx * dx) + (dy * dy) <= r * r) {
        blendPixel(raw, xx, yy, color);
      }
    }
  }
};

const sanitizeText = (value, fallback) => {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9:.\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
};

const measureText = (text, scale) => {
  return text.split('').reduce((width, char, index) => {
    if (char === ' ') return width + (3 * scale);
    const pattern = FONT[char] || FONT['?'];
    return width + (pattern[0].length * scale) + (index === text.length - 1 ? 0 : scale);
  }, 0);
};

const drawText = (raw, text, x, y, scale, color) => {
  let cursor = x;
  for (const char of text) {
    if (char === ' ') {
      cursor += 3 * scale;
      continue;
    }
    const pattern = FONT[char] || FONT['?'];
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] === '1') {
          fillRect(raw, cursor + (col * scale), y + (row * scale), scale, scale, color);
        }
      }
    }
    cursor += (pattern[0].length + 1) * scale;
  }
};

const fitScale = (text, maxWidth, maxScale, minScale) => {
  for (let scale = maxScale; scale >= minScale; scale -= 1) {
    if (measureText(text, scale) <= maxWidth) return scale;
  }
  return minScale;
};

const drawCenteredText = (raw, text, centerX, y, maxWidth, maxScale, minScale, color) => {
  const scale = fitScale(text, maxWidth, maxScale, minScale);
  const width = measureText(text, scale);
  drawText(raw, text, Math.round(centerX - (width / 2)), y, scale, color);
};

const formatEndFromTimestamp = (value) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const isPlaceholderEndLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || normalized === 'live timer' || normalized === 'not running' || normalized === 'no end time';
};

const parseTimezoneOffset = (value) => {
  const offset = Number(value);
  return Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : null;
};

const formatLocalEndFromTimestamp = (value, timezoneOffset) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  if (timezoneOffset !== null) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(timestamp - (timezoneOffset * 60 * 1000)));
  }

  return formatEndFromTimestamp(value);
};

const formatRemaining = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}H ${mins}M REMAINING` : `${hours}H REMAINING`;
  }
  return `${Math.max(1, minutes)}M REMAINING`;
};

export default async (request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'break' ? 'BREAK' : 'FOCUS';
  const timezoneOffset = parseTimezoneOffset(url.searchParams.get('tzOffset'));
  const requestedEndLabel = url.searchParams.get('endLabel') || '';
  const fallbackEndLabel = formatLocalEndFromTimestamp(url.searchParams.get('end'), timezoneOffset);
  const resolvedEndLabel = isPlaceholderEndLabel(requestedEndLabel) ? fallbackEndLabel : requestedEndLabel;
  const endLabel = sanitizeText(resolvedEndLabel, 'LIVE TIMER');
  const remainingLabel = sanitizeText(formatRemaining(url.searchParams.get('remaining')), 'SPECTATOR TIMER');
  const sessionLabel = sanitizeText(url.searchParams.get('session'), 'DORO');

  const raw = makeCanvas();
  fillRoundRect(raw, 96, 74, 1008, 482, 58, [32, 22, 28, 92]);
  fillRoundRect(raw, 126, 104, 948, 422, 42, [255, 255, 255, 34]);
  fillRoundRect(raw, 156, 134, 888, 362, 30, [0, 0, 0, 32]);
  fillRect(raw, 186, 414, 828, 2, [255, 255, 255, 58]);

  drawCenteredText(raw, 'DORO LIVE TIMER', WIDTH / 2, 144, 760, 9, 6, [255, 255, 255, 150]);
  drawCenteredText(raw, `${mode} ENDS AT`, WIDTH / 2, 204, 820, 10, 7, [255, 255, 255, 170]);
  drawCenteredText(raw, endLabel, WIDTH / 2, 262, 900, 26, 12, [255, 255, 255, 246]);
  drawCenteredText(raw, remainingLabel, WIDTH / 2, 444, 820, 10, 7, [255, 255, 255, 164]);
  drawCenteredText(raw, `SESSION ${sessionLabel}`, WIDTH / 2, 500, 760, 7, 5, [255, 255, 255, 112]);

  const png = makePng(raw);
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60',
    },
  });
};
