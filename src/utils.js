const fs = require('fs');

// 格式化数字显示
function formatNumber(num, decimals = 6) {
  if (typeof num === 'string') {
    num = parseFloat(num);
  }
  
  if (num === 0) return '0';
  
  if (num < 0.000001) {
    return num.toExponential(2);
  }
  
  if (num < 1) {
    return num.toFixed(8).replace(/\.?0+$/, '');
  }
  
  if (num < 1000) {
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  }
  
  if (num < 1000000) {
    return (num / 1000).toFixed(2) + 'K';
  }
  
  if (num < 1000000000) {
    return (num / 1000000).toFixed(2) + 'M';
  }
  
  return (num / 1000000000).toFixed(2) + 'B';
}

// 格式化地址显示
function formatAddress(address, start = 6, end = 4) {
  if (!address) return '';
  if (address.length < start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

// 格式化百分比
function formatPercentage(num) {
  if (typeof num === 'string') {
    num = parseFloat(num);
  }
  
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 验证以太坊地址
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// 验证数字
function isValidNumber(value, min = 0, max = Infinity) {
  const num = parseFloat(value);
  return !isNaN(num) && num >= min && num <= max;
}

// 睡眠函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 创建目录（如果不存在）
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 保存交易记录
function saveTradeRecord(trade) {
  try {
    ensureDir('./logs/trades');
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `./logs/trades/${date}.json`;
    
    let records = [];
    if (fs.existsSync(filename)) {
      const content = fs.readFileSync(filename, 'utf8');
      records = JSON.parse(content);
    }
    
    records.push({
      timestamp: new Date().toISOString(),
      ...trade
    });
    
    fs.writeFileSync(filename, JSON.stringify(records, null, 2));
    return true;
  } catch (error) {
    console.error('Save trade record error:', error);
    return false;
  }
}

// 读取交易记录
function loadTradeRecords(date = null) {
  try {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const filename = `./logs/trades/${targetDate}.json`;
    
    if (!fs.existsSync(filename)) {
      return [];
    }
    
    const content = fs.readFileSync(filename, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Load trade records error:', error);
    return [];
  }
}

// 计算滑点
function calculateSlippage(expectedAmount, actualAmount) {
  if (expectedAmount === 0) return 0;
  return ((expectedAmount - actualAmount) / expectedAmount) * 100;
}

// 计算价格影响
function calculatePriceImpact(amountIn, reserveIn, reserveOut) {
  // 使用恒定乘积公式计算价格影响
  const amountInWithFee = amountIn * 997; // 0.3% 手续费
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 1000) + amountInWithFee;
  const amountOut = numerator / denominator;
  
  const priceAfter = (reserveIn + amountIn) / (reserveOut - amountOut);
  const priceBefore = reserveIn / reserveOut;
  
  return ((priceAfter - priceBefore) / priceBefore) * 100;
}

// 生成交易摘要
function generateTradeSummary(trade) {
  const emoji = trade.type === 'buy' ? '🟢' : '🔴';
  const action = trade.type === 'buy' ? '购买' : '出售';
  
  return `
${emoji} *${action}交易*

📄 哈希: \`${formatAddress(trade.txHash, 8, 8)}\`
💰 金额: ${formatNumber(trade.amountIn)} ${trade.tokenInSymbol}
🎯 获得: ${formatNumber(trade.amountOut)} ${trade.tokenOutSymbol}
⛽ Gas: ${formatNumber(trade.gasUsed)} (${formatNumber(trade.gasCost)} BNB)
📊 滑点: ${formatPercentage(trade.slippage)}
⏰ 时间: ${formatTime(trade.timestamp)}
  `.trim();
}

// 错误处理包装器
function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in ${fn.name}:`, error);
      throw error;
    }
  };
}

// 重试机制
async function retry(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(delay * Math.pow(2, i)); // 指数退避
    }
  }
}

module.exports = {
  formatNumber,
  formatAddress,
  formatPercentage,
  formatTime,
  isValidAddress,
  isValidNumber,
  sleep,
  ensureDir,
  saveTradeRecord,
  loadTradeRecords,
  calculateSlippage,
  calculatePriceImpact,
  generateTradeSummary,
  withErrorHandling,
  retry
};
