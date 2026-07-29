import { describe, expect, it } from 'vitest';
import { Task } from '../types';
import { shouldShowTaskWhenCompletedTasksAreHidden } from './Tasks';

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  name: 'Task',
  estimated: 4,
  completed: 4,
  checked: true,
  selected: false,
  categoryId: null,
  subtasks: [],
  ...overrides,
});

describe('shouldShowTaskWhenCompletedTasksAreHidden', () => {
  it('keeps the selected completed task visible when completed tasks are hidden', () => {
    const task = createTask({ selected: true });

    expect(shouldShowTaskWhenCompletedTasksAreHidden(task, false)).toBe(true);
  });

  it('hides an unselected completed task when completed tasks are hidden', () => {
    const task = createTask();

    expect(shouldShowTaskWhenCompletedTasksAreHidden(task, false)).toBe(false);
  });

  it('keeps a completed parent visible while a selected completed subtask is inside it', () => {
    const task = createTask({
      subtasks: [
        createTask({
          id: 2,
          name: 'Subtask',
          selected: true,
        }),
      ],
    });

    expect(shouldShowTaskWhenCompletedTasksAreHidden(task, false)).toBe(true);
  });

  it('keeps completed tasks visible when completed tasks are shown', () => {
    const task = createTask();

    expect(shouldShowTaskWhenCompletedTasksAreHidden(task, true)).toBe(true);
  });
});
