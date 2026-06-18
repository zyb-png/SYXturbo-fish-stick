import { NextRequest, NextResponse } from 'next/server';
import { stream as oaiStream, invoke as oaiInvoke } from '@/lib/openai-client';
import { estimateMessagesTokens, estimateTokens } from '@/lib/token-utils';
import { tryExtractAndFixJSON, removeControlCharsInStrings } from '@/lib/json-utils';

// 每批处理的道具数
const BATCH_SIZE = 8;

export async function POST(request: NextRequest) {
  try {
    const { content, fileName, batch = 0, propMarkers } = await request.json();

    if (!content) {
      return NextResponse.json(
        { error: '未提供文件内容' },
        { status: 400 }
      );
    }

    console.log(`开始提取道具，文件: ${fileName}, 批次: ${batch}, 内容长度: ${content.length}`);

    // 初始化 LLM 客户端

    // 第一批或没有道具标记时：识别所有道具名称
    let allPropMarkers: string[] = propMarkers || [];
    
    if (batch <= 1 || !propMarkers || propMarkers.length === 0) {
      // 识别道具标记
      allPropMarkers = await identifyPropMarkers(content, fileName);
      console.log(`识别到 ${allPropMarkers.length} 个道具:`, allPropMarkers);
    }

    if (allPropMarkers.length === 0) {
      // 如果没有识别到道具标记，使用传统方式
      const result = await extractPropsTraditional(content, fileName);
      return NextResponse.json({
        success: true,
        type: 'props',
        data: result,
        batchInfo: {
          currentBatch: 1,
          totalBatches: 1,
          hasMore: false,
        },
        tokenUsage: result.tokenUsage,
      });
    }

    // 分批提取道具详情
    const totalBatches = Math.ceil(allPropMarkers.length / BATCH_SIZE);
    // 确保 batch 至少为 1
    const currentBatch = Math.max(1, batch);
    const currentBatchStart = (currentBatch - 1) * BATCH_SIZE;
    const currentBatchProps = allPropMarkers.slice(currentBatchStart, currentBatchStart + BATCH_SIZE);
    
    console.log(`处理第 ${currentBatch}/${totalBatches} 批，道具: ${currentBatchProps.join(', ')}`);

    // 提取当前批次的道具详情，传入起始 id 确保全局唯一
    const startId = currentBatchStart;
    const batchResult = await extractBatchProps(content, currentBatchProps, startId);
    
    const hasMore = currentBatch < totalBatches;

    return NextResponse.json({
      success: true,
      type: 'props',
      data: {
        totalProps: allPropMarkers.length,
        props: batchResult.props,
      },
      batchInfo: {
        currentBatch: currentBatch,
        totalBatches,
        hasMore,
        propMarkers: allPropMarkers,
      },
      tokenUsage: batchResult.tokenUsage,
    });
  } catch (error: any) {
    console.error('道具提取失败:', error);
    console.error('错误详情:', error?.message);
    return NextResponse.json(
      { error: '道具提取失败', details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * 识别所有道具名称
 */
async function identifyPropMarkers( content: string, fileName: string): Promise<string[]> {
  const taggedProps = extractTaggedNames(content, '道具');
  if (taggedProps.length > 0) {
    console.log(`从剧本结构识别到 ${taggedProps.length} 个道具:`, taggedProps);
    return taggedProps.slice(0, 30);
  }

  const systemPrompt = `你是一个专业的影视道具设计师。请分析文本，识别所有独特的道具名称。

**重要规则**：
1. 只返回道具名称数组，不要返回其他内容
2. 道具名称应该简洁明确（如：宝剑、玉佩、马车等）
3. 合并相同道具的不同称呼
4. 按重要性或出场顺序排列
5. 最多识别30个主要道具

输出JSON数组格式：
["道具1", "道具2", "道具3"]`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请识别以下文本中的所有道具名称：\n\n文件名：${fileName}\n\n内容：\n${content.substring(0, 50000)}` }
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
    console.warn('道具名称模型识别失败，使用本地兜底:', error?.message || error);
    return extractTaggedNames(content, '道具').slice(0, 30);
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
      console.log('道具名称数组解析失败:', e);
      // 解析失败，继续尝试其他方法
    }
  }

  // 解析道具名称数组
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

function extractTaggedNames(content: string, tagName: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addSegment = (segment: string) => {
    const cleanedSegment = segment
      .replace(/。.*$/g, '')
      .replace(/；.*$/g, '')
      .replace(/，?时间[:：].*$/g, '');

    for (const rawName of cleanedSegment.split(/[、,，;；\s]+/)) {
      const name = rawName
        .replace(/（.*?）/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/[:：].*$/g, '')
        .trim();

      if (name && name.length <= 20 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  };

  const patterns = [
    new RegExp(`【${tagName}】([^【\\n\\r]+)`, 'g'),
    new RegExp(`${tagName}[:：]([^。\\n\\r]+)`, 'g'),
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      addSegment(match[1]);
    }
  }

  if (names.length === 0 && tagName === '道具') {
    const commonProps = [
      '探照灯', '铁锤', '沙发', '公文包', '检测仪', '喷雾', '黄色胶带', '本子', '纸笔',
      '保安亭', '劳斯莱斯', '安保系统', '话筒', '手机', '直播摄像头', '文件', '合同',
      '转账记录', '车钥匙', '横幅', '舞狮', '锣鼓', '鞭炮', '冰箱', '空调', '资质证书',
      '饭盒', '项链', '婚纱', '钥匙', '证书', '摄像头', '车辆', '锤子',
    ];
    for (const prop of commonProps) {
      if (content.includes(prop) && !seen.has(prop)) {
        seen.add(prop);
        names.push(prop);
      }
    }
  }

  return names;
}

/**
 * 提取一批道具的详细信息
 */
async function extractBatchProps(
  
  content: string,
  propNames: string[],
  startId: number = 0  // 全局起始 id，确保不同批次的道具 id 不重复
): Promise<{ props: any[]; tokenUsage: any }> {
  const systemPrompt = `你是专业的影视道具设计师。为指定的道具生成详细信息。

**重要规则**：
1. 必须为每个道具生成完整的描述信息，不要遗漏任何字段
2. description 字段必须详细描述道具的外观特点、材质、颜色、尺寸等（至少30字）
3. 如果文本中没有详细描述，请根据道具名称和剧情推断合理的描述
4. function 字段必须描述道具在剧情中的作用或功能
5. visualDescription 必须描述道具的视觉外观特点
6. appearanceScenes 必须列出道具出现的场景

每个道具包含：
- id: 序号
- name: 道具名称（必须与输入的道具名称完全一致）
- type: 人物道具/场景道具/特效道具/服装配饰（必须填写）
- importance: 关键道具/重要道具/普通道具/背景道具（必须填写）
- description: 道具详细描述（必须填写，描述外观、材质、颜色、特点等，30-80字）
- appearanceScenes: 出现场景数组（必须填写，列出道具出现的场景）
- owner: 道具归属人物（如果是人物道具必须填写）
- function: 道具功能/作用（必须填写，描述在剧情中的作用）
- visualDescription: 视觉外观描述（详细描述外观特点）
- notes: 特殊备注（如需要特效、定制等）

输出JSON格式：
{
  "props": [
    {
      "id": 1,
      "name": "道具名称",
      "type": "人物道具",
      "importance": "关键道具",
      "description": "详细描述道具的外观特点、材质、颜色、尺寸等",
      "appearanceScenes": ["出现场景1", "出现场景2"],
      "owner": "归属人物",
      "function": "道具在剧情中的功能或作用",
      "visualDescription": "视觉外观描述",
      "notes": "特殊备注"
    }
  ]
}`;

  const propList = propNames.map((p, i) => `${i + 1}. ${p}`).join('\n');
  
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请为以下道具生成详细信息：\n${propList}\n\n参考文本：\n${content.substring(0, 30000)}` }
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
    console.warn('道具详情模型提取失败，使用默认道具详情:', error?.message || error);
  }

  const result = tryExtractAndFixJSON(response);
  const props: any[] = [];

  if (result && result.props && Array.isArray(result.props) && result.props.length > 0) {
    props.push(...result.props);
    console.log(`JSON 解析成功，提取到 ${props.length} 个道具`);
  } else if (Array.isArray(result) && result.length > 0) {
    props.push(...result);
    console.log(`JSON 解析为数组，提取到 ${props.length} 个道具`);
  } else {
    console.log(`JSON 解析失败或结果为空，将基于 propNames (${propNames.length} 个) 生成默认数据`);
  }

  // 确保所有道具都有完整的字段，生成有意义的默认值
  // 重要：使用 propNames 的顺序来分配 id，确保名称和 id 正确对应
  const completeProps = propNames.map((propName, idx) => {
    // 尝试从 LLM 返回的数据中找到匹配的道具
    const matchedProp = props.find(p => p.name === propName);
    const defaultDescription = `该道具"${propName}"的外观特点待补充。请根据剧本内容补充道具的材质、颜色、尺寸、特点等信息。`;
    
    // 使用 propNames 的索引来生成全局唯一的 id
    const globalId = startId + idx + 1;
    
    if (matchedProp) {
      // 判断 description 是否有效：存在、非空、且不是默认的待补充文本
      const hasValidDescription = matchedProp.description && 
        matchedProp.description.trim().length > 0 &&
        !matchedProp.description.includes('待补充') &&
        !matchedProp.description.includes('外观特点待补充');
      
      return {
        id: globalId,
        name: propName,
        type: matchedProp.type || '普通道具',
        importance: matchedProp.importance || '普通道具',
        description: hasValidDescription ? matchedProp.description : defaultDescription,
        appearanceScenes: matchedProp.appearanceScenes && matchedProp.appearanceScenes.length > 0 
          ? matchedProp.appearanceScenes 
          : ['待补充出现场景'],
        owner: matchedProp.owner || '待补充归属人物',
        function: matchedProp.function && matchedProp.function.length > 0 
          ? matchedProp.function 
          : '待补充道具功能',
        visualDescription: matchedProp.visualDescription && matchedProp.visualDescription.length > 0 
          ? matchedProp.visualDescription 
          : '待补充视觉外观描述',
        notes: matchedProp.notes || '',
      };
    } else {
      // 没有找到匹配的道具，生成默认数据
      return {
        id: globalId,
        name: propName,
        type: '普通道具',
        importance: '普通道具',
        description: defaultDescription,
        appearanceScenes: ['待补充出现场景'],
        owner: '待补充归属人物',
        function: '待补充道具功能',
        visualDescription: '待补充视觉外观描述',
        notes: '',
      };
    }
  });

  console.log(`extractBatchProps 完成: propNames=${propNames.length}, completeProps=${completeProps.length}`);

  return {
    props: completeProps.slice(0, propNames.length),
    tokenUsage: {
      input: estimateMessagesTokens(messages),
      output: estimateTokens(response),
      timestamp: Date.now(),
    },
  };
}

/**
 * 传统方式提取道具（无道具标记时使用）
 */
async function extractPropsTraditional(
  
  content: string,
  fileName: string
): Promise<any> {
  const systemPrompt = `你是一个专业的影视道具设计师。你的任务是：
1. 分析给定的文本内容，提取所有需要的道具
2. 每个道具需要包含：名称、类型、描述、重要程度、出现场景
3. 识别道具的属性（人物道具/场景道具/特效道具）
4. 分析道具对剧情的作用

请以 JSON 格式返回结果，格式如下：
{
  "totalProps": 道具总数,
  "props": [
    {
      "id": 1,
      "name": "道具名称",
      "type": "人物道具/场景道具/特效道具/服装配饰",
      "importance": "关键道具/重要道具/普通道具/背景道具",
      "description": "道具详细描述",
      "appearanceScenes": ["出现场景1", "出现场景2"],
      "owner": "道具归属人物（如果是人物道具）",
      "function": "道具功能/作用",
      "visualDescription": "视觉外观描述",
      "notes": "特殊备注（如：需要特效、需要定制等）"
    }
  ],
  "propCategories": {
    "characterProps": ["人物道具列表"],
    "sceneProps": ["场景道具列表"],
    "fxProps": ["特效道具列表"],
    "costumes": ["服装配饰列表"]
  },
  "keyProps": ["推动剧情的关键道具"],
  "customProps": ["需要特别定制的道具"]
}

**重要提示**：
1. 必须返回完整且有效的 JSON 格式
2. 字符串中的引号需要转义为 \\"
3. 不要在 JSON 中添加注释
4. 确保所有数组和对象都正确闭合`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `请分析以下文本并提取所有道具：\n\n文件名：${fileName}\n\n内容：\n${content}` }
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
    console.warn('传统道具模型提取失败，使用本地兜底:', error?.message || error);
    const localProps = extractTaggedNames(content, '道具').slice(0, 30);
    const fallback = await extractBatchProps(content, localProps, 0);
    return {
      totalProps: fallback.props.length,
      props: fallback.props,
      tokenUsage: fallback.tokenUsage,
    };
  }

  const outputTokens = estimateTokens(fullResponse);
  
  console.log(`LLM 响应长度: ${fullResponse.length} 字符`);

  const result = tryExtractAndFixJSON(fullResponse);
  
  if (result) {
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
      totalProps: 0,
      props: [],
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        timestamp: Date.now(),
      },
    };
  }
}
