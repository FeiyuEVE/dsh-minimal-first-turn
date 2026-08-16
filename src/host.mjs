import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setImmediate } from 'node:timers'

import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as terminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as persistentBash from '@deepseek-ai/dsh-tool-bash-persistent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as strReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'

const PLUGIN_ID = 'dsh-minimal-first-turn'
const BOOTSTRAP_TOOLS = new Set(['bash', 'str_replace_editor'])
const SUPPRESSED_SOURCES = new Set(['agent-instructions', 'skill-catalog'])
const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'
const STATE_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', `${PLUGIN_ID}.json`)
const TEMP_STATE_PATH = `${STATE_PATH}.tmp`
const STATE_ENDPOINT = '/minimal-first-turn/state'

export const name = PLUGIN_ID
export const inject = ['agents', 'webServer']

const PERSISTENT_BASH_DESCRIPTION = [
  'Run commands in a bash shell',
  '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
  "* You don't have access to the internet via this tool.",
  '* You do have access to a mirror of common linux and python packages via apt and pip.',
  '* State is persistent across command calls and discussions.',
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

function phaseFromEvents(session) {
  let boundary = -1
  let promoted = false
  for (const event of session.events ?? []) {
    const seq = event.seq ?? 0
    if (event.type === 'compaction/end') {
      boundary = seq
      promoted = false
    } else if ((event.type === 'tool/call' || event.type === 'assistant/message') && seq > boundary) {
      promoted = true
    }
  }
  return { boundary, promoted }
}

function createBootstrapPairPlugin() {
  return {
    name: 'minimal-first-turn-tool-pair',
    async apply(agentCtx) {
      const bootstrapCtx = agentCtx.isolate('terminals').isolate('fs')
      await bootstrapCtx.plugin(TerminalSessionService)
      await bootstrapCtx.plugin(terminalBash, { timeoutMs: 300000 })
      await bootstrapCtx.plugin(persistentBash, {
        timeoutMs: 300000,
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

  const phaseFor = (agent) => {
    if (!enabled || agent === undefined || agent.session === undefined) return { boundary: -1, promoted: true }
    if ((agent.session.header?.delegationDepth ?? 0) > 0) return { boundary: -1, promoted: true }
    const id = agent.session.id
    const existing = phases.get(id)
    if (existing !== undefined) return existing
    const phase = phaseFromEvents(agent.session)
    phases.set(id, phase)
    return phase
  }

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
    if (mount.fiber === undefined) return
    try {
      await mount.fiber.dispose()
    } catch (error) {
      warnOnce(`unmount:${agent.id}`, `${PLUGIN_ID}: failed to unload Minimal tools for agent ${agent.id}: ${String(error?.message ?? error)}`)
    }
  }

  const enableForLiveAgents = async () => {
    const pending = []
    for (const agent of ctx.agents.list()) {
      const mount = mountPair(agent)
      if (mount?.promise !== undefined) pending.push(mount.promise)
    }
    await Promise.all(pending)
  }

  const deferUnmount = () => {
    setImmediate(() => {
      if (enabled) return
      for (const [agent, mount] of mounts.entries()) {
        void unmountPair(agent, mount)
      }
    })
  }

  const setEnabled = (nextEnabled) => {
    const operation = updateQueue.then(async () => {
      if (nextEnabled === enabled) return { enabled }
      enabled = nextEnabled
      persistState(enabled)
      if (enabled) await enableForLiveAgents()
      else deferUnmount()
      return { enabled }
    })
    updateQueue = operation.catch(() => {})
    return operation
  }

  ctx.on('agent/created', ({ agent }) => {
    mountPair(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    phases.delete(agent.session.id)
    mounts.delete(agent)
  })

  ctx.on('session/event', (session, event) => {
    if (!enabled) return
    const phase = phases.get(session.id)
    if (phase === undefined) return
    const seq = event.seq ?? 0
    if (event.type === 'compaction/end') {
      phases.set(session.id, { boundary: seq, promoted: false })
    } else if ((event.type === 'tool/call' || event.type === 'assistant/message') && seq > phase.boundary) {
      phases.set(session.id, { ...phase, promoted: true })
    }
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const mount = enabled ? mountPair(agent) : undefined
    if (mount !== undefined && !mount.ready && !mount.failed) await mount.promise

    const decision = await next()
    if (!enabled || decision.kind === 'reject' || mount?.ready !== true || phaseFor(agent).promoted) return decision
    if (!Array.isArray(decision.messages)) return decision

    const messages = decision.messages.filter((message) => !SUPPRESSED_SOURCES.has(message?.source?.kind))
    return messages.length === decision.messages.length ? decision : { ...decision, messages }
  }, { prepend: true })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    if (!enabled) return assembled

    const agent = context.agent
    if (agent === undefined) return assembled

    const mount = mountPair(agent)
    if (mount !== undefined && !mount.ready && !mount.failed) await mount.promise
    if (mount?.ready !== true || phaseFor(agent).promoted) return assembled

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
