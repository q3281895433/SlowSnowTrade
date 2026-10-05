(function () {
  class Chart {
    constructor(canvas, crosshairCanvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.crosshairCanvas = crosshairCanvas;
      this.crosshairCtx = crosshairCanvas.getContext('2d');
      this.candles = [];
      this.lines = [];
      this.positions = [];
      this.trades = [];
      this.markers = [];
      this.boxes = [];
      this.riskZones = [];
      this.toolDraft = null;
      this.press = null;
      this.boxDraft = null;
      this.suppressClick = false;
      this.overlays = [];
      this.pointer = null;
      this.selection = [];
      this.onCandleClick = null;
      this.panBars = 0;
      this.barWidth = 8;
      this.seriesCache = null;
      this.futureBars = 12;
      this.pad = { left: 12, right: 76, top: 15, bottom: 27 };
      this.view = null;
      this.onViewport = null;
      this.onViewChanged = null;
      new ResizeObserver(() => this.draw()).observe(canvas);
      canvas.addEventListener('pointermove', event => {
        this.pointer = this.point(event);
        if (this.press) {
          if (this.press.boxing) this.boxDraft.b = this.toValue(this.clampPoint(this.pointer));
          else if (Math.hypot(this.pointer.x - this.press.point.x, this.pointer.y - this.press.point.y) > 7) { clearTimeout(this.press.timer); this.press.moved = true; }
        }
        this.drawCrosshair(this.pointer);
      });
      canvas.addEventListener('pointerdown', event => this.beginPress(event));
      canvas.addEventListener('pointerup', event => this.endPress(event));
      canvas.addEventListener('pointercancel', () => this.cancelPress());
      canvas.addEventListener('pointerleave', () => { if (!this.press?.boxing) { this.cancelPress(); this.pointer = null; this.drawCrosshair(null); } });
      canvas.addEventListener('click', event => {
        if (this.suppressClick) { this.suppressClick = false; return; }
        const point = this.point(event); if (!this.inside(point)) return;
        if (this.onChartClick) this.onChartClick({point,value:this.toValue(point),event});
        else this.selectCandle(event);
      });
      canvas.addEventListener('dblclick', () => this.clearSelection());
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        if (this.toolDraft || this.press?.boxing) return;
        const point = this.point(event), oldView = this.view;
        const anchor = oldView ? oldView.startIndex + (point.x - oldView.left) / oldView.step : this.candles.length - 1;
        const change = event.deltaY < 0 ? 1 : -1;
        this.barWidth = Math.max(2, Math.min(50, this.barWidth + change));
        if (oldView) {
          const slots = Math.max(10, Math.floor(oldView.chartW / this.barWidth));
          const step = oldView.chartW / slots;
          const start = anchor - (point.x - oldView.left) / step;
          const end = start + slots - 1;
          this.panBars = this.candles.length - 1 + this.futureBars - end;
        }
        this.draw();
      }, { passive: false });
    }
    point(event) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
    setData(candles, lines, positions, trades, markers, boxes, riskZones) { this.candles = candles || []; this.lines = lines || []; this.positions = positions || []; this.trades = trades || []; this.markers = markers || []; this.boxes = boxes || []; this.riskZones = riskZones || []; this.seriesCache = null; this.draw(); }
    setOverlays(names) { this.overlays = Array.isArray(names) ? names : []; this.seriesCache = null; this.draw(); }
    setPan(value) { this.panBars = Number(value) || 0; this.draw(); }
    inside(point) { const v = this.view; return !!v && point.x >= v.left && point.x <= v.left + v.chartW && point.y >= v.top && point.y <= v.top + v.chartH; }
    clampPoint(point) { const v = this.view; return v ? {x:Math.max(v.left,Math.min(v.left+v.chartW,point.x)),y:Math.max(v.top,Math.min(v.top+v.chartH,point.y))} : point; }
    beginPress(event) {
      if (event.button !== 0 || this.toolDraft || !this.inside(this.point(event))) return;
      this.suppressClick = false;
      const press = {point:this.point(event),pointerId:event.pointerId,moved:false,boxing:false};
      this.press = press;
      press.timer = setTimeout(() => {
        if (this.press !== press || press.moved) return;
        press.boxing = true; this.suppressClick = true;
        this.lockedRange = {min:this.view.min,max:this.view.max};
        const value = this.toValue(press.point); this.boxDraft = {a:value,b:value};
        this.canvas.setPointerCapture(press.pointerId); this.canvas.classList.add('drawing-box');
        this.onCandleClick?.(null); this.drawCrosshair(this.pointer);
      }, 150);
    }
    endPress(event) {
      const press = this.press; if (!press || event.pointerId !== press.pointerId) return;
      clearTimeout(press.timer);
      if (press.boxing) {
        const end = this.clampPoint(this.point(event)); this.boxDraft.b = this.toValue(end);
        if (Math.abs(end.x-press.point.x) >= 6 && Math.abs(end.y-press.point.y) >= 6) this.onBoxCreated?.({...this.boxDraft});
        this.suppressClick = true;
      } else if (press.moved) this.suppressClick = true;
      this.press = null; this.boxDraft = null; this.lockedRange = null; this.canvas.classList.remove('drawing-box');
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.draw();
    }
    cancelPress() { if (this.press) clearTimeout(this.press.timer); this.press = null; this.boxDraft = null; this.lockedRange = this.toolDraft ? this.lockedRange : null; this.canvas.classList.remove('drawing-box'); this.drawCrosshair(this.pointer); }
    setTool(draft) { this.cancelPress(); this.suppressClick=false; this.toolDraft = draft; this.lockedRange = draft && this.view ? {min:this.view.min,max:this.view.max} : null; this.canvas.classList.toggle('placing-tool',!!draft); this.clearSelection(); this.draw(); }
    boxBounds(box) { const a=this.linePoint(box.a),b=this.linePoint(box.b); return a&&b?{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}:null; }
    boxAt(point) { return [...this.boxes].reverse().find(box=>{const r=this.boxBounds(box);return r&&point.x>=r.x&&point.x<=r.x+r.w&&point.y>=r.y&&point.y<=r.y+r.h;}) || null; }
    zoneTimes(zone) {
      const drawing=zone.riskDrawing||zone;
      const start=drawing.a?.time ?? zone.openedAt ?? this.candles.at(-1)?.time ?? Date.now();
      return [start,drawing.b?.time ?? start+this.intervalMs()*24];
    }
    zoneAt(point) {
      const price=this.toValue(point)?.price;
      const own=this.positions.filter(p=>p.symbol===window.PTAppSymbol?.()&&(p.takeProfit||p.stopLoss));
      return [...this.riskZones,...own].reverse().find(zone=>{
        const [start,end]=this.zoneTimes(zone),a=this.linePoint({time:start,price:zone.entry}),b=this.linePoint({time:end,price:zone.entry});
        const low=Math.min(zone.entry,zone.stopLoss??zone.entry,zone.takeProfit??zone.entry),high=Math.max(zone.entry,zone.stopLoss??zone.entry,zone.takeProfit??zone.entry);
        const tolerance=this.view?(this.view.max-this.view.min)*4/this.view.chartH:0;
        return a&&b&&point.x>=Math.min(a.x,b.x)-4&&point.x<=Math.max(a.x,b.x)+4&&price>=low-tolerance&&price<=high+tolerance;
      })||null;
    }
    paintBox(ctx,box,draft=false) { const r=this.boxBounds(box),v=this.view;if(!r||!v)return;ctx.save();ctx.beginPath();ctx.rect(v.left,v.top,v.chartW,v.chartH);ctx.clip();ctx.fillStyle='#76d8ff0d';ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle=draft?'#d9f6ff':'#76d8ff';ctx.lineWidth=1.3;ctx.setLineDash(draft?[4,3]:[]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.restore(); }
    paintRiskZone(ctx,zone,layer='all') {
      const v=this.view;if(!v||!Number.isFinite(zone.entry)||zone.entry<=0)return;
      const [start,end]=this.zoneTimes(zone),a=this.linePoint({time:start,price:zone.entry}),b=this.linePoint({time:end,price:zone.entry});
      const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x);if(right<v.left||left>v.left+v.chartW)return;
      ctx.save();ctx.beginPath();ctx.rect(v.left,v.top,v.chartW,v.chartH);ctx.clip();ctx.font='11px -apple-system,sans-serif';ctx.lineWidth=.8;ctx.setLineDash([]);
      if(layer!=='lines')for(const [price,color] of [[zone.takeProfit,'rgba(8,153,129,0.18)'],[zone.stopLoss,'rgba(242,54,69,0.18)']]){
        if(!(price>0)||!Number.isFinite(price))continue;
        const y=this.linePoint({time:start,price}).y;
        ctx.fillStyle=color;ctx.fillRect(left,Math.min(a.y,y),right-left,Math.abs(a.y-y));
      }
      if(layer!=='fill')for(const [price,color,label] of [[zone.entry,'#b3cad6',zone.label||'开仓中间线'],[zone.takeProfit,'#24df91','止盈'],[zone.stopLoss,'#ff5c71','止损']]){
        if(!(price>0)||!Number.isFinite(price))continue;
        const y=this.linePoint({time:start,price}).y;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
        ctx.fillStyle=color;ctx.fillText(label+' '+this.priceText(price),Math.max(v.left,left)+4,y-4);
      }
      ctx.restore();
    }
    trendColor(a,b) { const direction=(b.price-a.price)*(b.time<a.time?-1:1);return direction>=0?'#245bb3':'#973340'; }
    paintLine(ctx,line) {
      const a=this.linePoint(line.a),b=this.linePoint(line.b||line.a),v=this.view;if(!a||!b||!v)return;
      ctx.save();ctx.beginPath();ctx.rect(v.left,v.top,v.chartW,v.chartH);ctx.clip();
      ctx.strokeStyle=line.color||this.trendColor(line.a,line.b||line.a);ctx.lineWidth=Number(line.width)||1;ctx.setLineDash(line.dash==='dashed'?[4,4]:[]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,line.type==='horizontal'?a.y:b.y);ctx.stroke();
      if(line.label){ctx.fillStyle=ctx.strokeStyle;ctx.font='11px -apple-system,sans-serif';ctx.fillText(line.label,Math.max(v.left,a.x+4),a.y-4);}ctx.restore();
    }
    drawInteractions(ctx) {
      if(this.boxDraft)this.paintBox(ctx,this.boxDraft,true);
      const tool=this.toolDraft,value=this.pointer&&this.toValue(this.clampPoint(this.pointer));if(!tool||!value)return;
      if(tool.type==='risk'){
        const zone={...tool,label:'开仓中间线'};
        if(tool.phase==='extent')zone.b={time:value.time,price:tool.entry};
        else if(tool.phase==='take'){
          if((tool.side==='long'&&value.price>tool.entry)||(tool.side==='short'&&value.price<tool.entry))zone.takeProfit=value.price;
        }else zone.stopLoss=value.price;
        this.paintRiskZone(ctx,zone);
      }else if(tool.type==='horizontal')this.paintLine(ctx,{...tool,b:{...value,price:tool.a.price},width:.8,dash:'dashed'});
      else if(tool.a)this.paintLine(ctx,{type:'trend',a:tool.a,b:value,color:this.trendColor(tool.a,value),width:1.2});
    }
    clearSelection() { this.selection = []; this.drawCrosshair(this.pointer); this.onCandleClick?.(null); }
    selectCandle(event) {
      if (!this.view || !this.candles.length) return;
      const point = this.point(event), index = Math.round((point.x - this.view.left) / this.view.step + this.view.startIndex - .5);
      if (index < 0 || index >= this.candles.length) return;
      const candle = this.candles[index];
      this.selection = this.selection.length === 1 ? [this.selection[0], candle] : [candle];
      this.drawCrosshair(point);
      this.onCandleClick?.({ candle, previous: this.candles[index - 1] || null, start: this.selection.length === 2 ? this.selection[0] : null, bars: this.selection.length === 2 ? index - this.candles.findIndex(item => item.time === this.selection[0].time) : 0, event });
    }
    resetView() { this.panBars = 0; this.draw(); }
    intervalMs() { const items = this.candles; return this.intervalDuration || (items.length > 1 ? items[items.length - 1].time - items[items.length - 2].time : 900000); }
    timeAt(index) {
      const items = this.candles, duration = this.intervalMs();
      if (!items.length) return Date.now();
      if (index < 0) return items[0].time + index * duration;
      if (index >= items.length) return items[items.length - 1].time + (index - items.length + 1) * duration;
      return items[index].time;
    }
    indexAt(time) {
      const items = this.candles, duration = this.intervalMs();
      if (!items.length) return 0;
      if (time < items[0].time) return (time - items[0].time) / duration;
      if (time > items[items.length - 1].time) return items.length - 1 + (time - items[items.length - 1].time) / duration;
      let low = 0, high = items.length - 1;
      while (low < high) { const mid = Math.floor((low + high) / 2); if (items[mid].time < time) low = mid + 1; else high = mid; }
      return low;
    }
    toValue(point) {
      const view = this.view; if (!view) return null;
      const index = Math.round((point.x - view.left) / view.step + view.startIndex - .5);
      const price = view.max - (point.y - view.top) / view.chartH * (view.max - view.min);
      return { time: this.timeAt(index), price: Math.max(0.00000001, price) };
    }
    linePoint(value) {
      const view = this.view; if (!view || !value) return null;
      return { x: view.left + (this.indexAt(value.time) - view.startIndex + .5) * view.step,
        y: view.top + (view.max - value.price) / (view.max - view.min) * view.chartH };
    }
    nearest(point) {
      if (!this.view) return null;
      let result = null, best = 14;
      for (const line of this.lines) {
        const a = this.linePoint(line.a), b = this.linePoint(line.b || line.a); if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
        const distance = Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
        if (distance < best) { best = distance; result = line; }
      }
      return result;
    }
    markerPoint(marker) {
      const view = this.view, candles = this.candles;
      if (!view || !candles.length || !Number.isFinite(marker.price)) return null;
      let low = 0, high = candles.length - 1;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (candles[mid].time <= marker.time) low = mid; else high = mid - 1; }
      const index = marker.time < candles[0].time || marker.time > candles[candles.length - 1].time + this.intervalMs() ? this.indexAt(marker.time) : low;
      return { index, x: view.left + (index - view.startIndex + .5) * view.step,
        y: view.top + (view.max - marker.price) / (view.max - view.min) * view.chartH };
    }
    nearestMarker(point) {
      for(const hit of this.markerHits||[])if(hit.manual&&point.x>=hit.x&&point.x<=hit.x+hit.w&&point.y>=hit.y&&point.y<=hit.y+hit.h)return hit.members[0];
      let nearest = null, distance = 18;
      for (const marker of this.markers) {
        const position = this.markerPoint(marker);
        if (!position) continue;
        const next = Math.hypot(position.x - point.x, position.y - point.y);
        if (next < distance) { nearest = marker; distance = next; }
      }
      return nearest;
    }
    roundedRect(ctx,x,y,w,h,r) {
      ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
    }
    drawMarkers() {
      const v=this.view,ctx=this.ctx;this.markerHits=[];if(!v)return;
      const entries=new Map(),orders=[];
      for(const trade of [...this.positions,...this.trades]){
        if(trade.symbol!==window.PTAppSymbol?.())continue;
        const key=trade.parentPositionId||trade.id;
        if(!entries.has(key))entries.set(key,{time:trade.openedAt,price:Number(trade.entry),qty:0,side:trade.side==='long'?'buy':'sell',action:trade.side==='long'?'开多':'开空',manual:false});
        entries.get(key).qty+=Number(trade.qty)||0;
        if(trade.closedAt&&Number.isFinite(Number(trade.exit)))orders.push({time:trade.closedAt,price:Number(trade.exit),qty:trade.qty,side:trade.side==='long'?'sell':'buy',action:trade.liquidated?'强平':trade.side==='long'?(trade.partial?'减多':'平多'):(trade.partial?'减空':'平空'),reason:trade.reason,manual:false});
      }
      const markers=[...entries.values(),...orders,...this.markers.map(m=>({...m,manual:true,action:m.side==='buy'?'手动买点':m.side==='sell'?'手动卖点':'标记'}))];
      const groups=[];
      for(const marker of markers){
        const point=this.markerPoint(marker);if(!point||point.x<v.left||point.x>v.left+v.chartW)continue;
        if(marker.side==='mark'){
          if(point.y<v.top||point.y>v.top+v.chartH)continue;
          ctx.strokeStyle='#d9f3ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(point.x-5,point.y);ctx.lineTo(point.x+5,point.y);ctx.moveTo(point.x,point.y-5);ctx.lineTo(point.x,point.y+5);ctx.stroke();continue;
        }
        const existing=groups.find(g=>g.side===marker.side&&g.manual===marker.manual&&g.members[0].action===marker.action&&Math.abs(g.point.x-point.x)<36&&Math.abs(g.point.y-point.y)<24);
        if(existing){existing.members.push(marker);existing.points.push(point);}else groups.push({side:marker.side,manual:marker.manual,point,members:[marker],points:[point]});
      }
      const font=11,height=18;
      const occupied=[],bounds={left:v.left+2,right:v.left+v.chartW-2,top:v.top+2,bottom:v.top+v.chartH-2};
      ctx.save();ctx.beginPath();ctx.rect(v.left,v.top,v.chartW,v.chartH);ctx.clip();
      for(const group of groups){
        const buy=group.side==='buy',color=buy?'#3be5a3':'#ff7186',direction=buy?1:-1;
        const label=group.members.length>1?(buy?'买入':'卖出')+' · '+group.members.length+'笔':group.manual?group.members[0].action:(buy?'买入':'卖出')+' · '+group.members[0].action;
        const width=18;
        const x=group.points.reduce((n,p)=>n+p.x,0)/group.points.length;
        const anchors=group.points.map(p=>{const candle=this.candles[p.index],wick=candle&&this.linePoint({time:candle.time,price:buy?candle.low:candle.high});return buy?Math.max(p.y,wick?.y??p.y):Math.min(p.y,wick?.y??p.y);});
        const anchorY=Math.max(bounds.top+8,Math.min(bounds.bottom-8,buy?Math.max(...anchors):Math.min(...anchors)));
        let rect;
        for(let attempt=0;attempt<18;attempt++){
          const lane=Math.floor(attempt/3),shift=attempt%3===0?0:attempt%3===1?width*.6:-width*.6;
          const left=Math.max(bounds.left,Math.min(bounds.right-width,x-width/2+shift));
          const top=Math.max(bounds.top,Math.min(bounds.bottom-height,anchorY+(buy?7:-height-7)+direction*lane*(height+5)));
          rect={x:left,y:top,w:width,h:height};
          if(!occupied.some(r=>rect.x<r.x+r.w+4&&rect.x+rect.w+4>r.x&&rect.y<r.y+r.h+4&&rect.y+rect.h+4>r.y))break;
        }
        occupied.push(rect);
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1;
        ctx.strokeStyle=buy?'#3be5a345':'#ff718645';ctx.setLineDash([2,3]);
        for(const p of group.points){const y=Math.max(v.top,Math.min(v.top+v.chartH,p.y));ctx.beginPath();ctx.moveTo(p.x,y);ctx.lineTo(p.x,anchorY);ctx.stroke();ctx.beginPath();ctx.arc(p.x,y,2.2,0,Math.PI*2);ctx.fill();}
        ctx.strokeStyle=color;ctx.setLineDash([]);
        // Buy arrow points upward from below the candle; sell points downward from above it.
        const tipY=anchorY,baseY=tipY+direction*4;
        ctx.setLineDash(group.manual?[3,3]:[]);ctx.beginPath();ctx.moveTo(x,baseY);ctx.lineTo(rect.x+rect.w/2,buy?rect.y:rect.y+rect.h);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.moveTo(x,tipY);ctx.lineTo(x-3,baseY);ctx.lineTo(x+3,baseY);ctx.closePath();ctx.fill();
        ctx.beginPath();this.roundedRect(ctx,rect.x,rect.y,rect.w,rect.h,3);ctx.fillStyle=buy?'#063626':'#40141e';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash(group.manual?[4,3]:[]);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle=color;ctx.font=`700 ${font}px -apple-system,sans-serif`;ctx.fillText(buy?'B':'S',rect.x+(width-ctx.measureText(buy?'B':'S').width)/2,rect.y+height/2+font*.35);
        this.markerHits.push({...rect,...group,label});
      }
      ctx.restore();
    }
    drawMarkerTooltip(ctx,point) {
      if(!point||this.toolDraft||this.press?.boxing)return;
      const hit=(this.markerHits||[]).find(h=>point.x>=h.x&&point.x<=h.x+h.w&&point.y>=h.y&&point.y<=h.y+h.h);if(!hit)return;
      const v=this.view,rows=[hit.label,...hit.members.slice(0,5).map(m=>`${new Date(m.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})} · ${m.action} · ${this.priceText(m.price)}${m.qty?' · 数量 '+Number(m.qty).toPrecision(6):''}`)];
      if(hit.members.length>5)rows.push(`另有 ${hit.members.length-5} 笔，成交明细可在历史交易查看`);
      ctx.save();ctx.font='12px -apple-system,sans-serif';const width=Math.min(v.chartW-8,Math.max(...rows.map(r=>ctx.measureText(r).width))+20),height=rows.length*21+12;
      const left=Math.max(v.left+4,Math.min(v.left+v.chartW-width-4,point.x+12)),top=Math.max(v.top+4,Math.min(v.top+v.chartH-height-4,point.y+15));
      ctx.fillStyle='#091721f5';ctx.strokeStyle=hit.side==='buy'?'#3be5a3':'#ff7186';ctx.lineWidth=1;ctx.beginPath();this.roundedRect(ctx,left,top,width,height,6);ctx.fill();ctx.stroke();ctx.fillStyle='#ecf7ff';
      rows.forEach((row,i)=>ctx.fillText(row,left+10,top+19+i*21,width-20));ctx.restore();
    }
    priceLine(price, color, label) {
      if(!Number.isFinite(price)||price<=0)return;
      const view = this.view, y = view.top + (view.max - price) / (view.max - view.min) * view.chartH;
      if (y < view.top || y > view.top + view.chartH) return;
      const ctx = this.ctx; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(view.left, y); ctx.lineTo(view.left + view.chartW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.fillText(label, view.left + 5, y - 5);
    }
    priceText(value) { return value >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value >= 1 ? value.toFixed(3) : value.toPrecision(5); }
    drawCrosshair(point) {
      const canvas = this.crosshairCanvas, rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
      if (!rect.width || !rect.height) return;
      if (canvas.width !== Math.round(rect.width * scale) || canvas.height !== Math.round(rect.height * scale)) { canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale); }
      const ctx = this.crosshairCtx; ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
      if (!this.view) return;
      this.drawInteractions(ctx);
      if (this.selection.length) {
        const first = this.linePoint({time:this.selection[0].time,price:this.selection[0].close});
        const second = this.selection.length > 1 ? this.linePoint({time:this.selection[1].time,price:this.selection[1].close}) : null;
        ctx.fillStyle = '#e5c563';
        if (first) { ctx.beginPath(); ctx.arc(first.x, first.y, 4, 0, Math.PI * 2); ctx.fill(); }
        if (first && second) { ctx.strokeStyle = '#e5c563'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(first.x, first.y); ctx.lineTo(second.x, second.y); ctx.stroke(); ctx.beginPath(); ctx.arc(second.x, second.y, 4, 0, Math.PI * 2); ctx.fill(); }
      }
      if (!point) return;
      const view = this.view, x = Math.max(view.left, Math.min(view.left + view.chartW, point.x)), y = Math.max(view.top, Math.min(view.top + view.chartH, point.y));
      ctx.strokeStyle = '#d7e9d688'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, view.top); ctx.lineTo(x, view.top + view.chartH); ctx.moveTo(view.left, y); ctx.lineTo(view.left + view.chartW, y); ctx.stroke(); ctx.setLineDash([]);
      const value = this.toValue({ x, y }); if (!value) return;
      ctx.font = '11px -apple-system,sans-serif'; ctx.fillStyle = '#203026'; ctx.fillRect(view.left + view.chartW + 2, y - 9, this.pad.right - 5, 18);
      ctx.fillStyle = '#edf7ef'; ctx.fillText(this.priceText(value.price), view.left + view.chartW + 6, y + 3);
      this.drawMarkerTooltip(ctx,point);
    }
    drawSeries(values, color) {
      const view = this.view, ctx = this.ctx; let started = false;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = Math.max(0, view.startIndex); i <= Math.min(this.candles.length - 1, view.endIndex); i++) {
        const value = values[i]; if (value == null || !Number.isFinite(value)) { started = false; continue; }
        const x = view.left + (i - view.startIndex + .5) * view.step;
        const y = view.top + (view.max - value) / (view.max - view.min) * view.chartH;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    getSeries() {
      if (this.seriesCache) return this.seriesCache;
      const close = this.candles.map(item => item.close), studies = window.PTIndicators, names = this.overlays;
      const result = {};
      for (const name of names) { const period=studies.maPeriod(name);if(period)result[name]=studies.sma(close,period); }
      for (const [name, period] of [['ema12',12],['ema26',26]]) if (names.includes(name)) result[name] = studies.ema(close, period);
      if (names.includes('vwap')) result.vwap = studies.vwap(this.candles);
      if (names.includes('boll')) result.boll = studies.bollinger(close);
      return (this.seriesCache = result);
    }
    draw() {
      const canvas = this.canvas, rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1;
      if (!rect.width || !rect.height) return;
      if (canvas.width !== Math.round(rect.width * scale) || canvas.height !== Math.round(rect.height * scale)) { canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale); }
      const ctx = this.ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
      if (!this.candles.length) { this.view = null; this.onViewport?.(null); this.drawCrosshair(null); return; }
      const left = this.pad.left, top = this.pad.top, chartW = Math.max(0, rect.width - left - this.pad.right), chartH = Math.max(50, rect.height - top - this.pad.bottom);
      if (chartW <= 0) return;
      const slots = Math.max(10, Math.floor(chartW / this.barWidth));
      const step = chartW / slots;
      const endIndex = this.candles.length - 1 + this.futureBars - Math.round(this.panBars);
      const startIndex = endIndex - slots + 1;
      const visible = this.candles.slice(Math.max(0, startIndex), Math.min(this.candles.length, endIndex + 1));
      const ownPositions = this.positions.filter(position => position.symbol === window.PTAppSymbol?.());
      const levels = visible.flatMap(candle => [candle.low, candle.high]);
      for (const position of ownPositions) levels.push(position.entry, ...[position.stopLoss, position.takeProfit].filter(Boolean));
      if (this.overlays.includes('boll')) {
        const bands = this.getSeries().boll;
        for (let i = Math.max(0, startIndex); i <= Math.min(this.candles.length - 1, endIndex); i++) if (bands[i]) levels.push(bands[i].upper, bands[i].lower);
      }
      const last = this.candles[this.candles.length - 1].close;
      let min = levels.length ? Math.min(...levels) : last * .99;
      let max = levels.length ? Math.max(...levels) : last * 1.01;
      const spread = Math.max(max - min, max * .002),hasMarkers=ownPositions.length||this.trades.some(t=>t.symbol===window.PTAppSymbol?.()&&t.closedAt>=this.timeAt(startIndex)&&t.openedAt<=this.timeAt(endIndex))||this.markers.length;
      const margin=hasMarkers?Math.max(.08,38/chartH):.08;min-=spread*margin;max+=spread*margin;
      if(this.lockedRange){min=this.lockedRange.min;max=this.lockedRange.max;}
      this.view = { left, top, chartW, chartH, startIndex, endIndex, step, min, max };
      ctx.font = '11px -apple-system,sans-serif'; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = top + i * chartH / 4; ctx.strokeStyle = '#ffffff1a'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + chartW, y); ctx.stroke();
        ctx.fillStyle = '#9caea3'; ctx.fillText(this.priceText(max - i * (max - min) / 4), left + chartW + 8, y + 4);
      }
      for(const box of this.boxes)this.paintBox(ctx,box);
      const zones=[...this.riskZones,...ownPositions.filter(p=>p.takeProfit||p.stopLoss).map(p=>({...p,label:'开仓中间线 '+p.leverage+'×'}))];
      for(const zone of zones)this.paintRiskZone(ctx,zone,'fill');

      for (let index = Math.max(0, startIndex); index <= Math.min(this.candles.length - 1, endIndex); index++) {
        const candle = this.candles[index], middle = left + (index - startIndex + .5) * step;
        const up = candle.close >= candle.open, color = up ? '#00e676' : '#ff6472';
        const yAt = value => top + (max - value) / (max - min) * chartH;
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(middle, yAt(candle.high)); ctx.lineTo(middle, yAt(candle.low)); ctx.stroke();
        const high = Math.min(yAt(candle.open), yAt(candle.close)), height = Math.max(1, Math.abs(yAt(candle.open) - yAt(candle.close)));
        ctx.fillRect(middle - Math.max(1, step * .32), high, Math.max(2, step * .64), height);
      }
      for (let mark = 0; mark <= 4; mark++) {
        const index = startIndex + Math.round(mark * (slots - 1) / 4);
        ctx.fillStyle = '#9caea3'; ctx.fillText(new Date(this.timeAt(index)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), left + mark * chartW / 4, rect.height - 8);
      }
      const series = this.getSeries();
      for (const name of this.overlays) if (series[name]) this.drawSeries(series[name], window.PTIndicators.overlayColor(name));
      if (this.overlays.includes('boll')) {
        this.drawSeries(series.boll.map(item => item?.upper), '#e5b96d');
        this.drawSeries(series.boll.map(item => item?.middle), '#bda3e6');
        this.drawSeries(series.boll.map(item => item?.lower), '#e5b96d');
      }
      for (const position of ownPositions) this.priceLine(window.PTTrade.liquidationPrice(position), '#ff8095', '强平价');
      for (const line of this.lines) this.paintLine(ctx,line);
      for(const zone of zones)this.paintRiskZone(ctx,zone,'lines');
      this.drawMarkers();
      this.onViewport?.(this.view);
      this.onViewChanged?.(this.view);
      this.drawCrosshair(this.pointer);
    }
  }
  window.PTChart = Chart;
})();
