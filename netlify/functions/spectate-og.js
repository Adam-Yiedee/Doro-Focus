import PImage from 'pureimage';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_PATH = fileURLToPath(new URL('./assets/Manrope-ExtraBoldStatic.ttf', import.meta.url));
const LABEL = 'TIME FINISHED';
const PLACEHOLDER_TIME = '--';

let fontLoadPromise = null;

const loadFonts = () => {
  if (!fontLoadPromise) {
    fontLoadPromise = PImage.registerFont(FONT_PATH, 'Manrope').load();
  }
  return fontLoadPromise;
};

const parseTimezoneOffset = (value) => {
  const offset = Number(value);
  return Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : null;
};

const formatEndFromTimestamp = (value, timezoneOffset) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  if (timezoneOffset !== null) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(timestamp - (timezoneOffset * 60 * 1000)));
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

const sanitizeTimeLabel = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/[^\d:AaPpMm.\- ]/g, '')
  .trim()
  .slice(0, 18);

const isPlaceholderEndLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized === 'live timer'
    || normalized === 'not running'
    || normalized === 'no end time'
    || normalized === 'doro shared timer'
    || normalized === 'timer';
};

const resolveEndLabel = (url) => {
  const timezoneOffset = parseTimezoneOffset(url.searchParams.get('tzOffset'));
  const requestedEndLabel = sanitizeTimeLabel(url.searchParams.get('endLabel'));
  const fallbackEndLabel = formatEndFromTimestamp(url.searchParams.get('end'), timezoneOffset);
  const resolvedEndLabel = isPlaceholderEndLabel(requestedEndLabel) ? fallbackEndLabel : requestedEndLabel;
  return sanitizeTimeLabel(resolvedEndLabel) || PLACEHOLDER_TIME;
};

const mix = (from, to, amount) => from.map((value, index) => Math.round(value + ((to[index] - value) * amount)));

const setPixel = (image, x, y, color) => {
  const index = ((y * WIDTH) + x) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = 255;
};

const blendPixel = (image, x, y, color) => {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const index = ((y * WIDTH) + x) * 4;
  const alpha = color[3] / 255;
  image.data[index] = Math.round((color[0] * alpha) + (image.data[index] * (1 - alpha)));
  image.data[index + 1] = Math.round((color[1] * alpha) + (image.data[index + 1] * (1 - alpha)));
  image.data[index + 2] = Math.round((color[2] * alpha) + (image.data[index + 2] * (1 - alpha)));
  image.data[index + 3] = 255;
};

const blendRoundedRect = (image, x, y, width, height, radius, color) => {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(WIDTH, Math.ceil(x + width));
  const bottom = Math.min(HEIGHT, Math.ceil(y + height));

  for (let yy = top; yy < bottom; yy += 1) {
    for (let xx = left; xx < right; xx += 1) {
      const dx = xx < x + radius ? x + radius - xx : xx > x + width - radius ? xx - (x + width - radius) : 0;
      const dy = yy < y + radius ? y + radius - yy : yy > y + height - radius ? yy - (y + height - radius) : 0;
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        blendPixel(image, xx, yy, color);
      }
    }
  }
};

const fillBackground = (image) => {
  const pink = [215, 158, 173];
  const mint = [158, 222, 205];
  const light = [255, 242, 246];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const diagonal = ((x / WIDTH) * 0.44) + ((y / HEIGHT) * 0.56);
      const centerDistance = Math.hypot((x - (WIDTH / 2)) / WIDTH, (y - (HEIGHT / 2)) / HEIGHT);
      const glow = Math.max(0, 1 - (centerDistance / 0.52));
      const base = mix(pink, mint, diagonal);
      setPixel(image, x, y, mix(base, light, glow * 0.18));
    }
  }

  blendRoundedRect(image, 106, 82, 988, 466, 56, [255, 255, 255, 38]);
  blendRoundedRect(image, 160, 132, 880, 366, 40, [255, 255, 255, 24]);
};

const encodePng = async (image) => {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await PImage.encodePNGToStream(image, sink);
  return Buffer.concat(chunks);
};

const drawCenteredLetterSpacedText = (ctx, text, centerX, y, spacing) => {
  const chars = text.split('');
  const width = chars.reduce((sum, char, index) => {
    const measured = ctx.measureText(char).width;
    return sum + measured + (index === chars.length - 1 ? 0 : spacing);
  }, 0);

  let x = centerX - (width / 2);
  for (const char of chars) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
};

const fitFontSize = (ctx, text, maxWidth, preferredSize, minSize) => {
  for (let size = preferredSize; size >= minSize; size -= 2) {
    ctx.font = `${size}px Manrope`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
};

const drawSoftText = (ctx, text, x, y, options = {}) => {
  const {
    color = '#ffffff',
    shadowColor = '#bf8797',
    shadowOffset = 8,
  } = options;

  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x, y + shadowOffset);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
};

const drawPreview = async (endLabel) => {
  await loadFonts();

  const image = PImage.make(WIDTH, HEIGHT);
  fillBackground(image);

  const ctx = image.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '30px Manrope';
  ctx.fillStyle = '#fff0f4';
  drawCenteredLetterSpacedText(ctx, LABEL, WIDTH / 2, 228, 6);

  const fontSize = fitFontSize(ctx, endLabel, 920, 150, 82);
  ctx.font = `${fontSize}px Manrope`;
  drawSoftText(ctx, endLabel, WIDTH / 2, 382, {
    color: '#ffffff',
    shadowColor: '#c78fa0',
    shadowOffset: 10,
  });

  return encodePng(image);
};

export default async (request) => {
  const url = new URL(request.url);
  const endLabel = resolveEndLabel(url);
  const png = await drawPreview(endLabel);

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.length),
      'cache-control': 'public, max-age=3600',
    },
  });
};
