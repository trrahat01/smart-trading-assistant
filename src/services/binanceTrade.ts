import HmacSHA256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';
import { getBinanceKeys } from './binanceKeys';

const DEFAULT_TESTNET_BASE_URL = 'https://testnet.binance.vision/api';
const TESTNET_BASE_URL =
  process.env.EXPO_PUBLIC_BINANCE_TESTNET_API_URL ?? DEFAULT_TESTNET_BASE_URL;

export interface BinanceOrderResponse {
  orderId?: number;
  clientOrderId?: string;
  status?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountInfo {
  balances: BinanceBalance[];
}

export interface SymbolTradingRules {
  minQty: number;
  stepSize: number;
  minNotional?: number;
}

const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;
const exchangeInfoCache: Record<string, { fetchedAt: number; rules: SymbolTradingRules }> = {};

const toQueryString = (params: Record<string, string>) => {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
};

const sign = (payload: string, secret: string) => {
  return HmacSHA256(payload, secret).toString(Hex);
};

const buildBinanceError = (data: Record<string, unknown>, status: number, fallback: string) => {
  const msg = typeof data.msg === 'string' ? data.msg : fallback;
  const rawCode = data.code;
  const code =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && rawCode.trim()
      ? rawCode
      : null;
  const codePart = code ? ` (code ${code})` : '';
  return `${msg}${codePart} [HTTP ${status}]`;
};

const formatQuantity = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const fixed = value.toFixed(6);
  return fixed.replace(/\.?0+$/, '');
};

const roundDownToStep = (value: number, stepSize: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(stepSize) || stepSize <= 0) {
    return value;
  }
  const precision = Math.max(0, stepSize.toString().split('.')[1]?.length ?? 0);
  const factor = 10 ** precision;
  const stepped = Math.floor((value * factor) / (stepSize * factor)) * stepSize;
  return Number(stepped.toFixed(precision));
};

const parseExchangeInfoRules = (symbolInfo: Record<string, unknown>): SymbolTradingRules => {
  const filters = (symbolInfo.filters as Array<Record<string, unknown>>) ?? [];
  const lotSize = filters.find((filter) => filter.filterType === 'LOT_SIZE');
  const minNotionalFilter =
    filters.find((filter) => filter.filterType === 'MIN_NOTIONAL') ??
    filters.find((filter) => filter.filterType === 'NOTIONAL');

  const minQty = Number(lotSize?.minQty ?? 0);
  const stepSize = Number(lotSize?.stepSize ?? 0);
  const minNotional = minNotionalFilter ? Number(minNotionalFilter.minNotional ?? 0) : undefined;

  return { minQty, stepSize, minNotional };
};

export const fetchTestnetAccountInfo = async (): Promise<BinanceAccountInfo> => {
  if (!TESTNET_BASE_URL) {
    throw new Error('Binance testnet base URL is not set.');
  }
  const keys = await getBinanceKeys();
  if (!keys?.apiKey || !keys?.apiSecret) {
    throw new Error('Binance testnet keys are missing.');
  }

  const params: Record<string, string> = {
    recvWindow: '5000',
    timestamp: Date.now().toString(),
  };
  const query = toQueryString(params);
  const signature = sign(query, keys.apiSecret);

  const response = await fetch(`${TESTNET_BASE_URL}/v3/account?${query}&signature=${signature}`, {
    method: 'GET',
    headers: {
      'X-MBX-APIKEY': keys.apiKey,
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      buildBinanceError(data, response.status, 'Binance testnet account failed.')
    );
  }

  return data as BinanceAccountInfo;
};

export const fetchTestnetSymbolRules = async (symbol: string): Promise<SymbolTradingRules> => {
  if (!TESTNET_BASE_URL) {
    throw new Error('Binance testnet base URL is not set.');
  }
  const cached = exchangeInfoCache[symbol];
  if (cached && Date.now() - cached.fetchedAt < EXCHANGE_INFO_TTL_MS) {
    return cached.rules;
  }

  const response = await fetch(`${TESTNET_BASE_URL}/v3/exchangeInfo?symbol=${symbol}`);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      buildBinanceError(data, response.status, 'Binance exchange info failed.')
    );
  }

  const symbols = (data.symbols as Array<Record<string, unknown>>) ?? [];
  if (!symbols.length) {
    throw new Error('Symbol rules not found.');
  }

  const rules = parseExchangeInfoRules(symbols[0]);
  exchangeInfoCache[symbol] = { fetchedAt: Date.now(), rules };
  return rules;
};

export const validateTestnetOrder = async (payload: {
  symbol: string;
  quantity: number;
  price: number;
}): Promise<{ quantity: number; error?: string }> => {
  const rules = await fetchTestnetSymbolRules(payload.symbol);
  const adjustedQty = roundDownToStep(payload.quantity, rules.stepSize);

  if (!Number.isFinite(adjustedQty) || adjustedQty <= 0) {
    return { quantity: adjustedQty, error: 'Quantity is invalid.' };
  }
  if (rules.minQty && adjustedQty < rules.minQty) {
    return {
      quantity: adjustedQty,
      error: `Minimum quantity is ${rules.minQty}.`,
    };
  }

  if (rules.minNotional && payload.price * adjustedQty < rules.minNotional) {
    return {
      quantity: adjustedQty,
      error: `Minimum order value is ${rules.minNotional} USDT.`,
    };
  }

  return { quantity: adjustedQty };
};

export const placeTestnetMarketOrder = async (payload: {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
}): Promise<BinanceOrderResponse> => {
  if (!TESTNET_BASE_URL) {
    throw new Error('Binance testnet base URL is not set.');
  }

  const keys = await getBinanceKeys();
  if (!keys?.apiKey || !keys?.apiSecret) {
    throw new Error('Binance testnet keys are missing.');
  }

  const params: Record<string, string> = {
    symbol: payload.symbol,
    side: payload.side,
    type: 'MARKET',
    quantity: formatQuantity(payload.quantity),
    recvWindow: '5000',
    timestamp: Date.now().toString(),
  };
  const query = toQueryString(params);
  const signature = sign(query, keys.apiSecret);

  const response = await fetch(`${TESTNET_BASE_URL}/v3/order?${query}&signature=${signature}`, {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': keys.apiKey,
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      buildBinanceError(data, response.status, 'Binance testnet order failed.')
    );
  }

  return data as BinanceOrderResponse;
};
