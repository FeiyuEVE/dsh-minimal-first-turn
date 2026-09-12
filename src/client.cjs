window.__ModuleLoader__.load({
  id: '@feiyueve/dsh-minimal-first-turn',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var STATE_ENDPOINT = '/minimal-first-turn/state'
    var CSS = `
.dmft-toggle{display:inline-flex;align-items:center;gap:7px;min-height:28px;color:var(--dsw-alias-label-secondary,#5f6b76);font-family:inherit;font-size:12px;line-height:1;white-space:nowrap}
.dmft-label{font-weight:600}
.dmft-switch{position:relative;width:32px;height:18px;border:1px solid var(--dsw-alias-border-l2,#c5c9d3);border-radius:999px;background:var(--dsw-alias-bg-layer-3,#d8dce5);padding:0;cursor:pointer;transition:background .15s ease,border-color .15s ease;flex:0 0 auto}
.dmft-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .15s ease}
.dmft-switch[data-enabled='true']{background:#188455;border-color:#188455}
.dmft-switch[data-enabled='true']::after{transform:translateX(14px)}
.dmft-switch:focus-visible{outline:2px solid #2b75d6;outline-offset:2px}
.dmft-switch:disabled{cursor:wait;opacity:.6}
`

    function injectCss(css) {
      if (typeof document === 'undefined') return function () {}
      if (document.querySelector('style[data-dsh-minimal-first-turn]') !== null) return function () {}
      var style = document.createElement('style')
      style.setAttribute('data-dsh-minimal-first-turn', 'toggle')
      style.textContent = css
      document.head.appendChild(style)
      return function () { style.remove() }
    }

    function request(options) {
      return fetch(STATE_ENDPOINT, options).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || 'minimal-first-turn state request failed')
          return body
        })
      })
    }

    function MinimalFirstTurnToggle() {
      var state = React.useState(null)
      var enabled = state[0]
      var setEnabled = state[1]
      var savingState = React.useState(false)
      var saving = savingState[0]
      var setSaving = savingState[1]

      React.useEffect(function () {
        var active = true
        request({ method: 'GET', cache: 'no-store' }).then(function (body) {
          if (active) setEnabled(body.enabled === true)
        }).catch(function () {
          if (active) setEnabled(false)
        })
        return function () { active = false }
      }, [])

      function toggle() {
        if (saving || enabled === null) return
        var next = !enabled
        setSaving(true)
        request({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        }).then(function (body) {
          setEnabled(body.enabled === true)
        }).catch(function () {
          setEnabled(enabled)
        }).finally(function () {
          setSaving(false)
        })
      }

      var ready = enabled !== null
      return React.createElement('div', { className: 'dmft-toggle', title: '让新会话的第一轮使用精简 prompt 与工具' },
        React.createElement('span', { className: 'dmft-label' }, '首轮精简'),
        React.createElement('button', {
          className: 'dmft-switch',
          type: 'button',
          role: 'switch',
          'aria-checked': enabled === true,
          'aria-label': '首轮精简',
          'data-enabled': enabled === true ? 'true' : 'false',
          disabled: !ready || saving,
          onClick: toggle,
        }))
    }

    var plugin = {
      name: 'dsh-minimal-first-turn-client',
      apply: function (ctx) {
        ctx.inject(['slots'], function (scope) {
          scope.effect(function () { return injectCss(CSS) })
          scope.effect(function () {
            return scope.slots.inject('conversation.input.left', function () {
              return scope.slots.register(
                { name: 'conversation.input.left', id: 'dsh-minimal-first-turn', order: 40, label: '首轮精简' },
                function () { return React.createElement(MinimalFirstTurnToggle) },
              )
            })
          })
        })
      },
    }

    exports.apply = plugin.apply
    return module.exports
  },
})
