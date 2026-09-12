(()=>{
  const ROWS_EXACT=224,COLS_EXACT=250,N_EXACT=ROWS_EXACT*COLS_EXACT;
  let exact=null;

  function norm64(text){
    let s=text.replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/]/g,'');
    if(!s)throw new Error('empty exact-value payload');
    const rem=s.length%4;if(rem)s+='='.repeat(4-rem);
    return s;
  }
  async function fetchPart(i){
    const name=`data/r_total_raw_v009_${String(i).padStart(2,'0')}.part`;
    const urls=[`${name}?v=009`,`https://raw.githubusercontent.com/Daveman3000/OrFeed/gh-pages/surface-analyzer/${name}?v=009`];
    const errors=[];
    for(const url of urls){
      try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}
      catch(e){errors.push(e.message);}
    }
    throw new Error(errors.join(' · fallback: '));
  }
  async function loadExact(){
    let b64='';
    for(let i=0;i<8;i++)b64+=await fetchPart(i);
    const bin=atob(norm64(b64)),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
    if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DecompressionStream.');
    const ds=new DecompressionStream('deflate');
    const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    const buf=new Uint8Array(ab),state={p:0};
    function readVarint(){
      let u=0,shift=0,b;
      do{
        if(state.p>=buf.length)throw new Error('Exact raw payload truncated');
        b=buf[state.p++];u+=(b&127)*2**shift;shift+=7;
      }while(b&128);
      return u;
    }
    const unzig=u=>(u>>>1)^-(u&1);
    const totalCents=new Int32Array(N_EXACT);let prev=0;
    for(let i=0;i<N_EXACT;i++){prev+=unzig(readVarint());totalCents[i]=prev;}
    if(state.p+N_EXACT>buf.length)throw new Error('Exact raw trades truncated');
    const trades=buf.slice(state.p,state.p+N_EXACT);state.p+=N_EXACT;
    const rMilli=new Int32Array(N_EXACT);
    for(let i=0;i<N_EXACT;i++){
      const residual=unzig(readVarint()),pred=Math.trunc(totalCents[i]*10/trades[i]);
      rMilli[i]=pred+residual;
    }
    if(state.p!==buf.length)throw new Error(`Exact raw payload has ${buf.length-state.p} trailing bytes`);
    exact={totalCents,rMilli};
  }
  function formatExact(key,idx){
    if(!exact)return null;
    if(key==='r_per_trade')return (exact.rMilli[idx]/1000).toLocaleString(undefined,{minimumFractionDigits:3,maximumFractionDigits:3});
    if(key==='total_r')return (exact.totalCents[idx]/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    return null;
  }
  const heat=document.getElementById('heat'),metric=document.getElementById('metric'),hoverBox=document.getElementById('hover');
  heat.addEventListener('mousemove',e=>{
    const key=metric.value;if(key!=='r_per_trade'&&key!=='total_r')return;
    const r=heat.getBoundingClientRect(),col=Math.max(0,Math.min(COLS_EXACT-1,Math.floor((e.clientX-r.left)/r.width*COLS_EXACT))),row=Math.max(0,Math.min(ROWS_EXACT-1,Math.floor((e.clientY-r.top)/r.height*ROWS_EXACT)));
    const v=formatExact(key,row*COLS_EXACT+col);if(v==null)return;
    const last=hoverBox.lastElementChild;if(!last)return;
    const suffix=(last.textContent.match(/·\s*P\d+/)||[])[0];
    last.innerHTML=`Value: <b>${v}${suffix?` · ${suffix.replace(/^·\s*/, '')}`:''}</b>`;
  });
  loadExact().catch(e=>console.error('Exact raw value payload failed:',e));
})();
