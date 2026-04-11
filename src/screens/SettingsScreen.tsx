import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { clearBinanceKeys, getBinanceKeys, saveBinanceKeys } from '../services/binanceKeys';
import { fetchTestnetAccountInfo } from '../services/binanceTrade';
import {
  loadAutoTradeSettings,
  pushAutoTradeConfig,
  saveAutoTradeSettings,
} from '../services/autoTrade';
import { useStore } from '../store/useStore';

const SYMBOL_PRESETS = [
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

export const SettingsScreen = () => {
  const {
    mode,
    easyModeEnabled,
    riskPerTrade,
    favorites,
    binanceTestnetEnabled,
    maxDailyLossPct,
    maxTradesPerDay,
    lossStreakLimit,
    cooldownMinutes,
    requireConfirmations,
    minAlignmentScore,
    autoPauseVolatility,
    maxAtrPercent,
    manualOverrideEnabled,
    tradeHoursEnabled,
    tradeStartHour,
    tradeEndHour,
    autoCloseOnStop,
    autoGradeFilter,
    alertOnSignalChange,
    setMode,
    setEasyModeEnabled,
    setRiskPerTrade,
    toggleFavorite,
    setBinanceTestnetEnabled,
    setMaxDailyLossPct,
    setMaxTradesPerDay,
    setLossStreakLimit,
    setCooldownMinutes,
    setRequireConfirmations,
    setMinAlignmentScore,
    setAutoPauseVolatility,
    setMaxAtrPercent,
    setManualOverrideEnabled,
    setTradeHoursEnabled,
    setTradeStartHour,
    setTradeEndHour,
    setAutoCloseOnStop,
    setAutoGradeFilter,
    setAlertOnSignalChange,
    resetDemo,
    resetLearning,
  } = useStore((state) => state);

  const applyEasyMode = () => {
    setRequireConfirmations(false);
    setMinAlignmentScore(0);
    setAutoPauseVolatility(false);
    setMaxAtrPercent(0.05);
    setManualOverrideEnabled(true);
    setMaxTradesPerDay(8);
    setMaxDailyLossPct(6);
    setLossStreakLimit(3);
    setCooldownMinutes(30);
  };

  const toggleEasyMode = () => {
    const next = !easyModeEnabled;
    setEasyModeEnabled(next);
    if (next) {
      applyEasyMode();
    }
  };

  const applySafeMode = () => {
    setRequireConfirmations(true);
    setMinAlignmentScore(2);
    setAutoPauseVolatility(true);
    setMaxAtrPercent(0.03);
    setManualOverrideEnabled(false);
    setMaxTradesPerDay(3);
    setMaxDailyLossPct(3);
    setLossStreakLimit(2);
    setCooldownMinutes(90);
  };

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [keysSaved, setKeysSaved] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [balanceLabel, setBalanceLabel] = useState('Not loaded');
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);
  const [autoServerUrl, setAutoServerUrl] = useState('');
  const [autoToken, setAutoToken] = useState('');
  const [autoDeviceId, setAutoDeviceId] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [autoSyncedAt, setAutoSyncedAt] = useState<number | null>(null);
  const [autoTesting, setAutoTesting] = useState(false);
  const [autoHealth, setAutoHealth] = useState<'unknown' | 'ok' | 'fail'>('unknown');
  const [autoLogs, setAutoLogs] = useState<string[]>([]);
  const [autoLogLoading, setAutoLogLoading] = useState(false);

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

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      const settings = await loadAutoTradeSettings();
      if (!active) {
        return;
      }
      setAutoServerUrl(settings.serverUrl);
      setAutoToken(settings.token);
      setAutoDeviceId(settings.deviceId);
      setAutoEnabled(settings.enabled);
    };
    loadSettings();
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

  const autoSymbols = useMemo(() => {
    const base = favorites.length ? favorites : SYMBOL_PRESETS;
    return base;
  }, [favorites]);

  const syncAutoTrade = async (enabled: boolean) => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Missing keys', 'Save your testnet keys first.');
      return;
    }
    if (!autoServerUrl.trim() || !autoToken.trim()) {
      Alert.alert('Missing server info', 'Enter the server URL and token first.');
      return;
    }

    setAutoSyncing(true);
    try {
      const settings = {
        serverUrl: autoServerUrl,
        token: autoToken,
        deviceId: autoDeviceId,
        enabled,
      };
      await saveAutoTradeSettings(settings);
      await pushAutoTradeConfig(settings, {
        enabled,
        symbols: autoSymbols,
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
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
      });
      setAutoEnabled(enabled);
      setAutoSyncedAt(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto-trade update failed.';
      Alert.alert('Auto-trade failed', message);
    } finally {
      setAutoSyncing(false);
    }
  };

  const testAutoTrade = async () => {
    if (!autoServerUrl.trim()) {
      Alert.alert('Missing server URL', 'Enter the server URL first.');
      return;
    }
    setAutoTesting(true);
    try {
      const response = await fetch(`${autoServerUrl.replace(/\/$/, '')}/health`);
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (response.ok && data.ok) {
        setAutoHealth('ok');
        Alert.alert('Server OK', 'Auto-trade server is reachable.');
      } else {
        setAutoHealth('fail');
        Alert.alert('Server failed', 'Server responded but did not return OK.');
      }
    } catch (error) {
      setAutoHealth('fail');
      Alert.alert('Server failed', 'Could not reach the auto-trade server.');
    } finally {
      setAutoTesting(false);
    }
  };

  const fetchAutoLogs = async () => {
    if (!autoServerUrl.trim() || !autoToken.trim()) {
      Alert.alert('Missing server info', 'Enter the server URL and token first.');
      return;
    }
    setAutoLogLoading(true);
    try {
      const response = await fetch(
        `${autoServerUrl.replace(/\/$/, '')}/logs?deviceId=${encodeURIComponent(autoDeviceId)}`,
        {
          headers: { Authorization: `Bearer ${autoToken}` },
        }
      );
      const data = (await response.json().catch(() => ({}))) as { logs?: string[] };
      if (!response.ok) {
        Alert.alert('Logs failed', 'Could not load server logs.');
        return;
      }
      setAutoLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (error) {
      Alert.alert('Logs failed', 'Could not reach the auto-trade server.');
    } finally {
      setAutoLogLoading(false);
    }
  };

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
        <Text style={styles.sectionTitle}>Easy Mode</Text>
        <Text style={styles.sectionDescription}>
          Show simple controls only. Turn this off to see advanced options.
        </Text>
        <Pressable
          style={[styles.toggleButton, easyModeEnabled ? styles.toggleOn : styles.toggleOff]}
          onPress={toggleEasyMode}
        >
          <Text style={styles.toggleText}>{easyModeEnabled ? 'Easy Mode On' : 'Easy Mode Off'}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trading Mode</Text>
        <Text style={styles.sectionDescription}>
          DEMO and REAL use the same trade flow with Binance-style fees. DEMO starts with $40 so
          you can practice safely.
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

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Risk Controls Pro</Text>
        <Text style={styles.sectionDescription}>Limits to reduce losses and protect capital.</Text>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max daily loss</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxDailyLossPct(maxDailyLossPct - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{maxDailyLossPct}%</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxDailyLossPct(maxDailyLossPct + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max trades/day</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxTradesPerDay(maxTradesPerDay - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{maxTradesPerDay}</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxTradesPerDay(maxTradesPerDay + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Loss streak limit</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setLossStreakLimit(lossStreakLimit - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{lossStreakLimit}</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setLossStreakLimit(lossStreakLimit + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Cooldown (minutes)</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setCooldownMinutes(cooldownMinutes - 5)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{cooldownMinutes}</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setCooldownMinutes(cooldownMinutes + 5)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>}

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mode Presets</Text>
        <Text style={styles.sectionDescription}>
          Quick presets to make trading easier or safer.
        </Text>
        <Pressable style={styles.applyButton} onPress={applyEasyMode}>
          <Text style={styles.applyButtonText}>Easy Mode (Faster)</Text>
        </Pressable>
        <Pressable style={styles.safeButton} onPress={applySafeMode}>
          <Text style={styles.applyButtonText}>Safe Mode (Stricter)</Text>
        </Pressable>
      </View>}

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Confirmations & Alerts</Text>
        <Text style={styles.sectionDescription}>Extra filters before trades are allowed.</Text>

        <Pressable
          style={[
            styles.toggleButton,
            requireConfirmations ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setRequireConfirmations(!requireConfirmations)}
        >
          <Text style={styles.toggleText}>
            {requireConfirmations ? 'Confirmations Enabled' : 'Confirmations Disabled'}
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.toggleButton,
            manualOverrideEnabled ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setManualOverrideEnabled(!manualOverrideEnabled)}
        >
          <Text style={styles.toggleText}>
            {manualOverrideEnabled ? 'Manual Override Enabled' : 'Manual Override Disabled'}
          </Text>
        </Pressable>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Min alignment</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMinAlignmentScore(minAlignmentScore - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{minAlignmentScore}/2</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMinAlignmentScore(minAlignmentScore + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={[
            styles.toggleButton,
            autoPauseVolatility ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setAutoPauseVolatility(!autoPauseVolatility)}
        >
          <Text style={styles.toggleText}>
            {autoPauseVolatility ? 'Pause On High Volatility' : 'No Volatility Pause'}
          </Text>
        </Pressable>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max ATR%</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxAtrPercent(Number((maxAtrPercent - 0.005).toFixed(3)))}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{(maxAtrPercent * 100).toFixed(1)}%</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setMaxAtrPercent(Number((maxAtrPercent + 0.005).toFixed(3)))}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={[
            styles.toggleButton,
            alertOnSignalChange ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setAlertOnSignalChange(!alertOnSignalChange)}
        >
          <Text style={styles.toggleText}>
            {alertOnSignalChange ? 'Signal Alerts On' : 'Signal Alerts Off'}
          </Text>
        </Pressable>
      </View>}

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Auto Trade Grade Filter</Text>
        <Text style={styles.sectionDescription}>
          Auto trade only when signal grade meets the filter.
        </Text>
        <View style={styles.directionRow}>
          {(['ALL', 'A', 'B', 'C'] as const).map((grade) => (
            <Pressable
              key={grade}
              style={[
                styles.directionButton,
                autoGradeFilter === grade && styles.buyButton,
              ]}
              onPress={() => setAutoGradeFilter(grade)}
            >
              <Text style={styles.directionText}>{grade}</Text>
            </Pressable>
          ))}
        </View>
      </View>}

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trading Hours</Text>
        <Text style={styles.sectionDescription}>
          Allow trades only within a time window (local time).
        </Text>
        <Pressable
          style={[
            styles.toggleButton,
            tradeHoursEnabled ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setTradeHoursEnabled(!tradeHoursEnabled)}
        >
          <Text style={styles.toggleText}>
            {tradeHoursEnabled ? 'Trading Hours Enabled' : 'Trading Hours Disabled'}
          </Text>
        </Pressable>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Start hour</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setTradeStartHour(tradeStartHour - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{tradeStartHour}:00</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setTradeStartHour(tradeStartHour + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>End hour</Text>
          <View style={styles.riskControlsInline}>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setTradeEndHour(tradeEndHour - 1)}
            >
              <Text style={styles.riskButtonText}>-</Text>
            </Pressable>
            <Text style={styles.riskValueSmall}>{tradeEndHour}:00</Text>
            <Pressable
              style={styles.riskButtonSmall}
              onPress={() => setTradeEndHour(tradeEndHour + 1)}
            >
              <Text style={styles.riskButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>}

      {!easyModeEnabled && <View style={styles.section}>
        <Text style={styles.sectionTitle}>Auto Close</Text>
        <Text style={styles.sectionDescription}>
          Automatically close trades when stop loss is hit (while app is open).
        </Text>
        <Pressable
          style={[
            styles.toggleButton,
            autoCloseOnStop ? styles.toggleOn : styles.toggleOff,
          ]}
          onPress={() => setAutoCloseOnStop(!autoCloseOnStop)}
        >
          <Text style={styles.toggleText}>
            {autoCloseOnStop ? 'Auto Close On' : 'Auto Close Off'}
          </Text>
        </Pressable>
      </View>}

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
        <Text style={styles.sectionNote}>
          DEMO and REAL can both send testnet orders when enabled. Fees are included in the trade
          math.
        </Text>

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
          onPress={() => {
            handleRefreshBalance();
          }}
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
        <Text style={styles.sectionTitle}>Auto Trade (Server)</Text>
        <Text style={styles.sectionDescription}>
          Runs on a free server so it keeps trading even when your phone is closed. Testnet only.
        </Text>

        <TextInput
          value={autoServerUrl}
          onChangeText={setAutoServerUrl}
          placeholder="Server URL (https://your-worker.example)"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          value={autoToken}
          onChangeText={setAutoToken}
          placeholder="Server Token"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
        <View style={styles.deviceIdBox}>
          <Text style={styles.deviceIdLabel}>Device ID</Text>
          <Text style={styles.deviceIdValue} selectable>
            {autoDeviceId}
          </Text>
        </View>

        <Pressable
          style={[
            styles.refreshButton,
            autoSyncing ? styles.buttonDisabled : styles.buttonGhost,
          ]}
          onPress={() => syncAutoTrade(autoEnabled)}
          disabled={autoSyncing}
        >
          <Text style={styles.actionButtonText}>
            {autoSyncing ? 'Syncing...' : 'Sync Settings'}
          </Text>
        </Pressable>

        {!easyModeEnabled && (
          <Pressable
            style={[
              styles.refreshButton,
              autoTesting ? styles.buttonDisabled : styles.buttonGhost,
            ]}
            onPress={testAutoTrade}
            disabled={autoTesting}
          >
            <Text style={styles.actionButtonText}>
              {autoTesting
                ? 'Testing...'
                : autoHealth === 'ok'
                ? 'Test Connection (OK)'
                : autoHealth === 'fail'
                ? 'Test Connection (Failed)'
                : 'Test Connection'}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={[
            styles.toggleButton,
            autoEnabled ? styles.toggleOn : styles.toggleOff,
            autoSyncing && styles.buttonDisabled,
          ]}
          onPress={() => syncAutoTrade(!autoEnabled)}
          disabled={autoSyncing}
        >
          <Text style={styles.toggleText}>
            {autoSyncing
              ? 'Syncing...'
              : autoEnabled
              ? 'Disable Auto Trade'
              : 'Enable Auto Trade'}
          </Text>
        </Pressable>
        <Text style={styles.helperText}>
          Status: {autoEnabled ? 'On' : 'Off'} | Symbols: {autoSymbols.length}
        </Text>
        <Text style={styles.balanceMeta}>
          {autoSyncedAt
            ? `Last sync ${new Date(autoSyncedAt).toLocaleTimeString()}`
            : 'Last sync: not yet'}
        </Text>

        {!easyModeEnabled && (
          <>
            <Pressable
              style={[
                styles.refreshButton,
                autoLogLoading ? styles.buttonDisabled : styles.buttonGhost,
              ]}
              onPress={fetchAutoLogs}
              disabled={autoLogLoading}
            >
              <Text style={styles.actionButtonText}>
                {autoLogLoading ? 'Loading logs...' : 'Fetch Server Logs'}
              </Text>
            </Pressable>
            {autoLogs.length ? (
              <View style={styles.logsBox}>
                {autoLogs.slice(0, 6).map((log, index) => (
                  <Text key={`${log}-${index}`} style={styles.logText}>
                    {log}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        )}
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
    paddingBottom: 110,
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
  riskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  riskLabel: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  riskControlsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  riskButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskButtonSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  riskValueSmall: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 40,
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
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceMeta: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
  },
  deviceIdBox: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  deviceIdLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  deviceIdValue: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
  },
  logsBox: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  logText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
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
  applyButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  safeButton: {
    backgroundColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 10,
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
  directionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#334155',
    alignItems: 'center',
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
  footerText: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 12,
  },
});
