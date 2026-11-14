/**
 * dsh-window-memory — 浏览器半侧：设置里的「窗口记忆」页。
 * 模块 id 必须等于 bundle 行名（dsh-window-memory）。
 *
 * 版式：按「应用图标」那页的样子分卡片（页头 + 四张卡），卡片内按宿主设置页的
 * 规格排版——状态卡里是 13/500 标签 + 13/20 值的键值行（0.5px 发丝线分隔），
 * 选项卡里是 Setting-Cell 行（14/20 标题、12/18 说明、16px 上下），按钮 34px，
 * 卡片底色用 --dsw-alias-card-fill。文案走 Client locale 服务，操作结果由宿主
 * 给 code、前端按语言翻译。
 */
;(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-window-memory',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useCallback = React.useCallback
      var useRef = React.useRef

      var API = '/dsh-window-memory'
      var NS = 'dsh-window-memory'

      var zh = {
        nav: '窗口记忆',
        'page.title': '窗口记忆',
        'page.sub': '记住 DSH 桌面主窗口的尺寸、位置与最大化状态，下次启动自动还原。',
        'card.state': '当前状态',
        'refresh': '刷新',
        'field.window': '当前窗口',
        'field.saved': '上次记录',
        'field.file': '状态文件',
        'field.last': '最近操作',
        'value.loading': '读取中…',
        'value.unavailable': '读不到',
        'value.noWindow': '没找到主窗口',
        'value.maximized': '最大化 · {size}',
        'value.window': '普通窗口 · {size} @ ({x}, {y})',
        'value.noRecord': '还没有记录',
        'value.recordUnusable': '记录由更新版本写入，本版不还原',
        'value.none': '—',
        'card.options': '记忆哪些内容',
        'opt.enabled': '启用窗口记忆',
        'opt.enabled.desc': '关掉后既不还原也不记录；这一项立即生效。',
        'opt.maximized': '记住最大化',
        'opt.maximized.desc': '上次是最大化，下次启动就自动最大化。',
        'opt.size': '记住尺寸与位置',
        'opt.size.desc': '上次的窗口大小和位置，下次启动照原样摆回去。',
        'options.note': '后两项在下次启动时才起作用；想马上看效果，用下面的「立即还原」。',
        'card.actions': '动手试试',
        'action.snapshot': '记住当前窗口',
        'action.apply': '立即还原',
        'action.clear': '清除记录',
        'actions.note': '「立即还原」把记录直接套用到当前窗口，不用重启 DSH 就能验证。',
        'card.notes': '说明',
        'note.frame': '窗口由 DSH 主进程创建，所以启动时仍可能先以默认尺寸出现一帧（约 0.15 秒）再套用记录。',
        'note.desktop': '只对 DSH 桌面版生效；网页版（dsh web）没有窗口可控制。',
        'note.storage': '这里的勾选保存在 window-memory.json；cordis.patch.yml 里的配置是初始默认值。',
        'message.saved': '已保存',
        'message.savedLocally': '已生效，但设置文件没写成（重启后会丢）',
        'message.unknown': '已完成',
        'error.request': '插件接口出错（HTTP {status}）',
        'error.save': '没保存（HTTP {status}）',
        'code.snapshot.ok': '已记住当前窗口（{size}）',
        'code.snapshot.noWindow': '没找到 DSH 主窗口',
        'code.snapshot.unreadable': '读不到窗口状态',
        'code.snapshot.writeFailed': '写状态文件失败',
        'code.disabled.snapshot': '窗口记忆已停用，先勾上「启用窗口记忆」',
        'code.disabled.apply': '窗口记忆已停用，先勾上「启用窗口记忆」',
        'code.apply.noRecord': '状态文件里没有可用的记录',
        'code.apply.noWindow': '没找到 DSH 主窗口',
        'code.apply.alreadyMaximized': '窗口已经是最大化了',
        'code.apply.okMaximized': '已还原为最大化（{size}）',
        'code.apply.maxFailed': '还原最大化失败',
        'code.apply.sizeOff': '尺寸与位置的记忆是关着的',
        'code.apply.zoomed': '窗口现在是最大化，先手动还原窗口再试',
        'code.apply.alreadyThere': '窗口已经是记录的位置和尺寸',
        'code.apply.okSize': '已还原窗口尺寸（{size}）',
        'code.apply.sizeFailed': '还原窗口尺寸失败',
        'code.clear.ok': '记录已清除，下次变化会重新记录',
        'code.clear.failed': '清除失败（文件可能被占用）',
      }

      var en = {
        nav: 'Window memory',
        'page.title': 'Window memory',
        'page.sub': 'Remember the DSH desktop window’s size, position and maximized state; restore it on the next launch.',
        'card.state': 'Current state',
        'refresh': 'Refresh',
        'field.window': 'Window',
        'field.saved': 'Saved record',
        'field.file': 'State file',
        'field.last': 'Last action',
        'value.loading': 'Loading…',
        'value.unavailable': 'Unavailable',
        'value.noWindow': 'No main window found',
        'value.maximized': 'Maximized · {size}',
        'value.window': 'Window · {size} @ ({x}, {y})',
        'value.noRecord': 'No record yet',
        'value.recordUnusable': 'Written by a newer version; not applied',
        'value.none': '—',
        'card.options': 'What to remember',
        'opt.enabled': 'Remember window state',
        'opt.enabled.desc': 'When off, nothing is restored or recorded. Takes effect immediately.',
        'opt.maximized': 'Remember maximized',
        'opt.maximized.desc': 'Reopen maximized when that is how you left it.',
        'opt.size': 'Remember size & position',
        'opt.size.desc': 'Put the window back at its last size and position next launch.',
        'options.note': 'The last two apply on the next launch; use Restore now below to try them immediately.',
        'card.actions': 'Try it',
        'action.snapshot': 'Remember this window',
        'action.apply': 'Restore now',
        'action.clear': 'Clear record',
        'actions.note': 'Restore now applies the record to this window, so no restart is needed to verify it.',
        'card.notes': 'Notes',
        'note.frame': 'The window is created by the DSH main process, so it may still show the default size for one frame (~0.15 s) before the record applies.',
        'note.desktop': 'Desktop only; dsh web has no window to control.',
        'note.storage': 'These choices live in window-memory.json; the config in cordis.patch.yml is the default.',
        'message.saved': 'Saved',
        'message.savedLocally': 'Applied, but the settings file could not be written (lost on restart)',
        'message.unknown': 'Done',
        'error.request': 'Plugin API error (HTTP {status})',
        'error.save': 'Not saved (HTTP {status})',
        'code.snapshot.ok': 'Remembered the current window ({size})',
        'code.snapshot.noWindow': 'No DSH main window found',
        'code.snapshot.unreadable': 'Could not read the window state',
        'code.snapshot.writeFailed': 'Could not write the state file',
        'code.disabled.snapshot': 'Window memory is off; enable it first',
        'code.disabled.apply': 'Window memory is off; enable it first',
        'code.apply.noRecord': 'No usable record in the state file',
        'code.apply.noWindow': 'No DSH main window found',
        'code.apply.alreadyMaximized': 'The window is already maximized',
        'code.apply.okMaximized': 'Restored maximized ({size})',
        'code.apply.maxFailed': 'Could not restore maximized',
        'code.apply.sizeOff': 'Size and position memory is turned off',
        'code.apply.zoomed': 'The window is maximized; restore it manually first',
        'code.apply.alreadyThere': 'The window already has the recorded size and position',
        'code.apply.okSize': 'Restored the window size ({size})',
        'code.apply.sizeFailed': 'Could not restore the window size',
        'code.clear.ok': 'Record cleared; the next change records again',
        'code.clear.failed': 'Could not clear the record (file may be in use)',
      }

      var DICTS = { zh: zh, en: en }

      function request(path, options) {
        var opts = options || {}
        var headers = Object.assign({}, opts.headers)
        if (opts.body !== undefined) headers['content-type'] = 'application/json'
        if (opts.method === 'POST') headers['x-dsh-window-memory'] = '1'
        return fetch(API + path, {
          method: opts.method || 'GET',
          cache: 'no-store',
          headers: headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        }).then(function (response) {
          return response.text().then(function (text) {
            var body = null
            try {
              body = text ? JSON.parse(text) : null
            } catch (e) {
              body = null
            }
            if (!response.ok || (body && body.ok === false)) {
              var error = new Error('HTTP ' + response.status)
              error.status = response.status
              throw error
            }
            if (body === null) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status })
            return body
          })
        })
      }

      function fmtTime(iso) {
        if (!iso) return ''
        try {
          var d = new Date(iso)
          if (Number.isNaN(d.getTime())) return iso
          var pad = function (n) { return n < 10 ? '0' + n : '' + n }
          return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
        } catch (e) {
          return iso
        }
      }

      function sizeText(value) {
        return value.width + '×' + value.height
      }

      function describeCurrent(t, value) {
        if (!value) return t('value.noWindow')
        if (value.maximized) return t('value.maximized', { size: sizeText(value) })
        return t('value.window', { size: sizeText(value), x: value.x, y: value.y })
      }

      function describeSaved(t, saved) {
        if (!saved) return t('value.noRecord')
        if (saved.future || saved.width === null || saved.height === null) return t('value.recordUnusable')
        var text = saved.maximized
          ? t('value.maximized', { size: sizeText(saved) })
          : t('value.window', { size: sizeText(saved), x: saved.x, y: saved.y })
        if (saved.savedAt) text += ' · ' + fmtTime(saved.savedAt)
        return text
      }

      /** 宿主结果码 → 当前语言；认不出就用通用“已完成”，不回退宿主的中文说明。 */
      function actionText(t, action) {
        var params = action.params ? Object.assign({}, action.params) : {}
        if (params.width !== undefined && params.height !== undefined) params.size = sizeText(params)
        var text = action.code ? t('code.' + action.code, params) : ''
        if (!text || text === 'code.' + action.code) text = t('message.unknown')
        return text
      }

      function describeAction(t, action) {
        if (!action) return t('value.none')
        return (action.ok ? '✓ ' : '✗ ') + actionText(t, action)
      }

      function feedbackText(t, feedback) {
        if (!feedback) return ''
        if (feedback.action) return (feedback.tone === 'ok' ? '✓ ' : '✗ ') + actionText(t, feedback.action)
        return (feedback.tone === 'ok' ? '✓ ' : '✗ ') + t(feedback.code, feedback.params)
      }

      // 卡片外壳学「应用图标」那一页；卡片内部的行/控件按宿主设置页的规格。
      var CSS = [
        '.dxm{display:flex;flex-direction:column;gap:16px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px}',
        '.dxm-head{display:flex;flex-direction:column;gap:4px;padding:0 2px 2px}',
        '.dxm-title{margin:0;font-size:16px;font-weight:600;line-height:24px}',
        '.dxm-sub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
        '.dxm-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-card-fill);border:0.5px solid var(--dsw-alias-border-l1)}',
        '.dxm-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:34px}',
        '.dxm-card-title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
        '.dxm-fields{display:flex;flex-direction:column;min-width:0}',
        '.dxm-field{display:flex;flex-direction:column;gap:2px;padding:10px 0;min-width:0}',
        '.dxm-field+.dxm-field{border-top:0.5px solid var(--dsw-alias-border-l2)}',
        '.dxm-field:first-child{padding-top:0}',
        '.dxm-field:last-child{padding-bottom:0}',
        '.dxm-field-label{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
        '.dxm-field-value{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
        '.dxm-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}',
        '.dxm-rows{display:flex;flex-direction:column;min-width:0}',
        '.dxm-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
        '.dxm-row:first-child{padding-top:0}',
        '.dxm-row:last-child{padding-bottom:0;border-bottom:none}',
        '.dxm-row-text{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.dxm-row-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
        '.dxm-row-desc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
        '.dxm-check-hit{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;margin:-8px 0;border-radius:var(--dsw-radius-md);cursor:pointer}',
        '.dxm-check{appearance:none;-webkit-appearance:none;flex:none;width:16px;height:16px;margin:0;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-bg-base);position:relative;cursor:pointer;transition:background-color .12s,border-color .12s}',
        '.dxm-check:checked{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
        '.dxm-check:checked::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 2px 2px 0;transform:rotate(45deg)}',
        '.dxm-check:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
        '.dxm-check:disabled,.dxm-check-hit:has(.dxm-check:disabled){opacity:.5;cursor:default}',
        '@media (hover:hover){.dxm-check:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}}',
        '.dxm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.dxm-btn{display:inline-flex;align-items:center;height:34px;padding:0 14px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}',
        '.dxm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
        '.dxm-btn:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
        '.dxm-btn.dxm-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);background:transparent}',
        '@media (hover:hover){.dxm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}',
        '.dxm-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
        '.dxm-feedback{margin:0;font-size:12px;line-height:18px}',
        '.dxm-feedback-ok{color:var(--dsw-alias-label-secondary)}',
        '.dxm-feedback-error{color:var(--dsw-alias-state-error-primary)}',
        '.dxm-notes{display:flex;flex-direction:column;gap:4px}',
      ].join('')

      function Style() {
        return h('style', null, CSS)
      }

      function Button(props) {
        return h(
          'button',
          {
            type: 'button',
            className: 'dxm-btn' + (props.danger ? ' dxm-danger' : ''),
            disabled: props.disabled,
            onClick: props.disabled ? undefined : props.onClick,
          },
          props.children,
        )
      }

      /** 一行勾选项：14/20 标题 + 12/18 说明，右侧原生 checkbox（36px 命中区）。 */
      function Check(props) {
        var id = 'dxm-' + props.name
        var descId = id + '-desc'
        return h(
          'div',
          { className: 'dxm-row' },
          h(
            'div',
            { className: 'dxm-row-text' },
            h('label', { htmlFor: id, className: 'dxm-row-title' }, props.label),
            h('div', { className: 'dxm-row-desc', id: descId }, props.desc),
          ),
          h(
            'label',
            { className: 'dxm-check-hit' },
            h('input', {
              id: id,
              type: 'checkbox',
              className: 'dxm-check',
              checked: props.checked === true,
              disabled: props.disabled,
              'aria-describedby': descId,
              onChange: props.disabled || !props.onChange ? undefined : function (event) {
                props.onChange(event.target.checked === true)
              },
            }),
          ),
        )
      }

      function App(props) {
        var t = props.t
        var s = useState(null)
        var status = s[0]
        var setStatus = s[1]
        var ph = useState('loading')
        var phase = ph[0]
        var setPhase = ph[1]
        var fb = useState(null)
        var feedback = fb[0]
        var setFeedback = fb[1]
        var b = useState(false)
        var busy = b[0]
        var setBusy = b[1]
        var d = useState(null)
        var local = d[0]
        var setLocal = d[1]
        var tick = useState(0)
        var setTick = tick[1]
        var alive = useRef(true)

        var load = useCallback(function () {
          return request('/status')
            .then(function (value) {
              if (!alive.current) return value
              setStatus(value)
              setLocal(value.settings)
              setPhase('ready')
              return value
            })
            .catch(function (err) {
              if (!alive.current) return null
              setPhase('error')
              // 只在没有操作反馈时显示请求错误，别盖掉刚做完的结果。
              setFeedback(function (current) {
                return current || { tone: 'error', where: 'state', code: 'error.request', params: { status: err.status || 0 } }
              })
              return null
            })
        }, [t])

        // 打开面板取一次；之后靠「刷新」和每次操作后的重新拉取，不做定时轮询。
        useEffect(function () {
          alive.current = true
          load()
          return function () { alive.current = false }
        }, [load])

        // 语言切换时由 subscribe 触发重渲染，文案随 t 更新。
        useEffect(function () {
          return props.subscribe(function () { setTick(function (n) { return n + 1 }) })
        }, [])

        var settings = local || (status && status.settings) || null
        var ready = phase === 'ready'
        var enabled = settings ? settings.enabled === true : false
        var current = status && status.current
        var saved = status && status.saved
        var action = status && status.lastAction
        var controlsLocked = busy || !ready

        function toggle(key, value) {
          if (controlsLocked) return
          var previous = settings
          var next = Object.assign({}, settings)
          next[key] = value
          setLocal(next)
          setBusy(true)
          setFeedback(null)
          var body = {}
          body[key] = value
          request('/settings', { method: 'POST', body: body })
            .then(function (value) {
              if (!alive.current) return value
              setLocal(value.settings)
              setFeedback(value.persisted === false
                ? { tone: 'error', where: 'state', code: 'message.savedLocally' }
                : { tone: 'ok', where: 'state', code: 'message.saved' })
              return load()
            })
            .catch(function (err) {
              if (!alive.current) return
              setLocal(previous)
              setFeedback({ tone: 'error', where: 'state', code: 'error.save', params: { status: err.status || 0 } })
            })
            .finally(function () { if (alive.current) setBusy(false) })
        }

        function run(path) {
          if (controlsLocked) return
          setBusy(true)
          setFeedback(null)
          request(path, { method: 'POST', body: {} })
            .then(function (value) {
              if (!alive.current) return value
              var result = value && value.action
              setFeedback(result
                ? { tone: result.ok ? 'ok' : 'error', where: 'actions', action: result }
                : { tone: 'ok', where: 'actions', code: 'message.unknown' })
              return load()
            })
            .catch(function (err) {
              if (!alive.current) return
              setFeedback({ tone: 'error', where: 'state', code: 'error.request', params: { status: err.status || 0 } })
            })
            .finally(function () { if (alive.current) setBusy(false) })
        }

        function fieldValue(describe) {
          if (!ready) return phase === 'error' ? t('value.unavailable') : t('value.loading')
          return describe()
        }

        function feedbackLine(where) {
          if (!feedback || feedback.where !== where) return null
          return h(
            'p',
            {
              className: 'dxm-feedback dxm-feedback-' + feedback.tone,
              role: feedback.tone === 'error' ? 'alert' : 'status',
            },
            feedbackText(t, feedback),
          )
        }

        function card(titleId, titleKey, head, body) {
          return h(
            'section',
            { className: 'dxm-card', 'aria-labelledby': titleId },
            h('div', { className: 'dxm-card-head' },
              h('h2', { className: 'dxm-card-title', id: titleId }, t(titleKey)),
              head || null,
            ),
            body,
          )
        }

        return h(
          'div',
          { className: 'dxm' },
          h(Style),

          h('header', { className: 'dxm-head' },
            h('h1', { className: 'dxm-title' }, t('page.title')),
            h('p', { className: 'dxm-sub' }, t('page.sub')),
          ),

          card('dxm-card-state', 'card.state',
            h(Button, { disabled: busy, onClick: function () { setBusy(true); load().finally(function () { if (alive.current) setBusy(false) }) } }, t('refresh')),
            h(React.Fragment, null,
              h('div', { className: 'dxm-fields' },
                h('div', { className: 'dxm-field' },
                  h('span', { className: 'dxm-field-label' }, t('field.window')),
                  h('span', { className: 'dxm-field-value' }, fieldValue(function () { return describeCurrent(t, current) })),
                ),
                h('div', { className: 'dxm-field' },
                  h('span', { className: 'dxm-field-label' }, t('field.saved')),
                  h('span', { className: 'dxm-field-value' }, fieldValue(function () { return describeSaved(t, saved) })),
                ),
                h('div', { className: 'dxm-field' },
                  h('span', { className: 'dxm-field-label' }, t('field.file')),
                  h('span', { className: 'dxm-field-value dxm-mono' }, (status && status.statePath) || t('value.none')),
                ),
                h('div', { className: 'dxm-field' },
                  h('span', { className: 'dxm-field-label' }, t('field.last')),
                  h('span', { className: 'dxm-field-value' }, fieldValue(function () { return describeAction(t, action) })),
                ),
              ),
              feedbackLine('state'),
            ),
          ),

          card('dxm-card-options', 'card.options', null,
            h(React.Fragment, null,
              h('div', { className: 'dxm-rows' },
                h(Check, {
                  name: 'enabled',
                  label: t('opt.enabled'),
                  desc: t('opt.enabled.desc'),
                  checked: settings ? settings.enabled : false,
                  disabled: controlsLocked,
                  onChange: function (value) { toggle('enabled', value) },
                }),
                h(Check, {
                  name: 'restore-maximized',
                  label: t('opt.maximized'),
                  desc: t('opt.maximized.desc'),
                  checked: settings ? settings.restoreMaximized : false,
                  disabled: controlsLocked,
                  onChange: function (value) { toggle('restoreMaximized', value) },
                }),
                h(Check, {
                  name: 'restore-size',
                  label: t('opt.size'),
                  desc: t('opt.size.desc'),
                  checked: settings ? settings.restoreSizePosition : false,
                  disabled: controlsLocked,
                  onChange: function (value) { toggle('restoreSizePosition', value) },
                }),
              ),
              h('p', { className: 'dxm-note' }, t('options.note')),
            ),
          ),

          card('dxm-card-actions', 'card.actions', null,
            h(React.Fragment, null,
              h('div', { className: 'dxm-actions' },
                h(Button, { disabled: controlsLocked || !enabled, onClick: function () { run('/snapshot') } }, t('action.snapshot')),
                h(Button, { disabled: controlsLocked || !enabled, onClick: function () { run('/apply') } }, t('action.apply')),
                h(Button, { danger: true, disabled: controlsLocked, onClick: function () { run('/clear') } }, t('action.clear')),
              ),
              h('p', { className: 'dxm-note' }, t('actions.note')),
              feedbackLine('actions'),
            ),
          ),

          card('dxm-card-notes', 'card.notes', null,
            h('div', { className: 'dxm-notes' },
              h('p', { className: 'dxm-note' }, t('note.frame')),
              h('p', { className: 'dxm-note' }, t('note.desktop')),
              h('p', { className: 'dxm-note' }, t('note.storage')),
            ),
          ),
        )
      }

      var exports = { inject: ['slots', 'locale'] }
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
      exports.apply = function (ctx) {
        ctx.effect(function () { return ctx.locale.register(NS, DICTS) }, 'dsh-window-memory: dictionaries')
        var t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-window-memory',
              order: 35,
              label: function () { return t('nav') },
            },
            function () {
              return h(App, {
                t: t,
                subscribe: function (fn) { return ctx.locale.subscribe(fn) },
              })
            },
          )
        })
      }
      return exports
    },
  })
})()
