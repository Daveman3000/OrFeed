(function(root,factory){
  const API=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceFilterCoreV001=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-filter-core-v001';
  const token=v=>v==null?'':String(v);
  const defsById=d=>Object.fromEntries((d?.parameters||[]).map(p=>[p.id,p]));
  const axisIds=surface=>{
    const layout=surface?.semanticDescriptor?.layout||{};
    return {x:[...(layout.x_parameter_order||[])],y:[...(layout.y_parameter_order||[])]};
  };

  function allowedSet(filterSpec,id){
    const raw=filterSpec?.[id];
    if(raw==null)return null;
    if(raw instanceof Set)return raw;
    if(Array.isArray(raw))return new Set(raw);
    throw new Error(`${id}: filter selection must be an array or Set of declared value indices.`);
  }

  function hasActiveFilters(surface,filterSpec){
    if(!surface?.semanticDescriptor||!filterSpec)return false;
    const defs=defsById(surface.semanticDescriptor),axes=axisIds(surface),allowed=new Set([...axes.x,...axes.y]);
    for(const id of allowed){
      const def=defs[id],set=allowedSet(filterSpec,id);
      if(!def||!set)continue;
      const n=(def.values||def.ordered_values||[]).length;
      if(n&&set.size<n)return true;
    }
    return false;
  }

  function passEntry(sem,ids,defs,filterSpec){
    for(const id of ids){
      const raw=sem?.[id];
      if(raw==null||raw==='')continue;
      const def=defs[id],set=allowedSet(filterSpec,id);
      if(!def||!set)continue;
      const values=def.values||def.ordered_values||[];
      const idx=values.findIndex(v=>token(v)===token(raw));
      if(idx>=0&&!set.has(idx))return false;
    }
    return true;
  }

  function applySurfaceFilter(source,filterSpec){
    if(!source?.semanticDescriptor||!hasActiveFilters(source,filterSpec))return source;
    const defs=defsById(source.semanticDescriptor),axes=axisIds(source),xAxis=source.semanticAxis?.x||[],yAxis=source.semanticAxis?.y||[];
    const keepX=[],keepY=[];
    for(let c=0;c<xAxis.length;c++)if(passEntry(xAxis[c],axes.x,defs,filterSpec))keepX.push(c);
    for(let r=0;r<yAxis.length;r++)if(passEntry(yAxis[r],axes.y,defs,filterSpec))keepY.push(r);
    if(!keepX.length||!keepY.length)throw new Error('Filter removes every configuration. Keep at least one value on each axis.');

    const oldCols=source.cols,cols=keepX.length,rows=keepY.length,n=rows*cols,metrics={},supportFields={},params={};
    for(const [k] of Object.entries(source.metrics||{}))metrics[k]=new Float64Array(n);
    for(const [k] of Object.entries(source.supportFields||{}))supportFields[k]=new Int32Array(n);
    for(const [k] of Object.entries(source.semanticParameterIndices||{})){const a=new Int16Array(n);a.fill(-1);params[k]=a;}

    let p=0;
    for(const r of keepY)for(const c of keepX){
      const old=r*oldCols+c;
      for(const [k,a] of Object.entries(source.metrics||{}))metrics[k][p]=a[old];
      for(const [k,a] of Object.entries(source.supportFields||{}))supportFields[k][p]=a[old];
      for(const [k,a] of Object.entries(source.semanticParameterIndices||{}))params[k][p]=a[old];
      p++;
    }

    return {
      ...source,
      rows,cols,metrics,supportFields,semanticParameterIndices:params,
      semanticAxis:{x:keepX.map(i=>xAxis[i]),y:keepY.map(i=>yAxis[i])},
      surfaceFilter:{active:true,sourceConfigs:source.rows*source.cols,visibleConfigs:n}
    };
  }

  function normalizeFilterSpec(filterSpec){
    const out={};
    for(const [id] of Object.entries(filterSpec||{})){
      const set=allowedSet(filterSpec,id);
      out[id]=[...set].sort((a,b)=>a-b);
    }
    return out;
  }

  return {VERSION,applySurfaceFilter,hasActiveFilters,normalizeFilterSpec};
});
