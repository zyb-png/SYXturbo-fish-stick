/**
 * Token 估算工具
 * 用于估算文本的Token数量
 */

/**
 * 估算文本的Token数量
 * 中文约1.5字符 = 1 token
 * 英文约4字符 = 1 token
 * 混合内容简单估算：字符数 / 2
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // 计算中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  // 计算英文字符数（包括数字、标点等）
  const otherChars = text.length - chineseChars;
  
  // 中文约1.5字符 = 1 token
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  // 英文约4字符 = 1 token
  const englishTokens = Math.ceil(otherChars / 4);
  
  return chineseTokens + englishTokens;
}

/**
 * 估算消息列表的Token数量
 */
export function estimateMessagesTokens(messages: Array<{ role: string; content: string | any[] }>): number {
  let total = 0;
  
  for (const msg of messages) {
    // 角色标识约占4 tokens
    total += 4;
    
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      // 多模态消息
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          total += estimateTokens(part.text);
        } else if (part.type === 'image_url') {
          // 图片约占用 85-1105 tokens，取决于分辨率
          total += 256; // 平均估算
        } else if (part.type === 'video_url') {
          // 视频根据fps和时长估算
          total += 1000; // 平均估算
        }
      }
    }
  }
  
  return total;
}

/**
 * Token使用量记录接口
 */
export interface TokenUsageRecord {
  input: number;
  output: number;
  timestamp: number;
}

/**
 * 创建Token使用记录
 */
export function createTokenRecord(inputTokens: number, outputText: string): TokenUsageRecord {
  return {
    input: inputTokens,
    output: estimateTokens(outputText),
    timestamp: Date.now(),
  };
}
