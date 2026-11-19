// 防剧透校轴流水线：generate / validate / backfill / qc / trace。
// 在 LinguaGacha 中由 workspace_run 导入；也可直接 node scripts/pipeline.mjs <命令> --参数 值。
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';

const readText = (file) => readFile(file, 'utf8');
const stem = (file) => basename(file).replace(/\.ass$/i, '');
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const bomOf = (text) => (text.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '');

// 占位稿骨架：单一中性样式 + 固定字段，所有可能含剧情的原文只进 work 目录。
const SAFE_STYLE_FORMAT = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';
const SAFE_STYLE_LINE = 'Style: AS1,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1';
const EVENT_FORMAT = 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
// Script Info 只重建这几个已知安全的键；值必须匹配严格格式，否则丢弃整行。
// 不能整行复制——ASS 的 "key: value" 里 value 是自由文本，可夹带剧透批注。
function safeScriptInfoLine(line) {
  const m = /^\s*(PlayResX|PlayResY|ScriptType|WrapStyle|ScaledBorderAndShadow|YCbCr Matrix|LayoutResX|LayoutResY|Timer)\s*:\s*(.*?)\s*$/i.exec(line);
  if (!m) return null;
  const key = m[1];
  const value = m[2];
  if ((/^PlayRes[XY]$/i.test(key)) && /^\d+$/.test(value)) return `${key}: ${value}`;
  if (/^ScriptType$/i.test(key) && /^v4\.00\+?$/i.test(value)) return 'ScriptType: v4.00+';
  if (/^WrapStyle$/i.test(key) && /^[0-3]$/.test(value)) return `WrapStyle: ${value}`;
  if (/^ScaledBorderAndShadow$/i.test(key) && /^(yes|no|true|false)$/i.test(value)) {
    return `ScaledBorderAndShadow: ${/^(yes|true)$/i.test(value) ? 'yes' : 'no'}`;
  }
  // 渲染相关、无剧透风险的安全字段：值限定为短 token/数字，杜绝尾随文本夹带。
  // YCbCr Matrix 只接受真实矩阵名（TV/PC.601/709/2020/240M/FCC），否则任意 ASCII 剧透词（如 BOSSISDEAD）会漏进占位稿。
  if (/^YCbCr Matrix$/i.test(key) && /^(TV|PC)\.(601|709|2020|240M|FCC)$/i.test(value)) return `YCbCr Matrix: ${value}`;
  if (/^LayoutRes[XY]$/i.test(key) && /^\d+$/.test(value)) return `${key}: ${value}`;
  if (/^Timer$/i.test(key) && /^[\d.]+$/.test(value)) return `Timer: ${value}`;
  return null; // 值不合规（含尾随文本/剧透）一律丢弃
}
const COMMENT_LINE = /^\s*(;|Comment:)/i;

// 读取状态文件并做最小 schema 校验：损坏时给出可定位的中文错误，而不是原始 TypeError。
async function loadMapping(work) {
  const m = await lib.readJson(join(work, 'mapping.json'));
  if (!m || !Array.isArray(m.order) || !m.entries || typeof m.entries !== 'object' || Array.isArray(m.entries)) {
    throw new Error('状态文件损坏：mapping.json 缺少 order/entries，请删除隐藏目录后重新 generate');
  }
  return m;
}
async function loadManifest(work) {
  const mf = await lib.readJson(join(work, 'manifest.json'));
  if (!mf || typeof mf.count !== 'number' || typeof mf.source !== 'string') {
    throw new Error('状态文件损坏：manifest.json 缺少 count/source，请删除隐藏目录后重新 generate');
  }
  return mf;
}

// 生成占位轴稿：白名单重建，绝不复制原 ASS 的任何文本段。
export async function generate({ source, work, out }) {
  const text = await readText(source);
  const { lines } = lib.splitAss(text);

  const check = lib.checkEventsFormat(lines);
  if (!check.ok) throw new Error(`ASS 格式不安全，拒绝生成占位稿：${check.reason}`);

  const entries = {};
  const order = [];
  let index0 = -1;
  let section = '';
  const safeScriptInfo = [];
  const originalStyles = [];
  let originalStyleFormat = '';
  const dialogueLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*\[/i.test(line)) { section = trimmed.toLowerCase(); continue; }
    if (COMMENT_LINE.test(line)) continue; // 所有段的注释一律清除（防批注剧透）

    if (section === '[events]') {
      if (/^\s*Format:/i.test(line)) continue;
      const d = lib.parseDialogue(line);
      if (!d) {
        // Dialogue 行解析失败（字段数不足等）绝不能静默丢弃，否则成片少行且无人察觉。
        if (/^\s*Dialogue:/i.test(line)) {
          throw new Error(`无法解析 Dialogue 行（字段数不足或格式异常）：${line.slice(0, 100)}`);
        }
        continue;
      }
      // 关键字段必须是数字；若 Actor 名含逗号会把字段挤错位，导致 Margin 变成文字（既错乱又可能夹带剧透）。
      if (!/^\d+$/.test(d.layer)) {
        throw new Error(`Dialogue 行 Layer 非数字，疑似字段错位（Actor 名可能含逗号）：${line.slice(0, 100)}`);
      }
      for (const k of ['marginL', 'marginR', 'marginV']) {
        if (!/^\d+$/.test(d[k])) {
          throw new Error(`Dialogue 行 ${k} 非数字，疑似字段错位（Actor 名可能含逗号）：${line.slice(0, 100)}`);
        }
      }
      // Start/End 必须是合法时间戳。parseTime 锚定 H:MM:SS.cc，通过即只含数字/冒号/点，
      // 杜绝 `Start=KILL` 这类文字被逐字复制进占位稿（也被 validate 静默放过的泄漏通道）。
      const startMs = lib.parseTime(d.start);
      const endMs = lib.parseTime(d.end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new Error(`Dialogue 行 Start/End 非法（必须为 H:MM:SS.cc，夹带非时间文本会被拒绝）：${line.slice(0, 100)}`);
      }

      index0++;
      const { tags: safeTags, visible } = lib.filterTags(d.text);
      const id = lib.makeId(index0, lib.stripTags(visible));
      const size = lib.sizeOf(visible);
      entries[id] = {
        id, index: index0, size,
        orig: {
          layer: d.layer, start: d.start, end: d.end, style: d.style, name: d.name,
          marginL: d.marginL, marginR: d.marginR, marginV: d.marginV, effect: d.effect,
          text: d.text
        },
        startMs: lib.parseTime(d.start), endMs: lib.parseTime(d.end),
        visible: lib.stripTags(d.text)
      };
      order.push(id);
      // 占位字段全脱敏：Style=AS1，Name/Effect 空，Margin 保留数字，Text 仅安全标签 + token + 填充
      dialogueLines.push(
        `Dialogue: ${d.layer},${d.start},${d.end},AS1,,${d.marginL},${d.marginR},${d.marginV},,${safeTags}${lib.tokenFor(id, size)}`
      );
      continue;
    }

    if (section === '[v4 styles]') {
      // SSA v4（18 字段样式）不在支持范围：fail-closed，避免用 23 字段 Format 输出 18 字段样式造成损坏。
      if (/^\s*(Style|Format):/i.test(line)) {
        throw new Error('不支持 SSA v4 的 [V4 Styles] 样式（仅支持 ASS v4.00+ 的 [V4+ Styles]），请在 Aegisub 中另存为 v4.00+ 后再试');
      }
      continue;
    }
    if (section === '[v4+ styles]') {
      if (/^\s*Format:/i.test(line)) { if (!originalStyleFormat) originalStyleFormat = line.trim(); }
      else if (/^\s*Style:/i.test(line)) originalStyles.push(line);
      continue;
    }
    if (section === '[script info]') {
      const rebuilt = safeScriptInfoLine(line);
      if (rebuilt) safeScriptInfo.push(rebuilt);
      continue;
    }
  }

  if (order.length === 0) throw new Error('未解析到任何 Dialogue 行，请检查 [Events] 与 Format/Dialogue');

  const outLines = [
    '[Script Info]',
    '; 校轴用占位稿：正文与样式信息已隐藏，仅保留时间轴与长度提示',
    ...safeScriptInfo,
    '',
    '[V4+ Styles]',
    SAFE_STYLE_FORMAT,
    SAFE_STYLE_LINE,
    '',
    '[Events]',
    EVENT_FORMAT,
    ...dialogueLines,
    ''
  ];

  const placeholder = out || join(dirname(source), `${stem(source)}.placeholder.ass`);
  await lib.atomicWriteText(placeholder, bomOf(text) + outLines.join(eolOf(text)));
  await lib.atomicWriteJson(join(work, 'manifest.json'), {
    version: 1, source, sourceHash: lib.sha256(text),
    createdAt: new Date().toISOString(), placeholder, workDir: work,
    count: order.length,
    lines: order.map((id) => ({ id, index: entries[id].index, size: entries[id].size }))
  });
  // 剧透全部集中在这个文件，绝不随占位稿交付。
  await lib.atomicWriteJson(join(work, 'mapping.json'), { version: 1, order, entries, originalStyles, originalStyleFormat });
  return { placeholder, work, count: order.length };
}

// 解析级白名单校验 + 来源哈希校验。
export async function validate({ returned, work }) {
  const manifest = await loadManifest(work);
  const mapping = await loadMapping(work);
  const { lines } = lib.splitAss(await readText(returned));
  const seen = new Set();
  const violations = [];
  const changes = [];
  let dialogueCount = 0;

  for (const line of lines) {
    const d = lib.parseDialogue(line);
    if (!d) continue;
    dialogueCount++;
    const { tags, visible } = lib.splitLeadingTags(d.text);
    const match = lib.tokenMatch(visible);
    if (!match) {
      violations.push({ type: 'missing_token', detail: d.text.slice(0, 80) });
      continue;
    }
    if (seen.has(match.id)) violations.push({ type: 'duplicate_id', id: match.id });
    seen.add(match.id);

    const entry = mapping.entries[match.id];
    if (!entry) { violations.push({ type: 'unknown_id', id: match.id }); continue; }

    // 填充段必须恰好是档位规定的块数（多一个少一个都算正文被改）。
    // 用 tokenMatch.index 精确切片；token 之前若有文字（leading 空格外的内容）判违规。
    const before = visible.slice(0, match.index);
    if (before.trim()) violations.push({ type: 'text_altered', id: match.id, detail: before.slice(0, 80) });
    const after = visible.slice(match.index + match.raw.length);
    const fillLen = (new RegExp(`^${lib.FILL_CHAR}*`).exec(after) || [''])[0].length;
    if (fillLen !== lib.FILL[entry.size]) {
      violations.push({ type: 'fill_altered', id: match.id,
        detail: `期望 ${lib.FILL[entry.size]} 个，实际 ${fillLen} 个` });
    }
    if (match.size !== entry.size) {
      violations.push({ type: 'token_altered', id: match.id, detail: `${match.size}→${entry.size}` });
    }
    const rest = after.slice(fillLen).trim();
    if (rest) violations.push({ type: 'text_altered', id: match.id, detail: rest.slice(0, 80) });

    // 回稿行首标签只能含白名单定位标签；出现任何非白名单内容（如 {\fn凶手}）都判违规。
    // 这类标签回填时会从原文恢复、不会进成片，但在 validate 阶段就应打回，避免静默改写。
    if (lib.filterTags(d.text).tags !== tags) {
      violations.push({ type: 'tag_illegal', id: match.id, detail: tags.slice(0, 80) });
    }

    const timeChanged = d.start !== entry.orig.start || d.end !== entry.orig.end;
    const tagsChanged = tags !== lib.filterTags(entry.orig.text).tags;
    const styleChanged = d.style !== 'AS1' || d.name !== '' || d.effect !== ''
      || ['marginL', 'marginR', 'marginV'].some((k) => d[k] !== entry.orig[k]);
    if (timeChanged || tagsChanged || styleChanged) {
      changes.push({ id: match.id, timeChanged, tagsChanged, styleChanged });
    }
  }

  if (dialogueCount !== manifest.count) {
    violations.push({ type: 'line_count', expected: manifest.count, actual: dialogueCount });
  }
  for (const id of mapping.order) {
    if (!seen.has(id)) violations.push({ type: 'missing_id', id });
  }

  // 源文件被换过就拒绝续跑，避免拿 A 的对照表回填 B 的稿子。
  try {
    if (lib.sha256(await readText(manifest.source)) !== manifest.sourceHash) {
      violations.push({ type: 'source_changed', source: manifest.source });
    }
  } catch {
    violations.push({ type: 'source_unavailable', source: manifest.source });
  }

  return { ok: violations.length === 0, violations, changes, dialogueCount, expected: manifest.count };
}

// 回填：按每行自身的 token 定位译文；强制守卫，跳过 validate 的篡改稿直接拒绝。
export async function backfill({ returned, work, out }) {
  const mapping = await loadMapping(work);
  const manifest = await loadManifest(work);
  // 关闭“跳过 validate 直接用旧 mapping 回填”的坑：源文件被换过就拒绝。
  let srcText;
  try { srcText = await readText(manifest.source); }
  catch { throw new Error(`源文件不可读（${manifest.source}），请重新 generate`); }
  if (lib.sha256(srcText) !== manifest.sourceHash) {
    throw new Error('源文件已变更（哈希不符），请重新 generate 后再回填');
  }
  const text = await readText(returned);
  const { lines } = lib.splitAss(text);
  const eol = eolOf(text);

  // 守卫：先确认每个 Dialogue 都带合法 token，且行数匹配。
  const tokenById = new Map();
  let tokensFound = 0;
  for (const line of lines) {
    const d = lib.parseDialogue(line);
    if (!d) continue;
    const { visible } = lib.splitLeadingTags(d.text);
    const match = lib.tokenMatch(visible);
    if (!match || !mapping.entries[match.id]) {
      throw new Error('回稿含非法或缺失的 ID token，请先执行 validate 并修正违规项');
    }
    tokenById.set(match.id, match);
    tokensFound++;
  }
  if (tokensFound !== mapping.order.length) {
    throw new Error(`回稿合法 token ${tokensFound} 个，对照表 ${mapping.order.length} 行，数量不符`);
  }

  let section = '';
  const outLines = [];
  let stylesInserted = false;
  const outputOrder = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*\[/i.test(line)) {
      section = trimmed.toLowerCase();
      outLines.push(line);
      if (section === '[v4+ styles]' && !stylesInserted) {
        outLines.push(mapping.originalStyleFormat || SAFE_STYLE_FORMAT, ...(mapping.originalStyles.length ? mapping.originalStyles : [SAFE_STYLE_LINE]));
        stylesInserted = true;
      }
      continue;
    }
    if (COMMENT_LINE.test(line)) continue;
    if (section === '[v4+ styles]') continue; // 占位稿的匿名样式不写回
    if (section === '[events]' && /^\s*Format:/i.test(line)) { outLines.push(EVENT_FORMAT); continue; }

    const d = lib.parseDialogue(line);
    if (!d || section !== '[events]') { outLines.push(line); continue; }

    const { visible } = lib.splitLeadingTags(d.text);
    const match = lib.tokenMatch(visible);
    const entry = mapping.entries[match.id];
    outputOrder.push(match.id);

    const mergedText = lib.mergeTags(entry.orig.text, lib.splitLeadingTags(d.text).tags);
    // Style/Name/Effect 在占位稿里被脱敏成 AS1/空，回稿若仍是占位值就还原原文。
    const style = d.style === 'AS1' ? entry.orig.style : d.style;
    const name = d.name === '' ? entry.orig.name : d.name;
    const effect = d.effect === '' ? entry.orig.effect : d.effect;
    outLines.push(
      `Dialogue: ${d.layer},${d.start},${d.end},${style},${name},${d.marginL},${d.marginR},${d.marginV},${effect},${mergedText}`
    );
  }

  const finalPath = out || join(dirname(returned), `${stem(returned)}.final.ass`);
  await lib.atomicWriteText(finalPath, bomOf(text) + outLines.join(eol));
  // 记录成片里每行的 ID 顺序：行序被 Aegisub 重排后，qc/trace 仍按位置取到正确 ID。
  mapping.outputOrder = outputOrder;
  await lib.atomicWriteJson(join(work, 'mapping.json'), mapping);
  return { out: finalPath, count: outputOrder.length };
}

// 终检：按 outputOrder 取真实 ID/译文，重叠检测用已见最大结束时间。
export async function qc({ ass, work, out }) {
  const mapping = await loadMapping(work);
  // qc/trace 针对回填后的成片：必须用 outputOrder（成片实际行序），缺失时拒绝而非静默回退。
  if (!Array.isArray(mapping.outputOrder)) {
    throw new Error('缺少 outputOrder：qc/trace 针对回填后的成片，请先运行 backfill');
  }
  const { lines } = lib.splitAss(await readText(ass));
  const order = mapping.outputOrder;
  const rows = [];
  const issues = [];
  let prevMaxEnd = -Infinity;
  let index = 0;
  let drawingLines = 0;
  let panelLines = 0;

  // 预扫描：识别「多面板排版组」——同一 (start,end,style) 多行、且每行各带独立 \pos。
  // 这是 fansub 常见的「同一时刻把长句拆成多块文字摆不同位置」做法，不是碰撞。
  const allD = lines.map(l => lib.parseDialogue(l)).filter(Boolean);
  const groupKeys = {};
  for (const d of allD) {
    const k = `${d.start}|${d.end}|${d.style}`;
    (groupKeys[k] = groupKeys[k] || []).push(d);
  }
  const panelKeys = new Set();
  for (const [k, v] of Object.entries(groupKeys)) {
    if (v.length > 1 && v.every(d => /\\pos\(/.test(d.text))) panelKeys.add(k);
  }

  for (const line of lines) {
    const d = lib.parseDialogue(line);
    if (!d) continue;
    // 纯绘图行（遮挡原视频硬字幕的底板）时间跨度极长，time 上包住后续对白，
    // 但它不是文字，不参与重叠碰撞检测，也不撑大 prevMaxEnd。
    const drawing = lib.isDrawingOnly(d.text);
    if (drawing) drawingLines++;
    const panel = !drawing && panelKeys.has(`${d.start}|${d.end}|${d.style}`);
    if (panel) panelLines++;
    const id = order[index] || null;
    const entry = id ? mapping.entries[id] : null;
    const startMs = lib.parseTime(d.start);
    const endMs = lib.parseTime(d.end);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      issues.push({ type: 'duration', severity: 'error', index: index + 1, message: '时间戳非法' });
    }
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      issues.push({ type: 'duration', severity: 'error', index: index + 1, message: '时长非正' });
    }
    // 绘图底板行与多面板排版行都不做重叠判断、也不更新 prevMaxEnd；普通对白之间仍按「早于此前任意行 end」判断。
    const skipOverlap = drawing || panel;
    if (!skipOverlap && Number.isFinite(startMs) && startMs < prevMaxEnd) {
      issues.push({ type: 'duration', severity: 'error', index: index + 1, message: '与先前行时间轴重叠' });
    }

    const chars = entry ? lib.visibleLength(entry.visible) : 0;
    const seconds = (Number.isFinite(startMs) && Number.isFinite(endMs)) ? (endMs - startMs) / 1000 : 0;
    const cps = seconds > 0 ? chars / seconds : 0;
    if (cps > 20) {
      issues.push({ type: 'duration', severity: 'warn', index: index + 1, message: `CPS ${cps.toFixed(1)} 超过 20` });
    }

    const open = (d.text.match(/\{/g) || []).length;
    const close = (d.text.match(/\}/g) || []).length;
    if (open !== close) {
      issues.push({ type: 'duration', severity: 'error', index: index + 1, message: 'ASS 标签未配对' });
    }
    if (entry && chars === 0) {
      issues.push({ type: 'translation', severity: 'warn', index: index + 1, message: '译文正文为空' });
    }

    rows.push({ index: index + 1, id, start: d.start, end: d.end, chars, cps: Number(cps.toFixed(2)) });
    if (!skipOverlap && Number.isFinite(endMs)) prevMaxEnd = Math.max(prevMaxEnd, endMs);
    index++;
  }

  if (index !== order.length) {
    issues.push({ type: 'duration', severity: 'error', index: null,
      message: `行数不符：成片 ${index} 行，对照表 ${order.length} 行` });
  }

  const report = {
    generatedAt: new Date().toISOString(), ass,
    total: index, drawingLines, panelLines,
    durationIssues: issues.filter((i) => i.type === 'duration'),
    translationIssues: issues.filter((i) => i.type === 'translation'),
    rows, issues
  };
  const jsonPath = out || join(work, 'dashboard.json');
  await lib.atomicWriteJson(jsonPath, report);
  await lib.atomicWriteText(jsonPath.replace(/\.json$/i, '.html'), dashboardHtml(report));
  return { json: jsonPath, html: jsonPath.replace(/\.json$/i, '.html'), total: index, ...report };
}

function dashboardHtml(report) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const rows = report.rows.map((r) => `<tr><td>${r.index}</td><td>${esc(r.id || '')}</td><td>${esc(r.start)}</td><td>${esc(r.end)}</td><td>${r.chars}</td><td>${r.cps}</td></tr>`).join('');
  const issues = report.issues.map((i) => `<li>[${esc(i.type)}/${esc(i.severity)}] 第 ${i.index ?? '-'} 行：${esc(i.message)}</li>`).join('') || '<li>无</li>';
  return `<!doctype html><meta charset="utf-8"><title>防剧透校轴 · 终检看板</title>
<style>body{font:14px/1.5 system-ui;margin:2rem;color:#222}h1{font-size:1.4rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.35rem .6rem;text-align:left}th{background:#f5f5f5}li{margin:.2rem 0}</style>
<h1>防剧透校轴 · 终检看板</h1>
<p>文件：${esc(report.ass)}　生成：${esc(report.generatedAt)}　台词行：${report.total}${report.drawingLines ? `　已忽略绘图底板行：${report.drawingLines}` : ''}${report.panelLines ? `　已忽略多面板排版行：${report.panelLines}` : ''}${(report.drawingLines || report.panelLines) ? '（均不参与重叠检测）' : ''}</p>
<h2>问题（${report.issues.length}）</h2><ul>${issues}</ul>
<h2>逐行指标</h2><table><thead><tr><th>#</th><th>ID</th><th>开始</th><th>结束</th><th>字数</th><th>CPS</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// 按时间戳反查。默认不返回译文，避免把剧透发给校轴人员；includeText=true 才显式带出。
export async function trace({ ass, time, work, includeText = false }) {
  const mapping = await loadMapping(work);
  if (!Array.isArray(mapping.outputOrder)) {
    throw new Error('缺少 outputOrder：qc/trace 针对回填后的成片，请先运行 backfill');
  }
  const ms = typeof time === 'number' ? time : lib.parseTime(time);
  const { lines } = lib.splitAss(await readText(ass));
  const order = mapping.outputOrder;
  const hits = [];
  let index = 0;
  for (const line of lines) {
    const d = lib.parseDialogue(line);
    if (!d) continue;
    const id = order[index];
    const entry = id ? mapping.entries[id] : null;
    const startMs = lib.parseTime(d.start);
    const endMs = lib.parseTime(d.end);
    if (entry && startMs <= ms && ms <= endMs) {
      const hit = { id, index: index + 1, start: d.start, end: d.end };
      if (includeText) hit.text = entry.visible;
      hits.push(hit);
    }
    index++;
  }
  return hits;
}

export async function run(command, options = {}) {
  switch (command) {
    case 'generate': return generate(options);
    case 'validate': return validate(options);
    case 'backfill': return backfill(options);
    case 'qc': return qc(options);
    case 'trace': return trace(options);
    default: throw new Error(`未知命令：${command}`);
  }
}

const COMMANDS = ['generate', 'validate', 'backfill', 'qc', 'trace'];
function usage() {
  console.error('用法: node pipeline.mjs <generate|validate|backfill|qc|trace> [--key value | --key=value]');
}

// 直接执行时的参数解析：同时支持 --key value 与 --key=value。
if (typeof process !== 'undefined' && process.argv?.[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !COMMANDS.includes(command)) {
    usage();
    process.exitCode = 1;
  } else {
    const options = {};
    let bad = false;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (!token.startsWith('--')) continue;
      const eq = token.indexOf('=');
      if (eq > 2) {
        options[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const value = rest[i + 1];
        if (value === undefined || value.startsWith('--')) {
          console.error(`参数 --${key} 缺少值`);
          bad = true;
          break;
        }
        options[key] = value;
        i++;
      }
    }
    if (bad) {
      usage();
      process.exitCode = 1;
    } else {
      if ('include-text' in options) options.includeText = options['include-text'] !== 'false';
      if ('includeText' in options) options.includeText = options.includeText !== 'false' && options.includeText !== false;
      // CLI 的 --time 若是纯数字，按毫秒数处理（与对象式 trace({time: 2210}) 一致）。
      // CLI 的 --time 若是纯数字（可带前导 +），按毫秒数处理（与对象式 trace({time: 2210}) 一致）。
      if (typeof options.time === 'string' && /^\+?\d+$/.test(options.time)) options.time = Number(options.time);
      try {
        console.log(JSON.stringify(await run(command, options), null, 2));
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  }
}
