export type ExecutionScriptLineStyle = 'Episode' | 'SceneHeading' | 'Cast' | 'Action' | 'Dialogue' | 'Note' | 'Body';

function stripMarkdownLineMarkers(line: string): string {
  return line
    .replace(/^#{1,6}\s*/g, '')
    .replace(/^>\s*/g, '')
    .replace(/^\s*[-*+]\s+/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/[`*_#]/g, '')
    .trim();
}

function normalizeLine(line: string): string {
  return stripMarkdownLineMarkers(line)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/([【（\[])\s+/g, '$1')
    .replace(/\s+([】）\]])/g, '$1')
    .trim();
}

export function normalizeExecutionScriptText(text: string): string {
  const withoutFences = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/^```(?:markdown|md|text|txt)?\s*/i, '')
    .replace(/\s*```$/i, '');

  const normalizedLines = withoutFences
    .split('\n')
    .map(normalizeLine);

  const output: string[] = [];
  for (const line of normalizedLines) {
    const previous = output[output.length - 1];
    if (!line) {
      if (previous) output.push('');
      continue;
    }

    const style = getExecutionScriptLineStyle(line);
    if ((style === 'Episode' || style === 'SceneHeading') && previous) {
      output.push('');
    }
    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function getExecutionScriptLineStyle(line: string): ExecutionScriptLineStyle {
  const text = line.trim();
  if (!text) return 'Body';
  if (/^第[一二三四五六七八九十百千万\d]+[集章幕]/.test(text)) return 'Episode';
  if (/^(本集)?出场人物[:：]/.test(text)) return 'Cast';
  if (/^\d+[-—]\d+\s+.+(?:\[[^\]]+\]|【[^】]+】)/.test(text)) return 'SceneHeading';
  if (/^△/.test(text)) return 'Action';
  if (/^【(?:音效|字幕|转场|音乐|特效|画面|旁白)】/.test(text)) return 'Note';
  if (/^[\u4e00-\u9fa5A-Za-z0-9·（）()]{1,20}(?:\s*\((?:O\.S\.|V\.O\.)\))?[:：]/.test(text)) return 'Dialogue';
  return 'Body';
}
