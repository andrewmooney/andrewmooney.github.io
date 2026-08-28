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

/* ============ Module 01: frequency & amplitude ============ */
(()=>{
  const scope=makeScope('scope1');
  let osc=null,gain=null;
  const f=bind('freq1',v=>v+' Hz',v=>{if(osc)osc.frequency.setTargetAtTime(v,ctx().currentTime,0.01)});
  const a=bind('gain1',v=>v+' %',v=>{if(gain)gain.gain.setTargetAtTime(v/100,ctx().currentTime,0.01)});
  makeToggle('run1',{
    start(){
      osc=ctx().createOscillator();gain=ctx().createGain();
      osc.frequency.value=+f.value;gain.gain.value=+a.value/100;
      osc.connect(gain).connect(bus());
      scope.attach(gain);osc.start();
    },
    stop(){osc.stop();osc=null;gain=null;scope.detach()}
  });
})();

/* ============ Module 01b: record your voice ============ */
(()=>{
  const c=document.getElementById('voice1'),g=c.getContext('2d');
  const rec=document.getElementById('rec1'),play=document.getElementById('play1'),hint=document.getElementById('recHint1');
  const zoomBtn=document.getElementById('zoom1');
  const spec=makeSpectrum('voiceSpec1');
  let buf=null,src=null,recorder=null,timer=null;
  let view={a:0,b:1},selA=null,selB=null;   // visible window + drag selection, as clip fractions
  const stop=reg(()=>{
    if(src){try{src.stop()}catch(e){};src=null;spec.detach();play.setAttribute('aria-pressed',false)}
  });
  function size(){const r=c.getBoundingClientRect();c.width=r.width*devicePixelRatio;c.height=r.height*devicePixelRatio;paint()}
  function paint(){
    const dpr=devicePixelRatio;
    g.fillStyle='#FAFBFD';g.fillRect(0,0,c.width,c.height);
    g.strokeStyle='#E6EAF1';g.lineWidth=1;
    g.beginPath();g.moveTo(0,c.height/2);g.lineTo(c.width,c.height/2);g.stroke();
    if(!buf)return;
    const d=buf.getChannelData(0),n=c.width|0;
    const i0=Math.floor(view.a*d.length), i1=Math.max(i0+2,Math.floor(view.b*d.length));
    const span=i1-i0;
    // auto-scale display so quiet recordings still fill the scope (shown in label)
    let pk=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a}
    const norm=pk>0?Math.min(0.95/pk,20):1;
    g.strokeStyle='#059669';
    if(span>=n*2){
      // zoomed out: min/max envelope per pixel column
      const step=span/n;
      for(let x=0;x<n;x++){
        let mn=1,mx=-1;
        const s=i0+Math.floor(x*step), e=Math.min(i0+Math.floor((x+1)*step),i1);
        for(let i=s;i<e;i++){const v=d[i];if(v<mn)mn=v;if(v>mx)mx=v}
        const y1=c.height/2-mx*norm*c.height*0.46, y2=c.height/2-mn*norm*c.height*0.46;
        g.beginPath();g.moveTo(x+0.5,y1);g.lineTo(x+0.5,Math.max(y2,y1+1));g.stroke();
      }
    }else{
      // zoomed in: polyline through the actual samples — the wobble itself
      g.lineWidth=2*dpr;g.beginPath();
      for(let i=i0;i<i1;i++){
        const x=(i-i0)/span*c.width, y=c.height/2-d[i]*norm*c.height*0.46;
        i===i0?g.moveTo(x,y):g.lineTo(x,y);
      }
      g.stroke();g.lineWidth=1;
    }
    // drag-selection overlay
    if(selA!==null&&selB!==null&&selA!==selB){
      const x0=Math.min(selA,selB)*c.width, x1=Math.max(selA,selB)*c.width;
      g.fillStyle='rgba(217,119,6,.14)';g.fillRect(x0,0,x1-x0,c.height);
      g.strokeStyle='#B45309';g.strokeRect(x0,0.5,x1-x0,c.height-1);
    }
    g.fillStyle='#6E7683';g.font=`${10*dpr}px monospace`;
    let lbl=(view.a*buf.duration).toFixed(3)+'–'+(view.b*buf.duration).toFixed(3)+' s';
    if(norm>1.05)lbl+=' · ×'+norm.toFixed(1)+' zoomed to fit';
    g.fillText(lbl,6*dpr,12*dpr);
  }
  function frac(e){const r=c.getBoundingClientRect();return Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))}
  c.addEventListener('pointerdown',e=>{if(!buf)return;e.preventDefault();c.setPointerCapture(e.pointerId);selA=selB=frac(e)});
  c.addEventListener('pointermove',e=>{if(selA===null)return;selB=frac(e);paint()});
  c.addEventListener('pointerup',()=>{
    if(selA===null)return;
    const a=Math.min(selA,selB),b=Math.max(selA,selB);
    selA=selB=null;
    if(b-a>0.01){                       // real drag, not a click
      const w=view.b-view.a;
      const na=view.a+a*w, nb=view.a+b*w;
      if((nb-na)*buf.length>=32){view={a:na,b:nb};zoomBtn.disabled=false}
    }
    paint();
  });
  zoomBtn.addEventListener('click',()=>{view={a:0,b:1};zoomBtn.disabled=true;paint()});
  addEventListener('resize',size);size();
  rec.addEventListener('click',async()=>{
    if(recorder){recorder.stop();return}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const chunks=[];
      recorder=new MediaRecorder(stream);
      recorder.ondataavailable=e=>chunks.push(e.data);
      recorder.onstop=async()=>{
        clearTimeout(timer);
        stream.getTracks().forEach(t=>t.stop());
        rec.setAttribute('aria-pressed',false);rec.textContent='● Record (3 s)';
        recorder=null;
        try{
          buf=await ctx().decodeAudioData(await new Blob(chunks).arrayBuffer());
          view={a:0,b:1};zoomBtn.disabled=true;   // new clip, full view
          paint();
          play.disabled=false;
          hint.textContent='That is your voice as a pressure wave — each bump is a syllable. The taller the bump, the louder (bigger amplitude).';
        }catch(e){hint.textContent='Could not decode the recording — try again.'}
      };
      recorder.start();
      rec.setAttribute('aria-pressed',true);rec.textContent='■ Stop';
      timer=setTimeout(()=>{if(recorder)recorder.stop()},3000);
    }catch(e){
      hint.textContent='Microphone blocked. Allow microphone access in your browser, then try again.';
    }
  });
  play.addEventListener('click',()=>{
    if(!buf)return;
    if(src){stop.fn();return}
    stopAll(stop);
    const a=ctx();
    src=a.createBufferSource();src.buffer=buf;
    const vol=a.createGain();vol.gain.value=0.8; // own voice at speaking level, not a synth tone
    src.connect(vol).connect(bus());
    src.onended=()=>{if(src){src=null;spec.detach();play.setAttribute('aria-pressed',false)}};
    src.start();
    spec.attach(vol);
    play.setAttribute('aria-pressed',true);
  });
})();

/* ============ Module 02: waveforms ============ */
(()=>{
  const scope=makeScope('scope2');
  const spec=makeSpectrum('spec2');
  const btns=[...document.querySelectorAll('#waveBtns [data-wave]')];
  let wave='sine',osc=null,gain=null;
  const f=bind('freq2',v=>v+' Hz',v=>{if(osc)osc.frequency.setTargetAtTime(v,ctx().currentTime,0.01)});
  btns.forEach(b=>b.addEventListener('click',()=>{
    wave=b.dataset.wave;
    btns.forEach(x=>x.setAttribute('aria-pressed',x===b));
    if(osc)osc.type=wave;
  }));
  makeToggle('run2',{
    start(){
      osc=ctx().createOscillator();gain=ctx().createGain();
      osc.type=wave;osc.frequency.value=+f.value;gain.gain.value=0.22;
      osc.connect(gain).connect(bus());
      osc.start();scope.attach(gain);spec.attach(gain); // start first: first drawn frame has signal
    },
    stop(){osc.stop();osc=null;gain=null;scope.detach();spec.detach()}
  });
})();

/* ============ Module 02b: build a wave from sines (additive) ============ */
(()=>{
  const scope=makeScope('scope2b');
  const spec=makeSpectrum('spec2b');
  const btns=[...document.querySelectorAll('#targ2b [data-t]')];
  const F=110;
  // harmonic amplitude of partial k for each target shape
  const RECIPES={
    square:  k=>k%2?1/k:0,
    sawtooth:k=>1/k,
    triangle:k=>k%2?(((k-1)/2)%2?-1:1)/(k*k):0
  };
  let target='square',osc=null,gain=null;
  const nEl=document.getElementById('n2b');
  function wave(){
    const N=+nEl.value;
    const real=new Float32Array(N+1),imag=new Float32Array(N+1);
    for(let k=1;k<=N;k++)imag[k]=RECIPES[target](k);
    return ctx().createPeriodicWave(real,imag);
  }
  function drawStatic(){
    const c=scope.canvas,g=scope.ctx2d;
    scope.grid();
    const N=+nEl.value,rec=RECIPES[target],cyc=2,mid=c.height/2;
    // peak of the partial sum, for normalising the display
    let peak=0;
    for(let i=0;i<512;i++){
      let s=0;const ph=i/512*2*Math.PI;
      for(let k=1;k<=N;k++)s+=rec(k)*Math.sin(k*ph);
      if(Math.abs(s)>peak)peak=Math.abs(s);
    }
    const amp=c.height*0.4/(peak||1);
    const y=(x,n)=>{
      let s=0;const ph=x/c.width*cyc*2*Math.PI;
      for(let k=1;k<=n;k++)s+=rec(k)*Math.sin(k*ph);
      return mid-s*amp;
    };
    g.strokeStyle='#C3BBA4';g.lineWidth=1.5*devicePixelRatio;g.beginPath();   // lone fundamental, dim
    for(let x=0;x<=c.width;x+=2)x?g.lineTo(x,mid-rec(1)*amp*Math.sin(x/c.width*cyc*2*Math.PI)):g.moveTo(x,mid);
    g.stroke();
    g.strokeStyle='#059669';g.lineWidth=2*devicePixelRatio;g.beginPath();      // the sum
    for(let x=0;x<=c.width;x+=2)x?g.lineTo(x,y(x,N)):g.moveTo(x,y(x,N));
    g.stroke();
  }
  const fmtN=v=>v===1?'1 — pure sine':v+' harmonics';
  const n=bind('n2b',fmtN,()=>{
    if(osc)osc.setPeriodicWave(wave());
    else drawStatic();
  });
  btns.forEach(b=>b.addEventListener('click',()=>{
    target=b.dataset.t;
    btns.forEach(x=>x.setAttribute('aria-pressed',x===b));
    if(osc)osc.setPeriodicWave(wave());else drawStatic();
  }));
  makeToggle('run2b',{
    start(){
      osc=ctx().createOscillator();gain=ctx().createGain();
      osc.setPeriodicWave(wave());osc.frequency.value=F;gain.gain.value=0.22;
      osc.connect(gain).connect(bus());
      osc.start();scope.attach(gain);spec.attach(gain);
    },
    stop(){osc.stop();osc=null;gain=null;scope.detach();spec.detach();drawStatic()}
  });
  addEventListener('resize',()=>{if(!osc)drawStatic()});
  drawStatic();
})();

/* ============ Module 03: filter ============ */
(()=>{
  const scope=makeScope('scope3');
  let osc=null,filt=null,gain=null;
  const c=bind('cut3',kHzFmt,v=>{if(filt)filt.frequency.setTargetAtTime(cutHz(v),ctx().currentTime,0.01)});
  const q=bind('res3',v=>'Q '+v.toFixed(1),v=>{if(filt)filt.Q.setTargetAtTime(v,ctx().currentTime,0.01)});
  makeToggle('run3',{
    start(){
      osc=ctx().createOscillator();filt=ctx().createBiquadFilter();gain=ctx().createGain();
      osc.type='sawtooth';osc.frequency.value=110;
      filt.type='lowpass';filt.frequency.value=cutHz(+c.value);filt.Q.value=+q.value;
      gain.gain.value=0.22;
      osc.connect(filt).connect(gain).connect(bus());
      scope.attach(gain);osc.start();
    },
    stop(){osc.stop();osc=null;filt=null;gain=null;scope.detach()}
  });
})();

/* ============ Module 04: ADSR ============ */
(()=>{  
  const scope=makeScope('scope4');
  const gateBtn=document.getElementById('gate4');
  let osc=null,vca=null;
  const stop=reg(()=>{
    if(osc){try{osc.stop()}catch(e){};osc=null;vca=null;scope.detach()}
  });
  const A=bind('a4',v=>(v/1000).toFixed(2)+' s');
  const D=bind('d4',v=>(v/1000).toFixed(2)+' s');
  const S=bind('s4',v=>v+' %');
  const R=bind('r4',v=>(v/1000).toFixed(2)+' s');
  function envDraw(){
    // draw the ADSR shape on the scope while idle
    const c=scope.canvas,g=scope.ctx2d;scope.grid();
    const a=+A.value,d=+D.value,s=+S.value/100,r=+R.value,hold=600;
    const total=a+d+hold+r;
    const X=t=>t/total*c.width, Y=v=>c.height*(0.92-v*0.8);
    g.strokeStyle='#B45309';g.lineWidth=2*devicePixelRatio;g.beginPath();
    g.moveTo(X(0),Y(0));g.lineTo(X(a),Y(1));g.lineTo(X(a+d),Y(s));
    g.lineTo(X(a+d+hold),Y(s));g.lineTo(X(total),Y(0));g.stroke();
    g.fillStyle='#6E7683';g.font=`${10*devicePixelRatio}px monospace`;
    g.fillText('A',X(a/2)-3,Y(0.5));g.fillText('D',X(a+d/2),Y((1+s)/2));
    g.fillText('S',X(a+d+hold/2),Y(s)-6*devicePixelRatio);g.fillText('R',X(a+d+hold+r/2),Y(s/2));
  }
  [A,D,S,R].forEach(el=>el.addEventListener('input',()=>{if(!osc)envDraw()}));
  addEventListener('resize',()=>{if(!osc)envDraw()});
  envDraw();
  function gateOn(e){
    e.preventDefault();
    ctx();
    stopAll(stop);stop.fn();
    const t=ctx().currentTime;
    osc=ctx().createOscillator();vca=ctx().createGain();
    osc.type='triangle';osc.frequency.value=220;
    vca.gain.setValueAtTime(0.0001,t);
    vca.gain.linearRampToValueAtTime(0.4,t + (+A.value/1000));
    vca.gain.setTargetAtTime(0.4*(+S.value/100)+0.0001, t + (+A.value/1000), (+D.value/1000)/3+0.001);
    osc.connect(vca).connect(bus());
    scope.attach(vca);osc.start();
  }
  function gateOff(){
    if(!osc)return;
    const t=ctx().currentTime;
    vca.gain.cancelScheduledValues(t);
    vca.gain.setValueAtTime(vca.gain.value,t);
    vca.gain.setTargetAtTime(0.0001,t,(+R.value/1000)/3+0.001);
    const o=osc;osc=null;
    setTimeout(()=>{try{o.stop()}catch(e){};scope.detach();envDraw()},+R.value+250);
  }
  gateBtn.addEventListener('pointerdown',gateOn);
  gateBtn.addEventListener('pointerup',gateOff);
  gateBtn.addEventListener('pointerleave',gateOff);
  gateBtn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)gateOn(e)});
  gateBtn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')gateOff()});
})();

/* ============ Module 05: LFO ============ */
(()=>{
  const scope=makeScope('scope5');
  const btns=[...document.querySelectorAll('#lfoTarget [data-target]')];
  let target='pitch',nodes=null;
  const rate=bind('rate5',v=>v.toFixed(1)+' Hz',v=>{if(nodes)nodes.lfo.frequency.setTargetAtTime(v,ctx().currentTime,0.01)});
  const depth=bind('depth5',v=>v+' %',v=>{if(nodes)setDepth(v)});
  function setDepth(v){
    if(!nodes)return;
    nodes.lfoGain.gain.setTargetAtTime(target==='pitch'? v/100*30 : v/100*0.2, ctx().currentTime,0.01);
  }
  btns.forEach(b=>b.addEventListener('click',()=>{
    target=b.dataset.target;
    btns.forEach(x=>x.setAttribute('aria-pressed',x===b));
    if(nodes){restart()}
  }));
  function build(){
    const c=ctx();
    const osc=c.createOscillator(),vca=c.createGain(),lfo=c.createOscillator(),lfoGain=c.createGain();
    osc.type='triangle';osc.frequency.value=330;vca.gain.value=0.28;
    lfo.frequency.value=+rate.value;
    if(target==='pitch'){lfoGain.gain.value=+depth.value/100*30;lfo.connect(lfoGain).connect(osc.frequency)}
    else{lfoGain.gain.value=+depth.value/100*0.2;lfo.connect(lfoGain).connect(vca.gain)}
    osc.connect(vca).connect(bus());
    scope.attach(vca);osc.start();lfo.start();
    nodes={osc,vca,lfo,lfoGain};
  }
  function restart(){if(nodes){nodes.osc.stop();nodes.lfo.stop();nodes=null;scope.detach();build()}}
  makeToggle('run5',{
    start:build,
    stop(){nodes.osc.stop();nodes.lfo.stop();nodes=null;scope.detach()}
  });
})();

/* ============ Module 06: mini synth ============ */
(()=>{  
  const scope=makeScope('scope6');
  const btns=[...document.querySelectorAll('#wave6Btns [data-wave]')];
  const voices=new Map();   // declared before binds — bind() fires callbacks immediately
  let wave='sawtooth';
  btns.forEach(b=>b.addEventListener('click',()=>{
    wave=b.dataset.wave;btns.forEach(x=>x.setAttribute('aria-pressed',x===b));
    voices.forEach(v=>{v.osc.type=wave});                      // live update held notes
  }));
  const C=bind('cut6',kHzFmt,v=>{voices.forEach(x=>x.filt.frequency.setTargetAtTime(cutHz(v),ctx().currentTime,0.01))});
  const Q=bind('res6',v=>'Q '+v.toFixed(1),v=>{voices.forEach(x=>x.filt.Q.setTargetAtTime(v,ctx().currentTime,0.01))});
  const A=bind('a6',v=>(v/1000).toFixed(2)+' s'),R=bind('r6',v=>(v/1000).toFixed(2)+' s');
  reg(()=>{voices.forEach(v=>{try{v.osc.stop()}catch(e){}});voices.clear();scope.detach()});
  let master=null;
  function ensureMaster(){
    if(!master){master=ctx().createGain();master.gain.value=0.9;master.connect(bus());scope.attach(master)}
  }
  function noteOn(btn){
    ctx();
    ensureMaster();
    const c=ctx(),t=c.currentTime,f=+btn.dataset.f;
    if(voices.has(btn))noteOff(btn);
    const osc=c.createOscillator(),filt=c.createBiquadFilter(),vca=c.createGain();
    osc.type=wave;osc.frequency.value=f;
    filt.type='lowpass';filt.frequency.value=cutHz(+C.value);filt.Q.value=+Q.value;
    vca.gain.setValueAtTime(0.0001,t);
    vca.gain.linearRampToValueAtTime(0.3,t + (+A.value/1000));
    osc.connect(filt).connect(vca).connect(master);
    osc.start();
    voices.set(btn,{osc,vca,filt});
    btn.classList.add('down');
  }
  function noteOff(btn){
    const v=voices.get(btn);if(!v)return;
    const t=ctx().currentTime;
    v.vca.gain.cancelScheduledValues(t);
    v.vca.gain.setValueAtTime(Math.max(v.vca.gain.value,0.0001),t);
    v.vca.gain.setTargetAtTime(0.0001,t,(+R.value/1000)/3+0.001);
    const o=v.osc;voices.delete(btn);
    setTimeout(()=>{try{o.stop()}catch(e){}},+R.value+250);
    btn.classList.remove('down');
  }
  document.querySelectorAll('#keys6 button').forEach(btn=>{
    btn.addEventListener('pointerdown',e=>{e.preventDefault();noteOn(btn)});
    btn.addEventListener('pointerup',()=>noteOff(btn));
    btn.addEventListener('pointerleave',()=>noteOff(btn));
    btn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)noteOn(btn)});
    btn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')noteOff(btn)});
  });
  /* computer-keyboard mapping: A S D F G H J K -> C3..C4 */
  const keyBtns=[...document.querySelectorAll('#keys6 button')];
  const homeRow=['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK'];
  keyBtns.forEach((b,i)=>{
    const s=document.createElement('small');s.textContent=homeRow[i].slice(3);b.appendChild(s);
  });
  const sec=document.getElementById('keys6').closest('section.module');
  const held=new Set();
  document.addEventListener('keydown',e=>{
    if(e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;   // never steal typing
    const i=homeRow.indexOf(e.code);
    if(i<0||sec.style.display==='none')return;
    if(held.has(e.code))return;
    held.add(e.code);
    noteOn(keyBtns[i]);
  });
  document.addEventListener('keyup',e=>{
    const i=homeRow.indexOf(e.code);
    if(i<0||!held.has(e.code))return;
    held.delete(e.code);
    noteOff(keyBtns[i]);
  });
  addEventListener('blur',()=>{held.forEach(code=>{noteOff(keyBtns[homeRow.indexOf(code)])});held.clear()}); // no stuck notes on tab switch
})();

/* ============ Module 07: sampling / digitisation (no audio needed) ============ */
(()=>{  
  const c=document.getElementById('scope7'),g=c.getContext('2d');
  function size(){const r=c.getBoundingClientRect();c.width=r.width*devicePixelRatio;c.height=r.height*devicePixelRatio;draw()}
  const srEl=document.getElementById('sr7'), bdEl=document.getElementById('bd7');
  bind('sr7',v=>v.toFixed(0),draw);
  bind('bd7',v=>v.toFixed(0)+' levels',draw);
  function draw(){
    g.fillStyle='#FAFBFD';g.fillRect(0,0,c.width,c.height);
    g.strokeStyle='#E6EAF1';g.beginPath();g.moveTo(0,c.height/2);g.lineTo(c.width,c.height/2);g.stroke();
    const amp=c.height*0.38,mid=c.height/2,cycles=2;
    const y=x=>mid-Math.sin(x/c.width*cycles*2*Math.PI)*amp;
    // analog wave
    g.strokeStyle='#059669';g.lineWidth=2*devicePixelRatio;g.beginPath();
    for(let x=0;x<=c.width;x++){x?g.lineTo(x,y(x)):g.moveTo(x,y(x))}
    g.stroke();
    // digital staircase
    const n=+srEl.value*cycles, levels=+bdEl.value;
    const quant=v=>{const s=(v-mid)/amp; const q=Math.round((s+1)/2*(levels-1))/(levels-1)*2-1; return mid+q*amp};
    g.strokeStyle='#B45309';g.lineWidth=2*devicePixelRatio;g.beginPath();
    for(let i=0;i<n;i++){
      const x0=i/n*c.width, x1=(i+1)/n*c.width, yy=quant(y(x0+ (x1-x0)/2));
      i?g.lineTo(x0,yy):g.moveTo(x0,yy);
      g.lineTo(x1,yy);
    }
    g.stroke();
    // sample dots
    g.fillStyle='#B45309';
    for(let i=0;i<n;i++){
      const x=(i+0.5)/n*c.width;
      g.beginPath();g.arc(x,quant(y(x)),3*devicePixelRatio,0,7);g.fill();
    }
  }
  addEventListener('resize',size);size();

  /* audible A/B: smooth original vs the digital copy the sliders describe */
  const run=document.getElementById('run7');
  const abBtns=[...document.querySelectorAll('#ab7 [data-src]')];
  let mode='analog',src=null,gain7=null;
  const stop=reg(()=>{
    if(src){try{src.stop()}catch(e){};src=null;gain7=null;
      run.setAttribute('aria-pressed',false);run.textContent='Start'}
  });
  function buildBuffer(){
    const c=ctx(),sr=c.sampleRate,f=220,len=sr; // 220 whole cycles in 1 s -> clickless loop
    const buf=c.createBuffer(1,len,sr),d=buf.getChannelData(0);
    const period=sr/f;
    if(mode==='analog'){
      for(let i=0;i<len;i++)d[i]=Math.sin(2*Math.PI*f*i/sr);
    }else{
      const hold=period/ +srEl.value, levels=+bdEl.value;
      for(let i=0;i<len;i++){
        const j=Math.floor(i/hold)*hold;              // sample-and-hold at the chosen rate
        const v=Math.sin(2*Math.PI*f*j/sr);
        d[i]=Math.round((v+1)/2*(levels-1))/(levels-1)*2-1; // quantise to the chosen levels
      }
    }
    return buf;
  }
  function play(){
    const c=ctx();
    if(src){try{src.stop()}catch(e){}}
    src=c.createBufferSource();src.buffer=buildBuffer();src.loop=true;
    if(!gain7){gain7=c.createGain();gain7.gain.value=0.25;gain7.connect(bus())}
    src.connect(gain7);src.start();
  }
  abBtns.forEach(b=>b.addEventListener('click',()=>{
    mode=b.dataset.src;
    abBtns.forEach(x=>x.setAttribute('aria-pressed',x===b));
    if(src)play();
  }));
  [srEl,bdEl].forEach(el=>el.addEventListener('input',()=>{if(src&&mode==='digital')play()}));
  run.addEventListener('click',()=>{
    ctx();
    if(src){stop.fn();return}
    stopAll(stop);play();
    run.setAttribute('aria-pressed',true);run.textContent='Stop';
  });
})();

/* ============ Module 08: FM synthesis ============ */
(()=>{
  const scope=makeScope('scope8');
  const spec=makeSpectrum('spec8');
  const F=220, MAXDEV=800; // Hz of pitch wobble at 100 % amount
  let nodes=null;
  const ratio=bind('ratio8',v=>v.toFixed(1)+' : 1',v=>{if(nodes)nodes.mod.frequency.setTargetAtTime(F*v,ctx().currentTime,0.01)});
  const amt=bind('amt8',v=>v+' %',v=>{if(nodes)nodes.modGain.gain.setTargetAtTime(v/100*MAXDEV,ctx().currentTime,0.01)});
  makeToggle('run8',{
    start(){
      const c=ctx();
      const car=c.createOscillator(),mod=c.createOscillator(),modGain=c.createGain(),vca=c.createGain();
      car.type='sine';car.frequency.value=F;
      mod.type='sine';mod.frequency.value=F*(+ratio.value);
      modGain.gain.value=+amt.value/100*MAXDEV;
      mod.connect(modGain).connect(car.frequency);   // modulator shakes the carrier's pitch
      vca.gain.value=0.25;
      car.connect(vca).connect(bus());
      car.start();mod.start();
      scope.attach(vca);spec.attach(vca);
      nodes={car,mod,modGain,vca};
    },
    stop(){nodes.car.stop();nodes.mod.stop();nodes=null;scope.detach();spec.detach()}
  });
})();

/* ============ Module 09: wavetable ============ */
(()=>{
  const scope=makeScope('scope9'),spec=makeSpectrum('spec9');
  const N=24; // harmonics per frame
  const frames=[               // harmonic recipes: amplitude of harmonic h
    h=>h===1?1:0,              // sine
    h=>h%2?1/h:0,              // square: odd harmonics, 1/n
    h=>1/h,                    // saw: all harmonics, 1/n
    h=>(h%2?1:0.6)/Math.pow(h,0.4) // buzz: slow decay, bright
  ];
  const names=['Sine','Square','Saw','Buzz'];
  function tableAt(m){         // m in 0..3, linear interpolation between adjacent frames
    const i=Math.min(frames.length-2,Math.floor(m)), f=m-i;
    const real=new Float32Array(N+1),imag=new Float32Array(N+1);
    for(let h=1;h<=N;h++)imag[h]=(1-f)*frames[i](h)+f*frames[i+1](h);
    return ctx().createPeriodicWave(real,imag);
  }
  let osc=null,gain=null;
  const M=bind('morph9',v=>names[Math.round(v)],v=>{if(osc)osc.setPeriodicWave(tableAt(v))});
  const F=bind('freq9',v=>v+' Hz',v=>{if(osc)osc.frequency.setTargetAtTime(v,ctx().currentTime,0.01)});
  makeToggle('run9',{
    start(){
      osc=ctx().createOscillator();gain=ctx().createGain();
      osc.setPeriodicWave(tableAt(+M.value));
      osc.frequency.value=+F.value;gain.gain.value=0.22;
      osc.connect(gain).connect(bus());
      osc.start();scope.attach(gain);spec.attach(gain);
    },
    stop(){osc.stop();osc=null;gain=null;scope.detach();spec.detach()}
  });
})();

/* ============ Module 10: granular ============ */
(()=>{
  const scope=makeScope('scope10'),spec=makeSpectrum('spec10');
  let srcBuf=null,out=null,timer=null;
  const P=bind('pos10',v=>v.toFixed(0)+' %');
  const S=bind('size10',v=>v.toFixed(0)+' ms');
  const D=bind('dens10',v=>v.toFixed(0)+' /s',()=>{if(timer)schedule()});
  const J=bind('spray10',v=>v.toFixed(0)+' ms');
  function makeSource(){        // 2 s four-note phrase with harmonics — grains have melody to chew on
    const c=ctx(),sr=c.sampleRate,notes=[392,294,262,196],dur=0.5;
    const b=c.createBuffer(1,sr*notes.length*dur,sr),d=b.getChannelData(0);
    notes.forEach((f,ni)=>{
      const o=ni*dur*sr,len=dur*sr;
      for(let i=0;i<len;i++){
        const t=i/sr,env=Math.min(1,t*30)*Math.exp(-t*3);
        d[o+i]=env*0.5*(Math.sin(2*Math.PI*f*t)+0.4*Math.sin(4*Math.PI*f*t)+0.15*Math.sin(6*Math.PI*f*t));
      }
    });
    return b;
  }
  function grain(){
    const c=ctx(),t=c.currentTime,dur=+S.value/1000;
    const jit=(Math.random()*2-1)*(+J.value/1000);
    const at=Math.min(Math.max((+P.value/100)*(srcBuf.duration-dur)+jit,0),srcBuf.duration-dur);
    const g=c.createGain(),s=c.createBufferSource();
    s.buffer=srcBuf;
    g.gain.setValueAtTime(0,t);                        // Hann-ish grain envelope
    g.gain.linearRampToValueAtTime(0.45,t+dur/2);
    g.gain.linearRampToValueAtTime(0,t+dur);
    s.connect(g).connect(out);
    s.start(t,at,dur+0.02);
  }
  function schedule(){
    if(timer)clearInterval(timer);
    timer=setInterval(grain,1000/ +D.value);
  }
  makeToggle('run10',{
    start(){
      if(!srcBuf)srcBuf=makeSource();
      out=ctx().createGain();out.gain.value=0.5;
      out.connect(bus());
      scope.attach(out);spec.attach(out);
      schedule();
    },
    stop(){clearInterval(timer);timer=null;out=null;scope.detach();spec.detach()}
  });
})();

/* ============ slider definitions (tooltips) ============ */
(()=>{
  const TIPS={
    freq1:'How many times per second the air wobbles — heard as pitch. Measured in hertz (Hz).',
    gain1:'How big the wobble is — heard as loudness.',
    freq2:'How many times per second the wave repeats — heard as pitch.',
    cut3:'The frequency where the filter starts cutting. Everything above it gets muffled away.',
    res3:'Boosts the frequencies right at the cutoff, adding a whistly, squelchy edge.',
    a4:'Attack: time from key-press to full volume. Fast = percussive, slow = swelling.',
    d4:'Decay: time to fall from the peak down to the sustain level.',
    s4:'Sustain: the volume held for as long as the key stays down.',
    r4:'Release: fade-out time after the key is let go.',
    rate5:'How fast the LFO wiggles its target, in cycles per second.',
    depth5:'How far the LFO pushes the target away from its setting.',
    cut6:'The frequency where the filter starts cutting — sweep it for the classic "wah".',
    res6:'Boosts frequencies at the cutoff for a squelchy, whistly edge.',
    a6:'Attack: time from key-press to full volume.',
    r6:'Release: fade-out time after the key is let go.',
    sr7:'How many measurements are taken of each wave cycle. More samples = truer copy (Nyquist says you need at least 2).',
    bd7:'How many volume steps each measurement can round to. More steps = less rounding error = less noise.',
    ratio8:'Modulator frequency as a multiple of the carrier’s. Whole numbers sound harmonic; in-between values sound metallic and bell-like.',
    amt8:'How hard the modulator shakes the carrier’s pitch. More amount = more sidebands = brighter sound.',
    morph9:'Position in the wavetable — slides smoothly between the stored waveform shapes.',
    freq9:'How many times per second the wave repeats — heard as pitch.',
    pos10:'Where in the source recording the grains are picked from. Park it to freeze time.',
    size10:'Length of each grain. Long grains sound like echoing repeats; short ones melt into texture.',
    dens10:'How many grains are fired per second. Higher = thicker, smoother cloud.',
    spray10:'Random scatter around the position, so grains land in slightly different places each time.'
  };
  for(const id in TIPS){
    const el=document.getElementById(id);
    if(!el)continue;
    el.closest('.ctl').setAttribute('data-tip',TIPS[id]);
    el.setAttribute('aria-description',TIPS[id]);
  }
})();

/* ============ router: one module per page, hash-addressed ============ */
(()=>{
  const sections=[...document.querySelectorAll('section.module')];
  sections.forEach((s,i)=>{s.id='m'+String(i+1).padStart(2,'0')});
  const links=[...document.querySelectorAll('nav.side a')];
  function show(){
    let id=location.hash.slice(1);
    if(!sections.some(s=>s.id===id))id='m01';
    stopAll();                              // no invisible audio from another page
    sections.forEach(s=>{s.style.display=s.id===id?'':'none'});
    links.forEach(a=>a.setAttribute('aria-current',a.hash==='#'+id));
    dispatchEvent(new Event('resize'));     // canvases sized 0 while hidden — resize now they're visible
    scrollTo(0,0);
  }
  addEventListener('hashchange',show);
  show();
})();

/* ============ M01: air-pressure propagation animation (anime.js probe) ============ */
(()=>{
  const fig=document.getElementById('propFig');
  if(!fig)return;
  const NS='http://www.w3.org/2000/svg';
  const N=48, M=22, SP=(560-2*M)/N, AMP=8.5, PHASE=0.55;
  const dots=[];
  for(let i=0;i<N;i++){
    const c=document.createElementNS(NS,'circle');
    c.setAttribute('cx',(M+SP/2+i*SP).toFixed(1));
    c.setAttribute('cy',26);c.setAttribute('r',3.2);
    c.setAttribute('fill',i===N>>1?'#B45309':'#8A93A1');
    // frozen mid-wave offsets: the static frame shows the bunching on its own
    c.setAttribute('transform','translate('+(AMP*Math.sin(-i*PHASE)).toFixed(1)+' 0)');
    fig.appendChild(c);dots.push(c);
  }
  // dotted home mark under the tracked particle: it wobbles but never travels
  const mx=M+SP/2+(N>>1)*SP, tick=document.createElementNS(NS,'line');
  tick.setAttribute('x1',mx);tick.setAttribute('x2',mx);
  tick.setAttribute('y1',42);tick.setAttribute('y2',58);
  tick.setAttribute('stroke','#B45309');tick.setAttribute('stroke-width',2);
  tick.setAttribute('stroke-dasharray','3 3');
  fig.appendChild(tick);
  if(!window.anime||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // anime drives one phase value; each dot is sin(phase - i*PHASE) — a travelling
  // wave that loops seamlessly (period 2pi) and keeps the tracked dot at home
  const state={p:0};
  const anim=window.anime.animate(state,{
    p:Math.PI*2,duration:2400,ease:'linear',loop:true,
    onUpdate:()=>{for(let i=0;i<N;i++)
      dots[i].setAttribute('transform','translate('+(AMP*Math.sin(state.p-i*PHASE)).toFixed(2)+' 0)')}
  });
  // spend frames only while the figure is actually on screen
  new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?anim.play():anim.pause()))
    .observe(fig);
})();

/* ============ M04: ADSR playhead animation (anime.js) ============ */
(()=>{
  const fig=document.getElementById('adsrFig');
  if(!fig)return;
  const NS='http://www.w3.org/2000/svg';
  const W=560, X0=30, X1=530, YT=30, YB=126, HOLD=600, PAUSE=500;
  const el=(t,at)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);fig.appendChild(e);return e};
  el('line',{x1:X0,y1:YB,x2:X1,y2:YB,stroke:'#DFE4EB','stroke-width':1.5});
  const gate=el('rect',{y:YB+10,height:7,rx:3,fill:'#C7CDD6'});
  const gateLbl=el('text',{y:YB+31,fill:'#5B6572','font-size':11,'font-family':'system-ui'});
  gateLbl.textContent='key held';
  const zones=['A','D','S','R'].map(()=>el('text',{y:YT-4,fill:'#8A93A1','font-size':11,'text-anchor':'middle','font-family':'system-ui'}));
  zones.forEach((z,i)=>z.textContent='ADSR'[i]);
  const fillArea=el('path',{fill:'#059669','fill-opacity':0.12,stroke:'none'});
  const curve=el('path',{fill:'none',stroke:'#059669','stroke-width':2.5});
  const swept=el('path',{fill:'none',stroke:'#B45309','stroke-width':2.5});
  const head=el('circle',{r:5,fill:'#B45309'});
  const sliders=['a4','d4','s4','r4'].map(id=>document.getElementById(id));
  // envelope level at time t (ms), from the current slider values —
  // linear attack, exponential decay/release (tau = time/3), like the audio path
  function shape(){
    const [a,d,s,r]=[+sliders[0].value,+sliders[1].value,+sliders[2].value/100,+sliders[3].value];
    const total=a+d+HOLD+r+PAUSE;
    const lv=t=>{
      if(t<a)return t/a;
      if(t<a+d+HOLD)return s+(1-s)*Math.exp(-(t-a)/(d/3)); // decay runs on into the hold — continuous at the D/S seam
      const off=a+d+HOLD;
      if(t<off+r)return s*Math.exp(-(t-off)/(r/3));
      return 0;
    };
    return {a,d,s,r,total,off:a+d+HOLD,lv};
  }
  const px=(t,total)=>X0+(X1-X0)*t/total, py=v=>YB-(YB-YT)*v;
  function geom(sh){
    let dd='';
    for(let i=0;i<=240;i++){const t=sh.total*i/240;dd+=(i?'L':'M')+px(t,sh.total).toFixed(1)+','+py(sh.lv(t)).toFixed(1)+' ';}
    curve.setAttribute('d',dd);
    fillArea.setAttribute('d',dd+'L'+X1.toFixed(1)+','+YB+' L'+X0.toFixed(1)+','+YB+' Z');
    gate.setAttribute('x',X0);gate.setAttribute('width',px(sh.off,sh.total)-X0);
    gateLbl.setAttribute('x',X0+4);
    const marks=[sh.a/2,sh.a+sh.d/2,sh.a+sh.d+HOLD/2,sh.off+sh.r/2];
    zones.forEach((z,i)=>z.setAttribute('x',px(marks[i],sh.total)));
  }
  let sh=shape();geom(sh);
  head.setAttribute('cx',X0);head.setAttribute('cy',py(0));
  if(!window.anime||matchMedia('(prefers-reduced-motion: reduce)').matches){head.remove();swept.remove();return}
  // anime drives one clock; onUpdate evaluates the same formula the contour was
  // drawn from, so head and curve can never disagree (see lab CLAUDE.md pattern)
  let anim=null;
  function start(){
    if(anim)anim.cancel();
    const state={t:0};
    anim=window.anime.animate(state,{t:sh.total,duration:sh.total,ease:'linear',loop:true,
      onUpdate:()=>{
        const t=Math.min(state.t,sh.total);
        head.setAttribute('cx',px(t,sh.total));head.setAttribute('cy',py(sh.lv(t)));
        let dd='';const n=Math.max(2,Math.floor(240*t/sh.total));
        for(let i=0;i<=n;i++){const u=t*i/n;dd+=(i?'L':'M')+px(u,sh.total).toFixed(1)+','+py(sh.lv(u)).toFixed(1)+' ';}
        swept.setAttribute('d',dd);
      }});
  }
  start();
  sliders.forEach(s=>s.addEventListener('input',()=>{sh=shape();geom(sh);start()}));
  new IntersectionObserver(es=>es.forEach(e=>{if(anim)e.isIntersecting?anim.play():anim.pause()})).observe(fig);
})();

/* ============ shared helper for the anime figures ============ */
function animFig(id,build){
  const fig=document.getElementById(id);
  if(!fig)return;
  const NS='http://www.w3.org/2000/svg';
  const el=(t,at)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);fig.appendChild(e);return e};
  const {seed,tick,duration,loopDelay}=build(el,fig);
  tick(seed);                                    // static fallback frame
  if(!window.anime||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const state={p:0};
  const anim=window.anime.animate(state,{p:1,duration,ease:'linear',loop:true,loopDelay:loopDelay||0,
    onUpdate:()=>tick(state.p)});
  new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?anim.play():anim.pause())).observe(fig);
}

/* M02: harmonics stacking into a sawtooth */
animFig('stackFig',el=>{
  const X0=30,X1=530,Y=76,H=52,MAXN=9;
  const lbl=el('text',{x:X1,y:20,fill:'#B45309','font-size':12,'text-anchor':'end','font-family':'system-ui'});
  el('line',{x1:X0,y1:Y,x2:X1,y2:Y,stroke:'#DFE4EB','stroke-width':1.5});
  const path=el('path',{fill:'none',stroke:'#059669','stroke-width':2.5});
  return {seed:0.55,duration:12000,loopDelay:1400,tick(p){
    // n rises 1 -> MAXN then falls back; fractional harmonic fades in continuously
    const n=1+(MAXN-1)*(p<0.5?p*2:(1-p)*2);
    const full=Math.floor(n),frac=n-full;
    let d='';
    for(let i=0;i<=260;i++){
      const x=i/260*Math.PI*4;                   // two cycles
      let v=0;
      for(let k=1;k<=full;k++)v+=Math.sin(k*x)/k;
      if(full<MAXN)v+=frac*Math.sin((full+1)*x)/(full+1);
      d+=(i?'L':'M')+(X0+(X1-X0)*i/260).toFixed(1)+','+(Y-v*H*0.62).toFixed(1)+' ';
    }
    path.setAttribute('d',d);
    lbl.textContent='harmonics: '+n.toFixed(1);
  }};
});

/* M05: LFO wobbling the pitch of a carrier — vibrato drawn */
animFig('lfoFig',el=>{
  const X0=30,X1=530,YL=46,HL=20,YC=122,HC=34;
  el('text',{x:X0,y:20,fill:'#5B6572','font-size':11,'font-family':'system-ui'}).textContent='the LFO — too slow to hear';
  el('text',{x:X0,y:86,fill:'#5B6572','font-size':11,'font-family':'system-ui'}).textContent='the note it is wiggling';
  el('line',{x1:X0,y1:YL,x2:X1,y2:YL,stroke:'#DFE4EB'});
  const lfoPath=el('path',{fill:'none',stroke:'#8A93A1','stroke-width':2});
  const dot=el('circle',{r:5,fill:'#B45309'});
  const car=el('path',{fill:'none',stroke:'#059669','stroke-width':2.5});
  // the LFO trace itself is static; the dot and the carrier move
  let d='';for(let i=0;i<=200;i++)d+=(i?'L':'M')+(X0+(X1-X0)*i/200).toFixed(1)+','+(YL-Math.sin(i/200*Math.PI*2)*HL).toFixed(1)+' ';
  lfoPath.setAttribute('d',d);
  return {seed:0.18,duration:6000,tick(p){
    const lv=Math.sin(p*Math.PI*2);              // LFO value right now, -1..1
    dot.setAttribute('cx',X0+(X1-X0)*p);dot.setAttribute('cy',YL-lv*HL);
    // carrier with instantaneous frequency following the LFO: phase = integral of f(t)
    let dd='',ph=0;
    const base=14,depth=5;                       // cycles across the strip, wobble depth
    for(let i=0;i<=300;i++){
      const u=i/300;
      ph+=(base+depth*Math.sin((p-0.12+u*0.24)*Math.PI*2))*(Math.PI*2/300)*0.24; // short sliding window of time
      dd+=(i?'L':'M')+(X0+(X1-X0)*u).toFixed(1)+','+(YC-Math.sin(ph)*HC).toFixed(1)+' ';
    }
    car.setAttribute('d',dd);
  }};
});

/* M07: the staircase coarsening as the sample rate falls */
animFig('stairFig',el=>{
  const X0=30,X1=530,Y=78,H=54;
  const lbl=el('text',{x:X1,y:20,fill:'#B45309','font-size':12,'text-anchor':'end','font-family':'system-ui'});
  el('line',{x1:X0,y1:Y,x2:X1,y2:Y,stroke:'#DFE4EB','stroke-width':1.5});
  const wave=i=>Math.sin(i*Math.PI*4);           // two smooth cycles, 0..1 domain
  let d='';for(let i=0;i<=240;i++)d+=(i?'L':'M')+(X0+(X1-X0)*i/240).toFixed(1)+','+(Y-wave(i/240)*H).toFixed(1)+' ';
  el('path',{d,fill:'none',stroke:'#C7CDD6','stroke-width':1.5,'stroke-dasharray':'4 3'});
  const stair=el('path',{fill:'none',stroke:'#059669','stroke-width':2.5});
  return {seed:0.6,duration:10000,loopDelay:800,tick(p){
    // measurements per cycle sweeps 24 -> 3 -> 24
    const per=3+21*Math.abs(1-2*p);
    const n=Math.round(per*2);                   // total samples over the two cycles
    let dd='';
    for(let i=0;i<n;i++){
      const u0=i/n,u1=(i+1)/n,v=wave(u0);
      dd+=(i?'L':'M')+(X0+(X1-X0)*u0).toFixed(1)+','+(Y-v*H).toFixed(1)
        +' L'+(X0+(X1-X0)*u1).toFixed(1)+','+(Y-v*H).toFixed(1)+' ';
    }
    stair.setAttribute('d',dd);
    lbl.textContent='measurements per cycle: '+per.toFixed(0);
  }};
});
