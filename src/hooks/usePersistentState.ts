import { useState, useEffect, useCallback, useRef } from 'react';
import LZString from 'lz-string';

const PROJECT_STATE_API = '/api/project-state';
const ESTIMATED_LOCAL_STORAGE_QUOTA = 5 * 1024 * 1024;
const MAX_LOCAL_STORAGE_VALUE_SIZE = 200 * 1024;
const LOCAL_STORAGE_SAFETY_BUFFER = 256 * 1024;
const STORAGE_USAGE_CACHE_MS = 30_000;
const SAVE_DEBOUNCE_MS = 900;
const PROJECT_SYNC_POLL_MS = 4000;
const PROJECT_SYNC_BACKGROUND_POLL_MS = 20_000;
const PROJECT_SYNC_RETRY_MS = 5000;
const PROJECT_SYNC_CHANNEL_NAME = 'manfei:project-state-sync';
const PERSISTENCE_DEBUG = false;
const ACTIVE_ACCOUNT_KEY = 'storyboard_active_account_id';
const ACCOUNT_KEY_PREFIX = 'storyboard_account_';
const ACCOUNT_SCOPE_CHANGED_EVENT = 'manfei:persistence-account-changed';
const PROTECTED_NON_EMPTY_KEYS = new Set<string>([
  'storyboard_file_content',
  'storyboard_scenes_data',
  'storyboard_characters_data',
  'storyboard_props_data',
  'storyboard_outline',
  'storyboard_outline_batch_info',
  'storyboard_scene_batch_info',
  'storyboard_character_batch_info',
  'storyboard_prop_batch_info',
  'storyboard_character_voice_data',
  'storyboard_voice_library',
  'storyboard_chapter_storyboards',
  'storyboard_asset_images',
]);
let cachedLocalStorageUsage = 0;
let cachedLocalStorageUsageExpiresAt = 0;

function persistenceDebugLog(...args: unknown[]): void {
  if (PERSISTENCE_DEBUG) {
    console.log(...args);
  }
}

// 存储 key 常量
export const STORAGE_KEYS = {
  UPLOADED_FILE: 'storyboard_uploaded_file',
  FILE_CONTENT: 'storyboard_file_content',
  EXECUTION_SCRIPT: 'storyboard_execution_script',
  EXECUTION_SCRIPT_SOURCE_SIGNATURE: 'storyboard_execution_script_source_signature',
  CREATION_BIBLE: 'storyboard_creation_bible',
  SCENES_DATA: 'storyboard_scenes_data',
  CHARACTERS_DATA: 'storyboard_characters_data',
  PROPS_DATA: 'storyboard_props_data',
  OUTLINE: 'storyboard_outline',
  OUTLINE_BATCH_INFO: 'storyboard_outline_batch_info',
  SCENE_BATCH_INFO: 'storyboard_scene_batch_info',
  CHARACTER_BATCH_INFO: 'storyboard_character_batch_info',
  PROP_BATCH_INFO: 'storyboard_prop_batch_info',
  CHARACTER_VOICE_DATA: 'storyboard_character_voice_data',
  VOICE_LIBRARY: 'storyboard_voice_library',
  EXTRACTION_REVIEW: 'storyboard_extraction_review',
  STORYBOARD_BATCH_INFO: 'storyboard_storyboard_batch_info',
  SELECTED_CHAPTER: 'storyboard_selected_chapter',
  STORYBOARD: 'storyboard_storyboard',
  IMAGE_STORYBOARDS: 'storyboard_image_storyboards',
  CONNECTING_PROMPTS: 'storyboard_connecting_prompts',
  VIDEO_RESULTS: 'storyboard_video_results',
  VIDEO_TOTAL_DURATION: 'storyboard_video_total_duration',
  STEP_CONFIRMED: 'storyboard_step_confirmed',
  CURRENT_STEP: 'storyboard_current_step',
  PROGRESS: 'storyboard_progress',
  VIDEO_RATIO: 'storyboard_video_ratio',
  ASSET_IMAGES: 'storyboard_asset_images',
  BATCH_ASSET_GENERATION_HISTORY: 'storyboard_batch_asset_generation_history',
  EXTRACTION_STATUS: 'storyboard_extraction_status',
  TOKEN_USAGE: 'storyboard_token_usage',
  CHAPTER_STORYBOARDS: 'storyboard_chapter_storyboards',
  ASSET_IMAGES_OBJ: 'storyboard_asset_images_obj',
  ASSET_IMAGES_LOCAL: 'storyboard_asset_images_local',
  GLOBAL_IMAGE_SETTINGS: 'storyboard_global_image_settings',
  SELECTED_SCENES: 'storyboard_selected_scenes',
  SELECTED_CHARACTERS: 'storyboard_selected_characters',
  SELECTED_PROPS: 'storyboard_selected_props',
} as const;

// Token 使用统计接口
export interface TokenUsage {
  // 各步骤的token消耗
  upload: { input: number; output: number; timestamp: number };
  executionScript: { input: number; output: number; timestamp: number };
  extractScenes: { input: number; output: number; timestamp: number };
  extractCharacters: { input: number; output: number; timestamp: number };
  extractVoices: { input: number; output: number; timestamp: number };
  extractProps: { input: number; output: number; timestamp: number };
  extractOutline: { input: number; output: number; timestamp: number };
  generateStoryboard: { input: number; output: number; timestamp: number };
  generateAssetImage: { input: number; output: number; timestamp: number }[];
  generateImageStoryboard: { input: number; output: number; timestamp: number }[];
  generatePrompts: { input: number; output: number; timestamp: number };
  generateVideo: { input: number; output: number; timestamp: number }[];
  regenerateStoryboardImage: { input: number; output: number; timestamp: number }[];
  regenerateVideo: { input: number; output: number; timestamp: number }[];
}

// Token 使用统计初始值
export const INITIAL_TOKEN_USAGE: TokenUsage = {
  upload: { input: 0, output: 0, timestamp: 0 },
  executionScript: { input: 0, output: 0, timestamp: 0 },
  extractScenes: { input: 0, output: 0, timestamp: 0 },
  extractCharacters: { input: 0, output: 0, timestamp: 0 },
  extractVoices: { input: 0, output: 0, timestamp: 0 },
  extractProps: { input: 0, output: 0, timestamp: 0 },
  extractOutline: { input: 0, output: 0, timestamp: 0 },
  generateStoryboard: { input: 0, output: 0, timestamp: 0 },
  generateAssetImage: [],
  generateImageStoryboard: [],
  generatePrompts: { input: 0, output: 0, timestamp: 0 },
  generateVideo: [],
  regenerateStoryboardImage: [],
  regenerateVideo: [],
};

// 计算总token使用量
export function calculateTotalTokens(usage: TokenUsage): { input: number; output: number; total: number } {
  let input = 0;
  let output = 0;

  // 单次调用的步骤
  const singleSteps: (keyof TokenUsage)[] = [
    'upload', 'executionScript', 'extractScenes', 'extractCharacters', 'extractVoices', 'extractProps',
    'extractOutline', 'generateStoryboard', 'generatePrompts'
  ];

  singleSteps.forEach(step => {
    const item = usage[step];
    if (item && 'input' in item) {
      input += (item as { input: number; output: number }).input;
      output += (item as { input: number; output: number }).output;
    }
  });

  // 数组类型的步骤
  const arraySteps: (keyof TokenUsage)[] = [
    'generateAssetImage', 'generateImageStoryboard', 'generateVideo',
    'regenerateStoryboardImage', 'regenerateVideo'
  ];

  arraySteps.forEach(step => {
    const items = usage[step];
    if (Array.isArray(items)) {
      items.forEach(item => {
        input += item.input;
        output += item.output;
      });
    }
  });

  return { input, output, total: input + output };
}

/**
 * 压缩数据以减少存储占用
 * 小数据直接用 JSON.stringify，大数据用 lz-string 压缩
 */
function compressData<T>(value: T): string {
  try {
    const serialized = JSON.stringify(value);
    // 超过 50KB 才压缩，小数据不值得压缩开销
    if (serialized.length > 50 * 1024) {
      const compressed = LZString.compressToUTF16(serialized);
      persistenceDebugLog(`[持久化] 压缩: ${serialized.length} → ${compressed.length} 字符 (${((1 - compressed.length / serialized.length) * 100).toFixed(0)}%)`);
      return 'LZ:' + compressed;
    }
    return serialized;
  } catch (error) {
    console.error('[持久化] 数据序列化失败:', error);
    throw error;
  }
}

/**
 * 解压从 localStorage 读取的数据
 */
function decompressData(stored: string): string {
  if (stored.startsWith('LZ:')) {
    try {
      return LZString.decompressFromUTF16(stored.slice(3)) || stored;
    } catch {
      console.warn('[持久化] 解压失败，使用原始数据');
      return stored;
    }
  }
  return stored;
}

function isStoryboardStateKey(key: string): boolean {
  return key.startsWith('storyboard_');
}

function safeAccountKey(accountId: string): string {
  return accountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'account';
}

function getScopedStorageKey(key: string, accountId: string | null): string {
  return accountId ? `${ACCOUNT_KEY_PREFIX}${safeAccountKey(accountId)}_${key}` : key;
}

function isScopedStoryboardStateKey(key: string): boolean {
  return key.startsWith(ACCOUNT_KEY_PREFIX) || key.startsWith('storyboard_');
}

function isLegacyRawStoryboardStateKey(key: string): boolean {
  return key.startsWith('storyboard_') &&
    !key.startsWith(ACCOUNT_KEY_PREFIX) &&
    key !== ACTIVE_ACCOUNT_KEY;
}

interface ProjectStateSyncUpdate {
  key: string;
  value: string | null;
  revision: number;
  keyRevision: number;
}

type ProjectStateSyncListener = (update: ProjectStateSyncUpdate) => void;

const projectStateSyncListeners = new Map<string, Set<ProjectStateSyncListener>>();
let projectStateSyncAccountId: string | null = null;
let projectStateSyncRevision = 0;
let projectStateSyncGeneration = 0;
let projectStateSyncTimer: ReturnType<typeof setTimeout> | null = null;
let projectStateSyncInFlight = false;
let projectStateSyncChannel: BroadcastChannel | null = null;
let projectStateSyncClientId = '';
let projectStateSyncWindowListenersReady = false;

function getProjectStateSyncClientId(): string {
  if (!projectStateSyncClientId) {
    projectStateSyncClientId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return projectStateSyncClientId;
}

function dispatchProjectStateSyncUpdate(update: ProjectStateSyncUpdate): void {
  projectStateSyncListeners.get(update.key)?.forEach((listener) => {
    try {
      listener(update);
    } catch (error) {
      console.warn(`[多端同步] 应用远端状态失败: ${update.key}`, error);
    }
  });
}

function getProjectStateSyncDelay(): number {
  return typeof document !== 'undefined' && document.hidden
    ? PROJECT_SYNC_BACKGROUND_POLL_MS
    : PROJECT_SYNC_POLL_MS;
}

function scheduleProjectStateSync(delay = getProjectStateSyncDelay()): void {
  if (typeof window === 'undefined' || !projectStateSyncAccountId || projectStateSyncListeners.size === 0) {
    return;
  }

  if (projectStateSyncTimer) {
    clearTimeout(projectStateSyncTimer);
  }
  projectStateSyncTimer = setTimeout(() => {
    projectStateSyncTimer = null;
    void pollProjectStateChanges();
  }, delay);
}

async function pollProjectStateChanges(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    projectStateSyncInFlight ||
    !projectStateSyncAccountId ||
    projectStateSyncListeners.size === 0
  ) {
    return;
  }

  projectStateSyncInFlight = true;
  const accountId = projectStateSyncAccountId;
  const generation = projectStateSyncGeneration;

  try {
    const response = await fetch(`${PROJECT_STATE_API}?since=${projectStateSyncRevision}`, {
      cache: 'no-store',
      headers: { 'X-Skip-Login-Prompt': '1' },
    });

    if (
      response.status === 401 ||
      accountId !== projectStateSyncAccountId ||
      generation !== projectStateSyncGeneration
    ) {
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (
      !result?.success ||
      accountId !== projectStateSyncAccountId ||
      generation !== projectStateSyncGeneration
    ) return;

    const revision = Number.isInteger(result.revision) ? result.revision : projectStateSyncRevision;
    const state = result.state && typeof result.state === 'object'
      ? result.state as Record<string, string>
      : {};
    const keyRevisions = result.keyRevisions && typeof result.keyRevisions === 'object'
      ? result.keyRevisions as Record<string, number>
      : {};

    if (result.reset) {
      projectStateSyncListeners.forEach((_listeners, stateKey) => {
        dispatchProjectStateSyncUpdate({
          key: stateKey,
          value: typeof state[stateKey] === 'string' ? state[stateKey] : null,
          revision,
          keyRevision: Number(keyRevisions[stateKey]) || revision,
        });
      });
    } else {
      Object.entries(state).forEach(([stateKey, value]) => {
        if (typeof value !== 'string') return;
        dispatchProjectStateSyncUpdate({
          key: stateKey,
          value,
          revision,
          keyRevision: Number(keyRevisions[stateKey]) || revision,
        });
      });

      if (Array.isArray(result.deletedKeys)) {
        result.deletedKeys.forEach((stateKey: unknown) => {
          if (typeof stateKey !== 'string') return;
          dispatchProjectStateSyncUpdate({
            key: stateKey,
            value: null,
            revision,
            keyRevision: Number(keyRevisions[stateKey]) || revision,
          });
        });
      }
    }

    projectStateSyncRevision = revision;
  } catch (error) {
    persistenceDebugLog('[多端同步] 拉取远端变更失败，将自动重试:', error);
  } finally {
    if (generation === projectStateSyncGeneration) {
      projectStateSyncInFlight = false;
    }
    if (
      accountId === projectStateSyncAccountId &&
      generation === projectStateSyncGeneration
    ) {
      scheduleProjectStateSync();
    }
  }
}

function requestImmediateProjectStateSync(): void {
  if (projectStateSyncTimer) {
    clearTimeout(projectStateSyncTimer);
    projectStateSyncTimer = null;
  }
  void pollProjectStateChanges();
}

function ensureProjectStateSyncWindowListeners(): void {
  if (typeof window === 'undefined' || projectStateSyncWindowListenersReady) return;

  const handleResume = () => requestImmediateProjectStateSync();
  window.addEventListener('focus', handleResume);
  window.addEventListener('online', handleResume);
  document.addEventListener('visibilitychange', handleResume);
  projectStateSyncWindowListenersReady = true;
}

function ensureProjectStateSyncChannel(): void {
  if (typeof window === 'undefined' || projectStateSyncChannel || typeof BroadcastChannel === 'undefined') return;

  projectStateSyncChannel = new BroadcastChannel(PROJECT_SYNC_CHANNEL_NAME);
  projectStateSyncChannel.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    if (
      !message ||
      message.clientId === getProjectStateSyncClientId() ||
      message.accountId !== projectStateSyncAccountId ||
      typeof message.key !== 'string'
    ) {
      return;
    }

    dispatchProjectStateSyncUpdate({
      key: message.key,
      value: typeof message.value === 'string' ? message.value : null,
      revision: Number(message.revision) || projectStateSyncRevision,
      keyRevision: Number(message.keyRevision) || Number(message.revision) || projectStateSyncRevision,
    });
  });
}

function subscribeProjectStateSync(
  accountId: string,
  key: string,
  listener: ProjectStateSyncListener,
  initialRevision = 0
): () => void {
  if (projectStateSyncAccountId !== accountId) {
    projectStateSyncAccountId = accountId;
    projectStateSyncRevision = initialRevision;
    projectStateSyncGeneration += 1;
    projectStateSyncInFlight = false;
  } else if (initialRevision > projectStateSyncRevision) {
    projectStateSyncRevision = initialRevision;
  }

  const listeners = projectStateSyncListeners.get(key) || new Set<ProjectStateSyncListener>();
  listeners.add(listener);
  projectStateSyncListeners.set(key, listeners);

  ensureProjectStateSyncWindowListeners();
  ensureProjectStateSyncChannel();
  scheduleProjectStateSync(0);

  return () => {
    const currentListeners = projectStateSyncListeners.get(key);
    currentListeners?.delete(listener);
    if (currentListeners?.size === 0) {
      projectStateSyncListeners.delete(key);
    }
    if (projectStateSyncListeners.size === 0 && projectStateSyncTimer) {
      clearTimeout(projectStateSyncTimer);
      projectStateSyncTimer = null;
    }
  };
}

function publishProjectStateSyncUpdate(
  accountId: string | null,
  key: string,
  value: string,
  result: { revision?: number; keyRevision?: number }
): void {
  if (!accountId || typeof window === 'undefined') return;

  const update: ProjectStateSyncUpdate = {
    key,
    value,
    revision: Number(result.revision) || 0,
    keyRevision: Number(result.keyRevision) || Number(result.revision) || 0,
  };
  projectStateSyncChannel?.postMessage({
    ...update,
    accountId,
    clientId: getProjectStateSyncClientId(),
  });
}

let accountIdPromise: Promise<string | null> | null = null;

interface ProjectStateBootstrapResult {
  state: Record<string, string>;
  blockedByLogin: boolean;
  revision: number;
  keyRevisions: Record<string, number>;
}

let projectStateBootstrapAccountId: string | null = null;
let projectStateBootstrapPromise: Promise<ProjectStateBootstrapResult> | null = null;

function resetProjectStateBootstrap(): void {
  projectStateBootstrapAccountId = null;
  projectStateBootstrapPromise = null;
}

function loadProjectStateBootstrap(accountId: string): Promise<ProjectStateBootstrapResult> {
  if (projectStateBootstrapAccountId !== accountId) {
    projectStateBootstrapAccountId = accountId;
    projectStateBootstrapPromise = null;
  }

  if (!projectStateBootstrapPromise) {
    projectStateBootstrapPromise = fetch(PROJECT_STATE_API, {
      cache: 'no-store',
      headers: { 'X-Skip-Login-Prompt': '1' },
    }).then(async (response) => {
      if (response.status === 401) {
        return { state: {}, blockedByLogin: true, revision: 0, keyRevisions: {} };
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      return {
        state: result?.success && result.state && typeof result.state === 'object'
          ? result.state as Record<string, string>
          : {},
        blockedByLogin: false,
        revision: Number(result?.revision) || 0,
        keyRevisions: result?.keyRevisions && typeof result.keyRevisions === 'object'
          ? result.keyRevisions as Record<string, number>
          : {},
      };
    }).catch((error) => {
      console.warn('[持久化] 批量读取项目状态失败，将使用浏览器缓存:', error);
      return { state: {}, blockedByLogin: false, revision: 0, keyRevisions: {} };
    });
  }

  return projectStateBootstrapPromise;
}

export function notifyPersistenceAccountChanged(): void {
  accountIdPromise = null;
  resetProjectStateBootstrap();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCOUNT_SCOPE_CHANGED_EVENT));
  }
}

async function resolvePersistenceAccountId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (!accountIdPromise) {
    accountIdPromise = fetch('/api/creation-points?view=summary', {
      cache: 'no-store',
      headers: { 'X-Skip-Login-Prompt': '1' },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = await response.json();
        const accountId = typeof result?.account?.id === 'string' ? result.account.id : '';
        return accountId || null;
      })
      .catch(() => null);
  }
  return accountIdPromise;
}

function isEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return value === null || value === undefined;
}

async function backupStateToServer(
  key: string,
  serializedValue: string,
  options?: { keepalive?: boolean; isCurrent?: () => boolean }
): Promise<boolean> {
  if (typeof window === 'undefined' || !isStoryboardStateKey(key)) return false;

  try {
    const body = JSON.stringify({
      key,
      value: serializedValue,
      clientId: getProjectStateSyncClientId(),
    });
    const canKeepAlive = !!options?.keepalive && body.length < 60 * 1024;

    if (canKeepAlive && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        PROJECT_STATE_API,
        new Blob([body], { type: 'application/json' })
      );
      if (sent) return true;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (options?.isCurrent && !options.isCurrent()) return false;

      try {
        const response = await fetch(PROJECT_STATE_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Skip-Login-Prompt': '1',
          },
          body,
          keepalive: canKeepAlive,
        });
        if (response.ok) {
          const result = await response.json().catch(() => ({}));
          publishProjectStateSyncUpdate(
            window.localStorage.getItem(ACTIVE_ACCOUNT_KEY),
            key,
            serializedValue,
            result
          );
          return true;
        }
        if (response.status === 401) return false;
        if (attempt === 2) {
          console.warn(`[持久化] 本地文件备份失败: ${key}, HTTP ${response.status}`);
        }
      } catch (error) {
        if (attempt === 2) {
          console.warn(`[持久化] 本地文件备份请求失败: ${key}`, error);
        }
      }

      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(1000 * (2 ** attempt), PROJECT_SYNC_RETRY_MS));
      });
    }
  } catch (error) {
    console.warn(`[持久化] 准备本地文件备份失败: ${key}`, error);
  }

  return false;
}

async function restoreStateFromServer(key: string, accountId: string): Promise<{
  value: string | null;
  blockedByLogin: boolean;
  revision: number;
  keyRevision: number;
}> {
  if (typeof window === 'undefined' || !isStoryboardStateKey(key)) {
    return { value: null, blockedByLogin: false, revision: 0, keyRevision: 0 };
  }

  try {
    const data = await loadProjectStateBootstrap(accountId);
    return {
      value: typeof data.state[key] === 'string' ? data.state[key] : null,
      blockedByLogin: data.blockedByLogin,
      revision: data.revision,
      keyRevision: Number(data.keyRevisions[key]) || 0,
    };
  } catch (error) {
    console.warn(`[持久化] 读取本地文件备份失败: ${key}`, error);
    return { value: null, blockedByLogin: false, revision: 0, keyRevision: 0 };
  }
}

function deleteStateBackup(key?: string): void {
  if (typeof window === 'undefined') return;

  const url = key
    ? `${PROJECT_STATE_API}?key=${encodeURIComponent(key)}`
    : PROJECT_STATE_API;

  void fetch(url, {
    method: 'DELETE',
    headers: { 'X-Skip-Login-Prompt': '1' },
  }).then((response) => {
    if (!response.ok) {
      console.warn(`[持久化] 清除本地文件备份失败: HTTP ${response.status}`);
    }
  }).catch((error) => {
    console.warn('[持久化] 清除本地文件备份请求失败:', error);
  });
}

/**
 * 检查存储空间是否充足
 */
function checkStorageSpace(requiredSize: number): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const now = Date.now();
    let usedSpace = cachedLocalStorageUsage;
    if (now >= cachedLocalStorageUsageExpiresAt) {
      usedSpace = 0;
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          const value = window.localStorage.getItem(key);
          if (value) {
            usedSpace += new Blob([value]).size;
          }
        }
      }
      cachedLocalStorageUsage = usedSpace;
      cachedLocalStorageUsageExpiresAt = now + STORAGE_USAGE_CACHE_MS;
    }

    // localStorage 通常限制在 5-10MB；这里保守按 5MB 估算。
    const remainingSpace = ESTIMATED_LOCAL_STORAGE_QUOTA - usedSpace;

    persistenceDebugLog(`[持久化] 存储空间: 已用 ${(usedSpace / 1024).toFixed(2)} KB, 剩余 ${(remainingSpace / 1024).toFixed(2)} KB, 需要 ${(requiredSize / 1024).toFixed(2)} KB`);

    return remainingSpace > requiredSize + LOCAL_STORAGE_SAFETY_BUFFER;
  } catch (error) {
    console.error('[持久化] 检查存储空间失败:', error);
    return false;
  }
}

/**
 * 状态持久化 Hook
 * 自动保存状态到 localStorage 和项目本地文件备份，并在页面加载时恢复
 *
 * 注意：为避免 SSR hydration mismatch，服务端和客户端初始渲染时都使用 initialValue，
 * 然后在客户端 useEffect 中同步 localStorage 的值
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // 初始状态始终使用 initialValue，避免 SSR hydration mismatch
  const [state, setState] = useState<T>(initialValue);
  const initialValueRef = useRef(initialValue);
  const hasHydratedRef = useRef(false);
  const stateRef = useRef(state);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleSaveHandleRef = useRef<number | null>(null);
  const saveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<T | null>(null);
  const pendingSaveVersionRef = useRef(0);
  const hasPendingSaveRef = useRef(false);
  const localMutationVersionRef = useRef(0);
  const persistedMutationVersionRef = useRef(0);
  const lastAppliedSerializedRef = useRef<string | null>(null);
  const retrySaveRef = useRef<(value: T, mutationVersion: number) => void>(() => undefined);
  const accountIdRef = useRef<string | null>(null);
  const scopedKeyRef = useRef(key);
  const [accountScopeVersion, setAccountScopeVersion] = useState(0);

  // 始终保持 ref 指向最新 state
  stateRef.current = state;

  useEffect(() => {
    const handleAccountScopeChanged = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (idleSaveHandleRef.current !== null) {
        window.cancelIdleCallback?.(idleSaveHandleRef.current);
        idleSaveHandleRef.current = null;
      }
      if (saveRetryTimerRef.current) {
        clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
      pendingSaveRef.current = null;
      pendingSaveVersionRef.current = 0;
      hasPendingSaveRef.current = false;
      hasHydratedRef.current = false;
      localMutationVersionRef.current = 0;
      persistedMutationVersionRef.current = 0;
      lastAppliedSerializedRef.current = null;
      accountIdRef.current = null;
      stateRef.current = initialValueRef.current;
      setState(initialValueRef.current);
      setAccountScopeVersion((version) => version + 1);
    };

    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleAccountScopeChanged);
    return () => window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleAccountScopeChanged);
  }, []);

  // 客户端 hydration：优先从项目本地文件备份恢复；备份不存在时使用 localStorage
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const previousAccountId = accountIdRef.current;
        const previousActiveAccountId = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
        const accountId = await resolvePersistenceAccountId();
        accountIdRef.current = accountId;
        scopedKeyRef.current = getScopedStorageKey(key, accountId);

        if (!accountId) {
          window.localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
          persistenceDebugLog(`[持久化] 未登录，跳过账号状态恢复: ${key}`);
          return;
        }

        const backupResult = await restoreStateFromServer(key, accountId);
        if (backupResult.blockedByLogin) {
          persistenceDebugLog(`[持久化] 未登录，跳过状态恢复: ${key}`);
          return;
        }

        window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);

        const scopedKey = scopedKeyRef.current;
        const item = window.localStorage.getItem(scopedKey);
        const legacyItem = item || previousActiveAccountId
          ? null
          : window.localStorage.getItem(key);
        const backup = backupResult.value;
        const serialized = backup || item || legacyItem;

        if (serialized) {
          const decompressed = decompressData(serialized);
          const parsed = JSON.parse(decompressed);
          lastAppliedSerializedRef.current = serialized;

          if (backup) {
            try {
              const backupSize = new Blob([backup]).size;
              if (backupSize <= MAX_LOCAL_STORAGE_VALUE_SIZE && checkStorageSpace(backupSize)) {
                window.localStorage.setItem(scopedKey, backup);
              } else {
                window.localStorage.removeItem(scopedKey);
                persistenceDebugLog(`[持久化] ${key} 已从本地文件恢复，跳过浏览器缓存 (${(backupSize / 1024).toFixed(2)} KB)`);
              }
            } catch (storageError) {
              console.warn(`[持久化] 浏览器存储空间不足，状态仅从本地文件恢复: ${key}`, storageError);
            }
          } else if (item || legacyItem) {
            if (legacyItem) {
              window.localStorage.setItem(scopedKey, legacyItem);
              window.localStorage.removeItem(key);
              persistenceDebugLog(`[持久化] 已将旧浏览器缓存迁入当前账号: ${key}`);
            }
            void backupStateToServer(key, item || legacyItem || '');
          }

          persistenceDebugLog(`[持久化] 从${backup ? '本地文件备份' : '浏览器'}恢复状态: ${key}`);
          if (!cancelled) {
            stateRef.current = parsed;
            setState(parsed);
          }
          return;
        }

        if (
          previousAccountId === null &&
          !previousActiveAccountId &&
          !isEmptyValue(stateRef.current)
        ) {
          const currentSerialized = compressData(stateRef.current);
          const currentSize = new Blob([currentSerialized]).size;
          void backupStateToServer(key, currentSerialized);
          if (currentSize <= MAX_LOCAL_STORAGE_VALUE_SIZE && checkStorageSpace(currentSize)) {
            window.localStorage.setItem(scopedKey, currentSerialized);
          }
          persistenceDebugLog(`[持久化] 已将登录前的当前状态保存到账号: ${key}`);
        }

        persistenceDebugLog(`[持久化] 无数据: ${key}，使用默认值`);
      } catch (error) {
        console.error(`[持久化] 读取失败: ${key}`, error);

        const accountId = accountIdRef.current || await resolvePersistenceAccountId();
        const backupResult = accountId
          ? await restoreStateFromServer(key, accountId)
          : { value: null, blockedByLogin: true, revision: 0, keyRevision: 0 };
        const backup = backupResult.blockedByLogin ? null : backupResult.value;
        if (backup) {
          try {
            const decompressed = decompressData(backup);
            const parsed = JSON.parse(decompressed);
            lastAppliedSerializedRef.current = backup;
            persistenceDebugLog(`[持久化] 浏览器数据异常，已从本地文件备份恢复: ${key}`);
            if (!cancelled) {
              stateRef.current = parsed;
              setState(parsed);
            }
          } catch (backupError) {
            console.error(`[持久化] 本地文件备份也无法恢复: ${key}`, backupError);
          }
        }
      } finally {
        // 标记 hydration 完成，之后才允许保存
        if (!cancelled) {
          hasHydratedRef.current = true;
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [key, accountScopeVersion]);

  // 账号在其他电脑或标签页发生变化时，增量更新当前 Hook 的状态。
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;

    const subscribe = async () => {
      const accountId = await resolvePersistenceAccountId();
      if (!accountId || cancelled) return;

      const bootstrap = await loadProjectStateBootstrap(accountId);
      if (bootstrap.blockedByLogin || cancelled) return;

      unsubscribe = subscribeProjectStateSync(accountId, key, (update) => {
        if (
          accountIdRef.current !== accountId ||
          !hasHydratedRef.current ||
          update.value === lastAppliedSerializedRef.current
        ) {
          return;
        }

        if (update.value === null) {
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          if (idleSaveHandleRef.current !== null) {
            window.cancelIdleCallback?.(idleSaveHandleRef.current);
            idleSaveHandleRef.current = null;
          }
          if (saveRetryTimerRef.current) {
            clearTimeout(saveRetryTimerRef.current);
            saveRetryTimerRef.current = null;
          }
          pendingSaveRef.current = null;
          pendingSaveVersionRef.current = 0;
          hasPendingSaveRef.current = false;
          localMutationVersionRef.current = 0;
          persistedMutationVersionRef.current = 0;
          lastAppliedSerializedRef.current = null;
          window.localStorage.removeItem(scopedKeyRef.current);
          stateRef.current = initialValueRef.current;
          setState(initialValueRef.current);
          return;
        }

        const hasUnsavedLocalChange = (
          hasPendingSaveRef.current ||
          localMutationVersionRef.current > persistedMutationVersionRef.current
        );
        if (hasUnsavedLocalChange) {
          persistenceDebugLog(`[多端同步] ${key} 存在本机未保存修改，暂不应用远端版本`);
          return;
        }

        try {
          const parsed = JSON.parse(decompressData(update.value)) as T;
          const serializedSize = new Blob([update.value]).size;

          if (
            serializedSize <= MAX_LOCAL_STORAGE_VALUE_SIZE &&
            checkStorageSpace(serializedSize)
          ) {
            window.localStorage.setItem(scopedKeyRef.current, update.value);
          } else {
            window.localStorage.removeItem(scopedKeyRef.current);
          }

          lastAppliedSerializedRef.current = update.value;
          stateRef.current = parsed;
          setState(parsed);
          window.dispatchEvent(new CustomEvent('manfei:project-state-synced', {
            detail: {
              key,
              revision: update.revision,
              keyRevision: update.keyRevision,
            },
          }));
        } catch (error) {
          console.warn(`[多端同步] 无法解析远端状态: ${key}`, error);
        }
      }, bootstrap.revision);
    };

    void subscribe();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, accountScopeVersion]);

  // 保存到 localStorage，并同步写入项目本地文件备份
  const saveToStorage = useCallback((
    value: T,
    options?: { keepalive?: boolean },
    mutationVersion = localMutationVersionRef.current
  ) => {
    if (typeof window === 'undefined') return;

    // 🛡️ 防误写保护 1：hydration 完成前禁止保存
    if (!hasHydratedRef.current) {
      persistenceDebugLog(`[持久化] 跳过保存 ${key}: hydration 尚未完成`);
      return;
    }

    // 🛡️ 防误写保护 2：防止空对象/空数组覆盖已有真实数据
    try {
      if (PROTECTED_NON_EMPTY_KEYS.has(key) && isEmptyValue(value)) {
        console.warn(`[持久化] ⚠️ 跳过保存 ${key}: 受保护数据不允许被空值覆盖`);
        return;
      }

      if (!accountIdRef.current) {
        persistenceDebugLog(`[持久化] 跳过保存 ${key}: 未登录账号`);
        return;
      }

      const scopedKey = scopedKeyRef.current;
      const existing = window.localStorage.getItem(scopedKey);
      if (existing && existing.length > 10) {
        const isEmptyDefault = typeof value === 'object' && value !== null &&
          (value as Record<string, unknown>).constructor === Object &&
          Object.keys(value as Record<string, unknown>).length === 0;
        if (isEmptyDefault) {
          console.warn(`[持久化] ⚠️ 跳过保存 ${key}: 企图用空对象覆盖已有数据 (${(existing.length / 1024).toFixed(1)}KB)`);
          return;
        }
        const isEmptyArray = Array.isArray(value) && value.length === 0;
        if (isEmptyArray) {
          console.warn(`[持久化] ⚠️ 跳过保存 ${key}: 企图用空数组覆盖已有数据 (${(existing.length / 1024).toFixed(1)}KB)`);
          return;
        }
      }
    } catch {
      // 忽略检查错误
    }

    try {
      const serialized = compressData(value);
      const size = new Blob([serialized]).size;

      lastAppliedSerializedRef.current = serialized;
      void backupStateToServer(key, serialized, {
        ...options,
        isCurrent: () => (
          !!options?.keepalive ||
          mutationVersion === localMutationVersionRef.current
        ),
      }).then((saved) => {
        if (saved) {
          persistedMutationVersionRef.current = Math.max(
            persistedMutationVersionRef.current,
            mutationVersion
          );
          if (saveRetryTimerRef.current) {
            clearTimeout(saveRetryTimerRef.current);
            saveRetryTimerRef.current = null;
          }
          return;
        }

        if (
          accountIdRef.current &&
          mutationVersion === localMutationVersionRef.current &&
          !hasPendingSaveRef.current &&
          !saveRetryTimerRef.current
        ) {
          saveRetryTimerRef.current = setTimeout(() => {
            saveRetryTimerRef.current = null;
            retrySaveRef.current(stateRef.current, localMutationVersionRef.current);
          }, PROJECT_SYNC_RETRY_MS);
        }
      });

      // 大状态只写入项目本地文件备份，避免浏览器 localStorage 5MB 配额被撑满。
      if (size > MAX_LOCAL_STORAGE_VALUE_SIZE || !checkStorageSpace(size)) {
        window.localStorage.removeItem(scopedKeyRef.current);
        persistenceDebugLog(`[持久化] ${key} 仅保存到项目本地文件备份，释放浏览器缓存 (${(size / 1024).toFixed(2)} KB)。`);
        return;
      }

      window.localStorage.setItem(scopedKeyRef.current, serialized);
      persistenceDebugLog(`[持久化] 保存状态: ${key}, 大小: ${(size / 1024).toFixed(2)} KB`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.warn(`[持久化] localStorage 配额已满: ${key}。已尝试写入项目本地文件备份，不会自动删除其他数据。`);
      } else {
        console.error(`[持久化] 保存失败: ${key}`, error);
      }
    }
  }, [key]);

  retrySaveRef.current = (value: T, mutationVersion: number) => {
    saveToStorage(value, undefined, mutationVersion);
  };

  const scheduleSaveToStorage = useCallback((value: T, mutationVersion: number) => {
    pendingSaveRef.current = value;
    pendingSaveVersionRef.current = mutationVersion;
    hasPendingSaveRef.current = true;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    if (idleSaveHandleRef.current !== null) {
      window.cancelIdleCallback?.(idleSaveHandleRef.current);
      idleSaveHandleRef.current = null;
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const flushPendingSave = () => {
        idleSaveHandleRef.current = null;
        const pendingValue = pendingSaveRef.current;
        const pendingVersion = pendingSaveVersionRef.current;
        pendingSaveRef.current = null;
        pendingSaveVersionRef.current = 0;
        const hasPendingValue = hasPendingSaveRef.current;
        hasPendingSaveRef.current = false;
        if (hasPendingValue) {
          saveToStorage(pendingValue as T, undefined, pendingVersion);
        }
      };

      if (typeof window.requestIdleCallback === 'function') {
        idleSaveHandleRef.current = window.requestIdleCallback(flushPendingSave, {
          timeout: 1200,
        });
      } else {
        // Safari currently has no requestIdleCallback. Yield a paint frame
        // before doing JSON/LZ work so clicks and scrolling stay responsive.
        saveTimerRef.current = setTimeout(flushPendingSave, 80);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [saveToStorage]);

  // 更新状态并保存
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    if (value instanceof Function) {
      setState((prev) => {
        const newValue = value(prev);
        if (Object.is(newValue, prev)) {
          return prev;
        }
        const mutationVersion = localMutationVersionRef.current + 1;
        localMutationVersionRef.current = mutationVersion;
        stateRef.current = newValue;
        scheduleSaveToStorage(newValue, mutationVersion);
        return newValue;
      });
    } else {
      if (Object.is(value, stateRef.current)) {
        return;
      }
      const mutationVersion = localMutationVersionRef.current + 1;
      localMutationVersionRef.current = mutationVersion;
      stateRef.current = value;
      setState(value);
      scheduleSaveToStorage(value, mutationVersion);
    }
  }, [scheduleSaveToStorage]);

  // 清除持久化数据
  const clearValue = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (idleSaveHandleRef.current !== null) {
        window.cancelIdleCallback?.(idleSaveHandleRef.current);
        idleSaveHandleRef.current = null;
      }
      if (saveRetryTimerRef.current) {
        clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
      pendingSaveRef.current = null;
      pendingSaveVersionRef.current = 0;
      hasPendingSaveRef.current = false;
      localMutationVersionRef.current = 0;
      persistedMutationVersionRef.current = 0;
      lastAppliedSerializedRef.current = null;
      window.localStorage.removeItem(scopedKeyRef.current);
      deleteStateBackup(key);
      stateRef.current = initialValueRef.current;
      setState(initialValueRef.current);
      persistenceDebugLog(`[持久化] 清除状态: ${key}`);
    } catch (error) {
      console.error(`[持久化] 清除失败: ${key}`, error);
    }
  }, [key]);

  // 🛡️ 页面卸载前保存 - 使用 ref 确保始终拿到最新 state，避免闭包陈旧值覆盖
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (idleSaveHandleRef.current !== null) {
        window.cancelIdleCallback?.(idleSaveHandleRef.current);
        idleSaveHandleRef.current = null;
      }
      pendingSaveRef.current = null;
      pendingSaveVersionRef.current = 0;
      hasPendingSaveRef.current = false;
      // 使用 ref 获取当前最新 state，防止因闭包捕获陈旧值
      saveToStorage(
        stateRef.current,
        { keepalive: true },
        localMutationVersionRef.current
      );
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveToStorage]); // 只依赖 saveToStorage，避免 state 变化导致反复注册/注销

  return [state, setValue, clearValue];
}

/**
 * 多状态持久化 Hook
 * 统一管理多个状态的持久化
 */
export function usePersistentStateManager() {
  // 清除所有持久化数据
  const clearAll = useCallback(() => {
    if (typeof window === 'undefined') return;

    const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    const scopedPrefix = accountId ? `${ACCOUNT_KEY_PREFIX}${safeAccountKey(accountId)}_` : '';
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (scopedPrefix) {
        if (key.startsWith(scopedPrefix) || isLegacyRawStoryboardStateKey(key)) keysToRemove.push(key);
      } else if (isLegacyRawStoryboardStateKey(key)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => window.localStorage.removeItem(key));
    deleteStateBackup();
    console.log(`[持久化] 已清除当前账号状态，共 ${keysToRemove.length} 项`);
  }, []);

  // 导出所有数据
  const exportData = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const data: Record<string, unknown> = {};
    const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    const scopedPrefix = accountId ? `${ACCOUNT_KEY_PREFIX}${safeAccountKey(accountId)}_` : '';
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const shouldExport = scopedPrefix
        ? key.startsWith(scopedPrefix)
        : key.startsWith('storyboard_') && !key.startsWith(ACCOUNT_KEY_PREFIX);
      if (shouldExport) {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const rawKey = scopedPrefix ? key.slice(scopedPrefix.length) : key;
            data[rawKey] = decompressData(raw);
          }
        } catch {
          // ignore
        }
      }
    }
    return data;
  }, []);

  // 导入数据
  const importData = useCallback((data: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;

    Object.entries(data).forEach(([key, value]) => {
      if (key.startsWith('storyboard_')) {
        const serialized = typeof value === 'string' ? value : compressData(value);
        const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY);
        window.localStorage.setItem(getScopedStorageKey(key, accountId), serialized);
        void backupStateToServer(key, serialized);
      }
    });
    console.log(`[持久化] 已导入 ${Object.keys(data).length} 项状态`);
  }, []);

  /**
   * 检查 localStorage 健康状态
   * 用于诊断数据持久化问题
   */
  const checkStorageHealth = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const result = {
      totalKeys: 0,
      storyboardKeys: 0,
      totalSize: 0,
      keys: [] as Array<{ key: string; size: number; hasData: boolean }>,
      quotaUsed: 0,
      quotaRemaining: 0,
    };

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      result.totalKeys++;
      const value = window.localStorage.getItem(key);
      const size = value ? new Blob([value]).size : 0;
      result.totalSize += size;

      const isStoryboardKey = isScopedStoryboardStateKey(key);
      if (isStoryboardKey) {
        result.storyboardKeys++;
      }

      result.keys.push({
        key,
        size,
        hasData: !!value && value !== 'null' && value !== '""',
      });
    }

    // 估算配额（通常 5-10MB）
    result.quotaUsed = (result.totalSize / ESTIMATED_LOCAL_STORAGE_QUOTA) * 100;
    result.quotaRemaining = ESTIMATED_LOCAL_STORAGE_QUOTA - result.totalSize;

    console.log('[持久化] localStorage 健康状态:', result);
    return result;
  }, []);

  return { clearAll, exportData, importData, checkStorageHealth };
}
