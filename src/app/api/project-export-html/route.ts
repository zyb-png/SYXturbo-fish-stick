import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ProjectState {
  currentStep: number;
  uploadedFileName: string | null;
  fileContent: string;
  scenesData: any;
  charactersData: any;
  propsData: any;
  outline: any;
  selectedChapter: any;
  storyboard: any;
  imageStoryboards: any[];
  connectingPrompts: any;
  videoResults: any[];
  videoTotalDuration: number;
  progress: number;
  videoRatio: string;
  assetImagesObj: Record<string, any>;
  stepConfirmed: Record<string, boolean>;
  extractionStatus: Record<string, string>;
}

// 生成独立的HTML查看器
function generateProjectHTML(projectName: string, state: ProjectState): string {
  const title = state.outline?.title || projectName;
  const summary = state.outline?.summary || '';
  const chapters = state.outline?.chapters || [];
  const scenes = state.scenesData?.scenes || [];
  const characters = state.charactersData?.characters || [];
  const props = state.propsData?.props || [];
  const storyboard = state.storyboard || null;
  const imageStoryboards = state.imageStoryboards || [];
  const videoResults = state.videoResults || [];
  const assetImages = state.assetImagesObj || {};

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - AI故事分镜项目</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');
    body { font-family: 'Noto Sans SC', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .card-shadow { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .video-container { aspect-ratio: 16/9; background: #1a1a1a; border-radius: 8px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <header class="gradient-bg text-white py-8 px-4">
    <div class="max-w-6xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold mb-2">${title}</h1>
          <p class="text-white/80">${summary || 'AI故事分镜视频生成器项目'}</p>
        </div>
        <div class="text-right text-sm text-white/70">
          <p>导出时间: ${new Date().toLocaleString('zh-CN')}</p>
          <p>项目版本: 1.0.0</p>
        </div>
      </div>
    </div>
  </header>

  <!-- Navigation -->
  <nav class="bg-white shadow-sm sticky top-0 z-50 no-print">
    <div class="max-w-6xl mx-auto px-4">
      <div class="flex space-x-1 overflow-x-auto py-2">
        <button onclick="showTab('overview')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-purple-100 text-purple-700" data-tab="overview">项目概览</button>
        <button onclick="showTab('scenes')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="scenes">场景 (${scenes.length})</button>
        <button onclick="showTab('characters')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="characters">人物 (${characters.length})</button>
        <button onclick="showTab('props')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="props">道具 (${props.length})</button>
        <button onclick="showTab('storyboard')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="storyboard">分镜脚本</button>
        <button onclick="showTab('images')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="images">分镜图片</button>
        <button onclick="showTab('videos')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-gray-100" data-tab="videos">视频</button>
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- Overview Tab -->
    <section id="tab-overview" class="tab-content">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white rounded-xl p-6 card-shadow">
          <div class="text-3xl font-bold text-purple-600">${scenes.length}</div>
          <div class="text-gray-600">场景</div>
        </div>
        <div class="bg-white rounded-xl p-6 card-shadow">
          <div class="text-3xl font-bold text-blue-600">${characters.length}</div>
          <div class="text-gray-600">人物</div>
        </div>
        <div class="bg-white rounded-xl p-6 card-shadow">
          <div class="text-3xl font-bold text-green-600">${props.length}</div>
          <div class="text-gray-600">道具</div>
        </div>
      </div>

      ${chapters.length > 0 ? `
      <div class="bg-white rounded-xl p-6 card-shadow mb-6">
        <h2 class="text-xl font-bold mb-4">章节目录</h2>
        <div class="space-y-3">
          ${chapters.map((ch: any) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <div class="font-medium">第${ch.chapterNumber}章: ${ch.title}</div>
              <div class="text-sm text-gray-600 mt-1">${ch.summary}</div>
              <div class="text-xs text-gray-400 mt-2">人物: ${ch.characters?.join(', ') || '无'} | 场景: ${ch.scenes?.join(', ') || '无'}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${storyboard ? `
      <div class="bg-white rounded-xl p-6 card-shadow">
        <h2 class="text-xl font-bold mb-4">分镜概览</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div class="p-4 bg-purple-50 rounded-lg">
            <div class="text-2xl font-bold text-purple-600">${storyboard.totalShots || storyboard.shots?.length || 0}</div>
            <div class="text-sm text-gray-600">分镜数量</div>
          </div>
          <div class="p-4 bg-blue-50 rounded-lg">
            <div class="text-2xl font-bold text-blue-600">${storyboard.wordCount || 0}</div>
            <div class="text-sm text-gray-600">字数</div>
          </div>
          <div class="p-4 bg-green-50 rounded-lg">
            <div class="text-2xl font-bold text-green-600">${imageStoryboards.length}</div>
            <div class="text-sm text-gray-600">图片</div>
          </div>
          <div class="p-4 bg-red-50 rounded-lg">
            <div class="text-2xl font-bold text-red-600">${videoResults.length}</div>
            <div class="text-sm text-gray-600">视频</div>
          </div>
        </div>
      </div>
      ` : ''}
    </section>

    <!-- Scenes Tab -->
    <section id="tab-scenes" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${scenes.map((scene: any) => `
          <div class="bg-white rounded-xl p-6 card-shadow">
            <div class="flex justify-between items-start mb-3">
              <h3 class="font-bold text-lg">${scene.name}</h3>
              <span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">${scene.type || '场景'}</span>
            </div>
            <p class="text-gray-600 text-sm mb-3">${scene.description}</p>
            <div class="flex flex-wrap gap-2 text-xs">
              ${scene.timeOfDay ? `<span class="px-2 py-1 bg-gray-100 rounded">时间: ${scene.timeOfDay}</span>` : ''}
              ${scene.atmosphere ? `<span class="px-2 py-1 bg-gray-100 rounded">氛围: ${scene.atmosphere}</span>` : ''}
              ${scene.importance ? `<span class="px-2 py-1 bg-gray-100 rounded">重要度: ${scene.importance}</span>` : ''}
            </div>
            ${scene.visualElements?.length ? `
              <div class="mt-3 text-xs text-gray-500">
                <strong>视觉元素:</strong> ${scene.visualElements.join('、')}
              </div>
            ` : ''}
          </div>
        `).join('') || '<p class="text-gray-500">暂无场景数据</p>'}
      </div>
    </section>

    <!-- Characters Tab -->
    <section id="tab-characters" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${characters.map((char: any) => `
          <div class="bg-white rounded-xl p-6 card-shadow">
            <div class="flex justify-between items-start mb-3">
              <h3 class="font-bold text-lg">${char.name}</h3>
              <span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">${char.role || '角色'}</span>
            </div>
            <div class="space-y-2 text-sm">
              ${char.age ? `<p><span class="text-gray-500">年龄:</span> ${char.age}</p>` : ''}
              ${char.gender ? `<p><span class="text-gray-500">性别:</span> ${char.gender}</p>` : ''}
              ${char.appearance ? `<p><span class="text-gray-500">外貌:</span> ${char.appearance}</p>` : ''}
              ${char.personality?.length ? `<p><span class="text-gray-500">性格:</span> ${char.personality.join('、')}</p>` : ''}
              ${char.background ? `<p><span class="text-gray-500">背景:</span> ${char.background}</p>` : ''}
              ${char.costume?.length ? `<p><span class="text-gray-500">服装:</span> ${char.costume.join('、')}</p>` : ''}
            </div>
            ${char.keyRelationships?.length ? `
              <div class="mt-3 pt-3 border-t">
                <p class="text-xs text-gray-500 font-medium mb-2">关键关系:</p>
                <div class="space-y-1">
                  ${char.keyRelationships.map((rel: any) => `
                    <p class="text-xs text-gray-600">${rel.target}: ${rel.relationship}</p>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('') || '<p class="text-gray-500">暂无人物数据</p>'}
      </div>
    </section>

    <!-- Props Tab -->
    <section id="tab-props" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${props.map((prop: any) => `
          <div class="bg-white rounded-xl p-4 card-shadow">
            <div class="flex justify-between items-start mb-2">
              <h3 class="font-bold">${prop.name}</h3>
              <span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">${prop.type || '道具'}</span>
            </div>
            <p class="text-gray-600 text-sm mb-2">${prop.description || prop.visualDescription}</p>
            <div class="flex flex-wrap gap-1 text-xs">
              ${prop.importance ? `<span class="px-1.5 py-0.5 bg-gray-100 rounded">${prop.importance}</span>` : ''}
              ${prop.owner ? `<span class="px-1.5 py-0.5 bg-gray-100 rounded">归属: ${prop.owner}</span>` : ''}
            </div>
          </div>
        `).join('') || '<p class="text-gray-500">暂无道具数据</p>'}
      </div>
    </section>

    <!-- Storyboard Tab -->
    <section id="tab-storyboard" class="tab-content hidden">
      ${storyboard?.shots?.length ? `
        <div class="space-y-4">
          ${storyboard.shots.map((shot: any, index: number) => `
            <div class="bg-white rounded-xl p-6 card-shadow">
              <div class="flex items-center gap-3 mb-3">
                <span class="flex items-center justify-center w-8 h-8 bg-purple-100 text-purple-700 rounded-full font-bold text-sm">${shot.shotNumber}</span>
                <span class="px-2 py-1 bg-gray-100 rounded text-sm">${shot.shotType}</span>
                <span class="text-sm text-gray-500">${shot.duration || ''}</span>
                ${shot.emotionalBeat ? `<span class="px-2 py-1 bg-pink-100 text-pink-700 rounded text-xs">${shot.emotionalBeat}</span>` : ''}
              </div>
              <p class="text-gray-700 mb-4">${shot.description}</p>
              ${shot.characters?.length ? `
                <div class="mb-4">
                  <p class="text-xs font-medium text-gray-500 mb-2">人物表演:</p>
                  <div class="space-y-2">
                    ${shot.characters.map((char: any) => `
                      <div class="p-3 bg-gray-50 rounded-lg">
                        <div class="font-medium text-sm">${char.name}</div>
                        ${char.dialogue ? `<div class="text-sm text-purple-600 mt-1">"${char.dialogue}"</div>` : ''}
                        ${char.performance || char.action ? `<div class="text-xs text-gray-600 mt-1">表演: ${char.performance || char.action}</div>` : ''}
                        ${char.reaction ? `<div class="text-xs text-gray-500 mt-1">反应: ${char.reaction}</div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${shot.scene ? `
                <div class="text-xs text-gray-500 flex flex-wrap gap-2">
                  <span>📍 ${shot.scene.location || ''}</span>
                  ${shot.scene.time ? `<span>🕐 ${shot.scene.time}</span>` : ''}
                  ${shot.scene.atmosphere ? `<span>🎨 ${shot.scene.atmosphere}</span>` : ''}
                  ${shot.scene.props?.length ? `<span>📦 ${shot.scene.props.join(', ')}</span>` : ''}
                </div>
              ` : ''}
              ${shot.notes ? `<p class="text-xs text-gray-400 mt-2 italic">${shot.notes}</p>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-gray-500">暂无分镜数据</p>'}
    </section>

    <!-- Images Tab -->
    <section id="tab-images" class="tab-content hidden">
      ${imageStoryboards.length > 0 ? `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${imageStoryboards.map((img: any) => `
            <div class="bg-white rounded-xl overflow-hidden card-shadow">
              <div class="aspect-video bg-gray-100">
                ${img.imageUrl ? `
                  <img src="${img.imageUrl}" alt="分镜${img.shotNumber}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-gray-400\\'>图片加载失败</div>'">
                ` : `
                  <div class="flex items-center justify-center h-full text-gray-400">
                    <span>暂无图片</span>
                  </div>
                `}
              </div>
              <div class="p-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">镜头 ${img.shotNumber}</span>
                </div>
                ${img.prompt ? `<p class="text-xs text-gray-500 line-clamp-2">${img.prompt.substring(0, 100)}...</p>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-gray-500">暂无分镜图片</p>'}
    </section>

    <!-- Videos Tab -->
    <section id="tab-videos" class="tab-content hidden">
      ${videoResults.length > 0 ? `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          ${videoResults.map((video: any) => `
            <div class="bg-white rounded-xl overflow-hidden card-shadow">
              <div class="video-container">
                ${video.videoUrl ? `
                  <video src="${video.videoUrl}" controls class="w-full h-full rounded-t-lg" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-gray-400\\'>视频加载失败</div>'"></video>
                ` : `
                  <div class="flex items-center justify-center h-full text-gray-400">
                    <span>暂无视频</span>
                  </div>
                `}
              </div>
              <div class="p-4">
                <div class="flex items-center justify-between">
                  <span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">镜头 ${video.shotNumber}</span>
                  <span class="text-sm text-gray-500">${video.duration}秒</span>
                </div>
                ${video.videoUrl ? `
                  <a href="${video.videoUrl}" download class="mt-3 block text-center py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors">
                    下载视频
                  </a>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-gray-500">暂无视频数据</p>'}
    </section>
  </main>

  <!-- Footer -->
  <footer class="bg-gray-800 text-white py-8 px-4 mt-12">
    <div class="max-w-6xl mx-auto text-center">
      <p class="text-gray-400">AI 故事分镜视频生成器 | 项目文件</p>
      <p class="text-sm text-gray-500 mt-2">此文件为离线查看器，无需网络连接</p>
    </div>
  </footer>

  <script>
    // Tab switching
    function showTab(tabName) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
      });
      
      // Show selected tab
      document.getElementById('tab-' + tabName).classList.remove('hidden');
      
      // Update button styles
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-purple-100', 'text-purple-700');
        btn.classList.add('hover:bg-gray-100');
      });
      
      const activeBtn = document.querySelector('.tab-btn[data-tab="' + tabName + '"]');
      if (activeBtn) {
        activeBtn.classList.add('bg-purple-100', 'text-purple-700');
        activeBtn.classList.remove('hover:bg-gray-100');
      }
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      showTab('overview');
    });
  </script>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  try {
    const { state, projectName } = await request.json() as { state: ProjectState; projectName: string };

    if (!state) {
      return NextResponse.json({
        success: false,
        error: '缺少项目状态数据',
      }, { status: 400 });
    }

    // 生成HTML
    const htmlContent = generateProjectHTML(projectName || 'storyboard-project', state);

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${projectName || 'storyboard-project'}_${timestamp}.html`;

    // 返回HTML文件
    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error('导出HTML失败:', error);
    return NextResponse.json({
      success: false,
      error: '导出HTML失败',
      details: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}
