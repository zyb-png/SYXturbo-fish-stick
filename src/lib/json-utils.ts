/**
 * JSON 解析工具函数
 * 用于处理 LLM 返回的 JSON 内容，支持清理、修复和容错解析
 */

/**
 * 清理和修复 JSON 字符串
 */
export function cleanAndFixJSON(jsonStr: string): string {
  let cleaned = jsonStr;
  
  // 移除 markdown 代码块标记
  cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  // 移除所有控制字符（包括换行符在内），因为在 JSON 字符串值中它们会导致解析失败
  // 但保留 JSON 结构中的换行和制表符
  // 策略：在字符串值外部保留换行，在字符串值内部转义或移除控制字符
  cleaned = removeControlCharsInStrings(cleaned);
  
  // 修复常见的 JSON 格式问题
  // 1. 修复多余的逗号
  cleaned = cleaned.replace(/,\s*}/g, '}');
  cleaned = cleaned.replace(/,\s*]/g, ']');
  
  // 2. 修复未转义的引号（在字符串值中的引号）
  // 匹配模式: "key": "value with "quotes" inside"
  // 这个比较复杂，先尝试简单修复
  cleaned = cleaned.replace(/"([^"]+)":\s*"([^"]*)"([^"]*)"([^"]*)"/g, '"$1": "$2\\"$3\\"$4"');
  
  return cleaned;
}

/**
 * 移除 JSON 字符串值中的控制字符（导出版本，供其他模块使用）
 */
export function removeControlCharsInStrings(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const charCode = char.charCodeAt(0);
    
    if (escape) {
      // 已经在转义状态，保留当前字符
      result += char;
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      result += char;
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    
    // 如果在字符串内部，移除或转义控制字符
    if (inString) {
      if (charCode < 32 || charCode === 127) {
        // 控制字符：换行、回车、制表符等
        if (char === '\n') {
          result += '\\n';  // 转义换行
        } else if (char === '\r') {
          result += '\\r';  // 转义回车
        } else if (char === '\t') {
          result += '\\t';  // 转义制表符
        } else {
          // 其他控制字符（如 0x00-0x1F），用空格替换或跳过
          result += ' ';  // 用空格替换，保持内容可读性
        }
        continue;
      }
    }
    
    result += char;
  }
  
  return result;
}

/**
 * 尝试提取并修复不完整的 JSON
 * @param response LLM 返回的原始响应
 * @returns 解析后的 JSON 对象，如果失败则返回 null
 */
export function tryExtractAndFixJSON(response: string): any {
  // 首先尝试直接匹配完整的 JSON 对象
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  // 也尝试匹配数组格式
  const jsonArrayMatch = response.match(/\[[\s\S]*\]/);
  
  if (!jsonMatch && !jsonArrayMatch) {
    console.log('未找到 JSON 格式内容');
    return null;
  }
  
  // 优先尝试解析数组格式（如果响应以 [ 开头）
  const trimmedResponse = response.trim();
  if (trimmedResponse.startsWith('[') && jsonArrayMatch) {
    const cleanedArray = removeControlCharsInStrings(jsonArrayMatch[0]);
    try {
      return JSON.parse(cleanedArray);
    } catch (e: any) {
      console.log('数组格式 JSON 解析失败:', e.message);
    }
  }
  
  // 尝试解析对象格式
  if (jsonMatch) {
    let jsonStr = removeControlCharsInStrings(jsonMatch[0]);
    
    // 第一次尝试：直接解析
    try {
      return JSON.parse(jsonStr);
    } catch (e: any) {
      console.log('首次 JSON 解析失败，尝试修复...', e.message);
    }
    
    // 第二次尝试：修复未闭合的括号
    try {
      const fixed = fixUnclosedBrackets(jsonStr);
      return JSON.parse(fixed);
    } catch (e: any) {
      console.log('JSON 修复失败:', e.message);
    }
    
    // 第三次尝试：截取到最后一个有效的闭合括号
    try {
      const partialJson = extractValidPartial(jsonStr);
      if (partialJson) {
        return JSON.parse(partialJson);
      }
    } catch (e: any) {
      console.log('部分 JSON 解析也失败:', e.message);
    }
    
    // 第四次尝试：尝试使用正则提取 chapters 数组并重新构建
    const outlineResult = tryExtractOutline(jsonStr);
    if (outlineResult) {
      return outlineResult;
    }

    // 第五次尝试：尝试提取 scenes/characters/props 数组
    const arrayResult = tryExtractArrays(jsonStr);
    if (arrayResult) {
      return arrayResult;
    }
  }
  
  return null;
}

/**
 * 修复未闭合的括号
 */
function fixUnclosedBrackets(jsonStr: string): string {
  let result = jsonStr;
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') openBraces++;
      if (char === '}') openBraces--;
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets--;
    }
  }
  
  // 如果字符串未闭合，添加引号
  if (inString) {
    result += '"';
  }
  
  // 添加缺失的闭合括号
  while (openBrackets > 0) {
    result += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    result += '}';
    openBraces--;
  }
  
  return result;
}

/**
 * 提取有效的部分 JSON
 */
function extractValidPartial(jsonStr: string): string | null {
  const lastBrace = jsonStr.lastIndexOf('}');
  if (lastBrace > 0) {
    // 找到对应的起始位置
    let depth = 0;
    let startIdx = -1;
    for (let i = lastBrace; i >= 0; i--) {
      if (jsonStr[i] === '}') depth++;
      if (jsonStr[i] === '{') depth--;
      if (depth === 0) {
        startIdx = i;
        break;
      }
    }
    
    if (startIdx >= 0) {
      return jsonStr.substring(startIdx, lastBrace + 1);
    }
  }
  return null;
}

/**
 * 尝试提取大纲结构
 */
function tryExtractOutline(jsonStr: string): any | null {
  try {
    // 尝试提取 title
    const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]*)"/);
    const title = titleMatch ? titleMatch[1] : '未命名剧本';
    
    // 尝试提取 summary
    const summaryMatch = jsonStr.match(/"summary"\s*:\s*"([^"]*)"/);
    const summary = summaryMatch ? summaryMatch[1] : '';
    
    // 尝试提取 chapters 数组中的各个章节
    const chapters: any[] = [];
    const chapterRegex = /\{\s*"chapterNumber"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]*)"\s*,\s*"summary"\s*:\s*"([^"]*)"/g;
    let match;
    let chapterNum = 1;
    
    while ((match = chapterRegex.exec(jsonStr)) !== null) {
      chapters.push({
        chapterNumber: parseInt(match[1]) || chapterNum,
        title: match[2] || `第${chapterNum}集`,
        summary: match[3] || '',
        characters: [],
        scenes: [],
        content: ''
      });
      chapterNum++;
    }
    
    if (chapters.length > 0) {
      console.log(`通过正则提取到 ${chapters.length} 个章节`);
      return {
        title,
        summary,
        totalChapters: chapters.length,
        chapters
      };
    }
  } catch (e: any) {
    console.log('正则提取失败:', e.message);
  }
  return null;
}

/**
 * 尝试提取数组（scenes/characters/props）
 */
function tryExtractArrays(jsonStr: string): any | null {
  try {
    // 尝试提取 scenes 数组
    const scenesMatch = jsonStr.match(/"scenes"\s*:\s*\[/);
    const charactersMatch = jsonStr.match(/"characters"\s*:\s*\[/);
    const propsMatch = jsonStr.match(/"props"\s*:\s*\[/);
    
    if (scenesMatch || charactersMatch || propsMatch) {
      const result: any = {};
      
      // 提取 scenes
      if (scenesMatch) {
        result.scenes = extractArrayItems(jsonStr, 'scenes');
        console.log(`通过正则提取到 ${result.scenes.length} 个场景`);
      }
      
      // 提取 characters
      if (charactersMatch) {
        result.characters = extractArrayItems(jsonStr, 'characters');
        console.log(`通过正则提取到 ${result.characters.length} 个人物`);
      }
      
      // 提取 props
      if (propsMatch) {
        result.props = extractArrayItems(jsonStr, 'props');
        console.log(`通过正则提取到 ${result.props.length} 个道具`);
      }
      
      if (Object.keys(result).length > 0) {
        return result;
      }
    }
  } catch (e: any) {
    console.log('数组提取失败:', e.message);
  }
  return null;
}

/**
 * 从 JSON 字符串中提取指定数组的项目
 */
function extractArrayItems(jsonStr: string, arrayName: string): any[] {
  const items: any[] = [];
  
  // 找到数组的起始位置
  const arrayStartMatch = jsonStr.match(new RegExp(`"${arrayName}"\\s*:\\s*\\[`));
  if (!arrayStartMatch) return items;
  
  const startIndex = arrayStartMatch.index! + arrayStartMatch[0].length;
  
  // 使用括号匹配找到数组结束位置
  let depth = 1;
  let currentIndex = startIndex;
  let currentItemStart = -1;
  
  while (currentIndex < jsonStr.length && depth > 0) {
    const char = jsonStr[currentIndex];
    
    if (char === '{') {
      if (depth === 1 && currentItemStart === -1) {
        currentItemStart = currentIndex;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 1 && currentItemStart !== -1) {
        // 提取这个对象
        const itemStr = jsonStr.substring(currentItemStart, currentIndex + 1);
        // 关键修复：在解析前清理控制字符
        const cleanedItemStr = removeControlCharsInStrings(itemStr);
        try {
          const item = JSON.parse(cleanedItemStr);
          items.push(item);
        } catch (e) {
          // 尝试修复并解析
          const fixedItem = tryParseObject(cleanedItemStr);
          if (fixedItem) items.push(fixedItem);
        }
        currentItemStart = -1;
      }
    } else if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
    }
    
    currentIndex++;
  }
  
  return items;
}

/**
 * 尝试解析单个对象
 */
function tryParseObject(objStr: string): any | null {
  // 首先清理控制字符
  let fixed = removeControlCharsInStrings(objStr);
  
  try {
    return JSON.parse(fixed);
  } catch {
    // 尝试修复常见的 JSON 问题
    
    // 修复未转义的引号
    fixed = fixed.replace(/"([^"]+)":\s*"([^"]*)"([^"]*)"([^"]*)"/g, '"$1": "$2\\"$3\\"$4"');
    
    // 修复多余的逗号
    fixed = fixed.replace(/,\s*}/g, '}');
    fixed = fixed.replace(/,\s*]/g, ']');
    
    // 添加缺失的闭合括号
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;
    
    for (let i = 0; i < fixed.length; i++) {
      const char = fixed[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\') {
        escape = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }
    }
    
    if (inString) fixed += '"';
    while (openBrackets > 0) { fixed += ']'; openBrackets--; }
    while (openBraces > 0) { fixed += '}'; openBraces--; }
    
    try {
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

/**
 * 安全解析 LLM 返回的 JSON
 * @param response LLM 返回的原始响应
 * @param fallback 解析失败时的默认返回值
 * @returns 解析后的 JSON 对象或默认值
 */
export function safeParseJSON<T>(response: string, fallback: T): T {
  const result = tryExtractAndFixJSON(response);
  return result !== null ? result : fallback;
}
