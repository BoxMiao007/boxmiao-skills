# boxmiao-skills

boxmiao 的 agent skills 集合。`skills/` 下每个子目录是一个独立的 skill,复制到 agent 的 skills 目录即可使用。

## Skills

### [vibe-init](skills/vibe-init/)

全新项目(空目录 / 空仓库)的 Vibe Coding 开发规则初始化:git 仓库、`.gitignore`、仓库根 `AGENTS.md` 协作契约(用户只提需求,AI agent 全权实现、验证、交付),README 顶部写入「AI Agent 开发声明」。不选技术栈、不搭骨架、不做需求规划。

### [vibe-fork-init](skills/vibe-fork-init/)

既有仓库(fork 或非 fork)的 Vibe Coding 接管:从 CI 配置等收集验证门命令写入 `AGENTS.md`(初始化只跑查询类快速命令,构建、测试等耗时命令不跑;含协作模式、完成定义、提交与推送策略等);fork 仓库额外配置 `upstream` 远程、分支模型、上游同步流程与冲突解决规则。可选 README 顶部 AI Agent 开发声明。

## 使用

把 skill 目录复制到 agent 的 skills 目录,启动时自动发现:

```bash
cp -r skills/vibe-init ~/.agents/skills/
```

## 目录结构约定

每个 skill 一个目录,必须包含 `SKILL.md`(frontmatter 写 `name` 与 `description`,正文是执行说明);可选 `references/` 存放模板和参考文件。skill 内的模板不复制用户全局规则,只写项目特有约定。
