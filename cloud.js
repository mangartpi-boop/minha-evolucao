/* Minha Evolução: autenticação e sincronização em nuvem com RLS. */
(() => {
  const config=window.MINHA_EVOLUCAO_SUPABASE||{};
  const configured=/^https:\/\/.+\.supabase\.co$/.test(config.url||'') && config.publishableKey && !config.publishableKey.includes('COLE_');
  const authScreen=document.getElementById('auth-screen');
  const message=document.getElementById('auth-message');
  const status=document.getElementById('cloud-status');
  const logOutBtn=document.getElementById('cloud-logout');
  const importBox=document.getElementById('cloud-import');
  let client=null, user=null, revision=0, lastSynced=0, saving=false, timer=null, loading=false, needImport=false, imported=false;
  function notify(t,bad=false){message.textContent=t;message.className=bad?'auth-error':'auth-note'}
  function statusText(t){status.textContent=t||''}
  function lock(show){document.body.classList.toggle('auth-locked',show);document.body.classList.remove('cloud-loading');logOutBtn.style.display=show?'none':'inline-block'}
  if(!configured || !window.supabase){
    document.body.classList.remove('cloud-loading');document.body.classList.add('auth-locked');
    document.getElementById('auth-form').style.display='none';document.getElementById('auth-register').style.display='none';document.getElementById('auth-reset').style.display='none';
    notify('Configuração necessária: preencha o arquivo config.js com a URL do seu projeto Supabase e a chave publicável. Não use chaves secretas.',true);
    return;
  }
  client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  // Fotos privadas: caminhos pertencentes à conta autenticada; URLs assinadas temporárias.
  const photoBucket='minha-evolucao-fotos';
  function assertMine(path){if(!user||!path.startsWith(user.id+'/'))throw Error('Foto fora da sua conta.');}
  window.cloudPhotos={
    async upload(blob,kind){
      if(!user)throw Error('Entre na conta antes de enviar a foto.');
      if(!['meals','workouts','profile'].includes(kind))throw Error('Categoria inválida.');
      const path=user.id+'/'+kind+'/'+crypto.randomUUID()+'.jpg';
      const {error}=await client.storage.from(photoBucket).upload(path,blob,{contentType:'image/jpeg',upsert:false});
      if(error)throw error;
      return path;
    },
    async url(path){assertMine(path);const {data,error}=await client.storage.from(photoBucket).createSignedUrl(path,120);if(error)throw error;return data.signedUrl;},
    async remove(path){assertMine(path);const {error}=await client.storage.from(photoBucket).remove([path]);if(error)throw error;}
  };
  const clean=()=>JSON.parse(JSON.stringify(db));
  const valid=d=>d&&typeof d==='object'&&!Array.isArray(d)&&d.profile&&Array.isArray(d.weights)&&['meals','water','workouts','doses','symptoms','events','measurements'].every(k=>Array.isArray(d[k]));
  function importOldPrompt(){
    if(!needImport||imported){importBox.innerHTML='';return;}
    importBox.innerHTML='<div class="cloud-alert"><strong>Encontramos registros salvos neste navegador.</strong><p>Deseja copiar estes registros para sua conta? Isso substituirá os dados atuais da conta. Escolha importar apenas se estes registros forem seus.</p><button class="btn" id="cloud-import-yes">Importar meus registros</button><button class="btn secondary" id="cloud-import-no">Agora não</button></div>';
    document.getElementById('cloud-import-yes').onclick=()=>{db=oldBackup;imported=true;needImport=false;render();cloudScheduleSave();importOldPrompt()};
    document.getElementById('cloud-import-no').onclick=()=>{imported=true;needImport=false;importOldPrompt()};
  }
  let oldBackup=null;
  async function loadAccount(session){
    const next=session?.user||null;
    if(!next){user=null;clearTimeout(timer);revision=0;lastSynced=0;db=structuredClone(defaults);statusText('');lock(true);return;}
    if(user?.id===next.id && !loading){lock(false);return;}
    user=next;loading=true;statusText('Carregando registros seguros…');
    try{
      const old=localStorage.getItem(KEY);
      if(old){try{const p=JSON.parse(old);if(valid({...defaults,...p}))oldBackup={...structuredClone(defaults),...p}}catch(e){}}
      const {data,error}=await client.from('user_data').select('data').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      db={...structuredClone(defaults),...(data?.data||{})};
      // Preservar os registros antigos neste navegador até confirmação explícita de importação.
      needImport=!!oldBackup && !data?.data;
      imported=false;revision=0;lastSynced=0;
      lock(false);render();importOldPrompt();statusText('Conta conectada · registros protegidos por conta');
    }catch(e){lock(true);notify('Falha ao carregar os dados. Verifique se executou o SQL do banco e se as políticas de acesso estão ativas. Detalhes: '+e.message,true)}
    finally{loading=false}
  }
  async function send(){
    if(!user || saving || loading || revision===lastSynced)return;
    saving=true;const currentUser=user.id, rev=revision, snapshot=clean();statusText('Salvando na nuvem…');
    try{
      const {error}=await client.from('user_data').upsert({user_id:currentUser,data:snapshot,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(error)throw error;
      if(user?.id===currentUser){lastSynced=rev;statusText('Alterações salvas na nuvem')}
    }catch(e){statusText('Erro ao salvar: '+e.message+' · exporte um backup');}
    finally{saving=false;if(revision!==lastSynced&&user?.id===currentUser)clearTimeout(timer),timer=setTimeout(send,3500)}
  }
  window.cloudScheduleSave=()=>{if(!user)return;revision++;statusText('Alterações pendentes…');clearTimeout(timer);timer=setTimeout(send,450)};
  window.cloudLogout=async()=>{if(!user)return;if(revision!==lastSynced){await send();if(revision!==lastSynced){alert('Os dados ainda não foram salvos na nuvem. Confira a conexão antes de sair.');return;}}await client.auth.signOut();};
  const f=document.getElementById('auth-form');
  f.onsubmit=async e=>{e.preventDefault();const email=document.getElementById('auth-email').value.trim(),password=document.getElementById('auth-password').value;notify('Entrando…');const {error}=await client.auth.signInWithPassword({email,password});if(error)notify(error.message,true)};
  document.getElementById('auth-register').onclick=async()=>{const email=document.getElementById('auth-email').value.trim(),password=document.getElementById('auth-password').value;if(!email||password.length<6){notify('Informe um e-mail válido e senha com pelo menos 6 caracteres.',true);return}notify('Criando conta…');const {data,error}=await client.auth.signUp({email,password,emailRedirectTo:location.origin});if(error)notify(error.message,true);else notify(data.session?'Conta criada e conectada!':'Cadastro recebido. Confira o e-mail para confirmar sua conta.');};
  document.getElementById('auth-reset').onclick=async()=>{const email=document.getElementById('auth-email').value.trim();if(!email){notify('Informe seu e-mail para receber o link de recuperação.',true);return;}const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});notify(error?error.message:'Se a conta existir, você receberá instruções de recuperação por e-mail.',!!error)};
  client.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){const newPassword=prompt('Digite uma nova senha com pelo menos 8 caracteres:');if(newPassword&&newPassword.length>=8)client.auth.updateUser({password:newPassword}).then(({error})=>notify(error?error.message:'Senha atualizada. Você já pode entrar.',!!error));else notify('Para trocar a senha, utilize no mínimo 8 caracteres.',true);return;}if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='SIGNED_OUT')setTimeout(()=>loadAccount(session),0)});
  client.auth.getSession().then(({data,error})=>{if(error)notify(error.message,true);else loadAccount(data.session)});
})();
