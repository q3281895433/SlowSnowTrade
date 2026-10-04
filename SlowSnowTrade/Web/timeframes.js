(function () {
  const day=86400000;
  const periods={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'6h':21600000,'12h':43200000,'1d':day,'2d':day*2,'1w':day*7};
  const labels={'1m':'1 分钟','3m':'3 分钟','5m':'5 分钟','15m':'15 分钟','30m':'30 分钟','1h':'1 小时','4h':'4 小时','6h':'6 小时','12h':'12 小时','1d':'1 日','2d':'2 日','1w':'周线'};
  const aggregated=interval=>interval==='2d'||interval==='1w';
  const sourceInterval=interval=>aggregated(interval)?'1d':interval;
  function group(candles,interval) {
    if(!aggregated(interval))return candles;
    const rows=[...new Map(candles.map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
    const duration=periods[interval],anchor=interval==='1w'?day*4:0,buckets=new Map();
    for(const candle of rows){
      if(![candle.time,candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite))continue;
      const time=Math.floor((candle.time-anchor)/duration)*duration+anchor,current=buckets.get(time);
      if(current){current.high=Math.max(current.high,candle.high);current.low=Math.min(current.low,candle.low);current.close=candle.close;current.volume+=candle.volume;}
      else buckets.set(time,{...candle,time});
    }
    // Exclude the first bucket when the downloaded history starts partway through it.
    return [...buckets.values()].filter(c=>c.time>=(rows[0]?.time??0)||c.time+duration>Date.now());
  }
  window.PTTimeframes={intervals:Object.keys(periods),periods,labels,aggregated,sourceInterval,group};
})();
