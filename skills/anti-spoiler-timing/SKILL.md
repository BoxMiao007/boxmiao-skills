---
name: anti-spoiler-timing
description: 防剧透人工校轴：把已翻译的 ASS 转成只含 ID 与长度占位的轴稿交给人工校轴，回稿后做白名单校验、回填译文、终检并发布，全程不让校轴人员提前看到剧情。翻译 ASS 后需要人工调轴、又担心校轴人员被剧透，或需要按时间戳报障反查 ID 定位修复时使用。不适用于：原文翻译、术语提取、非 ASS 字幕。
---

# 防剧透人工校轴

把翻译完成的 ASS 变成一份**看不懂内容、只调时间轴**的占位稿，人工校轴完成后再把译文回填。

这里的“防剧透”是硬要求：交给校轴人员的文件里**不能出现译文、原文、术语或任何可推断剧情的文字**。校轴人员只看到唯一 ID、`█` 长度填充和 S/M/L 长度档。

## 三条红线

1. **占位稿里没有剧情**。占位稿是白名单重建的：正文、样式名、角色名、Effect、批注、字体名等全部脱敏，只保留唯一 ID、`█` 填充和 S/M/L 档。
2. **状态必须落盘**。ID→译文对照表与 manifest 写在 ASS 同级的隐藏目录，只把单个占位 ASS 交出去；对照表绝不随占位稿交付。
3. **回填只动 ID token**。回稿里的**定位标签**（`\pos`/`\an`/`\fs` 等）、样式、位置、时间由校轴人员决定并保留；**非定位标签**（字体名、样式名、变换等）一律从原文恢复（详见 `references/ass-format.md`「可改与不可改」表）。只把 ID token 换回译文正文。

## 适用与不适用

- 适用：工作区已有翻译完成的 ASS（由 `media` 渲染、从工程导出或用户提供均可），接下来要人工调轴；需要按时间戳报障反查定位。
- 不适用：从原文翻译、提取术语、审校译文——那些交给 `glossary`、`translation`。本 skill 不替代它们，只消费其产出的 ASS 文件。
- 前置：翻译已完成。本 skill 是译文完成后的可选校轴环节，不是某个固定提示词里的“第 4 步”。

## 阶段判定

自动阶段判定是给 agent 编排用的约定：看到隐藏目录已有 `manifest.json` 就走阶段二，否则走阶段一。**脚本本身不按 manifest 自动分派**——直接调用 CLI 时必须显式指定 `generate` / `validate` 等子命令。

输入 ASS 一律在正文里用 `@workspace_file("...")` 引用；`@skill("anti-spoiler-timing")` 只接受技能名，不能带路径参数。若 ASS 不是工程条目、`@workspace_file` 解析不到，就在正文写绝对路径，让脚本直接读取。

### 纯 CLI 环境（没有 `read_skill` / `workspace_run`）

若当前环境没有 LinguaGacha 的工具，直接用 node 调用脚本，`<skill-root>` 是技能根目录：

```bash
node <skill-root>/scripts/pipeline.mjs generate  --source <译文ASS> --work <隐藏目录> --out <占位ASS>
node <skill-root>/scripts/pipeline.mjs validate  --returned <回稿ASS> --work <隐藏目录>
node <skill-root>/scripts/pipeline.mjs backfill  --returned <回稿ASS> --work <隐藏目录> --out <成片ASS>
node <skill-root>/scripts/pipeline.mjs qc       --ass <成片ASS> --work <隐藏目录>
node <skill-root>/scripts/pipeline.mjs trace    --ass <成片ASS> --work <隐藏目录> --time <时刻>
```

参数与对象式调用的对应关系：`source/work/out/returned/ass/time` 同名；`includeText` → `--include-text true|false`（**必须带值**，只写 `--include-text` 会报错）。stdout 输出 JSON，异常退出码为 1。references 用普通文件读取工具打开即可，无需 `read_skill`。

## 阶段一：生成占位轴

1. 读取用户引用的**翻译完成 ASS**。
2. 从技能 `read_skill` 返回的 `base_url` 导入脚本：
   ```js
   const pipeline = await import(new URL('scripts/pipeline.mjs', base_url).href);
   ```
3. 调用 `generate`，得到占位 ASS 路径与工作目录：
   ```js
   const result = await pipeline.generate({
     source: 翻译完成ASS路径,
     work:   '<ASS同级>/.anti-spoiler-<主名>',
     out:    '<ASS同级>/<主名>.placeholder.ass'
   });
   ```
4. 只把 `result.placeholder` 这一个文件交给校轴人员，明确告知：用 Aegisub 调时间轴与样式/位置，不要改正文里的 ID token。
5. **不要**把 `work` 目录里的 `mapping.json`、`manifest.json` 交出去——那里有完整译文。

`generate` 会先校验 `[Events]` 的 `Format` 字段顺序，不符就 fail-closed 报错，绝不把可疑文本带进占位稿。

## 阶段二：回稿续跑

1. 读取用户引用的校轴回稿 ASS。
2. 调用 `validate` 做解析级白名单比较：
   ```js
   const check = await pipeline.validate({ returned: 回稿ASS, work: 工作目录 });
   ```
   `ok === false` 时把 `violations` 原样反馈给用户，让他回 Aegisub 修正后再次调用；**此时不要回填**。
3. 校验通过后调用 `backfill` 回填：
   ```js
   const filled = await pipeline.backfill({ returned: 回稿ASS, work: 工作目录, out: '<主名>.final.ass' });
   ```
   `backfill` 自带守卫：回稿 token 非法/缺失、合法 token 数与对照表不符会直接拒绝；并会重算源文件哈希，源变更则拒绝（防止跳过 `validate` 用旧对照表回填）。但守卫**只查 token 合法性与数量**——填充、档位、追加文字类篡改不触发拒绝；不过回填以 `mapping` 原文为准，这些篡改不会进入成片。仍须先 `validate`。
4. 调用 `qc` 做终检并生成看板：
   ```js
   const report = await pipeline.qc({ ass: filled.out, work: 工作目录 });
   ```
   - `duration` 类问题（CPS 超限、时间重叠、时长非正、时间戳非法、ASS 标签未配对、行数不符；完整清单见 `references/workflow.md`）→ 请用户回 Aegisub 调轴。遮挡原视频硬字幕的**纯绘图底板行**（`{\p1}…{\p0}`）时间跨度很长，以及把一句话拆成多块文字摆不同位置的**多面板排版行**（同起止、同样式、各带 `\pos`），qc 都会自动忽略其重叠，不算误报；看板会列出这两类忽略的行数。
   - `translation` 类问题（目前仅“译文正文为空”，包括只有标签、可见字数为 0 的行）→ 反馈上游重新翻译/审校（`translation`）。
   - 无问题 → 发布 `final.ass` 与 `dashboard.html`。
5. 用户观影后按时间戳报障时：
   ```js
   const hits = await pipeline.trace({ ass: finalASS, time: '00:01:23.450', work: 工作目录 });
   ```
   `trace` 默认只返回 ID、时间与行号；要把译文给**翻译人员**修时显式传 `includeText: true`（CLI 写作 `--include-text true`，必须带值）。判定为闭区间 `start ≤ 时刻 ≤ end`，相邻行共享端点时同时命中；完全无法解析（如 `abc`）或超出范围的时间返回空数组（秒/厘秒字段越界如 `0:00:99.99` 会进位归一化，不返回空）。对象式调用可传毫秒数（`time: 2210`）；CLI 的 `--time` 传纯数字时也按毫秒处理，其余按时间码字符串。用它返回的 `id` 定位源行，修好后重新走 `backfill` → `qc`，**不要**重新 `generate`（否则校轴成果丢失）。

## 校验规则（解析级白名单）

| 项目 | 回稿允许 | violations[].type | 说明 |
|---|---|---|---|
| Start / End | 允许 | — | 校轴核心动作 |
| Layer / Margin / Style / Effect | 允许 | — | 样式与位置调整；改成剧透串也不违规（白名单允许） |
| 行首 `{...}` 定位标签 | 允许 | `tag_illegal`（出现非白名单标签时） | 只允许 `\pos`、`\an`、`\fs` 等定位标签；`\fn`、`\r`、`\t`、注释等非白名单内容一律判违规（回填本会从原文恢复，但 validate 阶段就打回） |
| ID token `[[AS:…|S/M/L]]` | **必须原样存活** | `missing_token` / `duplicate_id` / `unknown_id` / `missing_id` / `token_altered` | 缺失、重复、档位改写都判违规 |
| token 后的 `█` 填充 | 必须恰好是档位规定块数 | `fill_altered` | 删减或增加都视为正文被改 |
| 正文中出现额外文字 | 禁止 | `text_altered` | 视为篡改占位稿 |
| Dialogue 行数量 | 必须一致 | `line_count` | 增删行判违规 |
| 源文件哈希 | 必须匹配 | `source_changed` / `source_unavailable` | 源文件被换过或读不到就拒绝续跑，重新 `generate`、旧稿作废 |

**已知限制（威胁模型内可接受）**：`validate` 不校验 token 是否仍在原始行，因此**两个 ID（含 token 与 █ 填充）整体对调——不论档位——都不会被检出**。但校轴人员看不到译文、对调对他无收益；发布后按时间戳报障仍能反查定位。行序重排（Aegisub 按时间排序）是允许的。

回稿 `{`/`}` 不配对会被间接判为 `fill_altered`/`text_altered`（没有专门的 `tag_unbalanced` 类型）；`qc` 阶段的标签配对检查是终检，与此不同。

完整字段与数据结构见 `references/workflow.md`，ASS 格式与长度档阈值见 `references/ass-format.md`。

## 验收清单

- [ ] 占位 ASS 中搜索不到任何译文、原文、样式名、角色名、批注或剧透线索
- [ ] 占位稿只含中性样式 `AS1`，Dialogue 的 Name/Effect 为空
- [ ] 每行 Dialogue 都有唯一 ID token，且 S/M/L 与填充块数匹配（8/16/28）
- [ ] 对照表与 manifest 位于隐藏目录，未交付校轴人员
- [ ] 非标准 `Format` 顺序会 fail-closed 报错
- [ ] 回稿在 ID 缺失/重复/档位改写/填充被删或增加/正文被改时返回 `ok: false`
- [ ] 回稿行首出现非白名单标签（如 `\fn`、`\r`、`\t`）时返回 `tag_illegal`
- [ ] 源文件被换过或读不到时返回 `source_changed`/`source_unavailable`
- [ ] 回稿新增非定位标签不会在成片里产生空 `{}`
- [ ] 回填后标签、样式、位置、时间与回稿一致，只有正文被替换
- [ ] 行序被重排后 `qc`/`trace` 仍指向正确 ID（靠 `outputOrder`）
- [ ] 终检生成 `dashboard.html`，区分 `duration` 与 `translation` 类问题
- [ ] 按时间戳报障能反查到 ID，默认不带译文

## 参考

按需读取，不要一次全读：

- 遇到异常恢复、需要确认 manifest/mapping 结构或目录布局时，读 `references/workflow.md`。
- 需要确认 ASS 字段顺序、token 格式、长度档阈值或可改/不可改清单时，读 `references/ass-format.md`。
- 两份资源都用 `read_skill("anti-spoiler-timing", "references/<文件名>")` 读取。
- `scripts/lib.mjs`：ASS 解析、ID 生成、标签过滤、原子落盘。
- `scripts/pipeline.mjs`：`generate` / `validate` / `backfill` / `qc` / `trace`。
