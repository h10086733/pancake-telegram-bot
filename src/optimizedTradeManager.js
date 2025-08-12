const { ethers } = require('ethers');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');

class OptimizedTradeManager {
  constructor({ routerVersion = 'v2' } = {}) {
    console.log('🔧 初始化 OptimizedTradeManager...');
    this.provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);

    // 初始化Twitter客户端
    this.initTwitterClient();

    // V2 Router
    this.routerV2Address = config.PANCAKESWAP_ROUTER_V2_ADDRESS;
    this.routerV2ABI = [
      "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
      "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
      "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external"
    ];
    this.routerV2 = new ethers.Contract(this.routerV2Address, this.routerV2ABI, this.wallet);

    // V3 Router
    this.routerV3Address = config.PANCAKESWAP_ROUTER_V3_ADDRESS;
    this.routerV3ABI = [
      // V3 ABI 只包含核心功能
      "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256)",
      "function quoteExactInputSingle(address,address,uint24,uint256) external view returns (uint256)"
    ];
    this.routerV3 = new ethers.Contract(this.routerV3Address, this.routerV3ABI, this.wallet);

    // 路由器选择
    this.routerVersion = routerVersion;
    this.router = this.routerVersion === 'v3' ? this.routerV3 : this.routerV2;
    this.routerAddress = this.routerVersion === 'v3' ? this.routerV3Address : this.routerV2Address;
    console.log(`📋 使用路由器: ${this.routerAddress} (${this.routerVersion.toUpperCase()})`);
    
    // ERC20 ABI (精简版)
    this.erc20ABI = [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)"
    ];    // Settings - 从配置文件读取
    this.settings = {
      slippage: (config.DEFAULT_SLIPPAGE / 100) || 5, // 从基点转换为百分比
      gasPrice: (Number(config.DEFAULT_GAS_PRICE) / 1e9) || 0.1, // 从wei转换为Gwei
      gasLimit: config.DEFAULT_GAS_LIMIT || 300000
    };
    
    // 交易相关配置
    this.defaultBuyAmount = config.DEFAULT_BUY_AMOUNT
    this.maxTradeAmount = config.MAX_TRADE_AMOUNT ;
    this.defaultSellPercentage = config.DEFAULT_SELL_PERCENTAGE;
    // settings扩展
    this.settings.defaultBuyAmount = this.defaultBuyAmount;
    this.settings.maxTradeAmount = this.maxTradeAmount;
    this.settings.defaultSellPercentage = this.defaultSellPercentage;

    // File path for storing traded tokens
    this.tradedTokensFile = path.join(__dirname, '..', 'traded-tokens.json');
    this.ensureTradedTokensFile();
    
    // File path for storing trading history with profit tracking
    this.tradingHistoryFile = path.join(__dirname, '..', 'trading-history.json');
    this.ensureTradingHistoryFile();
    
    console.log('✅ OptimizedTradeManager 初始化完成');
  }

  /**
   * 确保交易代币文件存在
   */
  ensureTradedTokensFile() {
    if (!fs.existsSync(this.tradedTokensFile)) {
      fs.writeFileSync(this.tradedTokensFile, JSON.stringify({ tokens: [] }, null, 2));
    }
  }

  /**
   * 确保交易历史文件存在
   */
  ensureTradingHistoryFile() {
    if (!fs.existsSync(this.tradingHistoryFile)) {
      const initialData = {
        trades: [],
        summary: {
          totalTrades: 0,
          totalProfit: 0,
          totalLoss: 0,
          winRate: 0
        }
      };
      fs.writeFileSync(this.tradingHistoryFile, JSON.stringify(initialData, null, 2));
    }
  }

  /**
   * 获取已交易的代币列表
   */
  getTradedTokens() {
    try {
      const data = fs.readFileSync(this.tradedTokensFile, 'utf8');
      return JSON.parse(data).tokens || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * 获取交易历史
   */
  getTradingHistory() {
    try {
      const data = fs.readFileSync(this.tradingHistoryFile, 'utf8');
      const history = JSON.parse(data);
      
      // 确保数据结构完整
      if (!history.summary) {
        history.summary = { totalTrades: 0, totalProfit: 0, totalLoss: 0, winRate: 0 };
      }
      if (!history.trades) {
        history.trades = [];
      }
      
      return history;
    } catch (error) {
      return {
        trades: [],
        summary: { totalTrades: 0, totalProfit: 0, totalLoss: 0, winRate: 0 }
      };
    }
  }

  /**
   * 记录买入交易
   */
  recordBuyTrade(tokenAddress, tokenSymbol, bnbAmount, tokenAmount, bnbPrice, gasUsed, txHash) {
    try {
      const history = this.getTradingHistory();
      console.log('🔍 调试 - history对象:', JSON.stringify(history, null, 2));
      console.log('🔍 调试 - history.summary:', history.summary);
      console.log('🔍 调试 - history.trades:', history.trades);
      
      const buyTrade = {
        id: Date.now().toString(),
        type: 'BUY',
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol,
        bnbAmount: parseFloat(bnbAmount),
        tokenAmount: parseFloat(tokenAmount),
        bnbPrice: parseFloat(bnbPrice),
        gasUsed: parseFloat(gasUsed),
        timestamp: new Date().toISOString(),
        txHash,
        status: 'HOLDING' // HOLDING, SOLD
      };
      
      history.trades.push(buyTrade);
      history.summary.totalTrades++;
      
      fs.writeFileSync(this.tradingHistoryFile, JSON.stringify(history, null, 2));
      console.log(`📊 记录买入交易: ${tokenSymbol} - ${bnbAmount} BNB`);
      return buyTrade.id;
    } catch (error) {
      console.error('记录买入交易失败:', error);
      return null;
    }
  }

  /**
   * 记录卖出交易并计算利润
   */
  recordSellTrade(tokenAddress, tokenSymbol, tokenAmount, bnbReceived, bnbPrice, gasUsed, txHash) {
    try {
      const history = this.getTradingHistory();
      
      // 查找对应的买入交易（FIFO - 先进先出）
      const buyTrades = history.trades.filter(trade => 
        trade.type === 'BUY' && 
        trade.tokenAddress === tokenAddress.toLowerCase() && 
        trade.status === 'HOLDING'
      ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      if (buyTrades.length === 0) {
        console.log('⚠️ 未找到对应的买入记录，无法计算利润');
        return null;
      }
      
      let remainingTokensToSell = parseFloat(tokenAmount);
      let totalCost = 0;
      let totalGasUsed = parseFloat(gasUsed);
      const processedBuyTrades = [];
      
      // 处理多笔买入（FIFO）
      for (const buyTrade of buyTrades) {
        if (remainingTokensToSell <= 0) break;
        
        const tokensFromThisBuy = Math.min(remainingTokensToSell, buyTrade.tokenAmount);
        const costRatio = tokensFromThisBuy / buyTrade.tokenAmount;
        const costFromThisBuy = buyTrade.bnbAmount * costRatio;
        const gasFromThisBuy = buyTrade.gasUsed * costRatio;
        
        totalCost += costFromThisBuy;
        totalGasUsed += gasFromThisBuy;
        
        processedBuyTrades.push({
          id: buyTrade.id,
          tokensUsed: tokensFromThisBuy,
          costUsed: costFromThisBuy,
          gasUsed: gasFromThisBuy
        });
        
        // 更新买入交易状态
        if (tokensFromThisBuy >= buyTrade.tokenAmount) {
          buyTrade.status = 'SOLD';
        } else {
          // 部分卖出，创建新的记录
          const remainingTokens = buyTrade.tokenAmount - tokensFromThisBuy;
          const remainingCost = buyTrade.bnbAmount - costFromThisBuy;
          const remainingGas = buyTrade.gasUsed - gasFromThisBuy;
          
          buyTrade.tokenAmount = remainingTokens;
          buyTrade.bnbAmount = remainingCost;
          buyTrade.gasUsed = remainingGas;
        }
        
        remainingTokensToSell -= tokensFromThisBuy;
      }
      
      // 计算利润
      const revenue = parseFloat(bnbReceived);
      const profit = revenue - totalCost;
      const profitPercentage = ((profit / totalCost) * 100);
      
      // 记录卖出交易
      const sellTrade = {
        id: Date.now().toString(),
        type: 'SELL',
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol,
        tokenAmount: parseFloat(tokenAmount),
        bnbReceived: revenue,
        bnbPrice: parseFloat(bnbPrice),
        gasUsed: totalGasUsed,
        timestamp: new Date().toISOString(),
        txHash,
        // 利润计算
        totalCost,
        profit,
        profitPercentage,
        buyTradesUsed: processedBuyTrades
      };
      
      history.trades.push(sellTrade);
      history.summary.totalTrades++;
      
      // 更新利润统计
      if (profit > 0) {
        history.summary.totalProfit += profit;
      } else {
        history.summary.totalLoss += Math.abs(profit);
      }
      
      // 计算胜率
      const profitableTrades = history.trades.filter(t => t.type === 'SELL' && t.profit > 0).length;
      const totalSellTrades = history.trades.filter(t => t.type === 'SELL').length;
      history.summary.winRate = totalSellTrades > 0 ? (profitableTrades / totalSellTrades * 100) : 0;
      
      fs.writeFileSync(this.tradingHistoryFile, JSON.stringify(history, null, 2));
      
      console.log(`📊 记录卖出交易: ${tokenSymbol}`);
      console.log(`💰 成本: ${totalCost.toFixed(6)} BNB`);
      console.log(`💎 收入: ${revenue.toFixed(6)} BNB`);
      console.log(`📈 利润: ${profit.toFixed(6)} BNB (${profitPercentage.toFixed(2)}%)`);
      
      return {
        sellTradeId: sellTrade.id,
        profit,
        profitPercentage,
        totalCost,
        revenue
      };
      
    } catch (error) {
      console.error('记录卖出交易失败:', error);
      return null;
    }
  }

  /**
   * 获取单个代币的持仓信息
   */
  getTokenPositionInfo(tokenAddress) {
    try {
      const history = this.getTradingHistory();
      const buyTrades = history.trades.filter(trade => 
        trade.type === 'BUY' && 
        trade.tokenAddress === tokenAddress.toLowerCase() && 
        trade.status === 'HOLDING'
      );
      
      if (buyTrades.length === 0) {
        return null;
      }
      
      const totalTokens = buyTrades.reduce((sum, trade) => sum + trade.tokenAmount, 0);
      const totalCost = buyTrades.reduce((sum, trade) => sum + trade.bnbAmount, 0);
      const avgPrice = totalCost / totalTokens;
      
      return {
        totalTokens,
        totalCost,
        avgPrice,
        trades: buyTrades.length
      };
      
    } catch (error) {
      console.error('获取持仓信息失败:', error);
      return null;
    }
  }

  /**
   * 获取交易统计
   */
  getTradingStats() {
    try {
      const history = this.getTradingHistory();
      const summary = history.summary;
      
      const buyTrades = history.trades.filter(t => t.type === 'BUY');
      const sellTrades = history.trades.filter(t => t.type === 'SELL');
      
      return {
        totalTrades: summary.totalTrades,
        buyTrades: buyTrades.length,
        sellTrades: sellTrades.length,
        totalProfit: summary.totalProfit,
        totalLoss: summary.totalLoss,
        netProfit: summary.totalProfit - summary.totalLoss,
        winRate: summary.winRate,
        holdingTokens: buyTrades.filter(t => t.status === 'HOLDING').length
      };
    } catch (error) {
      console.error('获取交易统计失败:', error);
      return null;
    }
  }

  /**
   * 获取BNB价格
   */
  async getBNBPrice() {
    try {
      const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
      const data = await response.json();
      return parseFloat(data.price) || 600;
    } catch (error) {
      return 600;
    }
  }

  /**
   * 验证代币地址
   */
  async isValidTokenAddress(tokenAddress) {
    try {
      if (!ethers.isAddress(tokenAddress)) {
        return false;
      }
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      await tokenContract.symbol();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取钱包余额 - 只显示BNB
   */
  async getWalletBalance() {
    try {
      // 获取BNB余额
      const bnbBalance = await this.provider.getBalance(this.wallet.address);
      const bnbAmount = ethers.formatEther(bnbBalance);

      return {
        success: true,
        address: this.wallet.address,
        bnb: bnbAmount,
        balance: bnbAmount // 保持向后兼容
      };
    } catch (error) {
      console.error('获取钱包余额失败:', error);
      return { 
        success: false, 
        error: '获取钱包余额失败',
        address: this.wallet.address,
        bnb: '0',
        balance: '0'
      };
    }
  }

  /**
   * 获取代币余额
   */
  async getTokenBalance(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [balance, decimals] = await Promise.all([
        tokenContract.balanceOf(this.wallet.address),
        tokenContract.decimals()
      ]);
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      return '0';
    }
  }

  /**
   * 获取代币价格
   */
  async getTokenPrice(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [decimals, symbol] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol()
      ]);
      
      const bnbAmount = ethers.parseEther('1');
      const path = [config.WBNB_ADDRESS, tokenAddress];
      
      const amounts = await this.router.getAmountsOut(bnbAmount, path);
      const tokensOut = amounts[1];
      
      const tokensPerBNB = parseFloat(ethers.formatUnits(tokensOut, decimals));
      const priceInBNB = 1 / tokensPerBNB;
      
      const bnbPriceUSD = await this.getBNBPrice();
      const priceInUSD = priceInBNB * bnbPriceUSD;
      
      return {
        success: true,
        symbol: symbol,
        priceInBNB: priceInBNB.toFixed(18),
        priceInUSD: priceInUSD.toFixed(6),
        liquidity: 'V2池子',
        price: priceInBNB.toFixed(18)
      };
    } catch (error) {
      return { success: false, error: '无法获取价格信息' };
    }
  }

  // V3价格查询
  async getTokenPriceV3(tokenAddress, fee = 2500) {
    try {
      const bnbAmount = ethers.parseEther('1');
      const quoted = await this.routerV3.quoteExactInputSingle(
        config.WBNB_ADDRESS,
        tokenAddress,
        fee,
        bnbAmount
      );
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const decimals = await tokenContract.decimals();
      const tokensOut = quoted;
      const tokensPerBNB = parseFloat(ethers.formatUnits(tokensOut, decimals));
      const priceInBNB = 1 / tokensPerBNB;
      const bnbPriceUSD = await this.getBNBPrice();
      const priceInUSD = priceInBNB * bnbPriceUSD;
      return {
        success: true,
        priceInBNB: priceInBNB.toFixed(18),
        priceInUSD: priceInUSD.toFixed(6),
        liquidity: 'V3池子',
        price: priceInBNB.toFixed(18)
      };
    } catch (error) {
      return { success: false, error: '无法获取V3价格信息' };
    }
  }

  /**
   * 获取代币持仓
   */
  async getTokenHoldings() {
    try {
      const tradedTokens = this.getTradedTokens();
      const holdings = [];
      let totalValueUSD = 0;

      // 添加BNB余额
      const bnbBalance = await this.provider.getBalance(this.wallet.address);
      const bnbAmount = parseFloat(ethers.formatEther(bnbBalance));
      const bnbPriceUSD = await this.getBNBPrice();
      const bnbValueUSD = bnbAmount * bnbPriceUSD;
      
      holdings.push({
        symbol: 'BNB',
        balance: bnbAmount.toFixed(6),
        priceUSD: bnbPriceUSD.toFixed(2),
        valueUSD: bnbValueUSD.toFixed(2),
        isNative: true,
        address: null
      });
      
      totalValueUSD += bnbValueUSD;
      let foundTokens = 1;

      // 检查代币
      for (const tokenAddress of tradedTokens) {
        try {
          const balance = await this.getTokenBalance(tokenAddress);
          const balanceNum = parseFloat(balance);
          
          if (balanceNum > 0) {
            const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
            const symbol = await tokenContract.symbol();
            
            const priceInfo = await this.getTokenPrice(tokenAddress);
            let priceUSD = 0;
            let valueUSD = 0;
            
            if (priceInfo.success) {
              priceUSD = parseFloat(priceInfo.priceInUSD);
              valueUSD = balanceNum * priceUSD;
              totalValueUSD += valueUSD;
            }
            
            holdings.push({
              symbol: symbol,
              balance: balanceNum.toFixed(6),
              priceUSD: priceUSD.toFixed(6),
              valueUSD: valueUSD.toFixed(2),
              isNative: false,
              address: tokenAddress
            });
            
            foundTokens++;
          }
        } catch (error) {
          console.error(`检查代币失败:`, error);
        }
      }

      return {
        success: true,
        tokens: holdings, // 修正为tokens字段，兼容测试脚本
        totalValueUSD: totalValueUSD.toFixed(2),
        scannedTokens: tradedTokens.length,
        foundTokens: foundTokens,
        fromTradingHistory: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 智能买入
   */
  async smartBuy(tokenAddress, bnbAmount) {
    try {
      console.log(`🛒 买入: ${tokenAddress}, ${bnbAmount} BNB`);
      
      // 验证和格式化BNB数量
      const bnbAmountNum = parseFloat(bnbAmount);
      if (isNaN(bnbAmountNum) || bnbAmountNum <= 0) {
        return { success: false, error: '❌ 无效的BNB数量' };
      }
      
      // 更新Gas价格
      await this.updateGasPrice();
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 预先验证交易路径
      const pathValidation = await this.validateTradingPath(tokenAddress, false);
      if (!pathValidation.valid) {
        return { success: false, error: `❌ ${pathValidation.error}` };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      // 使用安全的数值解析
      const amountIn = this.parseEtherSafe(bnbAmountNum);
      const path = [config.WBNB_ADDRESS, tokenAddress];
      
      const amounts = await this.router.getAmountsOut(amountIn, path);
      const amountOutMin = amounts[1] * BigInt(100 - this.settings.slippage) / BigInt(100);
      
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tx = await this.router.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin,
        path,
        this.wallet.address,
        deadline,
        {
          value: amountIn,
          gasPrice: this.parseUnitsSafe(this.settings.gasPrice, 'gwei'),
          gasLimit: this.settings.gasLimit
        }
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.addTradedToken(tokenAddress);
        
        // 记录交易历史
        this.recordBuyTrade(tokenAddress, symbol, bnbAmountNum, ethers.formatUnits(amounts[1], decimals), '1.0', receipt.gasUsed.toString(), tx.hash);
        
        // 发送Twitter通知
        if (config.ENABLE_TWITTER) {
          try {
            const message = `🛒 买入成功!\n\n` +
              `代币: ${symbol}\n` +
              `数量: ${ethers.formatUnits(amounts[1], decimals)}\n` +
              `花费: ${bnbAmountNum} BNB\n` +
              `交易哈希: ${tx.hash}\n` +
              `版本: PancakeSwap V2\n` +
              `时间: ${new Date().toLocaleString()}`;
            
            await this.sendTweet(message);
            console.log('📱 Twitter通知已发送');
          } catch (error) {
            console.error('Twitter通知发送失败:', error);
          }
        }
        
        return {
          success: true,
          txHash: tx.hash,
          message: `✅ 成功买入 ${symbol}`,
          expectedAmount: ethers.formatUnits(amounts[1], decimals),
          gasUsed: receipt.gasUsed.toString(),
          details: {
            amountIn: bnbAmountNum,
            expectedTokens: ethers.formatUnits(amounts[1], decimals),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString()
          }
        };
      } else {
        return { success: false, error: '❌ 交易失败' };
      }
    } catch (error) {
      console.error('买入失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  // V3买入
  async smartBuyV3(tokenAddress, bnbAmount, fee = 2500) {
    try {
      console.log(`🛒 V3买入: ${tokenAddress}, ${bnbAmount} BNB`);
      
      // 验证和格式化BNB数量
      const bnbAmountNum = parseFloat(bnbAmount);
      if (isNaN(bnbAmountNum) || bnbAmountNum <= 0) {
        return { success: false, error: '❌ 无效的BNB数量' };
      }
      
      // 更新Gas价格
      await this.updateGasPrice();
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 预先验证V3交易路径
      const pathValidation = await this.validateTradingPath(tokenAddress, true, fee);
      if (!pathValidation.valid) {
        return { success: false, error: `❌ ${pathValidation.error}` };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      // 使用安全的数值解析
      const amountIn = this.parseEtherSafe(bnbAmountNum);
      
      const quoted = await this.routerV3.quoteExactInputSingle(
        config.WBNB_ADDRESS,
        tokenAddress,
        fee,
        amountIn
      );
      
      const amountOutMin = quoted * BigInt(100 - this.settings.slippage) / BigInt(100);
      
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tx = await this.routerV3.exactInputSingle({
        tokenIn: config.WBNB_ADDRESS,
        tokenOut: tokenAddress,
        fee: fee,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimit: 0
      },      {
        value: amountIn,
        gasPrice: this.parseUnitsSafe(this.settings.gasPrice, 'gwei'),
        gasLimit: this.settings.gasLimit
      });
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.addTradedToken(tokenAddress);
        
        // 记录交易历史
        this.recordBuyTrade(tokenAddress, symbol, bnbAmountNum, ethers.formatUnits(quoted, decimals), '1.0', receipt.gasUsed.toString(), tx.hash);
        
        // 发送Twitter通知
        if (config.ENABLE_TWITTER) {
          try {
            const message = `🛒 买入成功!\n\n` +
              `代币: ${symbol}\n` +
              `数量: ${ethers.formatUnits(quoted, decimals)}\n` +
              `花费: ${bnbAmountNum} BNB\n` +
              `交易哈希: ${tx.hash}\n` +
              `版本: PancakeSwap V3 (${fee/10000}%)\n` +
              `时间: ${new Date().toLocaleString()}`;
            
            await this.sendTweet(message);
            console.log('📱 Twitter通知已发送');
          } catch (error) {
            console.error('Twitter通知发送失败:', error);
          }
        }
        
        return {
          success: true,
          txHash: tx.hash,
          message: `✅ 成功V3买入 ${symbol}`,
          expectedAmount: ethers.formatUnits(quoted, decimals),
          gasUsed: receipt.gasUsed.toString(),
          fee: fee,
          details: {
            amountIn: bnbAmountNum,
            expectedTokens: ethers.formatUnits(quoted, decimals),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString(),
            fee: fee
          }
        };
      } else {
        return { success: false, error: '❌ 交易失败' };
      }
    } catch (error) {
      console.error('V3买入失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  /**
   * 智能卖出 - 带动态Gas价格
   */
  async smartSell(tokenAddress, tokenAmount) {
    try {
      console.log(`💸 卖出: ${tokenAddress}, ${tokenAmount}`);
      
      // 更新Gas价格
      await this.updateGasPrice();
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 预先验证交易路径
      const pathValidation = await this.validateTradingPath(tokenAddress, false);
      if (!pathValidation.valid) {
        return { success: false, error: `❌ ${pathValidation.error}` };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      const balance = await this.getTokenBalance(tokenAddress);
      const balanceNum = parseFloat(balance);
      const sellAmount = parseFloat(tokenAmount);
      
      if (balanceNum < sellAmount) {
        return { 
          success: false, 
          error: `余额不足: ${balanceNum.toFixed(6)} ${symbol}` 
        };
      }
      
      const amountIn = this.parseTokenAmountSafe(tokenAmount, decimals);
      
      // 检查授权
      const allowance = await tokenContract.allowance(this.wallet.address, this.routerAddress);
      
      if (allowance < amountIn) {
        console.log('授权代币...');
        const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
        await approveTx.wait();
      }
      
      const path = [tokenAddress, config.WBNB_ADDRESS];
      const amounts = await this.router.getAmountsOut(amountIn, path);
      const amountOutMin = amounts[1] * BigInt(100 - this.settings.slippage) / BigInt(100);
      
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tx = await this.router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountIn,
        amountOutMin,
        path,
        this.wallet.address,
        deadline,
        {
          gasPrice: this.parseUnitsSafe(this.settings.gasPrice, 'gwei'),
          gasLimit: this.settings.gasLimit
        }
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        // 卖出成功后检查余额，若为0则移除
        const remain = await this.getTokenBalance(tokenAddress);
        if (parseFloat(remain) === 0) {
          this.removeTradedToken(tokenAddress);
        }
        
        // 记录卖出交易并获取利润信息
        const expectedBNB = ethers.formatEther(amounts[1]);
        const priceInfo = await this.getTokenPrice(tokenAddress).catch(() => ({ success: false }));
        const bnbPrice = priceInfo.success ? priceInfo.priceInBNB : '0';
        const profitInfo = this.recordSellTrade(tokenAddress, symbol, tokenAmount, expectedBNB, bnbPrice, receipt.gasUsed.toString(), tx.hash);
        
        // 发送Twitter通知（包含利润信息）
        try {
          const priceUSD = priceInfo.success ? priceInfo.priceInUSD : null;
          const tweetMessage = this.generateSellTweetWithProfit(symbol, tokenAmount, expectedBNB, tx.hash, priceUSD, profitInfo);
          await this.sendTweet(tweetMessage);
        } catch (twitterError) {
          console.log('Twitter通知发送失败:', twitterError.message);
        }
        
        return {
          success: true,
          txHash: tx.hash,
          message: `成功卖出 ${tokenAmount} ${symbol}`,
          details: {
            amountIn: tokenAmount,
            expectedBNB: ethers.formatEther(amounts[1]),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString()
          }
        };
      } else {
        return { success: false, error: '交易失败' };
      }
    } catch (error) {
      console.error('卖出失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  // V3卖出 - 带动态Gas价格
  async smartSellV3(tokenAddress, tokenAmount, fee = 2500) {
    try {
      console.log(`💸 V3卖出: ${tokenAddress}, ${tokenAmount}`);
      
      // 更新Gas价格
      await this.updateGasPrice();
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 预先验证V3交易路径
      const pathValidation = await this.validateTradingPath(tokenAddress, true, fee);
      if (!pathValidation.valid) {
        return { success: false, error: `❌ ${pathValidation.error}` };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      const balance = await this.getTokenBalance(tokenAddress);
      const balanceNum = parseFloat(balance);
      const sellAmount = parseFloat(tokenAmount);
      
      if (balanceNum < sellAmount) {
        return { 
          success: false, 
          error: `余额不足: ${balanceNum.toFixed(6)} ${symbol}` 
        };
      }
      
      const amountIn = this.parseTokenAmountSafe(tokenAmount, decimals);
      
      // 检查授权
      const allowance = await tokenContract.allowance(this.wallet.address, this.routerAddress);
      
      if (allowance < amountIn) {
        console.log('授权代币...');
        const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
        await approveTx.wait();
      }
      
      const quoted = await this.routerV3.quoteExactInputSingle(
        tokenAddress,
        config.WBNB_ADDRESS,
        fee,
        amountIn
      );
      
      const amountOutMin = quoted * BigInt(100 - this.settings.slippage) / BigInt(100);
      
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tx = await this.routerV3.exactInputSingle({
        tokenIn: tokenAddress,
        tokenOut: config.WBNB_ADDRESS,
        fee: fee,
        recipient: this.wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimit: 0
      });
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        // V3卖出成功后检查余额，若为0则移除
        const remain = await this.getTokenBalance(tokenAddress);
        if (parseFloat(remain) === 0) {
          this.removeTradedToken(tokenAddress);
        }
        
        // 记录卖出交易并获取利润信息
        const expectedBNB = ethers.formatEther(quoted);
        const profitInfo = this.recordSellTrade(tokenAddress, symbol, tokenAmount, expectedBNB, this.settings.gasPrice, receipt.gasUsed.toString(), tx.hash);
        
        // 发送Twitter通知（包含利润信息）
        try {
          const priceInfo = await this.getTokenPriceV3(tokenAddress, fee);
          const priceUSD = priceInfo.success ? priceInfo.priceInUSD : null;
          const tweetMessage = this.generateSellTweetWithProfit(symbol, tokenAmount, expectedBNB, tx.hash, priceUSD, profitInfo);
          await this.sendTweet(tweetMessage);
        } catch (twitterError) {
          console.log('Twitter通知发送失败:', twitterError.message);
        }
        
        return {
          success: true,
          txHash: tx.hash,
          message: `成功V3卖出 ${tokenAmount} ${symbol}`,
          details: {
            amountIn: tokenAmount,
            expectedBNB: ethers.formatEther(quoted),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString()
          }
        };
      } else {
        return { success: false, error: '交易失败' };
      }
    } catch (error) {
      console.error('V3卖出失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  /**
   * 添加代币到监控列表
   */
  async addToken(tokenAddress) {
    try {
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '无效的代币地址' };
      }

      this.addTradedToken(tokenAddress);
      
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const symbol = await tokenContract.symbol();

      return {
        success: true,
        message: `已添加代币: ${symbol}`,
        token: { address: tokenAddress, symbol }
      };
    } catch (error) {
      return { success: false, error: `添加失败: ${error.message}` };
    }
  }

  /**
   * 获取动态Gas价格
   */
  async getDynamicGasPrice() {
    try {
      // 方法1: 通过ethers获取网络推荐Gas价格
      const feeData = await this.provider.getFeeData();
      if (feeData.gasPrice) {
        const gasPriceGwei = Number(feeData.gasPrice) / 1e9;
        console.log(`🔧 网络推荐Gas价格: ${gasPriceGwei.toFixed(2)} Gwei`);
        
        // 在推荐价格基础上增加10%确保快速确认
        const adjustedGasPrice = gasPriceGwei * 1.1;
        const maxGasPrice = (Number(config.MAX_GAS_PRICE) / 1e9) || 1.0; // 从配置读取最大Gas价格
        const finalGasPrice = Math.min(Math.max(adjustedGasPrice, 0.1), maxGasPrice);
        
        if (adjustedGasPrice > maxGasPrice) {
          console.log(`⚠️ Gas价格${adjustedGasPrice.toFixed(2)}超过限制，使用最大值${maxGasPrice} Gwei`);
        }
        
        return finalGasPrice;
      }
    } catch (error) {
      console.log('获取网络Gas价格失败，使用备用方法');
    }

    try {
      // 方法2: 通过BSC Gas Station API获取
      const response = await fetch('https://gasstation-mainnet.bnbchain.org/');
      const data = await response.json();
      if (data.standard) {
        const gasPrice = parseFloat(data.standard);
        const maxGasPrice = (Number(config.MAX_GAS_PRICE) / 1e9) || 1.0;
        const finalGasPrice = Math.min(Math.max(gasPrice, 0.1), maxGasPrice);
        
        console.log(`🔧 BSC Gas Station推荐: ${gasPrice} Gwei, 使用: ${finalGasPrice} Gwei`);
        return finalGasPrice;
      }
    } catch (error) {
      console.log('BSC Gas Station获取失败，使用配置默认值');
    }

    // 备用: 返回配置文件中的默认值
    const defaultGasPrice = (Number(config.DEFAULT_GAS_PRICE) / 1e9) || 0.1;
    console.log(`🔧 使用默认Gas价格: ${defaultGasPrice} Gwei`);
    return defaultGasPrice;
  }

  /**
   * 更新Gas价格设置
   */
  async updateGasPrice() {
    const dynamicGasPrice = await this.getDynamicGasPrice();
    // 使用安全格式化确保没有精度问题
    this.settings.gasPrice = parseFloat(this.formatDecimalSafe(dynamicGasPrice, 9));
    console.log(`⚡ Gas价格已更新为: ${this.settings.gasPrice.toFixed(2)} Gwei`);
    return this.settings.gasPrice;
  }

  // 权限验证
  isAuthorizedUser(chatId) {
    const adminChatIds = config.ADMIN_CHAT_IDS.split(',').map(id => id.trim());
    return adminChatIds.includes(chatId.toString());
  }

  // 交易金额验证
  validateTradeAmount(amount) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return { valid: false, error: '金额必须为正数' };
    }
    if (numAmount > this.maxTradeAmount) {
      return { valid: false, error: `金额不能超过 ${this.maxTradeAmount} BNB` };
    }
    return { valid: true };
  }

  // 代币地址严格验证
  async validateTokenAddress(tokenAddress) {
    if (!ethers.isAddress(tokenAddress)) {
      return { valid: false, error: '无效的代币地址格式' };
    }
    
    try {
      const code = await this.provider.getCode(tokenAddress);
      if (code === '0x') {
        return { valid: false, error: '地址不是合约地址' };
      }
      
      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      await tokenContract.symbol();
      return { valid: true };
    } catch (error) {
      return { valid: false, error: '无法验证代币合约' };
    }
  }

  /**
   * 初始化Twitter客户端
   */
  initTwitterClient() {
    if (config.ENABLE_TWITTER && config.TWITTER_API_KEY && config.TWITTER_API_SECRET) {
      try {
        this.twitterClient = new TwitterApi({
          appKey: config.TWITTER_API_KEY,
          appSecret: config.TWITTER_API_SECRET,
          accessToken: config.TWITTER_ACCESS_TOKEN,
          accessSecret: config.TWITTER_ACCESS_SECRET,
        });
        console.log('🐦 Twitter客户端初始化成功');
      } catch (error) {
        console.error('❌ Twitter客户端初始化失败:', error.message);
        this.twitterClient = null;
      }
    } else {
      this.twitterClient = null;
      console.log('🐦 Twitter通知已禁用');
    }
  }

  /**
   * 发送Twitter消息
   */
  async sendTweet(message) {
    if (!this.twitterClient || !config.ENABLE_TWITTER) {
      console.log('🐦 Twitter通知已禁用，跳过发送');
      return { success: false, reason: 'Twitter通知已禁用' };
    }

    try {
      const tweet = await this.twitterClient.v2.tweet(message);
      console.log('🐦 Tweet发送成功:', tweet.data.id);
      return { success: true, tweetId: tweet.data.id };
    } catch (error) {
      console.error('❌ Tweet发送失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 生成买入Tweet消息
   */
  generateBuyTweet(tokenSymbol, bnbAmount, txHash, priceUSD) {
    const shortTxHash = txHash ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}` : '';
    const priceInfo = priceUSD ? `💰 价格: $${priceUSD}\n` : '';
    
    return `🚀 机器人买入提醒

🔥 代币: $${tokenSymbol}
💎 数量: ${bnbAmount} BNB
${priceInfo}🔗 交易: https://bscscan.com/tx/${txHash}

#DeFi #PancakeSwap #BSC #${tokenSymbol} #TradingBot`;
  }

  /**
   * 生成卖出Tweet消息
   */
  generateSellTweet(tokenSymbol, tokenAmount, expectedBNB, txHash, priceUSD) {
    const shortTxHash = txHash ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}` : '';
    const priceInfo = priceUSD ? `💰 价格: $${priceUSD}\n` : '';
    
    return `💸 机器人卖出提醒

📤 代币: $${tokenSymbol}
💰 数量: ${tokenAmount} 代币
💎 获得: ${expectedBNB} BNB
${priceInfo}🔗 交易: https://bscscan.com/tx/${txHash}

#DeFi #PancakeSwap #BSC #${tokenSymbol} #TradingBot`;
  }

  /**
   * 生成包含利润信息的卖出Tweet消息
   */
  generateSellTweetWithProfit(tokenSymbol, tokenAmount, expectedBNB, txHash, priceUSD, profitInfo) {
    const shortTxHash = txHash ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}` : '';
    const priceInfo = priceUSD ? `💰 价格: $${priceUSD}\n` : '';
    
    let profitMessage = '';
    if (profitInfo && profitInfo.profit !== undefined) {
      const profitSign = profitInfo.profit >= 0 ? '+' : '';
      const profitEmoji = profitInfo.profit >= 0 ? '📈' : '📉';
      profitMessage = `${profitEmoji} 利润: ${profitSign}${profitInfo.profit.toFixed(6)} BNB (${profitSign}${profitInfo.profitPercentage.toFixed(2)}%)\n`;
    }
    
    return `💸 机器人卖出提醒

📤 代币: $${tokenSymbol}
💰 数量: ${tokenAmount} 代币
💎 获得: ${expectedBNB} BNB
${priceInfo}${profitMessage}🔗 交易: https://bscscan.com/tx/${txHash}

#DeFi #PancakeSwap #BSC #${tokenSymbol} #TradingBot`;
  }

  /**
   * 获取交易历史
   */
  /**
   * 添加交易记录
   */
  addTradingRecord(record) {
    try {
      const history = this.getTradingHistory();
      history.push(record);
      fs.writeFileSync(this.tradingHistoryFile, JSON.stringify({ trades: history }, null, 2));
    } catch (error) {
      console.error('Error adding trading record:', error);
    }
  }

  /**
   * 计算利润
   */
  calculateProfit(buyPrice, sellPrice, amount) {
    const profit = (sellPrice - buyPrice) * amount;
    return profit.toFixed(2);
  }

  /**
   * 智能卖出并计算利润
   */
  async smartSellWithProfit(tokenAddress, tokenAmount, buyTxHash) {
    try {
      console.log(`💸 智能卖出: ${tokenAddress}, ${tokenAmount}`);
      
      // 更新Gas价格
      await this.updateGasPrice();
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '无效的代币地址' };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals()
      ]);
      
      const balance = await this.getTokenBalance(tokenAddress);
      const balanceNum = parseFloat(balance);
      const sellAmount = parseFloat(tokenAmount);
      
      if (balanceNum < sellAmount) {
        return { 
          success: false, 
          error: `余额不足: ${balanceNum.toFixed(6)} ${symbol}` 
        };
      }
      
      const amountIn = this.parseTokenAmountSafe(tokenAmount, decimals);
      
      // 检查授权
      const allowance = await tokenContract.allowance(this.wallet.address, this.routerAddress);
      
      if (allowance < amountIn) {
        console.log('授权代币...');
        const approveTx = await tokenContract.approve(this.routerAddress, ethers.MaxUint256);
        await approveTx.wait();
      }
      
      const path = [tokenAddress, config.WBNB_ADDRESS];
      const amounts = await this.router.getAmountsOut(amountIn, path);
      const amountOutMin = amounts[1] * BigInt(100 - this.settings.slippage) / BigInt(100);
      
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      
      const tx = await this.router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountIn,
        amountOutMin,
        path,
        this.wallet.address,
        deadline,
        {
          gasPrice: this.parseUnitsSafe(this.settings.gasPrice, 'gwei'),
          gasLimit: this.settings.gasLimit
        }
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        // 卖出成功后检查余额，若为0则移除
        const remain = await this.getTokenBalance(tokenAddress);
        if (parseFloat(remain) === 0) {
          this.removeTradedToken(tokenAddress);
        }
        
        // 获取买入价格
        const buyRecord = this.getTradingHistory().find(record => record.txHash === buyTxHash);
        let buyPrice = 0;
        if (buyRecord) {
          const priceInfo = await this.getTokenPrice(tokenAddress);
          buyPrice = priceInfo.success ? parseFloat(priceInfo.priceInUSD) : 0;
        }
        
        // 计算利润
        const sellPrice = await this.getBNBPrice();
        const profit = this.calculateProfit(buyPrice, sellPrice, tokenAmount);
        
        // 添加交易记录
        this.addTradingRecord({
          txHash: tx.hash,
          tokenAddress: tokenAddress,
          tokenSymbol: symbol,
          amount: tokenAmount,
          price: sellPrice,
          profit: profit,
          timestamp: new Date().toISOString()
        });
        
        // 发送Twitter通知
        try {
          const priceInfo = await this.getTokenPrice(tokenAddress);
          const priceUSD = priceInfo.success ? priceInfo.priceInUSD : null;
          const expectedBNB = ethers.formatEther(amounts[1]);
          const tweetMessage = this.generateSellTweet(symbol, tokenAmount, expectedBNB, tx.hash, priceUSD);
          await this.sendTweet(tweetMessage);
        } catch (twitterError) {
          console.log('Twitter通知发送失败:', twitterError.message);
        }
        
        return {
          success: true,
          txHash: tx.hash,
          message: `成功卖出 ${tokenAmount} ${symbol}，利润: $${profit}`,
          details: {
            amountIn: tokenAmount,
            expectedBNB: ethers.formatEther(amounts[1]),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString(),
            profit: profit
          }
        };
      } else {
        return { success: false, error: '交易失败' };
      }
    } catch (error) {
      console.error('卖出失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  /**
   * 安全的数值格式化，避免浮点数精度问题
   */
  formatDecimalSafe(value, decimals = 18) {
    try {
      // 处理特殊值
      if (value === null || value === undefined || value === '') {
        return '0';
      }
      
      // 转换为数字
      const numValue = Number(value);
      
      // 检查是否为有效数字
      if (isNaN(numValue) || !isFinite(numValue)) {
        return '0';
      }
      
      // 转换为字符串并处理精度问题
      let valueStr = numValue.toString();
      
      // 如果是科学计数法，转换为标准格式
      if (valueStr.includes('e')) {
        valueStr = numValue.toFixed(decimals);
      }
      
      // 移除尾随的零
      if (valueStr.includes('.')) {
        valueStr = valueStr.replace(/\.?0+$/, '');
      }
      
      // 限制小数位数
      const parts = valueStr.split('.');
      if (parts[1] && parts[1].length > decimals) {
        valueStr = parts[0] + '.' + parts[1].substring(0, decimals);
      }
      
      return valueStr;
    } catch (error) {
      console.error('数值格式化错误:', error);
      return '0';
    }
  }

  /**
   * 安全的以太坊数值解析
   */
  parseEtherSafe(value) {
    try {
      const safeValue = this.formatDecimalSafe(value, 18);
      return ethers.parseEther(safeValue);
    } catch (error) {
      console.error('以太坊数值解析错误:', error, 'value:', value);
      throw new Error(`数值解析失败: ${value}`);
    }
  }

  /**
   * 安全的单位解析（用于Gas价格等）
   */
  parseUnitsSafe(value, unit = 'gwei', decimals = 9) {
    try {
      const safeValue = this.formatDecimalSafe(value, decimals);
      return ethers.parseUnits(safeValue, unit);
    } catch (error) {
      console.error('单位解析错误:', error, 'value:', value, 'unit:', unit);
      throw new Error(`单位解析失败: ${value} ${unit}`);
    }
  }

  /**
   * 安全的代币数量解析
   */
  parseTokenAmountSafe(amount, decimals) {
    try {
      // 验证和格式化代币数量
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('无效的代币数量');
      }
      
      // 使用安全格式化，限制小数位数不超过代币精度
      const safeAmount = this.formatDecimalSafe(amountNum, Number(decimals));
      return ethers.parseUnits(safeAmount, decimals);
    } catch (error) {
      console.error('代币数量解析错误:', error, 'amount:', amount, 'decimals:', decimals);
      throw new Error(`代币数量解析失败: ${amount}`);
    }
  }

  /**
   * 添加代币到已交易列表
   */
  addTradedToken(tokenAddress) {
    try {
      const tokens = this.getTradedTokens();
      const normalizedAddress = tokenAddress.toLowerCase();
      
      if (!tokens.includes(normalizedAddress)) {
        tokens.push(normalizedAddress);
        fs.writeFileSync(this.tradedTokensFile, JSON.stringify({ tokens }, null, 2));
        console.log(`✅ 代币已添加到交易列表: ${tokenAddress}`);
      }
    } catch (error) {
      console.error('添加交易代币失败:', error);
    }
  }

  /**
   * 从已交易列表中移除代币
   */
  removeTradedToken(tokenAddress) {
    try {
      const tokens = this.getTradedTokens();
      const normalizedAddress = tokenAddress.toLowerCase();
      const index = tokens.indexOf(normalizedAddress);
      
      if (index > -1) {
        tokens.splice(index, 1);
        fs.writeFileSync(this.tradedTokensFile, JSON.stringify({ tokens }, null, 2));
        console.log(`✅ 代币已从交易列表移除: ${tokenAddress}`);
      }
    } catch (error) {
      console.error('移除交易代币失败:', error);
    }
  }

  // 解析合约错误，提供用户友好的错误信息
  parseContractError(error) {
    const errorMessage = error.message || error.reason || '';
    const errorCode = error.code || '';
    
    // 常见的PancakeSwap错误类型
    if (errorMessage.includes('INSUFFICIENT_OUTPUT_AMOUNT') || errorMessage.includes('insufficient liquidity')) {
      return '❌ 流动性不足或滑点过小，请增加滑点或稍后重试';
    }
    
    if (errorMessage.includes('INSUFFICIENT_INPUT_AMOUNT')) {
      return '❌ 输入金额不足，请检查您的余额';
    }
    
    if (errorMessage.includes('INVALID_PATH') || errorMessage.includes('PancakeLibrary: INVALID_PATH')) {
      return '❌ 无效的交易路径，该代币可能不存在流动性池';
    }
    
    if (errorMessage.includes('EXPIRED')) {
      return '❌ 交易已过期，请重试';
    }
    
    if (errorMessage.includes('TRANSFER_FAILED') || errorMessage.includes('transfer failed')) {
      return '❌ 代币转账失败，可能是代币合约限制';
    }
    
    if (errorMessage.includes('execution reverted') && errorMessage.includes('require(false)')) {
      return '❌ 交易被拒绝，可能是：\n• 代币地址无效\n• 没有流动性池\n• 代币有交易限制\n• 滑点设置过低';
    }
    
    if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
      return '❌ 余额不足，请检查您的BNB余额';
    }
    
    if (errorMessage.includes('gas required exceeds allowance') || errorMessage.includes('out of gas')) {
      return '❌ Gas费用不足，请增加Gas限额或检查网络状况';
    }
    
    if (errorMessage.includes('nonce too low') || errorMessage.includes('replacement transaction underpriced')) {
      return '❌ 交易nonce错误，请等待上一笔交易确认';
    }
    
    if (errorMessage.includes('network error') || errorMessage.includes('timeout')) {
      return '❌ 网络连接问题，请检查网络状况后重试';
    }
    
    // 如果是数值相关错误
    if (errorMessage.includes('value out of range') || errorMessage.includes('numeric fault')) {
      return '❌ 数值格式错误，请检查输入的金额';
    }
    
    // 默认错误信息
    return `❌ 交易失败: ${error.reason || error.message || '未知错误'}`;
  }

  // 验证交易路径是否有效
  async validateTradingPath(tokenAddress, isV3 = false, fee = 2500) {
    try {
      const path = [config.WBNB_ADDRESS, tokenAddress];
      const testAmount = ethers.parseEther('0.001'); // 测试用的小额
      
      if (isV3) {
        // V3路径验证 - 检查池子是否存在
        const poolContract = new ethers.Contract(
          this.getV3PoolAddress(config.WBNB_ADDRESS, tokenAddress, fee),
          [
            "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
          ],
          this.provider
        );
        
        try {
          await poolContract.slot0();
          return { valid: true };
        } catch (error) {
          return { valid: false, error: `V3流动性池不存在 (费率${fee/10000}%)` };
        }
      } else {
        // V2路径验证 - 增强版
        try {
          const amounts = await this.router.getAmountsOut(testAmount, path);
          
          // 检查输出是否合理（至少要有一些代币）
          const outputAmount = amounts[1];
          if (outputAmount <= 0n) {
            return { valid: false, error: '代币输出为0，可能是诈骗代币' };
          }
          
          // 检查是否是蜜罐或极低流动性代币
          // 如果0.001 BNB只能换到极少的代币，那可能有问题
          const ratio = Number(outputAmount) / Number(testAmount);
          if (ratio < 0.0001) { // 如果比率太低，可能是问题代币
            return { valid: false, error: '代币流动性极低或可能是蜜罐代币' };
          }
          
          // 测试一个更大的金额，看看滑点是否合理
          const largerTestAmount = ethers.parseEther('0.01'); // 0.01 BNB
          try {
            const largerAmounts = await this.router.getAmountsOut(largerTestAmount, path);
            const largerRatio = Number(largerAmounts[1]) / Number(largerTestAmount);
            
            // 检查滑点是否过大（比小额测试的比率差太多）
            const slippageRatio = Math.abs(ratio - largerRatio) / ratio;
            if (slippageRatio > 0.5) { // 如果滑点超过50%，可能有问题
              return { valid: false, error: '代币流动性不足，滑点过大' };
            }
          } catch (e) {
            // 如果大额测试失败，说明流动性确实有问题
            return { valid: false, error: '代币流动性不足，无法支持正常交易' };
          }
          
          return { valid: true };
        } catch (error) {
          // 检查是否有V3池子可用
          const v3Fees = [500, 2500, 10000];
          let hasV3Pool = false;
          
          for (const feeAmount of v3Fees) {
            try {
              const poolContract = new ethers.Contract(
                this.getV3PoolAddress(config.WBNB_ADDRESS, tokenAddress, feeAmount),
                [
                  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
                ],
                this.provider
              );
              await poolContract.slot0();
              hasV3Pool = true;
              break;
            } catch (e) {
              // 继续检查下一个费率
            }
          }
          
          if (hasV3Pool) {
            return { valid: false, error: '该代币只在V3上有流动性，请尝试V3交易' };
          } else {
            return { valid: false, error: '该代币在PancakeSwap上没有流动性池，请检查代币地址或选择其他代币' };
          }
        }
      }
    } catch (error) {
      return { valid: false, error: '路径验证失败' };
    }
  }

  // 计算V3池子地址
  getV3PoolAddress(tokenA, tokenB, fee) {
    // 确保token地址顺序正确 (token0 < token1)
    let token0, token1;
    if (tokenA.toLowerCase() < tokenB.toLowerCase()) {
      token0 = tokenA;
      token1 = tokenB;
    } else {
      token0 = tokenB;
      token1 = tokenA;
    }
    
    // PancakeSwap V3 Factory 地址
    const factoryAddress = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
    
    // 使用ethers.js计算池子地址 (CREATE2)
    const salt = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint24'],
        [token0, token1, fee]
      )
    );
    
    // PancakeSwap V3 Pool Init Code Hash
    const initCodeHash = '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2';
    
    const poolAddress = ethers.getCreate2Address(
      factoryAddress,
      salt,
      initCodeHash
    );
    
    return poolAddress;
  }

  /**
   * 获取V2和V3的价格报价并选择最优策略
   */
  async getBestPriceStrategy(tokenAddress, bnbAmount, isBuy = true) {
    try {
      console.log(`🧠 分析最优策略 - ${isBuy ? '买入' : '卖出'}: ${tokenAddress}, ${bnbAmount} BNB`);
      
      const results = {
        v2: null,
        v3: null,
        bestStrategy: null,
        bestPrice: null,
        priceComparison: null
      };

      // 并行获取V2和V3的价格报价
      const [v2Quote, v3Quote] = await Promise.allSettled([
        this.getV2Quote(tokenAddress, bnbAmount, isBuy),
        this.getV3Quote(tokenAddress, bnbAmount, isBuy)
      ]);

      // 处理V2报价
      if (v2Quote.status === 'fulfilled' && v2Quote.value.success) {
        results.v2 = v2Quote.value;
        console.log(`📊 V2报价: ${results.v2.expectedAmount} tokens`);
      } else {
        console.log(`❌ V2报价失败: ${v2Quote.reason || 'Unknown error'}`);
      }

      // 处理V3报价
      if (v3Quote.status === 'fulfilled' && v3Quote.value.success) {
        results.v3 = v3Quote.value;
        console.log(`📊 V3报价: ${results.v3.expectedAmount} tokens`);
      } else {
        console.log(`❌ V3报价失败: ${v3Quote.reason || 'Unknown error'}`);
      }

      // 选择最优策略
      if (results.v2 && results.v3) {
        // 两个都有效，比较价格
        const v2Amount = parseFloat(results.v2.expectedAmount);
        const v3Amount = parseFloat(results.v3.expectedAmount);
        
        if (isBuy) {
          // 买入时选择能获得更多代币的路径
          if (v2Amount > v3Amount) {
            results.bestStrategy = 'v2';
            results.bestPrice = results.v2;
            results.priceComparison = `V2更优 (+${((v2Amount - v3Amount) / v3Amount * 100).toFixed(2)}%)`;
          } else {
            results.bestStrategy = 'v3';
            results.bestPrice = results.v3;
            results.priceComparison = `V3更优 (+${((v3Amount - v2Amount) / v2Amount * 100).toFixed(2)}%)`;
          }
        } else {
          // 卖出时选择能获得更多BNB的路径
          if (v2Amount > v3Amount) {
            results.bestStrategy = 'v2';
            results.bestPrice = results.v2;
            results.priceComparison = `V2更优 (+${((v2Amount - v3Amount) / v3Amount * 100).toFixed(2)}%)`;
          } else {
            results.bestStrategy = 'v3';
            results.bestPrice = results.v3;
            results.priceComparison = `V3更优 (+${((v3Amount - v2Amount) / v2Amount * 100).toFixed(2)}%)`;
          }
        }
        
        console.log(`🎯 最优策略: ${results.bestStrategy.toUpperCase()} - ${results.priceComparison}`);
      } else if (results.v2) {
        // 只有V2可用
        results.bestStrategy = 'v2';
        results.bestPrice = results.v2;
        results.priceComparison = 'V2可用，V3不可用';
        console.log('📊 使用V2策略 (V3不可用)');
      } else if (results.v3) {
        // 只有V3可用
        results.bestStrategy = 'v3';
        results.bestPrice = results.v3;
        results.priceComparison = 'V3可用，V2不可用';
        console.log('📊 使用V3策略 (V2不可用)');
      } else {
        // 都不可用
        console.log('❌ V2和V3都不可用');
        return {
          success: false,
          error: '没有可用的交易路径'
        };
      }

      return {
        success: true,
        ...results
      };

    } catch (error) {
      console.error('智能策略分析失败:', error);
      return {
        success: false,
        error: `策略分析失败: ${error.message}`
      };
    }
  }

  /**
   * 获取V2价格报价
   */
  async getV2Quote(tokenAddress, bnbAmount, isBuy = true) {
    try {
      const bnbAmountNum = parseFloat(bnbAmount);
      const amountIn = this.parseEtherSafe(bnbAmountNum);
      
      if (isBuy) {
        // 买入：BNB -> Token
        const path = [config.WBNB_ADDRESS, tokenAddress];
        const amounts = await this.routerV2.getAmountsOut(amountIn, path);
        
        const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
        const decimals = await tokenContract.decimals();
        
        return {
          success: true,
          version: 'v2',
          expectedAmount: ethers.formatUnits(amounts[1], decimals),
          path: path,
          amountIn: amountIn.toString(),
          amountOut: amounts[1].toString()
        };
      } else {
        // 卖出：Token -> BNB
        const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
        const decimals = await tokenContract.decimals();
        const tokenAmountIn = this.parseUnitsSafe(bnbAmountNum, decimals); // 这里bnbAmount实际是token数量
        
        const path = [tokenAddress, config.WBNB_ADDRESS];
        const amounts = await this.routerV2.getAmountsOut(tokenAmountIn, path);
        
        return {
          success: true,
          version: 'v2',
          expectedAmount: ethers.formatEther(amounts[1]),
          path: path,
          amountIn: tokenAmountIn.toString(),
          amountOut: amounts[1].toString()
        };
      }
    } catch (error) {
      console.error('V2报价失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取V3价格报价
   */
  async getV3Quote(tokenAddress, bnbAmount, isBuy = true, fee = 2500) {
    try {
      const bnbAmountNum = parseFloat(bnbAmount);
      
      // V3 Quoter合约地址和ABI
      const quoterV3Address = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
      const quoterV3ABI = [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
      ];
      
      const quoter = new ethers.Contract(quoterV3Address, quoterV3ABI, this.provider);
      
      if (isBuy) {
        // 买入：BNB -> Token
        const amountIn = this.parseEtherSafe(bnbAmountNum);
        const amountOut = await quoter.quoteExactInputSingle(
          config.WBNB_ADDRESS,
          tokenAddress,
          fee,
          amountIn,
          0
        );
        
        const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
        const decimals = await tokenContract.decimals();
        
        return {
          success: true,
          version: 'v3',
          expectedAmount: ethers.formatUnits(amountOut, decimals),
          fee: fee,
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString()
        };
      } else {
        // 卖出：Token -> BNB
        const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
        const decimals = await tokenContract.decimals();
        const tokenAmountIn = this.parseUnitsSafe(bnbAmountNum, decimals);
        
        const amountOut = await quoter.quoteExactInputSingle(
          tokenAddress,
          config.WBNB_ADDRESS,
          fee,
          tokenAmountIn,
          0
        );
        
        return {
          success: true,
          version: 'v3',
          expectedAmount: ethers.formatEther(amountOut),
          fee: fee,
          amountIn: tokenAmountIn.toString(),
          amountOut: amountOut.toString()
        };
      }
    } catch (error) {
      console.error('V3报价失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 比较V2和V3价格，返回最优路由
   */
  async getBestRoute(tokenAddress, bnbAmount, isBuy = true) {
    try {
      console.log(`🔍 正在比较 V2 和 V3 价格...`);
      
      // 并行获取V2和V3报价
      const [v2Quote, v3Quote2500, v3Quote500, v3Quote10000] = await Promise.allSettled([
        this.getV2Quote(tokenAddress, bnbAmount, isBuy),
        this.getV3Quote(tokenAddress, bnbAmount, isBuy, 2500), // 0.25% fee
        this.getV3Quote(tokenAddress, bnbAmount, isBuy, 500),  // 0.05% fee
        this.getV3Quote(tokenAddress, bnbAmount, isBuy, 10000) // 1% fee
      ]);

      const quotes = [];
      
      // 处理V2报价
      if (v2Quote.status === 'fulfilled' && v2Quote.value.success) {
        quotes.push({
          version: 'v2',
          expectedAmount: parseFloat(v2Quote.value.expectedAmount),
          quote: v2Quote.value
        });
      }
      
      // 处理V3报价
      [v3Quote2500, v3Quote500, v3Quote10000].forEach((quote, index) => {
        if (quote.status === 'fulfilled' && quote.value.success) {
          quotes.push({
            version: 'v3',
            expectedAmount: parseFloat(quote.value.expectedAmount),
            quote: quote.value
          });
        }
      });

      if (quotes.length === 0) {
        return {
          success: false,
          error: '无法获取任何有效报价'
        };
      }

      // 选择最优价格（买入时选择最多代币，卖出时选择最多BNB）
      const bestRoute = quotes.reduce((best, current) => {
        return current.expectedAmount > best.expectedAmount ? current : best;
      });

      console.log(`💡 最优路由: ${bestRoute.version.toUpperCase()}${bestRoute.quote.fee ? ` (fee: ${bestRoute.quote.fee/10000}%)` : ''}`);
      console.log(`📊 预期获得: ${bestRoute.expectedAmount} ${isBuy ? '代币' : 'BNB'}`);
      
      // 显示所有报价比较
      quotes.forEach(q => {
        console.log(`   ${q.version.toUpperCase()}${q.quote.fee ? ` (${q.quote.fee/10000}%)` : ''}: ${q.expectedAmount}`);
      });

      return {
        success: true,
        bestRoute: bestRoute.quote,
        allQuotes: quotes,
        comparison: {
          totalQuotes: quotes.length,
          bestPrice: bestRoute.expectedAmount,
          improvement: quotes.length > 1 ? 
            ((bestRoute.expectedAmount - Math.min(...quotes.map(q => q.expectedAmount))) / Math.min(...quotes.map(q => q.expectedAmount)) * 100).toFixed(2) + '%' : 
            '0%'
        }
      };

    } catch (error) {
      console.error('价格比较失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 智能买入 - 自动选择最优价格的路由
   */
  async smartBuyOptimal(tokenAddress, bnbAmount) {
    try {
      console.log(`🧠 智能买入: ${tokenAddress}, ${bnbAmount} BNB`);
      
      // 验证和格式化BNB数量
      const bnbAmountNum = parseFloat(bnbAmount);
      if (isNaN(bnbAmountNum) || bnbAmountNum <= 0) {
        return { success: false, error: '❌ 无效的BNB数量' };
      }
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 获取最优路由
      const routeResult = await this.getBestRoute(tokenAddress, bnbAmount, true);
      if (!routeResult.success) {
        return { success: false, error: `❌ ${routeResult.error}` };
      }

      const bestRoute = routeResult.bestRoute;
      
      // 根据最优路由执行交易
      let result;
      if (bestRoute.version === 'v2') {
        console.log('🔄 使用 PancakeSwap V2 执行买入');
        result = await this.smartBuy(tokenAddress, bnbAmount);
      } else {
        console.log(`🔄 使用 PancakeSwap V3 (${bestRoute.fee/10000}%) 执行买入`);
        result = await this.smartBuyV3(tokenAddress, bnbAmount, bestRoute.fee);
      }

      // 添加路由选择信息到结果
      if (result.success) {
        result.routeOptimization = {
          selectedRoute: `${bestRoute.version.toUpperCase()}${bestRoute.fee ? ` (${bestRoute.fee/10000}%)` : ''}`,
          priceImprovement: routeResult.comparison.improvement,
          quotesCompared: routeResult.comparison.totalQuotes
        };
        result.message += ` (最优路由: ${result.routeOptimization.selectedRoute})`;
        
        console.log(`✨ 价格优化: ${routeResult.comparison.improvement} 提升`);
      }

      return result;

    } catch (error) {
      console.error('智能买入失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  /**
   * 智能卖出 - 自动选择最优价格的路由
   */
  async smartSellOptimal(tokenAddress, tokenAmount) {
    try {
      console.log(`🧠 智能卖出: ${tokenAddress}, ${tokenAmount} 代币`);
      
      // 验证和格式化代币数量
      const tokenAmountNum = parseFloat(tokenAmount);
      if (isNaN(tokenAmountNum) || tokenAmountNum <= 0) {
        return { success: false, error: '❌ 无效的代币数量' };
      }
      
      const isValid = await this.isValidTokenAddress(tokenAddress);
      if (!isValid) {
        return { success: false, error: '❌ 无效的代币地址' };
      }

      // 获取最优路由
      const routeResult = await this.getBestRoute(tokenAddress, tokenAmount, false);
      if (!routeResult.success) {
        return { success: false, error: `❌ ${routeResult.error}` };
      }

      const bestRoute = routeResult.bestRoute;
      
      // 根据最优路由执行交易
      let result;
      if (bestRoute.version === 'v2') {
        console.log('🔄 使用 PancakeSwap V2 执行卖出');
        result = await this.smartSell(tokenAddress, tokenAmount);
      } else {
        console.log(`🔄 使用 PancakeSwap V3 (${bestRoute.fee/10000}%) 执行卖出`);
        result = await this.smartSellV3(tokenAddress, tokenAmount, bestRoute.fee);
      }

      // 添加路由选择信息到结果
      if (result.success) {
        result.routeOptimization = {
          selectedRoute: `${bestRoute.version.toUpperCase()}${bestRoute.fee ? ` (${bestRoute.fee/10000}%)` : ''}`,
          priceImprovement: routeResult.comparison.improvement,
          quotesCompared: routeResult.comparison.totalQuotes
        };
        result.message += ` (最优路由: ${result.routeOptimization.selectedRoute})`;
        
        console.log(`✨ 价格优化: ${routeResult.comparison.improvement} 提升`);
      }

      return result;

    } catch (error) {
      console.error('智能卖出失败:', error);
      return { success: false, error: this.parseContractError(error) };
    }
  }

  /**
   * 获取代币的最优价格信息（用于价格查询）
   */
  async getOptimalPrice(tokenAddress, bnbAmount = 0.001, isBuy = true) {
    try {
      const routeResult = await this.getBestRoute(tokenAddress, bnbAmount, isBuy);
      if (!routeResult.success) {
        return { success: false, error: routeResult.error };
      }

      const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, this.provider);
      const symbol = await tokenContract.symbol();

      return {
        success: true,
        symbol: symbol,
        tokenAddress: tokenAddress,
        bestRoute: routeResult.bestRoute,
        priceComparison: routeResult.allQuotes.map(q => ({
          version: q.version.toUpperCase() + (q.quote.fee ? ` (${q.quote.fee/10000}%)` : ''),
          price: q.expectedAmount,
          isBest: q.quote === routeResult.bestRoute
        })),
        improvement: routeResult.comparison.improvement
      };
    } catch (error) {
      console.error('获取最优价格失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = OptimizedTradeManager;
