export type Priority = 'low' | 'medium' | 'high';

export type Task = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  dueDate?: string;
  priority: Priority;
  category: string;
};

export type RepositorySettings = {
  owner: string;
  repository: string;
  path: string;
};

export type LocalSettings = {
  repository: RepositorySettings;
  remoteSha?: string;
};
