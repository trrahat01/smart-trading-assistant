import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { QuizAttempt, Trade, TradingMode } from '../types/trading';

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
  demoBalance: number;
  realBalance: number;
  riskPerTrade: number;
  favorites: string[];
  binanceTestnetEnabled: boolean;
  trades: Trade[];
  completedLessons: string[];
  quizAttempts: QuizAttempt[];

  setMode: (mode: TradingMode) => void;
  setRiskPerTrade: (risk: number) => void;
  toggleFavorite: (symbol: string) => void;
  setBinanceTestnetEnabled: (enabled: boolean) => void;
  openTrade: (payload: OpenTradePayload) => void;
  closeTrade: (tradeId: string, closePrice: number) => void;
  resetDemo: () => void;
  markLessonComplete: (lessonId: string) => void;
  saveQuizAttempt: (attempt: Omit<QuizAttempt, 'id' | 'attemptedAt'>) => void;
  resetLearning: () => void;
}

const clampRisk = (risk: number) => Math.max(1, Math.min(10, Math.round(risk)));

const computePnl = (trade: Trade, closePrice: number): number => {
  if (trade.direction === 'BUY') {
    return (closePrice - trade.entryPrice) * trade.quantity;
  }
  return (trade.entryPrice - closePrice) * trade.quantity;
};

export const useStore = create<TradingState>()(
  persist(
    (set) => ({
      mode: 'DEMO',
      demoBalance: 10000,
      realBalance: 1000,
      riskPerTrade: 2,
      favorites: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      binanceTestnetEnabled: false,
      trades: [],
      completedLessons: [],
      quizAttempts: [],

      setMode: (mode) => set({ mode }),

      setRiskPerTrade: (risk) => set({ riskPerTrade: clampRisk(risk) }),

      toggleFavorite: (symbol) =>
        set((state) => ({
          favorites: state.favorites.includes(symbol)
            ? state.favorites.filter((item) => item !== symbol)
            : [...state.favorites, symbol],
        })),

      setBinanceTestnetEnabled: (enabled) => set({ binanceTestnetEnabled: enabled }),

      openTrade: (payload) =>
        set((state) => ({
          trades: [
            {
              id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              symbol: payload.symbol,
              direction: payload.direction,
              entryPrice: payload.entryPrice,
              quantity: payload.quantity,
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
        })),

      closeTrade: (tradeId, closePrice) =>
        set((state) => {
          const trade = state.trades.find((item) => item.id === tradeId);
          if (!trade || trade.status === 'CLOSED') {
            return state;
          }

          const pnl = computePnl(trade, closePrice);
          const updatedTrades = state.trades.map((item) =>
            item.id === tradeId
              ? {
                  ...item,
                  status: 'CLOSED' as const,
                  closePrice,
                  pnl,
                  closedAt: Date.now(),
                }
              : item
          );

          if (trade.mode === 'DEMO') {
            return {
              trades: updatedTrades,
              demoBalance: state.demoBalance + pnl,
            };
          }
          return {
            trades: updatedTrades,
            realBalance: state.realBalance + pnl,
          };
        }),

      resetDemo: () =>
        set((state) => ({
          demoBalance: 10000,
          trades: state.trades.filter((trade) => trade.mode !== 'DEMO'),
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
