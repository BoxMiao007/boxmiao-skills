---
name: add-chinese-triggers
description: 给已有 skill 的 description 追加中文触发，让中文用户的说法也能命中它。当用户说"给这些 skill 补中文触发""让中文用户也能触发""description 加中文""批量改 skill 描述""核算中文触发的 token 成本"，或在几十个 SKILL.md 里批量改 description、又怕改坏英文和正文时使用。不适用于：从零创建 skill、把中文 description 翻成英文、description 本身已是中文的 skill。
---

# 给 skill 描述补充中文触发

给一批英文 `SKILL.md` 的 `description` 追加一句中文触发，让中文用户的说法也能命中这些 skill。
改动面极小（只碰 description 里的中文段），但因为要动几十个文件，所以**每一步都要能被机器验证**。

## 三条硬约束

用户几乎每次都会提这三条，先默认遵守：

1. **`name` 一个字母都不改**——它是 skill 的唯一标识，改了等于改名。
2. **`description` 的英文原文保留**，中文只能追加在它**后面**，不能翻译、不能删、不能移位。
3. **正文一个字节都不动**——标题层级、列表、表格、代码块、命令、路径、参数、文件名全部原样。

第四条经验规则：**`description` 里已经有中文的 skill 直接跳过**。它已经能接住中文请求了，再追加只是重复占用 token。

## 输出格式

```
<英文原文> <中文意图>时使用。
```

**示例**

```yaml
# 改前
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.

# 改后
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests. 测试先行、红绿重构、补集成测试时使用。
```

不要加 `中文：` 之类的前缀（白花 token），也不要写成"当用户…时使用。中文触发词包括：A、B、C。"——原因见下。

### 为什么是"意图 + 同义词"，不是"列举用户原话"

同一个意图，用户有很多种说法：审 / 评审 / 看看 / 挑毛病 / 过一遍。**列举具体句子只能命中你想到的那几种**，而写"意图 + 同义词"能让模型按语义匹配，覆盖面反而更宽：

| 写法 | 内容 | 成本 |
|---|---|---|
| 列举原话 | `当用户撰写 PR 正文时使用。中文触发词包括：写 PR 描述、生成 PR 正文、润色已有的 PR 描述。` | 贵，且换一种说法就漏 |
| 意图 + 同义词 | `写/改 PR 正文时使用。` | 约 1/4 成本，`写 PR 描述`、`改一下 PR body` 都沾得到 |

实测（22 个 skill、`o200k_base`）：列举式让总 token 从 1,180 涨到 2,841，意图式只涨到 1,649——**省掉 72% 的增量**。

## 中文意图怎么写

- 写**这个 skill 管什么事**，不写"用户会怎么说"。
- 2–5 个同义词用 `/` 并列：`审/评审`、`查/排查`、`画/做`、`建/改/优化`、`找/装`。
- 英文技术名词保留原样：`.canvas`、`AGENTS.md`、`CI secrets`、`Result`、`Defuddle`。
- 一句话，尽量 ≤ 40 字符；用顿号分列举，用分号分并列的语义块。
- 不以拉丁字母结尾就直接接 `时使用。`；以拉丁字母结尾时补一个空格（`…调 description 时使用。`）。
- 忠实于英文原文的**范围**：英文说"deepening opportunities"就不要写成"重构"（那是更大的集合，会误触发）。

同义词库与常见错误见 `references/format-guide.md`。

## 工作流

### 1. 盘点：把目标目录的 skill 分成四类

Windows PowerShell 不支持 heredoc，把下面这段存成 `inventory.py` 再 `python inventory.py`：

```python
import os, re, yaml
for d in sorted(os.listdir(".")):
    p = os.path.join(d, "SKILL.md")
    if not os.path.isfile(p):
        continue
    fm = open(p, encoding="utf-8").read().split("\n")
    end = next(i for i in range(1, len(fm)) if fm[i].strip() == "---")
    meta = yaml.safe_load("\n".join(fm[1:end])) or {}
    desc = str(meta.get("description") or "")
    kind = ("无 description" if not desc
            else "含中文→跳过" if re.search(r"[\u4e00-\u9fff]", desc)
            else "纯英文→待改")
    print(f"{d:32} {kind}")
```

- **纯英文** → 要改
- **已含中文** → 跳过（除非用户明确要求把已有的中文也换成新格式）
- **无 `description` 字段** → 跳过，**不要凭空新建这个字段**
- `disable-model-invocation: true` → 照样可以加（人读 description 也用得上），但要提醒用户：这类 skill 模型永远不会自动触发，中文只对**读描述的人**有用

### 2. 起草对照表

写一个 YAML，键是目录名，值是中文意图（**不要**带结尾的"时使用。"）：

```yaml
# 键 = 你目录下的 skill 名，值 = 中文意图
pr: 写/改 PR 正文
tdd: 测试先行、红绿重构、补集成测试
diagnosing-bugs: 查/排查难 bug、性能回归、报错、变慢的根因
```

### 3. 落地（不要手改 YAML）

先在**动手前**做快照，后面第 4 步要靠它证明没改坏：

```bash
cp -r <目标目录> <快照目录>
```

然后应用对照表：

```bash
python scripts/apply_cn_triggers.py --skills-dir <目标目录> --map intents.yaml --dry-run   # 先看会改什么
python scripts/apply_cn_triggers.py --skills-dir <目标目录> --map intents.yaml
```

脚本只替换 description 里的**中文尾段**：英文原文、引号风格、块标量（`>` / `|`）结构、行尾（LF/CRLF）、BOM 都原样保留（同一个文件里混用两种行尾时，会统一成占多数的那种并在输出里提示）；幂等，重复跑不会二次改动。

它会**拒改**这些情况（判 FAIL 而不是硬改）：中文尾段里还残留英文内容（会被删掉）、行尾有 YAML 行内注释、多行普通标量、intent 为空、map 键含路径分隔符、文件不是 UTF-8、YAML 解析失败、找不到文件。替换掉旧中文尾段时，`OK` 行会回显被替换掉的内容，不留静默删除。description 已是中文又确实要换格式时，加 `--force-chinese`。

### 4. 校验（必须全绿才算完成）

```bash
python scripts/verify_descriptions.py --skills-dir <目标目录> --baseline <快照目录> --require-suffix
```

它逐字节比对：`name`/正文/其它 frontmatter 键是否原样、差异是否只落在 description、YAML 是否可解析、英文前缀是否保留、有无 BOM 与行尾变化。

`--baseline` 指向的目录里缺某个 skill 时，脚本会判失败而不是静默跳过；没有 baseline 就只做结构校验——"正文没被改坏"这件事必须有快照或 git 才能证明。

### 5. 量成本

```bash
python scripts/measure_tokens.py --skills-dir <目标目录> --baseline <改动前快照>
```

需要 `tiktoken`（`pip install tiktoken`）。同时报 `o200k_base` 与 `cl100k_base`；没有 tiktoken 时退化为字符数统计，并明确标注"不是 token"。

### 6. 回归评测（改了几十个 skill 时强烈建议）

追加中文是为了"更容易被触发"，那就得证明没把触发搞坏。做法见 `references/format-guide.md` 的「回归评测」一节：一批正例（用户真会说的话）+ 一批反例（容易被误吸的邻近请求），改前改后各跑一次比对分数。

## 验收清单

- [ ] 每个目标 skill 只有 `description` 一处变化
- [ ] `verify_descriptions.py` 全绿
- [ ] 英文原文未被改动（apply 按整段英文前缀比对；verify 比对时会把连续空白归一化）
- [ ] 已含中文的 description 一行未动
- [ ] 没有 `description` 的文件没有被新建该字段
- [ ] 末尾统一为 `时使用。`
- [ ] token 增量已量出并告知用户
- [ ] 有 baseline 快照可回滚

## 参考

- `references/format-guide.md`：同义词库、token 实测数据、回归评测设计、常见错误
