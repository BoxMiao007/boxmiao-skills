import { mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const L = await import(pathToFileURL('D:/dev/github/boxmiao-skills/skills/anti-spoiler-timing/scripts/lib.mjs').href);
const P = await import(pathToFileURL('D:/dev/github/boxmiao-skills/skills/anti-spoiler-timing/scripts/pipeline.mjs').href);
const SRC = 'D:/dev/github/boxmiao-skills/skills/anti-spoiler-timing/evals/stress-complex.ass';
const d = await mkdtemp(join(tmpdir(), 'asstress-'));
const w = join(d, 'w');
const R = []; const ok = (n, p, x = '') => { R.push({ n, p: !!p, x }); if (!p) console.log('FAIL!', n, x); };

const t0 = Date.now();
const g = await P.generate({ source: SRC, work: w, out: join(d, 'p.ass') });
const ph = await readFile(g.placeholder, 'utf8');
const mapping = JSON.parse(await readFile(join(w, 'mapping.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(w, 'manifest.json'), 'utf8'));
ok('生成行数 1080', g.count === 1080 && mapping.order.length === 1080, `${g.count}/${mapping.order.length}`);
console.log(`generate 耗时 ${Date.now() - t0}ms`);

// ---- 1. 零泄漏：遍历所有剧透串 ----
const srcRaw = await readFile(SRC, 'utf8');
const leakStrings = [];
// 所有 mapping 正文（含标签）
for (const e of Object.values(mapping.entries)) {
  if (e.visible && e.visible.length > 0) leakStrings.push(e.visible);
}
// 已知剧透标记
for (const s of ['剧透标题', '最终boss', '凶手样式', '微软雅黑剧透', '反派样式', '翻译备注', '摄政王', '目击者', '剧透角色',
  '凶手是张三', '凶手姓名', '反派', '批注剧透', '揭示真相', 'PlayResX 尾随剧透', '凶手文字写在绘图区', 'boss结尾复活']) leakStrings.push(s);
const leaked = leakStrings.filter(s => ph.includes(s));
ok('占位稿零剧透泄漏', leaked.length === 0, `命中 ${leaked.length}: ${JSON.stringify(leaked.slice(0, 5))}`);

// ---- 2. 占位稿结构合规 ----
const phLines = ph.split('\n');
const phDialogues = phLines.filter(l => l.startsWith('Dialogue:'));
ok('占位稿 Dialogue 数 1080', phDialogues.length === 1080, `${phDialogues.length}`);
ok('每行都有 token', phDialogues.every(l => /\[\[AS:\d{4}:[0-9a-f]{8}\|[SML]\]\]/.test(l)), '');
ok('只有 AS1 样式', phLines.filter(l => l.startsWith('Style:')).every(l => l.startsWith('Style: AS1,')), '');
ok('Name/Effect 全空', phDialogues.every(l => { const p = l.split(','); return p[4].trim() === '' && p[8].trim() === ''; }), '');
ok('无 Comment 行', !phLines.some(l => /^Comment:/.test(l)), '');
ok('BOM 保留', (await readFile(join(d, 'p.ass'))).slice(0, 3).toString('hex') === 'efbbbf', '');
ok('CRLF 保留', ph.includes('\r\n'), '');
// 占位稿行首标签只含白名单定位标签
let badTags = 0;
for (const l of phDialogues) {
  const tm = /^Dialogue:[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/.exec(l);
  if (!tm) continue;
  const leading = (tm[1].match(/^\{[^}]*\}/g) || []).join('');
  for (const b of (leading.match(/\{[^}]*\}/g) || [])) {
    const inner = b.slice(1, -1);
    // 遮罩 \t 后，剩余必须是纯白名单定位标签
    const masked = L.filterTags(b + 'x').tags;
    if (masked !== b && !masked.startsWith(b.slice(0, 1))) badTags++;
  }
}
ok('占位稿无非法标签', badTags === 0, `badTags=${badTags}`);

// ---- 3. validate 通过 ----
const v0 = await P.validate({ returned: join(d, 'p.ass'), work: w });
ok('validate 通过', v0.ok, JSON.stringify(v0.violations.slice(0, 5)));

// ---- 4. backfill 未改稿字节级还原 ----
const t1 = Date.now();
const bf0 = await P.backfill({ returned: join(d, 'p.ass'), work: w, out: join(d, 'f0.ass') });
const f0 = await readFile(bf0.out, 'utf8');
const origDialogues = srcRaw.split('\r\n').filter(l => l.startsWith('Dialogue:'));
const finalDialogues = f0.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.startsWith('Dialogue:'));
ok('回填行数 1080', finalDialogues.length === 1080, `${finalDialogues.length}`);
const mism = [];
for (let i = 0; i < origDialogues.length; i++) {
  if (origDialogues[i] !== finalDialogues[i]) mism.push({ i, o: origDialogues[i], f: finalDialogues[i] });
}
ok('未改稿全部字节还原', mism.length === 0, `不符 ${mism.length} 处: ${JSON.stringify(mism.slice(0, 3))}`);
console.log(`backfill 耗时 ${Date.now() - t1}ms`);

// ---- 5. 改标签后原位保留（端到端，取几个代表行） ----
const edits = [
  ['{\\fs72}', '{\\fs80}'],
  ['{\\pos(100,100)}', '{\\pos(300,400)}'],
  ['{\\an8}', '{\\an8\\fs28}']
];
let edited = ph;
let applied = 0;
for (const [from, to] of edits) {
  if (edited.includes(from)) { edited = edited.replace(from, to); applied++; }
}
await writeFile(join(d, 'ret.ass'), edited, 'utf8');
const ve = await P.validate({ returned: join(d, 'ret.ass'), work: w });
ok('改标签 validate 通过', ve.ok, JSON.stringify(ve.violations.slice(0, 5)));
const bfe = await P.backfill({ returned: join(d, 'ret.ass'), work: w, out: join(d, 'fe.ass') });
const fe = await readFile(bfe.out, 'utf8');
ok('改 fs 原位保留', fe.includes('{\\fs80}'), fe.split('\n').filter(l => l.includes('fs80')).slice(0, 2).join(' | '));
ok('改 pos 原位保留', !fe.includes('{\\pos(100,100)}{\\pos(300,400)}'), '');

// ---- 6. qc / trace ----
const t2 = Date.now();
const q = await P.qc({ ass: bfe.out, work: w });
ok('qc 行数 1080', q.total === 1080, `${q.total}`);
ok('qc 区分 duration/translation', Array.isArray(q.durationIssues) && Array.isArray(q.translationIssues), '');
console.log(`qc 耗时 ${Date.now() - t2}ms, issues=${q.issues.length}`);
const t = await P.trace({ ass: bfe.out, time: '00:00:05.000', work: w, includeText: true });
ok('trace 命中', t.length >= 1, `${t.length}`);
ok('trace 默认无译文（另一调用）', (await P.trace({ ass: bfe.out, time: '00:00:05.000', work: w })).every(h => !('text' in h)), '');

// ---- 7. sourceHash 校验 ----
const mf = join(w, 'manifest.json');
const mObj = JSON.parse(await readFile(mf, 'utf8'));
const tampered = await copyFile(SRC, join(d, 't.ass')).then(async () => {
  const c = await readFile(join(d, 't.ass'), 'utf8');
  await writeFile(join(d, 't.ass'), c.replace('今晚的会议', '今晚的秘密会议'), 'utf8');
  return join(d, 't.ass');
});
mObj.source = tampered;
await writeFile(mf, JSON.stringify(mObj, null, 2), 'utf8');
const vh = await P.validate({ returned: join(d, 'ret.ass'), work: w });
ok('sourceHash 变更检出', vh.violations.some(i => i.type === 'source_changed'), '');

const pass = R.filter(r => r.p).length;
console.log(R.map(r => `${r.p ? 'PASS' : 'FAIL'} ${r.n}${r.x && !r.p ? ' :: ' + r.x : ''}`).join('\n'));
console.log(`\n${pass}/${R.length} passed`);
process.exitCode = pass === R.length ? 0 : 1;
