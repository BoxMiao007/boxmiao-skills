# README「Vibe Coding 开发」声明(固定模板)

本文件是唯一模板来源。fork 仓库用 fork 版(含功能清单块),非 fork 仓库用通用版;同一仓库只用一种。要改措辞只改这里,不改 SKILL.md。

## 插入规则

- **版本选择**:fork 仓库用 fork 版;非 fork 仓库用通用版。
- **位置**:README.md 文件顶部(插在现有内容之前,包括一级标题之前);fork 的功能清单块紧接在声明块下方。
- README.md 不存在:先问用户是否创建,不要默认创建。
- **去重**:README 里已存在 `vibe-coding-declaration` 标记块时跳过插入,不重复添加。
- 块必须用成对 HTML 注释标记包裹(声明块 `vibe-coding-declaration:begin` / `:end`,fork 功能清单块 `vibe-feature-registry:begin` / `:end`)。上游同步时 README 若冲突,机械解决:**标记块整体保留,其余部分取上游**。
- 语言:默认简体中文;若该仓库 README 主语言是英文,问用户要不要英文版,译文仍用同一对标记包裹。
- 块内链接了 `AGENTS.md`,因此必须在 AGENTS.md 写好之后执行。
- fork 功能清单块是**给人看的镜像**,唯一事实源是 AGENTS.md 的「功能清单」节:登记/移除功能时,在 AGENTS.md 和本标记块同步更新(规则写在 AGENTS.md 里)。agent 需要功能信息时只读 AGENTS.md,不要引导 agent 读 README——README 是给人看的界面,读它会白白占用上下文。

## 通用版模板(非 fork 仓库)

<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> **Vibe Coding 开发声明**
>
> 本仓库以 Vibe Coding 方式开发维护:
>
> - 所有代码变更均由 AI agent 执行
> - 协作模式、完成定义、验证门等开发约定见 [AGENTS.md](AGENTS.md)
<!-- vibe-coding-declaration:end -->

## fork 版模板(fork 仓库用)

<!-- vibe-coding-declaration:begin -->
> [!IMPORTANT]
> **Vibe Coding 开发声明**
>
> 本仓库是个人 fork，以 Vibe Coding 方式开发维护:
>
> - 所有代码变更均由 AI agent 执行
> - 分支模型、上游同步、冲突处理等约定见 [AGENTS.md](AGENTS.md)
> - 本 fork 自有功能见下方「本 Fork 功能清单」
<!-- vibe-coding-declaration:end -->

<!-- vibe-feature-registry:begin -->
## 本 Fork 功能清单

本 fork 相对上游的自有功能;约定见 [AGENTS.md](AGENTS.md)。

| 功能 | 一句话说明 | 关键文件/入口 | 引入提交 |
| ---- | ---------- | -------------- | -------- |
| (暂无登记,第一个功能合入时添加) | | | |
<!-- vibe-feature-registry:end -->
