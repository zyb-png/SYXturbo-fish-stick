export interface ExecutionScriptEpisodeBlock {
  index: number;
  number: number | null;
  heading: string;
  source: string;
}

export interface EpisodeOutputAssessment {
  complete: boolean;
  reasons: string[];
  sourceSceneCount: number;
  outputSceneCount: number;
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CHINESE_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1_000,
};

function cleanHeadingLine(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s*/g, '')
    .replace(/^\s*[-*+]\s*/g, '')
    .replace(/^\s*\d+\s*[.\u3001\uff0e]\s*/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

export function parseChineseEpisodeNumber(value: string): number | null {
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  let matched = false;

  for (const character of text) {
    if (character === '万') {
      section += digit;
      total += Math.max(1, section) * 10_000;
      section = 0;
      digit = 0;
      matched = true;
      continue;
    }

    if (character in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[character];
      matched = true;
      continue;
    }

    const unit = CHINESE_UNITS[character];
    if (unit) {
      section += (digit || 1) * unit;
      digit = 0;
      matched = true;
      continue;
    }

    return null;
  }

  const number = total + section + digit;
  return matched && number > 0 ? number : null;
}

export function parseExecutionEpisodeHeading(
  rawLine: string
): { number: number; heading: string } | null {
  const line = cleanHeadingLine(rawLine);
  if (!line || line.length > 120) return null;

  const patterns: RegExp[] = [
    /^\u7b2c\s*([\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\d]+)\s*[\u96c6\u7ae0\u5e55\u8bdd](?:\s*[:\uff1a\-\u2014]\s*.*|\s+.*)?$/,
    /^(?:Episode|EP\.?)\s*(\d+)(?:\s*[:\uff1a\-\u2014]\s*.*|\s+.*)?$/i,
    /^\[\s*(\d+)\s*](?:\s*[:\uff1a\-\u2014]\s*.*|\s+.*)?$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (!match) continue;
    const number = parseChineseEpisodeNumber(match[1]);
    if (number === null) continue;
    return { number, heading: line };
  }

  return null;
}

export function splitExecutionScriptEpisodes(content: string): ExecutionScriptEpisodeBlock[] {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const preamble: string[] = [];
  const blocks: Array<Omit<ExecutionScriptEpisodeBlock, 'index'>> = [];
  let currentIndex = -1;

  for (const line of lines) {
    const heading = parseExecutionEpisodeHeading(line);
    if (!heading) {
      if (currentIndex >= 0) {
        const current = blocks[currentIndex];
        current.source += `${current.source ? '\n' : ''}${line}`;
      } else {
        preamble.push(line);
      }
      continue;
    }

    const current = currentIndex >= 0 ? blocks[currentIndex] : undefined;
    if (current?.number === heading.number) {
      // Word 分页或页眉有时会重复当前集标题，不应把它误分成新一集。
      continue;
    }

    blocks.push({
      number: heading.number,
      heading: heading.heading,
      source: line,
    });
    currentIndex = blocks.length - 1;
  }

  const normalizedBlocks = blocks
    .map(block => ({ ...block, source: block.source.trim() }))
    .filter(block => block.source.length > 0);

  if (normalizedBlocks.length === 0) {
    const source = lines.join('\n').trim();
    return source ? [{ index: 0, number: null, heading: '', source }] : [];
  }

  const preambleText = preamble.join('\n').trim();
  if (preambleText) {
    normalizedBlocks[0].source = `${preambleText}\n\n${normalizedBlocks[0].source}`;
  }

  return normalizedBlocks.map((block, index) => ({ ...block, index }));
}

function countSceneHeadings(content: string): number {
  return content
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => /^\s*\d+\s*[-\u2014\u2013.]\s*\d+\b/.test(cleanHeadingLine(line)))
    .length;
}

export function assessEpisodeOutput(
  block: ExecutionScriptEpisodeBlock,
  output: string
): EpisodeOutputAssessment {
  const normalizedOutput = String(output || '').trim();
  const sourceSceneCount = countSceneHeadings(block.source);
  const outputSceneCount = countSceneHeadings(normalizedOutput);
  const sourceLength = block.source.replace(/\s/g, '').length;
  const outputLength = normalizedOutput.replace(/\s/g, '').length;
  const reasons: string[] = [];

  if (!normalizedOutput) reasons.push('模型未返回内容');
  if (sourceLength >= 400 && outputLength < 120) reasons.push('输出异常过短');

  if (sourceSceneCount >= 2) {
    const minimumSceneCount = Math.max(1, Math.ceil(sourceSceneCount * 0.6));
    if (outputSceneCount < minimumSceneCount) {
      reasons.push(`场景覆盖不完整（${outputSceneCount}/${sourceSceneCount}）`);
    }
  } else if (sourceSceneCount === 1 && outputSceneCount === 0) {
    reasons.push('缺少原文场景题头');
  }

  if (block.number !== null) {
    const outputEpisodeNumbers = normalizedOutput
      .split('\n')
      .map(parseExecutionEpisodeHeading)
      .filter((value): value is { number: number; heading: string } => value !== null)
      .map(value => value.number);
    if (!outputEpisodeNumbers.includes(block.number)) {
      reasons.push(`缺少第${block.number}集标题`);
    }
  }

  return {
    complete: reasons.length === 0,
    reasons,
    sourceSceneCount,
    outputSceneCount,
  };
}
