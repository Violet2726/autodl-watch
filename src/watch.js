import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStock, parseRow, isEligible } from './parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = path.join(root, '.browser-profile');
const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const intervalSeconds = Number(process.env.POLL_SECONDS || 30);
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 20) throw Error('POLL_SECONDS 必须为不小于 20 的数字。');
const configPath = path.join(root, 'config.local.json');
if (!fs.existsSync(configPath)) throw Error('缺少 config.local.json；请复制 config.example.json 并填写 sourceInstanceId。');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const expectedId = config.sourceInstanceId;
if (typeof expectedId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(expectedId)) {
  throw Error('请在 config.local.json 中填写有效的 sourceInstanceId。');
}
function log(message) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(logDir, 'monitor.log'), line + '\n');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: false,
  viewport: { width: 1400, height: 900 }
});
let stopped = false;
process.on('SIGINT', async () => { stopped = true; await context.close().catch(() => {}); process.exit(0); });
const page = context.pages()[0] || await context.newPage();
await page.goto('https://www.autodl.com/console/instance/list', { waitUntil: 'domcontentloaded' });
log('只读模式：不会创建实例或提交订单。');
log('请在新打开的 Edge 窗口登录；脚本会尝试打开源实例的克隆页并勾选数据盘。');
log('请不要关闭该窗口；按 Ctrl+C 停止监控。');

let cloneUrl;
let enteredClone = false;
while (!stopped) {
  if (page.isClosed()) throw Error('浏览器窗口已关闭。');
  const url = new URL(page.url());
  if (url.hostname === 'www.autodl.com' && url.pathname === '/cloneInstance' && url.searchParams.get('id') === expectedId && url.searchParams.get('copy_data_disk') === '1') {
    cloneUrl = url.href;
    break;
  }
  if (!enteredClone && url.hostname === 'www.autodl.com' && url.pathname === '/console/instance/list') {
    const source = page.locator('tr').filter({ hasText: expectedId });
    if (await source.count() === 1 && await source.getByRole('button', { name: '更多' }).isVisible()) {
      enteredClone = true;
      try {
        await source.getByRole('button', { name: '更多' }).click();
        await page.locator('.el-dropdown-menu:visible').getByText('克隆实例', { exact: true }).click();
        const dataDisk = page.locator('label.el-checkbox').filter({ has: page.locator('input[value="copy_data_disk"]') }).filter({ visible: true });
        await dataDisk.click({ timeout: 10000 });
        if (!(await dataDisk.locator('input').isChecked())) throw Error('数据盘选项未勾选。');
        await page.getByRole('button', { name: '继续', exact: true }).click();
        log('已打开源实例克隆页并选择复制数据盘。');
      } catch (error) {
        log(`自动进入克隆页失败：${error.message}。请手动从源实例进入克隆页面并勾选数据盘。`);
      }
    }
  }
  await pause(1000);
}
log('已识别源实例及数据盘复制选项，开始监控。');

async function poll() {
  const current = new URL(page.url());
  if (current.hostname !== 'www.autodl.com' || current.pathname !== '/cloneInstance' || current.searchParams.get('id') !== expectedId || current.searchParams.get('copy_data_disk') !== '1') {
    throw Error('页面已离开指定克隆流程，暂停以避免误判；请重新运行并完成登录。');
  }
  const label = page.locator('label.el-checkbox').filter({ has: page.locator('input[value="RTX 5090"]') });
  await label.waitFor({ state: 'visible', timeout: 30000 });
  const checkbox = label.locator('input[type="checkbox"]');
  if (!(await checkbox.isChecked())) await label.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('input[value="RTX 5090"]')?.closest('label');
    return /RTX\s*5090\s*\(\s*\d+\s*\/\s*\d+\s*\)/.test(el?.innerText || '');
  }, null, { timeout: 30000 });
  const stock = parseStock(await label.innerText());
  if (!stock) throw Error('无法识别 RTX 5090 库存；页面可能发生变化。');
  if (stock.idle === 0) { log(`RTX 5090 空闲 ${stock.idle}/${stock.total}；暂不扫描主机。`); return; }
  await page.waitForTimeout(1200);
  const table = page.locator('.el-table__body-wrapper').filter({ has: page.locator('tr.el-table__row') }).first();
  await table.waitFor({ state: 'visible', timeout: 20000 });
  let stable = 0, previous = -1;
  // 页面采用懒加载。滚动列表到末尾并等新增行，最多检查 80 次。
  for (let i = 0; i < 80 && stable < 4; i++) {
    const info = await table.evaluate(el => ({ count: el.querySelectorAll('tr.el-table__row').length, height: el.scrollHeight, top: el.scrollTop, client: el.clientHeight }));
    stable = info.count === previous && info.top + info.client >= info.height - 3 ? stable + 1 : 0;
    previous = info.count;
    await table.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(750);
  }
  const cells = await table.locator('tr.el-table__row').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td'), td => td.innerText)));
  const parsed = cells.map(parseRow).filter(Boolean);
  const matches = parsed.filter(row => isEligible(row));
  log(`RTX 5090 空闲 ${stock.idle}/${stock.total}；检查 ${parsed.length} 台主机，符合磁盘和库存条件 ${matches.length} 台。`);
  for (const row of matches) log(`发现候选：${row.host}，空闲 ${row.idle}/${row.total}，免费 ${row.freeGb}GB，可扩容 ${row.expandGb}GB，显示价格 ¥${row.pricePerHour}/小时。`);
  if (matches.length) { process.stdout.write('\x07'); log('只读测试不会自动租用；请自行核对价格和库存。'); }
  else log('库存汇总非零但未找到符合条件的主机；列表懒加载或库存变化可能导致遗漏，不能视为无候选。');
}

try {
  while (!stopped) {
    await poll();
    await pause(intervalSeconds * 1000);
    if (!stopped) await page.goto(cloneUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
} catch (error) {
  log(`监控已停止：${error.message}`);
  process.exitCode = 1;
} finally { await context.close().catch(() => {}); }
