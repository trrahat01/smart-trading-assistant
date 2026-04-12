export interface Env {
  AUTO_TRADE_KV: KVNamespace;
  AUTO_TRADE_TOKEN: string;
}

type TradeMode = 'TESTNET';

interface StoredConfig {
  deviceId: string;
  enabled: boolean;
  symbols: string[];
  riskPerTrade: number;
  maxTradesPerDay: number;
  dailyTradeLimit?: number;
  minAlignmentScore: number;
  requireConfirmations: boolean;
  autoPauseVolatility: boolean;
  maxAtrPercent: number;
  stopLossMultiplier?: number;
  takeProfitMultiplier?: number;
  tradeHoursEnabled?: boolean;
  tradeStartHour?: number;
  tradeEndHour?: number;
  utcOffsetMinutes?: number;
  autoGradeFilter?: 'ALL' | 'A' | 'B' | 'C';
  mode: TradeMode;
  apiKey: string;
  apiSecret: string;
}

interface StoredPosition {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  openedAt: number;
}

interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_TESTNET_API = 'https://testnet.binance.vision/api';
const CONFIG_LIST_KEY = 'auto_trade_devices';
const LOGS_KEY_PREFIX = 'logs:';
const todayKey = () => new Date().toISOString().slice(0, 10);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const authOk = (request: Request, env: Env) => {
  const auth = request.headers.get('Authorization') ?? '';
  return auth === `Bearer ${env.AUTO_TRADE_TOKEN}`;
};

const toQueryString = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

const sign = async (payload: string, secret: string) => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const calculateEMA = (prices: number[], period: number): number => {
  if (!prices.length) {
    return 0;
  }
  if (prices.length < period) {
    return prices[prices.length - 1];
  }
  const alpha = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < prices.length; i += 1) {
    ema = prices[i] * alpha + ema * (1 - alpha);
  }
  return ema;
};

const calculateRSI = (prices: number[], period = 14): number => {
  if (prices.length < period + 1) {
    return 50;
  }
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = prices[i] - prices[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i += 1) {
    const change = prices[i] - prices[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const calculateATRPercent = (klines: Kline[], period = 14): number => {
  if (klines.length < period + 1) {
    return 0.015;
  }
  const recent = klines.slice(-period);
  const sumTrueRange = recent.reduce((acc, candle, index) => {
    const prevClose = index === 0 ? candle.open : recent[index - 1].close;
    const tr = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
    return acc + tr;
  }, 0);
  const atr = sumTrueRange / period;
  const lastClose = recent[recent.length - 1].close || 1;
  return clamp(atr / lastClose, 0.006, 0.05);
};

const generateSignal = (klines: Kline[]) => {
  if (klines.length < 60) {
    return { type: 'HOLD' as const, score: 0 };
  }
  const closes = klines.map((kline) => kline.close);
  const currentPrice = closes[closes.length - 1];
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const momentum = ((currentPrice - closes[Math.max(0, closes.length - 10)]) / currentPrice) * 100;
  const atrPercent = calculateATRPercent(klines, 14);

  let score = 0;
  if (ema20 > ema50) {
    score += 35;
  } else {
    score -= 35;
  }
  if (rsi < 34) {
    score += 25;
  } else if (rsi > 68) {
    score -= 25;
  }
  if (momentum > 0.8) {
    score += 20;
  } else if (momentum < -0.8) {
    score -= 20;
  }
  score = clamp(score, -100, 100);

  let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (score >= 35) {
    type = 'BUY';
  } else if (score <= -35) {
    type = 'SELL';
  }

  return { type, score, atrPercent, currentPrice };
};

const gradeFromScore = (score: number) => {
  const absScore = Math.abs(score);
  if (absScore >= 75) {
    return 'A' as const;
  }
  if (absScore >= 55) {
    return 'B' as const;
  }
  return 'C' as const;
};

const gradeMeets = (grade: 'A' | 'B' | 'C', filter?: 'ALL' | 'A' | 'B' | 'C') => {
  if (!filter || filter === 'ALL') return true;
  if (filter === 'A') return grade === 'A';
  if (filter === 'B') return grade === 'A' || grade === 'B';
  return true;
};

const fetchKlines = async (symbol: string, interval: string, limit = 120): Promise<Kline[]> => {
  const response = await fetch(
    `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  const data = (await response.json()) as unknown[];
  if (!response.ok || !Array.isArray(data)) {
    return [];
  }
  return data
    .map((row) => {
      if (!Array.isArray(row)) {
        return null;
      }
      return {
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
      } as Kline;
    })
    .filter((row): row is Kline => row !== null);
};

const fetchTestnetPrice = async (symbol: string) => {
  const response = await fetch(`${BINANCE_TESTNET_API}/v3/ticker/price?symbol=${symbol}`);
  const data = (await response.json().catch(() => ({}))) as { price?: string };
  const price = Number(data.price ?? 0);
  return Number.isFinite(price) ? price : 0;
};

const placeTestnetMarketOrder = async (
  config: StoredConfig,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number
) => {
  const params: Record<string, string> = {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toFixed(6).replace(/\.?0+$/, ''),
    recvWindow: '5000',
    timestamp: Date.now().toString(),
  };
  const query = toQueryString(params);
  const signature = await sign(query, config.apiSecret);
  const response = await fetch(`${BINANCE_TESTNET_API}/v3/order?${query}&signature=${signature}`, {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': config.apiKey,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
};

const calculatePositionSize = (
  balance: number,
  riskPercent: number,
  entryPrice: number,
  stopLoss: number
) => {
  const riskAmount = balance * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (riskAmount <= 0 || stopDistance <= 0 || entryPrice <= 0) {
    return 0;
  }
  return riskAmount / stopDistance;
};

const fetchTestnetBalance = async (config: StoredConfig) => {
  const params = {
    recvWindow: '5000',
    timestamp: Date.now().toString(),
  };
  const query = toQueryString(params);
  const signature = await sign(query, config.apiSecret);
  const response = await fetch(`${BINANCE_TESTNET_API}/v3/account?${query}&signature=${signature}`, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': config.apiKey },
  });
  const data = (await response.json().catch(() => ({}))) as { balances?: Array<any> };
  if (!response.ok || !data.balances) {
    return 0;
  }
  const usdt = data.balances.find((item) => item.asset === 'USDT');
  const free = Number(usdt?.free ?? 0);
  return Number.isFinite(free) ? free : 0;
};

const shouldTrade = (lastType: string | null, nextType: string) => {
  if (nextType === 'HOLD') {
    return false;
  }
  if (!lastType) {
    return true;
  }
  return lastType !== nextType;
};

const shouldCloseForProfit = (position: StoredPosition, price: number) => {
  if (position.side === 'BUY') {
    if (price >= position.takeProfit) return 'TAKE_PROFIT';
    if (price <= position.stopLoss) return 'STOP_LOSS';
  } else {
    if (price <= position.takeProfit) return 'TAKE_PROFIT';
    if (price >= position.stopLoss) return 'STOP_LOSS';
  }
  return null;
};

const maybeClosePosition = async (
  config: StoredConfig,
  symbol: string,
  env: Env
): Promise<boolean> => {
  const positionKey = `position:${config.deviceId}:${symbol}`;
  const posRaw = await env.AUTO_TRADE_KV.get(positionKey);
  if (!posRaw) {
    return false;
  }
  const position = JSON.parse(posRaw) as StoredPosition;
  const price = await fetchTestnetPrice(symbol);
  if (!price) {
    return false;
  }
  const closeReason = shouldCloseForProfit(position, price);
  if (!closeReason) {
    return true;
  }

  const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
  const order = await placeTestnetMarketOrder(config, symbol, closeSide, position.quantity);
  if (order.ok) {
    await env.AUTO_TRADE_KV.delete(positionKey);
    await appendLog(
      env,
      config.deviceId,
      `Closed ${symbol} ${closeReason} at ${price.toFixed(4)}`
    );
    return true;
  }

  await appendLog(env, config.deviceId, `Close failed ${symbol} ${closeReason}`);
  return true;
};

const tradeSymbol = async (config: StoredConfig, symbol: string, env: Env) => {
  const hasPosition = await maybeClosePosition(config, symbol, env);
  if (hasPosition) {
    return;
  }

  if (config.tradeHoursEnabled) {
    const offset = Number.isFinite(config.utcOffsetMinutes) ? config.utcOffsetMinutes : 0;
    const now = new Date(Date.now() - offset * 60 * 1000);
    const hour = now.getUTCHours();
    const start = Number.isFinite(config.tradeStartHour) ? config.tradeStartHour : 0;
    const end = Number.isFinite(config.tradeEndHour) ? config.tradeEndHour : 23;
    const inWindow = start <= end ? hour >= start && hour <= end : hour >= start || hour <= end;
    if (!inWindow) {
      await appendLog(env, config.deviceId, `Skipped ${symbol} outside trading hours`);
      return;
    }
  }
  const [klines15m, klines1h, klines4h] = await Promise.all([
    fetchKlines(symbol, '15m', 120),
    fetchKlines(symbol, '1h', 120),
    fetchKlines(symbol, '4h', 120),
  ]);
  const signal = generateSignal(klines1h);
  if (signal.type === 'HOLD' || !signal.currentPrice) {
    return;
  }

  const grade = gradeFromScore(signal.score);
  if (!gradeMeets(grade, config.autoGradeFilter)) {
    await appendLog(env, config.deviceId, `Skipped ${symbol} grade ${grade}`);
    return;
  }

  const autoPause = Boolean(config.autoPauseVolatility);
  const maxAtr = Number.isFinite(config.maxAtrPercent) ? config.maxAtrPercent : 0.04;
  if (autoPause && signal.atrPercent > maxAtr) {
    await appendLog(
      env,
      config.deviceId,
      `Skipped ${symbol} high volatility ${(signal.atrPercent * 100).toFixed(2)}%`
    );
    return;
  }

  const requireConfirmations = Boolean(config.requireConfirmations);
  const minAlignmentScore = Number.isFinite(config.minAlignmentScore)
    ? Math.max(0, Math.min(2, config.minAlignmentScore))
    : 1;

  if (requireConfirmations) {
    const signal15m = generateSignal(klines15m);
    const signal4h = generateSignal(klines4h);
    const alignmentScore =
      (signal15m.type === signal.type ? 1 : 0) + (signal4h.type === signal.type ? 1 : 0);
  if (alignmentScore < minAlignmentScore) {
    await appendLog(
      env,
      config.deviceId,
      `Skipped ${symbol} alignment ${alignmentScore}/2`
    );
    return;
  }
  }

  const ht = generateSignal(klines4h);
  if (ht.type !== 'HOLD' && ht.type !== signal.type) {
    await appendLog(env, config.deviceId, `Skipped ${symbol} HTF conflict`);
    return;
  }

  const statsKey = `stats:${config.deviceId}:${todayKey()}`;
  const statsRaw = await env.AUTO_TRADE_KV.get(statsKey);
  const stats = statsRaw
    ? (JSON.parse(statsRaw) as { tradesCount: number })
    : { tradesCount: 0 };
  const maxTrades = Number.isFinite(config.maxTradesPerDay) ? config.maxTradesPerDay : 5;
  const dailyLimit = Number.isFinite(config.dailyTradeLimit)
    ? Math.max(1, Math.floor(Number(config.dailyTradeLimit)))
    : maxTrades;
  const tradeLimit = Math.min(Math.max(1, maxTrades), dailyLimit);
  if (stats.tradesCount >= tradeLimit) {
    await appendLog(env, config.deviceId, `Skipped ${symbol} max trades reached`);
    return;
  }

  const stateKey = `state:${config.deviceId}:${symbol}`;
  const lastType = await env.AUTO_TRADE_KV.get(stateKey);
  if (!shouldTrade(lastType, signal.type)) {
    await appendLog(env, config.deviceId, `Skipped ${symbol} duplicate signal`);
    return;
  }

  const stopMultiplier = Number.isFinite(config.stopLossMultiplier)
    ? Math.max(0.5, Number(config.stopLossMultiplier))
    : 1;
  const takeMultiplier = Number.isFinite(config.takeProfitMultiplier)
    ? Math.max(0.8, Number(config.takeProfitMultiplier))
    : 2.2;
  const stopDistance = signal.currentPrice * Math.max(signal.atrPercent * 1.4, 0.012) * stopMultiplier;
  const stopLoss =
    signal.type === 'BUY' ? signal.currentPrice - stopDistance : signal.currentPrice + stopDistance;
  const takeProfit =
    signal.type === 'BUY'
      ? signal.currentPrice + stopDistance * takeMultiplier
      : signal.currentPrice - stopDistance * takeMultiplier;
  const balance = await fetchTestnetBalance(config);
  const quantity = calculatePositionSize(balance, config.riskPerTrade, signal.currentPrice, stopLoss);
  if (quantity <= 0) {
    return;
  }

  const order = await placeTestnetMarketOrder(config, symbol, signal.type, quantity);
  if (order.ok) {
    await env.AUTO_TRADE_KV.put(stateKey, signal.type);
    await env.AUTO_TRADE_KV.put(
      `position:${config.deviceId}:${symbol}`,
      JSON.stringify({
        side: signal.type,
        entryPrice: signal.currentPrice,
        stopLoss,
        takeProfit,
        quantity,
        openedAt: Date.now(),
      } as StoredPosition)
    );
    await env.AUTO_TRADE_KV.put(
      statsKey,
      JSON.stringify({ tradesCount: stats.tradesCount + 1 })
    );
    await appendLog(env, config.deviceId, `Order ${signal.type} ${symbol} qty ${quantity.toFixed(4)}`);
  } else {
    await appendLog(env, config.deviceId, `Order failed ${symbol} ${signal.type}`);
  }
};

const appendLog = async (env: Env, deviceId: string, message: string) => {
  const key = `${LOGS_KEY_PREFIX}${deviceId}`;
  const existing = await env.AUTO_TRADE_KV.get(key);
  const logs = existing ? (JSON.parse(existing) as string[]) : [];
  const timestamp = new Date().toISOString();
  logs.unshift(`${timestamp} - ${message}`);
  await env.AUTO_TRADE_KV.put(key, JSON.stringify(logs.slice(0, 20)));
};

const runAutoTrade = async (env: Env) => {
  const listRaw = await env.AUTO_TRADE_KV.get(CONFIG_LIST_KEY);
  const deviceIds = listRaw ? (JSON.parse(listRaw) as string[]) : [];
  for (const deviceId of deviceIds) {
    const configRaw = await env.AUTO_TRADE_KV.get(`config:${deviceId}`);
    if (!configRaw) {
      continue;
    }
    const config = JSON.parse(configRaw) as StoredConfig;
    if (!config.enabled || config.mode !== 'TESTNET') {
      continue;
    }
    for (const symbol of config.symbols) {
      await tradeSymbol(config, symbol, env);
    }
  }
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/config') {
      if (!authOk(request, env)) {
        return json({ message: 'Unauthorized' }, 401);
      }
      const body = (await request.json().catch(() => null)) as StoredConfig | null;
      if (!body?.deviceId) {
        return json({ message: 'Invalid payload' }, 400);
      }
      await env.AUTO_TRADE_KV.put(`config:${body.deviceId}`, JSON.stringify(body));
      const listRaw = await env.AUTO_TRADE_KV.get(CONFIG_LIST_KEY);
      const devices = listRaw ? (JSON.parse(listRaw) as string[]) : [];
      if (!devices.includes(body.deviceId)) {
        devices.push(body.deviceId);
        await env.AUTO_TRADE_KV.put(CONFIG_LIST_KEY, JSON.stringify(devices));
      }
      await appendLog(env, body.deviceId, body.enabled ? 'Config enabled' : 'Config disabled');
      return json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/logs') {
      if (!authOk(request, env)) {
        return json({ message: 'Unauthorized' }, 401);
      }
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        return json({ message: 'Missing deviceId' }, 400);
      }
      const key = `${LOGS_KEY_PREFIX}${deviceId}`;
      const logsRaw = await env.AUTO_TRADE_KV.get(key);
      const logs = logsRaw ? (JSON.parse(logsRaw) as string[]) : [];
      return json({ logs });
    }

    return json({ message: 'Not found' }, 404);
  },
  async scheduled(_event: ScheduledEvent, env: Env) {
    await runAutoTrade(env);
  },
};
