import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { QuizAttempt, Trade, TradingMode } from '../types/trading';
import { BINANCE_SPOT_FEE_RATE, calculateTradeFee } from '../services/trading';

interface OpenTradePayload {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  confidence: Trade['confidence'];
  reason: string;
}

interface TradingState {
  mode: TradingMode;
  easyModeEnabled: boolean;
  demoBalance: number;
  realBalance: number;
  riskPerTrade: number;
  favorites: string[];
  binanceTestnetEnabled: boolean;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  lossStreakLimit: number;
  cooldownMinutes: number;
  requireConfirmations: boolean;
  minAlignmentScore: number;
  autoPauseVolatility: boolean;
  maxAtrPercent: number;
  manualOverrideEnabled: boolean;
  tradeHoursEnabled: boolean;
  tradeStartHour: number;
  tradeEndHour: number;
  autoCloseOnStop: boolean;
  autoGradeFilter: 'ALL' | 'A' | 'B' | 'C';
  alertOnSignalChange: boolean;
  dailyStatsByMode: {
    DEMO: {
      date: string;
      tradesCount: number;
      pnl: number;
      lossStreak: number;
      cooldownUntil?: number;
    };
    REAL: {
      date: string;
      tradesCount: number;
      pnl: number;
      lossStreak: number;
      cooldownUntil?: number;
    };
  };
  trades: Trade[];
  completedLessons: string[];
  quizAttempts: QuizAttempt[];

  setMode: (mode: TradingMode) => void;
  setEasyModeEnabled: (value: boolean) => void;
  setRiskPerTrade: (risk: number) => void;
  toggleFavorite: (symbol: string) => void;
  setBinanceTestnetEnabled: (enabled: boolean) => void;
  setMaxDailyLossPct: (value: number) => void;
  setMaxTradesPerDay: (value: number) => void;
  setLossStreakLimit: (value: number) => void;
  setCooldownMinutes: (value: number) => void;
  setRequireConfirmations: (value: boolean) => void;
  setMinAlignmentScore: (value: number) => void;
  setAutoPauseVolatility: (value: boolean) => void;
  setMaxAtrPercent: (value: number) => void;
  setManualOverrideEnabled: (value: boolean) => void;
  setTradeHoursEnabled: (value: boolean) => void;
  setTradeStartHour: (value: number) => void;
  setTradeEndHour: (value: number) => void;
  setAutoCloseOnStop: (value: boolean) => void;
  setAutoGradeFilter: (value: 'ALL' | 'A' | 'B' | 'C') => void;
  setAlertOnSignalChange: (value: boolean) => void;
  canOpenTrade: (balance: number) => { ok: boolean; reason?: string };
  openTrade: (payload: OpenTradePayload) => void;
  closeTrade: (tradeId: string, closePrice: number) => void;
  resetDemo: () => void;
  markLessonComplete: (lessonId: string) => void;
  saveQuizAttempt: (attempt: Omit<QuizAttempt, 'id' | 'attemptedAt'>) => void;
  resetLearning: () => void;
}

const clampRisk = (risk: number) => Math.max(1, Math.min(10, Math.round(risk)));

const computeGrossPnl = (trade: Trade, closePrice: number): number => {
  if (trade.direction === 'BUY') {
    return (closePrice - trade.entryPrice) * trade.quantity;
  }
  return (trade.entryPrice - closePrice) * trade.quantity;
};

const computeNetPnl = (trade: Trade, closePrice: number): { grossPnl: number; entryFee: number; exitFee: number; feesPaid: number; pnl: number } => {
  const feeRate = trade.feeRate ?? BINANCE_SPOT_FEE_RATE;
  const grossPnl = computeGrossPnl(trade, closePrice);
  const entryFee = trade.entryFee ?? calculateTradeFee(trade.entryPrice * trade.quantity, feeRate);
  const exitFee = calculateTradeFee(closePrice * trade.quantity, feeRate);
  const feesPaid = entryFee + exitFee;
  return {
    grossPnl,
    entryFee,
    exitFee,
    feesPaid,
    pnl: grossPnl - feesPaid,
  };
};

const todayKey = () => new Date().toLocaleDateString('en-CA');

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

const defaultDailyStats = () => ({
  date: todayKey(),
  tradesCount: 0,
  pnl: 0,
  lossStreak: 0,
  cooldownUntil: undefined,
});

const defaultDailyStatsByMode = () => ({
  DEMO: defaultDailyStats(),
  REAL: defaultDailyStats(),
});
const DEMO_STARTING_BALANCE = 40;

export const useStore = create<TradingState>()(
  persist(
    (set, get) => ({
      mode: 'DEMO',
      easyModeEnabled: true,
      demoBalance: DEMO_STARTING_BALANCE,
      realBalance: 1000,
      riskPerTrade: 2,
      favorites: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      binanceTestnetEnabled: false,
      maxDailyLossPct: 4,
      maxTradesPerDay: 5,
      lossStreakLimit: 2,
      cooldownMinutes: 60,
      requireConfirmations: false,
      minAlignmentScore: 1,
      autoPauseVolatility: false,
      maxAtrPercent: 0.04,
      manualOverrideEnabled: true,
      tradeHoursEnabled: false,
      tradeStartHour: 7,
      tradeEndHour: 22,
      autoCloseOnStop: true,
      autoGradeFilter: 'ALL',
      alertOnSignalChange: true,
      dailyStatsByMode: defaultDailyStatsByMode(),
      trades: [],
      completedLessons: [],
      quizAttempts: [],

      setMode: (mode) => set({ mode }),
      setEasyModeEnabled: (value) => set({ easyModeEnabled: value }),

      setRiskPerTrade: (risk) => set({ riskPerTrade: clampRisk(risk) }),

      toggleFavorite: (symbol) =>
        set((state) => ({
          favorites: state.favorites.includes(symbol)
            ? state.favorites.filter((item) => item !== symbol)
            : [...state.favorites, symbol],
        })),

      setBinanceTestnetEnabled: (enabled) => set({ binanceTestnetEnabled: enabled }),

      setMaxDailyLossPct: (value) =>
        set({ maxDailyLossPct: clampInt(value, 1, 20) }),
      setMaxTradesPerDay: (value) =>
        set({ maxTradesPerDay: clampInt(value, 1, 20) }),
      setLossStreakLimit: (value) =>
        set({ lossStreakLimit: clampInt(value, 1, 10) }),
      setCooldownMinutes: (value) =>
        set({ cooldownMinutes: clampInt(value, 5, 240) }),
      setRequireConfirmations: (value) => set({ requireConfirmations: value }),
      setMinAlignmentScore: (value) => set({ minAlignmentScore: clampInt(value, 0, 2) }),
      setAutoPauseVolatility: (value) => set({ autoPauseVolatility: value }),
      setMaxAtrPercent: (value) =>
        set({ maxAtrPercent: Math.max(0.01, Math.min(0.08, Number(value) || 0.04)) }),
      setManualOverrideEnabled: (value) => set({ manualOverrideEnabled: value }),
      setTradeHoursEnabled: (value) => set({ tradeHoursEnabled: value }),
      setTradeStartHour: (value) => set({ tradeStartHour: clampInt(value, 0, 23) }),
      setTradeEndHour: (value) => set({ tradeEndHour: clampInt(value, 0, 23) }),
      setAutoCloseOnStop: (value) => set({ autoCloseOnStop: value }),
      setAutoGradeFilter: (value) => set({ autoGradeFilter: value }),
      setAlertOnSignalChange: (value) => set({ alertOnSignalChange: value }),

      canOpenTrade: (balance) => {
        const state = get();
        const mode = state.mode;
        let stats = state.dailyStatsByMode[mode];
        if (stats.date !== todayKey()) {
          stats = defaultDailyStats();
          set({
            dailyStatsByMode: {
              ...state.dailyStatsByMode,
              [mode]: stats,
            },
          });
        }
        const now = Date.now();
        if (stats.cooldownUntil && now < stats.cooldownUntil) {
          return { ok: false, reason: 'Cooldown active after losses. Try later.' };
        }
        if (stats.tradesCount >= state.maxTradesPerDay) {
          return { ok: false, reason: 'Daily trade limit reached.' };
        }
        const maxLoss = (balance * state.maxDailyLossPct) / 100;
        if (stats.pnl <= -Math.abs(maxLoss)) {
          return { ok: false, reason: 'Daily loss limit reached.' };
        }
        return { ok: true };
      },

      openTrade: (payload) =>
        set((state) => {
          const mode = state.mode;
          const statsForMode = state.dailyStatsByMode[mode];
          const nextStats = statsForMode.date === todayKey() ? statsForMode : defaultDailyStats();
          return {
            trades: [
              {
                id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                symbol: payload.symbol,
                direction: payload.direction,
                entryPrice: payload.entryPrice,
                quantity: payload.quantity,
                feeRate: BINANCE_SPOT_FEE_RATE,
                entryFee: calculateTradeFee(payload.entryPrice * payload.quantity),
                stopLoss: payload.stopLoss,
                takeProfit: payload.takeProfit,
                confidence: payload.confidence,
                reason: payload.reason,
                mode: state.mode,
                status: 'OPEN',
                openedAt: Date.now(),
              },
              ...state.trades,
            ],
            dailyStatsByMode: {
              ...state.dailyStatsByMode,
              [mode]: {
                ...nextStats,
                tradesCount: nextStats.tradesCount + 1,
              },
            },
          };
        }),

      closeTrade: (tradeId, closePrice) =>
        set((state) => {
          const trade = state.trades.find((item) => item.id === tradeId);
          if (!trade || trade.status === 'CLOSED') {
            return state;
          }

          const { grossPnl, entryFee, exitFee, feesPaid, pnl } = computeNetPnl(trade, closePrice);
          const mode = trade.mode;
          const statsForMode = state.dailyStatsByMode[mode];
          const nextStats = statsForMode.date === todayKey() ? statsForMode : defaultDailyStats();
          const nextLossStreak = pnl < 0 ? nextStats.lossStreak + 1 : 0;
          const cooldownUntil =
            nextLossStreak >= state.lossStreakLimit
              ? Date.now() + state.cooldownMinutes * 60 * 1000
              : nextStats.cooldownUntil;
          const updatedTrades = state.trades.map((item) =>
            item.id === tradeId
              ? {
                  ...item,
                  status: 'CLOSED' as const,
                  closePrice,
                  pnl,
                  grossPnl,
                  entryFee,
                  exitFee,
                  feesPaid,
                  closedAt: Date.now(),
                }
              : item
          );

          if (trade.mode === 'DEMO') {
            return {
              trades: updatedTrades,
              demoBalance: state.demoBalance + pnl,
              dailyStatsByMode: {
                ...state.dailyStatsByMode,
                DEMO: {
                  ...nextStats,
                  pnl: nextStats.pnl + pnl,
                  lossStreak: nextLossStreak,
                  cooldownUntil,
                },
              },
            };
          }
          return {
            trades: updatedTrades,
            realBalance: state.realBalance + pnl,
            dailyStatsByMode: {
              ...state.dailyStatsByMode,
              REAL: {
                ...nextStats,
                pnl: nextStats.pnl + pnl,
                lossStreak: nextLossStreak,
                cooldownUntil,
              },
            },
          };
        }),

      resetDemo: () =>
        set((state) => ({
          demoBalance: DEMO_STARTING_BALANCE,
          trades: state.trades.filter((trade) => trade.mode !== 'DEMO'),
          dailyStatsByMode: {
            ...state.dailyStatsByMode,
            DEMO: defaultDailyStats(),
          },
        })),

      markLessonComplete: (lessonId) =>
        set((state) => {
          if (state.completedLessons.includes(lessonId)) {
            return state;
          }
          return { completedLessons: [...state.completedLessons, lessonId] };
        }),

      saveQuizAttempt: (attempt) =>
        set((state) => ({
          quizAttempts: [
            {
              id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              lessonId: attempt.lessonId,
              score: attempt.score,
              total: attempt.total,
              attemptedAt: Date.now(),
            },
            ...state.quizAttempts,
          ],
        })),

      resetLearning: () => set({ completedLessons: [], quizAttempts: [] }),
    }),
    {
      name: 'smart-trading-assistant-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
