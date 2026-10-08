(function () {
  const FEE_RATE = 0.0004;
  const MAINTENANCE_RATE = 0.005;

  function createAccount() { return { cash: 10000, deposits: 0, withdrawals: 0, positions: [], history: [], movements: [], orders: [], orderHistory: [] }; }
  function mark(position, prices) { return Number(prices[position.symbol] || position.entry); }
  function grossPnL(position, price) { return (position.side === 'long' ? 1 : -1) * (price - position.entry) * position.qty; }
  function floating(account, prices) { return account.positions.reduce((total, p) => total + grossPnL(p, mark(p, prices)), 0); }
  function locked(account) { return account.positions.reduce((total, p) => total + p.margin, 0) + (account.orders || []).reduce((n,o)=>n+(o.reserved||0),0); }
  function equity(account, prices) { return account.cash + locked(account) + floating(account, prices); }
  function realized(account) { return account.history.reduce((total, item) => total + item.netPnL, 0); }

  function normalizeRules(raw) {
    let deduction = 0, previousRate = 0;
    const tiers = (raw?.tiers || []).map(t => ({min:Number(t.startUnit),max:Number(t.endUnit),rate:Number(t.keepMarginRate),maxLeverage:Number(t.leverage)}))
      .filter(t => Number.isFinite(t.min) && Number.isFinite(t.max) && t.max > t.min && t.rate > 0 && t.rate < 1 && Number.isFinite(t.maxLeverage) && t.maxLeverage >= 1).sort((a,b) => a.min-b.min)
      .map(t => { deduction += t.min * (t.rate-previousRate); previousRate=t.rate; return {...t,deduction}; });
    const feeRate = Number(raw?.feeRate),maker = Number(raw?.makerFeeRate ?? feeRate);
    if (!tiers.length || !Number.isFinite(feeRate) || feeRate < 0 || feeRate >= .01) return null;
    return {source:'bitget',tiers,feeRate,maxLeverage:Math.min(100,Number(raw.maxLeverage)||100),minQty:Number(raw.minQty)||0,
      qtyStep:Number(raw.qtyStep)||0,makerFeeRate:Number.isFinite(maker)&&maker>=0&&maker<.01?maker:feeRate,minNotional:Number(raw.minNotional)||0,status:raw.status||'normal'};
  }
  function tierAt(position,price) {
    const tiers=position.riskModel?.tiers,notional=position.qty*price;
    return tiers?.find(t=>notional<=t.max) || tiers?.at(-1) || {min:0,max:Infinity,rate:MAINTENANCE_RATE,deduction:0,maxLeverage:100};
  }
  function feeRate(position) { return position.riskModel?.feeRate ?? FEE_RATE; }
  function riskStatus(position,price) {
    if(!Number.isFinite(price)||price<=0)return null;
    const tier=tierAt(position,price),notional=position.qty*price;
    const marginBalance=position.margin+grossPnL(position,price),maintenance=Math.max(0,notional*tier.rate-tier.deduction),feeReserve=notional*feeRate(position);
    return {markPrice:price,marginBalance,maintenance,feeReserve,required:maintenance+feeReserve,tier,
      ratio:marginBalance>0?(maintenance+feeReserve)/marginBalance:null,liquidating:marginBalance<=maintenance+feeReserve+1e-8};
  }

  function liquidationPrice(position) {
    const direction=position.side==='long'?1:-1,tiers=position.riskModel?.tiers||[tierAt(position,position.entry)];
    for(const tier of tiers){
      const price=(position.margin+tier.deduction-position.qty*position.entry*direction)/(position.qty*(tier.rate+feeRate(position)-direction));
      const notional=Math.max(0,price)*position.qty;
      if(notional>=tier.min-1e-7&&notional<=tier.max+1e-7)return Math.max(0,price);
    }
    return null;
  }

  function bankruptcyPrice(position) { return Math.max(0,position.entry+(position.side==='long'?-1:1)*position.margin/position.qty); }

  function open(account, options) {
    const { symbol, side, price, margin, leverage, riskModel, stopLoss = null, takeProfit = null } = options;
    if (!symbol || !['long', 'short'].includes(side) || !Number.isFinite(price) || price <= 0) throw new Error('暂无有效行情价格');
    if (options.qty == null && (!Number.isFinite(margin) || margin <= 0)) throw new Error('请输入大于 0 的保证金');
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 100) throw new Error('杠杆范围为 1–100 倍');
    if(!riskModel?.tiers?.length)throw new Error('正在获取该币种合约标记价和仓位档位');
    if(riskModel.status!=='normal')throw new Error('该合约当前不允许开仓');
    const requestedNotional = margin * leverage;
    const rawQty = options.qty == null ? requestedNotional / price : Number(options.qty),step=riskModel.qtyStep;
    const qty=step>0?Number((Math.floor((rawQty+step*1e-9)/step)*step).toPrecision(12)):rawQty;
    const notional = qty * price,actualMargin=notional/leverage;
    if(!Number.isFinite(qty)||!Number.isFinite(notional)||qty<riskModel.minQty||notional<riskModel.minNotional||qty<=0)throw new Error('数量或成交额低于该合约最小开仓限制');
    const tier=tierAt({qty,riskModel},price);
    if(notional>riskModel.tiers.at(-1).max)throw new Error('仓位价值超出该合约最高风险档位');
    if(leverage>Math.min(riskModel.maxLeverage,tier.maxLeverage))throw new Error('该仓位档位最多允许 '+Math.min(riskModel.maxLeverage,tier.maxLeverage)+' 倍杠杆');
    const openFee = notional * (options.maker ? riskModel.makerFeeRate ?? riskModel.feeRate : riskModel.feeRate);
    if (account.cash + 1e-8 < actualMargin + openFee) throw new Error('可用 USDT 不足以支付保证金和手续费');
    const position = { id: crypto.randomUUID(), symbol, side, qty, entry: price, margin:actualMargin, leverage, notional,marginMode:'isolated',riskModel,
      orderType:options.orderType||'market',openFee, stopLoss: validLevel(stopLoss, side, price, 'stop'), takeProfit: validLevel(takeProfit, side, price, 'take'), openedAt: Date.now() };
    if(riskStatus(position,price).liquidating)throw new Error('保证金不足以满足该档位的维持保证金和平仓手续费');
    account.cash -= actualMargin + openFee;
    account.positions.unshift(position);
    return position;
  }

  function validLevel(raw, side, entry, kind) {
    if (raw === '' || raw === null || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error('止盈止损价格必须大于 0');
    const below = kind === 'stop' ? side === 'long' : side === 'short';
    if (below && value >= entry) throw new Error(kind === 'stop' ? '止损价必须低于开仓价' : '止盈价必须低于开仓价');
    if (!below && value <= entry) throw new Error(kind === 'stop' ? '止损价必须高于开仓价' : '止盈价必须高于开仓价');
    return value;
  }

  function setRisk(position, stopLoss, takeProfit) {
    const stop = validLevel(stopLoss, position.side, position.entry, 'stop');
    const take = validLevel(takeProfit, position.side, position.entry, 'take');
    position.stopLoss = stop;
    position.takeProfit = take;
  }

  function close(account, id, price, reason = '手动平仓', details = {}) {
    const index = account.positions.findIndex(p => p.id === id);
    if (index < 0) throw new Error('持仓不存在');
    const p = account.positions[index];
    const liquidated = reason === '触发强平';
    if (!Number.isFinite(price) || price < 0 || (!liquidated && price === 0)) throw new Error('暂无有效的平仓价格');
    const gross = grossPnL(p, price);
    const closeFee = liquidated ? 0 : price * p.qty * (details.maker ? p.riskModel?.makerFeeRate ?? feeRate(p) : feeRate(p));
    const payout = liquidated ? 0 : Math.max(0, p.margin + gross - closeFee);
    const netPnL = payout - p.margin - p.openFee;
    const trade = { ...p, exit: price, grossPnL: gross, closeFee, netPnL, roi: netPnL / p.margin * 100,
      liquidated, liquidationCharge:0, reason, closedAt: Date.now(), ...details };
    account.cash += payout;
    account.positions.splice(index, 1);
    for(const order of [...(account.orders||[])])if(order.positionId===id&&order.id!==details.orderId)cancelOrder(account,order.id,'持仓已结束');
    account.history.unshift(trade);
    return trade;
  }

  function triggerReason(position, price, markPrice = null) {
    if(riskStatus(position,markPrice)?.liquidating)return '触发强平';
    if(!Number.isFinite(price)||price<=0)return null;
    if (position.side === 'long') {
      if (position.stopLoss && price <= position.stopLoss) return '触发止损';
      if (position.takeProfit && price >= position.takeProfit) return '触发止盈';
    } else {
      if (position.stopLoss && price >= position.stopLoss) return '触发止损';
      if (position.takeProfit && price <= position.takeProfit) return '触发止盈';
    }
    return null;
  }

  function liquidate(account,id,quote) {
    const p=account.positions.find(item=>item.id===id),events=[];
    if(!p)return events;
    let risk=riskStatus(p,quote.mark);
    while(risk?.liquidating){
      const tiers=p.riskModel?.tiers||[],level=tiers.indexOf(risk.tier),book=Number(p.side==='long'?quote.bid:quote.ask)||quote.last||quote.mark;
      // Reduce to the next lower risk tier first. Realized losses stay in this isolated margin.
      const cap=level>0?tiers[level-1].max/quote.mark:0,step=p.riskModel?.qtyStep||0;
      const rawClose=p.qty-cap,closeQty=step>0?Math.ceil(rawClose/step)*step:rawClose;
      const gross=grossPnL({...p,qty:closeQty},book),closeFee=closeQty*book*feeRate(p);
      if(level>0&&closeQty>0&&closeQty<p.qty&&p.margin+gross-closeFee>0){
        const fraction=closeQty/p.qty,openFee=p.openFee*fraction,netPnL=gross-closeFee-openFee;
        const event={...p,id:crypto.randomUUID(),parentPositionId:p.id,qty:closeQty,margin:p.margin*fraction,notional:p.entry*closeQty,
          openFee,exit:book,grossPnL:gross,closeFee,netPnL,roi:netPnL/(p.margin*fraction)*100,reason:'强平降档减仓',partial:true,liquidated:false,
          triggerMarkPrice:quote.mark,triggerRisk: risk,closedAt:Date.now()};
        p.qty-=closeQty;p.notional=p.entry*p.qty;p.margin+=gross-closeFee;p.openFee-=openFee;
        account.history.unshift(event);events.push(event);risk=riskStatus(p,quote.mark);continue;
      }
      const triggerLiquidationPrice=liquidationPrice(p),exit=bankruptcyPrice(p);
      events.push(close(account,p.id,exit,'触发强平',{triggerMarkPrice:quote.mark,triggerLiquidationPrice,triggerRisk:risk,
        execution:'insurance-takeover',insuranceCovered:Math.max(0,-(p.margin+grossPnL(p,book)))}));
      break;
    }
    return events;
  }


  function quantity(raw,model) {
    const n=Number(raw),step=model?.qtyStep||0;
    return step>0?Number((Math.floor((n+step*1e-9)/step)*step).toPrecision(12)):n;
  }
  function availableClose(account,positionId) {
    const p=account.positions.find(p=>p.id===positionId);
    return Math.max(0,(p?.qty||0)-(account.orders||[]).filter(o=>o.positionId===positionId).reduce((n,o)=>n+o.qty,0));
  }
  function closeQuantity(account,id,price,qty,reason='手动平仓',details={}) {
    const p=account.positions.find(p=>p.id===id);if(!p)throw new Error('持仓不存在');
    qty=quantity(qty,p.riskModel);
    if(!(qty>0)||qty>p.qty+1e-10)throw new Error('平仓数量超过可平仓数量');
    if(qty>=p.qty-1e-10)return close(account,id,price,reason,details);
    if(!(price>0)||!Number.isFinite(price))throw new Error('暂无有效的平仓价格');
    const fraction=qty/p.qty,part={...p,id:crypto.randomUUID(),parentPositionId:p.id,qty,margin:p.margin*fraction,openFee:p.openFee*fraction,notional:p.entry*qty};
    const gross=grossPnL(part,price),closeFee=price*qty*(details.maker?p.riskModel?.makerFeeRate??feeRate(p):feeRate(p)),payout=Math.max(0,part.margin+gross-closeFee),netPnL=payout-part.margin-part.openFee;
    const trade={...part,exit:price,grossPnL:gross,closeFee,netPnL,roi:netPnL/part.margin*100,partial:true,liquidated:false,reason,closedAt:Date.now(),...details};
    p.qty=Number((p.qty-qty).toPrecision(12));p.margin-=part.margin;p.openFee-=part.openFee;p.notional=p.qty*p.entry;
    account.cash+=payout;account.history.unshift(trade);return trade;
  }
  function placeOrder(account,options,quote) {
    if(!quote||!(quote.ask>0&&quote.bid>0))throw new Error('暂无有效的合约报价');
    const closing=!!options.positionId,p=closing?account.positions.find(p=>p.id===options.positionId):null;
    if(closing&&!p)throw new Error('请选择要平仓的账单');
    const side=closing?p.side:options.side,model=closing?p.riskModel:options.riskModel;
    const qty=quantity(options.qty,model),type=options.orderType||'market',limit=Number(options.price);
    if(!(qty>0))throw new Error('请输入有效的币种数量');
    if(closing&&qty>availableClose(account,p.id)+1e-10)throw new Error('数量超过未被委托占用的持仓数量');
    if(!['market','limit'].includes(type))throw new Error('无效的委托类型');
    if(type==='limit'&&!(limit>0))throw new Error('请输入有效的委托价格');
    const buy=(side==='long')!==closing,book=buy?quote.ask:quote.bid,marketable=type==='market'||(buy?book<=limit:book>=limit);
    if(marketable) {
      return {kind:closing?'closed':'opened',trade:closing?closeQuantity(account,p.id,book,qty,'手动平仓',{orderType:type}):open(account,{...options,side,qty,price:book,orderType:type})};
    }
    let reserved=0;
    if(!closing){const preview=open({...account,cash:account.cash,positions:[]},{...options,qty,price:limit,orderType:type});reserved=preview.margin+preview.openFee;}
    const order={id:crypto.randomUUID(),symbol:closing?p.symbol:options.symbol,side,qty,price:limit,leverage:closing?p.leverage:options.leverage,riskModel:model,positionId:p?.id||null,
      reduceOnly:closing,orderType:type,reserved,stopLoss:closing?null:validLevel(options.stopLoss,side,limit,'stop'),takeProfit:closing?null:validLevel(options.takeProfit,side,limit,'take'),status:'pending',createdAt:Date.now()};
    account.cash-=reserved;(account.orders??=[]).unshift(order);return {kind:'pending',order};
  }
  function cancelOrder(account,id,reason='已撤销') {
    const index=(account.orders||[]).findIndex(o=>o.id===id);if(index<0)return null;
    const order=account.orders.splice(index,1)[0];account.cash+=order.reserved||0;
    const result={...order,status:reason,finishedAt:Date.now()};(account.orderHistory??=[]).unshift(result);return result;
  }
  function fillOrders(account,symbol,quote,model) {
    const events=[];
    for(const o of [...(account.orders||[])]){
      if(o.symbol!==symbol)continue;
      const p=o.positionId&&account.positions.find(p=>p.id===o.positionId);
      if(o.reduceOnly&&!p){events.push({kind:'cancelled',order:cancelOrder(account,o.id,'持仓已结束')});continue;}
      const buy=(o.side==='long')!==o.reduceOnly,book=buy?quote.ask:quote.bid;
      if(!(book>0)||(buy?book>o.price:book<o.price))continue;
      if(!o.reduceOnly&&!model)continue;
      account.cash+=o.reserved||0;
      try {
        const trade=o.reduceOnly?closeQuantity(account,o.positionId,book,o.qty,'限价平仓',{orderId:o.id,orderType:'limit',maker:true}):open(account,{...o,riskModel:model,price:book,maker:true,orderType:'limit'});
        account.orders=account.orders.filter(item=>item.id!==o.id);
        const filled={...o,status:'filled',fillPrice:book,tradeId:trade.id,finishedAt:Date.now()};(account.orderHistory??=[]).unshift(filled);
        events.push({kind:o.reduceOnly?'closed':'opened',order:filled,trade});
      }catch(error){account.cash-=o.reserved||0;events.push({kind:'rejected',order:cancelOrder(account,o.id,'拒绝成交：'+error.message)});}
    }
    return events;
  }
  function adjustMargin(account,id,delta,markPrice) {
    const p=account.positions.find(p=>p.id===id);if(!p)throw new Error('持仓不存在');
    delta=Number(delta);if(!Number.isFinite(delta)||delta===0)throw new Error('请输入有效的保证金数额');
    if(delta>account.cash)throw new Error('可用 USDT 不足');
    const margin=p.margin+delta,risk=riskStatus({...p,margin},markPrice);
    if(!(margin>0)||!risk||risk.liquidating)throw new Error('调整后保证金不足以覆盖维持保证金和手续费');
    p.margin=margin;account.cash-=delta;
    const movement={id:crypto.randomUUID(),positionId:id,symbol:p.symbol,kind:'margin',amount:delta,cashAfter:account.cash,marginAfter:margin,at:Date.now()};
    account.movements.unshift(movement);return movement;
  }

  function adjustBalance(account, amount) {
    if (!Number.isFinite(amount) || amount === 0) throw new Error('请输入有效的 USDT 数额');
    if (amount < 0 && account.cash < -amount) throw new Error('可用 USDT 不足');
    account.cash += amount;
    if (amount > 0) account.deposits += amount; else account.withdrawals += -amount;
    const movement = { id: crypto.randomUUID(), amount, cashAfter: account.cash, at: Date.now() };
    account.movements.unshift(movement);
    return movement;
  }

  window.PTTrade = { FEE_RATE, MAINTENANCE_RATE, createAccount, mark, grossPnL, floating, locked, equity, realized,
    normalizeRules, tierAt, feeRate, riskStatus, liquidationPrice, bankruptcyPrice, liquidate, open, close, validLevel, setRisk, triggerReason, adjustBalance, quantity, availableClose, closeQuantity, placeOrder, cancelOrder, fillOrders, adjustMargin };
})();
