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
import { calculateStoryboardTokenCreationPoints } from '@/lib/provider-pricing';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  normalizeOpeningShotActionChange,
  normalizeOpeningShotContinuity,
} from '@/lib/storyboard-opening-shot';

interface Segment {
  id: number;
  name: string;
  description: string;
  content: string;
  emotionalTone: string;
  sceneContext: string;
  charactersPresent: string[];
  suggestedShots: number;
  plannedDuration: number;
  isFinalUnit: boolean;
}

interface DialogueLock {
  speaker: string;
  text: string;
  normalized: string;
  fullLine: string;
}

type StoryboardGlobalContext = {
  chapterNumber?: number;
  characters?: string[];
  scenes?: string[];
  charactersData?: any;
  scenesData?: any;
  propsData?: any;
  creationBibleInstruction?: string;
};

const VIDEO_UNIT_TARGET_MIN_SECONDS = 14;
const VIDEO_UNIT_TARGET_MAX_SECONDS = 15;
const DEFAULT_VIDEO_UNIT_SECONDS = 14.5;
const MIN_SHOT_DURATION_SECONDS = 1.5;
const MAX_SHOT_DURATION_SECONDS = 8;
const MAX_VIDEO_UNITS_PER_EPISODE = 48;
const MAX_SUGGESTED_SHOTS_PER_UNIT = 10;
const STORYBOARD_ANALYSIS_TIMEOUT_MS = 25_000;
const STORYBOARD_SEGMENT_TIMEOUT_MS = 45_000;
const STORYBOARD_LLM_API_KEY = process.env.STORYBOARD_LLM_API_KEY?.trim() || '';
const STORYBOARD_LLM_MODEL = process.env.STORYBOARD_LLM_MODEL?.trim() || 'gemini-3.5-flash';
const STORYBOARD_LLM_BASE_URL = (() => {
  const configured = (process.env.STORYBOARD_LLM_BASE_URL || 'https://mobaohee.xyz').trim().replace(/\/+$/, '');
  return /\/v1$/i.test(configured) ? configured : `${configured}/v1`;
})();

function getStoryboardLlmOptions() {
  if (!STORYBOARD_LLM_API_KEY) {
    throw new Error('未配置文字分镜模型 API Key，请联系管理员');
  }
  return {
    apiKey: STORYBOARD_LLM_API_KEY,
    baseUrl: STORYBOARD_LLM_BASE_URL,
    model: STORYBOARD_LLM_MODEL,
    includeUsage: true,
  };
}

function cleanPromptText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildCreationBibleInstruction(creationBible?: {
  creationType?: string;
  subjectRegion?: string;
  creationBackground?: string;
}): string {
  const creationType = cleanPromptText(creationBible?.creationType);
  const subjectRegion = cleanPromptText(creationBible?.subjectRegion);
  const creationBackground = cleanPromptText(creationBible?.creationBackground);
  if (!creationType && !subjectRegion && !creationBackground) return '';

  const lines = ['【创作圣经】'];
  if (creationType === '仿真人') {
    lines.push('创作类型：仿真人。分镜必须以真人短剧/电影实拍逻辑描述，人物表演、皮肤质感、服装材质、空间和光影都要真实可拍。');
  } else if (creationType === '3D') {
    lines.push('创作类型：3D。分镜必须以3D/CG动画逻辑描述，角色模型、材质分区、动作幅度、场景结构和渲染风格保持统一。');
  } else if (creationType === '动漫') {
    lines.push('创作类型：动漫。分镜必须以动漫/动画电影逻辑描述，角色线条、表情、动作夸张度、色彩和美术风格保持统一。');
  }

  if (subjectRegion === '国内') {
    lines.push('创作题材：国内。场景、道具、服饰、称呼、社会关系、环境细节要符合中国本土语境。');
  } else if (subjectRegion === '国外') {
    lines.push('创作题材：国外。场景、道具、服饰、称呼、社会关系、环境细节要符合海外/国际化语境。');
  }

  if (creationBackground === '近代') {
    lines.push('创作背景：近代。镜头内的服化道、建筑、交通、通讯、照明、标识和社会礼仪必须保持近代年代质感。');
  } else if (creationBackground === '现代') {
    lines.push('创作背景：现代。镜头内的服化道、建筑、交通、通讯、设备、标识和社会行为必须符合现代生活语境。');
  } else if (creationBackground === '古代') {
    lines.push('创作背景：古代。镜头内的服饰形制、发式、建筑、器物、交通、照明、礼仪和社会秩序必须符合古代语境，禁止无剧情依据的现代元素。');
  }

  lines.push('注意：创作圣经只约束视觉风格、题材语境和时代背景，不能改写剧情、台词、人物关系和事件顺序；如剧本明确存在回忆、年代跳转或穿越，按原剧情呈现相应时期。');
  return lines.join('\n');
}
// ================================================================
// Phase 1 Prompt：视频单元规划（快，非流式）
// ================================================================
const SEGMENT_ANALYSIS_PROMPT = `你是一位专业的影视分镜策划专家。你的任务是先把剧本规划成连续的 AI 视频单元，再由下一阶段为每个单元设计分镜。

【视频单元规划原则】
1. 每个视频单元必须是一个连贯、可独立生成的视频段落，围绕同一空间轴线、连续动作、同一对白节拍或完整情绪转折组织
2. 除最后一个单元可因正文结束而短于 14 秒外，每个单元计划时长应为 14-15 秒，任何单元都不得超过 15 秒
3. 单元边界优先落在动作完成、对白句意完成、视线/情绪转折、人物出入场或场景切换处，禁止机械按字数切割
4. 先保证剧情、动作、台词和空间连续，再估算该单元真正需要多少镜头；不要为了凑数量添加无信息镜头
5. 空镜、反应镜头、道具特写、手部特写只在服务剧情、情绪或连续性时规划，不要求每个单元机械齐全
6. 所有 content 按顺序拼接后必须完整覆盖原文，不能重叠、遗漏、改写或调整事件顺序

【输出格式】
严格输出 JSON 数组，不要任何其他文字：
[
  {
    "id": 1,
    "name": "视频单元名称（如：开场进入房间并发现异常）",
    "description": "一句话描述本单元的核心动作与情绪变化",
    "content": "该单元对应的连续原文（完整保留动作和对白，不要改写）",
    "emotionalTone": "本单元的核心情绪基调",
    "sceneContext": "场景信息",
    "charactersPresent": ["出场人物列表"],
    "plannedDuration": 14.5,
    "suggestedShots": 5
  }
]

【禁止】
1. 不要改编原文内容，content字段必须原文节选
2. 不要遗漏任何原文内容——所有段落合并后应覆盖全章
3. 不要把总镜头数设为固定目标，也不要要求每集至少 50 镜
4. 不要把单元固定成相同镜头数；suggestedShots 只是内容驱动的建议值，通常 3-8 镜，也允许完整长镜头或更细的动作组合
5. 不要让单个单元的 plannedDuration 超过 15 秒`;

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
  let prompt = `请为以下"第 ${segmentIndex + 1}/${totalSegments} 个视频单元"生成分镜脚本，严格按照 Skill 5 影视级分镜规范输出。

【视频单元信息】
单元名称：${segment.name}
单元描述：${segment.description}
情绪基调：${segment.emotionalTone}
场景：${segment.sceneContext}
出场人物：${segment.charactersPresent?.join('、') || '未知'}
计划总时长：${segment.plannedDuration} 秒（上限 15 秒）
建议镜头数：约 ${segment.suggestedShots} 个，仅供节奏参考，不是硬性数量
${globalContext.creationBibleInstruction ? `\n${globalContext.creationBibleInstruction}` : ''}

【本单元连续原文】
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
      if (char.faceFeatures) {
        const faceFeatures = typeof char.faceFeatures === 'string'
          ? char.faceFeatures
          : [
              char.faceFeatures.faceShape,
              char.faceFeatures.eyes,
              char.faceFeatures.nose,
              char.faceFeatures.mouth,
              char.faceFeatures.skinTone,
            ].filter(Boolean).join('；');
        if (faceFeatures) prompt += `  固定脸型特征：${faceFeatures}\n`;
      }
      if (char.looks && Array.isArray(char.looks) && char.looks.length > 0) {
        const chapterNumber = globalContext.chapterNumber;
        const chapterLooks = char.looks.filter((look: any) => {
          const episodes = getEpisodeNumbers(look);
          return look?.isBaseLook || episodes.length === 0 || (chapterNumber && episodes.includes(chapterNumber));
        });
        const looksToShow = chapterLooks.length > 0 ? chapterLooks : char.looks;
        prompt += `  造型列表：\n`;
        looksToShow.forEach((look: any, index: number) => {
          const lookId = look.id || `look_${index}`;
          prompt += `    [造型ID: ${lookId}] ${look.scene || '未知场景'} - ${look.description || look.costume || '待描述'}`;
          const episodes = getEpisodeNumbers(look);
          if (episodes.length > 0) prompt += `\n        关联集数: ${episodes.map(item => `第${item}集`).join('、')}`;
          if (look.costume) prompt += `\n        服装: ${look.costume}`;
          if (look.hairstyle) prompt += `\n        发型: ${look.hairstyle}`;
          prompt += '\n';
        });
      }
    });
    prompt += `\n请根据场景和情节选择最合适的造型ID填入 characters[].lookId 字段\n`;
  }

  const chapterNumber = globalContext.chapterNumber;
  const relevantScenes = getContextScenes(globalContext).filter((scene: any) => {
    const episodes = getEpisodeNumbers(scene);
    return episodes.length === 0 || (chapterNumber && episodes.includes(chapterNumber));
  });
  const relevantProps = getContextProps(globalContext).filter((prop: any) => {
    const episodes = getEpisodeNumbers(prop);
    return episodes.length === 0 || (chapterNumber && episodes.includes(chapterNumber));
  });
  if (relevantScenes.length > 0 || relevantProps.length > 0) {
    prompt += '\n【本集素材名称与状态】\n';
    if (relevantScenes.length > 0) {
      prompt += `场景状态：${relevantScenes.slice(0, 30).map((scene: any) => scene.name).filter(Boolean).join('、')}\n`;
    }
    if (relevantProps.length > 0) {
      prompt += `道具状态：${relevantProps.slice(0, 40).map((prop: any) => prop.name).filter(Boolean).join('、')}\n`;
    }
    prompt += 'scene.location 与 scene.props 优先使用上面已经提取的状态名称，确保后续图片能按集数和状态直接匹配；只有原文出现但清单遗漏时才补充新名称。\n';
  }

  prompt += `
【本视频单元生成要求】
1. 先在内部完成动作、对白和情绪节拍规划，再输出真正有叙事价值的镜头；建议约 ${segment.suggestedShots} 镜，但可根据内容增减，禁止凑镜头数
2. 本单元所有镜头时长相加以 ${segment.plannedDuration} 秒为目标，绝对不能超过 15 秒；最后一个单元可随正文自然结束
3. 时长要符合内容：环境建立约 2-4 秒，动作/插入/反应约 1.5-3 秒，普通对白约 3-6 秒，复杂动作或情绪表演约 4-8 秒；不能机械地全部写成同一时长
4. 有台词的镜头必须给足自然说完原文的时间，长台词按原文标点拆镜；系统会校验并小幅微调时长，但不会修改台词和剧情
5. 每个分镜必须包含：景别、运镜、镜头角度、机位、人物相对站位、人物肢体动作、脸部动作/表情、动作变化标注
6. 人物站位必须写清楚，例如：A 在画面左前景，B 在右后景，两人相距约 1 米，A 面向 B，B 侧身避开视线
7. ${prevLastShot
  ? '本段首镜不是本集第一镜，必须承接上方【上一段末镜衔接信息】并标注"较上一镜动作变化"，禁止重新写成"首镜建立动作"'
  : '本段首镜就是本集第一镜，没有上一镜，必须写"首镜建立动作"并建立人物站位、表情和道具状态，禁止出现"上一镜/前一镜"'}；从本集第二镜开始，动作变化应写清从坐直变成后退半步、从低头变成抬眼、右手从桌沿移到胸前等具体变化
8. 台词必须来自上方【本段原文台词锁定表】，一字不改；长台词按原文标点拆成连续分镜，不能改写、概括或新编
9. 空镜、反应镜头、道具或手部特写只在能建立空间、传递信息、推动情绪或保证连续性时使用，不要机械插入
10. 每个镜头都必须新增剧情动作、人物反应、空间信息或情绪变化；删除该镜头后若不影响理解，就不应生成
11. 景别和运镜要有变化，但变化必须有叙事动机；不要连续 3 个镜头使用同一景别或同一运镜

现在开始逐行输出本视频单元需要的分镜，内容完整后立即停止，不要补空镜凑数：`;

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
  "actionChange": "首镜建立动作：花十抬眼看向露夏，露夏手指停在杯沿，建立两人的初始动作和站位。",
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
      "actionChange": "首镜建立动作：抬眼看向露夏，右手夹烟停在半空",
      "performance": "微微仰头，吐出烟雾，眼神停在露夏脸上"
    }
  ],
  "emotionalBeat": "闲聊试探 → 害羞犹豫", // 情感节拍（必填）
  "cameraMovement": "缓推（Slow Dolly In）", // 镜头运动（必填）
  "duration": 5,                        // 预估时长（秒，数字）（必填）

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
  "continuity": "首镜建立奶茶杯、烟灰缸和人物视线方向，作为后续镜头的连续性基准",
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

【视频单元与时长 - 强制】
1. 先理解本单元的完整动作、对白、空间和情绪，再决定镜头数量；不存在每集至少 50 镜或每单元固定镜数
2. 本单元各镜头 duration 相加必须接近计划时长且不得超过 15 秒；duration 必须是数字，不能写范围或文字
3. 环境建立通常 2-4 秒，动作/插入/反应通常 1.5-3 秒，普通对白通常 3-6 秒，复杂动作或情绪表演通常 4-8 秒
4. 台词时长必须足够角色自然说完原文；长对白按原文标点拆镜，但禁止把短句无意义地切碎
5. 空镜、反应、手部或道具特写、连续组合镜头按剧情需要选用，不要求每个单元机械凑齐
6. 反应镜头必须具体且推动理解：抬眼、皱眉、吞咽、手指停顿、肩膀绷紧、视线躲开等
7. 空镜必须服务剧情：门缝光线、桌上杯子震动、走廊脚步声、手机屏幕亮起、窗外风声等

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
6. 本集第一镜必须在 actionChange 中建立初始肢体动作、脸部动作、表情和站位，禁止引用不存在的上一镜；从本集第二镜开始，每一个连续镜头都必须标注较上一镜发生的变化，没有改变时也要写"较上一镜：动作保持，仅眼神/呼吸变化"

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

function estimateSpokenDurationSeconds(value: string): number {
  const text = stripPerformanceParentheticals(String(value || ''))
    .replace(/[“”"'「」『』]/g, '')
    .trim();
  if (!text) return 0;

  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = text
    .replace(/[\u3400-\u9fff]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const pauseCount = (text.match(/[，,。！？!?；;：:…]/g) || []).length;
  return Math.max(1.5, cjkCount / 4 + latinWords / 2.4 + pauseCount * 0.12);
}

function estimateContentDurationSeconds(content: string): number {
  const lines = String(content || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return 3;

  return Math.max(1.5, lines.reduce((total, line) => {
    const dialogueMatch = line.match(/^[^：:\n]{1,32}[：:]\s*(.+)$/);
    if (dialogueMatch) {
      return total + estimateSpokenDurationSeconds(dialogueMatch[1]);
    }

    const compactLength = normalizeSourceSlice(line).length;
    return total + Math.min(6, Math.max(1.5, 0.8 + compactLength / 18));
  }, 0));
}

function splitContentIntoVideoBeats(content: string): string[] {
  const primaryBeats = splitContentBeats(content);
  return primaryBeats.flatMap(beat => {
    if (estimateContentDurationSeconds(beat) <= VIDEO_UNIT_TARGET_MAX_SECONDS) {
      return [beat];
    }
    const smallerBeats = beat
      .split(/(?<=[，,])/)
      .map(item => item.trim())
      .filter(Boolean);
    return smallerBeats.length > 1 ? smallerBeats : [beat];
  });
}

function clampPlannedDuration(value: unknown, isFinalUnit: boolean, content: string): number {
  const parsed = Number(value);
  const estimated = estimateContentDurationSeconds(content);
  const fallback = isFinalUnit
    ? Math.min(VIDEO_UNIT_TARGET_MAX_SECONDS, Math.max(3, estimated))
    : DEFAULT_VIDEO_UNIT_SECONDS;
  const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  const minimum = isFinalUnit ? 1.5 : VIDEO_UNIT_TARGET_MIN_SECONDS;
  return Math.round(
    Math.min(VIDEO_UNIT_TARGET_MAX_SECONDS, Math.max(minimum, duration)) * 10,
  ) / 10;
}

function estimateSuggestedShotCount(content: string, plannedDuration: number, suggested?: unknown): number {
  const parsed = Number(suggested);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_SUGGESTED_SHOTS_PER_UNIT, Math.max(1, Math.round(parsed)));
  }

  const beatCount = splitContentIntoVideoBeats(content).length;
  const durationDrivenCount = Math.round(plannedDuration / 3);
  return Math.min(
    MAX_SUGGESTED_SHOTS_PER_UNIT,
    Math.max(1, Math.max(durationDrivenCount, Math.min(beatCount, 6))),
  );
}

const INVALID_SCENE_CONTEXT_PATTERN = /^(?:未知|未知场景|未知环境|未指定|未识别|待定|待确认|无|场景|场景信息|环境|环境信息|地点|地点信息|故事主要场景|主要场景|当前场景|当前剧情场景|当前剧情环境)$/;
const SCENE_META_LABELS = '(?:内|外|内景|外景|室内|室外|日|夜|白天|夜晚|清晨|黄昏|傍晚)';

function cleanSceneContextCandidate(value: unknown): string {
  const text = String(value || '')
    .replace(/^(?:场景|地点|环境)\s*[：:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;]+$/g, '')
    .trim();

  if (
    !text
    || INVALID_SCENE_CONTEXT_PATTERN.test(text)
    || /^未知(?:里|的)?环境/.test(text)
  ) {
    return '';
  }
  return text;
}

function stripSceneHeadingMetadata(value: string): string {
  return String(value || '')
    .replace(
      new RegExp(`\\s*[\\[【（(]\\s*${SCENE_META_LABELS}(?:\\s*[/|、]\\s*${SCENE_META_LABELS})*\\s*[\\]】）)]`, 'gi'),
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSceneContextFromContent(content: string): string {
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const headingMatch = line.match(/^\s*\d+\s*[-—–.]\s*\d+\s*[:：]?\s*(.+?)\s*$/);
    if (headingMatch) {
      const heading = cleanSceneContextCandidate(stripSceneHeadingMetadata(headingMatch[1]));
      if (heading) return heading;
    }

    const labeledMatch = line.match(/^\s*(?:场景|地点|环境)\s*[：:]\s*(.+?)\s*$/);
    if (labeledMatch) {
      const labeled = cleanSceneContextCandidate(stripSceneHeadingMetadata(labeledMatch[1]));
      if (labeled) return labeled;
    }
  }
  return '';
}

function normalizeSceneMatchText(value: unknown): string {
  return stripSceneHeadingMetadata(String(value || ''))
    .replace(/^\s*\d+\s*[-—–.]\s*\d+\s*[:：]?\s*/, '')
    .replace(/[\s，,。；;：:、/|【】[\]（）()《》"'“”‘’\-—–_]/g, '')
    .toLowerCase();
}

function findMentionedSceneName(content: string, sceneNames: unknown[]): string {
  const normalizedContent = normalizeSceneMatchText(content);
  const candidates = sceneNames
    .map(cleanSceneContextCandidate)
    .filter(Boolean)
    .sort((left, right) => normalizeSceneMatchText(right).length - normalizeSceneMatchText(left).length);

  return candidates.find(candidate => {
    const normalized = normalizeSceneMatchText(candidate);
    return normalized.length >= 2 && normalizedContent.includes(normalized);
  }) || '';
}

function resolveBasicSceneContext(
  content: string,
  candidate: unknown,
  sceneNames: unknown[] = [],
): string {
  return findMentionedSceneName(content, sceneNames)
    || inferSceneContextFromContent(content)
    || cleanSceneContextCandidate(candidate)
    || sceneNames.map(cleanSceneContextCandidate).find(Boolean)
    || '当前剧情场景';
}

function createSourceLockedVideoUnits(
  sourceContent: string,
  seedSegments: Segment[],
  chapterTitle: string | undefined,
  characters: string[] | undefined,
  scenes: string[] | undefined,
): Segment[] {
  const beats = splitContentIntoVideoBeats(sourceContent);
  const buckets: string[] = [];
  const bucketDurations: number[] = [];
  let current: string[] = [];
  let currentDuration = 0;

  beats.forEach(beat => {
    const beatDuration = estimateContentDurationSeconds(beat);
    const wouldExceed = current.length > 0
      && currentDuration + beatDuration > VIDEO_UNIT_TARGET_MAX_SECONDS;

    if (
      wouldExceed
      && (
        currentDuration >= VIDEO_UNIT_TARGET_MIN_SECONDS
        || currentDuration >= 8
      )
    ) {
      buckets.push(current.join('\n'));
      bucketDurations.push(currentDuration);
      current = [];
      currentDuration = 0;
    }

    current.push(beat);
    currentDuration += beatDuration;

    if (currentDuration >= VIDEO_UNIT_TARGET_MIN_SECONDS) {
      buckets.push(current.join('\n'));
      bucketDurations.push(currentDuration);
      current = [];
      currentDuration = 0;
    }
  });

  if (current.length > 0) {
    buckets.push(current.join('\n'));
    bucketDurations.push(currentDuration);
  }

  let carriedSceneContext = '';
  return buckets.map((content, index) => {
    const seed = seedSegments[index];
    const matchedCharacters = (characters || []).filter(name => content.includes(name));
    const isFinalUnit = index === buckets.length - 1;
    const plannedDuration = clampPlannedDuration(
      seed?.plannedDuration ?? bucketDurations[index],
      isFinalUnit,
      content,
    );
    const seedSceneContext = cleanSceneContextCandidate(seed?.sceneContext);
    const sceneContext = resolveBasicSceneContext(
      content,
      carriedSceneContext || seedSceneContext,
      scenes || [],
    );
    carriedSceneContext = cleanSceneContextCandidate(sceneContext) || carriedSceneContext;
    return {
      id: index + 1,
      name: seed?.name || `${chapterTitle || '章节'}-视频单元${index + 1}`,
      description: seed?.description || '连续原文动作与情绪节拍',
      content,
      emotionalTone: seed?.emotionalTone || '综合',
      sceneContext,
      charactersPresent: matchedCharacters.length > 0
        ? matchedCharacters
        : (seed?.charactersPresent?.length ? seed.charactersPresent : (characters || [])),
      suggestedShots: estimateSuggestedShotCount(content, plannedDuration, seed?.suggestedShots),
      plannedDuration,
      isFinalUnit,
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
  const completeCoverage = normalizeSourceSlice(
    segments.map(segment => segment.content || '').join(''),
  ) === normalizeSourceSlice(sourceContent);
  const plausibleUnitCount = segments.length > 0 && segments.length <= MAX_VIDEO_UNITS_PER_EPISODE;
  const unitsAreShortEnough = segments.every(segment => (
    estimateContentDurationSeconds(segment.content) <= VIDEO_UNIT_TARGET_MAX_SECONDS * 1.5
  ));

  if (completeCoverage && plausibleUnitCount && unitsAreShortEnough) {
    let carriedSceneContext = '';
    return segments.map((segment, index) => {
      const isFinalUnit = index === segments.length - 1;
      const plannedDuration = clampPlannedDuration(
        segment.plannedDuration,
        isFinalUnit,
        segment.content,
      );
      const modelSceneContext = cleanSceneContextCandidate(segment.sceneContext);
      const sceneContext = resolveBasicSceneContext(
        segment.content,
        carriedSceneContext || modelSceneContext,
        scenes || [],
      );
      carriedSceneContext = cleanSceneContextCandidate(sceneContext) || carriedSceneContext;
      return {
        ...segment,
        id: index + 1,
        sceneContext,
        plannedDuration,
        isFinalUnit,
        suggestedShots: estimateSuggestedShotCount(
          segment.content,
          plannedDuration,
          segment.suggestedShots,
        ),
      };
    });
  }

  console.warn('[视频单元校验] 模型规划未完整、连续覆盖原文，已按原文节拍重建视频单元');
  return createSourceLockedVideoUnits(sourceContent, segments, chapterTitle, characters, scenes);
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

function getContextScenes(globalContext: StoryboardGlobalContext) {
  return toArray(globalContext.scenesData, ['scenes', 'allScenes']);
}

function getEpisodeNumbers(value: any): number[] {
  const direct = Array.isArray(value?.episodeNumbers) ? value.episodeNumbers : [];
  const occurrences = Array.isArray(value?.occurrences)
    ? value.occurrences.map((item: any) => item?.episodeNumber)
    : [];
  return Array.from(new Set([...direct, ...occurrences]
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item > 0)));
}

function getSceneRecordAliases(scene: any): string[] {
  return [
    scene?.name,
    scene?.mainSceneName,
    scene?.physicalLocation,
    ...(Array.isArray(scene?.aliases) ? scene.aliases : []),
    ...(Array.isArray(scene?.occurrences)
      ? scene.occurrences.map((occurrence: any) => (
        stripSceneHeadingMetadata(
          String(occurrence?.heading || '')
            .replace(/^\s*\d+\s*[-—–.]\s*\d+\s*[:：]?\s*/, ''),
        )
      ))
      : []),
  ].map(cleanSceneContextCandidate).filter(Boolean);
}

function findSceneRecordForContent(
  content: string,
  sceneRecords: any[],
): string {
  const normalizedContent = normalizeSceneMatchText(content);
  const ranked = sceneRecords
    .flatMap(scene => getSceneRecordAliases(scene).map(alias => ({
      alias,
      resolvedName: cleanSceneContextCandidate(scene?.name) || alias,
    })))
    .sort((left, right) => normalizeSceneMatchText(right.alias).length - normalizeSceneMatchText(left.alias).length);

  return ranked.find(item => {
    const normalizedAlias = normalizeSceneMatchText(item.alias);
    return normalizedAlias.length >= 2 && normalizedContent.includes(normalizedAlias);
  })?.resolvedName || '';
}

function resolveStoryboardSceneContext(
  rawLocation: unknown,
  segment: Segment,
  globalContext: StoryboardGlobalContext,
): string {
  const allSceneRecords = getContextScenes(globalContext);
  const chapterNumber = Number(globalContext.chapterNumber);
  const chapterSceneRecords = allSceneRecords.filter((scene: any) => {
    const episodeNumbers = getEpisodeNumbers(scene);
    return !Number.isFinite(chapterNumber)
      || chapterNumber <= 0
      || episodeNumbers.length === 0
      || episodeNumbers.includes(chapterNumber);
  });
  const chapterSceneNames = (globalContext.scenes || [])
    .map(cleanSceneContextCandidate)
    .filter(Boolean);
  const sourceMatchedLocation = findSceneRecordForContent(
    segment.content,
    chapterSceneRecords,
  )
    || findMentionedSceneName(segment.content, chapterSceneNames)
    || inferSceneContextFromContent(segment.content);
  if (sourceMatchedLocation) return sourceMatchedLocation;

  const directLocation = cleanSceneContextCandidate(rawLocation);
  if (directLocation) return directLocation;

  const plannedLocation = cleanSceneContextCandidate(segment.sceneContext);
  if (plannedLocation) return plannedLocation;

  return cleanSceneContextCandidate(chapterSceneRecords[0]?.name)
    || chapterSceneNames[0]
    || findSceneRecordForContent(segment.content, allSceneRecords)
    || cleanSceneContextCandidate(allSceneRecords[0]?.name)
    || '当前剧情场景';
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

async function estimateStoryboardReservationPoints(content: string): Promise<number> {
  const plannedUnits = createSourceLockedVideoUnits(content, [], undefined, [], []);
  const estimatedShots = plannedUnits.reduce(
    (sum, unit) => sum + unit.suggestedShots,
    0,
  );
  const estimatedInputTokens =
    await countDeepSeekTokens(SEGMENT_ANALYSIS_PROMPT) +
    await countDeepSeekTokens(content) +
    plannedUnits.length * (await countDeepSeekTokens(SKILL5_SYSTEM_PROMPT) + 800) +
    await countDeepSeekTokens(content);
  const estimatedOutputTokens = Math.max(estimatedShots, 1) * 500;
  return calculateStoryboardTokenCreationPoints({
    uncachedInputTokens: Math.ceil(estimatedInputTokens * 1.2),
    outputTokens: Math.ceil(estimatedOutputTokens * 1.2),
  });
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

function parseShotDurationSeconds(value: unknown, fallback = 3): number {
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value || '').match(/\d+(?:\.\d+)?/)?.[0]);
  const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.round(duration * 10) / 10;
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
    actionChange: normalizeOpeningShotActionChange(
      shotNumber,
      rawShot?.actionChange || rawShot?.movementChange,
    ),
    scene: {
      location: resolveStoryboardSceneContext(rawShot?.scene?.location, segment, globalContext),
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
        actionChange: normalizeOpeningShotActionChange(
          shotNumber,
          existing?.actionChange || existing?.movementChange,
          'character',
        ),
        performance: existing?.performance || [action, expression, gesture].filter(Boolean).join('，') || '根据台词和动作做出自然反应',
      };
    }),
    emotionalBeat: rawShot?.emotionalBeat || segment.emotionalTone || '剧情推进',
    cameraMovement: rawShot?.cameraMovement || plannedStyle.cameraMovement,
    duration: parseShotDurationSeconds(rawShot?.duration, 3),
    focalLength: rawShot?.focalLength || '35mm',
    aperture: rawShot?.aperture || 'f/4',
    cameraPosition: rawShot?.cameraPosition || `摄影机位于主体正前方，眼平高度，以平视拍摄人物动作，景别为中景。`,
    composition: rawShot?.composition || '主体位于画面中心偏左，背景保留场景信息',
    actionAndDialogue: actionAndDialogue || rawShot?.description || segment.description || '人物完成当前剧情动作',
    continuity: normalizeOpeningShotContinuity(
      shotNumber,
      rawShot?.continuity || rawShot?.continuityNotes,
    ),
    notes: rawShot?.notes || `${rawShot?.shotPurpose || plannedStyle.shotPurpose}，突出当前节拍的动作和反应。`,
    restrictions: rawShot?.restrictions || '不允许出现字幕/水印/任何文字',
  };
}

function getShotDialogueDurationSeconds(shot: any): number {
  const dialogues: string[] = Array.isArray(shot?.characters)
    ? shot.characters
      .map((character: any) => String(character?.dialogue || '').trim())
      .filter(Boolean)
    : [];
  const uniqueDialogues: string[] = Array.from(new Set(dialogues));
  return uniqueDialogues.reduce(
    (total, dialogue) => total + estimateSpokenDurationSeconds(dialogue),
    0,
  );
}

function getShotDurationBounds(shot: any): { minimum: number; maximum: number } {
  const dialogueDuration = getShotDialogueDurationSeconds(shot);
  const purpose = String(shot?.shotPurpose || '');
  const actionText = `${shot?.description || ''}${shot?.actionAndDialogue || ''}`;
  const declaredDuration = Math.min(
    VIDEO_UNIT_TARGET_MAX_SECONDS,
    parseShotDurationSeconds(shot?.duration, 3),
  );

  if (dialogueDuration > 0) {
    const minimum = Math.min(VIDEO_UNIT_TARGET_MAX_SECONDS, Math.max(2, dialogueDuration));
    return {
      minimum,
      maximum: Math.min(
        VIDEO_UNIT_TARGET_MAX_SECONDS,
        Math.max(
          minimum,
          declaredDuration,
          Math.min(MAX_SHOT_DURATION_SECONDS, dialogueDuration + 1.2),
        ),
      ),
    };
  }

  if (/空镜|环境/.test(purpose)) {
    return { minimum: 2, maximum: Math.max(4, declaredDuration) };
  }
  if (/反应/.test(purpose)) {
    return { minimum: MIN_SHOT_DURATION_SECONDS, maximum: Math.max(3.5, declaredDuration) };
  }
  if (/特写|插入|手部|道具/.test(purpose)) {
    return { minimum: MIN_SHOT_DURATION_SECONDS, maximum: Math.max(3, declaredDuration) };
  }
  if (actionText.length > 100 || /追逐|打斗|复杂|连续/.test(actionText)) {
    return { minimum: 2.5, maximum: Math.max(MAX_SHOT_DURATION_SECONDS, declaredDuration) };
  }
  return { minimum: MIN_SHOT_DURATION_SECONDS, maximum: Math.max(6, declaredDuration) };
}

function sumShotDurations(shots: any[]): number {
  return Math.round(
    shots.reduce((total, shot) => total + parseShotDurationSeconds(shot?.duration, 3), 0) * 10,
  ) / 10;
}

function rebalanceShotDurations(
  shots: any[],
  targetDuration: number,
  minimumTarget: number,
  maximumTarget: number,
): any[] {
  const balanced = shots.map(shot => {
    const bounds = getShotDurationBounds(shot);
    return {
      ...shot,
      duration: Math.round(
        Math.min(bounds.maximum, Math.max(bounds.minimum, parseShotDurationSeconds(shot?.duration, 3))) * 10,
      ) / 10,
    };
  });

  let total = sumShotDurations(balanced);
  if (total > maximumTarget) {
    let excess = total - maximumTarget;
    const reductionOrder = balanced
      .map((shot, index) => ({
        index,
        hasDialogue: getShotDialogueDurationSeconds(shot) > 0,
        slack: shot.duration - getShotDurationBounds(shot).minimum,
      }))
      .sort((left, right) => (
        Number(left.hasDialogue) - Number(right.hasDialogue)
        || right.slack - left.slack
      ));

    for (const entry of reductionOrder) {
      if (excess <= 0.01) break;
      const shot = balanced[entry.index];
      const minimum = getShotDurationBounds(shot).minimum;
      const reduction = Math.min(excess, Math.max(0, shot.duration - minimum));
      shot.duration = Math.round((shot.duration - reduction) * 10) / 10;
      excess = Math.round((excess - reduction) * 10) / 10;
    }
    total = sumShotDurations(balanced);
  }

  const desiredDuration = Math.min(
    maximumTarget,
    Math.max(minimumTarget, targetDuration),
  );
  if (total < desiredDuration) {
    let shortage = desiredDuration - total;
    const expansionOrder = balanced
      .map((shot, index) => ({
        index,
        hasDialogue: getShotDialogueDurationSeconds(shot) > 0,
        headroom: getShotDurationBounds(shot).maximum - shot.duration,
      }))
      .sort((left, right) => (
        Number(right.hasDialogue) - Number(left.hasDialogue)
        || right.headroom - left.headroom
      ));

    for (const entry of expansionOrder) {
      if (shortage <= 0.01) break;
      const shot = balanced[entry.index];
      const maximum = getShotDurationBounds(shot).maximum;
      const addition = Math.min(shortage, Math.max(0, maximum - shot.duration));
      shot.duration = Math.round((shot.duration + addition) * 10) / 10;
      shortage = Math.round((shortage - addition) * 10) / 10;
    }
  }

  return balanced;
}

function splitShotsAtVideoLimit(shots: any[]): any[][] {
  const groups: any[][] = [];
  let current: any[] = [];
  let currentDuration = 0;

  shots.forEach(shot => {
    const duration = Math.min(
      VIDEO_UNIT_TARGET_MAX_SECONDS,
      parseShotDurationSeconds(shot?.duration, 3),
    );
    if (
      current.length > 0
      && currentDuration + duration > VIDEO_UNIT_TARGET_MAX_SECONDS
    ) {
      groups.push(current);
      current = [];
      currentDuration = 0;
    }
    current.push({ ...shot, duration });
    currentDuration = Math.round((currentDuration + duration) * 10) / 10;
  });

  if (current.length > 0) groups.push(current);
  return groups;
}

function validateVideoUnitShots(
  shots: any[],
  segment: Segment,
  segmentIndex: number,
): any[] {
  if (shots.length === 0) return [];

  const minimumTarget = segment.isFinalUnit
    ? Math.min(segment.plannedDuration, VIDEO_UNIT_TARGET_MIN_SECONDS)
    : VIDEO_UNIT_TARGET_MIN_SECONDS;
  const balanced = rebalanceShotDurations(
    shots,
    segment.plannedDuration,
    Math.max(1.5, minimumTarget),
    VIDEO_UNIT_TARGET_MAX_SECONDS,
  );

  let groups = sumShotDurations(balanced) <= VIDEO_UNIT_TARGET_MAX_SECONDS
    ? [balanced]
    : splitShotsAtVideoLimit(balanced);

  groups = groups.map((group, groupIndex) => {
    const isLastGeneratedUnit = groupIndex === groups.length - 1;
    const canBeShort = segment.isFinalUnit && isLastGeneratedUnit;
    const groupMinimum = canBeShort
      ? Math.min(segment.plannedDuration, VIDEO_UNIT_TARGET_MIN_SECONDS)
      : VIDEO_UNIT_TARGET_MIN_SECONDS;
    return rebalanceShotDurations(
      group,
      canBeShort ? Math.min(segment.plannedDuration, VIDEO_UNIT_TARGET_MAX_SECONDS) : DEFAULT_VIDEO_UNIT_SECONDS,
      Math.max(1.5, groupMinimum),
      VIDEO_UNIT_TARGET_MAX_SECONDS,
    );
  });

  return groups.flatMap((group, groupIndex) => {
    const unitId = groups.length === 1
      ? String(segment.id)
      : `${segment.id}.${groupIndex + 1}`;
    const actualUnitDuration = sumShotDurations(group);
    return group.map(shot => ({
      ...shot,
      videoUnitId: unitId,
      videoUnitIndex: segmentIndex + 1,
      videoUnitSubIndex: groupIndex + 1,
      videoUnitTitle: segment.name,
      plannedUnitDuration: actualUnitDuration,
    }));
  });
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
  const shotCount = Math.max(1, desiredCount ?? segment.suggestedShots ?? 1);
  const sceneContext = resolveStoryboardSceneContext('', segment, globalContext);

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
      shotNumber: absoluteIndex + 1,
      shotType: plannedStyle.shotType,
      shotPurpose: plannedStyle.shotPurpose,
      cameraAngle: plannedStyle.cameraAngle,
      scene: {
        location: sceneContext,
        time: '日间',
        atmosphere: segment.emotionalTone || '剧情推进的紧张氛围',
        lighting: '自然光与环境光结合，主体清晰可见',
      },
      description: isEmpty
        ? `${sceneContext}的环境细节承接上一镜，空气和道具状态暗示情绪变化`
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
      actionAndDialogue: isEmpty ? `${sceneContext}的空镜承接情绪，道具和光线保持连续` : description,
    }, absoluteIndex + 1, segment, globalContext, sourceContent || segment.content, dialogueLocks);
  });
}

export async function POST(request: NextRequest) {
  let creationPointTaskId = '';
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const {
      chapterContent,
      chapterTitle,
      chapterNumber,
      characters,
      scenes,
      chapterSummary,
      charactersData,
      scenesData,
      propsData,
      creationBible,
    } = await request.json();
    const creationBibleInstruction = buildCreationBibleInstruction(creationBible);
    const storyboardLlmOptions = getStoryboardLlmOptions();

    console.log(`[生成分镜API] 收到请求 - 章节: ${chapterTitle}`);
    console.log(`[生成分镜API] 模型: ${storyboardLlmOptions.model}`);

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
        billingMode: 'storyboard_token',
        pricing: 'current_storyboard_token_rate',
        model: storyboardLlmOptions.model,
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
            message: '正在规划 14-15 秒连续视频单元...',
            phase: 'analyzing',
          })}\n\n`));

          console.log(`[视频单元规划] 开始分析章节: ${chapterTitle}`);

          const segmentAnalysisMessages = [
            { role: 'system' as const, content: SEGMENT_ANALYSIS_PROMPT },
            {
              role: 'user' as const,
              content: `请分析以下章节内容，先规划成连续的 14-15 秒视频单元。

章节标题：${chapterTitle}
${creationBibleInstruction ? `\n${creationBibleInstruction}\n` : ''}
主要人物：${characters?.join('、') || '未指定'}
关键场景：${scenes?.join('、') || '未指定'}
章节摘要（仅辅助理解整体剧情，禁止从摘要抽取或改写台词）：
${summaryContent || '无'}

章节正文（唯一台词来源）：
${finalContent}

请返回 JSON 数组，每个单元覆盖一段完整且连续的动作、对白与情绪节拍。`,
            },
          ];
          const analysisEstimatedInputTokens = await countDeepSeekMessageTokens(segmentAnalysisMessages);
          const analysisUsageHolder: { current: LlmTokenUsage | null } = { current: null };
          let analysisUsageRecorded = false;

          let segments: Segment[] = [];
          try {
            const analysisResult = await oaiInvoke(segmentAnalysisMessages, {
              ...storyboardLlmOptions,
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
                sceneContext: cleanSceneContextCandidate(segment.sceneContext),
                charactersPresent: Array.isArray(segment.charactersPresent) ? segment.charactersPresent : (characters || []),
                suggestedShots: Math.min(
                  MAX_SUGGESTED_SHOTS_PER_UNIT,
                  Math.max(1, Math.round(Number(segment.suggestedShots) || 5)),
                ),
                plannedDuration: Number(segment.plannedDuration) || DEFAULT_VIDEO_UNIT_SECONDS,
                isFinalUnit: false,
              }));
            if (segments.length === 0) {
              throw new Error('视频单元规划结果为空');
            }
            console.log(`[视频单元规划] 完成: ${segments.length} 个候选单元`);
          } catch (e) {
            if (!analysisUsageRecorded) {
              const analysisInputTokens = analysisUsageHolder.current?.inputTokens || analysisEstimatedInputTokens;
              billedInputTokens += analysisInputTokens;
              billedCachedInputTokens += analysisUsageHolder.current?.cachedInputTokens || 0;
              billedUncachedInputTokens += analysisUsageHolder.current?.uncachedInputTokens || analysisInputTokens;
              billedOutputTokens += analysisUsageHolder.current?.outputTokens || 0;
            }
            console.error('[视频单元规划] 模型规划失败，使用本地原文节拍规划:', e);
            segments = createSourceLockedVideoUnits(
              finalContent,
              [],
              chapterTitle,
              characters,
              scenes,
            );
          }

          segments = repairSegmentsAgainstSource(segments, finalContent, chapterTitle, characters, scenes);

          // 建议镜头数只用于进度估算，不作为补镜或验收门槛。
          const estimatedTotalShots = segments.reduce((sum, unit) => sum + unit.suggestedShots, 0);
          const totalSegments = segments.length;
          console.log(`[分镜计划] 规划 ${totalSegments} 个视频单元，预计约 ${estimatedTotalShots} 镜`);

          // 发送开始事件（带视频单元信息）
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'start',
            targetShotCount: estimatedTotalShots,
            totalSegments,
            totalVideoUnits: totalSegments,
            wordCount,
            chapterTitle,
            segments: segments.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              emotionalTone: s.emotionalTone,
              suggestedShots: s.suggestedShots,
              plannedDuration: s.plannedDuration,
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
            chapterNumber: Number(chapterNumber) || undefined,
            characters,
            scenes,
            charactersData,
            scenesData,
            propsData,
            creationBibleInstruction,
          };

          for (let segIdx = 0; segIdx < segments.length; segIdx++) {
            if (streamClosed || request.signal.aborted) {
              console.warn('[逐段生成] 客户端已断开，停止后续分镜生成');
              break;
            }

            const segment = segments[segIdx];

            // 发送视频单元开始事件
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'segment_start',
              segmentId: segment.id,
              segmentIndex: segIdx + 1,
              totalSegments,
              segmentName: segment.name,
              segmentDescription: segment.description,
              emotionalTone: segment.emotionalTone,
              targetShots: segment.suggestedShots,
              plannedDuration: segment.plannedDuration,
            })}\n\n`));

            console.log(
              `[逐单元生成] 开始第 ${segIdx + 1}/${totalSegments} 个视频单元: ` +
              `${segment.name} (${segment.plannedDuration}秒，建议约 ${segment.suggestedShots} 镜)`,
            );

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
              ...storyboardLlmOptions,
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
            const segmentRawShots: any[] = [];
            const collectedShotKeys = new Set<string>();

            const collectRawShot = (rawShot: any) => {
              const key = JSON.stringify(rawShot);
              if (collectedShotKeys.has(key)) return;
              collectedShotKeys.add(key);
              segmentRawShots.push(rawShot);
            };

            const emitShot = (shot: any) => {
              const numberedShot = {
                ...shot,
                shotNumber: globalShotCount + 1,
              };
              globalShotCount++;
              segmentShotCount++;
              allShots.push(numberedShot);
              lastSegmentLastShot = JSON.stringify(numberedShot, null, 2);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'shot',
                shot: numberedShot,
                shotNumber: globalShotCount,
                total: estimatedTotalShots,
                progress: Math.min(95, Math.round((globalShotCount / Math.max(estimatedTotalShots, 1)) * 100)),
                segmentId: segment.id,
                segmentIndex: segIdx + 1,
                videoUnitId: numberedShot.videoUnitId,
              })}\n\n`));
            };

            const normalizeCollectedShots = (rawShots: any[]) => rawShots.map((rawShot, index) => (
              normalizeShot(
                rawShot,
                globalShotCount + index + 1,
                segment,
                globalContext,
                finalContent,
                segmentDialogueLocks,
              )
            ));

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
                      collectRawShot(shot);
                    }
                  }
                }
              }
            } catch (segmentError) {
              console.error(`[逐单元生成] 第 ${segIdx + 1} 个单元模型流失败，将校验已返回内容或使用本地兜底:`, segmentError);
            }
            const segmentInputTokens = segmentUsageHolder.current?.inputTokens || segmentEstimatedInputTokens;
            billedInputTokens += segmentInputTokens;
            billedCachedInputTokens += segmentUsageHolder.current?.cachedInputTokens || 0;
            billedUncachedInputTokens += segmentUsageHolder.current?.uncachedInputTokens || segmentInputTokens;
            billedOutputTokens += segmentUsageHolder.current?.outputTokens || await countDeepSeekTokens(segmentFullResponse);

            // 处理剩余 buffer 或模型没有严格逐行输出的情况
            parseShotsFromText(buffer).forEach(collectRawShot);

            if (segmentRawShots.length === 0 && segmentFullResponse.trim()) {
              parseShotsFromText(segmentFullResponse).forEach(collectRawShot);
            }

            let normalizedShots = normalizeCollectedShots(segmentRawShots);
            if (normalizedShots.length === 0) {
              console.warn(`[逐单元生成] 第 ${segIdx + 1} 个单元没有有效模型输出，按原文节拍生成兜底镜头`);
              normalizedShots = createFallbackShots(
                segment,
                globalContext,
                segment.suggestedShots,
                globalShotCount,
                finalContent,
                segmentDialogueLocks,
              );
            }

            const validatedShots = validateVideoUnitShots(
              normalizedShots,
              segment,
              segIdx,
            );
            validatedShots.forEach(emitShot);

            const actualDuration = sumShotDurations(validatedShots);
            const generatedUnitCount = new Set(
              validatedShots.map(shot => shot.videoUnitId),
            ).size;
            console.log(
              `[逐单元生成] 第 ${segIdx + 1} 个规划单元完成: ` +
              `${segmentShotCount} 镜 / ${actualDuration}秒 / ${generatedUnitCount} 个有效视频单元`,
            );

            // 发送视频单元结束事件
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'segment_done',
              segmentId: segment.id,
              segmentIndex: segIdx + 1,
              totalSegments,
              actualShots: segmentShotCount,
              suggestedShots: segment.suggestedShots,
              actualDuration,
              generatedUnitCount,
              cumulativeShots: globalShotCount,
            })}\n\n`));
          }

          if (request.signal.aborted || streamClosed) {
            throw new Error('连接中断，文字分镜未完整生成');
          }
          if (globalShotCount === 0) {
            throw new Error('文字分镜没有生成任何有效镜头');
          }

          // ================================================================
          // Phase 3：完成
          // ================================================================
          const elapsed = Date.now() - startTime;
          const totalTokens = billedInputTokens + billedOutputTokens;
          const actualVideoUnits = new Set(
            allShots.map(shot => shot.videoUnitId).filter(Boolean),
          ).size;
          const finalPoints = calculateStoryboardTokenCreationPoints({
            cachedInputTokens: billedCachedInputTokens,
            uncachedInputTokens: billedUncachedInputTokens,
            inputTokens: billedInputTokens,
            outputTokens: billedOutputTokens,
          });

          console.log(
            `[逐单元生成] 全部完成: ${actualVideoUnits} 个视频单元 / ${globalShotCount} 镜, ` +
            `输入约 ${billedInputTokens} Token, 输出约 ${billedOutputTokens} Token, ` +
            `扣除 ${finalPoints} 创作点, 耗时 ${elapsed}ms`
          );

          await completeCreationPointTask(creationPointTaskId, finalPoints, {
            description: `文字分镜完成扣除（输入 ${billedInputTokens.toLocaleString('zh-CN')} / 输出 ${billedOutputTokens.toLocaleString('zh-CN')} Token）`,
            metadata: {
              billingMode: 'storyboard_token',
              model: storyboardLlmOptions.model,
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
            totalVideoUnits: actualVideoUnits,
            elapsed,
            creationPoints: finalPoints,
            model: storyboardLlmOptions.model,
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
