(function () {
  const desk = document.getElementById('desk');
  const definitions = [
    ['markets', '.sidebar', '市场与账户', '◉'],
    ['chart', '#workspace', 'K 线工作台', '▥'],
    ['order', '.order-panel', '交易台', '⇅'],
    ['agent', '.agent-panel', 'DeepSeek Agent', '✦'],
    ['activity', '.activity-panel', '持仓与记录', '▤'],
    ['discover', '.discovery-panel', '发现币种', '⌕']
  ];
  const nodes = definitions.map(([id, selector, title, icon]) => ({ id, node: document.querySelector(selector), title, icon }));
  const layer = document.createElement('div'); layer.className = 'window-layer'; layer.id = 'windowLayer';
  const taskbar = document.createElement('div'); taskbar.className = 'window-taskbar'; taskbar.id = 'windowTaskbar';
  desk.replaceChildren(layer, taskbar);
  const frames = new Map();
  const rects = new Map();
  let topZ = 10;
  let onChange = null;
  const dimension = () => ({ width: Math.max(980, layer.clientWidth), height: Math.max(500, layer.clientHeight) });
  function defaults() {
    const { width: w, height: h } = dimension();
    const left = 224, right = 304, middleX = left + 20, middleW = Math.max(350, w - middleX - right - 20);
    return {
      markets: { x: 10, y: 10, w: left, h: Math.max(300, h - 174) },
      chart: { x: middleX, y: 10, w: middleW, h: Math.max(390, h - 174) },
      order: { x: w - right - 10, y: 10, w: right, h: Math.max(220, Math.round(h * .48)) },
      agent: { x: w - right - 10, y: Math.round(h * .50), w: right, h: Math.max(170, Math.round(h * .30)) },
      activity: { x: 10, y: h - 180, w: w - 20, h: 170 },
      discover: {x:Math.max(10,(w-620)/2),y:40,w:620,h:Math.min(530,h-60),hidden:true}
    };
  }
  function paint(id) {
    const frame = frames.get(id), r = rects.get(id); if (!frame || !r) return;
    frame.style.left = r.x + 'px'; frame.style.top = r.y + 'px'; frame.style.width = r.w + 'px'; frame.style.height = r.h + 'px';
    frame.style.zIndex = r.z; frame.hidden = !!r.hidden;
    frame.classList.toggle('maximized', !!r.maximized);
    const button = taskbar.querySelector(`[data-task="${id}"]`); if (button) button.classList.toggle('minimized', !!r.hidden);
  }
  function emit() { onChange?.(); }
  function focus(id) { const r = rects.get(id); if (!r) return; r.z = ++topZ; paint(id); for (const [key, frame] of frames) { const selected = key === id; frame.classList.toggle('active', selected); taskbar.querySelector(`[data-task="${key}"]`)?.classList.toggle('active', selected); } }
  function show(id) { const r = rects.get(id); if (!r) return; r.hidden = false; focus(id); emit(); }
  function hide(id) { const r = rects.get(id); if (!r) return; r.hidden = true; paint(id); const next = [...rects].filter(([, item]) => !item.hidden).sort((a,b) => b[1].z - a[1].z)[0]; if (next) focus(next[0]); emit(); }
  function toggleMax(id) {
    const r = rects.get(id); if (!r) return;
    if (r.maximized) { Object.assign(r, r.previous || {}); r.maximized = false; }
    else { r.previous = { x: r.x, y: r.y, w: r.w, h: r.h }; const d = dimension(); Object.assign(r, { x: 4, y: 4, w: d.width - 8, h: d.height - 8, maximized: true }); }
    focus(id); emit();
  }
  const edgeNames = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  for (const item of nodes) {
    const frame = document.createElement('section'); frame.className = 'desktop-window'; frame.dataset.window = item.id;
    frame.innerHTML = `<div class="window-titlebar"><span class="window-symbol">${item.icon}</span><strong>${item.title}</strong><div class="window-actions"><button type="button" data-window-action="min" title="最小化" aria-label="最小化 ${item.title}">─</button><button type="button" data-window-action="max" title="最大化或还原" aria-label="最大化 ${item.title}">□</button><button type="button" data-window-action="close" title="关闭窗口" aria-label="关闭 ${item.title}">×</button></div></div>`;
    const content = document.createElement('div'); content.className = 'window-content'; content.append(item.node); frame.append(content);
    for (const edge of edgeNames) { const handle = document.createElement('div'); handle.className = 'window-edge edge-' + edge; handle.dataset.edge = edge; frame.append(handle); }
    layer.append(frame); frames.set(item.id, frame);
    const task = document.createElement('button'); task.type = 'button'; task.className = 'window-task'; task.dataset.task = item.id; task.innerHTML = `<span>${item.icon}</span>${item.title}`; taskbar.append(task);
    task.onclick = () => rects.get(item.id)?.hidden ? show(item.id) : (focus(item.id), emit());
    frame.addEventListener('pointerdown', () => focus(item.id));
    frame.querySelector('.window-actions').onclick = event => { const button = event.target.closest('[data-window-action]'); if (!button) return; event.stopPropagation(); const action = button.dataset.windowAction; if (action === 'max') toggleMax(item.id); else hide(item.id); };
    const titlebar = frame.querySelector('.window-titlebar');
    titlebar.ondblclick = event => { if (!event.target.closest('button')) toggleMax(item.id); };
    titlebar.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; drag(event, item.id, 'move', titlebar); });
    frame.querySelectorAll('.window-edge').forEach(handle => handle.addEventListener('pointerdown', event => drag(event, item.id, handle.dataset.edge, handle)));
  }
  function drag(event, id, mode, handle) {
    const rect = rects.get(id); if (!rect || rect.maximized) return;
    event.preventDefault(); event.stopPropagation(); focus(id); handle.setPointerCapture(event.pointerId);
    const origin = { ...rect }, startX = event.clientX, startY = event.clientY;
    const minWidth = { markets: 190, chart: 350, order: 250, agent: 250, activity: 380 }[id] || 220;
    const minHeight = { chart: 440, activity: 160 }[id] || 135;
    const move = point => {
      const dx = point.clientX - startX, dy = point.clientY - startY, bound = dimension();
      let x = origin.x, y = origin.y, w = origin.w, h = origin.h;
      if (mode === 'move') { x += dx; y += dy; }
      else {
        if (mode.includes('e')) w += dx;
        if (mode.includes('s')) h += dy;
        if (mode.includes('w')) { x += dx; w -= dx; }
        if (mode.includes('n')) { y += dy; h -= dy; }
        if (w < minWidth) { if (mode.includes('w')) x -= minWidth - w; w = minWidth; }
        if (h < minHeight) { if (mode.includes('n')) y -= minHeight - h; h = minHeight; }
      }
      rect.x = Math.max(-w + 70, Math.min(bound.width - 70, Math.round(x)));
      rect.y = Math.max(0, Math.min(bound.height - 32, Math.round(y)));
      rect.w = Math.round(w); rect.h = Math.round(h); paint(id);
    };
    const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); emit(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  function restore(saved) {
    const base = defaults();
    for (const item of nodes) {
      const input = saved?.[item.id], d = base[item.id];
      const r = input && Number.isFinite(input.x) && Number.isFinite(input.y) && Number.isFinite(input.w) && Number.isFinite(input.h) ? { ...d, ...input } : { ...d };
      if(item.id==='activity'&&r.h<160)r.h=160;
      r.z = Number.isFinite(r.z) ? r.z : ++topZ;
      topZ = Math.max(topZ, r.z);
      rects.set(item.id, r); paint(item.id);
    }
    const active = [...rects].filter(([, item]) => !item.hidden).sort((a,b) => b[1].z - a[1].z)[0]?.[0];
    for (const [key, frame] of frames) { const selected = key === active; frame.classList.toggle('active', selected); taskbar.querySelector(`[data-task="${key}"]`)?.classList.toggle('active', selected); }
  }
  function serialize() { return Object.fromEntries([...rects].map(([id, r]) => [id, { x: r.x, y: r.y, w: r.w, h: r.h, z: r.z, hidden: !!r.hidden, maximized: !!r.maximized, previous: r.previous || null }])); }
  window.addEventListener('resize', () => { for (const item of nodes) { const r = rects.get(item.id); if (r?.maximized) { const d = dimension(); Object.assign(r, { x: 4, y: 4, w: d.width - 8, h: d.height - 8 }); paint(item.id); } } });
  restore(null);
  focus('chart');
  window.PTWindows = { restore, serialize, show, hide, focus, set onChange(handler) { onChange = handler; } };
})();
