import { describe, expect, it } from 'vitest';
import { getActiveCategories, isCategoryArchived } from './categoryVisibility';
import { Category } from '../types';

const categories: Category[] = [
  { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
  { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book', archived: true },
];

describe('categoryVisibility', () => {
  it('treats legacy categories as active', () => {
    expect(isCategoryArchived(categories[0])).toBe(false);
    expect(getActiveCategories(categories)).toEqual([categories[0]]);
  });

  it('filters archived categories from future selection surfaces', () => {
    expect(getActiveCategories(categories).some((category) => category.id === 2)).toBe(false);
  });
});
