const TelegramBotAPI = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const winston = require('winston');
const config = require('./config');
const OptimizedTradeManager = require('./optimizedTradeManager');
const { formatAddress } = require('./utils');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class TelegramBot {
  constructor() {
    // 配置更稳定的轮询选项
    const botOptions = {
      polling: {
        interval: 1000,           // 轮询间隔1秒
        autoStart: true,          // 自动开始轮询
        params: {
          timeout: 10             // API超时10秒
        }
      }
    };
    
    this.bot = new TelegramBotAPI(config.TELEGRAM_BOT_TOKEN, botOptions);
    this.tradeManager = new OptimizedTradeManager();
    this.userSessions = new Map();
    
    // 添加错误处理监听器
    this.setupErrorHandlers();
    
    // 设置持久菜单
    this.persistentKeyboard = {
      keyboard: [
        ['🎮 主菜单', '⚡ 快速操作'],
        ['💰 钱包余额', '📊 代币持仓'],
        ['📈 价格查询', '⚙️ 设置'],
        ['📖 帮助']
      ],
      resize_keyboard: true,
      persistent: true
    };
    
    this.setupBotCommands();
    this.setupCommands();
    this.setupCallbacks();
  }

  setupErrorHandlers() {
    // 处理轮询错误
    this.bot.on('polling_error', (error) => {
      console.error('🔴 Telegram轮询错误:', error.message);
      logger.error('Telegram polling error', { error: error.message, code: error.code });
      
      // 如果是网络错误，尝试重新连接
      if (error.code === 'EFATAL' || error.message.includes('socket hang up')) {
        console.log('⚠️ 检测到网络错误，准备重新启动轮询...');
        setTimeout(() => {
          console.log('🔄 尝试重新启动轮询...');
          this.restartPolling();
        }, 5000); // 5秒后重试
      }
    });

    // 处理其他错误
    this.bot.on('error', (error) => {
      console.error('🔴 Telegram机器人错误:', error.message);
      logger.error('Telegram bot error', { error: error.message });
    });

    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      console.error('🔴 未捕获异常:', error.message);
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    });

    // 处理未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      console.error('🔴 未处理的Promise拒绝:', reason);
      logger.error('Unhandled promise rejection', { reason, promise });
    });
  }

  async restartPolling() {
    try {
      console.log('🛑 停止当前轮询...');
      await this.bot.stopPolling();
      
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      
      console.log('🚀 重新启动轮询...');
      await this.bot.startPolling();
      console.log('✅ 轮询重新启动成功');
      
      logger.info('Telegram polling restarted successfully');
    } catch (error) {
      console.error('❌ 重启轮询失败:', error.message);
      logger.error('Failed to restart polling', { error: error.message });
      
      // 如果重启失败，等待更长时间后再次尝试
      setTimeout(() => {
        console.log('🔄 再次尝试重启轮询...');
        this.restartPolling();
      }, 10000); // 10秒后再次尝试
    }
  }

  async setupBotCommands() {
    // 设置Telegram BotCommands (左下角快速命令)
    const commands = [
      { command: 'start', description: '🚀 启动机器人' },
      { command: 'buy', description: '💰 智能买入代币' },
      { command: 'sell', description: '💸 智能卖出代币' },
      { command: 'balance', description: '👛 查看钱包余额' },
      { command: 'holdings', description: '📊 查看代币持仓' },
      { command: 'price', description: '📈 查询代币价格' },
      { command: 'compare', description: '🔍 比较V2/V3价格' },
      { command: 'liquidity', description: '💧 检查流动性状况' },
      { command: 'addtoken', description: '➕ 添加代币监控' },
      { command: 'menu', description: '🎮 显示主菜单' },
      { command: 'quick', description: '⚡ 快速操作' },
      { command: 'settings', description: '⚙️ 设置' },
      { command: 'help', description: '📖 帮助信息' }
    ];

    try {
      await this.bot.setMyCommands(commands);
      logger.info('Telegram BotCommands 设置成功');
    } catch (error) {
      logger.error('设置 BotCommands 失败:', error);
    }
  }

  setupCommands() {
    // 主菜单命令
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/menu/, (msg) => this.showMainMenu(msg.chat.id));
    this.bot.onText(/\/quick/, (msg) => this.showQuickMenu(msg.chat.id));
    
    // 智能交易命令 - 自动选择最佳版本
    this.bot.onText(/\/buy$/, (msg) => this.handleBuyCommand(msg, null));
    this.bot.onText(/\/buy (\S+)(?: (\S+))?/, (msg, match) => this.handleBuyCommand(msg, match));
    this.bot.onText(/\/sell$/, (msg) => this.handleSellCommand(msg, null));
    this.bot.onText(/\/sell (\S+)(?: (\S+))?/, (msg, match) => this.handleSellCommand(msg, match));
    
    // 价格和分析命令
    this.bot.onText(/\/price (.+)/, (msg, match) => this.handlePriceCommand(msg, match));
    this.bot.onText(/\/compare (.+)/, (msg, match) => this.handleCompareCommand(msg, match));
    this.bot.onText(/\/liquidity (.+)/, (msg, match) => this.handleLiquidityCommand(msg, match));
    
    // 钱包命令
    this.bot.onText(/\/balance/, (msg) => this.handleBalance(msg));
    this.bot.onText(/\/wallet/, (msg) => this.handleWallet(msg));
    this.bot.onText(/\/holdings/, (msg) => this.handleHoldings(msg));
    this.bot.onText(/\/addtoken (.+)/, (msg, match) => this.handleAddToken(msg, match));
    
    // 设置命令
    this.bot.onText(/\/settings/, (msg) => this.handleSettings(msg));
    this.bot.onText(/\/slippage (.+)/, (msg, match) => this.handleSlippageSet(msg, match));
    this.bot.onText(/\/defaultbuy (.+)/, (msg, match) => this.handleDefaultBuySet(msg, match));
    this.bot.onText(/\/defaultsell (.+)/, (msg, match) => this.handleDefaultSellSet(msg, match));
  }

  setupCallbacks() {
    this.bot.on('callback_query', (callbackQuery) => {
      this.handleCallbackQuery(callbackQuery);
    });

    this.bot.on('message', (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      this.handleTextMessage(msg);
    });
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || msg.from.username || 'User';
    
    logger.info(`用户 ${userName} (Chat ID: ${chatId}) 启动了机器人`);
    
    const welcomeMessage = `
🚀 *欢迎使用 PancakeSwap 智能交易机器人!*

👋 欢迎，${userName}！
🆔 您的 Chat ID: \`${chatId}\`

通过这个机器人，您可以：
• 🧠 智能买卖代币 (自动选择最优路径)
• 💰 查看钱包余额  
• 📊 获取实时价格
• ⚙️ 设置交易参数

⚠️ *安全提醒*：
• 本机器人仅供学习和测试使用
• 请确保在安全环境中使用
• 建议使用小额资金测试

🧠 *智能交易系统*：
机器人会自动分析流动性，选择最优交换路径，您无需手动选择版本

🎮 *快速开始：*
• 点击下方按钮打开主菜单
• 使用 /menu 命令随时打开菜单
• 使用 /quick 打开快速操作菜单
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎮 打开主菜单', callback_data: 'main_menu' }
        ],
        [
          { text: '⚡ 快速菜单', callback_data: 'quick_menu' },
          { text: '📖 帮助', callback_data: 'help' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

    // 发送持久菜单键盘
    setTimeout(async () => {
      await this.bot.sendMessage(chatId, '🎮 *快捷菜单已激活*\n\n使用下方按钮快速访问功能：', {
        parse_mode: 'Markdown',
        reply_markup: this.persistentKeyboard
      });
    }, 1000);
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;
    const helpMessage = `
📖 *命令帮助*

*🧠 智能交易命令 (自动选择最优版本):*
• \`/buy <代币地址> [BNB数量]\` - 智能购买代币 (可选数量，默认使用设置值)
• \`/sell <代币地址> [数量/百分比]\` - 智能出售代币 (可选，默认100%)

*📊 查询命令：*
• \`/price <代币地址>\` - 查询代币价格
• \`/compare <代币地址>\` - 比较V2/V3价格和最优路由
• \`/liquidity <代币地址>\` - 详细检查流动性状况
• \`/balance\` - 查看钱包余额
• \`/holdings\` - 查看代币持仓列表 (基于交易记录)

*➕ 添加代币监控：*
• \`/addtoken <代币地址>\` - 添加代币到监控列表

*⚡ 快速菜单：*
• \`/menu\` - 显示主菜单
• \`/quick\` - 显示快速操作菜单

*⚙️ 设置命令：*
• \`/settings\` - 交易设置
• \`/slippage <百分比>\` - 设置滑点
• \`/defaultbuy <BNB数量>\` - 设置默认购买数量
• \`/defaultsell <百分比>\` - 设置默认卖出比例

*📝 使用示例：*
• \`/buy 0x...token\` - 使用默认数量购买代币
• \`/buy 0x...token 0.1\` - 用0.1 BNB购买代币
• \`/sell 0x...token\` - 卖出全部持有量
• \`/sell 0x...token 50%\` - 卖出50%持有量
• \`/defaultbuy 0.05\` - 设置默认购买0.05 BNB

*🚀 快速功能：*
• 发送代币地址自动查价格
• 快速菜单支持一键买卖
• 热门代币快速访问

*🧠 智能交易说明：*
机器人会自动分析流动性，选择最优的交换版本，自动选择最佳费率和滑点设置
    `;

    await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }

  async showMainMenu(chatId) {
    const menuMessage = `
🎮 *智能交易主菜单*

🧠 智能交易系统会自动为您选择最优的交换版本
所有交易都会自动分析并选择最佳路径

💡 *快速提示：*
• 使用 /quick 打开快速操作菜单
• 发送代币地址即可查看价格
• 默认购买: ${this.tradeManager.settings.defaultBuyAmount} BNB
• 默认卖出: ${this.tradeManager.settings.defaultSellPercentage}%
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '💰 钱包余额', callback_data: 'balance' },
          { text: '📊 代币持仓', callback_data: 'holdings' }
        ],
        [
          { text: '📈 价格查询', callback_data: 'price_query' },
          { text: '🔍 价格比较', callback_data: 'price_compare' }
        ],
        [
          { text: '💧 流动性检查', callback_data: 'liquidity_check' },
          { text: '⚡ 快速菜单', callback_data: 'quick_menu' }
        ],
        [
          { text: '🧠 智能买入', callback_data: 'smart_buy' },
          { text: '💸 智能卖出', callback_data: 'smart_sell' }
        ],
        [
          { text: '⚙️ 交易设置', callback_data: 'settings' },
          { text: '📖 帮助', callback_data: 'help' }
        ],
        [
          { text: '🔄 刷新', callback_data: 'refresh_menu' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, menuMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async handleBuyCommand(msg, match) {
    const chatId = msg.chat.id;
    
    // 如果没有参数，开始交互式购买流程
    if (!match) {
      const message = `
💰 *智能购买代币*

请输入您要购买的代币地址：

💡 *提示：*
• 输入完整的代币合约地址
• 系统将使用默认购买金额：${config.DEFAULT_BUY_AMOUNT} BNB
• 也可以输入：\`/buy <代币地址> <BNB数量>\`

📋 *常用代币：*
• CAKE: \`0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82\`
• USDT: \`0x55d398326f99059fF775485246999027B3197955\`
• BUSD: \`0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56\`
      `;
      
      // 设置用户状态为等待代币地址输入
      this.userSessions.set(chatId, {
        state: 'waiting_buy_token_address',
        timestamp: Date.now()
      });
      
      return this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          input_field_placeholder: '请输入代币合约地址...'
        }
      });
    }
    
    const tokenAddress = match[1];
    const bnbAmount = match[2] || config.DEFAULT_BUY_AMOUNT.toString();

    if (!this.isValidAddress(tokenAddress)) {
      return this.bot.sendMessage(chatId, '❌ 无效的代币地址格式');
    }

    if (isNaN(bnbAmount) || parseFloat(bnbAmount) <= 0) {
      return this.bot.sendMessage(chatId, '❌ 无效的BNB数量');
    }

    await this.executeBuy(chatId, tokenAddress, bnbAmount);
  }
  
  async executeBuy(chatId, tokenAddress, bnbAmount) {
    const loadingMsg = await this.bot.sendMessage(chatId, '🔍 正在验证代币地址...');

    try {
      const isValidToken = await this.tradeManager.isValidTokenAddress(tokenAddress);
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      
      if (!isValidToken) {
        return this.bot.sendMessage(chatId, '❌ 无效的代币地址或代币不存在', { parse_mode: 'Markdown' });
      }

      const result = await this.handleSmartBuy(chatId, tokenAddress, bnbAmount);

      if (result && result.success) {
        const versionLabel = result.type || 'Smart';
        const message = `
✅ *智能购买成功!*

💰 支付: ${bnbAmount} BNB
🎯 获得: ${result.expectedAmount || 'N/A'} 代币
📄 交易哈希: \`${result.txHash}\`
⛽ Gas 费用: ${result.gasUsed} wei
🧠 选择策略: ${versionLabel}
${result.fee ? `💱 池子费率: ${result.fee/10000}%` : ''}
        `;
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        const errorMessage = result?.error || result?.message || '交易执行失败，请稍后重试';
        await this.bot.sendMessage(chatId, `❌ 购买失败: ${errorMessage}`);
      }

    } catch (error) {
      logger.error('Buy command error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      const errorMessage = error?.message || error?.reason || '购买过程中发生未知错误';
      await this.bot.sendMessage(chatId, `❌ 购买过程中发生错误: ${errorMessage}`);
    }
  }

  async handleSellCommand(msg, match) {
    const chatId = msg.chat.id;
    
    // 如果没有参数，开始交互式卖出流程
    if (!match) {
      const message = `
💸 *智能卖出代币*

请输入您要卖出的代币地址：

💡 *提示：*
• 输入完整的代币合约地址
• 系统将卖出您钱包中的 ${config.DEFAULT_SELL_PERCENTAGE}% 代币
• 也可以输入：\`/sell <代币地址> <代币数量>\`

📋 *常用代币：*
• CAKE: \`0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82\`
• USDT: \`0x55d398326f99059fF775485246999027B3197955\`
• BUSD: \`0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56\`
      `;
      
      // 设置用户状态为等待代币地址输入
      this.userSessions.set(chatId, {
        state: 'waiting_sell_token_address',
        timestamp: Date.now()
      });
      
      return this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
          input_field_placeholder: '请输入代币合约地址...'
        }
      });
    }
    
    const tokenAddress = match[1];
    let tokenAmount = match[2];

    if (!this.isValidAddress(tokenAddress)) {
      return this.bot.sendMessage(chatId, '❌ 无效的代币地址格式');
    }

    // 如果没有指定数量，计算钱包中的代币数量并使用默认百分比
    if (!tokenAmount) {
      await this.executeSellWithBalance(chatId, tokenAddress);
    } else {
      if (isNaN(tokenAmount) || parseFloat(tokenAmount) <= 0) {
        return this.bot.sendMessage(chatId, '❌ 无效的代币数量');
      }
      await this.executeSell(chatId, tokenAddress, tokenAmount);
    }
  }
  
  async executeSellWithBalance(chatId, tokenAddress) {
    const loadingMsg = await this.bot.sendMessage(chatId, '🔍 正在查询钱包余额...');

    try {
      const balance = await this.tradeManager.getTokenBalance(tokenAddress);
      
      if (!balance || parseFloat(balance) <= 0) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        return this.bot.sendMessage(chatId, '❌ 钱包中没有该代币或余额为0');
      }
      
      // 计算要卖出的数量（使用默认百分比）
      const sellAmount = (parseFloat(balance) * config.DEFAULT_SELL_PERCENTAGE / 100).toString();
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      
      const confirmMsg = `
📊 *钱包代币余额*

💰 总余额: ${balance} 代币
📈 卖出比例: ${config.DEFAULT_SELL_PERCENTAGE}%
💸 将卖出: ${sellAmount} 代币

确认要执行卖出操作吗？
      `;
      
      await this.bot.sendMessage(chatId, confirmMsg, { parse_mode: 'Markdown' });
      await this.executeSell(chatId, tokenAddress, sellAmount);
      
    } catch (error) {
      logger.error('Get token balance error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 查询代币余额失败');
    }
  }
  
  async executeSell(chatId, tokenAddress, tokenAmount) {
    const loadingMsg = await this.bot.sendMessage(chatId, '🔍 正在验证代币地址和余额...');

    try {
      const validation = await this.tradeManager.isValidTokenAddress(tokenAddress);
      
      if (!validation.valid) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        return this.bot.sendMessage(chatId, `❌ ${validation.reason}`);
      }

      // 检查代币余额
      const balance = await this.tradeManager.getTokenBalance(tokenAddress);
      
      if (!balance || parseFloat(balance) <= 0) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        return this.bot.sendMessage(chatId, '❌ 钱包中没有该代币或余额为0');
      }

      // 检查要卖出的数量是否超过余额
      if (parseFloat(tokenAmount) > parseFloat(balance)) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        return this.bot.sendMessage(chatId, `❌ 卖出数量超过余额\n💰 当前余额: ${balance}`);
      }
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      const result = await this.handleSmartSell(chatId, tokenAddress, tokenAmount);

      if (result && result.success) {
        const versionLabel = result.type || 'Smart';
        const message = `
✅ *智能出售成功!*

💸 出售: ${tokenAmount} 代币
💰 获得: ${result.expectedAmount || 'N/A'} BNB
📄 交易哈希: \`${result.txHash}\`
⛽ Gas 费用: ${result.gasUsed} wei
🧠 选择策略: ${versionLabel}
${result.fee ? `💱 池子费率: ${result.fee/10000}%` : ''}
        `;
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        await this.bot.sendMessage(chatId, `❌ 出售失败: ${result?.error || '未知错误'}`);
      }

    } catch (error) {
      logger.error('Sell command error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 出售过程中发生错误');
    }
  }

  async handleSmartBuy(chatId, tokenAddress, bnbAmount) {
    const progressMsg = await this.bot.sendMessage(chatId, '🧠 正在比较 V2/V3 价格和检查流动性...');

    try {
      const result = await this.tradeManager.smartBuyOptimal(tokenAddress, bnbAmount);
      
      await this.bot.deleteMessage(chatId, progressMsg.message_id);
      
      // 如果交易成功，显示流动性信息
      if (result.success && result.liquidityInfo) {
        const liquidity = result.liquidityInfo;
        let liquidityWarning = '';
        
        if (liquidity.warning) {
          liquidityWarning = `\n⚠️ *流动性提醒*: 该池流动性较低 (${liquidity.ratio?.toFixed(1) || '?'}x)，交易可能有较大滑点`;
        } else if (liquidity.level === 'excellent') {
          liquidityWarning = `\n✅ *流动性充足*: ${liquidity.ratio?.toFixed(1) || '?'}x 流动性，交易影响较小`;
        }
        
        if (liquidityWarning) {
          await this.bot.sendMessage(chatId, liquidityWarning, { parse_mode: 'Markdown' });
        }
      }
      
      return result;

    } catch (error) {
      logger.error('Smart buy error:', error);
      try {
        await this.bot.deleteMessage(chatId, progressMsg.message_id);
      } catch (e) {}
      return { success: false, error: error.message };
    }
  }

  async handleSmartSell(chatId, tokenAddress, tokenAmount) {
    const progressMsg = await this.bot.sendMessage(chatId, '🧠 正在比较 V2/V3 价格和检查流动性...');

    try {
      const result = await this.tradeManager.smartSellOptimal(tokenAddress, tokenAmount);
      
      await this.bot.deleteMessage(chatId, progressMsg.message_id);
      
      // 如果交易成功，显示流动性信息
      if (result.success && result.liquidityInfo) {
        const liquidity = result.liquidityInfo;
        let liquidityWarning = '';
        
        if (liquidity.warning) {
          liquidityWarning = `\n⚠️ *流动性提醒*: 该池流动性较低 (${liquidity.ratio?.toFixed(1) || '?'}x)，交易可能有较大滑点`;
        } else if (liquidity.level === 'excellent') {
          liquidityWarning = `\n✅ *流动性充足*: ${liquidity.ratio?.toFixed(1) || '?'}x 流动性，交易影响较小`;
        }
        
        if (liquidityWarning) {
          await this.bot.sendMessage(chatId, liquidityWarning, { parse_mode: 'Markdown' });
        }
      }
      
      return result;

    } catch (error) {
      logger.error('Smart sell error:', error);
      try {
        await this.bot.deleteMessage(chatId, progressMsg.message_id);
      } catch (e) {}
      return { success: false, error: error.message };
    }
  }

  async handlePriceCommand(msg, match) {
    const chatId = msg.chat.id;
    const tokenAddress = match[1];

    if (!this.isValidAddress(tokenAddress)) {
      return this.bot.sendMessage(chatId, '❌ 无效的地址格式');
    }

    const loadingMsg = await this.bot.sendMessage(chatId, '📊 正在获取价格信息...');

    try {
      const priceInfo = await this.tradeManager.getTokenPrice(tokenAddress);
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (priceInfo.success) {
        const message = `
📊 *代币价格信息*

🪙 代币: \`${tokenAddress}\`
💰 当前价格: $${priceInfo.priceInUSD}
🔸 BNB 价格: ${priceInfo.priceInBNB} BNB
🏷️ 代币符号: ${priceInfo.symbol}
💧 流动性: ${priceInfo.liquidity === 'N/A' ? '正常' : priceInfo.liquidity + ' BNB'}
        `;
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        await this.bot.sendMessage(chatId, `❌ 获取价格失败: ${priceInfo.error}`);
      }

    } catch (error) {
      logger.error('Price command error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 获取价格时发生错误');
    }
  }

  async handleCompareCommand(msg, match) {
    const chatId = msg.chat.id;
    const tokenAddress = match[1];

    if (!this.isValidAddress(tokenAddress)) {
      return this.bot.sendMessage(chatId, '❌ 无效的地址格式');
    }

    const loadingMsg = await this.bot.sendMessage(chatId, '🔍 正在比较V2和V3价格（包含流动性检查）...');

    try {
      // 获取详细路由信息 (买入)
      const buyRouteInfo = await this.tradeManager.getBestRoute(tokenAddress, 0.001, true);
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (buyRouteInfo.success) {
        // 构建所有报价信息
        let allQuotesInfo = '✅ *可用路由*:\n';
        buyRouteInfo.allQuotes.forEach(q => {
          const poolAddress = q.liquidityInfo ? (q.liquidityInfo.poolAddress || q.liquidityInfo.pairAddress) : 'N/A';
          const shortAddress = poolAddress !== 'N/A' ? `${poolAddress.slice(0,6)}...${poolAddress.slice(-4)}` : 'N/A';
          const isBest = q === buyRouteInfo.allQuotes.find(best => best.expectedAmount === buyRouteInfo.comparison.bestPrice) ? ' 👑' : '';
          const feeStr = q.quote.fee ? ` (${q.quote.fee/10000}%)` : '';
          allQuotesInfo += `• ${q.version.toUpperCase()}${feeStr}: ${q.expectedAmount} 代币\n`;
          allQuotesInfo += `  💧 流动性: ${q.liquidityInfo.liquidityInBNB} BNB ${q.liquidityInfo.emoji} (${q.liquidityInfo.ratio.toFixed(1)}x)\n`;
          allQuotesInfo += `  🏠 池子: \`${shortAddress}\`${isBest}\n\n`;
        });

        // 构建被拒绝的路由信息
        let rejectedInfo = '';
        if (buyRouteInfo.rejectedQuotes && buyRouteInfo.rejectedQuotes.length > 0) {
          rejectedInfo = '\n❌ *不可用路由*:\n';
          buyRouteInfo.rejectedQuotes.forEach(rq => {
            const reason = rq.rejectedReason === 'liquidity' ? '流动性不足' : 
                          rq.rejectedReason === 'pool_not_exist' ? '池子不存在' : 
                          rq.rejectedReason === 'quote_failed' ? '报价失败' : '未知原因';
            const poolAddress = rq.liquidityInfo ? (rq.liquidityInfo.poolAddress || rq.liquidityInfo.pairAddress) : 'N/A';
            const shortAddress = poolAddress !== 'N/A' ? `${poolAddress.slice(0,6)}...${poolAddress.slice(-4)}` : 'N/A';
            const feeStr = rq.fee ? ` (${rq.fee/10000}%)` : '';
            rejectedInfo += `• ${rq.version.toUpperCase()}${feeStr}: ${reason}\n`;
            if (rq.liquidityInfo) {
              rejectedInfo += `  💧 流动性: ${rq.liquidityInfo.liquidityInBNB} BNB ${rq.liquidityInfo.emoji} (${rq.liquidityInfo.ratio.toFixed(1)}x)\n`;
            }
            rejectedInfo += `  🏠 池子: \`${shortAddress}\`\n\n`;
          });
        }

        // 最优路由信息
        const bestPoolAddress = buyRouteInfo.bestPoolAddress;
        const bestShortAddress = bestPoolAddress ? `${bestPoolAddress.slice(0,6)}...${bestPoolAddress.slice(-4)}` : 'N/A';

        const message = `
🔍 *流动性与价格分析报告*

🪙 代币: \`${tokenAddress}\`
💰 买入金额: 0.001 BNB

${allQuotesInfo}${rejectedInfo}
🏆 *最优选择*:
• 路由: ${buyRouteInfo.bestRoute.version.toUpperCase()}${buyRouteInfo.bestRoute.fee ? ` (${buyRouteInfo.bestRoute.fee/10000}%)` : ''}
• 预期获得: ${buyRouteInfo.comparison.bestPrice} 代币
• 池子地址: \`${bestPoolAddress || 'N/A'}\`
• 流动性等级: ${buyRouteInfo.bestLiquidity?.level || '未知'} ${buyRouteInfo.bestLiquidity?.emoji || ''}

📊 *统计*:
• 可用路由: ${buyRouteInfo.comparison.totalQuotes}
• 被拒路由: ${buyRouteInfo.comparison.totalRejected || 0}
• 价格提升: ${buyRouteInfo.comparison.improvement}

💡 使用 /buy 命令将自动选择最优路由
        `;
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        // 显示所有失败的原因
        let errorDetails = buyRouteInfo.error;
        if (buyRouteInfo.rejectedQuotes && buyRouteInfo.rejectedQuotes.length > 0) {
          errorDetails += '\n\n❌ *详细信息*:\n';
          buyRouteInfo.rejectedQuotes.forEach(rq => {
            const reason = rq.rejectedReason === 'liquidity' ? '流动性不足' : 
                          rq.rejectedReason === 'pool_not_exist' ? '池子不存在' : 
                          rq.rejectedReason === 'quote_failed' ? '报价失败' : '未知原因';
            const poolAddress = rq.liquidityInfo ? (rq.liquidityInfo.poolAddress || rq.liquidityInfo.pairAddress) : 'N/A';
            const shortAddress = poolAddress !== 'N/A' ? `${poolAddress.slice(0,6)}...${poolAddress.slice(-4)}` : 'N/A';
            const feeStr = rq.fee ? ` (${rq.fee/10000}%)` : '';
            errorDetails += `• ${rq.version.toUpperCase()}${feeStr}: ${reason} (池子: \`${shortAddress}\`)\n`;
          });
        }
        await this.bot.sendMessage(chatId, `❌ 流动性检查失败:\n\n${errorDetails}`, { parse_mode: 'Markdown' });
      }

    } catch (error) {
      logger.error('Compare command error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 价格比较时发生错误');
    }
  }

  async handleBalance(msg) {
    const chatId = msg.chat.id;
    const loadingMsg = await this.bot.sendMessage(chatId, '💰 正在获取钱包余额...');

    try {
      const balance = await this.tradeManager.getWalletBalance();
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      const message = `
💼 *钱包余额*

👤 地址: \`${balance.address}\`

💰 *余额信息:*
• BNB: ${parseFloat(balance.bnb).toFixed(6)} BNB
      `;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Balance error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 获取余额时发生错误');
    }
  }

  async handleWallet(msg) {
    await this.handleBalance(msg);
  }

  async handleSettings(msg) {
    const chatId = msg.chat.id;
    const settings = this.tradeManager.settings;

    const message = `
⚙️ *交易设置*

当前配置:
• 滑点容忍度: ${settings.slippage}%
• Gas 限制: ${settings.gasLimit}
• Gas 价格: ${settings.gasPrice} Gwei
• 最大交易金额: ${settings.maxTradeAmount} BNB

使用命令修改设置:
• \`/slippage <百分比>\` - 设置滑点容忍度
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '📊 设置滑点', callback_data: 'set_slippage' },
          { text: '⛽ 设置Gas', callback_data: 'set_gas' }
        ],
        [
          { text: '💰 设置最大金额', callback_data: 'set_max_amount' },
          { text: '🔙 返回主菜单', callback_data: 'main_menu' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async handleSlippageSet(msg, match) {
    const chatId = msg.chat.id;
    const slippage = parseFloat(match[1]);

    if (isNaN(slippage) || slippage < 0.1 || slippage > 50) {
      return this.bot.sendMessage(chatId, '❌ 滑点必须在 0.1% 到 50% 之间');
    }

    this.tradeManager.settings.slippage = slippage;
    await this.bot.sendMessage(chatId, `✅ 滑点已设置为 ${slippage}%`);
  }

  async handleDefaultBuySet(msg, match) {
    const chatId = msg.chat.id;
    const amount = parseFloat(match[1]);

    if (isNaN(amount) || amount <= 0) {
      return this.bot.sendMessage(chatId, '❌ 无效的金额');
    }

    this.tradeManager.settings.defaultBuyAmount = amount;
    await this.bot.sendMessage(chatId, `✅ 默认购买金额已设置为 ${amount} BNB`);
  }

  async handleDefaultSellSet(msg, match) {
    const chatId = msg.chat.id;
    const percentage = parseFloat(match[1]);

    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      return this.bot.sendMessage(chatId, '❌ 无效的百分比');
    }

    this.tradeManager.settings.defaultSellPercentage = percentage;
    await this.bot.sendMessage(chatId, `✅ 默认卖出百分比已设置为 ${percentage}%`);
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    await this.bot.answerCallbackQuery(callbackQuery.id);

    // 处理带参数的回调
    if (data.startsWith('quick_buy_0x')) {
      const tokenAddress = data.replace('quick_buy_', '');
      await this.bot.sendMessage(chatId, `🧠 请输入购买数量(BNB)或使用命令:\n/buy ${tokenAddress} <数量>`);
      return;
    }

    if (data.startsWith('quick_sell_0x')) {
      const tokenAddress = data.replace('quick_sell_', '');
      await this.bot.sendMessage(chatId, `💸 请输入卖出数量或使用命令:\n/sell ${tokenAddress} <数量>`);
      return;
    }

    switch (data) {
      case 'main_menu':
        await this.showMainMenu(chatId);
        break;
      case 'balance':
        await this.handleBalance({ chat: { id: chatId } });
        break;
      case 'holdings':
        await this.handleHoldings({ chat: { id: chatId } });
        break;
      case 'refresh_holdings':
        await this.handleHoldings({ chat: { id: chatId } });
        break;
      case 'trading_stats':
        await this.handleTradingStats({ chat: { id: chatId } });
        break;
      case 'trading_history':
        await this.handleTradingHistory({ chat: { id: chatId } });
        break;
      case 'wallet':
        await this.handleWallet({ chat: { id: chatId } });
        break;
      case 'settings':
        await this.handleSettings({ chat: { id: chatId } });
        break;
      case 'help':
        await this.handleHelp({ chat: { id: chatId } });
        break;
      case 'price_query':
        await this.bot.sendMessage(chatId, '📊 请输入代币地址查询价格，或使用命令 /price <代币地址>');
        break;
      case 'price_compare':
        await this.bot.sendMessage(chatId, '🔍 请输入代币地址比较V2/V3价格，或使用命令 /compare <代币地址>');
        break;
      case 'liquidity_check':
        await this.bot.sendMessage(chatId, '💧 请输入代币地址检查流动性状况，或使用命令 /liquidity <代币地址>');
        break;
      case 'smart_buy':
        await this.bot.sendMessage(chatId, '🧠 请使用命令 /buy <代币地址> <BNB数量> 进行智能购买');
        break;
      case 'smart_sell':
        await this.bot.sendMessage(chatId, '💸 请使用命令 /sell <代币地址> <代币数量> 进行智能出售');
        break;
      case 'set_slippage':
        await this.bot.sendMessage(chatId, '📊 请使用命令 /slippage <百分比> 设置滑点容忍度');
        break;
      case 'set_default_buy':
        await this.bot.sendMessage(chatId, '💰 请使用命令 /defaultbuy <BNB数量> 设置默认购买数量');
        break;
      case 'set_default_sell':
        await this.bot.sendMessage(chatId, '💸 请使用命令 /defaultsell <百分比> 设置默认卖出比例');
        break;
      case 'quick_menu':
        await this.showQuickMenu(chatId);
        break;
      case 'refresh_menu':
        await this.showMainMenu(chatId);
        break;
      case 'refresh_quick':
        await this.showQuickMenu(chatId);
        break;
      case 'quick_buy_001':
        await this.handleQuickBuy(chatId, 0.01);
        break;
      case 'quick_buy_005':
        await this.handleQuickBuy(chatId, 0.05);
        break;
      case 'quick_buy_01':
        await this.handleQuickBuy(chatId, 0.1);
        break;
      case 'quick_buy_05':
        await this.handleQuickBuy(chatId, 0.5);
        break;
      case 'quick_sell_25':
        await this.handleQuickSell(chatId, 25);
        break;
      case 'quick_sell_50':
        await this.handleQuickSell(chatId, 50);
        break;
      case 'quick_sell_75':
        await this.handleQuickSell(chatId, 75);
        break;
      case 'quick_sell_100':
        await this.handleQuickSell(chatId, 100);
        break;
      case 'popular_tokens':
        await this.showPopularTokens(chatId);
        break;
      case 'balance_detail':
        await this.handleBalanceDetail(chatId);
        break;
      case 'custom_token':
        await this.bot.sendMessage(chatId, '📊 请输入代币地址查询价格，或使用命令 /price <代币地址>');
        break;
      case 'token_cake':
        await this.handleTokenPrice(chatId, config.TOKENS.CAKE, 'CAKE');
        break;
      case 'token_usdt':
        await this.handleTokenPrice(chatId, config.TOKENS.USDT, 'USDT');
        break;
      case 'token_busd':
        await this.handleTokenPrice(chatId, config.TOKENS.BUSD, 'BUSD');
        break;
      case 'copy_all_addresses':
        await this.handleCopyAllAddresses(chatId);
        break;
      default:
        // 处理动态回调数据（如quick_buy_address, quick_sell_address）
        if (data.startsWith('quick_buy_')) {
          const tokenAddress = data.replace('quick_buy_', '');
          if (this.isValidAddress(tokenAddress)) {
            await this.executeBuy(chatId, tokenAddress, config.DEFAULT_BUY_AMOUNT.toString());
          } else {
            await this.bot.sendMessage(chatId, '❌ 无效的代币地址');
          }
        } else if (data.startsWith('quick_sell_')) {
          const tokenAddress = data.replace('quick_sell_', '');
          if (this.isValidAddress(tokenAddress)) {
            await this.executeSellWithBalance(chatId, tokenAddress);
          } else {
            await this.bot.sendMessage(chatId, '❌ 无效的代币地址');
          }
        } else {
          await this.bot.sendMessage(chatId, '❓ 未知的操作');
        }
        break;
    }
  }

  async handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    // 检查用户是否在交互状态中
    const userSession = this.userSessions.get(chatId);
    if (userSession) {
      // 检查会话是否过期（5分钟）
      const now = Date.now();
      if (now - userSession.timestamp > 5 * 60 * 1000) {
        this.userSessions.delete(chatId);
        return this.bot.sendMessage(chatId, '⏰ 操作超时，请重新开始');
      }
      
      // 处理不同的状态
      switch (userSession.state) {
        case 'waiting_buy_token_address':
          this.userSessions.delete(chatId);
          if (this.isValidAddress(text)) {
            return this.executeBuy(chatId, text, config.DEFAULT_BUY_AMOUNT.toString());
          } else {
            return this.bot.sendMessage(chatId, '❌ 无效的代币地址格式，请重新输入');
          }
          
        case 'waiting_sell_token_address':
          this.userSessions.delete(chatId);
          if (this.isValidAddress(text)) {
            return this.executeSellWithBalance(chatId, text);
          } else {
            return this.bot.sendMessage(chatId, '❌ 无效的代币地址格式，请重新输入');
          }
      }
    }

    // 处理持久菜单按钮
    switch (text) {
      case '🎮 主菜单':
        return this.showMainMenu(chatId);
      case '⚡ 快速操作':
        return this.showQuickMenu(chatId);
      case '💰 钱包余额':
        return this.handleBalance(msg);
      case '📊 代币持仓':
        return this.handleHoldings(msg);
      case '📈 价格查询':
        return this.bot.sendMessage(chatId, '📊 请输入代币地址查询价格，或使用命令 /price <代币地址>');
      case '⚙️ 设置':
        return this.handleSettings(msg);
      case '📖 帮助':
        return this.handleHelp(msg);
    }

    // 检查是否是代币地址
    if (this.isValidAddress(text)) {
      const priceInfo = await this.tradeManager.getTokenPrice(text);
      
      if (priceInfo.success) {
        const message = `
📊 *代币价格信息*

🪙 代币: \`${text}\`
💰 当前价格: $${priceInfo.priceInUSD}
🔸 BNB 价格: ${priceInfo.priceInBNB} BNB
🏷️ 代币符号: ${priceInfo.symbol}
💧 流动性: ${priceInfo.liquidity === 'N/A' ? '正常' : priceInfo.liquidity + ' BNB'}

快速操作：
        `;
        
        // 保存当前代币地址到会话中，供回调使用
        this.userSessions.set(chatId, {
          state: 'token_price_shown',
          tokenAddress: text,
          timestamp: Date.now()
        });
        
        await this.bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🧠 智能买入', callback_data: `quick_buy_${text}` },
                { text: '💸 智能卖出', callback_data: `quick_sell_${text}` }
              ]
            ]
          }
        });
      } else {
        await this.bot.sendMessage(chatId, `❌ 获取价格失败: ${priceInfo.error}`);
      }
    } else {
      // 发送帮助信息
      await this.bot.sendMessage(chatId, '❓ 不认识的命令。发送 /help 查看所有可用命令。');
    }
  }

  async showQuickMenu(chatId) {
    const balance = await this.tradeManager.getWalletBalance();
    
    const menuMessage = `
⚡ *快速操作菜单*

💼 *当前钱包状态：*
• BNB: ${parseFloat(balance.bnb || 0).toFixed(4)} BNB

⚙️ *当前设置：*
• 滑点: ${this.tradeManager.settings.slippage}%
• 默认购买: ${this.tradeManager.settings.defaultBuyAmount} BNB
• 默认卖出: ${this.tradeManager.settings.defaultSellPercentage}%

🚀 *快速操作：*
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎯 快速买入0.01', callback_data: 'quick_buy_001' },
          { text: '🎯 快速买入0.05', callback_data: 'quick_buy_005' }
        ],
        [
          { text: '🎯 快速买入0.1', callback_data: 'quick_buy_01' },
          { text: '🎯 快速买入0.5', callback_data: 'quick_buy_05' }
        ],
        [
          { text: '💸 卖出25%', callback_data: 'quick_sell_25' },
          { text: '💸 卖出50%', callback_data: 'quick_sell_50' }
        ],
        [
          { text: '💸 卖出75%', callback_data: 'quick_sell_75' },
          { text: '💸 全部卖出', callback_data: 'quick_sell_100' }
        ],
        [
          { text: '📊 热门代币', callback_data: 'popular_tokens' },
          { text: '💰 余额详情', callback_data: 'balance_detail' }
        ],
        [
          { text: '🔙 返回主菜单', callback_data: 'main_menu' },
          { text: '🔄 刷新', callback_data: 'refresh_quick' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, menuMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async showPopularTokens(chatId) {
    const menuMessage = `
🔥 *热门代币快速访问*

点击代币地址可以快速查看价格信息
    `;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🥞 CAKE', callback_data: 'token_cake' },
          { text: '💵 USDT', callback_data: 'token_usdt' }
        ],
        [
          { text: '💰 BUSD', callback_data: 'token_busd' },
          { text: '💎 ETH', callback_data: 'token_eth' }
        ],
        [
          { text: '📊 自定义地址', callback_data: 'custom_token' },
          { text: '🔙 返回快速菜单', callback_data: 'quick_menu' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, menuMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  async handleQuickBuy(chatId, amount) {
    await this.bot.sendMessage(chatId, `🧠 请输入代币地址进行快速购买 ${amount} BNB\n\n或使用命令: /buy <代币地址> ${amount}`);
  }

  async handleQuickSell(chatId, percentage) {
    await this.bot.sendMessage(chatId, `💸 请输入代币地址进行快速卖出 ${percentage}%\n\n或使用命令: /sell <代币地址> ${percentage}%`);
  }

  async handleBalanceDetail(chatId) {
    const loadingMsg = await this.bot.sendMessage(chatId, '💰 正在获取详细余额信息...');

    try {
      const balance = await this.tradeManager.getWalletBalance();
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      const message = `
💼 *钱包详细余额*

👤 地址: \`${balance.address}\`

💰 *详细余额信息:*
• BNB: ${parseFloat(balance.bnb || 0).toFixed(6)} BNB

⚙️ *当前设置:*
• 滑点: ${this.tradeManager.settings.slippage}%
• 默认购买: ${this.tradeManager.settings.defaultBuyAmount} BNB
• 默认卖出: ${this.tradeManager.settings.defaultSellPercentage}%
      `;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 刷新余额', callback_data: 'balance_detail' },
            { text: '⚡ 快速菜单', callback_data: 'quick_menu' }
          ]
        ]
      };

      await this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

    } catch (error) {
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 获取余额详情时发生错误');
    }
  }

  async handleTokenPrice(chatId, tokenAddress, tokenSymbol) {
    const loadingMsg = await this.bot.sendMessage(chatId, `📊 正在获取 ${tokenSymbol} 价格信息...`);

    try {
      const priceInfo = await this.tradeManager.getTokenPrice(tokenAddress);
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (priceInfo.success) {
        const message = `
📊 *${tokenSymbol} 价格信息*

🪙 代币: \`${tokenAddress}\`
💰 当前价格: $${priceInfo.priceInUSD}
🔸 BNB 价格: ${priceInfo.priceInBNB} BNB
🏷️ 代币符号: ${priceInfo.symbol}
💧 流动性: ${priceInfo.liquidity === 'N/A' ? '正常' : priceInfo.liquidity + ' BNB'}
        `;

        const keyboard = {
          inline_keyboard: [
            [
              { text: '🧠 智能买入', callback_data: 'smart_buy' },
              { text: '💸 智能卖出', callback_data: 'smart_sell' }
            ],
            [
              { text: '🔄 刷新价格', callback_data: `token_${tokenSymbol.toLowerCase()}` },
              { text: '🔙 返回热门', callback_data: 'popular_tokens' }
            ]
          ]
        };

        await this.bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await this.bot.sendMessage(chatId, `❌ 获取 ${tokenSymbol} 价格失败: ${priceInfo.error}`);
      }

    } catch (error) {
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, `❌ 获取 ${tokenSymbol} 价格时发生错误`);
    }
  }

  async handleHoldings(msg) {
    const chatId = msg.chat.id;
    const loadingMsg = await this.bot.sendMessage(chatId, '📊 正在扫描代币持仓和交易记录，请稍候...');

    try {
      const holdings = await this.tradeManager.getTokenHoldings();
      const stats = this.tradeManager.getTradingStats();
      
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (!holdings.success) {
        return this.bot.sendMessage(chatId, `❌ 获取持仓失败: ${holdings.error}`);
      }

      // 先显示交易统计
      let message = `📊 *交易统计概览*

`;

      if (stats) {
        const netProfitEmoji = stats.netProfit >= 0 ? '📈' : '📉';
        const netProfitSign = stats.netProfit >= 0 ? '+' : '';
        
        message += `🎯 总交易数: ${stats.totalTrades} 次\n`;
        message += `🛒 买入: ${stats.buyTrades} 次 | 💸 卖出: ${stats.sellTrades} 次\n`;
        message += `${netProfitEmoji} 净利润: ${netProfitSign}${stats.netProfit.toFixed(6)} BNB\n`;
        message += `📈 总盈利: +${stats.totalProfit.toFixed(6)} BNB\n`;
        message += `📉 总亏损: -${stats.totalLoss.toFixed(6)} BNB\n`;
        message += `🎯 胜率: ${stats.winRate.toFixed(1)}%\n`;
        message += `💼 持仓中: ${stats.holdingTokens} 个代币\n\n`;
      }

      if (holdings.tokens.length <= 1) { // 只有BNB
        message += holdings.fromTradingHistory ? 
          `📭 *代币持仓为空*

🔍 已扫描 ${holdings.scannedTokens} 个交易记录中的代币
💰 只发现 BNB 余额: ${holdings.tokens[0]?.balance || '0'} BNB

💡 *提示：* 
• 首次交易代币后会自动添加到监控列表
• 使用 /addtoken <地址> 手动添加代币监控
• 持仓列表基于您的交易历史记录` :
          `📭 *代币持仓为空*

🔍 已扫描 ${holdings.scannedTokens} 个代币地址
💰 只发现 BNB 余额: ${holdings.tokens[0]?.balance || '0'} BNB

💡 *提示：* 购买代币后会自动显示在持仓列表中`;

        return this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }

      message += `📊 *代币持仓列表* ${holdings.fromTradingHistory ? '(基于交易记录)' : ''}

👤 钱包: \`${this.tradeManager.wallet.address}\`
💵 总价值: $${holdings.totalValueUSD} USD
🔍 已扫描: ${holdings.scannedTokens} 个代币
✅ 发现持仓: ${holdings.foundTokens} 个代币

`;

      // 显示每个代币的持仓
      let allAddresses = []; // 收集所有代币地址用于全部复制
      
      holdings.tokens.forEach((holding, index) => {
        const icon = holding.isNative ? '🟡' : '🪙';
        const valueDisplay = parseFloat(holding.valueUSD) > 0.01 ? `$${holding.valueUSD}` : '<$0.01';
        
        message += `${icon} *${holding.symbol}*\n`;
        message += `   余额: ${holding.balance} ${holding.symbol}\n`;
        message += `   价值: ${valueDisplay}\n`;
        if (parseFloat(holding.priceUSD) > 0) {
          message += `   价格: $${holding.priceUSD}\n`;
        }
        
        // 添加持仓利润信息
        if (!holding.isNative && holding.address) {
          const tokenHolding = this.tradeManager.getTokenPositionInfo(holding.address);
          if (tokenHolding) {
            message += `   📊 持仓: ${tokenHolding.totalTokens.toFixed(6)} 代币\n`;
            message += `   💰 成本: ${tokenHolding.totalCost.toFixed(6)} BNB\n`;
            message += `   📈 均价: ${tokenHolding.avgPrice.toFixed(8)} BNB/代币\n`;
            
            // 计算当前未实现盈亏
            const currentValue = parseFloat(holding.balance) * tokenHolding.avgPrice;
            const unrealizedPnL = currentValue - tokenHolding.totalCost;
            const unrealizedPnLPercent = (unrealizedPnL / tokenHolding.totalCost) * 100;
            const pnlEmoji = unrealizedPnL >= 0 ? '📈' : '📉';
            const pnlSign = unrealizedPnL >= 0 ? '+' : '';
            
            message += `   ${pnlEmoji} 未实现: ${pnlSign}${unrealizedPnL.toFixed(6)} BNB (${pnlSign}${unrealizedPnLPercent.toFixed(2)}%)\n`;
          }
          
          message += `   地址: \`${holding.address}\`\n`;
          allAddresses.push(holding.address);
        }
        message += '\n';
      });

      // 如果有代币地址，添加全部复制按钮
      let inlineKeyboard = [
        [
          { text: '🔄 刷新持仓', callback_data: 'refresh_holdings' },
          { text: '💰 钱包余额', callback_data: 'balance' }
        ],
        [
          { text: '📈 交易统计', callback_data: 'trading_stats' },
          { text: '📋 交易历史', callback_data: 'trading_history' }
        ]
      ];

      if (allAddresses.length > 0) {
        // 将所有地址保存到会话中，用于复制
        this.userSessions.set(chatId, {
          ...this.userSessions.get(chatId),
          allTokenAddresses: allAddresses
        });
        
        inlineKeyboard.push([
          { text: '📋 复制所有地址', callback_data: 'copy_all_addresses' }
        ]);
      }

      inlineKeyboard.push([
        { text: '🎮 主菜单', callback_data: 'main_menu' }
      ]);

      // 如果消息太长，分页显示
      if (message.length > 4000) {
        const chunks = this.splitMessage(message, 4000);
        for (let i = 0; i < chunks.length; i++) {
          const isLastChunk = i === chunks.length - 1;
          await this.bot.sendMessage(chatId, chunks[i], { 
            parse_mode: 'Markdown',
            reply_markup: isLastChunk ? {
              inline_keyboard: inlineKeyboard
            } : undefined
          });
        }
      } else {
        await this.bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
      }

    } catch (error) {
      logger.error('Holdings error:', error);
      try {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (e) {}
      await this.bot.sendMessage(chatId, '❌ 获取持仓时发生错误');
    }
  }

  /**
   * 分割长消息
   */
  splitMessage(message, maxLength) {
    const chunks = [];
    const lines = message.split('\n');
    let currentChunk = '';
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
      }
      currentChunk += line + '\n';
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  isValidAddress(address) {
    return ethers.isAddress(address);
  }

  /**
   * 处理添加代币到监控列表
   */
  async handleAddToken(msg, match) {
    const chatId = msg.chat.id;
    const tokenAddress = match[1].trim();

    try {
      // 验证地址格式
      if (!this.isValidAddress(tokenAddress)) {
        return this.bot.sendMessage(chatId, '❌ 无效的代币地址格式');
      }

      const loadingMsg = await this.bot.sendMessage(chatId, '🔍 正在验证代币地址...');

      // 使用 TradeManager 的方法添加代币
      const result = await this.tradeManager.addTokenToWatchlist(tokenAddress);

      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (result.success) {
        const message = `✅ *代币添加成功*

🪙 代币: ${result.token.symbol} (${result.token.name})
📋 地址: \`${tokenAddress}\`

💡 该代币现在会显示在您的持仓列表中（如果有余额）
使用 /holdings 查看持仓列表`;

        await this.bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 查看持仓', callback_data: 'holdings' }],
              [{ text: '💰 购买此代币', callback_data: `quick_buy_${tokenAddress}` }],
              [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
            ]
          }
        });
      } else {
        await this.bot.sendMessage(chatId, `❌ ${result.error}`);
      }

    } catch (error) {
      logger.error('Add token error:', error);
      await this.bot.sendMessage(chatId, '❌ 添加代币时发生错误，请稍后重试');
    }
  }

  async handleCopyAllAddresses(chatId) {
    try {
      const userSession = this.userSessions.get(chatId);
      if (!userSession || !userSession.allTokenAddresses || userSession.allTokenAddresses.length === 0) {
        return this.bot.sendMessage(chatId, '❌ 没有找到代币地址，请先查看持仓列表');
      }

      const addresses = userSession.allTokenAddresses;
      const addressText = addresses.join('\n');
      
      const message = `📋 *所有代币地址* (共 ${addresses.length} 个)

\`\`\`
${addressText}
\`\`\`

💡 *使用提示:*
• 点击上方地址可直接复制
• 可以粘贴到其他应用使用
• 地址已按持仓顺序排列`;

      await this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔙 返回持仓', callback_data: 'holdings' },
              { text: '🎮 主菜单', callback_data: 'main_menu' }
            ]
          ]
        }
      });

      // 发送通知消息
      await this.bot.sendMessage(chatId, '✅ 地址已复制到上方消息，点击即可选择');

    } catch (error) {
      logger.error('Copy all addresses error:', error);
      await this.bot.sendMessage(chatId, '❌ 复制地址时发生错误');
    }
  }

  /**
   * 处理交易统计
   */
  async handleTradingStats(msg) {
    const chatId = msg.chat.id;
    
    try {
      const stats = this.tradeManager.getTradingStats();
      
      if (!stats || stats.totalTrades === 0) {
        return this.bot.sendMessage(chatId, `📊 *交易统计*

🔍 暂无交易记录

💡 *提示：* 完成第一笔交易后，统计数据将会显示在这里`, { parse_mode: 'Markdown' });
      }
      
      const netProfitEmoji = stats.netProfit >= 0 ? '📈' : '📉';
      const netProfitSign = stats.netProfit >= 0 ? '+' : '';
      const winRateEmoji = stats.winRate >= 50 ? '🎯' : '🎲';
      
      const message = `📊 *详细交易统计*

🎯 *总体表现*
• 总交易数: ${stats.totalTrades} 次
• 买入交易: ${stats.buyTrades} 次
• 卖出交易: ${stats.sellTrades} 次
• 持仓代币: ${stats.holdingTokens} 个

💰 *盈亏情况*
• ${netProfitEmoji} 净利润: ${netProfitSign}${stats.netProfit.toFixed(6)} BNB
• 📈 总盈利: +${stats.totalProfit.toFixed(6)} BNB
• 📉 总亏损: -${stats.totalLoss.toFixed(6)} BNB
• ${winRateEmoji} 胜率: ${stats.winRate.toFixed(1)}%

📋 *交易效率*
• 平均每笔盈利: +${(stats.totalProfit / Math.max(stats.sellTrades, 1)).toFixed(6)} BNB
• 平均每笔亏损: -${(stats.totalLoss / Math.max(stats.sellTrades, 1)).toFixed(6)} BNB
• 盈亏比: ${stats.totalLoss > 0 ? (stats.totalProfit / stats.totalLoss).toFixed(2) : 'N/A'}
`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📋 查看交易历史', callback_data: 'trading_history' },
            { text: '📊 查看持仓', callback_data: 'holdings' }
          ],
          [
            { text: '🔄 刷新统计', callback_data: 'trading_stats' },
            { text: '🎮 返回主菜单', callback_data: 'main_menu' }
          ]
        ]
      };

      return this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
    } catch (error) {
      console.error('获取交易统计失败:', error);
      return this.bot.sendMessage(chatId, `❌ 获取交易统计失败: ${error.message}`);
    }
  }

  /**
   * 处理交易历史
   */
  async handleTradingHistory(msg) {
    const chatId = msg.chat.id;
    
    try {
      const history = this.tradeManager.getTradingHistory();
      
      if (!history || history.trades.length === 0) {
        return this.bot.sendMessage(chatId, `📋 *交易历史*

🔍 暂无交易记录

💡 *提示：* 完成第一笔交易后，历史记录将会显示在这里`, { parse_mode: 'Markdown' });
      }
      
      // 按时间倒序排序，显示最近的交易
      const recentTrades = history.trades
        .slice()
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10); // 只显示最近10笔交易
      
      let message = `📋 *交易历史* (最近10笔)

`;

      recentTrades.forEach((trade, index) => {
        const date = new Date(trade.timestamp).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        if (trade.type === 'BUY') {
          message += `🛒 *买入 ${trade.tokenSymbol}*\n`;
          message += `   💰 花费: ${trade.bnbAmount.toFixed(6)} BNB\n`;
          message += `   🪙 获得: ${trade.tokenAmount.toFixed(6)} ${trade.tokenSymbol}\n`;
          message += `   📅 时间: ${date}\n`;
          message += `   📊 状态: ${trade.status === 'HOLDING' ? '持仓中' : '已卖出'}\n`;
        } else if (trade.type === 'SELL') {
          const profitEmoji = trade.profit >= 0 ? '📈' : '📉';
          const profitSign = trade.profit >= 0 ? '+' : '';
          
          message += `💸 *卖出 ${trade.tokenSymbol}*\n`;
          message += `   🪙 卖出: ${trade.tokenAmount.toFixed(6)} ${trade.tokenSymbol}\n`;
          message += `   💰 获得: ${trade.bnbReceived.toFixed(6)} BNB\n`;
          message += `   💵 成本: ${trade.totalCost.toFixed(6)} BNB\n`;
          message += `   ${profitEmoji} 利润: ${profitSign}${trade.profit.toFixed(6)} BNB (${profitSign}${trade.profitPercentage.toFixed(2)}%)\n`;
          message += `   📅 时间: ${date}\n`;
        }
        
        message += `   🔗 [查看交易](https://bscscan.com/tx/${trade.txHash})\n\n`;
      });

      if (history.trades.length > 10) {
        message += `📝 *提示：* 显示最近10笔交易，总共${history.trades.length}笔记录`;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📊 查看统计', callback_data: 'trading_stats' },
            { text: '📊 查看持仓', callback_data: 'holdings' }
          ],
          [
            { text: '🔄 刷新历史', callback_data: 'trading_history' },
            { text: '🎮 返回主菜单', callback_data: 'main_menu' }
          ]
        ]
      };

      return this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });
      
    } catch (error) {
      console.error('获取交易历史失败:', error);
      return this.bot.sendMessage(chatId, `❌ 获取交易历史失败: ${error.message}`);
    }
  }

  async start() {
    try {
      console.log('🤖 PancakeSwap 智能交易机器人启动中...');
      
      // 验证机器人token
      const me = await this.bot.getMe();
      console.log(`✅ 机器人已连接: @${me.username} (${me.first_name})`);
      
      // 设置webhook或启动轮询
      if (!this.bot.isPolling()) {
        await this.bot.startPolling();
        console.log('📡 轮询已启动');
      }
      
      console.log('🤖 机器人启动完成！');
    } catch (error) {
      console.error('启动机器人时发生错误:', error);
      process.exit(1);
    }
  }
}

module.exports = TelegramBot;
