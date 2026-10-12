const cache = new Map();

const DETAIL_TTL = 30 * 60 * 1000;      // 当前估值：30 分钟
const HISTORY_TTL = 6 * 60 * 60 * 1000; // 历史 PE：6 小时（仅最新点变化）

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = (req.query.code || '').toString().toUpperCase();
  // 蛋卷指数代码：SH000922 / CSIH30269 / SZ399324 等
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    res.status(400).json({ ok: false, error: 'invalid code' });
    return;
  }

  const isHistory = req.query.history === '1';
  const cacheKey = code + (isHistory ? ':hist' : '');
  const ttl = isHistory ? HISTORY_TTL : DETAIL_TTL;

  res.setHeader('Cache-Control', 'public, max-age=' + Math.floor(ttl / 1000));
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) {
    res.status(200).json(cached.data);
    return;
  }

  try {
    if (isHistory) {
      const resp = await fetch('https://danjuanfunds.com/djapi/index_eva/pe_history/' + code + '?day=all', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!resp.ok) throw new Error('danjuan HTTP ' + resp.status);
      const json = await resp.json();
      const growths = json && json.data && json.data.index_eva_pe_growths;
      if (!growths || !growths.length) throw new Error('no history data');
      const rows = growths
        .map(x => ({ date: new Date(x.ts).toISOString().slice(0, 10), pe: x.pe }))
        .filter(x => x.pe > 0);
      const data = { ok: true, code, rows };
      cache.set(cacheKey, { ts: Date.now(), data });
      res.status(200).json(data);
      return;
    }

    const resp = await fetch('https://danjuanfunds.com/djapi/index_eva/detail/' + code, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) throw new Error('danjuan HTTP ' + resp.status);
    const json = await resp.json();
    const d = json && json.data;
    if (!d) throw new Error(json && json.message ? json.message : 'no data');

    const data = {
      ok: true,
      code: d.index_code,
      name: d.name,
      yeild: d.yeild,               // 股息率（蛋卷字段拼写为 yeild）
      pe: d.pe,
      pb: d.pb,
      roe: d.roe,
      pePercentile: d.pe_percentile,
      pbPercentile: d.pb_percentile,
      evaType: d.eva_type,          // 'high' | 'low'
      evaTypeInt: d.eva_type_int,
      date: d.date
    };
    cache.set(cacheKey, { ts: Date.now(), data });
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}
