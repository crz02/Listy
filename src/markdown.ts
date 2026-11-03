import type { Priority, Task } from './types';

const taskLine = /^- \[([ xX])\] (.*?)(?:\s+<!-- listy:(.*?) -->)?$/;
const validPriorities: Priority[] = ['low', 'medium', 'high'];

export function serializeTasks(tasks: Task[]): string {
  const lines = tasks.map((task) => {
    const metadata = {
      id: task.id,
      createdAt: task.createdAt,
      ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
      priority: task.priority,
      category: task.category,
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    };
    return `- [${task.completedAt ? 'x' : ' '}] ${task.title.replace(/\r?\n/g, ' ')} <!-- listy:${JSON.stringify(metadata)} -->`;
  });

  return [
    '# Listy task list',
    '',
    '> Personal tasks stored as Markdown. Edit this file directly if you like.',
    '',
    '## Tasks',
    '',
    ...(lines.length ? lines : ['<!-- Add your first quest in Listy. -->']),
    '',
  ].join('\n');
}

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = taskLine.exec(line);
    if (!match) continue;

    const isComplete = match[1].toLowerCase() === 'x';
    const title = match[2].trim();
    if (!title) continue;

    let metadata: Partial<Task> = {};
    if (match[3]) {
      try {
        metadata = JSON.parse(match[3]) as Partial<Task>;
      } catch {
        metadata = {};
      }
    }

    const createdAt = isDate(metadata.createdAt) ? metadata.createdAt : localDateKey();
    const updatedAt = isDate(metadata.updatedAt) ? metadata.updatedAt : createdAt;
    const completedAt = isComplete
      ? isDate(metadata.completedAt)
        ? metadata.completedAt
        : createdAt
      : undefined;
    const priority = validPriorities.includes(metadata.priority as Priority)
      ? (metadata.priority as Priority)
      : 'medium';

    tasks.push({
      id: typeof metadata.id === 'string' && metadata.id ? metadata.id : createId(),
      title,
      createdAt,
      updatedAt,
      priority,
      category: typeof metadata.category === 'string' && metadata.category
        ? metadata.category
        : 'Personal',
      ...(isDate(metadata.dueDate) ? { dueDate: metadata.dueDate } : {}),
      ...(completedAt ? { completedAt } : {}),
    });
  }

  return tasks;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
