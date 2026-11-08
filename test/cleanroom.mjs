/**
 * 打包完整性测试：把「npm 会打进 tarball 的那几个文件」复制到一个空目录，
 * 从那里加载插件 —— 等价于「用户真的装了一个包」。
 *
 * 它挡的是这种事故：代码里 import 了没写进 files 的文件、或者漏了 client.js /
 * cordis.patch.yml，本机开发一切正常，用户装上就是坏的。
 *
 * 跑法：node test/cleanroom.mjs（不需要网络、不需要 DSH）
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 1. 按 package.json 的 files 白名单复制，模拟 npm pack
const stage = mkdtempSync(join(tmpdir(), 'pr-pack-'));
const entries = pkg.files ?? [];
assert.ok(entries.length > 0, 'package.json 里没有 files 白名单，装到用户机器上会带一堆垃圾');

for (const rel of entries) {
  const from = join(root, rel);
  assert.ok(existsSync(from), `files 里写了 ${rel}，但仓库里没有这个路径`);
  cpSync(from, join(stage, rel), { recursive: true });
}
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

// 2. 该有的入口一个都不能少
for (const rel of ['lib/index.js', 'client.js', 'cordis.patch.yml', 'README.md']) {
  assert.ok(existsSync(join(stage, rel)), `打出来的包里缺 ${rel}`);
}

// 3. 从这个"已安装"的副本加载，而不是从源码目录
const home = mkdtempSync(join(tmpdir(), 'pr-home-'));
process.env.DSH_HOME = home;

const mod = await import(pathToFileURL(join(stage, 'lib/index.js')).href);
assert.equal(typeof mod.apply, 'function', '包里没有 apply()');
assert.equal(mod.name, 'progress-report', 'name 不对');

// 4. 真的能挂上事件、注册接口、在到点时产出提醒
const handlers = new Map();
const routes = [];
const ctx = {
  on: (event, fn) => handlers.set(event, [...(handlers.get(event) ?? []), fn]),
  get: () => undefined,
  inject: (deps, fn) => {
    if (deps.includes('webServer')) {
      fn({ webServer: { register: (r) => routes.push(r) }, effect: (f) => f() });
    }
  },
  effect: (f) => f(),
  logger: { info() {} },
};

mod.apply(ctx, { intervalMinutes: 0.5, maxToolCalls: 2, minToolCalls: 1, minGapMinutes: 0 });

for (const ev of ['tools/pre-execute', 'tools/post-execute', 'agent/pre-step', 'agent/assistant-stream']) {
  assert.ok(handlers.has(ev), `没有挂 ${ev}`);
}
assert.ok(routes.length > 0, '没有注册设置接口');

const now = Date.now;
let fake = now();
Date.now = () => fake;
try {
  const agent = { id: 'a1', inbox: { nextStep: [], splice() {} } };
  const exec = { agent, name: 'pwsh', arguments: {} };
  const next = async () => ({ kind: 'enter' });
  await handlers.get('tools/post-execute')[0](exec, { kind: 'enter' }, next);
  fake += 10 * 60 * 1000;
  const res = await handlers.get('tools/post-execute')[0](exec, { kind: 'enter' }, next);
  assert.ok(Array.isArray(res.additionalContexts) && res.additionalContexts.length === 1, '到点没有注入提醒');
  console.log('  injected:', res.additionalContexts[0].content[0].text.split('\n')[0]);
} finally {
  Date.now = now;
}

// 5. 配置文件要自己播种出来
const cfgPath = join(home, 'progress-report.json');
assert.ok(existsSync(cfgPath), '没有播种配置文件');
assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).intervalMinutes, 0.5);

console.log(`clean-room ok (${pkg.name}@${pkg.version})`);
console.log('  routes:', routes.map((r) => r.path).join(', '));
console.log('  config file:', cfgPath);
