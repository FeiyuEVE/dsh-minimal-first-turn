import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as terminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as persistentBash from '@deepseek-ai/dsh-tool-bash-persistent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as strReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'

const PLUGIN_ID = 'dsh-minimal-first-turn'
const BOOTSTRAP_TOOLS = new Set(['bash', 'str_replace_editor'])
// How many leading turns the Minimal conditioning owns. The session's *first
// turn* is conditioned as a whole — every step it takes and every tool it calls,
// however many that is — and the next user round gets the selected preset back.
const MINIMAL_TURNS = 1
const SUPPRESSED_SOURCES = new Set(['agent-instructions', 'skill-catalog'])
const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'
const BASH_TIMEOUT_MS = 300_000
const STATE_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', `${PLUGIN_ID}.json`)
const TEMP_STATE_PATH = `${STATE_PATH}.tmp`
const STATE_ENDPOINT = '/minimal-first-turn/state'

export const name = PLUGIN_ID
export const inject = ['agents', 'webServer']

// Byte-identical to the `minimal` agent preset's persistent-bash description in
// the supported harness version: the first-request tool schema is the lever
// this plugin exists to control, so it must track the official Minimal text.
const PERSISTENT_BASH_DESCRIPTION = [
  'Run commands in a bash shell',
  '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
  '* Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.',
  '* State is persistent across command calls and discussions with the user.',
  "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
  '* Please avoid commands that may produce a very large amount of output.',
  "* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.",
].join('\n')

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && typeof parsed.enabled === 'boolean'
      ? { enabled: parsed.enabled }
      : { enabled: true }
  } catch {
    return { enabled: true }
  }
}

function persistState(enabled) {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(TEMP_STATE_PATH, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8')
  renameSync(TEMP_STATE_PATH, STATE_PATH)
}

/**
 * Read this session's durable events.
 *
 * dsh 0.1.3-alpha.1 removed the public `session.events` array in favor of
 * `snapshotEvents()`; both stay behind a feature probe so the phase machine
 * works on either harness generation.
 * @param session - the agent's live session.
 * @returns durable events in log order.
 */
function durableEvents(session) {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return session.events ?? []
}

/**
 * Fold the bootstrap phase from durable events: the phase is promoted as soon as
 * a turn beyond {@link MINIMAL_TURNS} opens, so the whole first turn stays
 * minimal and the handover happens exactly when the next user round begins.
 * Because `turn/start` is appended before that turn's first step is assembled,
 * resume, reload and compaction all preserve the phase.
 * @param session - the agent's live session.
 * @returns whether the session has left its conditioned turns.
 */
function phaseFromEvents(session) {
  for (const event of durableEvents(session)) {
    if (event.type !== 'turn/start') continue
    if (Number(event.data?.turn ?? 1) > MINIMAL_TURNS) return { promoted: true }
  }
  return { promoted: false }
}

function createBootstrapPairPlugin() {
  return {
    name: 'minimal-first-turn-tool-pair',
    async apply(agentCtx) {
      const bootstrapCtx = agentCtx.isolate('terminals').isolate('fs')
      await bootstrapCtx.plugin(TerminalSessionService)
      await bootstrapCtx.plugin(terminalBash, { timeoutMs: BASH_TIMEOUT_MS })
      await bootstrapCtx.plugin(persistentBash, {
        timeoutMs: BASH_TIMEOUT_MS,
        description: PERSISTENT_BASH_DESCRIPTION,
      })
      await bootstrapCtx.plugin(LocalFileSystem, {
        cwd: process.env.DSH_CWD ?? process.cwd(),
      })
      await bootstrapCtx.plugin(strReplaceEditor, { maxOutputChars: 16000 })
    },
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

async function readJsonBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw.length === 0 ? null : JSON.parse(raw)
}

function hasTrustedOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function apply(ctx) {
  let enabled = readState().enabled
  let updateQueue = Promise.resolve()
  const mounts = new Map()
  const phases = new Map()
  const warned = new Set()

  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    ctx.logger.warn(message)
  }

  const isSubagent = (agent) => (agent.session?.header?.delegationDepth ?? 0) > 0

  /** The live agent owning a durable event's session, if it is still registered. */
  const agentForSession = (session) => {
    for (const agent of ctx.agents.list()) {
      if (agent.session?.id === session.id) return agent
    }
    return undefined
  }

  const phaseFor = (agent) => {
    if (agent === undefined || agent.session === undefined) return { promoted: true }
    const id = agent.session.id
    const existing = phases.get(id)
    if (existing !== undefined) return existing
    const phase = isSubagent(agent) ? { promoted: true } : phaseFromEvents(agent.session)
    phases.set(id, phase)
    return phase
  }

  /** Whether this agent still owes its minimal first request. Subagents never do. */
  const needsBootstrap = (agent) => enabled && phaseFor(agent).promoted === false

  const mountPair = (agent) => {
    if (!enabled) return undefined
    const existing = mounts.get(agent)
    if (existing !== undefined) return existing

    let fiber
    try {
      fiber = agent.ctx.plugin(createBootstrapPairPlugin())
    } catch (error) {
      warnOnce(`mount:${agent.id}`, `${PLUGIN_ID}: Minimal tools unavailable for agent ${agent.id}: ${String(error?.message ?? error)}`)
      const failed = { ready: false, failed: true, fiber: undefined, promise: Promise.resolve() }
      mounts.set(agent, failed)
      return failed
    }

    const mount = { ready: false, failed: false, fiber, promise: undefined }
    mounts.set(agent, mount)
    mount.promise = Promise.resolve(fiber).then(
      () => { mount.ready = true },
      (error) => {
        mount.failed = true
        warnOnce(`mount:${agent.id}`, `${PLUGIN_ID}: Minimal tools unavailable for agent ${agent.id}: ${String(error?.message ?? error)}`)
      },
    )
    return mount
  }

  const unmountPair = async (agent, mount) => {
    mounts.delete(agent)
    if (mount?.fiber === undefined) return
    try {
      await mount.fiber.dispose()
    } catch (error) {
      warnOnce(`unmount:${agent.id}`, `${PLUGIN_ID}: failed to unload Minimal tools for agent ${agent.id}: ${String(error?.message ?? error)}`)
    }
  }

  /**
   * Make the mounted pair match the durable phase, from a request-time hook.
   *
   * This is the mount path (a session that starts conditioned needs the pair
   * before its first assembly) and the backstop for the handover: if the pair is
   * somehow still mounted on a promoted request, unload it before
   * `next()` computes anything. The handover itself is anchored earlier — see
   * {@link releaseAtTurnBoundary} — because a turn's catalog is collected before
   * this waterfall runs at all.
   * @param agent - the agent whose catalog is about to be assembled.
   * @returns the live mount while the session is still conditioned, else undefined.
   */
  const reconcilePair = async (agent) => {
    if (needsBootstrap(agent)) {
      const mount = mountPair(agent)
      if (mount !== undefined && !mount.ready && !mount.failed) await mount.promise
      return mount
    }
    const mount = mounts.get(agent)
    if (mount !== undefined) await unmountPair(agent, mount)
    return undefined
  }

  /**
   * Unload the pair ahead of the handover.
   *
   * The next turn's catalog is collected *before* `agent/pre-step` and
   * `system-prompt/assemble` run, so unloading from either of those is too late:
   * the promoted turn would still be assembled with the agent-scoped persistent
   * `bash` shadowing the preset's own shell and with `str_replace_editor` in the
   * catalog. `agent/turn-stopping` is dispatched (and awaited) while the last
   * conditioned turn closes, which is the last boundary before that assembly.
   * @param agent - the agent whose conditioned turn is closing.
   */
  const releaseAtTurnBoundary = async (agent) => {
    const mount = mounts.get(agent)
    if (mount === undefined) return
    await unmountPair(agent, mount)
  }

  /**
   * Drop the bootstrap pair once the session no longer needs it. Never runs
   * while the session is still conditioned; the common handover is already done
   * by {@link releaseAtTurnBoundary} or {@link reconcilePair}, and this remains
   * the eager path for a toggle that is switched off while the agent is idle.
   */
  const releaseWhenIdle = (agent) => {
    if (needsBootstrap(agent)) return
    void Promise.resolve(agent.whenIdle()).then(() => {
      if (needsBootstrap(agent)) return
      const mount = mounts.get(agent)
      if (mount === undefined) return
      void unmountPair(agent, mount)
    }).catch(() => {})
  }

  const enableForLiveAgents = async () => {
    const pending = []
    for (const agent of ctx.agents.list()) {
      if (!needsBootstrap(agent)) continue
      const mount = mountPair(agent)
      if (mount?.promise !== undefined) pending.push(mount.promise)
    }
    await Promise.all(pending)
  }

  const setEnabled = (nextEnabled) => {
    const operation = updateQueue.then(async () => {
      if (nextEnabled === enabled) return { enabled }
      enabled = nextEnabled
      persistState(enabled)
      if (enabled) await enableForLiveAgents()
      else for (const agent of [...mounts.keys()]) releaseWhenIdle(agent)
      return { enabled }
    })
    updateQueue = operation.catch(() => {})
    return operation
  }

  ctx.on('agent/created', ({ agent }) => {
    if (needsBootstrap(agent)) mountPair(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    phases.delete(agent.session.id)
    mounts.delete(agent)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    releaseWhenIdle(agent)
  })

  ctx.on('session/event', (session, event) => {
    const phase = phases.get(session.id)
    if (phase === undefined || phase.promoted) return
    if (event.type === 'turn/start') {
      // Appended before this turn's first step is assembled, so the handover is
      // in place for the very request that opens the next user round.
      if (Number(event.data?.turn ?? 1) <= MINIMAL_TURNS) return
      phases.set(session.id, { promoted: true })
      return
    }
    // A conditioned turn that closes without a stop boundary (abort, error)
    // still ends the conditioning: start the unload as early as we can. The
    // awaited path is `agent/turn-stopping` below.
    if (event.type !== 'turn/end' || Number(event.data?.turn ?? 1) > MINIMAL_TURNS) return
    const agent = agentForSession(session)
    if (agent !== undefined) void releaseAtTurnBoundary(agent).catch(() => {})
  })

  // The awaited handover. `agent/turn-stopping` is dispatched with `serial` mode
  // while the last conditioned turn closes, and the loop waits for it — so the
  // pair is gone before that turn's `turn/end` and well before the next turn's
  // catalog is collected. If queued next-step input continues the same turn
  // instead, the remaining steps simply assemble without the pair (the missing
  // bootstrap tools fall back to the selected preset, as logged).
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    if (turn > MINIMAL_TURNS) return
    await releaseAtTurnBoundary(agent)
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const mount = await reconcilePair(agent)
    const decision = await next()
    if (mount?.ready !== true || !needsBootstrap(agent)) return decision
    if (!Array.isArray(decision.messages)) return decision

    const messages = decision.messages.filter((message) => !SUPPRESSED_SOURCES.has(message?.source?.kind))
    return messages.length === decision.messages.length ? decision : { ...decision, messages }
  }, { prepend: true })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent
    if (agent === undefined) return next()

    const mount = await reconcilePair(agent)
    const assembled = await next()
    if (mount?.ready !== true || !needsBootstrap(agent)) return assembled

    const available = new Set(assembled.tools.map((tool) => tool.name))
    const missing = [...BOOTSTRAP_TOOLS].filter((tool) => !available.has(tool))
    if (missing.length > 0) {
      warnOnce(`catalog:${agent.id}`, `${PLUGIN_ID}: Missing bootstrap tools ${JSON.stringify(missing)} for agent ${agent.id}; using the original catalog.`)
      return assembled
    }

    return {
      ...assembled,
      sections: [{ name: 'minimal-first-turn:persona', text: MINIMAL_PERSONA }],
      contexts: [],
      tools: assembled.tools.filter((tool) => BOOTSTRAP_TOOLS.has(tool.name)),
    }
  }, { prepend: true })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_ENDPOINT,
    handler: async (req, res) => {
      if (!hasTrustedOrigin(req)) {
        sendJson(res, 403, { error: 'untrusted-origin' })
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { enabled })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body === null || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'enabled must be a boolean' })
          return
        }
        sendJson(res, 200, await setEnabled(body.enabled))
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) })
      }
    },
  }), `${PLUGIN_ID}: state endpoint`)
}
