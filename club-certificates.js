/* Teacher-confirmed certificates. Private records/signatures stay out of browser storage. */
(() => {
  'use strict';
  const W=841.89,H=595.28,BUCKET='club-teacher-signatures';
  const cleanText=value=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim();
  function linesFor(ctx,text,width){
    const lines=[];let line='';
    for(const word of cleanText(text).split(/\s+/)){
      if(ctx.measureText((line?line+' ':'')+word).width<=width){line+=(line?' ':'')+word;continue;}
      if(line){lines.push(line);line='';}
      if(ctx.measureText(word).width<=width){line=word;continue;}
      for(const char of word){if(ctx.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}
    }
    if(line)lines.push(line);return lines;
  }
  function fitted(ctx,text,{x,y,width,size=12,min=7,maxLines=1,bold=false,color='#fff',lineHeight=1.25,multiY=null,height=Infinity}){
    let lines=[];
    for(;size>=min;size-=.5){ctx.font=`${bold?'bold ':''}${size}px Verdana, Arial, sans-serif`;lines=linesFor(ctx,text,width);if(lines.length<=maxLines&&lines.length*size*lineHeight<=height)break;}
    if(lines.length>maxLines)throw Error('This name or course title needs a larger certificate text area. Ask an administrator to shorten its display name.');
    if(lines.length>1&&multiY!==null)y=multiY;
    ctx.fillStyle=color;lines.forEach((line,i)=>ctx.fillText(line,x,y+i*size*lineHeight));return lines.length;
  }
  const completionDate=value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value));
  function drawCertificate(canvas,record,template,signature,{sample=false}={}){
    const scale=3;canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.drawImage(template,0,0,W,H);ctx.textBaseline='alphabetic';
    const name=cleanText(record.recipient_name),course=cleanText(record.course_title),kind=record.completion_kind==='learning'?'learning':'practical';
    fitted(ctx,completionDate(record.completed_at||record.issued_at).toUpperCase(),{x:36,y:31,width:460,size:9,color:'#cacaca'});
    fitted(ctx,name,{x:36,y:113,multiY:80,width:568,size:43,min:7,maxLines:2,bold:true,lineHeight:1.02});
    fitted(ctx,'TURK INNOVATION CLUB',{x:W-221,y:199,width:200,size:10,bold:true});
    fitted(ctx,'CERTIFICATE OF COMPLETION',{x:36,y:241,width:610,size:13,color:'#f4b5b2'});
    fitted(ctx,course,{x:36,y:282,multiY:263,width:735,size:28,min:8,maxLines:3,height:58,bold:true,lineHeight:1.02});
    fitted(ctx,kind==='learning'?'Learning programme':'Practical training programme',{x:37,y:316,width:650,size:12,color:'#d8d8d8'});
    const body=`TURK INNOVATION CLUB certifies that ${name} has successfully completed the ${kind==='learning'?'learning activities and assessment':'practical coursework, project and assessment'} requirements for ${course}, as confirmed by the course teacher.`;
    fitted(ctx,body,{x:37,y:355,width:550,size:12,min:6,maxLines:6,height:85,lineHeight:1.65});
    if(signature){
      ctx.fillStyle='#fff';ctx.fillRect(38,452,215,48);
      const ratio=Math.min(203/signature.width,40/signature.height);
      ctx.drawImage(signature,44+(203-signature.width*ratio)/2,456+(40-signature.height*ratio)/2,signature.width*ratio,signature.height*ratio);
    }else fitted(ctx,'Signature unavailable on this older record',{x:38,y:490,width:260,size:9,color:'#aaa'});
    fitted(ctx,record.teacher_name||'Teacher-confirmed completion',{x:37,y:528,width:310,size:12,bold:true,maxLines:2,min:8});
    fitted(ctx,'COMPLETION RECORD',{x:W-257,y:486,width:225,size:9,color:'#c9c9c9'});
    fitted(ctx,'TIC-'+String(record.public_code).replaceAll('-','').toUpperCase(),{x:W-257,y:509,width:225,size:10,min:7,bold:true});
    fitted(ctx,'WHERE IDEAS BECOME REALITY',{x:37,y:582,width:450,size:8,color:'#ccc'});
    if(record.revoked_at||sample){ctx.save();ctx.translate(W/2,H/2);ctx.rotate(-.22);ctx.globalAlpha=.5;ctx.fillStyle='#f14843';ctx.font='bold 52px Arial';ctx.textAlign='center';ctx.fillText(record.revoked_at?'REVOKED':'SAMPLE',0,0);ctx.restore();}
    return canvas;
  }
  // A standards-based, single-page PDF containing the exact rendered award.
  // No external PDF service receives names, certificates or signatures.
  function makePdf(jpeg,width,height){
    const encode=value=>new TextEncoder().encode(value),parts=[],offsets=[0];let length=0;
    const append=bytes=>{parts.push(bytes);length+=bytes.length;};
    const text=value=>append(encode(value));
    const object=(number,prefix,stream=null)=>{offsets[number]=length;text(number+' 0 obj\n'+prefix);if(stream){text('\nstream\n');append(stream);text('\nendstream');}text('\nendobj\n');};
    text('%PDF-1.4\n');
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    object(4,`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,jpeg);
    const drawing=encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`);object(5,`<< /Length ${drawing.length} >>`,drawing);
    const start=length;text('xref\n0 6\n0000000000 65535 f \n');
    for(let n=1;n<=5;n++)text(String(offsets[n]).padStart(10,'0')+' 00000 n \n');
    text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    const output=new Uint8Array(length);let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output;
  }
  function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>reject(Error('A certificate image could not load. Check your connection and try again.'));img.src=src;});}
  // Keep strokes in canvas coordinates so CSS resizing never clears a signature.
  function createSignaturePad(canvas,onChange=()=>{}){
    canvas.width=900;canvas.height=450;
    const ink=canvas.getContext('2d'),strokes=[];let pointer=null,locked=false;
    const point=event=>{const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};};
    function paint(){
      ink.clearRect(0,0,canvas.width,canvas.height);ink.strokeStyle=ink.fillStyle='#141b2f';ink.lineWidth=7;ink.lineCap=ink.lineJoin='round';
      for(const points of strokes){
        if(points.length===1){ink.beginPath();ink.arc(points[0].x,points[0].y,3.5,0,Math.PI*2);ink.fill();continue;}
        ink.beginPath();ink.moveTo(points[0].x,points[0].y);
        for(let i=1;i<points.length-1;i++)ink.quadraticCurveTo(points[i].x,points[i].y,(points[i].x+points[i+1].x)/2,(points[i].y+points[i+1].y)/2);
        ink.lineTo(points.at(-1).x,points.at(-1).y);ink.stroke();
      }
    }
    function finish(event){if(event.pointerId!==pointer)return;pointer=null;try{canvas.releasePointerCapture(event.pointerId);}catch{}onChange(strokes.length);}
    const handlers={
      pointerdown(event){if(locked||pointer!==null||event.isPrimary===false||event.button!==0)return;event.preventDefault();pointer=event.pointerId;strokes.push([point(event)]);try{canvas.setPointerCapture(pointer);}catch{}paint();},
      pointermove(event){if(locked||event.pointerId!==pointer)return;event.preventDefault();const points=strokes.at(-1),next=point(event),last=points.at(-1);if(Math.hypot(next.x-last.x,next.y-last.y)<1)return;points.push(next);paint();},
      pointerup:finish,pointercancel:finish,lostpointercapture:finish
    };
    for(const [event,handler] of Object.entries(handlers))canvas.addEventListener(event,handler);
    return {hasInk:()=>strokes.length>0,undo(){if(locked)return;pointer=null;strokes.pop();paint();onChange(strokes.length);},clear(){if(locked)return;pointer=null;strokes.length=0;paint();onChange(0);},lock(value){locked=value;if(value&&pointer!==null)finish({pointerId:pointer});},destroy(){pointer=null;strokes.length=0;for(const [event,handler] of Object.entries(handlers))canvas.removeEventListener(event,handler);canvas.width=canvas.height=0;}};
  }
  function cropSignature(source){
    const context=source.getContext('2d'),{data}=context.getImageData(0,0,source.width,source.height);let left=source.width,top=source.height,right=-1,bottom=-1;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const i=(y*source.width+x)*4;if(data[i+3]>32&&Math.min(data[i],data[i+1],data[i+2])<225){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
    if(right<left)throw Error('Add your signature or initials before saving.');
    const output=document.createElement('canvas'),padding=14;
    output.width=right-left+1+padding*2;output.height=bottom-top+1+padding*2;
    const ink=output.getContext('2d');ink.fillStyle='#fff';ink.fillRect(0,0,output.width,output.height);ink.drawImage(source,left,top,right-left+1,bottom-top+1,padding,padding,right-left+1,bottom-top+1);return output;
  }
  function initialsImage(value){
    const text=cleanText(value);if(!/^[\p{L}\p{M} .'-]{1,10}$/u.test(text)||!/[\p{L}]/u.test(text))throw Error('Enter up to 10 letters for your initials. Full stops and spaces are allowed.');
    const canvas=document.createElement('canvas');canvas.width=900;canvas.height=240;
    const ink=canvas.getContext('2d');let size=150;ink.font=`italic ${size}px Georgia, serif`;
    while(ink.measureText(text).width>840&&size>30){size-=2;ink.font=`italic ${size}px Georgia, serif`;}
    ink.fillStyle='#141b2f';ink.fillText(text,24,175);return cropSignature(canvas);
  }
  const pngBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare this signature. Please try again.')),'image/png'));
  function create(ctx){
    const {db,esc,modal,close,show}=ctx;let epoch=0,current=null,editor=null;
    const state=()=>ctx.get(),snapshot=()=>({owner:state().session?.user.id,generation:state().generation,epoch});
    const valid=s=>s.owner&&s.owner===state().session?.user.id&&s.generation===state().generation&&s.epoch===epoch&&state().club;
    const $=selector=>document.querySelector(selector);
    const feedback=(form,message)=>{const output=form?.querySelector('[data-certificate-feedback]');if(output){output.textContent=message;output.hidden=!message;}};
    const note='<p class="auth-feedback" data-certificate-feedback role="status" hidden></p>';
    const setupError=error=>/space_certificate_signatories|schema cache|does not exist|could not find/i.test(error?.message||'')?'Certificate setup is not active yet. Ask the administrator to run upgrade_automatic_course_certificates.sql.':error?.message||'Could not load certificates. Try again.';
    const fields=()=>({courses:state().cache.courses||[],roster:state().cache.course_roster||[],enrollments:state().cache.course_enrollments||[]});
    const teacherOnly=()=>{if(!state().teacher)throw Error('Teacher access is required.');};
    function destroyEditor(){if(!editor)return;const previous=editor;editor=null;previous.dispose();}
    function startEditor(form,s,saved){
      if(!form?.querySelector('#certificateSignaturePad'))return;
      const draw=form.querySelector('#certificateSignaturePad'),preview=form.querySelector('#certificateSignaturePreview'),name=form.querySelector('[data-signature-name]'),previewStatus=form.querySelector('[data-signature-status]');
      let image=null,revision=0,disposed=false,saving=false;
      const alive=()=>!disposed&&valid(s)&&form.isConnected;
      const clearPreview=()=>{preview.width=600;preview.height=140;};
      function showImage(source,label){
        image=source;clearPreview();const ink=preview.getContext('2d');ink.fillStyle='#fff';ink.fillRect(0,0,preview.width,preview.height);
        if(source){const ratio=Math.min(560/source.width,112/source.height);ink.drawImage(source,(600-source.width*ratio)/2,(140-source.height*ratio)/2,source.width*ratio,source.height*ratio);}
        previewStatus.textContent=label;preview.setAttribute('aria-label',label);name.textContent=form.elements.teacher_name.value||'Your teacher name';
      }
      const pad=createSignaturePad(draw,count=>{form.querySelector('[data-signature-undo]').disabled=!count;form.querySelector('[data-signature-clear]').disabled=!count;if(form.elements.signature_mode.value==='draw')update();});
      async function update(){
        const ownRevision=++revision,mode=form.elements.signature_mode.value;
        image=null;showImage(null,mode==='saved'?'Loading your saved signature…':'Add a signature to see how it will appear.');
        try{
          let source=null;
          if(mode==='draw'){if(pad.hasInk())source=cropSignature(draw);}
          if(mode==='initials'){if(form.elements.initials.value.trim())source=initialsImage(form.elements.initials.value);}
          if(mode==='upload'){
            const file=form.elements.signature.files[0];if(!file)return;
            if(file.size>2097152||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Upload a PNG, JPEG or WebP signature up to 2 MB.');
            const url=URL.createObjectURL(file);try{const loaded=await loadImage(url);if(!alive()||ownRevision!==revision)return;
              const canvas=document.createElement('canvas'),ratio=Math.min(1,1600/loaded.width,800/loaded.height);canvas.width=Math.max(1,Math.round(loaded.width*ratio));canvas.height=Math.max(1,Math.round(loaded.height*ratio));canvas.getContext('2d').drawImage(loaded,0,0,canvas.width,canvas.height);source=cropSignature(canvas);
            }finally{URL.revokeObjectURL(url);}
          }
          if(mode==='saved'){
            const signed=await db.storage.from(BUCKET).createSignedUrl(saved.signature_path,120);if(signed.error)throw signed.error;
            if(!alive()||ownRevision!==revision)return;source=await loadImage(signed.data.signedUrl);
          }
          if(!alive()||ownRevision!==revision)return;
          showImage(source,source?(mode==='saved'?'Your saved signature.':'Preview — ready to save.'):'Draw your signature or initials in the box above.');
        }catch(error){if(alive()&&ownRevision===revision)showImage(null,mode==='saved'?'Saved signature preview could not load. You can keep using the saved version.':error.message);}
      }
      function switchMode(mode){
        if(saving||!['draw','initials','upload',...(saved?['saved']:[])].includes(mode))return;
        form.elements.signature_mode.value=mode;
        form.querySelectorAll('[data-signature-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.signatureMode===mode)));
        form.querySelectorAll('[data-signature-panel]').forEach(panel=>{panel.hidden=panel.dataset.signaturePanel!==mode;});
        form.elements.signature.required=false;feedback(form,'');void update();
      }
      const onClick=event=>{const button=event.target.closest('button');if(!button||saving)return;if(button.dataset.signatureMode)switchMode(button.dataset.signatureMode);if(button.hasAttribute('data-signature-undo'))pad.undo();if(button.hasAttribute('data-signature-clear'))pad.clear();};
      const onInput=event=>{if(event.target.name==='initials')void update();if(event.target.name==='teacher_name')name.textContent=event.target.value||'Your teacher name';};
      const onChange=event=>{if(event.target.name==='signature')void update();};
      form.addEventListener('click',onClick);form.addEventListener('input',onInput);form.addEventListener('change',onChange);
      editor={form,async file(){const mode=form.elements.signature_mode.value;if(mode==='saved')return null;if(mode==='draw'&&!pad.hasInk())throw Error('Draw your signature or initials before saving.');if(!image)throw Error('Wait for the signature preview, or add your signature first.');return pngBlob(image);},lock(value){saving=value;pad.lock(value);form.querySelectorAll('[data-signature-mode]').forEach(button=>{button.disabled=value;});for(const key of ['teacher_name','initials','signature'])form.elements[key].disabled=value;for(const selector of ['[data-signature-undo]','[data-signature-clear]'])form.querySelector(selector).disabled=value||!pad.hasInk();},dispose(){disposed=true;revision++;pad.destroy();image=null;clearPreview();preview.width=preview.height=0;form.removeEventListener('click',onClick);form.removeEventListener('input',onInput);form.removeEventListener('change',onChange);}};
      switchMode(saved?'saved':'draw');
    }
    const dialog=$('#modal');dialog?.addEventListener('close',()=>{if(!dialog.open)destroyEditor();});
    const content=$('#modalContent');if(content&&typeof MutationObserver==='function')new MutationObserver(()=>{if(editor&&!editor.form.isConnected)destroyEditor();}).observe(content,{childList:true});
    async function settings(){
      teacherOnly();destroyEditor();const s=snapshot();modal('<h2>Teacher certificate signature</h2><p role="status">Loading your signing details…</p>');
      const result=await db.from('space_certificate_signatories').select('*').eq('user_id',s.owner).maybeSingle();if(!valid(s))return;
      if(result.error){modal(`<h2>Teacher certificate signature</h2><p role="alert">${esc(setupError(result.error))}</p>`);return;}
      const saved=result.data;
      modal(`<span class="eyebrow">TEACHER CERTIFICATES</span><h2>Your name and signature</h2><p class="muted">Draw your signature or initials, type your initials, or upload an image. Your saved signature is placed on certificates when you confirm course completion.</p><form id="certificateSettingsForm" class="form-stack"><div class="field"><label for="certificateTeacherName">Full teacher name</label><input id="certificateTeacherName" name="teacher_name" maxlength="120" minlength="2" value="${esc(saved?.teacher_name||state().me?.full_name||'')}" required></div><input type="hidden" name="saved_path" value="${esc(saved?.signature_path||'')}"><input type="hidden" name="signature_mode" value="${saved?'saved':'draw'}"><div class="signature-modes" role="group" aria-label="Choose how to add your signature">${[...(saved?[['saved','Use saved']]:[]),['draw','Draw signature'],['initials','Type initials'],['upload','Upload image']].map(([mode,label])=>`<button type="button" data-signature-mode="${mode}" aria-pressed="${mode===(saved?'saved':'draw')}">${label}</button>`).join('')}</div><section data-signature-panel="saved" ${saved?'':'hidden'}><p class="hint">Your saved signature is shown below. Choose another method to replace it.</p></section><section data-signature-panel="draw" ${saved?'hidden':''}><p id="signatureDrawHelp" class="hint">Sign or draw your initials using your finger, mouse or stylus. Prefer a keyboard? Choose Type initials or Upload image.</p><div class="signature-pad-wrap"><canvas id="certificateSignaturePad" aria-label="Draw your signature or initials" aria-describedby="signatureDrawHelp">Choose Type initials or Upload image if drawing is unavailable.</canvas><span aria-hidden="true">SIGN HERE</span></div><div class="signature-tools"><span class="hint">Dark ink · white background</span><button type="button" class="text-button" data-signature-undo disabled>Undo stroke</button><button type="button" class="text-button" data-signature-clear disabled>Clear</button></div></section><section data-signature-panel="initials" hidden><div class="field"><label for="certificateInitials">Your initials</label><input id="certificateInitials" name="initials" maxlength="10" placeholder="E. T." autocomplete="off" spellcheck="false"><small>These initials will be used as your certificate signature.</small></div></section><section data-signature-panel="upload" hidden><div class="field"><label for="certificateSignature">Signature image</label><input id="certificateSignature" name="signature" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG, JPEG or WebP, up to 2 MB. Use dark ink on white or a transparent background.</small></div></section><section class="signature-preview"><span class="eyebrow">CERTIFICATE PREVIEW</span><canvas id="certificateSignaturePreview" width="600" height="140" role="img" aria-label="Your signature preview"></canvas><strong data-signature-name>${esc(saved?.teacher_name||state().me?.full_name||'Your teacher name')}</strong><p class="hint" data-signature-status role="status">Add a signature to preview it.</p></section><label><input name="consent" type="checkbox" required> This is my signature or initials, and I authorize its use when I confirm a member’s course completion.</label><p class="hint">Existing certificates keep the name and signature recorded when they were issued.</p>${note}<button class="button" type="submit">Save signing details</button></form>`);
      startEditor($('#certificateSettingsForm'),s,saved);
    }
    function learnerOptions(form,preferred=''){
      const course=form.elements.course.value,search=String(form.elements.search.value||'').trim().toLowerCase(),data=fields();
      const rows=data.enrollments.filter(e=>e.course_id===course&&e.learner_id!==state().session.user.id).map(e=>({...e,name:data.roster.find(r=>r.course_id===course&&r.learner_id===e.learner_id)?.full_name||ctx.memberName(e.learner_id)})).filter(e=>!search||e.name.toLowerCase().includes(search));
      form.elements.learner.innerHTML='<option value="">Choose a member</option>'+rows.slice(0,100).map(e=>`<option value="${esc(e.learner_id)}" ${e.learner_id===preferred?'selected':''}>${esc(e.name)}${e.status==='completed'?' · already completed':''}</option>`).join('');
      const count=form.querySelector('[data-learner-count]');if(count)count.textContent=rows.length>100?`${rows.length} matches. Search by name to narrow the first 100.`:`${rows.length} enrolled members match.`;
    }
    function complete(courseId='',learnerId=''){
      teacherOnly();destroyEditor();const courses=fields().courses.filter(c=>state().admin||c.instructor_id===state().session.user.id);
      if(!courses.length)throw Error('Open Teaching studio and select a course assigned to you first.');
      modal(`<span class="eyebrow">COURSE COMPLETION</span><h2>Confirm completion and issue certificate</h2><p class="muted">For learning and practical courses. Confirm the member has met the course requirements. If a final project is awaiting review, accept that project instead.</p><form id="certificateCompleteForm" class="form-stack"><div class="field"><label for="certificateCourse">Course</label><select id="certificateCourse" name="course">${courses.map(c=>`<option value="${esc(c.id)}" ${c.id===courseId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></div><div class="field"><label for="certificateLearnerSearch">Find an enrolled member</label><input id="certificateLearnerSearch" name="search" type="search" placeholder="Search by name" autocomplete="off"></div><div class="field"><label for="certificateLearner">Member</label><select id="certificateLearner" name="learner" required></select><small data-learner-count></small></div><div class="field"><label for="certificateKind">Completion type</label><select id="certificateKind" name="kind"><option value="learning">Learning course</option><option value="practical">Practical course</option></select></div><div class="field"><label for="certificateCompletionNote">What confirms completion?</label><textarea id="certificateCompletionNote" name="note" minlength="5" maxlength="1000" required placeholder="Record the assessment, learning activities or practical work completed."></textarea></div><label><input name="acknowledge" type="checkbox" required> I have checked this member’s work and confirm all course requirements are complete. Issue their certificate using my saved name and signature.</label>${note}<button class="button" type="submit">Confirm completion and issue</button></form><p class="hint">Set up your name and signature in Teaching studio → Certificate signature before confirming.</p>`);
      learnerOptions($('#certificateCompleteForm'),learnerId);
    }
    async function open(id){
      if(!state().club)throw Error('Sign in with an approved club account to open certificates.');
      const s=snapshot();destroyEditor();current=null;modal('<h2>Your course certificate</h2><p role="status">Preparing your certificate…</p>');
      const result=await db.from('space_certificates').select('*').eq('id',id).maybeSingle();if(!valid(s))return;
      if(result.error)throw result.error;if(!result.data)throw Error('This certificate is unavailable or belongs to another account.');
      const record=result.data;
      modal(`<div class="certificate-document"><div class="section-heading"><div><span class="eyebrow">TURK INNOVATION CLUB</span><h2>${record.revoked_at?'Revoked certificate':'Course certificate'}</h2><p>${esc(record.course_title)}</p></div></div><p data-certificate-status role="status">Loading the certificate and teacher signature…</p><div class="certificate-canvas-wrap"><canvas id="memberCertificateCanvas" role="img" aria-label="${esc(record.recipient_name+' completed '+record.course_title+'. Teacher: '+(record.teacher_name||'not recorded'))}"></canvas></div><div class="profile-buttons certificate-controls"><button class="button" data-action="certificateDownload" data-id="${esc(record.id)}" disabled>Download PDF</button><button class="text-button" data-action="certificateView" data-id="${esc(record.id)}">Reload certificate</button></div><p class="hint">${record.revoked_at?'This award has been revoked. Any downloaded copy will show REVOKED.':record.signed_by?'Issued after teacher confirmation. Names and the signature are preserved from issuance.':'This older certificate has no saved teacher signature. Ask your teacher to confirm it from Teaching studio.'}</p>${note}</div>`);
      try{
        let signatureUrl='';if(record.signature_path){const signed=await db.storage.from(BUCKET).createSignedUrl(record.signature_path,120);if(signed.error)throw signed.error;signatureUrl=signed.data.signedUrl;}
        const base=new URL('./',location.origin+location.pathname);
        const [template,signature]=await Promise.all([loadImage(new URL('assets/certificate-template-v1.png',base).href),signatureUrl?loadImage(signatureUrl):null]);
        if(!valid(s))return;const canvas=$('#memberCertificateCanvas');if(!canvas)return;
        drawCertificate(canvas,record,template,signature);current={record,canvas,snapshot:s};
        $('[data-certificate-status]').textContent=record.revoked_at?'Revoked award':'Your certificate is ready to download.';
        $('[data-action="certificateDownload"]').disabled=false;
      }catch(error){if(valid(s))$('[data-certificate-status]').textContent=error.message||'Could not render the certificate. Reload to try again.';}
    }
    async function openCourse(course){
      const s=snapshot(),result=await db.from('space_certificates').select('id').eq('course_id',course).eq('learner_id',s.owner).maybeSingle();
      if(!valid(s))return;if(result.error)throw result.error;if(!result.data)throw Error('Your teacher has not issued this course certificate yet.');return open(result.data.id);
    }
    async function download(){
      if(!current||!valid(current.snapshot))throw Error('Reopen this certificate before downloading it.');
      const ready=current,s=snapshot(),fresh=await db.from('space_certificates').select('id,revoked_at,teacher_confirmed_at').eq('id',ready.record.id).maybeSingle();
      if(!valid(s))return;if(fresh.error)throw fresh.error;if(!fresh.data)throw Error('This certificate is no longer available to this account.');
      if(fresh.data.revoked_at!==ready.record.revoked_at||fresh.data.teacher_confirmed_at!==ready.record.teacher_confirmed_at){await open(ready.record.id);show('The certificate record changed. Review it, then download again.');return;}
      const url=ready.canvas.toDataURL('image/jpeg',.97),jpeg=Uint8Array.from(atob(url.split(',')[1]),char=>char.charCodeAt(0));
      const pdf=makePdf(jpeg,ready.canvas.width,ready.canvas.height),href=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
      const link=document.createElement('a');link.href=href;link.download='TURK-INNOVATION-CLUB-'+ready.record.public_code+'.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
    }
    async function submit(event){
      const form=event.target,button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;feedback(form,'');const s=snapshot(),signingEditor=editor?.form===form?editor:null;let uploaded='';
      try{
        teacherOnly();const values=new FormData(form);
        if(form.getAttribute('id')==='certificateSettingsForm'){
          if(signingEditor&&values.get('consent')!=='on')throw Error('Acknowledge that this is your own signature or initials.');
          signingEditor?.lock(true);
          const file=signingEditor?await signingEditor.file():values.get('signature');let path=String(values.get('saved_path')||'');
          if(!valid(s)||(signingEditor&&(editor!==signingEditor||!form.isConnected)))return;
          if(file?.size){
            if(file.size>2097152||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Upload a PNG, JPEG or WebP signature up to 2 MB.');
            const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];path=s.owner+'/'+crypto.randomUUID()+'.'+ext;
            const result=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false}).catch(error=>{if(valid(s))void ctx.report?.('upload',error,s.owner);throw error;});if(result.error){if(valid(s))void ctx.report?.('upload',result.error,s.owner);throw result.error;}uploaded=path;
          }
          if(!path)throw Error('Draw your signature, type your initials, or upload your signature image.');
          if(!valid(s)||(signingEditor&&(editor!==signingEditor||!form.isConnected)))return;
          const result=await db.rpc('space_save_certificate_signatory',{p_name:String(values.get('teacher_name')||''),p_path:path,p_consent:values.get('consent')==='on'});if(result.error)throw result.error;
          if(!valid(s)||(signingEditor&&editor!==signingEditor))return;destroyEditor();close();show('Your teacher name and signature are saved. They will appear automatically when you confirm course completions.');return;
        }
        const result=await db.rpc('space_confirm_course_completion',{p_course:String(values.get('course')||''),p_learner:String(values.get('learner')||''),p_kind:String(values.get('kind')||''),p_note:String(values.get('note')||'').trim(),p_acknowledge:values.get('acknowledge')==='on'});
        if(result.error)throw result.error;if(!valid(s))return;
        const id=result.data;close();show('Completion confirmed. The certificate and notification are in the member’s account.');
        try{await ctx.refresh();}catch{show('Certificate issued. Reload Teaching studio to refresh the student list.');}
        if(valid(s)&&id)try{await open(id);}catch(error){modal(`<h2>Certificate issued</h2><p>The completion and member notification were saved. The preview could not load: ${esc(error.message||'connection unavailable')}.</p><button class="button" data-action="certificateView" data-id="${esc(id)}">Open certificate again</button>`);}
      }catch(error){if(valid(s))feedback(form,setupError(error)+(uploaded?' The uploaded image remains private; retry saving your details.':''));}
      finally{if(editor===signingEditor)signingEditor?.lock(false);if(button.isConnected!==false)button.disabled=false;}
    }
    function action(name,id,element){
      if(!name.startsWith('certificate'))return false;
      if(element?.disabled)return true;
      const task=async()=>{if(name==='certificateSettings')return settings();if(name==='certificateComplete')return complete(element?.dataset.course||'',element?.dataset.learner||'');if(name==='certificateView')return open(id);if(name==='certificateCourse')return openCourse(id);if(name==='certificateDownload')return download();};
      void task().catch(error=>{const form=$('#certificateSettingsForm')||$('#certificateCompleteForm')||$('.certificate-document');if(form)feedback(form,setupError(error));else modal(`<h2>Course certificate</h2><p role="alert">${esc(setupError(error))}</p>`);});return true;
    }
    document.addEventListener('input',event=>{const form=event.target.form;if(form?.getAttribute('id')==='certificateCompleteForm'&&event.target.name==='search')learnerOptions(form);});
    document.addEventListener('change',event=>{const form=event.target.form;if(form?.getAttribute('id')==='certificateCompleteForm'&&event.target.name==='course')learnerOptions(form);});
    async function requireSigner(){
      teacherOnly();const s=snapshot(),result=await db.from('space_certificate_signatories').select('user_id').eq('user_id',s.owner).maybeSingle();
      if(!valid(s))throw Error('Your account changed. Reopen this course review.');
      if(result.error)throw Error(setupError(result.error));
      if(!result.data)throw Error('Save your teacher name and signature in Teaching studio → Certificate signature first.');
    }
    return {action,open,requireSigner,reset(){epoch++;destroyEditor();if(current?.canvas){current.canvas.width=0;current.canvas.height=0;}current=null;const owned=$('.certificate-document')||$('#certificateSettingsForm')||$('#certificateCompleteForm');if(owned){owned.replaceChildren?.();close();}},handleSubmit(event){if(!['certificateSettingsForm','certificateCompleteForm'].includes(event.target.getAttribute?.('id')))return false;event.preventDefault();void submit(event);return true;}};
  }
  window.SpaceCertificates={create,drawCertificate,makePdf,linesFor,createSignaturePad,cropSignature,initialsImage};
})();
