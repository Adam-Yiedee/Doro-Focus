import { describe, expect, it } from 'vitest';
import { Category, Task } from '../types';
import { mergeOrderedEntitiesById, mergeTaskLists } from './stateMerge';

describe('mergeOrderedEntitiesById', () => {
  it('keeps the preferred order while preserving items that exist only in the fallback source', () => {
    const remoteCategories: Category[] = [
      { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
      { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book' },
      { id: 4, name: 'Admin', color: '#8291C6', icon: 'briefcase' },
    ];
    const localCategories: Category[] = [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book-open' },
      { id: 3, name: 'Reading', color: '#D7A86E', icon: 'notebook' },
      { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
    ];

    expect(mergeOrderedEntitiesById(remoteCategories, localCategories, 'local')).toEqual([
      localCategories[0],
      localCategories[1],
      localCategories[2],
      remoteCategories[2],
    ]);
  });
});

describe('mergeTaskLists', () => {
  it('preserves a local-only categorized task even when remote task order wins', () => {
    const remoteTasks: Task[] = [
      {
        id: 1,
        name: 'Existing remote task',
        estimated: 2,
        completed: 0,
        checked: false,
        selected: false,
        categoryId: null,
        subtasks: [],
        isExpanded: true,
      },
    ];
    const localTasks: Task[] = [
      {
        id: 1,
        name: 'Existing local task',
        estimated: 2,
        completed: 0,
        checked: false,
        selected: false,
        categoryId: null,
        subtasks: [],
        isExpanded: true,
      },
      {
        id: 2,
        name: 'New categorized task',
        estimated: 1,
        completed: 0,
        checked: false,
        selected: true,
        categoryId: 77,
        subtasks: [],
        isExpanded: true,
      },
    ];

    expect(mergeTaskLists(remoteTasks, localTasks, 'remote')).toEqual([
      remoteTasks[0],
      localTasks[1],
    ]);
  });

  it('merges subtask trees recursively instead of dropping subtasks from the non-preferred side', () => {
    const remoteTasks: Task[] = [
      {
        id: 10,
        name: 'Parent',
        estimated: 2,
        completed: 0,
        checked: false,
        selected: false,
        categoryId: null,
        subtasks: [
          {
            id: 101,
            name: 'Remote subtask',
            estimated: 1,
            completed: 0,
            checked: false,
            selected: false,
            categoryId: null,
            subtasks: [],
            isExpanded: false,
          },
        ],
        isExpanded: true,
      },
    ];
    const localTasks: Task[] = [
      {
        id: 10,
        name: 'Parent updated locally',
        estimated: 3,
        completed: 0,
        checked: false,
        selected: true,
        categoryId: 5,
        subtasks: [
          {
            id: 102,
            name: 'Local subtask',
            estimated: 2,
            completed: 0,
            checked: false,
            selected: false,
            categoryId: 5,
            subtasks: [],
            isExpanded: false,
          },
        ],
        isExpanded: true,
      },
    ];

    expect(mergeTaskLists(remoteTasks, localTasks, 'local')).toEqual([
      {
        ...localTasks[0],
        subtasks: [
          localTasks[0].subtasks[0],
          remoteTasks[0].subtasks[0],
        ],
      },
    ]);
  });
});
