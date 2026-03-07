const HEX_COLOR_REGEX = /^#?([\da-f]{3}|[\da-f]{6})$/i;

export const PASTEL_SWATCHES = [
  '#C86D80',
  '#4FAE9B',
  '#6D88E3',
  '#D68C57',
  '#9A79DA',
  '#7FAF63',
  '#D4B14C',
];

export const DEFAULT_WORK_SURFACE = PASTEL_SWATCHES[0];
export const DEFAULT_BREAK_SURFACE = PASTEL_SWATCHES[1];

const normalizeHex = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(HEX_COLOR_REGEX);
  if (!match) return null;

  const raw = match[1];
  if (raw.length === 3) {
    return `#${raw.split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  return `#${raw}`.toLowerCase();
};

const parseHex = (value: string) => {
  const normalized = normalizeHex(value);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
};

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

const toHex = (value: number) => clampChannel(value).toString(16).padStart(2, '0');

const mixHex = (base: string, target: string, weight: number) => {
  const baseRgb = parseHex(base);
  const targetRgb = parseHex(target);
  if (!baseRgb || !targetRgb) return base;

  const ratio = Math.max(0, Math.min(1, weight));
  const inverse = 1 - ratio;

  return `#${toHex(baseRgb.r * inverse + targetRgb.r * ratio)}${toHex(baseRgb.g * inverse + targetRgb.g * ratio)}${toHex(baseRgb.b * inverse + targetRgb.b * ratio)}`;
};

const rgbToHsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const rUnit = r / 255;
  const gUnit = g / 255;
  const bUnit = b / 255;
  const max = Math.max(rUnit, gUnit, bUnit);
  const min = Math.min(rUnit, gUnit, bUnit);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue = 0;
  switch (max) {
    case rUnit:
      hue = ((gUnit - bUnit) / delta + (gUnit < bUnit ? 6 : 0)) / 6;
      break;
    case gUnit:
      hue = ((bUnit - rUnit) / delta + 2) / 6;
      break;
    default:
      hue = ((rUnit - gUnit) / delta + 4) / 6;
      break;
  }

  return { h: hue, s: saturation, l: lightness };
};

const hueToRgb = (p: number, q: number, t: number) => {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
};

const hslToHex = (h: number, s: number, l: number) => {
  const hue = ((h % 1) + 1) % 1;
  const saturation = clampUnit(s);
  const lightness = clampUnit(l);

  if (saturation === 0) {
    const gray = lightness * 255;
    return `#${toHex(gray)}${toHex(gray)}${toHex(gray)}`;
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return `#${toHex(hueToRgb(p, q, hue + 1 / 3) * 255)}${toHex(hueToRgb(p, q, hue) * 255)}${toHex(hueToRgb(p, q, hue - 1 / 3) * 255)}`;
};

export const getMutedSurfaceColor = (value: string | undefined, fallback: string = DEFAULT_WORK_SURFACE) => {
  const normalized = typeof value === 'string' ? normalizeHex(value) : null;
  const baseHex = normalized || fallback;
  const baseRgb = parseHex(baseHex);
  if (!baseRgb) return fallback;

  const { h, s, l } = rgbToHsl(baseRgb);
  const liftedLightness = Math.min(0.8, Math.max(0.72, l * 0.78 + 0.18));
  const preservedSaturation = Math.min(0.62, Math.max(0.38, s * 0.92 + 0.06));
  const softened = hslToHex(h, preservedSaturation, liftedLightness);

  return mixHex(softened, '#fffaf4', 0.08);
};
