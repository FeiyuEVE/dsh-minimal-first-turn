# Changelog

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
