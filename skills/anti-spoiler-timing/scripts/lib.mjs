// ASS 解析、ID 生成、标签过滤与原子落盘。供 pipeline.mjs 导入。
// 安全约定：占位稿由 pipeline 白名单重建，本模块负责把「可能含剧情」的内容识别出来并隔离。
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

// [[AS:0007:a1b2c3|M]] —— token 本体，不含后面的 █ 填充
// 序号至少 4 位，允许更长（超过 9999 行时自然扩展为 5 位以上）。
export const TOKEN_SRC = /\[\[AS:(\d{4,}):([0-9a-f]{8})\|([SML])\]\]/;
export const TOKEN_ANY = /\[\[AS:\d{4,}:[0-9a-f]{8}\|[SML]\]\]/g;
export const FILL_CHAR = '█';
export const LEADING_TAGS = /^(\{[^}]*\})+/;
export const FILL = { S: 8, M: 16, L: 28 };

// [Events] 的 Format 前 9 字段必须是这个顺序，否则 fail-closed。
export const STANDARD_FORMAT = [
  'Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'
];

// 只有这些定位/尺寸标签允许出现在占位稿里，校轴人员可调。
// 注意：pos/move 的参数必须是纯数字，否则可夹带剧透文本（如 \pos(凶手是张三,2)）。
// \fn、\r、\t、\p、\clip 等可能夹带字体名/样式名/绘图，一律不进占位稿。
// fr 系列按官方手册有 \fr \frx \fry \frz 四种，角度可为负数/小数，必须完整匹配，
// 否则 \frz30 会被截成 \fr（改变了校轴人员看到的旋转语义）。
// 数值参数用完整有符号小数 + 右边界（后接空白/反斜杠/结尾）匹配，避免 \fs20.5 被截成 \fs20、
// \fs20.5.5 被截成 \fs20.5 而在回填时留下 .5 残块；fr 组非可选，裸 \fr 按非白名单处理。
export const POSITION_TAGS = /\\(?:an\d+(?:\.\d+)?(?=[\s\\\u0000]|$)|pos\([-\d.,\s]+\)(?=[\s\\\u0000]|$)|move\([-\d.,\s]+\)(?=[\s\\\u0000]|$)|fs[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?=[\s\\\u0000]|$)|fsc[xy][-+]?(?:\d+(?:\.\d+)?|\.\d+)(?=[\s\\\u0000]|$)|fr(?:[xyz][-+]?(?:\d+(?:\.\d+)?|\.\d+)|[-+]?(?:\d+(?:\.\d+)?|\.\d+))(?=[\s\\\u0000]|$)|fax[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?=[\s\\\u0000]|$)|fay[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?=[\s\\\u0000]|$))/g;

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ID = 行号(1 起) + 行号与正文的哈希前 8 位。稳定、可复现、增删行不错位。
// 输入必须是剥掉标签后的可见正文，保证改样式不影响 ID。
export function makeId(index0, visible) {
  const hash = sha256(`${index0}\u0000${visible}`).slice(0, 8);
  return `AS:${String(index0 + 1).padStart(4, '0')}:${hash}`;
}

export function parseTime(value) {
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(String(value).trim());
  if (!m) return NaN;
  return ((Number(m[1]) * 3600) + (Number(m[2]) * 60) + Number(m[3])) * 1000
    + Number(`0.${m[4]}`) * 1000;
}

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00:00.00';
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

// Dialogue 的前 9 个字段固定，第 10 个是 Text（内部可能含逗号）。
export function parseDialogue(line) {
  if (!/^\s*Dialogue:/i.test(line)) return null;
  const body = line.replace(/^\s*Dialogue:/i, '');
  let comma = 0;
  let pos = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === ',') {
      comma++;
      if (comma === 9) { pos = i; break; }
    }
  }
  if (pos < 0) return null;
  const head = body.slice(0, pos).split(',');
  if (head.length !== 9) return null;
  return {
    layer: head[0].trim(), start: head[1].trim(), end: head[2].trim(),
    style: head[3].trim(), name: head[4].trim(),
    marginL: head[5].trim(), marginR: head[6].trim(), marginV: head[7].trim(),
    effect: head[8].trim(),
    // 规范化尾部空白：不影响显示，但避免 sizeOf/makeId/CPS 被尾部空格污染。
    text: body.slice(pos + 1).replace(/[ \t]+$/, '')
  };
}

// 只替换 Text 字段，前面的字段与空格原样保留。
export function replaceDialogueText(line, newText) {
  let comma = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ',' && ++comma === 9) return line.slice(0, i + 1) + newText;
  }
  return line;
}

export function splitLeadingTags(text) {
  const m = LEADING_TAGS.exec(text);
  return m ? { tags: m[0], visible: text.slice(m[0].length) } : { tags: '', visible: text };
}

export function stripTags(text) {
  return String(text).replace(/\{[^}]*\}/g, '');
}

// 可见字符数：去掉标签、去掉 \N/\n 换行（不占可见宽度），\h 硬空格按 1 个字符算。
// 用于长度分档、CPS、字数统计，避免换行符把 S 顶成 M 或虚增 CPS。
export function visibleLength(text) {
  return [...stripTags(text).replace(/\\N/g, '').replace(/\\n/g, '').replace(/\\h/g, ' ')].length;
}

// 长度档只看可见字符，不看标签；忽略尾部空白，避免尾部空格把 S 顶成 M。
export function sizeOf(visible) {
  const n = visibleLength(visible.replace(/[ \t]+$/, ''));
  return n <= 12 ? 'S' : n <= 24 ? 'M' : 'L';
}

export function tokenFor(id, size) {
  return `[[${id}|${size}]]${FILL_CHAR.repeat(FILL[size])}`;
}

// 返回 token 的 id/size/raw 以及它在 visible 里的 index（供 validate 精确切片）。
export function tokenMatch(visible) {
  const m = TOKEN_SRC.exec(visible);
  if (!m) return null;
  return { id: `AS:${m[1]}:${m[2]}`, size: m[3], raw: m[0], index: m.index };
}

// 平衡括号提取 \t(...) —— 正则 /[^)]*/ 遇到嵌套 `(` 会错断，必须按深度扫描。
// 返回 [{ text, start, end }]，只提取顶层的 \t(...) 调用（内部嵌套一并纳入）。
export function takeTransformCalls(inner) {
  const calls = [];
  let i = 0;
  while (i < inner.length - 2) {
    if (inner[i] === '\\' && inner[i + 1] === 't' && inner[i + 2] === '(') {
      const start = i;
      let depth = 0;
      let j = i + 2;
      for (; j < inner.length; j++) {
        if (inner[j] === '(') depth++;
        else if (inner[j] === ')') {
          depth--;
          if (depth === 0) { j++; break; }
        }
      }
      if (depth !== 0) {
        // 未闭合：把剩余部分整体当成一个变换吃进来，避免其内部白名单标签被提升到顶层。
        calls.push({ text: inner.slice(start), start, end: inner.length });
        break;
      }
      calls.push({ text: inner.slice(start, j), start, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return calls;
}

// 把 \t(...) 替换成不含反斜杠/括号的占位符，避免其内部 \fscx 被 POSITION_TAGS 匹配。
// 按 start/end 位置切片重建，避免 String.replace 遇到重复子串或 `$` 时的歧义。
function maskTransforms(inner) {
  const calls = takeTransformCalls(inner);
  if (!calls.length) return { masked: inner, holes: [], calls };
  let masked = '';
  let last = 0;
  const holes = [];
  calls.forEach((c, idx) => {
    masked += inner.slice(last, c.start);
    const token = `\u0000T${idx}\u0000`;
    masked += token;
    holes.push(token);
    last = c.end;
  });
  masked += inner.slice(last);
  return { masked, holes, calls };
}

function unmask(masked, holes, calls) {
  let out = masked;
  // 用函数替换，确保变换文本里的 `$`（如 `$&`）按字面量还原，不被当成替换模式。
  holes.forEach((tok, idx) => { out = out.replace(tok, () => calls[idx].text); });
  return out;
}

// 从原始行首标签中，只保留定位类标签进入占位稿；其余（含 \t 变换）全部丢弃。
export function filterTags(text) {
  const { tags, visible } = splitLeadingTags(text);
  const blocks = tags.match(/\{[^}]*\}/g) || [];
  const safe = [];
  for (const block of blocks) {
    const { masked } = maskTransforms(block.slice(1, -1));
    const kept = masked.match(POSITION_TAGS) || [];
    if (kept.length) safe.push(`{${kept.join('')}}`);
  }
  return { tags: safe.join(''), visible };
}

// 回填：校轴改过的定位标签 + 原始的非定位标签 + 原始正文。
// 未改定位标签时直接返回原文（字节级还原）。
// 关键：占位稿只保留「含定位标签的块」，不含定位标签的块（如 {\i1}、{\rStyle}）被丢弃，
// 因此回稿块与原文块不是一一对应，不能按裸索引对齐。必须按「原文中含定位标签的块」顺序
// 消费回稿的定位标签；无定位标签的原文块原样保留；新增标签放回对应块；绝不输出空 {}；
// 被校轴删掉的定位块应消失（不回退到原文复活）。
// 对 \t(...) 整体保护：按平衡括号提取后遮罩，避免其内部 \fscx 被当定位标签拆走。
export function mergeTags(originalText, returnedTags) {
  const { tags: origTags, visible } = splitLeadingTags(originalText);
  if (returnedTags === filterTags(originalText).tags) return originalText; // 未改，字节级还原

  const origBlocks = origTags.match(/\{[^}]*\}/g) || [];
  const retBlocks = returnedTags.match(/\{[^}]*\}/g) || [];
  const positionsOf = (blocks) => blocks.map((b) => {
    const { masked } = maskTransforms(b.slice(1, -1));
    return masked.match(POSITION_TAGS) || [];
  });
  const retPos = positionsOf(retBlocks);

  const infos = origBlocks.map((b) => {
    const { masked, holes, calls } = maskTransforms(b.slice(1, -1));
    return { masked, holes, calls, has: (masked.match(POSITION_TAGS) || []).length > 0 };
  });

  // 原文完全没有定位块、但回稿新增了定位标签：前置一个新块，原文块全部保留。
  // 必须过滤空数组——非定位块（如 {\b1}）的 retPos 是 []，不滤会产生空 {}。
  if (!infos.some((x) => x.has) && retPos.length) {
    return retPos.filter((p) => p.length).map((p) => `{${p.join('')}}`).join('') + origBlocks.join('') + visible;
  }

  const rebuilt = [];
  let used = 0;
  for (let i = 0; i < origBlocks.length; i++) {
    if (!infos[i].has) { rebuilt.push(origBlocks[i]); continue; } // 非定位块原样保留
    const want = retPos[used++] || [];
    let idx = 0;
    const inner = infos[i].masked.replace(new RegExp(POSITION_TAGS.source, 'g'),
      () => (idx < want.length ? want[idx++] : ''));
    const out = unmask(inner, infos[i].holes, infos[i].calls) + want.slice(idx).join('');
    const trimmedOut = out.trim();
    // 防御：合法标签体以反斜杠开头；若残块不以反斜杠开头（正则误匹配留下的 .5 之类），丢弃而不是污染成片。
    if (trimmedOut && trimmedOut.startsWith('\\')) rebuilt.push(`{${trimmedOut}}`); // 空/残块不回退到原文：被删的定位块应消失，不复活、不产生 {}
  }
  for (let k = used; k < retPos.length; k++) {
    if (retPos[k].length) rebuilt.push(`{${retPos[k].join('')}}`);
  }
  return rebuilt.join('') + visible;
}

// 纯绘图行：{\p1}…{\p0} 之间只有绘图命令、没有可见文字。
// 真实字幕常见「整段视频盖一块底色遮挡原视频硬字幕」的做法，这类行时间跨度很长（十几分钟），
// 时间上会把后面所有对白包住；qc 的重叠检测必须跳过它，否则终检被满屏误报淹没。
export function isDrawingOnly(text) {
  const s = String(text);
  if (!/\\p[1-9]/.test(s)) return false;
  let drawing = false;
  let visible = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      if (end < 0) break;
      const block = s.slice(i, end + 1);
      const m = /\\p([0-9])/.exec(block);
      if (m) drawing = Number(m[1]) >= 1;
      i = end + 1;
      continue;
    }
    if (!drawing) visible += s[i];
    i++;
  }
  return visible.trim() === '';
}

// fail-closed：Format 顺序不对就拒绝生成，避免把正文当 Style 带进占位稿。
export function checkEventsFormat(lines) {
  let inEvents = false;
  for (const line of lines) {
    if (/^\s*\[/i.test(line)) {
      inEvents = /^\s*\[Events\]/i.test(line);
      continue;
    }
    if (inEvents && /^\s*Format:/i.test(line)) {
      const fields = line.replace(/^\s*Format:\s*/i, '').split(',').map((s) => s.trim());
      const head = fields.slice(0, 9).join(',').toLowerCase().replace(/\s+/g, '');
      const want = STANDARD_FORMAT.slice(0, 9).join(',').toLowerCase();
      if (head !== want) return { ok: false, reason: `Format 前 9 字段非标准顺序：${head}` };
      return { ok: true, fields };
    }
  }
  return { ok: false, reason: '[Events] 段缺少 Format: 行' };
}

export function splitAss(text) {
  const s = String(text);
  const hadBom = s.charCodeAt(0) === 0xFEFF;
  return { lines: (hadBom ? s.slice(1) : s).split(/\r?\n/), hadBom };
}

// 读取状态 JSON：文件读不到或 JSON 非法时给出可定位的中文错误，而不是原始异常栈。
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`读不到状态文件 ${basename(file)}（${e.code || '错误'}），请确认已完成 generate`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`状态文件 ${basename(file)} 不是合法 JSON（可能已损坏），请删除隐藏目录后重新 generate：${e.message}`);
  }
}

export async function atomicWriteJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function atomicWriteText(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, value, 'utf8');
  await rename(tmp, file);
}
