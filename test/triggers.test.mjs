/**
 * 触发器与文案的单元测试：不启动 DSH，用假的 ctx 抓事件处理器。
 * 跑法：node --test test/
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

// 必须在 import 之前：模块加载时就把 CONFIG_FILE 算好了
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pr-test-'));

const entry = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const mod = await import(pathToFileURL(entry).href);
const { testing } = mod;

/** 假 ctx：只实现插件用到的那几件事。 */
function makeCtx({ roots } = {}) {
  const handlers = new Map();
  const ctx = {
    on(event, fn) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
      return () => {};
    },
    get(key) {
      if (key === 'agents' && roots) return { roots: () => roots };
      return undefined;
    },
    inject() {},
    effect() {},
    logger: { info() {} },
  };
  return { ctx, handlers };
}

const callHook = (handlers, event, ...args) => {
  const fns = handlers.get(event) ?? [];
  assert.ok(fns.length > 0, `${event} 没有处理器`);
  return fns[0](...args);
};

const passThrough = async () => ({ kind: 'enter' });

/** 让插件跑起来，返回 handlers 与 exec 工厂。 */
function boot(config, opts = {}) {
  // 运行期配置文件优先于 cordis 里的 config —— 先把这次要测的值写进文件
  writeFileSync(
    join(process.env.DSH_HOME, 'progress-report.json'),
    testing.serialize(testing.coerce(config, testing.DEFAULTS)),
    'utf8',
  );
  const { ctx, handlers } = makeCtx(opts);
  mod.apply(ctx, config);
  const agent = { id: 'agent-1', inbox: { nextStep: [], splice() {} } };
  const exec = (name = 'pwsh') => ({ agent, name, arguments: {} });
  return { handlers, agent, exec };
}

test('次数没到就不打扰', async () => {
  const { handlers, exec } = boot({
    intervalMinutes: 1440,
    maxToolCalls: 3,
    minGapMinutes: 0,
    minToolCalls: 1,
  });
  const out = await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  assert.equal(out.additionalContexts, undefined);
});

test('连续调用到达阈值就注入一条 notice', async () => {
  const { handlers, exec } = boot({
    intervalMinutes: 1440,
    maxToolCalls: 2,
    minGapMinutes: 0,
    minToolCalls: 1,
  });
  await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  const out = await callHook(handlers, 'tools/post-execute', exec('read'), {}, passThrough);

  assert.equal(out.additionalContexts.length, 1);
  const msg = out.additionalContexts[0];
  assert.equal(msg.role, 'user');
  assert.equal(msg.source.kind, 'progress-report');
  assert.equal(msg.source.form, 'notice');
  assert.match(msg.content[0].text, /进度检查点/);
});

test('触发后计数归零，需要再攒一轮', async () => {
  const { handlers, exec } = boot({
    intervalMinutes: 1440,
    maxToolCalls: 2,
    minGapMinutes: 0,
    minToolCalls: 1,
  });
  await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  const first = await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  assert.equal(first.additionalContexts.length, 1);

  const soon = await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  assert.equal(soon.additionalContexts, undefined, '紧接着的一次不该再插');
});

test('真人用户消息把计数清零', async () => {
  const { handlers, exec, agent } = boot({
    intervalMinutes: 1440,
    maxToolCalls: 3,
    minGapMinutes: 0,
    minToolCalls: 1,
  });
  await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  await callHook(handlers, 'agent/pre-step', {
    agent,
    messages: [{ role: 'user', source: { kind: 'user' } }],
  }, passThrough);

  const out = await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  assert.equal(out.additionalContexts, undefined, '归零后一次调用不该触发');
});

test('自定义文案会替换占位符', async () => {
  const { handlers, exec } = boot({
    intervalMinutes: 1440,
    maxToolCalls: 2,
    minGapMinutes: 0,
    minToolCalls: 1,
    template: '跑了 {calls} 次、{minutes} 分钟，[slow={slow}] 继续',
  });
  await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  const out = await callHook(handlers, 'tools/post-execute', exec(), {}, passThrough);
  const text = out.additionalContexts[0].content[0].text;
  assert.match(text, /跑了 2 次/);
  assert.match(text, /\[slow=\]/);
  assert.ok(!text.includes('{'), '占位符应该都换掉了');
});

test('慢工具会被单独记下来并点名', async () => {
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;

    const { handlers, exec } = boot({
      intervalMinutes: 1440,
      maxToolCalls: 0,
      minGapMinutes: 0,
      minToolCalls: 1,
      slowToolSeconds: 10,
    });
    const e = exec('pwsh');
    await callHook(handlers, 'tools/pre-execute', e, passThrough);
    now += 120_000; // 这一跑就是两分钟
    const out = await callHook(handlers, 'tools/post-execute', e, {}, passThrough);

    assert.equal(out.additionalContexts.length, 1, '慢工具应该单独触发一次');
    assert.match(out.additionalContexts[0].content[0].text, /pwsh/);
  } finally {
    Date.now = realNow;
  }
});

test('子代理不提醒', async () => {
  const sub = { id: 'sub-1' };
  const { handlers, exec } = boot(
    { intervalMinutes: 1440, maxToolCalls: 1, minGapMinutes: 0, minToolCalls: 1 },
    { roots: [{ id: 'main' }] },
  );
  const e = exec();
  e.agent = sub;
  const out = await callHook(handlers, 'tools/post-execute', e, {}, passThrough);
  assert.equal(out.additionalContexts, undefined);
});

test('数值越界会被钳到边界，并记下调整', () => {
  const { config, adjustments } = testing.coerceDetailed(
    { intervalMinutes: 0.1, maxToolCalls: 99999, minGapMinutes: -5, minToolCalls: 0 },
    testing.DEFAULTS,
  );
  assert.equal(config.intervalMinutes, 0.5);
  assert.equal(config.maxToolCalls, 1000);
  assert.equal(config.minGapMinutes, 0);
  assert.equal(config.minToolCalls, 1);
  assert.equal(adjustments.length, 4);
  assert.ok(adjustments.every((a) => a.input !== a.value && a.min <= a.value && a.value <= a.max));
});

test('非法值退回默认，不算"调整"', () => {
  const { config, adjustments } = testing.coerceDetailed(
    { intervalMinutes: 'abc', enabled: 'yes', lang: 'klingon' },
    testing.DEFAULTS,
  );
  assert.equal(config.intervalMinutes, testing.DEFAULTS.intervalMinutes);
  assert.equal(config.enabled, true);
  assert.equal(config.lang, 'auto');
  assert.equal(adjustments.length, 0);
});

test('英文文案', () => {
  const text = testing.buildText(10, 12, { ...testing.DEFAULTS, lang: 'en' }, null);
  assert.match(text, /progress check/);
  assert.match(text, /10 min/);
});

test('慢工具在英文文案里也点名', () => {
  const text = testing.buildText(10, 12, { ...testing.DEFAULTS, lang: 'en' }, { tool: 'pwsh', seconds: 120 });
  assert.match(text, /pwsh.*just ran for 120s/);
});

test('存档文件可以再读回来', () => {
  const raw = testing.serialize({ ...testing.DEFAULTS, intervalMinutes: 7, template: 'x {calls} y' });
  const back = testing.coerce(JSON.parse(raw), testing.DEFAULTS);
  assert.equal(back.intervalMinutes, 7);
  assert.equal(back.template, 'x {calls} y');
});

test('配置文件不存在时，插件自己播种一份', () => {
  // 删掉文件，模拟"刚装上、还没人碰过设置"
  rmSync(join(process.env.DSH_HOME, 'progress-report.json'), { force: true });
  const { ctx } = makeCtx();
  mod.apply(ctx, { intervalMinutes: 7, maxToolCalls: 4 });
  const text = readFileSync(join(process.env.DSH_HOME, 'progress-report.json'), 'utf8');
  const seeded = JSON.parse(text);
  assert.equal(seeded.intervalMinutes, 7);
  assert.equal(seeded.maxToolCalls, 4);
  assert.equal(seeded.lang, 'auto');
});
