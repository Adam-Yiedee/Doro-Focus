export type EncouragementPromptKind = 'pomo' | 'task' | 'category' | 'general';

export type EncouragementPrompt = {
  kind: EncouragementPromptKind;
  message: string;
};

export type EncouragementPromptContext = {
  currentPomoNumber: number | null;
  completedPomoCount: number | null;
  pomoLabel: string;
  taskName: string | null;
  categoryName: string | null;
  isBreak: boolean;
};

const ENCOURAGEMENT_PRESETS = [
  "Oh, you're actually locked in locked in.",
  'Okay productivity machine.',
  'Who gave you permission to work this hard?',
  'Casually becoming unstoppable, I see.',
  'Save some productivity for the rest of us.',
  'Academic weapon behavior.',
  "You're making procrastination nervous.",
  'Rare footage of you getting things done.',
  'Honestly? Kind of impressive.',
  'Your brain deserves a little applause.',
  'Certified locked-in moment.',
  'The focus is focusing.',
  'Okay, scholar.',
  'That task picked the wrong person today.',
  "Keep going - I'm emotionally invested now.",
  "You versus your to-do list. Current score: you're winning.",
  'No distractions. Only greatness.',
  "You're in the zone. Protect it.",
  'Tiny win detected.',
  'Productivity witnessed and officially approved.',
] as const;

const POMO_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.currentPomoNumber !== null && context.currentPomoNumber > 1
    ? `${context.pomoLabel} in? You're crazy.`
    : 'First pomo energy. Lock in.',
  context => context.currentPomoNumber !== null && context.currentPomoNumber >= 3
    ? `${context.pomoLabel} deep. Academic weapon behavior.`
    : 'Next pomo is going to fear you.',
  context => context.isBreak
    ? context.completedPomoCount !== null && context.completedPomoCount > 0
      ? `${context.completedPomoCount} pomo${context.completedPomoCount === 1 ? '' : 's'} down. Break earned.`
      : 'Break earned. Come back dangerous.'
    : context.currentPomoNumber !== null
      ? `${context.pomoLabel} momentum detected.`
      : 'Pomo momentum detected.',
  context => context.currentPomoNumber !== null && context.currentPomoNumber >= 5
    ? `${context.pomoLabel} in? Save some focus for the rest of us.`
    : context.currentPomoNumber !== null
      ? `Certified ${context.pomoLabel} progress.`
      : 'Certified pomo progress.',
  context => context.currentPomoNumber !== null
    ? `Tiny ${context.pomoLabel} win detected.`
    : 'Tiny pomo win detected.',
];

const TASK_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.taskName ? `${context.taskName} picked the wrong person today.` : 'That task list picked the wrong person today.',
  context => context.taskName ? `Rare footage of ${context.taskName} getting handled.` : 'Rare footage of tasks getting handled.',
  context => context.taskName ? `${context.taskName}? Honestly, kind of impressive.` : 'Honestly? That task momentum is impressive.',
  context => context.taskName ? `You versus ${context.taskName}. Current score: you're winning.` : "You versus the to-do list. Current score: you're winning.",
  context => context.taskName ? `No distractions. Only ${context.taskName}.` : 'No distractions. Only greatness.',
];

const CATEGORY_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.categoryName ? `${context.categoryName} again? Nice!` : 'Category focus is looking clean.',
  context => context.categoryName ? `${context.categoryName} mode activated.` : 'Focus mode activated.',
  context => context.categoryName ? `${context.categoryName} does not stand a chance.` : 'This focus block does not stand a chance.',
  context => context.categoryName ? `Certified ${context.categoryName} momentum.` : 'Certified momentum.',
  context => context.categoryName ? `Your ${context.categoryName} focus is looking dangerous.` : 'Your focus is looking dangerous.',
];

export const normalizeEncouragementSubject = (value: string | null | undefined, blockedLabels: string[] = []) => {
  const normalized = value?.trim();
  if (!normalized) return null;
  const normalizedLower = normalized.toLowerCase();
  if (blockedLabels.some(label => normalizedLower === label.toLowerCase())) return null;
  return normalized.slice(0, 52);
};

const appendUniqueEncouragement = (options: EncouragementPrompt[], prompt: EncouragementPrompt | null | undefined) => {
  const normalized = prompt?.message.trim();
  if (!prompt || !normalized || options.some(option => option.message === normalized)) return;
  options.push({ ...prompt, message: normalized });
};

const getRandomArrayItem = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

const getRandomGeneralEncouragements = (count: number, blockedMessages: Set<string>) => {
  const pool = ENCOURAGEMENT_PRESETS
    .filter(message => !blockedMessages.has(message))
    .sort(() => Math.random() - 0.5);
  return pool.slice(0, count);
};

export const buildEncouragementOptions = (context: EncouragementPromptContext): EncouragementPrompt[] => {
  const prompts: EncouragementPrompt[] = [];

  appendUniqueEncouragement(prompts, {
    kind: 'pomo',
    message: getRandomArrayItem(POMO_PROMPT_BUILDERS)(context),
  });
  appendUniqueEncouragement(prompts, {
    kind: 'task',
    message: getRandomArrayItem(TASK_PROMPT_BUILDERS)(context),
  });
  appendUniqueEncouragement(prompts, {
    kind: 'category',
    message: getRandomArrayItem(CATEGORY_PROMPT_BUILDERS)(context),
  });

  const usedMessages = new Set(prompts.map(prompt => prompt.message));
  getRandomGeneralEncouragements(2, usedMessages).forEach(message => {
    appendUniqueEncouragement(prompts, { kind: 'general', message });
    usedMessages.add(message);
  });

  while (prompts.length < 5) {
    const fallback = ENCOURAGEMENT_PRESETS.find(message => !usedMessages.has(message));
    if (!fallback) break;
    appendUniqueEncouragement(prompts, { kind: 'general', message: fallback });
    usedMessages.add(fallback);
  }

  return prompts.slice(0, 5);
};
