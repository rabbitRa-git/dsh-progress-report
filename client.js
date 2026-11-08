/**
 * dsh-progress-report —— 浏览器半端（「设置」里的一页）
 * ============================================================================
 * client bundle 不是 ESM，是自注册脚本：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => ({ inject: ['slots'], apply(ctx) {...} }),
 *     })
 *
 * 进「设置」的写法（抄 dsh-bili-scroll / dsh-meme 的槽位注册）：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'progress-report', order: 35, label: '进度汇报' },
 *       () => h(Panel),
 *     ))
 *
 * 读写参数走后端 /api/progress-report/config（见 lib/index.js），存的是
 * ~/.dsh/progress-report.json —— 同一个文件，改完下一次工具调用就按新值走。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-progress-report',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/progress-report'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 403 ? '（被宿主拦了，只接受本机页面）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) =>
      asJson(
        await fetch(API + p, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
      )

    const CSS = `
[data-pr-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:560px;}
[data-pr-sec]{display:flex;flex-direction:column;gap:10px;}
[data-pr-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-pr-grow]{flex:1;min-width:0;}
[data-pr-label]{font-size:13px;}
[data-pr-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-num]{width:84px;text-align:center;box-sizing:border-box;padding:6px 8px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-pr-num]:focus{outline:none;border-color:#3b82f6;}
[data-pr-unit]{font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;padding:0;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;}
[data-pr-sw][data-on]{background:#3b82f6;}
[data-pr-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-pr-sw][data-on] i{left:19px;}
[data-pr-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  display:flex;flex-direction:column;gap:10px;}
[data-pr-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:inherit;}
[data-pr-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-pr-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-pr-btn][disabled]{opacity:.5;cursor:default;}
[data-pr-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-msg][data-good]{color:#22c55e;}
[data-pr-msg][data-warn]{color:#f59e0b;}
[data-pr-path]{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;}
    `

    const ROW_DEFS = [
      {
        key: 'intervalMinutes',
        label: '每隔多少分钟要求汇报一次',
        unit: '分钟',
        min: 0.5,
        step: 0.5,
        note: '到点后，插件会在下一次工具调用结束时提醒我停下来跟你说话。',
      },
      {
        key: 'maxToolCalls',
        label: '连续这么多次工具调用没汇报，也强制提醒',
        unit: '次',
        min: 0,
        step: 1,
        note: '兜底，专治"时间没到但已经连着干了一大堆活"。填 0 = 只用时间规则。',
      },
      {
        key: 'minGapMinutes',
        label: '但两次提醒之间至少隔',
        unit: '分钟',
        min: 0,
        step: 1,
        note: '给上面那条兜底加时间下限：不然密集读文件时几分钟就凑满次数，变成每分钟被打断一次。',
      },
      {
        key: 'minToolCalls',
        label: '至少调用这么多次工具才允许提醒',
        unit: '次',
        min: 1,
        step: 1,
        note: '防止"一句话长思考"就被打断。',
      },
    ]

    const Switch = ({ on, onChange, label }) =>
      h(
        'button',
        {
          'data-pr-sw': '',
          type: 'button',
          'aria-label': label,
          title: label,
          'data-on': on ? '' : undefined,
          onClick: () => onChange(!on),
        },
        h('i'),
      )

    const Panel = () => {
      const [state, setState] = React.useState({ status: 'loading' })
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null) // { text, tone }

      React.useEffect(() => {
        let alive = true
        jget('/config')
          .then((r) => {
            if (!alive) return
            if (!r || r.ok !== true) {
              setState({ status: 'error', error: '宿主没有返回配置（插件可能没激活）' })
              return
            }
            setState({ status: 'ok', config: r.config, defaults: r.defaults, file: r.file, lastFire: r.lastFire })
            setDraft({ ...r.config })
          })
          .catch((e) => alive && setState({ status: 'error', error: e.message }))
        return () => {
          alive = false
        }
      }, [])

      if (state.status === 'loading') return h('div', { 'data-pr-page': '' }, h('div', { 'data-pr-note': '' }, '读取中…'))
      if (state.status === 'error')
        return h(
          'div',
          { 'data-pr-page': '' },
          h('div', { 'data-pr-msg': '', 'data-warn': '' }, '读不到配置：' + state.error),
        )

      const saved = state.config
      const patch = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
      const dirty = draft && Object.keys(draft).some((k) => draft[k] !== saved[k])

      const save = async () => {
        if (!draft) return
        const blank = ROW_DEFS.filter((r) => draft[r.key] === '' || draft[r.key] === undefined)
        if (blank.length) {
          setMsg({ text: '「' + blank[0].label + '」还没填数字。', tone: 'warn' })
          return
        }
        setBusy(true)
        setMsg(null)
        try {
          const r = await jpost('/config', draft)
          if (!r || r.ok !== true) throw new Error((r && r.error) || '保存没成功')
          setState((s) => ({ ...s, config: r.config }))
          setDraft({ ...r.config })
          setMsg({ text: '已保存，下一次工具调用就按新值走（不用重启）。', tone: 'good' })
        } catch (e) {
          setMsg({ text: '保存失败：' + e.message, tone: 'warn' })
        } finally {
          setBusy(false)
        }
      }

      const resetDefaults = () => {
        if (!state.defaults) return
        setDraft({ ...state.defaults })
        setMsg({ text: '已填回默认值，点「保存」才生效。', tone: '' })
      }

      const onOff = (k) => (v) => patch(k, v)
      const onNum = (k, min) => (e) => {
        const raw = e.target.value
        if (raw === '') return patch(k, '')
        const n = Number(raw)
        if (Number.isFinite(n)) patch(k, Math.max(min, n))
      }

      const numValue = (k) => (draft[k] === '' || draft[k] === undefined ? '' : String(draft[k]))

      const lastFireText = (() => {
        const f = state.lastFire
        if (!f || !f.at) return '这个会话里还没触发过。'
        const d = new Date(f.at)
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        return `上次提醒 ${hh}:${mm}（${f.reason}，距上次 ${f.minutes} 分钟 / ${f.calls} 次调用）`
      })()

      return h(
        'div',
        { 'data-pr-page': '' },

        h(
          'div',
          { 'data-pr-sec': '' },
          h('div', { 'data-pr-h': '' }, '总开关'),
          h(
            'div',
            { 'data-pr-row': '' },
            h(Switch, { on: Boolean(draft.enabled), onChange: onOff('enabled'), label: '启用进度提醒' }),
            h(
              'div',
              { 'data-pr-grow': '', 'data-pr-label': '' },
              draft.enabled ? '启用中' : '已关闭，长任务不会再被打断',
            ),
          ),
        ),

        draft.enabled
          ? h(
              'div',
              { 'data-pr-sec': '' },
              h('div', { 'data-pr-h': '' }, '什么时候提醒'),
              ...ROW_DEFS.map((row) =>
                h(
                  'div',
                  { 'data-pr-sec': '', key: row.key },
                  h(
                    'div',
                    { 'data-pr-row': '' },
                    h('div', { 'data-pr-grow': '', 'data-pr-label': '' }, row.label),
                    h('input', {
                      'data-pr-num': '',
                      type: 'number',
                      min: row.min,
                      step: row.step,
                      value: numValue(row.key),
                      onChange: onNum(row.key, row.min),
                    }),
                    h('span', { 'data-pr-unit': '' }, row.unit),
                  ),
                  h('div', { 'data-pr-note': '' }, row.note),
                ),
              ),
              h(
                'div',
                { 'data-pr-row': '' },
                h(Switch, {
                  on: Boolean(draft.mentionTodo),
                  onChange: onOff('mentionTodo'),
                  label: '提醒里带上更新清单',
                }),
                h(
                  'div',
                  { 'data-pr-grow': '', 'data-pr-label': '' },
                  '提醒里顺带让我更新任务清单（todo）',
                ),
              ),
              h(
                'div',
                { 'data-pr-note': '' },
                '两个条件谁先满足都算：到了时间，或者连着调用了那么多次工具。',
              ),
            )
          : null,

        h(
          'div',
          { 'data-pr-row': '' },
          h(
            'button',
            { 'data-pr-btn': '', 'data-primary': '', disabled: busy || !dirty, onClick: save },
            busy ? '保存中…' : dirty ? '保存' : '已是最新',
          ),
          h('button', { 'data-pr-btn': '', disabled: busy, onClick: resetDefaults }, '恢复默认'),
        ),

        msg ? h('div', { 'data-pr-msg': '', 'data-good': msg.tone === 'good' ? '' : undefined, 'data-warn': msg.tone === 'warn' ? '' : undefined }, msg.text) : null,

        h(
          'div',
          { 'data-pr-sec': '' },
          h('div', { 'data-pr-h': '' }, '状态'),
          h('div', { 'data-pr-note': '' }, lastFireText),
          h(
            'div',
            { 'data-pr-note': '' },
            '参数存在 ',
            h('span', { 'data-pr-path': '' }, state.file || '~/.dsh/progress-report.json'),
            ' —— 改完立即生效，不用重启 DSH。',
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-progress-report')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-progress-report: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register(
            { name: 'settings.section', id: 'progress-report', order: 35, label: '进度汇报' },
            () => h(Panel),
          ),
        )
      },
    }
  },
})
