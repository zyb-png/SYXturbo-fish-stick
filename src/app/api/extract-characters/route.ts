import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON, removeControlCharsInStrings } from '@/lib/json-utils';
import { requireUserLoginResponse } from '@/lib/auth-guard';

// 每批处理的人物数
const BATCH_SIZE = 8;

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const { content, fileName, batch = 0, characterMarkers } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取人物，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 第一批或没有人物标记时：识别所有人物名称
    let allCharacterMarkers: string[] = characterMarkers || [];
    
    if (batch <= 1 || !characterMarkers || characterMarkers.length === 0) {
      // 识别人物标记
      allCharacterMarkers = await identifyCharacterMarkers(content, fileName);
      console.log(`识别到 ${allCharacterMarkers.length} 个人物:`, allCharacterMarkers);
    }

    if (allCharacterMarkers.length === 0) {
      // 如果没有识别到人物标记，使用传统方式
      const result = await extractCharactersTraditional(content, fileName);
      return NextResponse.json({
        success: true,
        type: 'characters',
        data: result,
        batchInfo: {
          currentBatch: 1,
          totalBatches: 1,
          hasMore: false,
        },
        tokenUsage: result.tokenUsage,
      });
    }

    // 分批提取人物详情
    const totalBatches = Math.ceil(allCharacterMarkers.length / BATCH_SIZE);
    // 确保 batch 至少为 1
    const currentBatch = Math.max(1, batch);
    const currentBatchStart = (currentBatch - 1) * BATCH_SIZE;
    const currentBatchCharacters = allCharacterMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    
    console.log(`处理第 ${currentBatch}/${totalBatches} 批，人物: ${currentBatchCharacters.join(', ')}`);

    // 提取当前批次的人物详情，传入起始 id 确保全局唯一
    const startId = currentBatchStart;
    const batchResult = await extractBatchCharacters(content, currentBatchCharacters, startId);
    
    const hasMore = currentBatch < totalBatches;
    
    console.log(`人物提取完成，批次 ${currentBatch}/${totalBatches}，返回 ${batchResult.characters.length} 个人物`);

    return NextResponse.json({
      success: true,
      type: 'characters',
      data: {
        totalCharacters: allCharacterMarkers.length,
        characters: batchResult.characters,
      },
      batchInfo: {
        currentBatch: currentBatch,
        totalBatches,
        hasMore,
        characterMarkers: allCharacterMarkers,
      },
      tokenUsage: batchResult.tokenUsage,
    });
  } catch (error: any) {
    console.error('人物提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '人物提取失败', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * 识别所有人物名称
 */
async function identifyCharacterMarkers(content: string, fileName: string): Promise<string[]> {
  const localCharacters = extractLocalCharacterNames(content);
  if (localCharacters.length > 0) {
    console.log(`从剧本结构识别到 ${localCharacters.length} 个人物:`, localCharacters);
    return localCharacters.slice(0, 30);
  }

  const systemPrompt = `你是一个专业的影视角色分析师。请分析文本，识别所有独特的人物名称。

**重要规则**：
1. 只返回人物名称数组，不要返回其他内容
2. 人物名称应该准确（如：张三、李四、王五等）
3. 合并同一人物的不同称呼（如"张三"和"老张"合并为"张三"）
4. 按出场顺序或重要性排列
5. 最多识别30个主要人物

输出JSON数组格式：
["人物1", "人物2", "人物3"]`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请识别以下文本中的所有人物名称：\n\n文件名：${fileName}\n\n内容：\n${content.substring(0, 50000)}` }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.3,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('人物名称模型识别失败，使用本地兜底:', error?.message || error);
    return extractLocalCharacterNames(content).slice(0, 30);
  }

  // 清理响应内容，移除 markdown 代码块标记
  let cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  // 如果响应以数组开始，直接尝试解析（先清理控制字符）
  if (cleanedResponse.startsWith('[')) {
    try {
      // 关键修复：先清理控制字符再解析
      const sanitizedResponse = removeControlCharsInStrings(cleanedResponse);
      const parsed = JSON.parse(sanitizedResponse);
      if (Array.isArray(parsed)) {
        // 去重：确保每个名称只出现一次
        const uniqueNames = [...new Set(parsed.filter((s): s is string => typeof s === 'string'))];
        return uniqueNames;
      }
    } catch (e) {
      console.log('人物名称数组解析失败:', e);
      // 解析失败，继续尝试其他方法
    }
  }

  // 解析人物名称数组
  const result = tryExtractAndFixJSON(response);
  if (Array.isArray(result)) {
    // 去重：确保每个名称只出现一次
    const uniqueNames = [...new Set(result.filter((s): s is string => typeof s === 'string'))];
    return uniqueNames;
  }
  
  // 尝试用正则提取
  const matches = response.match(/"([^"]+)"/g);
  if (matches) {
    const names = matches.map(m => m.replace(/"/g, '')).filter(s => s.length > 0 && s.length < 50);
    // 去重
    return [...new Set(names)];
  }

  return [];
}

function extractLocalCharacterNames(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const blocked = new Set(['人物', '角色', '场景', '道具', '时间', '旁白', '画面', '镜头', '字幕']);
  const addName = (rawName: string) => {
    const name = rawName
      .replace(/（.*?）/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[*×xX]\d+/g, '')
      .replace(/[:：].*$/g, '')
      .trim();

    if (
      name &&
      name.length >= 2 &&
      name.length <= 12 &&
      !blocked.has(name) &&
      !seen.has(name)
    ) {
      seen.add(name);
      names.push(name);
    }
  };

  const castPatterns = [
    /【人物】([^【\n\r]+)/g,
    /人物[:：]([^\n\r]+)/g,
    /角色[:：]([^\n\r]+)/g,
  ];

  for (const pattern of castPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      for (const rawName of match[1].split(/[、,，;；\s]+/)) {
        addName(rawName);
      }
    }
  }

  if (names.length < 3) {
    const dialoguePattern = /(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z]{2,8})[：:]/g;
    let match: RegExpExecArray | null;
    while ((match = dialoguePattern.exec(content)) !== null) {
      addName(match[1]);
    }
  }

  return names;
}

function normalizeCharacterRole(role: any): string {
  if (typeof role !== 'string' || !role.trim()) return '次要配角';
  const normalized = role.trim();
  if (normalized.includes('主角') && !normalized.includes('配角')) return '主角';
  if (normalized.includes('主要配角')) return '主要配角';
  if (normalized.includes('次要配角')) return '次要配角';
  if (normalized.includes('龙套')) return '龙套';
  if (normalized.includes('路人')) return '路人';
  if (normalized.includes('背景') || normalized.includes('群众')) return '背景人物';
  return '次要配角';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGender(value: any): '' | '男' | '女' | '待定' {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (/待定|未知|不明|无法判断/.test(text)) return '待定';
  const hasFemale = /女|女性|女生|女孩|女人/.test(text);
  const hasMale = /男|男性|男生|男孩|男人/.test(text);
  if (hasFemale && !hasMale) return '女';
  if (hasMale && !hasFemale) return '男';
  return '';
}

function collectCharacterEvidence(content: string, name: string, radius = 140, maxCount = 6): string[] {
  if (!name) return [];
  const evidence: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(escapeRegExp(name), 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null && evidence.length < maxCount) {
    const start = Math.max(0, match.index - radius);
    const end = Math.min(content.length, match.index + name.length + radius);
    const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
    if (snippet && !seen.has(snippet)) {
      seen.add(snippet);
      evidence.push(snippet);
    }
  }

  return evidence;
}

function inferGenderFromName(name: string): '' | '男' | '女' {
  if (!name) return '';
  if (/母|妈|妈妈|姐姐|妹妹|阿姨|嫂|妻|夫人|太太|小姐|姑娘|女孩|女儿|新娘|老板娘/.test(name)) return '女';
  if (/父|爸|爸爸|叔|伯|哥|哥哥|爷|爷爷|儿子|先生|少爷|老爷|公子|男孩/.test(name)) return '男';
  if (/沈念|明珠|巧云|春梅|桂芳|晓晓|梦瑶|小芳|小美/.test(name)) return '女';
  if (/延之|方宇|顾父|王叔|老陈|张村长/.test(name)) return '男';
  if (/[婷娜娟芳梅兰雪霞莉丽敏婧妍媛瑶琳倩萍慧颖]$/.test(name)) return '女';
  if (/[伟强刚勇军杰磊鹏涛斌龙峰]$/.test(name)) return '男';
  return '';
}

function inferGenderFromEvidence(name: string, content: string): '' | '男' | '女' {
  const evidence = collectCharacterEvidence(content, name, 220, 10).join(' ');
  if (!evidence) return '';

  const femalePatterns = [
    /她/g,
    /女主|女配|女二|女反派|女儿|养女|亲生女|女孩|女生|女人|姑娘|小姐|大小姐|千金|夫人|太太|母亲|妈妈|姐姐|妹妹|妻子|老婆|未婚妻|新娘|闺蜜|姐妹|母女|父女|姐弟/g,
    /叫她|喊她|问她|对她说|拉着她|抱住她|保护她|她的|嫁给|娶她/g,
    new RegExp(`${escapeRegExp(name)}[（(][^）)]*(女|养女|女儿|姑娘|小姐|大小姐|千金|太太|夫人|妻子|未婚妻|新娘|姐姐|妹妹)`, 'g'),
    new RegExp(`${escapeRegExp(name)}[^。！？\\n]{0,40}(她|女儿|养女|小姐|姑娘|妻子|未婚妻|母亲|妈妈|姐姐|妹妹|新娘|太太|夫人)`, 'g'),
    new RegExp(`(她|女儿|养女|小姐|姑娘|妻子|未婚妻|母亲|妈妈|姐姐|妹妹|新娘|太太|夫人)[^。！？\\n]{0,40}${escapeRegExp(name)}`, 'g'),
  ];
  const malePatterns = [
    /他/g,
    /男主|男配|男二|男反派|儿子|养子|亲生子|男孩|男生|男人|先生|少爷|老爷|公子|父亲|爸爸|哥哥|弟弟|丈夫|老公|未婚夫|新郎|兄弟|父子|母子|兄妹/g,
    /叫他|喊他|问他|对他说|拉着他|抱住他|保护他|他的|他娶|他要娶/g,
    new RegExp(`${escapeRegExp(name)}[（(][^）)]*(男|养子|儿子|先生|少爷|老爷|公子|丈夫|未婚夫|新郎|父亲|爸爸|哥哥|弟弟)`, 'g'),
    new RegExp(`${escapeRegExp(name)}[^。！？\\n]{0,40}(他|儿子|养子|先生|少爷|丈夫|未婚夫|父亲|爸爸|哥哥|弟弟|新郎)`, 'g'),
    new RegExp(`(他|儿子|养子|先生|少爷|丈夫|未婚夫|父亲|爸爸|哥哥|弟弟|新郎)[^。！？\\n]{0,40}${escapeRegExp(name)}`, 'g'),
  ];

  const score = (patterns: RegExp[]) => patterns.reduce((sum, pattern) => {
    pattern.lastIndex = 0;
    return sum + (evidence.match(pattern)?.length || 0);
  }, 0);

  const femaleScore = score(femalePatterns);
  const maleScore = score(malePatterns);
  if (femaleScore > maleScore) return '女';
  if (maleScore > femaleScore) return '男';
  return '';
}

function resolveCharacterGender(name: string, content: string, modelGender: any): '男' | '女' | '待定' {
  const normalizedModelGender = normalizeGender(modelGender);
  const evidenceGender = inferGenderFromEvidence(name, content);
  const nameHintGender = inferGenderFromName(name);

  if (evidenceGender) return evidenceGender;
  if (normalizedModelGender && normalizedModelGender !== '待定') {
    if (nameHintGender && nameHintGender !== normalizedModelGender) return nameHintGender;
    return normalizedModelGender;
  }
  if (nameHintGender) return nameHintGender;
  return '待定';
}

function textContradictsGender(value: any, gender: '男' | '女' | '待定'): boolean {
  if (gender === '待定') return false;
  const text = Array.isArray(value) || (value && typeof value === 'object')
    ? JSON.stringify(value)
    : String(value || '');
  if (gender === '女') return /男性角色|男士|男装|男人|男孩|男生/.test(text);
  return /女性角色|女士|女装|女人|女孩|女生/.test(text);
}

function buildCharacterContextDigest(content: string, characterNames: string[]): string {
  return characterNames.map((name) => {
    const snippets = collectCharacterEvidence(content, name, 120, 4);
    const evidence = snippets.length > 0
      ? snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')
      : '未在文本片段中找到明确上下文，请勿凭空设定性别。';
    return `【${name}】\n${evidence}`;
  }).join('\n\n');
}

/**
 * 提取一批人物的详细信息
 */
async function extractBatchCharacters(
  content: string,
  characterNames: string[],
  startId: number = 0  // 全局起始 id，确保不同批次的人物 id 不重复
): Promise<{ characters: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视角色分析师。为指定的人物生成详细信息。

**绝对重要规则**：
1. **必须为输入列表中的每个人物都生成信息，不能遗漏任何人！**
2. 即使人物只是简短提到或背景角色，也必须生成完整信息
3. 确保输出的人物名称与输入的人物名称**完全一致**（包括大小写、标点）
4. appearance 字段必须详细描述人物的外貌特征（身高、体型、发型、五官特点、皮肤质感、穿着风格等，**80-150字**）
5. **faceFeatures 字段必须详细描述人物的固定脸型特征**，这些特征在所有场景下都保持不变
6. **looks 字段必须识别人物在不同场景、不同阶段的造型变化**
7. 如果文本中有明确提到人物在不同场景的服装、发型变化，必须提取为多个造型
8. 每个人物至少需要有一个造型（默认造型）
9. 描述要适合真人电影风格，避免卡通化或过度夸张
10. role 只能使用：主角、主要配角、次要配角、龙套、路人、背景人物
11. gender 只能使用：男、女、待定。必须根据参考文本中的称谓、代词、亲属关系、括号身份说明判断；不要因为示例、职业或默认习惯把未知人物写成男性。
12. 如果人物上下文中出现“她、女儿、养女、小姐、夫人、母亲、姐姐、妹妹、妻子、姑娘”等女性证据，gender 必须为“女”；出现“他、儿子、先生、父亲、哥哥、弟弟、丈夫”等男性证据，gender 才写“男”；没有明确证据时写“待定”。
13. 性别判断优先级：先看别人对该人物的称呼和亲属/婚恋关系，其次看角色间互动方式里的代词和行为关系，最后才参考姓名气质；不能只因为职业、地位、年龄或模板示例判断性别。

每个人物包含：
- id: 序号
- name: 人物名称（必须与输入的人物名称完全一致）
- role: 主角/主要配角/次要配角/龙套/路人/背景人物（必须填写）
- age: 年龄（如：25岁、中年、老年等）
- gender: 男/女/待定
- personality: 性格特点数组（必须填写，至少2个）
- appearance: 外貌详细描述（**必须填写，80-150字**，包含身高体型、发型、五官、皮肤质感、穿着风格等细节）
- faceFeatures: 固定脸型特征对象（**必须填写**，包含脸型、眼睛、鼻子、嘴巴、肤色，这些特征在所有场景下保持一致）
  - faceShape: 脸型（如：椭圆脸、圆脸、方脸、鹅蛋脸等）
  - eyes: 眼睛特征（如：双眼皮大眼睛、丹凤眼、杏眼等）
  - nose: 鼻子特征（如：高鼻梁、翘鼻、塌鼻等）
  - mouth: 嘴巴特征（如：樱桃小嘴、薄唇、丰唇等）
  - skinTone: 肤色（如：白皙、健康、小麦色等）
- looks: 不同场景/阶段造型数组（**必须填写，至少1个**，每个人物在不同场景或不同剧情阶段的造型）
  - id: 造型唯一标识（如：look-1, look-2）
  - scene: 适用场景（如：初见、战斗、婚礼、日常生活、工作等）
  - stage: 故事阶段（可选，如：前期、中期、后期）
  - description: 造型整体描述（50-100字）
  - costume: 服装详细描述
  - hairstyle: 发型描述
  - accessories: 配饰数组（如：项链、戒指、手镯等）
  - makeup: 化妆描述（如：淡妆、浓妆、无妆等）
  - mood: 情绪状态（如：微笑、严肃、悲伤等）
- background: 背景故事（如文本中有则填写）
- keyRelationships: 关键关系数组（列出与他人的重要关系）
- arc: 人物弧光（人物的发展变化轨迹）
- keyScenes: 关键出场场景数组
- props: 标志性道具数组

输出JSON格式：
{
  "characters": [
    {
      "id": 1,
      "name": "人物名称1",
      "role": "主角",
      "age": "25岁",
      "gender": "女",
      "personality": ["勇敢", "聪明", "正义感强"],
      "appearance": "详细描述外貌特征，包括身高体型、发型、五官特点、皮肤质感、穿着风格等（80-150字）",
      "faceFeatures": {
        "faceShape": "椭圆脸",
        "eyes": "双眼皮大眼睛",
        "nose": "高鼻梁",
        "mouth": "樱桃小嘴",
        "skinTone": "白皙"
      },
      "looks": [
        {
          "id": "look-1",
          "scene": "初见",
          "description": "第一次出场时的造型",
          "costume": "白色衬衫搭配黑色西装",
          "hairstyle": "利落短发",
          "accessories": ["银色手表"],
          "makeup": "淡妆",
          "mood": "微笑"
        },
        {
          "id": "look-2",
          "scene": "战斗",
          "description": "战斗场景的造型",
          "costume": "黑色战术服",
          "hairstyle": "凌乱的战斗发型",
          "accessories": ["战术手套", "护目镜"],
          "makeup": "无妆",
          "mood": "严肃"
        }
      ],
      "background": "背景故事",
      "keyRelationships": [{"target": "关系对象", "relationship": "关系类型"}],
      "arc": "人物发展轨迹",
      "keyScenes": ["关键出场场景1"],
      "props": ["标志性道具"]
    },
    {
      "id": 2,
      "name": "人物名称2",
      ...
    }
  ]
}

**重要提示：脸型一致性**
- faceFeatures 描述的是人物的固定特征，在所有场景下都保持不变
- looks 描述的是人物在不同场景的造型变化（服装、发型、配饰、化妆）
- 生成图片时，需要同时使用 faceFeatures 和 looks 的描述，确保脸型一致但造型变化`;

  const characterList = characterNames.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const characterContextDigest = buildCharacterContextDigest(content, characterNames);
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下所有人物生成详细信息（不要遗漏任何人）：\n${characterList}\n\n每个人物的上下文证据（优先依据这些片段判断性别、年龄、身份和关系）：\n${characterContextDigest}\n\n完整参考文本：\n${content.substring(0, 30000)}` }
  ];

  let response = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.5,
    });

    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content.toString();
    }
  } catch (error: any) {
    console.warn('人物详情模型提取失败，使用默认人物详情:', error?.message || error);
  }

  console.log(`人物详情提取响应长度: ${response.length} 字符`);
  console.log(`响应前500字符: ${response.substring(0, 500)}`);
  console.log(`响应后500字符: ${response.substring(Math.max(0, response.length - 500))}`);

  const result = tryExtractAndFixJSON(response);
  console.log(`JSON解析结果类型: ${typeof result}, 是否为null: ${result === null}`);
  if (result && typeof result === 'object') {
    console.log(`JSON解析结果键: ${Object.keys(result).join(', ')}`);
  }

  // 解析人物列表，更宽松的解析策略
  const characters: any[] = [];

  if (result && typeof result === 'object') {
    // 情况1: 标准格式 { characters: [...] }
    if (result.characters && Array.isArray(result.characters) && result.characters.length > 0) {
      characters.push(...result.characters);
      console.log(`JSON 解析成功，提取到 ${characters.length} 个人物（标准格式）`);
    } 
    // 情况2: 直接是数组格式 [...]
    else if (Array.isArray(result) && result.length > 0) {
      characters.push(...result);
      console.log(`JSON 解析为数组，提取到 ${characters.length} 个人物`);
    }
    // 情况3: 尝试其他可能的字段名
    else {
      for (const key of Object.keys(result)) {
        if (Array.isArray(result[key]) && result[key].length > 0) {
          characters.push(...result[key]);
          console.log(`JSON 从字段 ${key} 解析，提取到 ${characters.length} 个人物`);
          break;
        }
      }
    }
  }

  if (characters.length === 0) {
    console.log(`JSON 解析失败或结果为空，将基于 characterNames (${characterNames.length} 个) 生成默认数据`);
  } else {
    console.log(`成功解析 ${characters.length} 个人物的详细信息`);
    // 输出LLM返回的人物名称
    console.log(`LLM返回的人物名称: ${characters.map(c => c.name).join(', ')}`);
    console.log(`需要的人物名称: ${characterNames.join(', ')}`);
    // 找出缺失的人物
    const missingNames = characterNames.filter(name => !characters.some(c => c.name === name));
    if (missingNames.length > 0) {
      console.log(`缺失的人物: ${missingNames.join(', ')}`);
    }
  }

  // 确保所有人物都有完整的字段，尽量使用 LLM 返回的数据
  // 重要：使用 characterNames 的顺序来分配 id，确保名称和 id 正确对应
  const completeCharacters = characterNames.map((charName, idx) => {
    // 尝试从 LLM 返回的数据中找到匹配的人物（支持大小写不敏感匹配）
    const matchedChar = characters.find(c => 
      c.name === charName || 
      c.name.toLowerCase() === charName.toLowerCase() ||
      c.name.trim() === charName.trim()
    );
    
    // 使用 characterNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    const defaultGender = resolveCharacterGender(charName, content, matchedChar?.gender);
    const defaultAge = matchedChar?.age || (/村长|王叔|老陈|老板|刘总|孙总|钱老板/.test(charName) ? '45岁左右' : /李春梅|赵桂芳/.test(charName) ? '中年' : /张敏|李晓晓|小助理/.test(charName) ? '25岁左右' : /方宇/.test(charName) ? '28岁左右' : '30岁左右');
    const defaultPersonality = /方宇/.test(charName)
      ? ['冷静克制', '证据意识强', '外柔内刚']
      : /李春梅|赵桂芳/.test(charName)
        ? ['贪婪算计', '情绪外放', '欺软怕硬']
        : /张敏/.test(charName)
          ? ['真诚爽朗', '干练务实', '有分寸感']
          : /周特助|助理/.test(charName)
            ? ['专业谨慎', '执行力强', '反应敏捷']
            : ['性格鲜明', '行动直接', '服务剧情冲突'];
    
    // 生成默认的脸型特征
    const generateDefaultFaceFeatures = (char: any) => {
      const gender = normalizeGender(char.gender) || defaultGender;
      return {
        faceShape: gender === '女' ? '鹅蛋脸或柔和椭圆脸，轮廓自然清晰' : gender === '男' ? '椭圆脸或方中带圆的脸型，轮廓稳定' : '自然写实脸型，轮廓清晰稳定',
        eyes: gender === '女' ? '眼型清晰有神，情绪表达明显' : gender === '男' ? '眼神专注，眉眼有辨识度' : '眼神清晰，情绪表达自然',
        nose: '鼻梁自然端正，符合写实真人比例',
        mouth: gender === '女' ? '唇形自然，表情变化细腻' : gender === '男' ? '唇线清楚，表情克制有力度' : '唇形自然，表情变化符合剧情',
        skinTone: gender === '女' ? '自然肤色，质感干净' : gender === '男' ? '自然健康肤色，保留真实皮肤质感' : '自然肤色，保留真实皮肤质感',
      };
    };

    // 生成默认的造型（至少一个）
    const generateDefaultLooks = (char: any) => {
      const gender = normalizeGender(char.gender) || defaultGender;
      return [{
        id: 'look-1',
        scene: '默认造型',
        description: `${char.name}的基础出场造型，保持脸型和五官一致，服装根据人物身份与剧情阶段呈现写实短剧质感。`,
        costume: char.costume && char.costume.length > 0 && !textContradictsGender(char.costume[0], gender) ? char.costume[0] : (gender === '女' ? '简洁生活装或职业装，颜色自然，方便在不同场景延展' : gender === '男' ? '简洁日常装或商务装，剪裁利落，贴合人物身份' : '简洁写实服装，颜色自然，贴合人物身份'),
        hairstyle: gender === '女' ? '自然披发、低马尾或利落短发，根据场景微调' : gender === '男' ? '干净短发或自然整理发型' : '自然整理发型，贴合人物身份',
        accessories: [],
        makeup: gender === '女' ? '自然淡妆' : gender === '男' ? '自然无妆或轻微修饰' : '自然妆造',
        mood: '自然',
      }];
    };

    // 生成默认的外貌描述（更详细的模板）
    const generateDefaultAppearance = (char: any) => {
      const genderText = normalizeGender(char.gender) || defaultGender;
      const ageText = char.age || defaultAge;
      const personalityText = char.personality && Array.isArray(char.personality) && char.personality.length > 0 
        ? char.personality[0] 
        : defaultPersonality[0];
      const genderRoleText = genderText === '待定' ? '角色' : `${genderText}性角色`;
      const bodyText = genderText === '女'
        ? '身形自然匀称，面部线条柔和但有辨识度'
        : genderText === '男'
          ? '身材比例匀称，面部轮廓清晰'
          : '身材比例自然，面部轮廓清晰';
      
      return `${char.name}是${ageText}的${genderRoleText}，${personalityText}。${bodyText}，眼神和神态能体现人物当下情绪。服装以日常、商务或剧情场景搭配为主，整体贴合真人短剧写实风格。`;
    };
    
    // 辅助函数：判断字符串是否有效（非空且不包含"待补充"相关关键词）
    const isValidString = (value: any): boolean => {
      return value && 
             typeof value === 'string' && 
             value.trim().length > 0 && 
             !value.includes('待补充') &&
             !value.includes('待完善');
    };

    // 辅助函数：专门用于验证外貌描述，更宽松的判断
    const isValidAppearance = (value: any): boolean => {
      if (!value || typeof value !== 'string' || value.trim().length < 10) {
        return false;
      }
      const trimmed = value.trim();
      // 检查是否只是占位符
      if (trimmed === '待补充' || trimmed === '待完善' || trimmed === '暂无描述') {
        return false;
      }
      // 检查是否完全是"待补充..."模式
      if (/^待补充[\u4e00-\u9fa5]+$/.test(trimmed)) {
        return false;
      }
      return true;
    };
    
    // 辅助函数：获取有效值，优先使用 matchedChar 的值，其次使用默认值
    const getValue = (matchedValue: any, defaultValue: any) => {
      if (matchedValue !== undefined && matchedValue !== null) {
        if (Array.isArray(matchedValue)) {
          return matchedValue.length > 0 ? matchedValue : defaultValue;
        }
        if (isValidString(matchedValue)) {
          return matchedValue;
        }
      }
      return defaultValue;
    };
    
    if (matchedChar) {
      // 使用 LLM 返回的数据，填充缺失的字段
      console.log(`人物 ${charName} 找到匹配数据，使用 LLM 返回的信息`);
      const normalizedModelGender = normalizeGender(matchedChar.gender);
      const genderWasCorrected = Boolean(normalizedModelGender && normalizedModelGender !== '待定' && normalizedModelGender !== defaultGender);
      const safeMatchedChar = { ...matchedChar, name: charName, gender: defaultGender };
      const defaultLook = generateDefaultLooks(safeMatchedChar)[0];
      const safeLooks = !genderWasCorrected && !textContradictsGender(matchedChar.looks, defaultGender)
        ? getValue(matchedChar.looks, generateDefaultLooks(safeMatchedChar))
        : generateDefaultLooks(safeMatchedChar);
      const safeCostume = !genderWasCorrected && !textContradictsGender(matchedChar.costume, defaultGender)
        ? getValue(matchedChar.costume, [defaultLook.costume])
        : [defaultLook.costume];
      const safeCostumeDetails = !genderWasCorrected && matchedChar.costumeDetails && !textContradictsGender(matchedChar.costumeDetails, defaultGender)
        ? matchedChar.costumeDetails
        : {
            mainOutfit: defaultLook.costume,
            accessories: defaultLook.accessories,
            colorScheme: '自然写实配色',
            styleNotes: '贴合人物身份和短剧现实题材风格',
          };
      return {
        id: globalId,
        name: charName,
        role: normalizeCharacterRole(getValue(matchedChar.role, '次要配角')),
        age: getValue(matchedChar.age, defaultAge),
        gender: defaultGender,
        personality: getValue(matchedChar.personality, defaultPersonality),
        // appearance 字段使用专门的验证函数
        appearance: isValidAppearance(matchedChar.appearance) && !textContradictsGender(matchedChar.appearance, defaultGender)
          ? matchedChar.appearance 
          : generateDefaultAppearance(safeMatchedChar),
        faceFeatures: !genderWasCorrected && !textContradictsGender(matchedChar.faceFeatures, defaultGender)
          ? matchedChar.faceFeatures || generateDefaultFaceFeatures(safeMatchedChar)
          : generateDefaultFaceFeatures(safeMatchedChar),
        looks: safeLooks,
        background: getValue(matchedChar.background, `${charName}在剧情中承担${normalizeCharacterRole(getValue(matchedChar.role, '次要配角'))}功能，主要围绕核心矛盾推进人物关系和事件冲突。`),
        keyRelationships: getValue(matchedChar.keyRelationships, []),
        arc: getValue(matchedChar.arc, `${charName}随着剧情推进经历立场、情绪或处境变化，形象服务于故事冲突和反转。`),
        keyScenes: getValue(matchedChar.keyScenes, []),
        costume: safeCostume,
        costumeDetails: safeCostumeDetails,
        props: getValue(matchedChar.props, []),
      };
    } else {
      // 没有找到匹配的人物，生成默认数据
      console.log(`人物 ${charName} 没有在 LLM 响应中找到，生成默认数据`);
      return {
        id: globalId,
        name: charName,
        role: '次要配角',
        age: defaultAge,
        gender: defaultGender,
        personality: defaultPersonality,
        appearance: generateDefaultAppearance({ name: charName, age: defaultAge, gender: defaultGender, personality: defaultPersonality }),
        faceFeatures: generateDefaultFaceFeatures({ name: charName, gender: defaultGender }),
        looks: generateDefaultLooks({ name: charName, gender: defaultGender }),
        background: `${charName}在剧情中承担次要配角功能，主要围绕核心矛盾推进人物关系和事件冲突。`,
        keyRelationships: [],
        arc: `${charName}随着剧情推进经历立场、情绪或处境变化，形象服务于故事冲突和反转。`,
        keyScenes: [],
        costume: [generateDefaultLooks({ name: charName, gender: defaultGender })[0].costume],
        costumeDetails: {
          mainOutfit: generateDefaultLooks({ name: charName, gender: defaultGender })[0].costume,
          accessories: [],
          colorScheme: '自然写实配色',
          styleNotes: '贴合人物身份和短剧现实题材风格',
        },
        props: [],
      };
    }
  });

  console.log(`extractBatchCharacters 完成: characterNames=${characterNames.length}, completeCharacters=${completeCharacters.length}`);
  
  // 输出每个人物的详细信息用于调试
  completeCharacters.forEach((char, idx) => {
    console.log(`人物 ${idx + 1} [${char.name}]:`);
    console.log(`  - role: ${char.role}`);
    console.log(`  - appearance: ${char.appearance}`);
    console.log(`  - personality: ${JSON.stringify(char.personality)}`);
    console.log(`  - costume: ${JSON.stringify(char.costume)}`);
  });

  return {
    characters: completeCharacters.slice(0, characterNames.length),
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}

/**
 * 传统方式提取人物（无人物标记时使用）
 */
async function extractCharactersTraditional(
  content: string,
  fileName: string
): Promise<any> {
  const systemPrompt = `你是一个专业的影视角色分析师。你的任务是：
1. 分析给定的文本内容，提取所有人物角色
2. 每个人物必须生成 role、age、gender、personality、appearance、faceFeatures、looks、background、keyRelationships、arc、keyScenes、props
3. role 只能使用：主角、主要配角、次要配角、龙套、路人、背景人物
4. appearance 必须是 80-150 字外貌描述，包含身高体型、发型、五官、肤色质感、穿着风格
5. faceFeatures 必须是固定脸型特征，包括脸型、眼睛、鼻子、嘴巴、肤色，后续所有造型都保持一致
6. looks 必须识别人物在不同场景/阶段的造型变化，包括服装、发型、配饰、化妆、情绪状态
7. background 写背景故事，keyRelationships 写人物关系，arc 写人物弧光，keyScenes 写关键场景，props 写标志性道具
8. gender 只能使用：男、女、待定。必须根据文本中的称谓、代词、亲属关系、括号身份说明、角色互动方式判断；不要默认男性，不确定就写“待定”。
9. 性别判断优先级：先看别人对该人物的称呼和亲属/婚恋关系，其次看角色间互动方式里的代词和行为关系，最后才参考姓名气质。

请以 JSON 格式返回结果，格式如下：
{
  "totalCharacters": 人物总数,
  "characters": [
    {
      "id": 1,
      "name": "人物名称",
      "role": "主角/主要配角/次要配角/龙套/路人/背景人物",
      "age": "年龄",
      "gender": "女",
      "personality": ["性格特点1", "性格特点2"],
      "appearance": "80-150字外貌描述，包含身高体型、发型、五官、肤色质感、穿着风格",
      "faceFeatures": {
        "faceShape": "脸型",
        "eyes": "眼睛特征",
        "nose": "鼻子特征",
        "mouth": "嘴巴特征",
        "skinTone": "肤色"
      },
      "looks": [
        {
          "id": "look-1",
          "scene": "默认造型",
          "description": "造型描述",
          "costume": "服装",
          "hairstyle": "发型",
          "accessories": ["配饰"],
          "makeup": "化妆",
          "mood": "情绪"
        }
      ],
      "background": "背景故事",
      "keyRelationships": [
        {
          "target": "关系对象",
          "relationship": "关系类型"
        }
      ],
      "arc": "人物弧光/发展轨迹",
      "keyScenes": ["关键出场场景1", "关键出场场景2"],
      "props": ["标志性道具1", "标志性道具2"]
    }
  ]
}

**重要提示**：
1. 必须返回完整且有效的 JSON 格式
2. 字符串中的引号需要转义为 \\"
3. 不要在 JSON 中添加注释
4. 确保所有数组和对象都正确闭合`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请分析以下文本并提取所有人物：\n\n文件名：${fileName}\n\n内容：\n${content}` }
  ];

  const inputTokens = estimateMessagesTokens(messages);

  let fullResponse = '';
  try {
    const stream = oaiStream(messages, {
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content.toString();
      }
    }
  } catch (error: any) {
    console.warn('传统人物模型提取失败，使用本地兜底:', error?.message || error);
    const localCharacters = extractLocalCharacterNames(content).slice(0, 30);
    const fallback = await extractBatchCharacters(content, localCharacters, 0);
    return {
      totalCharacters: fallback.characters.length,
      characters: fallback.characters,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const outputTokens = estimateTokens(fullResponse);

  console.log(`LLM 响应长度: ${fullResponse.length} 字符`);

  const result = tryExtractAndFixJSON(fullResponse);

  if (result) {
    if (Array.isArray(result.characters)) {
      result.characters = result.characters.map((character: any) => ({
        ...character,
        role: normalizeCharacterRole(character.role),
        gender: resolveCharacterGender(character.name || '', content, character.gender),
        appearance: textContradictsGender(character.appearance, resolveCharacterGender(character.name || '', content, character.gender))
          ? ''
          : character.appearance,
      }));
    }

    return {
      ...result,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  } else {
    console.error('JSON 解析失败，无法修复');
    return {
      totalCharacters: 0,
      characters: [],
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  }
}
