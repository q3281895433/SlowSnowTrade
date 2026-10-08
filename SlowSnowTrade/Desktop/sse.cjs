// Parse complete SSE events, retaining split UTF-8 sequences and tool-call fragments.
class SSEParser {
  constructor(onData){this.onData=onData;this.decoder=new TextDecoder();this.buffer='';this.data=[];this.done=false;}
  feed(bytes){this.buffer+=this.decoder.decode(bytes,{stream:true});this.lines();if(this.buffer.length>8*1024*1024)throw new Error('流式事件过大');}
  lines(){let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);if(!line){this.event();}else if(line.startsWith('data:'))this.data.push(line.slice(5).trimStart());}}
  event(){if(!this.data.length)return;const text=this.data.join('\n');this.data=[];if(text==='[DONE]'){this.done=true;return;}const data=JSON.parse(text);if(data.error)throw new Error('DeepSeek 流式响应出错');this.onData(data);}
  finish(){this.buffer+=this.decoder.decode();this.lines();if(this.buffer.startsWith('data:'))this.data.push(this.buffer.slice(5).trim());this.event();if(!this.done)throw new Error('流式连接提前结束；未完成的工具指令不会执行');}
}
module.exports=SSEParser;
