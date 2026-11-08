/**
 * dsh-progress-report — 让 DSH 做长任务时按时向用户"汇报进度"
 * ============================================================================
 * 为什么有它：模型在长任务里常常连续几十次工具调用、一句人话都不说，
 * 用户只能盯着转圈，既不知道做到哪了，也没机会在跑偏时打断。
 * 别的办法（在 AGENTS.md 里写规矩）靠模型自觉，还会被上下文压缩吃掉；
 * 这里换成**宿主侧强制打断**：每次工具调用结束后看一眼计时器，到点就往
 * 下一步的输入里塞一条提醒。模型下一步必然看到，跟压缩无关、跟自觉无关。
 *
 * 机制（零依赖，只用 node 内置）：
 *   ctx.on("tools/pre-execute")  —— 记下每个调用开始的时间（算慢工具耗时）
 *   ctx.on("tools/post-execute") —— 计次 / 计时，到点生成一条 notice 消息
 *   ctx.on("agent/pre-step")     —— 收到真人用户消息时重置计时器
 *   ctx.inject(["webServer"])    —— /api/progress-report 给设置页读写参数、发测试提醒
 *
 * 配置：
 *   默认值来自本包的 cordis.patch.yml；
 *   运行期可改 `~/.dsh/progress-report.json`（首次启动自动生成），改完下一轮就生效。
 *   设置页（client.js）会把这些字段画成表单，写的就是同一个文件。
 *   每次触发都会往 `~/.dsh/progress-report.log` 追加一行（超过 256KB 自动只留尾部）。
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const name = 'progress-report';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const CONFIG_FILE = join(DSH_HOME, 'progress-report.json');
const LOG_FILE = join(DSH_HOME, 'progress-report.log');
const LOG_MAX_BYTES = 256 * 1024;

const DEFAULTS = {
  enabled: true,
  /** 距离上次汇报超过这么多分钟就提醒一次 */
  intervalMinutes: 10,
  /** 兜底：连续这么多次工具调用没汇报，即使没到时间也提醒（0 = 关闭） */
  maxToolCalls: 12,
  /** 兜底提醒也至少隔这么多分钟，免得密集调用时变成每分钟一次 */
  minGapMinutes: 3,
  /** 至少执行过这么多次工具调用才提醒，避免一句话长思考也被打断 */
  minToolCalls: 2,
  /** 提醒里是否带上「顺手更新 todo_write」 */
  mentionTodo: true,
  /** 提醒文案语言：auto / zh / en */
  lang: 'auto',
  /** 自定义提醒全文；留空 = 用内置文案。占位符：{minutes} {calls} {slow} */
  template: '',
  /** 单个工具跑超过这么多秒就算"慢工具"，下次提醒里会点出来 */
  slowToolSeconds: 60,
};

const LIMITS = {
  intervalMinutes: [0.5, 1440],
  maxToolCalls: [0, 1000],
  minGapMinutes: [0, 1440],
  minToolCalls: [1, 1000],
  slowToolSeconds: [10, 3600],
};

const NOTE =
  '改完不用重启，下一次工具调用就按新值计时。intervalMinutes = 每隔多少分钟要求汇报一次；' +
  'template 留空用内置文案，可用占位符 {minutes} {calls} {slow}。';

function coerceDetailed(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const adjustments = [];

  /** 钳位而不是"坏了就退回默认"——填 0.1 应该落到 0.5，不能悄悄跳回 10。 */
  const num = (key, d) => {
    const v = src[key];
    if (v === '' || v === null || v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    const [min, max] = LIMITS[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    const fixed = Math.min(max, Math.max(min, n));
    if (fixed !== n) adjustments.push({ key, input: n, value: fixed, min, max });
    return fixed;
  };
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const text = (v, d) => (typeof v === 'string' ? v : d);
  const lang = (v, d) => (v === 'zh' || v === 'en' || v === 'auto' ? v : d);

  const config = {
    enabled: bool(src.enabled, base.enabled),
    intervalMinutes: num('intervalMinutes', base.intervalMinutes),
    maxToolCalls: num('maxToolCalls', base.maxToolCalls),
    minGapMinutes: num('minGapMinutes', base.minGapMinutes),
    minToolCalls: num('minToolCalls', base.minToolCalls),
    mentionTodo: bool(src.mentionTodo, base.mentionTodo),
    lang: lang(src.lang, base.lang),
    template: text(src.template, base.template),
    slowToolSeconds: num('slowToolSeconds', base.slowToolSeconds),
  };
  return { config, adjustments };
}

function coerce(raw, base) {
  return coerceDetailed(raw, base).config;
}

function serialize(config) {
  return `${JSON.stringify(
    {
      _说明: NOTE,
      intervalMinutes: config.intervalMinutes,
      maxToolCalls: config.maxToolCalls,
      minGapMinutes: config.minGapMinutes,
      minToolCalls: config.minToolCalls,
      enabled: config.enabled,
      mentionTodo: config.mentionTodo,
      lang: config.lang,
      template: config.template,
      slowToolSeconds: config.slowToolSeconds,
    },
    null,
    2,
  )}\n`;
}

/** 首次运行把默认值写出去，用户有个现成的文件可改。 */
function seedConfigFile(initial) {
  try {
    if (existsSync(CONFIG_FILE)) return;
    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, serialize(initial), 'utf8');
  } catch {
    /* 写不了就算了，用内置默认值 */
  }
}

/** 读文件；文件不在 / 坏了就返回 base。 */
function loadConfig(base) {
  try {
    return coerce(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), base);
  } catch {
    return base;
  }
}

function createUserMessage(input) {
  return Object.freeze({ ...input, role: 'user', id: randomUUID() });
}

/* ------------------------------------------------------------------ *
 * 文案
 * ------------------------------------------------------------------ */

function detectLang(cfg) {
  if (cfg.lang === 'zh' || cfg.lang === 'en') return cfg.lang;
  const env = `${process.env.DSH_LOCALE || ''} ${process.env.LC_ALL || ''} ${process.env.LANG || ''}`;
  if (/\ben[_-]/i.test(env)) return 'en';
  return 'zh';
}

const BUILTIN_ZH = (minutes, calls, slow) => {
  const lines = [
    `【进度检查点】已连续 ${calls} 次工具调用、${minutes} 分钟没说话。`,
  ];
  if (slow) lines.push('', `⚠︎ 刚才 \`${slow.tool}\` 跑了 ${slow.seconds} 秒，这期间我插不上话。`);
  lines.push(
    '',
    '不要停手，也别单独发一条纯文字消息：在接下来这条回复里，**先用一行写进度**，紧接着把原本要调的工具一起发出去。',
    '',
    '`进度 x/y · 已完成：… · 正在：… · 下一步：… · 风险：无 / <具体风险>`',
    '',
    '- 预感下一个调用会跑很久（构建 / 安装 / 大批文件）：先写这一行，再发那个调用。',
    '- 跑偏了（原计划走不通、有更省事的做法、偏离要求）：在下面补一句「原计划 / 现在情况 / 建议」，然后照常继续。',
  );
  return lines;
};

const BUILTIN_EN = (minutes, calls, slow) => {
  const lines = [
    `[progress check] ${calls} tool calls and ${minutes} min since you last said anything.`,
  ];
  if (slow) lines.push('', `(!) \`${slow.tool}\` just ran for ${slow.seconds}s — nothing could reach the user during that.`);
  lines.push(
    '',
    'Do not stop, and do not send a text-only message: in your next reply, **lead with one line of progress**, then send the tool calls you were about to make.',
    '',
    '`progress x/y · done: … · doing: … · next: … · risk: none / <risk>`',
    '',
    '- If the next call will take long (build / install / many files), write that line first, then make the call.',
    '- If you drifted (the plan no longer works, there is a cheaper way, or the request was misread), say「plan / now / proposal」in one line, then carry on.',
  );
  return lines;
};

function buildText(gapMinutes, callCount, cfg, slow) {
  const lang = detectLang(cfg);
  const tpl = typeof cfg.template === 'string' ? cfg.template.trim() : '';
  if (tpl) {
    return tpl
      .replace(/\{minutes\}/g, String(gapMinutes))
      .replace(/\{calls\}/g, String(callCount))
      .replace(/\{slow\}/g, slow ? `${slow.tool} ${slow.seconds}s` : '');
  }
  const lines = (lang === 'en' ? BUILTIN_EN : BUILTIN_ZH)(gapMinutes, callCount, slow);
  if (cfg.mentionTodo) {
    lines.push(lang === 'en' ? '- If the task list is stale, update it with `todo_write`.' : '- 清单不准了，顺手 `todo_write` 更新一下。');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 触发日志
 * ------------------------------------------------------------------ */

function appendLog(line) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    try {
      if (statSync(LOG_FILE).size > LOG_MAX_BYTES) {
        const kept = readFileSync(LOG_FILE, 'utf8').split('\n').slice(-200).join('\n');
        writeFileSync(LOG_FILE, `${kept}\n`, 'utf8');
      }
    } catch {
      /* 文件还不存在 */
    }
    appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    /* 日志写不了不影响提醒 */
  }
}

function hhmm(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ------------------------------------------------------------------ *
 * 设置页用的 HTTP 接口
 * ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  try {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(text);
  } catch {
    try {
      res.statusCode = 500;
      res.end();
    } catch {
      /* 连接已经断了 */
    }
  }
}

/** 只接受本机同源请求：挡住浏览器里别的网页顺手改配置。 */
function sameOriginOk(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const o = new URL(origin);
    const host = req.headers.host;
    return !host || o.host === host;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * @param {import('cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config) {
  const initial = coerce(config, DEFAULTS);
  seedConfigFile(initial);

  let cfg = initial;
  let stamp = -1;
  /** 给设置页看的：最近一次提醒是什么时候、因为什么 */
  const lastFire = { at: 0, minutes: 0, calls: 0, reason: '' };
  /** 最近一次被观察到的顶级 agent（设置页的「测试提醒」要塞给它） */
  let lastAgent = null;
  /** 工具名 → 平均耗时（只记超过阈值的那些） */
  const slowStats = new Map();
  /** 每个 exec 的开始时间，用来算这一次跑了多久 */
  const startedAt = new WeakMap();
  /** 下一次提醒里要捎带一提的慢工具 */
  let lastSlow = null;

  /** 每轮检查一次配置文件有没有被改过（stat 很便宜，开销可忽略）。 */
  const refresh = () => {
    try {
      const st = statSync(CONFIG_FILE);
      if (st.mtimeMs === stamp) return;
      stamp = st.mtimeMs;
      cfg = loadConfig(initial);
    } catch {
      /* 文件不存在 / 正在写 / 坏了：沿用上一次的值 */
    }
  };

  /** @type {WeakMap<object, {lastReportAt:number, calls:number, fired:number}>} */
  const states = new WeakMap();

  const log = (...args) => {
    try {
      if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(...args);
      else console.info('[progress-report]', ...args);
    } catch {
      /* 日志失败不影响主流程 */
    }
  };

  const stateOf = (agent) => {
    let s = states.get(agent);
    if (!s) {
      s = { lastReportAt: Date.now(), calls: 0, fired: 0 };
      states.set(agent, s);
    }
    return s;
  };

  /**
   * 子代理（workflow / subagent 起的）没有用户可汇报，别去打扰它。
   * 拿不到 agents 服务时一律当作主代理，宁可多提醒也不要整条静默。
   */
  const isSubagent = (agent) => {
    try {
      const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined;
      if (!agents || typeof agents.roots !== 'function') return false;
      const roots = agents.roots();
      return roots.length > 0 && !roots.includes(agent);
    } catch {
      return false;
    }
  };

  const buildReminder = (gapMinutes, calls, reason, slow) =>
    createUserMessage({
      content: [{ type: 'text', text: buildText(gapMinutes, calls, cfg, slow) }],
      source: {
        kind: 'progress-report',
        form: 'notice',
        summary: `进度检查点 · ${gapMinutes} 分钟 / ${calls} 次调用`,
      },
    });

  /** 把一条消息直接排进这个 agent 的下一步输入。 */
  const pushToAgent = (agent, message) => {
    try {
      const inbox = agent && agent.inbox;
      if (!inbox || typeof inbox.splice !== 'function') return false;
      const at = Array.isArray(inbox.nextStep) ? inbox.nextStep.length : 0;
      inbox.splice('next-step', at, 0, [message]);
      return true;
    } catch {
      return false;
    }
  };

  const observe = (exec) => {
    refresh();
    if (!cfg.enabled) return undefined;
    const agent = exec && exec.agent;
    if (!agent) return undefined;
    if (isSubagent(agent)) return undefined;
    lastAgent = agent;

    const s = stateOf(agent);
    s.calls += 1;

    const now = Date.now();
    const gapMs = now - s.lastReportAt;
    const byTime = gapMs >= cfg.intervalMinutes * 60_000;
    // 次数兜底也要隔 minGapMinutes：否则密集读文件时 12 次调用两分钟就凑满，
    // "每 10 分钟汇报"会退化成"每分钟被打断一次"。
    const byCalls =
      cfg.maxToolCalls > 0 &&
      s.calls >= Math.max(cfg.maxToolCalls, cfg.minToolCalls) &&
      gapMs >= cfg.minGapMinutes * 60_000;

    // 慢工具：这一次跑得久，即使还没到点，也值得让用户知道刚才为什么安静。
    const started = startedAt.get(exec);
    const ranMs = started ? now - started : 0;
    const slowNow = ranMs >= cfg.slowToolSeconds * 1000;
    const bySlow = slowNow && gapMs >= Math.min(cfg.minGapMinutes, 1) * 60_000 && s.calls >= cfg.minToolCalls;

    if (!byTime && !byCalls && !bySlow) return undefined;
    if (s.calls < cfg.minToolCalls) return undefined;

    const gapMinutes = Math.max(1, Math.round(gapMs / 60_000));
    const calls = s.calls;
    const slow = lastSlow;
    lastSlow = null;
    s.lastReportAt = now;
    s.calls = 0;
    s.fired += 1;

    const reasonText =
      bySlow && !byTime && !byCalls
        ? '慢工具'
        : byTime && byCalls
          ? '时间到 + 调用次数到'
          : byTime
            ? '时间到'
            : '调用次数到';

    lastFire.at = now;
    lastFire.minutes = gapMinutes;
    lastFire.calls = calls;
    lastFire.reason = reasonText;

    appendLog(
      `${hhmm(now)} fire reason=${reasonText} gap=${gapMinutes}min calls=${calls}` +
        (slow ? ` slow=${slow.tool}:${slow.seconds}s` : ''),
    );

    return buildReminder(gapMinutes, calls, reasonText, slow);
  };

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (exec && typeof exec === 'object') startedAt.set(exec, Date.now());
    } catch {
      /* 记不上就算了 */
    }
    return next();
  });

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    // 先算这一次跑了多久：慢的话要在下面这条提醒里就能点名，而不是等到下一次
    try {
      const started = exec && startedAt.get(exec);
      if (started && exec && typeof exec.name === 'string') {
        const ranSeconds = Math.round((Date.now() - started) / 1000);
        if (ranSeconds >= cfg.slowToolSeconds) {
          lastSlow = { tool: exec.name, seconds: ranSeconds };
          const prev = slowStats.get(exec.name);
          slowStats.set(exec.name, {
            avgSeconds: prev ? Math.round(prev.avgSeconds * 0.6 + ranSeconds * 0.4) : ranSeconds,
            count: (prev?.count ?? 0) + 1,
          });
        }
      }
    } catch {
      /* 统计失败不影响提醒 */
    }

    const reminder = observe(exec);

    const downstream = await next();
    if (!reminder) return downstream;
    const additionalContexts = [reminder, ...(downstream.additionalContexts ?? [])];
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts };
    }
    return { ...downstream, additionalContexts };
  });

  ctx.on('agent/pre-step', (payload, next) => {
    const messages = payload && payload.messages;
    const agent = payload && payload.agent;
    if (agent) lastAgent = agent;
    if (
      agent &&
      Array.isArray(messages) &&
      messages.some((m) => m && m.source && m.source.kind === 'user')
    ) {
      const s = states.get(agent);
      if (s) {
        s.lastReportAt = Date.now();
        s.calls = 0;
        s.fired = 0;
      } else {
        stateOf(agent);
      }
    }
    return next();
  });

  /** 自检用：设置页的客户端包有没有被 DSH 的 clientModules 收进去。 */
  const clientBundlePath = () => {
    try {
      const cm = typeof ctx.get === 'function' ? ctx.get('clientModules') : undefined;
      const p = cm && typeof cm.clientPath === 'function' ? cm.clientPath('dsh-progress-report') : undefined;
      return p ? { ok: true, path: p } : { ok: false, reason: 'clientModules 里没有这个包' };
    } catch (e) {
      return { ok: false, reason: e?.message ?? String(e) };
    }
  };

  const slowToolList = () =>
    [...slowStats.entries()]
      .map(([toolName, v]) => ({ name: toolName, avgSeconds: v.avgSeconds, count: v.count }))
      .sort((a, b) => b.avgSeconds - a.avgSeconds)
      .slice(0, 5);

  /* 设置页的后端。webServer 是可选的：拿不到就只留提醒功能。 */
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (sub) => {
        sub.effect(
          () =>
            sub.webServer.register({
              kind: 'prefix',
              path: '/api/progress-report',
              handler: async (req, res) => {
                if (!sameOriginOk(req)) {
                  sendJson(res, 403, { ok: false, error: '只接受本机同源请求' });
                  return;
                }
                let path = '/';
                try {
                  path = new URL(req.url, 'http://127.0.0.1').pathname.replace(/\/+$/, '');
                } catch {
                  /* 保留 '/' */
                }

                try {
                  if (req.method === 'GET' && path === '/api/progress-report/config') {
                    refresh();
                    sendJson(res, 200, {
                      ok: true,
                      config: cfg,
                      defaults: initial,
                      limits: LIMITS,
                      file: CONFIG_FILE,
                      logFile: LOG_FILE,
                      lastFire: lastFire.at ? lastFire : null,
                      slowTools: slowToolList(),
                      client: clientBundlePath(),
                    });
                    return;
                  }

                  if (req.method === 'POST' && path === '/api/progress-report/config') {
                    const body = await readBody(req);
                    if (!body) {
                      sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
                      return;
                    }
                    const { config: next, adjustments } = coerceDetailed(
                      { ...loadConfig(initial), ...body },
                      initial,
                    );
                    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
                    writeFileSync(CONFIG_FILE, serialize(next), 'utf8');
                    // 主动刷新：不用等下一次工具调用去发现 mtime 变了
                    cfg = next;
                    try {
                      stamp = statSync(CONFIG_FILE).mtimeMs;
                    } catch {
                      stamp = -1;
                    }
                    appendLog(`${hhmm(Date.now())} config saved ${JSON.stringify(body)}`);
                    sendJson(res, 200, { ok: true, config: cfg, file: CONFIG_FILE, adjustments });
                    return;
                  }

                  if (req.method === 'POST' && path === '/api/progress-report/test') {
                    refresh();
                    const text = buildText(1, cfg.minToolCalls, cfg, null);
                    const message = createUserMessage({
                      content: [{ type: 'text', text }],
                      source: {
                        kind: 'progress-report',
                        form: 'notice',
                        summary: '进度检查点 · 测试',
                      },
                    });
                    const delivered = lastAgent ? pushToAgent(lastAgent, message) : false;
                    appendLog(
                      `${hhmm(Date.now())} test delivered=${delivered} agent=${lastAgent ? 'yes' : 'none'}`,
                    );
                    sendJson(res, 200, {
                      ok: true,
                      delivered,
                      reason: lastAgent
                        ? delivered
                          ? '已排进下一步输入，模型下一次开口就会看到'
                          : '拿到会话了，但它的收件箱不收消息'
                        : '还没有在这个进程里见到过会话，先在会话里跑一次工具再来',
                      text,
                    });
                    return;
                  }

                  sendJson(res, 404, { ok: false, error: '没有这个接口' });
                } catch (err) {
                  sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
                }
              },
            }),
          'progress-report: 设置接口',
        );
      });
    }
  } catch (e) {
    log(`设置接口没挂上（提醒功能不受影响）：${e?.message ?? e}`);
  }

  log(
    `已启用：每 ${initial.intervalMinutes} 分钟或连续 ${initial.maxToolCalls} 次工具调用强制汇报一次；` +
      `运行期改 ${CONFIG_FILE}（或在 设置 › 进度汇报 里改）即时生效`,
  );
}

/** 只给 test/ 用：把纯函数暴露出去，免得为了测试去起一个真的 DSH。 */
export const testing = { DEFAULTS, LIMITS, coerce, coerceDetailed, buildText, detectLang, serialize };
