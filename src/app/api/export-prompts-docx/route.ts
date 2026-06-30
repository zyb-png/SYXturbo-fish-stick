import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';

export const runtime = 'nodejs';

type VideoPromptItem = {
  shotNumber?: number;
  duration?: number;
  videoPrompt?: string;
  panelDescription?: string;
  performance?: string;
};

type PromptGroup = {
  groupIndex?: number;
  shotNumbers?: number[];
  combinedPrompt?: string;
  storyboardPromptText?: string;
};

type ExportPayload = {
  storyTitle?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  imageSettings?: {
    ratios?: string[];
    styles?: string[];
    lighting?: string[];
  };
  videoPrompts?: VideoPromptItem[];
  promptGroups?: PromptGroup[];
  saveToDownloads?: boolean;
};

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function joinList(values?: string[]): string {
  return Array.isArray(values) && values.length > 0 ? values.join('、') : '未设置';
}

function paragraph(text = '', style?: 'Title' | 'Subtitle' | 'Heading1' | 'Heading2' | 'Meta' | 'Body'): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const lines = String(text).split(/\r?\n/);
  const runXml = lines.map((line, index) => {
    const breakXml = index === 0 ? '' : '<w:br/>';
    return `${breakXml}${escapeXml(line)}`;
  }).join('');

  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${runXml}</w:t></w:r></w:p>`;
}

function buildDocumentXml(payload: ExportPayload): string {
  const chapterNumber = payload.chapterNumber ?? 1;
  const chapterTitle = cleanText(payload.chapterTitle, '未命名章节');
  const storyTitle = cleanText(payload.storyTitle, '');
  const videoPrompts = Array.isArray(payload.videoPrompts) ? payload.videoPrompts : [];
  const promptGroups = Array.isArray(payload.promptGroups) ? payload.promptGroups : [];
  const parts: string[] = [];

  parts.push(paragraph(`第${chapterNumber}集提示词`, 'Title'));
  if (chapterTitle) parts.push(paragraph(chapterTitle, 'Subtitle'));
  if (storyTitle) parts.push(paragraph(`项目：${storyTitle}`, 'Meta'));
  parts.push(paragraph(`导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`, 'Meta'));
  parts.push(paragraph(`画面比例：${joinList(payload.imageSettings?.ratios)}`, 'Meta'));
  parts.push(paragraph(`画面风格：${joinList(payload.imageSettings?.styles)}`, 'Meta'));
  parts.push(paragraph(`光影效果：${joinList(payload.imageSettings?.lighting)}`, 'Meta'));

  parts.push(paragraph('单镜头故事版面板描述', 'Heading1'));
  if (videoPrompts.length === 0) {
    parts.push(paragraph('暂无单镜头提示词。', 'Body'));
  } else {
    videoPrompts
      .slice()
      .sort((a, b) => (a.shotNumber ?? 0) - (b.shotNumber ?? 0))
      .forEach((item) => {
        const shotNumber = item.shotNumber ?? '-';
        const durationText = typeof item.duration === 'number' ? `｜时长：${item.duration}秒` : '';
        parts.push(paragraph(`镜头 ${shotNumber}${durationText}`, 'Heading2'));
        parts.push(paragraph(cleanText(item.videoPrompt || item.panelDescription, '无提示词内容'), 'Body'));
        if (cleanText(item.performance)) {
          parts.push(paragraph(`表演提示：${cleanText(item.performance)}`, 'Body'));
        }
      });
  }

  parts.push(paragraph('分组连贯故事版面板描述', 'Heading1'));
  if (promptGroups.length === 0) {
    parts.push(paragraph('暂无分组提示词。', 'Body'));
  } else {
    promptGroups
      .slice()
      .sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0))
      .forEach((group) => {
        const shots = Array.isArray(group.shotNumbers) ? group.shotNumbers.join('、') : '-';
        parts.push(paragraph(`第${group.groupIndex ?? '-'}组｜镜头 ${shots}`, 'Heading2'));
        parts.push(paragraph(cleanText(group.combinedPrompt, '无连贯提示词内容'), 'Body'));
        if (cleanText(group.storyboardPromptText)) {
          parts.push(paragraph('故事板专用提示词', 'Heading2'));
          parts.push(paragraph(cleanText(group.storyboardPromptText), 'Body'));
        }
      });
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14">
  <w:body>
    ${parts.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="36"/><w:color w:val="4C1D95"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="180"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="24"/><w:color w:val="374151"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="360" w:after="180"/><w:keepNext/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="220" w:after="100"/><w:keepNext/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="23"/><w:color w:val="4338CA"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Meta">
    <w:name w:val="Meta"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="70"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="19"/><w:color w:val="6B7280"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Body">
    <w:name w:val="Body"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="160" w:line="330" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="21"/></w:rPr>
  </w:style>
</w:styles>`;

function createDocx(payload: ExportPayload): Buffer {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`));
  zip.addFile('word/document.xml', Buffer.from(buildDocumentXml(payload)));
  zip.addFile('word/styles.xml', Buffer.from(stylesXml));
  zip.addFile('docProps/core.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(`第${payload.chapterNumber ?? 1}集提示词`)}</dc:title>
  <dc:creator>AI 故事分镜视频生成器</dc:creator>
  <cp:lastModifiedBy>AI 故事分镜视频生成器</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`));
  zip.addFile('docProps/app.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AI 故事分镜视频生成器</Application>
</Properties>`));

  return zip.toBuffer();
}

function getUniqueFilePath(directory: string, filename: string): { filePath: string; filename: string } {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let index = 1;

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${base}_${index}${ext}`;
    index += 1;
  }

  return {
    filePath: path.join(directory, candidate),
    filename: candidate,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireUserLoginResponse();
  if (auth.response) return auth.response;

  try {
    const payload = await request.json() as ExportPayload;
    const chapterNumber = payload.chapterNumber ?? 1;
    const chapterTitle = cleanFilename(cleanText(payload.chapterTitle, '未命名章节'));
    const filename = `第${chapterNumber}集_${chapterTitle}_提示词.docx`;
    const docx = createDocx(payload);

    if (payload.saveToDownloads) {
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      fs.mkdirSync(downloadsDir, { recursive: true });
      const { filePath, filename: savedFilename } = getUniqueFilePath(downloadsDir, filename);
      fs.writeFileSync(filePath, docx);

      return NextResponse.json({
        success: true,
        filename: savedFilename,
        filePath,
        bytes: docx.length,
      });
    }

    const body = new Uint8Array(docx).buffer;

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(docx.length),
      },
    });
  } catch (error: any) {
    console.error('导出提示词 Word 失败:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || '导出提示词 Word 失败',
    }, { status: 500 });
  }
}
