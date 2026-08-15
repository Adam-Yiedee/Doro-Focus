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
  'That focus is landing. Keep the rhythm.',
  'Strong pace. Stay with the next minute.',
  'Clean momentum. Keep stacking it.',
  'You are making real progress.',
  'The room can feel that focus.',
  'Steady work. Keep it simple and keep going.',
  'Nice block. Protect the momentum.',
  'One focused minute at a time.',
  'You are moving this forward.',
  'Solid pace. Stay locked in.',
  'That is a real focus streak forming.',
  'Quiet progress still counts.',
  'Keep showing up. It is working.',
  'The next block is yours.',
  'You are closer than you were a minute ago.',
  'Good work. Keep the thread alive.',
  'This is how the session gets won.',
  'Stay steady. The work is moving.',
  'Tiny win detected. Keep building.',
  'Focus witnessed and fully respected.',
] as const;

const POMO_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.currentPomoNumber !== null && context.currentPomoNumber > 1
    ? `${context.pomoLabel} in. Keep the pace steady.`
    : 'First block started. Set the tone.',
  context => context.currentPomoNumber !== null && context.currentPomoNumber >= 3
    ? `${context.pomoLabel} deep. That is strong momentum.`
    : 'Next block is a clean chance to move.',
  context => context.isBreak
    ? context.completedPomoCount !== null && context.completedPomoCount > 0
      ? `${context.completedPomoCount} pomo${context.completedPomoCount === 1 ? '' : 's'} down. Break earned.`
      : 'Break earned. Come back steady.'
    : context.currentPomoNumber !== null
      ? `${context.pomoLabel} momentum is building.`
      : 'Focus momentum is building.',
  context => context.currentPomoNumber !== null && context.currentPomoNumber >= 5
    ? `${context.pomoLabel} in. Serious endurance.`
    : context.currentPomoNumber !== null
      ? `Solid ${context.pomoLabel} progress.`
      : 'Solid focus progress.',
  context => context.currentPomoNumber !== null
    ? `Small ${context.pomoLabel} win. Keep stacking.`
    : 'Small focus win. Keep stacking.',
];

const TASK_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.taskName ? `${context.taskName} is moving. Stay with it.` : 'The task list is moving. Stay with it.',
  context => context.taskName ? `Nice progress on ${context.taskName}. Keep the thread alive.` : 'Nice progress. Keep the thread alive.',
  context => context.taskName ? `${context.taskName} is getting handled one block at a time.` : 'One block at a time. It adds up.',
  context => context.taskName ? `Keep returning to ${context.taskName}. That consistency matters.` : 'Keep returning to the work. That consistency matters.',
  context => context.taskName ? `One clean minute on ${context.taskName}. Then another.` : 'One clean minute. Then another.',
];

const CATEGORY_PROMPT_BUILDERS: Array<(context: EncouragementPromptContext) => string> = [
  context => context.categoryName ? `${context.categoryName} focus is settling in.` : 'Focus is settling in.',
  context => context.categoryName ? `${context.categoryName} is getting real attention.` : 'This work is getting real attention.',
  context => context.categoryName ? `Stay with ${context.categoryName}. Progress is visible.` : 'Stay with it. Progress is visible.',
  context => context.categoryName ? `${context.categoryName} momentum is building.` : 'Momentum is building.',
  context => context.categoryName ? `Your ${context.categoryName} rhythm looks strong.` : 'Your focus rhythm looks strong.',
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
