import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStock, parseRow, isEligible } from '../src/parse.js';

test('区分 5090 和 5090 D 库存', () => {
  assert.deepEqual(parseStock('RTX 5090 (1/2056)'), { idle: 1, total: 2056 });
  assert.equal(parseStock('RTX 5090 D (1/240)'), null);
});
test('识别主机并筛选 GPU 和扩容量', () => {
  const cells = ['id', 'B80机', 'RTX 5090\n32GB', '1 / 8', 'CPU', 'Xeon', '数据盘：50GB\n可扩容：50GB', 'CUDA', '￥2.78/时\n￥2.93/时'];
  const row = parseRow(cells);
  assert.equal(row.pricePerHour, 2.78);
  assert.equal(isEligible(row), true);
  assert.equal(isEligible({ ...row, expandGb: 49 }), false);
  assert.equal(isEligible({ ...row, idle: 0 }), false);
  assert.equal(parseRow(cells.toSpliced(2, 1, 'RTX 5090 D\n32GB')), null);
  assert.equal(parseRow(cells.toSpliced(6, 1, '数据盘：50GB')), null);
});
