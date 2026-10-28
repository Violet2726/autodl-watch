export function parseStock(text) {
  const m = String(text).match(/^\s*RTX\s*5090\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/i);
  return m ? { idle: Number(m[1]), total: Number(m[2]) } : null;
}

export function parseRow(cells) {
  if (!Array.isArray(cells) || cells.length < 9) return null;
  const gpu = cells[2].replace(/\s+/g, ' ').trim();
  if (!/^RTX\s+5090\s+32GB$/i.test(gpu)) return null;
  const idle = cells[3].match(/(\d+)\s*\/\s*(\d+)/);
  const free = cells[6].match(/数据盘\s*[：:]\s*(\d+(?:\.\d+)?)\s*GB/i);
  const expand = cells[6].match(/可扩容\s*[：:]\s*(\d+(?:\.\d+)?)\s*GB/i);
  const price = cells[8].match(/[￥¥]\s*(\d+(?:\.\d+)?)/);
  if (!idle || !free || !expand || !price) return null;
  return { host: cells[1].trim(), idle: Number(idle[1]), total: Number(idle[2]), freeGb: Number(free[1]), expandGb: Number(expand[1]), pricePerHour: Number(price[1]) };
}

export function isEligible(row, minExpansionGb = 50) {
  return !!row && row.idle >= 1 && row.freeGb >= 50 && row.expandGb >= minExpansionGb;
}
