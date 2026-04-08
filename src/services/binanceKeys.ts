import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_API = 'binance_api_key';
const KEY_SECRET = 'binance_api_secret';

export interface BinanceKeys {
  apiKey: string;
  apiSecret: string;
}

export const getBinanceKeys = async (): Promise<BinanceKeys | null> => {
  const [apiKey, apiSecret] = await Promise.all([
    AsyncStorage.getItem(KEY_API),
    AsyncStorage.getItem(KEY_SECRET),
  ]);

  if (!apiKey || !apiSecret) {
    return null;
  }

  return { apiKey, apiSecret };
};

export const saveBinanceKeys = async (apiKey: string, apiSecret: string) => {
  await Promise.all([
    AsyncStorage.setItem(KEY_API, apiKey.trim()),
    AsyncStorage.setItem(KEY_SECRET, apiSecret.trim()),
  ]);
};

export const clearBinanceKeys = async () => {
  await Promise.all([AsyncStorage.removeItem(KEY_API), AsyncStorage.removeItem(KEY_SECRET)]);
};
