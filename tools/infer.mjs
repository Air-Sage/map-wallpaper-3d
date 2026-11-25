// Stage 1: run Depth Anything V2 Small on every picture (with horizontal-flip averaging), save raw float depth.
// usage: node infer.mjs <model.onnx> <srcDir> <rawDir>   (pictures named NNN.png or NNN_DDD.png)
import fs from 'fs'; import path from 'path';
import sharp from 'sharp'; import * as ort from 'onnxruntime-node';
const [,, model, srcDir, outDir]=process.argv;
const MEAN=[0.485,0.456,0.406], STD=[0.229,0.224,0.225];
fs.mkdirSync(outDir,{recursive:true});
const sess=await ort.InferenceSession.create(model,{executionProviders:['cpu'],graphOptimizationLevel:'all'});
const files=fs.readdirSync(srcDir).filter(f=>/^\d{3}(_\d{3})?\.(png|jpg)$/i.test(f)).sort();
async function run(buf,w,h,flip){
  const n=w*h, f=new Float32Array(3*n);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const s=(y*w+(flip?w-1-x:x))*3, i=y*w+x; for(let c=0;c<3;c++) f[c*n+i]=(buf[s+c]/255-MEAN[c])/STD[c]; }
  const out=await sess.run({pixel_values:new ort.Tensor('float32',f,[1,3,h,w])});
  const t=out.predicted_depth, oh=t.dims.at(-2), ow=t.dims.at(-1), d=new Float32Array(ow*oh);
  for(let y=0;y<oh;y++) for(let x=0;x<ow;x++) d[y*ow+x]=t.data[y*ow+(flip?ow-1-x:x)];
  return {d,ow,oh};
}
const t0=Date.now();
for(const f of files){
  const id=f.replace(/\.\w+$/,''), dst=path.join(outDir,id+'.f32');
  if(fs.existsSync(dst)) continue;
  const p=path.join(srcDir,f), meta=await sharp(p).metadata();
  const ar=meta.width/meta.height;      // short side 518, both sides multiples of 14
  let h=518, w=Math.round(h*ar/14)*14; if(ar<1){ w=518; h=Math.round(w/ar/14)*14; }
  const {data}=await sharp(p).removeAlpha().resize(w,h,{fit:'fill',kernel:'cubic'}).raw().toBuffer({resolveWithObject:true});
  const a=await run(data,w,h,false), b=await run(data,w,h,true);
  const d=new Float32Array(a.d.length); for(let i=0;i<d.length;i++) d[i]=(a.d[i]+b.d[i])/2;
  const hdr=Buffer.alloc(16); hdr.writeUInt32LE(a.ow,0); hdr.writeUInt32LE(a.oh,4); hdr.writeUInt32LE(meta.width,8); hdr.writeUInt32LE(meta.height,12);
  fs.writeFileSync(dst,Buffer.concat([hdr,Buffer.from(d.buffer)]));
  console.log(id,a.ow+'x'+a.oh,meta.width+'x'+meta.height,((Date.now()-t0)/1000).toFixed(0)+'s');
}
console.log('DONE',files.length);
