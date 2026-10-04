(function () {
  const studies=window.PTIndicators;
  const periods=window.PTTimeframes.periods;
  const finite=n=>Number.isFinite(n)?Number(n.toPrecision(10)):null;
  function candles(rows) {
    return (rows||[]).map(row=>Array.isArray(row)?{time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])}:row)
      .filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.close>0&&c.high>=c.low)
      .sort((a,b)=>a.time-b.time);
  }
  function snapshot(dataset,asOf) {
    if(!dataset)return null;
    const duration=periods[dataset.interval],all=window.PTTimeframes.group(candles(dataset.rows),dataset.interval),closed=all.filter(c=>c.time+duration<=asOf);
    const values=closed.map(c=>c.close),last=closed.at(-1),previous=closed.at(-2),range=closed.slice(-20);
    if(!last)return {source:dataset.source,category:dataset.category,interval:dataset.interval,asOf,error:dataset.error||'没有在分析时点前已收盘的 K 线'};
    const ma=n=>finite(studies.sma(values,n).at(-1)),ema=n=>closed.length>=n?finite(studies.ema(values,n).at(-1)):null;
    const oscillator=closed.length>=35?studies.macd(values).at(-1):null;
    const atr=finite(studies.atr(closed).at(-1)),band=studies.bollinger(values).at(-1),avgVolume=closed.length>=21?studies.sma(closed.slice(0,-1).map(c=>c.volume),20).at(-1):null;
    return {source:dataset.source,category:dataset.category,interval:dataset.interval,sourceInterval:dataset.sourceInterval||dataset.interval,asOf,candleCount:closed.length,firstCandleTime:closed[0].time,lastClosedAt:last.time+duration,
      lastClosedPrice:last.close,changeLastBarPercent:previous?finite((last.close/previous.close-1)*100):null,
      change20BarsPercent:range.length===20?finite((last.close/range[0].open-1)*100):null,
      ma20:ma(20),ma50:ma(50),ma100:ma(100),ema12:ema(12),ema26:ema(26),
      macd:oscillator?{dif:finite(oscillator.dif),dea:finite(oscillator.dea),histogram:finite(oscillator.histogram)}:null,
      rsi14:finite(studies.rsi(values).at(-1)),atr14:atr,atrPercent:atr?finite(atr/last.close*100):null,
      boll20:band?{middle:finite(band.middle),upper:finite(band.upper),lower:finite(band.lower)}:null,
      range20Bars:range.length===20?{low:Math.min(...range.map(c=>c.low)),high:Math.max(...range.map(c=>c.high))}:null,
      latestClosedVolume:last.volume,relativeVolume20:avgVolume>0?finite(last.volume/avgVolume):null,
      recentClosedCandles:closed.slice(-24),formingCandlesExcluded:all.length-closed.length,error:dataset.error||null};
  }
  function sample(trade,datasets,account,quote) {
    const now=Date.now(),entry=Number(trade.openedAt),exit=Number(trade.closedAt),get=purpose=>datasets.find(d=>d.purpose===purpose);
    const atEntry=snapshot(get('entry'),entry),atExit=snapshot(get('exit'),exit);
    const intratrade=get('exit'),duration=periods[intratrade?.interval],bars=window.PTTimeframes.group(candles(intratrade?.rows),intratrade?.interval).filter(c=>c.time>=entry&&c.time+duration<=exit);
    const sign=trade.side==='long'?1:-1,stop=Number(trade.stopLoss),target=Number(trade.takeProfit);
    const stopDistance=stop>0?Math.abs(trade.entry-stop):null,targetDistance=target>0?Math.abs(target-trade.entry):null;
    const past=(account.history||[]).filter(t=>Number(t.closedAt)<=exit).sort((a,b)=>b.closedAt-a.closedAt).slice(0,30);
    const profit=past.filter(t=>t.netPnL>0).reduce((n,t)=>n+t.netPnL,0),loss=-past.filter(t=>t.netPnL<0).reduce((n,t)=>n+t.netPnL,0);
    const best=bars.length?Math.max(...bars.map(c=>sign*(sign>0?c.high-trade.entry:c.low-trade.entry)*trade.qty)):null;
    const worst=bars.length?Math.min(...bars.map(c=>sign*(sign>0?c.low-trade.entry:c.high-trade.entry)*trade.qty)):null;
    return {schemaVersion:2,requestedAt:now,trade,
      executionBasis:'本地逐仓模拟；Bitget USDT-FUTURES 盘口估算，未模拟真实订单簿、资金费率或离线行情路径',
      tradeReview:{atEntry,atExit,heldMinutes:finite((exit-entry)/60000),
        roundTripFees:finite(Number(trade.openFee)+Number(trade.closeFee)),feesAsPercentOfMargin:trade.margin>0?finite((Number(trade.openFee)+Number(trade.closeFee))/trade.margin*100):null,
        stopPriceRiskUSDT:stopDistance?finite(stopDistance*trade.qty):null,rewardRiskAtFinalLevels:stopDistance&&targetDistance?finite(targetDistance/stopDistance):null,
        realizedRAtFinalStop:stopDistance?finite(trade.netPnL/(stopDistance*trade.qty)):null,
        riskPlanTiming:'当前账单仅保存最后设置的止盈止损；其设置是否早于入场未知，不能当作已知的开仓前计划',
        excursion:{completeBarsUsed:bars.length,approximateBestGrossPnL:finite(best),approximateWorstGrossPnL:finite(worst),
          coversHoldingPeriod:!!bars.length&&candles(intratrade?.rows)[0]?.time<=entry&&candles(intratrade?.rows).at(-1)?.time+duration>=exit,
          limitation:'仅已收盘且完整位于持仓期内的 K 线极值，排除入场/出场所在的不完整蜡烛；不等于真实逐笔 MFE/MAE，不可用于精确回测'},
        recentHistory:{sampleType:'截至该账单平仓时的最近 30 条平仓记录，含分批平仓',records:past.length,
          independentPositions:new Set(past.map(p=>p.parentPositionId||p.id)).size,winRatePercent:past.length?finite(past.filter(t=>t.netPnL>0).length/past.length*100):null,
          netPnL:finite(past.reduce((n,p)=>n+p.netPnL,0)),profitFactor:loss>0?finite(profit/loss):null,
          trades:past.map(p=>({id:p.id,symbol:p.symbol,side:p.side,netPnL:p.netPnL,leverage:p.leverage,reason:p.reason,partial:!!p.partial,closedAt:p.closedAt}))}},
      currentMarket:{asOf:now,selectedPeriod:snapshot(get('current'),now),hourly:snapshot(get('hourly'),now),fourHourly:snapshot(get('fourHourly'),now),
        bitcoinHourly:snapshot(get('bitcoin'),now),contractQuote:quote?{...quote,source:'Bitget',category:'USDT-FUTURES'}:null,
        accountNow:{availableUSDT:account.cash,isolatedMargins:account.positions.reduce((n,p)=>n+p.margin,0),openPositions:account.positions.length},
        scope:'仅价格、成交量和技术指标动向；不包含新闻、链上资金流、订单簿深度或资金费率'},
      dataQuality:{decisionInterval:trade.decisionInterval||null,analysisInterval:get('entry')?.interval||null,
        originalDecisionIntervalKnown:!!trade.decisionInterval,errors:datasets.filter(d=>d.error).map(d=>({purpose:d.purpose,interval:d.interval,error:d.error})),
        noLookAhead:'入场复盘只使用开仓前已收盘 K 线；平仓后与当前行情仅供事后复盘和现在的条件式方案，不能证明当时可预知未来'},
      request:'中文给出交易诊断、改进建议、当前动向、条件式多空/震荡策略、参考交易方法及量化研究方向，避免复述账单。'};
  }
  window.PTAnalysis={sample};
})();
