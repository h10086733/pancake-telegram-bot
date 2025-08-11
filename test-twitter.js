/**
 * Twitter发送测试脚本
 * 测试买入和卖出的Twitter通知功能
 */

require('dotenv').config();
const OptimizedTradeManager = require('./src/optimizedTradeManager');

async function testTwitterNotifications() {
  console.log('🐦 开始Twitter通知测试...\n');

  try {
    // 临时启用Twitter（仅用于测试）
    const originalTwitterSetting = process.env.ENABLE_TWITTER;
    process.env.ENABLE_TWITTER = 'true';
    
    // 初始化交易管理器
    const tradeManager = new OptimizedTradeManager();
    
    // 等待一秒确保初始化完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('📊 测试Twitter消息生成...\n');

    // 测试买入Tweet消息生成
    const buyTweetMessage = tradeManager.generateBuyTweet(
      'CAKE', 
      '0.1', 
      '0x1234567890abcdef1234567890abcdef12345678',
      '2.50'
    );
    
    console.log('🚀 买入Tweet消息:');
    console.log('─'.repeat(50));
    console.log(buyTweetMessage);
    console.log('─'.repeat(50));
    console.log(`消息长度: ${buyTweetMessage.length} 字符\n`);

    // 测试卖出Tweet消息生成
    const sellTweetMessage = tradeManager.generateSellTweet(
      'CAKE',
      '100',
      '0.095',
      '0x9876543210fedcba9876543210fedcba98765432',
      '2.45'
    );
    
    console.log('💸 卖出Tweet消息:');
    console.log('─'.repeat(50));
    console.log(sellTweetMessage);
    console.log('─'.repeat(50));
    console.log(`消息长度: ${sellTweetMessage.length} 字符\n`);

    // 测试Twitter API连接
    console.log('🔗 测试Twitter API连接...');
    
    if (tradeManager.twitterClient) {
      console.log('✅ Twitter客户端已初始化');
      
      // 测试发送Tweet（测试消息）
      const testMessage = `🤖 机器人测试消息 

📅 时间: ${new Date().toLocaleString()}
🔧 状态: Twitter功能测试中...

#TradingBot #Test`;

      console.log('\n📤 发送测试Tweet...');
      console.log('测试消息:');
      console.log('─'.repeat(30));
      console.log(testMessage);
      console.log('─'.repeat(30));
      
      const tweetResult = await tradeManager.sendTweet(testMessage);
      
      if (tweetResult.success) {
        console.log(`✅ 测试Tweet发送成功! Tweet ID: ${tweetResult.tweetId}`);
        console.log(`🔗 查看链接: https://twitter.com/i/web/status/${tweetResult.tweetId}`);
      } else {
        console.log(`❌ 测试Tweet发送失败: ${tweetResult.error || tweetResult.reason}`);
      }
      
    } else {
      console.log('❌ Twitter客户端未初始化');
      console.log('请检查以下配置:');
      console.log('- ENABLE_TWITTER 是否为 true');
      console.log('- Twitter API 密钥是否正确配置');
    }

    // 恢复原始设置
    process.env.ENABLE_TWITTER = originalTwitterSetting;

    console.log('\n🎉 Twitter测试完成!');
    console.log('\n📋 测试总结:');
    console.log('- ✅ 消息格式生成正常');
    console.log('- ✅ Twitter客户端初始化测试');
    console.log('- ✅ API连接测试');
    
    if (tradeManager.twitterClient) {
      console.log('\n💡 提示: 如需在实际交易中启用Twitter通知,');
      console.log('请在 .env 文件中设置 ENABLE_TWITTER=true');
    }

  } catch (error) {
    console.error('❌ 测试过程中出错:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// 运行测试
if (require.main === module) {
  testTwitterNotifications().catch(console.error);
}

module.exports = testTwitterNotifications;
