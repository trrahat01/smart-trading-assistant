import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { clearBinanceKeys, getBinanceKeys, saveBinanceKeys } from '../services/binanceKeys';
import { fetchTestnetAccountInfo } from '../services/binanceTrade';
import { useStore } from '../store/useStore';

const SYMBOL_PRESETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT'];

export const SettingsScreen = () => {
  const {
    mode,
    riskPerTrade,
    favorites,
    binanceTestnetEnabled,
    setMode,
    setRiskPerTrade,
    toggleFavorite,
    setBinanceTestnetEnabled,
    resetDemo,
    resetLearning,
  } = useStore((state) => state);

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [keysSaved, setKeysSaved] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [balanceLabel, setBalanceLabel] = useState('Not loaded');
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const loadKeys = async () => {
      const keys = await getBinanceKeys();
      if (!active) {
        return;
      }
      if (keys) {
        setApiKey(keys.apiKey);
        setApiSecret(keys.apiSecret);
        setKeysSaved(true);
      }
    };
    loadKeys();
    return () => {
      active = false;
    };
  }, []);

  const handleRefreshBalance = React.useCallback(
    async (options?: { silent?: boolean }) => {
      if (!keysSaved) {
        if (!options?.silent) {
          Alert.alert('Missing keys', 'Save your testnet keys first.');
        }
        return;
      }
      setLoadingBalance(true);
      try {
        const account = await fetchTestnetAccountInfo();
        const usdt = account.balances.find((item) => item.asset === 'USDT');
        if (!usdt) {
          setBalanceLabel('USDT not found');
        } else {
          const free = Number(usdt.free);
          setBalanceLabel(`${Number.isFinite(free) ? free.toFixed(2) : usdt.free} USDT`);
        }
        setBalanceUpdatedAt(Date.now());
      } catch (error) {
        if (!options?.silent) {
          const message = error instanceof Error ? error.message : 'Could not load balance.';
          Alert.alert('Balance failed', message);
        } else {
          console.warn('Balance refresh failed', error);
        }
      } finally {
        setLoadingBalance(false);
      }
    },
    [keysSaved]
  );

  useEffect(() => {
    if (!keysSaved) {
      return;
    }
    let active = true;
    handleRefreshBalance({ silent: true });
    const timer = setInterval(() => {
      if (!active) {
        return;
      }
      handleRefreshBalance({ silent: true });
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [handleRefreshBalance, keysSaved]);

  const handleSaveKeys = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Missing keys', 'Enter both API key and secret.');
      return;
    }
    setSavingKeys(true);
    try {
      await saveBinanceKeys(apiKey, apiSecret);
      setKeysSaved(true);
      setBalanceLabel('Not loaded');
      setBalanceUpdatedAt(null);
      Alert.alert('Saved', 'Testnet keys saved locally on this device.');
    } catch (error) {
      console.warn('Key save failed', error);
      Alert.alert('Save failed', 'Could not save your keys. Try again.');
    } finally {
      setSavingKeys(false);
    }
  };

  const handleClearKeys = async () => {
    setSavingKeys(true);
    try {
      await clearBinanceKeys();
      setApiKey('');
      setApiSecret('');
      setKeysSaved(false);
      setBalanceLabel('Not loaded');
      setBalanceUpdatedAt(null);
      setBinanceTestnetEnabled(false);
      Alert.alert('Cleared', 'Testnet keys removed.');
    } catch (error) {
      console.warn('Key clear failed', error);
      Alert.alert('Clear failed', 'Could not clear your keys.');
    } finally {
      setSavingKeys(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trading Mode</Text>
        <Text style={styles.sectionDescription}>
          Use DEMO for practice. REAL mode tracks a separate balance.
        </Text>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeButton, mode === 'DEMO' ? styles.modeActive : styles.modeInactive]}
            onPress={() => setMode('DEMO')}
          >
            <Text style={styles.modeButtonText}>DEMO</Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'REAL' ? styles.modeRealActive : styles.modeInactive]}
            onPress={() => setMode('REAL')}
          >
            <Text style={styles.modeButtonText}>REAL</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Risk Per Trade</Text>
        <Text style={styles.sectionDescription}>Current risk: {riskPerTrade}%</Text>

        <View style={styles.riskControls}>
          <Pressable
            style={styles.riskButton}
            onPress={() => setRiskPerTrade(riskPerTrade - 1)}
          >
            <Text style={styles.riskButtonText}>-</Text>
          </Pressable>
          <Text style={styles.riskValue}>{riskPerTrade}%</Text>
          <Pressable
            style={styles.riskButton}
            onPress={() => setRiskPerTrade(riskPerTrade + 1)}
          >
            <Text style={styles.riskButtonText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.helperText}>Recommended range: 1% to 2% while learning.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Favorite Markets</Text>
        <Text style={styles.sectionDescription}>
          Pin the pairs you want to watch first in the Market tab.
        </Text>

        <View style={styles.tagWrap}>
          {SYMBOL_PRESETS.map((symbol) => {
            const selected = favorites.includes(symbol);
            return (
              <Pressable
                key={symbol}
                onPress={() => toggleFavorite(symbol)}
                style={[styles.tag, selected ? styles.tagActive : styles.tagInactive]}
              >
                <Text style={styles.tagText}>{symbol.replace('USDT', '')}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Binance Testnet</Text>
        <Text style={styles.sectionDescription}>
          Free paper trading with Binance testnet. Do not use real keys. Keys are stored locally
          on this device.
        </Text>
        <Text style={styles.sectionNote}>Use REAL mode to send testnet orders.</Text>

        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="API Key"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          value={apiSecret}
          onChangeText={setApiSecret}
          placeholder="API Secret"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, savingKeys ? styles.buttonDisabled : styles.buttonPrimary]}
            onPress={handleSaveKeys}
            disabled={savingKeys}
          >
            <Text style={styles.actionButtonText}>Save Keys</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, savingKeys ? styles.buttonDisabled : styles.buttonGhost]}
            onPress={handleClearKeys}
            disabled={savingKeys}
          >
            <Text style={styles.actionButtonText}>Clear</Text>
          </Pressable>
        </View>

        <Pressable
          style={[
            styles.refreshButton,
            loadingBalance ? styles.buttonDisabled : styles.buttonGhost,
          ]}
          onPress={handleRefreshBalance}
          disabled={loadingBalance}
        >
          <Text style={styles.actionButtonText}>
            {loadingBalance ? 'Refreshing...' : `Refresh Balance (${balanceLabel})`}
          </Text>
        </Pressable>
        <Text style={styles.balanceMeta}>
          {balanceUpdatedAt
            ? `Last updated ${new Date(balanceUpdatedAt).toLocaleTimeString()}`
            : 'Last updated: not yet'}
        </Text>

        <Pressable
          style={[
            styles.toggleButton,
            binanceTestnetEnabled ? styles.toggleOn : styles.toggleOff,
            !keysSaved && styles.buttonDisabled,
          ]}
          onPress={() => setBinanceTestnetEnabled(!binanceTestnetEnabled)}
          disabled={!keysSaved}
        >
          <Text style={styles.toggleText}>
            {binanceTestnetEnabled ? 'Testnet Trading Enabled' : 'Enable Testnet Trading'}
          </Text>
        </Pressable>
        <Text style={styles.helperText}>
          Status: {keysSaved ? 'Keys saved' : 'Keys missing'} | Trading{' '}
          {binanceTestnetEnabled ? 'On' : 'Off'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reset</Text>
        <Text style={styles.sectionDescription}>Use reset tools when you want a fresh practice cycle.</Text>

        <Pressable
          style={styles.resetButton}
          onPress={() =>
            Alert.alert('Reset demo account?', 'This clears all DEMO trades and resets DEMO balance.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: resetDemo },
            ])
          }
        >
          <Text style={styles.resetButtonText}>Reset Demo Account</Text>
        </Pressable>

        <Pressable
          style={[styles.resetButton, styles.secondaryResetButton]}
          onPress={() =>
            Alert.alert(
              'Reset learning progress?',
              'This clears lesson completion and quiz history.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reset', style: 'destructive', onPress: resetLearning },
              ]
            )
          }
        >
          <Text style={styles.resetButtonText}>Reset Learning Progress</Text>
        </Pressable>
      </View>

      <Text style={styles.footerText}>
        Education only. This app does not provide financial advice.
      </Text>
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
  section: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionDescription: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeActive: {
    backgroundColor: '#92400E',
  },
  modeRealActive: {
    backgroundColor: '#14532D',
  },
  modeInactive: {
    backgroundColor: '#334155',
  },
  modeButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  riskControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  riskButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskButtonText: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
  },
  riskValue: {
    color: '#F8FAFC',
    fontSize: 30,
    fontWeight: '700',
    minWidth: 70,
    textAlign: 'center',
  },
  helperText: {
    color: '#7DD3FC',
    fontSize: 12,
  },
  sectionNote: {
    color: '#94A3B8',
    fontSize: 12,
  },
  input: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  refreshButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  balanceMeta: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  buttonPrimary: {
    backgroundColor: '#1D4ED8',
  },
  buttonGhost: {
    backgroundColor: '#334155',
  },
  buttonDisabled: {
    backgroundColor: '#475569',
  },
  toggleButton: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: '#14532D',
  },
  toggleOff: {
    backgroundColor: '#334155',
  },
  toggleText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagActive: {
    backgroundColor: '#1E3A8A',
    borderColor: '#38BDF8',
  },
  tagInactive: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  tagText: {
    color: '#E2E8F0',
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: '#7F1D1D',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryResetButton: {
    backgroundColor: '#4338CA',
  },
  resetButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  footerText: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 12,
  },
});
