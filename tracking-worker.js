let hands,face,faceTime=0;
self.onmessage=async ({data})=>{
 try{
  if(data.type==='init'){
   const {HandLandmarker,FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
   const files=await FilesetResolver.forVisionTasks('./vendor/wasm');
   hands=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./vendor/hand_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.65,minHandPresenceConfidence:.65,minTrackingConfidence:.65});
   face=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./vendor/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:1});
   self.postMessage({type:'ready'});
  }else if(data.type==='frame'){
   const bitmap=data.bitmap;
   try{
    const hand=hands.detectForVideo(bitmap,data.time).landmarks[0]||null;
    let mouth;
    if(!hand && data.time-faceTime>330){
     faceTime=data.time;
     const f=face.detectForVideo(bitmap,data.time).faceLandmarks[0];
     mouth=f?{top:f[13],bottom:f[14],left:f[61],right:f[291]}:null;
    }
    self.postMessage({type:'result',hand,mouth,time:data.time});
   }finally{bitmap.close();}
  }
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
