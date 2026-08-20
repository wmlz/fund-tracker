const cache = new Map();

const WHITELIST = new Set(['CL', 'OIL']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const symbol = (req.query.symbol || '').toString().toUpperCase();
  if (!WHITELIST.has(symbol)) {
    res.status(400).json({ ok: false, error: 'invalid symbol' });
    return;
  }
  const days = Math.min(parseInt(req.query.days) || 30, 120);

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < 60 * 1000) {
    res.status(200).json(cached.data);
    return;
  }

  try {
    const resp = await fetch(
      'https://stock.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=' + symbol,
      {
        headers: {
          'Referer': 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );
    if (!resp.ok) throw new Error('sina HTTP ' + resp.status);
    const text = await resp.text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0) throw new Error('bad kline response');
    const arr = JSON.parse(text.slice(start, end + 1));
    const rows = arr.slice(-days).map(x => ({
      date: x.date,
      close: parseFloat(x.close)
    }));
    const data = { ok: true, symbol, days: rows.length, rows };
    cache.set(symbol, { ts: Date.now(), data });
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}