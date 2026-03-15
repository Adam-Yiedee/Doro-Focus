import { Category, LogEntry } from '../types';

type CategorySnapshot = Pick<LogEntry, 'categoryName' | 'categoryColor' | 'categoryIcon'>;

const getSafeText = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const getCategoryMapById = (categories: Category[]) => {
  const map = new Map<number, Category>();
  categories.forEach((category) => {
    if (typeof category.id === 'number' && Number.isFinite(category.id)) {
      map.set(category.id, category);
    }
  });
  return map;
};

export const buildCategorySnapshot = (
  categories: Category[] | Map<number, Category>,
  categoryId: number | null | undefined,
): CategorySnapshot => {
  if (typeof categoryId !== 'number' || !Number.isFinite(categoryId)) {
    return {};
  }

  const categoriesById = categories instanceof Map ? categories : getCategoryMapById(categories);
  const category = categoriesById.get(categoryId);
  if (!category) return {};

  return {
    categoryName: category.name,
    categoryColor: category.color,
    categoryIcon: category.icon,
  };
};

export const resolveLogEntryCategory = (
  entry: Pick<LogEntry, 'categoryId' | 'categoryName' | 'categoryColor' | 'categoryIcon'>,
  categories: Category[] | Map<number, Category>,
) => {
  const categoriesById = categories instanceof Map ? categories : getCategoryMapById(categories);
  const category = typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId)
    ? categoriesById.get(entry.categoryId)
    : undefined;

  return {
    category,
    name: category?.name || getSafeText(entry.categoryName),
    color: category?.color || getSafeText(entry.categoryColor),
    icon: category?.icon || getSafeText(entry.categoryIcon),
  };
};
