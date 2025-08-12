require('dotenv').config();
const TelegramBot = require('./bot');
const { ensureDir } = require('./utils');

async function main() {
  try {
    // 创建必要的目录
    ensureDir('./logs');
    ensureDir('./logs/trades');
    
    console.log('🚀 启动 Pancake Telegram 交易机器人...');
    
    // 检查必要的环境变量
    const requiredEnvVars = [
      'TELEGRAM_BOT_TOKEN',
      'PRIVATE_KEY',
      'ADMIN_CHAT_IDS'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ 缺少必要的环境变量:');
      missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
      });
      console.error('\n请检查 .env 文件配置');
      process.exit(1);
    }
    
    // 创建并启动机器人
    const bot = new TelegramBot();
    
    // 等待机器人完全初始化
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await bot.start();
    
    // 优雅关闭
    process.on('SIGINT', async () => {
      console.log('\n🛑 正在关闭机器人...');
      await bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 正在关闭机器人...');
      await bot.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

main();
