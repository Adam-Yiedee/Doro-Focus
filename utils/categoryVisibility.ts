import { Category } from '../types';

export const isCategoryArchived = (category: Pick<Category, 'archived'> | null | undefined): boolean => (
  category?.archived === true
);

export const isActiveCategory = (category: Category): boolean => !isCategoryArchived(category);

export const getActiveCategories = (categories: Category[]): Category[] => (
  categories.filter(isActiveCategory)
);
