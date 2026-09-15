(function(root){
  'use strict';

  const VERSION='rr-presentation-v036';
  let installed=false,lastResult=null,lastMetric='',lastW=0,lastH=0;

  function scanner(){return root.SurfaceScanLayerV035||root.SurfaceScanLayerV034||root.SurfaceScanLayerV033||null;}
  function finite(v){return Number.isFinite(v);}
  function currentMetric(){
    const raw=document.getElementById('metric')?.value||'';
    return raw.replace(/^(sr|fr):/,'');
  }
  function metricLabel(metric){
    const sel=document.getElementById('metric');
    const text=sel?.selectedOptions?.[0]?.textContent;
    if(text)return text.replace(/^SR · |^FR · /,'');
    return String(metric||'Performance').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  function regionMetric(rr,r,preferred){
    const metric=r?.metrics?.[preferred]?preferred:rr?.performance_metrics?.[0];
    return {metric,m:r?.metrics?.[metric]||null};
  }
  function boundaryDrop(rr,r,preferred){
    const {m}=regionMetric(rr,r,preferred);
    return finite(m?.boundary_mean_normalized_drop)?m.boundary_mean_normalized_drop:0;
  }
  function topRegions(rr,preferred,limit=5){
    return [...(rr?.regions||[])].sort((a,b)=>{
      const d=boundaryDrop(rr,b,preferred)-boundaryDrop(rr,a,preferred);
      return Math.abs(d)>1e-12?d:b.cell_count-a.cell_count;
    }).slice(0,limit);
  }
  function outlineAlpha(rr,rid,preferred){
    const regions=rr?.regions||[];
    const max=Math.max(0,...regions.map(r=>boundaryDrop(rr,r,preferred)));
    const r=regions[rid];
    if(!r)return .45;
    if(max<=1e-12)return .55;
    const t=Math.max(0,Math.min(1,boundaryDrop(rr,r,preferred)/max));
    return .22+.78*Math.sqrt(t);
  }

  function largestScreenFragment(regionId,rid,rows,cols){
    const N=regionId.length,seen=new Uint8Array(N),queue=new Int32Array(N);
    let best=null;
    for(let start=0;start<N;start++){
      if(seen[start]||regionId[start]!==rid)continue;
      let h=0,t=0;queue[t++]=start;seen[start]=1;
      const cells=[];let sumR=0,sumC=0,minR=Infinity,maxR=-1,minC=Infinity,maxC=-1;
      while(h<t){
        const i=queue[h++],r=Math.floor(i/cols),c=i-r*cols;
        cells.push(i);sumR+=r;sumC+=c;minR=Math.min(minR,r);maxR=Math.max(maxR,r);minC=Math.min(minC,c);maxC=Math.max(maxC,c);
        const ns=[];
        if(c>0)ns.push(i-1);if(c<cols-1)ns.push(i+1);if(r>0)ns.push(i-cols);if(r<rows-1)ns.push(i+cols);
        for(const n of ns)if(!seen[n]&&regionId[n]===rid){seen[n]=1;queue[t++]=n;}
      }
      if(!best||cells.length>best.cells.length)best={cells,sumR,sumC,minR,maxR,minC,maxC};
    }
    if(!best)return null;
    const cr=best.sumR/best.cells.length,cc=best.sumC/best.cells.length;
    let cell=best.cells[0],dist=Infinity;
    for(const i of best.cells){const r=Math.floor(i/cols),c=i-r*cols,d=(r-cr)*(r-cr)+(c-cc)*(c-cc);if(d<dist){dist=d;cell=i;}}
    return {...best,cell};
  }

  function renderOverlay(api,result,rr){
    const surface=root.activeSurface;if(!surface||!rr)return;
    const overlay=document.getElementById('scanLayerOverlay'),heat=document.getElementById('heat');
    if(!overlay||!heat)return;
    if(overlay.width!==heat.width)overlay.width=heat.width;
    if(overlay.height!==heat.height)overlay.height=heat.height;
    const rows=surface.rows,cols=surface.cols,c=overlay.getContext('2d'),mask=result.mask,config=api.config||{};
    const showOnly=!!config.display?.show_matches_only,dim=!!config.display?.dim_nonpassing;
    c.clearRect(0,0,overlay.width,overlay.height);

    if(showOnly||dim){
      const off=document.createElement('canvas');off.width=cols;off.height=rows;
      const oc=off.getContext('2d'),im=oc.createImageData(cols,rows);
      for(let i=0;i<mask.length;i++)if(!mask[i]){
        const p=i*4;im.data[p]=4;im.data[p+1]=7;im.data[p+2]=10;im.data[p+3]=showOnly?238:158;
      }
      oc.putImageData(im,0,0);
      c.save();c.imageSmoothingEnabled=false;c.drawImage(off,0,0,overlay.width,overlay.height);c.restore();
    }

    const sx=overlay.width/cols,sy=overlay.height/rows,d=devicePixelRatio||1,preferred=currentMetric();
    c.save();c.setLineDash([]);c.lineWidth=1*d;c.lineCap='butt';c.lineJoin='miter';
    for(let i=0;i<rr.mask.length;i++){
      if(!rr.mask[i])continue;
      const r=Math.floor(i/cols),col=i-r*cols,id=rr.regionId[i];
      const x0=col*sx,x1=(col+1)*sx,y0=r*sy,y1=(r+1)*sy;
      c.strokeStyle=`rgba(92,210,255,${outlineAlpha(rr,id,preferred)})`;
      c.beginPath();
      if(col===0||!rr.mask[i-1]||rr.regionId[i-1]!==id){c.moveTo(x0,y0);c.lineTo(x0,y1);}
      if(col===cols-1||!rr.mask[i+1]||rr.regionId[i+1]!==id){c.moveTo(x1,y0);c.lineTo(x1,y1);}
      if(r===0||!rr.mask[i-cols]||rr.regionId[i-cols]!==id){c.moveTo(x0,y0);c.lineTo(x1,y0);}
      if(r===rows-1||!rr.mask[i+cols]||rr.regionId[i+cols]!==id){c.moveTo(x0,y1);c.lineTo(x1,y1);}
      c.stroke();
    }

    const top=topRegions(rr,preferred,5);
    c.font=`600 ${9*d}px Inter,system-ui,sans-serif`;c.textAlign='center';c.textBaseline='middle';
    for(const region of top){
      const rid=region.region_id-1,frag=largestScreenFragment(rr.regionId,rid,rows,cols);if(!frag)continue;
      const text=`R${region.region_id}`,tw=c.measureText(text).width,pad=4*d,h=14*d,w=tw+pad*2;
      const bw=(frag.maxC-frag.minC+1)*sx,bh=(frag.maxR-frag.minR+1)*sy;
      if(bw<w+2*d||bh<h+2*d)continue;
      const rr0=Math.floor(frag.cell/cols),cc=frag.cell-rr0*cols,x=(cc+.5)*sx,y=(rr0+.5)*sy;
      c.fillStyle='rgba(8,13,18,.88)';c.fillRect(x-w/2,y-h/2,w,h);
      c.strokeStyle='rgba(92,210,255,.85)';c.lineWidth=1*d;c.strokeRect(x-w/2,y-h/2,w,h);
      c.fillStyle='rgba(235,247,252,.98)';c.fillText(text,x,y+.25*d);
    }
    c.restore();
  }

  function injectStyle(){
    if(document.getElementById('rrPresentationV036Style'))return;
    const s=document.createElement('style');s.id='rrPresentationV036Style';s.textContent=`
      .sa-rr-v036-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:5px}.sa-rr-v036-sub{color:#7f8c98}.sa-rr-v036-table{margin-top:7px;border:1px solid #26313d;border-radius:6px;overflow:hidden}.sa-rr-v036-row{display:grid;grid-template-columns:42px 52px 78px 72px 62px minmax(112px,1fr);gap:5px;align-items:center;padding:5px 6px;border-top:1px solid #202a34}.sa-rr-v036-row:first-child{border-top:0}.sa-rr-v036-row.head{color:#6f7d89;font-size:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;background:#0d141c}.sa-rr-v036-row.data{color:#b9c5cf}.sa-rr-v036-row.data b{color:#eef4f8}.sa-rr-v036-more{margin-top:5px;color:#71808f}.sa-rr-v036-key{margin-top:5px;color:#82919e}.sa-rr-v036-key strong{color:#a9bac8;font-weight:700}
    `;document.head.appendChild(s);
  }

  function enhanceMenu(result,rr){
    const box=document.querySelector('.sa-scan-regional');if(!box||box.dataset.rrv036==='1')return;
    const preferred=currentMetric(),top=topRegions(rr,preferred,5),metric=top.length?regionMetric(rr,top[0],preferred).metric:(rr.performance_metrics?.[0]||preferred);
    const total=(rr.regions||[]).reduce((a,r)=>a+(r.cell_count||0),0);
    box.dataset.rrv036='1';
    box.innerHTML='';
    const head=document.createElement('div');head.className='sa-rr-v036-head';
    const left=document.createElement('b');left.textContent='Regional Robustness';
    const right=document.createElement('span');right.className='sa-rr-v036-sub';right.textContent=`${rr.regions.length.toLocaleString()} performance region${rr.regions.length===1?'':'s'} · ${total.toLocaleString()} qualifying cells`;
    head.append(left,right);box.appendChild(head);
    const key=document.createElement('div');key.className='sa-rr-v036-key';key.innerHTML=`Outline intensity = <strong>boundary deterioration</strong> · stronger line = larger ${metricLabel(metric)} drop just outside the region.`;box.appendChild(key);

    const table=document.createElement('div');table.className='sa-rr-v036-table';
    const header=document.createElement('div');header.className='sa-rr-v036-row head';
    for(const t of ['Region','Cells','Consistency','Exposure','Depth','Boundary deterioration']){const s=document.createElement('span');s.textContent=t;header.appendChild(s);}table.appendChild(header);
    for(const r of top){
      const {m}=regionMetric(rr,r,preferred),row=document.createElement('div');row.className='sa-rr-v036-row data';
      const depth=r.boundaryless?'∞':finite(r.mean_depth)?r.mean_depth.toFixed(1):'—';
      const sim=finite(m?.interior_similarity)?`${(m.interior_similarity*100).toFixed(0)}%`:'—';
      const exposure=finite(r.boundary_exposure)?`${(r.boundary_exposure*100).toFixed(0)}%`:'—';
      const norm=finite(m?.boundary_mean_normalized_drop)?`${m.boundary_mean_normalized_drop.toFixed(2)}×`:'—';
      const raw=finite(m?.boundary_mean_raw_drop)?m.boundary_mean_raw_drop:null;
      const drop=raw==null?norm:`${norm} · ${raw.toFixed(3)} raw`;
      const vals=[`R${r.region_id}`,r.cell_count.toLocaleString(),sim,exposure,depth,drop];
      vals.forEach((v,i)=>{const s=document.createElement('span');if(i===0){const b=document.createElement('b');b.textContent=v;s.appendChild(b);}else s.textContent=v;row.appendChild(s);});
      table.appendChild(row);
    }
    box.appendChild(table);
    if(rr.regions.length>top.length){const more=document.createElement('div');more.className='sa-rr-v036-more';more.textContent=`+ ${(rr.regions.length-top.length).toLocaleString()} more region${rr.regions.length-top.length===1?'':'s'}`;box.appendChild(more);}
    box.title='Interior consistency = share of internal semantic-neighbor edges within 10% of the hard-surface scale. Exposure = share of region connections that leave the region. Depth = mean semantic steps from the boundary. Boundary deterioration = mean performance loss when stepping just outside, normalized by the same scale.';
  }

  function sync(){
    const api=scanner();if(!api)return;
    const result=api.result,rr=result?.regionalRobustness||null,overlay=document.getElementById('scanLayerOverlay'),metric=currentMetric();
    if(rr&&overlay){
      const changed=result!==lastResult||metric!==lastMetric||overlay.width!==lastW||overlay.height!==lastH;
      if(changed){renderOverlay(api,result,rr);lastResult=result;lastMetric=metric;lastW=overlay.width;lastH=overlay.height;}
      enhanceMenu(result,rr);
    }else{lastResult=result||null;lastMetric=metric;lastW=overlay?.width||0;lastH=overlay?.height||0;}
  }

  function install(){
    if(installed)return;
    if(!scanner()||typeof root.activeSurface==='undefined'){setTimeout(install,50);return;}
    installed=true;injectStyle();root.SurfaceRrPresentationV036={version:VERSION};
    setInterval(sync,200);sync();
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
