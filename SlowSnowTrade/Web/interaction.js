(function(){
  let enabled=true,context,lastTap=0;
  try{enabled=localStorage.getItem('sst-sound')!=='off';}catch{}
  const toggle=document.getElementById('soundToggle');
  function sync(){toggle.textContent='音效 '+(enabled?'开':'关');toggle.setAttribute('aria-pressed',String(enabled));toggle.setAttribute('aria-label',enabled?'关闭界面音效':'开启界面音效');}
  function play(kind='tap') {
    if(!enabled)return;
    try {
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      context ||= new Audio();if(context.state==='suspended')context.resume();
      if(context.state!=='running')return;
      const now=context.currentTime,notes={tap:[700],send:[440,660],success:[660,880],error:[330,260]}[kind]||[700];
      notes.forEach((frequency,index)=>{
        const osc=context.createOscillator(),gain=context.createGain(),start=now+index*.065;
        osc.type='sine';osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(frequency*.92,start+.10);
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.025,start+.008);gain.gain.exponentialRampToValueAtTime(.001,start+.12);
        osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.13);
      });
    } catch{}
  }
  toggle.onclick=()=>{enabled=!enabled;try{localStorage.setItem('sst-sound',enabled?'on':'off');}catch{}sync();if(enabled)play();};
  document.addEventListener('click',event=>{
    const control=event.target.closest('button,summary');if(!control||control.disabled||control===toggle||control.id==='agentSendButton')return;
    if(Date.now()-lastTap<80)return;lastTap=Date.now();play();
  },{passive:true});
  sync();window.PTInteraction={play};
})();
