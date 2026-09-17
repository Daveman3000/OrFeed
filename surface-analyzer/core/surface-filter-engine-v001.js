(function(root,factory){
  'use strict';
  const API=factory();
  if(root)root.SurfaceFilterEngineV001=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-filter-engine-v001';
  const token=v=>v==null?'':String(v);
  const defsById=d=>Object.fromEntries((d?.parameters||[]).map(p=>[p.id,p]));

  function axisIds(surface){
    const layout=surface?.semanticDescriptor?.layout||{};
    return {
      x:[...(layout.x_parameter_order||[])],
      y:[...(layout.y_parameter_order||[])]
    };
  }

  function normalizeFilterSpec(surface,spec={}){
    if(!surface?.semanticDescriptor)throw new Error('Semantic surface is required.');
    const defs=defsById(surface.semanticDescriptor),axes=axisIds(surface),allowed=new Set([...axes.y,...axes.x]),out={};
    for(const def of surface.semanticDescriptor.parameters||[]){
      if(!allowed.has(def.id))continue;
      const count=(def.values||[]).length;
      if(!count)continue;
      const raw=spec?.[def.id];
      const values=raw instanceof Set?[...raw]:Array.isArray(raw)?raw:Array.from({length:count},(_,i)=>i);
      const normalized=[...new Set(values.filter(i=>Number.isInteger(i)&&i>=0&&i<count))].sort((a,b)=>a-b);
      if(!normalized.length)throw new Error(`Filter for ${def.id} removes every declared value.`);
      out[def.id]=normalized;
    }
    return out;
  }

  function activeFilters(surface,spec={}){
    if(!surface?.semanticDescriptor)return false;
    const defs=defsById(surface.semanticDescriptor),normalized=normalizeFilterSpec(surface,spec);
    for(const [id,values] of Object.entries(normalized)){
      const count=(defs[id]?.values||[]).length;
      if(count&&values.length<count)return true;
    }
    return false;
  }

  function passEntry(sem,ids,defs,selection){
    for(const id of ids){
      const raw=sem?.[id];
      if(raw==null||raw==='')continue;
      const def=defs[id],selected=selection[id];
      if(!def||!selected)continue;
      const idx=(def.values||[]).findIndex(v=>token(v)===token(raw));
      if(idx>=0&&!selected.has(idx))return false;
    }
    return true;
  }

  function applySurfaceFilter(source,spec={}){
    if(!source?.semanticDescriptor)return source;
    const normalized=normalizeFilterSpec(source,spec);
    if(!activeFilters(source,normalized))return source;

    const defs=defsById(source.semanticDescriptor),axes=axisIds(source),selection={};
    for(const [id,values] of Object.entries(normalized))selection[id]=new Set(values);

    const xAxis=source.semanticAxis?.x||[],yAxis=source.semanticAxis?.y||[];
    if(xAxis.length!==source.cols||yAxis.length!==source.rows)throw new Error('Semantic axis dimensions do not match surface rows/cols.');

    const keepX=[],keepY=[];
    for(let c=0;c<xAxis.length;c++)if(passEntry(xAxis[c],axes.x,defs,selection))keepX.push(c);
    for(let r=0;r<yAxis.length;r++)if(passEntry(yAxis[r],axes.y,defs,selection))keepY.push(r);
    if(!keepX.length||!keepY.length)throw new Error('Filter removes every configuration. Keep at least one value on each axis.');

    const oldCols=source.cols,cols=keepX.length,rows=keepY.length,n=rows*cols,metrics={},supportFields={},params={};
    for(const [key] of Object.entries(source.metrics||{}))metrics[key]=new Float64Array(n);
    for(const [key] of Object.entries(source.supportFields||{}))supportFields[key]=new Int32Array(n);
    for(const [key] of Object.entries(source.semanticParameterIndices||{})){
      const values=new Int16Array(n);values.fill(-1);params[key]=values;
    }

    let p=0;
    for(const r of keepY)for(const c of keepX){
      const old=r*oldCols+c;
      for(const [key,values] of Object.entries(source.metrics||{}))metrics[key][p]=values[old];
      for(const [key,values] of Object.entries(source.supportFields||{}))supportFields[key][p]=values[old];
      for(const [key,values] of Object.entries(source.semanticParameterIndices||{}))params[key][p]=values[old];
      p++;
    }

    return {
      ...source,
      rows,
      cols,
      metrics,
      supportFields,
      semanticParameterIndices:params,
      semanticAxis:{
        x:keepX.map(i=>xAxis[i]),
        y:keepY.map(i=>yAxis[i])
      },
      surfaceFilter:{
        active:true,
        sourceConfigs:source.rows*source.cols,
        visibleConfigs:n
      }
    };
  }

  return {VERSION,axisIds,normalizeFilterSpec,activeFilters,applySurfaceFilter};
});
