import { Buffer } from 'buffer';
import { parseTasks, serializeTasks } from './markdown';
import type { RepositorySettings, Task } from './types';

type GitHubFile = {
  sha: string;
  content: string;
  encoding: string;
};

export class RemoteFileNotFoundError extends Error {
  constructor() {
    super('The Markdown file does not exist in this repository yet.');
    this.name = 'RemoteFileNotFoundError';
  }
}

export class SyncConflictError extends Error {
  constructor() {
    super('The Markdown file changed on GitHub. Pull the latest version before syncing again.');
    this.name = 'SyncConflictError';
  }
}

function fileUrl(repository: RepositorySettings): string {
  const path = repository.path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/contents/${path}`;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function pullTasks(
  repository: RepositorySettings,
  token: string,
): Promise<{ tasks: Task[]; sha: string }> {
  const response = await fetch(fileUrl(repository), { headers: headers(token) });
  if (response.status === 404) throw new RemoteFileNotFoundError();
  if (!response.ok) throw new Error(await responseMessage(response));

  const file = await response.json() as GitHubFile;
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error('GitHub returned an unsupported Markdown file format.');
  }
  const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
  return { tasks: parseTasks(markdown), sha: file.sha };
}

export async function pushTasks(
  repository: RepositorySettings,
  token: string,
  tasks: Task[],
  sha?: string,
): Promise<string> {
  const response = await fetch(fileUrl(repository), {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update Listy tasks',
      content: Buffer.from(serializeTasks(tasks), 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });

  if (response.status === 409 || response.status === 422) throw new SyncConflictError();
  if (!response.ok) throw new Error(await responseMessage(response));

  const result = await response.json() as { content?: { sha?: string } };
  if (!result.content?.sha) throw new Error('GitHub saved the file but did not return its revision.');
  return result.content.sha;
}

async function responseMessage(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json() as { message?: string };
    detail = body.message ? `: ${body.message}` : '';
  } catch {
    detail = '';
  }
  return `GitHub sync failed (${response.status})${detail}.`;
}
