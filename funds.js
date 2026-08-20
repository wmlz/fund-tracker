window.FUNDS = {
  '161226': {
    code: '161226',
    name: '国投瑞银白银LOF',
    market: 'sz',
    tracker: {
      type: 'futures',
      symbol: 'nf_AG0',
      fallback: { source: 'tencent', symbol: 'hf_SI' }
    }
  },
  '160723': {
    code: '160723',
    name: '嘉实原油LOF',
    market: 'sz',
    tracker: {
      type: 'composite',
      symbols: [
        { source: 'tencent', symbol: 'hf_CL', weight: 1, kline: 'CL' }
      ]
    }
  },
  '501018': {
    code: '501018',
    name: '南方原油LOF',
    market: 'sh',
    tracker: {
      type: 'composite',
      symbols: [
        { source: 'tencent', symbol: 'hf_CL', weight: 0.6, kline: 'CL' },
        { source: 'tencent', symbol: 'hf_OIL', weight: 0.4, kline: 'OIL' }
      ]
    }
  }
};