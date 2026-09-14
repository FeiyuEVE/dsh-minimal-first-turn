# Changelog

## 0.2.1 - 2026-09-14

- Port to DeepSeek Harness `0.1.5-rc.2-local.5`; the five `@deepseek-ai`
  peer dependencies are repinned. No behavior change: the `local.5` delta is
  confined to the `tool-bash` / `tool-pwsh` sandbox-escalation path, and this
  plugin's imports (`dsh-terminal`, `dsh-terminal-bash`,
  `dsh-tool-bash-persistent`, `dsh-fs-local`, `dsh-tool-str-replace-editor`)
  keep their service classes, export maps, and the Minimal persistent-bash
  description text the plugin mirrors.

## 0.2.0 - 2026-09-13

- Condition the whole **first turn** instead of the first request: the Minimal
  prompt and the two-tool catalog now cover every step and tool call of turn 1,
  and the selected preset is injected when the next user round opens.
- Derive the phase from `turn/start` events instead of the first `tool/call` or
  `assistant/message`, so the handover is tied to the conversation round rather
  than to a tool-call counter. A session that has left turn 1 is never
  re-conditioned, including after `compaction/end`.
- Move the handover ahead of catalog collection: the Minimal pair is unloaded at
  `agent/turn-stopping`, the awaited boundary that closes the conditioned turn.
  A turn's catalog is collected before `agent/pre-step` and
  `system-prompt/assemble`, so unloading from those left the promoted turn's
  first request carrying the agent-scoped persistent `bash` (shadowing the
  preset's shell) and `str_replace_editor`. Verified with a queued follow-up
  sent mid-turn — turn 2 opens in the same driver loop — where the promoted
  header is now the preset's own 32-tool catalog.
- Fix the mobile composer: on narrow viewports the switch used to wrap the
  toolbar into two rows. It is now registered in two slots and moves out of the
  toolbar into its own row (`conversation.input.dock`) at `max-width: 767px`,
  leaving the native tool buttons on a single row. Desktop keeps the toolbar
  placement.
- Tag the toggle root with its variant class (`dmft-toggle--left` /
  `dmft-toggle--dock`), pin it to `flex: 0 0 auto; min-width: 0`, and hide the
  inactive variant.

## 0.1.1 - 2026-09-13

- Rename the package to `@feiyueve/dsh-minimal-first-turn` for the private
  registry (the bundle patch and client bundle id follow).
- Port to DeepSeek Harness `0.1.5-rc.2-local.4`; peer dependencies repinned.
- Read durable events through `session.snapshotEvents()`, falling back to the
  removed `session.events` array (dropped in harness 0.1.3-alpha.1).
- Unload the agent-scoped Minimal tool pair once a promoted agent next goes
  idle, so the persistent `bash` stops shadowing the selected preset's own
  shell and `str_replace_editor` leaves the restored catalog.
- Mount the pair lazily per root session (never for subagents) and track the
  bootstrap phase from durable events regardless of the toggle, so flipping the
  switch on mid-session cannot re-minimize an already-promoted session.
- Track the current `minimal` preset's persistent-bash description text.
- Declare no runtime dependencies (dsh resolves `@deepseek-ai` packages from its
  own install), dropping the stale `0.1.0-rc.6` devDependencies and lockfile.

## 0.1.0 - 2026-08-15

- Initial public release.
- Adds Minimal-compatible first-request conditioning for DSH Web root sessions.
- Adds a persistent composer switch labelled `首轮精简`.
- Restores the selected preset after the first durable model response or tool call.
