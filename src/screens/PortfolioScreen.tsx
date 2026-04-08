import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createTickerStream, fetchPrice } from '../services/binance';
import type { TickerStreamStatus } from '../services/binance';
import { calculateOpenPnL } from '../services/trading';
import { useStore } from '../store/useStore';
import { Trade } from '../types/trading';

const money = (value: number) => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const PortfolioScreen = () => {
  const { mode, demoBalance, realBalance, trades, closeTrade } = useStore((state) => state);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<TickerStreamStatus>('offline');

  const activeTrades = trades.filter((trade) => trade.status === 'OPEN' && trade.mode === mode);
  const activeSymbols = useMemo(
    () => [...new Set(activeTrades.map((trade) => trade.symbol))],
    [activeTrades]
  );
  const closedTrades = trades.filter((trade) => trade.status === 'CLOSED' && trade.mode === mode);
  const cashBalance = mode === 'DEMO' ? demoBalance : realBalance;

  const refreshPrices = async () => {
    if (activeSymbols.length === 0) {
      setPrices({});
      return;
    }
    setRefreshing(true);
    try {
      const rows = await Promise.all(
        activeSymbols.map(
          async (symbol) => [symbol, await fetchPrice(symbol, { allowFallback: false })] as const
        )
      );
      setPrices(Object.fromEntries(rows));
    } catch (error) {
      console.warn('Price refresh failed', error);
      Alert.alert('Could not refresh prices', 'Please try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshPrices();

    if (activeSymbols.length === 0) {
      setStreamStatus('offline');
      return;
    }

    let active = true;
    const stream = createTickerStream(activeSymbols, {
      onTick: (ticker) => {
        if (!active) {
          return;
        }
        setPrices((current) => ({
          ...current,
          [ticker.symbol]: ticker.lastPrice,
        }));
      },
      onStatus: (status) => {
        if (!active) {
          return;
        }
        setStreamStatus(status);
      },
      onError: (error) => {
        console.warn('Live portfolio stream error', error);
      },
    });

    return () => {
      active = false;
      stream.close();
    };
  }, [activeSymbols.join('|')]);

  const openPnl = useMemo(() => {
    return activeTrades.reduce((sum, trade) => {
      const price = prices[trade.symbol] ?? trade.entryPrice;
      return sum + calculateOpenPnL(trade, price);
    }, 0);
  }, [activeTrades, prices]);

  const closedPnl = closedTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const wins = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;

  const equity = cashBalance + openPnl;

  const handleCloseTrade = (trade: Trade) => {
    const price = prices[trade.symbol] ?? trade.entryPrice;
    Alert.alert(
      'Close trade',
      `Close ${trade.direction} ${trade.symbol.replace('USDT', '')} at $${price.toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: () => closeTrade(trade.id, price),
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          tintColor="#38BDF8"
          refreshing={refreshing}
          onRefresh={refreshPrices}
        />
      }
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Account Equity</Text>
        <Text style={styles.summarySubtitle}>
          {streamStatus === 'live'
            ? 'Live Binance prices'
            : streamStatus === 'reconnecting'
            ? 'Reconnecting live prices...'
            : 'Live prices offline'}
        </Text>
        <Text style={styles.summaryValue}>${money(equity)}</Text>

        <View style={styles.metricsGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Cash</Text>
            <Text style={styles.metricValue}>${money(cashBalance)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Open PnL</Text>
            <Text style={[styles.metricValue, openPnl >= 0 ? styles.positive : styles.negative]}>
              {openPnl >= 0 ? '+' : ''}${money(openPnl)}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Closed PnL</Text>
            <Text style={[styles.metricValue, closedPnl >= 0 ? styles.positive : styles.negative]}>
              {closedPnl >= 0 ? '+' : ''}${money(closedPnl)}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Win Rate</Text>
            <Text style={styles.metricValue}>{winRate.toFixed(1)}%</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Trades ({activeTrades.length})</Text>
        {activeTrades.length === 0 ? (
          <Text style={styles.emptyText}>No open trades in this mode.</Text>
        ) : (
          activeTrades.map((trade) => {
            const currentPrice = prices[trade.symbol] ?? trade.entryPrice;
            const pnl = calculateOpenPnL(trade, currentPrice);
            return (
              <View key={trade.id} style={styles.tradeCard}>
                <View style={styles.tradeTopRow}>
                  <View>
                    <Text style={styles.tradeSymbol}>{trade.symbol.replace('USDT', '')}</Text>
                    <Text style={styles.tradeMeta}>
                      {trade.direction} - Qty {trade.quantity.toFixed(4)}
                    </Text>
                  </View>
                  <Text style={[styles.tradePnl, pnl >= 0 ? styles.positive : styles.negative]}>
                    {pnl >= 0 ? '+' : ''}${money(pnl)}
                  </Text>
                </View>

                <Text style={styles.tradeMeta}>
                  Entry ${trade.entryPrice.toFixed(2)} | Current ${currentPrice.toFixed(2)}
                </Text>
                <Text style={styles.tradeMeta}>
                  SL ${trade.stopLoss.toFixed(2)} | TP ${trade.takeProfit.toFixed(2)}
                </Text>

                <Pressable style={styles.closeButton} onPress={() => handleCloseTrade(trade)}>
                  <Text style={styles.closeButtonText}>Close Trade</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent History</Text>
        {closedTrades.length === 0 ? (
          <Text style={styles.emptyText}>No closed trades yet.</Text>
        ) : (
          closedTrades.slice(0, 12).map((trade) => (
            <View key={trade.id} style={styles.historyRow}>
              <View>
                <Text style={styles.historySymbol}>
                  {trade.direction} {trade.symbol.replace('USDT', '')}
                </Text>
                <Text style={styles.historyMeta}>
                  {new Date(trade.closedAt ?? trade.openedAt).toLocaleString()}
                </Text>
              </View>
              <Text
                style={[
                  styles.historyPnl,
                  (trade.pnl ?? 0) >= 0 ? styles.positive : styles.negative,
                ]}
              >
                {(trade.pnl ?? 0) >= 0 ? '+' : ''}${money(trade.pnl ?? 0)}
              </Text>
            </View>
          ))
        )}
      </View>
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
    paddingBottom: 30,
  },
  summaryCard: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  summaryTitle: {
    color: '#CBD5E1',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summarySubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 6,
  },
  summaryValue: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 8,
  },
  metricsGrid: {
    marginTop: 14,
    gap: 10,
  },
  metricItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  metricValue: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  positive: {
    color: '#22C55E',
  },
  negative: {
    color: '#F43F5E',
  },
  section: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  tradeCard: {
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 5,
  },
  tradeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tradeSymbol: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  tradeMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  tradePnl: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    marginTop: 8,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomColor: '#1F2937',
    borderBottomWidth: 1,
    paddingBottom: 10,
    marginBottom: 2,
  },
  historySymbol: {
    color: '#E2E8F0',
    fontWeight: '600',
  },
  historyMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  historyPnl: {
    fontWeight: '700',
  },
});
