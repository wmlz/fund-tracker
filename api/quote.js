const cache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3');

  const symbol = (req.query.symbol || '').toString();
  if (!/^nf_[A-Za-z0-9]+$/.test(symbol)) {
    res.status(400).json({ ok: false, error: 'invalid symbol' });
    return;
  }

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < 3000) {
    res.status(200).json(cached.data);
    return;
  }

  try {
    const resp = await fetch('https://hq.sinajs.cn/list=' + symbol, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (!resp.ok) throw new Error('sina HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    let text;
    try {
      text = new TextDecoder('gb18030').decode(buf);
    } catch (e) {
      text = buf.toString('utf8');
    }
    const m = text.match(/="([^"]*)"/);
    if (!m || !m[1]) throw new Error('bad sina response');

    const f = m[1].split(',');
    const last = parseFloat(f[8]);
    const prevSettle = parseFloat(f[10]);
    const data = {
      ok: true,
      symbol,
      name: f[0],
      time: f[1],
      date: f[17],
      open: parseFloat(f[2]),
      high: parseFloat(f[3]),
      low: parseFloat(f[4]),
      last,
      prevSettle,
      pct: prevSettle ? (last - prevSettle) / prevSettle * 100 : 0,
      volume: parseFloat(f[14]),
      oi: parseFloat(f[13])
    };
    cache.set(symbol, { ts: Date.now(), data });
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}