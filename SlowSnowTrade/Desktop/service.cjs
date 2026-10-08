const fs = require('node:fs/promises');
const path = require('node:path');
const WebSocket = require('ws');
const SSEParser=require('./sse.cjs');
const SYMBOL = /^[A-Z0-9]{1,25}USDT$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const intervals = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D', '2d': '1D', '1w': '1D' };
const marketInterval = interval => ['2d','1w'].includes(interval) ? '1d' : interval;
const sourceOf = source => source === 'bitget' ? 'bitget' : 'binance';
const symbolsOf = values => [...new Set(Array.isArray(values) ? values.filter(s => typeof s === 'string' && SYMBOL.test(s)) : [])].slice(0, 200);
const rowsOf = object => object?.code === '00000' && Array.isArray(object.data) ? object.data : [];
const urlFor = (base, parameters) => `${base}?${new URLSearchParams(parameters)}`;

class DesktopService {
  constructor(options) {
    Object.assign(this, options);
    this.dataPath = path.join(options.desktop, 'deepseek/SlowSnowTrade');
    this.tradeLogPath = path.join(options.desktop, 'VScode/SlowSnowTrade/tradelog');
    this.keyPath = path.join(options.userData, 'deepseek-key.enc');
    this.disk = Promise.resolve();
    this.configs = new Map(); this.tiers = new Map(); this.tierAt = new Map();
    this.pendingTiers = new Set(); this.sentRules = new Map(); this.riskSymbols = [];
    this.riskGeneration = 0; this.controllers = new Set(); this.generation = 0; this.closed = false;
  }
  async initialize() {
    await fs.mkdir(this.dataPath, { recursive: true });
    await fs.mkdir(this.tradeLogPath, { recursive: true });
    await fs.mkdir(this.userData, { recursive: true });
    this.riskTimer = setInterval(() => this.fetchRisk().catch(error => this.emit('contractRiskError', { message: error.message })), 1000);
  }
  async request(url, options = {}, timeout = 12000) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  async readJSON(filename, fallback = {}) {
    try { return JSON.parse(await fs.readFile(path.join(this.dataPath, filename), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') this.emit('storageError', { message: `${filename} 读取失败，原文件已保留` }); return fallback; }
  }
  // Serialize disk changes; replace complete files atomically to survive interrupted saves.
  enqueue(operation) {
    const next = this.disk.then(operation); this.disk = next.catch(() => {}); return next;
  }
  async atomic(filename, content) {
    const temporary = `${filename}.tmp`;
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, filename);
  }
  async writeJSON(filename, object) {
    await this.enqueue(() => this.atomic(path.join(this.dataPath, filename), JSON.stringify(object, null, 2)));
    if (filename === 'state.json' || filename.startsWith('analysis-')) this.scheduleExport();
  }
  async record(record) {
    await this.enqueue(() => fs.appendFile(path.join(this.dataPath, 'training-data.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 }));
    this.scheduleExport();
  }
  async analyses() {
    const result = {};
    for (const name of await fs.readdir(this.dataPath)) {
      if (!/^analysis-[A-Za-z0-9_-]+\.json$/.test(name)) continue;
      const record = await this.readJSON(name, null);
      if (record && typeof record.id === 'string' && typeof record.analysis === 'string') result[record.id] = record;
    }
    return result;
  }
  keyAvailable() { return this.safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || this.safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
  async key() {
    if (!this.keyAvailable()) return '';
    try { return this.safeStorage.decryptString(await fs.readFile(this.keyPath)); }
    catch (error) { if (error.code !== 'ENOENT') this.emit('storageError', { message: '无法读取系统加密的 API Key，请在 Agent 面板重新保存' }); return ''; }
  }
  async saveKey(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 1024) throw new Error('请输入有效的 API Key');
    if (!this.keyAvailable()) throw new Error('系统安全存储不可用，无法保存 API Key');
    const encrypted = this.safeStorage.encryptString(key.trim());
    await this.enqueue(() => this.atomic(this.keyPath, encrypted));
    this.emit('keyStatus', { saved: true, storageLabel: process.platform === 'win32' ? 'Windows 加密存储' : '系统安全存储' });
  }
  scheduleExport() {
    if (this.exportTimer || this.closed) return;
    this.exportTimer = setTimeout(() => {
      this.exportTimer = null;
      this.enqueue(() => this.exportTradeLog()).catch(error => this.emit('storageError', { message: `tradelog 同步失败：${error.message}` }));
    }, 500);
  }
  async exportTradeLog() {
    const state = await this.readJSON('state.json'); const analyses = await this.analyses();
    const trades = Array.isArray(state?.account?.history) ? state.account.history : [];
    let text = '# 小雪交易 · Trade Log\n\n逐单账单与 DeepSeek 复盘。\n\n更新：' + new Date().toISOString() + '\n\n';
    if (!trades.length && !Object.keys(analyses).length) text += '暂无已平仓账单或复盘。可在 App 历史交易中点击分析。\n';
    const included = new Set();
    for (const trade of trades) {
      included.add(trade.id);
      text += `## ${trade.symbol} · ${trade.side === 'long' ? '做多' : '做空'}\n\n- 账单：${trade.id}\n- 平仓时间：${Number.isFinite(trade.closedAt) ? new Date(trade.closedAt).toISOString() : trade.closedAt}\n- 数量：${trade.qty}\n- 开仓 / 平仓：${trade.entry} / ${trade.exit}\n- 保证金：${trade.margin} USDT · 杠杆：${trade.leverage}×\n- 净盈亏：${trade.netPnL} USDT · 原因：${trade.reason}\n\n### DeepSeek 复盘\n\n${analyses[trade.id]?.analysis || '尚未生成复盘。可在 App 历史交易中点击分析。'}\n\n---\n\n`;
    }
    for (const [id, review] of Object.entries(analyses)) if (!included.has(id)) text += `## 历史复盘 · ${id}\n\n${review.analysis}\n\n---\n\n`;
    await this.atomic(path.join(this.tradeLogPath, 'tradelog.md'), text);
    await this.atomic(path.join(this.tradeLogPath, 'trades.json'), JSON.stringify(trades, null, 2));
    for (const name of await fs.readdir(this.dataPath)) {
      if (/^analysis-[A-Za-z0-9_-]+\.json$/.test(name) || name === 'training-data.jsonl')
        await fs.copyFile(path.join(this.dataPath, name), path.join(this.tradeLogPath, name));
    }
    const archive = path.join(this.dataPath, 'analysis-history');
    let names = []; try { names = await fs.readdir(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (names.length) {
      const target = path.join(this.tradeLogPath, 'analysis-history'); await fs.mkdir(target, { recursive: true });
      for (const name of names.filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n))) {
        try { await fs.copyFile(path.join(archive, name), path.join(target, name), require('node:fs').constants.COPYFILE_EXCL); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    }
  }
  async openTradeLog() {
    try {
      await this.enqueue(() => this.exportTradeLog());
      const error = await this.shell.openPath(this.tradeLogPath); if (error) throw new Error(error);
    } catch (error) { this.emit('storageError', { message: error.message }); }
  }
  async fetchKlines(message) {
    const { symbol, interval, requestId } = message;
    if (!SYMBOL.test(symbol) || !intervals[interval]) return;
    const limit = marketInterval(interval) !== interval ? '1000' : '500';
    const sources = message.source === 'auto' ? ['bitget', 'binance'] : [sourceOf(message.source)];
    try {
      const data = await Promise.any(sources.map(async source => {
        const url = source === 'bitget' ? urlFor('https://api.bitget.com/api/v3/market/candles', { category: 'SPOT', symbol, interval: intervals[interval], limit }) : urlFor('https://data-api.binance.vision/api/v3/klines', { symbol, interval: marketInterval(interval), limit });
        const object = await this.request(url); const rows = source === 'bitget' ? rowsOf(object) : object;
        if (!Array.isArray(rows) || !rows.length) throw new Error('行情源未返回 K 线');
        return { source, symbol, interval, requestId, rows };
      }));
      this.emit('marketSnapshot', data);
    } catch (error) { this.emit('marketError', { symbol, requestId, message: error.errors?.map(e => e.message).join(' / ') || error.message }); }
  }
  async fetchSymbols(message) {
    const source = sourceOf(message.source);
    const object = await this.request(source === 'bitget' ? 'https://api.bitget.com/api/v3/market/instruments?category=SPOT' : 'https://data-api.binance.vision/api/v3/exchangeInfo');
    const items = source === 'bitget' ? rowsOf(object) : object.symbols;
    if (!Array.isArray(items)) throw new Error('币种列表暂不可用');
    const pairs = items.filter(i => SYMBOL.test(i.symbol) && (source === 'bitget' ? i.quoteCoin === 'USDT' && i.status === 'online' : i.quoteAsset === 'USDT' && i.status === 'TRADING')).map(i => ({ id: i.symbol, base: (source === 'bitget' ? i.baseCoin : i.baseAsset) || '' }));
    this.emit('symbols', { source, pairs });
    await this.fetchTopSymbols({ source, onlyQuotes: true });
  }
  async fetchTopSymbols(message) {
    const source = sourceOf(message.source);
    const object = await this.request(source === 'bitget' ? 'https://api.bitget.com/api/v3/market/tickers?category=SPOT' : 'https://data-api.binance.vision/api/v3/ticker/24hr');
    const items = source === 'bitget' ? rowsOf(object) : object;
    if (!Array.isArray(items)) throw new Error('热门币种暂不可用');
    const pairs = items.filter(i => SYMBOL.test(i.symbol));
    this.emit('discoveryQuotes', { source, quotes: pairs.filter(i => Number(i.lastPrice) > 0).map(i => ({ symbol: i.symbol, price: Number(i.lastPrice), change: source === 'bitget' ? Number(i.price24hPcnt) * 100 : Number(i.priceChangePercent) })) });
    if (message.onlyQuotes) return;
    const key = source === 'bitget' ? 'turnover24h' : 'quoteVolume';
    this.emit('topSymbols', { source, pairs: pairs.sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, 40).map(i => ({ id: i.symbol, base: i.symbol.slice(0, -4) })) });
  }
  async fetchSeedTags() {
    const cached = await this.readJSON('seed-tags.json', null);
    if (cached) this.emit('seedTags', { ...cached, cached: true });
    try {
      const object = await this.request('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true');
      if (!Array.isArray(object.data)) throw new Error('种子标签暂不可用');
      const tags = {};
      for (const i of object.data) if (SYMBOL.test(i.s) && i.q === 'USDT' && i.st === 'TRADING') {
        const labels = Array.isArray(i.tags) ? i.tags : [];
        tags[i.s] = { seed: labels.includes('Seed'), tags: labels, name: i.an || i.b || '', source: 'Binance' };
      }
      if (!Object.keys(tags).length) throw new Error('种子标签暂不可用');
      const data = { tags, fetchedAt: Date.now() / 1000, cached: false };
      await this.writeJSON('seed-tags.json', data); this.emit('seedTags', data);
    } catch (error) { if (!cached) this.emit('seedTagsError', { message: error.message }); }
  }
  emitRules(symbol) {
    const c = this.configs.get(symbol), tiers = this.tiers.get(symbol); if (!c || !tiers?.length) return;
    const rules = { symbol, source: 'bitget', tiers, feeRate: c.takerFeeRate || '0.0006', makerFeeRate: c.makerFeeRate || '0.0002', maxLeverage: c.maxLever || '100', minQty: c.minTradeNum || '0', qtyStep: c.sizeMultiplier || '0', minNotional: c.minTradeUSDT || '5', status: c.symbolStatus || 'normal' };
    const json = JSON.stringify(rules); if (this.sentRules.get(symbol) === json) return;
    this.sentRules.set(symbol, json); this.emit('contractRules', rules);
  }
  async fetchRisk() {
    if (this.closed || !this.riskSymbols.length) return;
    const symbols = [...this.riskSymbols]; const now = Date.now();
    this.startRiskStream(symbols);
    if (!this.configBusy && now - (this.configAt || 0) > 21600000) {
      this.configBusy = true;
      this.request('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES').then(object => {
        const items = rowsOf(object); if (!items.length) throw new Error('合约配置暂不可用');
        this.configs = new Map(items.filter(i => SYMBOL.test(i.symbol)).map(i => [i.symbol, i])); this.configAt = Date.now();
        symbols.forEach(s => this.emitRules(s));
      }).catch(() => { this.configAt = Date.now() - 21540000; }).finally(() => { this.configBusy = false; });
    }
    let index = 0;
    for (const symbol of symbols) {
      this.emitRules(symbol);
      if (this.pendingTiers.has(symbol) || now - (this.tierAt.get(symbol) || 0) < 21600000) continue;
      this.pendingTiers.add(symbol);
      setTimeout(async () => {
        if (this.closed) return;
        try {
          const tiers = rowsOf(await this.request(urlFor('https://api.bitget.com/api/v2/mix/market/query-position-lever', { productType: 'USDT-FUTURES', symbol })));
          if (!tiers.length) throw new Error('无合约档位');
          this.tiers.set(symbol, tiers); this.tierAt.set(symbol, Date.now()); this.emitRules(symbol);
        } catch { this.tierAt.set(symbol, Date.now() - 21540000); }
        finally { this.pendingTiers.delete(symbol); }
      }, index++ * 150);
    }
    if (this.priceBusy) return; this.priceBusy = true;
    try {
      const items = rowsOf(await this.request('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES'));
      if (!items.length) throw new Error('合约标记价暂不可用');
      const quotes = items.filter(i => symbols.includes(i.symbol) && Number(i.markPrice) > 0).map(i => ({ symbol: i.symbol, mark: i.markPrice, last: i.lastPr || i.markPrice, bid: i.bidPr || 0, ask: i.askPr || 0, time: i.ts || 0 }));
      this.emit('contractRiskSnapshot', { source: 'bitget', quotes, requestedSymbols: symbols, receivedAt: Date.now() });
    } finally { this.priceBusy = false; }
  }
  stopRiskStream() {
    this.riskGeneration++;clearInterval(this.riskPingTimer);clearTimeout(this.riskReconnectTimer);
    if(this.riskSocket){this.riskSocket.removeAllListeners();this.riskSocket.on('error',()=>{});this.riskSocket.terminate();this.riskSocket=null;}
  }
  startRiskStream(symbols) {
    const key=[...symbols].sort().join(',');
    if(this.riskKey===key && ((this.riskSocket && Date.now()-this.riskActivity<60000)||this.riskReconnectTimer))return;
    this.stopRiskStream();this.riskReconnectTimer=null;if(this.closed||!symbols.length)return;
    this.riskKey=key;this.riskActivity=Date.now();const generation=this.riskGeneration;
    const socket=this.riskSocket=new WebSocket('wss://ws.bitget.com/v2/ws/public',{handshakeTimeout:12000,maxPayload:2*1024*1024});
    socket.on('open',()=>{
      socket.send(JSON.stringify({op:'subscribe',args:symbols.map(instId=>({instType:'USDT-FUTURES',channel:'ticker',instId}))}));
      this.riskPingTimer=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send('ping');},25000);
    });
    socket.on('message',buffer=>{
      if(this.closed||generation!==this.riskGeneration)return;
      const text=buffer.toString();this.riskActivity=Date.now();if(text==='pong')return;
      let payload;try{payload=JSON.parse(text);}catch{return;}
      const symbol=payload.arg?.instId;if(payload.arg?.channel!=='ticker'||!this.riskSymbols.includes(symbol))return;
      const quotes=(Array.isArray(payload.data)?payload.data:[]).filter(row=>Number(row.markPrice)>0&&Number(row.lastPr)>0).map(row=>({symbol,mark:row.markPrice,last:row.lastPr,bid:row.bidPr,ask:row.askPr,time:row.ts||payload.ts}));
      if(quotes.length)this.emit('contractRiskSnapshot',{source:'bitget',quotes,receivedAt:Date.now()});
    });
    socket.on('error',()=>{}); // REST stays active while the public stream reconnects.
    socket.on('close',()=>{
      if(this.closed||generation!==this.riskGeneration)return;
      clearInterval(this.riskPingTimer);this.riskSocket=null;
      this.riskReconnectTimer=setTimeout(()=>{this.riskReconnectTimer=null;if(generation===this.riskGeneration)this.startRiskStream(this.riskSymbols);},3000);
    });
  }
  stopStream() {
    this.generation++; clearInterval(this.pingTimer); clearTimeout(this.reconnectTimer);
    if (this.socket) { this.socket.removeAllListeners(); this.socket.on('error', () => {}); this.socket.terminate(); this.socket = null; }
  }
  startStream(message) {
    this.stopStream(); const symbols = symbolsOf(message.symbols).slice(0, 20), interval = message.interval, source = sourceOf(message.source);
    if (!symbols.length || !intervals[interval] || this.closed) return;
    const generation = this.generation;
    const url = source === 'bitget' ? 'wss://ws.bitget.com/v3/ws/public' : 'wss://data-stream.binance.vision/stream?streams=' + symbols.map(s => `${s.toLowerCase()}@kline_${marketInterval(interval)}`).join('/');
    const socket = this.socket = new WebSocket(url, { handshakeTimeout: 12000, maxPayload: 2 * 1024 * 1024 });
    socket.on('open', () => {
      if (source === 'bitget') {
        socket.send(JSON.stringify({ op: 'subscribe', args: symbols.map(symbol => ({ instType: 'spot', topic: 'kline', symbol, interval: intervals[interval] })) }));
        this.pingTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping'); }, 25000);
      }
    });
    socket.on('message', buffer => {
      if (generation !== this.generation || this.closed) return;
      let payload; try { payload = JSON.parse(buffer.toString()); } catch { return; }
      let tick;
      if (source === 'bitget') {
        const row = payload.data?.[0], symbol = payload.arg?.symbol;
        if (symbols.includes(symbol) && row && !Array.isArray(row)) tick = { source, i: marketInterval(interval), s: symbol, t: row.start, o: row.open, h: row.high, l: row.low, c: row.close, v: row.volume };
      } else { const k = (payload.data || payload).k; if (k && symbols.includes(k.s)) tick = { ...k, source }; }
      if (tick) { this.emit('marketTick', tick); this.emit('streamState', { connected: true }); }
    });
    socket.on('error', () => { if (generation === this.generation) this.emit('streamState', { connected: false, message: '实时流连接异常，正在重连' }); });
    socket.on('close', () => {
      if (generation !== this.generation || this.closed) return;
      clearInterval(this.pingTimer); this.emit('streamState', { connected: false, message: '实时流正在重连' });
      this.reconnectTimer = setTimeout(() => { if (generation === this.generation) this.startStream(message); }, 3000);
    });
  }
  async fetchAnalysisContext(message) {
    const trade = message.trade, symbol = trade?.symbol;
    if (!SYMBOL.test(symbol) || typeof message.requestId !== 'string') return;
    const interval = intervals[message.interval] ? message.interval : '15m', now = Date.now();
    const jobs = [
      { purpose: 'entry', symbol, interval, endTime: trade.openedAt || now },
      { purpose: 'exit', symbol, interval, endTime: trade.closedAt || now },
      { purpose: 'current', symbol, interval, endTime: now },
      { purpose: 'hourly', symbol, interval: '1h', endTime: now },
      { purpose: 'fourHourly', symbol, interval: '4h', endTime: now }
    ];
    if (symbol !== 'BTCUSDT') jobs.push({ purpose: 'bitcoin', symbol: 'BTCUSDT', interval: '1h', endTime: now });
    const datasets = await Promise.all(jobs.map(async job => {
      const result = { ...job, sourceInterval: marketInterval(job.interval), source: 'Bitget', category: 'USDT-FUTURES', rows: [] };
      try {
        const old = now - Number(job.endTime) > 89 * 86400000;
        result.rows = rowsOf(await this.request(urlFor('https://api.bitget.com/api/v3/market/' + (old ? 'history-candles' : 'candles'), { category: 'USDT-FUTURES', symbol: job.symbol, interval: intervals[job.interval], endTime: String(Math.round(Number(job.endTime))), limit: old ? '100' : marketInterval(job.interval) !== job.interval ? '1000' : '200' })));
        if (!result.rows.length) result.error = '该时段未返回合约 K 线';
      } catch (error) { result.error = error.message; }
      return result;
    }));
    if (symbol === 'BTCUSDT') datasets.push({ ...datasets.find(d => d.purpose === 'hourly'), purpose: 'bitcoin' });
    this.emit('analysisContext', { requestId: message.requestId, tradeId: trade.id || '', datasets });
  }
  async analyze(message) {
    const trade=message.trade;
    if(!trade||!ID.test(trade.id))throw new Error('账单编号无效');
    this.analysisInFlight??=new Set();if(this.analysisInFlight.has(trade.id)||this.analysisInFlight.size>=2)throw new Error('已有复盘正在生成，请完成后重试');
    this.analysisInFlight.add(trade.id);
    try {
      const sample=message.sample||{trade,market:message.market||[]},prompt=await fs.readFile(this.promptPath,'utf8');let content='',finish=null;
      await this.streamAgent({messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(sample)}]},chunk=>{
        const choice=chunk.choices?.[0],text=choice?.delta?.content;if(typeof text==='string'&&text){content+=text;this.emit('analysisDelta',{id:trade.id,text});}if(choice?.finish_reason)finish=choice.finish_reason;
      },'review');
      if(!content.trim()||!finish)throw new Error('DeepSeek 未返回完整复盘');
      const record={id:trade.id,createdAt:Date.now()/1000,analysis:content,trade,promptVersion:3,model:'deepseek-v4-pro',reasoningEffort:'max',sample,truncated:finish==='length'},filename=`analysis-${trade.id}.json`;
      await this.enqueue(async()=>{const archive=path.join(this.dataPath,'analysis-history');try{await fs.access(path.join(this.dataPath,filename));await fs.mkdir(archive,{recursive:true});await fs.copyFile(path.join(this.dataPath,filename),path.join(archive,`${Date.now()}-${filename}`));}catch(error){if(error.code!=='ENOENT')throw error;}await this.atomic(path.join(this.dataPath,filename),JSON.stringify(record,null,2));});
      await this.record({type:'analysis',data:record});this.emit('analysis',record);
    }finally{this.analysisInFlight.delete(trade.id);}
  }
  async streamAgent(body,onData,kind='chat') {
    const key=await this.key();if(!key)throw new Error('请先保存 DeepSeek API Key');
    const controller=new AbortController();this.controllers.add(controller);if(kind==='chat')this.chatController=controller;
    const timeout=setTimeout(()=>controller.abort(),900000);
    try {
      const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({...body,model:'deepseek-v4-pro',thinking:{type:'enabled'},reasoning_effort:'max',stream:true}),signal:controller.signal});
      if(!response.ok)throw new Error(`DeepSeek HTTP ${response.status}，请检查 Key、余额或模型权限`);
      const parser=new SSEParser(onData);for await(const chunk of response.body)parser.feed(chunk);parser.finish();
    } finally {clearTimeout(timeout);this.controllers.delete(controller);if(this.chatController===controller)this.chatController=null;}
  }
  async askAgent(message) {
    if(this.chatBusy)throw new Error('请等待上一个问题完成');
    if(!ID.test(message.id||'')||typeof message.question!=='string'||!message.question.trim()||message.question.length>2000||!Array.isArray(message.messages)||Buffer.byteLength(JSON.stringify(message.messages))>8*1024*1024||!Array.isArray(message.tools)||message.tools.length>12)throw new Error('Agent 请求格式错误或上下文过大');
    this.chatBusy=true;this.chatId=message.id;
    try {
      const prompt=await fs.readFile(path.join(path.dirname(this.promptPath),'chat-system-prompt.txt'),'utf8');
      const messages=[{role:'system',content:prompt},...message.messages.filter(m=>['user','assistant','tool'].includes(m.role))];
      await this.streamAgent({messages,tools:message.tools},chunk=>this.emit('agentDelta',{id:message.id,round:message.round,chunk}));
      this.emit('agentStreamEnd',{id:message.id,round:message.round});
    } finally {this.chatBusy=false;}
  }
  async saveAgent(message) {
    const record=message.record;if(!ID.test(record?.id||'')||typeof record.question!=='string'||typeof record.answer!=='string'||Buffer.byteLength(JSON.stringify(record))>2*1024*1024)throw new Error('对话记录无效或过大');
    await this.enqueue(async()=>{
      const history=await this.readJSON('agent-chat.json',[]),records=[...(Array.isArray(history)?history:[]).filter(x=>x.id!==record.id),record].slice(-200);
      await this.atomic(path.join(this.dataPath,'agent-chat.json'),JSON.stringify(records,null,2));
      const text='# 小雪 Agent 对话\n\n'+records.map(x=>`## ${new Date(Number(x.createdAt)>1e12?Number(x.createdAt):Number(x.createdAt)*1000).toISOString()}\n\n### 问题\n\n${x.question}\n\n### 回答\n\n${x.answer}\n\n### 工具执行\n\n${JSON.stringify(x.tools||[],null,2)}\n`).join('\n');
      await this.atomic(path.join(this.tradeLogPath,'agent-chat.md'),text);
    });this.emit('agentAnswer',record);
  }
  async agentTraining(message) {
    if(!ID.test(message.id||'')||!ID.test(message.callId||''))return;
    const limit=Math.max(1,Math.min(30,Number(message.limit)||8));
    let file;try{file=await fs.open(path.join(this.dataPath,'training-data.jsonl'),'r');const info=await file.stat(),size=Math.min(info.size,256*1024),bytes=Buffer.alloc(size);await file.read(bytes,0,size,info.size-size);let lines=bytes.toString('utf8').split('\n');if(info.size>size)lines.shift();
      const samples=lines.filter(Boolean).slice(-limit).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
      this.emit('agentTrainingData',{id:message.id,callId:message.callId,samples});
    }catch{this.emit('agentTrainingData',{id:message.id,callId:message.callId,samples:[],message:'暂无可读取的训练记录'});}finally{await file?.close();}
  }
  async dispatch(message) {
    if (this.closed || !message || typeof message !== 'object' || typeof message.type !== 'string') return;
    try {
      if (Buffer.byteLength(JSON.stringify(message)) > 20 * 1024 * 1024) throw new Error('数据体积过大');
      switch (message.type) {
        case 'ready':
          this.emit('initialState', { state: await this.readJSON('state.json'), hasKey: !!(await this.key()), dataPath: this.dataPath, tradeLogPath: this.tradeLogPath, analyses: await this.analyses(), agentChat:await this.readJSON('agent-chat.json',[]) }); this.scheduleExport(); break;
        case 'fetchKlines': await this.fetchKlines(message); break;
        case 'fetchSymbols': await this.fetchSymbols(message); break;
        case 'fetchTopSymbols': await this.fetchTopSymbols(message); break;
        case 'fetchDiscoveryQuotes': await this.fetchTopSymbols({ ...message, onlyQuotes: true }); break;
        case 'fetchSeedTags': await this.fetchSeedTags(); break;
        case 'fetchContractRisk': this.riskSymbols = symbolsOf(message.symbols); await this.fetchRisk(); break;
        case 'stream': this.startStream(message); break;
        case 'saveState': if (message.state && typeof message.state === 'object') await this.writeJSON('state.json', message.state); break;
        case 'record': if (message.record && typeof message.record === 'object') await this.record(message.record); break;
        case 'saveMarket':
          if (SYMBOL.test(message.symbol) && intervals[message.interval]) await this.writeJSON(`market-${sourceOf(message.source)}-${message.symbol}-${message.interval}.json`, { symbol: message.symbol, interval: message.interval, source: sourceOf(message.source), candles: Array.isArray(message.candles) ? message.candles : [] }); break;
        case 'saveKey': await this.saveKey(message.key); break;
        case 'fetchAnalysisContext': await this.fetchAnalysisContext(message); break;
        case 'analyze': await this.analyze(message); break;
        case 'askAgent': await this.askAgent(message); break;
        case 'cancelAgent': if(message.id===this.chatId)this.chatController?.abort(); break;
        case 'saveAgentConversation': await this.saveAgent(message); break;
        case 'agentReadTraining': await this.agentTraining(message); break;
        case 'openTradeLog': await this.openTradeLog(); break;
      }
    } catch (error) {
      const types = { askAgent:'agentError', saveAgentConversation:'agentSaveError', analyze: 'analysisError', saveKey: 'keyStatus', fetchSymbols: 'symbolsError', fetchTopSymbols: 'topSymbolsError', fetchDiscoveryQuotes: 'topSymbolsError', fetchContractRisk: 'contractRiskError' };
      this.emit(types[message.type] || 'storageError', { id: message.type==='askAgent'?message.id:message.record?.id||message.trade?.id || '', round:message.round, message: error.message, error: error.message, saved: false });
    }
  }
  close() {
    if (this.closed) return this.disk;
    this.closed = true; clearInterval(this.riskTimer); this.stopStream(); this.stopRiskStream();
    for (const controller of this.controllers) controller.abort();
    clearTimeout(this.exportTimer); this.exportTimer = null;
    return this.enqueue(() => this.exportTradeLog()).catch(error => this.emit('storageError', { message: error.message }));
  }
}
module.exports = DesktopService;
