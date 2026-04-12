import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { getTradeBlockReason } from '../services/tradeRules';
import { useStore } from '../store/useStore';
import { MarketTicker, SignalType, TradingSignal } from '../types/trading';
import { placeTestnetMarketOrder, validateTestnetOrder } from '../services/binanceTrade';

const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'ADAUSDT',
  'XRPUSDT',
  'LTCUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'DOTUSDT',
  'LINKUSDT',
  'MATICUSDT',
  'TRXUSDT',
  'BCHUSDT',
  'SHIBUSDT',
  'PEPEUSDT',
  'ATOMUSDT',
  'NEARUSDT',
  'SUIUSDT',
  'INJUSDT',
  'APTUSDT',
];

const formatPrice = (value: number) => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  });
};

export const MarketScreen = () => {
  const {
    mode,
    easyModeEnabled,
    demoBalance,
    realBalance,
    favorites,
    riskPerTrade,
    toggleFavorite,
    openTrade,
    binanceTestnetEnabled,
    requireConfirmations,
    minAlignmentScore,
    autoPauseVolatility,
    maxAtrPercent,
    manualOverrideEnabled,
    tradeHoursEnabled,
    tradeStartHour,
    tradeEndHour,
    alertOnSignalChange,
    setRequireConfirmations,
    setManualOverrideEnabled,
    canOpenTrade,
  } = useStore((state) => state);

  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [signals, setSignals] = useState<Record<string, TradingSignal>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<TickerStreamStatus>('connecting');
  const [placingOrder, setPlacingOrder] = useState(false);
  const lastSignalRef = useRef<Record<string, { type: SignalType; at: number }>>({});

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
        const [klines15m, klines1h, klines4h] = await Promise.all([
          fetchKlines(symbol, '15m', 120),
          fetchKlines(symbol, '1h', 120),
          fetchKlines(symbol, '4h', 120),
        ]);
        const signal1h = generateSignal(symbol, klines1h, { higherTimeframe: klines4h });
        const signal15m = generateSignal(symbol, klines15m);
        const signal4h = generateSignal(symbol, klines4h);

        const timeframes = {
          '15m': {
            trend: signal15m.trend ?? 'NEUTRAL',
            score: signal15m.score,
            rsi: signal15m.metrics?.rsi ?? 50,
          },
          '1h': {
            trend: signal1h.trend ?? 'NEUTRAL',
            score: signal1h.score,
            rsi: signal1h.metrics?.rsi ?? 50,
          },
          '4h': {
            trend: signal4h.trend ?? 'NEUTRAL',
            score: signal4h.score,
            rsi: signal4h.metrics?.rsi ?? 50,
          },
        };

        const alignmentScore =
          (timeframes['15m'].trend === timeframes['1h'].trend &&
          timeframes['1h'].trend !== 'NEUTRAL'
            ? 1
            : 0) +
          (timeframes['4h'].trend === timeframes['1h'].trend &&
          timeframes['1h'].trend !== 'NEUTRAL'
            ? 1
            : 0);

        const confirmations = [...(signal1h.confirmations ?? [])];
        confirmations.push(
          `15m trend ${timeframes['15m'].trend}`,
          `4h trend ${timeframes['4h'].trend}`,
          `Alignment score ${alignmentScore}/2`
        );

        return [
          symbol,
          {
            ...signal1h,
            timeframes,
            alignmentScore,
            confirmations,
          } as TradingSignal,
        ] as const;
      })
    );
    const nextSignals = Object.fromEntries(signalRows);

    const now = Date.now();
    if (alertOnSignalChange) {
      const cooldownMs = 10 * 60 * 1000;
      for (const [symbol, signal] of Object.entries(nextSignals)) {
        if (!signal || signal.type === 'HOLD') {
          continue;
        }
        const last = lastSignalRef.current[symbol];
        if (!last || (last.type !== signal.type && now - last.at > cooldownMs)) {
          Alert.alert(
            'Signal changed',
            `${symbol.replace('USDT', '')}: ${signal.type} (${signal.confidence})`
          );
          break;
        }
      }
    }

    for (const [symbol, signal] of Object.entries(nextSignals)) {
      if (!signal) {
        continue;
      }
      const last = lastSignalRef.current[symbol];
      if (!last || last.type !== signal.type) {
        lastSignalRef.current[symbol] = { type: signal.type, at: now };
      }
    }

    setSignals(nextSignals);
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

  const visibleTickers = useMemo(() => {
    if (!easyModeEnabled) {
      return sortedTickers;
    }
    return sortedTickers.slice(0, 4);
  }, [easyModeEnabled, sortedTickers]);

  const topSuggestions = useMemo(() => {
    return Object.entries(signals)
      .map(([symbol, signal]) => ({ symbol, signal }))
      .filter(({ signal }) => signal && signal.type !== 'HOLD')
      .sort((a, b) => Math.abs(b.signal.score) - Math.abs(a.signal.score))
      .slice(0, easyModeEnabled ? 3 : 5);
  }, [easyModeEnabled, signals]);

  const heatmapItems = useMemo(() => {
    return sortedTickers.map((ticker) => {
      const signal = signals[ticker.symbol];
      const score = signal?.score ?? 0;
      const intensity = Math.min(1, Math.abs(score) / 100);
      const isBull = score >= 30;
      const isBear = score <= -30;
      const baseColor = isBull ? '#166534' : isBear ? '#7F1D1D' : '#334155';
      return {
        symbol: ticker.symbol,
        label: ticker.symbol.replace('USDT', ''),
        score,
        intensity,
        baseColor,
      };
    });
  }, [sortedTickers, signals]);

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

    const blockReason = getTradeBlockReason({
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
    });
    if (blockReason) {
      Alert.alert('Trade blocked', blockReason);
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

    const shouldSendOrder = binanceTestnetEnabled;

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
        <Text style={styles.title}>Trade</Text>
        <Text style={styles.subtitle}>
          {statusLabel}
          {asOf ? ` - Updated ${new Date(asOf).toLocaleTimeString()}` : ''}
        </Text>
      </View>

      <View style={styles.simpleModeCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.healthTitle}>Simple Mode</Text>
          <Text style={styles.simpleModeBadge}>On</Text>
        </View>
        <Text style={styles.healthMeta}>
          Demo and real use the same rules. Top suggestions stay visible here.
        </Text>
      </View>

      <View style={styles.healthCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.healthTitle}>Top Suggestions</Text>
          <Text style={styles.healthMeta}>{topSuggestions.length} ready</Text>
        </View>
        {topSuggestions.length ? (
          <View style={styles.suggestionList}>
            {topSuggestions.map(({ symbol, signal }) => (
              <View key={symbol} style={styles.suggestionRow}>
                <View style={styles.suggestionSymbolBox}>
                  <Text style={styles.suggestionSymbol}>{symbol.replace('USDT', '')}</Text>
                  <Text style={styles.suggestionMeta}>
                    {signal.grade ? `Grade ${signal.grade}` : 'Grade C'} • Score {signal.score}
                  </Text>
                </View>
                <View style={styles.suggestionPriceBox}>
                  <Text style={styles.suggestionPrice}>${formatPrice(signal.entryPrice)}</Text>
                  <Text style={styles.suggestionMeta}>
                    TP ${formatPrice(signal.takeProfit)} | SL ${formatPrice(signal.stopLoss)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.suggestionBadge,
                    signal.type === 'BUY'
                      ? styles.suggestionBadgeBuy
                      : signal.type === 'SELL'
                      ? styles.suggestionBadgeSell
                      : styles.suggestionBadgeHold,
                  ]}
                >
                  {signal.type} {signal.confidence}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.healthMeta}>Waiting for signals...</Text>
        )}
      </View>

      {!easyModeEnabled && <View style={styles.quickCard}>
        <Text style={styles.healthTitle}>Quick Controls</Text>
        <View style={styles.quickRow}>
          <Pressable
            style={[
              styles.quickToggle,
              requireConfirmations ? styles.quickOn : styles.quickOff,
            ]}
            onPress={() => setRequireConfirmations(!requireConfirmations)}
          >
            <Text style={styles.quickText}>
              Confirmations {requireConfirmations ? 'On' : 'Off'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.quickToggle,
              manualOverrideEnabled ? styles.quickOn : styles.quickOff,
            ]}
            onPress={() => setManualOverrideEnabled(!manualOverrideEnabled)}
          >
            <Text style={styles.quickText}>
              Manual Override {manualOverrideEnabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.quickHint}>
          Turn confirmations off if trades feel blocked. You can always switch back in Settings.
        </Text>
      </View>}

      {!easyModeEnabled && marketHealth ? (
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

      {!easyModeEnabled && <View style={styles.radarCard}>
        <Text style={styles.healthTitle}>Volatility Radar</Text>
        {sortedTickers
          .slice()
          .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
          .slice(0, 3)
          .map((item) => (
            <View key={item.symbol} style={styles.radarRow}>
              <Text style={styles.radarSymbol}>{item.symbol.replace('USDT', '')}</Text>
              <Text
                style={[
                  styles.radarChange,
                  item.priceChangePercent >= 0 ? styles.up : styles.down,
                ]}
              >
                {item.priceChangePercent.toFixed(2)}%
              </Text>
            </View>
          ))}
      </View>}

      {!easyModeEnabled && <View style={styles.heatmapCard}>
        <Text style={styles.healthTitle}>Watchlist Heatmap</Text>
        <View style={styles.heatmapGrid}>
          {heatmapItems.map((item) => (
            <View
              key={item.symbol}
              style={[
                styles.heatmapTile,
                {
                  backgroundColor: item.baseColor,
                  opacity: 0.55 + item.intensity * 0.45,
                },
              ]}
            >
              <Text style={styles.heatmapText}>{item.label}</Text>
              <Text style={styles.heatmapSub}>{item.score.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      </View>}

      {visibleTickers.map((ticker) => {
        const signal = signals[ticker.symbol];
        const isFav = favorites.includes(ticker.symbol);
        const isUp = ticker.priceChangePercent >= 0;
        const impact =
          Math.abs(ticker.priceChangePercent) > 6 ||
          (signal?.metrics?.atrPercent ?? 0) > 0.03
            ? 'High'
            : Math.abs(ticker.priceChangePercent) > 3
            ? 'Medium'
            : 'Low';
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
                      {signal.grade ? ` (${signal.grade})` : ''}
                    </Text>
                  </View>
                </View>

                <Text style={styles.reasonText}>{signal.reason}</Text>
                {signal.marketSummary ? (
                  <Text style={styles.summaryText}>{signal.marketSummary}</Text>
                ) : null}
                <Text style={styles.impactText}>Impact: {impact}</Text>
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
    paddingBottom: 96,
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
  quickCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickToggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  quickOn: {
    backgroundColor: '#14532D',
  },
  quickOff: {
    backgroundColor: '#7F1D1D',
  },
  quickText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  quickHint: {
    color: '#94A3B8',
    fontSize: 12,
  },
  simpleModeCard: {
    backgroundColor: '#0B1226',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  simpleModeBadge: {
    color: '#F8FAFC',
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '700',
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
  impactText: {
    color: '#FBBF24',
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
  heatmapCard: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  heatmapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heatmapTile: {
    width: '30%',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  heatmapText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  heatmapSub: {
    color: '#E2E8F0',
    fontSize: 11,
  },
  radarCard: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  radarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radarSymbol: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  radarChange: {
    fontSize: 13,
    fontWeight: '700',
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
  suggestionList: {
    gap: 10,
  },
  suggestionRow: {
    backgroundColor: '#0B1226',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionSymbolBox: {
    flex: 1,
  },
  suggestionSymbol: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  suggestionMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  suggestionPriceBox: {
    alignItems: 'flex-end',
  },
  suggestionPrice: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  suggestionBadge: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  suggestionBadgeBuy: {
    backgroundColor: '#14532D',
  },
  suggestionBadgeSell: {
    backgroundColor: '#7F1D1D',
  },
  suggestionBadgeHold: {
    backgroundColor: '#334155',
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
