import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireUserLoginResponse } from '@/lib/auth-guard';
import {
  getExecutionScriptLineStyle,
  normalizeExecutionScriptText,
  type ExecutionScriptLineStyle,
} from '@/lib/execution-script-format';

export const runtime = 'nodejs';

type ExportExecutionScriptPayload = {
  storyTitle?: string;
  sourceFileName?: string;
  executionScript?: string;
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
    .slice(0, 80) || '执行剧本';
}

type DocxParagraphStyle = 'Title' | 'Subtitle' | 'Meta' | 'Body' | ExecutionScriptLineStyle;

function paragraph(text = '', style?: DocxParagraphStyle): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const lines = String(text).split(/\r?\n/);
  const runs = lines.map((line, index) => {
    const breakXml = index === 0 ? '' : '<w:br/>';
    return `<w:r>${breakXml}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
  }).join('');

  return `<w:p>${styleXml}${runs}</w:p>`;
}

function buildDocumentXml(payload: Required<Pick<ExportExecutionScriptPayload, 'executionScript'>> & ExportExecutionScriptPayload): string {
  const title = cleanText(payload.storyTitle || payload.sourceFileName, '执行剧本');
  const executionScript = normalizeExecutionScriptText(payload.executionScript);
  const parts: string[] = [];

  parts.push(paragraph('执行剧本', 'Title'));
  parts.push(paragraph(title, 'Subtitle'));
  if (payload.sourceFileName) parts.push(paragraph(`源文件：${payload.sourceFileName}`, 'Meta'));
  parts.push(paragraph(`导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`, 'Meta'));
  parts.push(...executionScript.split('\n').map(line => (
    line.trim()
      ? paragraph(line, getExecutionScriptLineStyle(line))
      : paragraph('', 'Body')
  )));

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
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="36"/><w:color w:val="D6A93A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="180"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="24"/><w:color w:val="374151"/></w:rPr>
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
  <w:style w:type="paragraph" w:styleId="Episode">
    <w:name w:val="Episode"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="160"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/><w:color w:val="9A6A00"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SceneHeading">
    <w:name w:val="SceneHeading"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="180" w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="23"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Cast">
    <w:name w:val="Cast"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:b/><w:sz w:val="21"/><w:color w:val="374151"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Action">
    <w:name w:val="Action"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="21"/><w:color w:val="1F2937"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Dialogue">
    <w:name w:val="Dialogue"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="110" w:line="320" w:lineRule="auto"/><w:ind w:left="360"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="21"/><w:color w:val="000000"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Note">
    <w:name w:val="Note"/>
    <w:basedOn w:val="Body"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="100"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:i/><w:sz w:val="20"/><w:color w:val="6B7280"/></w:rPr>
  </w:style>
</w:styles>`;

function createDocx(payload: Required<Pick<ExportExecutionScriptPayload, 'executionScript'>> & ExportExecutionScriptPayload): Buffer {
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
  <dc:title>${escapeXml(cleanText(payload.storyTitle || payload.sourceFileName, '执行剧本'))}</dc:title>
  <dc:creator>MM钰汐</dc:creator>
  <cp:lastModifiedBy>MM钰汐</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`));
  zip.addFile('docProps/app.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>MM钰汐</Application>
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
    const payload = await request.json() as ExportExecutionScriptPayload;
    const executionScript = normalizeExecutionScriptText(cleanText(payload.executionScript));
    if (!executionScript) {
      return NextResponse.json({
        success: false,
        error: '暂无可导出的执行剧本',
      }, { status: 400 });
    }

    const title = cleanFilename(cleanText(payload.storyTitle || payload.sourceFileName, '执行剧本'));
    const filename = `${title}_执行剧本.docx`;
    const docx = createDocx({ ...payload, executionScript });

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
    console.error('导出执行剧本 Word 失败:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || '导出执行剧本 Word 失败',
    }, { status: 500 });
  }
}
