import type { TradingSignal } from '../types/trading';

export interface TradeRuleContext {
  balance: number;
  tradeHoursEnabled: boolean;
  tradeStartHour: number;
  tradeEndHour: number;
  requireConfirmations: boolean;
  minAlignmentScore: number;
  autoPauseVolatility: boolean;
  maxAtrPercent: number;
  manualOverrideEnabled: boolean;
  canOpenTrade: (balance: number) => { ok: boolean; reason?: string };
  signal?: TradingSignal | null;
}

export const getTradeBlockReason = (context: TradeRuleContext): string | null => {
  const {
    balance,
    tradeHoursEnabled,
    tradeStartHour,
    tradeEndHour,
    requireConfirmations,
    minAlignmentScore,
    autoPauseVolatility,
    maxAtrPercent,
    manualOverrideEnabled,
    canOpenTrade,
    signal,
  } = context;

  if (tradeHoursEnabled) {
    const hour = new Date().getHours();
    const inWindow =
      tradeStartHour <= tradeEndHour
        ? hour >= tradeStartHour && hour <= tradeEndHour
        : hour >= tradeStartHour || hour <= tradeEndHour;
    if (!inWindow) {
      return 'Outside your allowed trading hours.';
    }
  }

  const guard = canOpenTrade(balance);
  if (!guard.ok) {
    return guard.reason ?? 'Risk limits active.';
  }

  if (!signal) {
    return null;
  }

  if (requireConfirmations && !manualOverrideEnabled) {
    const alignment = signal.alignmentScore ?? 0;
    if (alignment < minAlignmentScore) {
      return 'Not enough timeframe confirmations.';
    }
    if (
      signal.higherTimeframe?.trend &&
      signal.trend &&
      signal.higherTimeframe.trend !== 'NEUTRAL' &&
      signal.higherTimeframe.trend !== signal.trend
    ) {
      return 'Higher timeframe trend conflicts.';
    }
    if (
      autoPauseVolatility &&
      signal.metrics?.atrPercent &&
      signal.metrics.atrPercent > maxAtrPercent
    ) {
      return 'Volatility is too high right now.';
    }
  }

  return null;
};
