export type TradingMode = 'DEMO' | 'REAL';
export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'OPEN' | 'CLOSED';
export type SignalType = 'BUY' | 'SELL' | 'HOLD';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  volume: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface TradingSignal {
  symbol: string;
  type: SignalType;
  confidence: Confidence;
  score: number;
  trend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  grade?: 'A' | 'B' | 'C';
  reason: string;
  lessonTip: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  confirmations?: string[];
  marketSummary?: string;
  timeframes?: Record<
    string,
    { trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; score: number; rsi: number }
  >;
  alignmentScore?: number;
  metrics?: {
    rsi: number;
    ema20: number;
    ema50: number;
    momentum: number;
    atrPercent: number;
    trendStrength: number;
  };
  higherTimeframe?: {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rsi: number;
  };
}

export interface Trade {
  id: string;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  confidence: Confidence;
  reason: string;
  mode: TradingMode;
  status: TradeStatus;
  openedAt: number;
  closedAt?: number;
  closePrice?: number;
  pnl?: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  level: 'Beginner' | 'Intermediate';
  durationMinutes: number;
  summary: string;
  keyPoints: string[];
  quiz: QuizQuestion[];
}

export interface QuizAttempt {
  id: string;
  lessonId: string;
  score: number;
  total: number;
  attemptedAt: number;
}
