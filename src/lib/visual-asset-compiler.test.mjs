import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileVisualAssetPrompt,
  sanitizePropImagePromptText,
  VisualAssetValidationError,
} from './visual-asset-compiler.ts';

test('prop prompt sanitizer keeps appearance and removes people, actions, and story metadata', () => {
  const prompt = sanitizePropImagePromptText([
    '当前状态视觉：银灰色短刀，黑色皮革缠绕刀柄，刀刃有细小缺口',
    '归属人物：沈屹',
    '状态形成背景：李萍手持短刀抵住沈屹脖颈',
    '剧情识别重点：推动冲突并成为证据',
    '原文依据：第1集仓库冲突',
  ].join('；'));

  assert.match(prompt, /银灰色短刀/);
  assert.match(prompt, /黑色皮革缠绕刀柄/);
  assert.match(prompt, /刀刃有细小缺口/);
  assert.doesNotMatch(prompt, /沈屹|李萍|手持|脖颈|剧情|第1集/);
});

test('compiled prop prompt never carries relationship or narrative fields into image generation', () => {
  const result = compileVisualAssetPrompt({
    type: 'prop',
    rawPrompt: [
      '道具名称：短刀',
      '当前状态视觉：银灰色刀刃，黑色皮革刀柄，刀锋有缺口',
      '归属人物：沈屹',
      '人物关系：李萍用它威胁沈屹',
      '剧情作用：推动仓库冲突并成为证据',
    ].join('；'),
    data: { name: '短刀' },
    hasReferenceImage: false,
  });

  assert.equal(result.assetType, 'prop');
  assert.match(result.prompt, /银灰色刀刃/);
  assert.match(result.prompt, /无人物、无人脸、无手、无身体部位/);
  assert.doesNotMatch(result.prompt, /沈屹|李萍|威胁|推动仓库冲突|成为证据/);
  assert.ok(result.checks.some(check => check.code === 'prop-visual-only'));
});

test('compiled prop prompt strips the exact owner from legacy names and reference labels', () => {
  const result = compileVisualAssetPrompt({
    type: 'prop',
    rawPrompt: [
      '道具名称：沈屹的短刀',
      '同一道具身份：沈屹的短刀',
      '当前状态视觉：银灰色刀刃，黑色皮革刀柄',
      '参考前一状态：沈屹的短刀',
    ].join('；'),
    data: { name: '沈屹的短刀', owner: '沈屹' },
    hasReferenceImage: false,
  });

  assert.match(result.prompt, /短刀/);
  assert.doesNotMatch(result.prompt, /沈屹/);
});

test('visible effect keeps the effect appearance but removes caster actions', () => {
  const result = compileVisualAssetPrompt({
    type: 'prop',
    rawPrompt: '特效名称：赤焰法阵；当前状态视觉：暗红色火焰呈环形扩散，金色符文围绕核心旋转；状态形成背景：施法者挥手攻击受术者',
    data: { name: '赤焰法阵' },
    hasReferenceImage: false,
    isVisibleEffect: true,
  });

  assert.equal(result.assetType, 'effect');
  assert.match(result.prompt, /暗红色火焰呈环形扩散/);
  assert.match(result.prompt, /金色符文围绕核心旋转/);
  assert.doesNotMatch(result.prompt, /状态形成背景|施法者挥手攻击受术者/);
  assert.match(result.prompt, /无施法者、无受术者/);
});

test('relationship-only prop prompt is rejected before spending creation points', () => {
  assert.throws(() => compileVisualAssetPrompt({
    type: 'prop',
    rawPrompt: '归属人物：沈屹；剧情作用：推动冲突；原文依据：第1集仓库',
    data: { name: '未知道具' },
    hasReferenceImage: false,
  }), VisualAssetValidationError);
});
