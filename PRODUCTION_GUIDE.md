# 🚀 Production Deployment Guide

## Pre-Deployment Checklist

### 1. Clean Up Test Data
Run the production cleanup script to remove all test files and data:
```bash
./production-cleanup.sh
```

### 2. Environment Configuration
Review and update your `.env` file with production settings:

#### Required Settings:
- `PRIVATE_KEY`: Your wallet private key (⚠️ KEEP SECURE)
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `TELEGRAM_CHAT_ID`: Your Telegram chat ID

#### Trading Parameters:
- `DEFAULT_BUY_AMOUNT_BNB`: Default buy amount in BNB (e.g., 0.01)
- `DEFAULT_SELL_PERCENTAGE`: Default sell percentage (e.g., 100)
- `SLIPPAGE_TOLERANCE`: Slippage tolerance percentage (e.g., 1)
- `GAS_PRICE_GWEI`: Gas price in Gwei (e.g., 3)
- `GAS_LIMIT`: Gas limit (e.g., 500000)
- `MAX_GAS_PRICE_GWEI`: Maximum gas price in Gwei (e.g., 20)

#### Twitter Notifications (Optional):
- `TWITTER_ENABLED`: true/false
- `TWITTER_API_KEY`: Your Twitter API key
- `TWITTER_API_SECRET`: Your Twitter API secret
- `TWITTER_ACCESS_TOKEN`: Your Twitter access token
- `TWITTER_ACCESS_TOKEN_SECRET`: Your Twitter access token secret

### 3. Twitter Setup (Optional)
If you want Twitter notifications, follow the detailed setup guide in `TWITTER_SETUP.md`.

### 4. Security Checklist
- [ ] Private key is stored securely
- [ ] `.env` file is not committed to version control
- [ ] Bot token is valid and secure
- [ ] Wallet has sufficient BNB for gas fees
- [ ] Test with small amounts first

## Deployment Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Bot
```bash
npm start
```

### 3. Test with Small Amounts
- Start with very small BNB amounts (0.001-0.01 BNB)
- Test buy and sell operations
- Verify notifications are working
- Check trading history and profit calculations

### 4. Monitor the Bot
- Watch for errors in the console
- Check trading history with `/stats` command
- Monitor gas usage and costs
- Verify Twitter notifications (if enabled)

## Bot Commands

### Trading Commands:
- `/buy <token_address> [amount_bnb]` - Buy tokens
- `/sell <token_address> [percentage]` - Sell tokens
- `/smartbuy <token_address> [amount_bnb]` - Smart buy with V2/V3 selection
- `/smartsell <token_address> [percentage]` - Smart sell with V2/V3 selection

### Information Commands:
- `/help` - Show help message
- `/balance` - Show wallet balance
- `/holdings` - Show current token holdings
- `/stats` - Show trading statistics
- `/history` - Show recent trades

### Gas Commands:
- `/gas` - Show current gas prices
- `/setgas <price>` - Set gas price (Gwei)

## Monitoring and Maintenance

### Log Files
Check the `logs/` directory for detailed error logs and trading activity.

### Trading History
Trading data is stored in:
- `trading-history.json` - All trade records with profit calculations
- `traded-tokens.json` - Current token holdings

### Backup Strategy
Regularly backup:
- `.env` file (securely)
- `trading-history.json`
- `traded-tokens.json`

## Troubleshooting

### Common Issues:
1. **Insufficient BNB Balance**: Ensure wallet has enough BNB for gas fees
2. **High Gas Prices**: Adjust `MAX_GAS_PRICE_GWEI` if transactions fail
3. **Slippage Issues**: Increase `SLIPPAGE_TOLERANCE` for volatile tokens
4. **Network Issues**: Check BSC network status and RPC endpoints

### Emergency Stop
To stop the bot immediately:
1. Press `Ctrl+C` in the terminal
2. Remove bot token from Telegram bot settings (temporary)
3. Transfer funds to a different wallet (if compromised)

## Performance Optimization

### Gas Optimization:
- Use dynamic gas pricing (enabled by default)
- Monitor and adjust `MAX_GAS_PRICE_GWEI`
- Consider transaction timing during low network usage

### Router Selection:
- V2/V3 selection is automatic based on liquidity
- Monitor which router provides better rates
- Adjust router preference if needed

## Support and Updates

### Getting Help:
- Check error messages in console logs
- Review trading history for patterns
- Test with small amounts to isolate issues

### Updates:
- Regularly check for bot updates
- Backup data before updating
- Test new features in a development environment first

---

⚠️ **IMPORTANT SECURITY NOTES:**
- Never share your private key or bot token
- Use a dedicated wallet for trading
- Start with small amounts
- Monitor the bot regularly
- Keep backups of important data
