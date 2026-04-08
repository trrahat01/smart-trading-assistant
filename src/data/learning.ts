import { Lesson } from '../types/trading';

export const LESSONS: Lesson[] = [
  {
    id: 'risk-101',
    title: 'Risk Management 101',
    level: 'Beginner',
    durationMinutes: 8,
    summary:
      'Learn why professional traders protect capital first, then seek returns.',
    keyPoints: [
      'Risk only 1-2% of account equity per trade.',
      'Always define stop loss before entry.',
      'Focus on consistency, not one big trade.',
    ],
    quiz: [
      {
        id: 'risk-1',
        question: 'If your account is $5,000 and risk is 2%, max risk per trade is:',
        options: ['$50', '$100', '$500', '$1,000'],
        answerIndex: 1,
        explanation: '2% of $5,000 is $100. That is your risk budget for one trade.',
      },
      {
        id: 'risk-2',
        question: 'What should be decided before opening a trade?',
        options: ['Stop loss', 'Profit screenshot', 'Leverage boost', 'News headline'],
        answerIndex: 0,
        explanation: 'Stop loss defines downside risk and position size.',
      },
    ],
  },
  {
    id: 'trend-momentum',
    title: 'Trend + Momentum',
    level: 'Beginner',
    durationMinutes: 10,
    summary:
      'Combine trend direction with momentum so entries align with stronger moves.',
    keyPoints: [
      'EMA20 above EMA50 often signals bullish structure.',
      'RSI near 50 usually means neutral momentum.',
      'Take fewer trades, but in the clearest direction.',
    ],
    quiz: [
      {
        id: 'trend-1',
        question: 'If EMA20 is above EMA50, baseline trend bias is:',
        options: ['Bullish', 'Bearish', 'Flat only', 'Unknown'],
        answerIndex: 0,
        explanation: 'Fast EMA above slow EMA is commonly used as bullish trend confirmation.',
      },
      {
        id: 'trend-2',
        question: 'RSI above 70 is generally interpreted as:',
        options: ['Oversold', 'Neutral', 'Overbought', 'Noisy data'],
        answerIndex: 2,
        explanation: 'RSI > 70 can mean overbought conditions or strong momentum.',
      },
    ],
  },
  {
    id: 'trade-planning',
    title: 'Trade Planning Blueprint',
    level: 'Intermediate',
    durationMinutes: 12,
    summary:
      'A practical checklist: thesis, invalidation, entry, position size, and exit.',
    keyPoints: [
      'Write one sentence for trade thesis.',
      'Invalidation level must be price-based, not emotion-based.',
      'Prefer setups with reward:risk >= 2:1.',
    ],
    quiz: [
      {
        id: 'plan-1',
        question: 'A 2:1 reward:risk means:',
        options: [
          'Potential loss is double gain',
          'Potential gain is double risk',
          'Win rate must be 100%',
          'Trade must close today',
        ],
        answerIndex: 1,
        explanation: '2:1 reward:risk targets twice the risk amount.',
      },
      {
        id: 'plan-2',
        question: 'Best invalidation level is usually:',
        options: [
          'A random tight stop',
          'Exactly 1% away always',
          'A level that breaks your setup logic',
          'No stop in strong markets',
        ],
        answerIndex: 2,
        explanation: 'Invalidation should directly conflict with the setup thesis.',
      },
    ],
  },
  {
    id: 'psychology',
    title: 'Trading Psychology',
    level: 'Intermediate',
    durationMinutes: 9,
    summary:
      'Build routines that reduce revenge trading and fear-based exits.',
    keyPoints: [
      'Judge process quality first, PnL second.',
      'After two emotional trades, stop and reset.',
      'Use a pre-trade checklist to stay objective.',
    ],
    quiz: [
      {
        id: 'psy-1',
        question: 'After a large loss, the healthiest next step is:',
        options: [
          'Increase size to recover quickly',
          'Take a short pause and review your process',
          'Switch to random coins',
          'Disable all stops',
        ],
        answerIndex: 1,
        explanation: 'Pause + review helps break emotional reaction loops.',
      },
      {
        id: 'psy-2',
        question: 'A process-focused trader mainly evaluates:',
        options: [
          'Only daily PnL',
          'How viral their trades are',
          'Rule adherence and decision quality',
          'How often they trade',
        ],
        answerIndex: 2,
        explanation: 'Strong process drives long-term outcomes better than impulse decisions.',
      },
    ],
  },
];
