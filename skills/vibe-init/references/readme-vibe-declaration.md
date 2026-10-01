# README「Vibe Coding 开发」声明——通用版(固定模板)

本文件是唯一模板来源:所有新项目的 README 声明都用下面这段原文,保证各仓库一致。要改措辞只改这里,不改 SKILL.md。

## 插入规则

- **位置**:README.md 顶部(插在一级标题之前)。
- 新项目的 README 随初始化一起创建,声明块固定写入,不作为询问项;README 正文只写已知信息,未知处标注待补全,由后续开发回填。
- 必须用成对 HTML 注释标记包裹(`vibe-coding-declaration:begin` / `:end`),便于日后机械更新或移除。
- 语言:默认简体中文;若用户要求英文项目,问要不要英文版,译文仍用同一对标记包裹。
- 块内链接了 `AGENTS.md`,因此必须在 AGENTS.md 写好之后执行。

## 模板

<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> **Vibe Coding 开发声明**
>
> 本仓库以 Vibe Coding 方式开发维护:
>
> - 所有代码变更均由 AI agent 执行
> - 协作模式、完成定义、验证门等开发约定见 [AGENTS.md](AGENTS.md)
<!-- vibe-coding-declaration:end -->
