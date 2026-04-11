import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { createTickerStream, fetchKlines, fetchTickers } from '../services/binance';
import { getBinanceKeys } from '../services/binanceKeys';
import { pushAutoTradeConfig, loadAutoTradeSettings } from '../services/autoTrade';
import { calculatePositionSize, generateSignal } from '../services/trading';
import { useStore } from '../store/useStore';
import { TradingSignal } from '../types/trading';

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
const MAX_POINTS = 48;
type EasyPreset = 'SAFE' | 'BALANCED' | 'FAST';

const EASY_PRESET_CONFIG: Record<EasyPreset, { stopPct: number; takePct: number }> = {
  SAFE: { stopPct: 0.01, takePct: 0.015 },
  BALANCED: { stopPct: 0.015, takePct: 0.03 },
  FAST: { stopPct: 0.02, takePct: 0.05 },
};

const formatPrice = (value: number) => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  });
};

export const LiveScreen = () => {
  const {
    mode,
    easyModeEnabled,
    demoBalance,
    realBalance,
    riskPerTrade,
    openTrade,
    maxTradesPerDay,
    minAlignmentScore,
    requireConfirmations,
    tradeHoursEnabled,
    tradeStartHour,
    tradeEndHour,
    autoPauseVolatility,
    maxAtrPercent,
    favorites,
    autoGradeFilter,
    canOpenTrade,
  } = useStore((state) => state);

  const balance = mode === 'DEMO' ? demoBalance : realBalance;
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [price, setPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [signal, setSignal] = useState<TradingSignal | null>(null);
  const [loadingSignal, setLoadingSignal] = useState(false);
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [alertMode, setAlertMode] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [alertPrice, setAlertPrice] = useState('');
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [useWatchlist, setUseWatchlist] = useState(true);
  const [chartWidth, setChartWidth] = useState(320);
  const [gradeFilter, setGradeFilter] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');
  const [topMovers, setTopMovers] = useState<
    Array<{ symbol: string; change: number; lastPrice: number }>
  >([]);
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line');
  const [candles, setCandles] = useState<
    Array<{ open: number; high: number; low: number; close: number }>
  >([]);
  const [moverAlertEnabled, setMoverAlertEnabled] = useState(false);
  const [moverThreshold, setMoverThreshold] = useState('5');
  const lastMoverAlertAtRef = useRef(0);
  const [minRR, setMinRR] = useState(1.2);
  const liteMode = easyModeEnabled;
  const [easyDirection, setEasyDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [easyAmountUsd, setEasyAmountUsd] = useState('10');
  const [easyPreset, setEasyPreset] = useState<EasyPreset>('BALANCED');
  const [opportunities, setOpportunities] = useState<
    Array<{
      symbol: string;
      type: 'BUY' | 'SELL';
      grade?: string;
      score: number;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      rr: number;
    }>
  >([]);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoServerUrl, setAutoServerUrl] = useState('');
  const [autoToken, setAutoToken] = useState('');
  const [autoDeviceId, setAutoDeviceId] = useState('');

  useEffect(() => {
    let active = true;
    loadAutoTradeSettings().then((settings) => {
      if (!active) return;
      setAutoServerUrl(settings.serverUrl);
      setAutoToken(settings.token);
      setAutoDeviceId(settings.deviceId);
      setAutoEnabled(settings.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const stream = createTickerStream([symbol], {
      onTick: (ticker) => {
        if (!active) return;
        setPrice(ticker.lastPrice);
        setHistory((prev) => {
          const next = [...prev, ticker.lastPrice];
          if (next.length > MAX_POINTS) {
            next.shift();
          }
          return next;
        });
        if (alertEnabled && alertPrice) {
          const target = Number(alertPrice);
          if (Number.isFinite(target)) {
            const hit =
              alertMode === 'ABOVE' ? ticker.lastPrice >= target : ticker.lastPrice <= target;
            if (hit) {
              Alert.alert(
                'Price Alert',
                `${symbol.replace('USDT', '')} hit ${formatPrice(ticker.lastPrice)}`
              );
              setAlertEnabled(false);
            }
          }
        }
      },
    });
    return () => {
      active = false;
      stream.close();
    };
  }, [symbol]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingSignal(true);
      try {
        const [klines15m, klines1h, klines4h] = await Promise.all([
          fetchKlines(symbol, '15m', 80),
          fetchKlines(symbol, '1h', 120),
          fetchKlines(symbol, '4h', 120),
        ]);
        const next = generateSignal(symbol, klines1h, { higherTimeframe: klines4h });
        if (active) {
          setSignal(next);
          setCandles(
            klines15m.slice(-40).map((k) => ({
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            }))
          );
        }
      } catch (error) {
        console.warn('Live signal fetch failed', error);
      } finally {
        if (active) {
          setLoadingSignal(false);
        }
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [symbol]);

  useEffect(() => {
    let active = true;
    const loadMovers = async () => {
      try {
        const rows = await fetchTickers(SYMBOLS, { allowFallback: true });
        if (!active) return;
        const movers = rows
          .map((row) => ({
            symbol: row.symbol,
            change: row.priceChangePercent,
            lastPrice: row.lastPrice,
          }))
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
          .slice(0, 5);
        setTopMovers(movers);

        if (moverAlertEnabled) {
          const threshold = Number(moverThreshold);
          const now = Date.now();
          const cooldownMs = 5 * 60 * 1000;
          if (Number.isFinite(threshold) && now - lastMoverAlertAtRef.current > cooldownMs) {
            const hit = movers.find((item) => Math.abs(item.change) >= threshold);
            if (hit) {
              Alert.alert(
                'Mover Alert',
                `${hit.symbol.replace('USDT', '')} moved ${hit.change.toFixed(2)}%`
              );
              lastMoverAlertAtRef.current = now;
            }
          }
        }
      } catch (error) {
        console.warn('Top movers load failed', error);
      }
    };
    loadMovers();
    const timer = setInterval(loadMovers, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadOpportunities = async () => {
      try {
        const rows = await Promise.all(
          SYMBOLS.map(async (item) => {
            const klines1h = await fetchKlines(item, '1h', 120);
            const next = generateSignal(item, klines1h);
            if (next.type === 'HOLD') {
              return null;
            }
            const risk = Math.abs(next.entryPrice - next.stopLoss);
            const reward = Math.abs(next.takeProfit - next.entryPrice);
            const rr = risk > 0 ? reward / risk : 0;
            return {
              symbol: item,
              type: next.type,
              grade: next.grade,
              score: next.score,
              entryPrice: next.entryPrice,
              stopLoss: next.stopLoss,
              takeProfit: next.takeProfit,
              rr,
            };
          })
        );
        const filtered = rows.filter(Boolean) as Array<{
          symbol: string;
          type: 'BUY' | 'SELL';
          grade?: string;
          score: number;
          entryPrice: number;
          stopLoss: number;
          takeProfit: number;
          rr: number;
        }>;
        const graded = filtered.filter((item) => {
          if (gradeFilter === 'ALL') return true;
          return item.grade === gradeFilter;
        });
        const withRR = graded.filter((item) => item.rr >= minRR);
        const ranked = withRR
          .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          .slice(0, 5);
        if (active) {
          setOpportunities(ranked);
        }
      } catch (error) {
        console.warn('Opportunities load failed', error);
      }
    };
    loadOpportunities();
    const timer = setInterval(loadOpportunities, 120000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gradeFilter, minRR]);

  const chartPoints = useMemo(() => {
    if (history.length < 2) return '';
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;
    return history
      .map((value, index) => {
        const x = (index / (history.length - 1)) * chartWidth;
        const y = 120 - ((value - min) / range) * 110 - 5;
        return `${x},${y}`;
      })
      .join(' ');
  }, [history, chartWidth]);

  const candleShapes = useMemo(() => {
    if (!candles.length) return [];
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const range = max - min || 1;
    const candleWidth = Math.max(4, chartWidth / candles.length - 2);
    return candles.map((candle, index) => {
      const x = index * (candleWidth + 2);
      const highY = 120 - ((candle.high - min) / range) * 110 - 5;
      const lowY = 120 - ((candle.low - min) / range) * 110 - 5;
      const openY = 120 - ((candle.open - min) / range) * 110 - 5;
      const closeY = 120 - ((candle.close - min) / range) * 110 - 5;
      const bullish = candle.close >= candle.open;
      const color = bullish ? '#22C55E' : '#F43F5E';
      return {
        key: `${candle.open}-${index}`,
        x,
        highY,
        lowY,
        openY,
        closeY,
        color,
        width: candleWidth,
      };
    });
  }, [candles, chartWidth]);

  const applySuggestion = () => {
    if (!signal) return;
    if (gradeFilter !== 'ALL' && signal.grade && signal.grade !== gradeFilter) {
      Alert.alert('Filtered', `Current signal grade is ${signal.grade}.`);
      return;
    }
    setDirection(signal.type === 'SELL' ? 'SELL' : 'BUY');
    setEntryPrice(signal.entryPrice.toFixed(2));
    setStopLoss(signal.stopLoss.toFixed(2));
    setTakeProfit(signal.takeProfit.toFixed(2));
  };

  const applyFromMarket = () => {
    if (!price) {
      Alert.alert('Price unavailable', 'Wait for a live price first.');
      return;
    }
    setEntryPrice(price.toFixed(2));
  };

  const applyPercentSetup = (stopPct: number, takePct: number) => {
    const base = Number(entryPrice);
    const entry = Number.isFinite(base) && base > 0 ? base : price ?? 0;
    if (!entry) {
      Alert.alert('Missing price', 'Set an entry or wait for a live price.');
      return;
    }
    const stop =
      direction === 'BUY' ? entry * (1 - stopPct) : entry * (1 + stopPct);
    const take =
      direction === 'BUY' ? entry * (1 + takePct) : entry * (1 - takePct);
    setEntryPrice(entry.toFixed(2));
    setStopLoss(stop.toFixed(2));
    setTakeProfit(take.toFixed(2));
  };

  const applyTakeProfitRR = (rrTarget: number) => {
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
      Alert.alert('Missing entry or stop', 'Set entry and stop loss first.');
      return;
    }
    const risk =
      direction === 'BUY' ? entry - stop : stop - entry;
    if (risk <= 0) {
      Alert.alert('Invalid stop', 'Stop loss must be on the risk side.');
      return;
    }
    const take =
      direction === 'BUY' ? entry + risk * rrTarget : entry - risk * rrTarget;
    setTakeProfit(take.toFixed(2));
  };

  const riskReward = useMemo(() => {
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    const take = Number(takeProfit);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(take)) {
      return null;
    }
    const risk =
      direction === 'BUY' ? entry - stop : stop - entry;
    const reward =
      direction === 'BUY' ? take - entry : entry - take;
    if (risk <= 0 || reward <= 0) {
      return null;
    }
    return reward / risk;
  }, [direction, entryPrice, stopLoss, takeProfit]);

  const executeManual = () => {
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    const take = Number(takeProfit);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(take)) {
      Alert.alert('Invalid input', 'Enter valid entry, stop loss, and take profit.');
      return;
    }
    const quantity = calculatePositionSize(balance, riskPerTrade, entry, stop);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Cannot open trade', 'Position size is invalid for this setup.');
      return;
    }
    openTrade({
      symbol,
      direction,
      entryPrice: entry,
      quantity,
      stopLoss: stop,
      takeProfit: take,
      confidence: signal?.confidence ?? 'LOW',
      reason: 'Manual trade',
    });
    Alert.alert(
      'Manual trade opened',
      `${direction} ${symbol}\nSize: ${quantity.toFixed(4)}\nRisk: ${riskPerTrade}%`
    );
  };

  const executeEasyTrade = () => {
    if (!price) {
      Alert.alert('Price unavailable', 'Wait for live price before opening a quick trade.');
      return;
    }
    const amountUsd = Number(easyAmountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid USD amount.');
      return;
    }
    const guard = canOpenTrade(balance);
    if (!guard.ok) {
      Alert.alert('Trade blocked', guard.reason ?? 'Risk limits active.');
      return;
    }

    const config = EASY_PRESET_CONFIG[easyPreset];
    const entry = price;
    const stopLoss =
      easyDirection === 'BUY'
        ? entry * (1 - config.stopPct)
        : entry * (1 + config.stopPct);
    const takeProfit =
      easyDirection === 'BUY'
        ? entry * (1 + config.takePct)
        : entry * (1 - config.takePct);
    const quantity = amountUsd / entry;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Cannot open trade', 'Quantity is invalid for this setup.');
      return;
    }

    openTrade({
      symbol,
      direction: easyDirection,
      entryPrice: entry,
      quantity,
      stopLoss,
      takeProfit,
      confidence: signal?.confidence ?? 'MEDIUM',
      reason: `Easy quick trade (${easyPreset})`,
    });

    setDirection(easyDirection);
    setEntryPrice(entry.toFixed(2));
    setStopLoss(stopLoss.toFixed(2));
    setTakeProfit(takeProfit.toFixed(2));

    Alert.alert(
      'Easy trade opened',
      `${easyDirection} ${symbol}\n$${amountUsd.toFixed(2)}\nPreset: ${easyPreset}`
    );
  };

  const toggleAutoTrade = async (enabled: boolean) => {
    if (!autoServerUrl || !autoToken) {
      Alert.alert('Missing server info', 'Set Auto Trade server URL and token in Settings.');
      return;
    }
    setAutoSyncing(true);
    try {
      const keys = await getBinanceKeys();
      if (!keys?.apiKey || !keys?.apiSecret) {
        Alert.alert('Missing keys', 'Save your testnet keys first.');
        return;
      }
      const symbols = useWatchlist && favorites.length ? favorites : [symbol];
      await pushAutoTradeConfig(
        {
          serverUrl: autoServerUrl,
          token: autoToken,
          deviceId: autoDeviceId,
          enabled,
        },
        {
          enabled,
          symbols,
          riskPerTrade,
          maxTradesPerDay,
          minAlignmentScore,
          requireConfirmations,
          autoPauseVolatility,
          maxAtrPercent,
          tradeHoursEnabled,
          tradeStartHour,
          tradeEndHour,
          utcOffsetMinutes: new Date().getTimezoneOffset(),
          autoGradeFilter,
          mode: 'TESTNET',
          apiKey: keys.apiKey,
          apiSecret: keys.apiSecret,
        }
      );
      setAutoEnabled(enabled);
      Alert.alert('Auto trade updated', enabled ? 'Auto trade is ON.' : 'Auto trade is OFF.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto trade sync failed.';
      Alert.alert('Auto trade failed', message);
    } finally {
      setAutoSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Live Market</Text>

      <View style={styles.symbolRow}>
        {SYMBOLS.map((item) => (
          <Pressable
            key={item}
            onPress={() => setSymbol(item)}
            style={[styles.symbolChip, symbol === item ? styles.symbolChipActive : null]}
          >
            <Text style={styles.symbolChipText}>{item.replace('USDT', '')}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.manualCard}>
        <Text style={styles.sectionTitle}>One-Tap Easy Trade</Text>
        <Text style={styles.helperText}>
          Works in {mode} mode. Demo uses the same trade flow as real, just with a $40 bankroll.
        </Text>
        <View style={styles.directionRow}>
          <Pressable
            style={[styles.directionButton, easyDirection === 'BUY' && styles.buyButton]}
            onPress={() => setEasyDirection('BUY')}
          >
            <Text style={styles.directionText}>BUY</Text>
          </Pressable>
          <Pressable
            style={[styles.directionButton, easyDirection === 'SELL' && styles.sellButton]}
            onPress={() => setEasyDirection('SELL')}
          >
            <Text style={styles.directionText}>SELL</Text>
          </Pressable>
        </View>
        <TextInput
          value={easyAmountUsd}
          onChangeText={setEasyAmountUsd}
          placeholder="USD amount (ex: 10)"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          style={styles.input}
        />
        <View style={styles.quickRow}>
          {(['SAFE', 'BALANCED', 'FAST'] as const).map((preset) => (
            <Pressable
              key={preset}
              style={[styles.filterButton, easyPreset === preset && styles.filterButtonActive]}
              onPress={() => setEasyPreset(preset)}
            >
              <Text style={styles.filterButtonText}>{preset}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.helperText}>
          {easyPreset} preset: SL {(EASY_PRESET_CONFIG[easyPreset].stopPct * 100).toFixed(1)}% | TP{' '}
          {(EASY_PRESET_CONFIG[easyPreset].takePct * 100).toFixed(1)}%
        </Text>
        <Pressable style={styles.applyButton} onPress={executeEasyTrade}>
          <Text style={styles.applyButtonText}>Open Easy Trade</Text>
        </Pressable>
      </View>

      <View style={styles.priceCard}>
        <Text style={styles.priceLabel}>{symbol.replace('USDT', '')} / USDT</Text>
        <Text style={styles.priceValue}>{price ? `$${formatPrice(price)}` : '--'}</Text>
        <View style={styles.directionRow}>
          <Pressable
            style={[styles.directionButton, chartMode === 'line' && styles.buyButton]}
            onPress={() => setChartMode('line')}
          >
            <Text style={styles.directionText}>Line</Text>
          </Pressable>
          <Pressable
            style={[styles.directionButton, chartMode === 'candles' && styles.buyButton]}
            onPress={() => setChartMode('candles')}
          >
            <Text style={styles.directionText}>Candles</Text>
          </Pressable>
        </View>
        <View
          style={styles.chartBox}
          onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        >
          <Svg width="100%" height="120">
            {chartMode === 'line' ? (
              <Polyline
                points={chartPoints}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="3"
              />
            ) : (
              candleShapes.map((candle) => (
                <React.Fragment key={candle.key}>
                  <Line
                    x1={candle.x + candle.width / 2}
                    y1={candle.highY}
                    x2={candle.x + candle.width / 2}
                    y2={candle.lowY}
                    stroke={candle.color}
                    strokeWidth="2"
                  />
                  <Rect
                    x={candle.x}
                    y={Math.min(candle.openY, candle.closeY)}
                    width={candle.width}
                    height={Math.max(2, Math.abs(candle.closeY - candle.openY))}
                    fill={candle.color}
                  />
                </React.Fragment>
              ))
            )}
          </Svg>
        </View>
      </View>

      <View style={styles.signalCard}>
        <Text style={styles.sectionTitle}>Lite Mode</Text>
        <Text style={styles.helperText}>
          {liteMode
            ? 'ON from Settings. Advanced sections are hidden.'
            : 'OFF from Settings. Advanced sections are visible.'}
        </Text>
      </View>

      {!liteMode && (
        <View style={styles.signalCard}>
        <Text style={styles.sectionTitle}>Top Movers</Text>
        <View style={styles.directionRow}>
          <Pressable
            style={[styles.directionButton, moverAlertEnabled && styles.buyButton]}
            onPress={() => setMoverAlertEnabled(!moverAlertEnabled)}
          >
            <Text style={styles.directionText}>
              {moverAlertEnabled ? 'Mover Alerts On' : 'Mover Alerts Off'}
            </Text>
          </Pressable>
          <TextInput
            value={moverThreshold}
            onChangeText={setMoverThreshold}
            placeholder="%"
            placeholderTextColor="#64748B"
            keyboardType="numeric"
            style={styles.moverInput}
          />
        </View>
        {topMovers.length === 0 ? (
          <Text style={styles.helperText}>Loading movers...</Text>
        ) : (
          topMovers.map((mover) => (
            <Pressable
              key={mover.symbol}
              style={styles.moverRow}
              onPress={() => setSymbol(mover.symbol)}
            >
              <Text style={styles.moverSymbol}>{mover.symbol.replace('USDT', '')}</Text>
              <Text style={styles.moverPrice}>${formatPrice(mover.lastPrice)}</Text>
              <Text
                style={[
                  styles.moverChange,
                  mover.change >= 0 ? styles.buyButton : styles.sellButton,
                ]}
              >
                {mover.change >= 0 ? '+' : ''}
                {mover.change.toFixed(2)}%
              </Text>
            </Pressable>
          ))
        )}
        <Text style={styles.helperText}>Tap a mover to load it in chart and trade panel.</Text>
        </View>
      )}

      <View style={styles.signalCard}>
        <Text style={styles.sectionTitle}>Best Setups (Easy)</Text>
        <Text style={styles.helperText}>Only show setups with profit ratio.</Text>
        <View style={styles.quickRow}>
          {[1, 1.2, 1.5, 2].map((value) => (
            <Pressable
              key={value}
              style={[
                styles.filterButton,
                minRR === value && styles.filterButtonActive,
              ]}
              onPress={() => setMinRR(value)}
            >
              <Text style={styles.filterButtonText}>{value}x</Text>
            </Pressable>
          ))}
        </View>
        {opportunities.length === 0 ? (
          <Text style={styles.helperText}>Scanning for strong setups...</Text>
        ) : (
          opportunities.map((item) => (
            <Pressable
              key={item.symbol}
              style={styles.opportunityRow}
              onPress={() => {
                setSymbol(item.symbol);
                if (item.type) {
                  setDirection(item.type);
                }
                setEntryPrice(item.entryPrice.toFixed(2));
                setStopLoss(item.stopLoss.toFixed(2));
                setTakeProfit(item.takeProfit.toFixed(2));
              }}
            >
              <View>
                <Text style={styles.opportunitySymbol}>
                  {item.symbol.replace('USDT', '')} {item.grade ? `(${item.grade})` : ''}
                </Text>
                <Text style={styles.helperText}>
                  {item.type} | R/R 1:{item.rr.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.opportunityScore}>{item.score.toFixed(0)}</Text>
            </Pressable>
          ))
        )}
        <Text style={styles.helperText}>Tap a setup to auto-fill manual trade.</Text>
      </View>

      {!liteMode && (
        <View style={styles.signalCard}>
        <Text style={styles.sectionTitle}>Trade Suggestion</Text>
        <View style={styles.directionRow}>
          {(['ALL', 'A', 'B', 'C'] as const).map((grade) => (
            <Pressable
              key={grade}
              style={[
                styles.directionButton,
                gradeFilter === grade && styles.buyButton,
              ]}
              onPress={() => setGradeFilter(grade)}
            >
              <Text style={styles.directionText}>Grade {grade}</Text>
            </Pressable>
          ))}
        </View>
        {loadingSignal ? (
          <Text style={styles.helperText}>Loading signal...</Text>
        ) : signal ? (
          <>
            <Text style={styles.signalType}>
              {signal.type} - {signal.confidence}
              {signal.grade ? ` (${signal.grade})` : ''}
            </Text>
            <Text style={styles.helperText}>{signal.marketSummary}</Text>
            <Text style={styles.helperText}>Suggested entry: ${signal.entryPrice.toFixed(2)}</Text>
            <Text style={styles.helperText}>Stop loss: ${signal.stopLoss.toFixed(2)}</Text>
            <Text style={styles.helperText}>Take profit: ${signal.takeProfit.toFixed(2)}</Text>
            <Pressable style={styles.applyButton} onPress={applySuggestion}>
              <Text style={styles.applyButtonText}>Use Suggestion</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.helperText}>No signal yet.</Text>
        )}
        </View>
      )}

      {!liteMode && (
        <View style={styles.manualCard}>
        <Text style={styles.sectionTitle}>Manual Trade</Text>
        <View style={styles.directionRow}>
          <Pressable
            style={[styles.directionButton, direction === 'BUY' && styles.buyButton]}
            onPress={() => setDirection('BUY')}
          >
            <Text style={styles.directionText}>BUY</Text>
          </Pressable>
          <Pressable
            style={[styles.directionButton, direction === 'SELL' && styles.sellButton]}
            onPress={() => setDirection('SELL')}
          >
            <Text style={styles.directionText}>SELL</Text>
          </Pressable>
        </View>
        <Text style={styles.helperText}>Quick setup</Text>
        <View style={styles.quickRow}>
          <Pressable style={styles.quickButton} onPress={applyFromMarket}>
            <Text style={styles.quickButtonText}>Use Market</Text>
          </Pressable>
          <Pressable
            style={styles.quickButton}
            onPress={() => applyPercentSetup(0.01, 0.02)}
          >
            <Text style={styles.quickButtonText}>1% / 2%</Text>
          </Pressable>
          <Pressable
            style={styles.quickButton}
            onPress={() => applyPercentSetup(0.02, 0.04)}
          >
            <Text style={styles.quickButtonText}>2% / 4%</Text>
          </Pressable>
          <Pressable
            style={styles.quickButton}
            onPress={() => applyPercentSetup(0.03, 0.06)}
          >
            <Text style={styles.quickButtonText}>3% / 6%</Text>
          </Pressable>
        </View>
        <Text style={styles.helperText}>Profit target (uses stop loss)</Text>
        <View style={styles.quickRow}>
          <Pressable style={styles.quickButton} onPress={() => applyTakeProfitRR(1.5)}>
            <Text style={styles.quickButtonText}>TP 1.5x</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => applyTakeProfitRR(2)}>
            <Text style={styles.quickButtonText}>TP 2x</Text>
          </Pressable>
          <Pressable style={styles.quickButton} onPress={() => applyTakeProfitRR(3)}>
            <Text style={styles.quickButtonText}>TP 3x</Text>
          </Pressable>
        </View>
        <TextInput
          value={entryPrice}
          onChangeText={setEntryPrice}
          placeholder="Entry price"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          style={styles.input}
        />
        <TextInput
          value={stopLoss}
          onChangeText={setStopLoss}
          placeholder="Stop loss"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          style={styles.input}
        />
        <TextInput
          value={takeProfit}
          onChangeText={setTakeProfit}
          placeholder="Take profit"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          style={styles.input}
        />
        {riskReward ? (
          <Text style={styles.helperText}>Risk/Reward: 1:{riskReward.toFixed(2)}</Text>
        ) : null}
        <Pressable style={styles.applyButton} onPress={executeManual}>
          <Text style={styles.applyButtonText}>Execute Manual Trade</Text>
        </Pressable>
        </View>
      )}

      {!liteMode && (
        <View style={styles.manualCard}>
        <Text style={styles.sectionTitle}>Price Alert</Text>
        <View style={styles.directionRow}>
          <Pressable
            style={[styles.directionButton, alertMode === 'ABOVE' && styles.buyButton]}
            onPress={() => setAlertMode('ABOVE')}
          >
            <Text style={styles.directionText}>ABOVE</Text>
          </Pressable>
          <Pressable
            style={[styles.directionButton, alertMode === 'BELOW' && styles.sellButton]}
            onPress={() => setAlertMode('BELOW')}
          >
            <Text style={styles.directionText}>BELOW</Text>
          </Pressable>
        </View>
        <TextInput
          value={alertPrice}
          onChangeText={setAlertPrice}
          placeholder="Alert price"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          style={styles.input}
        />
        <Pressable
          style={[styles.applyButton, alertEnabled ? styles.sellButton : styles.buyButton]}
          onPress={() => setAlertEnabled(!alertEnabled)}
        >
          <Text style={styles.applyButtonText}>
            {alertEnabled ? 'Disable Alert' : 'Enable Alert'}
          </Text>
        </Pressable>
        </View>
      )}

      {!liteMode && (
        <View style={styles.autoCard}>
        <Text style={styles.sectionTitle}>Auto Trade</Text>
        <Text style={styles.helperText}>
          Auto trade uses the server worker and runs even when your phone is closed.
        </Text>
        <Pressable
          style={[styles.directionButton, useWatchlist ? styles.buyButton : styles.sellButton]}
          onPress={() => setUseWatchlist(!useWatchlist)}
        >
          <Text style={styles.directionText}>
            {useWatchlist ? 'Using Watchlist' : 'Single Coin Only'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.applyButton, autoEnabled ? styles.sellButton : styles.buyButton]}
          onPress={() => toggleAutoTrade(!autoEnabled)}
          disabled={autoSyncing}
        >
          <Text style={styles.applyButtonText}>
            {autoSyncing
              ? 'Syncing...'
              : autoEnabled
              ? 'Disable Auto Trade'
              : 'Enable Auto Trade'}
          </Text>
        </Pressable>
        <Text style={styles.helperText}>
          Auto uses symbols:{' '}
          {(useWatchlist && favorites.length ? favorites : [symbol])
            .map((item) => item.replace('USDT', ''))
            .join(', ')}
        </Text>
        </View>
      )}
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
    gap: 14,
    paddingBottom: 96,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
  },
  symbolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  symbolChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  symbolChipActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#1E3A8A',
  },
  symbolChipText: {
    color: '#E2E8F0',
    fontWeight: '600',
  },
  priceCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  priceLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  priceValue: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '700',
  },
  chartBox: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  signalCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  manualCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  autoCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  signalType: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  moverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  opportunityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  opportunitySymbol: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  opportunityScore: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  moverSymbol: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  moverPrice: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  moverChange: {
    color: '#F8FAFC',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  moverInput: {
    width: 70,
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#F8FAFC',
    textAlign: 'center',
  },
  helperText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  applyButton: {
    backgroundColor: '#1D4ED8',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  directionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  directionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  quickButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#334155',
  },
  quickButtonText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterButtonActive: {
    backgroundColor: '#14532D',
    borderColor: '#14532D',
  },
  filterButtonText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  directionText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  buyButton: {
    backgroundColor: '#14532D',
  },
  sellButton: {
    backgroundColor: '#7F1D1D',
  },
  input: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
  },
});
