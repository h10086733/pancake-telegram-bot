const { ethers } = require('ethers');
const config = require('./config');
const fs = require('fs');
const path = require('path');

class OptimizedTradeManager {
  constructor({ routerVersion = 'v2' } = {}) {
    console.log('🔧 初始化 OptimizedTradeManager...');
    this.provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL);
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);

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
    ];
    
    // Settings
    this.settings = {
      slippage: 10, // 10%
      gasPrice: 0.1, // 0.1 Gwei
      gasLimit: 300000
    };
    
    // File path for storing traded tokens
    this.tradedTokensFile = path.join(__dirname, '..', 'traded-tokens.json');
    this.ensureTradedTokensFile();
    
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
   * 添加代币到已交易列表
   */
  addTradedToken(tokenAddress) {
    try {
      const tokens = this.getTradedTokens();
      if (!tokens.includes(tokenAddress.toLowerCase())) {
        tokens.push(tokenAddress.toLowerCase());
        fs.writeFileSync(this.tradedTokensFile, JSON.stringify({ tokens }, null, 2));
      }
    } catch (error) {
      console.error('Error adding traded token:', error);
    }
  }

  /**
   * 移除已交易代币
   */
  removeTradedToken(tokenAddress) {
    try {
      const tokens = this.getTradedTokens();
      const idx = tokens.indexOf(tokenAddress.toLowerCase());
      if (idx !== -1) {
        tokens.splice(idx, 1);
        fs.writeFileSync(this.tradedTokensFile, JSON.stringify({ tokens }, null, 2));
      }
    } catch (error) {
      console.error('Error removing traded token:', error);
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
   * 获取钱包余额
   */
  async getWalletBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return {
        success: true,
        balance: ethers.formatEther(balance),
        address: this.wallet.address
      };
    } catch (error) {
      return { success: false, error: '获取钱包余额失败' };
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
    // 这里只是方法框架，具体参数和滑点保护可根据实际需求完善
    try {
      console.log(`🛒 V3买入: ${tokenAddress}, ${bnbAmount} BNB`);
      
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
      });
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.addTradedToken(tokenAddress);
        
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
   * 智能卖出
   */
  async smartSell(tokenAddress, tokenAmount) {
    try {
      console.log(`💸 卖出: ${tokenAddress}, ${tokenAmount}`);
      
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

  // V3卖出
  async smartSellV3(tokenAddress, tokenAmount, fee = 2500) {
    // 这里只是方法框架，具体参数和滑点保护可根据实际需求完善
    try {
      console.log(`💸 V3卖出: ${tokenAddress}, ${tokenAmount}`);
      
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
}

module.exports = OptimizedTradeManager;
