require('dotenv').config();

module.exports = {
  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  
  // Blockchain
  BSC_RPC_URL: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  
  // PancakeSwap 官方路由器地址
  PANCAKESWAP_ROUTER_V2_ADDRESS: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  PANCAKESWAP_ROUTER_V3_ADDRESS: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
  WBNB_ADDRESS: process.env.WBNB_ADDRESS || '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  
  // Trading Settings
  DEFAULT_SLIPPAGE: parseInt(process.env.DEFAULT_SLIPPAGE), // 5% (in basis points) 
  DEFAULT_GAS_LIMIT: parseInt(process.env.DEFAULT_GAS_LIMIT), // 30万gas，对代币交易足够
  DEFAULT_GAS_PRICE: BigInt(process.env.DEFAULT_GAS_PRICE), // 0.1 Gwei，BSC主网当前正常水平
  MAX_TRADE_AMOUNT: parseFloat(process.env.MAX_TRADE_AMOUNT),
  DEFAULT_BUY_AMOUNT: parseFloat(process.env.DEFAULT_BUY_AMOUNT), // 默认购买0.05 BNB
  DEFAULT_SELL_PERCENTAGE: parseFloat(process.env.DEFAULT_SELL_PERCENTAGE), // 默认卖出100%
  
  // Liquidity Settings
  MIN_LIQUIDITY_RATIO: parseInt(process.env.MIN_LIQUIDITY_RATIO) || 10,
  MIN_ABSOLUTE_LIQUIDITY: parseFloat(process.env.MIN_ABSOLUTE_LIQUIDITY) || 0.1,
  LIQUIDITY_WARNING_RATIO: parseInt(process.env.LIQUIDITY_WARNING_RATIO) || 20,
  
  // Security
  ADMIN_CHAT_IDS: process.env.ADMIN_CHAT_IDS || '',
  ENABLE_TRADING: process.env.ENABLE_TRADING === 'true',
  
  // API Keys
  BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY,
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
  
  // Twitter API Keys
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  TWITTER_API_SECRET: process.env.TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET,
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,
  ENABLE_TWITTER: process.env.ENABLE_TWITTER === 'true',
  
  // Common Token Addresses
  TOKENS: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'
  }
};
