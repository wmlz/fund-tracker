const cache = new Map();
const TTL = 30 * 60 * 1000; // 指数估值每日更新，缓存 30 分钟

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=1800');

  const code = (req.query.code || '').toString().toUpperCase();
  // 蛋卷指数代码：SH000922 / CSIH30269 / SZ399324 等
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    res.status(400).json({ ok: false, error: 'invalid code' });
    return;
  }

  const cached = cache.get(code);
  if (cached && Date.now() - cached.ts < TTL) {
    res.status(200).json(cached.data);
    return;
  }

  try {
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
    cache.set(code, { ts: Date.now(), data });
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}
