# 提 PR 到 awesome-dsh-plugin

仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin

市场（dshmarket）**不读我们的仓库**，只读这个精选列表；列表合并后 CI 每天刷新
npm 上的 `dsh-plugin-catalog`，市场与发现页就自动出现了。

## 步骤

1. 打开上面的仓库，点 **Fork**
2. 在自己的 fork 里编辑 `README.md`，按现有条目的格式加一行（下面的内容就是为它准备的）
3. 提 Pull Request，标题：`Add dsh-progress-report`
4. 描述里写上「插件已在 npm 发布」+ npm 链接

## 要加进 README 的内容

先在页面里找一条现成的、**带 npm 包**的插件条目，照它的写法（列表项还是表格行、
链接怎么排）复制一行改内容。文字部分可以直接用：

- 包名：`dsh-progress-report`
- 仓库：`https://github.com/<你的GitHub用户名>/dsh-progress-report`
- npm：`https://www.npmjs.com/package/dsh-progress-report`

中文一句话：

> 长任务期间按时间强制模型汇报进度：到点就在下一次工具调用前塞一条「进度 x/y」
> 检查点。不靠模型自觉，不受上下文压缩影响，零依赖，带设置页。

英文一句话：

> Forces periodic progress reports during long tasks: a checkpoint lands in the
> model's next turn every N minutes. Compression-proof, zero dependencies,
> with a settings page.

分类建议：`tools`（工具与能力）。

## PR 描述模板

```markdown
## Add dsh-progress-report

- npm: https://www.npmjs.com/package/dsh-progress-report
- repo: https://github.com/<你的GitHub用户名>/dsh-progress-report

Makes long-running dsh tasks report progress on a configurable interval
(default 10 min, plus a tool-call fallback). Implemented as a
`tools/post-execute` hook that injects a `form: "notice"` checkpoint into the
next turn — it does not rely on model discipline and is unaffected by context
compression. Zero dependencies (only `node:*`), ships a settings page under
**Settings › Progress report**.
```

## 合并之后

CI 生成条目后，市场里能搜到、能一键装。更新插件只要 `npm publish` 新版本，
目录那边按 npm 版本号走，不用再提 PR。
