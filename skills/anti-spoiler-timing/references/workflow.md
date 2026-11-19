# 完整流程与数据结构

## 目标与非目标

目标：在**人工校轴**环节阻断剧透。校轴人员拿到的是一份只有 ID、`█` 与 S/M/L 的 ASS，能调时间轴和样式/位置，但读不到任何台词内容。

非目标：不翻译、不提术语、不审校译文。这些属于 `glossary`、`translation` 的职责。本 skill 的输入是**翻译已经完成**的 ASS，由 `media` 渲染、工程导出或用户提供均可。

## 阶段判定

```
调用 anti-spoiler-timing
        │
        ├─ 工作目录无 manifest.json ──→ 阶段一 generate
        │
        └─ 工作目录有 manifest.json ──→ 阶段二 validate → backfill → qc
```

工作目录固定为 ASS 同级的 `.anti-spoiler-<主名>/`。判断依据是文件是否存在，不靠用户记忆或额外参数。

## 目录布局

```
<ASS 所在目录>/
├── <主名>.ass                    # 翻译完成 ASS（输入，只读）
├── <主名>.placeholder.ass        # 占位轴稿，唯一交付给校轴人员的文件
├── <主名>.final.ass              # 回填后的成片 ASS
└── .anti-spoiler-<主名>/         # 剧透区，绝不交付校轴人员
    ├── manifest.json             # 状态：sourceHash、ID、时间、长度档
    ├── mapping.json              # ID→译文对照表 + 原始样式 + outputOrder（含剧透）
    ├── dashboard.json            # 终检指标数据
    └── dashboard.html            # 终检看板
```

**没有** `source.ass` 副本：完整译文只在原始 ASS 和 `mapping.json` 里。工作目录里的任何文件都不能随占位稿交付。交付时只传单个 `.placeholder.ass` 文件，不要打包整个目录。

## 占位稿为什么是白名单重建

早期版本是“复制原 ASS + 替换 Text 字段”，实测会泄露：`[Script Info]` 的 Title/Comments/Note、`[V4+ Styles]` 的样式名、Dialogue 的 Name/Style/Effect、分号注释、行首 `\fn`/`\r`/`\t` 标签里的文字，全部原样留在占位稿里。

现在 `generate` 只输出固定骨架：中性 `[Script Info]`（仅保留白名单字段 PlayResX/Y、ScriptType、WrapStyle、ScaledBorderAndShadow、YCbCr Matrix、LayoutResX/Y、Timer）、单一匿名样式 `AS1`、`[Events]` 的 `Format` + 脱敏 Dialogue。原始内容只进 `mapping.json`。

** fail-closed**：`generate` 先校验 `[Events]` 的 `Format` 前 9 字段按顺序、忽略大小写与空白后等于 `Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect`，不符直接报错。字段顺序不对时若继续解析，会把正文当成 Style 字段带进占位稿。

## manifest.json

```json
{
  "version": 1,
  "source": "path/to/<主名>.ass",
  "sourceHash": "sha256...",
  "createdAt": "ISO-8601",
  "placeholder": "path/to/<主名>.placeholder.ass",
  "workDir": "path/to/.anti-spoiler-<主名>",
  "count": 42,
  "lines": [
    { "id": "AS:0007:a1b2c3de", "index": 6, "size": "M" }
  ]
}
```

`validate` 会重算 `manifest.source` 的哈希并与 `sourceHash` 比对；源文件被换过就返回 `source_changed`，拒绝续跑。

## mapping.json

```json
{
  "version": 1,
  "order": ["AS:0007:a1b2c3de", "..."],
  "outputOrder": ["AS:0007:a1b2c3de", "..."],
  "originalStyles": ["Style: Default,Arial,20,..."],
  "entries": {
    "AS:0007:a1b2c3de": {
      "id": "AS:0007:a1b2c3de",
      "index": 6, "size": "M",
      "visible": "译文正文",
      "startMs": 1000, "endMs": 3000,
      "orig": {
        "layer": "0", "start": "0:00:01.00", "end": "0:00:03.00",
        "style": "Default", "name": "", "effect": "",
        "marginL": "0", "marginR": "0", "marginV": "0",
        "text": "{\\i1}译文正文"
      }
    }
  }
}
```

- `order`：generate 时的行序，校验完整性用。
- `outputOrder`：backfill 写入成片后的行序。Aegisub 可能按时间重排 Dialogue 行，`qc`/`trace` 靠它按位置取到正确 ID，避免按 `order` 错位。
- `originalStyles`：原始样式定义，backfill 时写回成片。
- `orig`：原始 9 字段与完整 Text，回填时用于样式/名称还原和非定位标签恢复。

## 校验规则

`validate` 返回 `{ ok, violations, changes, dialogueCount, expected }`。

| violation | 触发条件 |
|---|---|
| `missing_token` | Dialogue 行没有 ID token |
| `duplicate_id` | 同一 ID 出现多次 |
| `unknown_id` | ID 不在对照表 |
| `missing_id` | 对照表里的 ID 在回稿中消失 |
| `text_altered` | token 之后出现 `█` 以外的文字 |
| `tag_illegal` | 回稿行首标签含非白名单内容（如 `\fn`、`\r`、`\t`、注释文本） |
| `fill_altered` | `█` 填充被删或数量与档位不符 |
| `token_altered` | S/M/L 档位字母被改 |
| `line_count` | Dialogue 行数与对照表不符 |
| `source_changed` / `source_unavailable` | 源文件被换过或读不到 |

`changes` 只是提示校轴人员改了哪些字段（时间 / 标签 / 样式），全部属于白名单，不构成违规。

## 回填

`backfill` 有强制守卫：先扫描所有 Dialogue，发现任一 token 缺失或不在对照表就抛错；合法 token 数必须等于 `order.length`。通过后才逐行按**自身 token** 定位译文，替换 `token + █填充`。

- 行首标签：用回稿的定位标签（校轴改动）+ 原文的非定位标签（字体、样式、变换等）。
- Style/Name/Effect：回稿仍是占位值（`AS1`/空）时还原原文，否则保留校轴人员的改动。
- 时间、Layer、Margin：以回稿为准。
- 原始样式定义写回 `[V4+ Styles]`。

## 终检

`qc` 生成 `dashboard.json` 与 `dashboard.html`：

| 指标 | 规则 | 分类 |
|---|---|---|
| 时间戳非法 / 时长非正 | `parseTime` 返回 NaN 或 end ≤ start | `duration` |
| CPS | 可见字数 ÷ 时长秒数 > 20 告警 | `duration` |
| 碰撞 | 本行开始早于**此前任意普通行**的最大结束时间（不是只看上一行）。以下两类不参与重叠检测、也不撑大结束时间：① **纯绘图行**（`{\p1}…{\p0}` 且无可见文字，如遮挡原视频硬字幕的底板）；② **多面板排版行**（同一 `start,end,style` 的多行、且各行带独立 `\pos`，即把一句话拆成多块文字摆不同位置）。看板会列出两类忽略行数 | `duration` |
| 标签配对 | `{` 与 `}` 数量不等 | `duration` |
| 行数 | 与 `outputOrder` 长度不符 | `duration` |
| 空正文 | 可见字数为 0 | `translation` |

`duration` 类问题请用户回 Aegisub；`translation` 类问题反馈上游重译。

## 报障反查

用户观影时按时间戳报障，例如 `00:01:23.450`。`trace` 返回覆盖该时刻的行：

```json
[{ "id": "AS:0007:a1b2c3de", "index": 7, "start": "0:01:23.00", "end": "0:01:25.00" }]
```

默认**不含译文**，避免有人把结果直接转发给校轴人员造成泄漏。要把译文交给翻译人员修时显式传 `includeText: true`（CLI 为 `--include-text true`，必须带值）。

判定为闭区间 `start ≤ 时刻 ≤ end`，相邻行共享端点时同时命中；完全无法解析（如 `abc`）或超出范围的时间返回空数组（秒/厘秒字段越界如 `0:00:99.99` 会进位归一化，不返回空）。`time` 可传毫秒数：对象式调用 `time: 2000`；纯 CLI 的 `--time` 传纯数字时也按毫秒处理，否则按时间码字符串。

用 `id` 定位源行，修好后重新 `backfill` → `qc`；不要重新 `generate`，否则校轴成果会丢。

## 异常处理

| 情况 | 处理 |
|---|---|
| 输入 ASS 解析出 0 行 Dialogue | `generate` 抛错停止 |
| `[Events]` 的 Format 非标准顺序 | `generate` fail-closed 抛错 |
| 有 `Dialogue:` 行解析失败（字段数不足/缺 Text） | `generate` 抛错，绝不静默丢行 |
| Layer/Margin 非数字（Actor 名含逗号导致字段错位） | `generate` 抛错；Actor/Name 字段不能含逗号 |
| Start/End 非法（非 `H:MM:SS.cc`，夹带非时间文本） | `generate` 抛错，避免文字被逐字复制进占位稿 |
| 使用 SSA v4 的 `[V4 Styles]`（v4.00 而非 v4.00+） | 不支持，`generate` 抛错；请在 Aegisub 另存为 v4.00+ |
| 超过 9999 行 Dialogue | 无需处理：token 序号会自动扩展为 5 位以上，`TOKEN_SRC`/`TOKEN_ANY` 与自检正则已用 `\d{4,}`，validate/backfill 正常工作 |
| `sourceHash` 与 manifest 不符 | `validate` 返回 `source_changed`；`backfill` 亦拒绝。重新 generate，旧校轴稿作废 |
| 源文件读不到 | `validate` 返回 `source_unavailable`，恢复源文件后重试或重新 generate |
| 回稿 token 被删 / 非法 / 数量与对照表不符 | `backfill` 抛错，先修回稿 |
| 回稿新增非定位标签 | `validate` 返回 `tag_illegal`；回填本会从原文恢复，不会进成片 |
| 状态文件（manifest/mapping）损坏或缺失 | 各命令给出清晰中文错误（"状态文件损坏…请重新 generate"），不会抛原始 TypeError |
| qc/trace 提示"缺少 outputOrder" | 说明尚未 `backfill`；qc/trace 只针对回填后的成片 |
| 需要放弃本次校轴 | 用原始 ASS 重新 `generate`，删除旧隐藏目录 |
| 工作目录被误交付 | 立即停用该稿，重新 generate 并只交付单个占位 ASS |
