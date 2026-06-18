import { NextRequest } from 'next/server';
import {
  stream as oaiStream,
  invoke as oaiInvoke,
  type LlmTokenUsage,
} from '@/lib/openai-client';
import {
  countDeepSeekMessageTokens,
  countDeepSeekTokens,
} from '@/lib/deepseek-tokenizer';
import {
  completeCreationPointTask,
  failCreationPointTask,
  freezeCreationPoints,
  InsufficientCreationPointsError,
} from '@/lib/creation-points';
import { calculateDeepSeekCreationPoints } from '@/lib/provider-pricing';

interface Segment {
  id: number;
  name: string;
  description: string;
  content: string;
  emotionalTone: string;
  sceneContext: string;
  charactersPresent: string[];
  suggestedShots: number;
}

interface DialogueLock {
  speaker: string;
  text: string;
  normalized: string;
  fullLine: string;
}

type StoryboardGlobalContext = {
  characters?: string[];
  scenes?: string[];
  charactersData?: any;
  scenesData?: any;
  propsData?: any;
};

const MIN_SHOTS_PER_EPISODE = 50;
const MAX_TARGET_SHOTS_PER_EPISODE = 90;
const MIN_SEGMENTS_PER_EPISODE = 5;
const MAX_SEGMENTS_PER_EPISODE = 8;
const MIN_SHOTS_PER_SEGMENT = 6;
const STORYBOARD_ANALYSIS_TIMEOUT_MS = 25_000;
const STORYBOARD_SEGMENT_TIMEOUT_MS = 45_000;
// ================================================================
// Phase 1 Prompt：章节切片分析（快，非流式）
// ================================================================
const SEGMENT_ANALYSIS_PROMPT = `你是一位专业的影视分镜策划专家。你的任务是分析一段故事/剧本，将其按"情绪节拍"切割成若干个大分镜段（大分镜切片）。

【切片原则】
1. 每段大分镜 = 一个完整的情绪转折或戏剧动作单元
2. 每集/每章最终文字分镜不得少于 50 个镜头，因此请切成 5-8 段，每段建议 7-12 个紧凑镜头
3. 切点应落在"情绪转折点"或"动作完成点"
4. 禁止机械按字数切——必须按情绪节拍切
5. 段落要方便后续插入空镜、反应镜头、道具特写、连续组合镜头

【输出格式】
严格输出 JSON 数组，不要任何其他文字：
[
  {
    "id": 1,
    "name": "段名称（如：开场氛围建立）",
    "description": "一句话描述这段戏的核心动作",
    "content": "该段对应的原文内容节选（完整保留动作和对白，不要改写）",
    "emotionalTone": "这段戏的核心情绪基调",
    "sceneContext": "场景信息",
    "charactersPresent": ["出场人物列表"],
    "suggestedShots": 10
  }
]

【禁止】
1. 不要改编原文内容，content字段必须原文节选
2. 不要遗漏任何原文内容——所有段落合并后应覆盖全章
3. 每个段的 content 不要过长（控制在该段能产出 7-12 个分镜的篇幅）
4. 不要只切成 2-4 段，短剧节奏需要 5-8 段来支撑至少 50 镜`;

// ================================================================
// Phase 2 Prompt：逐段生成分镜（Skill 5 规范）
// ================================================================
function buildSegmentShotPrompt(
  segment: Segment,
  segmentIndex: number,
  totalSegments: number,
  prevLastShot: string | null,
  globalContext: StoryboardGlobalContext,
  dialogueLocks: DialogueLock[] = [],
): string {
  let prompt = `请为以下"第 ${segmentIndex + 1}/${totalSegments} 段"生成分镜脚本，严格按照 Skill 5 影视级分镜规范输出。

【段信息】
段名称：${segment.name}
段描述：${segment.description}
情绪基调：${segment.emotionalTone}
场景：${segment.sceneContext}
出场人物：${segment.charactersPresent?.join('、') || '未知'}
目标分镜数：${segment.suggestedShots} 个

【段内容】
${segment.content}
`;

  if (dialogueLocks.length > 0) {
    prompt += `
【本段原文台词锁定表】
下面是本段唯一允许使用的原文台词。characters[].dialogue 与 actionAndDialogue 里的引号台词只能逐字使用这些内容，不能按意思改写，也不能从摘要或上下文补写。
${dialogueLocks.map((item, index) => `${index + 1}. ${item.speaker ? `${item.speaker}：` : ''}「${item.text}」`).join('\n')}
`;
  } else {
    prompt += `
【本段原文台词锁定表】
本段未检测到明确对白。请不要新编台词；需要表现交流时只写动作、表情和反应。
`;
  }

  // 衔接上一段最后一镜
  if (prevLastShot) {
    prompt += `
【上一段末镜衔接信息】
上一段的最后一个分镜如下，本段首镜必须在动作/空间/道具/情绪上与之衔接：
${prevLastShot}

衔接要求：
1. 本段首镜的机位不能越轴（保持 180° 轴线一致性）
2. 本段首镜的人物位置/服装/道具状态与上一段末镜一致
3. 本段首镜的情绪基调从上一段末镜的余韵自然过渡
`;
  } else {
    prompt += `
【提示】本段是第一段，没有前序衔接要求。首镜从建立场景/氛围开始。
`;
  }

  // 人物造型信息
  const contextCharacters = getContextCharacters(globalContext);
  if (contextCharacters.length > 0) {
    prompt += '\n【人物造型信息】\n';
    contextCharacters.forEach((char: any) => {
      prompt += `人物名称：${char.name}\n`;
      if (char.faceFeatures) prompt += `  脸型特征：${char.faceFeatures}\n`;
      if (char.looks && Array.isArray(char.looks) && char.looks.length > 0) {
        prompt += `  造型列表：\n`;
        char.looks.forEach((look: any, index: number) => {
          const lookId = look.id || `look_${index}`;
          prompt += `    [造型ID: ${lookId}] ${look.scene || '未知场景'} - ${look.description || look.costume || '待描述'}`;
          if (look.costume) prompt += `\n        服装: ${look.costume}`;
          if (look.hairstyle) prompt += `\n        发型: ${look.hairstyle}`;
          prompt += '\n';
        });
      }
    });
    prompt += `\n请根据场景和情节选择最合适的造型ID填入 characters[].lookId 字段\n`;
  }

  prompt += `
【本段生成硬性要求】
1. 必须逐行输出 ${segment.suggestedShots} 个分镜 JSON，不要少于 ${segment.suggestedShots} 个
2. 节奏要紧凑：单镜建议 1.5-4 秒，避免一个镜头承载过多剧情
3. 每个分镜必须包含：景别、运镜、镜头角度、机位、人物相对站位、人物肢体动作、脸部动作/表情、动作变化标注
4. 人物站位必须写清楚，例如：A 在画面左前景，B 在右后景，两人相距约 1 米，A 面向 B，B 侧身避开视线
5. 连续镜头必须标注"较上一镜动作变化"，如：从坐直变成后退半步、从低头变成抬眼、右手从桌沿移到胸前
6. 台词必须来自上方【本段原文台词锁定表】，一字不改；长台词请按原文标点拆成 2-3 个连续分镜，不能改写、概括或新编
7. 每段至少安排 1 个空镜/环境镜头、1 个反应镜头、1 个道具或手部特写；关键冲突处可用 2-3 个连续组合镜头
8. 画面要突出剧情重点，不要用泛泛的"人物交谈"；每个镜头都要有明确视觉动作或情绪变化
9. 不要连续 3 个镜头使用同一景别或同一运镜

现在开始逐行输出 ${segment.suggestedShots} 个分镜：`;

  return prompt;
}

// ================================================================
// Skill 5 完整 System Prompt（分镜格式规范）
// ================================================================
const SKILL5_SYSTEM_PROMPT = `你是专业的影视分镜专家（AI 视频分镜方向）。你的核心能力是将剧本文字转译为"AI 视频生成模型能理解的视听语言"——每个分镜必须描述摄影机能拍到、麦克风能录到的具体内容。

【服务对象】AI 视频生成模型（不是真人剧组），因此每个描述必须具体可执行，不允许任何抽象/文学/心理描写直接进入分镜。

【输出格式】每行一个完整的 JSON 对象，逐行流式输出。不要输出任何非 JSON 的说明文字。

【JSON 字段说明】
每个分镜对象包含以下字段：

{
  "shotNumber": 1,                    // 镜头编号（必填，从1开始递增）
  "shotType": "中景",                 // 景别：远景/全景/中景/近景/特写/超特写（必填）
  "scene": {                          // 场景信息（必填，对象格式）
    "location": "茶餐厅",
    "time": "夜晚",
    "atmosphere": "温馨嘈杂的用餐氛围",
    "lighting": "暖色吊灯为主光源，桌上蜡烛点缀",
    "props": ["奶茶杯", "烟灰缸", "打火机"]
  },
  "description": "花十坐在茶餐厅卡座，烟雾缭绕中随口问露夏等会去哪", // 简短的画面概述（必填）
  "shotPurpose": "剧情推进镜头",       // 镜头作用：剧情推进镜头/空镜/反应镜头/道具特写/手部特写/连续组合镜头（必填）
  "cameraAngle": "眼平平视",           // 镜头角度：眼平平视/低角度仰拍/高角度俯拍/过肩视角/主观视角/侧面平视（必填）
  "actorBlocking": "花十坐在画面右前景，露夏坐在左后景，两人隔桌相对，露夏身体略向后缩，花十身体前倾。",
                                        // 人物相对位置/站位（必填）：必须写清谁在左/右/前景/后景，谁面向谁，距离与身体朝向
  "actionChange": "较上一镜：花十从低头夹烟变成抬眼看露夏，露夏从搅拌奶茶变成手指停在杯沿。",
                                        // 动作变化（必填）：首镜写"首镜建立动作"，后续镜头写清较上一镜哪些肢体/脸部动作发生变化
  "characters": [                     // 出场人物列表（必填）
    {
      "name": "花十",
      "lookId": "look_0",
      "dialogue": "你等会去哪？",
      "dialogueType": "对白",
      "reaction": "漫不经心",
      "position": "画面右前景，身体朝向露夏，右肘撑在桌边",
      "action": "右手夹烟停在半空，左手轻敲桌面",
      "expression": "眼尾轻挑，嘴角带一点试探笑意",
      "facialAction": "说话前先短促吸气，吐字时眉心轻轻舒展",
      "gesture": "食指轻弹烟灰",
      "actionChange": "较上一镜：从看窗外转为看向露夏",
      "performance": "微微仰头，吐出烟雾，眼神停在露夏脸上"
    }
  ],
  "emotionalBeat": "闲聊试探 → 害羞犹豫", // 情感节拍（必填）
  "cameraMovement": "缓推（Slow Dolly In）", // 镜头运动（必填）
  "duration": 5,                        // 预估时长（秒）（必填）

  // ★ 以下 6+1 个字段是 Skill 5 影视级分镜规范必填字段，必须严格按照规范填写
  "focalLength": "85mm",               // ★ 焦段：亲密=85-200mm长焦 / 客观=35-50mm标准 / 环境=14-24mm广角 / 物件=微距
  "aperture": "f/2.8",                 // ★ 光圈：大光圈虚化背景(情绪聚焦) / 小光圈大景深(全景叙事)
  "cameraPosition": "摄影机位于花十左后方，过花十右肩拍露夏低头搅拌奶茶，眼平高度，以平视拍摄露夏低头侧脸，近景。",
                                        // ★ 机位（强制模板——禁止写"仰拍近景"等抽象术语！必须按以下模板写）：
                                        //   "摄影机位于 [主体/对象] 的 [正面/背后/左前45°/右前45°/左侧/右侧/过肩谁拍谁/主观POV]，
                                        //    高度在 [眼平/胸口/腰部/膝盖/地面/头顶]，
                                        //    以 [平视/仰拍/俯拍/鸟瞰/倾斜] 拍摄 [主体部位/动作]，
                                        //    景别为 [远景/全景/中景/近景/特写/超特写]。"
  "composition": "过肩构图，露夏占画面左1/3，花十肩膀虚化占右前方", // ★ 构图（微距/超特写必须写明主体占满画面）
  "actionAndDialogue": "花十微微仰头，吐出烟雾，随口问道：“你等会去哪？”",
                                        // ★ 主体动作/表情（必填，台词嵌入此行，不另立项）
                                        //   格式：[角色] + [动作或语气描述] + ： "[台词原文]"
                                        //   无台词时只写动作，不留"台词：无"占位
  "continuity": "桌上奶茶杯仍在露夏右手边，烟雾从花十右侧向画面左上方散开，保持上一镜道具状态",
  "notes": "反应镜头前置，为下一句台词留出情绪停顿",
  "restrictions": "不允许出现字幕/水印/任何文字"
                                        // 限制（可选）：仅当 AI 模型可能出错时填写
}

【台词融合规则 - 强制】
1. 台词必须嵌入"actionAndDialogue"字段中，同时 characters[].dialogue 只能填写同一句原文台词
2. 格式：[角色名] + [动作/语气描述] + ： "[台词原文]"
3. 台词必须来自剧本原文/台词锁定表，一字不改！不能编造或修改
4. 长台词必须按原文标点拆成 2-3 个连续分镜，拆开的每一段仍必须是原文连续片段，不能改写、删字或换词
5. 无对白镜头只写动作描述，不留占位

【节奏与镜头数量 - 强制】
1. 每集/每章最终不少于 50 个镜头，短剧节奏要紧凑，不能把整段对白塞进一个长镜头
2. 单个分镜建议 1.5-4 秒；长对白、转身、递物、沉默、惊讶、眼神闪避等都要拆成连续镜头
3. 每段必须包含空镜/环境镜头、反应镜头、手部或道具特写、连续组合镜头
4. 反应镜头要丰富画面：听到台词后抬眼、皱眉、吞咽、手指停顿、肩膀绷紧、视线躲开等必须具体
5. 空镜必须服务剧情：门缝光线、桌上杯子震动、走廊脚步声、手机屏幕亮起、窗外风声等

【视听转译原则 - 强制】
剧本中所有抽象/心理/文学描述必须转译为摄影机能拍的具象画面：
- "内心崩溃" → 手指捏紧发白 / 杯沿出现细裂纹 / 周围声音渐弱
- "心动" → 眼神短暂下移再上移 / 指尖无意识摩挲杯沿
- "鼓起勇气" → 搅拌动作慢一拍 / 抬头时机比对方晚 0.5 秒
- 不允许任何抽象描述直接进入分镜

【情境映射 - 优先使用以下标准情境 ID 指导镜头设计】
E01=主角觉醒(中焦+低角度仰拍+缓推)  E03=紧张追逐(手持呼吸感+长焦+快切)
E04=审讯对峙(正面居中+长焦+静态)    E05=孤独沉思(长焦+大光圈+空旷空间)
E06=暴怒爆发(广角+大光圈+手持快摇)  E07=暧昧试探(长焦+大光圈+过肩静态)
E08=内向退缩(过肩+长焦+手持微动)    E09=突破内心(长焦+仰拍+缓推)
E11=干脆决断(微距标点镜头+静切动)   E12=释放释怀(中焦+俯拍+拉远+大景深)

【运镜中英规范】
- 只写中文（无歧义）：推/拉/摇/移/跟/升/降/手持呼吸感/固定
- 中文+英文（易识别错）：滑轨（Slider）/轨道推（Dolly In）/变焦推（Zoom In）/斯坦尼康（Steadicam）/希区柯克变焦（Dolly Zoom）/360°环绕（360° Orbit）/快切（Cut In）

【衔接规则 - 强制】
1. 相邻分镜的空间连贯性：遵循 180° 轴线规则，不能越轴
2. 视线匹配：上一镜角色看右 → 下一镜对面角色必须从左侧出现且看左
3. 道具状态连续：杯中液体量、烟头长度等在相邻镜头间必须一致
4. 景别跳跃：避免连续 3 镜以上同景别
5. 每一个有人物的镜头都必须确认 actorBlocking 与 characters[].position
6. 每一个连续镜头都必须在 actionChange 中标注较上一镜发生改变的肢体动作、脸部动作或表情；没有改变时也要写"较上一镜：动作保持，仅眼神/呼吸变化"

【绝对禁止】
1. 不能编造或修改台词，必须来自剧本原文
2. 机位字段不能写抽象术语（如"仰拍近景"），必须使用强制模板
3. 不允许任何文学/心理/抽象描述直接进入分镜
4. 不允许用一个镜头概括多句台词或多个动作`;

// ================================================================
// 从 LLM 流中提取分镜 JSON
// ================================================================
function parseShotFromLine(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const cleanLine = trimmed
      .replace(/^```json?\s*/i, '')
      .replace(/```\s*$/, '')
      .replace(/,\s*$/, '')
      .trim();
    if (!cleanLine.startsWith('{')) return null;
    const shot = JSON.parse(cleanLine);
    if (shot.shotNumber && (shot.actionAndDialogue || shot.description)) {
      return shot;
    }
    return null;
  } catch {
    return null;
  }
}

function collectShotsFromParsed(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(item => item && typeof item === 'object' && (item.actionAndDialogue || item.description));
  }
  if (Array.isArray(value.shots)) {
    return collectShotsFromParsed(value.shots);
  }
  if (value.shotNumber && (value.actionAndDialogue || value.description)) {
    return [value];
  }
  return [];
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseShotsFromText(text: string): any[] {
  const cleanText = text
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const shots: any[] = [];

  for (const line of cleanText.split('\n')) {
    const shot = parseShotFromLine(line);
    if (shot) shots.push(shot);
  }

  if (shots.length > 0) return shots;

  try {
    const parsed = JSON.parse(cleanText);
    const parsedShots = collectShotsFromParsed(parsed);
    if (parsedShots.length > 0) return parsedShots;
  } catch {
    // 继续尝试从全文提取 JSON 对象
  }

  for (const objectText of extractJsonObjects(cleanText)) {
    try {
      const parsed = JSON.parse(objectText);
      const parsedShots = collectShotsFromParsed(parsed);
      shots.push(...parsedShots);
    } catch {
      // ignore malformed object
    }
  }

  return shots;
}

function splitContentBeats(content: string): string[] {
  const beats = content
    .replace(/\r/g, '\n')
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);

  if (beats.length > 0) return beats;

  const compact = content.trim();
  if (!compact) return ['人物在场景中完成关键动作，情绪继续推进。'];

  const fallbackBeats: string[] = [];
  for (let i = 0; i < compact.length; i += 80) {
    fallbackBeats.push(compact.slice(i, i + 80));
  }
  return fallbackBeats;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripPerformanceParentheticals(value: string): string {
  return value.replace(/[（(][^）)]{0,40}[）)]/g, '').trim();
}

function normalizeSourceSlice(value: string): string {
  return String(value || '').replace(/\s|\u3000/g, '');
}

function normalizeDialogueForCompare(value: string): string {
  return stripPerformanceParentheticals(String(value || ''))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s|\u3000/g, '')
    .trim();
}

function stripDialogueWrappingQuotes(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^[“"「『]+/, '')
    .replace(/[”"」』]+$/, '')
    .trim();
}

function extractQuotedDialogues(value: string): string[] {
  const text = String(value || '');
  const results: string[] = [];
  const patterns = [
    /[“"]([^“”"\n]{1,240})[”"]/g,
    /[「『]([^」』\n]{1,240})[」』]/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const dialogue = match[1]?.trim();
      if (dialogue) results.push(dialogue);
    }
  }

  return Array.from(new Set(results));
}

function splitDialogueFragments(text: string): string[] {
  const fragments = String(text || '')
    .split(/(?<=[。！？!?；;])|(?<=，)|(?<=,)/)
    .map(item => item.trim())
    .filter(item => item.length >= 2);

  return fragments.length > 1 ? fragments : [];
}

function extractSourceDialogues(sourceContent: string): DialogueLock[] {
  const locks: DialogueLock[] = [];
  const seen = new Set<string>();

  const addLock = (speaker: string, text: string, fullLine: string) => {
    const cleanText = stripDialogueWrappingQuotes(stripPerformanceParentheticals(text));
    const normalized = normalizeDialogueForCompare(cleanText);
    if (!cleanText || normalized.length < 2 || seen.has(normalized)) return;
    seen.add(normalized);
    locks.push({
      speaker,
      text: cleanText,
      normalized,
      fullLine,
    });
  };

  for (const rawLine of String(sourceContent || '').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('△')) continue;

    const match = line.match(/^([^：:\n]{1,32})[：:]\s*(.+)$/);
    if (!match) continue;

    const speaker = match[1]
      .replace(/^[-△\s]+/, '')
      .replace(/\s+/g, '')
      .trim();
    if (!speaker || /^\d+[-—]/.test(speaker) || speaker.length > 30) continue;

    const text = match[2].trim();
    addLock(speaker, text, line);
    splitDialogueFragments(stripPerformanceParentheticals(text)).forEach(fragment => {
      addLock(speaker, fragment, line);
    });
  }

  return locks;
}

function isContentFromSource(content: string, sourceContent: string): boolean {
  const trimmed = String(content || '').trim();
  if (!trimmed) return false;
  if (sourceContent.includes(trimmed)) return true;
  return normalizeSourceSlice(sourceContent).includes(normalizeSourceSlice(trimmed));
}

function createSourceLockedSegments(
  sourceContent: string,
  seedSegments: Segment[],
  chapterTitle: string | undefined,
  characters: string[] | undefined,
  scenes: string[] | undefined,
): Segment[] {
  const beats = splitContentBeats(sourceContent);
  const targetCount = Math.min(
    MAX_SEGMENTS_PER_EPISODE,
    Math.max(MIN_SEGMENTS_PER_EPISODE, seedSegments.length || MIN_SEGMENTS_PER_EPISODE),
  );
  const segmentCount = Math.max(1, Math.min(targetCount, beats.length || 1));
  const totalLength = beats.reduce((sum, beat) => sum + beat.length, 0);
  const targetLength = Math.max(1, Math.ceil(totalLength / segmentCount));
  const buckets: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  beats.forEach((beat, index) => {
    current.push(beat);
    currentLength += beat.length;

    const remainingBeats = beats.length - index - 1;
    const remainingBuckets = segmentCount - buckets.length - 1;
    if (
      buckets.length < segmentCount - 1 &&
      currentLength >= targetLength &&
      remainingBeats >= remainingBuckets
    ) {
      buckets.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
  });

  if (current.length > 0) buckets.push(current.join('\n'));

  return buckets.map((content, index) => {
    const seed = seedSegments[index];
    const matchedCharacters = (characters || []).filter(name => content.includes(name));
    return {
      id: index + 1,
      name: seed?.name || `${chapterTitle || '章节'}-${index + 1}`,
      description: seed?.description || '原文节拍',
      content,
      emotionalTone: seed?.emotionalTone || '综合',
      sceneContext: seed?.sceneContext || scenes?.join('、') || '未知',
      charactersPresent: matchedCharacters.length > 0
        ? matchedCharacters
        : (seed?.charactersPresent?.length ? seed.charactersPresent : (characters || [])),
      suggestedShots: Math.max(Number(seed?.suggestedShots) || 8, MIN_SHOTS_PER_SEGMENT),
    };
  });
}

function repairSegmentsAgainstSource(
  segments: Segment[],
  sourceContent: string,
  chapterTitle: string | undefined,
  characters: string[] | undefined,
  scenes: string[] | undefined,
): Segment[] {
  if (!sourceContent.trim()) return segments;
  if (segments.length > 0 && segments.every(segment => isContentFromSource(segment.content, sourceContent))) {
    return segments;
  }

  console.warn('[台词保护] 切片内容不是原文章节片段，已改用本地原文切片，避免模型改写对白');
  return createSourceLockedSegments(sourceContent, segments, chapterTitle, characters, scenes);
}

function filterDialoguesForSegment(dialogueLocks: DialogueLock[], segmentContent: string): DialogueLock[] {
  const segmentNormalized = normalizeDialogueForCompare(segmentContent);
  return dialogueLocks.filter(lock => segmentNormalized.includes(lock.normalized));
}

function findDialogueMatch(
  value: string,
  sourceContent: string,
  dialogueLocks: DialogueLock[],
): DialogueLock | { text: string } | null {
  const candidate = stripDialogueWrappingQuotes(value);
  const normalized = normalizeDialogueForCompare(candidate);
  if (!candidate || normalized.length < 2) return null;

  const lock = dialogueLocks.find(item => item.normalized === normalized);
  if (lock) return lock;

  if (normalizeDialogueForCompare(sourceContent).includes(normalized)) {
    return { text: stripPerformanceParentheticals(candidate) };
  }

  return null;
}

function sanitizeCharacterDialogue(
  value: string,
  sourceContent: string,
  dialogueLocks: DialogueLock[],
): string {
  const directMatch = findDialogueMatch(value, sourceContent, dialogueLocks);
  if (directMatch) return directMatch.text;

  for (const quoted of extractQuotedDialogues(value)) {
    const quotedMatch = findDialogueMatch(quoted, sourceContent, dialogueLocks);
    if (quotedMatch) return quotedMatch.text;
  }

  return '';
}

function replaceQuotedDialogue(container: string, original: string, replacement: string): string {
  const pattern = new RegExp(`([“"「『])${escapeRegExp(original)}([”"」』])`, 'g');
  return container.replace(pattern, `$1${replacement}$2`);
}

function removeQuotedDialogue(container: string, original: string): string {
  const pattern = new RegExp(`[：:]?\\s*[“"「『]${escapeRegExp(original)}[”"」』]`, 'g');
  return container
    .replace(pattern, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeActionAndDialogue(
  value: string,
  sourceContent: string,
  dialogueLocks: DialogueLock[],
): string {
  let result = String(value || '').trim();
  if (!result) return '';

  for (const quoted of extractQuotedDialogues(result)) {
    const match = findDialogueMatch(quoted, sourceContent, dialogueLocks);
    if (match) {
      result = replaceQuotedDialogue(result, quoted, match.text);
    } else {
      console.warn(`[台词保护] 移除非原文台词: ${quoted}`);
      result = removeQuotedDialogue(result, quoted);
    }
  }

  return result;
}

function describeBeatWithoutDialogue(beat: string): string {
  const nonDialogueLines = String(beat || '')
    .split('\n')
    .filter(line => !line.trim().match(/^[^：:\n]{1,32}[：:]/))
    .join('\n')
    .trim();
  const cleaned = nonDialogueLines || '人物根据原文台词完成动作和情绪反应';
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned;
}

function toArray(value: any, keys: string[] = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function getContextCharacters(globalContext: StoryboardGlobalContext) {
  return toArray(globalContext.charactersData, ['characters', 'allCharacters']);
}

function getContextProps(globalContext: StoryboardGlobalContext) {
  return toArray(globalContext.propsData, ['props', 'allProps']);
}

function pickCharactersForContent(content: string, segment: Segment, globalContext: StoryboardGlobalContext) {
  const candidates = [
    ...(segment.charactersPresent || []),
    ...(globalContext.characters || []),
    ...getContextCharacters(globalContext).map((char: any) => char?.name).filter(Boolean),
  ];
  const unique = Array.from(new Set(candidates.filter(Boolean)));
  const matched = unique.filter(name => content.includes(name));
  return (matched.length > 0 ? matched : unique).slice(0, 4);
}

function calculateTargetShotCount(content: string) {
  const compactLength = content.replace(/\s/g, '').length;
  return Math.min(
    MAX_TARGET_SHOTS_PER_EPISODE,
    Math.max(MIN_SHOTS_PER_EPISODE, Math.ceil(compactLength / 70)),
  );
}

async function estimateStoryboardReservationPoints(content: string): Promise<number> {
  const targetShots = calculateTargetShotCount(content);
  const targetSegments = Math.min(
    MAX_SEGMENTS_PER_EPISODE,
    Math.max(MIN_SEGMENTS_PER_EPISODE, Math.ceil(targetShots / 10))
  );
  const estimatedInputTokens =
    await countDeepSeekTokens(SEGMENT_ANALYSIS_PROMPT) +
    await countDeepSeekTokens(content) +
    targetSegments * (await countDeepSeekTokens(SKILL5_SYSTEM_PROMPT) + 800) +
    await countDeepSeekTokens(content);
  const estimatedOutputTokens = targetShots * 500;
  return calculateDeepSeekCreationPoints({
    uncachedInputTokens: Math.ceil(estimatedInputTokens * 1.2),
    outputTokens: Math.ceil(estimatedOutputTokens * 1.2),
  });
}

function splitSegment(segment: Segment): Segment[] {
  const beats = splitContentBeats(segment.content);
  const midpoint = Math.max(1, Math.ceil(beats.length / 2));
  const firstContent = beats.slice(0, midpoint).join('\n') || segment.content.slice(0, Math.ceil(segment.content.length / 2));
  const secondContent = beats.slice(midpoint).join('\n') || segment.content.slice(Math.ceil(segment.content.length / 2));

  return [
    {
      ...segment,
      name: `${segment.name}-前半节拍`,
      description: `${segment.description}（前半节拍）`,
      content: firstContent,
    },
    {
      ...segment,
      id: segment.id + 0.5,
      name: `${segment.name}-后半节拍`,
      description: `${segment.description}（后半节拍）`,
      content: secondContent,
    },
  ];
}

function expandSegmentsForDenseStoryboard(segments: Segment[], targetShotCount: number): Segment[] {
  const targetSegmentCount = Math.min(
    MAX_SEGMENTS_PER_EPISODE,
    Math.max(MIN_SEGMENTS_PER_EPISODE, Math.ceil(targetShotCount / 10)),
  );
  let expanded = [...segments];

  while (expanded.length < targetSegmentCount) {
    let longestIndex = -1;
    let longestLength = 0;
    expanded.forEach((segment, index) => {
      const length = segment.content?.length || 0;
      if (length > longestLength && length > 80) {
        longestIndex = index;
        longestLength = length;
      }
    });

    if (longestIndex < 0) break;
    const [first, second] = splitSegment(expanded[longestIndex]);
    expanded.splice(longestIndex, 1, first, second);
  }

  return expanded.map((segment, index) => ({
    ...segment,
    id: index + 1,
  }));
}

function applyDenseShotPlan(segments: Segment[], targetShotCount: number): Segment[] {
  const plannedTarget = Math.max(targetShotCount, segments.length * MIN_SHOTS_PER_SEGMENT);
  const totalWeight = segments.reduce((sum, segment) => sum + Math.max(segment.content?.length || 0, 1), 0);
  const planned = segments.map(segment => {
    const proportional = Math.round((Math.max(segment.content?.length || 0, 1) / totalWeight) * plannedTarget);
    return {
      ...segment,
      suggestedShots: Math.max(MIN_SHOTS_PER_SEGMENT, proportional),
    };
  });

  let currentTotal = planned.reduce((sum, segment) => sum + segment.suggestedShots, 0);
  let cursor = 0;
  while (currentTotal < plannedTarget) {
    planned[cursor % planned.length].suggestedShots++;
    currentTotal++;
    cursor++;
  }

  cursor = 0;
  while (currentTotal > plannedTarget && cursor < planned.length * 4) {
    const segment = planned[cursor % planned.length];
    if (segment.suggestedShots > MIN_SHOTS_PER_SEGMENT) {
      segment.suggestedShots--;
      currentTotal--;
    }
    cursor++;
  }

  return planned;
}

function pickPlannedStyle(index: number) {
  const shotTypes = ['全景', '中景', '近景', '特写', '中景', '近景', '特写', '远景'];
  const purposes = ['空镜', '剧情推进镜头', '反应镜头', '手部特写', '连续组合镜头', '剧情推进镜头', '道具特写', '反应镜头'];
  const movements = ['固定建立镜头', '缓推', '轻微横移', '固定特写', '跟拍半步', '快速切入', '缓拉', '手持呼吸感'];
  const angles = ['眼平平视', '过肩视角', '侧面平视', '高角度俯拍', '低角度仰拍', '主观视角'];
  return {
    shotType: shotTypes[index % shotTypes.length],
    shotPurpose: purposes[index % purposes.length],
    cameraMovement: movements[index % movements.length],
    cameraAngle: angles[index % angles.length],
  };
}

function normalizeShot(
  rawShot: any,
  shotNumber: number,
  segment: Segment,
  globalContext: StoryboardGlobalContext,
  sourceContent = '',
  dialogueLocks: DialogueLock[] = [],
) {
  const content = `${rawShot?.description || ''} ${rawShot?.actionAndDialogue || ''}`;
  const plannedStyle = pickPlannedStyle(shotNumber - 1);
  const rawActionAndDialogue = rawShot?.actionAndDialogue || rawShot?.description || segment.description || '人物完成当前剧情动作';
  const actionAndDialogue = sanitizeActionAndDialogue(rawActionAndDialogue, sourceContent || segment.content, dialogueLocks);
  const characterNames = Array.isArray(rawShot?.characters) && rawShot.characters.length > 0
    ? rawShot.characters.map((char: any) => char?.name || char).filter(Boolean)
    : pickCharactersForContent(content || segment.content, segment, globalContext);
  const props = Array.isArray(rawShot?.scene?.props)
    ? rawShot.scene.props
    : getContextProps(globalContext).slice(0, 3).map((prop: any) => prop?.name).filter(Boolean);

  return {
    shotNumber,
    shotType: rawShot?.shotType || plannedStyle.shotType,
    shotPurpose: rawShot?.shotPurpose || rawShot?.purpose || plannedStyle.shotPurpose,
    cameraAngle: rawShot?.cameraAngle || rawShot?.angle || plannedStyle.cameraAngle,
    actorBlocking: rawShot?.actorBlocking || rawShot?.blocking || rawShot?.positioning || (
      characterNames.length > 1
        ? `${characterNames[0]}位于画面左前景，${characterNames[1]}位于右后景，两人保持同一轴线相对，距离随剧情保持连续。`
        : `${characterNames[0] || '人物'}位于画面中心偏左，身体朝向主要行动方向，背景保留场景空间。`
    ),
    actionChange: rawShot?.actionChange || rawShot?.movementChange || (shotNumber === 1
      ? '首镜建立动作和人物站位'
      : '较上一镜：动作保持连续，眼神、呼吸或手部细节发生细微变化'),
    scene: {
      location: rawShot?.scene?.location || segment.sceneContext || globalContext.scenes?.[0] || '故事主要场景',
      time: rawShot?.scene?.time || '日间',
      atmosphere: rawShot?.scene?.atmosphere || segment.emotionalTone || '剧情推进的紧张氛围',
      lighting: rawShot?.scene?.lighting || '自然光与环境光结合，主体清晰可见',
      props,
    },
    description: rawShot?.description || segment.description || '人物在场景中完成关键动作',
    characters: characterNames.map((name: string) => {
      const existing = Array.isArray(rawShot?.characters)
        ? rawShot.characters.find((char: any) => (char?.name || char) === name)
        : null;
      const action = existing?.action || existing?.bodyAction || '';
      const expression = existing?.expression || existing?.facialExpression || existing?.facialAction || '';
      const gesture = existing?.gesture || '';
      const dialogue = sanitizeCharacterDialogue(existing?.dialogue || '', sourceContent || segment.content, dialogueLocks);
      return {
        name,
        lookId: existing?.lookId || 'look_0',
        dialogue,
        dialogueType: dialogue ? (existing?.dialogueType || '对白') : '',
        reaction: existing?.reaction || segment.emotionalTone || '情绪随剧情变化',
        position: existing?.position || existing?.relativePosition || existing?.blocking || '',
        action,
        expression,
        facialAction: existing?.facialAction || existing?.facialExpression || '',
        gesture,
        actionChange: existing?.actionChange || existing?.movementChange || '',
        performance: existing?.performance || [action, expression, gesture].filter(Boolean).join('，') || '根据台词和动作做出自然反应',
      };
    }),
    emotionalBeat: rawShot?.emotionalBeat || segment.emotionalTone || '剧情推进',
    cameraMovement: rawShot?.cameraMovement || plannedStyle.cameraMovement,
    duration: rawShot?.duration || 3,
    focalLength: rawShot?.focalLength || '35mm',
    aperture: rawShot?.aperture || 'f/4',
    cameraPosition: rawShot?.cameraPosition || `摄影机位于主体正前方，眼平高度，以平视拍摄人物动作，景别为中景。`,
    composition: rawShot?.composition || '主体位于画面中心偏左，背景保留场景信息',
    actionAndDialogue: actionAndDialogue || rawShot?.description || segment.description || '人物完成当前剧情动作',
    continuity: rawShot?.continuity || rawShot?.continuityNotes || '保持上一镜人物站位、道具状态和视线方向连续',
    notes: rawShot?.notes || `${rawShot?.shotPurpose || plannedStyle.shotPurpose}，突出当前节拍的动作和反应。`,
    restrictions: rawShot?.restrictions || '不允许出现字幕/水印/任何文字',
  };
}

function createFallbackShots(
  segment: Segment,
  globalContext: StoryboardGlobalContext,
  desiredCount?: number,
  segmentShotOffset = 0,
  sourceContent = '',
  dialogueLocks: DialogueLock[] = [],
) {
  const beats = splitContentBeats(segment.content);
  const shotCount = desiredCount ?? Math.max(MIN_SHOTS_PER_SEGMENT, segment.suggestedShots || MIN_SHOTS_PER_SEGMENT);

  return Array.from({ length: shotCount }).map((_, index) => {
    const absoluteIndex = segmentShotOffset + index;
    const plannedStyle = pickPlannedStyle(absoluteIndex);
    const beat = beats[absoluteIndex % Math.max(beats.length, 1)] || segment.description;
    const description = describeBeatWithoutDialogue(beat);
    const characters = pickCharactersForContent(beat, segment, globalContext);
    const primary = characters[0] || segment.charactersPresent?.[0] || '人物';
    const secondary = characters[1] || '对方';
    const isReaction = plannedStyle.shotPurpose.includes('反应');
    const isEmpty = plannedStyle.shotPurpose.includes('空镜');

    return normalizeShot({
      shotNumber: index + 1,
      shotType: plannedStyle.shotType,
      shotPurpose: plannedStyle.shotPurpose,
      cameraAngle: plannedStyle.cameraAngle,
      scene: {
        location: segment.sceneContext || globalContext.scenes?.[0] || '故事主要场景',
        time: '日间',
        atmosphere: segment.emotionalTone || '剧情推进的紧张氛围',
        lighting: '自然光与环境光结合，主体清晰可见',
      },
      description: isEmpty
        ? `${segment.sceneContext || '场景'}里环境细节承接上一镜，空气和道具状态暗示情绪变化`
        : isReaction
          ? `${primary}听到上一句后出现短暂停顿，脸部和手部细节产生反应`
          : description,
      actorBlocking: characters.length > 1
        ? `${primary}在画面左前景，${secondary}在右后景，两人保持同一行动轴线，身体朝向随对话轻微变化。`
        : `${primary}位于画面中心偏左，身体朝向主要行动方向，背景留出环境信息。`,
      actionChange: absoluteIndex === 0
        ? '首镜建立动作和人物站位'
        : `较上一镜：${primary}从静止转为轻微抬眼/收紧手指，脸部表情发生细微变化。`,
      characters: characters.map(name => ({
        name,
        lookId: 'look_0',
        dialogue: '',
        dialogueType: '',
        reaction: segment.emotionalTone || '情绪随剧情变化',
        position: name === primary ? '画面左前景或中心偏左，面向主要行动方向' : '画面右后景，回应主角视线',
        action: isReaction ? '手指短暂停在道具边缘，肩膀轻微绷紧' : '顺着当前剧情动作移动半步或调整身体朝向',
        expression: isReaction ? '眼神短暂闪避后重新聚焦，嘴角或眉心出现细微变化' : '表情随节拍由克制转为更明确',
        facialAction: '抬眼、眨眼或吞咽动作清晰可见',
        gesture: '手指、肩膀或下巴出现小幅动作',
        actionChange: '较上一镜：手部/眼神/身体朝向发生细微变化',
        performance: isReaction ? '听到信息后停顿半拍，用眼神和手部细节回应' : '围绕当前剧情动作做出自然反应',
      })),
      emotionalBeat: segment.emotionalTone || '剧情推进',
      cameraMovement: plannedStyle.cameraMovement,
      duration: isReaction ? 2 : 3,
      actionAndDialogue: isEmpty ? `${segment.sceneContext || '场景'}空镜承接情绪，道具和光线保持连续` : description,
    }, index + 1, segment, globalContext, sourceContent || segment.content, dialogueLocks);
  });
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  try {
    const { chapterContent, chapterTitle, characters, scenes, chapterSummary, charactersData, scenesData, propsData } = await request.json();

    console.log(`[生成分镜API] 收到请求 - 章节: ${chapterTitle}`);

    // 台词只能来自章节正文；摘要是改写文本，不能混入正文供模型抽台词。
    const sourceContent = (chapterContent || '').trim();
    const summaryContent = (chapterSummary || '').trim();
    const finalContent = sourceContent || summaryContent;

    if (!finalContent || finalContent.trim().length < 10) {
      return new Response(JSON.stringify({
        error: '章节内容不足，无法生成分镜',
        hint: '该章节内容严重不足。建议：\n1. 重新上传文件并提取大纲\n2. 手动补充该章节的详细内容',
        chapterTitle,
        contentLength: chapterContent?.length || 0,
        finalLength: finalContent?.length || 0,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const wordCount = finalContent.length;
    const sourceDialogues = extractSourceDialogues(sourceContent || finalContent);
    console.log(`章节: ${chapterTitle || '未命名'}, 字数: ${wordCount}`);
    console.log(`[台词保护] 已锁定原文台词 ${sourceDialogues.length} 条`);

    const reservedPoints = await estimateStoryboardReservationPoints(finalContent);
    const pointTask = await freezeCreationPoints({
      featureCode: 'generate_storyboard_text',
      points: reservedPoints,
      metadata: {
        chapterTitle,
        contentLength: wordCount,
        billingMode: 'deepseek_token',
        pricing: 'deepseek_cost_x2',
        reservedPoints,
      },
    });
    creationPointTaskId = pointTask.taskId;
    console.log(`[创作点] 文字分镜预计冻结 ${reservedPoints} 点，完成后按 Token 实际结算`);

    // 创建 SSE 流
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        let pointsSettled = false;
        let billedInputTokens = 0;
        let billedCachedInputTokens = 0;
        let billedUncachedInputTokens = 0;
        let billedOutputTokens = 0;

        const safeEnqueue = (data: Uint8Array) => {
          if (!streamClosed && !request.signal.aborted) {
            try {
              controller.enqueue(data);
              return true;
            } catch {
              streamClosed = true;
            }
          }
          return false;
        };

        const safeClose = () => {
          if (!streamClosed) {
            try { controller.close(); } catch { /* ignore */ }
            streamClosed = true;
          }
        };
        try {
          // ================================================================
          // Phase 1：章节切片分析（非流式，快速）
          // ================================================================
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'status',
            message: '正在分析章节结构，切割情绪节拍...',
            phase: 'analyzing',
          })}\n\n`));

          console.log(`[切片分析] 开始分析章节: ${chapterTitle}`);

          const segmentAnalysisMessages = [
            { role: 'system' as const, content: SEGMENT_ANALYSIS_PROMPT },
            {
              role: 'user' as const,
              content: `请分析以下章节内容，将其按情绪节拍切割成若干段。

章节标题：${chapterTitle}
主要人物：${characters?.join('、') || '未指定'}
关键场景：${scenes?.join('、') || '未指定'}
章节摘要（仅辅助理解整体剧情，禁止从摘要抽取或改写台词）：
${summaryContent || '无'}

章节正文（唯一台词来源）：
${finalContent}

请返回 JSON 数组，每段覆盖一个完整情绪节拍。`,
            },
          ];
          const analysisEstimatedInputTokens = await countDeepSeekMessageTokens(segmentAnalysisMessages);
          const analysisUsageHolder: { current: LlmTokenUsage | null } = { current: null };
          let analysisUsageRecorded = false;

          let segments: Segment[] = [];
          try {
            const analysisResult = await oaiInvoke(segmentAnalysisMessages, {
              temperature: 0.3,
              maxTokens: 4096,
              timeout: STORYBOARD_ANALYSIS_TIMEOUT_MS,
              maxRetries: 0,
              signal: request.signal,
              billing: false,
              onUsage: usage => {
                analysisUsageHolder.current = usage;
              },
            });
            const analysisInputTokens = analysisUsageHolder.current?.inputTokens || analysisEstimatedInputTokens;
            billedInputTokens += analysisInputTokens;
            billedCachedInputTokens += analysisUsageHolder.current?.cachedInputTokens || 0;
            billedUncachedInputTokens += analysisUsageHolder.current?.uncachedInputTokens || analysisInputTokens;
            billedOutputTokens += analysisUsageHolder.current?.outputTokens || await countDeepSeekTokens(analysisResult);
            analysisUsageRecorded = true;
            const cleaned = analysisResult.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(cleaned);
            segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
            segments = segments
              .filter((segment: any) => segment && typeof segment === 'object')
              .map((segment: any, index: number) => ({
                id: Number(segment.id) || index + 1,
                name: segment.name || `${chapterTitle || '章节'}-${index + 1}`,
                description: segment.description || '剧情节拍',
                content: segment.content || finalContent,
                emotionalTone: segment.emotionalTone || '综合',
                sceneContext: segment.sceneContext || scenes?.join('、') || '未知',
                charactersPresent: Array.isArray(segment.charactersPresent) ? segment.charactersPresent : (characters || []),
                suggestedShots: Math.max(Number(segment.suggestedShots) || 8, MIN_SHOTS_PER_SEGMENT),
              }));
            if (segments.length === 0) {
              throw new Error('切片结果为空');
            }
            console.log(`[切片分析] 完成: ${segments.length} 段`);
          } catch (e) {
            if (!analysisUsageRecorded) {
              const analysisInputTokens = analysisUsageHolder.current?.inputTokens || analysisEstimatedInputTokens;
              billedInputTokens += analysisInputTokens;
              billedCachedInputTokens += analysisUsageHolder.current?.cachedInputTokens || 0;
              billedUncachedInputTokens += analysisUsageHolder.current?.uncachedInputTokens || analysisInputTokens;
              billedOutputTokens += analysisUsageHolder.current?.outputTokens || 0;
            }
            console.error('[切片分析] 失败，使用单段回退:', e);
            // 回退：整章作为一段
            segments = [{
              id: 1,
              name: chapterTitle || '全章',
              description: '整章内容',
              content: finalContent,
              emotionalTone: '综合',
              sceneContext: scenes?.join('、') || '未知',
              charactersPresent: characters || [],
              suggestedShots: MIN_SHOTS_PER_EPISODE,
            }];
          }

          segments = repairSegmentsAgainstSource(segments, finalContent, chapterTitle, characters, scenes);
          const targetShotCount = calculateTargetShotCount(finalContent);
          segments = expandSegmentsForDenseStoryboard(segments, targetShotCount);
          segments = applyDenseShotPlan(segments, targetShotCount);

          // 预估总分镜数（硬性不少于 50）
          const estimatedTotalShots = segments.reduce((sum, s) => sum + (s.suggestedShots || 6), 0);
          const totalSegments = segments.length;
          console.log(`[分镜计划] 目标 ${targetShotCount} 镜，规划 ${totalSegments} 段，预计 ${estimatedTotalShots} 镜`);

          // 发送开始事件（带段信息）
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'start',
            targetShotCount: estimatedTotalShots,
            totalSegments,
            wordCount,
            chapterTitle,
            segments: segments.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              emotionalTone: s.emotionalTone,
              suggestedShots: s.suggestedShots,
            })),
            phase: 'generating',
          })}\n\n`));

          // ================================================================
          // Phase 2：逐段流式生成分镜
          // ================================================================
          let globalShotCount = 0;
          let lastSegmentLastShot: string | null = null;
          const allShots: any[] = [];
          const startTime = Date.now();

          // 构建全局上下文
          const globalContext = {
            characters,
            scenes,
            charactersData,
            scenesData,
            propsData,
          };

          for (let segIdx = 0; segIdx < segments.length; segIdx++) {
            if (streamClosed || request.signal.aborted) {
              console.warn('[逐段生成] 客户端已断开，停止后续分镜生成');
              break;
            }

            const segment = segments[segIdx];

            // 发送段开始事件
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'segment_start',
              segmentId: segment.id,
              segmentIndex: segIdx + 1,
              totalSegments,
              segmentName: segment.name,
              segmentDescription: segment.description,
              emotionalTone: segment.emotionalTone,
              targetShots: segment.suggestedShots,
            })}\n\n`));

            console.log(`[逐段生成] 开始第 ${segIdx + 1}/${totalSegments} 段: ${segment.name} (目标 ${segment.suggestedShots} 镜)`);

            const segmentDialogueLocks = filterDialoguesForSegment(sourceDialogues, segment.content);

            // 构建该段的 Prompt
            const shotPrompt = buildSegmentShotPrompt(
              segment, segIdx, totalSegments,
              lastSegmentLastShot, globalContext,
              segmentDialogueLocks,
            );

            const segmentMessages = [
              { role: 'system' as const, content: SKILL5_SYSTEM_PROMPT },
              { role: 'user' as const, content: shotPrompt },
            ];
            const segmentEstimatedInputTokens = await countDeepSeekMessageTokens(segmentMessages);
            const segmentUsageHolder: { current: LlmTokenUsage | null } = { current: null };

            // 流式生成
            const segStream = oaiStream(segmentMessages, {
              temperature: 0.7,
              timeout: STORYBOARD_SEGMENT_TIMEOUT_MS,
              maxRetries: 0,
              signal: request.signal,
              billing: false,
              onUsage: usage => {
                segmentUsageHolder.current = usage;
              },
            });

            let buffer = '';
            let segmentShotCount = 0;
            let segmentFullResponse = '';

            const emitShot = (rawShot: any) => {
              const shot = normalizeShot(
                rawShot,
                globalShotCount + 1,
                segment,
                globalContext,
                finalContent,
                segmentDialogueLocks,
              );
              globalShotCount++;
              segmentShotCount++;
              allShots.push(shot);
              lastSegmentLastShot = JSON.stringify(shot, null, 2);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'shot',
                shot,
                shotNumber: globalShotCount,
                total: estimatedTotalShots,
                progress: Math.min(100, Math.round((globalShotCount / Math.max(estimatedTotalShots, 1)) * 100)),
                segmentId: segment.id,
                segmentIndex: segIdx + 1,
              })}\n\n`));
            };

            try {
              for await (const chunk of segStream) {
                if (chunk.content) {
                  const content = chunk.content.toString();
                  segmentFullResponse += content;
                  buffer += content;

                  // 按行解析
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (const line of lines) {
                    const shot = parseShotFromLine(line);
                    if (shot) {
                      emitShot(shot);
                    }
                  }
                }
              }
            } catch (segmentError) {
              console.error(`[逐段生成] 第 ${segIdx + 1} 段模型流失败，将使用本地兜底:`, segmentError);
            }
            const segmentInputTokens = segmentUsageHolder.current?.inputTokens || segmentEstimatedInputTokens;
            billedInputTokens += segmentInputTokens;
            billedCachedInputTokens += segmentUsageHolder.current?.cachedInputTokens || 0;
            billedUncachedInputTokens += segmentUsageHolder.current?.uncachedInputTokens || segmentInputTokens;
            billedOutputTokens += segmentUsageHolder.current?.outputTokens || await countDeepSeekTokens(segmentFullResponse);

            // 处理剩余 buffer 或模型没有严格逐行输出的情况
            const bufferedShots = parseShotsFromText(buffer);
            bufferedShots.forEach(emitShot);

            if (segmentShotCount === 0 && segmentFullResponse.trim()) {
              const recoveredShots = parseShotsFromText(segmentFullResponse);
              recoveredShots.forEach(emitShot);
            }

            if (segmentShotCount < segment.suggestedShots) {
              const missingCount = segment.suggestedShots - segmentShotCount;
              console.warn(`[逐段生成] 第 ${segIdx + 1} 段少于目标，自动补足 ${missingCount} 镜`);
              createFallbackShots(
                segment,
                globalContext,
                missingCount,
                segmentShotCount,
                finalContent,
                segmentDialogueLocks,
              ).forEach(emitShot);
            }

            console.log(`[逐段生成] 第 ${segIdx + 1} 段完成: 实际生成 ${segmentShotCount} 镜`);

            // 发送段结束事件
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'segment_done',
              segmentId: segment.id,
              segmentIndex: segIdx + 1,
              totalSegments,
              actualShots: segmentShotCount,
              targetShots: segment.suggestedShots,
              cumulativeShots: globalShotCount,
            })}\n\n`));
          }

          if (request.signal.aborted || streamClosed) {
            throw new Error('连接中断，文字分镜未完整生成');
          }
          if (globalShotCount < MIN_SHOTS_PER_EPISODE) {
            throw new Error(`文字分镜未达到最低 ${MIN_SHOTS_PER_EPISODE} 镜，实际 ${globalShotCount} 镜`);
          }

          // ================================================================
          // Phase 3：完成
          // ================================================================
          const elapsed = Date.now() - startTime;
          const totalTokens = billedInputTokens + billedOutputTokens;
          const finalPoints = calculateDeepSeekCreationPoints({
            cachedInputTokens: billedCachedInputTokens,
            uncachedInputTokens: billedUncachedInputTokens,
            inputTokens: billedInputTokens,
            outputTokens: billedOutputTokens,
          });

          console.log(
            `[逐段生成] 全部完成: ${globalShotCount} 镜, ` +
            `输入约 ${billedInputTokens} Token, 输出约 ${billedOutputTokens} Token, ` +
            `扣除 ${finalPoints} 创作点, 耗时 ${elapsed}ms`
          );

          await completeCreationPointTask(creationPointTaskId, finalPoints, {
            description: `文字分镜完成扣除（输入 ${billedInputTokens.toLocaleString('zh-CN')} / 输出 ${billedOutputTokens.toLocaleString('zh-CN')} Token）`,
            metadata: {
              billingMode: 'deepseek_token',
              cachedInputTokens: billedCachedInputTokens,
              uncachedInputTokens: billedUncachedInputTokens,
              inputTokens: billedInputTokens,
              outputTokens: billedOutputTokens,
              totalTokens,
              finalPoints,
            },
          });
          pointsSettled = true;

          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            success: true,
            totalShots: globalShotCount,
            totalSegments,
            elapsed,
            creationPoints: finalPoints,
            tokenUsage: {
              input: billedInputTokens,
              output: billedOutputTokens,
              timestamp: Date.now(),
            },
          })}\n\n`));

        } catch (error) {
          console.error('逐段生成失败:', error);
          if (!pointsSettled && creationPointTaskId) {
            await failCreationPointTask(
              creationPointTaskId,
              error instanceof Error ? error.message : '文字分镜生成失败'
            ).catch((refundError) => {
              console.error('[创作点] 文字分镜任务退回失败:', refundError);
            });
          }
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: '生成失败: ' + (error as Error).message,
          })}\n\n`));
        } finally {
          safeClose();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('分镜脚本生成失败:', error);
    if (creationPointTaskId) {
      await failCreationPointTask(
        creationPointTaskId,
        error instanceof Error ? error.message : '分镜脚本生成失败'
      ).catch((refundError) => {
        console.error('[创作点] 文字分镜任务退回失败:', refundError);
      });
    }
    return new Response(JSON.stringify({
      error: error instanceof InsufficientCreationPointsError
        ? error.message
        : '分镜脚本生成失败',
    }), {
      status: error instanceof InsufficientCreationPointsError ? 402 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
