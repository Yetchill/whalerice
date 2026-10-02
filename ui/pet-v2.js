function createPet(container) {
  container.innerHTML = `<div class="pet-scene"><div class="balance-sign" title="右键打开设置，拖动牌子移动"><span class="currency-symbol">¥</span><strong class="balance-number">—</strong><span class="connection-dot"></span></div><div class="pet-art"><canvas width="600" height="600" aria-label="捧着米饭、拿着勺子的鲸鱼娘"></canvas></div></div>`;
  const scene = container.querySelector('.pet-scene');
  const canvas = container.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const names = ['idle-full','idle-half','idle-low','idle-empty','eat-01','eat-02','eat-02b','eat-03','eat-03b','eat-04','eat-05'];
  const images = new Map();
  const ready = Promise.all(names.map(name => new Promise((resolve,reject) => {
    const image = new Image(); image.onload = () => {images.set(name,image);resolve();}; image.onerror = reject;
    image.src = `../assets/frames/${name}.png`;
  })));
  let currentState, lastMotionId, animationStart = null, animationFrame, visualIdle = 'idle-empty';
  const timeline = [['eat-01',100],['eat-02',180],['eat-02b',130],['eat-03',160],['eat-03b',100],['eat-04',170],['eat-05',220],['eat-05',180],['eat-01',120]];
  const duration = timeline.reduce((sum,[,ms]) => sum+ms,0);
  function idleName(amount) {return amount === null ? 'idle-empty' : amount <= 0 ? 'idle-empty' : amount < 10 ? 'idle-low' : amount <= 50 ? 'idle-half' : 'idle-full';}
  function bowlPath() {
    // Preserve the current rice level while the hand and expression move.
    const w=canvas.width,p=new Path2D();p.rect(0,0,w,w);
    p.moveTo(.424*w,.624*w);p.bezierCurveTo(.431*w,.600*w,.468*w,.577*w,.512*w,.578*w);
    p.bezierCurveTo(.560*w,.578*w,.599*w,.600*w,.607*w,.624*w);p.lineTo(.597*w,.687*w);
    p.bezierCurveTo(.570*w,.728*w,.460*w,.726*w,.432*w,.679*w);p.closePath();return p;
  }
  function draw(name) {
    const idle=images.get(visualIdle);if(!idle)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(idle,0,0,canvas.width,canvas.height);
    if(name&&images.has(name)){
      ctx.save();ctx.clip(bowlPath(),'evenodd');ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(images.get(name),0,0,canvas.width,canvas.height);ctx.restore();
    }
    canvas.dataset.frame=name||visualIdle;
  }
  function tick(now){
    if(animationStart===null)animationStart=now;
    let elapsed=now-animationStart,frame=timeline[0][0],frameElapsed=elapsed;
    if(elapsed>=duration){animationStart=null;animationFrame=null;scene.classList.remove('eating');draw(null);return;}
    for(const[name,ms]of timeline){if(frameElapsed<ms){frame=name;break;}frameElapsed-=ms;}
    draw(frame);animationFrame=requestAnimationFrame(tick);
  }
  function eat(){if(animationFrame)cancelAnimationFrame(animationFrame);animationStart=null;scene.classList.add('eating');animationFrame=requestAnimationFrame(tick);}
  ready.then(()=>{canvas.dataset.ready='true';if(currentState)draw(null);});
  return{ready,update(state){
    currentState=state;const b=state.balance;
    container.style.transform=`scale(${state.config.uiScale||1})`;
    container.querySelector('.currency-symbol').textContent=b?.currency==='USD'?'$':'¥';
    container.querySelector('.balance-number').textContent=b?b.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4}):'—';
    scene.classList.toggle('stale',state.status==='error');scene.classList.toggle('unconfigured',!state.hasKey);
    container.querySelector('.balance-sign').title=state.error||(!state.hasKey?'右键设置，导入 API Key':state.updatedAt?`余额更新于 ${new Date(state.updatedAt).toLocaleTimeString('zh-CN')} · 右键打开设置`:'正在查询余额');
    visualIdle=idleName(b?.amount??null);
    if(lastMotionId!==undefined&&lastMotionId!==state.motionId&&state.motion==='eat')ready.then(eat);
    else if(!animationFrame)ready.then(()=>draw(null));lastMotionId=state.motionId;
  }};
}
