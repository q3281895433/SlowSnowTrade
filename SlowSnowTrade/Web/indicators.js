(function () {
  function sma(values, period) {
    let sum = 0;
    return values.map((value, index) => {
      sum += value;
      if (index >= period) sum -= values[index - period];
      return index + 1 < period ? null : sum / period;
    });
  }
  function ema(values, period) {
    const alpha = 2 / (period + 1); let last = null;
    return values.map(value => { last = last === null ? value : alpha * value + (1 - alpha) * last; return last; });
  }
  function bollinger(values, period = 20) {
    const middle = sma(values, period);
    return middle.map((value, index) => {
      if (value === null) return null;
      const sample = values.slice(index - period + 1, index + 1);
      const deviation = Math.sqrt(sample.reduce((sum, price) => sum + (price - value) ** 2, 0) / period);
      return { middle: value, upper: value + deviation * 2, lower: value - deviation * 2 };
    });
  }
  function macd(values) {
    const fast = ema(values, 12), slow = ema(values, 26);
    const dif = values.map((_, index) => fast[index] - slow[index]);
    const dea = ema(dif, 9);
    return values.map((_, index) => ({ dif: dif[index], dea: dea[index], histogram: (dif[index] - dea[index]) * 2 }));
  }
  function rsi(values, period = 14) {
    let gain = 0, loss = 0;
    return values.map((value, index) => {
      if (index === 0) return null;
      const change = value - values[index - 1];
      if (index <= period) { gain += Math.max(change, 0); loss += Math.max(-change, 0); if (index === period) { gain /= period; loss /= period; } }
      else { gain = (gain * (period - 1) + Math.max(change, 0)) / period; loss = (loss * (period - 1) + Math.max(-change, 0)) / period; }
      if (index < period) return null;
      return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    });
  }
  function vwap(candles) {
    let value = 0, volume = 0;
    return candles.map(candle => { const typical = (candle.high + candle.low + candle.close) / 3; value += typical * candle.volume; volume += candle.volume; return volume ? value / volume : candle.close; });
  }
  function kdj(candles, period = 9) {
    let k = 50, d = 50;
    return candles.map((candle, index) => {
      const sample = candles.slice(Math.max(0, index - period + 1), index + 1);
      const high = Math.max(...sample.map(item => item.high)), low = Math.min(...sample.map(item => item.low));
      const rsv = high === low ? 50 : (candle.close - low) / (high - low) * 100;
      k = (2 * k + rsv) / 3; d = (2 * d + k) / 3;
      return { k, d, j: 3 * k - 2 * d };
    });
  }
  function atr(candles, period = 14) {
    let average = 0;
    return candles.map((candle, index) => {
      const previous = index ? candles[index - 1].close : candle.close;
      const range = Math.max(candle.high - candle.low, Math.abs(candle.high - previous), Math.abs(candle.low - previous));
      average = index < period ? (average * index + range) / (index + 1) : (average * (period - 1) + range) / period;
      return index + 1 < period ? null : average;
    });
  }
  function cci(candles, period = 20) {
    const typical = candles.map(c => (c.high + c.low + c.close) / 3), mean = sma(typical, period);
    return typical.map((value, index) => {
      if (mean[index] === null) return null;
      const deviation = typical.slice(index - period + 1, index + 1).reduce((sum, price) => sum + Math.abs(price - mean[index]), 0) / period;
      return deviation ? (value - mean[index]) / (.015 * deviation) : 0;
    });
  }
  function obv(candles) {
    let total = 0;
    return candles.map((candle, index) => { if (index) total += Math.sign(candle.close - candles[index - 1].close) * candle.volume; return total; });
  }
  class IndicatorChart {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.candles = []; this.view = null; this.type = 'macd'; this.cached = null; this.resizeObserver = new ResizeObserver(() => this.draw()); this.resizeObserver.observe(canvas); }
    dispose() { this.resizeObserver.disconnect(); }
    setData(candles, view, type) { const rows = candles || [], last = rows.at(-1), signature = [type, rows.length, last?.time, last?.close, last?.volume].join(':'); if (signature !== this.cacheKey) { this.cached = null; this.cacheKey = signature; } this.candles = rows; this.view = view; this.type = type; this.draw(); }
    computed(factory) { return this.cached || (this.cached = factory()); }
    draw() {
      const rect = this.canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
      if (!rect.width || !rect.height) return;
      if (this.canvas.width !== Math.round(rect.width * scale) || this.canvas.height !== Math.round(rect.height * scale)) { this.canvas.width = Math.round(rect.width * scale); this.canvas.height = Math.round(rect.height * scale); }
      const ctx = this.ctx, width = rect.width, height = rect.height;
      ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
      const view = this.view; if (!view || !this.candles.length || this.type === 'none') return;
      const top = 8, bottom = height - 18, plotHeight = bottom - top;
      const start = Math.max(0, view.startIndex), end = Math.min(this.candles.length - 1, view.endIndex);
      if (end < start) return;
      const plotLeft = view.left, plotWidth = view.chartW, localStep = view.step;
      const xAt = index => plotLeft + (index - view.startIndex + .5) * localStep;
      const line = (values, color, yAt) => { ctx.beginPath(); let started = false; for (let i = start; i <= end; i++) { const value = values[i]; if (value == null || !Number.isFinite(value)) { started = false; continue; } const x = xAt(i), y = yAt(value); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); } ctx.strokeStyle = color; ctx.lineWidth = 1.35; ctx.stroke(); };
      ctx.font = '11px -apple-system,sans-serif';
      if (this.type === 'macd') {
        const series = this.computed(() => macd(this.candles.map(c => c.close)));
        const values = series.slice(start, end + 1).flatMap(item => [item.dif, item.dea, item.histogram]);
        const range = Math.max(...values.map(Math.abs), .000001) * 1.15;
        const yAt = n => top + (range - n) / (range * 2) * plotHeight;
        ctx.strokeStyle = '#ffffff23'; ctx.beginPath(); ctx.moveTo(plotLeft, yAt(0)); ctx.lineTo(plotLeft + plotWidth, yAt(0)); ctx.stroke();
        for (let i = start; i <= end; i++) { const v = series[i].histogram; ctx.fillStyle = v >= 0 ? '#00e676aa' : '#ff6472aa'; const y = yAt(v), zero = yAt(0); ctx.fillRect(xAt(i) - Math.max(1, localStep * .28), Math.min(y, zero), Math.max(2, localStep * .56), Math.max(1, Math.abs(zero - y))); }
        line(series.map(v => v.dif), '#e8b36e', yAt); line(series.map(v => v.dea), '#b99bd6', yAt);
        ctx.fillStyle = '#9caea3'; ctx.fillText('DIF', 14, height - 5); ctx.fillStyle = '#e8b36e'; ctx.fillText('DEA', 46, height - 5);
      } else if (this.type === 'rsi') {
        const series = this.computed(() => rsi(this.candles.map(c => c.close))); const yAt = n => top + (100 - n) / 100 * plotHeight;
        for (const level of [30, 70]) { ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffffff27'; ctx.beginPath(); ctx.moveTo(plotLeft, yAt(level)); ctx.lineTo(plotLeft + plotWidth, yAt(level)); ctx.stroke(); ctx.fillStyle = '#a89d8b'; ctx.fillText(String(level), width - 42, yAt(level) - 4); } ctx.setLineDash([]);
        line(series, '#e8b36e', yAt);
      } else if (this.type === 'volume') {
        const maximum = Math.max(...this.candles.slice(start, end + 1).map(c => c.volume), 1);
        for (let i = start; i <= end; i++) { const candle = this.candles[i], barHeight = candle.volume / maximum * plotHeight; ctx.fillStyle = candle.close >= candle.open ? '#00e676aa' : '#ff6472aa'; ctx.fillRect(xAt(i) - Math.max(1, localStep * .32), bottom - barHeight, Math.max(2, localStep * .64), barHeight); }
      } else if (this.type === 'kdj') {
        const series = this.computed(() => kdj(this.candles)), yAt = n => top + (120 - n) / 140 * plotHeight;
        for (const level of [20, 80]) { ctx.strokeStyle = '#ffffff27'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(plotLeft, yAt(level)); ctx.lineTo(plotLeft + plotWidth, yAt(level)); ctx.stroke(); } ctx.setLineDash([]);
        line(series.map(v => v.k), '#e8b36e', yAt); line(series.map(v => v.d), '#b99bd6', yAt); line(series.map(v => v.j), '#00e676', yAt);
      } else if (this.type === 'atr' || this.type === 'cci' || this.type === 'obv') {
        const values = this.computed(() => this.type === 'atr' ? atr(this.candles) : this.type === 'cci' ? cci(this.candles) : obv(this.candles));
        const shown = values.slice(start, end + 1).filter(Number.isFinite);
        if (!shown.length) return;
        const low = this.type === 'atr' ? 0 : Math.min(...shown), high = Math.max(...shown);
        const gap = Math.max(high - low, Math.abs(high) * .05, .000001);
        const yAt = n => top + (high + gap * .1 - n) / (high - low + gap * .2) * plotHeight;
        if (this.type === 'cci') for (const level of [-100, 100]) { ctx.strokeStyle = '#ffffff27'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(plotLeft, yAt(level)); ctx.lineTo(plotLeft + plotWidth, yAt(level)); ctx.stroke(); } ctx.setLineDash([]);
        line(values, '#e8b36e', yAt);
      }
    }
  }
  function orderedToggle(list,name,checked) { return checked ? (list.includes(name)?list:[...list,name]) : list.filter(item=>item!==name); }
  window.PTIndicators = { orderedToggle, sma, ema, bollinger, macd, rsi, vwap, kdj, atr, cci, obv, IndicatorChart };
})();
