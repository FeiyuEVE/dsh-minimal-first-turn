window.__ModuleLoader__.load({
  id: '@feiyueve/dsh-minimal-first-turn',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var STATE_ENDPOINT = '/minimal-first-turn/state'
    var CSS = `
.dmft-toggle{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;min-width:0;min-height:24px;color:var(--dsw-alias-label-secondary,#5f6b76);font-family:inherit;font-size:12px;line-height:1;white-space:nowrap}
.dmft-label{font-weight:600}
.dmft-switch{position:relative;width:32px;height:18px;border:1px solid var(--dsw-alias-border-l2,#c5c9d3);border-radius:999px;background:var(--dsw-alias-bg-layer-3,#d8dce5);padding:0;cursor:pointer;transition:background .15s ease,border-color .15s ease;flex:0 0 auto}
.dmft-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .15s ease}
.dmft-switch[data-enabled='true']{background:#188455;border-color:#188455}
.dmft-switch[data-enabled='true']::after{transform:translateX(14px)}
.dmft-switch:focus-visible{outline:2px solid #2b75d6;outline-offset:2px}
.dmft-switch:disabled{cursor:wait;opacity:.6}
/* 工具条那一枚在窄屏放不下：官方 row 允许换行，多一枚约 87px 的控件就会把 model/发送
   那一组挤到第二排（实测 390px 下工具条只剩约 260px、行内容余量约 57px；360px 只剩约
   11px，开关压到 20px 宽也照样换行）。所以窄屏改用 composer 上方那一行
   （conversation.input.dock，官方 goal bar 用的同一个槽位）。
   判定不只看视口：只有 dock 那一枚**真的挂上了**（组件挂载时才给 <html> 打
   data-dmft-dock），才撤掉工具条那份；否则说明当前外壳根本不渲染 dock 槽位，
   保留工具条那份，宁可再生旧的换行也不能让开关凭空消失。 */
.dmft-toggle--dock{display:none}
html[data-dmft-dock] .dmft-toggle--left{display:none}
html[data-dmft-dock] .dmft-toggle--dock{display:inline-flex;width:100%;justify-content:flex-end;min-height:20px;padding:0 4px}
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

    /** 窄屏判定：视口门槛，或 dsh-mobile 已挂上原生移动布局。 */
    function isNarrowShell() {
      var root = document.documentElement
      if (root.hasAttribute('data-dsh-mobile')) return true
      return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
    }

    function MinimalFirstTurnToggle(props) {
      var variant = props && props.variant === 'dock' ? 'dock' : 'left'
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

      // dock 那一枚挂上了才撤掉工具条那份（见 CSS 注释）。视口或移动布局变化时
      // 重新判定，卸载时把标记一起收回。
      React.useEffect(function () {
        if (variant !== 'dock') return function () {}
        var root = document.documentElement
        var query = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
        function sync() {
          if (isNarrowShell()) root.setAttribute('data-dmft-dock', '')
          else root.removeAttribute('data-dmft-dock')
        }
        sync()
        if (query !== null && typeof query.addEventListener === 'function') query.addEventListener('change', sync)
        var observer = typeof MutationObserver === 'function'
          ? new MutationObserver(sync)
          : null
        if (observer !== null) observer.observe(root, { attributes: true, attributeFilter: ['data-dsh-mobile'] })
        return function () {
          if (query !== null && typeof query.removeEventListener === 'function') query.removeEventListener('change', sync)
          if (observer !== null) observer.disconnect()
          root.removeAttribute('data-dmft-dock')
        }
      }, [variant])

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
      return React.createElement('div', { className: 'dmft-toggle dmft-toggle--' + variant, title: '让新会话的第一轮使用精简 prompt 与工具' },
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
          // 桌面：输入框工具条里那一枚（跟其他按钮同一行）。
          scope.effect(function () {
            return scope.slots.inject('conversation.input.left', function () {
              return scope.slots.register(
                { name: 'conversation.input.left', id: 'dsh-minimal-first-turn', order: 40, label: '首轮精简' },
                function () { return React.createElement(MinimalFirstTurnToggle, { variant: 'left' }) },
              )
            })
          })
          // 窄屏：工具条放不下（见 CSS 里那段注释），改挂 composer 上方那一行。
          scope.effect(function () {
            return scope.slots.inject('conversation.input.dock', function () {
              return scope.slots.register(
                { name: 'conversation.input.dock', id: 'dsh-minimal-first-turn', order: 30, label: '首轮精简' },
                function () { return React.createElement(MinimalFirstTurnToggle, { variant: 'dock' }) },
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
