import fs from 'fs';
import path from 'path';

export interface ProviderConnectionSettings {
  apiKey: string;
  baseUrl: string;
}

export interface LlmConnectionSettings extends ProviderConnectionSettings {
  model: string;
}

export interface ManfeiConnectionSettings extends ProviderConnectionSettings {
  model: 'moon-manfei-new';
  resolution: '720p';
}

export interface AssetStorageSettings {
  endpointUrl: string;
  region: string;
  bucketName: string;
  accessPointAlias: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AppSettings {
  llm: LlmConnectionSettings;
  runninghub: ProviderConnectionSettings;
  seedance: ProviderConnectionSettings;
  manfei: ManfeiConnectionSettings;
  assetStorage: AssetStorageSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  llm: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  runninghub: {
    apiKey: '',
    baseUrl: 'https://www.runninghub.cn/openapi/v2',
  },
  seedance: {
    apiKey: '',
    baseUrl: 'https://www.xszy.top',
  },
  manfei: {
    apiKey: '',
    baseUrl: 'http://115.191.42.226:8001',
    model: 'moon-manfei-new',
    resolution: '720p',
  },
  assetStorage: {
    endpointUrl: 'https://tos-cn-beijing.volces.com',
    region: 'cn-beijing',
    bucketName: 'ark-auto-2119577522-cn-beijing-default',
    accessPointAlias: '20260605-019e97c351b07f01a81008cd82b9f393-tosalias',
    accessKeyId: '',
    secretAccessKey: '',
  },
};

function readAssetsPath(): string {
  const configPath = path.join(process.cwd(), 'assets-config.json');
  let assetsPath = path.join(process.cwd(), 'assets');

  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      if (typeof config.assetsPath === 'string' && config.assetsPath.trim()) {
        assetsPath = path.isAbsolute(config.assetsPath)
          ? config.assetsPath
          : path.join(process.cwd(), config.assetsPath);
      }
    }
  } catch (error) {
    console.warn('读取资产配置失败，使用默认 assets 目录:', error);
  }

  return assetsPath;
}

export function getAppSettingsPath(): string {
  return path.join(readAssetsPath(), 'project-state', 'app-settings.json');
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanBaseUrl(value: unknown): string {
  return cleanString(value).replace(/\/+$/, '');
}

function normalizeSettings(input: unknown): AppSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
  return {
    llm: {
      apiKey: cleanString(raw.llm?.apiKey),
      baseUrl: cleanBaseUrl(raw.llm?.baseUrl),
      model: cleanString(raw.llm?.model),
    },
    runninghub: {
      apiKey: cleanString(raw.runninghub?.apiKey),
      baseUrl: cleanBaseUrl(raw.runninghub?.baseUrl),
    },
    seedance: {
      apiKey: cleanString(raw.seedance?.apiKey),
      baseUrl: cleanBaseUrl(raw.seedance?.baseUrl),
    },
    manfei: {
      apiKey: cleanString(raw.manfei?.apiKey),
      baseUrl: cleanBaseUrl(raw.manfei?.baseUrl),
      model: 'moon-manfei-new',
      resolution: '720p',
    },
    assetStorage: {
      endpointUrl: cleanBaseUrl(raw.assetStorage?.endpointUrl),
      region: cleanString(raw.assetStorage?.region),
      bucketName: cleanString(raw.assetStorage?.bucketName),
      accessPointAlias: cleanString(raw.assetStorage?.accessPointAlias),
      accessKeyId: cleanString(raw.assetStorage?.accessKeyId),
      secretAccessKey: cleanString(raw.assetStorage?.secretAccessKey),
    },
  };
}

function mergeWithDefaults(settings: AppSettings): AppSettings {
  return {
    llm: {
      apiKey: settings.llm.apiKey,
      baseUrl: settings.llm.baseUrl || DEFAULT_APP_SETTINGS.llm.baseUrl,
      model: settings.llm.model || DEFAULT_APP_SETTINGS.llm.model,
    },
    runninghub: {
      apiKey: settings.runninghub.apiKey,
      baseUrl: settings.runninghub.baseUrl || DEFAULT_APP_SETTINGS.runninghub.baseUrl,
    },
    seedance: {
      apiKey: settings.seedance.apiKey,
      baseUrl: settings.seedance.baseUrl || DEFAULT_APP_SETTINGS.seedance.baseUrl,
    },
    manfei: {
      apiKey: settings.manfei.apiKey,
      baseUrl: settings.manfei.baseUrl || DEFAULT_APP_SETTINGS.manfei.baseUrl,
      model: 'moon-manfei-new',
      resolution: '720p',
    },
    assetStorage: {
      endpointUrl: settings.assetStorage.endpointUrl || DEFAULT_APP_SETTINGS.assetStorage.endpointUrl,
      region: settings.assetStorage.region || DEFAULT_APP_SETTINGS.assetStorage.region,
      bucketName: settings.assetStorage.bucketName || DEFAULT_APP_SETTINGS.assetStorage.bucketName,
      accessPointAlias: settings.assetStorage.accessPointAlias || DEFAULT_APP_SETTINGS.assetStorage.accessPointAlias,
      accessKeyId: settings.assetStorage.accessKeyId,
      secretAccessKey: settings.assetStorage.secretAccessKey,
    },
  };
}

export function getSavedAppSettingsSync(): AppSettings {
  return mergeWithDefaults(readSavedAppSettingsWithoutDefaultsSync());
}

function readSavedAppSettingsWithoutDefaultsSync(): AppSettings {
  const settingsPath = getAppSettingsPath();
  try {
    if (!fs.existsSync(settingsPath)) {
      return normalizeSettings({});
    }

    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return normalizeSettings(data);
  } catch (error) {
    console.warn('读取应用设置失败，使用默认设置:', error);
    return normalizeSettings({});
  }
}

export function getRuntimeAppSettingsSync(): AppSettings {
  const saved = readSavedAppSettingsWithoutDefaultsSync();
  return {
    llm: {
      apiKey: saved.llm.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      baseUrl: saved.llm.baseUrl || cleanBaseUrl(process.env.LLM_BASE_URL) || DEFAULT_APP_SETTINGS.llm.baseUrl,
      model: saved.llm.model || process.env.LLM_MODEL || DEFAULT_APP_SETTINGS.llm.model,
    },
    runninghub: {
      apiKey: saved.runninghub.apiKey || process.env.RUNNINGHUB_API_KEY || '',
      baseUrl: saved.runninghub.baseUrl || cleanBaseUrl(process.env.RUNNINGHUB_BASE_URL) || DEFAULT_APP_SETTINGS.runninghub.baseUrl,
    },
    seedance: {
      apiKey: saved.seedance.apiKey || process.env.XSZY_API_KEY || '',
      baseUrl: saved.seedance.baseUrl || cleanBaseUrl(process.env.SEEDANCE_BASE_URL) || cleanBaseUrl(process.env.XSZY_BASE_URL) || DEFAULT_APP_SETTINGS.seedance.baseUrl,
    },
    manfei: {
      apiKey: saved.manfei.apiKey || process.env.MANFEI_API_KEY || '',
      baseUrl: saved.manfei.baseUrl || cleanBaseUrl(process.env.MANFEI_BASE_URL) || DEFAULT_APP_SETTINGS.manfei.baseUrl,
      model: 'moon-manfei-new',
      resolution: '720p',
    },
    assetStorage: {
      endpointUrl: saved.assetStorage.endpointUrl || cleanBaseUrl(process.env.TOS_ENDPOINT) || cleanBaseUrl(process.env.ASSET_STORAGE_ENDPOINT_URL) || DEFAULT_APP_SETTINGS.assetStorage.endpointUrl,
      region: saved.assetStorage.region || process.env.ASSET_STORAGE_REGION || DEFAULT_APP_SETTINGS.assetStorage.region,
      bucketName: saved.assetStorage.bucketName || process.env.TOS_BUCKET_NAME || process.env.ASSET_STORAGE_BUCKET_NAME || DEFAULT_APP_SETTINGS.assetStorage.bucketName,
      accessPointAlias: saved.assetStorage.accessPointAlias || process.env.TOS_ACCESS_POINT_ALIAS || DEFAULT_APP_SETTINGS.assetStorage.accessPointAlias,
      accessKeyId: saved.assetStorage.accessKeyId || process.env.TOS_ACCESS_KEY_ID || process.env.ASSET_STORAGE_ACCESS_KEY_ID || '',
      secretAccessKey: saved.assetStorage.secretAccessKey || process.env.TOS_SECRET_ACCESS_KEY || process.env.ASSET_STORAGE_SECRET_ACCESS_KEY || '',
    },
  };
}

export function saveAppSettingsSync(input: unknown): AppSettings {
  const settings = mergeWithDefaults(normalizeSettings(input));
  const settingsPath = getAppSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  return settings;
}

export function getLlmConfigSync(): LlmConnectionSettings {
  return getRuntimeAppSettingsSync().llm;
}

export function getRunningHubConfigSync(): ProviderConnectionSettings {
  return getRuntimeAppSettingsSync().runninghub;
}

export function getSeedanceConnectionConfigSync(): ProviderConnectionSettings {
  return getRuntimeAppSettingsSync().seedance;
}

export function getManfeiConfigSync(): ManfeiConnectionSettings {
  return getRuntimeAppSettingsSync().manfei;
}

export function getAssetStorageConfigSync(): AssetStorageSettings {
  return getRuntimeAppSettingsSync().assetStorage;
}
