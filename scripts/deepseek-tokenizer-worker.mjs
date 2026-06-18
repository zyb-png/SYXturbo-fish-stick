import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, env } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;

const tokenizer = await AutoTokenizer.from_pretrained(
  fileURLToPath(new URL('../resources/deepseek-v3-tokenizer/', import.meta.url)),
  { local_files_only: true }
);

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') return part.text;
    if (part?.type === 'image_url') return '<image>';
    if (part?.type === 'video_url') return '<video>';
    return '';
  }).join('\n');
}

function countText(text) {
  if (!text) return 0;
  const encoded = tokenizer.encode(text, { add_special_tokens: false });
  return encoded.length ?? encoded.size ?? encoded.data?.length ?? 0;
}

function countMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const normalizedMessages = messages.map((message) => ({
    role: message.role,
    content: normalizeMessageContent(message.content),
  }));
  const encoded = tokenizer.apply_chat_template(normalizedMessages, {
    tokenize: true,
    add_generation_prompt: true,
  });
  const inputIds = encoded?.input_ids ?? encoded;
  return inputIds?.size ?? inputIds?.length ?? inputIds?.data?.length ?? 0;
}

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    const count = request.type === 'messages'
      ? countMessages(request.messages)
      : countText(request.text);
    process.stdout.write(`${JSON.stringify({ id: request.id, count })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      id: request?.id,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
  }
}
