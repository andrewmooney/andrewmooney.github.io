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

/* ============ Module 12: patch bay ============ */
(()=>{
  const patch=document.getElementById('patch12');
  const svg=document.getElementById('wires12');
  const world=document.getElementById('world12');
  const view={tx:0,ty:0,s:1};
  function applyView(){world.style.transform='translate('+view.tx+'px,'+view.ty+'px) scale('+view.s+')';drawWires()}
  function toWorld(cx,cy){const pr=patch.getBoundingClientRect();return{x:(cx-pr.left-view.tx)/view.s,y:(cy-pr.top-view.ty)/view.s}}
  const run=document.getElementById('run12');
  const scope=makeScope('scope12'),spec=makeSpectrum('spec12');
  const CONTROL={lfo:1,env:1,midi:1,arp:1,latch:1,det:1,sync:1,keys:1,clock:1};   // blocks whose cables carry control, not audio

  /* dropdowns, data-driven: each entry is one <select> kind a block can declare via DEFS[type].sels.
     key = model field on the block; after = live-update hook when the value changes. */
  const SELS={
    wave:{key:'wave',def:'sawtooth',label:'waveform',
      opts:[['sine','Sine'],['triangle','Triangle'],['sawtooth','Saw'],['square','Square']],
      after:b=>{if(live&&live.map[b.id])applyWave(b,live.map[b.id]);render()}},   // re-render: wave-specific controls show/hide
    ftype:{key:'ftype',def:'lowpass',label:'filter type',
      opts:[['lowpass','Low-pass'],['highpass','High-pass'],['bandpass','Band-pass'],['notch','Notch'],
            ['ladder','Ladder 24dB (Moog)'],['acid','Acid (303)']],
      after:()=>{if(running)rebuild()}},   // topologies differ (single vs cascade) — rebuild is click-free
    ncol:{key:'ncol',def:'white',label:'noise colour',
      opts:[['white','White'],['pink','Pink'],['brown','Brown']],
      after:b=>{
        if(!live||!live.map[b.id])return;
        const n=live.map[b.id],c=ctx();
        const s=c.createBufferSource();s.buffer=noiseBuf(c,b.ncol);s.loop=true;
        s.connect(n.out);s.start();
        try{n.src.stop()}catch(x){}
        n.src=s;
      }},
    lft:{key:'lft',def:'pitch',label:'LFO target on oscillators',
      opts:[['pitch','→ Pitch'],['pw','→ Pulse width']],
      after:()=>{if(running)rebuild()}},
    apat:{key:'apat',def:'up',label:'arp pattern',
      opts:[['up','Up'],['down','Down'],['updown','Up & down'],['random','Random']],
      after:null}                                              // read at each arp step
  };
  const DEFS={
    vco:  {name:'VCO · Osc',   hasIn:true, hasOut:true, sels:['wave'], params:[
            {lab:'',min:55,max:880,val:110,step:1,fmt:v=>v+' Hz'},
            {lab:'PW',min:5,max:95,val:50,step:1,fmt:v=>'PW '+v+' %',onlyWave:'square'},
            {lab:'GL',min:0,max:1000,val:0,step:10,fmt:v=>'GL '+(v/1000).toFixed(2)+' s'},
            {lab:'OCT',min:-3,max:3,val:0,step:1,fmt:v=>'OCT '+(v>0?'+':'')+v}],sub:true,modScale:60}, // in = control only (LFO/MIDI); audio wires in are ignored
    noise:{name:'Noise',       hasIn:false,hasOut:true, sels:['ncol'], params:[]},
    vcf:  {name:'VCF · Filter',hasIn:true, hasOut:true, sels:['ftype'], params:[
            {lab:'',min:0,max:100,val:60,step:1,fmt:kHzFmt},
            {lab:'KT',min:0,max:100,val:100,step:1,fmt:v=>'KT '+v+' %'},
            {lab:'RES',min:0,max:100,val:40,step:1,fmt:v=>'Res '+v+' %'}],modScale:1200}, // KT: keyboard tracking; RES 40 = the pre-knob default character. modScale in cents: LFO wobbles detune, never negative Hz
    vca:  {name:'VCA · Amp',   hasIn:true, hasOut:true, params:[{lab:'',min:0,max:100,val:60,step:1,fmt:v=>v+' %'}],modScale:0.25},
    mix:  {name:'Mixer',       hasIn:true, hasOut:true, params:[{lab:'',min:0,max:100,val:80,step:1,fmt:v=>v+' %'}],modScale:0.25},
    lfo:  {name:'LFO',         hasIn:false,hasOut:true, sels:['lft'], params:[{lab:'',min:0.5,max:12,val:4,step:0.1,fmt:v=>v.toFixed(1)+' Hz'}]},
    env:  {name:'EG · Envelope',hasIn:true, hasOut:true,params:[   // in = gate from MIDI
            {lab:'A',min:1,max:1500,val:40,step:1,fmt:v=>'A '+(v/1000).toFixed(2)+' s'},
            {lab:'D',min:1,max:2000,val:200,step:1,fmt:v=>'D '+(v/1000).toFixed(2)+' s'},
            {lab:'S',min:0,max:100,val:70,step:1,fmt:v=>'S '+v+' %'},
            {lab:'R',min:1,max:2500,val:300,step:1,fmt:v=>'R '+(v/1000).toFixed(2)+' s'}],trig:true},
    rev:  {name:'Reverb',      hasIn:true, hasOut:true, params:[
            {lab:'SZ',min:0.3,max:4,val:1.5,step:0.1,fmt:v=>'Size '+v.toFixed(1)+' s'},
            {lab:'MIX',min:0,max:100,val:35,step:1,fmt:v=>'Mix '+v+' %'}]},
    drv:  {name:'Drive',       hasIn:true, hasOut:true, params:[
            {lab:'',min:0,max:100,val:40,step:1,fmt:v=>'Drive '+v+' %'},
            {lab:'LVL',min:0,max:100,val:70,step:1,fmt:v=>'Level '+v+' %'}]},
    cho:  {name:'Chorus',      hasIn:true, hasOut:true, params:[
            {lab:'RT',min:0.1,max:5,val:0.8,step:0.1,fmt:v=>'Rate '+v.toFixed(1)+' Hz'},
            {lab:'DP',min:0,max:100,val:50,step:1,fmt:v=>'Depth '+v+' %'}]},
    crush:{name:'Crusher',     hasIn:true, hasOut:true, params:[
            {lab:'',min:2,max:8,val:5,step:1,fmt:v=>v+' bits'}]},
    del:  {name:'Delay',       hasIn:true, hasOut:true, params:[
            {lab:'T',min:20,max:800,val:280,step:1,fmt:v=>'T '+v+' ms'},
            {lab:'FB',min:0,max:90,val:45,step:1,fmt:v=>'FB '+v+' %'}],modScale:0.008},
    midi: {name:'MIDI In',     hasIn:false,hasOut:true, params:[],chan:true},
    keys: {name:'Keys',        hasIn:false,hasOut:true, params:[],keys:true},   // note source: on-screen keys + A-K
    clock:{name:'Clock',       hasIn:false,hasOut:true, params:[{lab:'',min:0.5,max:8,val:2,step:0.1,fmt:v=>v.toFixed(1)+' Hz'}]}, // self-firing gate
    arp:  {name:'Arp',         hasIn:true, hasOut:true, sels:['apat'], params:[
            {lab:'',min:1,max:20,val:6,step:0.5,fmt:v=>v.toFixed(1)+' Hz'},
            {lab:'SW',min:50,max:75,val:50,step:1,fmt:v=>'SW '+v+' %'}]}, // in = notes; SW 50 = straight, 66 = triplet shuffle
    latch:{name:'Latch',       hasIn:true, hasOut:true, params:[]},                       // in = notes; press toggles held
    det:  {name:'Detune',      hasIn:false,hasOut:true, params:[{lab:'',min:-100,max:100,val:7,step:1,fmt:v=>(v>0?'+':'')+v+' ¢'}]},
    sync: {name:'Sync',        hasIn:true, hasOut:true, params:[]},                       // in = leader osc, out = followers
    code: {name:'Code',        hasIn:true, hasOut:true, codeblk:true, params:[]},   // your own DSP, run sample-by-sample in an AudioWorklet
    out:  {name:'Output',      hasIn:true, hasOut:false,params:[
            {lab:'',min:0,max:100,val:80,step:1,fmt:v=>'Vol '+v+' %'},
            {lab:'PAN',min:-100,max:100,val:0,step:1,fmt:v=>v===0?'Pan C':'Pan '+(v<0?'L':'R')+Math.abs(v)}]}
  };

  /* per-module diagrams shown in the doc panel */
  const FIGS={"vco": "<svg class=\"mathfig\" viewBox=\"0 0 520 112\" role=\"img\" aria-label=\"The four oscillator waveform shapes\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"20\" y1=\"52\" x2=\"125\" y2=\"52\" stroke=\"#DFE4EB\"/><path d=\"M20.0,52.0 L22.0,44.9 L24.0,38.2 L26.0,32.3 L28.0,27.5 L30.0,24.1 L32.0,22.3 L34.0,22.2 L36.0,23.8 L38.0,27.0 L40.0,31.6 L42.0,37.4 L44.0,44.0 L46.0,51.1 L48.0,58.2 L50.0,65.0 L52.0,71.1 L54.0,76.0 L56.0,79.6 L58.0,81.6 L60.0,81.9 L62.0,80.5 L64.0,77.5 L66.0,73.1 L68.0,67.4 L70.0,60.8 L72.0,53.8 L74.0,46.6 L76.0,39.8 L78.0,33.6 L80.0,28.5 L82.0,24.8 L84.0,22.6 L86.0,22.0 L88.0,23.2 L90.0,26.0 L92.0,30.3 L94.0,35.8 L96.0,42.3 L98.0,49.3 L100.0,56.5 L102.0,63.4 L104.0,69.6 L106.0,74.9 L108.0,78.8 L110.0,81.2 L112.0,82.0 L114.0,81.0 L116.0,78.4 L118.0,74.3 L120.0,68.9 L122.0,62.5 L124.0,55.6\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"72\" y=\"102\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">sine</text><line x1=\"145\" y1=\"52\" x2=\"250\" y2=\"52\" stroke=\"#DFE4EB\"/><path d=\"M145.0,52.0 L147.0,47.4 L149.0,42.9 L151.0,38.3 L153.0,33.7 L155.0,29.1 L157.0,24.6 L159.0,24.0 L161.0,28.6 L163.0,33.1 L165.0,37.7 L167.0,42.3 L169.0,46.9 L171.0,51.4 L173.0,56.0 L175.0,60.6 L177.0,65.1 L179.0,69.7 L181.0,74.3 L183.0,78.9 L185.0,80.6 L187.0,76.0 L189.0,71.4 L191.0,66.9 L193.0,62.3 L195.0,57.7 L197.0,53.1 L199.0,48.6 L201.0,44.0 L203.0,39.4 L205.0,34.9 L207.0,30.3 L209.0,25.7 L211.0,22.9 L213.0,27.4 L215.0,32.0 L217.0,36.6 L219.0,41.1 L221.0,45.7 L223.0,50.3 L225.0,54.9 L227.0,59.4 L229.0,64.0 L231.0,68.6 L233.0,73.1 L235.0,77.7 L237.0,81.7 L239.0,77.1 L241.0,72.6 L243.0,68.0 L245.0,63.4 L247.0,58.9 L249.0,54.3\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"197\" y=\"102\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">triangle</text><line x1=\"270\" y1=\"52\" x2=\"375\" y2=\"52\" stroke=\"#DFE4EB\"/><path d=\"M270.0,82.0 L272.0,79.7 L274.0,77.4 L276.0,75.1 L278.0,72.9 L280.0,70.6 L282.0,68.3 L284.0,66.0 L286.0,63.7 L288.0,61.4 L290.0,59.1 L292.0,56.9 L294.0,54.6 L296.0,52.3 L298.0,50.0 L300.0,47.7 L302.0,45.4 L304.0,43.1 L306.0,40.9 L308.0,38.6 L310.0,36.3 L312.0,34.0 L314.0,31.7 L316.0,29.4 L318.0,27.1 L320.0,24.9 L322.0,22.6 L324.0,80.3 L326.0,78.0 L328.0,75.7 L330.0,73.4 L332.0,71.1 L334.0,68.9 L336.0,66.6 L338.0,64.3 L340.0,62.0 L342.0,59.7 L344.0,57.4 L346.0,55.1 L348.0,52.9 L350.0,50.6 L352.0,48.3 L354.0,46.0 L356.0,43.7 L358.0,41.4 L360.0,39.1 L362.0,36.9 L364.0,34.6 L366.0,32.3 L368.0,30.0 L370.0,27.7 L372.0,25.4 L374.0,23.1\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"322\" y=\"102\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">saw</text><line x1=\"395\" y1=\"52\" x2=\"500\" y2=\"52\" stroke=\"#DFE4EB\"/><path d=\"M395.0,22.0 L397.0,22.0 L399.0,22.0 L401.0,22.0 L403.0,22.0 L405.0,22.0 L407.0,22.0 L409.0,22.0 L411.0,22.0 L413.0,22.0 L415.0,22.0 L417.0,22.0 L419.0,22.0 L421.0,22.0 L423.0,82.0 L425.0,82.0 L427.0,82.0 L429.0,82.0 L431.0,82.0 L433.0,82.0 L435.0,82.0 L437.0,82.0 L439.0,82.0 L441.0,82.0 L443.0,82.0 L445.0,82.0 L447.0,82.0 L449.0,22.0 L451.0,22.0 L453.0,22.0 L455.0,22.0 L457.0,22.0 L459.0,22.0 L461.0,22.0 L463.0,22.0 L465.0,22.0 L467.0,22.0 L469.0,22.0 L471.0,22.0 L473.0,22.0 L475.0,82.0 L477.0,82.0 L479.0,82.0 L481.0,82.0 L483.0,82.0 L485.0,82.0 L487.0,82.0 L489.0,82.0 L491.0,82.0 L493.0,82.0 L495.0,82.0 L497.0,82.0 L499.0,82.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"447\" y=\"102\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">square</text></svg>", "noise": "<svg class=\"mathfig\" viewBox=\"0 0 520 148\" role=\"img\" aria-label=\"Noise colours as spectral slopes\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"120\" x2=\"490\" y2=\"120\" stroke=\"#DFE4EB\"/><line x1=\"40\" y1=\"14\" x2=\"40\" y2=\"120\" stroke=\"#DFE4EB\"/><line x1=\"40\" y1=\"34\" x2=\"490\" y2=\"34\" stroke=\"#5B6572\" stroke-width=\"2.2\"/><text x=\"452\" y=\"28\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">white \u00b7 flat</text><line x1=\"40\" y1=\"40\" x2=\"490\" y2=\"86\" stroke=\"#B45309\" stroke-width=\"2.2\"/><text x=\"430\" y=\"98\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">pink \u00b7 \u22123 dB/oct</text><line x1=\"40\" y1=\"44\" x2=\"430\" y2=\"120\" stroke=\"#1C2431\" stroke-width=\"2.2\"/><text x=\"310\" y=\"116\" fill=\"#1C2431\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">brown \u00b7 \u22126 dB/oct</text><text x=\"265\" y=\"138\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">frequency \u2192</text><text x=\"30\" y=\"20\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"end\" font-family=\"system-ui\">loud</text></svg>", "vcf": "<svg class=\"mathfig\" viewBox=\"0 0 520 156\" role=\"img\" aria-label=\"Filter response: passband, resonance bump at the cutoff, rolloff\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"130\" x2=\"490\" y2=\"130\" stroke=\"#DFE4EB\"/><path d=\"M40.0,52.0 L43.0,52.0 L46.0,52.0 L49.0,52.0 L52.0,52.0 L55.0,52.0 L58.0,52.0 L61.0,52.0 L64.0,52.0 L67.0,52.0 L70.0,52.0 L73.0,52.0 L76.0,52.0 L79.0,52.0 L82.0,52.0 L85.0,52.0 L88.0,52.0 L91.0,52.0 L94.0,52.0 L97.0,52.0 L100.0,52.0 L103.0,52.0 L106.0,52.0 L109.0,52.0 L112.0,52.0 L115.0,52.0 L118.0,52.0 L121.0,52.0 L124.0,52.0 L127.0,52.0 L130.0,52.0 L133.0,52.0 L136.0,52.0 L139.0,52.0 L142.0,52.0 L145.0,52.0 L148.0,52.0 L151.0,52.0 L154.0,52.0 L157.0,52.0 L160.0,52.0 L163.0,52.0 L166.0,52.0 L169.0,52.0 L172.0,52.0 L175.0,52.0 L178.0,52.0 L181.0,52.0 L184.0,52.0 L187.0,52.0 L190.0,52.0 L193.0,52.0 L196.0,52.0 L199.0,52.0 L202.0,52.0 L205.0,52.0 L208.0,52.0 L211.0,52.0 L214.0,52.0 L217.0,52.0 L220.0,52.0 L223.0,52.0 L226.0,52.0 L229.0,52.0 L232.0,52.0 L235.0,52.0 L238.0,52.0 L241.0,52.0 L244.0,52.0 L247.0,52.0 L250.0,52.0 L253.0,52.0 L256.0,50.9 L259.0,47.7 L262.0,44.6 L265.0,41.6 L268.0,38.8 L271.0,36.2 L274.0,33.9 L277.0,32.0 L280.0,30.4 L283.0,29.2 L286.0,28.4 L289.0,28.0 L292.0,29.2 L295.0,31.0 L298.0,32.8 L301.0,34.6 L304.0,36.4 L307.0,38.2 L310.0,40.0 L313.0,41.8 L316.0,43.6 L319.0,45.4 L322.0,47.2 L325.0,49.0 L328.0,50.8 L331.0,52.6 L334.0,54.4 L337.0,56.2 L340.0,58.0 L343.0,59.8 L346.0,61.6 L349.0,63.4 L352.0,65.2 L355.0,67.0 L358.0,68.8 L361.0,70.6 L364.0,72.4 L367.0,74.2 L370.0,76.0 L373.0,77.8 L376.0,79.6 L379.0,81.4 L382.0,83.2 L385.0,85.0 L388.0,86.8 L391.0,88.6 L394.0,90.4 L397.0,92.2 L400.0,94.0 L403.0,95.8 L406.0,97.6 L409.0,99.4 L412.0,101.2 L415.0,103.0 L418.0,104.8 L421.0,106.6 L424.0,108.4 L427.0,110.2 L430.0,112.0 L433.0,113.8 L436.0,115.6 L439.0,117.4 L442.0,119.2 L445.0,121.0 L448.0,122.8 L451.0,124.6 L454.0,126.4 L457.0,128.2 L460.0,130.0 L463.0,130.0 L466.0,130.0 L469.0,130.0 L472.0,130.0 L475.0,130.0 L478.0,130.0 L481.0,130.0 L484.0,130.0 L487.0,130.0 L490.0,130.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2.4\"/><line x1=\"290\" y1=\"130\" x2=\"290\" y2=\"22\" stroke=\"#B45309\" stroke-dasharray=\"5 4\" stroke-width=\"1.4\"/><text x=\"290\" y=\"146\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">cutoff</text><text x=\"280\" y=\"20\" fill=\"#B45309\" font-size=\"10\" text-anchor=\"end\" font-family=\"system-ui\">resonance (Q)</text><text x=\"420\" y=\"70\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">rolloff</text></svg>", "vca": "<svg class=\"mathfig\" viewBox=\"0 0 520 122\" role=\"img\" aria-label=\"A VCA multiplies the signal by a gain value\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M30.0,60.0 L32.0,51.0 L34.0,42.6 L36.0,35.4 L38.0,30.1 L40.0,26.9 L42.0,26.0 L44.0,27.7 L46.0,31.6 L48.0,37.6 L50.0,45.2 L52.0,53.9 L54.0,63.0 L56.0,71.9 L58.0,80.0 L60.0,86.6 L62.0,91.3 L64.0,93.7 L66.0,93.7 L68.0,91.3 L70.0,86.6 L72.0,80.0 L74.0,71.9 L76.0,63.0 L78.0,53.9 L80.0,45.2 L82.0,37.6 L84.0,31.6 L86.0,27.7 L88.0,26.0 L90.0,26.9 L92.0,30.1 L94.0,35.4 L96.0,42.6 L98.0,51.0 L100.0,60.0 L102.0,69.0 L104.0,77.4 L106.0,84.6 L108.0,89.9 L110.0,93.1 L112.0,94.0 L114.0,92.3 L116.0,88.4 L118.0,82.4 L120.0,74.8 L122.0,66.1 L124.0,57.0 L126.0,48.1 L128.0,40.0 L130.0,33.4 L132.0,28.7 L134.0,26.3 L136.0,26.3 L138.0,28.7 L140.0,33.4 L142.0,40.0 L144.0,48.1 L146.0,57.0 L148.0,66.1 L150.0,74.8 L152.0,82.4 L154.0,88.4 L156.0,92.3 L158.0,94.0 L160.0,93.1 L162.0,89.9 L164.0,84.6 L166.0,77.4 L168.0,69.0 L170.0,60.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"1.8\"/><text x=\"100\" y=\"112\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">input</text><text x=\"196\" y=\"64\" fill=\"#1C2431\" font-size=\"20\" text-anchor=\"middle\" font-family=\"system-ui\">\u00d7</text><path d=\"M225,92 L355,28\" stroke=\"#B45309\" stroke-width=\"2.2\" fill=\"none\"/><text x=\"290\" y=\"112\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">gain rising</text><text x=\"382\" y=\"64\" fill=\"#1C2431\" font-size=\"20\" text-anchor=\"middle\" font-family=\"system-ui\">=</text><path d=\"M400.0,60.0 L402.0,59.8 L404.0,59.4 L406.0,58.6 L408.0,57.8 L410.0,57.0 L412.0,56.3 L414.0,55.9 L416.0,56.0 L418.0,56.5 L420.0,57.6 L422.0,59.1 L424.0,61.1 L426.0,63.3 L428.0,65.6 L430.0,67.7 L432.0,69.4 L434.0,70.5 L436.0,70.9 L438.0,70.3 L440.0,68.9 L442.0,66.5 L444.0,63.4 L446.0,59.7 L448.0,55.7 L450.0,51.6 L452.0,48.0 L454.0,45.0 L456.0,43.0 L458.0,42.2 L460.0,42.7 L462.0,44.7 L464.0,48.0 L466.0,52.5 L468.0,57.8 L470.0,63.7 L472.0,69.6 L474.0,75.1 L476.0,79.7 L478.0,83.0 L480.0,84.7 L482.0,84.6 L484.0,82.5 L486.0,78.6 L488.0,73.1 L490.0,66.3 L492.0,58.7 L494.0,50.9 L496.0,43.4 L498.0,36.9 L500.0,31.9 L502.0,28.8 L504.0,28.1 L506.0,29.7 L508.0,33.8 L510.0,40.0\" fill=\"none\" stroke=\"#1C2431\" stroke-width=\"1.8\"/><text x=\"455\" y=\"112\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">output grows</text></svg>", "mix": "<svg class=\"mathfig\" viewBox=\"0 0 520 168\" role=\"img\" aria-label=\"Two signals added sample by sample\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"70\" y1=\"32\" x2=\"470\" y2=\"32\" stroke=\"#DFE4EB\"/><path d=\"M70.0,32.0 L73.0,30.5 L76.0,29.0 L79.0,27.5 L82.0,26.1 L85.0,24.7 L88.0,23.4 L91.0,22.2 L94.0,21.0 L97.0,20.0 L100.0,19.1 L103.0,18.2 L106.0,17.5 L109.0,16.9 L112.0,16.5 L115.0,16.2 L118.0,16.0 L121.0,16.0 L124.0,16.1 L127.0,16.4 L130.0,16.8 L133.0,17.3 L136.0,18.0 L139.0,18.8 L142.0,19.7 L145.0,20.7 L148.0,21.8 L151.0,23.0 L154.0,24.3 L157.0,25.6 L160.0,27.1 L163.0,28.5 L166.0,30.0 L169.0,31.5 L172.0,33.0 L175.0,34.5 L178.0,36.0 L181.0,37.4 L184.0,38.8 L187.0,40.1 L190.0,41.4 L193.0,42.6 L196.0,43.7 L199.0,44.6 L202.0,45.5 L205.0,46.3 L208.0,46.9 L211.0,47.4 L214.0,47.7 L217.0,47.9 L220.0,48.0 L223.0,47.9 L226.0,47.7 L229.0,47.4 L232.0,46.9 L235.0,46.3 L238.0,45.5 L241.0,44.6 L244.0,43.7 L247.0,42.6 L250.0,41.4 L253.0,40.1 L256.0,38.8 L259.0,37.4 L262.0,36.0 L265.0,34.5 L268.0,33.0 L271.0,31.5 L274.0,30.0 L277.0,28.5 L280.0,27.1 L283.0,25.6 L286.0,24.3 L289.0,23.0 L292.0,21.8 L295.0,20.7 L298.0,19.7 L301.0,18.8 L304.0,18.0 L307.0,17.3 L310.0,16.8 L313.0,16.4 L316.0,16.1 L319.0,16.0 L322.0,16.0 L325.0,16.2 L328.0,16.5 L331.0,16.9 L334.0,17.5 L337.0,18.2 L340.0,19.1 L343.0,20.0 L346.0,21.0 L349.0,22.2 L352.0,23.4 L355.0,24.7 L358.0,26.1 L361.0,27.5 L364.0,29.0 L367.0,30.5 L370.0,32.0 L373.0,33.5 L376.0,35.0 L379.0,36.5 L382.0,37.9 L385.0,39.3 L388.0,40.6 L391.0,41.8 L394.0,43.0 L397.0,44.0 L400.0,44.9 L403.0,45.8 L406.0,46.5 L409.0,47.1 L412.0,47.5 L415.0,47.8 L418.0,48.0 L421.0,48.0 L424.0,47.9 L427.0,47.6 L430.0,47.2 L433.0,46.7 L436.0,46.0 L439.0,45.2 L442.0,44.3 L445.0,43.3 L448.0,42.2 L451.0,41.0 L454.0,39.7 L457.0,38.4 L460.0,36.9 L463.0,35.5 L466.0,34.0 L469.0,32.5\" fill=\"none\" stroke=\"#059669\" stroke-width=\"1.8\"/><text x=\"58\" y=\"36\" fill=\"#059669\" font-size=\"12\" text-anchor=\"end\" font-family=\"system-ui\">A</text><line x1=\"70\" y1=\"78\" x2=\"470\" y2=\"78\" stroke=\"#DFE4EB\"/><path d=\"M70.0,69.9 L73.0,68.9 L76.0,68.4 L79.0,68.6 L82.0,69.3 L85.0,70.7 L88.0,72.5 L91.0,74.6 L94.0,77.0 L97.0,79.4 L100.0,81.8 L103.0,83.9 L106.0,85.6 L109.0,86.8 L112.0,87.5 L115.0,87.5 L118.0,87.0 L121.0,85.8 L124.0,84.2 L127.0,82.2 L130.0,79.8 L133.0,77.4 L136.0,75.0 L139.0,72.8 L142.0,71.0 L145.0,69.5 L148.0,68.7 L151.0,68.4 L154.0,68.8 L157.0,69.7 L160.0,71.2 L163.0,73.1 L166.0,75.3 L169.0,77.7 L172.0,80.2 L175.0,82.4 L178.0,84.4 L181.0,86.0 L184.0,87.1 L187.0,87.6 L190.0,87.4 L193.0,86.7 L196.0,85.4 L199.0,83.6 L202.0,81.5 L205.0,79.1 L208.0,76.7 L211.0,74.3 L214.0,72.2 L217.0,70.5 L220.0,69.2 L223.0,68.5 L226.0,68.4 L229.0,69.0 L232.0,70.1 L235.0,71.7 L238.0,73.8 L241.0,76.1 L244.0,78.5 L247.0,80.9 L250.0,83.1 L253.0,85.0 L256.0,86.4 L259.0,87.3 L262.0,87.6 L265.0,87.3 L268.0,86.3 L271.0,84.9 L274.0,83.0 L277.0,80.8 L280.0,78.4 L283.0,75.9 L286.0,73.6 L289.0,71.6 L292.0,70.0 L295.0,68.9 L298.0,68.4 L301.0,68.5 L304.0,69.3 L307.0,70.6 L310.0,72.3 L313.0,74.4 L316.0,76.8 L319.0,79.2 L322.0,81.6 L325.0,83.7 L328.0,85.5 L331.0,86.8 L334.0,87.5 L337.0,87.6 L340.0,87.0 L343.0,86.0 L346.0,84.3 L349.0,82.3 L352.0,80.0 L355.0,77.6 L358.0,75.2 L361.0,73.0 L364.0,71.1 L367.0,69.6 L370.0,68.7 L373.0,68.4 L376.0,68.7 L379.0,69.6 L382.0,71.0 L385.0,72.9 L388.0,75.2 L391.0,77.6 L394.0,80.0 L397.0,82.3 L400.0,84.3 L403.0,85.9 L406.0,87.0 L409.0,87.6 L412.0,87.5 L415.0,86.8 L418.0,85.5 L421.0,83.8 L424.0,81.6 L427.0,79.3 L430.0,76.8 L433.0,74.5 L436.0,72.3 L439.0,70.6 L442.0,69.3 L445.0,68.6 L448.0,68.4 L451.0,68.9 L454.0,70.0 L457.0,71.6 L460.0,73.6 L463.0,75.9 L466.0,78.3 L469.0,80.7\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1.8\"/><text x=\"58\" y=\"82\" fill=\"#B45309\" font-size=\"12\" text-anchor=\"end\" font-family=\"system-ui\">B</text><line x1=\"70\" y1=\"136\" x2=\"470\" y2=\"136\" stroke=\"#DFE4EB\"/><path d=\"M70.0,127.9 L72.0,126.2 L74.0,124.7 L76.0,123.4 L78.0,122.5 L80.0,121.8 L82.0,121.5 L84.0,121.4 L86.0,121.5 L88.0,121.9 L90.0,122.5 L92.0,123.2 L94.0,124.0 L96.0,124.9 L98.0,125.9 L100.0,126.8 L102.0,127.7 L104.0,128.5 L106.0,129.1 L108.0,129.6 L110.0,129.9 L112.0,130.0 L114.0,129.9 L116.0,129.6 L118.0,129.0 L120.0,128.3 L122.0,127.4 L124.0,126.3 L126.0,125.2 L128.0,123.9 L130.0,122.6 L132.0,121.4 L134.0,120.1 L136.0,119.0 L138.0,118.0 L140.0,117.2 L142.0,116.6 L144.0,116.3 L146.0,116.2 L148.0,116.5 L150.0,117.0 L152.0,117.9 L154.0,119.0 L156.0,120.5 L158.0,122.2 L160.0,124.2 L162.0,126.4 L164.0,128.8 L166.0,131.3 L168.0,133.9 L170.0,136.6 L172.0,139.2 L174.0,141.7 L176.0,144.1 L178.0,146.4 L180.0,148.5 L182.0,150.3 L184.0,151.9 L186.0,153.2 L188.0,154.2 L190.0,154.8 L192.0,155.2 L194.0,155.3 L196.0,155.1 L198.0,154.6 L200.0,153.9 L202.0,153.0 L204.0,151.9 L206.0,150.8 L208.0,149.5 L210.0,148.3 L212.0,147.1 L214.0,145.9 L216.0,144.9 L218.0,144.0 L220.0,143.2 L222.0,142.7 L224.0,142.3 L226.0,142.2 L228.0,142.2 L230.0,142.5 L232.0,143.0 L234.0,143.6 L236.0,144.4 L238.0,145.3 L240.0,146.2 L242.0,147.2 L244.0,148.2 L246.0,149.1 L248.0,149.9 L250.0,150.5 L252.0,151.0 L254.0,151.2 L256.0,151.2 L258.0,151.0 L260.0,150.4 L262.0,149.6 L264.0,148.4 L266.0,147.0 L268.0,145.4 L270.0,143.4 L272.0,141.3 L274.0,139.0 L276.0,136.5 L278.0,134.0 L280.0,131.4 L282.0,128.8 L284.0,126.3 L286.0,123.9 L288.0,121.7 L290.0,119.6 L292.0,117.8 L294.0,116.3 L296.0,115.0 L298.0,114.1 L300.0,113.5 L302.0,113.2 L304.0,113.2 L306.0,113.6 L308.0,114.2 L310.0,115.1 L312.0,116.2 L314.0,117.5 L316.0,118.9 L318.0,120.5 L320.0,122.0 L322.0,123.6 L324.0,125.2 L326.0,126.6 L328.0,128.0 L330.0,129.2 L332.0,130.2 L334.0,131.0 L336.0,131.6 L338.0,132.0 L340.0,132.1 L342.0,132.1 L344.0,131.8 L346.0,131.4 L348.0,130.8 L350.0,130.2 L352.0,129.5 L354.0,128.7 L356.0,128.0 L358.0,127.3 L360.0,126.7 L362.0,126.3 L364.0,126.1 L366.0,126.0 L368.0,126.3 L370.0,126.7 L372.0,127.4 L374.0,128.4 L376.0,129.7 L378.0,131.2 L380.0,133.0 L382.0,134.9 L384.0,137.1 L386.0,139.4 L388.0,141.7 L390.0,144.2 L392.0,146.6 L394.0,148.9 L396.0,151.2 L398.0,153.3 L400.0,155.3 L402.0,157.0 L404.0,158.4 L406.0,159.5 L408.0,160.3 L410.0,160.8 L412.0,161.0 L414.0,160.8 L416.0,160.3 L418.0,159.5 L420.0,158.4 L422.0,157.1 L424.0,155.5 L426.0,153.8 L428.0,152.0 L430.0,150.1 L432.0,148.1 L434.0,146.2 L436.0,144.4 L438.0,142.6 L440.0,141.0 L442.0,139.6 L444.0,138.4 L446.0,137.4 L448.0,136.6 L450.0,136.1 L452.0,135.8 L454.0,135.7 L456.0,135.8 L458.0,136.1 L460.0,136.5 L462.0,137.1 L464.0,137.7 L466.0,138.3 L468.0,138.9 L470.0,139.5\" fill=\"none\" stroke=\"#1C2431\" stroke-width=\"2\"/><text x=\"50\" y=\"140\" fill=\"#1C2431\" font-size=\"12\" text-anchor=\"end\" font-family=\"system-ui\">A+B</text></svg>", "del": "<svg class=\"mathfig\" viewBox=\"0 0 520 160\" role=\"img\" aria-label=\"One sound followed by geometrically fading echoes\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"120\" x2=\"490\" y2=\"120\" stroke=\"#DFE4EB\"/><line x1=\"70\" y1=\"120\" x2=\"70\" y2=\"30\" stroke=\"#059669\" stroke-width=\"5\"/><line x1=\"180\" y1=\"120\" x2=\"180\" y2=\"80\" stroke=\"#B45309\" stroke-width=\"5\"/><line x1=\"290\" y1=\"120\" x2=\"290\" y2=\"102\" stroke=\"#B45309\" stroke-width=\"5\"/><line x1=\"400\" y1=\"120\" x2=\"400\" y2=\"112\" stroke=\"#B45309\" stroke-width=\"5\"/><path d=\"M70,132 v7 h110 v-7\" fill=\"none\" stroke=\"#5B6572\" stroke-width=\"1.2\"/><text x=\"125\" y=\"152\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">delay time T</text><text x=\"300\" y=\"40\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">each echo = previous \u00d7 feedback</text></svg>", "rev": "<svg class=\"mathfig\" viewBox=\"0 0 520 156\" role=\"img\" aria-label=\"Reverb as a dense cloud of decaying echoes\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"120\" x2=\"490\" y2=\"120\" stroke=\"#DFE4EB\"/><line x1=\"60\" y1=\"120\" x2=\"60\" y2=\"28\" stroke=\"#059669\" stroke-width=\"4\"/><line x1=\"78\" y1=\"120\" x2=\"78\" y2=\"68\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"84\" y1=\"120\" x2=\"84\" y2=\"78\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"90\" y1=\"120\" x2=\"90\" y2=\"55\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"95\" y1=\"120\" x2=\"95\" y2=\"85\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"101\" y1=\"120\" x2=\"101\" y2=\"65\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"107\" y1=\"120\" x2=\"107\" y2=\"74\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"113\" y1=\"120\" x2=\"113\" y2=\"89\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"119\" y1=\"120\" x2=\"119\" y2=\"72\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"124\" y1=\"120\" x2=\"124\" y2=\"92\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"130\" y1=\"120\" x2=\"130\" y2=\"78\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"136\" y1=\"120\" x2=\"136\" y2=\"93\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"142\" y1=\"120\" x2=\"142\" y2=\"93\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"148\" y1=\"120\" x2=\"148\" y2=\"83\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"153\" y1=\"120\" x2=\"153\" y2=\"72\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"159\" y1=\"120\" x2=\"159\" y2=\"96\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"165\" y1=\"120\" x2=\"165\" y2=\"94\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"171\" y1=\"120\" x2=\"171\" y2=\"83\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"177\" y1=\"120\" x2=\"177\" y2=\"76\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"182\" y1=\"120\" x2=\"182\" y2=\"88\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"188\" y1=\"120\" x2=\"188\" y2=\"94\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"194\" y1=\"120\" x2=\"194\" y2=\"81\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"200\" y1=\"120\" x2=\"200\" y2=\"104\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"206\" y1=\"120\" x2=\"206\" y2=\"87\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"211\" y1=\"120\" x2=\"211\" y2=\"101\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"217\" y1=\"120\" x2=\"217\" y2=\"104\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"223\" y1=\"120\" x2=\"223\" y2=\"106\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"229\" y1=\"120\" x2=\"229\" y2=\"103\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"235\" y1=\"120\" x2=\"235\" y2=\"96\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"240\" y1=\"120\" x2=\"240\" y2=\"107\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"246\" y1=\"120\" x2=\"246\" y2=\"102\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"252\" y1=\"120\" x2=\"252\" y2=\"102\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"258\" y1=\"120\" x2=\"258\" y2=\"107\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"264\" y1=\"120\" x2=\"264\" y2=\"105\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"269\" y1=\"120\" x2=\"269\" y2=\"112\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"275\" y1=\"120\" x2=\"275\" y2=\"112\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"281\" y1=\"120\" x2=\"281\" y2=\"111\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"287\" y1=\"120\" x2=\"287\" y2=\"107\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"293\" y1=\"120\" x2=\"293\" y2=\"110\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"298\" y1=\"120\" x2=\"298\" y2=\"112\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"304\" y1=\"120\" x2=\"304\" y2=\"111\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"310\" y1=\"120\" x2=\"310\" y2=\"112\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"316\" y1=\"120\" x2=\"316\" y2=\"114\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"322\" y1=\"120\" x2=\"322\" y2=\"111\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"327\" y1=\"120\" x2=\"327\" y2=\"113\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"333\" y1=\"120\" x2=\"333\" y2=\"116\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"339\" y1=\"120\" x2=\"339\" y2=\"114\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"345\" y1=\"120\" x2=\"345\" y2=\"115\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"351\" y1=\"120\" x2=\"351\" y2=\"114\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"356\" y1=\"120\" x2=\"356\" y2=\"115\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"362\" y1=\"120\" x2=\"362\" y2=\"117\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"368\" y1=\"120\" x2=\"368\" y2=\"116\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"374\" y1=\"120\" x2=\"374\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"380\" y1=\"120\" x2=\"380\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"385\" y1=\"120\" x2=\"385\" y2=\"117\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"391\" y1=\"120\" x2=\"391\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"397\" y1=\"120\" x2=\"397\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"403\" y1=\"120\" x2=\"403\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"409\" y1=\"120\" x2=\"409\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"414\" y1=\"120\" x2=\"414\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"420\" y1=\"120\" x2=\"420\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"426\" y1=\"120\" x2=\"426\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"432\" y1=\"120\" x2=\"432\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"438\" y1=\"120\" x2=\"438\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"443\" y1=\"120\" x2=\"443\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"449\" y1=\"120\" x2=\"449\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"455\" y1=\"120\" x2=\"455\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"461\" y1=\"120\" x2=\"461\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"467\" y1=\"120\" x2=\"467\" y2=\"118\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"472\" y1=\"120\" x2=\"472\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><line x1=\"478\" y1=\"120\" x2=\"478\" y2=\"119\" stroke=\"#B45309\" stroke-width=\"2\"/><text x=\"265\" y=\"144\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">thousands of tiny echoes, fading \u2014 a room&#8217;s impulse response</text></svg>", "cho": "<svg class=\"mathfig\" viewBox=\"0 0 520 116\" role=\"img\" aria-label=\"A dry wave and a slightly wobbling delayed copy drifting in and out of step\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M40.0,54.0 L42.0,51.1 L44.0,48.2 L46.0,45.4 L48.0,42.8 L50.0,40.2 L52.0,37.9 L54.0,35.7 L56.0,33.7 L58.0,32.0 L60.0,30.6 L62.0,29.5 L64.0,28.7 L66.0,28.2 L68.0,28.0 L70.0,28.1 L72.0,28.6 L74.0,29.4 L76.0,30.5 L78.0,31.9 L80.0,33.5 L82.0,35.4 L84.0,37.6 L86.0,39.9 L88.0,42.4 L90.0,45.1 L92.0,47.9 L94.0,50.7 L96.0,53.6 L98.0,56.5 L100.0,59.4 L102.0,62.2 L104.0,64.9 L106.0,67.5 L108.0,69.9 L110.0,72.1 L112.0,74.0 L114.0,75.8 L116.0,77.2 L118.0,78.4 L120.0,79.2 L122.0,79.8 L124.0,80.0 L126.0,79.9 L128.0,79.5 L130.0,78.7 L132.0,77.7 L134.0,76.3 L136.0,74.7 L138.0,72.8 L140.0,70.7 L142.0,68.4 L144.0,65.9 L146.0,63.2 L148.0,60.5 L150.0,57.6 L152.0,54.7 L154.0,51.8 L156.0,48.9 L158.0,46.1 L160.0,43.4 L162.0,40.8 L164.0,38.4 L166.0,36.2 L168.0,34.2 L170.0,32.4 L172.0,31.0 L174.0,29.8 L176.0,28.9 L178.0,28.3 L180.0,28.0 L182.0,28.1 L184.0,28.5 L186.0,29.2 L188.0,30.2 L190.0,31.5 L192.0,33.1 L194.0,34.9 L196.0,37.0 L198.0,39.3 L200.0,41.8 L202.0,44.4 L204.0,47.2 L206.0,50.0 L208.0,52.9 L210.0,55.8 L212.0,58.7 L214.0,61.5 L216.0,64.2 L218.0,66.8 L220.0,69.3 L222.0,71.5 L224.0,73.6 L226.0,75.3 L228.0,76.9 L230.0,78.1 L232.0,79.0 L234.0,79.7 L236.0,80.0 L238.0,79.9 L240.0,79.6 L242.0,78.9 L244.0,78.0 L246.0,76.7 L248.0,75.1 L250.0,73.3 L252.0,71.3 L254.0,69.0 L256.0,66.5 L258.0,63.9 L260.0,61.2 L262.0,58.3 L264.0,55.5 L266.0,52.5 L268.0,49.7 L270.0,46.8 L272.0,44.1 L274.0,41.5 L276.0,39.0 L278.0,36.7 L280.0,34.7 L282.0,32.9 L284.0,31.3 L286.0,30.0 L288.0,29.1 L290.0,28.4 L292.0,28.1 L294.0,28.0 L296.0,28.3 L298.0,29.0 L300.0,29.9 L302.0,31.1 L304.0,32.7 L306.0,34.4 L308.0,36.5 L310.0,38.7 L312.0,41.2 L314.0,43.8 L316.0,46.5 L318.0,49.3 L320.0,52.2 L322.0,55.1 L324.0,58.0 L326.0,60.8 L328.0,63.6 L330.0,66.2 L332.0,68.7 L334.0,71.0 L336.0,73.1 L338.0,74.9 L340.0,76.5 L342.0,77.8 L344.0,78.8 L346.0,79.5 L348.0,79.9 L350.0,80.0 L352.0,79.7 L354.0,79.1 L356.0,78.2 L358.0,77.0 L360.0,75.6 L362.0,73.8 L364.0,71.8 L366.0,69.6 L368.0,67.2 L370.0,64.6 L372.0,61.9 L374.0,59.1 L376.0,56.2 L378.0,53.3 L380.0,50.4 L382.0,47.5 L384.0,44.8 L386.0,42.1 L388.0,39.6 L390.0,37.3 L392.0,35.2 L394.0,33.3 L396.0,31.7 L398.0,30.3 L400.0,29.3 L402.0,28.5 L404.0,28.1 L406.0,28.0 L408.0,28.2 L410.0,28.8 L412.0,29.6 L414.0,30.8 L416.0,32.2 L418.0,34.0 L420.0,35.9 L422.0,38.1 L424.0,40.5 L426.0,43.1 L428.0,45.8 L430.0,48.6 L432.0,51.5 L434.0,54.4 L436.0,57.3 L438.0,60.1 L440.0,62.9 L442.0,65.6 L444.0,68.1 L446.0,70.4 L448.0,72.6 L450.0,74.5 L452.0,76.1 L454.0,77.5 L456.0,78.6 L458.0,79.4 L460.0,79.9 L462.0,80.0 L464.0,79.8 L466.0,79.3 L468.0,78.5 L470.0,77.4 L472.0,76.0 L474.0,74.3 L476.0,72.3 L478.0,70.1 L480.0,67.8 L482.0,65.2 L484.0,62.6 L486.0,59.8 L488.0,56.9 L490.0,54.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"1.8\"/><path d=\"M40.0,65.2 L42.0,62.7 L44.0,60.0 L46.0,57.2 L48.0,54.5 L50.0,51.7 L52.0,48.9 L54.0,46.2 L56.0,43.6 L58.0,41.1 L60.0,38.7 L62.0,36.6 L64.0,34.6 L66.0,32.9 L68.0,31.4 L70.0,30.1 L72.0,29.2 L74.0,28.5 L76.0,28.1 L78.0,28.0 L80.0,28.2 L82.0,28.7 L84.0,29.5 L86.0,30.6 L88.0,32.0 L90.0,33.6 L92.0,35.5 L94.0,37.6 L96.0,39.8 L98.0,42.2 L100.0,44.8 L102.0,47.5 L104.0,50.2 L106.0,53.0 L108.0,55.9 L110.0,58.7 L112.0,61.4 L114.0,64.0 L116.0,66.6 L118.0,69.0 L120.0,71.2 L122.0,73.2 L124.0,75.0 L126.0,76.5 L128.0,77.8 L130.0,78.8 L132.0,79.5 L134.0,79.9 L136.0,80.0 L138.0,79.8 L140.0,79.3 L142.0,78.4 L144.0,77.3 L146.0,75.9 L148.0,74.2 L150.0,72.3 L152.0,70.2 L154.0,67.9 L156.0,65.4 L158.0,62.8 L160.0,60.0 L162.0,57.2 L164.0,54.4 L166.0,51.5 L168.0,48.7 L170.0,45.9 L172.0,43.2 L174.0,40.7 L176.0,38.3 L178.0,36.1 L180.0,34.1 L182.0,32.4 L184.0,30.9 L186.0,29.7 L188.0,28.9 L190.0,28.3 L192.0,28.0 L194.0,28.1 L196.0,28.5 L198.0,29.2 L200.0,30.2 L202.0,31.5 L204.0,33.1 L206.0,34.9 L208.0,37.0 L210.0,39.3 L212.0,41.8 L214.0,44.5 L216.0,47.2 L218.0,50.1 L220.0,53.0 L222.0,55.9 L224.0,58.8 L226.0,61.7 L228.0,64.4 L230.0,67.0 L232.0,69.5 L234.0,71.8 L236.0,73.8 L238.0,75.6 L240.0,77.1 L242.0,78.3 L244.0,79.2 L246.0,79.7 L248.0,80.0 L250.0,79.9 L252.0,79.5 L254.0,78.7 L256.0,77.6 L258.0,76.3 L260.0,74.6 L262.0,72.6 L264.0,70.4 L266.0,68.0 L268.0,65.5 L270.0,62.7 L272.0,59.9 L274.0,56.9 L276.0,53.9 L278.0,51.0 L280.0,48.0 L282.0,45.2 L284.0,42.4 L286.0,39.8 L288.0,37.4 L290.0,35.2 L292.0,33.3 L294.0,31.6 L296.0,30.3 L298.0,29.2 L300.0,28.5 L302.0,28.1 L304.0,28.0 L306.0,28.3 L308.0,29.0 L310.0,29.9 L312.0,31.2 L314.0,32.8 L316.0,34.7 L318.0,36.8 L320.0,39.2 L322.0,41.8 L324.0,44.5 L326.0,47.4 L328.0,50.3 L330.0,53.3 L332.0,56.3 L334.0,59.3 L336.0,62.2 L338.0,65.0 L340.0,67.7 L342.0,70.1 L344.0,72.4 L346.0,74.4 L348.0,76.1 L350.0,77.6 L352.0,78.7 L354.0,79.5 L356.0,79.9 L358.0,80.0 L360.0,79.7 L362.0,79.1 L364.0,78.2 L366.0,76.9 L368.0,75.3 L370.0,73.5 L372.0,71.4 L374.0,69.0 L376.0,66.4 L378.0,63.7 L380.0,60.9 L382.0,57.9 L384.0,54.9 L386.0,51.9 L388.0,48.9 L390.0,46.0 L392.0,43.2 L394.0,40.5 L396.0,38.0 L398.0,35.8 L400.0,33.8 L402.0,32.0 L404.0,30.6 L406.0,29.4 L408.0,28.6 L410.0,28.1 L412.0,28.0 L414.0,28.2 L416.0,28.8 L418.0,29.7 L420.0,30.9 L422.0,32.4 L424.0,34.2 L426.0,36.3 L428.0,38.6 L430.0,41.1 L432.0,43.8 L434.0,46.6 L436.0,49.5 L438.0,52.5 L440.0,55.5 L442.0,58.5 L444.0,61.4 L446.0,64.2 L448.0,66.8 L450.0,69.3 L452.0,71.6 L454.0,73.7 L456.0,75.5 L458.0,77.0 L460.0,78.3 L462.0,79.2 L464.0,79.7 L466.0,80.0 L468.0,79.9 L470.0,79.5 L472.0,78.7 L474.0,77.6 L476.0,76.3 L478.0,74.6 L480.0,72.7 L482.0,70.5 L484.0,68.1 L486.0,65.6 L488.0,62.9 L490.0,60.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1.8\" opacity=\"0.85\"/><text x=\"150\" y=\"104\" fill=\"#059669\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">dry</text><text x=\"300\" y=\"104\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">copy \u2014 delay slowly wobbling</text></svg>", "drv": "<svg class=\"mathfig\" viewBox=\"0 0 520 152\" role=\"img\" aria-label=\"Drive transfer curve: linear middle, flattened peaks\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"60\" y1=\"130\" x2=\"460\" y2=\"130\" stroke=\"#DFE4EB\"/><line x1=\"260\" y1=\"20\" x2=\"260\" y2=\"130\" stroke=\"#DFE4EB\"/><line x1=\"80\" y1=\"128\" x2=\"440\" y2=\"24\" stroke=\"#5B6572\" stroke-dasharray=\"5 4\" stroke-width=\"1.2\"/><path d=\"M80.0,128.0 L84.0,128.0 L88.0,127.9 L92.0,127.9 L96.0,127.8 L100.0,127.8 L104.0,127.7 L108.0,127.6 L112.0,127.5 L116.0,127.4 L120.0,127.3 L124.0,127.1 L128.0,127.0 L132.0,126.8 L136.0,126.6 L140.0,126.4 L144.0,126.1 L148.0,125.8 L152.0,125.5 L156.0,125.1 L160.0,124.7 L164.0,124.2 L168.0,123.6 L172.0,123.0 L176.0,122.3 L180.0,121.5 L184.0,120.6 L188.0,119.6 L192.0,118.4 L196.0,117.2 L200.0,115.8 L204.0,114.3 L208.0,112.6 L212.0,110.7 L216.0,108.7 L220.0,106.5 L224.0,104.1 L228.0,101.5 L232.0,98.8 L236.0,95.9 L240.0,92.8 L244.0,89.6 L248.0,86.3 L252.0,82.9 L256.0,79.5 L260.0,76.0 L264.0,72.5 L268.0,69.1 L272.0,65.7 L276.0,62.4 L280.0,59.2 L284.0,56.1 L288.0,53.2 L292.0,50.5 L296.0,47.9 L300.0,45.5 L304.0,43.3 L308.0,41.3 L312.0,39.4 L316.0,37.7 L320.0,36.2 L324.0,34.8 L328.0,33.6 L332.0,32.4 L336.0,31.4 L340.0,30.5 L344.0,29.7 L348.0,29.0 L352.0,28.4 L356.0,27.8 L360.0,27.3 L364.0,26.9 L368.0,26.5 L372.0,26.2 L376.0,25.9 L380.0,25.6 L384.0,25.4 L388.0,25.2 L392.0,25.0 L396.0,24.9 L400.0,24.7 L404.0,24.6 L408.0,24.5 L412.0,24.4 L416.0,24.3 L420.0,24.2 L424.0,24.2 L428.0,24.1 L432.0,24.1 L436.0,24.0 L440.0,24.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.4\"/><text x=\"430\" y=\"140\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">in \u2192</text><text x=\"250\" y=\"18\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"end\" font-family=\"system-ui\">out</text><text x=\"365\" y=\"44\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">peaks squash \u2014 new harmonics</text><text x=\"160\" y=\"120\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"middle\" font-family=\"system-ui\">dashed: no drive</text></svg>", "crush": "<svg class=\"mathfig\" viewBox=\"0 0 520 152\" role=\"img\" aria-label=\"Bitcrusher transfer: the straight line becomes a staircase\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"60\" y1=\"130\" x2=\"460\" y2=\"130\" stroke=\"#DFE4EB\"/><line x1=\"260\" y1=\"20\" x2=\"260\" y2=\"130\" stroke=\"#DFE4EB\"/><line x1=\"80\" y1=\"128\" x2=\"440\" y2=\"24\" stroke=\"#5B6572\" stroke-dasharray=\"5 4\" stroke-width=\"1.2\"/><path d=\"M80.0,128.0 L82.0,128.0 L84.0,128.0 L86.0,128.0 L88.0,128.0 L90.0,128.0 L92.0,128.0 L94.0,128.0 L96.0,128.0 L98.0,117.6 L100.0,117.6 L102.0,117.6 L104.0,117.6 L106.0,117.6 L108.0,117.6 L110.0,117.6 L112.0,117.6 L114.0,117.6 L116.0,117.6 L118.0,117.6 L120.0,117.6 L122.0,117.6 L124.0,117.6 L126.0,117.6 L128.0,117.6 L130.0,117.6 L132.0,117.6 L134.0,117.6 L136.0,107.2 L138.0,107.2 L140.0,107.2 L142.0,107.2 L144.0,107.2 L146.0,107.2 L148.0,107.2 L150.0,107.2 L152.0,107.2 L154.0,107.2 L156.0,107.2 L158.0,107.2 L160.0,107.2 L162.0,107.2 L164.0,107.2 L166.0,107.2 L168.0,107.2 L170.0,96.8 L172.0,96.8 L174.0,96.8 L176.0,96.8 L178.0,96.8 L180.0,96.8 L182.0,96.8 L184.0,96.8 L186.0,96.8 L188.0,96.8 L190.0,96.8 L192.0,96.8 L194.0,96.8 L196.0,96.8 L198.0,96.8 L200.0,96.8 L202.0,96.8 L204.0,96.8 L206.0,96.8 L208.0,86.4 L210.0,86.4 L212.0,86.4 L214.0,86.4 L216.0,86.4 L218.0,86.4 L220.0,86.4 L222.0,86.4 L224.0,86.4 L226.0,86.4 L228.0,86.4 L230.0,86.4 L232.0,86.4 L234.0,86.4 L236.0,86.4 L238.0,86.4 L240.0,86.4 L242.0,76.0 L244.0,76.0 L246.0,76.0 L248.0,76.0 L250.0,76.0 L252.0,76.0 L254.0,76.0 L256.0,76.0 L258.0,76.0 L260.0,76.0 L262.0,76.0 L264.0,76.0 L266.0,76.0 L268.0,76.0 L270.0,76.0 L272.0,76.0 L274.0,76.0 L276.0,76.0 L278.0,76.0 L280.0,65.6 L282.0,65.6 L284.0,65.6 L286.0,65.6 L288.0,65.6 L290.0,65.6 L292.0,65.6 L294.0,65.6 L296.0,65.6 L298.0,65.6 L300.0,65.6 L302.0,65.6 L304.0,65.6 L306.0,65.6 L308.0,65.6 L310.0,65.6 L312.0,65.6 L314.0,55.2 L316.0,55.2 L318.0,55.2 L320.0,55.2 L322.0,55.2 L324.0,55.2 L326.0,55.2 L328.0,55.2 L330.0,55.2 L332.0,55.2 L334.0,55.2 L336.0,55.2 L338.0,55.2 L340.0,55.2 L342.0,55.2 L344.0,55.2 L346.0,55.2 L348.0,55.2 L350.0,55.2 L352.0,44.8 L354.0,44.8 L356.0,44.8 L358.0,44.8 L360.0,44.8 L362.0,44.8 L364.0,44.8 L366.0,44.8 L368.0,44.8 L370.0,44.8 L372.0,44.8 L374.0,44.8 L376.0,44.8 L378.0,44.8 L380.0,44.8 L382.0,44.8 L384.0,44.8 L386.0,34.4 L388.0,34.4 L390.0,34.4 L392.0,34.4 L394.0,34.4 L396.0,34.4 L398.0,34.4 L400.0,34.4 L402.0,34.4 L404.0,34.4 L406.0,34.4 L408.0,34.4 L410.0,34.4 L412.0,34.4 L414.0,34.4 L416.0,34.4 L418.0,34.4 L420.0,34.4 L422.0,34.4 L424.0,24.0 L426.0,24.0 L428.0,24.0 L430.0,24.0 L432.0,24.0 L434.0,24.0 L436.0,24.0 L438.0,24.0 L440.0,24.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.2\"/><text x=\"430\" y=\"140\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">in \u2192</text><text x=\"390\" y=\"40\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">rounded to steps</text></svg>", "lfo": "<svg class=\"mathfig\" viewBox=\"0 0 520 112\" role=\"img\" aria-label=\"An LFO swings a parameter around its resting value\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"64\" x2=\"490\" y2=\"64\" stroke=\"#5B6572\" stroke-dasharray=\"5 4\"/><path d=\"M40.0,64.0 L42.0,62.1 L44.0,60.2 L46.0,58.3 L48.0,56.5 L50.0,54.6 L52.0,52.8 L54.0,51.0 L56.0,49.3 L58.0,47.6 L60.0,46.0 L62.0,44.4 L64.0,42.9 L66.0,41.4 L68.0,40.0 L70.0,38.7 L72.0,37.5 L74.0,36.4 L76.0,35.3 L78.0,34.3 L80.0,33.4 L82.0,32.7 L84.0,32.0 L86.0,31.4 L88.0,30.9 L90.0,30.5 L92.0,30.2 L94.0,30.1 L96.0,30.0 L98.0,30.0 L100.0,30.2 L102.0,30.4 L104.0,30.8 L106.0,31.3 L108.0,31.8 L110.0,32.5 L112.0,33.2 L114.0,34.1 L116.0,35.0 L118.0,36.1 L120.0,37.2 L122.0,38.4 L124.0,39.7 L126.0,41.1 L128.0,42.5 L130.0,44.0 L132.0,45.6 L134.0,47.2 L136.0,48.9 L138.0,50.6 L140.0,52.4 L142.0,54.2 L144.0,56.0 L146.0,57.9 L148.0,59.7 L150.0,61.6 L152.0,63.5 L154.0,65.4 L156.0,67.3 L158.0,69.2 L160.0,71.1 L162.0,72.9 L164.0,74.7 L166.0,76.5 L168.0,78.3 L170.0,80.0 L172.0,81.6 L174.0,83.2 L176.0,84.7 L178.0,86.2 L180.0,87.6 L182.0,88.9 L184.0,90.2 L186.0,91.4 L188.0,92.4 L190.0,93.4 L192.0,94.3 L194.0,95.2 L196.0,95.9 L198.0,96.5 L200.0,97.0 L202.0,97.4 L204.0,97.7 L206.0,97.9 L208.0,98.0 L210.0,98.0 L212.0,97.9 L214.0,97.6 L216.0,97.3 L218.0,96.9 L220.0,96.3 L222.0,95.7 L224.0,95.0 L226.0,94.1 L228.0,93.2 L230.0,92.2 L232.0,91.1 L234.0,89.9 L236.0,88.6 L238.0,87.3 L240.0,85.9 L242.0,84.4 L244.0,82.8 L246.0,81.2 L248.0,79.5 L250.0,77.8 L252.0,76.1 L254.0,74.3 L256.0,72.5 L258.0,70.6 L260.0,68.7 L262.0,66.8 L264.0,64.9 L266.0,63.1 L268.0,61.2 L270.0,59.3 L272.0,57.4 L274.0,55.5 L276.0,53.7 L278.0,51.9 L280.0,50.2 L282.0,48.5 L284.0,46.8 L286.0,45.2 L288.0,43.6 L290.0,42.1 L292.0,40.7 L294.0,39.4 L296.0,38.1 L298.0,36.9 L300.0,35.8 L302.0,34.8 L304.0,33.9 L306.0,33.0 L308.0,32.3 L310.0,31.7 L312.0,31.1 L314.0,30.7 L316.0,30.4 L318.0,30.1 L320.0,30.0 L322.0,30.0 L324.0,30.1 L326.0,30.3 L328.0,30.6 L330.0,31.0 L332.0,31.5 L334.0,32.1 L336.0,32.8 L338.0,33.7 L340.0,34.6 L342.0,35.6 L344.0,36.6 L346.0,37.8 L348.0,39.1 L350.0,40.4 L352.0,41.8 L354.0,43.3 L356.0,44.8 L358.0,46.4 L360.0,48.0 L362.0,49.7 L364.0,51.5 L366.0,53.3 L368.0,55.1 L370.0,56.9 L372.0,58.8 L374.0,60.7 L376.0,62.6 L378.0,64.5 L380.0,66.4 L382.0,68.3 L384.0,70.1 L386.0,72.0 L388.0,73.8 L390.0,75.6 L392.0,77.4 L394.0,79.1 L396.0,80.8 L398.0,82.4 L400.0,84.0 L402.0,85.5 L404.0,86.9 L406.0,88.3 L408.0,89.6 L410.0,90.8 L412.0,91.9 L414.0,93.0 L416.0,93.9 L418.0,94.8 L420.0,95.5 L422.0,96.2 L424.0,96.7 L426.0,97.2 L428.0,97.6 L430.0,97.8 L432.0,98.0 L434.0,98.0 L436.0,97.9 L438.0,97.8 L440.0,97.5 L442.0,97.1 L444.0,96.6 L446.0,96.0 L448.0,95.3 L450.0,94.6 L452.0,93.7 L454.0,92.7 L456.0,91.6 L458.0,90.5 L460.0,89.3 L462.0,88.0 L464.0,86.6 L466.0,85.1 L468.0,83.6 L470.0,82.0 L472.0,80.4 L474.0,78.7 L476.0,77.0 L478.0,75.2 L480.0,73.4 L482.0,71.5 L484.0,69.7 L486.0,67.8 L488.0,65.9 L490.0,64.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.2\"/><line x1=\"470\" y1=\"64\" x2=\"470\" y2=\"30\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"462\" y=\"40\" fill=\"#059669\" font-size=\"10\" text-anchor=\"end\" font-family=\"system-ui\">depth</text><text x=\"90\" y=\"26\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">the knob&#8217;s value over time</text><text x=\"70\" y=\"80\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"start\" font-family=\"system-ui\">resting value p&#8320;</text></svg>", "env": "<svg class=\"mathfig\" viewBox=\"0 0 520 160\" role=\"img\" aria-label=\"ADSR: rise, fall to sustain, hold, release\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"130\" x2=\"490\" y2=\"130\" stroke=\"#DFE4EB\"/><path d=\"M40,130 L120,30 L200,74 L340,74 L470,128\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.4\"/><text x=\"80\" y=\"150\" fill=\"#1C2431\" font-size=\"12\" text-anchor=\"middle\" font-family=\"system-ui\">A</text><text x=\"160\" y=\"150\" fill=\"#1C2431\" font-size=\"12\" text-anchor=\"middle\" font-family=\"system-ui\">D</text><text x=\"270\" y=\"150\" fill=\"#1C2431\" font-size=\"12\" text-anchor=\"middle\" font-family=\"system-ui\">S</text><text x=\"400\" y=\"150\" fill=\"#1C2431\" font-size=\"12\" text-anchor=\"middle\" font-family=\"system-ui\">R</text><line x1=\"340\" y1=\"130\" x2=\"340\" y2=\"74\" stroke=\"#DFE4EB\" stroke-dasharray=\"4 3\"/><text x=\"346\" y=\"66\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"start\" font-family=\"system-ui\">key released</text></svg>", "arp": "<svg class=\"mathfig\" viewBox=\"0 0 520 140\" role=\"img\" aria-label=\"Arpeggiator stepping through held notes in order\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"60\" y1=\"100\" x2=\"470\" y2=\"100\" stroke=\"#DFE4EB\"/><text x=\"48\" y=\"104\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"end\" font-family=\"system-ui\">C</text><line x1=\"60\" y1=\"64\" x2=\"470\" y2=\"64\" stroke=\"#DFE4EB\"/><text x=\"48\" y=\"68\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"end\" font-family=\"system-ui\">E</text><line x1=\"60\" y1=\"28\" x2=\"470\" y2=\"28\" stroke=\"#DFE4EB\"/><text x=\"48\" y=\"32\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"end\" font-family=\"system-ui\">G</text><circle cx=\"90\" cy=\"100\" r=\"9\" fill=\"#059669\"/><circle cx=\"154\" cy=\"64\" r=\"9\" fill=\"#B45309\"/><circle cx=\"218\" cy=\"28\" r=\"9\" fill=\"#059669\"/><circle cx=\"282\" cy=\"100\" r=\"9\" fill=\"#B45309\"/><circle cx=\"346\" cy=\"64\" r=\"9\" fill=\"#059669\"/><circle cx=\"410\" cy=\"28\" r=\"9\" fill=\"#B45309\"/><text x=\"265\" y=\"128\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">steps \u2192 (Up pattern; swing stretches every other step)</text></svg>", "det": "<svg class=\"mathfig\" viewBox=\"0 0 520 130\" role=\"img\" aria-label=\"Two slightly detuned tones drift past each other and their sum pulses \u2014 beating\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"86\" x2=\"250\" y2=\"86\" stroke=\"#DFE4EB\"/><line x1=\"130\" y1=\"86\" x2=\"130\" y2=\"32\" stroke=\"#059669\" stroke-width=\"4\"/><line x1=\"146\" y1=\"86\" x2=\"146\" y2=\"36\" stroke=\"#B45309\" stroke-width=\"4\"/><text x=\"138\" y=\"104\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">two pitches, cents apart</text><clipPath id=\"detClip\"><rect x=\"290\" y=\"14\" width=\"220\" height=\"44\"/></clipPath><path d=\"M290.0,34.0 L290.9,32.6 L291.8,31.2 L292.8,29.8 L293.7,28.6 L294.6,27.4 L295.5,26.4 L296.4,25.5 L297.3,24.9 L298.2,24.4 L299.2,24.1 L300.1,24.0 L301.0,24.1 L301.9,24.4 L302.8,25.0 L303.8,25.7 L304.7,26.6 L305.6,27.6 L306.5,28.8 L307.4,30.1 L308.3,31.4 L309.2,32.8 L310.2,34.3 L311.1,35.7 L312.0,37.1 L312.9,38.4 L313.8,39.7 L314.8,40.8 L315.7,41.8 L316.6,42.6 L317.5,43.2 L318.4,43.7 L319.3,43.9 L320.2,44.0 L321.2,43.8 L322.1,43.5 L323.0,42.9 L323.9,42.2 L324.8,41.3 L325.8,40.2 L326.7,39.0 L327.6,37.7 L328.5,36.3 L329.4,34.9 L330.3,33.5 L331.2,32.0 L332.2,30.7 L333.1,29.3 L334.0,28.1 L334.9,27.0 L335.8,26.1 L336.8,25.3 L337.7,24.7 L338.6,24.2 L339.5,24.0 L340.4,24.0 L341.3,24.2 L342.2,24.6 L343.2,25.2 L344.1,26.0 L345.0,26.9 L345.9,28.0 L346.8,29.2 L347.8,30.5 L348.7,31.9 L349.6,33.3 L350.5,34.8 L351.4,36.2 L352.3,37.6 L353.2,38.9 L354.2,40.1 L355.1,41.2 L356.0,42.1 L356.9,42.8 L357.8,43.4 L358.8,43.8 L359.7,44.0 L360.6,44.0 L361.5,43.7 L362.4,43.3 L363.3,42.7 L364.2,41.9 L365.2,40.9 L366.1,39.8 L367.0,38.5 L367.9,37.2 L368.8,35.8 L369.8,34.4 L370.7,33.0 L371.6,31.5 L372.5,30.2 L373.4,28.9 L374.3,27.7 L375.2,26.7 L376.2,25.8 L377.1,25.0 L378.0,24.5 L378.9,24.1 L379.8,24.0 L380.8,24.1 L381.7,24.3 L382.6,24.8 L383.5,25.5 L384.4,26.3 L385.3,27.3 L386.2,28.4 L387.2,29.7 L388.1,31.0 L389.0,32.4 L389.9,33.9 L390.8,35.3 L391.8,36.7 L392.7,38.1 L393.6,39.3 L394.5,40.5 L395.4,41.5 L396.3,42.4 L397.2,43.1 L398.2,43.6 L399.1,43.9 L400.0,44.0 L400.9,43.9 L401.8,43.6 L402.8,43.1 L403.7,42.4 L404.6,41.5 L405.5,40.5 L406.4,39.3 L407.3,38.1 L408.2,36.7 L409.2,35.3 L410.1,33.9 L411.0,32.4 L411.9,31.0 L412.8,29.7 L413.8,28.4 L414.7,27.3 L415.6,26.3 L416.5,25.5 L417.4,24.8 L418.3,24.3 L419.2,24.1 L420.2,24.0 L421.1,24.1 L422.0,24.5 L422.9,25.0 L423.8,25.8 L424.8,26.7 L425.7,27.7 L426.6,28.9 L427.5,30.2 L428.4,31.5 L429.3,33.0 L430.2,34.4 L431.2,35.8 L432.1,37.2 L433.0,38.5 L433.9,39.8 L434.8,40.9 L435.8,41.9 L436.7,42.7 L437.6,43.3 L438.5,43.7 L439.4,44.0 L440.3,44.0 L441.2,43.8 L442.2,43.4 L443.1,42.8 L444.0,42.1 L444.9,41.2 L445.8,40.1 L446.8,38.9 L447.7,37.6 L448.6,36.2 L449.5,34.8 L450.4,33.3 L451.3,31.9 L452.2,30.5 L453.2,29.2 L454.1,28.0 L455.0,26.9 L455.9,26.0 L456.8,25.2 L457.8,24.6 L458.7,24.2 L459.6,24.0 L460.5,24.0 L461.4,24.2 L462.3,24.7 L463.2,25.3 L464.2,26.1 L465.1,27.0 L466.0,28.1 L466.9,29.3 L467.8,30.7 L468.8,32.0 L469.7,33.5 L470.6,34.9 L471.5,36.3 L472.4,37.7 L473.3,39.0 L474.2,40.2 L475.2,41.3 L476.1,42.2 L477.0,42.9 L477.9,43.5 L478.8,43.8 L479.8,44.0 L480.7,43.9 L481.6,43.7 L482.5,43.2 L483.4,42.6 L484.3,41.8 L485.2,40.8 L486.2,39.7 L487.1,38.4 L488.0,37.1 L488.9,35.7 L489.8,34.3 L490.8,32.8 L491.7,31.4 L492.6,30.1 L493.5,28.8 L494.4,27.6 L495.3,26.6 L496.2,25.7 L497.2,25.0 L498.1,24.4 L499.0,24.1 L499.9,24.0 L500.8,24.1 L501.8,24.4 L502.7,24.9 L503.6,25.5 L504.5,26.4 L505.4,27.4 L506.3,28.6 L507.2,29.8 L508.2,31.2 L509.1,32.6 L510.0,34.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"1.8\" opacity=\"0.85\"/><g clip-path=\"url(#detClip)\"><path d=\"M250.0,34.0 L251.2,32.2 L252.3,30.5 L253.5,28.8 L254.6,27.4 L255.8,26.1 L256.9,25.1 L258.1,24.5 L259.2,24.1 L260.4,24.0 L261.5,24.3 L262.7,24.9 L263.8,25.8 L265.0,26.9 L266.2,28.3 L267.3,29.9 L268.5,31.6 L269.6,33.4 L270.8,35.2 L271.9,37.0 L273.1,38.6 L274.2,40.2 L275.4,41.5 L276.5,42.6 L277.7,43.4 L278.8,43.8 L280.0,44.0 L281.2,43.8 L282.3,43.4 L283.5,42.6 L284.6,41.5 L285.8,40.2 L286.9,38.6 L288.1,37.0 L289.2,35.2 L290.4,33.4 L291.5,31.6 L292.7,29.9 L293.8,28.3 L295.0,26.9 L296.2,25.8 L297.3,24.9 L298.5,24.3 L299.6,24.0 L300.8,24.1 L301.9,24.5 L303.1,25.1 L304.2,26.1 L305.4,27.4 L306.5,28.8 L307.7,30.5 L308.8,32.2 L310.0,34.0 L311.2,35.8 L312.3,37.5 L313.5,39.2 L314.6,40.6 L315.8,41.9 L316.9,42.9 L318.1,43.5 L319.2,43.9 L320.4,44.0 L321.5,43.7 L322.7,43.1 L323.8,42.2 L325.0,41.1 L326.2,39.7 L327.3,38.1 L328.5,36.4 L329.6,34.6 L330.8,32.8 L331.9,31.0 L333.1,29.4 L334.2,27.8 L335.4,26.5 L336.5,25.4 L337.7,24.6 L338.8,24.2 L340.0,24.0 L341.2,24.2 L342.3,24.6 L343.5,25.4 L344.6,26.5 L345.8,27.8 L346.9,29.4 L348.1,31.0 L349.2,32.8 L350.4,34.6 L351.5,36.4 L352.7,38.1 L353.8,39.7 L355.0,41.1 L356.2,42.2 L357.3,43.1 L358.5,43.7 L359.6,44.0 L360.8,43.9 L361.9,43.5 L363.1,42.9 L364.2,41.9 L365.4,40.6 L366.5,39.2 L367.7,37.5 L368.8,35.8 L370.0,34.0 L371.2,32.2 L372.3,30.5 L373.5,28.8 L374.6,27.4 L375.8,26.1 L376.9,25.1 L378.1,24.5 L379.2,24.1 L380.4,24.0 L381.5,24.3 L382.7,24.9 L383.8,25.8 L385.0,26.9 L386.2,28.3 L387.3,29.9 L388.5,31.6 L389.6,33.4 L390.8,35.2 L391.9,37.0 L393.1,38.6 L394.2,40.2 L395.4,41.5 L396.5,42.6 L397.7,43.4 L398.8,43.8 L400.0,44.0 L401.2,43.8 L402.3,43.4 L403.5,42.6 L404.6,41.5 L405.8,40.2 L406.9,38.6 L408.1,37.0 L409.2,35.2 L410.4,33.4 L411.5,31.6 L412.7,29.9 L413.8,28.3 L415.0,26.9 L416.2,25.8 L417.3,24.9 L418.5,24.3 L419.6,24.0 L420.8,24.1 L421.9,24.5 L423.1,25.1 L424.2,26.1 L425.4,27.4 L426.5,28.8 L427.7,30.5 L428.8,32.2 L430.0,34.0 L431.2,35.8 L432.3,37.5 L433.5,39.2 L434.6,40.6 L435.8,41.9 L436.9,42.9 L438.1,43.5 L439.2,43.9 L440.4,44.0 L441.5,43.7 L442.7,43.1 L443.8,42.2 L445.0,41.1 L446.2,39.7 L447.3,38.1 L448.5,36.4 L449.6,34.6 L450.8,32.8 L451.9,31.0 L453.1,29.4 L454.2,27.8 L455.4,26.5 L456.5,25.4 L457.7,24.6 L458.8,24.2 L460.0,24.0 L461.2,24.2 L462.3,24.6 L463.5,25.4 L464.6,26.5 L465.8,27.8 L466.9,29.4 L468.1,31.0 L469.2,32.8 L470.4,34.6 L471.5,36.4 L472.7,38.1 L473.8,39.7 L475.0,41.1 L476.2,42.2 L477.3,43.1 L478.5,43.7 L479.6,44.0 L480.8,43.9 L481.9,43.5 L483.1,42.9 L484.2,41.9 L485.4,40.6 L486.5,39.2 L487.7,37.5 L488.8,35.8 L490.0,34.0 L491.2,32.2 L492.3,30.5 L493.5,28.8 L494.6,27.4 L495.8,26.1 L496.9,25.1 L498.1,24.5 L499.2,24.1 L500.4,24.0 L501.5,24.3 L502.7,24.9 L503.8,25.8 L505.0,26.9 L506.2,28.3 L507.3,29.9 L508.5,31.6 L509.6,33.4 L510.8,35.2 L511.9,37.0 L513.1,38.6 L514.2,40.2 L515.4,41.5 L516.5,42.6 L517.7,43.4 L518.8,43.8 L520.0,44.0 L521.2,43.8 L522.3,43.4 L523.5,42.6 L524.6,41.5 L525.8,40.2 L526.9,38.6 L528.1,37.0 L529.2,35.2 L530.4,33.4 L531.5,31.6 L532.7,29.9 L533.8,28.3 L535.0,26.9 L536.2,25.8 L537.3,24.9 L538.5,24.3 L539.6,24.0 L540.8,24.1 L541.9,24.5 L543.1,25.1 L544.2,26.1 L545.4,27.4 L546.5,28.8 L547.7,30.5 L548.8,32.2 L550.0,34.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1.8\" opacity=\"0.85\"><animateTransform attributeName=\"transform\" type=\"translate\" from=\"0 0\" to=\"40.0 0\" dur=\"5s\" repeatCount=\"indefinite\"/></path></g><text x=\"400\" y=\"70\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"middle\" font-family=\"system-ui\">the amber one is a touch slower \u2014 watch it drift</text><path d=\"M290.0,96.0 L290.9,93.5 L291.8,91.1 L292.8,88.7 L293.7,86.6 L294.6,84.7 L295.5,83.1 L296.4,81.8 L297.3,80.9 L298.2,80.3 L299.2,80.1 L300.1,80.4 L301.0,81.0 L301.9,81.9 L302.8,83.3 L303.8,84.9 L304.7,86.8 L305.6,88.9 L306.5,91.2 L307.4,93.6 L308.3,96.0 L309.2,98.4 L310.2,100.7 L311.1,102.9 L312.0,104.9 L312.9,106.7 L313.8,108.2 L314.8,109.4 L315.7,110.2 L316.6,110.7 L317.5,110.8 L318.4,110.5 L319.3,109.9 L320.2,108.9 L321.2,107.7 L322.1,106.1 L323.0,104.4 L323.9,102.4 L324.8,100.3 L325.8,98.2 L326.7,96.0 L327.6,93.8 L328.5,91.8 L329.4,89.9 L330.3,88.1 L331.2,86.6 L332.2,85.3 L333.1,84.4 L334.0,83.7 L334.9,83.3 L335.8,83.3 L336.8,83.6 L337.7,84.2 L338.6,85.0 L339.5,86.2 L340.4,87.5 L341.3,89.0 L342.2,90.7 L343.2,92.4 L344.1,94.2 L345.0,96.0 L345.9,97.7 L346.8,99.4 L347.8,100.9 L348.7,102.3 L349.6,103.5 L350.5,104.4 L351.4,105.1 L352.3,105.6 L353.2,105.8 L354.2,105.7 L355.1,105.5 L356.0,104.9 L356.9,104.2 L357.8,103.3 L358.8,102.3 L359.7,101.1 L360.6,99.9 L361.5,98.6 L362.4,97.3 L363.3,96.0 L364.2,94.8 L365.2,93.6 L366.1,92.6 L367.0,91.7 L367.9,91.0 L368.8,90.4 L369.8,90.0 L370.7,89.8 L371.6,89.8 L372.5,89.9 L373.4,90.1 L374.3,90.5 L375.2,91.1 L376.2,91.7 L377.1,92.4 L378.0,93.1 L378.9,93.8 L379.8,94.6 L380.8,95.3 L381.7,96.0 L382.6,96.6 L383.5,97.2 L384.4,97.6 L385.3,98.0 L386.2,98.2 L387.2,98.4 L388.1,98.4 L389.0,98.4 L389.9,98.3 L390.8,98.1 L391.8,97.9 L392.7,97.6 L393.6,97.3 L394.5,97.0 L395.4,96.7 L396.3,96.5 L397.2,96.3 L398.2,96.1 L399.1,96.0 L400.0,96.0 L400.9,96.0 L401.8,96.1 L402.8,96.3 L403.7,96.5 L404.6,96.7 L405.5,97.0 L406.4,97.3 L407.3,97.6 L408.2,97.9 L409.2,98.1 L410.1,98.3 L411.0,98.4 L411.9,98.4 L412.8,98.4 L413.8,98.2 L414.7,98.0 L415.6,97.6 L416.5,97.2 L417.4,96.6 L418.3,96.0 L419.2,95.3 L420.2,94.6 L421.1,93.8 L422.0,93.1 L422.9,92.4 L423.8,91.7 L424.8,91.1 L425.7,90.5 L426.6,90.1 L427.5,89.9 L428.4,89.8 L429.3,89.8 L430.2,90.0 L431.2,90.4 L432.1,91.0 L433.0,91.7 L433.9,92.6 L434.8,93.6 L435.8,94.8 L436.7,96.0 L437.6,97.3 L438.5,98.6 L439.4,99.9 L440.3,101.1 L441.2,102.3 L442.2,103.3 L443.1,104.2 L444.0,104.9 L444.9,105.5 L445.8,105.7 L446.8,105.8 L447.7,105.6 L448.6,105.1 L449.5,104.4 L450.4,103.5 L451.3,102.3 L452.2,100.9 L453.2,99.4 L454.1,97.7 L455.0,96.0 L455.9,94.2 L456.8,92.4 L457.8,90.7 L458.7,89.0 L459.6,87.5 L460.5,86.2 L461.4,85.0 L462.3,84.2 L463.2,83.6 L464.2,83.3 L465.1,83.3 L466.0,83.7 L466.9,84.4 L467.8,85.3 L468.8,86.6 L469.7,88.1 L470.6,89.9 L471.5,91.8 L472.4,93.8 L473.3,96.0 L474.2,98.2 L475.2,100.3 L476.1,102.4 L477.0,104.4 L477.9,106.1 L478.8,107.7 L479.8,108.9 L480.7,109.9 L481.6,110.5 L482.5,110.8 L483.4,110.7 L484.3,110.2 L485.2,109.4 L486.2,108.2 L487.1,106.7 L488.0,104.9 L488.9,102.9 L489.8,100.7 L490.8,98.4 L491.7,96.0 L492.6,93.6 L493.5,91.2 L494.4,88.9 L495.3,86.8 L496.2,84.9 L497.2,83.3 L498.1,81.9 L499.0,81.0 L499.9,80.4 L500.8,80.1 L501.8,80.3 L502.7,80.9 L503.6,81.8 L504.5,83.1 L505.4,84.7 L506.3,86.6 L507.2,88.7 L508.2,91.1 L509.1,93.5 L510.0,96.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2\"/><text x=\"400\" y=\"126\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">their sum swells and fades \u2014 beating</text></svg>", "clock": "<svg class=\"mathfig\" viewBox=\"0 0 520 140\" role=\"img\" aria-label=\"A clock gate: on for half the period, off for half\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"40\" y1=\"96\" x2=\"490\" y2=\"96\" stroke=\"#DFE4EB\"/><path d=\"M40,96 L40,40 L96,40 L96,96 L152,96 L152,40 L208,40 L208,96 L264,96 L264,40 L320,40 L320,96 L376,96 L376,40 L432,40 L432,96 L488,96 \" fill=\"none\" stroke=\"#059669\" stroke-width=\"2.2\"/><path d=\"M40,108 v7 h112 v-7\" fill=\"none\" stroke=\"#5B6572\" stroke-width=\"1.2\"/><text x=\"96\" y=\"130\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">one period = 1/rate</text><text x=\"68\" y=\"32\" fill=\"#5B6572\" font-size=\"10\" text-anchor=\"middle\" font-family=\"system-ui\">gate on</text></svg>", "out": "<svg class=\"mathfig\" viewBox=\"0 0 520 150\" role=\"img\" aria-label=\"Equal-power pan: left and right gain curves crossing at centre\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"60\" y1=\"120\" x2=\"460\" y2=\"120\" stroke=\"#DFE4EB\"/><path d=\"M60.0,28.0 L64.0,28.0 L68.0,28.0 L72.0,28.1 L76.0,28.2 L80.0,28.3 L84.0,28.4 L88.0,28.6 L92.0,28.7 L96.0,28.9 L100.0,29.1 L104.0,29.4 L108.0,29.6 L112.0,29.9 L116.0,30.2 L120.0,30.5 L124.0,30.9 L128.0,31.3 L132.0,31.7 L136.0,32.1 L140.0,32.5 L144.0,33.0 L148.0,33.4 L152.0,33.9 L156.0,34.5 L160.0,35.0 L164.0,35.6 L168.0,36.2 L172.0,36.8 L176.0,37.4 L180.0,38.0 L184.0,38.7 L188.0,39.4 L192.0,40.1 L196.0,40.8 L200.0,41.6 L204.0,42.3 L208.0,43.1 L212.0,43.9 L216.0,44.7 L220.0,45.6 L224.0,46.4 L228.0,47.3 L232.0,48.2 L236.0,49.1 L240.0,50.0 L244.0,51.0 L248.0,52.0 L252.0,52.9 L256.0,53.9 L260.0,54.9 L264.0,56.0 L268.0,57.0 L272.0,58.1 L276.0,59.2 L280.0,60.3 L284.0,61.4 L288.0,62.5 L292.0,63.6 L296.0,64.8 L300.0,65.9 L304.0,67.1 L308.0,68.3 L312.0,69.5 L316.0,70.7 L320.0,71.9 L324.0,73.2 L328.0,74.4 L332.0,75.7 L336.0,77.0 L340.0,78.2 L344.0,79.5 L348.0,80.8 L352.0,82.1 L356.0,83.5 L360.0,84.8 L364.0,86.1 L368.0,87.5 L372.0,88.8 L376.0,90.2 L380.0,91.6 L384.0,92.9 L388.0,94.3 L392.0,95.7 L396.0,97.1 L400.0,98.5 L404.0,99.9 L408.0,101.3 L412.0,102.8 L416.0,104.2 L420.0,105.6 L424.0,107.0 L428.0,108.5 L432.0,109.9 L436.0,111.3 L440.0,112.8 L444.0,114.2 L448.0,115.7 L452.0,117.1 L456.0,118.6 L460.0,120.0\" fill=\"none\" stroke=\"#059669\" stroke-width=\"2.2\"/><path d=\"M60.0,120.0 L64.0,118.6 L68.0,117.1 L72.0,115.7 L76.0,114.2 L80.0,112.8 L84.0,111.3 L88.0,109.9 L92.0,108.5 L96.0,107.0 L100.0,105.6 L104.0,104.2 L108.0,102.8 L112.0,101.3 L116.0,99.9 L120.0,98.5 L124.0,97.1 L128.0,95.7 L132.0,94.3 L136.0,92.9 L140.0,91.6 L144.0,90.2 L148.0,88.8 L152.0,87.5 L156.0,86.1 L160.0,84.8 L164.0,83.5 L168.0,82.1 L172.0,80.8 L176.0,79.5 L180.0,78.2 L184.0,77.0 L188.0,75.7 L192.0,74.4 L196.0,73.2 L200.0,71.9 L204.0,70.7 L208.0,69.5 L212.0,68.3 L216.0,67.1 L220.0,65.9 L224.0,64.8 L228.0,63.6 L232.0,62.5 L236.0,61.4 L240.0,60.3 L244.0,59.2 L248.0,58.1 L252.0,57.0 L256.0,56.0 L260.0,54.9 L264.0,53.9 L268.0,52.9 L272.0,52.0 L276.0,51.0 L280.0,50.0 L284.0,49.1 L288.0,48.2 L292.0,47.3 L296.0,46.4 L300.0,45.6 L304.0,44.7 L308.0,43.9 L312.0,43.1 L316.0,42.3 L320.0,41.6 L324.0,40.8 L328.0,40.1 L332.0,39.4 L336.0,38.7 L340.0,38.0 L344.0,37.4 L348.0,36.8 L352.0,36.2 L356.0,35.6 L360.0,35.0 L364.0,34.5 L368.0,33.9 L372.0,33.4 L376.0,33.0 L380.0,32.5 L384.0,32.1 L388.0,31.7 L392.0,31.3 L396.0,30.9 L400.0,30.5 L404.0,30.2 L408.0,29.9 L412.0,29.6 L416.0,29.4 L420.0,29.1 L424.0,28.9 L428.0,28.7 L432.0,28.6 L436.0,28.4 L440.0,28.3 L444.0,28.2 L448.0,28.1 L452.0,28.0 L456.0,28.0 L460.0,28.0\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.2\"/><text x=\"90\" y=\"40\" fill=\"#059669\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">left gain</text><text x=\"430\" y=\"40\" fill=\"#B45309\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">right gain</text><text x=\"260\" y=\"138\" fill=\"#5B6572\" font-size=\"11\" text-anchor=\"middle\" font-family=\"system-ui\">pan position: L \u2192 C \u2192 R (curves cross at equal power)</text></svg>"};
  /* per-module documentation: what / maths / the actual code. Shown by the ? button on each block. */
  const DOCS={
    vco:{title:'VCO — Voltage-Controlled Oscillator',
      what:'The sound source. It repeats a waveform shape at a set frequency; the shape decides the harmonic recipe (timbre), the frequency decides the pitch. PW reshapes the square wave, GL glides between pitches, OCT shifts by octaves, and the sub adds a sine one octave below.',
      math:'A sine oscillator is <em>y</em>(<em>t</em>) = <em>A</em>·sin(2π<em>f</em><em>t</em>). Every other waveform is a sum of sines (Fourier): a saw is Σ sin(2π<em>kft</em>)/<em>k</em> over all harmonics <em>k</em>; a square uses odd <em>k</em> only. A pulse at duty <em>d</em> has harmonic amplitudes 2·sin(π<em>k</em><em>d</em>)/(π<em>k</em>) — at <em>d</em> = 50% the even ones vanish and it becomes the square. One octave = doubling <em>f</em>; one cent = a 2^(1/1200) ratio. Reading it: Σ means add one sine per harmonic k = 1, 2, 3…; dividing by k makes higher harmonics quieter.',
      code:"const o = ctx.createOscillator();\no.type = 'sawtooth';        // or a custom PeriodicWave\no.frequency.value = 110;    // Hz\nconst g = ctx.createGain(); // output level stage\ng.gain.value = 0.4;\no.connect(g);\no.start();"},
    noise:{title:'Noise',
      what:'Random samples — all frequencies at once. White is equal energy per hertz; pink falls 3 dB per octave (equal energy per octave, like rain); brown falls 6 dB per octave (deep rumble). Noise is the raw material for wind, drums, and hiss.',
      math:'White: each sample is an independent random value. Pink: white passed through a −3 dB/oct filter (here a 3-pole Kellet approximation). Brown: a leaky integral of white — <em>y</em>[<em>n</em>] = (<em>y</em>[<em>n</em>−1] + 0.02·white)/1.02 — integration turns the flat spectrum into 1/<em>f</em>².',
      code:"const buf = ctx.createBuffer(1, 2*sr, sr);\nconst d = buf.getChannelData(0);\nfor (let i = 0; i < d.length; i++)\n  d[i] = Math.random()*2 - 1;   // white\nconst src = ctx.createBufferSource();\nsrc.buffer = buf; src.loop = true; src.start();"},
    vcf:{title:'VCF — Voltage-Controlled Filter',
      what:'Sculpts tone by cutting frequencies. Low-pass keeps the lows, high-pass the highs, band-pass a slice, notch removes a slice. The Ladder cascades two stages for the steep 24 dB/oct Moog rolloff; Acid adds soft-clip drive before a hot-resonance cascade (TB-303). KT makes the cutoff follow the played note; RES boosts frequencies at the cutoff.',
      math:'A biquad filter obeys <em>y</em>[<em>n</em>] = <em>b</em>₀<em>x</em>[<em>n</em>] + <em>b</em>₁<em>x</em>[<em>n</em>−1] + <em>b</em>₂<em>x</em>[<em>n</em>−2] − <em>a</em>₁<em>y</em>[<em>n</em>−1] − <em>a</em>₂<em>y</em>[<em>n</em>−2] — each output sample mixes recent inputs and its own recent outputs. One biquad rolls off at 12 dB/oct; two in series give 24. Resonance is the quality factor <em>Q</em>: peak gain at the cutoff ≈ <em>Q</em>. Key tracking scales cutoff by (<em>f</em><sub>note</sub>/261.6)^KT. Reading it: square brackets index samples — y[n−1] is simply the previous output; the b and a letters are fixed mix amounts derived from cutoff and Q.',
      code:"const f = ctx.createBiquadFilter();\nf.type = 'lowpass';\nf.frequency.value = 1600;  // cutoff Hz\nf.Q.value = 8;             // resonance\n// 24 dB ladder: two in series\n// f1.connect(f2)"},
    vca:{title:'VCA — Voltage-Controlled Amplifier',
      what:'A volume control another signal can drive. On its own it is a level knob; with an Envelope or LFO plugged in it becomes the thing that turns a drone into notes (envelope) or adds tremolo (LFO).',
      math:'Just multiplication: <em>y</em>[<em>n</em>] = <em>g</em>·<em>x</em>[<em>n</em>]. All amplitude shaping in synthesis — envelopes, tremolo, gating — is multiplying the signal by a slowly-changing number.',
      code:"const g = ctx.createGain();\ng.gain.value = 0.3;\n// modulation: another node can drive the gain\nlfo.connect(g.gain);"},
    mix:{title:'Mixer',
      what:'Sums several signals into one, with a level knob. In Web Audio any input adds, so a mixer is a gain stage used as a junction — the block exists to make the routing readable.',
      math:'Addition: <em>y</em>[<em>n</em>] = <em>g</em>·(<em>x</em>₁[<em>n</em>] + <em>x</em>₂[<em>n</em>] + …). Summing equal signals grows peaks linearly — the limiter downstream is why stacking voices here stays safe.',
      code:"const m = ctx.createGain();\nm.gain.value = 0.8;\noscA.connect(m); oscB.connect(m); // inputs sum"},
    del:{title:'Delay',
      what:'An echo: the signal replayed T milliseconds later, fed partly back into itself for repeating echoes. Short modulated delays are how chorus and flangers work — this block plus an LFO is a flanger.',
      math:'<em>y</em>[<em>n</em>] = <em>x</em>[<em>n</em>] + <em>w</em>·<em>x</em>[<em>n</em>−<em>D</em>] with feedback <em>y</em> looped into the buffer scaled by FB. Echoes decay geometrically: after <em>k</em> passes the level is FB^<em>k</em>.',
      code:"const dl = ctx.createDelay(1);\ndl.delayTime.value = 0.28;\nconst fb = ctx.createGain();\nfb.gain.value = 0.45;\ndl.connect(fb); fb.connect(dl); // feedback loop"},
    rev:{title:'Reverb',
      what:'The sound of a space: thousands of overlapping echoes decaying together. Implemented by convolving the signal with an impulse response — a recording (here: a synthesised one) of how the space answers a single click.',
      math:'Convolution: <em>y</em>[<em>n</em>] = Σ<sub><em>k</em></sub> <em>x</em>[<em>k</em>]·<em>h</em>[<em>n</em>−<em>k</em>] — every input sample launches a copy of the impulse response <em>h</em>, all summed. Our <em>h</em> is noise shaped by (1−<em>t</em>/<em>T</em>)^2.5, an exponential-ish decay. Reading it: Σ over k adds one scaled, shifted copy of the impulse h per input sample — convolution means every sample launches its own echo pattern.',
      code:"const cv = ctx.createConvolver();\ncv.buffer = impulse;  // noise * decay curve\ninp.connect(cv);      // wet path\ncv.connect(wet); inp.connect(sum); // + dry"},
    cho:{title:'Chorus',
      what:'A short delay (about 20 ms) whose time is gently wobbled by an internal LFO, mixed with the dry signal. The moving delay detunes the copy slightly, which sounds like several players almost together.',
      math:'A delay changing at rate <em>r</em> shifts pitch by the Doppler ratio 1 − d<em>D</em>/d<em>t</em>. Small periodic delay change ⇒ periodic slight detune ⇒ beating between dry and wet at a few hertz.',
      code:"const dl = ctx.createDelay(0.1);\ndl.delayTime.value = 0.02;\nlfo.connect(lfoGain).connect(dl.delayTime);\ninp.connect(sum); inp.connect(dl);\ndl.connect(wet).connect(sum);"},
    drv:{title:'Drive',
      what:'Soft-clips the waveform: quiet parts pass, loud peaks squash. Squashing bends the wave shape, which adds harmonics — that is distortion. More drive, more bend, more harmonics.',
      math:'Waveshaping: <em>y</em> = tanh(<em>k</em><em>x</em>)/tanh(<em>k</em>). tanh is linear near 0 and flattens at ±1; a sine in becomes a progressively squarer wave out, and a squarer wave means more odd harmonics.',
      code:"const ws = ctx.createWaveShaper();\nconst c = new Float32Array(512);\nfor (let i = 0; i < 512; i++) {\n  const x = i/255.5 - 1;\n  c[i] = Math.tanh(k*x)/Math.tanh(k);\n}\nws.curve = c;"},
    crush:{title:'Crusher',
      what:'Bit-depth reduction: rounds every sample to a small set of levels, like early samplers and game consoles. The rounding error is heard as gritty noise glued to the signal.',
      math:'Quantisation: <em>y</em> = round(<em>x</em>·<em>L</em>)/<em>L</em> with <em>L</em> = 2^bits/2 levels. Each bit of depth buys about 6 dB of signal-to-noise: 8 bits ≈ 48 dB, 16 bits (CD) ≈ 96 dB.',
      code:"const ws = ctx.createWaveShaper();\n// staircase curve: round to 2^bits levels\nc[i] = Math.round(x*L)/L;"},
    lfo:{title:'LFO — Low-Frequency Oscillator',
      what:'An oscillator too slow to hear, used to turn knobs automatically. Into an Osc: vibrato (or PWM on a square). Into a Filter: wah/wobble. Into an Amp: tremolo. Into a Delay: flanging.',
      math:'The target parameter becomes <em>p</em>(<em>t</em>) = <em>p</em>₀ + <em>d</em>·sin(2π<em>rt</em>). Filter wobble here is applied in cents (±1200 = one octave) so the cutoff scales multiplicatively and can never go below zero. Reading it: p₀ is the knob&rsquo;s resting value (subscript zero = starting point), d the swing, r the wobble rate.',
      code:"const lfo = ctx.createOscillator();\nlfo.frequency.value = 4;   // Hz, subsonic\nconst depth = ctx.createGain();\ndepth.gain.value = 1200;   // modulation amount\nlfo.connect(depth).connect(filter.detune);"},
    env:{title:'EG — Envelope Generator',
      what:'Shapes a value over time when triggered: rise (Attack), fall (Decay) to a held level (Sustain), fade on release (Release). Into an Amp or Osc it shapes loudness into notes; into a Filter it sweeps brightness per note.',
      math:'Attack is a linear ramp over <em>t</em><sub>A</sub>. Decay and Release are exponentials — setTargetAtTime approaches the target like e^(−<em>t</em>/τ), reaching ~95% after 3τ, which is why the code uses D/3 and R/3 as time constants. Exponential decay is how real vibrating things lose energy. Reading it: e ≈ 2.718; e^(−t/τ) is the fraction remaining after time t, where τ (tau) is the time constant — 63% gone at τ, 95% by 3τ.',
      code:"p.cancelScheduledValues(t);\np.setValueAtTime(p.value, t);\np.linearRampToValueAtTime(max, t + A);      // attack\np.setTargetAtTime(sustain, t + A, D/3);     // decay\n// on release:\np.setTargetAtTime(min, t, R/3);"},
    midi:{title:'MIDI In',
      what:'Listens to a hardware MIDI keyboard (Chrome/Edge). Note-ons set wired Oscs\u2019 pitch (round-robin across several = polyphony) and gate wired Envelopes; pick a channel or All.',
      math:'MIDI note <em>n</em> to frequency: <em>f</em> = 440·2^((<em>n</em>−69)/12) — twelve equal steps per octave, note 69 = A440.',
      code:"navigator.requestMIDIAccess().then(m => {\n  input.onmidimessage = e => {\n    const [status, note, vel] = e.data;\n    const f = 440 * 2**((note-69)/12);\n  };\n});"},
    keys:{title:'Keys',
      what:'A note source needing no hardware: eight on-screen keys (C3–C4) that also listen to your computer keyboard, A to K. Emits the same note events as MIDI In, so everything downstream behaves identically.',
      math:'Same mapping as MIDI: <em>f</em> = 440·2^((<em>n</em>−69)/12).',
      code:"document.addEventListener('keydown', e => {\n  const note = {KeyA:48, KeyS:50, /*…*/}[e.code];\n  if (note !== undefined) noteOn(note);\n});"},
    clock:{title:'Clock',
      what:'Fires a gate on/off cycle at a set rate all by itself — the metronome of a self-running patch. Into an Envelope: rhythmic pulsing. Into an Arp: a sequence that plays with nobody touching anything.',
      math:'Period <em>T</em> = 1/<em>rate</em>; the gate holds for half of each period (50% duty).',
      code:"setInterval(() => {\n  noteOn(48);\n  setTimeout(() => noteOff(48), 500/rate);\n}, 1000/rate);"},
    arp:{title:'Arp — Arpeggiator',
      what:'Holds the notes fed into it and replays them one at a time at its own rate — up, down, ping-pong or random — turning a held chord into a rhythmic line. SW adds swing: long-short step pairs.',
      math:'Step <em>k</em> of an up pattern plays note <em>k</em> mod <em>N</em> of the sorted held set. Swing at ratio <em>s</em> makes step pairs last 2<em>T</em>·<em>s</em> and 2<em>T</em>·(1−<em>s</em>) — 66% is the triplet shuffle.',
      code:"const step = () => {\n  play(held[i++ % held.length]);\n  const dur = pair * (i%2 ? sw : 1-sw);\n  setTimeout(step, dur);   // self-scheduling\n};"},
    latch:{title:'Latch',
      what:'Notes stay held after you lift the key; press the same key again to release it. Feeds the Arp beautifully: tap a chord, and it keeps arpeggiating hands-free.',math:'',
      code:"if (held.has(note)) { held.delete(note); noteOff(note); }\nelse { held.add(note); noteOn(note); }"},
    det:{title:'Detune',
      what:'Shifts a wired Osc by cents (hundredths of a semitone). Two oscillators a few cents apart drift in and out of phase — the classic fat unison shimmer.',
      math:'Frequency ratio for <em>c</em> cents: 2^(<em>c</em>/1200). Two oscillators <em>f</em> and <em>f</em>+Δ beat at Δ Hz — 7 cents on 110 Hz beats about twice per couple of seconds.',
      code:"osc2.frequency.value = f * 2**(cents/1200);"},
    sync:{title:'Sync',
      what:'Pitch lock: wire a leader Osc into Sync and Sync into followers, and the followers copy the leader\u2019s pitch through slider moves and played notes. Combine with Detune for locked-but-fat stacks.',math:'',
      code:"onPitchChange(leader, f => {\n  followers.forEach(o => o.frequency.value = f);\n});"},
    code:{title:'Code — write your own module',
      what:'A blank module: you write the DSP. Your code runs inside an AudioWorklet — the real-time audio thread — once per 128-sample chunk, filling the output array sample by sample. Start from a template (oscillator, filter, bitcrush, ring mod), break it, fix it: this is exactly how every other block works underneath.',
      math:'Everything in this bench reduces to this loop: for each sample, compute a number between −1 and 1. An oscillator advances a phase by 2π<em>f</em>/<em>sampleRate</em> per sample; a one-pole filter eases toward its input, <em>y</em> += <em>a</em>(<em>x</em>−<em>y</em>); an effect is any function of current and past samples.',
      code:"// the contract your code fulfils:\nprocess(input, output, state) {\n  for (let i = 0; i < output.length; i++) {\n    output[i] = /* your DSP here */;\n  }\n}"},
    out:{title:'Output',
      what:'The speaker socket. Vol sets the patch\u2019s master level and Pan places it in the stereo field; a limiter sits after it so no patch can clip or blast headphones. Nothing sounds until a path reaches here.',
      math:'Equal-power panning at position <em>p</em> ∈ [−1,1]: gains cos((<em>p</em>+1)π/4) and sin((<em>p</em>+1)π/4) — total acoustic power stays constant across the sweep.',
      code:"master.connect(panner).connect(limiter)\n      .connect(ctx.destination);"}
  };

  let blocks=[],wires=[],nid=0,running=false,live=null,armed=null;
  let midiStatus=navigator.requestMIDIAccess?'not connected yet':'no Web MIDI in this browser';
  const heldNotes=new Map();            // note-emitter id -> Set of held note numbers
  const noteAssign=new Map();           // note-emitter id -> {map: note->vcoId, rr: round-robin counter}
  const procState=new Map();            // arp/latch id -> {notes:[],idx,timer,latched:Set}

  function addBlock(type,x,y){
    const d=DEFS[type];
    const b={id:'b'+(++nid),type,x,y,vals:d.params.map(p=>p.val)};
    if(d.chan)b.chan='all';
    (d.sels||[]).forEach(sn=>{b[SELS[sn].key]=SELS[sn].def});
    if(d.codeblk){b.code=DEFAULT_CODE;ensureWorklet()}
    blocks.push(b);
    if(type==='midi')initMidi();
    render();
  }
  function removeBlock(id){
    blocks=blocks.filter(b=>b.id!==id);
    wires=wires.filter(w=>w.from!==id&&w.to!==id);
    if(armed===id)armed=null;
    render();rebuild();
  }

  /* focus survives a render() rebuild: remember block id + control index, restore after */
  const FOCUSABLE='h4,input,select,button';
  function focusKey(){
    const a=document.activeElement,blk=a&&a.closest?a.closest('.blk'):null;
    if(!blk)return null;
    return {id:blk.dataset.id,i:[...blk.querySelectorAll(FOCUSABLE)].indexOf(a)};
  }
  function restoreFocus(k){
    if(!k||k.i<0)return;
    const blk=world.querySelector('.blk[data-id="'+k.id+'"]');
    const el=blk&&[...blk.querySelectorAll(FOCUSABLE)][k.i];
    if(el)el.focus();
  }

  /* out-port arming (click-to-click wiring), shared by the pointer and keyboard paths */
  function setArmed(id){
    armed=id;
    [...patch.querySelectorAll('.port.out')].forEach(p=>{
      const on=p.closest('.blk').dataset.id===armed;
      p.classList.toggle('armed',on);p.setAttribute('aria-pressed',on?'true':'false');
    });
  }

  function render(){
    const fk=focusKey();
    [...world.querySelectorAll('.blk')].forEach(e=>e.remove());
    blocks.forEach(b=>{
      const d=DEFS[b.type];
      const el=document.createElement('div');
      el.className='blk';el.dataset.id=b.id;
      el.style.left=b.x+'px';el.style.top=b.y+'px';
      let h='<h4 tabindex="0" role="button" aria-label="'+d.name+' block, arrow keys move it, hold Shift for fine steps">'+d.name+'</h4>';
      if(DOCS[b.type])h+='<button class="doc" aria-label="about this module">?</button>';
      if(b.type!=='out')h+='<button class="x" aria-label="delete module">✕</button>';
      (d.sels||[]).forEach(sn=>{
        const sd=SELS[sn];
        h+='<select data-sel="'+sn+'" aria-label="'+sd.label+'">';
        sd.opts.forEach(([v,n])=>{h+='<option value="'+v+'"'+(b[sd.key]===v?' selected':'')+'>'+n+'</option>'});
        h+='</select>';
      });
      d.params.forEach((p,i)=>{
        const sv=Math.min(p.smax||p.max,Math.max(p.smin||p.min,b.vals[i]));
        const hide=p.onlyWave&&b.wave!==p.onlyWave?' style="display:none"':'';   // controls only shown for the wave that supports them
        h+='<input type="range" data-pi="'+i+'"'+hide+' min="'+(p.smin||p.min)+'" max="'+(p.smax||p.max)+'" step="'+p.step+'" value="'+sv+'" aria-label="'+d.name+' '+(p.lab||'control')+'">';
        h+=p.edit
          ?'<input class="num" data-pi="'+i+'"'+hide+' type="number" min="'+p.min+'" max="'+p.max+'" step="'+p.step+'" value="'+b.vals[i]+'" aria-label="'+d.name+' value">'
          :'<small data-pi="'+i+'"'+hide+'>'+p.fmt(b.vals[i])+'</small>';
      });
      if(d.chan){
        h+='<select aria-label="MIDI channel"><option value="all">All channels</option>';
        for(let ch=1;ch<=16;ch++)h+='<option value="'+ch+'"'+(String(b.chan)===String(ch)?' selected':'')+'>Ch '+ch+'</option>';
        h+='</select><small class="mst">'+midiStatus+'</small>';
      }
      if(d.sub)h+='<button class="subtog" aria-pressed="'+(b.sub?'true':'false')+'">Sub osc '+(b.sub?'on':'off')+'</button>';
      if(d.keys){
        h+='<div class="mkeys">';
        [['A',48],['S',50],['D',52],['F',53],['G',55],['H',57],['J',59],['K',60]].forEach(([l,n])=>{
          h+='<button data-n="'+n+'" aria-label="note '+l+'">'+l+'</button>';
        });
        h+='</div>';
      }
      if(d.trig)h+='<button class="trig">Trig (hold)</button>';
      if(d.codeblk)h+='<button class="trig codeedit">Edit code</button><small class="codestat">'+(b.code?'ready':'')+'</small>';
      el.innerHTML=h;
      if(d.hasIn)el.insertAdjacentHTML('beforeend','<button class="port in" aria-label="'+d.name+' input port"></button>');
      if(d.hasOut)el.insertAdjacentHTML('beforeend','<button class="port out'+(armed===b.id?' armed':'')+'" aria-pressed="'+(armed===b.id?'true':'false')+'" aria-label="'+d.name+' output port"></button>');
      world.appendChild(el);
      hook(el,b,d);
    });
    drawWires();
    restoreFocus(fk);
  }

  function hook(el,b,d){
    el.addEventListener('pointerdown',e=>{
      if(e.target.closest('input,select,button'))return;   // controls, ports, ✕, Trig: never start a drag
      e.preventDefault();e.stopPropagation();try{el.setPointerCapture(e.pointerId)}catch(x){}
      const w0=toWorld(e.clientX,e.clientY), ox=w0.x-b.x, oy=w0.y-b.y;
      const move=e2=>{
        const w=toWorld(e2.clientX,e2.clientY);
        b.x=w.x-ox;b.y=w.y-oy;
        el.style.left=b.x+'px';el.style.top=b.y+'px';drawWires();
      };
      const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up)};
      el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
    });
    const hd=el.querySelector('h4');   // keyboard equivalent of dragging the block by its header
    if(hd)hd.addEventListener('keydown',e=>{
      const dir={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
      if(!dir)return;
      e.preventDefault();
      const step=e.shiftKey?1:10;
      b.x+=dir[0]*step;b.y+=dir[1]*step;
      el.style.left=b.x+'px';el.style.top=b.y+'px';drawWires();
    });
    const x=el.querySelector('.x');
    if(x)x.addEventListener('click',()=>removeBlock(b.id));
    const dq=el.querySelector('.doc');
    if(dq)dq.addEventListener('click',()=>openDoc(b.type));
    el.querySelectorAll('input[type=range]').forEach(r=>{
      const i=+r.dataset.pi,p=d.params[i];
      r.addEventListener('input',()=>{
        b.vals[i]=+r.value;
        const num=el.querySelector('input.num[data-pi="'+i+'"]');
        if(num)num.value=b.vals[i];
        const sm=el.querySelector('small[data-pi="'+i+'"]');
        if(sm)sm.textContent=p.fmt(b.vals[i]);
        liveParam(b,i);liveControl(b);
      });
    });
    el.querySelectorAll('input.num').forEach(num=>{
      const i=+num.dataset.pi,p=d.params[i];
      num.addEventListener('change',()=>{
        const v=Math.min(p.max,Math.max(p.min,+num.value||p.val));
        b.vals[i]=v;num.value=v;
        const r=el.querySelector('input[type=range][data-pi="'+i+'"]');
        if(r)r.value=Math.min(+r.max,Math.max(+r.min,v));
        liveParam(b,i);
      });
    });
    const nc=el.querySelector('select.ncol');
    if(nc)nc.addEventListener('change',()=>{
      b.ncol=nc.value;
      if(live&&live.map[b.id]){                 // swap the running source for the new colour
        const n=live.map[b.id],c=ctx();
        const s=c.createBufferSource();s.buffer=noiseBuf(c,b.ncol);s.loop=true;
        s.connect(n.out);s.start();
        try{n.src.stop()}catch(x){}
        n.src=s;
      }
    });
    el.querySelectorAll('select[data-sel]').forEach(sd=>{
      const spec=SELS[sd.dataset.sel];
      sd.addEventListener('change',()=>{b[spec.key]=sd.value;if(spec.after)spec.after(b)});
    });
    const sel=el.querySelector('select:not([data-sel])');
    if(sel)sel.addEventListener('change',()=>{b.chan=sel.value});
    const ft=el.querySelector('select.ftype');
    if(ft)ft.addEventListener('change',()=>{
      b.ftype=ft.value;
      if(live&&live.map[b.id])live.map[b.id].inp.type=b.ftype;   // live update
    });
    const wv=el.querySelector('select.wave');
    if(wv)wv.addEventListener('change',()=>{
      b.wave=wv.value;
      if(live&&live.map[b.id])applyWave(b,live.map[b.id]);   // live update (square honours PW)
      render();                                              // re-render so wave-specific controls show/hide
    });
    const st2=el.querySelector('.subtog');
    if(st2)st2.addEventListener('click',()=>{
      b.sub=!b.sub;
      st2.setAttribute('aria-pressed',b.sub);st2.textContent='Sub osc '+(b.sub?'on':'off');
      if(live&&live.map[b.id]&&live.map[b.id].subGain)
        live.map[b.id].subGain.gain.setTargetAtTime(b.sub?0.35:0,ctx().currentTime,0.02);
    });
    el.querySelectorAll('.mkeys button').forEach(kb=>{
      const note=+kb.dataset.n;
      const on=e=>{e.preventDefault();kb.classList.add('down');noteEvent(b.id,true,note,0)};
      const off=()=>{kb.classList.remove('down');noteEvent(b.id,false,note,0)};
      kb.addEventListener('pointerdown',on);
      kb.addEventListener('pointerup',off);
      kb.addEventListener('pointerleave',off);
      kb.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)on(e)});
      kb.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')off()});
    });
    const ce=el.querySelector('.codeedit');
    if(ce)ce.addEventListener('click',()=>openCodeEditor(b));
    const trig=el.querySelector('.trig:not(.codeedit)');
    if(trig){
      const on=e=>{e.preventDefault();gateOn(b)},off=()=>gateOff(b);
      trig.addEventListener('pointerdown',on);
      trig.addEventListener('pointerup',off);
      trig.addEventListener('pointerleave',off);
      trig.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)on(e)});
      trig.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')off()});
    }
    const po=el.querySelector('.port.out');
    if(po)po.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      try{po.setPointerCapture(e.pointerId)}catch(x){}
      const start={x:e.clientX,y:e.clientY};
      let moved=false,temp=null;
      const mv=e2=>{
        if(!moved&&Math.hypot(e2.clientX-start.x,e2.clientY-start.y)<=6)return;
        moved=true;
        if(!temp)temp=tempCable(CONTROL[b.type]);
        const a=portPos(b.id,'out'),pr=patch.getBoundingClientRect();
        temp.setAttribute('d',curveD(a,{x:e2.clientX-pr.left,y:e2.clientY-pr.top}));
      };
      const up=e2=>{
        po.removeEventListener('pointermove',mv);po.removeEventListener('pointerup',up);
        if(temp)temp.remove();
        if(!moved){setArmed(armed===b.id?null:b.id);return}   // plain click: arm for click-to-click wiring
        const t=document.elementFromPoint(e2.clientX,e2.clientY);
        const pin=t&&t.closest?t.closest('.port.in'):null;
        if(pin){
          const tid=pin.closest('.blk').dataset.id;
          if(tid!==b.id&&!wires.some(w=>w.from===b.id&&w.to===tid))wires.push({from:b.id,to:tid});
          drawWires();rebuild();
        }
      };
      po.addEventListener('pointermove',mv);po.addEventListener('pointerup',up);
    });
    if(po)po.addEventListener('click',e=>{if(e.detail===0)setArmed(armed===b.id?null:b.id)});   // keyboard activation only (pointer path arms on pointerup)
    const pi=el.querySelector('.port.in');
    if(pi)pi.addEventListener('click',()=>{
      if(!armed||armed===b.id)return;
      const i=wires.findIndex(w=>w.from===armed&&w.to===b.id);
      if(i>=0)dropWire(i);else wires.push({from:armed,to:b.id});   // same pair again = unplug it
      setArmed(null);
      drawWires();rebuild();
    });
    [[po,'out'],[pi,'in']].forEach(([p,side])=>{
      if(p)p.addEventListener('keydown',e=>{
        if(e.key!=='Delete'&&e.key!=='Backspace')return;
        e.preventDefault();
        for(let i=wires.length-1;i>=0;i--)if(side==='out'?wires[i].from===b.id:wires[i].to===b.id)dropWire(i);
        drawWires();rebuild();
      });
    });
  }
  function dropWire(i){                       // remove wires[i], keeping the scope probe honest
    if(probeWire===wires[i])probeWire=null;
    wires.splice(i,1);
  }


  /* cable probe: click an audio cable to point the scopes at that signal */
  let probeWire=null;
  function setProbe(w){probeWire=w;applyProbe();drawWires()}
  function applyProbe(){
    if(!live)return;
    scope.detach();spec.detach();
    let node=live.master,txt='';
    if(probeWire){
      const fb=blocks.find(b=>b.id===probeWire.from), tb=blocks.find(b=>b.id===probeWire.to);
      const fn=live.map[probeWire.from];
      if(wires.includes(probeWire)&&fn&&fn.out&&fb&&!CONTROL[fb.type]){
        node=fn.out;
        txt=' — probing '+DEFS[fb.type].name+' → '+(tb?DEFS[tb.type].name:'?');
      }else probeWire=null;
    }
    scope.attach(node);spec.attach(node);
    const lbls=[...document.querySelectorAll('.scopelbl')];
    if(lbls[0])lbls[0].textContent='Live waveform'+txt;
    if(lbls[1])lbls[1].textContent='Spectrum'+txt;
  }

  /* keyboard equivalent of clicking a cable: "p" walks the probe through the wires, then off */
  document.addEventListener('keydown',e=>{
    if(e.key!=='p'&&e.key!=='P')return;
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
    if(!wires.length)return;
    const i=wires.indexOf(probeWire)+1;
    setProbe(i>=wires.length?null:wires[i]);
  });

  function curveD(a,z){const mx=(a.x+z.x)/2;return 'M'+a.x+','+a.y+' C'+mx+','+a.y+' '+mx+','+z.y+' '+z.x+','+z.y}
  function tempCable(mod){
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('fill','none');
    p.setAttribute('stroke',mod?'#B45309':'#059669');
    p.setAttribute('stroke-width','2.5');
    if(mod)p.setAttribute('stroke-dasharray','6 4');
    p.style.pointerEvents='none';
    svg.appendChild(p);
    return p;
  }
  function portPos(id,sel){
    const el=patch.querySelector('.blk[data-id="'+id+'"] .port.'+sel);
    if(!el)return null;
    const pr=patch.getBoundingClientRect(),r=el.getBoundingClientRect();
    return {x:r.left+r.width/2-pr.left, y:r.top+r.height/2-pr.top};
  }
  function drawWires(){
    svg.innerHTML='';
    wires.forEach((w,i)=>{
      const a=portPos(w.from,'out'), z=portPos(w.to,'in');
      if(!a||!z)return;
      const src=blocks.find(b=>b.id===w.from);
      const mod=src&&CONTROL[src.type];
      const dstr=curveD(a,z);
      const mk=(width,stroke,dash)=>{
        const p=document.createElementNS('http://www.w3.org/2000/svg','path');
        p.setAttribute('d',dstr);p.setAttribute('fill','none');
        p.setAttribute('stroke',stroke);p.setAttribute('stroke-width',width);
        if(dash)p.setAttribute('stroke-dasharray','6 4');
        return p;
      };
      const vis=mk(w===probeWire?4.5:2.5,mod?'#B45309':'#059669',mod||running);
      if(running){vis.classList.add('flow');if(mod)vis.classList.add('modw')}
      const hit=mk(14,'rgba(0,0,0,0)',false);      // fat invisible hit area
      hit.style.cursor='grab';
      hit.addEventListener('pointerdown',e=>{
        // click = probe this cable on the scopes; drag = unplug (re-route or remove)
        e.stopPropagation();e.preventDefault();
        try{hit.setPointerCapture(e.pointerId)}catch(x){}
        const w=wires[i];
        const start={x:e.clientX,y:e.clientY};
        let moved=false,temp=null;
        const mv=e2=>{
          if(!moved){
            if(Math.hypot(e2.clientX-start.x,e2.clientY-start.y)<=6)return;
            moved=true;
            const idx=wires.indexOf(w);
            if(idx>=0)wires.splice(idx,1);
            if(probeWire===w)probeWire=null;
            vis.remove();rebuild();   // keep this hit element alive: it holds the pointer capture
            temp=tempCable(mod);
          }
          const sPos=portPos(w.from,'out'),pr=patch.getBoundingClientRect();
          if(sPos&&temp)temp.setAttribute('d',curveD(sPos,{x:e2.clientX-pr.left,y:e2.clientY-pr.top}));
        };
        const up=e2=>{
          hit.removeEventListener('pointermove',mv);hit.removeEventListener('pointerup',up);hit.removeEventListener('pointercancel',up);
          if(!moved){setProbe(probeWire===w?null:w);return}   // plain click: toggle probe
          if(temp)temp.remove();
          const t=document.elementFromPoint(e2.clientX,e2.clientY);
          const pin=t&&t.closest?t.closest('.port.in'):null;
          if(pin){
            const tid=pin.closest('.blk').dataset.id;
            if(tid!==w.from&&!wires.some(x=>x.from===w.from&&x.to===tid))wires.push({from:w.from,to:tid});
          }
          drawWires();rebuild();
        };
        hit.addEventListener('pointermove',mv);hit.addEventListener('pointerup',up);hit.addEventListener('pointercancel',up);
      });
      svg.appendChild(vis);svg.appendChild(hit);
    });
  }

  /* audio graph */
  function teardown(){
    if(!live)return;
    if(live.pwmTimer)clearInterval(live.pwmTimer);
    (live.clockTimers||[]).forEach(c=>clearInterval(c.timer));
    procState.forEach(st=>{if(st.timer)clearInterval(st.timer);st.timer=null});
    // fade the old graph out before stopping its sources — stopping mid-waveform clicks
    const old=live;live=null;
    try{old.master.gain.setTargetAtTime(0,ctx().currentTime,0.01)}catch(e){}
    setTimeout(()=>{
      for(const id in old.map){const n=old.map[id];if(n&&n.src){try{n.src.stop()}catch(e){}}if(n&&n.src2){try{n.src2.stop()}catch(e){}}}
      try{old.master.disconnect()}catch(e){}
      try{if(old.pan)old.pan.disconnect()}catch(e){}
    },70);
  }
  function nodeFor(b){
    const c=ctx();
    if(b.type==='vco'){
      const o=c.createOscillator();o.frequency.value=b.vals[0];
      const n={src:o};applyWave(b,n);
      const g=c.createGain();g.gain.value=0.4;o.connect(g);o.start();
      const so=c.createOscillator();so.type='sine';so.frequency.value=b.vals[0]/2; // sub: sine one octave down
      const sg=c.createGain();sg.gain.value=b.sub?0.35:0;
      so.connect(sg).connect(g);so.start();
      return{src:o,src2:so,sub:so,subGain:sg,out:g,param:o.frequency,amp:g.gain,baseFreq:b.vals[0]};
    }
    if(b.type==='noise'){
      const s=c.createBufferSource();s.buffer=noiseBuf(c,b.ncol||'white');s.loop=true;
      const g=c.createGain();g.gain.value=0.3;s.connect(g);s.start();
      return{src:s,out:g};
    }
    if(b.type==='vcf'){
      const cut=cutHz(b.vals[0]);
      if(b.ftype==='ladder'||b.ftype==='acid'){          // classic 24 dB/oct: two cascaded lowpass stages
        const f1=c.createBiquadFilter(),f2=c.createBiquadFilter();
        f1.type=f2.type='lowpass';
        f1.frequency.value=f2.frequency.value=cut;
        const q=resQs(b.ftype,b.vals[2]??40);
        f1.Q.value=q[0];f2.Q.value=q[1];
        let head=f1;
        if(b.ftype==='acid'){                            // 303 character: soft-clip drive before the filter
          const ws=c.createWaveShaper();
          const N=256,curve=new Float32Array(N);
          for(let i=0;i<N;i++){const x=i/(N-1)*2-1;curve[i]=Math.tanh(1.8*x)}
          ws.curve=curve;ws.connect(f1);head=ws;
        }
        f1.connect(f2);
        return{inp:head,out:f2,param:f1.frequency,param2:f2.frequency,qs:[f1.Q,f2.Q],mod:[f1.detune,f2.detune]};
      }
      const f=c.createBiquadFilter();f.type=b.ftype||'lowpass';f.frequency.value=cut;
      f.Q.value=resQs(b.ftype,b.vals[2]??40)[0];
      return{inp:f,out:f,param:f.frequency,qs:[f.Q],mod:[f.detune]};
    }
    if(b.type==='vca'){const g=c.createGain();g.gain.value=b.vals[0]/100*0.5;return{inp:g,out:g,param:g.gain}}
    if(b.type==='mix'){const g=c.createGain();g.gain.value=b.vals[0]/100;return{inp:g,out:g,param:g.gain}}
    if(b.type==='code'){
      if(workletReady&&window.AudioWorkletNode){
        try{
          const wn=new AudioWorkletNode(c,'user-code',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
          wn.port.onmessage=e=>codeStatus(b,e.data==='ok'?'running':'error');
          wn.port.postMessage(b.code||DEFAULT_CODE);
          return{inp:wn,out:wn,wn};
        }catch(e){}
      }
      ensureWorklet();                       // pass-through until the worklet module is ready
      const g=c.createGain();
      return{inp:g,out:g};
    }
    if(b.type==='rev'){
      const inp=c.createGain(),sum=c.createGain(),cv=c.createConvolver(),wet=c.createGain();
      cv.buffer=reverbIR(c,b.vals[0]);
      wet.gain.value=b.vals[1]/100*1.2;
      inp.connect(sum);                              // dry
      inp.connect(cv);cv.connect(wet).connect(sum);  // wet
      return{inp,out:sum,cv,wet:wet.gain};
    }
    if(b.type==='drv'){
      const ws=c.createWaveShaper(),lvl=c.createGain();
      ws.curve=driveCurve(b.vals[0]);lvl.gain.value=b.vals[1]/100;
      ws.connect(lvl);
      return{inp:ws,out:lvl,ws,lvl:lvl.gain};
    }
    if(b.type==='cho'){
      const inp=c.createGain(),sum=c.createGain(),dl=c.createDelay(0.1),wet=c.createGain();
      const lf=c.createOscillator(),lg=c.createGain();
      dl.delayTime.value=0.02;wet.gain.value=0.7;
      lf.frequency.value=b.vals[0];lg.gain.value=b.vals[1]/100*0.008;
      lf.connect(lg).connect(dl.delayTime);lf.start();
      inp.connect(sum);inp.connect(dl);dl.connect(wet).connect(sum);
      return{inp,out:sum,src:lf,lfR:lf.frequency,lg:lg.gain};
    }
    if(b.type==='crush'){
      const ws=c.createWaveShaper();
      ws.curve=crushCurve(b.vals[0]);
      return{inp:ws,out:ws,ws};
    }
    if(b.type==='del'){
      const inp=c.createGain(),sum=c.createGain(),dl=c.createDelay(1),fb=c.createGain(),wet=c.createGain();
      dl.delayTime.value=b.vals[0]/1000;fb.gain.value=b.vals[1]/100;wet.gain.value=0.7;
      inp.connect(sum);                      // dry
      inp.connect(dl);dl.connect(fb).connect(dl);dl.connect(wet).connect(sum); // wet + feedback loop
      return{inp,out:sum,param:dl.delayTime,fb:fb.gain};
    }
    if(b.type==='lfo'){const o=c.createOscillator();o.frequency.value=b.vals[0];const g=c.createGain();o.connect(g);o.start();return{src:o,out:g,isLfo:true}}
    return null; // env, midi, out: no audio node of their own
  }
  function pulseWave(dutyPct){ // Fourier pulse train; 50% duty = classic square (odd harmonics only)
    const duty=dutyPct/100,N=32;
    const real=new Float32Array(N+1),imag=new Float32Array(N+1);
    for(let k=1;k<=N;k++)real[k]=2/(k*Math.PI)*Math.sin(k*Math.PI*duty);
    return ctx().createPeriodicWave(real,imag);
  }
  function applyWave(b,n){
    if(b.wave==='square')n.src.setPeriodicWave(pulseWave(b.vals[1]||50));
    else n.src.type=b.wave;
  }
  const noiseCache={};
  function noiseBuf(c,col){ // white: flat · pink: -3 dB/oct (Kellet filter) · brown: -6 dB/oct (leaky integrator)
    if(noiseCache[col])return noiseCache[col];
    const bu=c.createBuffer(1,c.sampleRate*2,c.sampleRate),d=bu.getChannelData(0);
    if(col==='pink'){
      let b0=0,b1=0,b2=0;
      for(let i=0;i<d.length;i++){
        const w=Math.random()*2-1;
        b0=0.997*b0+0.029591*w;b1=0.985*b1+0.032534*w;b2=0.95*b2+0.048056*w;
        d[i]=b0+b1+b2+w*0.05;
      }
    }else if(col==='brown'){
      let l=0;
      for(let i=0;i<d.length;i++){l=(l+0.02*(Math.random()*2-1))/1.02;d[i]=l}
    }else{
      for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    }
    let pk=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a}
    if(pk>0)for(let i=0;i<d.length;i++)d[i]*=0.9/pk;   // normalise so colours are equally loud
    // crossfade the loop seam: pink/brown don't end where they began, which clicks every loop
    const F=512;
    for(let i=0;i<F;i++){const t=i/F;d[d.length-F+i]=d[d.length-F+i]*(1-t)+d[i]*t}
    noiseCache[col]=bu;
    return bu;
  }
  /* FX curve/impulse generators — pure functions of their knob values */
  function reverbIR(c,sec){
    const len=Math.max(1,Math.floor(c.sampleRate*sec));
    const b=c.createBuffer(2,len,c.sampleRate);
    for(let ch=0;ch<2;ch++){
      const d=b.getChannelData(ch);
      for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.5);
    }
    return b;
  }
  function driveCurve(amt){
    const N=512,k=1+amt/100*20,cu=new Float32Array(N);
    for(let i=0;i<N;i++){const x=i/(N-1)*2-1;cu[i]=Math.tanh(k*x)/Math.tanh(k)}
    return cu;
  }
  function crushCurve(bits){
    const N=1024,L=Math.pow(2,Math.round(bits))/2,cu=new Float32Array(N);
    for(let i=0;i<N;i++){const x=i/(N-1)*2-1;cu[i]=Math.round(x*L)/L}
    return cu;
  }
  function resQs(ftype,res){ // per-model Q mapping for the RES knob; res 40 matches the old fixed values
    const r=res/100;
    if(ftype==='acid')return[r*25,r*10];
    if(ftype==='ladder')return[0.5+r*1.5,r*17.5];
    return[Math.max(0.5,r*20)];
  }
  function envRange(to){ // what an envelope sweeps on its target
    if(to.type==='vco')return{min:0.0001,max:0.4};        // gates the osc's own level
    if(to.type==='vca')return{min:0.0001,max:to.vals[0]/100*0.5};
    if(to.type==='mix')return{min:0.0001,max:to.vals[0]/100};
    if(to.type==='vcf')return{min:80,max:cutHz(to.vals[0])};
    return null;
  }
  function rebuild(){
    teardown();
    if(!running)return;
    const c=ctx();
    const ob=blocks.find(b=>b.type==='out');
    const master=c.createGain();master.gain.value=ob?ob.vals[0]/100:0.8;
    let pan=null;
    if(c.createStereoPanner){
      pan=c.createStereoPanner();pan.pan.value=ob?ob.vals[1]/100:0;
      master.connect(pan);pan.connect(bus());
    }else master.connect(bus());   // very old browsers: no panner, straight through
    // scopes attach at the end via applyProbe (respects an active cable probe)
    const map={},envT={},noteRoutes={},det={},syncLead={},syncOut={},pwmList=[];
    blocks.forEach(b=>{
      map[b.id]=nodeFor(b);
      if(['midi','arp','latch','keys','clock'].includes(b.type))noteRoutes[b.id]={procs:[],vcos:[],envs:[],vcfs:[]};
    });
    wires.forEach(w=>{
      const from=blocks.find(b=>b.id===w.from), to=blocks.find(b=>b.id===w.to);
      if(!from||!to)return;
      const fn=map[w.from], tn=map[w.to];
      try{
        if(from.type==='env'){
          if(!tn)return;
          const par=to.type==='vco'?tn.amp:tn.param;   // env into an Osc gates its level, not its pitch
          const rng=envRange(to);
          if(!par||!rng)return;
          par.value=rng.min;                    // silent/closed until gated
          (envT[from.id]=envT[from.id]||[]).push({param:par,...rng});
          if(to.type==='vcf'&&tn.param2){tn.param2.value=rng.min;envT[from.id].push({param:tn.param2,...rng})}
        }else if(noteRoutes[from.id]){          // midi / arp / latch: note-event routing
          const r=noteRoutes[from.id];
          if(to.type==='vco')r.vcos.push(w.to);
          else if(to.type==='env')r.envs.push(w.to);
          else if(to.type==='vcf')r.vcfs.push(w.to);       // keyboard tracking: cutoff follows the note
          else if(to.type==='arp'||to.type==='latch')r.procs.push(w.to);
        }else if(from.type==='det'){
          if(to.type==='vco')det[w.to]=(det[w.to]||1)*Math.pow(2,from.vals[0]/1200);
        }else if(from.type==='vco'&&to.type==='sync'){
          if(!syncLead[w.to])syncLead[w.to]=w.from;   // first osc in = leader
        }else if(from.type==='sync'){
          if(to.type==='vco')(syncOut[w.from]=syncOut[w.from]||[]).push(w.to);
        }else if(fn&&fn.isLfo){
          if(to.type==='vco'&&from.lft==='pw'){       // control-rate PWM
            if(tn)pwmList.push({vb:to,n:tn,lb:from,ph:0});
            return;
          }
          if(!tn)return;
          if(to.type==='vcf'&&tn.mod){                 // filter wobble via detune (cents): stays positive, no clicks
            fn.out.gain.value=DEFS.vcf.modScale;
            tn.mod.forEach(m=>fn.out.connect(m));
            return;
          }
          if(!tn.param)return;
          fn.out.gain.value=DEFS[to.type].modScale;
          fn.out.connect(tn.param);
          if(tn.param2)fn.out.connect(tn.param2);
        }else if(to.type==='out'){
          if(fn)fn.out.connect(master);
        }else if(fn&&tn&&tn.inp){
          fn.out.connect(tn.inp);
        }
      }catch(e){}
    });
    // pitch follows through envelopes: notes -> Env -> Osc means the osc gets the note too
    Object.values(noteRoutes).forEach(r=>{
      r.envs.forEach(eid=>{
        wires.filter(w2=>w2.from===eid).forEach(w2=>{
          const tb=blocks.find(b=>b.id===w2.to);
          if(tb&&tb.type==='vco'&&!r.vcos.includes(w2.to))r.vcos.push(w2.to);
        });
      });
    });
    // sync: follower oscs mirror their leader's pitch
    const syncFollows={};
    Object.entries(syncLead).forEach(([sid,leader])=>{
      (syncOut[sid]||[]).forEach(f=>{if(f!==leader)syncFollows[f]=leader});
    });
    heldNotes.clear();noteAssign.clear();
    procState.forEach(st=>{if(st.timer)clearInterval(st.timer)});procState.clear();
    live={master,pan,map,envT,noteRoutes,det,syncFollows,clockTimers:[]};
    applyProbe();
    blocks.filter(b=>b.type==='clock').forEach(cb=>startClock(cb));
    if(pwmList.length){
      live.pwmTimer=setInterval(()=>{
        pwmList.forEach(e=>{
          if(e.vb.wave!=='square')return;
          e.ph+=e.lb.vals[0]*0.033*2*Math.PI;
          const duty=Math.min(95,Math.max(5,e.vb.vals[1]+Math.sin(e.ph)*35));
          if(e.last!==undefined&&Math.abs(duty-e.last)<0.4)return;   // skip near-identical updates: each swap ticks slightly
          e.last=duty;
          e.n.src.setPeriodicWave(pulseWave(duty));
        });
      },33);
    }
    Object.keys(det).forEach(id=>{const n=map[id];if(n)applyVcoFreq(id,n.baseFreq)});        // apply detune now
    Object.values(syncFollows).forEach(l=>{const n=map[l];if(n)applyVcoFreq(l,n.baseFreq)}); // align followers now
  }
  function applyVcoFreq(id,f,depth){
    if(!live)return;
    const n=live.map[id];
    if(!n||!n.param)return;
    n.baseFreq=f;
    const vb=blocks.find(x=>x.id===id);
    const gl=vb&&vb.vals[2]?vb.vals[2]/1000:0;             // portamento: glide time from the GL knob
    const oct=vb?Math.pow(2,vb.vals[3]||0):1;              // octave shift
    const target=f*oct*(live.det[id]||1), tc=gl>0.015?gl/3:0.005;
    n.param.setTargetAtTime(target,ctx().currentTime,tc);
    if(n.sub)n.sub.frequency.setTargetAtTime(target/2,ctx().currentTime,tc);  // sub tracks an octave below
    if((depth||0)>3)return;
    Object.entries(live.syncFollows).forEach(([fid,lid])=>{
      if(lid===id&&fid!==id)applyVcoFreq(fid,f,(depth||0)+1);
    });
  }
  function startClock(cb){
    const tick=()=>{
      noteEvent(cb.id,true,48,0);
      setTimeout(()=>noteEvent(cb.id,false,48,0),1000/cb.vals[0]*0.5);   // gate half the step
    };
    live.clockTimers.push({id:cb.id,timer:setInterval(tick,1000/cb.vals[0])});
    tick();
  }
  /* note events: emitted by MIDI In, Keys, Clock, Latch and Arp; consumed by Oscs (pitch), Envs (gate), Filters (key tracking), and forwarded to processors */
  function noteEvent(bid,on,note,depth){
    if(!live||(depth||0)>4)return;
    const r=live.noteRoutes[bid];if(!r)return;
    const held=heldNotes.get(bid)||heldNotes.set(bid,new Set()).get(bid);
    const na=noteAssign.get(bid)||noteAssign.set(bid,{map:new Map(),rr:0}).get(bid);
    if(on){
      held.add(note);
      const f=440*Math.pow(2,(note-69)/12);
      if(r.vcos.length){
        const busy=new Set(na.map.values());
        let vid=r.vcos.find(id=>!busy.has(id));
        if(!vid){vid=r.vcos[na.rr%r.vcos.length];na.rr++}
        na.map.set(note,vid);
        applyVcoFreq(vid,f);
      }
      r.vcfs.forEach(id=>{                                // cutoff tracks pitch, scaled by the KT knob, ref middle C
        const fb=blocks.find(x=>x.id===id),n2=live.map[id];
        if(!fb||!n2||!n2.param)return;
        const tracked=Math.min(12000,Math.max(40,cutHz(fb.vals[0])*Math.pow(f/261.63,(fb.vals[1]||0)/100)));
        n2.param.setTargetAtTime(tracked,ctx().currentTime,0.01);
        if(n2.param2)n2.param2.setTargetAtTime(tracked,ctx().currentTime,0.01);
      });
      r.envs.forEach(id=>{const eb=blocks.find(x=>x.id===id);if(eb)gateOn(eb)});
    }else{
      held.delete(note);na.map.delete(note);
      if(held.size===0)r.envs.forEach(id=>{const eb=blocks.find(x=>x.id===id);if(eb)gateOff(eb)});
    }
    r.procs.forEach(pid=>procInput(pid,on,note,(depth||0)+1));
  }
  function procInput(pid,on,note,depth){
    const pb=blocks.find(b=>b.id===pid);if(!pb)return;
    const st=procState.get(pid)||procState.set(pid,{notes:[],idx:0,timer:null,latched:new Set()}).get(pid);
    if(pb.type==='latch'){
      if(!on)return;                                    // releases ignored: that's the latch
      if(st.latched.has(note)){st.latched.delete(note);noteEvent(pid,false,note,depth)}
      else{st.latched.add(note);noteEvent(pid,true,note,depth)}
    }else if(pb.type==='arp'){
      if(on){if(!st.notes.includes(note)){st.notes.push(note);st.notes.sort((a,b)=>a-b)}ensureArp(pb,st)}
      else{
        st.notes=st.notes.filter(n=>n!==note);
        if(!st.notes.length&&st.timer){clearInterval(st.timer);st.timer=null;
          [...(heldNotes.get(pid)||[])].forEach(n=>noteEvent(pid,false,n,depth));}
      }
    }
  }
  function ensureArp(pb,st){
    if(st.timer)return;
    // self-scheduling chain (not setInterval) so swing can stretch alternate steps;
    // rate/swing/pattern are read fresh every step, so knob moves apply immediately
    const loop=()=>{
      if(!live||!st.notes.length){st.timer=null;return}
      const n=st.notes,len=n.length;
      let note;
      const pat=pb.apat||'up';                     // notes are kept sorted ascending
      if(pat==='random')note=n[Math.floor(Math.random()*len)];
      else if(pat==='down')note=n[len-1-(st.idx%len)];
      else if(pat==='updown'){
        const cyc=len>1?2*len-2:1, p=st.idx%cyc;
        note=n[p<len?p:cyc-p];
      }else note=n[st.idx%len];                    // up
      st.idx++;
      const sw=(pb.vals[1]||50)/100, pair=2000/pb.vals[0];
      const dur=(st.idx%2===1)?pair*sw:pair*(1-sw);   // long-short pairs; 50% = straight
      noteEvent(pb.id,true,note,1);
      setTimeout(()=>noteEvent(pb.id,false,note,1),dur*0.55);   // gate ~55% of this step
      st.timer=setTimeout(loop,dur);
    };
    loop();
  }
  function liveParam(b,i){
    if(!live)return;
    if(b.type==='out'){
      if(i===1){if(live.pan)live.pan.pan.setTargetAtTime(b.vals[1]/100,ctx().currentTime,0.01)}
      else live.master.gain.setTargetAtTime(b.vals[0]/100,ctx().currentTime,0.01);
      return;
    }
    const n=live.map[b.id];if(!n)return;
    const t=ctx().currentTime;
    if(b.type==='vco'){
      if(i===1)applyWave(b,n);            // PW slider: rebuild the pulse recipe
      else if(i===0)applyVcoFreq(b.id,b.vals[0]);
      else if(i===3)applyVcoFreq(b.id,n.baseFreq!=null?n.baseFreq:b.vals[0]);  // octave: retune the held pitch
      // i===2 (glide) is read at the next pitch change
    }
    else if(b.type==='vcf'){
      if(i===0){
        n.param.setTargetAtTime(cutHz(b.vals[0]),t,0.01);
        if(n.param2)n.param2.setTargetAtTime(cutHz(b.vals[0]),t,0.01);
      }else if(i===2&&n.qs){
        resQs(b.ftype,b.vals[2]).forEach((q,k)=>{if(n.qs[k])n.qs[k].setTargetAtTime(q,t,0.01)});
      } // KT applies at the next note
    }
    else if(b.type==='vca')n.param.setTargetAtTime(b.vals[0]/100*0.5,t,0.01);
    else if(b.type==='mix')n.param.setTargetAtTime(b.vals[0]/100,t,0.01);
    else if(b.type==='rev'){
      if(i===0)n.cv.buffer=reverbIR(ctx(),b.vals[0]);
      else n.wet.setTargetAtTime(b.vals[1]/100*1.2,t,0.02);
    }
    else if(b.type==='drv'){
      if(i===0)n.ws.curve=driveCurve(b.vals[0]);
      else n.lvl.setTargetAtTime(b.vals[1]/100,t,0.01);
    }
    else if(b.type==='cho'){
      if(i===0)n.lfR.setTargetAtTime(b.vals[0],t,0.01);
      else n.lg.setTargetAtTime(b.vals[1]/100*0.008,t,0.01);
    }
    else if(b.type==='crush')n.ws.curve=crushCurve(b.vals[0]);
    else if(b.type==='del'){
      if(i===0)n.param.setTargetAtTime(b.vals[0]/1000,t,0.01);
      else n.fb.setTargetAtTime(b.vals[1]/100,t,0.01);
    }
    else if(b.type==='lfo')n.src.frequency.setTargetAtTime(b.vals[0],t,0.01);
    // env ADSR read at gate time
  }
  function liveControl(b){ // det / arp knobs affect running control state, not audio nodes
    if(!live)return;
    if(b.type==='det'){
      wires.filter(w=>w.from===b.id).forEach(w=>{
        const tb=blocks.find(x=>x.id===w.to);
        if(!tb||tb.type!=='vco'||!live.map[w.to])return;
        let fac=1;
        wires.filter(w2=>w2.to===w.to).forEach(w2=>{
          const sb=blocks.find(x=>x.id===w2.from);
          if(sb&&sb.type==='det')fac*=Math.pow(2,sb.vals[0]/1200);
        });
        live.det[w.to]=fac;
        applyVcoFreq(w.to,live.map[w.to].baseFreq!=null?live.map[w.to].baseFreq:tb.vals[0]);
      });
    }else if(b.type==='clock'&&live){
      const e=live.clockTimers.find(c=>c.id===b.id);
      if(e){clearInterval(e.timer);live.clockTimers=live.clockTimers.filter(c=>c!==e);startClock(b)}
    }
  }
  function gateOn(envB){
    if(!live||!live.envT[envB.id])return;
    const t=ctx().currentTime;
    const a=envB.vals[0]/1000, d=envB.vals[1]/1000, s=envB.vals[2]/100;
    live.envT[envB.id].forEach(tg=>{
      tg.param.cancelScheduledValues(t);
      tg.param.setValueAtTime(Math.max(tg.param.value,tg.min),t);
      tg.param.linearRampToValueAtTime(tg.max,t+a);                          // attack
      tg.param.setTargetAtTime(tg.min+(tg.max-tg.min)*s,t+a,d/3+0.001);      // decay to sustain
    });
  }
  function gateOff(envB){
    if(!live||!live.envT[envB.id])return;
    const t=ctx().currentTime, r=envB.vals[3]/1000;
    live.envT[envB.id].forEach(tg=>{
      tg.param.cancelScheduledValues(t);
      tg.param.setValueAtTime(tg.param.value,t);
      tg.param.setTargetAtTime(tg.min,t,r/3+0.001);                          // release
    });
  }
  /* Web MIDI */
  let midiAccess=null;
  function midiStatusShow(){
    [...patch.querySelectorAll('.blk .mst')].forEach(s=>s.textContent=midiStatus);
  }
  function initMidi(){
    if(!navigator.requestMIDIAccess){midiStatus='no Web MIDI in this browser';midiStatusShow();return}
    if(midiAccess)return;
    navigator.requestMIDIAccess().then(m=>{
      midiAccess=m;
      const hookAll=()=>{
        const ins=[...m.inputs.values()];
        ins.forEach(inp=>inp.onmidimessage=onMidi);
        midiStatus=ins.length?ins.length+' device'+(ins.length===1?'':'s')+' connected':'no MIDI devices found';
        midiStatusShow();
      };
      hookAll();m.onstatechange=hookAll;
    }).catch(()=>{midiStatus='MIDI access denied';midiStatusShow()});
  }
  function onMidi(e){
    if(!live)return;
    const [st,d1,d2]=e.data;
    const type=st&0xF0, ch=(st&0x0F)+1;
    const noteOn=type===0x90&&d2>0, noteOff=type===0x80||(type===0x90&&d2===0);
    if(!noteOn&&!noteOff)return;
    blocks.filter(b=>b.type==='midi'&&(b.chan==='all'||+b.chan===ch)).forEach(mb=>{
      noteEvent(mb.id,noteOn,d1,0);
    });
  }

  const stop=reg(()=>{
    teardown();running=false;scope.detach();spec.detach();
    run.setAttribute('aria-pressed',false);run.textContent='Start';
    drawWires();
  });
  run.addEventListener('click',()=>{
    ctx();
    if(blocks.some(b=>b.type==='midi'))initMidi();  // request inside a user gesture
    if(running){stop.fn();return}
    stopAll(stop);
    running=true;rebuild();drawWires();
    run.setAttribute('aria-pressed',true);run.textContent='Stop';
  });
  document.querySelectorAll('#pal12 [data-add]').forEach(btn=>btn.addEventListener('click',()=>{
    const c=toWorld(patch.getBoundingClientRect().left+patch.clientWidth/2,
                    patch.getBoundingClientRect().top+patch.clientHeight/2);
    addBlock(btn.dataset.add, c.x-75+(Math.random()*120-60), c.y-40+(Math.random()*120-60));
    rebuild();
  }));
  addEventListener('resize',drawWires);

  /* pan & zoom: drag empty bench, wheel/pinch to zoom, double-click resets */
  const bgPts=new Map();
  const isBg=t=>t===patch||t===world||t===svg;
  patch.addEventListener('pointerdown',e=>{
    if(!isBg(e.target))return;
    try{patch.setPointerCapture(e.pointerId)}catch(x){}
    bgPts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    patch.classList.add('panning');
  });
  patch.addEventListener('pointermove',e=>{
    if(!bgPts.has(e.pointerId))return;
    const prev=bgPts.get(e.pointerId);
    if(bgPts.size===1){                        // pan
      view.tx+=e.clientX-prev.x;view.ty+=e.clientY-prev.y;
      bgPts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      applyView();
    }else if(bgPts.size===2){                  // pinch
      const pts=[...bgPts.entries()];
      const other=pts.find(([id])=>id!==e.pointerId)[1];
      const d0=Math.hypot(prev.x-other.x,prev.y-other.y);
      bgPts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const d1=Math.hypot(e.clientX-other.x,e.clientY-other.y);
      if(d0>0)zoomAt((e.clientX+other.x)/2,(e.clientY+other.y)/2,d1/d0);
    }
  });
  const endBg=e=>{bgPts.delete(e.pointerId);if(!bgPts.size)patch.classList.remove('panning')};
  patch.addEventListener('pointerup',endBg);
  patch.addEventListener('pointercancel',endBg);
  function zoomAt(cx,cy,f){
    const pr=patch.getBoundingClientRect();
    const ns=Math.min(2.5,Math.max(0.35,view.s*f));
    const px=cx-pr.left,py=cy-pr.top;
    view.tx=px-(px-view.tx)*(ns/view.s);
    view.ty=py-(py-view.ty)*(ns/view.s);
    view.s=ns;applyView();
  }
  patch.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*0.0012))},{passive:false});
  patch.addEventListener('dblclick',e=>{if(isBg(e.target)){view.tx=0;view.ty=0;view.s=1;applyView()}});

  /* save / load — localStorage, works offline */
  const PKEY='synthlab.patch.';
  const PATCH_VERSION=1;   // bump on breaking save-format changes; loader migrates or warns
  const saveBtn=document.getElementById('save12'),loadSel=document.getElementById('patches12'),fsBtn=document.getElementById('fs12');
  let store=null;
  try{store=window.localStorage;store.length}catch(e){} // blocked in private mode / sandboxed pages
  function refreshPatchList(){
    if(!store)return;
    let opts='<option value="">Load patch…</option>';
    for(let i=0;i<store.length;i++){
      const k=store.key(i);
      if(k&&k.startsWith(PKEY)){
        const n=k.slice(PKEY.length).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        opts+='<option>'+n+'</option>';
      }
    }
    loadSel.innerHTML=opts;
  }
  if(!store){saveBtn.disabled=true;loadSel.disabled=true}
  saveBtn.addEventListener('click',()=>{
    if(!store)return;
    const name=prompt('Name this patch:','my patch');
    if(!name)return;
    try{
      store.setItem(PKEY+name,JSON.stringify({v:PATCH_VERSION,blocks,wires}));
      refreshPatchList();loadSel.value=name;
    }catch(e){alert('Could not save — browser storage is blocked or full.')}
  });
  function loadPatchData(data){                // shared by the Load dropdown and file Import
    if(!data||!Array.isArray(data.blocks))throw 0;
    const pv=data.v||0;                        // 0 = legacy pre-version save
    if(pv>PATCH_VERSION){
      alert('This patch was saved by a newer version of the Patch Bay. Loading anyway — some settings may be missing.');
    }
    // pv < PATCH_VERSION: per-version migrations go here; the sanitising below covers v0 -> v1
    blocks=data.blocks.filter(b=>DEFS[b.type]);
    blocks.forEach(b=>{
      const d=DEFS[b.type];
      if(!Array.isArray(b.vals)||b.vals.length!==d.params.length)b.vals=d.params.map(p=>p.val);
    });
    wires=(data.wires||[]).filter(w=>blocks.some(b=>b.id===w.from)&&blocks.some(b=>b.id===w.to));
    nid=blocks.reduce((m,b)=>Math.max(m,parseInt(String(b.id).slice(1),10)||0),0);
    armed=null;
    if(blocks.some(b=>b.type==='midi'))initMidi();
    render();rebuild();
  }
  loadSel.addEventListener('change',()=>{
    const name=loadSel.value;
    if(!name||!store)return;
    try{loadPatchData(JSON.parse(store.getItem(PKEY+name)))}
    catch(e){alert('Could not load that patch.')}
  });
  refreshPatchList();

  /* export / import — patches as files, for sharing between machines */
  document.getElementById('exp12').addEventListener('click',()=>{
    const name=prompt('Name this patch file:','my patch');
    if(!name)return;
    const data=JSON.stringify({v:PATCH_VERSION,name,blocks,wires},null,1);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
    a.download=name.replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-')+'.synthpatch.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  });
  const impFile=document.getElementById('impfile12');
  document.getElementById('imp12').addEventListener('click',()=>{impFile.value='';impFile.click()});
  impFile.addEventListener('change',async()=>{
    const f=impFile.files[0];
    if(!f)return;
    try{loadPatchData(JSON.parse(await f.text()))}
    catch(e){alert('Could not read that file — it does not look like a Patch Bay patch.')}
  });

  /* computer keyboard -> every Keys block (A-K = C3..C4) */
  const KEYROW={KeyA:48,KeyS:50,KeyD:52,KeyF:53,KeyG:55,KeyH:57,KeyJ:59,KeyK:60};
  const kbHeld=new Set();
  function keyVis(note,on){
    [...patch.querySelectorAll('.mkeys button[data-n="'+note+'"]')].forEach(k=>k.classList.toggle('down',on));
  }
  document.addEventListener('keydown',e=>{
    if(e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
    const note=KEYROW[e.code];
    if(note===undefined||kbHeld.has(e.code))return;
    const kbs=blocks.filter(b=>b.type==='keys');
    if(!kbs.length)return;
    kbHeld.add(e.code);keyVis(note,true);
    kbs.forEach(b=>noteEvent(b.id,true,note,0));
  });
  document.addEventListener('keyup',e=>{
    const note=KEYROW[e.code];
    if(note===undefined||!kbHeld.has(e.code))return;
    kbHeld.delete(e.code);keyVis(note,false);
    blocks.filter(b=>b.type==='keys').forEach(b=>noteEvent(b.id,false,note,0));
  });
  addEventListener('blur',()=>{
    kbHeld.forEach(code=>{
      const note=KEYROW[code];keyVis(note,false);
      blocks.filter(b=>b.type==='keys').forEach(b=>noteEvent(b.id,false,note,0));
    });
    kbHeld.clear();
  });

  /* classic example patches — recreations of famous synth sounds with these blocks */
  (function(){
    const dv=t=>DEFS[t].params.map(p=>p.val);
    const B=(id,type,x,y,extra)=>Object.assign({id,type,x,y,vals:dv(type)},extra||{});
    const W=(from,to)=>({from,to});
    const PRESETS={
      'Basic Chain':()=>({blocks:[                       // the canonical first patch: Synth Lab's Mini Synth chain, plus keys
        B('k','keys',20,280),
        B('s1','vco',20,60,{wave:'sawtooth',vals:[220,50,0,0]}),
        B('e','env',300,320),
        B('f','vcf',320,110,{ftype:'lowpass',vals:[70,100,25]}),
        B('o','out',640,100)],
        wires:[W('k','s1'),W('k','e'),W('e','s1'),W('s1','f'),W('f','o')]}),  // keys set pitch and gate the env; env opens the osc: notes, not a drone
      'Fat Bass — Minimoog style':()=>({blocks:[
        B('s1','vco',20,40,{wave:'sawtooth',vals:[55,50,0,0],sub:true}),
        B('s2','vco',20,200,{wave:'sawtooth',vals:[55,50,0,0]}),
        B('dt','det',20,360,{vals:[12]}),
        B('f','vcf',320,130,{ftype:'lowpass',vals:[55,100,45]}),
        B('o','out',640,100)],
        wires:[W('s1','f'),W('s2','f'),W('dt','s2'),W('f','o')]}),
      'PWM Strings — Juno style':()=>({blocks:[
        B('s1','vco',20,40,{wave:'square',vals:[220,50,0,0]}),
        B('s2','vco',20,200,{wave:'square',vals:[220,50,0,0]}),
        B('dt','det',20,360,{vals:[9]}),
        B('l','lfo',320,320,{vals:[0.7],lft:'pw'}),
        B('f','vcf',320,110,{ftype:'lowpass',vals:[70,100,35]}),
        B('d','del',530,110,{vals:[280,35]}),
        B('o','out',700,300)],
        wires:[W('s1','f'),W('s2','f'),W('dt','s2'),W('l','s1'),W('f','d'),W('d','o')]}),
      'Dub Wobble':()=>({blocks:[
        B('s1','vco',20,80,{wave:'sawtooth',vals:[55,50,0,0],sub:true}),
        B('l','lfo',20,260,{vals:[4]}),
        B('f','vcf',320,140,{ftype:'lowpass',vals:[50,100,65]}),
        B('o','out',640,110)],
        wires:[W('s1','f'),W('l','f'),W('f','o')]}),
      'Ocean Wind':()=>({blocks:[
        B('n','noise',20,80,{ncol:'pink'}),
        B('l','lfo',20,260,{vals:[0.5]}),
        B('f','vcf',320,140,{ftype:'lowpass',vals:[45,100,30]}),
        B('o','out',640,110)],
        wires:[W('n','f'),W('l','f'),W('f','o')]}),
      'Echo Lead':()=>({blocks:[
        B('s1','vco',20,100,{wave:'triangle',vals:[330,50,80,0]}),
        B('d','del',320,120,{vals:[420,55]}),
        B('o','out',640,100)],
        wires:[W('s1','d'),W('d','o')]}),
      'Acid Line — 303 style':()=>({blocks:[
        B('s1','vco',20,40,{wave:'sawtooth',vals:[110,50,0,0]}),
        B('ck','clock',20,220,{vals:[2.5]}),
        B('e','env',300,300,{vals:[5,300,10,150]}),
        B('f','vcf',320,90,{ftype:'acid',vals:[60,100,55]}),   // high ceiling: the sweep spans ~80 Hz -> ~2.3 kHz
        B('o','out',640,90)],
        wires:[W('s1','f'),W('ck','e'),W('e','f'),W('e','s1'),W('f','o')]}),  // env gates the osc too: notes, not a drone
      'Ladder Bass — Moog style':()=>({blocks:[
        B('s1','vco',20,60,{wave:'sawtooth',vals:[55,50,0,0],sub:true}),
        B('f','vcf',320,110,{ftype:'ladder',vals:[50,100,50]}),
        B('o','out',640,90)],
        wires:[W('s1','f'),W('f','o')]}),
      'Siren':()=>({blocks:[
        B('s1','vco',20,100,{wave:'sine',vals:[440,50,120,0]}),
        B('l','lfo',20,280,{vals:[0.6]}),
        B('o','out',640,100)],
        wires:[W('s1','o'),W('l','s1')]})
    };
    const sel=document.getElementById('presets12');
    for(const k in PRESETS)sel.insertAdjacentHTML('beforeend','<option>'+k+'</option>');
    sel.addEventListener('change',()=>{
      const k=sel.value;
      if(!k||!PRESETS[k])return;
      try{loadPatchData({v:PATCH_VERSION,...PRESETS[k]()})}catch(e){}
      try{history.replaceState(null,'','#preset='+slug(k))}catch(e){}  // shareable URL; replaceState so back isn't spammed
      sel.value='';
    });

    /* hash deep-links — #preset=<slug> builds that patch on the bench (no audio until Start) */
    function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
    const SLUGS={};
    for(const k in PRESETS){
      SLUGS[slug(k)]=k;
      const short=slug(k.split('—')[0]);          // 'fat-bass' as well as 'fat-bass-minimoog-style'
      if(!SLUGS[short])SLUGS[short]=k;
    }
    function applyHash(){
      const m=/^#preset=(.+)/.exec(location.hash||'');
      if(!m)return;
      let raw=m[1];try{raw=decodeURIComponent(raw)}catch(e){}
      const k=SLUGS[slug(raw)];
      if(!k)return;                               // unknown slug: normal blank bench
      try{loadPatchData({v:PATCH_VERSION,...PRESETS[k]()})}catch(e){}
    }
    addEventListener('hashchange',applyHash);
    applyHash();
  })();

  /* randomise: template-based so every roll makes sound — skeleton first, dice after */
  document.getElementById('rand12').addEventListener('click',()=>{
    const R=(a,b)=>a+Math.random()*(b-a);
    const pick=a=>a[Math.floor(Math.random()*a.length)];
    const chance=p=>Math.random()<p;
    blocks=[];wires=[];nid=0;armed=null;
    const W=Math.max(700,patch.clientWidth),H=Math.max(420,patch.clientHeight);
    const col=f=>Math.round(W*f), row=()=>Math.round(30+Math.random()*(H-190));
    const mk=(t,x,y)=>{addBlock(t,x,y);return blocks[blocks.length-1]};
    const dest=mk('out',col(0.86),row());
    // sources
    const srcs=[];
    const v1=mk('vco',col(0.03),row());srcs.push(v1);
    v1.wave=pick(['sine','triangle','sawtooth','sawtooth','square']);
    v1.vals[0]=Math.round(R(55,440));
    if(v1.wave==='square')v1.vals[1]=Math.round(R(15,85));
    v1.vals[3]=pick([0,0,0,-1,1]);
    v1.sub=chance(0.3);
    if(chance(0.5)){
      const v2=mk('vco',col(0.03),row());srcs.push(v2);
      v2.wave=pick(['sine','triangle','sawtooth','square']);
      v2.vals[0]=Math.round(v1.vals[0]*pick([1,1,1.5,2]));   // unison, fifth or octave
      v2.vals[3]=pick([0,0,-1]);
      if(chance(0.7)){
        const dt=mk('det',col(0.03),row());
        dt.vals[0]=Math.round(R(5,25));
        wires.push({from:dt.id,to:v2.id});
      }
    }
    if(chance(0.25)){
      const nz=mk('noise',col(0.03),row());
      nz.ncol=pick(['white','pink','brown']);srcs.push(nz);
    }
    // processing chain
    let joint;
    if(chance(0.75)){
      joint=mk('vcf',col(0.32),row());
      joint.ftype=pick(['lowpass','lowpass','lowpass','bandpass','highpass']);
      joint.vals[0]=Math.round(R(35,90));
      srcs.forEach(s=>wires.push({from:s.id,to:joint.id}));
    }else if(srcs.length>1){
      joint=mk('mix',col(0.32),row());
      srcs.forEach(s=>wires.push({from:s.id,to:joint.id}));
    }else joint=srcs[0];
    let tail=joint;
    if(chance(0.4)){
      const dl=mk('del',col(0.58),row());
      dl.vals[0]=Math.round(R(120,600));dl.vals[1]=Math.round(R(20,60));
      wires.push({from:tail.id,to:dl.id});tail=dl;
    }
    wires.push({from:tail.id,to:dest.id});
    // modulation
    if(chance(0.65)){
      const l=mk('lfo',col(0.32),row());
      l.vals[0]=+R(0.5,8).toFixed(1);
      const tgt=pick([joint.type==='vcf'?joint:v1,v1]);
      if(tgt.type==='vco'&&tgt.wave==='square'&&chance(0.5))l.lft='pw';
      wires.push({from:l.id,to:tgt.id});
    }
    if(chance(0.35)&&joint.type==='vcf'){
      const e=mk('env',col(0.58),row());
      e.vals=[Math.round(R(20,800)),Math.round(R(100,1200)),Math.round(R(30,90)),Math.round(R(100,1500))];
      wires.push({from:e.id,to:joint.id});         // filter sweep on Trig — bench still sounds without it
    }
    render();rebuild();
  });

  /* full screen */
  const demo=patch.closest('.demo');
  fsBtn.addEventListener('click',()=>{
    if(document.fullscreenElement)document.exitFullscreen();
    else if(demo.requestFullscreen)demo.requestFullscreen();
    else if(demo.webkitRequestFullscreen)demo.webkitRequestFullscreen();
  });
  /* in full screen, the scopes float in a draggable, resizable window over the bench */
  let scopeWin=null,scopeAnchor=null;
  const swPos={x:null,y:null,w:440,h:320};      // remembered across fullscreen sessions
  function enterScopeWin(){
    if(scopeWin)return;
    const lbls=[...document.querySelectorAll('.scopelbl')];
    const sc=document.getElementById('scope12'),sp=document.getElementById('spec12');
    if(lbls.length<2||!sc||!sp)return;
    scopeAnchor=document.createElement('div');
    lbls[0].before(scopeAnchor);
    scopeWin=document.createElement('div');
    scopeWin.className='scopewin';
    scopeWin.innerHTML='<div class="swbar">Scopes — drag to move · corner to resize</div><div class="swbody"></div>';
    scopeWin.querySelector('.swbody').append(lbls[0],sc,lbls[1],sp);
    demo.appendChild(scopeWin);
    scopeWin.style.left=(swPos.x??Math.max(8,innerWidth-swPos.w-24))+'px';
    scopeWin.style.top=(swPos.y??Math.max(8,innerHeight-swPos.h-24))+'px';
    scopeWin.style.width=swPos.w+'px';scopeWin.style.height=swPos.h+'px';
    const bar=scopeWin.querySelector('.swbar');
    bar.addEventListener('pointerdown',e=>{
      e.preventDefault();try{bar.setPointerCapture(e.pointerId)}catch(x){}
      const ox=e.clientX-scopeWin.offsetLeft, oy=e.clientY-scopeWin.offsetTop;
      const mv=e2=>{
        swPos.x=Math.min(innerWidth-80,Math.max(0,e2.clientX-ox));
        swPos.y=Math.min(innerHeight-40,Math.max(0,e2.clientY-oy));
        scopeWin.style.left=swPos.x+'px';scopeWin.style.top=swPos.y+'px';
      };
      const up=()=>{bar.removeEventListener('pointermove',mv);bar.removeEventListener('pointerup',up)};
      bar.addEventListener('pointermove',mv);bar.addEventListener('pointerup',up);
    });
    new ResizeObserver(()=>{
      if(!scopeWin)return;
      swPos.w=scopeWin.offsetWidth;swPos.h=scopeWin.offsetHeight;
      dispatchEvent(new Event('resize'));        // canvases re-measure their new box
    }).observe(scopeWin);
    dispatchEvent(new Event('resize'));
  }
  function exitScopeWin(){
    if(!scopeWin)return;
    scopeAnchor.replaceWith(...scopeWin.querySelector('.swbody').children);
    scopeWin.remove();scopeWin=null;scopeAnchor=null;
    dispatchEvent(new Event('resize'));
  }
  document.addEventListener('fullscreenchange',()=>{
    const on=!!document.fullscreenElement;
    fsBtn.title=on?'Exit full screen':'Full screen';
    fsBtn.setAttribute('aria-label',fsBtn.title);
    if(on)enterScopeWin();else exitScopeWin();
    dispatchEvent(new Event('resize'));drawWires();
  });





  /* shared side panel (docs / code editor / eject) with a resizable left edge */
  let panelW=null,panelOpener=null,codeEdit=null;   // opener: focus goes back where it came from
  function closePanel(){
    const p=document.getElementById('docpanel');
    if(!p)return;
    p.remove();codeEdit=null;
    if(panelOpener&&panelOpener.isConnected)panelOpener.focus();
    panelOpener=null;
  }
  function openPanel(html){
    let p=document.getElementById('docpanel');
    if(!p){panelOpener=document.activeElement;p=document.createElement('div');p.id='docpanel';document.body.appendChild(p)}
    codeEdit=null;
    p.innerHTML='<div class="docgrip" title="drag to resize" aria-hidden="true"></div>'
      +'<button class="docclose" aria-label="close">✕</button>'+html;
    if(panelW)p.style.width=panelW+'px';
    p.querySelector('.docclose').addEventListener('click',closePanel);
    p.querySelector('.docclose').focus();
    const grip=p.querySelector('.docgrip');
    grip.addEventListener('pointerdown',e=>{
      e.preventDefault();try{grip.setPointerCapture(e.pointerId)}catch(x){}
      const mv=e2=>{panelW=Math.min(innerWidth-40,Math.max(300,innerWidth-e2.clientX));p.style.width=panelW+'px'};
      const up=()=>{grip.removeEventListener('pointermove',mv);grip.removeEventListener('pointerup',up)};
      grip.addEventListener('pointermove',mv);grip.addEventListener('pointerup',up);
    });
    return p;
  }

  /* the Code block: user DSP compiled into a generic AudioWorklet processor */
  const CODE_TEMPLATES={
    'Pass-through':`// input: Float32Array or null · output: Float32Array (128 samples)
// state persists between calls · sampleRate is available
for (let i = 0; i < output.length; i++) {
  output[i] = input ? input[i] : 0;
}`,
    'Sine oscillator':`state.phase = state.phase || 0;
const f = 220;                        // try changing me
for (let i = 0; i < output.length; i++) {
  output[i] = 0.3 * Math.sin(state.phase);
  state.phase += 2 * Math.PI * f / sampleRate;
}`,
    'One-pole low-pass':`state.y = state.y || 0;
const cutoff = 800;
const a = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
for (let i = 0; i < output.length; i++) {
  const x = input ? input[i] : 0;
  state.y += a * (x - state.y);       // ease toward the input
  output[i] = state.y;
}`,
    'Bitcrush':`const bits = 4, L = 2 ** bits / 2;
for (let i = 0; i < output.length; i++) {
  const x = input ? input[i] : 0;
  output[i] = Math.round(x * L) / L;  // round to 2^bits levels
}`,
    'Ring modulator':`state.phase = state.phase || 0;
const f = 30;                          // modulation frequency
for (let i = 0; i < output.length; i++) {
  const x = input ? input[i] : 0;
  output[i] = x * Math.sin(state.phase);
  state.phase += 2 * Math.PI * f / sampleRate;
}`
  };
  const DEFAULT_CODE=CODE_TEMPLATES['Pass-through'];
  const WORKLET_SRC=`class UserProc extends AudioWorkletProcessor{
  constructor(){super();this.state={};this.fn=null;
    this.port.onmessage=e=>{
      try{this.fn=new Function('input','output','state','sampleRate',e.data);this.state={};this.port.postMessage('ok')}
      catch(err){this.fn=null;this.port.postMessage('error: '+err.message)}
    };
  }
  process(inputs,outputs){
    const inp=inputs[0]&&inputs[0][0]?inputs[0][0]:null;
    const out=outputs[0][0];
    if(this.fn){
      try{this.fn(inp,out,this.state,sampleRate)}
      catch(e){this.fn=null;this.port.postMessage('error: '+e.message)}
    }else if(inp)out.set(inp);
    return true;
  }
}
registerProcessor('user-code',UserProc);`;
  let workletReady=false,workletLoading=null;
  function ensureWorklet(){
    if(workletReady||!ctx().audioWorklet)return Promise.resolve();
    if(!workletLoading){
      workletLoading=ctx().audioWorklet
        .addModule(URL.createObjectURL(new Blob([WORKLET_SRC],{type:'application/javascript'})))
        .then(()=>{workletReady=true;if(running)rebuild()})
        .catch(()=>{});
    }
    return workletLoading;
  }
  function codeStatus(b,msg){
    const el=patch.querySelector('.blk[data-id="'+b.id+'"] small.codestat');
    if(el)el.textContent=msg;
  }
  function openCodeEditor(b){
    let opts='';for(const k in CODE_TEMPLATES)opts+='<option>'+k+'</option>';
    const p=openPanel('<h3>Code — write your own DSP</h3>'
      +'<p>Runs on the audio thread, 128 samples at a time. <code>input</code> (Float32Array or null), <code>output</code> (fill it, −1…1), <code>state</code> (yours, persists), <code>sampleRate</code>.</p>'
      +'<h4>Start from a template</h4><select class="codetpl">'+opts+'</select>'
      +'<textarea class="codearea" spellcheck="false"></textarea>'
      +'<div class="coderow"><button class="pad codeapply">Apply</button><span class="codeerr"></span></div>');
    const ta=p.querySelector('.codearea'),err=p.querySelector('.codeerr'),tpl=p.querySelector('.codetpl');
    ta.value=b.code||DEFAULT_CODE;
    codeEdit={b,ta};   // Escape out of the textarea stashes this draft (see the Escape handler)
    tpl.addEventListener('change',()=>{ta.value=CODE_TEMPLATES[tpl.value]});
    p.querySelector('.codeapply').addEventListener('click',()=>{
      b.code=ta.value;err.textContent='';
      const n=live&&live.map[b.id];
      if(n&&n.wn){
        n.wn.port.onmessage=e=>{err.textContent=e.data==='ok'?'✓ running':e.data;codeStatus(b,e.data==='ok'?'running':'error')};
        n.wn.port.postMessage(b.code);
      }else err.textContent='saved — applies when the patch runs';
    });
  }

  /* eject: generate a readable, standalone Web Audio version of the current patch */
  function ejectCode(){
    const L=[],names={},counts={};
    const nm=b=>{if(names[b.id])return names[b.id];
      const base={vco:'osc',noise:'noise',vcf:'filter',vca:'amp',mix:'mix',del:'delay',rev:'reverb',cho:'chorus',drv:'drive',crush:'crush',lfo:'lfo',out:'master'}[b.type]||b.type;
      counts[base]=(counts[base]||0)+1;
      return names[b.id]=base+(counts[base]>1?counts[base]:'')};
    const audioSrc={vco:1,noise:1,vcf:1,vca:1,mix:1,del:1,rev:1,cho:1,drv:1,crush:1};
    let needPulse=false;
    L.push('// Ejected from the Patch Bay — this is your patch as plain Web Audio code.');
    L.push('// Every line maps to a block or a cable on the bench.');
    L.push('const ctx = new AudioContext();');
    L.push('');
    blocks.forEach(b=>{
      const v=nm(b);
      if(b.type==='vco'){
        L.push('// '+DEFS.vco.name);
        L.push('const '+v+' = ctx.createOscillator();');
        if(b.wave==='square'){needPulse=true;L.push(v+'.setPeriodicWave(pulseWave('+(b.vals[1]||50)+'));  // square with pulse width')}
        else L.push(v+".type = '"+(b.wave||'sawtooth')+"';");
        const oct=Math.pow(2,b.vals[3]||0);
        L.push(v+'.frequency.value = '+(b.vals[0]*oct)+';');
        L.push('const '+v+'Out = ctx.createGain(); '+v+'Out.gain.value = 0.4;');
        L.push(v+'.connect('+v+'Out); '+v+'.start();');
        if(b.sub){L.push('const '+v+'Sub = ctx.createOscillator();  // sub: sine one octave down');
          L.push(v+"Sub.type = 'sine'; "+v+'Sub.frequency.value = '+(b.vals[0]*oct/2)+';');
          L.push('const '+v+'SubG = ctx.createGain(); '+v+'SubG.gain.value = 0.35;');
          L.push(v+'Sub.connect('+v+'SubG).connect('+v+'Out); '+v+'Sub.start();')}
      }else if(b.type==='noise'){
        L.push('// Noise ('+(b.ncol||'white')+')');
        L.push('const '+v+'Buf = ctx.createBuffer(1, 2*ctx.sampleRate, ctx.sampleRate);');
        L.push('{ const d = '+v+'Buf.getChannelData(0);');
        if(b.ncol==='pink')L.push('  let b0=0,b1=0,b2=0; for (let i=0;i<d.length;i++){ const w=Math.random()*2-1; b0=0.997*b0+0.029591*w; b1=0.985*b1+0.032534*w; b2=0.95*b2+0.048056*w; d[i]=(b0+b1+b2+w*0.05)*0.25; } }');
        else if(b.ncol==='brown')L.push('  let l=0; for (let i=0;i<d.length;i++){ l=(l+0.02*(Math.random()*2-1))/1.02; d[i]=l*3; } }');
        else L.push('  for (let i=0;i<d.length;i++) d[i]=Math.random()*2-1; }');
        L.push('const '+v+'Src = ctx.createBufferSource(); '+v+'Src.buffer = '+v+'Buf; '+v+'Src.loop = true;');
        L.push('const '+v+' = ctx.createGain(); '+v+'.gain.value = 0.3;');
        L.push(v+'Src.connect('+v+'); '+v+'Src.start();');
      }else if(b.type==='vcf'){
        const cut=Math.round(cutHz(b.vals[0])),q=resQs(b.ftype,b.vals[2]??40);
        if(b.ftype==='ladder'||b.ftype==='acid'){
          L.push('// '+DEFS.vcf.name+' — '+b.ftype+' (two cascaded stages = 24 dB/oct)');
          L.push('const '+v+' = ctx.createBiquadFilter();  const '+v+'B = ctx.createBiquadFilter();');
          L.push(v+".type = "+v+"B.type = 'lowpass';");
          L.push(v+'.frequency.value = '+v+'B.frequency.value = '+cut+';');
          L.push(v+'.Q.value = '+q[0].toFixed(1)+'; '+v+'B.Q.value = '+q[1].toFixed(1)+';');
          L.push(v+'.connect('+v+'B);');
        }else{
          L.push('// '+DEFS.vcf.name);
          L.push('const '+v+' = ctx.createBiquadFilter();');
          L.push(v+".type = '"+(b.ftype||'lowpass')+"'; "+v+'.frequency.value = '+cut+'; '+v+'.Q.value = '+q[0].toFixed(1)+';');
        }
      }else if(b.type==='vca'||b.type==='mix'){
        L.push('// '+DEFS[b.type].name);
        L.push('const '+v+' = ctx.createGain(); '+v+'.gain.value = '+(b.vals[0]/100*(b.type==='vca'?0.5:1)).toFixed(2)+';');
      }else if(b.type==='del'){
        L.push('// Delay with feedback');
        L.push('const '+v+' = ctx.createGain();  const '+v+'D = ctx.createDelay(1);  const '+v+'F = ctx.createGain();');
        L.push(v+'D.delayTime.value = '+(b.vals[0]/1000)+'; '+v+'F.gain.value = '+(b.vals[1]/100)+';');
        L.push('const '+v+'In = ctx.createGain();');
        L.push(v+'In.connect('+v+'); '+v+'In.connect('+v+'D); '+v+'D.connect('+v+'F).connect('+v+'D); '+v+'D.connect('+v+');');
      }else if(b.type==='rev'){
        L.push('// Reverb: convolution with a generated impulse response');
        L.push('const '+v+'IR = ctx.createBuffer(2, Math.floor(ctx.sampleRate*'+b.vals[0]+'), ctx.sampleRate);');
        L.push('for (let ch=0; ch<2; ch++){ const d='+v+'IR.getChannelData(ch); for (let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2.5); }');
        L.push('const '+v+' = ctx.createGain();  const '+v+'Cv = ctx.createConvolver();  const '+v+'In = ctx.createGain();  const '+v+'W = ctx.createGain();');
        L.push(v+'Cv.buffer = '+v+'IR; '+v+'W.gain.value = '+(b.vals[1]/100*1.2).toFixed(2)+';');
        L.push(v+'In.connect('+v+'); '+v+'In.connect('+v+'Cv); '+v+'Cv.connect('+v+'W).connect('+v+');');
      }else if(b.type==='cho'){
        L.push('// Chorus: short delay wobbled by an internal LFO');
        L.push('const '+v+' = ctx.createGain();  const '+v+'In = ctx.createGain();  const '+v+'D = ctx.createDelay(0.1);  const '+v+'W = ctx.createGain();');
        L.push('const '+v+'L = ctx.createOscillator();  const '+v+'LG = ctx.createGain();');
        L.push(v+"D.delayTime.value = 0.02; "+v+'W.gain.value = 0.7; '+v+'L.frequency.value = '+b.vals[0]+'; '+v+'LG.gain.value = '+(b.vals[1]/100*0.008).toFixed(4)+';');
        L.push(v+'L.connect('+v+'LG).connect('+v+'D.delayTime); '+v+'L.start();');
        L.push(v+'In.connect('+v+'); '+v+'In.connect('+v+'D); '+v+'D.connect('+v+'W).connect('+v+');');
      }else if(b.type==='drv'){
        L.push('// Drive: tanh waveshaper');
        L.push('const '+v+' = ctx.createGain(); '+v+'.gain.value = '+(b.vals[1]/100).toFixed(2)+';');
        L.push('const '+v+'Ws = ctx.createWaveShaper();');
        L.push('{ const k=1+'+b.vals[0]+'/100*20, c=new Float32Array(512);');
        L.push('  for (let i=0;i<512;i++){ const x=i/255.5-1; c[i]=Math.tanh(k*x)/Math.tanh(k); } '+v+'Ws.curve=c; }');
        L.push(v+'Ws.connect('+v+');');
      }else if(b.type==='crush'){
        L.push('// Crusher: quantise to '+b.vals[0]+' bits');
        L.push('const '+v+' = ctx.createWaveShaper();');
        L.push('{ const Lv=2**'+Math.round(b.vals[0])+'/2, c=new Float32Array(1024);');
        L.push('  for (let i=0;i<1024;i++){ const x=i/511.5-1; c[i]=Math.round(x*Lv)/Lv; } '+v+'.curve=c; }');
      }else if(b.type==='lfo'){
        L.push('// LFO');
        L.push('const '+v+' = ctx.createOscillator();  const '+v+'G = ctx.createGain();');
        L.push(v+'.frequency.value = '+b.vals[0]+'; '+v+'.connect('+v+'G); '+v+'.start();');
      }else if(b.type==='out'){
        L.push('// Output: level, pan, then a safety limiter');
        L.push('const '+v+' = ctx.createGain(); '+v+'.gain.value = '+(b.vals[0]/100).toFixed(2)+';');
        L.push('const '+v+'Pan = ctx.createStereoPanner(); '+v+'Pan.pan.value = '+((b.vals[1]||0)/100).toFixed(2)+';');
        L.push('const limiter = ctx.createDynamicsCompressor();');
        L.push('limiter.threshold.value = -12; limiter.ratio.value = 20; limiter.attack.value = 0.002;');
        L.push(v+'.connect('+v+'Pan).connect(limiter).connect(ctx.destination);');
      }
      L.push('');
    });
    L.push('// ---- cables ----');
    const inName=b=>({del:'In',rev:'In',cho:'In',drv:'Ws'}[b.type]!==undefined?nm(b)+({del:'In',rev:'In',cho:'In',drv:'Ws'}[b.type]):nm(b));
    const outName=b=>b.type==='vco'?nm(b)+'Out':nm(b);
    wires.forEach(w=>{
      const from=blocks.find(x=>x.id===w.from), to=blocks.find(x=>x.id===w.to);
      if(!from||!to)return;
      if(from.type==='lfo'){
        if(to.type==='vcf'){L.push(nm(from)+'G.gain.value = 1200;  // cents of filter wobble');
          L.push(nm(from)+'G.connect('+nm(to)+'.detune);'+(to.ftype==='ladder'||to.ftype==='acid'?' '+nm(from)+'G.connect('+nm(to)+'B.detune);':''))}
        else if(to.type==='vco')L.push(nm(from)+'G.gain.value = 60; '+nm(from)+'G.connect('+nm(to)+'.frequency);  // vibrato');
        else if(to.type==='vca'||to.type==='mix')L.push(nm(from)+'G.gain.value = 0.25; '+nm(from)+'G.connect('+nm(to)+'.gain);  // tremolo');
        else if(to.type==='del')L.push(nm(from)+'G.gain.value = 0.008; '+nm(from)+'G.connect('+nm(to)+'D.delayTime);  // flanging');
        else L.push('// LFO → '+DEFS[to.type].name+': exercise — pick a parameter to modulate');
      }else if(from.type==='env'){
        L.push('// Envelope → '+DEFS[to.type].name+' (A '+from.vals[0]+' ms, D '+from.vals[1]+' ms, S '+from.vals[2]+' %, R '+from.vals[3]+' ms)');
        L.push('// exercise: on a key press, ramp the target with linearRampToValueAtTime (attack)');
        L.push('// then setTargetAtTime(sustain, t+A, D/3); on release setTargetAtTime(min, t, R/3)');
      }else if(from.type==='det'&&to.type==='vco'){
        L.push(nm(to)+'.frequency.value *= 2**('+from.vals[0]+'/1200);  // detune '+from.vals[0]+' cents');
      }else if(CONTROL[from.type]){
        L.push('// '+DEFS[from.type].name+' → '+DEFS[to.type].name+': note/control routing — exercise for the reader');
      }else if(audioSrc[from.type]||from.type==='out'){
        if(to.type==='out')L.push(outName(from)+'.connect('+nm(to)+');');
        else if(audioSrc[to.type])L.push(outName(from)+'.connect('+inName(to)+');');
      }
    });
    let pre='';
    if(needPulse)pre='function pulseWave(duty){\n  const N=32, real=new Float32Array(N+1), imag=new Float32Array(N+1);\n  for (let k=1;k<=N;k++) real[k]=2/(k*Math.PI)*Math.sin(k*Math.PI*duty/100);\n  return ctx.createPeriodicWave(real,imag);\n}\n';
    const code=pre+L.join('\n');
    const html='<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Ejected patch</title></head>\n<body style="font-family:system-ui;padding:2rem">\n<h1>Your patch, as code</h1>\n<p>Press start, then read the source — every block on the bench is a few lines here.</p>\n<button id="go" style="font-size:1.2rem;padding:.5rem 1.5rem">Start</button>\n<pre style="background:#f4f5f7;padding:1rem;border-radius:8px;overflow:auto">'+code.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>\n<script>\ndocument.getElementById("go").addEventListener("click",()=>{\n'+code+'\n},{once:true});\n<\/script>\n</body></html>';
    // show the code right here; offer copy + download
    const p=openPanel('<h3>Your patch, as code</h3>'
      +'<p>Every block on the bench is a few lines below. Copy it, or download it as a runnable page.</p>'
      +'<div class="coderow"><button class="pad codecopy">Copy code</button><button class="pad codedl">Download page</button><span class="codeerr"></span></div>'
      +'<pre class="ejectpre"></pre>');
    p.querySelector('.ejectpre').textContent=code;
    p.querySelector('.codecopy').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(code);p.querySelector('.codeerr').textContent='copied'}
      catch(e){p.querySelector('.codeerr').textContent='copy blocked — select the text instead'}
    });
    p.querySelector('.codedl').addEventListener('click',()=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
      a.download='my-patch-ejected.html';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    });
  }
  document.getElementById('eject12').addEventListener('click',ejectCode);

  /* module documentation panel */
  function openDoc(t){
    const d=DOCS[t];if(!d)return;
    openPanel('<h3>'+d.title+'</h3>'
      +'<h4>What it does</h4><p>'+d.what+'</p>'
      +(d.math?'<h4>The maths</h4><p class="mathblk">'+d.math+'</p>':'')
      +(FIGS[t]?'<h4>In pictures</h4>'+(matchMedia('(prefers-reduced-motion: reduce)').matches?FIGS[t].replace(/<animateTransform[^>]*\/>/g,''):FIGS[t]):'')
      +(d.code?'<h4>The code — this module is literally this</h4><pre>'+d.code+'</pre>':''));
  }
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    const p=document.getElementById('docpanel');if(!p)return;
    if(codeEdit&&document.activeElement===codeEdit.ta){   // first Escape: leave the editor, keeping the draft
      codeEdit.b.code=codeEdit.ta.value;
      p.querySelector('.docclose').focus();
      return;
    }
    closePanel();                                        // second Escape: close the panel
  });

  /* starter bench: the classic chain, unwired — placed proportionally so narrow screens keep all blocks visible.
     Skipped when a #preset= deep link already filled the bench. */
  if(!blocks.length){
    const pw=Math.max(340,patch.clientWidth);
    addBlock('vco',Math.round(pw*0.04),40);
    addBlock('vcf',Math.round(Math.min(pw*0.38,pw-330)),170);
    addBlock('out',Math.round(pw*0.96-160),60);
  }
})();
