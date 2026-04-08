import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createTickerStream, fetchKlines, fetchTickers } from '../services/binance';
import type { TickerStreamStatus } from '../services/binance';
import { calculatePositionSize, generateSignal } from '../services/trading';
import { useStore } from '../store/useStore';
import { MarketTicker, TradingSignal } from '../types/trading';
import { placeTestnetMarketOrder, validateTestnetOrder } from '../services/binanceTrade';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT'];

const formatPrice = (value: number) => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  });
};

export const MarketScreen = () => {
  const {
    mode,
    demoBalance,
    realBalance,
    favorites,
    riskPerTrade,
    toggleFavorite,
    openTrade,
    binanceTestnetEnabled,
  } = useStore((state) => state);

  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [signals, setSignals] = useState<Record<string, TradingSignal>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<TickerStreamStatus>('connecting');
  const [placingOrder, setPlacingOrder] = useState(false);

  const balance = mode === 'DEMO' ? demoBalance : realBalance;

  const refreshTickers = async (allowFallback: boolean) => {
    const latestTickers = await fetchTickers(SYMBOLS, { allowFallback });
    if (latestTickers.length > 0) {
      setTickers(latestTickers);
      setAsOf(Date.now());
    }
  };

  const loadSignals = async () => {
    const signalRows = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        const [klines1h, klines4h] = await Promise.all([
          fetchKlines(symbol, '1h', 120),
          fetchKlines(symbol, '4h', 120),
        ]);
        return [symbol, generateSignal(symbol, klines1h, { higherTimeframe: klines4h })] as const;
      })
    );
    setSignals(Object.fromEntries(signalRows));
  };

  const loadInitial = async () => {
    setLoading(true);
    try {
      await refreshTickers(false);
      await loadSignals();
    } catch (error) {
      console.warn('Market load failed', error);
      Alert.alert('Market update failed', 'Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshTickers(false), loadSignals()]);
    } catch (error) {
      console.warn('Market refresh failed', error);
      Alert.alert('Market update failed', 'Please try again in a moment.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    let stream: ReturnType<typeof createTickerStream> | null = null;

    const start = async () => {
      await loadInitial();
      if (!active) {
        return;
      }

      stream = createTickerStream(SYMBOLS, {
        onTick: (ticker) => {
          if (!active) {
            return;
          }
          setTickers((current) => {
            const index = current.findIndex((item) => item.symbol === ticker.symbol);
            if (index === -1) {
              return [...current, ticker];
            }
            const updated = [...current];
            updated[index] = { ...updated[index], ...ticker };
            return updated;
          });
          setAsOf(Date.now());
        },
        onStatus: (status) => {
          if (!active) {
            return;
          }
          setStreamStatus(status);
        },
        onError: (error) => {
          console.warn('Live ticker stream error', error);
        },
      });
    };

    start();

    const signalTimer = setInterval(() => {
      loadSignals().catch((error) => {
        console.warn('Signal refresh failed', error);
      });
    }, 45000);

    return () => {
      active = false;
      clearInterval(signalTimer);
      stream?.close();
    };
  }, []);

  const sortedTickers = useMemo(() => {
    return [...tickers].sort((a, b) => {
      const aFav = favorites.includes(a.symbol) ? 1 : 0;
      const bFav = favorites.includes(b.symbol) ? 1 : 0;
      return bFav - aFav;
    });
  }, [tickers, favorites]);

  const marketHealth = useMemo(() => {
    const signalList = Object.values(signals);
    if (!signalList.length) {
      return null;
    }
    const scores = signalList.map((item) => item.score);
    const avgScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const buyCount = signalList.filter((item) => item.type === 'BUY').length;
    const sellCount = signalList.filter((item) => item.type === 'SELL').length;
    const holdCount = signalList.filter((item) => item.type === 'HOLD').length;
    const avgAtr =
      signalList.reduce((sum, item) => sum + (item.metrics?.atrPercent ?? 0), 0) /
      signalList.length;
    const avgTrendStrength =
      signalList.reduce((sum, item) => sum + (item.metrics?.trendStrength ?? 0), 0) /
      signalList.length;

    let label = 'Neutral';
    if (avgScore >= 40) {
      label = 'Bullish';
    } else if (avgScore <= -40) {
      label = 'Bearish';
    }

    const alerts: string[] = [];
    if (avgAtr > 0.03) {
      alerts.push('High volatility across the board');
    } else if (avgAtr < 0.012) {
      alerts.push('Low volatility (range-bound)');
    }
    if (avgTrendStrength < 0.004) {
      alerts.push('Trend strength is weak (choppy)');
    }
    if (buyCount >= sellCount + 2) {
      alerts.push('Breadth favors buyers');
    } else if (sellCount >= buyCount + 2) {
      alerts.push('Breadth favors sellers');
    }

    return {
      label,
      avgScore,
      buyCount,
      sellCount,
      holdCount,
      avgAtr,
      avgTrendStrength,
      alerts,
    };
  }, [signals]);

  const executeTrade = async (signal: TradingSignal) => {
    if (signal.type === 'HOLD') {
      Alert.alert('No trade', 'Signal is neutral. Wait for better conditions.');
      return;
    }
    const quantity = calculatePositionSize(
      balance,
      riskPerTrade,
      signal.entryPrice,
      signal.stopLoss
    );
    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Cannot open trade', 'Position size is invalid for this setup.');
      return;
    }

    const shouldSendOrder = binanceTestnetEnabled && mode === 'REAL';

    if (shouldSendOrder) {
      setPlacingOrder(true);
      try {
        const validation = await validateTestnetOrder({
          symbol: signal.symbol,
          quantity,
          price: signal.entryPrice,
        });
        if (validation.error) {
          Alert.alert('Order not allowed', validation.error);
          return;
        }
        const finalQuantity = validation.quantity;
        const order = await placeTestnetMarketOrder({
          symbol: signal.symbol,
          side: signal.type,
          quantity: finalQuantity,
        });
        openTrade({
          symbol: signal.symbol,
          direction: signal.type,
          entryPrice: signal.entryPrice,
          quantity: finalQuantity,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          reason: signal.reason,
        });
        Alert.alert(
          'Testnet order placed',
          `Order ${order.orderId ?? 'created'}\n${signal.type} ${signal.symbol}\nSize: ${finalQuantity.toFixed(
            4
          )}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Order failed.';
        Alert.alert('Testnet order failed', message);
      } finally {
        setPlacingOrder(false);
      }
      return;
    }

    openTrade({
      symbol: signal.symbol,
      direction: signal.type,
      entryPrice: signal.entryPrice,
      quantity,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      confidence: signal.confidence,
      reason: signal.reason,
    });

    Alert.alert(
      'Trade opened',
      `${signal.type} ${signal.symbol}\nSize: ${quantity.toFixed(4)}\nRisk: ${riskPerTrade}%`
    );
  };

  if (loading && tickers.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Loading market data...</Text>
      </View>
    );
  }

  const statusLabel =
    streamStatus === 'live'
      ? 'Live Binance feed'
      : streamStatus === 'reconnecting'
      ? 'Reconnecting live feed...'
      : 'Live feed offline';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          tintColor="#38BDF8"
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      }
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Market Scanner</Text>
        <Text style={styles.subtitle}>
          {statusLabel}
          {asOf ? ` - Updated ${new Date(asOf).toLocaleTimeString()}` : ''}
        </Text>
      </View>

      {marketHealth ? (
        <View style={styles.healthCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.healthTitle}>Market Health</Text>
            <Text
              style={[
                styles.healthBadge,
                marketHealth.label === 'Bullish'
                  ? styles.healthBull
                  : marketHealth.label === 'Bearish'
                  ? styles.healthBear
                  : styles.healthNeutral,
              ]}
            >
              {marketHealth.label}
            </Text>
          </View>
          <Text style={styles.healthMeta}>
            Avg score {marketHealth.avgScore.toFixed(1)} | Buys {marketHealth.buyCount} | Sells{' '}
            {marketHealth.sellCount} | Holds {marketHealth.holdCount}
          </Text>
          <Text style={styles.healthMeta}>
            Avg volatility {(marketHealth.avgAtr * 100).toFixed(2)}% | Trend strength{' '}
            {(marketHealth.avgTrendStrength * 100).toFixed(2)}%
          </Text>
          {marketHealth.alerts.length ? (
            <View style={styles.healthAlerts}>
              {marketHealth.alerts.map((alert) => (
                <Text key={alert} style={styles.healthAlertText}>
                  {alert}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {sortedTickers.map((ticker) => {
        const signal = signals[ticker.symbol];
        const isFav = favorites.includes(ticker.symbol);
        const isUp = ticker.priceChangePercent >= 0;
        const tradeSize =
          signal?.entryPrice && signal?.stopLoss
            ? calculatePositionSize(balance, riskPerTrade, signal.entryPrice, signal.stopLoss)
            : 0;

        return (
          <View key={ticker.symbol} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={styles.symbolBox}>
                <Pressable onPress={() => toggleFavorite(ticker.symbol)} style={styles.starButton}>
                  <Ionicons
                    name={isFav ? 'star' : 'star-outline'}
                    size={20}
                    color={isFav ? '#FBBF24' : '#94A3B8'}
                  />
                </Pressable>
                <View>
                  <Text style={styles.symbolText}>{ticker.symbol.replace('USDT', '')}</Text>
                  <Text style={styles.quoteText}>USDT</Text>
                </View>
              </View>

              <View style={styles.priceBox}>
                <Text style={styles.priceText}>${formatPrice(ticker.lastPrice)}</Text>
                <Text style={[styles.changeText, isUp ? styles.up : styles.down]}>
                  {isUp ? '+' : ''}
                  {ticker.priceChangePercent.toFixed(2)}%
                </Text>
              </View>
            </View>

            {signal ? (
              <View style={styles.signalBox}>
                <View style={styles.rowBetween}>
                  <Text style={styles.signalLabel}>Signal</Text>
                  <View
                    style={[
                      styles.signalBadge,
                      signal.type === 'BUY'
                        ? styles.buyBadge
                        : signal.type === 'SELL'
                        ? styles.sellBadge
                        : styles.holdBadge,
                    ]}
                  >
                    <Text style={styles.signalBadgeText}>
                      {signal.type} - {signal.confidence}
                    </Text>
                  </View>
                </View>

                <Text style={styles.reasonText}>{signal.reason}</Text>
                {signal.marketSummary ? (
                  <Text style={styles.summaryText}>{signal.marketSummary}</Text>
                ) : null}
                <Text style={styles.tipText}>Learn tip: {signal.lessonTip}</Text>

                <View style={styles.metricsRow}>
                  <Text style={styles.metricText}>Score: {signal.score}</Text>
                  <Text style={styles.metricText}>R:R {signal.riskReward.toFixed(1)}:1</Text>
                  <Text style={styles.metricText}>Size {tradeSize.toFixed(4)}</Text>
                </View>

                {signal.confirmations?.length ? (
                  <View style={styles.confirmationBox}>
                    <Text style={styles.confirmationTitle}>Confirmations</Text>
                    {signal.confirmations.slice(0, 5).map((item) => (
                      <Text key={`${ticker.symbol}-${item}`} style={styles.confirmationText}>
                        {item}
                      </Text>
                    ))}
                  </View>
                ) : null}

                <Pressable
                  onPress={() => executeTrade(signal)}
                  disabled={signal.type === 'HOLD' || placingOrder}
                  style={[
                    styles.tradeButton,
                    signal.type === 'BUY'
                      ? styles.buyButton
                      : signal.type === 'SELL'
                      ? styles.sellButton
                      : styles.disabledButton,
                    placingOrder && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.tradeButtonText}>
                    {placingOrder
                      ? 'Placing order...'
                      : signal.type === 'HOLD'
                      ? 'No Trade Setup'
                      : `Execute ${signal.type} (${riskPerTrade}% risk)`}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1020',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 30,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B1020',
  },
  loadingText: {
    marginTop: 10,
    color: '#94A3B8',
  },
  headerRow: {
    marginBottom: 8,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbolBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  symbolText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  quoteText: {
    color: '#64748B',
    fontSize: 12,
  },
  priceBox: {
    alignItems: 'flex-end',
  },
  priceText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '600',
  },
  changeText: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
  },
  up: {
    color: '#22C55E',
  },
  down: {
    color: '#F43F5E',
  },
  signalBox: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    gap: 8,
  },
  signalLabel: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 13,
  },
  signalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  buyBadge: {
    backgroundColor: '#14532D',
  },
  sellBadge: {
    backgroundColor: '#881337',
  },
  holdBadge: {
    backgroundColor: '#334155',
  },
  signalBadgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  reasonText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  summaryText: {
    color: '#93C5FD',
    fontSize: 12,
  },
  tipText: {
    color: '#7DD3FC',
    fontSize: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  confirmationBox: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  confirmationTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  confirmationText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  healthCard: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  healthTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
  },
  healthBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  healthBull: {
    backgroundColor: '#14532D',
  },
  healthBear: {
    backgroundColor: '#7F1D1D',
  },
  healthNeutral: {
    backgroundColor: '#334155',
  },
  healthMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  healthAlerts: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  healthAlertText: {
    color: '#FBBF24',
    fontSize: 12,
  },
  tradeButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buyButton: {
    backgroundColor: '#16A34A',
  },
  sellButton: {
    backgroundColor: '#E11D48',
  },
  disabledButton: {
    backgroundColor: '#475569',
  },
  tradeButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
});
