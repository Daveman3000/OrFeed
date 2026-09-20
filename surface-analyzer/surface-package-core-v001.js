(function(root,factory){
  const API=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfacePackageCoreV001=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-package-core-v001';
  const DEFAULT_REQUIRED_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
  const DISPLAY_PASSTHROUGH_METRICS=['win_pct'];
  const fail=m=>{throw new Error(m);};
  const token=v=>v==null?'':String(v);

  function eachCsvRow(text,fn){
    let row=[],field='',quoted=false,rowNo=1;
    const ef=()=>{row.push(field);field='';};
    const er=()=>{ef();fn(row,rowNo++);row=[];};
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}
        else field+=c;
      }else if(c==='"')quoted=true;
      else if(c===',')ef();
      else if(c==='\n')er();
      else if(c!=='\r')field+=c;
    }
    if(quoted)fail('Semantic CSV ends inside a quoted field');
    if(field.length||row.length)er();
  }

  function createCsvRowParser(fn){
    let row=[],field='',quoted=false,pendingQuote=false,rowNo=1,finished=false;
    const ef=()=>{row.push(field);field='';};
    const er=()=>{ef();fn(row,rowNo++);row=[];};
    const pushChar=c=>{
      for(;;){
        if(quoted){
          if(pendingQuote){
            if(c==='"'){field+='"';pendingQuote=false;return;}
            quoted=false;pendingQuote=false;
            continue;
          }
          if(c==='"'){pendingQuote=true;return;}
          field+=c;return;
        }
        if(c==='"'){quoted=true;return;}
        if(c===','){ef();return;}
        if(c==='\n'){er();return;}
        if(c!=='\r')field+=c;
        return;
      }
    };
    return {
      push(text){
        if(finished)fail('Semantic CSV parser is already finished');
        for(let i=0;i<text.length;i++)pushChar(text[i]);
      },
      finish(){
        if(finished)fail('Semantic CSV parser is already finished');
        if(quoted){
          if(pendingQuote){quoted=false;pendingQuote=false;}
          else fail('Semantic CSV ends inside a quoted field');
        }
        if(field.length||row.length)er();
        finished=true;
      }
    };
  }

  function parseScalar(s,t){
    if(s==='')return null;
    if(['number','integer','boolean','enum'].includes(t)){
      const v=Number(s);if(!Number.isFinite(v))fail(`Invalid ${t} value ${JSON.stringify(s)}`);return v;
    }
    return s;
  }

  function same(a,b){if(a==null||a==='')return b==null||b==='';return typeof b==='number'?Number(a)===b:String(a)===String(b);}

  function active(rule,p){
    if(!rule||rule==='always')return true;
    if(rule.op==='eq')return same(p[rule.parameter],rule.value);
    if(rule.op==='in')return (rule.values||[]).some(v=>same(p[rule.parameter],v));
    if(rule.op==='and')return (rule.clauses||[]).every(c=>active(c,p));
    fail(`Unsupported active_when rule ${JSON.stringify(rule)}`);
  }

  function validateDescriptor(d){
    if(!d||d.descriptor_schema_version!==1)fail('surface_descriptor.json must use descriptor_schema_version 1');
    if(!d.study_id||!Array.isArray(d.parameters)||!d.layout||!d.results)fail('Descriptor is missing study_id, parameters, layout, or results');
    const ids=new Set();
    for(const p of d.parameters){
      if(!p.id||ids.has(p.id))fail(`Invalid or duplicate parameter id ${p.id}`);ids.add(p.id);
      if(!['regime','ordered','facet'].includes(p.topology_role))fail(`${p.id}: invalid topology_role`);
      if(!Array.isArray(p.values)||!p.values.length)fail(`${p.id}: declared values are required`);
    }
    for(const a of ['x_parameter_order','y_parameter_order'])for(const id of d.layout[a]||[])if(!ids.has(id))fail(`${a}: unknown parameter ${id}`);
    if(!Array.isArray(d.results.metrics)||!d.results.metrics.length)fail('Descriptor must declare results.metrics');
    const support=d.results.support_fields||[];
    if(!Array.isArray(support))fail('Descriptor results.support_fields must be an array when present');
    const resultIds=new Set();
    for(const id of d.results.metrics){
      if(typeof id!=='string'||!id)fail('Descriptor metric ids must be non-empty strings');
      if(resultIds.has(id))fail(`Duplicate descriptor result id ${id}`);
      resultIds.add(id);
    }
    for(const field of support){
      if(!field||typeof field!=='object'||Array.isArray(field))fail('Descriptor support_fields entries must be typed objects');
      if(typeof field.id!=='string'||!field.id)fail('Descriptor support field id must be a non-empty string');
      if(field.type!=='integer')fail(`${field.id}: unsupported support field type ${field.type||'(missing)'}`);
      if(typeof field.role!=='string'||!field.role)fail(`${field.id}: support field role is required`);
      if(resultIds.has(field.id))fail(`Duplicate descriptor result id ${field.id}`);
      resultIds.add(field.id);
    }
    return d;
  }

  function displayPassthroughIds(d){
    const raw=[
      ...(Array.isArray(d?.results?.passthrough_results)?d.results.passthrough_results:[]),
      ...(Array.isArray(d?.passthrough_results)?d.passthrough_results:[])
    ];
    const out=[];
    for(const field of raw){
      const id=typeof field==='string'?field:(field&&typeof field==='object'&&!Array.isArray(field)?field.id:null);
      if(DISPLAY_PASSTHROUGH_METRICS.includes(id)&&!out.includes(id))out.push(id);
    }
    return out;
  }

  const valueMaps=d=>Object.fromEntries(d.parameters.map(p=>[p.id,new Map(p.values.map((v,i)=>[token(v),i]))]));

  function axisSpec(d,axis){
    const order=[...(d.layout[`${axis}_parameter_order`]||[])],slots=(d.layout.virtual_slots||[]).filter(s=>s.axis===axis),members=new Set(slots.flatMap(s=>s.parameters||[])),after=new Map();
    for(const s of slots){const a=after.get(s.after)||[];a.push(s);after.set(s.after,a);}
    const spec=[];
    for(const id of order){
      if(!members.has(id))spec.push({kind:'parameter',id});
      for(const s of after.get(id)||[])spec.push({kind:'virtual',id:s.id,parameters:s.parameters||[]});
    }
    return spec;
  }

  function rankFor(sem,spec,maps,defs){
    const out=[];
    for(const it of spec){
      if(it.kind==='parameter'){
        const raw=sem[it.id]??'',def=defs[it.id],on=def?active(def.active_when,sem):raw!=='';
        out.push(!on?-1:(maps[it.id]?.get(raw)??1e9));
      }else{
        let rank=-1,count=0;
        for(const id of it.parameters){
          const raw=sem[id]??'',def=defs[id];if(def&&!active(def.active_when,sem))continue;
          const r=maps[id]?.get(raw);if(r===undefined)fail(`${id}: undeclared value ${raw}`);rank=r;count++;
        }
        if(count!==1)fail(`${it.id}: expected exactly one active parameter, got ${count}`);
        out.push(rank);
      }
    }
    return out;
  }

  function cmpRank(a,b){for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;}
  function signature(sem,ids){return ids.map(id=>`${id}=${sem[id]??''}`).join('|');}

  function buildSemanticSurfaceFromRows(emitRows,descriptor,file={name:'surface.surface.zip',size:0},{requiredMetrics=DEFAULT_REQUIRED_METRICS}={}){
    const d=validateDescriptor(descriptor),params=d.parameters,paramIds=params.map(p=>p.id),paramDefs=Object.fromEntries(params.map(p=>[p.id,p])),maps=valueMaps(d),xIds=d.layout.x_parameter_order||[],yIds=d.layout.y_parameter_order||[],xSpec=axisSpec(d,'x'),ySpec=axisSpec(d,'y'),metricIds=d.results.metrics,passthroughIds=displayPassthroughIds(d).filter(k=>!metricIds.includes(k)),loadedMetricIds=[...metricIds,...passthroughIds],supportDefs=d.results.support_fields||[],supportIds=supportDefs.map(f=>f.id),constants=d.experiment_constants||[],expected=Number(d.provenance?.source_row_count)||0;
    let header=null,col=null,n=0;
    const keys=new Set(),xMap=new Map(),yMap=new Map(),xIdsByRow=[],yIdsByRow=[];
    const metricTmp=Object.fromEntries(loadedMetricIds.map(k=>[k,expected?new Float64Array(expected):[]]));
    const supportTmp=Object.fromEntries(supportIds.map(k=>[k,expected?new Int32Array(expected):[]]));
    const paramTmp=Object.fromEntries(paramIds.map(k=>{const a=expected?new Int16Array(expected):[];if(expected)a.fill(-1);return[k,a];}));

    emitRows((cells,rowNo)=>{
      if(!header){
        header=cells.map(x=>x.trim());col=Object.fromEntries(header.map((name,i)=>[name,i]));
        const req=['analysis_key',...paramIds,...loadedMetricIds,...supportIds,...constants.map(c=>c.id)],missing=req.filter(k=>col[k]===undefined);
        if(missing.length)fail(`Semantic CSV missing required columns: ${missing.join(', ')}`);return;
      }
      if(cells.every(v=>v===''))return;
      if(expected&&n>=expected)fail(`Descriptor provenance expects ${expected} rows, found more`);
      const sem={},typed={},onById={};
      for(const p of params){const raw=cells[col[p.id]]??'';sem[p.id]=raw;typed[p.id]=parseScalar(raw,p.type);}
      for(const p of params){
        const on=active(p.active_when,typed),raw=sem[p.id];onById[p.id]=on;
        if(on&&raw===''&&!maps[p.id].has(''))fail(`Row ${rowNo}: active parameter ${p.id} is blank`);
        if(!on&&raw!=='')fail(`Row ${rowNo}: inactive parameter ${p.id} must be blank`);
        if(on&&!maps[p.id].has(raw))fail(`Row ${rowNo}: ${p.id}=${raw} is outside the declared domain`);
      }
      for(const c of constants){const raw=cells[col[c.id]]??'';if(raw===''||!same(raw,c.value))fail(`Row ${rowNo}: constant ${c.id}=${raw} does not match descriptor value ${c.value}`);}
      const ak=cells[col.analysis_key]??'';if(!ak)fail(`Row ${rowNo}: blank analysis_key`);if(keys.has(ak))fail(`Row ${rowNo}: duplicate analysis_key ${ak}`);keys.add(ak);
      const xs=signature(sem,xIds),ys=signature(sem,yIds);
      let xe=xMap.get(xs);if(!xe){xe={temp:xMap.size,sig:xs,sem:Object.fromEntries(xIds.map(id=>[id,sem[id]])),rank:rankFor(sem,xSpec,maps,paramDefs)};xMap.set(xs,xe);}
      let ye=yMap.get(ys);if(!ye){ye={temp:yMap.size,sig:ys,sem:Object.fromEntries(yIds.map(id=>[id,sem[id]])),rank:rankFor(sem,ySpec,maps,paramDefs)};yMap.set(ys,ye);}
      xIdsByRow[n]=xe.temp;yIdsByRow[n]=ye.temp;
      for(const k of loadedMetricIds){const v=Number(cells[col[k]]);if(!Number.isFinite(v))fail(`Row ${rowNo}: invalid ${k}`);if(expected)metricTmp[k][n]=v;else metricTmp[k].push(v);}
      for(const field of supportDefs){
        const k=field.id,v=Number(cells[col[k]]);
        if(!Number.isFinite(v)||!Number.isInteger(v))fail(`Row ${rowNo}: support field ${k} must be an integer`);
        if(v<-2147483648||v>2147483647)fail(`Row ${rowNo}: support field ${k} is outside Int32 range`);
        if(expected)supportTmp[k][n]=v;else supportTmp[k].push(v);
      }
      for(const p of params){const raw=sem[p.id],v=onById[p.id]?maps[p.id].get(raw):-1;if(expected)paramTmp[p.id][n]=v;else paramTmp[p.id].push(v);}
      n++;
    });

    if(!header)fail('Semantic CSV is empty');
    if(expected&&n!==expected)fail(`Descriptor provenance expects ${expected} rows, got ${n}`);
    const x=[...xMap.values()].sort((a,b)=>cmpRank(a.rank,b.rank)),y=[...yMap.values()].sort((a,b)=>cmpRank(a.rank,b.rank)),cols=x.length,rows=y.length;
    if(rows*cols!==n)fail(`Semantic surface is not a complete rectangle: ${rows} × ${cols} != ${n}`);
    const xr=new Int32Array(x.length),yr=new Int32Array(y.length);x.forEach((v,i)=>xr[v.temp]=i);y.forEach((v,i)=>yr[v.temp]=i);
    const metrics=Object.fromEntries(loadedMetricIds.map(k=>[k,new Float64Array(n)])),supportFields=Object.fromEntries(supportIds.map(k=>[k,new Int32Array(n)])),parameterIndices=Object.fromEntries(paramIds.map(k=>{const a=new Int16Array(n);a.fill(-1);return[k,a];})),physicalIndexByVisual=new Int32Array(n),seen=new Uint8Array(n);
    for(let j=0;j<n;j++){
      const pos=yr[yIdsByRow[j]]*cols+xr[xIdsByRow[j]];if(seen[pos])fail(`Duplicate visual cell ${pos}`);seen[pos]=1;
      for(const k of loadedMetricIds)metrics[k][pos]=metricTmp[k][j];
      for(const k of supportIds)supportFields[k][pos]=supportTmp[k][j];
      for(const id of paramIds)parameterIndices[id][pos]=paramTmp[id][j];
      physicalIndexByVisual[pos]=j;
    }
    if(seen.some(v=>v!==1))fail('Semantic package does not cover every resolved visual cell');
    for(const k of requiredMetrics||[])if(!metrics[k])fail(`Analyzer-required metric ${k} is not declared by this package`);

    return {
      schemaVersion:2,packageVersion:VERSION,packageKind:'semantic-surface-v1',fileName:file.name||'surface.surface.zip',fileSize:file.size||0,loadedAt:new Date().toISOString(),rows,cols,
      jobId:d.provenance?.job_id??null,runId:d.provenance?.run_id??null,generationId:d.provenance?.data_generation_id??null,buildId:d.provenance?.backtester_build??null,
      metrics,supportFields,semanticDescriptor:d,semanticParameterIndices:parameterIndices,semanticAxis:{x:x.map(v=>v.sem),y:y.map(v=>v.sem)},physicalIndexByVisual
    };
  }

  function buildSemanticSurface(text,descriptor,file={name:'surface.surface.zip',size:0},{requiredMetrics=DEFAULT_REQUIRED_METRICS}={}){
    return buildSemanticSurfaceFromRows(fn=>eachCsvRow(text,fn),descriptor,file,{requiredMetrics});
  }

  function buildSemanticSurfaceFromTextChunks(chunks,descriptor,file={name:'surface.surface.zip',size:0},{requiredMetrics=DEFAULT_REQUIRED_METRICS}={}){
    return buildSemanticSurfaceFromRows(fn=>{
      const parser=createCsvRowParser(fn);
      for(const chunk of chunks)parser.push(chunk);
      parser.finish();
    },descriptor,file,{requiredMetrics});
  }

  return {VERSION,DEFAULT_REQUIRED_METRICS,active,validateDescriptor,buildSemanticSurface,buildSemanticSurfaceFromTextChunks,eachCsvRow,createCsvRowParser};
});
