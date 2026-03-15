import { Task } from '../types';

export type MergePreference = 'local' | 'remote';

type EntityWithId = { id: number | string };

const getSourcesByPreference = <T>(
  remoteItems: T[] = [],
  localItems: T[] = [],
  prefer: MergePreference = 'local',
) => {
  if (prefer === 'remote') {
    return {
      preferredItems: Array.isArray(remoteItems) ? remoteItems : [],
      fallbackItems: Array.isArray(localItems) ? localItems : [],
    };
  }

  return {
    preferredItems: Array.isArray(localItems) ? localItems : [],
    fallbackItems: Array.isArray(remoteItems) ? remoteItems : [],
  };
};

export const mergeOrderedEntitiesById = <T extends EntityWithId>(
  remoteItems: T[] = [],
  localItems: T[] = [],
  prefer: MergePreference = 'local',
): T[] => {
  const { preferredItems, fallbackItems } = getSourcesByPreference(remoteItems, localItems, prefer);
  const orderedIds: Array<number | string> = [];
  const seenIds = new Set<number | string>();
  const preferredById = new Map<number | string, T>();
  const fallbackById = new Map<number | string, T>();

  preferredItems.forEach((item) => {
    if (!item) return;
    preferredById.set(item.id, item);
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    orderedIds.push(item.id);
  });

  fallbackItems.forEach((item) => {
    if (!item) return;
    fallbackById.set(item.id, item);
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    orderedIds.push(item.id);
  });

  return orderedIds
    .map((id) => preferredById.get(id) ?? fallbackById.get(id) ?? null)
    .filter((item): item is T => item !== null);
};

const cloneTaskTree = (task: Task): Task => ({
  ...task,
  subtasks: Array.isArray(task.subtasks) ? task.subtasks.map(cloneTaskTree) : [],
});

export const mergeTaskLists = (
  remoteTasks: Task[] = [],
  localTasks: Task[] = [],
  prefer: MergePreference = 'local',
): Task[] => {
  const orderedTasks = mergeOrderedEntitiesById(remoteTasks, localTasks, prefer);
  const remoteById = new Map<number | string, Task>();
  const localById = new Map<number | string, Task>();

  remoteTasks.forEach((task) => {
    if (task) remoteById.set(task.id, task);
  });
  localTasks.forEach((task) => {
    if (task) localById.set(task.id, task);
  });

  return orderedTasks.map((orderedTask) => {
    const remoteTask = remoteById.get(orderedTask.id);
    const localTask = localById.get(orderedTask.id);
    const preferredTask = prefer === 'remote' ? remoteTask : localTask;
    const fallbackTask = prefer === 'remote' ? localTask : remoteTask;

    if (!preferredTask && fallbackTask) {
      return cloneTaskTree(fallbackTask);
    }
    if (!preferredTask) {
      return cloneTaskTree(orderedTask);
    }

    const remoteSubtasks = Array.isArray(remoteTask?.subtasks) ? remoteTask.subtasks : [];
    const localSubtasks = Array.isArray(localTask?.subtasks) ? localTask.subtasks : [];

    return {
      ...(fallbackTask ? cloneTaskTree(fallbackTask) : {}),
      ...cloneTaskTree(preferredTask),
      subtasks: mergeTaskLists(remoteSubtasks, localSubtasks, prefer),
    };
  });
};
