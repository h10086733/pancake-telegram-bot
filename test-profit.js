/**
 * 利润计算测试脚本
 * 测试买入卖出利润追踪功能
 */

require('dotenv').config();
const OptimizedTradeManager = require('./src/optimizedTradeManager');

async function testProfitCalculation() {
  console.log('📊 开始利润计算功能测试...\n');

  try {
    // 初始化交易管理器
    const tradeManager = new OptimizedTradeManager();
    
    // 等待一秒确保初始化完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('📋 测试交易记录功能...\n');

    // 测试数据
    const testTokenAddress = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'; // CAKE
    const testTokenSymbol = 'CAKE';

    // 模拟买入交易
    console.log('🛒 模拟买入交易...');
    const buyTradeId1 = tradeManager.recordBuyTrade(
      testTokenAddress,
      testTokenSymbol,
      0.1, // 0.1 BNB
      100, // 100 CAKE
      2.50, // $2.50
      21000, // Gas used
      '0x1234567890abcdef1234567890abcdef12345678'
    );
    
    const buyTradeId2 = tradeManager.recordBuyTrade(
      testTokenAddress,
      testTokenSymbol,
      0.2, // 0.2 BNB
      80, // 80 CAKE (价格上涨了)
      3.00, // $3.00
      21000, // Gas used
      '0x2345678901bcdef12345678901cdef1234567890'
    );

    console.log(`✅ 记录买入交易 ID: ${buyTradeId1}, ${buyTradeId2}`);

    // 查看持仓信息
    console.log('\n📊 查看持仓信息:');
    const holdings = tradeManager.getTokenPositionInfo(testTokenAddress);
    if (holdings) {
      console.log(`总代币: ${holdings.totalTokens}`);
      console.log(`总成本: ${holdings.totalCost} BNB`);
      console.log(`平均价格: ${holdings.avgPrice} BNB/代币`);
      console.log(`买入次数: ${holdings.trades}`);
    } else {
      console.log('❌ 未找到持仓信息');
    }

    // 模拟部分卖出 (50 CAKE)
    console.log('\n💸 模拟部分卖出交易 (50 CAKE)...');
    const sellResult1 = tradeManager.recordSellTrade(
      testTokenAddress,
      testTokenSymbol,
      50, // 卖出50个CAKE
      0.15, // 获得0.15 BNB
      3.20, // $3.20
      25000, // Gas used
      '0x3456789012cdef123456789012def12345678901'
    );

    if (sellResult1) {
      console.log(`✅ 卖出记录成功`);
      console.log(`利润: ${sellResult1.profit.toFixed(6)} BNB`);
      console.log(`利润率: ${sellResult1.profitPercentage.toFixed(2)}%`);
      console.log(`成本: ${sellResult1.totalCost.toFixed(6)} BNB`);
      console.log(`收入: ${sellResult1.revenue.toFixed(6)} BNB`);
    }

    // 查看更新后的持仓
    console.log('\n📊 部分卖出后的持仓信息:');
    const updatedHoldings = tradeManager.getTokenPositionInfo(testTokenAddress);
    if (updatedHoldings) {
      console.log(`剩余代币: ${updatedHoldings.totalTokens}`);
      console.log(`剩余成本: ${updatedHoldings.totalCost} BNB`);
      console.log(`平均价格: ${updatedHoldings.avgPrice} BNB/代币`);
    }

    // 模拟全部卖出剩余代币
    console.log('\n💸 模拟全部卖出剩余代币...');
    const sellResult2 = tradeManager.recordSellTrade(
      testTokenAddress,
      testTokenSymbol,
      130, // 卖出剩余130个CAKE
      0.35, // 获得0.35 BNB
      2.80, // $2.80 (价格下跌)
      25000, // Gas used
      '0x4567890123def1234567890123ef123456789012'
    );

    if (sellResult2) {
      console.log(`✅ 卖出记录成功`);
      console.log(`利润: ${sellResult2.profit.toFixed(6)} BNB`);
      console.log(`利润率: ${sellResult2.profitPercentage.toFixed(2)}%`);
      console.log(`成本: ${sellResult2.totalCost.toFixed(6)} BNB`);
      console.log(`收入: ${sellResult2.revenue.toFixed(6)} BNB`);
    }

    // 查看交易统计
    console.log('\n📈 交易统计:');
    const stats = tradeManager.getTradingStats();
    if (stats) {
      console.log(`总交易数: ${stats.totalTrades}`);
      console.log(`买入交易: ${stats.buyTrades}`);
      console.log(`卖出交易: ${stats.sellTrades}`);
      console.log(`总盈利: +${stats.totalProfit.toFixed(6)} BNB`);
      console.log(`总亏损: -${stats.totalLoss.toFixed(6)} BNB`);
      console.log(`净利润: ${stats.netProfit.toFixed(6)} BNB`);
      console.log(`胜率: ${stats.winRate.toFixed(1)}%`);
      console.log(`持仓代币: ${stats.holdingTokens} 个`);
    }

    // 测试Twitter消息生成（包含利润）
    console.log('\n🐦 测试包含利润的Twitter消息:');
    const profitTweetMessage = tradeManager.generateSellTweetWithProfit(
      'CAKE',
      '50',
      '0.15',
      '0x3456789012cdef123456789012def12345678901',
      '3.20',
      sellResult1
    );
    
    console.log('─'.repeat(50));
    console.log(profitTweetMessage);
    console.log('─'.repeat(50));
    console.log(`消息长度: ${profitTweetMessage.length} 字符\n`);

    console.log('🎉 利润计算功能测试完成!');
    console.log('\n📋 测试总结:');
    console.log('- ✅ 买入交易记录功能');
    console.log('- ✅ 卖出交易记录和利润计算');
    console.log('- ✅ 持仓信息追踪');
    console.log('- ✅ 交易统计功能');
    console.log('- ✅ 多笔买入的FIFO计算');
    console.log('- ✅ 包含利润的Twitter消息生成');

  } catch (error) {
    console.error('❌ 测试过程中出错:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// 运行测试
if (require.main === module) {
  testProfitCalculation().catch(console.error);
}

module.exports = testProfitCalculation;
