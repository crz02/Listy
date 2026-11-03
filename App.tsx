import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { pullTasks, pushTasks, RemoteFileNotFoundError } from './src/github';
import { localDateKey, serializeTasks } from './src/markdown';
import { clearToken, loadSettings, loadTasks, loadToken, saveSettings, saveTasks, saveToken } from './src/storage';
import type { LocalSettings, Priority, RepositorySettings, Task } from './src/types';

type TaskFilter = 'All' | 'Today' | 'Upcoming' | 'Done';

const colors = {
  background: '#100D19',
  surface: '#1C1728',
  elevated: '#282136',
  border: '#383049',
  text: '#F6F1FB',
  muted: '#A89EB8',
  pink: '#F48FB1',
  lavender: '#B9A5FF',
  mint: '#85D6BC',
  gold: '#F6C978',
  red: '#F28A9C',
};

const priorities: Priority[] = ['low', 'medium', 'high'];
const categories = ['Personal', 'Study', 'Work', 'Other'];
const filters: TaskFilter[] = ['All', 'Today', 'Upcoming', 'Done'];

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('All');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState('Personal');
  const [priority, setPriority] = useState<Priority>('medium');
  const [repositoryOwner, setRepositoryOwner] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('tasks.md');
  const [tokenDraft, setTokenDraft] = useState('');
  const [syncStatus, setSyncStatus] = useState('Saved on this device');
  const [errorMessage, setErrorMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const revision = useRef(0);
  const settingsRef = useRef<LocalSettings | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadTasks(), loadSettings(), loadToken()])
      .then(([savedTasks, savedSettings, savedToken]) => {
        if (!active) return;
        setTasks(savedTasks);
        setSettings(savedSettings);
        settingsRef.current = savedSettings;
        setToken(savedToken ?? '');
        setRepositoryOwner(savedSettings?.repository.owner ?? '');
        setRepositoryName(savedSettings?.repository.repository ?? '');
        setRepositoryPath(savedSettings?.repository.path ?? 'tasks.md');
        setSyncStatus(savedToken && savedSettings ? 'Connected to private GitHub repo' : 'Saved on this device');
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(errorText(error));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setHydrated(true);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    const snapshot = tasks;
    const snapshotRevision = revision.current;
    const timer = setTimeout(() => {
      void saveTasks(snapshot)
        .then(async () => {
          const currentSettings = settingsRef.current;
          if (!currentSettings || !token) {
            setSyncStatus('Saved on this device');
            setDirty(false);
            return;
          }
          setSyncStatus('Syncing your quests…');
          try {
            const sha = await pushTasks(currentSettings.repository, token, snapshot, currentSettings.remoteSha);
            const nextSettings = { ...currentSettings, remoteSha: sha };
            await saveSettings(nextSettings);
            settingsRef.current = nextSettings;
            setSettings(nextSettings);
            if (revision.current === snapshotRevision) {
              setDirty(false);
              setSyncStatus('Synced with your private repo');
              setErrorMessage('');
            }
          } catch (error) {
            setSyncStatus('Saved here · GitHub sync needs attention');
            setErrorMessage(errorText(error));
          }
        })
        .catch((error: unknown) => {
          setErrorMessage(`Could not save your tasks on this device: ${errorText(error)}`);
        });
    }, settingsRef.current && token ? 850 : 150);
    return () => clearTimeout(timer);
  }, [dirty, hydrated, tasks, token]);

  const today = localDateKey();
  const todayCompletions = useMemo(
    () => tasks.filter((task) => task.completedAt === today).length,
    [tasks, today],
  );
  const streak = useMemo(() => calculateStreak(tasks, today), [tasks, today]);
  const openCount = tasks.filter((task) => !task.completedAt).length;
  const heatmap = useMemo(() => buildHeatmap(tasks), [tasks]);
  const visibleTasks = tasks.filter((task) => {
    if (filter === 'Done') return Boolean(task.completedAt);
    if (filter === 'Today') return !task.completedAt && (!task.dueDate || task.dueDate <= today);
    if (filter === 'Upcoming') return !task.completedAt && Boolean(task.dueDate && task.dueDate > today);
    return true;
  });

  function updateTasks(nextTasks: Task[]) {
    revision.current += 1;
    setTasks(nextTasks);
    setDirty(true);
    setErrorMessage('');
  }

  function addTask() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setErrorMessage('Give your quest a name first.');
      return;
    }
    if (dueDate && !isDate(dueDate)) {
      setErrorMessage('Enter the due date as YYYY-MM-DD.');
      return;
    }
    const task: Task = {
      id: createId(),
      title: cleanTitle,
      createdAt: today,
      updatedAt: today,
      priority,
      category,
      ...(dueDate ? { dueDate } : {}),
    };
    updateTasks([task, ...tasks]);
    setTitle('');
    setDueDate('');
    setErrorMessage('');
  }

  function toggleTask(task: Task) {
    updateTasks(tasks.map((item) => item.id === task.id
      ? { ...item, updatedAt: today, completedAt: item.completedAt ? undefined : today }
      : item));
  }

  function deleteTask(task: Task) {
    updateTasks(tasks.filter((item) => item.id !== task.id));
  }

  async function connectRepository() {
    const repository: RepositorySettings = {
      owner: repositoryOwner.trim(),
      repository: repositoryName.trim(),
      path: repositoryPath.trim() || 'tasks.md',
    };
    const credential = tokenDraft.trim() || token;
    if (!/^[A-Za-z0-9._-]+$/.test(repository.owner) || !/^[A-Za-z0-9._-]+$/.test(repository.repository)) {
      setErrorMessage('Enter a valid GitHub owner and repository name.');
      return;
    }
    if (!credential) {
      setErrorMessage('Add a GitHub fine-grained token with Contents read/write access to this private repo.');
      return;
    }
    if (repository.path.startsWith('/') || repository.path.split('/').includes('..')) {
      setErrorMessage('Enter a repository-relative Markdown file path.');
      return;
    }

    setSyncStatus('Connecting to GitHub…');
    setErrorMessage('');
    try {
      let nextTasks = tasks;
      let sha: string;
      try {
        const remote = await pullTasks(repository, credential);
        sha = remote.sha;
        if (tasks.length === 0) {
          nextTasks = remote.tasks;
        } else {
          const combined = new Map(remote.tasks.map((task) => [task.id, task]));
          for (const task of tasks) {
            const remoteTask = combined.get(task.id);
            if (!remoteTask || (task.updatedAt ?? task.createdAt) > (remoteTask.updatedAt ?? remoteTask.createdAt)) {
              combined.set(task.id, task);
            }
          }
          nextTasks = [...combined.values()];
          if (serializeTasks(nextTasks) !== serializeTasks(remote.tasks)) {
            sha = await pushTasks(repository, credential, nextTasks, remote.sha);
          }
        }
      } catch (error) {
        if (!(error instanceof RemoteFileNotFoundError)) throw error;
        sha = await pushTasks(repository, credential, tasks);
      }

      const nextSettings = { repository, remoteSha: sha };
      await Promise.all([saveToken(credential), saveSettings(nextSettings), saveTasks(nextTasks)]);
      setToken(credential);
      setTokenDraft('');
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setTasks(nextTasks);
      setDirty(false);
      setSyncStatus('Synced with your private repo');
    } catch (error) {
      setSyncStatus('Not connected');
      setErrorMessage(errorText(error));
    }
  }

  async function pullLatest() {
    if (!settings || !token) return;
    setSyncStatus('Pulling latest Markdown…');
    setErrorMessage('');
    try {
      const remote = await pullTasks(settings.repository, token);
      const nextSettings = { ...settings, remoteSha: remote.sha };
      await Promise.all([saveTasks(remote.tasks), saveSettings(nextSettings)]);
      revision.current += 1;
      setTasks(remote.tasks);
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setDirty(false);
      setSyncStatus('Pulled the latest version');
    } catch (error) {
      setSyncStatus('Could not pull latest version');
      setErrorMessage(errorText(error));
    }
  }

  async function syncNow() {
    const currentSettings = settingsRef.current;
    if (!currentSettings || !token) return;
    const snapshot = tasks;
    const snapshotRevision = revision.current;
    setSyncStatus('Syncing your quests…');
    setErrorMessage('');
    try {
      await saveTasks(snapshot);
      const sha = await pushTasks(currentSettings.repository, token, snapshot, currentSettings.remoteSha);
      const nextSettings = { ...currentSettings, remoteSha: sha };
      await saveSettings(nextSettings);
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      if (revision.current === snapshotRevision) setDirty(false);
      setSyncStatus('Synced with your private repo');
    } catch (error) {
      setSyncStatus('Saved here · GitHub sync needs attention');
      setErrorMessage(errorText(error));
    }
  }

  async function disconnectRepository() {
    try {
      await clearToken();
      setToken('');
      setTokenDraft('');
      settingsRef.current = null;
      setSettings(null);
      setSyncStatus('Saved on this device');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  }

  if (loading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loading}>
          <StatusBar style="light" />
          <ActivityIndicator color={colors.pink} size="large" />
          <Text style={styles.mutedText}>Opening your quest journal…</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.page}>
          <View style={styles.topbar}>
            <View style={styles.brand}>
              <View style={styles.brandMark}><Text style={styles.brandMarkText}>✦</Text></View>
              <View>
                <Text style={styles.brandName}>LISTY</Text>
                <Text style={styles.eyebrow}>YOUR PERSONAL QUEST LOG</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSettingsOpen(!settingsOpen)}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
            >
              <Text style={styles.settingsButtonText}>{settingsOpen ? 'Close' : '⚙ Settings'}</Text>
            </Pressable>
          </View>

          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>A NEW DAY, A NEW CHAPTER</Text>
              <Text style={styles.heroTitle}>Your quests,{'\n'}your pace.</Text>
              <Text style={styles.heroSubtitle}>
                {openCount ? `${openCount} ${openCount === 1 ? 'quest' : 'quests'} waiting for you.` : 'A clear page. What will you make today?'}
              </Text>
            </View>
            <View style={styles.mascot}>
              <Text style={styles.mascotFace}>ʕ•ᴥ•ʔ</Text>
              <Text style={styles.mascotCaption}>YOU GOT THIS</Text>
            </View>
          </View>

          <View style={styles.widgetRow}>
            <View style={[styles.widget, styles.streakWidget]}>
              <View style={styles.widgetHeading}>
                <Text style={styles.widgetIcon}>🔥</Text>
                <Text style={styles.widgetLabel}>CURRENT STREAK</Text>
              </View>
              <Text style={styles.streakNumber}>{streak}<Text style={styles.streakUnit}> days</Text></Text>
              <Text style={styles.widgetHint}>{streak ? 'Keep your momentum going!' : 'Complete a quest to begin.'}</Text>
            </View>
            <View style={[styles.widget, styles.todayWidget]}>
              <View style={styles.widgetHeading}>
                <Text style={styles.widgetIcon}>🌸</Text>
                <Text style={styles.widgetLabel}>TODAY</Text>
              </View>
              <Text style={styles.streakNumber}>{todayCompletions}<Text style={styles.streakUnit}> done</Text></Text>
              <Text style={styles.widgetHint}>Every little step counts.</Text>
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeading}>
              <View>
                <Text style={styles.panelTitle}>Your consistency</Text>
                <Text style={styles.panelSubtitle}>Little steps add up over time.</Text>
              </View>
              <Text style={styles.heatmapLegend}>LESS  ▪ ▪ ▪  MORE</Text>
            </View>
            <View style={styles.heatmap} accessibilityLabel="Task completion activity for the past 13 weeks">
              {heatmap.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={styles.heatmapWeek}>
                  {week.map(({ date, count }) => (
                    <View
                      key={date}
                      accessibilityLabel={`${date}: ${count} tasks completed`}
                      style={[styles.heatmapCell, { backgroundColor: heatColor(count) }]}
                    />
                  ))}
                </View>
              ))}
            </View>
            <Text style={styles.heatmapFooter}>Your last 13 weeks of completed quests</Text>
          </View>

          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.panelTitle}>Today&apos;s quests</Text>
              <Text style={styles.panelSubtitle}>{tasks.length ? `${tasks.length - openCount} complete · ${openCount} still in progress` : 'Start small. One quest is enough.'}</Text>
            </View>
            <Text style={styles.sectionBadge}>✦ FOCUS MODE</Text>
          </View>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="New task"
              onChangeText={setTitle}
              onSubmitEditing={addTask}
              placeholder="What would you like to get done?"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.taskInput}
              value={title}
            />
            <View style={styles.composerDetails}>
              <TextInput
                accessibilityLabel="Due date"
                onChangeText={setDueDate}
                placeholder="Due YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={styles.dueInput}
                value={dueDate}
              />
              <View style={styles.chipRow}>
                {priorities.map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    selected={priority === item}
                    onPress={() => setPriority(item)}
                    tint={item === 'high' ? colors.red : item === 'low' ? colors.mint : colors.lavender}
                  />
                ))}
              </View>
            </View>
            <View style={styles.composerFooter}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroller}>
                {categories.map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    selected={category === item}
                    onPress={() => setCategory(item)}
                    tint={colors.pink}
                  />
                ))}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                onPress={addTask}
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <Text style={styles.addButtonText}>＋ Add quest</Text>
              </Pressable>
            </View>
          </View>

          {errorMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroller}>
              {filters.map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === item }}
                  key={item}
                  onPress={() => setFilter(item)}
                  style={[styles.filterTab, filter === item && styles.filterTabActive]}
                >
                  <Text style={[styles.filterTabText, filter === item && styles.filterTabTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.syncLabel}>{syncStatus}</Text>
          </View>

          {visibleTasks.length ? (
            <View style={styles.taskList}>
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task)} />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>{filter === 'Done' ? '🌙' : '🪷'}</Text>
              <Text style={styles.emptyTitle}>{filter === 'Done' ? 'Nothing completed just yet' : filter === 'Upcoming' ? 'No quests on the horizon' : 'Your story starts with one small quest'}</Text>
              <Text style={styles.emptySubtitle}>{filter === 'All' || filter === 'Today' ? 'Add a task above and take it one step at a time.' : 'Your next chapter is waiting.'}</Text>
            </View>
          )}

          {settingsOpen ? (
            <View style={styles.settingsPanel}>
              <Text style={styles.panelTitle}>Private GitHub sync</Text>
              <Text style={styles.panelSubtitle}>
                Your tasks stay in a private repository you control. No Listy server or account required.
              </Text>
              <View style={styles.formRow}>
                <TextInput
                  accessibilityLabel="GitHub owner"
                  autoCapitalize="none"
                  onChangeText={setRepositoryOwner}
                  placeholder="GitHub owner"
                  placeholderTextColor={colors.muted}
                  style={styles.settingsInput}
                  value={repositoryOwner}
                />
                <TextInput
                  accessibilityLabel="Repository name"
                  autoCapitalize="none"
                  onChangeText={setRepositoryName}
                  placeholder="Private repository"
                  placeholderTextColor={colors.muted}
                  style={styles.settingsInput}
                  value={repositoryName}
                />
              </View>
              <TextInput
                accessibilityLabel="Markdown file path"
                autoCapitalize="none"
                onChangeText={setRepositoryPath}
                placeholder="tasks.md"
                placeholderTextColor={colors.muted}
                style={styles.settingsInput}
                value={repositoryPath}
              />
              <TextInput
                accessibilityLabel="GitHub fine-grained personal access token"
                autoCapitalize="none"
                onChangeText={setTokenDraft}
                placeholder={token ? 'Token saved securely · enter a new one to replace' : 'Fine-grained GitHub token'}
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.settingsInput}
                value={tokenDraft}
              />
              <Text style={styles.formHint}>
                Create a fine-grained token for this repo only, with Contents read/write access. On web, the token stays in this browser session; on mobile, it is stored in Keychain/Keystore.
              </Text>
              <Pressable onPress={() => { void Linking.openURL('https://github.com/settings/personal-access-tokens/new'); }}>
                <Text style={styles.linkText}>Create a GitHub token ↗</Text>
              </Pressable>
              <View style={styles.settingsActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={syncStatus === 'Connecting to GitHub…'}
                  onPress={() => { void connectRepository(); }}
                  style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                >
                  <Text style={styles.addButtonText}>{syncStatus === 'Connecting to GitHub…' ? 'Connecting…' : 'Connect & sync'}</Text>
                </Pressable>
                {settings && token ? (
                  <>
                    <Pressable onPress={() => { void syncNow(); }} style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Sync now</Text>
                    </Pressable>
                    <Pressable onPress={() => { void pullLatest(); }} style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Pull latest</Text>
                    </Pressable>
                    <Pressable onPress={() => { void disconnectRepository(); }} style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Disconnect</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
              <Text style={styles.formHint}>
                Markdown path: <Text style={styles.monoText}>{settings?.repository.path ?? (repositoryPath || 'tasks.md')}</Text>
                {settings?.remoteSha ? ` · revision ${settings.remoteSha.slice(0, 7)}` : ''}
              </Text>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Made for your own little adventures <Text style={styles.footerAccent}>✦</Text></Text>
            <Text style={styles.footerText}>{Platform.OS === 'web' ? 'Browser edition' : 'Mobile edition'} · your data, your repo</Text>
          </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Chip({ label, selected, tint, onPress }: { label: string; selected: boolean; tint: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && { borderColor: tint, backgroundColor: `${tint}18` }]}
    >
      <Text style={[styles.chipText, selected && { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  const overdue = task.dueDate && task.dueDate < localDateKey() && !task.completedAt;
  return (
    <View style={[styles.taskCard, task.completedAt && styles.taskCardDone]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: Boolean(task.completedAt) }}
        accessibilityLabel={`${task.completedAt ? 'Reopen' : 'Complete'} ${task.title}`}
        onPress={onToggle}
        style={[styles.checkbox, task.completedAt && styles.checkboxDone]}
      >
        <Text style={styles.checkmark}>{task.completedAt ? '✓' : ''}</Text>
      </Pressable>
      <Pressable onPress={onToggle} style={styles.taskBody}>
        <Text style={[styles.taskTitle, task.completedAt && styles.taskTitleDone]}>{task.title}</Text>
        <View style={styles.taskMeta}>
          <Text style={styles.taskCategory}>{task.category}</Text>
          {task.dueDate ? (
            <Text style={[styles.taskDue, overdue && styles.overdueText]}>
              {overdue ? 'Overdue · ' : 'Due · '}{task.dueDate}
            </Text>
          ) : null}
          <Text style={[styles.priorityText, { color: priorityColor(task.priority) }]}>{task.priority}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} onPress={onDelete} style={styles.deleteButton}>
        <Text style={styles.deleteText}>×</Text>
      </Pressable>
    </View>
  );
}

function buildHeatmap(tasks: Task[]): { date: string; count: number }[][] {
  const now = new Date();
  const days = Array.from({ length: 91 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90 + index);
    return localDateKey(date);
  });
  const completions = new Map<string, number>();
  tasks.forEach((task) => {
    if (task.completedAt) completions.set(task.completedAt, (completions.get(task.completedAt) ?? 0) + 1);
  });
  return Array.from({ length: 13 }, (_, weekIndex) =>
    days.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => ({ date, count: completions.get(date) ?? 0 })),
  );
}

function calculateStreak(tasks: Task[], today: string): number {
  const activeDays = new Set(tasks.flatMap((task) => task.completedAt ? [task.completedAt] : []));
  let date = new Date(`${today}T12:00:00`);
  if (!activeDays.has(today)) {
    date.setDate(date.getDate() - 1);
    if (!activeDays.has(localDateKey(date))) return 0;
  }
  let streak = 0;
  while (activeDays.has(localDateKey(date))) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function heatColor(count: number): string {
  if (count === 0) return '#302A3B';
  if (count === 1) return '#9C6D9A';
  if (count === 2) return '#C17DA7';
  return colors.pink;
}

function priorityColor(priorityValue: Priority): string {
  return priorityValue === 'high' ? colors.red : priorityValue === 'low' ? colors.mint : colors.lavender;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDateKey(parsed) === value;
}

function createId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 40 },
  page: { width: '100%', maxWidth: 740, alignSelf: 'center' },
  loading: { flex: 1, gap: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#3A2942', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: colors.pink, fontSize: 24 },
  brandName: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 2 },
  eyebrow: { color: colors.muted, fontSize: 9, letterSpacing: 1.6, fontWeight: '800' },
  settingsButton: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  settingsButtonText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  hero: { backgroundColor: '#261D35', borderColor: '#453351', borderWidth: 1, borderRadius: 24, padding: 22, minHeight: 180, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  heroCopy: { flexShrink: 1 },
  heroTitle: { color: colors.text, fontSize: 32, fontWeight: '900', lineHeight: 37, marginTop: 10, letterSpacing: -1 },
  heroSubtitle: { color: '#C8BCD4', fontSize: 13, marginTop: 10 },
  mascot: { width: 112, height: 112, borderRadius: 34, backgroundColor: '#382B46', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '4deg' }] },
  mascotFace: { fontSize: 31, color: '#F7C3D1', fontWeight: '700' },
  mascotCaption: { color: colors.pink, fontSize: 8, fontWeight: '900', letterSpacing: 1.1, marginTop: 6 },
  widgetRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  widget: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 16, minHeight: 128 },
  streakWidget: { backgroundColor: '#241C30' },
  todayWidget: { backgroundColor: '#211D31' },
  widgetHeading: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  widgetIcon: { fontSize: 15 },
  widgetLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.05 },
  streakNumber: { color: colors.text, fontSize: 27, fontWeight: '900', marginTop: 10 },
  streakUnit: { color: colors.pink, fontSize: 15, fontWeight: '800' },
  widgetHint: { color: colors.muted, fontSize: 10, marginTop: 4 },
  panel: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 17, marginTop: 14 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  panelTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  panelSubtitle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  heatmapLegend: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  heatmap: { flexDirection: 'row', gap: 5, marginTop: 16, alignSelf: 'center' },
  heatmapWeek: { gap: 5 },
  heatmapCell: { width: 11, height: 11, borderRadius: 3 },
  heatmapFooter: { color: colors.muted, fontSize: 10, marginTop: 11, textAlign: 'center' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 27, marginBottom: 12 },
  sectionBadge: { color: colors.lavender, backgroundColor: '#292239', overflow: 'hidden', borderRadius: 9, fontSize: 8, letterSpacing: 0.7, paddingVertical: 7, paddingHorizontal: 9, fontWeight: '900' },
  composer: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 13 },
  taskInput: { minHeight: 42, color: colors.text, fontSize: 14, paddingHorizontal: 4 },
  composerDetails: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 5 },
  dueInput: { flex: 1, minWidth: 90, height: 36, color: colors.text, fontSize: 10, paddingHorizontal: 8, backgroundColor: colors.elevated, borderRadius: 10 },
  chipRow: { flexDirection: 'row', gap: 5 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#211C2C' },
  chipText: { color: colors.muted, fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },
  composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  categoryScroller: { flexDirection: 'row', gap: 5, paddingRight: 6 },
  addButton: { backgroundColor: colors.pink, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#281726', fontSize: 11, fontWeight: '900' },
  pressed: { opacity: 0.75 },
  errorText: { color: colors.red, fontSize: 11, marginTop: 10 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 17, minHeight: 38 },
  filterScroller: { flexDirection: 'row', gap: 5 },
  filterTab: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11 },
  filterTabActive: { backgroundColor: '#352840' },
  filterTabText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  filterTabTextActive: { color: colors.pink },
  syncLabel: { color: colors.muted, fontSize: 8, marginLeft: 8, flexShrink: 1, textAlign: 'right' },
  taskList: { gap: 8, marginTop: 7 },
  taskCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  taskCardDone: { opacity: 0.72 },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 1.5, borderColor: '#756887', alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: colors.mint, borderColor: colors.mint },
  checkmark: { color: '#17261F', fontSize: 12, fontWeight: '900' },
  taskBody: { flex: 1, minWidth: 0 },
  taskTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  taskTitleDone: { color: colors.muted, textDecorationLine: 'line-through' },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 5, flexWrap: 'wrap' },
  taskCategory: { color: colors.muted, fontSize: 9 },
  taskDue: { color: colors.muted, fontSize: 9 },
  overdueText: { color: colors.red },
  priorityText: { fontSize: 9, fontWeight: '800', textTransform: 'capitalize' },
  deleteButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.muted, fontSize: 21 },
  emptyState: { borderColor: colors.border, borderStyle: 'dashed', borderWidth: 1, borderRadius: 17, padding: 26, alignItems: 'center', marginTop: 8 },
  emptyIcon: { fontSize: 27, marginBottom: 10 },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  emptySubtitle: { color: colors.muted, fontSize: 10, marginTop: 6, textAlign: 'center' },
  settingsPanel: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 17, marginTop: 20, gap: 10 },
  formRow: { flexDirection: 'row', gap: 8 },
  settingsInput: { backgroundColor: colors.elevated, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 12, color: colors.text, fontSize: 11, flex: 1 },
  formHint: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  linkText: { color: colors.lavender, fontSize: 10, fontWeight: '700' },
  settingsActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  secondaryButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  monoText: { color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  footer: { paddingVertical: 26, alignItems: 'center', gap: 5 },
  footerText: { color: colors.muted, fontSize: 9 },
  footerAccent: { color: colors.pink },
  mutedText: { color: colors.muted, fontSize: 12 },
});
