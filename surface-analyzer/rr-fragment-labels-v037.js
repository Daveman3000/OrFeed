(function(root){
  'use strict';

  const VERSION='rr-fragment-labels-v037';

  function scanner(){return root.SurfaceScanLayerV035||root.SurfaceScanLayerV034||root.SurfaceScanLayerV033||null;}
  function finite(v){return Number.isFinite(v);}
  function currentMetric(){
    const raw=document.getElementById('metric')?.value||'';
    return raw.replace(/^(sr|fr):/,'');
  }
  function regionMetric(rr,r,preferred){
    const metric=r?.metrics?.[preferred]?preferred:rr?.performance_metrics?.[0];
    return r?.metrics?.[metric]||null;
  }
  function boundaryDrop(rr,r,preferred){
    const m=regionMetric(rr,r,preferred);
    return finite(m?.boundary_mean_normalized_drop)?m.boundary_mean_normalized_drop:0;
  }
  function topRegions(rr,preferred,limit=5){
    return [...(rr?.regions||[])].sort((a,b)=>{
      const d=boundaryDrop(rr,b,preferred)-boundaryDrop(rr,a,preferred);
      return Math.abs(d)>1e-12?d:b.cell_count-a.cell_count;
    }).slice(0,limit);
  }

  function screenFragments(regionId,rid,rows,cols){
    const N=regionId.length,seen=new Uint8Array(N),queue=new Int32Array(N),out=[];
    for(let start=0;start<N;start++){
      if(seen[start]||regionId[start]!==rid)continue;
      let h=0,t=0;queue[t++]=start;seen[start]=1;
      const cells=[];let sumR=0,sumC=0,minR=Infinity,maxR=-1,minC=Infinity,maxC=-1;
      while(h<t){
        const i=queue[h++],r=Math.floor(i/cols),c=i-r*cols;
        cells.push(i);sumR+=r;sumC+=c;minR=Math.min(minR,r);maxR=Math.max(maxR,r);minC=Math.min(minC,c);maxC=Math.max(maxC,c);
        if(c>0&&regionId[i-1]===rid&&!seen[i-1]){seen[i-1]=1;queue[t++]=i-1;}
        if(c<cols-1&&regionId[i+1]===rid&&!seen[i+1]){seen[i+1]=1;queue[t++]=i+1;}
        if(r>0&&regionId[i-cols]===rid&&!seen[i-cols]){seen[i-cols]=1;queue[t++]=i-cols;}
        if(r<rows-1&&regionId[i+cols]===rid&&!seen[i+cols]){seen[i+cols]=1;queue[t++]=i+cols;}
      }
      const cr=sumR/cells.length,cc=sumC/cells.length;
      let cell=cells[0],dist=Infinity;
      for(const i of cells){
        const r=Math.floor(i/cols),c=i-r*cols,d=(r-cr)*(r-cr)+(c-cc)*(c-cc);
        if(d<dist){dist=d;cell=i;}
      }
      out.push({cells,cell,minR,maxR,minC,maxC});
    }
    return out.sort((a,b)=>b.cells.length-a.cells.length);
  }

  function upperLeftCell(cells,cols){
    let best=cells[0];
    for(const i of cells){
      const br=Math.floor(best/cols),bc=best-br*cols,r=Math.floor(i/cols),c=i-r*cols;
      if(r<br||(r===br&&c<bc))best=i;
    }
    return best;
  }

  function drawExtraLabels(){
    const api=scanner(),result=api?.result,rr=result?.regionalRobustness;
    if(!rr||typeof activeSurface==='undefined'||!activeSurface)return;
    const overlay=document.getElementById('scanLayerOverlay');if(!overlay)return;
    const rows=activeSurface.rows,cols=activeSurface.cols,sx=overlay.width/cols,sy=overlay.height/rows,d=devicePixelRatio||1,c=overlay.getContext('2d'),preferred=currentMetric();
    const top=topRegions(rr,preferred,5);
    c.save();c.font=`600 ${9*d}px Inter,system-ui,sans-serif`;c.textAlign='center';c.textBaseline='middle';
    for(const region of top){
      const rid=region.region_id-1,fragments=screenFragments(rr.regionId,rid,rows,cols);
      const text=`R${region.region_id}`,tw=c.measureText(text).width,pad=4*d,h=14*d,w=tw+pad*2;
      for(let f=1;f<fragments.length;f++){
        const frag=fragments[f];
        if(frag.cells.length<2)continue;
        const bw=(frag.maxC-frag.minC+1)*sx,bh=(frag.maxR-frag.minR+1)*sy;
        if(bw<w+2*d||bh<h+2*d)continue;
        const anchor=upperLeftCell(frag.cells,cols),r=Math.floor(anchor/cols),col=anchor-r*cols,x=col*sx+w/2+2*d,y=r*sy+h/2+2*d;
        c.fillStyle='rgb(8,13,18)';c.fillRect(x-w/2,y-h/2,w,h);
        c.strokeStyle='rgba(92,210,255,.85)';c.lineWidth=1*d;c.strokeRect(x-w/2,y-h/2,w,h);
        c.fillStyle='rgba(235,247,252,.98)';c.fillText(text,x,y+.25*d);
      }
    }
    c.restore();
  }

  function install(){
    if(!root.SurfaceRrPresentationV036||!scanner()||typeof activeSurface==='undefined'){setTimeout(install,50);return;}
    root.SurfaceRrFragmentLabelsV037={version:VERSION};
    const v=document.querySelector('.version');if(v){v.textContent='v037';v.title='v037 RR fragment labels · presentation v036 · scanner v035 · core v030';}
    setInterval(drawExtraLabels,250);drawExtraLabels();
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
