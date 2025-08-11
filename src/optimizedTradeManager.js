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
    this.defaultBuyAmount = config.DEFAULT_BUY_AMOUNT || 0.05;
    this.maxTradeAmount = config.MAX_TRADE_AMOUNT || 1.0;
    this.defaultSellPercentage = config.DEFAULT_SELL_PERCENTAGE || 100;
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
      return JSON.parse(data);
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
      
      const amountIn = ethers.parseEther(bnbAmount.toString());
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
          gasPrice: ethers.parseUnits(this.settings.gasPrice.toString(), 'gwei'),
          gasLimit: this.settings.gasLimit
        }
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.addTradedToken(tokenAddress);
        
        // 发送Twitter通知
        try {
          const priceInfo = await this.getTokenPrice(tokenAddress);
          const priceUSD = priceInfo.success ? priceInfo.priceInUSD : null;
          const tweetMessage = this.generateBuyTweet(symbol, bnbAmount, tx.hash, priceUSD);
          await this.sendTweet(tweetMessage);
        } catch (twitterError) {
          console.log('Twitter通知发送失败:', twitterError.message);
        }
        
        // 记录买入交易
        const priceInfo = await this.getTokenPrice(tokenAddress).catch(() => ({ success: false }));
        const bnbPrice = priceInfo.success ? priceInfo.priceInBNB : '0';
        this.recordBuyTrade(tokenAddress, symbol, bnbAmount, ethers.formatUnits(amounts[1], decimals), bnbPrice, receipt.gasUsed.toString(), tx.hash);
        
        return {
          success: true,
          txHash: tx.hash,
          message: `成功买入 ${symbol}`,
          details: {
            amountIn: bnbAmount,
            expectedTokens: ethers.formatUnits(amounts[1], decimals),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString()
          }
        };
      } else {
        return { success: false, error: '交易失败' };
      }
    } catch (error) {
      console.error('买入失败:', error);
      return { success: false, error: `买入失败: ${error.reason || error.message}` };
    }
  }

  // V3买入
  async smartBuyV3(tokenAddress, bnbAmount, fee = 2500) {
    try {
      console.log(`🛒 V3买入: ${tokenAddress}, ${bnbAmount} BNB`);
      
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
      
      const amountIn = ethers.parseEther(bnbAmount.toString());
      
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
      }, {
        value: amountIn,
        gasPrice: ethers.parseUnits(this.settings.gasPrice.toString(), 'gwei'),
        gasLimit: this.settings.gasLimit
      });
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.addTradedToken(tokenAddress);
        
        // 发送Twitter通知
        try {
          const priceInfo = await this.getTokenPriceV3(tokenAddress, fee);
          const priceUSD = priceInfo.success ? priceInfo.priceInUSD : null;
          const tweetMessage = this.generateBuyTweet(symbol, bnbAmount, tx.hash, priceUSD);
          await this.sendTweet(tweetMessage);
        } catch (twitterError) {
          console.log('Twitter通知发送失败:', twitterError.message);
        }
        
        // 记录买入交易
        this.recordBuyTrade(tokenAddress, symbol, bnbAmount, ethers.formatUnits(quoted, decimals), this.settings.gasPrice, receipt.gasUsed.toString(), tx.hash);
        
        return {
          success: true,
          txHash: tx.hash,
          message: `成功V3买入 ${symbol}`,
          details: {
            amountIn: bnbAmount,
            expectedTokens: ethers.formatUnits(quoted, decimals),
            slippage: this.settings.slippage,
            gasUsed: receipt.gasUsed.toString()
          }
        };
      } else {
        return { success: false, error: '交易失败' };
      }
    } catch (error) {
      console.error('V3买入失败:', error);
      return { success: false, error: `买入失败: ${error.reason || error.message}` };
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
      
      const amountIn = ethers.parseUnits(tokenAmount.toString(), decimals);
      
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
          gasPrice: ethers.parseUnits(this.settings.gasPrice.toString(), 'gwei'),
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
      return { success: false, error: `卖出失败: ${error.reason || error.message}` };
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
      
      const amountIn = ethers.parseUnits(tokenAmount.toString(), decimals);
      
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
      return { success: false, error: `卖出失败: ${error.reason || error.message}` };
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
    this.settings.gasPrice = dynamicGasPrice;
    console.log(`⚡ Gas价格已更新为: ${dynamicGasPrice.toFixed(2)} Gwei`);
    return dynamicGasPrice;
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
  getTradingHistory() {
    try {
      const data = fs.readFileSync(this.tradingHistoryFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {
        trades: [],
        summary: { totalTrades: 0, totalProfit: 0, totalLoss: 0, winRate: 0 }
      };
    }
  }

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
      
      const amountIn = ethers.parseUnits(tokenAmount.toString(), decimals);
      
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
          gasPrice: ethers.parseUnits(this.settings.gasPrice.toString(), 'gwei'),
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
      return { success: false, error: `卖出失败: ${error.reason || error.message}` };
    }
  }
}

module.exports = OptimizedTradeManager;
