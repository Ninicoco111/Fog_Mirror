const $=id=>document.getElementById(id);
const video=$('camera'),canvas=$('fog'),display=canvas.getContext('2d');
const mask=document.createElement('canvas'),m=mask.getContext('2d');
const frost=document.createElement('canvas'),f=frost.getContext('2d');
let lang='zh',stream,worker,running=false,busy=false,facing='user',width=innerWidth,height=innerHeight;
let hand=null,handAt=0,target=null,position=null,previous=null,mode=null,penDown=false;
let lastPenAt=-10000;
let fistAt=0,palmAt=0,palmDone=false,breathAt=0,breathDone=false,clouds=[];
const mobileDevice=matchMedia('(pointer:coarse)').matches;
const trackingEdge=mobileDevice?384:640;
let brush=18,density=.7,lastFrame=0,lastBlur=0,lastCloud=0,lastSend=0,raf=0,generation=0,ready=false;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
const text=(zh,en)=>lang==='zh'?zh:en;
function status(zh,en){$('status').textContent=text(zh,en);}
function resize(){
 width=innerWidth;height=innerHeight;
 canvas.width=mask.width=width;canvas.height=mask.height=height;
 const renderScale=Math.min(mobileDevice?.45:.6,900/Math.max(width,height));
 frost.width=Math.ceil(width*renderScale);frost.height=Math.ceil(height*renderScale);
 previous=null;position=null;clouds=[];lastBlur=0;
}
function clearGlass(){m.clearRect(0,0,width,height);clouds=[];previous=null;}
function fullFog(){m.clearRect(0,0,width,height);m.fillStyle='rgba(255,255,255,.94)';m.fillRect(0,0,width,height);previous=null;clouds=[];}
function mapped(p){
 const scale=(mobileDevice?Math.min:Math.max)(width/video.videoWidth,height/video.videoHeight);
 const w=video.videoWidth*scale,h=video.videoHeight*scale;
 return {x:(facing==='user'?1-p.x:p.x)*w-(w-width)/2,y:p.y*h-(h-height)/2};
}
function jointAngle(h,a,b,c){
 const u=[h[a].x-h[b].x,h[a].y-h[b].y,h[a].z-h[b].z];
 const v=[h[c].x-h[b].x,h[c].y-h[b].y,h[c].z-h[b].z];
 return u.reduce((sum,n,i)=>sum+n*v[i],0)/(Math.hypot(...u)*Math.hypot(...v));
}
function curled(h,a,b,c){return jointAngle(h,a,b,c)>-.25;}
function gesture(h,now){
 const size=Math.max(.015,dist(h[5],h[17]));
 const curls=[[5,6,8],[9,10,12],[13,14,16],[17,18,20]].map(j=>curled(h,...j));
 const indexAngle=jointAngle(h,5,6,8);
 const indexReach=dist(h[8],h[0])/Math.max(.01,dist(h[6],h[0]));
 const foldedOthers=[[9,10,12],[13,14,16],[17,18,20]].filter(([a,b,c])=>
   jointAngle(h,a,b,c)>-.65 || dist(h[c],h[0])<dist(h[b],h[0])*1.05).length;
 // Index pointing writes; thumb position does not affect this pose.
 const indexUp=indexAngle<(penDown?-.5:-.65) && indexReach>(penDown?1.03:1.08);
 penDown=indexUp && foldedOthers>=2;
 if(penDown)lastPenAt=now;
 const fist=!penDown && indexAngle>-.25 && foldedOthers===3
   && dist(h[8],h[0])<dist(h[6],h[0])*1.04;
 const fullySpread=[[5,6,8],[9,10,12],[13,14,16],[17,18,20]].every(j=>jointAngle(h,...j)<-.85);
 const palm=!penDown && !fist && fullySpread && dist(h[4],h[8])>size*.9
   && dist(h[8],h[20])>size*1.6 && dist(h[4],h[5])>size*.65 && now-lastPenAt>1800;
 if(palm){
  if(!palmAt)palmAt=now;
  $('palmProgress').hidden=false;
  $('palmProgress').style.setProperty('--progress',Math.min(1,(now-palmAt)/1300));
  if(now-palmAt>1300&&!palmDone){fullFog();palmDone=true;}
 }else{palmAt=0;palmDone=false;$('palmProgress').hidden=true;}
 if(fist && now-lastPenAt>1100){if(!fistAt)fistAt=now;}else fistAt=0;
 const next=palm?null:fist&&fistAt>0&&now-fistAt>650?'erase':penDown?'pen':null;
 if(next!==mode){previous=null;position=null;}mode=next;
 const p=mode==='erase'?{x:(h[5].x+h[9].x+h[13].x+h[17].x)/4,y:(h[5].y+h[9].y+h[13].y+h[17].y)/4}:h[8];
 target=mapped(p);
 if(palm)status('🖐️ 五指完全张开并保持，清空笔画','🖐️ Hold fully spread fingers to clear');
 else if(mode==='erase')status('✊ 正在擦雾','✊ Wiping mist');
 else if(mode==='pen')status('正在写字 · 收起食指即可抬笔','Writing · curl your index finger to lift');
 else status('只伸食指写字 · 收起食指空笔移动','Extend only your index finger to write · curl it to lift');
}
function breathe(mouth,now){
 if(!mouth){breathAt=0;breathDone=false;return;}
 const ratio=dist(mouth.top,mouth.bottom)/Math.max(.001,dist(mouth.left,mouth.right));
 if(ratio>.23){
  if(!breathAt)breathAt=now;
  if(now-breathAt>320&&!breathDone){
   const p=mapped({x:(mouth.top.x+mouth.bottom.x)/2,y:(mouth.top.y+mouth.bottom.y)/2});
   clouds.push({...p,born:now,seed:Math.random()*7});breathDone=true;
  }
 }else if(ratio<.15){breathAt=0;breathDone=false;}
}
function drawStroke(p,prev,size,erase){
 m.save();m.globalCompositeOperation='destination-out';
 if(!erase){
  m.lineWidth=size;m.lineCap='round';m.lineJoin='round';m.shadowColor='#000';m.shadowBlur=size*.1;
  m.beginPath();m.moveTo(prev?.x??p.x,prev?.y??p.y);m.lineTo(p.x,p.y);m.stroke();
  if(!prev){m.beginPath();m.arc(p.x,p.y,size/2,0,Math.PI*2);m.fill();}
 }else{
  const length=prev?Math.hypot(p.x-prev.x,p.y-prev.y):0;
  const count=Math.max(1,Math.ceil(length/(size*.12)));
  for(let i=1;i<=count;i++){
   const t=i/count,x=prev?prev.x+(p.x-prev.x)*t:p.x,y=prev?prev.y+(p.y-prev.y)*t:p.y;
   const g=m.createRadialGradient(x,y,0,x,y,size/2);
   g.addColorStop(0,'rgba(0,0,0,.3)');g.addColorStop(.65,'rgba(0,0,0,.22)');g.addColorStop(1,'rgba(0,0,0,0)');
   m.fillStyle=g;m.fillRect(x-size/2,y-size/2,size,size);
  }
 }
 m.restore();
}
function render(now){
 if(!running)return;
 const dt=Math.min(.04,(now-lastFrame)/1000||.016);lastFrame=now;
 if(now-handAt>220){mode=null;target=null;position=null;previous=null;penDown=false;$('cursor').hidden=true;}
 if(target){
  const gap=position?Math.hypot(target.x-position.x,target.y-position.y):0;
  const alpha=1-Math.exp(-dt*(gap>30?36:18));
  position=position?{x:position.x+(target.x-position.x)*alpha,y:position.y+(target.y-position.y)*alpha}:{...target};
  $('cursor').hidden=false;$('cursor').style.left=position.x+'px';$('cursor').style.top=position.y+'px';
  const size=mode==='erase'?Math.max(110,brush*4):brush;
  $('cursor').style.width=$('cursor').style.height=size+'px';$('cursor').classList.toggle('active',!!mode);
  if(mode){
   if(previous&&Math.hypot(previous.x-position.x,previous.y-position.y)>180)previous=null;
   drawStroke(position,previous,size,mode==='erase');previous={...position};
  }else previous=null;
 }
 if(now-lastCloud>45){
  lastCloud=now;clouds=clouds.filter(c=>now-c.born<3200);
  for(const c of clouds){
   const age=(now-c.born)/3200,r=70+age*Math.min(width,height)*.68;
   m.save();m.globalCompositeOperation='source-over';
   for(let i=0;i<5;i++){
    const angle=c.seed+i*2.4,x=c.x+Math.cos(angle)*r*.25,y=c.y+Math.sin(angle)*r*.2-r*age*.15;
    const g=m.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(255,255,255,'+(.24*Math.sin(Math.PI*age))+')');
    g.addColorStop(.65,'rgba(255,255,255,'+(.15*Math.sin(Math.PI*age))+')');g.addColorStop(1,'#ffffff00');
    m.fillStyle=g;m.fillRect(x-r,y-r,r*2,r*2);
   }m.restore();
  }
 }
 if(video.readyState>=2){
  lastBlur=now;
  const w=frost.width,h=frost.height,scale=(mobileDevice?Math.min:Math.max)(w/video.videoWidth,h/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;
  f.save();f.clearRect(0,0,w,h);if(facing==='user'){f.translate(w,0);f.scale(-1,1);}
  const blur=(1+Math.pow(density,1.3)*26)*w/width;
  // The clear video, mist video and hand mapping share the same fit.
  // Blur the original-sized image without enlarging the reflection.
  f.filter='blur('+blur+'px)';
  f.drawImage(video,(w-vw)/2,(h-vh)/2,vw,vh);f.restore();
  f.fillStyle='rgba(238,245,241,'+(Math.pow(density,1.8)*.65)+')';f.fillRect(0,0,w,h);
 }
 display.clearRect(0,0,width,height);display.globalAlpha=density;display.drawImage(frost,0,0,width,height);
 display.globalAlpha=1;display.globalCompositeOperation='destination-in';display.drawImage(mask,0,0);display.globalCompositeOperation='source-over';
 if(!busy&&now-lastSend>(mobileDevice?55:32)&&video.readyState>=2)sendFrame(now);
 raf=requestAnimationFrame(render);
}
async function sendFrame(now){
 busy=true;lastSend=now;const token=generation;
 try{
  const sampleScale=trackingEdge/Math.max(video.videoWidth,video.videoHeight);
  const bitmap=await createImageBitmap(video,{resizeWidth:Math.max(1,Math.round(video.videoWidth*sampleScale)),resizeHeight:Math.max(1,Math.round(video.videoHeight*sampleScale)),resizeQuality:'low'});
  if(!running||token!==generation){bitmap.close();busy=false;return;}
  worker.postMessage({type:'frame',bitmap,time:now},[bitmap]);
 }catch(e){busy=false;}
}
function stop(){
 running=false;generation++;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;
 worker?.terminate();worker=null;busy=false;ready=false;mode=null;position=null;target=null;previous=null;penDown=false;
 $('cursor').hidden=true;$('palmProgress').hidden=true;
}
function loadWorker(){
 return new Promise((resolve,reject)=>{
  worker=new Worker('./tracking-worker.js');
  const timeout=setTimeout(()=>reject(new Error('Tracking timeout')),60000);
  worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};
  worker.onmessage=({data})=>{
   if(data.type==='ready'){clearTimeout(timeout);ready=true;resolve();}
   else if(data.type==='error'){if(!ready){clearTimeout(timeout);reject(new Error(data.message));}else{busy=false;status('识别暂时中断，请重新打开镜子','Tracking interrupted. Reopen the mirror.');}}
   else if(data.type==='result'){
    busy=false;hand=data.hand;
    if(hand){handAt=performance.now();gesture(hand,handAt);}
    else{mode=null;target=null;previous=null;position=null;penDown=false;fistAt=0;palmAt=0;}
    if(data.mouth!==undefined)breathe(data.mouth,performance.now());
   }
  };
  worker.postMessage({type:'init'});
 });
}
async function camera(){
 stream?.getTracks().forEach(t=>t.stop());
 const constraints=mobileDevice
   ?{facingMode:facing,resizeMode:'none',frameRate:{ideal:30,max:30}}
   :{facingMode:facing,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}};
 stream=await navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
 const track=stream.getVideoTracks()[0],capabilities=track.getCapabilities?.();
 if(capabilities?.zoom)try{await track.applyConstraints({advanced:[{zoom:capabilities.zoom.min}]});}catch(e){}
 video.style.objectFit=mobileDevice?'contain':'cover';
 video.srcObject=stream;await video.play();video.style.transform=facing==='user'?'scaleX(-1)':'none';
 $('fallback').style.display='none';lastBlur=0;
}
$('startBtn').onclick=async()=>{
 $('startBtn').disabled=true;$('startBtn').textContent=text('正在加载识别…','Loading tracking…');
 try{
  await camera();await loadWorker();$('startCard').classList.add('hidden');document.querySelector('.controls').style.opacity=1;$('hint').style.opacity=1;
  running=true;clearGlass();resize();raf=requestAnimationFrame(render);
 }catch(e){stop();$('message').textContent=text('无法打开摄像头或手势识别，请允许权限后重试。','Unable to start camera or tracking. Allow access and retry.');console.error(e);}
 finally{$('startBtn').disabled=false;$('startBtn').textContent=text('打开镜子','Open mirror');}
};
$('brush').oninput=()=>{brush=Number($('brush').value);$('brushValue').textContent=brush+' px';previous=null;};
$('fogLevel').oninput=()=>{density=Number($('fogLevel').value)/100;$('fogValue').textContent=Math.round(density*100)+'%';lastBlur=0;};
$('refogBtn').onclick=fullFog;
$('clearBtn').onclick=clearGlass;
$('cameraBtn').onclick=async()=>{if(!running)return;$('cameraBtn').disabled=true;facing=facing==='user'?'environment':'user';mode=null;target=null;previous=null;try{await camera();}catch(e){status('无法切换镜头','Unable to switch camera');}finally{$('cameraBtn').disabled=false;}};
function language(){
 document.documentElement.lang=lang==='zh'?'zh-CN':'en';
 $('language').textContent=lang==='zh'?'English':'中文';
 $('message').innerHTML=text('握住其他手指，只伸出食指写字。<br>收起食指即可空笔移动，再伸出写下一个词。<br>✊ 握拳保持后移动擦雾 · 🖐️ 五指完全张开并保持，清空笔画。<br>初始无雾；张嘴做哈气动作，会在嘴边起雾。','Curl the other fingers and extend your index finger to write.<br>Curl your index finger to lift, then extend it for the next word.<br>✊ Hold a fist, then wipe mist · 🖐️ Hold fully spread fingers to clear.<br>Start clear. Open your mouth to mist the glass locally.');
 document.querySelector('.card small').innerHTML=text('摄像头识别嘴部动作，不检测真实呼气。<br>画面仅在本机处理，不上传或录制。','Mouth movement simulates breath; actual exhalation is not detected.<br>Processed locally. No uploads or recording.');
 $('startBtn').textContent=text('打开镜子','Open mirror');
 $('refogBtn').textContent=text('整面起雾','Fog all');
 $('clearBtn').textContent=text('完全无雾','Clear glass');
 $('cameraBtn').textContent=text('切换镜头','Camera');
 document.querySelector('.brush').firstChild.textContent=text('笔画粗细 ','Brush size ');
 $('fogLabel').textContent=text('镜面模糊度','Mirror fog');
 status('食指写字 · 收起空笔 · 握拳保持擦雾','Index to write · curl to lift · hold fist to wipe');
}
try{lang=localStorage.getItem('fog-language')==='en'?'en':'zh';}catch(e){}
$('language').onclick=()=>{lang=lang==='zh'?'en':'zh';try{localStorage.setItem('fog-language',lang);}catch(e){}language();};
addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();$('startCard').classList.remove('hidden');}});
addEventListener('pagehide',stop);
resize();language();
