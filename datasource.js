window.DS = (() => {
  const API_ROOT = ''; // 空 = 同域，部署到 Vercel 时 /api 在同域

  async function fetchText(url, opts = {}) {
    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  }

  function decodeGBK(buf) {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch (e) {
      return new TextDecoder('utf-8').decode(buf);
    }
  }

  async function fetchGBK(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return decodeGBK(new Uint8Array(await resp.arrayBuffer()));
  }

  function loadJSONP(url) {
    return new Promise((resolve, reject) => {
      const cb = '__jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const script = document.createElement('script');
      const timeout = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, 15000);
      function cleanup() {
        clearTimeout(timeout);
        delete window[cb];
        script.remove();
      }
      window[cb] = (data) => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('JSONP load error')); };
      script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  // ---- 场内实时行情（腾讯 qt.gtimg.cn） ----
  async function getIntraday(fund) {
    const text = await fetchGBK('https://qt.gtimg.cn/q=' + fund.market + fund.code);
    const m = text.match(/="([^"]+)"/);
    if (!m) throw new Error('bad quote response');
    const f = m[1].split('~');
    return {
      name: f[1],
      price: parseFloat(f[3]),
      prevClose: parseFloat(f[4]),
      open: parseFloat(f[5]),
      high: parseFloat(f[33]),
      low: parseFloat(f[34]),
      pct: parseFloat(f[32]),
      change: parseFloat(f[31]),
      time: f[30],
      volume: parseFloat(f[36]),
      amount: parseFloat(f[37]) * 10000
    };
  }

  // ---- 场内日K（腾讯） ----
  async function getDailyKline(fund, days = 120) {
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
      fund.market + fund.code + ',day,,,' + days + ',qfq';
    const json = JSON.parse(await fetchText(url));
    const key = fund.market + fund.code;
    const rows = (json.data && json.data[key] && json.data[key].day) || [];
    return rows.map(r => ({
      date: r[0],
      open: parseFloat(r[1]),
      close: parseFloat(r[2]),
      high: parseFloat(r[3]),
      low: parseFloat(r[4]),
      volume: parseFloat(r[5])
    }));
  }

  // ---- 场内分时（腾讯） ----
  async function getMinuteData(fund) {
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' +
      fund.market + fund.code;
    const json = JSON.parse(await fetchText(url));
    const key = fund.market + fund.code;
    const raw = (json.data && json.data[key] && json.data[key].data && json.data[key].data.data) || [];
    return raw.map(s => {
      const p = s.split(' ');
      return { t: p[0], price: parseFloat(p[1]), volume: parseFloat(p[2]), amount: parseFloat(p[3]) };
    });
  }

  // ---- 历史净值 ----
  // 优先走 Vercel /api/nav（准确到最新净值），失败降级天天基金 pingzhongdata JSONP
  let navProxyCache = { key: '', data: null };

  async function getNavHistory(fund, days = 120) {
    const key = fund.code + ':' + days;
    if (navProxyCache.key === key && navProxyCache.data) return navProxyCache.data;
    try {
      const resp = await fetch(API_ROOT + '/api/nav?code=' + fund.code + '&days=' + days);
      if (resp.ok) {
        const json = await resp.json();
        if (json.ok && json.list && json.list.length) {
          const list = json.list.slice().reverse(); // 转为按日期升序
          navProxyCache = { key, data: list };
          return list;
        }
      }
    } catch (e) {}
    return getNavHistoryPingzhong(fund);
  }

  async function getNavHistoryPingzhong(fund) {
    const url = 'https://fund.eastmoney.com/pingzhongdata/' + fund.code + '.js';
    const text = await fetchText(url);
    const m = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) throw new Error('netWorthTrend not found');
    const list = JSON.parse(m[1]).map(o => ({
      date: new Date(o.x).toISOString().slice(0, 10),
      nav: o.y
    })).filter(o => o.nav && o.nav > 0);
    navProxyCache = { key: fund.code + ':x', data: list };
    return list;
  }

  async function getLatestNav(fund) {
    const list = await getNavHistory(fund, 10);
    if (!list.length) throw new Error('no nav data');
    const last = list[list.length - 1];
    return { date: last.date, nav: last.nav, purchase: last.purchase };
  }

  // ---- 指数估值（红利股息率，经 Vercel /api/dividend 代理蛋卷） ----
  async function getIndexValuation(code) {
    const resp = await fetch(API_ROOT + '/api/dividend?code=' + encodeURIComponent(code));
    if (!resp.ok) throw new Error('dividend HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'dividend error');
    return json;
  }

  // 指数 PE 历史（用于反推股息率走势）
  async function getIndexValuationHistory(code) {
    const resp = await fetch(API_ROOT + '/api/dividend?code=' + encodeURIComponent(code) + '&history=1');
    if (!resp.ok) throw new Error('dividend history HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'dividend history error');
    return json;
  }

  // ---- 跟踪标的报价 ----
  async function getTrackerQuote(fund, anchorDate) {
    const t = fund.tracker;
    if (t.type === 'futures') {
      try {
        const q = await getFuturesProxy(t.symbol);
        q.source = 'sina-proxy';
        return q;
      } catch (e) {
        if (t.fallback) {
          const q = await getTencentFX(t.fallback.symbol);
          q.source = 'tencent-fx';
          q.fallbackNote = '代理不可用，已降级为' + (q.name || t.fallback.symbol);
          return q;
        }
        throw e;
      }
    }
    if (t.type === 'composite') {
      return getCompositeQuote(t.symbols, anchorDate);
    }
    throw new Error('unsupported tracker type: ' + t.type);
  }

  // 组合型跟踪标的：多标的加权累计涨跌（锚定最新净值日期 D0）
  async function getCompositeQuote(symbols, anchorDate) {
    let degraded = false;
    const comps = await Promise.all(symbols.map(async s => {
      let kline = null;
      try { kline = await getForeignKline(s.kline, 40); } catch (e) { degraded = true; }
      const live = await getTencentFX(s.symbol);
      const anchor = pickAnchor(kline, anchorDate);
      const cum = anchor
        ? (live.last / anchor.close - 1) * 100
        : live.pct;
      return {
        name: live.name,
        last: live.last,
        pct: live.pct,
        cum,
        weight: s.weight,
        anchorDate: anchor ? anchor.date : null,
        time: live.time
      };
    }));
    const totalW = comps.reduce((a, c) => a + c.weight, 0);
    const pct = comps.reduce((a, c) => a + c.cum * c.weight, 0) / totalW;
    const anchorDates = comps.map(c => c.anchorDate).filter(Boolean).sort();
    const q = {
      source: 'tencent-composite',
      pct,
      last: comps[0].last,
      name: comps.map(c => c.name + '\u00d7' + c.weight).join('+'),
      components: comps,
      anchorDate: anchorDates.length ? anchorDates[anchorDates.length - 1] : null,
      time: comps[0].time
    };
    if (degraded) q.fallbackNote = '锚定K线不可用，已降级为单日涨跌';
    return q;
  }

  function pickAnchor(kline, anchorDate) {
    if (!kline || !kline.length) return null;
    if (!anchorDate) return kline[kline.length - 1];
    for (let i = kline.length - 1; i >= 0; i--) {
      if (kline[i].date <= anchorDate) return kline[i];
    }
    return kline[0];
  }

  // 新浪国内期货（经 Vercel /api/quote 代理）
  async function getFuturesProxy(symbol) {
    const resp = await fetch(API_ROOT + '/api/quote?symbol=' + encodeURIComponent(symbol));
    if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'proxy error');
    return json;
  }

  // 外盘期货日K（经 Vercel /api/kline 代理，用于锚定价）
  async function getForeignKline(symbol, days = 40) {
    const resp = await fetch(API_ROOT + '/api/kline?symbol=' + encodeURIComponent(symbol) + '&days=' + days);
    if (!resp.ok) throw new Error('kline HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.ok || !json.rows) throw new Error(json.error || 'kline error');
    return json.rows;
  }

  // 腾讯外盘（COMEX 等）
  async function getTencentFX(symbol) {
    const text = await fetchGBK('https://qt.gtimg.cn/q=' + symbol);
    const m = text.match(/="([^"]+)"/);
    if (!m) throw new Error('bad fx response');
    const f = m[1].split(',');
    const last = parseFloat(f[0]);
    const prev = parseFloat(f[7]);
    return {
      name: f[13],
      last,
      prev: prev,
      pct: parseFloat(f[1]) || (prev ? (last / prev - 1) * 100 : 0),
      time: f[6],
      date: f[12]
    };
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  return {
    getIntraday,
    getDailyKline,
    getMinuteData,
    getNavHistory,
    getLatestNav,
    getIndexValuation,
    getIndexValuationHistory,
    getTrackerQuote,
    todayStr
  };
})();