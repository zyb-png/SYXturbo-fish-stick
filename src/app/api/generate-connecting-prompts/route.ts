import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';

// 设置 API 路由超时时间为 5 分钟（LLM 生成需要较长时间）
export const maxDuration = 600; // 单位：秒

// 素材图片数据结构
interface AssetImage {
  imageId: string;
  imageUrl: string;
  imageKey?: string;
  isCustom?: boolean;
}

interface AssetImages {
  assetId: string;
  type: 'scene' | 'character' | 'prop';
  name: string;
  images: AssetImage[];
}

// 分镜图像设置（用于视频提示词生成）
interface ImageStoryboardSettings {
  ratios: ('16:9' | '9:16' | '4:3' | '1:1')[];
  styles: string[];
  lighting: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { 
      imageStoryboards, 
      chapterTitle, 
      chapterSummary,  // 新增：章节故事概要
      storyTitle,      // 新增：整体故事标题
      storySummary,    // 新增：整体故事概要
      storyboard, 
      assetImages,  // 新增：素材图片数据
      scenesData,   // 新增：场景数据（用于匹配场景 ID）
      charactersData, // 新增：人物数据（用于匹配人物 ID）
      propsData,    // 新增：道具数据（用于匹配道具 ID）
      imageSettings,  // 新增：分镜图像设置（比例、风格、光影）
    } = await request.json();

    // 支持两种输入方式：
    // 1. imageStoryboards: 图片分镜数据（兼容旧流程）
    // 2. storyboard: 纯文字分镜数据（新流程，跳过图片分镜）
    const hasImageStoryboards = imageStoryboards && Array.isArray(imageStoryboards) && imageStoryboards.length > 0;
    const hasStoryboard = storyboard && Array.isArray(storyboard) && storyboard.length > 0;

    if (!hasImageStoryboards && !hasStoryboard) {
      return NextResponse.json(
        { error: '请提供图片分镜数据或文字分镜数据' },
        { status: 400 }
      );
    }

    // 初始化 LLM 客户端

    // 计算分镜数量
    const totalShots = hasImageStoryboards 
      ? imageStoryboards.filter((s: any) => !s.error).length 
      : storyboard.length;

    // 构建图像设置描述
    const imageSettingsDesc = imageSettings ? `
【重要】全局分镜设置（必须应用于所有视频提示词）：
- 画面比例：${imageSettings.ratios?.join('、') || '16:9'}
- 画面风格：${imageSettings.styles?.length > 0 ? imageSettings.styles.join('、') : '自动选择适合的风格'}
- 光影效果：${imageSettings.lighting?.length > 0 ? imageSettings.lighting.join('、') : '自动选择适合的光影'}

请在生成视频提示词时，将这些设置融入到画面描述中，确保：
1. 视频画面比例符合用户选择的设置
2. 画面风格与用户选择的风格一致
3. 光影效果与用户选择的设置匹配
` : '';

    // 构建故事背景描述
    const storyBackgroundDesc = storyTitle || storySummary ? `
【重要】故事背景（请深入理解并融入视频提示词）：
${storyTitle ? `故事标题：${storyTitle}` : ''}
${storySummary ? `故事概要：${storySummary}` : ''}
${chapterSummary ? `本章概要：${chapterSummary}` : ''}

请确保生成的视频提示词：
1. 紧扣故事主题和情感基调
2. 画面风格与故事氛围相匹配
3. 人物表演符合角色性格和当前情节发展
4. 场景氛围能够烘托故事情感
` : '';

    // 生成分镜串联提示词的系统提示
    const systemPrompt = `你是一位电影级分镜导演、影视预演设计师、AI视觉统筹师、镜头语言分析师。你的任务是为每个分镜生成一份"电影工业级分镜故事板面板"的完整描述。

【核心理念】
你的输出将用于驱动 AI 绘制电影工业级分镜故事板面板（总控图），以及作为 RunningHub 图生图的输入提示词。
1. 每个 panelDescription 必须是一个**流畅的自然语言段落**（不是标签堆砌），包含：
   - 景别 + 焦段感（如"中景，85mm 长焦压缩空间"）
   - 场景氛围（位置、时间、光影、色调）
   - 人物动作与表演细节 + 台词（嵌入动作描述中）
   - 镜头运动方式（中文清晰描述）
   - 构图与机位（摄影机位置、拍摄角度）
   - 道具状态（具体位置、数量、使用方式）
2. panelDescription 要像"导演分镜总控图上的文字说明"——具体、可执行、有画面感
3. 严禁抽象文学描述！所有"内心崩溃""鼓起勇气"等必须转为具象视听语言

${storyBackgroundDesc}
${imageSettingsDesc}

【Skill 5 影视级字段利用规范】
每个分镜提供了 6 个专业字段（focalLength/aperture/cameraPosition/composition/cameraMovement/actionAndDialogue），你必须：
1. 将 cameraPosition（机位模板）自然融入 panelDescription——描述摄影机在哪、怎么拍
2. 将 composition（构图）融入——描述主体在画面中的位置关系
3. 将 actionAndDialogue（台词嵌入动作）直接使用——保持台词原文
4. 将 focalLength/aperture 融入镜头语言描述

【分镜衔接 - 强制要求】
- 除第一个分镜外，每个分镜的 panelDescription **开头必须包含与上一镜末尾的衔接描述**
- 衔接方式："承接上一镜，[上一镜末尾动作/状态]，镜头切换至..."
- 例如："承接上一镜花十掐灭烟头的动作，镜头拉开至中景，露夏低头搅拌奶茶..."
- 确保人物服装、道具状态、环境光线在相邻镜头间一致

【绝对重要】数量要求：
- 输入的分镜数量为 ${totalShots} 个
- 你必须生成且只能生成 ${totalShots} 个故事板面板描述
- shotPrompts 数组的长度必须等于 ${totalShots}
- 每个分镜都必须有对应的故事板面板描述，不能遗漏或多余
- shotNumber 必须与输入的分镜编号一一对应

【重要】场景设计要求：
- 场景设计必须大胆创新，视觉冲击力强
- 画面极具吸引力，构图独特
- 色彩对比鲜明，光影效果震撼
- 每个镜头都要有视觉亮点

【专业分镜版提示词格式 - 强制要求】
每个 panelDescription 必须以电影工业级分镜故事板的专业格式编写，像真实电影剧组中导演对摄影师的分镜指令，包含以下内容：
1. 镜头编号与时间段：以【镜头 X | XX:XX - XX:XX】开头
2. 画面内容：详细描述角色在场景中的位置、动作、与环境的关系
3. 景别与焦段：精确说明景别（特写/近景/中景/全景/远景）和焦段感（如35mm广角、85mm长焦）
4. 机位与运镜：说明摄影机位置（正面/侧面/俯拍/仰拍）、运动方式（推/拉/摇/移/跟/升降）
5. 人物动作与台词：演员的表演细节和台词原文（用引号标注）
6. 情绪变化：角色此时的情感和表演状态
7. 色彩与光影：画面主色调、光影方向、氛围感
8. 声音提示：环境音效或背景音乐提示
9. 镜头意图：这个镜头要传达的叙事目的或情感冲击

示例故事板面板描述：
【镜头 1 | 00:00 - 00:04】中景，35mm广角镜头，主角站立在昏暗的仓库中央，背后是堆满杂物的货架，顶光从右上方打下在主角脸上投出阴影。主角慢慢抬起头，眼神坚定地说出我来了。冷蓝色调，环境音是低沉的机器嗡鸣声。镜头意图：建立场景压迫感和主角的决心。

每个 panelDescription 必须像导演分镜总控图上的文字说明一样专业、精准、有画面执行力。
严禁使用抽象文学描述，所有情绪和心理活动必须转化为可见的肢体动作、表情变化和场景氛围。

请以 JSON 格式返回结果，格式如下：
{
  "chapterTitle": "章节标题",
  "storyFlow": "整体故事流程描述",
  "connectingNarrative": "串联所有分镜的叙事文本",
  "totalDuration": "预计总时长（秒）",
  "shotPrompts": [
    {
      "shotNumber": 1,
      "panelDescription": "电影工业级分镜故事板面板描述（包含景别、场景、人物动作台词、镜头运动、构图机位、道具、衔接过渡）",
      "duration": 4,
      "transition": "到下一镜的过渡描述",
      "emotionNote": "情感基调说明",
      "performance": "人物表演指导"
    }
  ]
}`;

    // 构建输入内容 - 支持图片分镜或纯文字分镜
    let shotsDescription = '';
    
    if (hasImageStoryboards) {
      // 方式1：基于图片分镜数据（兼容旧流程）
      shotsDescription = imageStoryboards
        .filter((s: any) => !s.error)
        .map((s: any, index: number) => {
          return `
【分镜 ${s.shotNumber}】
画面描述：${s.originalShot.description || '无'}
场景：${s.originalShot.scene?.location || '无'}，${s.originalShot.scene?.atmosphere || '无'}
人物：${s.originalShot.characters?.map((c: any) => `${c.name} ${c.action || ''}`).join('、') || '无'}
镜头运动：${s.originalShot.cameraMovement || '无'}
图片提示词：${s.prompt}
`;
        })
        .join('\n');
    } else if (hasStoryboard) {
      // 方式2：基于纯文字分镜数据（新流程）- 包含 Skill 5 影视级字段
      shotsDescription = storyboard
        .map((shot: any, index: number) => {
          const scene = shot.scene || {};
          const characters = shot.characters || [];
          const props = scene.props || [];
          
          return `
【分镜 ${shot.shotNumber || index + 1}】
景别：${shot.shotType || '无'}
镜头作用：${shot.shotPurpose || '无'}
镜头角度：${shot.cameraAngle || '无'}
画面描述：${shot.description || '无'}
场景：${scene.location || '无'}
时间：${scene.time || '无'}
氛围：${scene.atmosphere || '无'}
光影：${scene.lighting || '无'}
道具：${props.length > 0 ? props.join('、') : '无'}
镜头运动：${shot.cameraMovement || '无'}
情感节拍：${shot.emotionalBeat || '无'}
人物站位：${shot.actorBlocking || '无'}
动作变化：${shot.actionChange || '无'}
连续性：${shot.continuity || '无'}
拍摄备注：${shot.notes || '无'}
人物详情：${characters.map((c: any) => 
  `${c.name || '未知'} - 站位：${c.position || '无'} - 表演：${c.performance || '无'} - 动作：${c.action || '无'} - 表情：${c.expression || '无'} - 脸部动作：${c.facialAction || '无'} - 手势：${c.gesture || '无'} - 动作变化：${c.actionChange || '无'} - 反应：${c.reaction || '无'} - 对白：${c.dialogue ? `"${c.dialogue}"` : '无'} - 对白类型：${c.dialogueType || '无'}`
).join(' | ') || '无'}
【Skill 5 影视参数】
焦段：${shot.focalLength || '无'}
光圈：${shot.aperture || '无'}
机位：${shot.cameraPosition || '无'}
构图：${shot.composition || '无'}
动作/台词：${shot.actionAndDialogue || '无'}
限制：${shot.restrictions || '无'}
`;
        })
        .join('\n');
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `请为以下章节的分镜生成串联提示词和视频生成提示词。

章节标题：${chapterTitle}

分镜内容：
${shotsDescription}

【重要要求】
1. 为每个分镜生成自然语言描述的故事板面板 panelDescription
2. 充分利用 Skill 5 的机位/构图/焦段/光圈信息，融入视频提示词中
3. ★ 除第一个分镜外，每个分镜的 panelDescription 开头必须包含与上一镜末尾的衔接过渡
4. 台词必须保持原文，嵌入动作描述中
5. cameraPosition 的机位描述要自然融入提示词
6. 场景设计大胆创新，画面极具吸引力和视觉冲击力
7. 分镜之间的道具状态、人物服装、环境光线要保持一致
8. 每个 panelDescription 必须按【专业分镜版提示词格式】的要求编写，以【镜头编号 | 时间段】开头，包含画面内容、景别焦段、机位运镜、人物动作台词、情绪变化、色彩光影、声音提示、镜头意图`
      }
    ];

    // 估算输入token
    const inputTokens = estimateMessagesTokens(messages);

    let fullResponse = '';

    // 50+ 镜头时，整章一次性让模型返回完整 JSON 极易超时或截断。
    // 这种情况下先用文字分镜本身稳定生成面板描述，后续每组故事板提示词仍可单独 AI 精修。
    const shouldUseLocalPanelPrompts = totalShots > 24 || inputTokens > 24000;
    if (shouldUseLocalPanelPrompts) {
      console.log(`分镜数量/输入过大，使用本地稳定面板描述生成: shots=${totalShots}, inputTokens=${inputTokens}`);
      fullResponse = JSON.stringify({
        chapterTitle,
        storyFlow: '根据文字分镜自动生成故事版面板描述',
        connectingNarrative: '长章节采用本地稳定生成，避免一次性大模型输出截断',
        totalDuration: `${totalShots * 3}秒`,
        shotPrompts: [],
      });
    } else {
      // 使用流式输出
      const stream = oaiStream(messages, {
        temperature: 0.8,
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          fullResponse += chunk.content.toString();
        }
      }
    }

    // 估算输出token
    const outputTokens = estimateTokens(fullResponse);

    // 尝试解析 JSON
    try {
      let jsonStr = fullResponse.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) {
        console.log('未找到有效的 JSON 内容，将使用默认提示词');
        jsonStr = '{"shotPrompts": []}';
      }
      
      // 尝试解析 JSON
      let connectingPrompts: any = null;
      try {
        connectingPrompts = JSON.parse(jsonStr);
      } catch (e) {
        // JSON 解析失败，尝试多种修复方式
        console.log('JSON 解析失败，尝试修复...');
        
        // 方法1: 尝试找到 shotPrompts 数组并截取到有效的位置
        const shotPromptsMatch = jsonStr.match(/"shotPrompts"\s*:\s*\[/);
        if (shotPromptsMatch) {
          // 找到 shotPrompts 数组开始的位置
          const startIndex = shotPromptsMatch.index! + shotPromptsMatch[0].length;
          let depth = 1; // 已经进入数组
          let validEnd = -1;
          let lastCompleteObject = -1;
          
          for (let i = startIndex; i < jsonStr.length && depth > 0; i++) {
            if (jsonStr[i] === '{') {
              depth++;
            } else if (jsonStr[i] === '}') {
              depth--;
              if (depth === 1) {
                // 完成一个对象
                lastCompleteObject = i;
              }
            } else if (jsonStr[i] === '[') {
              depth++;
            } else if (jsonStr[i] === ']') {
              depth--;
              if (depth === 0) {
                validEnd = i;
                break;
              }
            }
          }
          
          // 如果找到完整的数组结束
          if (validEnd > 0) {
            const fixedJson = jsonStr.substring(0, validEnd + 1) + '}}';
            try {
              connectingPrompts = JSON.parse(fixedJson);
              console.log('JSON 修复成功（方法1: 完整数组）');
            } catch (e1) {
              // 尝试截取到最后一个完整对象
              if (lastCompleteObject > 0) {
                const fixedJson2 = jsonStr.substring(0, lastCompleteObject + 1) + ']}}';
                try {
                  connectingPrompts = JSON.parse(fixedJson2);
                  console.log('JSON 修复成功（方法1: 部分数组）');
                } catch (e2) {
                  console.log('方法1修复失败，尝试方法2');
                }
              }
            }
          } else if (lastCompleteObject > 0) {
            // 截取到最后一个完整对象
            const fixedJson = jsonStr.substring(0, lastCompleteObject + 1) + ']}}';
            try {
              connectingPrompts = JSON.parse(fixedJson);
              console.log('JSON 修复成功（方法1: 最后完整对象）');
            } catch (e2) {
              console.log('方法1修复失败，尝试方法2');
            }
          }
        }
        
        // 方法2: 如果方法1失败，尝试更通用的修复
        if (!connectingPrompts) {
          // 尝试截取到最后一个有效的闭合括号
          const lastBrace = jsonStr.lastIndexOf('}');
          const lastBracket = jsonStr.lastIndexOf(']');
          const lastClose = Math.max(lastBrace, lastBracket);
          
          if (lastClose > 0) {
            // 尝试找到完整的对象
            let depth = 0;
            let validEnd = -1;
            for (let i = 0; i < jsonStr.length; i++) {
              if (jsonStr[i] === '{' || jsonStr[i] === '[') depth++;
              if (jsonStr[i] === '}' || jsonStr[i] === ']') depth--;
              if (depth === 0) {
                validEnd = i;
                break;
              }
            }
            
            if (validEnd > 0) {
              jsonStr = jsonStr.substring(0, validEnd + 1);
              try {
                connectingPrompts = JSON.parse(jsonStr);
                console.log('JSON 修复成功（方法2）');
              } catch (e2) {
                console.log('JSON 修复失败，使用空提示词');
              }
            }
          }
        }
        
        // 方法3: 如果所有方法都失败，使用空的 shotPrompts
        if (!connectingPrompts) {
          console.log('所有修复方法失败，使用默认空提示词');
          connectingPrompts = { shotPrompts: [] };
        }
      }
      
      // 确保 shotPrompts 数量与输入一致
      if (!connectingPrompts.shotPrompts || !Array.isArray(connectingPrompts.shotPrompts)) {
        connectingPrompts.shotPrompts = [];
      }
      
      const generatedCount = connectingPrompts.shotPrompts.length;
      console.log(`提示词生成: 期望 ${totalShots}, 实际生成 ${generatedCount}`);
      
      // 获取输入数据源
      const inputShots = hasImageStoryboards 
        ? imageStoryboards.filter((s: any) => !s.error)
        : storyboard;
      
      // 构建期望的 shotNumber 列表
      const expectedShotNumbers = inputShots.map((s: any, index: number) => s.shotNumber || index + 1);
      
      // 创建一个 Map 来存储已生成的提示词
        const generatedMap = new Map<number, any>();
        connectingPrompts.shotPrompts.forEach((p: any) => {
          if (p.shotNumber) {
            generatedMap.set(p.shotNumber, p);
          }
        });
        
        // 构建素材图片查找映射
        const assetImageMap = new Map<string, string>();
        if (assetImages && Array.isArray(assetImages)) {
          assetImages.forEach((asset: AssetImages) => {
            if (asset.images && asset.images.length > 0) {
              // 使用第一张图片作为视频生成的参考图
              assetImageMap.set(asset.assetId, asset.images[0].imageUrl);
              // 同时支持按名称查找
              assetImageMap.set(`${asset.type}-${asset.name}`, asset.images[0].imageUrl);
            }
          });
        }
        
        // 构建场景名称到 ID 的映射
        const sceneNameToId = new Map<string, string>();
        if (scenesData?.scenes) {
          scenesData.scenes.forEach((scene: any) => {
            sceneNameToId.set(scene.name, scene.id);
          });
        }
        
        // 构建人物名称到 ID 的映射
        const characterNameToId = new Map<string, string>();
        if (charactersData?.characters) {
          charactersData.characters.forEach((char: any) => {
            characterNameToId.set(char.name, char.id);
          });
        }
        
        // 构建道具名称到 ID 的映射
        const propNameToId = new Map<string, string>();
        if (propsData?.props) {
          propsData.props.forEach((prop: any) => {
            propNameToId.set(prop.name, prop.id);
          });
        }
        
        console.log(`素材图片映射: ${assetImageMap.size} 条`);
        console.log(`场景名称映射: ${sceneNameToId.size} 条`);
        console.log(`人物名称映射: ${characterNameToId.size} 条`);
        console.log(`道具名称映射: ${propNameToId.size} 条`);
        
        // 重新构建 shotPrompts，确保与输入一致，并添加素材图片 URL
        const finalShotPrompts: any[] = [];
        expectedShotNumbers.forEach((shotNum: number, index: number) => {
          const shotData = inputShots[index];
          const existingPrompt = generatedMap.get(shotNum);
          
          // 获取图片 URL（如果有图片分镜数据）
          const imageUrl = hasImageStoryboards ? (shotData as any)?.imageUrl : undefined;
          const imageUrlEndFrame = hasImageStoryboards ? (shotData as any)?.imageUrlEndFrame : undefined;
          
          // 从素材确认模块获取图片
          let sceneImageUrl: string | undefined;
          let characterImageUrls: string[] = [];
          let propImageUrls: string[] = [];
          
          if (!imageUrl && assetImages) {
            // 获取场景图片
            const shot = hasImageStoryboards ? (shotData as any)?.originalShot : shotData;
            const sceneName = shot?.scene?.location;
            if (sceneName) {
              // 先尝试通过 ID 查找
              const sceneId = sceneNameToId.get(sceneName);
              if (sceneId) {
                sceneImageUrl = assetImageMap.get(`scene-${sceneId}`);
              }
              // 如果没找到，尝试通过名称查找
              if (!sceneImageUrl) {
                sceneImageUrl = assetImageMap.get(`scene-${sceneName}`);
              }
            }
            
            // 获取人物图片
            const characters = shot?.characters || [];
            characters.forEach((char: any) => {
              const charName = char.name;
              if (charName) {
                const charId = characterNameToId.get(charName);
                let charImageUrl: string | undefined;
                if (charId) {
                  charImageUrl = assetImageMap.get(`character-${charId}`);
                }
                if (!charImageUrl) {
                  charImageUrl = assetImageMap.get(`character-${charName}`);
                }
                if (charImageUrl) {
                  characterImageUrls.push(charImageUrl);
                }
              }
            });
            
            // 获取道具图片
            const propNames = shot?.scene?.props || [];
            propNames.forEach((propName: string) => {
              if (propName) {
                const propId = propNameToId.get(propName);
                let propImageUrl: string | undefined;
                if (propId) {
                  propImageUrl = assetImageMap.get(`prop-${propId}`);
                }
                if (!propImageUrl) {
                  propImageUrl = assetImageMap.get(`prop-${propName}`);
                }
                if (propImageUrl) {
                  propImageUrls.push(propImageUrl);
                }
              }
            });
          }
          
          // 确定最终使用的图片 URL
          // 优先级：图片分镜 > 场景图片 > 人物图片 > 道具图片
          const finalImageUrl = imageUrl || sceneImageUrl || (characterImageUrls.length > 0 ? characterImageUrls[0] : undefined) || (propImageUrls.length > 0 ? propImageUrls[0] : undefined);
          
          if (existingPrompt) {
            // 使用已生成的提示词，确保 shotNumber 正确，并添加图片 URL
            finalShotPrompts.push({
              ...existingPrompt,
              shotNumber: shotNum,
              imageUrl: finalImageUrl,
              imageUrlEndFrame,
              sceneImageUrl,     // 场景图片（供参考）
              characterImageUrls, // 人物图片（供参考）
              propImageUrls,      // 道具图片（供参考）
            });
          } else {
            // 为缺失的分镜生成默认提示词（包含所有字段，含 Skill 5 字段）
            const description = shotData?.description || shotData?.originalShot?.description || '';
            const scene = shotData?.scene || shotData?.originalShot?.scene || {};
            const characters = shotData?.characters || shotData?.originalShot?.characters || [];
            const props = shotData?.scene?.props || shotData?.originalShot?.scene?.props || [];
            const shotType = shotData?.shotType || '中景';
            const shotPurpose = shotData?.shotPurpose || '';
            const cameraAngle = shotData?.cameraAngle || '';
            const actorBlocking = shotData?.actorBlocking || '';
            const actionChange = shotData?.actionChange || '';
            const continuity = shotData?.continuity || '';
            const cameraMovement = shotData?.cameraMovement || '固定镜头';
            const notes = shotData?.notes || '';
            const emotionalBeat = shotData?.emotionalBeat || '';
            const duration = shotData?.duration || 4;
            
            // Skill 5 字段
            const focalLength = shotData?.focalLength || '';
            const aperture = shotData?.aperture || '';
            const cameraPosition = shotData?.cameraPosition || '';
            const composition = shotData?.composition || '';
            const actionAndDialogue = shotData?.actionAndDialogue || '';
            const restrictions = shotData?.restrictions || '';
            
            const formatTime = (seconds: number) => {
              const safeSeconds = Math.max(0, Math.floor(seconds));
              const mins = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
              const secs = (safeSeconds % 60).toString().padStart(2, '0');
              return `${mins}:${secs}`;
            };

            const durationNumber = Number(duration) || 3;
            const startTime = inputShots
              .slice(0, index)
              .reduce((sum: number, shot: any) => sum + (Number(shot?.duration || shot?.originalShot?.duration) || 3), 0);
            const endTime = startTime + durationNumber;

            const sceneParts = [
              scene.location || '主要场景',
              scene.time ? `时间为${scene.time}` : '',
              scene.atmosphere ? `氛围为${scene.atmosphere}` : '',
              scene.lighting ? `光影为${scene.lighting}` : '',
            ].filter(Boolean).join('，');

            const characterText = characters.length > 0
              ? characters.map((c: any) => {
                  const details = [
                    c.position ? `站位：${c.position}` : '',
                    c.performance ? `表演：${c.performance}` : '',
                    c.action ? `动作：${c.action}` : '',
                    c.expression ? `表情：${c.expression}` : '',
                    c.facialAction ? `脸部动作：${c.facialAction}` : '',
                    c.gesture ? `手势：${c.gesture}` : '',
                    c.reaction ? `反应：${c.reaction}` : '',
                  ].filter(Boolean).join('，');
                  return details ? `${c.name || '人物'}（${details}）` : (c.name || '人物');
                }).filter(Boolean).join('；')
              : '画面以环境和道具状态推动叙事';

            const dialogueText = characters
              .filter((c: any) => c.dialogue)
              .map((c: any) => `${c.name || '人物'}：“${c.dialogue}”`)
              .join('，');

            const defaultPrompt = [
              `【镜头 ${shotNum} | ${formatTime(startTime)} - ${formatTime(endTime)}】`,
              `${shotType}${focalLength ? `，${focalLength}焦段感` : ''}${aperture ? `，${aperture}光圈` : ''}。`,
              `${sceneParts}。`,
              cameraPosition ? `${cameraPosition}` : `${cameraAngle || '眼平平视'}拍摄，${cameraMovement}。`,
              composition ? `构图：${composition}。` : '',
              actorBlocking ? `人物站位：${actorBlocking}。` : '',
              description ? `画面内容：${description}。` : '',
              actionAndDialogue ? `动作与台词：${actionAndDialogue}。` : '',
              characterText ? `人物表演：${characterText}。` : '',
              dialogueText ? `台词原文：${dialogueText}。` : '',
              actionChange ? `动作变化：${actionChange}。` : '',
              continuity ? `连续性：${continuity}。` : '',
              props.length > 0 ? `道具状态：${props.join('、')}保持可见并与上一镜连续。` : '',
              `镜头运动：${cameraMovement}。`,
              emotionalBeat ? `情绪变化：${emotionalBeat}。` : '',
              notes ? `镜头意图：${notes}。` : `镜头意图：突出${shotPurpose || '当前剧情节拍'}，让观众清楚感知动作与情绪推进。`,
              restrictions ? `限制：${restrictions}。` : '',
            ].filter(Boolean).join('');
            
            finalShotPrompts.push({
              shotNumber: shotNum,
              panelDescription: defaultPrompt,
              duration: duration,
              transition: '',
              emotionNote: emotionalBeat,
              performance: '',
              imageUrl: finalImageUrl,
              imageUrlEndFrame,
              sceneImageUrl,
              characterImageUrls,
              propImageUrls,
            });
          }
        });
        
        connectingPrompts.shotPrompts = finalShotPrompts;
        console.log(`最终提示词数量: ${finalShotPrompts.length}`);
        console.log(`包含图片的提示词数量: ${finalShotPrompts.filter(p => p.imageUrl).length}`);
        
        return NextResponse.json({
          success: true,
          connectingPrompts,
          tokenUsage: {
            input: inputTokens,
            output: outputTokens,
            timestamp: Date.now(),
          },
        });
    } catch (parseError) {
      console.error('JSON 解析失败:', parseError);
      console.error('原始响应内容:', fullResponse?.substring(0, 500));
      return NextResponse.json({
        success: false,
        error: 'AI 返回的数据格式异常，请重试',
        details: parseError instanceof Error ? parseError.message : '解析失败',
      });
    }
  } catch (error) {
    console.error('串联提示词生成失败:', error);
    return NextResponse.json({
      success: false,
      error: '串联提示词生成失败，请稍后重试',
      details: error instanceof Error ? error.message : '未知错误',
    });
  }
}
