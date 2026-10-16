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
  function create(ctx){
    const {db,esc,modal,close,show}=ctx;let epoch=0,current=null;
    const state=()=>ctx.get(),snapshot=()=>({owner:state().session?.user.id,generation:state().generation,epoch});
    const valid=s=>s.owner&&s.owner===state().session?.user.id&&s.generation===state().generation&&s.epoch===epoch&&state().club;
    const $=selector=>document.querySelector(selector);
    const feedback=(form,message)=>{const output=form?.querySelector('[data-certificate-feedback]');if(output){output.textContent=message;output.hidden=!message;}};
    const note='<p class="auth-feedback" data-certificate-feedback role="status" hidden></p>';
    const setupError=error=>/space_certificate_signatories|schema cache|does not exist|could not find/i.test(error?.message||'')?'Certificate setup is not active yet. Ask the administrator to run upgrade_automatic_course_certificates.sql.':error?.message||'Could not load certificates. Try again.';
    const fields=()=>({courses:state().cache.courses||[],roster:state().cache.course_roster||[],enrollments:state().cache.course_enrollments||[]});
    const teacherOnly=()=>{if(!state().teacher)throw Error('Teacher access is required.');};
    async function settings(){
      teacherOnly();const s=snapshot();modal('<h2>Teacher certificate signature</h2><p role="status">Loading your signing details…</p>');
      const result=await db.from('space_certificate_signatories').select('*').eq('user_id',s.owner).maybeSingle();if(!valid(s))return;
      if(result.error){modal(`<h2>Teacher certificate signature</h2><p role="alert">${esc(setupError(result.error))}</p>`);return;}
      const saved=result.data;
      modal(`<span class="eyebrow">TEACHER CERTIFICATES</span><h2>Your name and signature</h2><p class="muted">Use your own signature. It will appear on certificates when you confirm course completion. Existing certificates retain the signature used when they were issued.</p><form id="certificateSettingsForm" class="form-stack"><div class="field"><label for="certificateTeacherName">Full teacher name</label><input id="certificateTeacherName" name="teacher_name" maxlength="120" minlength="2" value="${esc(saved?.teacher_name||state().me?.full_name||'')}" required></div><input type="hidden" name="saved_path" value="${esc(saved?.signature_path||'')}"><div class="field"><label for="certificateSignature">${saved?'Replace signature (optional)':'Signature image'}</label><input id="certificateSignature" name="signature" type="file" accept="image/png,image/jpeg,image/webp" ${saved?'':'required'}><small>PNG, JPEG or WebP, up to 2 MB. Use dark ink on white or a transparent background. Crop close to the signature.</small></div>${saved?'<p class="subtle">A signature is already saved. Upload a new image only when you want to change it.</p>':''}<label><input name="consent" type="checkbox" required> This is my signature, and I authorize its use when I confirm a member’s course completion.</label>${note}<button class="button" type="submit">Save signing details</button></form>`);
    }
    function learnerOptions(form,preferred=''){
      const course=form.elements.course.value,search=String(form.elements.search.value||'').trim().toLowerCase(),data=fields();
      const rows=data.enrollments.filter(e=>e.course_id===course&&e.learner_id!==state().session.user.id).map(e=>({...e,name:data.roster.find(r=>r.course_id===course&&r.learner_id===e.learner_id)?.full_name||ctx.memberName(e.learner_id)})).filter(e=>!search||e.name.toLowerCase().includes(search));
      form.elements.learner.innerHTML='<option value="">Choose a member</option>'+rows.slice(0,100).map(e=>`<option value="${esc(e.learner_id)}" ${e.learner_id===preferred?'selected':''}>${esc(e.name)}${e.status==='completed'?' · already completed':''}</option>`).join('');
      const count=form.querySelector('[data-learner-count]');if(count)count.textContent=rows.length>100?`${rows.length} matches. Search by name to narrow the first 100.`:`${rows.length} enrolled members match.`;
    }
    function complete(courseId='',learnerId=''){
      teacherOnly();const courses=fields().courses.filter(c=>state().admin||c.instructor_id===state().session.user.id);
      if(!courses.length)throw Error('Open Teaching studio and select a course assigned to you first.');
      modal(`<span class="eyebrow">COURSE COMPLETION</span><h2>Confirm completion and issue certificate</h2><p class="muted">For learning and practical courses. Confirm the member has met the course requirements. If a final project is awaiting review, accept that project instead.</p><form id="certificateCompleteForm" class="form-stack"><div class="field"><label for="certificateCourse">Course</label><select id="certificateCourse" name="course">${courses.map(c=>`<option value="${esc(c.id)}" ${c.id===courseId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></div><div class="field"><label for="certificateLearnerSearch">Find an enrolled member</label><input id="certificateLearnerSearch" name="search" type="search" placeholder="Search by name" autocomplete="off"></div><div class="field"><label for="certificateLearner">Member</label><select id="certificateLearner" name="learner" required></select><small data-learner-count></small></div><div class="field"><label for="certificateKind">Completion type</label><select id="certificateKind" name="kind"><option value="learning">Learning course</option><option value="practical">Practical course</option></select></div><div class="field"><label for="certificateCompletionNote">What confirms completion?</label><textarea id="certificateCompletionNote" name="note" minlength="5" maxlength="1000" required placeholder="Record the assessment, learning activities or practical work completed."></textarea></div><label><input name="acknowledge" type="checkbox" required> I have checked this member’s work and confirm all course requirements are complete. Issue their certificate using my saved name and signature.</label>${note}<button class="button" type="submit">Confirm completion and issue</button></form><p class="hint">Set up your name and signature in Teaching studio → Certificate signature before confirming.</p>`);
      learnerOptions($('#certificateCompleteForm'),learnerId);
    }
    async function open(id){
      if(!state().club)throw Error('Sign in with an approved club account to open certificates.');
      const s=snapshot();current=null;modal('<h2>Your course certificate</h2><p role="status">Preparing your certificate…</p>');
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
      const form=event.target,button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;feedback(form,'');const s=snapshot();let uploaded='';
      try{
        teacherOnly();const values=new FormData(form);
        if(form.getAttribute('id')==='certificateSettingsForm'){
          const file=values.get('signature');let path=String(values.get('saved_path')||'');
          if(file?.size){
            if(file.size>2097152||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Upload a PNG, JPEG or WebP signature up to 2 MB.');
            const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];path=s.owner+'/'+crypto.randomUUID()+'.'+ext;
            const result=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});if(result.error)throw result.error;uploaded=path;
          }
          if(!path)throw Error('Choose your signature image.');
          if(!valid(s))return;
          const result=await db.rpc('space_save_certificate_signatory',{p_name:String(values.get('teacher_name')||''),p_path:path,p_consent:values.get('consent')==='on'});if(result.error)throw result.error;
          if(!valid(s))return;close();show('Your teacher name and signature are saved. You can now confirm course completions.');return;
        }
        const result=await db.rpc('space_confirm_course_completion',{p_course:String(values.get('course')||''),p_learner:String(values.get('learner')||''),p_kind:String(values.get('kind')||''),p_note:String(values.get('note')||'').trim(),p_acknowledge:values.get('acknowledge')==='on'});
        if(result.error)throw result.error;if(!valid(s))return;
        const id=result.data;close();show('Completion confirmed. The certificate and notification are in the member’s account.');
        try{await ctx.refresh();}catch{show('Certificate issued. Reload Teaching studio to refresh the student list.');}
        if(valid(s)&&id)try{await open(id);}catch(error){modal(`<h2>Certificate issued</h2><p>The completion and member notification were saved. The preview could not load: ${esc(error.message||'connection unavailable')}.</p><button class="button" data-action="certificateView" data-id="${esc(id)}">Open certificate again</button>`);}
      }catch(error){if(valid(s))feedback(form,setupError(error)+(uploaded?' The uploaded image remains private; retry saving your details.':''));}
      finally{if(button.isConnected!==false)button.disabled=false;}
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
    return {action,open,requireSigner,reset(){epoch++;if(current?.canvas){current.canvas.width=0;current.canvas.height=0;}current=null;const owned=$('.certificate-document')||$('#certificateSettingsForm')||$('#certificateCompleteForm');if(owned){owned.replaceChildren?.();close();}},handleSubmit(event){if(!['certificateSettingsForm','certificateCompleteForm'].includes(event.target.getAttribute?.('id')))return false;event.preventDefault();void submit(event);return true;}};
  }
  window.SpaceCertificates={create,drawCertificate,makePdf,linesFor};
})();
