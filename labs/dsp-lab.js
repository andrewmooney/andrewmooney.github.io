"use strict";
/* ============ shared audio engine ============ */
let AC=null;
const stoppers=[];           // stop callbacks for running demos
function ctx(){
  if(!AC){AC=new (window.AudioContext||window.webkitAudioContext)();}
  if(AC.state==='suspended')AC.resume();
  return AC;
}
function stopAll(except){
  stoppers.forEach(s=>{if(s!==except)s.fn()});
}
function reg(fn){const o={fn};stoppers.push(o);return o}

/* master output bus: limiter so stacked voices / high resonance can't clip or blast headphones */
let BUS=null;
function bus(){
  if(!BUS){
    const c=ctx();
    BUS=c.createDynamicsCompressor();
    BUS.threshold.value=-12;BUS.knee.value=6;BUS.ratio.value=20;
    BUS.attack.value=0.002;BUS.release.value=0.15;
    const trim=c.createGain();trim.gain.value=0.9;
    BUS.connect(trim).connect(c.destination);
  }
  return BUS;
}

/* ============ scope drawing ============ */
function makeScope(canvasId){
  const c=document.getElementById(canvasId);
  const g=c.getContext('2d');
  let analyser=null,raf=null;
  function size(){
    const r=c.getBoundingClientRect();
    c.width=r.width*devicePixelRatio; c.height=r.height*devicePixelRatio;
  }
  addEventListener('resize',()=>{size();grid()});
  function grid(){
    g.fillStyle='#FAFBFD';g.fillRect(0,0,c.width,c.height);
    g.strokeStyle='#E6EAF1';g.lineWidth=1;
    g.beginPath();g.moveTo(0,c.height/2);g.lineTo(c.width,c.height/2);g.stroke();
  }
  size();grid();
  return {
    canvas:c,ctx2d:g,grid,
    attach(node){
      analyser=ctx().createAnalyser();analyser.fftSize=2048;
      node.connect(analyser);
      const data=new Float32Array(analyser.fftSize);
      const draw=()=>{
        analyser.getFloatTimeDomainData(data);
        grid();
        g.strokeStyle='#059669';g.lineWidth=2*devicePixelRatio;g.beginPath();
        // trigger on rising zero-crossing for a stable trace
        let start=0;
        for(let i=1;i<data.length/2;i++){if(data[i-1]<=0&&data[i]>0){start=i;break}}
        const n=Math.min(1024,data.length-start);
        for(let i=0;i<n;i++){
          const x=i/n*c.width, y=c.height/2-data[start+i]*c.height*0.42;
          i?g.lineTo(x,y):g.moveTo(x,y);
        }
        g.stroke();
        /* x/y overlay: amplitude scale, time ticks, live freq + amp readout */
        const dpr=devicePixelRatio, sr=ctx().sampleRate, total=n/sr;
        g.font=`${10*dpr}px monospace`;g.fillStyle='#6E7683';
        g.textBaseline='middle';
        g.fillText('+1',4*dpr,c.height/2-c.height*0.42);
        g.fillText('0',4*dpr,c.height/2);
        g.fillText('-1',4*dpr,c.height/2+c.height*0.42);
        g.textBaseline='alphabetic';
        g.strokeStyle='#D9DFE8';g.lineWidth=1;
        for(let t=0.005;t<total;t+=0.005){
          const x=t/total*c.width;
          g.beginPath();g.moveTo(x,0);g.lineTo(x,c.height);g.stroke();
          g.fillText((t*1000).toFixed(0)+' ms',x+3*dpr,c.height-4*dpr);
        }
        let peak=0;for(let i=0;i<data.length;i++){const a=Math.abs(data[i]);if(a>peak)peak=a}
        let firstX=-1,lastX=-1,k=0;
        for(let i=1;i<data.length;i++){if(data[i-1]<=0&&data[i]>0){if(firstX<0)firstX=i;lastX=i;k++}}
        let txt='amp '+Math.round(peak*100)+' %';
        if(k>1&&lastX>firstX)txt=Math.round((k-1)*sr/(lastX-firstX))+' Hz · '+txt;
        g.fillStyle='#B45309';g.textAlign='right';
        g.fillText(txt,c.width-6*dpr,13*dpr);
        g.textAlign='left';
      };
      const loop=()=>{draw();raf=requestAnimationFrame(loop)};
      loop();
      setTimeout(()=>{if(analyser)draw()},200); // rAF pauses on hidden surfaces; paint one real frame anyway
    },
    detach(){if(raf)cancelAnimationFrame(raf);raf=null;analyser=null;grid();}
  };
}

/* ============ spectrum drawing ============ */
function makeSpectrum(canvasId){
  const c=document.getElementById(canvasId);
  const g=c.getContext('2d');
  let analyser=null,raf=null;
  function size(){
    const r=c.getBoundingClientRect();
    c.width=r.width*devicePixelRatio; c.height=r.height*devicePixelRatio;
  }
  addEventListener('resize',()=>{size();grid()});
  function grid(){g.fillStyle='#FAFBFD';g.fillRect(0,0,c.width,c.height)}
  size();grid();
  return {
    attach(node){
      analyser=ctx().createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=0.5;
      analyser.minDecibels=-90;analyser.maxDecibels=-15; // quiet sources (voice) still reach visible bar heights
      node.connect(analyser);
      const data=new Uint8Array(analyser.frequencyBinCount);
      const maxHz=5500, nyquist=ctx().sampleRate/2;
      const draw=()=>{
        analyser.getByteFrequencyData(data);
        grid();
        const bins=Math.min(data.length,Math.floor(maxHz/nyquist*data.length));
        const w=c.width/bins;
        g.fillStyle='#B45309';
        for(let i=0;i<bins;i++){
          const h=data[i]/255*c.height*0.95;
          if(h>0)g.fillRect(i*w,c.height-h,Math.max(w-1,1),h);
        }
      };
      const loop=()=>{draw();raf=requestAnimationFrame(loop)};
      loop();
      setTimeout(()=>{if(analyser)draw()},200); // rAF pauses on hidden surfaces; paint one real frame anyway
    },
    detach(){if(raf)cancelAnimationFrame(raf);raf=null;analyser=null} // keep last frame on screen
  };
}

/* helper: slider binding */
function bind(id,fmt,cb){
  const el=document.getElementById(id),out=document.getElementById(id+'o');
  const upd=()=>{const v=parseFloat(el.value);out.textContent=fmt(v);if(cb)cb(v)};
  el.addEventListener('input',upd);upd();
  return el;
}
function cutHz(v){ // 0-100 -> 80 Hz .. 12 kHz exponential
  return 80*Math.pow(12000/80,v/100);
}
function kHzFmt(v){const h=cutHz(v);return h<1000?h.toFixed(0)+' Hz':(h/1000).toFixed(1)+' kHz'}

/* helper: Start/Stop toggle wiring shared by every runnable demo.
   hooks.start builds the module's audio graph; hooks.stop tears it down.
   Handles the run button state, the stoppers registry and one-demo-at-a-time. */
function makeToggle(runId,hooks){
  const run=document.getElementById(runId);
  let on=false;
  const stop=reg(()=>{
    if(!on)return;
    on=false;hooks.stop();
    run.setAttribute('aria-pressed',false);run.textContent='Start';
  });
  run.addEventListener('click',()=>{
    ctx();
    if(on){stop.fn();return}
    stopAll(stop);
    on=true;hooks.start();
    run.setAttribute('aria-pressed',true);run.textContent='Stop';
  });
  return stop;
}


/* ============ D01: draw a wave ============ */
(()=>{
  const scope=makeScope('scopeD1'), spec=makeSpectrum('specD1');
  const cv=document.getElementById('drawD1'), g=cv.getContext('2d');
  const W=256;
  const cycle=new Float32Array(W);
  for(let i=0;i<W;i++)cycle[i]=Math.sin(i/W*2*Math.PI);   // start from a sine
  let src=null,gain=null,drawing=false;
  function size(){const r=cv.getBoundingClientRect();cv.width=r.width*devicePixelRatio;cv.height=r.height*devicePixelRatio;paint()}
  function paint(){
    g.fillStyle='#0B0D10';g.fillRect(0,0,cv.width,cv.height);
    g.strokeStyle='#2A2D35';g.beginPath();g.moveTo(0,cv.height/2);g.lineTo(cv.width,cv.height/2);g.stroke();
    g.strokeStyle='#059669';g.lineWidth=2*devicePixelRatio;g.beginPath();
    for(let x=0;x<cv.width;x++){
      const v=cycle[Math.floor(x/cv.width*W)];
      const y=cv.height/2-v*cv.height*0.44;
      x?g.lineTo(x,y):g.moveTo(x,y);
    }
    g.stroke();
  }
  addEventListener('resize',size);size();
  function plot(e){
    const r=cv.getBoundingClientRect();
    const i=Math.min(W-1,Math.max(0,Math.floor((e.clientX-r.left)/r.width*W)));
    const v=Math.min(1,Math.max(-1,-((e.clientY-r.top)/r.height*2-1)));
    cycle[i]=v;
    // smooth the neighbours a touch so single points don't spike
    if(i>0)cycle[i-1]=(cycle[i-1]+v)/2;
    if(i<W-1)cycle[i+1]=(cycle[i+1]+v)/2;
    paint();
  }
  cv.style.touchAction='none';cv.style.cursor='crosshair';
  cv.addEventListener('pointerdown',e=>{e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(x){};drawing=true;plot(e)});
  cv.addEventListener('pointermove',e=>{if(drawing)plot(e)});
  cv.addEventListener('pointerup',()=>{drawing=false;if(src)restart()});
  function buildBuffer(){
    const c=ctx(),sr=c.sampleRate,f=110,len=sr;
    const b=c.createBuffer(1,len,sr),d=b.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=cycle[Math.floor((i*f*W/sr))%W]*0.35;
    return b;
  }
  function restart(){
    const c=ctx();
    const ns=c.createBufferSource();ns.buffer=buildBuffer();ns.loop=true;
    ns.connect(gain);ns.start();
    try{src.stop()}catch(e){}
    src=ns;
  }
  /* preset shapes: fill the cycle from a formula, same repaint/restart as Reset */
  const SHAPES={
    Sine:i=>Math.sin(i/W*2*Math.PI),
    Square:i=>i<W/2?1:-1,
    Saw:i=>1-2*i/W,
    Triangle:i=>4*Math.abs(i/W-0.5)-1,
    Random:()=>Math.random()*2-1
  };
  function setShape(f){for(let i=0;i<W;i++)cycle[i]=f(i);paint();if(src)restart()}
  document.getElementById('resetD1').addEventListener('click',()=>setShape(SHAPES.Sine));
  [...document.querySelectorAll('#shapesD1 button')].forEach(btn=>{
    btn.addEventListener('click',()=>setShape(SHAPES[btn.dataset.shape]));
  });
  makeToggle('runD1',{
    start(){
      gain=ctx().createGain();gain.gain.value=0.8;
      gain.connect(bus());
      src=ctx().createBufferSource();src.buffer=buildBuffer();src.loop=true;
      src.connect(gain);src.start();
      scope.attach(gain);spec.attach(gain);
    },
    stop(){try{src.stop()}catch(e){};src=null;gain=null;scope.detach();spec.detach()}
  });
})();

/* ============ D02: sampling & aliasing ============ */
(()=>{
  const scope=makeScope('scopeD2'), spec=makeSpectrum('specD2');
  const info=document.getElementById('aliasD2');
  let src=null,gain=null;
  function predict(){
    const f=+F.value, fs=+FS.value;
    const n=Math.round(f/fs);
    const alias=Math.abs(f-n*fs);
    info.textContent='Nyquist limit: '+(fs/2).toFixed(0)+' Hz.  '
      +(f<=fs/2?'Faithful: you hear '+f+' Hz.':'Aliased! '+f+' Hz folds to '+alias.toFixed(0)+' Hz.');
    return alias;
  }
  const F=bind('freqD2',v=>v+' Hz');   // no cb here: bind fires immediately, before F/FS exist (the TDZ trap)
  const FS=bind('fsD2',v=>v+' Hz');
  [F,FS].forEach(el=>el.addEventListener('input',()=>{predict();if(src)restart()}));
  function buildBuffer(){
    const c=ctx(),sr=c.sampleRate,len=sr;
    const b=c.createBuffer(1,len,sr),d=b.getChannelData(0);
    const hold=sr/ +FS.value;                       // pretend sample rate: sample-and-hold
    for(let i=0;i<len;i++){
      const j=Math.floor(i/hold)*hold;
      d[i]=0.3*Math.sin(2*Math.PI*(+F.value)*j/sr);
    }
    return b;
  }
  function restart(){
    const c=ctx();
    const ns=c.createBufferSource();ns.buffer=buildBuffer();ns.loop=true;
    ns.connect(gain);ns.start();
    try{src.stop()}catch(e){}
    src=ns;
  }
  makeToggle('runD2',{
    start(){
      gain=ctx().createGain();gain.gain.value=0.9;gain.connect(bus());
      src=ctx().createBufferSource();src.buffer=buildBuffer();src.loop=true;
      src.connect(gain);src.start();
      scope.attach(gain);spec.attach(gain);
    },
    stop(){try{src.stop()}catch(e){};src=null;gain=null;scope.detach();spec.detach()}
  });
  predict();
})();

/* ============ D03: FIR — the moving average ============ */
(()=>{
  const scope=makeScope('scopeD3'), spec=makeSpectrum('specD3');
  const rc=document.getElementById('respD3'), rg=rc.getContext('2d');
  let osc=null,cv=null,gain=null,inp=null;
  function sizeR(){const r=rc.getBoundingClientRect();rc.width=r.width*devicePixelRatio;rc.height=r.height*devicePixelRatio;drawResp()}
  function drawResp(){
    rg.fillStyle='#0B0D10';rg.fillRect(0,0,rc.width,rc.height);
    const N=+T.value, sr=48000, fmax=6000;
    rg.strokeStyle='#B45309';rg.lineWidth=2*devicePixelRatio;rg.beginPath();
    for(let x=0;x<rc.width;x++){
      const f=x/rc.width*fmax;
      const w=Math.PI*f/sr;
      const H=N===1?1:Math.abs(Math.sin(N*w)/(N*Math.sin(w)||1e-9));
      const y=rc.height*(1-H*0.92)-2;
      x?rg.lineTo(x,y):rg.moveTo(x,y);
    }
    rg.stroke();
    rg.fillStyle='#6E7683';rg.font=`${10*devicePixelRatio}px monospace`;
    rg.fillText('|H(f)|  0–6 kHz',6*devicePixelRatio,12*devicePixelRatio);
  }
  addEventListener('resize',sizeR);
  function firBuf(){
    const c=ctx(),N=Math.round(+T.value);
    const b=c.createBuffer(1,Math.max(1,N),c.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<N;i++)d[i]=1/N;                   // boxcar: average of the last N samples
    return b;
  }
  let cvGain=null,rwTimer=null;
  function rewire(){
    if(!inp)return;
    const c=ctx(),t=c.currentTime;
    const ncv=c.createConvolver();ncv.normalize=false;ncv.buffer=firBuf();
    const ng=c.createGain();ng.gain.value=0;
    inp.connect(ncv);ncv.connect(ng);ng.connect(gain);
    ng.gain.setTargetAtTime(1,t,0.015);                    // fade the new path in
    if(cv){                                                 // fade the old one out, then unplug
      const ocv=cv,og=cvGain;
      og.gain.setTargetAtTime(0,t,0.015);
      setTimeout(()=>{try{inp.disconnect(ocv);ocv.disconnect();og.disconnect()}catch(e){}},120);
    }
    cv=ncv;cvGain=ng;
  }
  const T=bind('tapsD3',v=>v.toFixed(0)+' taps');   // cb added after: bind fires immediately (TDZ)
  T.addEventListener('input',()=>{drawResp();if(osc){clearTimeout(rwTimer);rwTimer=setTimeout(rewire,80)}});
  makeToggle('runD3',{
    start(){
      const c=ctx();
      osc=c.createOscillator();osc.type='sawtooth';osc.frequency.value=110;
      inp=c.createGain();inp.gain.value=0.25;
      gain=c.createGain();gain.gain.value=1;gain.connect(bus());
      osc.connect(inp);
      rewire();
      osc.start();
      scope.attach(gain);spec.attach(gain);
    },
    stop(){osc.stop();osc=null;cv=null;cvGain=null;inp=null;gain=null;scope.detach();spec.detach()}
  });
  sizeR();
})();

/* ============ D04: convolution — build an echo response ============ */
(()=>{
  const scope=makeScope('scopeD4'), spec=makeSpectrum('specD4');
  const tc=document.getElementById('impD4'), tg=tc.getContext('2d');
  const DUR=1.6;
  let taps=[{t:0.0,a:1}], src=null,cv=null,gain=null;
  let cur=0.3,pend=0.8;                        // keyboard cursor position (s) and the height the next spike gets
  function sizeT(){const r=tc.getBoundingClientRect();tc.width=r.width*devicePixelRatio;tc.height=r.height*devicePixelRatio;drawTaps()}
  function drawTaps(){
    tg.fillStyle='#0B0D10';tg.fillRect(0,0,tc.width,tc.height);
    tg.strokeStyle='#2A2D35';tg.beginPath();tg.moveTo(0,tc.height-1);tg.lineTo(tc.width,tc.height-1);tg.stroke();
    tg.fillStyle='#6E7683';tg.font=`${10*devicePixelRatio}px monospace`;
    tg.fillText('impulse response · click to add an echo · click a spike to remove',6*devicePixelRatio,12*devicePixelRatio);
    taps.forEach(p=>{
      const x=p.t/DUR*tc.width;
      tg.strokeStyle='#B45309';tg.lineWidth=3*devicePixelRatio;
      tg.beginPath();tg.moveTo(x,tc.height);tg.lineTo(x,tc.height*(1-p.a*0.85));tg.stroke();
    });
    if(document.activeElement===tc){           // keyboard cursor: where Enter would put the next spike
      const x=cur/DUR*tc.width, y=tc.height*(1-pend*0.85);
      tg.strokeStyle='#6E7683';tg.lineWidth=1*devicePixelRatio;tg.setLineDash([4*devicePixelRatio,4*devicePixelRatio]);
      tg.beginPath();tg.moveTo(x,0);tg.lineTo(x,tc.height);tg.stroke();tg.setLineDash([]);
      tg.fillStyle='#059669';tg.fillRect(x-3*devicePixelRatio,y,6*devicePixelRatio,3*devicePixelRatio);
      tg.fillStyle='#6E7683';tg.fillText(cur.toFixed(2)+'s · '+pend.toFixed(1),x+6*devicePixelRatio,tc.height-4*devicePixelRatio);
    }
  }
  addEventListener('resize',sizeT);
  tc.style.cursor='crosshair';
  tc.addEventListener('focus',drawTaps);tc.addEventListener('blur',drawTaps);
  tc.addEventListener('keydown',e=>{
    const step={ArrowLeft:-1,ArrowRight:1}[e.key];
    if(step){cur=Math.round(Math.min(DUR,Math.max(0,cur+step*(e.shiftKey?0.1:0.02)))*1000)/1000}
    else if(e.key==='ArrowUp'||e.key==='ArrowDown')pend=Math.round(Math.min(1,Math.max(0.1,pend+(e.key==='ArrowUp'?0.1:-0.1)))*10)/10;
    else if(e.key==='Enter'){
      const near=taps.findIndex(p=>p.t>0.01&&Math.abs(p.t-cur)<DUR*0.02);   // same near-hit test as the pointer path
      if(near>=0)taps.splice(near,1);
      else if(taps.length<24)taps.push({t:cur,a:pend});
      if(src)rewire();
    }else return;
    e.preventDefault();drawTaps();
  });
  tc.addEventListener('pointerdown',e=>{
    const r=tc.getBoundingClientRect();
    const t=(e.clientX-r.left)/r.width*DUR;
    const near=taps.findIndex(p=>p.t>0.01&&Math.abs(p.t-t)<DUR*0.02);
    if(near>=0)taps.splice(near,1);
    else if(taps.length<24)taps.push({t,a:Math.min(1,Math.max(0.1,1-(e.clientY-r.top)/r.height))});
    drawTaps();
    if(src)rewire();
  });
  function irBuf(){
    const c=ctx(),len=Math.floor(c.sampleRate*DUR);
    const b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);
    taps.forEach(p=>{d[Math.min(len-1,Math.floor(p.t*c.sampleRate))]=p.a});
    return b;
  }
  function pluckBuf(){                        // a short repeating note to convolve
    const c=ctx(),sr=c.sampleRate,len=sr*2;
    const b=c.createBuffer(1,len,sr),d=b.getChannelData(0);
    for(let rep=0;rep<2;rep++){
      const o=rep*sr;
      for(let i=0;i<sr*0.18;i++){
        const t=i/sr;
        d[o+i]=0.5*Math.exp(-t*22)*Math.sin(2*Math.PI*330*t);
      }
    }
    return b;
  }
  function rewire(){
    const c=ctx();
    const ncv=c.createConvolver();ncv.normalize=false;ncv.buffer=irBuf();
    src.disconnect();src.connect(ncv);ncv.connect(gain);
    if(cv)try{cv.disconnect()}catch(e){}
    cv=ncv;
  }
  makeToggle('runD4',{
    start(){
      const c=ctx();
      gain=c.createGain();gain.gain.value=0.8;gain.connect(bus());
      src=c.createBufferSource();src.buffer=pluckBuf();src.loop=true;
      rewire();
      src.start();
      scope.attach(gain);spec.attach(gain);
    },
    stop(){try{src.stop()}catch(e){};src=null;cv=null;gain=null;scope.detach();spec.detach()}
  });
  sizeT();
})();

/* ============ router ============ */
(()=>{
  const sections=[...document.querySelectorAll('section.module')];
  sections.forEach((s,i)=>{s.id='d0'+(i+1)});
  const links=[...document.querySelectorAll('nav.side a')];
  function show(){
    let id=location.hash.slice(1);
    if(!sections.some(s=>s.id===id))id='d01';
    stopAll();
    sections.forEach(s=>{s.style.display=s.id===id?'':'none'});
    links.forEach(a=>a.setAttribute('aria-current',a.hash==='#'+id));
    dispatchEvent(new Event('resize'));
    scrollTo(0,0);
  }
  addEventListener('hashchange',show);
  show();
})();

/* ============ D02: wagon-wheel aliasing animation (anime.js) ============ */
(()=>{
  const fig=document.getElementById('wheelFig');
  if(!fig)return;
  const NS='http://www.w3.org/2000/svg', SCALE=800; // Hz -> revs/sec, ratio-preserving
  const CY=84, R=58, CX1=150, CX2=410;             // shared wheel geometry
  const el=(t,at,parent)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);(parent||fig).appendChild(e);return e};
  function wheel(cx,label){
    const g=el('g',{});
    el('circle',{cx,cy:CY,r:R,fill:'none',stroke:'#5B6572','stroke-width':3},g);
    const rot=el('g',{},g);
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2;
      el('line',{x1:cx,y1:CY,x2:cx+(R-2)*Math.cos(a),y2:CY+(R-2)*Math.sin(a),
        stroke:i?'#8A93A1':'#B45309','stroke-width':i?2.5:4},rot);
    }
    el('text',{x:cx,y:166,fill:'#5B6572','font-size':12,'text-anchor':'middle','font-family':'system-ui'},g).textContent=label;
    return rot;
  }
  const realRot=wheel(CX1,'really spinning'), seenRot=wheel(CX2,'what the samples saw');
  const seenLbl=el('text',{x:CX2,y:184,fill:'#B45309','font-size':11,'text-anchor':'middle','font-family':'system-ui'});
  const F=document.getElementById('freqD2'), FS=document.getElementById('fsD2');
  function apparent(){ // signed alias, matching predict(): negative = looks backwards
    const f=+F.value, fs=+FS.value;
    return f-Math.round(f/fs)*fs;
  }
  function caption(){
    const ap=apparent(), rev=Math.abs(ap)/SCALE;
    seenLbl.textContent=ap===+F.value?'faithful — same spin':
      (ap<0?'looks like '+rev.toFixed(1)+' rev/s backwards':'looks like '+rev.toFixed(1)+' rev/s — too slow');
  }
  caption();
  [F,FS].forEach(s=>s.addEventListener('input',caption));
  // static fallback frame: two wheels at different fixed angles
  seenRot.setAttribute('transform','rotate(-30 '+CX2+' '+CY+')');
  if(!window.anime||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // anime is the clock; both wheels computed from the same t each frame, sliders
  // read live so the illusion always matches the prediction line above
  const state={t:0};
  const anim=window.anime.animate(state,{t:36000,duration:36000000,ease:'linear',loop:true,
    onUpdate:()=>{
      const t=state.t, f=+F.value, fs=+FS.value;
      const realA=(f/SCALE*360*t)%360;
      const ts=Math.floor(t*fs/SCALE)/(fs/SCALE);       // last strobe instant
      const seenA=(f/SCALE*360*ts)%360;
      realRot.setAttribute('transform','rotate('+realA.toFixed(1)+' '+CX1+' '+CY+')');
      seenRot.setAttribute('transform','rotate('+seenA.toFixed(1)+' '+CX2+' '+CY+')');
    }});
  new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?anim.play():anim.pause())).observe(fig);
})();

/* ============ D03: sliding-window convolution animation (anime.js) ============ */
(()=>{
  const fig=document.getElementById('convFig');
  if(!fig)return;
  const NS='http://www.w3.org/2000/svg';
  const el=(t,at)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);fig.appendChild(e);return e};
  const N=90, K=9, X0=30, X1=530, YIN=76, YOUT=176, H=34;
  // deterministic jagged input: slow sine + fast ripple + hashy jitter
  const x=[];for(let i=0;i<N;i++)
    x.push(0.62*Math.sin(i*0.14)+0.28*Math.sin(i*1.9)+0.22*Math.sin(i*7.3+2.1));
  // causal moving average (same rule the module teaches)
  const y=x.map((_,i)=>{let s=0,c=0;for(let j=Math.max(0,i-K+1);j<=i;j++){s+=x[j];c++}return s/c});
  const px=i=>X0+(X1-X0)*i/(N-1), pyIn=v=>YIN-v*H, pyOut=v=>YOUT-v*H;
  const poly=(vals,py,upTo)=>{let d='';for(let i=0;i<=upTo;i++)d+=(i?'L':'M')+px(i).toFixed(1)+','+py(vals[i]).toFixed(1)+' ';return d};
  el('text',{x:X0,y:16,fill:'#5B6572','font-size':11,'font-family':'system-ui'}).textContent='input — jagged';
  el('text',{x:X0,y:134,fill:'#5B6572','font-size':11,'font-family':'system-ui'}).textContent='output — the averages the window left behind';
  el('path',{d:poly(x,pyIn,N-1),fill:'none',stroke:'#8A93A1','stroke-width':1.5});
  const win=el('rect',{y:YIN-H-6,height:2*H+12,rx:4,fill:'rgba(217,119,6,.14)',stroke:'#B45309','stroke-width':1.5});
  const winLbl=el('text',{y:YIN-H-12,fill:'#B45309','font-size':11,'text-anchor':'middle','font-family':'system-ui'});
  winLbl.textContent='average these '+K;
  const out=el('path',{fill:'none',stroke:'#059669','stroke-width':2.5});
  const drop=el('line',{stroke:'#B45309','stroke-width':1.5,'stroke-dasharray':'3 3'});
  const head=el('circle',{r:4.5,fill:'#059669'});
  function frame(i){ // window ends at sample i; output drawn up to i
    const a=Math.max(0,i-K+1);
    win.setAttribute('x',px(a)-4);win.setAttribute('width',px(i)-px(a)+8);
    winLbl.setAttribute('x',(px(a)+px(i))/2);
    out.setAttribute('d',poly(y,pyOut,i));
    drop.setAttribute('x1',px(i));drop.setAttribute('x2',px(i));
    drop.setAttribute('y1',pyIn(x[i]));drop.setAttribute('y2',pyOut(y[i]));
    head.setAttribute('cx',px(i));head.setAttribute('cy',pyOut(y[i]));
  }
  frame(Math.floor(N*0.55)); // static fallback: caught mid-slide
  if(!window.anime||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // one anime clock, geometry recomputed from it each frame (lab CLAUDE.md pattern)
  const state={p:0};
  const anim=window.anime.animate(state,{p:N-1,duration:9000,ease:'linear',loop:true,loopDelay:1200,
    onUpdate:()=>frame(Math.max(0,Math.min(N-1,Math.floor(state.p))))});
  new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?anim.play():anim.pause())).observe(fig);
})();
