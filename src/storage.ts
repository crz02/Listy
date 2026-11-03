import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { LocalSettings, Task } from './types';

const TASKS_KEY = 'listy.tasks.v1';
const SETTINGS_KEY = 'listy.settings.v1';
const TOKEN_KEY = 'listy.github-token';

function browserStore(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Browser storage is not available.');
  }
  return window.localStorage;
}

export async function loadTasks(): Promise<Task[]> {
  const value = Platform.OS === 'web'
    ? browserStore().getItem(TASKS_KEY)
    : await AsyncStorage.getItem(TASKS_KEY);
  if (!value) return [];

  try {
    const tasks: unknown = JSON.parse(value);
    return Array.isArray(tasks) ? tasks as Task[] : [];
  } catch {
    return [];
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  const value = JSON.stringify(tasks);
  if (Platform.OS === 'web') {
    browserStore().setItem(TASKS_KEY, value);
  } else {
    await AsyncStorage.setItem(TASKS_KEY, value);
  }
}

export async function loadSettings(): Promise<LocalSettings | null> {
  const value = Platform.OS === 'web'
    ? browserStore().getItem(SETTINGS_KEY)
    : await AsyncStorage.getItem(SETTINGS_KEY);
  if (!value) return null;

  try {
    return JSON.parse(value) as LocalSettings;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: LocalSettings): Promise<void> {
  const value = JSON.stringify(settings);
  if (Platform.OS === 'web') {
    browserStore().setItem(SETTINGS_KEY, value);
  } else {
    await AsyncStorage.setItem(SETTINGS_KEY, value);
  }
}

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      throw new Error('Session storage is not available in this browser.');
    }
    window.sessionStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(TOKEN_KEY);
    }
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
