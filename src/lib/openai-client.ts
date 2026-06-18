/**
 * OpenAI 兼容 API 客户端
 * 支持流式和非流式两种调用方式
 * 
 * 环境变量配置:
 * - LLM_BASE_URL: API 地址（默认 DeepSeek）
 * - LLM_API_KEY / OPENAI_API_KEY: API 密钥
 * - LLM_MODEL: 默认模型（默认 deepseek-v4-flash）
 */

import { getLlmConfigSync } from './app-settings';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
} from './creation-points';
import {
  countDeepSeekMessageTokens,
  countDeepSeekTokens,
} from './deepseek-tokenizer';
import { calculateDeepSeekCreationPoints } from './provider-pricing';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamChunk {
  content?: string;
}

export interface LlmTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface LlmRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onUsage?: (usage: LlmTokenUsage) => void;
  billing?: boolean;
  billingLabel?: string;
}

/** 延迟函数 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 是否应该重试：429(限流)、5xx(服务端错误) */
const isRetryableStatus = (status: number) => status === 429 || status >= 500;

const isRetryableNetworkError = (error: any) => {
  const code = error?.code || error?.cause?.code;
  const name = error?.name || error?.cause?.name;
  const message = `${error?.message || ''} ${error?.cause?.message || ''}`;
  return (
    name === 'AbortError' ||
    error?.type === 'aborted' ||
    ['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code) ||
    /fetch failed|terminated|timeout|socket|network/i.test(message)
  );
};

function anySignal(signals: AbortSignal[]): AbortSignal {
  const activeSignals = signals.filter(Boolean);
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

/** 计算退避延迟：指数退避 + 随机抖动，最大 30 秒 */
const getBackoffDelay = (attempt: number): number => {
  const base = 1000; // 1 秒
  const max = 30_000; // 30 秒
  const exponential = Math.min(base * Math.pow(2, attempt), max);
  const jitter = Math.random() * 1000; // 0~1 秒抖动
  return exponential + jitter;
};

function normalizeUsage(value: any): LlmTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const inputTokens = Number(value.prompt_tokens ?? value.input_tokens ?? 0);
  const outputTokens = Number(value.completion_tokens ?? value.output_tokens ?? 0);
  const totalTokens = Number(value.total_tokens ?? inputTokens + outputTokens);
  if (![inputTokens, outputTokens, totalTokens].some(number => Number.isFinite(number) && number > 0)) {
    return null;
  }
  const normalizedInputTokens = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const cachedInputTokens = Number(
    value.prompt_cache_hit_tokens ??
    value.prompt_tokens_details?.cached_tokens ??
    value.input_tokens_details?.cached_tokens ??
    0
  );
  const uncachedInputTokens = Number(
    value.prompt_cache_miss_tokens ??
    Math.max(0, normalizedInputTokens - (Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0))
  );
  return {
    inputTokens: normalizedInputTokens,
    cachedInputTokens: Number.isFinite(cachedInputTokens) ? Math.max(0, cachedInputTokens) : 0,
    uncachedInputTokens: Number.isFinite(uncachedInputTokens) ? Math.max(0, uncachedInputTokens) : normalizedInputTokens,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
  };
}

function shouldBillDeepSeek(baseUrl: string, options: LlmRequestOptions): boolean {
  return options.billing !== false && baseUrl.includes('api.deepseek.com');
}

async function createFallbackUsage(messages: Message[], output: string): Promise<LlmTokenUsage> {
  const inputTokens = await countDeepSeekMessageTokens(messages);
  const outputTokens = await countDeepSeekTokens(output);
  return {
    inputTokens,
    cachedInputTokens: 0,
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

async function beginDeepSeekBilling(
  messages: Message[],
  options: LlmRequestOptions,
  model: string
): Promise<string> {
  const estimatedInputTokens = await countDeepSeekMessageTokens(messages);
  const estimatedOutputTokens = Math.max(1, options.maxTokens || 16384);
  const reservedPoints = calculateDeepSeekCreationPoints({
    uncachedInputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  });
  const task = await freezeCreationPoints({
    featureCode: 'deepseek_text_analysis',
    points: reservedPoints,
    metadata: {
      model,
      billingMode: 'deepseek_token',
      estimatedInputTokens,
      estimatedOutputTokens,
      reservedPoints,
      label: options.billingLabel || '文本分析',
    },
  });
  return task.taskId;
}

async function settleDeepSeekBilling(
  taskId: string,
  usage: LlmTokenUsage,
  label = '文本分析'
): Promise<void> {
  const finalPoints = calculateDeepSeekCreationPoints(usage);
  await completeCreationPointTask(taskId, finalPoints, {
    description: `${label}完成扣除（输入 ${usage.inputTokens.toLocaleString('zh-CN')} / 输出 ${usage.outputTokens.toLocaleString('zh-CN')} Token）`,
    metadata: {
      billingMode: 'deepseek_token',
      cachedInputTokens: usage.cachedInputTokens,
      uncachedInputTokens: usage.uncachedInputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      finalPoints,
    },
  });
}

function getProviderRequestOptions(baseUrl: string, streaming = false) {
  if (!baseUrl.includes('api.deepseek.com')) return {};
  return {
    thinking: { type: 'disabled' },
    ...(streaming ? { stream_options: { include_usage: true } } : {}),
  };
}

/**
 * 非流式调用 LLM（带超时控制 + 自动重试）
 */
async function invokeRequest(
  messages: Message[],
  options: LlmRequestOptions = {}
): Promise<string> {
  const timeout = options.timeout ?? 120_000;
  const maxRetries = options.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const config = getLlmConfigSync();

    if (!config.apiKey) {
      clearTimeout(timer);
      throw new Error('未配置文本模型 API Key，请在右上角「设置」中填写');
    }

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || config.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 16384,
          stream: false,
          ...getProviderRequestOptions(config.baseUrl),
        }),
        signal: options.signal ? anySignal([controller.signal, options.signal]) : controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`API 请求失败: ${response.status} - ${errorText}`);

        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          console.log(`[LLM] 请求 ${response.status}，${attempt + 1}/${maxRetries} 次重试，等待 ${(delay / 1000).toFixed(1)}s...`);
          clearTimeout(timer);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }

      clearTimeout(timer);
      const data = await response.json();
      const usage = normalizeUsage(data.usage);
      if (usage) options.onUsage?.(usage);
      return data.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      clearTimeout(timer);

      // AbortError（超时）以及网络错误也重试
      if (isRetryableNetworkError(error) && attempt < maxRetries) {
        lastError = error;
        const delay = getBackoffDelay(attempt);
        console.log(`[LLM] 请求超时或连接异常，${attempt + 1}/${maxRetries} 次重试，等待 ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('API 请求失败：超过最大重试次数');
}

/**
 * 流式调用 LLM，返回异步生成器（带自动重试）
 */
async function* streamRequest(
  messages: Message[],
  options: LlmRequestOptions = {}
): AsyncGenerator<StreamChunk> {
  const timeout = options.timeout ?? 120_000;
  const maxRetries = options.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const config = getLlmConfigSync();

    if (!config.apiKey) {
      clearTimeout(timer);
      throw new Error('未配置文本模型 API Key，请在右上角「设置」中填写');
    }

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || config.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 16384,
          stream: true,
          ...getProviderRequestOptions(config.baseUrl, true),
        }),
        signal: options.signal ? anySignal([controller.signal, options.signal]) : controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`API 请求失败: ${response.status} - ${errorText}`);

        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          console.log(`[LLM] 流式请求 ${response.status}，${attempt + 1}/${maxRetries} 次重试，等待 ${(delay / 1000).toFixed(1)}s...`);
          clearTimeout(timer);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }

      clearTimeout(timer);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const usage = normalizeUsage(parsed.usage);
            if (usage) options.onUsage?.(usage);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              yield { content: delta.content };
            }
          } catch {
            // 跳过解析失败的块
          }
        }
      }

      return; // 流完成，正常退出
    } catch (error: any) {
      clearTimeout(timer);

      // 网络/超时错误也重试（流式中途中断不重试，只在建立连接阶段重试）
      if (isRetryableNetworkError(error) && attempt < maxRetries) {
        lastError = error;
        const delay = getBackoffDelay(attempt);
        console.log(`[LLM] 流式请求超时或连接异常，${attempt + 1}/${maxRetries} 次重试，等待 ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('流式 API 请求失败：超过最大重试次数');
}

export async function invoke(
  messages: Message[],
  options: LlmRequestOptions = {}
): Promise<string> {
  const config = getLlmConfigSync();
  if (!shouldBillDeepSeek(config.baseUrl, options)) {
    return invokeRequest(messages, options);
  }

  const taskId = await beginDeepSeekBilling(messages, options, options.model || config.model);
  let usage: LlmTokenUsage | null = null;
  try {
    const content = await invokeRequest(messages, {
      ...options,
      onUsage: value => {
        usage = value;
        options.onUsage?.(value);
      },
    });
    const finalUsage = usage || await createFallbackUsage(messages, content);
    await settleDeepSeekBilling(taskId, finalUsage, options.billingLabel || '文本分析');
    return content;
  } catch (error) {
    await failCreationPointTask(
      taskId,
      error instanceof Error ? error.message : 'DeepSeek 文本任务失败'
    ).catch(refundError => {
      console.error('[创作点] DeepSeek 文本任务退回失败:', refundError);
    });
    throw error;
  }
}

export async function* stream(
  messages: Message[],
  options: LlmRequestOptions = {}
): AsyncGenerator<StreamChunk> {
  const config = getLlmConfigSync();
  if (!shouldBillDeepSeek(config.baseUrl, options)) {
    yield* streamRequest(messages, options);
    return;
  }

  const taskId = await beginDeepSeekBilling(messages, options, options.model || config.model);
  let usage: LlmTokenUsage | null = null;
  let output = '';
  try {
    for await (const chunk of streamRequest(messages, {
      ...options,
      onUsage: value => {
        usage = value;
        options.onUsage?.(value);
      },
    })) {
      if (chunk.content) output += chunk.content;
      yield chunk;
    }
    const finalUsage = usage || await createFallbackUsage(messages, output);
    await settleDeepSeekBilling(taskId, finalUsage, options.billingLabel || '文本分析');
  } catch (error) {
    await failCreationPointTask(
      taskId,
      error instanceof Error ? error.message : 'DeepSeek 文本任务失败'
    ).catch(refundError => {
      console.error('[创作点] DeepSeek 文本任务退回失败:', refundError);
    });
    throw error;
  }
}
