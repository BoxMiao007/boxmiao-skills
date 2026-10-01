# README「AI Agent 开发声明」(固定模板)

本文件是唯一模板来源。fork 仓库用 fork 版(含功能清单块),非 fork 仓库用通用版;同一仓库只用一种。要改措辞只改这里,不改 SKILL.md。

## 插入规则

- **版本选择**:fork 仓库用 fork 版;非 fork 仓库用通用版。
- **位置**:README.md 文件顶部(插在现有内容之前,包括一级标题之前);fork 的功能清单块紧接在声明块下方。
- README.md 不存在:先问用户是否创建,不要默认创建。
- **去重**:README 里已存在 `vibe-coding-declaration` 标记块时跳过插入,不重复添加。
- 块必须用成对 HTML 注释标记包裹(声明块 `vibe-coding-declaration:begin` / `:end`,fork 功能清单块 `vibe-feature-registry:begin` / `:end`)。上游同步时 README 若冲突,机械解决:**标记块整体保留,其余部分取上游**。
- 语言:默认简体中文;若该仓库 README 主语言是英文,问用户要不要英文版,译文仍用同一对标记包裹。

## 通用版模板(非 fork 仓库)

<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> 本仓库由 AI 开发与维护，所有代码变更均由 AI 执行。
<!-- vibe-coding-declaration:end -->

## fork 版模板(fork 仓库用)

<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> 本仓库由 AI 开发与维护，所有代码变更均由 AI 执行。
<!-- vibe-coding-declaration:end -->

<!-- vibe-feature-registry:begin -->
## 本 Fork 功能清单

| 功能 | 一句话说明 | 关键文件/入口 | 引入提交 |
| ---- | ---------- | -------------- | -------- |
| (暂无登记,第一个功能合入时添加) | | | |
<!-- vibe-feature-registry:end -->
