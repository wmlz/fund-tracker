export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const code = (req.query.code || '').toString();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ ok: false, error: 'invalid code' });
    return;
  }
  const days = Math.min(parseInt(req.query.days) || 120, 365);

  try {
    const resp = await fetch(
      'https://api.fund.eastmoney.com/f10/lsjz?fundCode=' + code +
      '&pageIndex=1&pageSize=' + days,
      {
        headers: {
          'Referer': 'https://fundf10.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );
    if (!resp.ok) throw new Error('eastmoney HTTP ' + resp.status);
    const json = await resp.json();
    const list = (json.Data && json.Data.LSJZList || []).map(x => ({
      date: x.FSRQ,
      nav: parseFloat(x.DWJZ),
      pct: parseFloat(x.JZZZL),
      purchase: x.SGZT
    }));
    res.status(200).json({ ok: true, code, list });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}