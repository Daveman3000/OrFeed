(function(){
  'use strict';

  function install(){
    const wrap=document.getElementById('scanLayerControl');
    if(!wrap||!window.SurfaceScanLayerV031){setTimeout(install,25);return;}
    const pop=wrap.querySelector('.sa-scan-pop'),button=wrap.querySelector('.sa-scan-btn');
    if(!pop||!button)return;

    const style=document.createElement('style');
    style.textContent=`
      .sa-scan-help{margin:-2px 0 10px;color:#8e9aa7;font-size:10px;line-height:1.4}
      .sa-scan-columns{display:grid;grid-template-columns:120px minmax(150px,1fr) 92px 62px 88px 28px;gap:6px;padding:0 0 4px;color:#697785;font-size:8px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
      @media(max-width:760px){.sa-scan-columns{display:none}}
    `;
    document.head.appendChild(style);

    // The menu re-renders its contents while handling clicks. Stop bubbling here so
    // the document-level outside-click handler never mistakes a detached old button
    // for a click outside the menu.
    pop.addEventListener('click',e=>e.stopPropagation());

    let decorating=false;
    function decorate(){
      if(decorating)return;decorating=true;
      try{
        const head=pop.querySelector('.sa-scan-head');
        if(head&&!pop.querySelector('.sa-scan-help')){
          const help=document.createElement('div');
          help.className='sa-scan-help';
          help.textContent='Keep configurations that pass every rule below. Rules can use Performance, Structural Robustness, or Facet Replication.';
          head.insertAdjacentElement('afterend',help);
        }
        const master=pop.querySelector('.sa-scan-master');
        if(master){
          const text=[...master.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
          if(text)text.nodeValue=' Scan active';
        }
        const section=[...pop.querySelectorAll('.sa-scan-section')].find(x=>x.textContent.includes('CRITERIA'));
        if(section)section.textContent='MATCH ALL RULES';
        const first=pop.querySelector('.sa-scan-row');
        if(first&&!pop.querySelector('.sa-scan-columns')){
          const h=document.createElement('div');h.className='sa-scan-columns';
          for(const t of ['Source','Metric','Basis','Rule','Threshold','']){const s=document.createElement('span');s.textContent=t;h.appendChild(s);}
          first.parentNode.insertBefore(h,first);
        }
        const apply=pop.querySelector('[data-act="apply"]');if(apply)apply.textContent='Apply & Run';
      }finally{decorating=false;}
    }

    const observer=new MutationObserver(()=>queueMicrotask(decorate));
    observer.observe(pop,{childList:true,subtree:true});

    button.addEventListener('click',()=>setTimeout(()=>{
      if(!wrap.classList.contains('open'))return;
      // New/empty scan: expose the actual rule builder immediately instead of
      // presenting an unexplained blank state.
      if(!pop.querySelector('.sa-scan-row')){
        const add=pop.querySelector('.sa-scan-add');
        if(add){
          add.click();
          const active=pop.querySelector('.sa-scan-master input[type="checkbox"]');
          if(active&&!active.checked){active.checked=true;active.dispatchEvent(new Event('change',{bubbles:true}));}
        }
      }
      decorate();
    },0));

    decorate();
  }
  install();
})();