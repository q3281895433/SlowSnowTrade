(function(){
  const $=id=>document.getElementById(id);
  let config,records=[],pending=null,hasKey=false;
  function show(view='chat') {
    const chat=view==='chat';
    $('agentChatPanel').hidden=!chat;$('agentReviewPanel').hidden=chat;
    for(const [id,active] of [['agentChatTab',chat],['agentReviewTab',!chat]]) {
      $(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;
    }
  }
  function message(role,text) {
    const row=document.createElement('article');row.className='agent-message '+role;
    const label=document.createElement('strong');label.textContent=role==='user'?'你':'小雪 Agent';
    const body=document.createElement('div');body.className='agent-message-content';
    for(const line of String(text).split('\n')) {
      const heading=line.match(/^#{1,3}\s+(.+)$/),node=document.createElement(heading?'h3':'p');
      node.textContent=(heading?heading[1]:line).replace(/\*\*(.+?)\*\*/g,'$1');body.append(node);
    }
    row.append(label,body);return row;
  }
  function render() {
    const log=$('agentMessages');log.replaceChildren();
    if(!records.length&&!pending) {
      const welcome=document.createElement('div');welcome.className='agent-welcome';
      welcome.innerHTML='<span class="agent-face large" aria-hidden="true"><i></i><i></i></span><strong>想了解这笔交易的什么？</strong><p>可以问趋势、风险、策略，也可以接着追问。</p>';log.append(welcome);
    }
    for(const item of records.slice(-50)) {
      log.append(message('user',item.question),message('assistant',item.answer));
    }
    if(pending) {
      log.append(message('user',pending.question));const waiting=message('assistant','正在分析…');waiting.classList.add('thinking');log.append(waiting);
    }
    log.scrollTop=log.scrollHeight;
    $('agentSendButton').disabled=!!pending;$('agentQuestion').disabled=!!pending;
    log.setAttribute('aria-busy',String(!!pending));
  }
  function setKey(value) {
    hasKey=!!value;$('keyStatus').textContent=hasKey?'已配置':'未配置';$('keyStatus').classList.toggle('saved',hasKey);
    $('keyCompact').hidden=!hasKey;$('keyInput').hidden=hasKey;$('cancelKeyButton').hidden=!hasKey;
    $('saveKeyButton').disabled=false;
  }
  function submit(event) {
    event?.preventDefault();if(pending)return;
    const question=$('agentQuestion').value.trim();if(!question)return;
    if(!hasKey) {config.note('请先保存 DeepSeek API Key');$('keyInput').hidden=false;$('apiKey').focus();return;}
    const id='chat-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const context=$('agentAttachContext').checked?config.context():null;
    pending={id,question};$('agentQuestion').value='';$('agentQuestionStatus').textContent='正在分析…';render();
    window.PTInteraction?.play('send');config.send({type:'askAgent',id,question,context});
  }
  function init(options) {
    config=options;
    $('agentChatTab').onclick=()=>show('chat');$('agentReviewTab').onclick=()=>show('review');
    for(const id of ['agentChatTab','agentReviewTab'])$(id).onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?'agentChatTab':event.key==='End'?'agentReviewTab':id==='agentChatTab'?'agentReviewTab':'agentChatTab';$(next).click();$(next).focus();
    };
    $('askAgentShortcut').onclick=()=>{window.PTWindows.show('agent');show('chat');$('agentQuestion').focus();};
    $('editKeyButton').onclick=()=>{$('keyCompact').hidden=true;$('keyInput').hidden=false;$('apiKey').focus();};
    $('cancelKeyButton').onclick=()=>{$('apiKey').value='';setKey(hasKey);};
    $('agentQuestionForm').onsubmit=submit;
    $('agentQuestion').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing)submit(event);};
    document.querySelector('.agent-question-shortcuts').onclick=event=>{
      const button=event.target.closest('[data-agent-question]');if(!button||pending)return;
      $('agentQuestion').value=button.dataset.agentQuestion;$('agentQuestion').focus();
    };
  }
  function restore(items) {
    records=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.question==='string'&&typeof x.answer==='string').slice(-200);render();
  }
  function event(type,data) {
    if(!pending||data.id!==pending.id)return;
    if(type==='agentAnswer') {
      records.push(data);records=records.slice(-200);pending=null;render();
      $('agentQuestionStatus').textContent=data.truncated?'回答未完整 · 可继续追问':'已保存到 tradelog';window.PTInteraction?.play('success');
    } else {
      $('agentQuestion').value=pending.question;pending=null;render();
      $('agentQuestionStatus').textContent=data.message||'提问失败，请重试';window.PTInteraction?.play('error');
    }
    show('chat');window.PTWindows.show('agent');$('agentQuestion').focus();
  }
  window.PTAgentChat={init,setKey,restore,show,event};
})();
