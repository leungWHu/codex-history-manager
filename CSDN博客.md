# Codex 历史会话删除工具

> 本工具适用于 Windows、Linux / Ubuntu
 
项目地址：[leungWHu/codex-history-manager](https://github.com/leungWHu/codex-history-manager)

最近在 Windows 上使用 Codex 时，遇到一个挺容易被忽略的问题：通过 Desktop、VS Code、Cmd 等不同入口开启过 Codex 对话后，如果只是临时对话且关闭窗口，后面就很容易忘记这些历史会话到底在哪里。

更麻烦的是，不同入口产生的记录并不总是能在同一个界面里完整显示。例如 **Desktop 端无法看到从 VS Code 或 Cmd 里开启过的全部对话**。对熟悉命令行和 Codex 数据结构的程序员来说，这可能不是大问题；但对 Codex 小白用户或非程序员来说，想安全清理历史记录就不太友好。

于是我做了一个小工具：**Codex History Manager**。它是一个本地运行的 Codex 历史会话删除工具，只需要启动一个Python工具，可以在浏览器里集中查看、搜索和删除本机 Codex 历史会话。

## 适合谁使用

先说明一下边界：如果你是高级程序员，熟悉 Codex CLI，建议优先使用 Codex 官方内置的归档或删除方式。例如用 `/archive` 或 `codex archive` 隐藏会话但保留 transcript；确认不再需要时，再用 `/delete` 或 `codex delete` 永久删除会话。

这个工具更适合下面这类用户：

- 主要在 Windows 上使用 Codex
- 不熟悉 `.codex` 目录结构
- 不想手动查找 `jsonl`、SQLite、索引文件
- 曾经通过 Desktop、VS Code、cmd 等多个入口开启过对话
- 想用网页界面确认会话内容后再删除

它的目标不是替代官方归档和删除入口，而是给普通用户提供一个更直观的本地辅助界面。

## 使用教程

Windows 用户可以下载项目后双击运行：

```text
start_windows.bat
```

也可以直接运行：

```bash
python server.py
```

更详细的启动方式、参数说明和项目结构，或者在Linux / Ubuntu中使用，可以查看 GitHub README，项目下载地址：

[leungWHu/codex-history-manager](https://github.com/leungWHu/codex-history-manager)
## 它能做什么

工具启动后，会在本机开启一个 Web 页面，默认只监听 `127.0.0.1`。页面会读取本机 Codex 历史数据，并按项目目录、临时会话、归档会话等方式整理出来。

主要功能包括：

- 查看本机 Codex 历史会话
- 按项目目录自动分组
- 搜索会话标题、工作目录和首条用户消息
- 查看会话创建时间、更新时间、消息数量和文件路径
- 展示用户消息、处理过程、最终回复等内容
- 删除单个会话或整个分组的会话
- 删除前生成清理计划并要求二次确认

对 Codex 小白用户来说，最有用的是两点：**集中查看**和**安全删除**。

集中查看可以避免在 Desktop、VS Code、命令行之间来回找记录；安全删除则避免了直接手动删除 `.codex` 文件时的不确定性。

## 界面预览

会话列表和分组视图：

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/184b1f623ade46a4818bc37f0a178d8c.png)


删除前的二次确认：

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/cf891620742d4df789c83d03eeb541ee.png#pic_center)



## 为什么不建议直接删会话sesson

Codex 的历史数据不只是一份文本文件。一个会话可能同时出现在会话 `jsonl`、索引文件、SQLite 数据库、全局状态文件和 shell snapshot 等多个位置。

如果只删掉其中一部分，界面或索引里可能还会残留引用；如果手动删错文件，又可能影响其他会话。

因此这个工具在删除时做了一些保护：

- 校验会话 ID
- 确认会话文件位于 Codex 数据目录内
- 拒绝删除当前正在运行的会话
- 删除前展示预计清理内容
- 单个会话删除需要输入短 ID
- 分组删除需要输入固定确认文本
- 删除后再次检查残留引用



## 使用提醒

这个工具只在本机读取 Codex 历史数据，不会上传到远程服务。

不过，删除操作会修改 `.codex` 里的本地数据文件，而且删除后不可撤销。

另外，删除 Codex 历史会话不会删除你的项目目录，也不会删除项目里的代码文件，可放心使用。

## 总结

Codex History Manager 是一个很小的本地工具，主要解决普通 Windows 用户在多个入口使用 Codex 后，历史会话不好集中查看和删除的问题。

如果你熟悉命令行，官方内置的归档和删除方式仍然是首选；如果你只是想通过一个网页界面看清楚本机 Codex 历史，并谨慎清理不需要的会话，这个工具会更直观一些。
