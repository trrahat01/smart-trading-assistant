import { Kline, MarketTicker } from '../types/trading';

const BASE_URL = 'https://api.binance.com/api/v3';
const STREAM_URL = 'wss://stream.binance.com:9443/stream';

const FALLBACK_BASE_PRICE: Record<string, number> = {
  BTCUSDT: 67000,
  ETHUSDT: 3400,
  SOLUSDT: 145,
  BNBUSDT: 610,
  ADAUSDT: 0.82,
  XRPUSDT: 0.62,
  LTCUSDT: 95,
  DOGEUSDT: 0.16,
  AVAXUSDT: 42,
  DOTUSDT: 7.5,
  LINKUSDT: 16,
  MATICUSDT: 0.95,
  TRXUSDT: 0.14,
  BCHUSDT: 390,
  SHIBUSDT: 0.00002,
  PEPEUSDT: 0.0000012,
  ATOMUSDT: 9.5,
  NEARUSDT: 5.2,
  SUIUSDT: 1.6,
  INJUSDT: 27,
  APTUSDT: 10,
};

const toNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const buildStreamUrl = (symbols: string[]) => {
  const streams = symbols.map((symbol) => `${symbol.toLowerCase()}@ticker`).join('/');
  return `${STREAM_URL}?streams=${streams}`;
};

const parseTickerEvent = (payload: unknown): MarketTicker | null => {
  if (!payload) {
    return null;
  }

  const event = typeof payload === 'object' && payload !== null && 'data' in payload
    ? (payload as { data?: Record<string, unknown> }).data
    : (payload as Record<string, unknown>);

  if (!event || typeof event !== 'object') {
    return null;
  }

  const symbol = String((event as Record<string, unknown>).s ?? '');
  if (!symbol) {
    return null;
  }

  return {
    symbol,
    lastPrice: toNumber((event as Record<string, unknown>).c),
    priceChangePercent: toNumber((event as Record<string, unknown>).P),
    volume: toNumber((event as Record<string, unknown>).v),
  };
};

const pseudoRandom = (seed: number) => {
  return Math.sin(seed * 97.23) * 10000 - Math.floor(Math.sin(seed * 97.23) * 10000);
};

const buildFallbackTickers = (symbols: string[]): MarketTicker[] => {
  return symbols.map((symbol, index) => {
    const base = FALLBACK_BASE_PRICE[symbol] ?? 100;
    const drift = (pseudoRandom(index + 1) - 0.5) * 0.03;
    const changePct = drift * 100;
    return {
      symbol,
      lastPrice: base * (1 + drift),
      priceChangePercent: changePct,
      volume: base * 1000 * (1 + Math.abs(drift) * 5),
    };
  });
};

const buildFallbackKlines = (symbol: string, limit: number): Kline[] => {
  const base = FALLBACK_BASE_PRICE[symbol] ?? 100;
  const now = Date.now();
  const stepMs = 60 * 60 * 1000;
  const klines: Kline[] = [];
  let previousClose = base;

  for (let i = limit; i >= 1; i--) {
    const pointSeed = i * 1.37 + symbol.length * 2.13;
    const wave = Math.sin(pointSeed / 3.2) * 0.008;
    const noise = (pseudoRandom(pointSeed) - 0.5) * 0.01;
    const close = previousClose * (1 + wave + noise);
    const high = Math.max(previousClose, close) * (1 + 0.004);
    const low = Math.min(previousClose, close) * (1 - 0.004);
    const openTime = now - i * stepMs;
    klines.push({
      openTime,
      closeTime: openTime + stepMs - 1,
      open: previousClose,
      high,
      low,
      close,
      volume: base * 50 * (1 + Math.abs(noise) * 20),
    });
    previousClose = close;
  }

  return klines;
};

export const fetchTickers = async (
  symbols: string[],
  options?: { allowFallback?: boolean }
): Promise<MarketTicker[]> => {
  const allowFallback = options?.allowFallback ?? true;
  try {
    const response = await fetch(`${BASE_URL}/ticker/24hr`);
    if (!response.ok) {
      throw new Error(`Binance ticker failed with status ${response.status}`);
    }
    const data = (await response.json()) as Array<Record<string, unknown>>;
    const filtered = data.filter((row) => symbols.includes(String(row.symbol)));
    if (!filtered.length) {
      return allowFallback ? buildFallbackTickers(symbols) : [];
    }
    return filtered.map((row) => ({
      symbol: String(row.symbol),
      lastPrice: toNumber(row.lastPrice),
      priceChangePercent: toNumber(row.priceChangePercent),
      volume: toNumber(row.volume),
    }));
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    console.warn('Ticker fetch failed, using local fallback data.', error);
    return buildFallbackTickers(symbols);
  }
};

export type TickerStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export const createTickerStream = (
  symbols: string[],
  handlers: {
    onTick: (ticker: MarketTicker) => void;
    onStatus?: (status: TickerStreamStatus) => void;
    onError?: (error: unknown) => void;
  }
) => {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

  const updateStatus = (status: TickerStreamStatus) => {
    handlers.onStatus?.(status);
  };

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) {
      return;
    }
    reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000);
    updateStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    updateStatus('connecting');
    socket = new WebSocket(buildStreamUrl(symbols));

    socket.onopen = () => {
      reconnectAttempt = 0;
      updateStatus('live');
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        const ticker = parseTickerEvent(payload);
        if (ticker) {
          handlers.onTick(ticker);
        }
      } catch (error) {
        handlers.onError?.(error);
      }
    };

    socket.onerror = (error) => {
      handlers.onError?.(error);
    };

    socket.onclose = () => {
      updateStatus('offline');
      scheduleReconnect();
    };
  };

  connect();

  return {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
};

export const fetchPrice = async (
  symbol: string,
  options?: { allowFallback?: boolean }
): Promise<number> => {
  const allowFallback = options?.allowFallback ?? true;
  try {
    const response = await fetch(`${BASE_URL}/ticker/price?symbol=${symbol}`);
    if (!response.ok) {
      throw new Error(`Binance price failed with status ${response.status}`);
    }
    const data = (await response.json()) as { price?: string };
    return toNumber(data.price, FALLBACK_BASE_PRICE[symbol] ?? 0);
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    console.warn(`Price fetch failed for ${symbol}, using fallback price.`, error);
    return FALLBACK_BASE_PRICE[symbol] ?? 0;
  }
};

export const fetchKlines = async (
  symbol: string,
  interval = '1h',
  limit = 120
): Promise<Kline[]> => {
  try {
    const response = await fetch(
      `${BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Binance klines failed with status ${response.status}`);
    }
    const data = (await response.json()) as unknown[];
    if (!Array.isArray(data) || data.length === 0) {
      return buildFallbackKlines(symbol, limit);
    }
    return data
      .map((row) => {
        if (!Array.isArray(row)) {
          return null;
        }
        return {
          openTime: toNumber(row[0]),
          open: toNumber(row[1]),
          high: toNumber(row[2]),
          low: toNumber(row[3]),
          close: toNumber(row[4]),
          volume: toNumber(row[5]),
          closeTime: toNumber(row[6]),
        } satisfies Kline;
      })
      .filter((row): row is Kline => row !== null);
  } catch (error) {
    console.warn(`Kline fetch failed for ${symbol}, using fallback history.`, error);
    return buildFallbackKlines(symbol, limit);
  }
};
