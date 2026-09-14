# DSH Minimal First Turn

[中文](#中文说明) | [Installation](#installation)

`@feiyueve/dsh-minimal-first-turn` is a DeepSeek Harness Web plugin that makes
an enabled root session's first turn smaller and closer to the official Minimal
preset, without permanently giving up the selected agent preset.

Fork of [`ZRui-C/dsh-minimal-first-turn`](https://github.com/ZRui-C/dsh-minimal-first-turn),
ported to the local DeepSeek Harness baseline `0.1.5-rc.2-local.5` (see
[CHANGELOG.md](CHANGELOG.md)). It is inspired by the first-request conditioning
work in
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard).
This project is independent, experimental, and not affiliated with DeepSeek.

## What It Does

While **First-turn minimal** is enabled:

1. A new root session's **first turn** is conditioned as a whole: every step it
   takes, and every tool call it makes, uses the Minimal system prompt.
2. During that turn the model sees only the official Minimal tool pair:
   persistent `bash` and `str_replace_editor`.
3. Automatic workspace-instruction and skill-catalog messages are removed from
   those requests.
4. When the next user round opens, the selected preset's original prompt and
   complete tool catalog are injected. The unload is anchored on
   `agent/turn-stopping`, the awaited boundary where the conditioned turn closes,
   because a turn's catalog is collected *before* `agent/pre-step` and
   `system-prompt/assemble` run — unloading from either of those would leave the
   promoted turn's first request assembled with the shadowed shell.
5. The agent-scoped Minimal tools are mounted only while the session is inside
   its conditioned turns, and are unloaded at the handover (or when the switch
   is turned off and the agent goes idle): the pair registers a persistent
   `bash` under the same name as the preset's own shell, so leaving it mounted
   would keep shadowing that shell (and keep `str_replace_editor` in a catalog
   the preset never asked for).
6. The phase is folded from durable `turn/start` events, so resume and reload
   preserve it. A session that has already left its first turn is not
   conditioned again, not even after `compaction/end`.

The composer contains a persistent **首轮精简** switch. It is global to the
current DSH home, not per-session. Disabling it removes this plugin's
agent-scoped Minimal tools and stops all filtering for future requests.

## Installation

This package targets DSH Web with `@deepseek-ai/*` `0.1.5-rc.2-local.5`
packages. A persistent Bash PTY is required, so the current release supports
macOS and Linux hosts; Windows is not supported yet.

```bash
# from the private registry (local builds are published under the @feiyueve scope)
dsh plugin --profile web add @feiyueve/dsh-minimal-first-turn
```

Restart the existing `dsh web` process, then open a conversation. The
**首轮精简** switch appears beside the composer controls.

The toggle state is stored at:

```text
$DSH_HOME/plugins/dsh-minimal-first-turn.json
```

When `DSH_HOME` is unset, the path is `~/.dsh/plugins/dsh-minimal-first-turn.json`.

## Development

```bash
npm run check          # syntax-check both halves
npm pack --dry-run
```

The plugin ships plain JavaScript and declares no runtime dependencies — dsh
resolves every `@deepseek-ai` package from its own installation at runtime — so
there is no install or build step.

For a local Web profile, add the package as a dependency and mount its
`cordis.patch.yml`, then restart `dsh web`. Host changes require a restart;
client-only changes require a page reload when the Web HMR watcher is not
running.

## Compatibility and Caveats

- The plugin changes model-visible first-turn conditions. It does not
  guarantee a particular reasoning phrase or outcome.
- Its behavior is intentionally limited to root sessions; subagents keep their
  original catalog.
- The conditioned window is the session's first turn, however many tool calls
  that turn makes. A session whose first turn never ends stays minimal; the
  handover is tied to the next user round, not to a tool-call counter.
- The first-turn effect is derived from durable session events, so resume and
  compaction preserve the phase correctly. The phase read prefers
  `session.snapshotEvents()` and falls back to the removed `session.events`
  array, so the same build runs on both harness generations.
- DeepSeek Harness is a developer preview. Pin the supported DSH package
  versions when using this in production.

## License

MIT. The implementation includes derivative work from the MIT-licensed
`dsh-anchored-standard` project and DeepSeek Harness packages; the required
attribution is included in [LICENSE](LICENSE).

## 中文说明

这是一个 DSH Web 插件。开启“首轮精简”后，新根会话的**第一轮**（turn）整体走
Minimal system prompt、持久 `bash` 与 `str_replace_editor`：这一轮里模型做多少步、
调多少次工具都保持不变，并移除自动注入的工作区说明和技能目录。等下一轮对话开始时
（turn 2 开轮事件已落盘、该轮首个请求组装之前），当前预设的完整 prompt 与工具目录
注入回来，因此不存在“已恢复但 shell 仍被遮蔽”的中间态。已经离开首轮的会话不会再次
进入精简阶段，压缩之后也不会。

它不保证模型输出固定的推理措辞，只控制模型可见的首轮条件。开关是全局持久设置，
而不是单个会话设置。

首轮的 Minimal 工具对只在会话处于受控轮次时挂载，交接时（或关闭开关且 agent 空闲时）
卸载（`bash` 与所选预设自己的 shell 同名，常驻会一直遮蔽预设的实现）。
