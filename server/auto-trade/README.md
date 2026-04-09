# Auto Trade Worker (Free, Testnet)

This Cloudflare Worker runs on a schedule and places **Binance testnet** orders based on the same signal logic used in the app.

## Setup (Free Tier)

1. Install Wrangler:
```bash
npm install -g wrangler
```

2. Login:
```bash
wrangler login
```

3. Create a KV namespace:
```bash
wrangler kv namespace create AUTO_TRADE_KV
```

Copy the returned `id` into `wrangler.toml`.

4. Set a server token (used by the app):
```bash
wrangler secret put AUTO_TRADE_TOKEN
```

5. Deploy:
```bash
wrangler deploy
```

The deploy output prints a URL like `https://smart-trading-auto-trade.YOUR_ACCOUNT.workers.dev`.

## App Configuration

In the app Settings:
- Paste the Worker URL into **Server URL**
- Paste the secret into **Server Token**
- Enable **Auto Trade**

## Notes
- This worker only supports **TESTNET** trading for safety.
- It trades only when trend aligns on 1h and 4h.
- It will skip trades if the signal type hasn’t changed since the last run.
- It respects max trades per day and alignment score settings from the app.
- It logs decisions and orders; fetch logs from the app or via GET /logs.
- It can filter trades by signal grade (A/B/C) from the app settings.
