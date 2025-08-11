# Pancake Telegram 智能交易机器人

🚀 **基于 PancakeSwap V2/V3 池子的 Telegram 智能交易机器人**

## 🌟 功能特性

- 📱 **Telegram 界面**: 通过 Telegram 聊天进行交易
- 🧠 **智能交易**: 自动选择 PancakeSwap V2/V3 最优池子和路径
- 💰 **余额管理**: 实时查看钱包余额
- 📊 **价格监控**: 获取实时代币价格（V2/V3池子）
- ⚙️ **参数设置**: 自定义滑点、Gas 等
- 🛡️ **安全控制**: 管理员权限、交易限额

## 📋 快速开始

### 1. 安装依赖

```bash
cd /home/qiyun/project/pancake-telegram-bot
npm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并填写配置：

```bash
cp .env.example .env
nano .env
```

必要配置：
```env
# Telegram Bot Token (从 @BotFather 获取)
TELEGRAM_BOT_TOKEN=your_bot_token_here

# 你的钱包私钥
PRIVATE_KEY=your_private_key_here

# 管理员 Chat ID (可以是您的 Telegram 用户 ID)
ADMIN_CHAT_IDS=123456789

# 已部署的合约地址
PANCAKE_ROUTER_CONTRACT=0x41911355B713662B662a255ca1c1670bDA91b4b2
```

### 3. 获取 Telegram Bot Token

1. 在 Telegram 中找到 @BotFather
2. 发送 `/newbot` 创建新机器人
3. 按提示设置机器人名称和用户名
4. 复制获得的 Token 到 `.env` 文件

### 4. 获取机器人信息和您的 Chat ID

#### 获取机器人信息
运行以下命令查看您的机器人详细信息：
```bash
node get-bot-info.js
```

#### 获取您的 Chat ID (重要!)
**注意**: 您需要的是您自己的 Chat ID，不是机器人的 ID！

方法一 - 使用 @userinfobot:
1. 在 Telegram 中搜索并找到 @userinfobot
2. 向它发送 `/start` 命令
3. 它会返回您的用户 ID (这就是您的 Chat ID)
4. 将这个 ID 添加到 `.env` 文件的 `ADMIN_CHAT_IDS` 中

方法二 - 通过您的机器人获取:
1. 先启动机器人: `npm start`
2. 在 Telegram 中找到您的机器人并向它发送任意消息
3. 查看终端日志，会显示发送消息的用户 Chat ID

示例 `.env` 配置：
```env
ADMIN_CHAT_IDS=123456789
```

如果有多个管理员，用逗号分隔：
```env
ADMIN_CHAT_IDS=123456789,987654321
```

### 5. 检查配置

在启动机器人之前，检查所有配置是否正确：

```bash
npm run check-config
```

### 6. 测试连接

```bash
npm run test
```

### 7. 启动机器人

```bash
npm start
```

## 🎮 使用方法

### 📱 快速访问方式

**1. Telegram 左下角快速命令 (推荐)**
- 点击聊天输入框左下角的菜单图标 (/)
- 选择需要的命令，如 `/buy`, `/sell`, `/price` 等
- 支持自动补全和命令预览

**2. 持久键盘菜单**
- 使用底部按钮快速访问功能
- 包含主菜单、快速操作、钱包余额等

**3. 内联菜单**
- 通过 `/menu` 显示交互式按钮菜单
- 点击按钮快速执行操作

### 基本命令

- `/start` - 开始使用机器人  
- `/menu` - 显示主菜单
- `/quick` - 快速操作菜单
- `/help` - 查看帮助信息

### 智能交易命令

**🚀 交互式交易（推荐）**

```
/buy
💰 无参数交互式购买 - 机器人会提示您输入代币地址，然后使用默认数量购买

/sell  
💸 无参数交互式卖出 - 机器人会提示您输入代币地址，然后自动卖出钱包中的代币

优势：
• 简单易用，只需点击左下角快速命令
• 自动使用默认设置
• 智能余额检测
• 5分钟会话超时保护
```

**📝 完整参数交易**

```
/buy <代币地址> <BNB数量>
示例: /buy 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 0.1
🧠 系统会自动分析V2和V3流动性，选择最优路径

/sell <代币地址> <代币数量>  
示例: /sell 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 100
🧠 系统会自动分析V2和V3流动性，选择最优路径

/price <代币地址>
示例: /price 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82
📊 显示V2和V3价格对比

/addtoken <代币地址>
示例: /addtoken 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
➕ 添加代币到持仓监控列表
```

### 🧠 智能交易说明

机器人的核心特性是智能选择最佳交换版本：

- **自动分析**: 同时分析V2和V3的流动性和价格
- **最优选择**: 自动选择能获得更好价格的版本
- **费率优化**: V3交易时自动选择最佳费率池
- **无需区分**: 用户无需关心V2/V3细节，系统自动处理

### 钱包命令

- `/balance` - 查看钱包余额（BNB、USDT、CAKE）
- `/holdings` - 查看代币持仓列表（基于交易记录）
- `/addtoken <代币地址>` - 添加代币到监控列表
- `/wallet` - 钱包详细信息

**📊 动态代币持仓功能特色：**
- 🎯 **基于交易记录** - 只监控您实际交易过的代币
- 💰 显示实时余额和价值
- 📈 按价值排序显示
- 💵 USD 总价值统计
- ⚡ 并行查询快速响应
- 🔄 **自动更新** - 每次买入/卖出后自动添加到监控列表
- ➕ **手动添加** - 使用 `/addtoken` 命令添加新代币监控
- 💾 **持久存储** - 交易记录保存在 `traded-tokens.json` 文件中
- 🧠 **智能初始化** - 首次运行包含主流代币（CAKE、USDT、USDC等）

### 设置命令

- `/settings` - 交易设置
- `/slippage <百分比>` - 设置滑点容忍度

## 🔧 配置说明

### 交易设置

```env
DEFAULT_SLIPPAGE=100        # 1% 滑点 (基点)
DEFAULT_GAS_LIMIT=500000    # Gas 限制
DEFAULT_GAS_PRICE=5000000000 # 5 Gwei
MAX_TRADE_AMOUNT=1.0        # 最大交易额 (BNB)
```

### 安全设置

```env
ADMIN_CHAT_IDS=123456789,987654321  # 管理员 ID (逗号分隔)
ENABLE_TRADING=true                 # 启用/禁用交易
```

## 📊 支持的代币

机器人内置了常见代币地址：

- **WBNB**: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
- **CAKE**: 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82
- **BUSD**: 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56
- **USDT**: 0x55d398326f99059fF775485246999027B3197955
- **USDC**: 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d

## 🛡️ 安全提醒

⚠️ **重要安全注意事项**：

1. **私钥安全**: 确保私钥安全，建议使用专门的交易钱包
2. **小额测试**: 首次使用时请用小额资金测试
3. **网络安全**: 在安全的网络环境中运行
4. **定期备份**: 备份重要配置和日志文件
5. **监控资金**: 定期检查钱包余额和交易记录

## 📚 重要提示

#### 🎯 代币地址 vs 交易对地址
机器人会自动验证您输入的地址：
- ✅ **代币地址**: 可以直接用于交易的 ERC20 代币合约地址
- ❌ **交易对地址**: PancakeSwap 的流动性池地址，不能直接交易

如果您输入了交易对地址，机器人会提醒您并显示该交易对包含的代币地址。

#### 🔍 如何找到正确的代币地址
1. 在 [PancakeSwap](https://pancakeswap.finance) 搜索代币
2. 在 [BSCScan](https://bscscan.com) 确认合约地址
3. 确保地址是代币合约，不是交易对合约

## 📝 开发和调试

### 开发模式

```bash
npm run dev  # 使用 nodemon 自动重启
```

### 查看日志

```bash
tail -f logs/combined.log  # 查看所有日志
tail -f logs/error.log     # 查看错误日志
```

### 交易记录

交易记录保存在 `logs/trades/` 目录下，按日期分文件存储。

## 📁 文件结构说明

### 重要文件
- `.env` - 环境配置文件（包含私钥、Token等敏感信息）
- `traded-tokens.json` - 交易记录的代币地址列表（自动生成和维护）
- `src/optimizedTradeManager.js` - 核心交易管理器
- `src/bot.js` - Telegram 机器人主要逻辑
- `logs/` - 日志文件目录

### 交易记录管理
- 📊 机器人会自动记录所有买入和卖出的代币地址
- 💾 记录保存在 `traded-tokens.json` 文件中
- 🔄 每次交易成功后自动更新列表
- 🎯 持仓查询基于此记录，只显示实际交易过的代币
- 🛡️ 文件损坏或丢失时会自动重新初始化（包含主流代币）

## 🚀 部署到生产环境

### 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start src/index.js --name pancake-bot

# 查看状态
pm2 status

# 查看日志
pm2 logs pancake-bot

# 设置开机自启
pm2 startup
pm2 save
```

## 🤝 技术支持

如果遇到问题：

1. 检查 `.env` 配置是否正确
2. 确认网络连接正常
3. 查看日志文件中的错误信息
4. 确保钱包有足够的 BNB 作为 Gas 费

## 📄 许可证

MIT License - 仅供学习和测试使用

---

🎉 **享受您的自动化交易体验！**
