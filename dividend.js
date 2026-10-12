(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let loaded = false;

  function num(v, digits) {
    return (v == null || isNaN(v)) ? '--' : Number(v).toFixed(digits);
  }

  // PE 分位 → 颜色：≥80% 偏贵(红)，≤20% 偏宜(绿)，其余中性(蓝)
  function percentileColor(p) {
    if (p == null || isNaN(p)) return 'var(--text-dim)';
    if (p >= 0.8) return 'var(--up)';
    if (p <= 0.2) return 'var(--down)';
    return 'var(--accent)';
  }

  function evaText(t) {
    return t === 'high' ? '估值偏高' : t === 'low' ? '估值偏低' : '估值中性';
  }

  function evaColor(t) {
    return t === 'high' ? 'var(--up)' : t === 'low' ? 'var(--down)' : 'var(--accent)';
  }

  function cardHTML(ix, v) {
    const yeild = v.yeild == null ? null : v.yeild * 100;
    const peP = v.pePercentile;
    const pc = percentileColor(peP);
    const ec = evaColor(v.evaType);
    const pctTxt = peP == null ? '--' : (peP * 100).toFixed(1) + '%';
    const barW = peP == null ? 0 : Math.max(2, Math.min(100, peP * 100));

    return '' +
      '<div class="div-card-head">' +
        '<span class="name">' + (v.name || ix.name) + '</span>' +
        '<span class="code">' + (v.code || ix.code) + '</span>' +
        '<span class="div-badge" style="color:' + ec + ';border-color:' + ec + '">' + evaText(v.evaType) + '</span>' +
      '</div>' +
      '<div class="yeild">' + (yeild == null ? '--' : yeild.toFixed(2) + '%') + '</div>' +
      '<div class="yeild-label">当前股息率</div>' +
      '<div class="metrics">' +
        '<span>PE <b>' + num(v.pe, 2) + '</b></span>' +
        '<span>PB <b>' + num(v.pb, 2) + '</b></span>' +
        '<span>ROE <b>' + (v.roe == null ? '--' : (v.roe * 100).toFixed(2) + '%') + '</b></span>' +
      '</div>' +
      '<div class="bar-wrap">' +
        '<div class="bar-label"><span>PE 历史分位</span><span style="color:' + pc + '">' + pctTxt + '</span></div>' +
        '<div class="bar"><i style="width:' + barW + '%;background:' + pc + '"></i></div>' +
      '</div>' +
      '<div class="foot"><span>数据日期 <b>' + (v.date || '--') + '</b></span></div>';
  }

  function placeholderHTML(ix, msg) {
    return '<div class="div-card-head"><span class="name">' + ix.name + '</span>' +
      '<span class="code">' + ix.code + '</span></div>' +
      '<div class="div-card-err">' + msg + '</div>';
  }

  async function load() {
    const grid = $('divGrid');
    const status = $('divStatus');
    const indexes = window.DIVIDEND_INDEXES || [];
    grid.innerHTML = '';
    status.textContent = '加载中...';

    const results = await Promise.allSettled(indexes.map(ix => DS.getIndexValuation(ix.code)));
    const errs = [];

    indexes.forEach((ix, i) => {
      const card = document.createElement('div');
      card.className = 'div-card';
      const r = results[i];
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        card.innerHTML = cardHTML(ix, r.value);
      } else {
        errs.push(ix.name);
        card.innerHTML = placeholderHTML(ix, '数据不可用');
      }
      grid.appendChild(card);
    });

    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    status.textContent = '更新于 ' + hh + ':' + mm +
      (errs.length ? ' · 警告: ' + errs.join('、') + ' 获取失败' : '');
  }

  function switchView(view) {
    const isPremium = view === 'premium';
    $('view-premium').hidden = !isPremium;
    $('view-dividend').hidden = isPremium;
    $('fundSelect').style.display = isPremium ? '' : 'none';
    $('tabPremium').classList.toggle('active', isPremium);
    $('tabDividend').classList.toggle('active', !isPremium);
    document.title = isPremium ? 'LOF/ETF 实时溢价监控' : '红利指数股息率监控';

    if (isPremium) {
      if (window.__premiumControl) { window.__premiumControl.resume(); window.__premiumControl.resize(); }
    } else {
      if (window.__premiumControl) window.__premiumControl.pause();
      if (!loaded) { loaded = true; load(); }
    }
  }

  function init() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
    $('divRefresh').addEventListener('click', () => { loaded = true; load(); });
  }

  init();
})();
