(() => {
  'use strict';

  const REFRESH_MS = 5000;
  const minuteChartEl = document.getElementById('minuteChart');
  const historyChartEl = document.getElementById('historyChart');

  const state = {
    fundCode: null,
    intraday: null,
    tracker: null,
    nav: null,
    estNav: null,
    premium: null,
    minute: [],
    alert: { up: null, down: null },
    lastNotified: { up: 0, down: 0 }
  };

  let navLoadedDate = '';

  let minuteChart = null;
  let historyChart = null;
  let timer = null;

  // ---------- helpers ----------

  const $ = (id) => document.getElementById(id);

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtPct(v) {
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isTradingTime() {
    const d = new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const min = d.getHours() * 60 + d.getMinutes();
    return (min >= 9 * 60 && min <= 11 * 60 + 30) || (min >= 13 * 60 + 30 && min <= 15 * 60);
  }

  function marketClosed() {
    const d = new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    const min = d.getHours() * 60 + d.getMinutes();
    return min > 15 * 60;
  }

  // ---------- init / fund selection ----------

  function initSelect() {
    const sel = $('fundSelect');
    sel.innerHTML = '';
    Object.keys(FUNDS).forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = FUNDS[code].name + ' (' + code + ')';
      sel.appendChild(opt);
    });
    sel.value = state.fundCode;
    sel.addEventListener('change', () => {
      selectFund(sel.value);
    });
  }

  function selectFund(code) {
    if (!FUNDS[code]) return;
    state.fundCode = code;
    state.intraday = null;
    state.tracker = null;
    state.nav = null;
    navLoadedDate = '';
    state.minute = [];
    loadAlert();
    try { history.replaceState(null, '', '?code=' + code); } catch (e) {}
    localStorage.setItem('premium_fund', code);
    $('fundSelect').value = code;
    renderAll();
    loadHistory();
    initMinuteFromTencent();
    refreshQuote();
    scheduleRefresh();
  }

  const DEFAULT_FUND = '161226';

  function resolveInitialFund() {
    const fromUrl = new URLSearchParams(location.search).get('code');
    const fromLS = localStorage.getItem('premium_fund');
    if (FUNDS[fromUrl]) return fromUrl;
    if (FUNDS[fromLS]) return fromLS;
    return FUNDS[DEFAULT_FUND] ? DEFAULT_FUND : Object.keys(FUNDS)[0];
  }

  // ---------- alert ----------

  function loadAlert() {
    try {
      state.alert = JSON.parse(localStorage.getItem('premium_alert_' + state.fundCode)) ||
        { up: null, down: null };
    } catch (e) {
      state.alert = { up: null, down: null };
    }
    $('alertUp').value = state.alert.up == null ? '' : state.alert.up;
    $('alertDown').value = state.alert.down == null ? '' : state.alert.down;
  }

  function saveAlert() {
    const up = parseFloat($('alertUp').value);
    const down = parseFloat($('alertDown').value);
    state.alert.up = isNaN(up) ? null : up;
    state.alert.down = isNaN(down) ? null : down;
    localStorage.setItem('premium_alert_' + state.fundCode, JSON.stringify(state.alert));
    $('alertStatus').textContent = '已保存（当前基金）';
    setTimeout(() => { $('alertStatus').textContent = ''; }, 2000);
  }

  function checkAlert() {
    if (state.premium == null || !state.alert) return;
    const a = state.alert;
    const el = $('premium-card');
    el.classList.remove('pos', 'neg');
    if (a.up != null && state.premium > a.up) {
      el.classList.add('pos');
      notify('溢价偏高', '场内溢价 ' + fmtPct(state.premium) + '，高于 ' + a.up + '%', 'up');
    } else if (a.down != null && state.premium < a.down) {
      el.classList.add('neg');
      notify('折价过深', '场内折价 ' + fmtPct(state.premium) + '，低于 ' + a.down + '%', 'down');
    }
  }

  function notify(title, body, dir) {
    const now = Date.now();
    if (now - state.lastNotified[dir] < 5 * 60 * 1000) return;
    state.lastNotified[dir] = now;
    document.title = '⚠ ' + title + ' · ' + FUNDS[state.fundCode].name;
    setTimeout(() => { document.title = 'LOF/ETF 实时溢价监控'; }, 5000);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) {}
    }
  }

  function initNotify() {
    const btn = $('notifyBtn');
    btn.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        $('alertStatus').textContent = '当前浏览器不支持通知';
        return;
      }
      const p = await Notification.requestPermission();
      $('alertStatus').textContent = p === 'granted' ? '通知已开启' : '通知未授权';
      setTimeout(() => { $('alertStatus').textContent = ''; }, 2000);
    });
  }

  // ---------- data refresh ----------

  async function loadNav() {
    const today = todayStr();
    if (navLoadedDate === today && state.nav) return state.nav;
    try {
      const nav = await DS.getLatestNav(FUNDS[state.fundCode]);
      state.nav = nav;
      navLoadedDate = today;
      return state.nav;
    } catch (e) {
      if (state.nav) return state.nav;
      throw e;
    }
  }

  async function refreshQuote() {
    const fund = FUNDS[state.fundCode];
    const errors = [];
    let nav;
    try {
      nav = await loadNav();
      if (nav) state.nav = nav;
    } catch (e) {
      errors.push('净值:' + shortErr(e));
    }
    const anchorDate = state.nav ? state.nav.date : null;
    const results = await Promise.allSettled([
      DS.getIntraday(fund),
      DS.getTrackerQuote(fund, anchorDate)
    ]);
    if (results[0].status === 'fulfilled') state.intraday = results[0].value;
    else errors.push('场内:' + shortErr(results[0].reason));
    if (results[1].status === 'fulfilled') state.tracker = results[1].value;
    else errors.push('标的:' + shortErr(results[1].reason));

    if (state.intraday && state.tracker && state.nav) {
      state.estNav = state.nav.nav * (1 + state.tracker.pct / 100);
      state.premium = (state.intraday.price / state.estNav - 1) * 100;
      const key = fmtTime(Date.now());
      const last = state.minute[state.minute.length - 1];
      if (last && last.t === key) {
        last.price = state.intraday.price;
        last.estNav = state.estNav;
        last.premium = state.premium;
      } else if (state.minute.length < 1200) {
        state.minute.push({
          t: key,
          price: state.intraday.price,
          estNav: state.estNav,
          premium: state.premium
        });
      }
    }

    render();
    checkAlert();
    renderStatus(errors);
  }

  function shortErr(e) { return (e && e.message) ? e.message : String(e); }

  function scheduleRefresh() {
    if (timer) clearInterval(timer);
    if (isTradingTime()) {
      timer = setInterval(refreshQuote, REFRESH_MS);
    }
  }

  // ---------- render ----------

  function render() {
    const fund = FUNDS[state.fundCode];
    $('premium').textContent = state.premium == null ? '--' : fmtPct(state.premium);
    const pc = $('premium-card');
    pc.classList.remove('pos', 'neg');
    if (state.premium != null) pc.classList.add(state.premium >= 0 ? 'pos' : 'neg');

    $('premiumSub').textContent = state.intraday && state.estNav
      ? '场内-净值: ' + (state.intraday.price - state.estNav).toFixed(4) +
        (state.tracker && state.tracker.fallbackNote ? ' · ' + state.tracker.fallbackNote : '')
      : '等待数据...';

    if (state.intraday) {
      $('intradayPrice').textContent = state.intraday.price.toFixed(3);
      $('intradaySub').textContent =
        (state.intraday.pct >= 0 ? '+' : '') + state.intraday.pct.toFixed(2) + '% · 最高 ' +
        state.intraday.high.toFixed(3) + ' · 最低 ' + state.intraday.low.toFixed(3);
    }

    if (state.estNav && state.nav) {
      $('estNav').textContent = state.estNav.toFixed(4);
      const lag = tradingLagDays(state.nav.date);
      $('navSub').textContent = '基准净值 ' + state.nav.nav.toFixed(4) + '（' + state.nav.date +
        (lag > 0 ? '，滞后' + lag + '个交易日' : '') + '）' +
        (state.tracker ? ' · 标的' + (state.tracker.pct >= 0 ? '+' : '') + state.tracker.pct.toFixed(2) + '%' : '');
    } else {
      $('estNav').textContent = '--';
    }

    if (state.tracker) {
      $('trackerPrice').textContent = state.tracker.last.toFixed(2);
      if (state.tracker.source === 'tencent-composite') {
        $('trackerSub').textContent =
          (state.tracker.pct >= 0 ? '+' : '') + state.tracker.pct.toFixed(2) + '% · ' +
          state.tracker.name +
          (state.tracker.anchorDate ? ' · 锚定 ' + state.tracker.anchorDate : '');
      } else {
        const srcLabel = state.tracker.source === 'sina-proxy' ? '沪银主力' : '外盘';
        $('trackerSub').textContent =
          (state.tracker.pct >= 0 ? '+' : '') + state.tracker.pct.toFixed(2) + '% · ' + srcLabel +
          (state.tracker.name ? ' ' + state.tracker.name : '');
      }
    } else {
      $('trackerPrice').textContent = '--';
      $('trackerSub').textContent = '--';
    }

    renderMinuteChart();
  }

  function tradingLagDays(dateStr) {
    const today = new Date(todayStr() + 'T00:00:00');
    const d = new Date(dateStr + 'T00:00:00');
    let count = 0;
    while (d < today) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return Math.max(0, count - 1);
  }

  function renderAll() {
    const fund = FUNDS[state.fundCode];
    $('premium').textContent = '--';
    $('premiumSub').textContent = '等待数据...';
    $('intradayPrice').textContent = '--';
    $('intradaySub').textContent = '--';
    $('estNav').textContent = '--';
    $('navSub').textContent = '--';
    $('trackerPrice').textContent = '--';
    $('trackerSub').textContent = '--';
    $('status').textContent = '加载中 ' + fund.name + '...';
  }

  function renderStatus(errors) {
    const parts = [];
    parts.push('更新于 ' + fmtTime(Date.now()));
    if (state.tracker) {
      let src;
      if (state.tracker.source === 'sina-proxy') src = '沪银主力(代理)';
      else if (state.tracker.source === 'tencent-composite') src = '外盘组合(直连)';
      else if (state.tracker.source === 'tencent-fx') src = '外盘(降级)';
      parts.push('标的数据源: ' + src);
    }
    if (!isTradingTime()) {
      parts.push(marketClosed() ? '今日已收盘' : '休市中');
    }
    if (errors.length) parts.push('警告: ' + errors.join(' | '));
    $('status').textContent = parts.join(' · ');
  }

  // ---------- charts ----------

  async function initMinuteFromTencent() {
    try {
      const data = await DS.getMinuteData(FUNDS[state.fundCode]);
      state.minute = data.map(d => ({
        t: d.t.slice(0, 2) + ':' + d.t.slice(2, 4),
        price: d.price,
        estNav: null,
        premium: null
      }));
      renderMinuteChart();
    } catch (e) {}
  }

  function initCharts() {
    if (window.echarts) {
      minuteChart = echarts.init(minuteChartEl);
      historyChart = echarts.init(historyChartEl);
      window.addEventListener('resize', () => {
        minuteChart && minuteChart.resize();
        historyChart && historyChart.resize();
      });
    } else {
      minuteChartEl.innerHTML = '<div class="chart-placeholder">图表库加载失败，请检查网络</div>';
      historyChartEl.innerHTML = '<div class="chart-placeholder">图表库加载失败，请检查网络</div>';
    }
  }

  function renderMinuteChart() {
    if (!minuteChart) return;
    const data = state.minute;
    const option = {
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { data: ['场内价', '估算净值', '溢价率'], textStyle: { color: '#8a93a6' } },
      grid: { left: 50, right: 55, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: data.map(d => d.t),
        axisLabel: { color: '#8a93a6' },
        axisLine: { lineStyle: { color: '#2a3550' } }
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#8a93a6', formatter: (v) => v.toFixed(3) },
          splitLine: { lineStyle: { color: '#2a3550' } }
        },
        {
          type: 'value',
          scale: true,
          axisLabel: { color: '#8a93a6', formatter: (v) => v.toFixed(2) + '%' },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: '场内价',
          type: 'line',
          data: data.map(d => d.price),
          symbol: 'none',
          lineStyle: { width: 1.5 },
          itemStyle: { color: '#4c8dff' }
        },
        {
          name: '估算净值',
          type: 'line',
          data: data.map(d => d.estNav),
          symbol: 'none',
          lineStyle: { width: 1.5, type: 'dashed' },
          itemStyle: { color: '#c792ea' }
        },
        {
          name: '溢价率',
          type: 'line',
          yAxisIndex: 1,
          data: data.map(d => d.premium),
          symbol: 'none',
          lineStyle: { width: 1.5 },
          itemStyle: { color: '#34c77b' }
        }
      ]
    };
    minuteChart.setOption(option);
  }

  async function loadHistory() {
    if (!historyChart) return;
    const fund = FUNDS[state.fundCode];
    const placeholder = () => {
      historyChartEl.innerHTML = '<div class="chart-placeholder">历史数据加载失败</div>';
    };
    try {
      const [kline, navList] = await Promise.all([
        DS.getDailyKline(fund, 120),
        DS.getNavHistory(fund)
      ]);
      const navMap = {};
      navList.forEach(n => { navMap[n.date] = n.nav; });
      const today = todayStr();
      const rows = kline.filter(k => !(k.date === today && !marketClosed()))
        .map(k => {
          const nav = navMap[k.date];
          return nav ? { date: k.date, premium: (k.close / nav - 1) * 100 } : null;
        })
        .filter(Boolean);

      const colors = rows.map(r => (r.premium >= 0 ? '#f2554f' : '#34c77b'));
      const option = {
        tooltip: {
          trigger: 'axis',
          formatter: (p) => {
            const r = rows[p[0].dataIndex];
            return r.date + '<br/>溢价率: ' + (r.premium >= 0 ? '+' : '') + r.premium.toFixed(2) + '%';
          }
        },
        grid: { left: 50, right: 16, top: 20, bottom: 30 },
        xAxis: {
          type: 'category',
          data: rows.map(r => r.date.slice(5)),
          axisLabel: { color: '#8a93a6' },
          axisLine: { lineStyle: { color: '#2a3550' } }
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#8a93a6', formatter: (v) => v.toFixed(1) + '%' },
          splitLine: { lineStyle: { color: '#2a3550' } }
        },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16 }],
        series: [{
          name: '溢价率',
          type: 'bar',
          data: rows.map((r, i) => ({ value: r.premium, itemStyle: { color: colors[i] } })),
          barMaxWidth: 8
        }]
      };
      historyChart.setOption(option);
    } catch (e) {
      placeholder();
    }
  }

  // ---------- boot ----------

  $('saveAlert').addEventListener('click', saveAlert);
  initNotify();
  initCharts();
  state.fundCode = resolveInitialFund();
  initSelect();
  loadAlert();
  renderAll();
  loadHistory();
  initMinuteFromTencent();
  refreshQuote();
  scheduleRefresh();

  // 供「红利股息率」tab 切换协调：切换时暂停/恢复轮询、重绘图表
  window.__premiumControl = {
    pause() { if (timer) { clearInterval(timer); timer = null; } },
    resume() { scheduleRefresh(); },
    resize() {
      requestAnimationFrame(() => {
        minuteChart && minuteChart.resize();
        historyChart && historyChart.resize();
      });
    }
  };
})();