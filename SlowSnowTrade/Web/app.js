(function () {
  const $ = id => document.getElementById(id);
  const native = payload => window.SlowSnowDesktop ? window.SlowSnowDesktop.postMessage(payload) : window.webkit?.messageHandlers?.native?.postMessage(payload);
  const ledger = window.PTTrade;
  const defaults = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT'];
  const intervals = ['1m','5m','15m','1h','4h','1d'];
  const indicatorNames = { macd:'MACD · 12/26/9',rsi:'RSI · 14',kdj:'KDJ · 9',atr:'ATR · 14',cci:'CCI · 20',obv:'OBV',volume:'成交量' };
  const state = {
    symbol:'BTCUSDT',interval:'15m',source:'auto',activeSource:'binance',
    watchlist:defaults.slice(),symbols:defaults.map(id=>({id,base:id.slice(0,-4)})),
    account:ledger.createAccount(),prices:{},contractQuotes:{},riskModels:{},candles:[],lines:{},markers:{},boxes:{},riskZones:{},analyses:{},autoAnalyze:false,
    overlays:['ma20','ma50','ma100'],indicators:['macd'],leftTool:'trend',layout:{font:100,icon:34,indicatorHeight:150}
  };
  const chart = new window.PTChart($('chart'), $('crosshairChart'));
  const indicatorCharts = new Map();
  window.PTAppSymbol = () => state.symbol;
  let orderMode='open',selectedPosition=null,marginPosition=null,priceInitialized=false,discoveryPage=0,seedTags={},marketChanges={},tab='positions',selectedTrade=null,editLine=null,menuPoint=null,pendingTool=null;
  let loading=false,streamOk=false,lastTickAt=0,requestId=0,paintQueued=false,chartDirty=false,lastTablePaint=0,toastTimer,paintedSymbol='',symbolsForSource='';
  let initialized=false,riskError='';
  const analysisJobs=new Map(),analysingTrades=new Set();
  const format = (n,d=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const priceText = n => Number.isFinite(Number(n)) ? (n>=1000?format(n,2):n>=1?format(n,4):Number(n).toPrecision(5)) : '—';
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const base = symbol => state.symbols.find(item=>item.id===symbol)?.base || symbol.slice(0,-4);
  const symbolName = symbol => `${base(symbol)}/USDT`;
  function icon(symbol) {
    const name=base(symbol),hue=[...name].reduce((sum,char)=>sum+char.charCodeAt(0)*7,0)%360;
    const logos={BTC:'₿',ETH:'◆',SOL:'◎',BNB:'◇',XRP:'×',DOGE:'Ð',ADA:'₳',AVAX:'▲',LINK:'⬡',DOT:'●',LTC:'Ł'};
    return `<span class="coin-icon" style="--coin-hue:${hue}">${esc(logos[name]||name.slice(0,2))}<img loading="lazy" src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${esc(name.toLowerCase())}.svg" alt="" onerror="this.remove()"></span>`;
  }
  function note(message) { const el=$('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3300); }
  function record(type,data) { native({type:'record',record:{type,at:new Date().toISOString(),data}}); }
  function save() {
    native({type:'saveState',state:{version:7,symbol:state.symbol,interval:state.interval,source:state.source,
      watchlist:state.watchlist,symbols:state.symbols,account:state.account,lines:state.lines,markers:state.markers,boxes:state.boxes,riskZones:state.riskZones,leftTool:state.leftTool,
      analyses:state.analyses,autoAnalyze:state.autoAnalyze,overlays:state.overlays,indicators:state.indicators,
      layout:state.layout,windows:window.PTWindows.serialize()}});
  }
  function applyTextScale() {
    document.documentElement.style.setProperty('--font-scale',state.layout.font/100);
    document.documentElement.style.setProperty('--icon-size',state.layout.icon+'px');
    document.documentElement.style.setProperty('--study-height',state.layout.indicatorHeight+'px');
    $('fontScale').value=state.layout.font;$('fontScaleValue').textContent=state.layout.font+'%';
    $('iconScale').value=state.layout.icon;$('iconScaleValue').textContent=state.layout.icon;
  }
  function setConnection(label,detail,online) { $('connectionText').textContent=label;$('connectionDetail').textContent=detail;$('connectionDot').classList.toggle('online',!!online); }
  function sourceName(source) { return source==='bitget'?'Bitget':'Binance'; }
  function fetchContractRisk() {if(initialized)native({type:'fetchContractRisk',symbols:[...new Set([state.symbol,...state.account.positions.map(p=>p.symbol),...(state.account.orders||[]).map(o=>o.symbol)])]});}
  function freshQuote(symbol) {const q=state.contractQuotes[symbol];return q&&Date.now()-q.receivedAt<5000?q:null;}
  function contractPrice(symbol,direction,closing=false) {const q=freshQuote(symbol);if(!q)return null;return ((direction==='long')!==closing?q.ask:q.bid)||q.last;}
  function accountPrices() {return {...state.prices,...Object.fromEntries(Object.entries(state.contractQuotes).map(([symbol,q])=>[symbol,q.mark]))};}
  function restartStream() {
    const symbols=[...new Set([...state.watchlist.slice(0,16),...state.account.positions.map(p=>p.symbol),state.symbol])].slice(0,20);
    native({type:'stream',source:state.activeSource,symbols,interval:state.interval});
  }
  function fetchMarket() {
    loading=true;streamOk=false;requestId++;
    $('chartMessage').textContent='正在读取行情';$('chartMessage').hidden=false;
    setConnection('读取行情',state.source==='auto'?'自动择快':sourceName(state.source),false);
    native({type:'fetchKlines',symbol:state.symbol,interval:state.interval,source:state.source,requestId});
  }
  function marketPriceNodes() { document.querySelectorAll('[data-market-price]').forEach(el=>{el.textContent=priceText(state.prices[el.dataset.marketPrice]);}); }
  function renderMarkets() {
    const query=$('symbolSearch').value.trim().toUpperCase();
    $('markets').innerHTML=state.watchlist.filter(symbol=>!query||symbol.includes(query)||base(symbol).includes(query)).map(symbol=>
      `<div class="market ${symbol===state.symbol?'selected':''}" role="listitem"><button class="market-select" data-symbol="${esc(symbol)}" type="button">${icon(symbol)}<span class="market-name">${esc(base(symbol))}<small>/USDT</small>${seedBadge(symbol)}</span><span class="market-price" data-market-price="${esc(symbol)}">${priceText(state.prices[symbol])}</span></button><button class="market-remove" data-remove="${esc(symbol)}" title="移出自选" type="button">×</button></div>`).join('')||'<div class="table-empty">暂无币种</div>';
    const matches=query?state.symbols.filter(item=>item.id.includes(query)||item.base.includes(query)).slice(0,12):[];
    $('searchResults').hidden=!matches.length;
    $('searchResults').innerHTML=matches.map(item=>`<button data-add="${esc(item.id)}" type="button">${esc(item.base)}${seedBadge(item.id)}<span>${esc(item.id)}</span></button>`).join('');
  }
  function renderChart() {
    chart.overlays=state.overlays;
    chart.setData(state.candles,state.lines[state.symbol]||[],state.account.positions,state.account.history,state.markers[state.symbol]||[],state.boxes[state.symbol]||[],state.riskZones[state.symbol]||[]);
    if (paintedSymbol!==state.symbol) { paintedSymbol=state.symbol;$('pairTitle').textContent=symbolName(state.symbol);$('pairLogo').innerHTML=icon(state.symbol); }
    updateChartNumbers();
  }
  function updateChartNumbers() {
    $('lastPrice').textContent=priceText(state.prices[state.symbol]);$('candleCount').textContent=state.candles.length+' 根';
    const candle=state.candles.at(-1);
    for (const [id,key] of [['openPrice','open'],['highPrice','high'],['lowPrice','low']]) $(id).textContent=candle?priceText(candle[key]):'—';
    $('volume').textContent=candle?format(candle.volume,2):'—';$('chartMessage').hidden=!!state.candles.length;
  }
  function renderAccount() {
    const account=state.account,prices=accountPrices(),floating=ledger.floating(account,prices),realized=ledger.realized(account);
    $('equity').textContent=format(ledger.equity(account,prices));$('cash').textContent=format(account.cash);
    $('lockedMargin').textContent=format(ledger.locked(account));$('floatingPnL').textContent=format(floating);
    $('realizedPnL').textContent=format(realized);$('bottomPnL').textContent=format(realized);
    for (const id of ['floatingPnL','realizedPnL','bottomPnL']) $(id).className=(id==='floatingPnL'?floating:realized)>=0?'gain':'loss';
    $('positionCount').textContent=account.positions.length;$('historyCount').textContent=account.history.length;
  }
  function selectedBill() {
    return state.account.positions.find(p=>p.id===selectedPosition&&p.symbol===state.symbol)||null;
  }
  function syncPositionChoice() {
    const items=state.account.positions.filter(p=>p.symbol===state.symbol);
    if(!items.some(p=>p.id===selectedPosition))selectedPosition=items[0]?.id||null;
    const html=items.length?items.map(p=>`<option value="${p.id}">${esc(base(p.symbol))} · ${p.side==='long'?'多':'空'} · ${priceText(p.entry)} · ${format(p.qty,6)}</option>`).join(''):'<option value="">暂无持仓</option>';
    if($('closePositionSelect').innerHTML!==html)$('closePositionSelect').innerHTML=html;
    $('closePositionSelect').value=selectedPosition||'';
  }
  function orderValue(direction='long') {
    const market=$('orderType').value==='market',bill=selectedBill();
    const price=market?contractPrice(state.symbol,orderMode==='close'?(bill?.side||direction):direction,orderMode==='close'):Number($('orderPrice').value);
    const model=state.riskModels[state.symbol],qty=ledger.quantity($('amount').value,model),leverage=Number($('leverage').value);
    return {price,model,qty,leverage,notional:price*qty,margin:price*qty/leverage};
  }
  function renderOrder() {
    syncPositionChoice();
    const quote=freshQuote(state.symbol),market=$('orderType').value==='market',closing=orderMode==='close',bill=selectedBill();
    if(quote&&!priceInitialized){$('orderPrice').value=Number(quote.last.toPrecision(10));priceInitialized=true;}
    $('orderPrice').disabled=market;$('useMarketPrice').disabled=market||!quote;
    if(market){$('orderPrice').value='';$('orderPrice').placeholder=quote?'市价 · '+priceText(quote.last):'市价';}
    $('closePositionField').hidden=!closing;$('leverage').disabled=closing;
    const v=orderValue(),{price,model,qty,leverage,notional,margin}=v;
    $('leverageValue').textContent=(closing?bill?.leverage||leverage:leverage)+'×';
    $('quantityUnit').textContent=base(state.symbol);$('amountUnit').textContent=base(state.symbol);$('amount').step=String(model?.qtyStep||'any');
    $('orderAvailable').textContent=format(state.account.cash)+' USDT';$('contractMark').textContent=quote?priceText(quote.mark):'—';
    $('notional').textContent=price>0&&qty>0?format(notional)+' USDT':'—';$('marginEstimate').textContent=closing?'释放对应保证金':price>0&&qty>0?format(margin,4)+' USDT':'—';
    const fee=model?(market?model.feeRate:model.makerFeeRate??model.feeRate):NaN;
    $('openFeeEstimate').textContent=price>0&&qty>0&&model?format(notional*fee,4)+' USDT':'—';
    const maxQty=model&&price>0?ledger.quantity(state.account.cash/(price/leverage+price*model.feeRate),model):0;
    $('estimate').textContent=(closing?format(ledger.availableClose(state.account,bill?.id),6):format(maxQty,6))+' '+base(state.symbol);
    const liquidation=d=>{const n=ledger.liquidationPrice({side:d,entry:price,margin,qty,riskModel:model});return n>0?priceText(n):'—';};
    $('liquidationEstimate').textContent=model&&qty>0&&price>0&&!closing?liquidation('long')+' / '+liquidation('short'):'—';
    const tier=model&&qty>0&&price>0?ledger.tierAt({qty,riskModel:model},price):model?.tiers[0],maxLeverage=tier?Math.min(model.maxLeverage,tier.maxLeverage):0;
    $('orderRiskStatus').textContent=quote&&model?`Bitget U 本位 · 维持保证金率 ${format(tier.rate*100)}% · 此档最高 ${maxLeverage}×`:(riskError||'正在读取合约报价与仓位档位');
    const enough=!!quote&&!!model&&price>0&&qty>0&&(market||Number($('orderPrice').value)>0);
    const canOpen=enough&&leverage<=maxLeverage&&margin+notional*model.feeRate<=state.account.cash+1e-8&&qty>=model.minQty&&notional>=model.minNotional&&notional<=model.tiers.at(-1).max&&model.status==='normal'&&!ledger.riskStatus({side:'short',entry:price,margin,qty,riskModel:model},price).liquidating;
    const canClose=enough&&bill&&qty<=ledger.availableClose(state.account,bill.id)+1e-10;
    $('submitOrder').disabled=closing?!(canClose&&bill.side==='short'):!canOpen;
    $('submitShort').disabled=closing?!(canClose&&bill.side==='long'):!canOpen;
    $('submitOrder').textContent=closing?'买入 / 平空':'买入 / 开多';$('submitShort').textContent=closing?'卖出 / 平多':'卖出 / 开空';
    $('orderCount').textContent=(state.account.orders||[]).length;
  }
  function sizeOrder(percent) {
    const {price,model,leverage}=orderValue();if(!(price>0)||!model)return;
    const max=orderMode==='close'?ledger.availableClose(state.account,selectedBill()?.id):state.account.cash/(price/leverage+price*model.feeRate);
    $('amount').value=ledger.quantity(max*percent/100,model);$('sizePercent').value=percent;$('sizePercentValue').textContent=percent+'%';renderOrder();
  }
  function submit(direction) {
    try {
      const quote=freshQuote(state.symbol);if(!quote)throw new Error('合约报价已过期，正在重连');
      const {price,model,qty,leverage}=orderValue(direction),bill=selectedBill();
      if(orderMode==='close'&&(!bill||(direction==='long'?bill.side!=='short':bill.side!=='long')))throw new Error('请选择对应方向的持仓');
      const result=ledger.placeOrder(state.account,{symbol:state.symbol,side:direction,qty,price,leverage,riskModel:model,orderType:$('orderType').value,positionId:orderMode==='close'?bill?.id:null},quote);
      if(result.trade){if(result.kind==='opened'){result.trade.decisionInterval=state.interval;result.trade.chartSourceAtOrder=state.activeSource;}record(result.kind==='opened'?'trade_opened':'trade_closed',result.trade);if(result.kind==='opened')selectedPosition=result.trade.id;else if(state.autoAnalyze)analyze(result.trade);}
      else{result.order.decisionInterval=state.interval;result.order.chartSourceAtOrder=state.activeSource;record('order_placed',result.order);tab='orders';}
      $('orderError').hidden=true;save();render();fetchContractRisk();restartStream();note(result.kind==='pending'?'限价委托已提交':result.kind==='opened'?'已成交开仓':'已成交平仓');
    }catch(error){$('orderError').textContent=error.message;$('orderError').hidden=false;}
  }
  function seedBadge(symbol) {return seedTags[symbol]?.seed?'<small class="seed-badge" title="币安公开 Seed 标签">种子</small>':'';}
  function renderDiscovery() {
    const query=$('discoverySearch').value.trim().toUpperCase(),filter=$('discoveryFilter').value;
    const items=state.symbols.filter(p=>(!query||p.id.includes(query)||p.base.toUpperCase().includes(query)||(seedTags[p.id]?.name||'').toUpperCase().includes(query))&&(filter!=='seed'||seedTags[p.id]?.seed)&&(filter!=='watch'||state.watchlist.includes(p.id))).sort((a,b)=>a.base.localeCompare(b.base));
    const pages=Math.max(1,Math.ceil(items.length/30));discoveryPage=Math.min(discoveryPage,pages-1);
    $('discoveryStatus').textContent=sourceName(state.activeSource)+' · '+items.length+' 个 USDT 交易对';
    $('discoveryList').innerHTML=items.slice(discoveryPage*30,(discoveryPage+1)*30).map(p=>`<div class="discovery-row">${icon(p.id)}<button data-discover-open="${esc(p.id)}" type="button"><strong>${esc(p.base)} ${seedBadge(p.id)}</strong><small>${esc(seedTags[p.id]?.name||p.id)}</small></button><span>${priceText(state.prices[p.id])}<small class="${Number(marketChanges[p.id])>=0?'gain':'loss'}">${Number.isFinite(marketChanges[p.id])?(marketChanges[p.id]>=0?'+':'')+format(marketChanges[p.id])+'%':''}</small></span><button data-discover-add="${esc(p.id)}" type="button" aria-label="${state.watchlist.includes(p.id)?'移出':'加入'} ${esc(p.base)} 自选">${state.watchlist.includes(p.id)?'★':'☆'}</button></div>`).join('')||'<div class="table-empty">没有匹配的币种</div>';
    $('discoveryPage').textContent=(discoveryPage+1)+' / '+pages;$('discoveryPrev').disabled=discoveryPage===0;$('discoveryNext').disabled=discoveryPage>=pages-1;
  }
  function renderInsight(text) {
    const fragment=document.createDocumentFragment();
    for(const line of String(text||'').split('\n')){
      if(!line.trim())continue;
      const heading=line.match(/^#{1,3}\s+(.+)$/),node=document.createElement(heading?'h3':'p');
      node.textContent=(heading?heading[1]:line).replace(/\*\*(.+?)\*\*/g,'$1');fragment.append(node);
    }
    $('agentInsight').replaceChildren(fragment);
  }
  function renderReviews() {
    const items=Object.values(state.analyses).filter(x=>x?.id&&typeof x.analysis==='string').sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
    const html=items.length?items.map(x=>`<option value="${esc(x.id)}">${esc(x.trade?symbolName(x.trade.symbol):'复盘')} · ${x.promptVersion>=2?'策略版':'基础版'} · ${new Date(Number(x.createdAt)*1000).toLocaleString('zh-CN')}</option>`).join(''):'<option value="">暂无复盘</option>';
    if($('analysisSelect').innerHTML!==html)$('analysisSelect').innerHTML=html;
    const current=state.analyses[selectedTrade]||items[0];if(current){$('analysisSelect').value=current.id;renderInsight(current.analysis);$('analysisMeta').textContent=(current.promptVersion>=2?'策略复盘 · 含建议、动向与方法':'历史基础复盘 · 可点击重新生成升级')+(current.truncated?' · 输出不完整，可重新生成':'');}$('regenerateAnalysisButton').disabled=!current||analysingTrades.has(current.id);
  }
  const td=(value,className='')=>`<span class="${className}">${value}</span>`;
  function renderTable() {
    const head=$('tableHead'),body=$('tableBody'),account=state.account;let rows=[];
    if(tab==='positions'){
      head.innerHTML=['交易对','方向','保证金','杠杆','开仓价','标记价','浮动盈亏','区间 / 风险','操作'].map(item=>td(item)).join('');
      rows=account.positions.map(p=>{const quote=state.contractQuotes[p.symbol],current=quote?.mark||p.entry,pnl=ledger.grossPnL(p,current)-current*p.qty*ledger.feeRate(p)-p.openFee,risk=quote?ledger.riskStatus(p,current):null,liq=ledger.liquidationPrice(p);
        return `<div class="trade-row ${p.id===selectedPosition?'selected-bill':''}" data-select-position="${p.id}">${td(esc(symbolName(p.symbol)))}${td(p.side==='long'?'做多':'做空',p.side==='long'?'gain':'loss')}${td(format(p.margin)+'<small class="position-quantity">'+format(p.qty,6)+' '+esc(base(p.symbol))+'</small>')}${td(p.leverage+'× · 逐仓')}${td(priceText(p.entry))}${td(quote?priceText(current):'—')}${td(format(pnl),pnl>=0?'gain':'loss')}${td(`<span class="risk-cell">${p.takeProfit?priceText(p.takeProfit):'—'} / ${p.stopLoss?priceText(p.stopLoss):'—'}<small>强平 ${liq>0?priceText(liq):'—'} · 风险 ${risk?(risk.marginBalance<=0?'≥100':format(risk.ratio*100,1))+'%':'—'}</small></span>`)}<span class="trade-actions"><button data-risk="${p.id}">区间</button><button data-margin="${p.id}">保证金</button><button data-close="${p.id}">平仓</button></span></div>`;});
    }
    if(tab==='orders'){
      head.innerHTML=['交易对','方向','数量','杠杆','委托价格','冻结 USDT','类型','提交时间','操作'].map(item=>td(item)).join('');
      rows=(account.orders||[]).map(o=>`<div class="trade-row">${td(esc(symbolName(o.symbol)))}${td(o.reduceOnly?(o.side==='long'?'平多':'平空'):(o.side==='long'?'开多':'开空'))}${td(format(o.qty,6))}${td(o.leverage+'×')}${td(priceText(o.price))}${td(format(o.reserved,4))}${td('限价 · '+(o.reduceOnly?'只减仓':'开仓'))}${td(new Date(o.createdAt).toLocaleTimeString())}<span class="trade-actions"><button data-cancel-order="${o.id}">撤单</button></span></div>`);
    }
    if(tab==='history'){
      head.innerHTML=['交易对','方向','保证金','杠杆','开仓价','平仓价','净盈亏','回报 / 原因','操作'].map(item=>td(item)).join('');
      rows=account.history.map(p=>`<div class="trade-row">${td(esc(symbolName(p.symbol)))}${td(p.side==='long'?'做多':'做空')}${td(format(p.margin))}${td(p.leverage+'×')}${td(priceText(p.entry))}${td(priceText(p.exit))}${td(format(p.netPnL),p.netPnL>=0?'gain':'loss')}${td(format(p.roi)+'% · '+esc(p.reason))}<span class="trade-actions"><button data-analyze="${p.id}">${state.analyses[p.id]?'复盘':'分析'}</button></span>${selectedTrade===p.id?`<div class="detail-row"><strong>净盈亏 ${format(p.netPnL)} USDT</strong> · 开仓费 ${format(p.openFee,4)} · 平仓费 ${format(p.closeFee,4)} · 毛盈亏 ${format(p.grossPnL,4)}${p.triggerMarkPrice?`<br>触发标记价 ${priceText(p.triggerMarkPrice)} · 维持保证金 ${format(p.triggerRisk?.maintenance,4)} · 保证金权益 ${format(p.triggerRisk?.marginBalance,4)} · ${p.partial?'降档减仓':'破产价接管清算'}`:''}<br>${esc(state.analyses[p.id]?.analysis||'点击分析，调用 DeepSeek 生成复盘。')}</div>`:''}</div>`);
    }
    if(tab==='funds'){
      head.innerHTML=['时间','变动','变动后余额'].map(item=>td(item)).join('');
      rows=account.movements.map(m=>`<div class="trade-row">${td(new Date(m.at).toLocaleString())}${td((m.amount>0?'+':'')+format(m.amount),m.amount>0?'gain':'loss')}${td(format(m.cashAfter))}</div>`);
    }
    if(tab==='training'){
      head.innerHTML=['数据集','内容','位置'].map(item=>td(item)).join('');
      rows=[`<div class="trade-row">${td('交易样本')}${td(account.history.length+' 笔完整交易')}${td('training-data.jsonl')}</div>`,`<div class="trade-row">${td('复盘样本')}${td(Object.keys(state.analyses).length+' 份 Agent 分析')}${td('analysis-*.json')}</div>`,`<div class="trade-row">${td('K 线快照')}${td(state.symbol+' · '+state.interval)}${td('market-*.json')}</div>`];
    }
    body.innerHTML=rows.join('')||'<div class="table-empty"><span>⌁</span>暂无记录</div>';
    document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
    lastTablePaint=Date.now();
  }
  function render() {renderMarkets();renderChart();renderAccount();renderOrder();renderTable();renderReviews();$('autoAnalyze').checked=state.autoAnalyze;}
  function schedulePaint(selectedCandle=false) {
    chartDirty ||= selectedCandle;
    if (paintQueued) return;
    paintQueued=true;
    requestAnimationFrame(()=>{paintQueued=false;marketPriceNodes();updateChartNumbers();renderAccount();renderOrder();if(chartDirty){chartDirty=false;chart.setData(state.candles,state.lines[state.symbol]||[],state.account.positions,state.account.history,state.markers[state.symbol]||[],state.boxes[state.symbol]||[],state.riskZones[state.symbol]||[]);}if(Date.now()-lastTablePaint>250)renderTable();});
  }
  function syncStudyChecks() {
    for(const [id,selected] of [['overlayPicker',state.overlays],['indicatorPicker',state.indicators]])
      $(id).querySelectorAll('input[type=checkbox]').forEach(box=>{box.checked=selected.includes(box.value);});
  }
  function renderIndicatorPanels() {
    const container=$('indicatorPlots');for(const plot of indicatorCharts.values())plot.dispose();indicatorCharts.clear();container.replaceChildren();
    const visible=state.indicators.length>0;$('indicatorWindow').hidden=!visible;$('indicatorResizeHandle').hidden=!visible;
    if (!visible) return;
    for(const type of state.indicators){
      const item=document.createElement('section');item.className='indicator-plot';
      item.innerHTML=`<div class="indicator-plot-head"><strong>${indicatorNames[type]||type}</strong><button type="button" data-remove-indicator="${type}" title="移除此指标">×</button></div><canvas aria-label="${indicatorNames[type]||type} 指标"></canvas>`;
      container.append(item);
      const plot=new window.PTIndicators.IndicatorChart(item.querySelector('canvas'));
      indicatorCharts.set(type,plot);
      plot.setData(state.candles,chart.view,type);
    }
  }
  chart.onViewport=view=>{for(const [type,plot] of indicatorCharts)plot.setData(state.candles,view,type);};
  chart.onViewChanged=view=>{
    if(!view)return;
    const slider=$('historySlider'),visible=Math.max(10,Math.floor(view.chartW/view.step));
    slider.min=String(-(state.candles.length+visible));slider.max=String(Math.max(8,Math.round(visible*.35)));slider.value=String(-Math.round(chart.panBars));
    $('historyValue').textContent=chart.panBars>0?`前 ${Math.round(chart.panBars)} 根`:chart.panBars<0?`向右 ${Math.abs(Math.round(chart.panBars))} 格`:'最新';
    $('chartViewStatus').textContent=` · 宽度 ${chart.barWidth}px`;
  };
  function changeSymbol(symbol) {
    state.symbol=symbol;priceInitialized=false;$('orderPrice').value='';$('amount').value='';state.candles=[];cancelTool();paintedSymbol='';chart.clearSelection();chart.resetView();save();render();fetchMarket();fetchContractRisk();
  }
  function addSymbol(symbol) { if(!state.symbols.some(item=>item.id===symbol)){note('币种不在当前行情源的交易列表');return;}if(!state.watchlist.includes(symbol))state.watchlist.push(symbol);$('symbolSearch').value='';changeSymbol(symbol); }
  function closePosition(id,reason='手动平仓',executionPrice=null) {
    try {const position=state.account.positions.find(item=>item.id===id);if(!position)return;
      const result=ledger.close(state.account,id,executionPrice??contractPrice(position.symbol,position.side,true),reason);
      record('trade_closed',result);save();render();restartStream();fetchContractRisk();note(`${symbolName(position.symbol)} 已平仓 · ${format(result.netPnL)} USDT`);
      if(state.autoAnalyze)analyze(result);
    } catch(error){note(error.message);}
  }
  function processTriggers(symbol) {
    const quote=freshQuote(symbol);if(!quote)return;
    for(const position of [...state.account.positions]){
      if(position.symbol!==symbol||!position.riskModel)continue;
      const reason=ledger.triggerReason(position,quote.last,quote.mark);
      if(reason==='触发强平'){
        const events=ledger.liquidate(state.account,position.id,quote);
        for(const event of events){record('trade_closed',event);if(state.autoAnalyze)analyze(event);}
        if(events.length){save();render();restartStream();fetchContractRisk();note(`${symbolName(symbol)} ${state.account.positions.some(p=>p.id===position.id)?'已强平减仓':'已触发强平'} · ${format(events.reduce((n,e)=>n+e.netPnL,0))} USDT`);}
      }else if(reason)closePosition(position.id,reason);
    }
  }
  function processOrders(symbol) {
    const quote=freshQuote(symbol);if(!quote)return;
    const events=ledger.fillOrders(state.account,symbol,quote,state.riskModels[symbol]);
    if(!events.length)return;
    for(const e of events){record('order_updated',e.order);if(e.trade){if(e.kind==='opened'){e.trade.decisionInterval=e.order.decisionInterval||null;e.trade.chartSourceAtOrder=e.order.chartSourceAtOrder||null;}record(e.kind==='opened'?'trade_opened':'trade_closed',e.trade);if(e.kind==='closed'&&state.autoAnalyze)analyze(e.trade);}}
    save();render();fetchContractRisk();restartStream();note(events.some(e=>e.trade)?'限价委托已成交':'委托已取消或拒绝，资金已释放');processTriggers(symbol);
  }
  function analyze(position) {
    if(!position){note('还没有已平仓交易');return;}
    if(!$('keyStatus').classList.contains('saved')){note('先在 Agent 面板保存 DeepSeek API Key');window.PTWindows.show('agent');return;}
    if(analysingTrades.has(position.id)){note('这笔账单正在分析');return;}
    const id=crypto.randomUUID(),trade=JSON.parse(JSON.stringify(position));
    analysisJobs.set(id,{trade,account:JSON.parse(JSON.stringify(state.account))});analysingTrades.add(trade.id);
    $('analysisStatus').textContent='读取合约行情…';selectedTrade=trade.id;
    native({type:'fetchAnalysisContext',requestId:id,trade,interval:trade.decisionInterval||state.interval});
    renderTable();window.PTWindows.show('agent');
  }
  function cancelTool() { pendingTool=null;chart.setTool(null);$('chartToolStatus').hidden=true; }
  function startTool(tool,message) { pendingTool={...tool,symbol:state.symbol};chart.setTool(pendingTool);$('chartToolStatus').textContent=message+' · Esc 取消';$('chartToolStatus').hidden=false;$('chartTooltip').hidden=true; }
  function showRisk(id,anchor=null) {
    const position=state.account.positions.find(item=>item.id===(id||selectedPosition));
    if(!position){note('先在持仓表或交易台选择一笔账单');return;}
    selectedPosition=position.id;if(position.symbol!==state.symbol)changeSymbol(position.symbol);
    window.PTWindows.show('chart');
    const a={time:anchor?.time||state.candles.at(-1)?.time||position.openedAt,price:position.entry};
    startTool({type:'risk',positionId:position.id,entry:position.entry,side:position.side,a,phase:'extent'},'已识别'+(position.side==='long'?'做多':'做空')+' · 左键确认横线终点');
    renderOrder();renderTable();
  }
  function addMarker(value,side='mark') {const marker={id:crypto.randomUUID(),...value,side};(state.markers[state.symbol]??=[]).push(marker);record('manual_marker_added',{symbol:state.symbol,...marker});save();renderChart();}
  chart.onBoxCreated=box=>{const item={id:crypto.randomUUID(),...box};(state.boxes[state.symbol]??=[]).push(item);record('box_added',{symbol:state.symbol,...item});save();renderChart();};
  chart.onChartClick=({point,value,event})=>{
    if(!value)return;
    if(pendingTool){
      if(pendingTool.symbol!==state.symbol){cancelTool();return;}
      if(pendingTool.type==='trend'||pendingTool.type==='horizontal'){const line={type:pendingTool.type,a:pendingTool.a,b:pendingTool.type==='horizontal'?{...value,price:pendingTool.a.price}:value,color:pendingTool.color};if(line.a.time===line.b.time){note('请在另一根 K 线的位置确认终点');return;}cancelTool();createLine(line);return;}
      if(pendingTool.type==='risk'){
        try{
          if(pendingTool.phase==='extent'){if(value.time===pendingTool.a.time)return;pendingTool.b={time:value.time,price:pendingTool.entry};pendingTool.phase='take';chart.setTool(pendingTool);$('chartToolStatus').textContent=(pendingTool.side==='long'?'在中间线上方':'在中间线下方')+'点击确认绿色止盈线 · Esc 取消';return;}
          const valid=pendingTool.phase==='take'?(pendingTool.side==='long'?value.price>pendingTool.entry:value.price<pendingTool.entry):(pendingTool.side==='long'?value.price<pendingTool.entry:value.price>pendingTool.entry);if(!valid)return;
          const price=ledger.validLevel(value.price,pendingTool.side,pendingTool.entry,pendingTool.phase==='take'?'take':'stop');
          if(pendingTool.phase==='take'){pendingTool.takeProfit=price;pendingTool.phase='stop';chart.setTool(pendingTool);$('chartToolStatus').textContent=(pendingTool.side==='long'?'在中间线下方':'在中间线上方')+'点击确认红色止损线 · Esc 取消';return;}
          const zone={...pendingTool,stopLoss:price};
          if(zone.positionId){const p=state.account.positions.find(item=>item.id===zone.positionId);if(!p){cancelTool();note('该持仓已平仓');return;}ledger.setRisk(p,zone.stopLoss,zone.takeProfit);p.riskDrawing={a:zone.a,b:zone.b};record('risk_updated',{positionId:p.id,stopLoss:p.stopLoss,takeProfit:p.takeProfit});}
          else{const item={id:crypto.randomUUID(),entry:zone.entry,side:zone.side,stopLoss:zone.stopLoss,takeProfit:zone.takeProfit,a:zone.a,b:zone.b};(state.riskZones[state.symbol]??=[]).push(item);record('risk_zone_added',{symbol:state.symbol,...item});}
          cancelTool();save();render();note('止盈止损区间已设置');if(zone.positionId)processTriggers(state.symbol);
        }catch(error){note(error.message);}
        return;
      }
    }
    if(state.leftTool==='trend'){startTool({type:'trend',a:value},'左键确认趋势线终点');return;}
    if(state.leftTool==='measure'){chart.selectCandle(event);return;}
    if(event.detail>1)return;
    addMarker(value,state.leftTool);
  };
  function openLineDialog(line) {editLine=line;$('lineLabel').value=line?.label||'';$('lineColor').value=line?.color||'#00e676';$('lineWidth').value=line?.width||2;$('lineDash').value=line?.dash||'solid';$('lineDialog').showModal();}
  function createLine(line) {const horizontal=line.type==='horizontal',item={...line,id:crypto.randomUUID(),color:horizontal?(line.color||'#226c48'):chart.trendColor(line.a,line.b),width:horizontal ? .8 : 1.2,dash:horizontal?'dashed':'solid',label:''};(state.lines[state.symbol]??=[]).push(item);save();renderChart();}
  function menuAction(action,button) {
    $('chartMenu').hidden=true;const near=menuPoint&&chart.nearest(menuPoint),value=menuPoint&&chart.toValue(menuPoint);
    if(action==='cancel-tool'){cancelTool();return;}
    if(action==='cancel-box'){const box=menuPoint&&chart.boxAt(menuPoint);if(box){state.boxes[state.symbol]=state.boxes[state.symbol].filter(item=>item.id!==box.id);record('box_removed',{symbol:state.symbol,id:box.id});save();renderChart();}return;}
    if(action==='delete-zone'){const zone=menuPoint&&chart.zoneAt(menuPoint);if(zone){const p=state.account.positions.find(p=>p.id===zone.id);if(p){ledger.setRisk(p,null,null);delete p.riskDrawing;record('risk_cancelled',{positionId:p.id});}else state.riskZones[state.symbol]=(state.riskZones[state.symbol]||[]).filter(item=>item.id!==zone.id);save();render();}return;}
    if(action==='risk-position'||action==='risk-selected'){showRisk(action==='risk-position'?button.dataset.position:selectedPosition,value);return;}
    if((action==='risk-long'||action==='risk-short')&&value){startTool({type:'risk',entry:value.price,side:action==='risk-long'?'long':'short',a:value,phase:'extent'},'左键确认横线终点');return;}
    if((action==='buy-marker'||action==='sell-marker')&&value){addMarker(value,action==='buy-marker'?'buy':'sell');return;}
    if(action==='delete-marker'){const marker=menuPoint&&chart.nearestMarker(menuPoint);if(!marker){note('附近没有手动标记');return;}state.markers[state.symbol]=(state.markers[state.symbol]||[]).filter(item=>item.id!==marker.id);save();renderChart();return;}
    if(action==='horizontal'&&value){const reference=selectedBill()?.entry||state.contractQuotes[state.symbol]?.last||state.prices[state.symbol];startTool({type:'horizontal',a:value,color:value.price>=reference?'#226c48':'#8c7625'},'左键确认水平虚线终点');return;}
    if(action==='trend'&&value){startTool({type:'trend',a:value},'趋势线起点已设置，左键点击终点');return;}
    if(action==='edit'){if(near)openLineDialog(near);else note('右键位置附近没有划线');return;}
    if(action==='delete'){if(!near){note('右键位置附近没有划线');return;}state.lines[state.symbol]=state.lines[state.symbol].filter(line=>line.id!==near.id);save();renderChart();}
  }
  function showChartMenu(event) {
    event.preventDefault();event.stopPropagation();menuPoint=chart.point(event);if(!chart.inside(menuPoint))return;
    const menu=$('chartMenu');
    menu.querySelector('[data-chart-action="cancel-box"]').hidden=!chart.boxAt(menuPoint);
    menu.querySelector('[data-chart-action="delete-zone"]').hidden=!chart.zoneAt(menuPoint);
    menu.querySelector('[data-chart-action="cancel-tool"]').hidden=!pendingTool;
    menu.querySelector('[data-chart-action="risk-selected"]').disabled=!selectedBill();
    $('chartPositionActions').innerHTML=state.account.positions.filter(p=>p.symbol===state.symbol).map(p=>`<button data-chart-action="risk-position" data-position="${esc(p.id)}">设置${p.side==='long'?'多':'空'}仓止盈止损 · ${p.leverage}×</button>`).join('');
    menu.hidden=false;const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-rect.height-8))+'px';
  }
  chart.onCandleClick=selection=>{
    const tooltip=$('chartTooltip');
    if(!selection){tooltip.hidden=true;return;}
    const {candle,previous,start,bars,event}=selection,stage=$('chartStage'),rect=stage.getBoundingClientRect();
    const change=previous?.close?((candle.close/previous.close-1)*100):0;
    const measure=start?.close?`<div>区间 ${bars} 根 · ${((candle.close/start.close-1)*100).toFixed(2)}%</div>`:'<div>再点一根 K 线可测量区间</div>';
    tooltip.innerHTML=`<strong>${new Date(candle.time).toLocaleString('zh-CN')}</strong><div>开 ${priceText(candle.open)} · 高 ${priceText(candle.high)}</div><div>低 ${priceText(candle.low)} · 收 ${priceText(candle.close)}</div><div>涨跌 ${change>=0?'+':''}${change.toFixed(2)}% · 量 ${format(candle.volume,2)}</div>${measure}`;
    tooltip.style.left=Math.max(4,Math.min(rect.width-230,event.clientX-rect.left+12))+'px';
    tooltip.style.top=Math.max(4,Math.min(rect.height-112,event.clientY-rect.top+12))+'px';
    tooltip.hidden=false;
  };
  function initializeEvents() {
    $('intervals').innerHTML=intervals.map(value=>`<button data-interval="${value}" type="button">${value}</button>`).join('');
    $('intervals').onclick=event=>{const button=event.target.closest('[data-interval]');if(!button)return;state.interval=button.dataset.interval;state.candles=[];cancelTool();chart.clearSelection();chart.resetView();document.querySelectorAll('[data-interval]').forEach(item=>item.classList.toggle('active',item===button));save();renderChart();fetchMarket();};
    $('sourceSelect').onchange=()=>{state.source=$('sourceSelect').value;state.candles=[];cancelTool();chart.clearSelection();chart.resetView();save();renderChart();fetchMarket();};
    $('markets').onclick=event=>{const remove=event.target.closest('[data-remove]');if(remove){state.watchlist=state.watchlist.filter(value=>value!==remove.dataset.remove);if(!state.watchlist.includes(state.symbol))changeSymbol(state.watchlist[0]||'BTCUSDT');else{save();renderMarkets();restartStream();}return;}const button=event.target.closest('[data-symbol]');if(button)changeSymbol(button.dataset.symbol);};
    $('symbolSearch').oninput=renderMarkets;$('searchResults').onclick=event=>{const button=event.target.closest('[data-add]');if(button)addSymbol(button.dataset.add);};
    $('addSymbolButton').onclick=()=>{const query=$('symbolSearch').value.trim().toUpperCase(),found=state.symbols.find(item=>item.id===query||item.base===query);if(found)addSymbol(found.id);else note('请从搜索结果选择交易对');};
    $('autoAddButton').onclick=()=>{note('正在读取热门币种');native({type:'fetchTopSymbols',source:state.activeSource});};
    $('refreshButton').onclick=fetchMarket;$('chartResetButton').onclick=()=>chart.resetView();
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){cancelTool();chart.cancelPress();chart.clearSelection();$('chartMenu').hidden=true;}});
    $('historySlider').oninput=()=>chart.setPan(-Number($('historySlider').value));
    $('indicatorResizeHandle').addEventListener('pointerdown',event=>{event.preventDefault();const handle=event.currentTarget;handle.setPointerCapture(event.pointerId);const startY=event.clientY,startHeight=state.layout.indicatorHeight;const move=point=>{const max=Math.max(90,Math.min(360,$('workspace').clientHeight*.55));state.layout.indicatorHeight=Math.round(Math.max(90,Math.min(max,startHeight+startY-point.clientY)));document.documentElement.style.setProperty('--study-height',state.layout.indicatorHeight+'px');};const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);save();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);});
    $('overlayPicker').onchange=event=>{const box=event.target;if(box.type!=='checkbox')return;state.overlays=window.PTIndicators.orderedToggle(state.overlays,box.value,box.checked);chart.setOverlays(state.overlays);save();};
    $('indicatorPicker').onchange=event=>{const box=event.target;if(box.type!=='checkbox')return;state.indicators=window.PTIndicators.orderedToggle(state.indicators,box.value,box.checked);renderIndicatorPanels();if(box.checked)$('indicatorPlots').scrollTop=$('indicatorPlots').scrollHeight;save();};
    $('leftClickTool').onchange=()=>{cancelTool();state.leftTool=$('leftClickTool').value;chart.clearSelection();save();};
    $('indicatorPlots').onclick=event=>{const button=event.target.closest('[data-remove-indicator]');if(!button)return;state.indicators=state.indicators.filter(name=>name!==button.dataset.removeIndicator);syncStudyChecks();renderIndicatorPanels();save();};
    function setOrderMode(mode){orderMode=mode;for(const [id,value] of [['openMode','open'],['closeMode','close']]){$(id).classList.toggle('active',mode===value);$(id).setAttribute('aria-selected',String(mode===value));}$('amount').value='';renderOrder();}
    $('openMode').onclick=()=>setOrderMode('open');$('closeMode').onclick=()=>setOrderMode('close');
    $('orderType').onchange=()=>{if($('orderType').value==='limit'&&freshQuote(state.symbol))$('orderPrice').value=state.contractQuotes[state.symbol].last;renderOrder();};
    $('useMarketPrice').onclick=()=>{const q=freshQuote(state.symbol);if(q){$('orderPrice').value=q.last;priceInitialized=true;renderOrder();}};
    $('closePositionSelect').onchange=()=>{selectedPosition=$('closePositionSelect').value;$('amount').value='';renderOrder();renderTable();};
    ['amount','leverage','orderPrice'].forEach(id=>$(id).oninput=()=>{if(id==='orderPrice')priceInitialized=true;renderOrder();});
    $('sizePercent').oninput=()=>sizeOrder(Number($('sizePercent').value));document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>sizeOrder(Number(b.dataset.size)));
    $('submitOrder').onclick=()=>submit('long');$('submitShort').onclick=()=>submit('short');
    $('discoverButton').onclick=()=>{renderDiscovery();window.PTWindows.show('discover');native({type:'fetchDiscoveryQuotes',source:state.activeSource});};
    $('discoverySearch').oninput=$('discoveryFilter').onchange=()=>{discoveryPage=0;renderDiscovery();};
    $('discoveryPrev').onclick=()=>{discoveryPage=Math.max(0,discoveryPage-1);renderDiscovery();};$('discoveryNext').onclick=()=>{discoveryPage++;renderDiscovery();};
    $('refreshDiscovery').onclick=()=>{native({type:'fetchSymbols',source:state.activeSource});native({type:'fetchSeedTags'});};
    $('discoveryList').onclick=e=>{const open=e.target.closest('[data-discover-open]'),add=e.target.closest('[data-discover-add]');if(open)addSymbol(open.dataset.discoverOpen);if(add){const symbol=add.dataset.discoverAdd;if(state.watchlist.includes(symbol))state.watchlist=state.watchlist.filter(x=>x!==symbol);else state.watchlist.push(symbol);save();renderMarkets();restartStream();}renderDiscovery();};
    $('analysisSelect').onchange=()=>{selectedTrade=$('analysisSelect').value;renderReviews();renderTable();};$('openTradeLog').onclick=()=>native({type:'openTradeLog'});
    function changeMargin(sign){try{const p=state.account.positions.find(p=>p.id===marginPosition),q=p&&freshQuote(p.symbol);if(!q)throw new Error('请等待有效的合约标记价');const m=ledger.adjustMargin(state.account,marginPosition,Number($('marginAmount').value)*sign,q.mark);record('margin_adjusted',m);save();render();$('marginDialog').close();note('逐仓保证金已调整');}catch(e){$('marginError').textContent=e.message;$('marginError').hidden=false;}}
    $('addMargin').onclick=()=>changeMargin(1);$('removeMargin').onclick=()=>changeMargin(-1);
    window.PTAccountAPI={addMargin:(id,amount)=>{const p=state.account.positions.find(p=>p.id===id),q=p&&freshQuote(p.symbol);if(!q)throw new Error('标记价不可用');const result=ledger.adjustMargin(state.account,id,amount,q.mark);record('margin_adjusted',result);save();render();return result;}};
    document.querySelector('.activity-tabs').onclick=event=>{const button=event.target.closest('[data-tab]');if(button){tab=button.dataset.tab;renderTable();}};
    $('tableBody').onclick=event=>{const row=event.target.closest('[data-select-position]');if(row&&!event.target.closest('button')){selectedPosition=row.dataset.selectPosition;const p=state.account.positions.find(p=>p.id===selectedPosition);if(p&&p.symbol!==state.symbol)changeSymbol(p.symbol);renderOrder();renderTable();}const cancel=event.target.closest('[data-cancel-order]');if(cancel){const o=ledger.cancelOrder(state.account,cancel.dataset.cancelOrder);if(o){record('order_cancelled',o);save();render();fetchContractRisk();}}const margin=event.target.closest('[data-margin]');if(margin){marginPosition=margin.dataset.margin;const p=state.account.positions.find(p=>p.id===marginPosition);$('marginPosition').textContent=symbolName(p.symbol)+' · '+(p.side==='long'?'做多':'做空')+' · 当前 '+format(p.margin)+' USDT';$('marginError').hidden=true;$('marginDialog').showModal();}const close=event.target.closest('[data-close]'),risk=event.target.closest('[data-risk]'),analysis=event.target.closest('[data-analyze]');if(close){selectedPosition=close.dataset.close;const p=state.account.positions.find(p=>p.id===selectedPosition);if(p.symbol!==state.symbol)changeSymbol(p.symbol);$('closeMode').click();sizeOrder(100);window.PTWindows.show('order');}if(risk)showRisk(risk.dataset.risk);if(analysis){const p=state.account.history.find(item=>item.id===analysis.dataset.analyze);if(!p)return;selectedTrade=p.id;if(state.analyses[p.id]){renderInsight(state.analyses[p.id].analysis);renderTable();window.PTWindows.show('agent');}else analyze(p);}};
    $('chartStage').addEventListener('contextmenu',showChartMenu);
    $('chartMenu').onclick=event=>{const button=event.target.closest('[data-chart-action]');if(button)menuAction(button.dataset.chartAction,button);};
    document.addEventListener('click',event=>{if(!event.target.closest('#chartMenu'))$('chartMenu').hidden=true;if(!event.target.closest('.study-picker'))document.querySelectorAll('.study-picker').forEach(item=>item.open=false);});
    $('saveLineButton').onclick=()=>{if(!editLine)return;Object.assign(editLine,{label:$('lineLabel').value.trim(),color:$('lineColor').value,width:Number($('lineWidth').value),dash:$('lineDash').value});save();renderChart();$('lineDialog').close();};
    ['walletButton','walletShortcut'].forEach(id=>$(id).onclick=()=>{$('walletCash').textContent=format(state.account.cash);$('walletError').hidden=true;$('walletDialog').showModal();});
    function wallet(sign){try{const movement=ledger.adjustBalance(state.account,Number($('walletAmount').value)*sign);record('balance_adjusted',movement);save();render();$('walletDialog').close();note((sign>0?'已加入 ':'已减去 ')+format(Math.abs(movement.amount))+' USDT');}catch(error){$('walletError').textContent=error.message;$('walletError').hidden=false;}}
    $('depositButton').onclick=()=>wallet(1);$('withdrawButton').onclick=()=>wallet(-1);document.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
    $('saveKeyButton').onclick=()=>{const key=$('apiKey').value.trim();if(!key){note('请输入 API Key');return;}native({type:'saveKey',key});$('apiKey').value='';};
    $('autoAnalyze').onchange=()=>{state.autoAnalyze=$('autoAnalyze').checked;save();};$('analyzeLatestButton').onclick=()=>analyze(state.account.history[0]);$('regenerateAnalysisButton').onclick=()=>{const id=$('analysisSelect').value||selectedTrade;const p=state.account.history.find(t=>t.id===id)||state.analyses[id]?.trade;analyze(p);};
    $('fontScale').oninput=()=>{state.layout.font=Number($('fontScale').value);applyTextScale();save();};
    $('iconScale').oninput=()=>{state.layout.icon=Number($('iconScale').value);applyTextScale();save();};
    window.PTWindows.onChange=save;
  }
  window.PaperTradeNative = event => {
    const data=event.data||{};
    if(event.type==='initialState'){
      const saved=data.state;
      if(saved?.version>=2){for(const key of ['symbol','interval','watchlist','symbols','account','lines','markers','boxes','riskZones','leftTool','analyses','autoAnalyze','source','overlays','indicators','layout'])if(saved[key]!=null)state[key]=saved[key];}
      if(saved?.version===2){state.overlays=saved.overlay==='ma'?['ma7','ma25']:saved.overlay==='boll'?['boll']:[];state.indicators=saved.indicator&&saved.indicator!=='none'?[saved.indicator]:['macd'];}
      state.layout={font:100,icon:34,indicatorHeight:150,...state.layout};state.markers=state.markers&&typeof state.markers==='object'?state.markers:{};state.source=['auto','binance','bitget'].includes(state.source)?state.source:'auto';
      state.overlays=Array.isArray(state.overlays)?state.overlays:[];state.indicators=Array.isArray(state.indicators)?state.indicators:['macd'];
      state.boxes=state.boxes||{};state.riskZones=state.riskZones||{};state.account.orders=state.account.orders||[];state.account.orderHistory=state.account.orderHistory||[];state.account.movements=state.account.movements||[];state.analyses={...state.analyses,...(data.analyses||{})};state.leftTool=saved?.version>=7&&['trend','mark','buy','sell','measure'].includes(state.leftTool)?state.leftTool:'trend';$('leftClickTool').value=state.leftTool;
      if(!saved||saved.version<5)state.overlays=[...new Set(['ma20','ma50','ma100',...state.overlays.filter(name=>!['ma7','ma25','ma99'].includes(name))])];
      if(saved?.version<7)for(const lines of Object.values(state.lines))for(const line of lines){if(line.type==='horizontal'){line.b={time:line.a.time+21600000,price:line.a.price};line.width=.8;line.dash='dashed';line.legacyHorizontal=true;}else if(line.b)line.color=chart.trendColor(line.a,line.b);}
      const windows=saved?.windows?JSON.parse(JSON.stringify(saved.windows)):null;if(saved?.version<4&&windows?.chart&&windows?.indicators){windows.chart.h+=windows.indicators.h+8;delete windows.indicators;}
      window.PTWindows.restore(windows);applyTextScale();$('sourceSelect').value=state.source;
      $('dataPath').textContent='数据目录：'+data.dataPath;$('tradeLogPath').textContent='复盘目录：'+(data.tradeLogPath||'桌面/VScode/SlowSnowTrade/tradelog');$('keyStatus').textContent=data.hasKey?'已配置':'未配置';$('keyStatus').classList.toggle('saved',!!data.hasKey);
      syncStudyChecks();renderIndicatorPanels();document.querySelectorAll('[data-interval]').forEach(button=>button.classList.toggle('active',button.dataset.interval===state.interval));
      initialized=true;render();renderDiscovery();fetchMarket();fetchContractRisk();native({type:'fetchSeedTags'});return;
    }
    if(event.type==='marketSnapshot'){
      if(data.requestId!==requestId||data.symbol!==state.symbol||data.interval!==state.interval)return;
      const previousSource=state.activeSource;state.activeSource=data.source||'binance';
      state.candles=(data.rows||[]).map(row=>({time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])})).filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.close)).sort((a,b)=>a.time-b.time);
      const last=state.candles.at(-1);if(last){state.prices[data.symbol]=last.close;for(const line of state.lines[data.symbol]||[])if(line.legacyHorizontal){line.color=line.a.price>=last.close?'#226c48':'#8c7625';line.b={time:line.a.time+chart.intervalMs()*24,price:line.a.price};delete line.legacyHorizontal;}}
      loading=false;setConnection('行情已连接',sourceName(state.activeSource)+' · '+state.interval,true);
      $('marketSubtitle').textContent=sourceName(state.activeSource)+' · K 线';
      native({type:'saveMarket',source:state.activeSource,symbol:data.symbol,interval:data.interval,candles:state.candles});
      render();if(!streamOk||previousSource!==state.activeSource)restartStream();if(symbolsForSource!==state.activeSource){symbolsForSource=state.activeSource;native({type:'fetchSymbols',source:state.activeSource});}return;
    }
    if(event.type==='marketTick'){
      if(data.source&&data.source!==state.activeSource)return;
      lastTickAt=Date.now();const symbol=data.s,price=Number(data.c);if(!symbol||!Number.isFinite(price))return;
      state.prices[symbol]=price;
      let changed=false;
      if(symbol===state.symbol){const candle={time:Number(data.t),open:Number(data.o),high:Number(data.h),low:Number(data.l),close:price,volume:Number(data.v)};const last=state.candles.at(-1);
        if(last?.time===candle.time){state.candles[state.candles.length-1]=candle;changed=true;}
        else if(!last||candle.time>last.time){state.candles.push(candle);if(state.candles.length>500)state.candles.shift();changed=true;}
      }
      schedulePaint(changed);return;
    }
    if(event.type==='contractRules'){
      const model=ledger.normalizeRules(data);if(!model)return;
      const changed=JSON.stringify(state.riskModels[data.symbol])!==JSON.stringify(model);state.riskModels[data.symbol]=model;
      if(changed){for(const o of state.account.orders)if(o.symbol===data.symbol)o.riskModel=model;for(const p of state.account.positions)if(p.symbol===data.symbol){p.riskModel=model;p.marginMode='isolated';}save();renderChart();}
      renderOrder();processTriggers(data.symbol);processOrders(data.symbol);return;
    }
    if(event.type==='contractRiskSnapshot'){
      riskError='';const requested=[state.symbol,...state.account.positions.map(p=>p.symbol),...(state.account.orders||[]).map(o=>o.symbol)];
      for(const row of data.quotes||[]){const mark=Number(row.mark),last=Number(row.last),time=Number(row.time);if(!requested.includes(row.symbol)||!(mark>0&&last>0)||!Number.isFinite(mark)||!Number.isFinite(last))continue;
        const old=state.contractQuotes[row.symbol];if(old&&time<=old.time)continue;
        const bid=Number(row.bid),ask=Number(row.ask);state.contractQuotes[row.symbol]={mark,last,bid:bid>0&&Number.isFinite(bid)?bid:last,ask:ask>0&&Number.isFinite(ask)?ask:last,time,receivedAt:Date.now()};processTriggers(row.symbol);processOrders(row.symbol);
      }
      if((data.requestedSymbols||[]).includes(state.symbol)&&!(data.quotes||[]).some(row=>row.symbol===state.symbol))riskError='该币种没有可用的 Bitget U 本位合约';
      schedulePaint();return;
    }
    if(event.type==='contractRiskError'){riskError='合约标记价连接异常，正在重连';renderOrder();return;}
    if(event.type==='streamState'){streamOk=!!data.connected;if(streamOk)setConnection('实时行情',sourceName(state.activeSource)+' WebSocket',true);else setConnection(state.candles.length?'实时流重连中':'连接异常',data.message||'正在重试',false);return;}
    if(event.type==='marketError'){if(data.requestId!==requestId)return;loading=false;$('chartMessage').textContent='行情连接异常 · '+(data.message||'请检查网络');$('chartMessage').hidden=!!state.candles.length;setConnection('连接异常',data.message||'请检查网络',false);note('行情读取失败，点击 ↻ 重试');return;}
    if(event.type==='symbols'){if(data.source!==state.activeSource)return;state.symbols=data.pairs||[];renderMarkets();renderDiscovery();save();return;}
    if(event.type==='discoveryQuotes'){if(data.source!==state.activeSource)return;for(const q of data.quotes||[])if(Number(q.price)>0){state.prices[q.symbol]=Number(q.price);marketChanges[q.symbol]=Number(q.change);}renderDiscovery();marketPriceNodes();return;}
    if(event.type==='seedTags'){seedTags=data.tags||{};$('seedStatus').textContent='种子标记来源：币安 · '+new Date(Number(data.fetchedAt)*1000).toLocaleString('zh-CN')+(data.cached?' · 缓存':'');renderMarkets();renderDiscovery();return;}
    if(event.type==='seedTagsError'){$('seedStatus').textContent='种子标签暂时不可用，稍后可刷新';return;}
    if(event.type==='topSymbols'){if(data.source!==state.activeSource)return;const valid=new Set(state.symbols.map(item=>item.id));let added=0;for(const item of data.pairs||[]){if(valid.has(item.id)&&!state.watchlist.includes(item.id)){state.watchlist.push(item.id);added++;}}save();renderMarkets();restartStream();note('已加入 '+added+' 个热门币种');return;}
    if(event.type==='topSymbolsError'||event.type==='symbolsError'||event.type==='storageError')note(data.message||'请求失败');
    if(event.type==='keyStatus'){$('keyStatus').textContent=data.saved?'已配置':'保存失败';$('keyStatus').classList.toggle('saved',!!data.saved);note(data.saved?'API Key 已存入'+(data.storageLabel||'钥匙串'):data.error||'保存失败');}
    if(event.type==='analysisContext'){
      const job=analysisJobs.get(data.requestId);if(!job)return;analysisJobs.delete(data.requestId);
      const sample=window.PTAnalysis.sample(job.trade,data.datasets||[],job.account,freshQuote(job.trade.symbol));
      $('analysisStatus').textContent='生成复盘与策略…';native({type:'analyze',trade:job.trade,sample});return;
    }
    if(event.type==='analysis'){analysingTrades.delete(data.id);state.analyses[data.id]=data;selectedTrade=data.id;renderInsight(data.analysis);$('analysisStatus').textContent=data.truncated?'已保存 · 输出未完整':'策略复盘已保存';save();renderReviews();renderTable();window.PTWindows.show('agent');note('复盘已保存至 VScode / tradelog');}
    if(event.type==='analysisError'){analysingTrades.delete(data.id);$('analysisStatus').textContent='失败';renderReviews();note(data.message||'分析失败');}
  };
  window.SlowSnowDesktop?.onEvent(window.PaperTradeNative);
  initializeEvents();applyTextScale();syncStudyChecks();renderIndicatorPanels();render();native({type:'ready'});
  setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});},1000);
  setInterval(renderOrder,1000);
  setInterval(()=>{if(!loading&&(!streamOk||Date.now()-lastTickAt>90000))native({type:'fetchKlines',symbol:state.symbol,interval:state.interval,source:state.activeSource,requestId});},30000);
})();
