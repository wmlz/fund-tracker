(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let loaded = false;

  const valuationCache = {}; // code -> 当前估值
  const charts = {};         // code -> echarts 实例

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
      '<div class="foot"><span>数据日期 <b>' + (v.date || '--') + '</b></span></div>' +
      '<div class="hist-toggle">历史走势 <span class="caret">▾</span></div>' +
      '<div class="hist-wrap" hidden>' +
        '<div class="hist-chart"></div>' +
        '<div class="hist-note">股息率历史由 PE 反推：股息率 = 分红率 ÷ PE（分红率取当前值近似，远期可能有少量漂移）。</div>' +
      '</div>';
  }

  function placeholderHTML(ix, msg) {
    return '<div class="div-card-head"><span class="name">' + ix.name + '</span>' +
      '<span class="code">' + ix.code + '</span></div>' +
      '<div class="div-card-err">' + msg + '</div>';
  }

  async function buildChart(card, code) {
    const el = card.querySelector('.hist-chart');
    const v = valuationCache[code];
    if (!v) return;
    el.innerHTML = '<div class="hist-loading">加载中...</div>';

    let rows;
    try {
      rows = (await DS.getIndexValuationHistory(code)).rows;
    } catch (e) {
      el.innerHTML = '<div class="hist-loading">历史数据加载失败</div>';
      return;
    }
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="hist-loading">暂无历史数据</div>';
      return;
    }

    // 反推：历史股息率_t = 当前股息率 × (当前 PE ÷ PE_t)
    const curYeild = v.yeild * 100;
    const curPE = v.pe;
    const data = rows.map(r => [r.date, +(curYeild * curPE / r.pe).toFixed(3)]);

    el.innerHTML = '';
    const chart = echarts.init(el);
    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        formatter: (p) => p[0].axisValue + '<br/>股息率 ' + (+p[0].data[1]).toFixed(2) + '%'
      },
      grid: { left: 46, right: 14, top: 18, bottom: 26 },
      xAxis: {
        type: 'time',
        axisLabel: { color: '#8a93a6', formatter: '{yyyy}' },
        axisLine: { lineStyle: { color: '#2a3550' } }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#8a93a6', formatter: (x) => x.toFixed(1) + '%' },
        splitLine: { lineStyle: { color: '#2a3550' } }
      },
      series: [{
        type: 'line',
        data,
        symbol: 'none',
        smooth: true,
        lineStyle: { width: 1.6, color: '#4c8dff' },
        areaStyle: { color: 'rgba(76,141,255,0.12)' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#8a93a6', type: 'dashed', width: 1 },
          data: [{ type: 'average', name: '均值' }],
          label: { color: '#8a93a6', formatter: '均值 {c}%' }
        }
      }]
    });
    charts[code] = chart;
  }

  async function toggleCard(card, code) {
    const wrap = card.querySelector('.hist-wrap');
    if (!wrap) return;
    const open = !wrap.hidden;
    if (open) {
      wrap.hidden = true;
      card.classList.remove('open');
      return;
    }
    wrap.hidden = false;
    card.classList.add('open');
    if (!charts[code]) {
      await new Promise(r => requestAnimationFrame(r)); // 等布局完成再建图
      await buildChart(card, code);
    } else {
      charts[code].resize();
    }
  }

  async function load() {
    const grid = $('divGrid');
    const status = $('divStatus');
    const indexes = window.DIVIDEND_INDEXES || [];
    grid.innerHTML = '';
    status.textContent = '加载中...';

    // 重置图表实例
    Object.keys(charts).forEach(k => { try { charts[k].dispose(); } catch (e) {} delete charts[k]; });

    const results = await Promise.allSettled(indexes.map(ix => DS.getIndexValuation(ix.code)));
    const errs = [];

    indexes.forEach((ix, i) => {
      const card = document.createElement('div');
      card.className = 'div-card';
      const r = results[i];
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        const v = r.value;
        const code = v.code || ix.code;
        valuationCache[code] = v;
        card.innerHTML = cardHTML(ix, v);
        card.addEventListener('click', () => toggleCard(card, code));
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
      else { requestAnimationFrame(() => Object.keys(charts).forEach(k => charts[k].resize())); }
    }
  }

  function init() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
    $('divRefresh').addEventListener('click', () => { loaded = true; load(); });
  }

  init();
})();
