(function(){
  const $=id=>document.getElementById(id);
  let config,records=[],pending=null,hasKey=false,paint=0;
  const readNames=new Set(['get_simulated_account','get_market','get_trade_history','get_training_data']);
  const field=(type,description,extra={})=>({type,description,...extra});
  const str=d=>field('string',d),num=d=>field('number',d);
  function tool(name,description,properties={},required=[]) {return {type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}};}
  const tools=[
    tool('get_simulated_account','读取本地模拟账户、持仓、委托与当前杠杆'),
    tool('get_market','读取最新 Bitget 合约盘口与当前周期、1h、4h 合约K线指标，同时区分当前现货图表。',{symbol:str('USDT 交易对；省略为当前币种')}),
    tool('get_trade_history','读取已平仓账单与复盘',{limit:num('1–30，默认 10')}),
    tool('get_training_data','读取本机已保存的交易训练样本；这些是历史记录，不代表模型已经训练。',{limit:num('1–30，默认 8')}),
    tool('open_simulated_trade','实际在本地模拟器下单。只有用户明确要求执行才可调用。先查询最新账户与合约行情。10U 默认成交额10USDT；只有明确说保证金才使用 margin。',{
      symbol:str('USDT 交易对'),side:field('string','方向',{enum:['long','short']}),amount_usdt:num('正数 USDT 金额'),amount_type:field('string','notional 成交额；margin 保证金',{enum:['notional','margin']}),leverage:num('杠杆；省略为当前交易台杠杆'),order_type:field('string','市价或限价，默认市价',{enum:['market','limit']}),limit_price:num('限价时必须指定'),stop_loss:num('止损价格，可选'),take_profit:num('止盈价格，可选'),reason:str('执行理由与策略失效条件')},['side','amount_usdt','amount_type','reason']),
    tool('close_simulated_trade','对指定持仓执行市价平仓或减仓',{position_id:str('真实持仓编号'),percent:num('平仓百分比，(0,100]，默认100'),reason:str('平仓理由')},['position_id','reason']),
    tool('update_simulated_risk','修改已有持仓的止盈止损。不自动开仓。未提供的字段保留，null 清除对应价位。',{position_id:str('持仓编号'),stop_loss:field(['number','null'],'止损价格'),take_profit:field(['number','null'],'止盈价格'),reason:str('设置理由')},['position_id','reason']),
    tool('cancel_simulated_order','撤销本地待成交委托并释放占用资金',{order_id:str('委托编号'),reason:str('撤单理由')},['order_id','reason']),
    tool('adjust_simulated_margin','调整指定模拟持仓保证金，正数追加、负数减少',{position_id:str('持仓编号'),amount_usdt:num('保证金变动 USDT'),reason:str('调整理由')},['position_id','amount_usdt','reason'])
  ];
  function executionRequested(text) {
    // Advice stays read-only; the model cannot grant itself execution permission.
    const action=/(开仓|开多|开空|下单|买入|卖出|做多|做空|平仓|清仓|撤单|止盈|止损|保证金|减仓|交易)/.test(text);
    const command=/(执行|立即|现在就|直接|开始|帮我|请|全部平仓|全部撤单)/.test(text)||/^(?:开仓|开多|开空|下单|买入|卖出|做多|做空|平仓|清仓|撤单|设置|修改|取消|追加|减少)/.test(text)||/(?:用|以).*(?:开多|开空|开仓|下单|买入|卖出|做多|做空)/.test(text);
    const question=/(该不该|要不要|能否|能不能|如何|怎么|建议|是否|[?？吗])/.test(text);
    return action&&command&&!question&&!/(?:(?:不要|别|不需要|不想|禁止).*(?:开仓|下单|交易|执行)|只.*(?:分析|建议))/.test(text);
  }
  function show(view='chat') {
    const chat=view==='chat';$('agentChatPanel').hidden=!chat;$('agentReviewPanel').hidden=chat;
    for(const [id,active] of [['agentChatTab',chat],['agentReviewTab',!chat]]){$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;}
  }
  function message(role,text) {
    const row=document.createElement('article');row.className='agent-message '+role;
    const label=document.createElement('strong');label.textContent=role==='user'?'你':'小雪 Agent';
    const body=document.createElement('div');body.className='agent-message-content agent-stream-text';body.textContent=text;row.append(label,body);return row;
  }
  function controls(){ $('agentSendButton').disabled=!!pending;$('agentQuestion').disabled=!!pending;$('agentStopButton').hidden=!pending;$('agentMessages').setAttribute('aria-busy',String(!!pending)); }
  function render() {
    const log=$('agentMessages');log.replaceChildren();
    if(!records.length&&!pending){const welcome=document.createElement('div');welcome.className='agent-welcome';welcome.innerHTML='<strong>小雪模拟交易 Agent</strong><p>可以分析走势，也可以说：“用成交额 10 USDT，在当前币种开多”。</p>';log.append(welcome);}
    for(const item of records.slice(-50))log.append(message('user',item.question),message('assistant',item.answer));
    if(pending){log.append(message('user',pending.question));pending.row=message('assistant',pending.display||'最高思考 · 正在分析…');log.append(pending.row);}
    log.scrollTop=log.scrollHeight;controls();
  }
  function update(job) {
    if(pending!==job||paint)return;
    paint=requestAnimationFrame(()=>{paint=0;if(pending!==job)return;const log=$('agentMessages'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<70;
      job.row?.querySelector('.agent-message-content')?.replaceChildren(document.createTextNode(job.display||'最高思考 · 正在分析…'));if(bottom)log.scrollTop=log.scrollHeight;
    });
  }
  function setKey(value) {
    hasKey=!!value;$('keyStatus').textContent=hasKey?'已配置':'未配置';$('keyStatus').classList.toggle('saved',hasKey);
    $('keyCompact').hidden=!hasKey;$('keyInput').hidden=hasKey;$('cancelKeyButton').hidden=!hasKey;$('saveKeyButton').disabled=false;
  }
  function round(job) {
    if(pending!==job||job.cancelled)return;
    if(++job.round>8){finish(job,'已达到本次工具轮次上限，请查看执行记录后继续。');return;}
    job.assistant={role:'assistant',content:'',reasoning_content:'',tool_calls:[]};job.fragments=new Map();job.finishReason=null;job.ending=false;
    $('agentQuestionStatus').textContent='最高思考 · 第 '+job.round+' 轮';
    config.send({type:'askAgent',id:job.id,round:job.round,question:job.question,messages:job.messages,tools:tools.filter(t=>job.allowTrade||readNames.has(t.function.name))});
  }
  function finish(job,extra='') {
    if(pending!==job)return;
    job.cancelled=true;let answer=job.display.trim();if(extra)answer+=(answer?'\n\n':'')+extra;
    if(!answer)answer='未返回回答，也未执行交易。';
    const record={id:job.id,question:job.question,answer,createdAt:Date.now()/1000,model:'deepseek-v4-pro',reasoningEffort:'max',tools:job.executions,stopped:!!extra};
    records.push(record);records=records.slice(-200);pending=null;render();$('agentQuestionStatus').textContent='正在保存到 tradelog…';
    config.send({type:'saveAgentConversation',record});
  }
  async function end(job) {
    if(job.ending||pending!==job)return;job.ending=true;
    if(job.finishReason!=='tool_calls'){
      finish(job,job.finishReason==='length'?'输出达到模型长度限制；未完成的工具指令没有执行。':job.fragments.size||job.finishReason!=='stop'?'输出或工具指令未完整，已停止执行。':'');return;
    }
    const calls=[...job.fragments.entries()].sort((a,b)=>a[0]-b[0]).map(([,c])=>c);
    if(!calls.length||calls.length>12||calls.some(c=>!c.id||c.type!=='function'||!c.function.name)){finish(job,'工具指令格式无效，没有执行。');return;}
    job.assistant.tool_calls=calls;job.messages.push(job.assistant);
    for(const call of calls){
      if(pending!==job||job.cancelled)return;
      let args,result,writing=!readNames.has(call.function.name);
      const active=()=>pending===job&&!job.cancelled&&(!writing||job.allowTrade&&$('agentAllowTrade').checked);
      try {
        args=JSON.parse(call.function.arguments);if(!args||Array.isArray(args)||typeof args!=='object')throw Error('参数必须是对象');
        const definition=tools.find(t=>t.function.name===call.function.name);if(!definition)throw Error('工具不存在');
        if(!active())throw Error('当前提问没有授权执行模拟交易');
        for(const key of definition.function.parameters.required)if(!(key in args))throw Error('缺少参数：'+key);
        for(const [key,value] of Object.entries(args)){
          const schema=definition.function.parameters.properties[key];if(!schema)throw Error('未知参数：'+key);
          const types=Array.isArray(schema.type)?schema.type:[schema.type],actual=value===null?'null':typeof value;
          if(!types.includes(actual)||(actual==='number'&&!Number.isFinite(value))||(schema.enum&&!schema.enum.includes(value)))throw Error('参数类型或取值无效：'+key);
        }
        const canonical=JSON.stringify(Object.fromEntries(Object.entries(args).filter(([k])=>k!=='reason').sort(([a],[b])=>a.localeCompare(b)))),signature=call.function.name+canonical;
        if(writing&&job.writes.has(signature))result={...job.writes.get(signature),duplicatePrevented:true};
        else {if(writing&&job.writeCount>=6)throw Error('本次最多执行 6 项模拟账户变更');result=await config.executeTool(call.function.name,args,{id:job.id,callId:call.id,active});
          if(writing){job.writeCount++;job.writes.set(signature,result);}}
      }catch(error){result={ok:false,error:error.message};}
      if(pending!==job||job.cancelled)return;
      const entry={callId:call.id,name:call.function.name,args,result,at:Date.now()};job.executions.push(entry);config.record?.('agent_tool_result',{chatId:job.id,...entry});
      job.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
      job.display+='\n[工具 '+call.function.name+'] '+(result.ok===false?'未执行：'+result.error:'完成'+(result.duplicatePrevented?'（重复操作已拦截）':''))+'\n';update(job);
    }
    round(job);
  }
  function submit(event) {
    event?.preventDefault();if(pending)return;const question=$('agentQuestion').value.trim();if(!question)return;
    if(!hasKey){config.note('请先保存 DeepSeek API Key');$('keyInput').hidden=false;$('apiKey').focus();return;}
    const id='chat-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),allowTrade=$('agentAllowTrade').checked&&executionRequested(question);
    const history=records.slice(-6).map(r=>({question:r.question,answer:r.answer.slice(-8000)}));
    const context=$('agentAttachContext').checked?config.context():null;
    pending={id,question,allowTrade,messages:[{role:'user',content:JSON.stringify({question,executionAuthorized:allowTrade,context,previousConversation:history})}],round:0,display:'',executions:[],writes:new Map(),writeCount:0,cancelled:false};
    $('agentQuestion').value='';render();window.PTInteraction?.play('send');round(pending);
  }
  function init(options) {
    config=options;$('agentChatTab').onclick=()=>show('chat');$('agentReviewTab').onclick=()=>show('review');
    for(const id of ['agentChatTab','agentReviewTab'])$(id).onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'agentChatTab':event.key==='End'?'agentReviewTab':id==='agentChatTab'?'agentReviewTab':'agentChatTab';$(next).click();$(next).focus();};
    $('askAgentShortcut').onclick=()=>{window.PTWindows.show('agent');show('chat');$('agentQuestion').focus();};
    $('editKeyButton').onclick=()=>{$('keyCompact').hidden=true;$('keyInput').hidden=false;$('apiKey').focus();};
    $('cancelKeyButton').onclick=()=>{$('apiKey').value='';setKey(hasKey);};
    $('agentQuestionForm').onsubmit=submit;$('agentQuestion').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing)submit(event);};
    $('agentStopButton').onclick=()=>{const job=pending;if(!job)return;job.cancelled=true;config.send({type:'cancelAgent',id:job.id});finish(job,'已停止思考和后续执行。已完成的模拟账户操作保留，详情见工具记录。');};
    document.querySelector('.agent-question-shortcuts').onclick=event=>{const button=event.target.closest('[data-agent-question]');if(!button||pending)return;$('agentQuestion').value=button.dataset.agentQuestion;$('agentQuestion').focus();};
  }
  function restore(items){records=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.question==='string'&&typeof x.answer==='string').slice(-200);render();}
  function event(type,data) {
    if(type==='agentAnswer'||type==='agentSaveError'){if(records.some(r=>r.id===data.id))$('agentQuestionStatus').textContent=type==='agentAnswer'?'已保存到 tradelog':data.message||'保存失败';return;}
    const job=pending;if(!job||data.id!==job.id||data.round!==job.round)return;
    if(type==='agentDelta'){
      const choice=data.chunk?.choices?.[0],delta=choice?.delta||{};if(choice?.finish_reason)job.finishReason=choice.finish_reason;
      if(typeof delta.reasoning_content==='string')job.assistant.reasoning_content+=delta.reasoning_content;
      if(typeof delta.content==='string'){job.assistant.content+=delta.content;job.display+=delta.content;update(job);}
      for(const part of delta.tool_calls||[]){if(!Number.isInteger(part.index)||part.index<0||part.index>11)continue;let c=job.fragments.get(part.index);if(!c){c={id:'',type:'function',function:{name:'',arguments:''}};job.fragments.set(part.index,c);}if(part.id)c.id+=part.id;if(part.type)c.type=part.type;if(part.function?.name)c.function.name+=part.function.name;if(part.function?.arguments)c.function.arguments+=part.function.arguments;}
    }else if(type==='agentStreamEnd')void end(job);
    else if(type==='agentError')finish(job,'连接或模型请求失败：'+(data.message||'请重试')+'。未完整的工具指令没有执行。');
  }
  window.PTAgentChat={init,setKey,restore,show,event};
})();
