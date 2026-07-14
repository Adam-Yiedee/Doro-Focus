import React from 'react';
import {
  Banknote,
  Bike,
  BookText,
  BookOpen,
  Brain,
  Briefcase,
  CalendarCheck2,
  Calculator,
  Camera,
  Clapperboard,
  Code2,
  Coffee,
  Compass,
  ClipboardList,
  Cpu,
  Dumbbell,
  FolderKanban,
  FlaskConical,
  Gamepad2,
  Gavel,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  Landmark,
  Languages,
  Layers3,
  Laptop2,
  Leaf,
  Library,
  Lightbulb,
  Microscope,
  Music,
  NotebookPen,
  Palette,
  Pencil,
  PencilRuler,
  PenTool,
  Scale,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserRound,
  Video,
  Wallet,
  Wrench,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

type CategoryIconOption = {
  key: string;
  label: string;
  Icon: LucideIcon;
};

export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
  { key: 'pencil', label: 'Pencil', Icon: Pencil },
  { key: 'pentool', label: 'Design', Icon: PenTool },
  { key: 'ruler', label: 'Drafting', Icon: PencilRuler },
  { key: 'notebook', label: 'Notebook', Icon: NotebookPen },
  { key: 'book', label: 'Book', Icon: BookOpen },
  { key: 'booktext', label: 'Reading', Icon: BookText },
  { key: 'library', label: 'Library', Icon: Library },
  { key: 'cap', label: 'Study', Icon: GraduationCap },
  { key: 'brain', label: 'Thinking', Icon: Brain },
  { key: 'calculator', label: 'Math', Icon: Calculator },
  { key: 'microscope', label: 'Science', Icon: Microscope },
  { key: 'flask', label: 'Lab', Icon: FlaskConical },
  { key: 'gavel', label: 'Law', Icon: Gavel },
  { key: 'scale', label: 'Debate', Icon: Scale },
  { key: 'languages', label: 'Languages', Icon: Languages },
  { key: 'calendar', label: 'Planning', Icon: CalendarCheck2 },
  { key: 'checklist', label: 'Checklist', Icon: ClipboardList },
  { key: 'target', label: 'Target', Icon: Target },
  { key: 'briefcase', label: 'Work', Icon: Briefcase },
  { key: 'kanban', label: 'Board', Icon: FolderKanban },
  { key: 'laptop', label: 'Laptop', Icon: Laptop2 },
  { key: 'cpu', label: 'Tech', Icon: Cpu },
  { key: 'hammer', label: 'Build', Icon: Hammer },
  { key: 'shield', label: 'Security', Icon: Shield },
  { key: 'bike', label: 'Cycling', Icon: Bike },
  { key: 'dumbbell', label: 'Fitness', Icon: Dumbbell },
  { key: 'coffee', label: 'Coffee', Icon: Coffee },
  { key: 'music', label: 'Music', Icon: Music },
  { key: 'gamepad', label: 'Gaming', Icon: Gamepad2 },
  { key: 'video', label: 'Video', Icon: Video },
  { key: 'clapper', label: 'Film', Icon: Clapperboard },
  { key: 'camera', label: 'Photo', Icon: Camera },
  { key: 'lightbulb', label: 'Ideas', Icon: Lightbulb },
  { key: 'sparkles', label: 'Creative', Icon: Sparkles },
  { key: 'palette', label: 'Art', Icon: Palette },
  { key: 'code', label: 'Coding', Icon: Code2 },
  { key: 'wallet', label: 'Money', Icon: Wallet },
  { key: 'banknote', label: 'Budget', Icon: Banknote },
  { key: 'leaf', label: 'Nature', Icon: Leaf },
  { key: 'heart', label: 'Health', Icon: Heart },
  { key: 'user', label: 'Personal', Icon: UserRound },
  { key: 'landmark', label: 'History', Icon: Landmark },
  { key: 'globe', label: 'World', Icon: Globe },
  { key: 'compass', label: 'Travel', Icon: Compass },
  { key: 'layers', label: 'Projects', Icon: Layers3 },
  { key: 'trophy', label: 'Goals', Icon: Trophy },
  { key: 'wrench', label: 'Tools', Icon: Wrench },
  { key: 'star', label: 'General', Icon: Star },
];

const CATEGORY_ICON_ALIASES: Record<string, string> = {
  pen: 'pencil',
  calc: 'calculator',
  atom: 'microscope',
  game: 'gamepad',
  bulb: 'lightbulb',
  money: 'wallet',
  chess: 'trophy',
};

const baseCategoryIcons = CATEGORY_ICON_OPTIONS.reduce<Record<string, LucideIcon>>((acc, option) => {
  acc[option.key] = option.Icon;
  return acc;
}, {});

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ...baseCategoryIcons,
  ...Object.fromEntries(
    Object.entries(CATEGORY_ICON_ALIASES).map(([alias, target]) => [alias, baseCategoryIcons[target] || Star]),
  ),
};

const resolveCategoryIcon = (key: string) => CATEGORY_ICONS[key] || Star;

export const getCategoryIconLabel = (key: string) => {
  const targetKey = CATEGORY_ICON_ALIASES[key] || key;
  return CATEGORY_ICON_OPTIONS.find((option) => option.key === targetKey)?.label || 'General';
};

export const getIcon = (key: string, props?: LucideProps) => {
  const Icon = resolveCategoryIcon(key);
  return <Icon size={14} strokeWidth={2} {...props} />;
};
