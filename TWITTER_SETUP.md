# Twitter 交易通知配置指南

## 📱 功能介绍

机器人现在支持在每次买入和卖出时自动发送Twitter通知，让你的交易活动更加透明和专业。

## 🔧 配置步骤

### 1. 获取Twitter API密钥

1. 访问 [Twitter Developer Portal](https://developer.twitter.com/)
2. 创建一个新的App应用
3. 生成以下密钥：
   - API Key (API_KEY)
   - API Secret Key (API_SECRET)
   - Access Token (ACCESS_TOKEN)
   - Access Token Secret (ACCESS_SECRET)
   - Bearer Token (BEARER_TOKEN)

### 2. 配置环境变量

在 `.env` 文件中添加你的Twitter API密钥：

```env
# Twitter API Keys
TWITTER_API_KEY=your_api_key_here
TWITTER_API_SECRET=your_api_secret_here
TWITTER_ACCESS_TOKEN=your_access_token_here
TWITTER_ACCESS_SECRET=your_access_secret_here
TWITTER_BEARER_TOKEN=your_bearer_token_here
ENABLE_TWITTER=true  # 设置为true启用Twitter通知
```

### 3. 重启机器人

配置完成后重启机器人，你会看到：
```
🐦 Twitter客户端初始化成功
```

## 📝 Tweet消息示例

### 买入通知
```
🚀 机器人买入提醒

🔥 代币: $CAKE
💎 数量: 0.1 BNB
💰 价格: $2.50
🔗 交易: https://bscscan.com/tx/0x1234...abcd

#DeFi #PancakeSwap #BSC #CAKE #TradingBot
```

### 卖出通知
```
💸 机器人卖出提醒

📤 代币: $CAKE
💰 数量: 100 代币
💎 获得: 0.095 BNB
💰 价格: $2.45
🔗 交易: https://bscscan.com/tx/0x5678...efgh

#DeFi #PancakeSwap #BSC #CAKE #TradingBot
```

## ⚠️ 注意事项

1. **API限制**: Twitter API有速率限制，请合理使用
2. **隐私考虑**: 交易通知会公开发布，请考虑隐私影响
3. **网络错误**: 如果Twitter发送失败，不会影响交易本身
4. **可选功能**: 可以随时通过设置 `ENABLE_TWITTER=false` 关闭

## 🛡️ 安全建议

- 使用专门的Twitter账户用于交易通知
- 定期检查和轮换API密钥
- 不要在推文中包含过多敏感信息
- 考虑使用Twitter的私有账户功能

## 🔧 故障排除

如果遇到问题：

1. **初始化失败**: 检查API密钥是否正确
2. **发送失败**: 检查网络连接和API限制
3. **权限错误**: 确保Twitter App有发推权限

启用后，每次交易成功都会自动发送Twitter通知！
