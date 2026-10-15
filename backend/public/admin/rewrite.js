"use strict";
window.RewriteModule={mount({root,user,api,openNews,back}){
  let disposed=false,timer,busy=false,job,options,editing=false,revision=0,popup;
  function preview(){if(!popup&&window.RewritePreview)popup=window.RewritePreview.create({user,api,categories:options.categories,openEditor:openNews,regenerate:async()=>{popup.loading();job=await api(`news/rewrite/${job.id}/generate`,{method:'POST',body:JSON.stringify({categoryId:job.categoryId,regenerate:true})});await show();}});return popup;}
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,handler,cls='secondary')=>{const b=el('button',text,cls);b.type='button';b.onclick=handler;return b;};
  const states={queued_capture:'Aguardando captura',capturing:'Buscando matéria e imagem…',captured:'Prévia pronta para conferir',queued_generate:'Aguardando geração',generating:'Reescrevendo e salvando rascunho…',ready:'Rascunho pronto',error:'Precisa de atenção'};
  const writable=['news.create','news.upload'].every(p=>user.permissions.includes(p));
  const pending=j=>['queued_capture','capturing','queued_generate','generating'].includes(j.state);
  function notice(message,error=false){for(const n of root.querySelectorAll('#rewrite-notice,[data-rewrite-feedback]')){n.textContent=message;n.className=(n.hasAttribute('data-rewrite-feedback')?'rewrite-feedback ':'')+(error?'error':'save-status');n.setAttribute('role',error?'alert':'status');n.hidden=!message;}}
  function canLeave(){return!editing||window.confirm('Há alterações na prévia que ainda não foram salvas. Sair sem salvar?');}
  async function action(fn){if(busy)return;busy=true;root.setAttribute('aria-busy','true');try{await fn();}catch(e){notice(e.message,true);popup?.error(e.message);}finally{busy=false;root.setAttribute('aria-busy','false');}}
  async function home(){clearTimeout(timer);job=undefined;editing=false;const seq=++revision;
    root.replaceChildren(el('p','Carregando reescritas…','muted'));
    try{const [history,choices]=await Promise.all([api('news/rewrite'),api('news/options')]);if(disposed||seq!==revision)return;options=choices;
      const header=el('div',undefined,'news-controls');header.append(button('← Matérias',back),el('h2','Reescrita com IA'));const card=el('section',undefined,'card'),body=el('div',undefined,'card-body'),form=el('form');
      form.innerHTML='<label>Link da matéria original<input name="url" type="url" placeholder="https://…" maxlength="2048" required></label><p class="muted">Busque a fonte, confira a prévia e gere um rascunho com texto novo, imagem e créditos. Você publica pelo editor de Notícias.</p><button class="primary" type="submit">Buscar matéria</button>';
      const status=el('p');status.id='rewrite-notice';status.role='status';body.append(form,status);card.append(body);
      if(!writable)for(const field of form.querySelectorAll('input,button'))field.disabled=true;
      form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;action(async()=>{const submit=form.querySelector('button');submit.disabled=true;notice('Iniciando captura…');try{const data=await api('news/rewrite',{method:'POST',body:JSON.stringify({url:form.elements.namedItem('url').value})});job=data.job;await show();if(data.duplicate)notice('Esta origem já está no histórico. Abra a matéria existente ou continue o processamento.');}finally{submit.disabled=false;}});};
      const historyCard=el('section',undefined,'card');const heading=el('div',undefined,'card-header');heading.append(el('h2','Histórico · últimas 50 reescritas'),button('Atualizar',home));historyCard.append(heading);
      if(!history.items.length)historyCard.append(el('p','Nenhuma reescrita por enquanto.','card-body muted'));
      for(const item of history.items){const row=el('div',undefined,'rewrite-history-row'),text=el('div');text.append(el('strong',item.title||item.url),el('p',`${states[item.state]||item.state} · ${new Date(item.createdAt).toLocaleString('pt-BR')}`,'muted'));if(item.error)text.append(el('p',item.error,'error'));else if(item.warning)text.append(el('p',item.warning,'muted'));row.append(text,button(item.newsId?'Abrir matéria':'Ver processamento',()=>action(async()=>{if(item.newsId){openNews(item.newsId);return;}job=await api(`news/rewrite/${item.id}`);show();})));historyCard.append(row);}
      root.replaceChildren(header,card,historyCard);
    }catch(e){if(!disposed)root.replaceChildren(el('p',e.message,'error'),button('Tentar novamente',home));}
  }
  async function poll(){if(disposed||!job)return;const id=job.id,seq=revision;try{const next=await api(`news/rewrite/${id}`);if(disposed||seq!==revision||job?.id!==id)return;job=next;await show();}catch(e){if(disposed||seq!==revision)return;notice(e.message,true);timer=setTimeout(poll,5000);}}
  async function show(){clearTimeout(timer);if(disposed||!job)return;editing=false;
    const header=el('div',undefined,'news-controls');header.append(button('← Reescritas',()=>{if(canLeave())home();}),el('h2',states[job.state]||job.state));
    const card=el('section',undefined,'card'),body=el('div',undefined,'card-body'),status=el('p');status.id='rewrite-notice';status.role='status';body.append(status);
    const link=el('a',job.url);link.href=job.url;link.target='_blank';link.rel='noopener noreferrer';body.append(link);
    if(job.error)body.append(el('p',job.error,'error'));
    if(job.warning)body.append(el('p',job.warning,'save-status'));
    if(job.source){body.append(el('h3',job.source.title),el('p',[job.source.siteName,job.source.author,job.source.publishedAt?new Date(job.source.publishedAt).toLocaleDateString('pt-BR'):null].filter(Boolean).join(' · '),'muted'));
      if(job.image){const image=el('img');image.className='rewrite-cover';image.src=job.image.imageUrl;image.alt=job.image.altText;body.append(image,el('p',job.image.credits||'','muted'));}
      if(job.imageError)body.append(el('p',`Imagem não recuperada: ${job.imageError}`,'error'));
      const details=el('details'),summary=el('summary','Texto extraído');details.append(summary,el('p',job.source.text,'rewrite-source-text'));body.append(details);
    }
    if(pending(job))body.append(el('p','O processamento continua se você sair desta tela. Acompanhe pelo histórico.','muted'));
    else if(job.newsId){body.append(button('Ver matéria reescrita',()=>preview()?.show(job),'primary'),button('Revisar e publicar no editor',()=>openNews(job.newsId),'secondary'));
      if(job.imageError&&writable)body.append(button('Tentar recuperar a imagem',()=>action(async()=>{notice('Recuperando imagem…');job=await api(`news/rewrite/${job.id}/image`,{method:'POST'});show();})));
      if(writable)body.append(button('Gerar nova versão da origem',()=>{if(window.confirm('Criar uma nova versão como outra matéria?'))action(async()=>{job=(await api('news/rewrite',{method:'POST',body:JSON.stringify({url:job.url,newVersion:true})})).job;show();});}));
      if(job.result?.warnings?.length){body.append(el('h3','Pontos para conferir'));for(const warning of job.result.warnings)body.append(el('p',warning,'muted'));}
    }else if(writable){
      const manual=el('details');manual.append(el('summary',job.source?'Editar texto e imagem da prévia':'Colar texto manualmente'));const form=el('form');
      form.innerHTML='<label>Título original<input name="title" maxlength="240" required></label><label>Texto completo<textarea name="text" rows="12" minlength="150" maxlength="60000" required></textarea></label><p class="muted" data-source-count></p><label>URL da imagem (opcional)<input name="imageUrl" type="url" maxlength="2048"></label><label>Crédito da imagem disponível<input name="imageCredit" maxlength="300"></label><button type="submit" class="secondary">Salvar prévia</button>';
      for(const name of ['title','text','imageUrl','imageCredit'])form.elements.namedItem(name).value=job.source?.[name]||'';
      const sourceText=form.elements.namedItem('text'),sourceCount=form.querySelector('[data-source-count]'),max=job.diagnostic?.maxChars||60000;sourceText.maxLength=max;const updateCount=()=>{const length=sourceText.value.length;sourceCount.textContent=`${length.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')} caracteres`;sourceCount.className=length>max?'error':'muted';};updateCount();
      form.oninput=()=>{editing=true;updateCount();};form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;action(async()=>{const data={};for(const name of ['title','text','imageUrl','imageCredit'])data[name]=form.elements.namedItem(name).value;job=await api(`news/rewrite/${job.id}/source`,{method:'PUT',body:JSON.stringify(data)});editing=false;show();notice('Prévia salva. Escolha a categoria e gere o rascunho.');});};manual.append(form);body.append(manual);
      if(job.source){const form=el('form',undefined,'news-controls'),label=el('label','Categoria do Informe67'),select=el('select');select.name='categoryId';select.required=true;const placeholder=el('option','Selecione a categoria');placeholder.value='';select.append(placeholder);for(const category of options.categories){const option=el('option',category.name);option.value=category.id;select.append(option);}select.value=job.categoryId||'';label.append(select);const submit=el('button',job.result?'Salvar resultado como rascunho':'Reescrever com IA','primary');submit.type='submit';form.append(label,submit);form.onsubmit=event=>{event.preventDefault();if(busy)return;if(editing){notice('Salve as alterações da prévia antes de gerar.',true);return;}if(!form.reportValidity())return;action(async()=>{const original=submit.textContent;submit.disabled=true;select.disabled=true;submit.textContent='Enviando para IA…';notice('Solicitando a reescrita. Aguarde…');job.categoryId=select.value;preview()?.loading();try{job=await api(`news/rewrite/${job.id}/generate`,{method:'POST',body:JSON.stringify({categoryId:select.value})});await show();}finally{submit.disabled=false;select.disabled=false;submit.textContent=original;}});};body.append(form);
        if(job.source.imageUrl&&!job.image)body.append(button('Recuperar imagem da prévia',()=>action(async()=>{notice('Recuperando imagem…');job=await api(`news/rewrite/${job.id}/image`,{method:'POST'});show();})));
      }
    }
    const feedback=el('p',undefined,'rewrite-feedback save-status');feedback.setAttribute('data-rewrite-feedback','');feedback.role='status';feedback.hidden=true;body.append(feedback);
    card.append(body);root.replaceChildren(header,card);
    if(job.error)notice(job.error,true);
    else if(job.warning)notice(job.warning,true);
    else if(pending(job))notice(states[job.state]+' O processamento continua se você sair desta tela.');
    else if(job.newsId)notice('Rascunho salvo. Abra o editor para revisar e publicar.');
    if(pending(job))timer=setTimeout(poll,2000);
    if(popup||job.state==='ready')await preview()?.show(job);
  }
  home();return{canLeave,hasChanges:()=>editing,dispose(){disposed=true;clearTimeout(timer);popup?.dispose();revision++;}};
}};
