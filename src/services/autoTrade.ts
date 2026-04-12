import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_SERVER_URL = 'auto_trade_server_url';
const KEY_TOKEN = 'auto_trade_token';
const KEY_DEVICE_ID = 'auto_trade_device_id';
const KEY_ENABLED = 'auto_trade_enabled';

export interface AutoTradeConfig {
  deviceId: string;
  enabled: boolean;
  symbols: string[];
  riskPerTrade: number;
  maxTradesPerDay: number;
  dailyTradeLimit?: number;
  minAlignmentScore: number;
  requireConfirmations: boolean;
  autoPauseVolatility: boolean;
  maxAtrPercent: number;
  stopLossMultiplier?: number;
  takeProfitMultiplier?: number;
  tradeHoursEnabled: boolean;
  tradeStartHour: number;
  tradeEndHour: number;
  utcOffsetMinutes: number;
  autoCloseOnStop?: boolean;
  autoGradeFilter?: 'ALL' | 'A' | 'B' | 'C';
  mode: 'TESTNET';
  apiKey: string;
  apiSecret: string;
}

export interface AutoTradeSettings {
  serverUrl: string;
  token: string;
  deviceId: string;
  enabled: boolean;
}

const generateDeviceId = () => {
  const rand = Math.random().toString(36).slice(2, 10);
  return `device_${Date.now().toString(36)}_${rand}`;
};

export const loadAutoTradeSettings = async (): Promise<AutoTradeSettings> => {
  const [serverUrl, token, deviceId, enabled] = await Promise.all([
    AsyncStorage.getItem(KEY_SERVER_URL),
    AsyncStorage.getItem(KEY_TOKEN),
    AsyncStorage.getItem(KEY_DEVICE_ID),
    AsyncStorage.getItem(KEY_ENABLED),
  ]);

  const finalDeviceId = deviceId ?? generateDeviceId();
  if (!deviceId) {
    await AsyncStorage.setItem(KEY_DEVICE_ID, finalDeviceId);
  }

  return {
    serverUrl: serverUrl ?? '',
    token: token ?? '',
    deviceId: finalDeviceId,
    enabled: enabled === 'true',
  };
};

export const saveAutoTradeSettings = async (settings: AutoTradeSettings) => {
  await Promise.all([
    AsyncStorage.setItem(KEY_SERVER_URL, settings.serverUrl.trim()),
    AsyncStorage.setItem(KEY_TOKEN, settings.token.trim()),
    AsyncStorage.setItem(KEY_DEVICE_ID, settings.deviceId.trim()),
    AsyncStorage.setItem(KEY_ENABLED, String(settings.enabled)),
  ]);
};

export const pushAutoTradeConfig = async (
  settings: AutoTradeSettings,
  config: Omit<AutoTradeConfig, 'deviceId'>
) => {
  if (!settings.serverUrl || !settings.token) {
    throw new Error('Auto-trade server URL or token is missing.');
  }
  const response = await fetch(`${settings.serverUrl.replace(/\/$/, '')}/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify({
      deviceId: settings.deviceId,
      ...config,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? `Auto-trade update failed (HTTP ${response.status}).`);
  }

  return data;
};
