# boxmiao-skills

boxmiao 的 agent skills 集合。`skills/` 下每个子目录是一个独立的 skill,复制到 agent 的 skills 目录即可使用。

## Skills

### [vibe-init](skills/vibe-init/)

全新项目(空目录 / 空仓库)的 Vibe Coding 开发规则初始化:git 仓库、`.gitignore`、仓库根 `AGENTS.md` 协作契约(用户只提需求,AI agent 全权实现、验证、交付)、前端调试不干扰用户等开发规范,以及版本与发布规则(SemVer 2.0.0 机械递增、Conventional Commits 前置约定、本地 annotated tag 闸门、GitHub Release 记录变更)与 README 顶部的「AI 开发声明」。不选技术栈、不搭骨架、不做需求规划。

### [vibe-fork-init](skills/vibe-fork-init/)

既有仓库(fork 或非 fork)的 Vibe Coding 接管:从 CI 配置等收集验证门命令写入 `AGENTS.md`(初始化只跑查询类快速命令,构建、测试等耗时命令不跑;含协作模式、完成定义、前端调试不干扰用户、提交与推送策略等);fork 仓库额外配置 `upstream` 远程、分支模型、上游同步流程、冲突解决规则与发布版本命名(fork 发布版本号带 `-fork.数字` 后缀,基于上游未发布代码的发布标预发布加 `-pre.日期`,Release 标题标注 fork/upstream 来源)。可选 README 顶部 AI 开发声明。

### [ui-design-guidelines](skills/ui-design-guidelines/)

界面外观与样式调整默认遵循的设计准则:变动数值保持等宽、嵌套圆角同心、标题平衡换行、柔和阴影替代硬边框,以及用视觉层级和自解释结构代替冗余说明文字,同时保留必要标签与危险操作提示。只描述视觉结果与判据,不绑定具体技术栈;新建组件与样式重写时默认按此检查,并附交付核对清单;Web 实现示例放在 references 下按需读取。

### [add-chinese-triggers](skills/add-chinese-triggers/)

给已有 skill 的 description 追加中文触发,让中文用户的说法也能触发它:只改 description 里的中文段,不动 `name`、英文原文、正文与其它 frontmatter。格式统一为「<英文原文> <中文意图>时使用。」,中文意图写「意图 + 同义词」(如"查/排查难 bug、性能回归、报错"),比列举用户原话省约 72% 的 token 且覆盖更宽;description 本身已是中文的 skill 默认跳过。附带三个脚本:`apply_cn_triggers.py`(幂等落地,支持无引号/单引号/双引号/`>`/`|`,保留引号风格与 LF/CRLF 行尾,遇英文残留或行内注释会拒改)、`verify_descriptions.py`(带 baseline 时逐字节确认英文与正文没被动)、`measure_tokens.py`(量 token 增量)。

## 使用

把 skill 目录复制到 agent 的 skills 目录,启动时自动发现:

```bash
cp -r skills/vibe-init ~/.agents/skills/
```

## 目录结构约定

每个 skill 一个目录,必须包含 `SKILL.md`(frontmatter 写 `name` 与 `description`,正文是执行说明);可选 `references/` 存放模板与参考文件,`scripts/` 存放可执行脚本(脚本不进上下文,由正文按需调用)。skill 内的模板不复制用户全局规则,只写项目特有约定。
