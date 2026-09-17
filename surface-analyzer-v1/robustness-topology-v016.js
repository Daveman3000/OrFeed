(function(root){
  'use strict';
  const CONTEXT_PARAMS=new Set(['london_range_min_points','london_range_min_atr_percent']);
  const TM_PARAMS=new Set(['maximum_trades_per_day','stop_london_range_percent','fixed_target_allocation_percent','fixed_target_london_range_multiple']);

  // Mirrors surface-analyzer/volspike.study_descriptor.v1.json.
  // maximum_trades_per_day is intentionally ORDERED, not regime.
  const DESCRIPTOR={
    descriptor_schema_version:1,
    descriptor_version:'1.0.1',
    study_id:'volspike',
    parameters:[
      {id:'london_range_mode',display_name:'London Range Mode',value_type:'enum',topology_role:'regime'},
      {id:'trade_management_mode',display_name:'Trade Management Mode',value_type:'enum',topology_role:'regime'},
      {id:'maximum_trades_per_day',display_name:'Max Trades / Day',value_type:'integer',topology_role:'ordered',ordered_values:[1,2]},
      {id:'london_close_beyond_asia',display_name:'London Close Beyond Asia',value_type:'boolean',topology_role:'facet'},
      {id:'pm_close_mode',display_name:'PM Close Mode',value_type:'enum',topology_role:'facet'},
      {id:'entry_location',display_name:'Entry Location',value_type:'enum',topology_role:'facet'},
      {id:'fixed_target_exit_rule',display_name:'Fixed Target Exit Rule',value_type:'enum',topology_role:'facet',active_when:{op:'in',parameter:'trade_management_mode',values:[0,2]}},
      {id:'london_range_min_points',display_name:'London Range Min Points',value_type:'number',topology_role:'ordered',ordered_values:[150,175,200,225,250,275,300],active_when:{op:'eq',parameter:'london_range_mode',value:0}},
      {id:'london_range_min_atr_percent',display_name:'London Range Min ATR %',value_type:'number',topology_role:'ordered',ordered_values:[20,25,30,35,40,45,50],active_when:{op:'eq',parameter:'london_range_mode',value:1}},
      {id:'stop_london_range_percent',display_name:'Stop London Range %',value_type:'number',topology_role:'ordered',ordered_values:[10,20,30,40,50]},
      {id:'fixed_target_allocation_percent',display_name:'Fixed Target Allocation %',value_type:'number',topology_role:'ordered',ordered_values:[25,37.5,50],active_when:{op:'eq',parameter:'trade_management_mode',value:2}},
      {id:'fixed_target_london_range_multiple',display_name:'Fixed Target London Range Multiple',value_type:'number',topology_role:'ordered',ordered_values:[1,1.25,1.5,1.75,2],active_when:{op:'and',clauses:[{op:'in',parameter:'trade_management_mode',values:[0,2]},{op:'eq',parameter:'fixed_target_exit_rule',value:1}]}}
    ]
  };

  function activeWhen(rule,params){
    if(!rule)return true;
    if(rule.op==='eq')return params[rule.parameter]===rule.value;
    if(rule.op==='in')return rule.values.includes(params[rule.parameter]);
    if(rule.op==='and')return rule.clauses.every(c=>activeWhen(c,params));
    throw new Error(`Unsupported active_when op ${rule.op}`);
  }
  function activeDefs(descriptor,params,role){return descriptor.parameters.filter(p=>p.topology_role===role&&activeWhen(p.active_when,params));}
  function orderedIndex(def,value){
    const i=(def.ordered_values||[]).findIndex(v=>Object.is(v,value)||v===value);
    if(i<0)throw new Error(`${def.id}: value ${value} is not in ordered_values`);return i;
  }
  function valueToken(v){return typeof v==='number'?String(v):JSON.stringify(v);}
  function semanticKey(descriptor,params,override){
    const parts=[];
    for(const def of descriptor.parameters){
      if(!activeWhen(def.active_when,params))continue;
      if(!['regime','facet','ordered'].includes(def.topology_role))continue;
      if(def.topology_role==='ordered'){
        let idx=orderedIndex(def,params[def.id]);if(override&&override.id===def.id)idx=override.index;
        parts.push(`${def.id}#${idx}`);
      }else parts.push(`${def.id}=${valueToken(params[def.id])}`);
    }
    return parts.join('|');
  }
  function hardSurfaceKey(descriptor,params){
    return activeDefs(descriptor,params,'regime').map(d=>`${d.id}=${valueToken(params[d.id])}`).join('|');
  }
  function facetKey(descriptor,params){
    return activeDefs(descriptor,params,'facet').map(d=>`${d.id}=${valueToken(params[d.id])}`).join('|');
  }

  function volspikeParams(row,orig){
    const rangeMode=row>=112?1:0,local=row%112,thresholdIndex=Math.floor(local/16),within=local%16;
    const londonClose=within>=8?1:0,w=within%8,pm=Math.floor(w/2),entry=w%2;
    const stop=[10,20,30,40,50][Math.floor(orig/50)],trades=orig%2===0?1:2,scenario=Math.floor((orig%50)/2);
    let tm,rule=null,multiple=null,allocation=null;
    if(scenario<=5){tm=0;rule=scenario===0?0:1;if(rule===1)multiple=[1,1.25,1.5,1.75,2][scenario-1];}
    else if(scenario===6){tm=1;}
    else{tm=2;const j=scenario-7,allocIndex=Math.floor(j/6),v=j%6;allocation=[25,37.5,50][allocIndex];rule=v===0?0:1;if(rule===1)multiple=[1,1.25,1.5,1.75,2][v-1];}
    const p={
      london_range_mode:rangeMode,
      trade_management_mode:tm,
      maximum_trades_per_day:trades,
      london_close_beyond_asia:londonClose,
      pm_close_mode:pm,
      entry_location:entry,
      stop_london_range_percent:stop
    };
    if(rangeMode===0)p.london_range_min_points=[150,175,200,225,250,275,300][thresholdIndex];
    else p.london_range_min_atr_percent=[20,25,30,35,40,45,50][thresholdIndex];
    if(tm===0||tm===2)p.fixed_target_exit_rule=rule;
    if(tm===2)p.fixed_target_allocation_percent=allocation;
    if((tm===0||tm===2)&&rule===1)p.fixed_target_london_range_multiple=multiple;
    return p;
  }

  function buildVolspikeConfigs(rows,cols,visualOrder){
    const configs=new Array(rows*cols);
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const orig=visualOrder[col],i=row*cols+col;
      configs[i]={id:`${row}:${orig}`,params:volspikeParams(row,orig),displayIndex:i,row,col,outerOrdinal:row,innerOrdinal:orig};
    }
    return configs;
  }

  function buildSemanticGraph(configs,descriptor){
    const N=configs.length,indexByKey=new Map(),nodes=new Array(N),surfaceCells=new Map();
    for(let i=0;i<N;i++){
      const cfg=configs[i],params=cfg.params,key=semanticKey(descriptor,params),hard=hardSurfaceKey(descriptor,params),facet=facetKey(descriptor,params);
      if(indexByKey.has(key))throw new Error(`Duplicate semantic configuration ${key}`);
      indexByKey.set(key,i);
      const ordered=activeDefs(descriptor,params,'ordered').map(def=>({id:def.id,index:orderedIndex(def,params[def.id]),length:def.ordered_values.length,family:CONTEXT_PARAMS.has(def.id)?'context':TM_PARAMS.has(def.id)?'tm':'other'}));
      nodes[i]={...cfg,key,hard,facet,ordered};
      if(!surfaceCells.has(hard))surfaceCells.set(hard,[]);surfaceCells.get(hard).push(i);
    }
    const adj=Array.from({length:N},()=>[]),byParam=Array.from({length:N},()=>Object.create(null));
    let directedEdgeCount=0,missingExpectedDirect=0;
    for(let i=0;i<N;i++){
      const node=nodes[i];
      for(const o of node.ordered){
        const list=byParam[i][o.id]=[];
        for(const delta of [-1,1]){
          const ni=o.index+delta;if(ni<0||ni>=o.length)continue;
          const key=semanticKey(descriptor,node.params,{id:o.id,index:ni}),j=indexByKey.get(key);
          if(j===undefined){missingExpectedDirect++;continue;}
          list.push({to:j,delta});adj[i].push(j);directedEdgeCount++;
        }
      }
    }
    for(let i=0;i<N;i++)for(const j of adj[i]){
      const a=nodes[i],b=nodes[j];
      if(a.hard!==b.hard)throw new Error('Graph edge crosses hard regime');
      if(a.facet!==b.facet)throw new Error('Graph edge crosses facet');
      const aOrd=new Map(a.ordered.map(o=>[o.id,o])),bOrd=new Map(b.ordered.map(o=>[o.id,o]));
      if(aOrd.size!==bOrd.size)throw new Error('Graph edge changes active parameter set');
      let changed=0;
      for(const [id,oa] of aOrd){const ob=bOrd.get(id);if(!ob)throw new Error('Graph edge changes active parameter set');const d=Math.abs(oa.index-ob.index);if(d){if(d!==1)throw new Error('Graph edge skips ordered value');changed++;}}
      if(changed!==1)throw new Error('Graph edge must change exactly one ordered parameter');
    }
    const seen=new Uint8Array(N);let components=0;
    for(let i=0;i<N;i++)if(!seen[i]){components++;const q=[i];seen[i]=1;for(let h=0;h<q.length;h++)for(const j of adj[q[h]])if(!seen[j]){seen[j]=1;q.push(j);}}
    return {descriptor,configs:nodes,adj,byParam,surfaceCells,directedEdgeCount,undirectedEdgeCount:directedEdgeCount/2,missingExpectedDirect,components};
  }

  root.SurfaceTopologyV016={DESCRIPTOR,CONTEXT_PARAMS,TM_PARAMS,activeWhen,activeDefs,buildVolspikeConfigs,buildSemanticGraph};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.SurfaceTopologyV016;
})(typeof window!=='undefined'?window:globalThis);
