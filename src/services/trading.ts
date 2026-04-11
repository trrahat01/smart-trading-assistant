import { Kline, Trade, TradingSignal } from '../types/trading';

export const BINANCE_SPOT_FEE_RATE = 0.001;

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
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

const confidenceFromScore = (score: number) => {
  const absScore = Math.abs(score);
  if (absScore >= 70) {
    return 'HIGH' as const;
  }
  if (absScore >= 45) {
    return 'MEDIUM' as const;
  }
  return 'LOW' as const;
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

const trendLabel = (ema20: number, ema50: number) => {
  if (ema20 > ema50 * 1.002) {
    return 'BULLISH' as const;
  }
  if (ema20 < ema50 * 0.998) {
    return 'BEARISH' as const;
  }
  return 'NEUTRAL' as const;
};

const formatPct = (value: number) => `${value.toFixed(2)}%`;

export const calculatePositionSize = (
  balance: number,
  riskPercent: number,
  entryPrice: number,
  stopLoss: number
): number => {
  const riskAmount = balance * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (riskAmount <= 0 || stopDistance <= 0 || entryPrice <= 0) {
    return 0;
  }
  return riskAmount / stopDistance;
};

export const calculateTradeFee = (notional: number, feeRate = BINANCE_SPOT_FEE_RATE): number => {
  if (!Number.isFinite(notional) || notional <= 0) {
    return 0;
  }
  return notional * feeRate;
};

export const calculateOpenPnL = (trade: Trade, currentPrice: number): number => {
  const diff =
    trade.direction === 'BUY'
      ? currentPrice - trade.entryPrice
      : trade.entryPrice - currentPrice;
  const feeRate = trade.feeRate ?? BINANCE_SPOT_FEE_RATE;
  const entryFee = trade.entryFee ?? calculateTradeFee(trade.entryPrice * trade.quantity, feeRate);
  const exitFee = calculateTradeFee(currentPrice * trade.quantity, feeRate);
  return diff * trade.quantity - entryFee - exitFee;
};

export const generateSignal = (
  symbol: string,
  klines: Kline[],
  context?: { higherTimeframe?: Kline[] }
): TradingSignal => {
  if (klines.length < 60) {
    return {
      symbol,
      type: 'HOLD',
      confidence: 'LOW',
      score: 0,
      reason: 'Not enough market history for signal quality.',
      lessonTip: 'Wait for more candles to avoid low-confidence entries.',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      riskReward: 0,
    };
  }

  const closes = klines.map((kline) => kline.close);
  const currentPrice = closes[closes.length - 1];
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const momentum =
    ((currentPrice - closes[Math.max(0, closes.length - 10)]) / currentPrice) * 100;
  const atrPercent = calculateATRPercent(klines, 14);
  const trendStrength = Math.abs(ema20 - ema50) / currentPrice;
  const trend = trendLabel(ema20, ema50);

  let score = 0;
  const reasons: string[] = [];
  const confirmations: string[] = [];

  if (ema20 > ema50) {
    score += 35;
    reasons.push('Trend is bullish (EMA20 above EMA50)');
    confirmations.push('Trend alignment (EMA20 above EMA50)');
  } else {
    score -= 35;
    reasons.push('Trend is bearish (EMA20 below EMA50)');
    confirmations.push('Trend alignment (EMA20 below EMA50)');
  }

  if (rsi < 34) {
    score += 25;
    reasons.push('RSI shows oversold conditions');
    confirmations.push(`RSI oversold (${rsi.toFixed(1)})`);
  } else if (rsi > 68) {
    score -= 25;
    reasons.push('RSI shows overbought conditions');
    confirmations.push(`RSI overbought (${rsi.toFixed(1)})`);
  } else {
    reasons.push('RSI is neutral');
    confirmations.push(`RSI neutral (${rsi.toFixed(1)})`);
  }

  if (momentum > 0.8) {
    score += 20;
    reasons.push('Short-term momentum is positive');
    confirmations.push(`Momentum +${momentum.toFixed(2)}%`);
  } else if (momentum < -0.8) {
    score -= 20;
    reasons.push('Short-term momentum is negative');
    confirmations.push(`Momentum ${momentum.toFixed(2)}%`);
  } else {
    reasons.push('Momentum is mixed');
    confirmations.push(`Momentum ${momentum.toFixed(2)}%`);
  }

  if (trendStrength > 0.01) {
    confirmations.push(`Trend strength ${formatPct(trendStrength * 100)} (strong)`);
  } else {
    confirmations.push(`Trend strength ${formatPct(trendStrength * 100)} (weak)`);
  }

  let higherTimeframe:
    | { trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; rsi: number }
    | undefined;

  if (context?.higherTimeframe && context.higherTimeframe.length >= 40) {
    const htCloses = context.higherTimeframe.map((kline) => kline.close);
    const htEma20 = calculateEMA(htCloses, 20);
    const htEma50 = calculateEMA(htCloses, 50);
    const htRsi = calculateRSI(htCloses, 14);
    const htTrend = trendLabel(htEma20, htEma50);
    higherTimeframe = { trend: htTrend, rsi: htRsi };

    if (htTrend === trend) {
      score += 10;
      confirmations.push(`HTF trend confirms (${htTrend})`);
    } else if (htTrend !== 'NEUTRAL') {
      score -= 10;
      confirmations.push(`HTF trend conflicts (${htTrend})`);
    } else {
      confirmations.push('HTF trend neutral');
    }
  }

  score = clamp(score, -100, 100);
  const confidence = confidenceFromScore(score);
  const grade = gradeFromScore(score);

  let type: TradingSignal['type'] = 'HOLD';
  if (score >= 35) {
    type = 'BUY';
  } else if (score <= -35) {
    type = 'SELL';
  }

  const stopDistance = currentPrice * Math.max(atrPercent * 1.4, 0.012);
  const takeDistance = stopDistance * 2.2;

  const stopLoss = type === 'BUY' ? currentPrice - stopDistance : currentPrice + stopDistance;
  const takeProfit =
    type === 'BUY' ? currentPrice + takeDistance : currentPrice - takeDistance;

  const lessonTip =
    type === 'HOLD'
      ? 'No edge right now. Stand aside and protect capital.'
      : 'Entry only makes sense if stop loss and position size are respected.';

  const marketSummary = `${trend} trend | RSI ${rsi.toFixed(1)} | Momentum ${momentum.toFixed(
    2
  )}% | Vol ${formatPct(atrPercent * 100)}`;

  return {
    symbol,
    type,
    confidence,
    score,
    trend,
    grade,
    reason: reasons.join(' | '),
    lessonTip,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    riskReward: takeDistance / stopDistance,
    confirmations,
    marketSummary,
    metrics: {
      rsi,
      ema20,
      ema50,
      momentum,
      atrPercent,
      trendStrength,
    },
    higherTimeframe,
  };
};
