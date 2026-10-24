# CHANGELOG.md 骨架(固定模板)

`vibe-init` 初始化时按本模板创建仓库根 `CHANGELOG.md`。与 `readme-vibe-declaration.md` 同一套思路:模板集中在这里,SKILL.md 只引用,不重复写骨架。

## 使用规则

- 只在用户选择**发版**时创建;答"不发版"时不建 `CHANGELOG.md`,也不写「版本与发布」节。
- 初始内容就是下面的骨架:`## [Unreleased]` 下预置四个空子标题,作为往后追加条目的落点。不预填历史,不臆造条目。`[Unreleased]` 里的空子标题是占位脚手架,可以一直留着。
- 条目写法见 `agents-template.md`「完成定义」第 3 条:按用户可感知的变化写,一次交付一条,不复述提交列表;破坏性改动在条目行尾标 `（Breaking）`。
- 发版时把 `## [Unreleased]` 改成 `## [X.Y.Z] - YYYY-MM-DD`,顶部再补一个新的空 `## [Unreleased]`(同样带四个子标题)。**已定稿的版本章节**里,用不到的空的子标题整段删掉,不留空标题。
- 不用底部版本比较链接(`[X.Y.Z]: .../compare/...`):仓库地址在初始化时可能还不存在,写了就是臆造,且每次发版要同步维护第二处。
- 已发布版本的章节不可修改。

## 模板

```markdown
# Changelog

本文件记录本项目的所有重要变更,格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

### Changed

### Fixed

### Removed
```
