import { describe, expect, it } from 'vitest';
import { buildCategorySnapshot, getCategoryMapById, resolveLogEntryCategory } from './categoryTracking';

const categories = [
  { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
  { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book' },
];

describe('categoryTracking', () => {
  it('builds a snapshot from the live category record', () => {
    expect(buildCategorySnapshot(categories, 2)).toEqual({
      categoryName: 'Study',
      categoryColor: '#4FAE9B',
      categoryIcon: 'book',
    });
  });

  it('prefers the current category over an older saved snapshot', () => {
    const renamedCategories = [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book' },
    ];

    expect(resolveLogEntryCategory({
      categoryId: 2,
      categoryName: 'Study',
      categoryColor: '#9AA0AA',
      categoryIcon: 'notebook',
    }, renamedCategories)).toEqual({
      category: renamedCategories[0],
      name: 'Deep Study',
      color: '#4FAE9B',
      icon: 'book',
    });
  });

  it('falls back to the saved snapshot when the category no longer exists', () => {
    const categoriesById = getCategoryMapById(categories);

    expect(resolveLogEntryCategory({
      categoryId: 99,
      categoryName: 'Archived Reading',
      categoryColor: '#8899AA',
      categoryIcon: 'history',
    }, categoriesById)).toEqual({
      category: undefined,
      name: 'Archived Reading',
      color: '#8899AA',
      icon: 'history',
    });
  });

  it('still resolves archived category records for historical stats', () => {
    const archivedCategories = [
      { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book', archived: true },
    ];

    expect(resolveLogEntryCategory({
      categoryId: 2,
      categoryName: 'Older Study',
      categoryColor: '#9AA0AA',
      categoryIcon: 'notebook',
    }, archivedCategories)).toEqual({
      category: archivedCategories[0],
      name: 'Study',
      color: '#4FAE9B',
      icon: 'book',
    });
  });
});
