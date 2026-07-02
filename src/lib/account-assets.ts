import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { PublicAccount } from './account-store';

export const DEFAULT_ASSET_FOLDERS = {
  scenes: '场景图片',
  characters: '人物图片',
  props: '道具图片',
  storyboards: '分镜图片',
  videos: '视频文件',
};

export type AssetFolderConfig = typeof DEFAULT_ASSET_FOLDERS;

export function readConfiguredAssetsRoot(): string {
  const fallback = path.join(process.cwd(), 'assets');
  const configPath = path.join(process.cwd(), 'assets-config.json');

  try {
    if (!fs.existsSync(configPath)) return fallback;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const configured = typeof config.assetsPath === 'string' ? config.assetsPath.trim() : '';
    if (!configured) return fallback;
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  } catch (error) {
    console.warn('[账号资产] 读取资产配置失败，使用默认 assets 目录:', error);
    return fallback;
  }
}

export function readAssetFoldersConfig(): AssetFolderConfig {
  const configPath = path.join(process.cwd(), 'assets-config.json');

  try {
    if (!fs.existsSync(configPath)) return DEFAULT_ASSET_FOLDERS;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.folders || typeof config.folders !== 'object') return DEFAULT_ASSET_FOLDERS;
    return {
      ...DEFAULT_ASSET_FOLDERS,
      ...config.folders,
    };
  } catch (error) {
    console.warn('[账号资产] 读取资产文件夹配置失败，使用默认分类:', error);
    return DEFAULT_ASSET_FOLDERS;
  }
}

export function getAccountStorageSegment(accountId: string): string {
  const safeId = accountId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'account';
  const digest = createHash('sha256').update(accountId).digest('hex').slice(0, 12);
  return `${safeId}-${digest}`;
}

export function getAccountAssetsPath(account: Pick<PublicAccount, 'id'>): string {
  return path.join(readConfiguredAssetsRoot(), 'accounts', getAccountStorageSegment(account.id));
}

export function getAccountProjectStateDir(account: Pick<PublicAccount, 'id'>): string {
  return path.join(getAccountAssetsPath(account), 'project-state');
}

export function getAccountRemoteKey(account: Pick<PublicAccount, 'id'>, key: string): string {
  const cleanKey = key.replace(/^\/+/, '');
  return `accounts/${getAccountStorageSegment(account.id)}/${cleanKey}`;
}

export function getAccountRemotePrefix(account: Pick<PublicAccount, 'id'>, prefix = ''): string {
  const cleanPrefix = prefix.replace(/^\/+/, '');
  return `accounts/${getAccountStorageSegment(account.id)}/${cleanPrefix}`;
}

export function isAccountRemoteKey(account: Pick<PublicAccount, 'id'>, key: string): boolean {
  return key.startsWith(`accounts/${getAccountStorageSegment(account.id)}/`);
}

export function ensureAssetFolders(assetsPath: string, folders = readAssetFoldersConfig()): void {
  for (const folderName of Object.values(folders)) {
    fs.mkdirSync(path.join(assetsPath, folderName), { recursive: true });
  }
}
