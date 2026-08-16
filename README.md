# DSH Minimal First Turn

[中文](#中文说明) | [Installation](#installation)

`dsh-minimal-first-turn` is a DeepSeek Harness Web plugin that makes an enabled
root session's first model request smaller and closer to the official Minimal
preset, without permanently giving up the selected agent preset.

It is inspired by the first-request conditioning work in
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard).
This project is independent, experimental, and not affiliated with DeepSeek.

## What It Does

While **First-turn minimal** is enabled:

1. A new root session's first request uses the Minimal system prompt.
2. The model sees only the official Minimal tool pair: persistent `bash` and
   `str_replace_editor`.
3. Automatic workspace-instruction and skill-catalog messages are removed from
   that request.
4. The first durable `tool/call` or `assistant/message` restores the selected
   preset's original prompt and complete tool catalog.
5. After `compaction/end`, the next request enters the same controlled phase.

The composer contains a persistent **首轮精简** switch. It is global to the
current DSH home, not per-session. Disabling it removes this plugin's
agent-scoped Minimal tools and stops all filtering for future requests.

## Installation

This package targets DSH Web with `@deepseek-ai/*` `0.1.0-rc.6` packages.
A persistent Bash PTY is required, so the current release supports macOS and
Linux hosts; Windows is not supported yet.

```bash
dsh plugin --profile web add dsh-minimal-first-turn
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
pnpm install
pnpm check
npm pack --dry-run
```

For a local Web profile, add the package as a dependency and mount its
`cordis.patch.yml`, then restart `dsh web`. Host changes require a restart;
client-only changes require a page reload when the Web HMR watcher is not
running.

## Compatibility and Caveats

- The plugin changes model-visible first-request conditions. It does not
  guarantee a particular reasoning phrase or outcome.
- Its behavior is intentionally limited to root sessions; subagents keep their
  original catalog.
- The first-turn effect is derived from durable session events, so resume and
  compaction preserve the phase correctly.
- DeepSeek Harness is a developer preview. Pin the supported DSH package
  versions when using this in production.

## License

MIT. The implementation includes derivative work from the MIT-licensed
`dsh-anchored-standard` project and DeepSeek Harness packages; the required
attribution is included in [LICENSE](LICENSE).

## 中文说明

这是一个 DSH Web 插件。开启“首轮精简”后，新根会话的第一轮模型请求会使用
Minimal system prompt、持久 `bash` 与 `str_replace_editor`，并移除自动注入的
工作区说明和技能目录。首次 `tool/call` 或 `assistant/message` 后，当前预设的
完整 prompt 与工具目录恢复；发生上下文压缩后，下一轮会再次进入首轮精简阶段。

它不保证模型输出固定的推理措辞，只控制模型可见的首轮条件。开关是全局持久设置，
而不是单个会话设置。
