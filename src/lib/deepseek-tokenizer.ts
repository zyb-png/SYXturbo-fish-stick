import 'server-only';

import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';

type ChatMessage = {
  role: string;
  content: string | any[];
};

interface PendingRequest {
  resolve: (count: number) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = '';
const pendingRequests = new Map<string, PendingRequest>();

function getTokenizerPath(): string {
  return path.join(process.cwd(), 'resources', 'deepseek-v3-tokenizer');
}

function rejectPendingRequests(message: string): void {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pendingRequests.clear();
}

function handleWorkerOutput(chunk: Buffer): void {
  stdoutBuffer += chunk.toString('utf-8');
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      const pending = pendingRequests.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(Number(response.count) || 0);
      }
    } catch (error) {
      console.warn('[DeepSeek tokenizer] 无法解析工作进程响应:', error);
    }
  }
}

function getWorker(): ChildProcessWithoutNullStreams {
  if (worker && !worker.killed) return worker;

  const tokenizerPath = getTokenizerPath();
  const workerPath = path.join(process.cwd(), 'scripts', 'deepseek-tokenizer-worker.mjs');
  if (!fs.existsSync(path.join(tokenizerPath, 'tokenizer.json'))) {
    throw new Error(`DeepSeek tokenizer 资源不存在: ${tokenizerPath}`);
  }
  if (!fs.existsSync(workerPath)) {
    throw new Error(`DeepSeek tokenizer 工作脚本不存在: ${workerPath}`);
  }

  stdoutBuffer = '';
  worker = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', handleWorkerOutput);
  worker.stderr.on('data', (chunk) => {
    console.warn('[DeepSeek tokenizer]', chunk.toString('utf-8').trim());
  });
  worker.on('error', (error) => {
    rejectPendingRequests(`DeepSeek tokenizer 工作进程异常: ${error.message}`);
    worker = null;
  });
  worker.on('exit', (code) => {
    rejectPendingRequests(`DeepSeek tokenizer 工作进程退出: ${code ?? 'unknown'}`);
    worker = null;
  });
  return worker;
}

function requestTokenCount(payload: Record<string, unknown>): Promise<number> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('DeepSeek tokenizer 计算超时'));
    }, 30_000);
    pendingRequests.set(id, { resolve, reject, timer });
    try {
      getWorker().stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    } catch (error) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function countDeepSeekTokens(text: string): Promise<number> {
  if (!text) return 0;
  return requestTokenCount({ type: 'text', text });
}

export async function countDeepSeekMessageTokens(messages: ChatMessage[]): Promise<number> {
  if (!messages.length) return 0;
  return requestTokenCount({ type: 'messages', messages });
}
