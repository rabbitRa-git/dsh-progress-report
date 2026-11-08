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
 * 「发一条测试提醒」走后端 /test，会真的往当前会话排一条提醒，用来肉眼验活。
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
[data-pr-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:600px;}
[data-pr-sec]{display:flex;flex-direction:column;gap:10px;}
[data-pr-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-pr-grow]{flex:1;min-width:0;}
[data-pr-label]{font-size:13px;line-height:18px;}
[data-pr-en]{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
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
[data-pr-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:inherit;}
[data-pr-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-pr-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-pr-btn][disabled]{opacity:.5;cursor:default;}
[data-pr-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-word;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-msg][data-good]{color:#22c55e;}
[data-pr-msg][data-warn]{color:#f59e0b;}
[data-pr-path]{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;}
[data-pr-ta]{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;padding:8px 10px;border-radius:8px;
  font-size:12px;line-height:18px;font-family:inherit;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;}
[data-pr-ta]:focus{outline:none;border-color:#3b82f6;}
[data-pr-pre]{white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:16px;padding:8px 10px;
  border-radius:8px;background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-chip]{font-size:11px;padding:3px 8px;border-radius:99px;cursor:pointer;font-family:ui-monospace,Consolas,monospace;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.22));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;}
[data-pr-list]{display:flex;flex-direction:column;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-prev]{display:flex;flex-direction:column;gap:4px;}
[data-pr-prev-t]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-pr-prev] pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:17px;
  font-family:ui-monospace,Consolas,monospace;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));
  border-left:2px solid #3b82f6;color:inherit;}
    `

    const ROW_DEFS = [
      {
        key: 'intervalMinutes',
        label: '每隔多少分钟要求汇报一次',
        en: 'Report interval (minutes)',
        unit: '分钟',
        min: 0.5,
        step: 0.5,
        note: '到点后，插件会在下一次工具调用结束时提醒我停下来跟你说话。',
      },
      {
        key: 'maxToolCalls',
        label: '连续这么多次工具调用没汇报，也强制提醒',
        en: 'Also fire after this many tool calls',
        unit: '次',
        min: 0,
        step: 1,
        note: '兜底，专治"时间没到但已经连着干了一大堆活"。填 0 = 只用时间规则。',
      },
      {
        key: 'minGapMinutes',
        label: '但两次提醒之间至少隔',
        en: 'Minimum gap between reminders',
        unit: '分钟',
        min: 0,
        step: 1,
        note: '给上面那条兜底加时间下限：不然密集读文件时几分钟就凑满次数，变成每分钟被打断一次。',
      },
      {
        key: 'minToolCalls',
        label: '至少调用这么多次工具才允许提醒',
        en: 'Never fire before this many tool calls',
        unit: '次',
        min: 1,
        step: 1,
        note: '防止"一句话长思考"就被打断。',
      },
    ]

    const LANGS = [
      { v: 'auto', t: '跟随系统 · auto' },
      { v: 'zh', t: '中文' },
      { v: 'en', t: 'English' },
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

    const Label = ({ zh, en }) =>
      h('div', { 'data-pr-grow': '' }, h('div', { 'data-pr-label': '' }, zh), en ? h('div', { 'data-pr-en': '' }, en) : null)

    const Panel = () => {
      const [state, setState] = React.useState({ status: 'loading' })
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null) // { text, tone }
      const [testResult, setTestResult] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        jget('/config')
          .then((r) => {
            if (!alive) return
            if (!r || r.ok !== true) {
              setState({ status: 'error', error: '宿主没有返回配置（插件可能没激活）' })
              return
            }
            setState({
              status: 'ok',
              config: r.config,
              defaults: r.defaults,
              limits: r.limits || {},
              file: r.file,
              logFile: r.logFile,
              lastFire: r.lastFire,
              slowTools: r.slowTools || [],
            })
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

      const describeAdjustments = (list) => {
        if (!Array.isArray(list) || !list.length) return ''
        return (
          '（' +
          list
            .map((a) => `${a.key} 从 ${a.input} 调整为 ${a.value}，范围 ${a.min}–${a.max}`)
            .join('；') +
          '）'
        )
      }

      const save = async () => {
        if (!draft) return
        const blank = ROW_DEFS.filter((r) => draft[r.key] === '' || draft[r.key] === undefined)
        if (blank.length) {
          setMsg({ text: '「' + blank[0].label + '」还没填数字。', tone: 'warn' })
          return
        }
        setBusy(true)
        setMsg(null)
        setTestResult(null)
        try {
          const r = await jpost('/config', draft)
          if (!r || r.ok !== true) throw new Error((r && r.error) || '保存没成功')
          setState((s) => ({ ...s, config: r.config }))
          setDraft({ ...r.config })
          setMsg({
            text:
              '已保存，下一次工具调用就按新值走（不用重启）。' + describeAdjustments(r.adjustments),
            tone: 'good',
          })
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

      const sendTest = async () => {
        setBusy(true)
        setTestResult(null)
        try {
          const r = await jpost('/test', {})
          if (!r || r.ok !== true) throw new Error((r && r.error) || '没发出去')
          setTestResult(r)
        } catch (e) {
          setTestResult({ ok: false, reason: e.message })
        } finally {
          setBusy(false)
        }
      }

      const onOff = (k) => (v) => patch(k, v)
      const onNum = (k, min) => (e) => {
        const raw = e.target.value
        if (raw === '') return patch(k, '')
        const n = Number(raw)
        if (Number.isFinite(n)) patch(k, Math.max(min, n))
      }
      const numValue = (k) => (draft[k] === '' || draft[k] === undefined ? '' : String(draft[k]))
      const insertToken = (tok) => {
        const cur = String(draft.template || '')
        patch('template', cur + (cur && !cur.endsWith(' ') ? ' ' : '') + tok)
      }

      // ---- 文案预览：和 lib/index.js 的 buildText 保持同一套措辞 ----
      const sampleLang = (() => {
        if (draft.lang === 'en') return 'en'
        if (draft.lang === 'zh') return 'zh'
        try {
          return String(navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh'
        } catch {
          return 'zh'
        }
      })()
      const sampleMinutes = Number(draft.intervalMinutes) || 10
      const sampleCalls =
        Number(draft.maxToolCalls) > 0
          ? Number(draft.maxToolCalls)
          : Math.max(1, Number(draft.minToolCalls) || 2)
      const tplTrimmed = String(draft.template || '').trim()
      const fillTpl = (s) =>
        s
          .replace(/\{minutes\}/g, String(sampleMinutes))
          .replace(/\{calls\}/g, String(sampleCalls))
          .replace(/\{slow\}/g, 'pwsh 120s')
      const previewFull = tplTrimmed
        ? fillTpl(tplTrimmed)
        : sampleLang === 'en'
          ? `[progress check] ${sampleCalls} tool calls and ${sampleMinutes} min since you last said anything.\n… (5 more lines of rules)`
          : `【进度检查点】已连续 ${sampleCalls} 次工具调用、${sampleMinutes} 分钟没说话。\n…（后面还有 5 行完整规则）`
      const previewShort = tplTrimmed
        ? fillTpl(tplTrimmed)
        : sampleLang === 'en'
          ? `[progress check] another ${sampleMinutes} min / ${sampleCalls} tool calls without a word. Lead your next reply with one line: \`progress x/y · doing: … · next: …\`, then carry on.`
          : `【进度检查点】又过了 ${sampleMinutes} 分钟、${sampleCalls} 次调用没吭声。这一条回复里先补一行「进度 x/y · 正在：… · 下一步：…」，然后接着干。`

      const clockOf = (ts) => {
        try {
          const d = new Date(ts)
          const p = (n) => String(n).padStart(2, '0')
          return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
        } catch {
          return '--:--'
        }
      }
      const shortSession = (id) => (id ? String(id).replace(/^session-/, '').slice(0, 8) : '未知')

      const lastFireText = (() => {        const f = state.lastFire
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
          h('div', { 'data-pr-h': '' }, '总开关 · ENABLED'),
          h(
            'div',
            { 'data-pr-row': '' },
            h(Switch, { on: Boolean(draft.enabled), onChange: onOff('enabled'), label: '启用进度提醒' }),
            h(Label, {
              zh: draft.enabled ? '启用中' : '已关闭，长任务不会再被打断',
              en: draft.enabled ? 'On' : 'Off — long tasks will not be interrupted',
            }),
          ),
        ),

        draft.enabled
          ? h(
              'div',
              { 'data-pr-sec': '' },
              h('div', { 'data-pr-h': '' }, '什么时候提醒 · WHEN'),
              ...ROW_DEFS.map((row) =>
                h(
                  'div',
                  { 'data-pr-sec': '', key: row.key },
                  h(
                    'div',
                    { 'data-pr-row': '' },
                    h(Label, { zh: row.label, en: row.en }),
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
                h(Label, { zh: '单个工具跑超过这么秒算"慢工具"', en: 'Slow tool threshold (seconds)' }),
                h('input', {
                  'data-pr-num': '',
                  type: 'number',
                  min: 10,
                  step: 10,
                  value: numValue('slowToolSeconds'),
                  onChange: onNum('slowToolSeconds', 10),
                }),
                h('span', { 'data-pr-unit': '' }, '秒'),
              ),
              h(
                'div',
                { 'data-pr-note': '' },
                '超过阈值的调用会被记下来，下一次提醒里点一句"刚才那个调用跑了多久"——长命令期间我插不上话，至少让用户知道时间花在哪了。',
              ),
              h(
                'div',
                { 'data-pr-note': '' },
                '两个条件谁先满足都算：到了时间，或者连着调用了那么多次工具。',
              ),
            )
          : null,

        draft.enabled
          ? h(
              'div',
              { 'data-pr-sec': '' },
              h('div', { 'data-pr-h': '' }, '提醒说什么 · WHAT IT SAYS'),

              h(
                'div',
                { 'data-pr-row': '' },
                h(Label, { zh: '提醒文案语言', en: 'Language of the reminder' }),
                h(
                  'select',
                  {
                    'data-pr-num': '',
                    style: { width: '130px', textAlign: 'left' },
                    value: draft.lang || 'auto',
                    onChange: (e) => patch('lang', e.target.value),
                  },
                  LANGS.map((l) => h('option', { key: l.v, value: l.v }, l.t)),
                ),
              ),

              h(
                'div',
                { 'data-pr-note': '' },
                '自定义文案（留空 = 用内置）。可用占位符：',
                ' ',
                h('button', { 'data-pr-chip': '', type: 'button', onClick: () => insertToken('{minutes}') }, '{minutes}'),
                ' ',
                h('button', { 'data-pr-chip': '', type: 'button', onClick: () => insertToken('{calls}') }, '{calls}'),
                ' ',
                h('button', { 'data-pr-chip': '', type: 'button', onClick: () => insertToken('{slow}') }, '{slow}'),
              ),
              h('textarea', {
                'data-pr-ta': '',
                spellCheck: false,
                placeholder: '留空使用内置文案。例如：\\n【进度检查点】已经跑了 {calls} 次工具调用、{minutes} 分钟，先写一行进度再继续。',
                value: draft.template || '',
                onChange: (e) => patch('template', e.target.value),
              }),

              h('div', { 'data-pr-note': '' }, '预览 · PREVIEW（按上面这些参数算出来的样子）'),
              h(
                'div',
                { 'data-pr-prev': '' },
                h('div', { 'data-pr-prev-t': '' }, '第一条 · 完整规则'),
                h('pre', {}, previewFull),
              ),
              tplTrimmed
                ? null
                : h(
                    'div',
                    { 'data-pr-prev': '' },
                    h('div', { 'data-pr-prev-t': '' }, '之后每条 · 只发一行'),
                    h('pre', {}, previewShort),
                  ),
              tplTrimmed
                ? h('div', { 'data-pr-note': '' }, '填了自定义文案：每次都用你写的这段，不再区分首条和后续。')
                : h(
                    'div',
                    { 'data-pr-note': '' },
                    '同一段规则重复三遍只是占上下文，所以第一次给完整规则，之后每次只发一行提醒。',
                  ),

              h(
                'div',
                { 'data-pr-row': '' },
                h(Switch, {
                  on: Boolean(draft.mentionTodo),
                  onChange: onOff('mentionTodo'),
                  label: '提醒里带上更新清单',
                }),
                h(Label, { zh: '提醒里顺带让我更新任务清单（todo）', en: 'Append a todo_update hint (built-in text only)' }),
              ),
              draft.template && draft.template.trim()
                ? h('div', { 'data-pr-note': '' }, '注意：填了自定义文案时，上面这个开关不生效——整段文字都由你写。')
                : null,
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
          h('button', { 'data-pr-btn': '', disabled: busy || !draft.enabled, onClick: sendTest }, '发一条测试提醒'),
        ),

        msg ? h('div', { 'data-pr-msg': '', 'data-good': msg.tone === 'good' ? '' : undefined, 'data-warn': msg.tone === 'warn' ? '' : undefined }, msg.text) : null,

        testResult
          ? h(
              'div',
              { 'data-pr-msg': '', 'data-good': testResult.delivered ? '' : undefined, 'data-warn': testResult.delivered ? undefined : '' },
              (testResult.delivered ? '✓ 已排进下一步输入：' : '✗ 没送出去：') +
                (testResult.reason || '') +
                (testResult.text ? '｜内容：' + testResult.text.slice(0, 160) : ''),
            )
          : null,

        h(
          'div',
          { 'data-pr-sec': '' },
          h('div', { 'data-pr-h': '' }, '状态 · STATUS'),
          h('div', { 'data-pr-note': '' }, lastFireText),
          state.recent && state.recent.length
            ? h(
                'div',
                { 'data-pr-list': '' },
                h('div', {}, '最近几次提醒（按会话，最多 6 条）'),
                ...state.recent.map((r, i) =>
                  h('div', { key: i }, `· ${clockOf(r.at)} ${r.reason} · 距上次 ${r.minutes} 分钟 / ${r.calls} 次调用 · 会话 ${shortSession(r.session)}`),
                ),
              )
            : h('div', { 'data-pr-note': '' }, '最近几分钟还没有提醒记录。'),
          state.slowTools && state.slowTools.length
            ? h(
                'div',
                { 'data-pr-list': '' },
                h('div', {}, '慢工具（按平均耗时）'),
                ...state.slowTools.map((t, i) =>
                  h('div', { key: i }, `· ${t.name} 约 ${t.avgSeconds} 秒（${t.count} 次）`),
                ),
              )
            : h('div', { 'data-pr-note': '' }, '还没遇到慢工具（超过阈值的调用会列在这里）。'),
          h(
            'div',
            { 'data-pr-note': '' },
            '参数存在 ',
            h('span', { 'data-pr-path': '' }, state.file || '~/.dsh/progress-report.json'),
            ' —— 改完立即生效，不用重启 DSH。',
          ),
          h(
            'div',
            { 'data-pr-note': '' },
            '每次触发都会记一行到 ',
            h('span', { 'data-pr-path': '' }, state.logFile || '~/.dsh/progress-report.log'),
            '，超过 256KB 自动只留最近 200 行。',
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
