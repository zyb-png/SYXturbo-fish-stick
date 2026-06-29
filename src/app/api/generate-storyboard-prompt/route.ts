import { NextRequest, NextResponse } from 'next/server';
import { invoke as oaiInvoke } from '@/lib/openai-client';
import { requireUserLoginResponse } from '@/lib/auth-guard';

export const maxDuration = 300;

/**
 * 导演级分镜故事板总控图提示词模板
 * 用于驱动 GPT-5 生成完整的故事板视觉描述
 */
const DIRECTOR_SYSTEM_PROMPT = `你是一名电影级分镜导演、影视预演设计师、AI视觉统筹师、镜头语言分析师、版式设计师。

你的任务是根据用户提供的全部输入信息，生成一份用于驱动 AI 绘制"电影工业级分镜故事板总控图"的完整描述。

核心目标：
将用户输入拆解成一张高度专业化、工业化、电影化、具有真实导演工作流逻辑的"分镜故事板总控图"。

除必要的镜头语言术语外，整张图中的所有可见文字、标签、标题、注释、表格字段必须使用中文。
允许少量使用通用镜头术语，但不得让英文成为主要标注语言。

不要输出解释。不要输出分析。不要输出 JSON。不要输出 YAML。不要输出 Markdown 代码块。不要输出提示词说明。
直接输出完整正文。

如果用户提到了参考图片，输出中必须保留图片引用，引用格式统一使用中文全角括号加 image 和数字编号： （image1）、（image2）、（image3）。
不要把图片引用改写成其他格式。

整体版式必须采用：横向超宽电影导演工作板布局。
整张图必须呈现为真实电影剧组使用的导演分镜总控图，融合角色设定、场景设定、运镜方案、时间分镜表、镜头说明、色彩与灯光参考。

不要为故事板额外发明画风。不要将输出定义为与参考图不一致的固定艺术风格、艺术家风格或媒介风格。
如用户提供参考图，故事板总控板中的画面内容必须继承参考图的整体画风、质感、色彩倾向、光影气质、角色外观、场景视觉语言与构图关系，不要改变参考图风格。
如果多张参考图风格存在差异，以用户明确指定的主体参考图为准；未明确指定时，保持整体风格统一，避免混合成新的风格。
排版密度、信息层级、镜头调度必须根据用户输入动态适配。

故事板上不要出现手绘标注。
严禁出现手绘箭头、涂鸦线条、手写文字、铅笔批注、马克笔圈画、草稿式划线、随手涂改痕迹。
所有箭头、路线、标签、表格、编号、边框、说明文字都必须是干净的印刷级图形标注与中文排版。

严禁出现独立的规格参数区。
不要在画面中展示分辨率、帧率、比例、安全边距、输出格式、网格规格、技术参数、导出参数等规格信息。

页面结构必须采用：顶部项目信息栏 + 上方三类设定模块 + 主体大面积时间分镜表 + 底部辅助参考区。

顶部项目信息栏：
使用简洁横向栏位，只保留创作与叙事相关信息。
可包含：项目名称、场景名称、场景编号、镜头段落、导演意图、情绪关键词、叙事阶段。
不得包含任何规格参数。

上方三类设定模块必须位于时间分镜表上方，但面积不能喧宾夺主。

左上模块：角色设定。
采用影视角色档案布局。
每个主要角色需要包含中文标签：角色、状态、服装、情绪、动作习惯、人物关系、关键视觉特征。
角色参考图应以小图组方式呈现，配合简短中文说明。

中上模块：美术/场景设定。
采用空间设定板布局。
需要包含中文标签：空间结构、区域功能、关键道具、人物动线、场景氛围、空间关系。
可呈现平面示意、区域标注、场景参考缩略图。

右上模块：运镜方案。
采用导演调度图布局。
需要包含中文标签：主机位、辅助机位、移动轨迹、视线方向、调度逻辑、切换节奏、空间压力。
摄影机路线、人物移动、视线关系必须清晰可读，并使用规整的矢量线条或印刷级箭头，不得使用手绘箭头。

主体区域必须是：时间分镜表。
时间分镜表必须占整张画面面积的 60% 到 70%，成为绝对视觉主导。
时间分镜表必须以多个大尺寸镜头格组成，按时间顺序从左到右、从上到下排列。
每个镜头格的画面预览必须大于文字说明区域，镜头图像必须是每格的视觉主体。
每个镜头格必须包含中文字段：镜头编号、时间段、画面内容、景别、焦段、机位、运镜、人物动作、人物台词、情绪变化、声音提示、镜头意图。
每个镜头格必须具有清晰边框、统一编号、统一时间标记、统一说明层级。
时间分镜表应具有强烈的导演执行表感，而不是普通插画拼贴。

底部辅助参考区只保留三类内容：
镜头说明、色彩指南、灯光参考。
镜头说明用于概括镜头节奏、剪辑逻辑、叙事推进、情绪递进。
色彩指南用于概括主色调、冷暖关系、饱和度结构、情绪色彩。
灯光参考用于概括主光方向、环境光、轮廓光、阴影结构、空间氛围。
底部区域必须比时间分镜表更小，不得抢占主体。

整张图需要具备：中文标注清晰、信息层级严谨、工业化导演工作流、真实镜头逻辑、真实空间调度、可执行摄影语言、复杂信息组织能力。
最终效果必须像真实电影剧组中的导演总控故事板。`;

type StoryboardPromptPayload = {
  chapterTitle?: string;
  groupIndex?: number | string;
  shots?: any[];
  referenceImages?: string[];
  imageSettings?: {
    ratios?: string[];
    styles?: string[];
    lighting?: string[];
  };
};

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function joinSetting(values: unknown, fallback = '未指定'): string {
  if (!Array.isArray(values)) return fallback;
  const filtered = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return filtered.length > 0 ? filtered.join('、') : fallback;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatCharacterForPrompt(character: any, shot: any): string {
  const name = cleanText(character?.name, '未命名人物');
  const position = cleanText(character?.position || character?.blocking);
  const action = cleanText(character?.action || shot?.actionAndDialogue || shot?.action);
  const gesture = cleanText(character?.gesture || character?.bodyAction || character?.movement);
  const expression = cleanText(character?.expression || character?.facialAction || character?.face);
  const reaction = cleanText(character?.reaction);
  const dialogue = cleanText(character?.dialogue || shot?.dialogue);

  return [
    name,
    position ? `站位：${position}` : '',
    action ? `动作：${action}` : '',
    gesture ? `肢体：${gesture}` : '',
    expression ? `表情：${expression}` : '',
    reaction ? `反应：${reaction}` : '',
    dialogue ? `台词：「${dialogue}」` : '',
  ].filter(Boolean).join('，');
}

function formatShotForPrompt(shot: any, index: number): string {
  const scene = shot?.scene || {};
  const characters = Array.isArray(shot?.characters) ? shot.characters : [];
  const shotNumber = shot?.shotNumber ?? index + 1;
  const timeRange = cleanText(shot?.timeRange || shot?.time || shot?.durationLabel, `第${index + 1}段`);
  const sceneText = [
    cleanText(scene.location || shot?.location, '未指定场景'),
    cleanText(scene.time || shot?.sceneTime),
    cleanText(scene.atmosphere || shot?.atmosphere),
  ].filter(Boolean).join(' / ');
  const characterText = characters.length > 0
    ? characters.map((character: any) => formatCharacterForPrompt(character, shot)).join('；')
    : cleanText(shot?.actorBlocking || shot?.actionAndDialogue || shot?.description, '按画面内容安排人物调度');

  return `镜头${shotNumber}｜时间：${timeRange}
画面内容：${cleanText(shot?.description || shot?.panelDescription || shot?.videoPrompt, '根据本镜头剧情呈现关键画面')}
景别：${cleanText(shot?.shotType, '中景')}｜焦段：${cleanText(shot?.focalLength, '标准焦段')}｜机位/角度：${cleanText(shot?.cameraPosition || shot?.cameraAngle, '平视机位')}｜运镜：${cleanText(shot?.cameraMovement, '稳定推进')}
场景：${sceneText || '未指定场景'}
人物调度：${cleanText(shot?.actorBlocking, characterText)}
动作变化：${cleanText(shot?.actionChange || shot?.continuity, '承接上一镜头动作，并标注微表情、视线和肢体变化')}
台词/声音：${cleanText(shot?.dialogue || shot?.actionAndDialogue, '无明确台词时保留环境声与动作声')}
镜头意图：${cleanText(shot?.shotPurpose || shot?.purpose, '推进叙事、强化人物情绪与空间关系')}`;
}

function buildLocalStoryboardPrompt(payload: StoryboardPromptPayload): string {
  const shots = Array.isArray(payload.shots) ? payload.shots : [];
  const safeReferenceImages = Array.isArray(payload.referenceImages)
    ? payload.referenceImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
  const shotBlocks = shots.map((shot, index) => formatShotForPrompt(shot, index)).join('\n\n');
  const characterNames = uniq(shots.flatMap((shot: any) =>
    Array.isArray(shot?.characters)
      ? shot.characters.map((character: any) => cleanText(character?.name))
      : []
  ));
  const sceneNames = uniq(shots.map((shot: any) => cleanText(shot?.scene?.location || shot?.location)));
  const refText = safeReferenceImages.length > 0
    ? safeReferenceImages.map((url, index) => `（image${index + 1}）${url}`).join('\n')
    : '无参考图片时，依据分镜文字保持写实电影质感、统一角色外观和统一场景空间。';

  return `横向超宽电影导演工作板布局，生成一张电影工业级分镜故事板总控图。整张图必须像真实剧组导演、美术、摄影联合使用的执行总控板，中文印刷级标注清晰，信息层级严谨，不要手绘箭头，不要涂鸦批注，不要水印，不要英文规格参数区。

顶部项目信息栏：项目/章节「${cleanText(payload.chapterTitle, '未命名章节')}」，镜头段落「第${payload.groupIndex ?? 1}组连续分镜」，主要角色「${characterNames.join('、') || '按镜头内容识别主体人物'}」，主要场景「${sceneNames.join('、') || '按镜头内容建立空间'}」，导演意图为连续叙事、紧凑节奏、明确人物站位、突出动作变化与情绪递进。

上方三类设定模块：
左上「角色设定」采用影视角色档案布局，展示主要角色小图组、服装状态、情绪状态、动作习惯、人物关系、关键视觉特征。
中上「美术/场景设定」采用空间设定板布局，展示空间结构、区域功能、关键道具、人物动线、场景氛围、空间关系。
右上「运镜方案」采用导演调度图布局，展示主机位、辅助机位、移动轨迹、视线方向、调度逻辑、切换节奏、空间压力；路线和箭头必须是干净的矢量标注。

主体区域是时间分镜表，占整张画面 60% 到 70%。每个镜头格按时间顺序从左到右、从上到下排列；画面预览大于文字说明。每格必须包含中文字段：镜头编号、时间段、画面内容、景别、焦段、机位、运镜、人物动作、人物台词、情绪变化、声音提示、镜头意图。

本组镜头逐格内容：
${shotBlocks}

底部辅助参考区只保留三类内容：
镜头说明：剪辑节奏紧凑，长台词拆成连续反应镜头和动作镜头，加入适当空镜、反应镜头、连续组合镜头，让画面更活。
色彩指南：${joinSetting(payload.imageSettings?.styles, '电影感、写实、统一色彩倾向')}；画面比例倾向：${joinSetting(payload.imageSettings?.ratios, '16:9')}。
灯光参考：${joinSetting(payload.imageSettings?.lighting, '自然电影光、环境光、轮廓光、空间阴影')}。

参考图片必须继承其整体画风、质感、色彩倾向、光影气质、角色外观、场景视觉语言与构图关系。参考图片如下：
${refText}

最终画面要求：真实电影分镜总控板，高密度但可读，干净印刷级中文排版，镜头格清晰，人物相对位置明确，动作变化可见，表情和肢体细节丰富，整体不是插画拼贴，而是可执行的导演工作流故事板。`;
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const payload = await request.json() as StoryboardPromptPayload;
    const {
      chapterTitle,
      groupIndex,
      shots,
      referenceImages,
      imageSettings,
    } = payload;

    if (!shots || !Array.isArray(shots) || shots.length === 0) {
      return NextResponse.json({ error: '请提供分镜数据' }, { status: 400 });
    }

    console.log(`🎬 生成故事板文字提示词: 章节="${chapterTitle}", 第${groupIndex}组, ${shots.length}个镜头`);

    const localPrompt = buildLocalStoryboardPrompt(payload);

    // 默认使用结构化分镜直接生成，避免模型超时/返回空导致按钮报错。
    // 如需重新启用模型润色，可在环境变量中设置 ENABLE_LLM_STORYBOARD_PROMPT=true。
    const shouldUseModelPrompt = process.env.ENABLE_LLM_STORYBOARD_PROMPT === 'true';
    if (!shouldUseModelPrompt || shots.length >= 4 || (Array.isArray(referenceImages) && referenceImages.length > 8)) {
      console.log(`✅ 故事板提示词本地生成成功: ${localPrompt.substring(0, 100)}...`);

      return NextResponse.json({
        success: true,
        storyboardPrompt: localPrompt,
        groupIndex,
        shotCount: shots.length,
        source: 'local',
      });
    }

    // 构建分镜组描述
    const shotDescriptions = shots.map((shot: any) => {
      const scene = shot.scene || {};
      const characters = shot.characters || [];
      const charDesc = characters.map((c: any) => {
        return `${c.name} - 动作: ${shot.actionAndDialogue || c.action || ''}${c.dialogue ? `, 台词: 「${c.dialogue}」` : ''}`;
      }).join('；');

      return `[镜头${shot.shotNumber}] 景别=${shot.shotType || '中景'} | 焦段=${shot.focalLength || ''} | 机位=${shot.cameraPosition || ''} | 运镜=${shot.cameraMovement || ''} | 内容=${shot.description || ''} | 人物=${charDesc} | 场景=${scene.location || ''}(${scene.time || ''},${scene.atmosphere || ''})`;
    }).join('\n');

    const allCharacters = shots.flatMap((s: any) => (s.characters || []).map((c: any) => c.name));
    const uniqueChars = [...new Set(allCharacters)];
    const mainScene = shots[0]?.scene?.location || '';

    // 构建参考图描述
    let refDesc = '';
    if (referenceImages && referenceImages.length > 0) {
      refDesc = `\n\n本组镜头有 ${referenceImages.length} 张参考图片，分别是：\n`;
      referenceImages.forEach((url: string, i: number) => {
        refDesc += `（image${i + 1}）${url}\n`;
      });
      refDesc += '\n所有参考图片的画风、质感、色彩倾向、光影气质必须被继承到故事板总控图中。';
    }

    const userMsg = `章节名称：${chapterTitle}
第 ${groupIndex} 组分镜（${shots.length} 个连续镜头）：

${shotDescriptions}

主要角色：${uniqueChars.join('、') || '无'}
主要场景：${mainScene || '无'}
${refDesc}

全局画面设定（用户指定的视觉风格，必须严格执行）：
- 画面比例：${imageSettings?.ratios?.join(' / ') || '未指定'}
- 画面风格：${joinSetting(imageSettings?.styles)}
- 光影效果：${joinSetting(imageSettings?.lighting)}

以上比例、风格和光影效果必须融入到故事板总控图的画面描述与视觉呈现中。

请根据以上信息，生成一份完整的电影工业级分镜故事板总控图描述。`;

    try {
      // 调用 GPT-5（openai-client 内置自动重试）。失败时降级为结构化本地提示词，不再让前端按钮报错。
      const result = await oaiInvoke([
        { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ], { temperature: 0.7, maxTokens: 2000, timeout: 45_000 });

      const trimmed = result.trim();
      if (!trimmed) throw new Error('GPT-5 未返回有效的提示词');

      console.log(`✅ 故事板提示词生成成功: ${trimmed.substring(0, 100)}...`);

      return NextResponse.json({
        success: true,
        storyboardPrompt: trimmed,
        groupIndex,
        shotCount: shots.length,
        source: 'llm',
      });
    } catch (modelError: any) {
      console.warn('⚠️ 模型生成故事板提示词失败，已降级为本地结构化提示词:', modelError);

      return NextResponse.json({
        success: true,
        storyboardPrompt: localPrompt,
        groupIndex,
        shotCount: shots.length,
        source: 'local-fallback',
        warning: modelError?.message || '模型生成失败，已使用本地提示词',
      });
    }

  } catch (error: any) {
    console.error('❌ 故事板提示词生成失败:', error);
    return NextResponse.json({
      success: false,
      error: error.message || '故事板提示词生成失败',
    }, { status: 500 });
  }
}
