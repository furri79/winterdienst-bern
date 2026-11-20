const fs=require('fs'),path=require('path');
const manifest=JSON.parse(fs.readFileSync('.openai/hosting.json'));
const types={'.html':'text/html; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.zip':'application/zip','.webmanifest':'application/manifest+json','.json':'application/json','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const assets={};
for(const file of fs.readdirSync('public')){
 const full=path.join('public',file);if(!fs.statSync(full).isFile())continue;
 assets['/'+file]={type:types[path.extname(file)]||'application/octet-stream',data:fs.readFileSync(full).toString('base64')};
}
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
fs.writeFileSync('dist/server/index.js',fs.readFileSync('worker/environment.mjs','utf8')+'\n'+fs.readFileSync('worker/app.mjs','utf8').replace("import {environmentResponse} from './environment.mjs';\n",'')+'\nconst ASSETS='+JSON.stringify(assets)+';\nexport default createWorker(ASSETS);\n');
fs.writeFileSync('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));
console.log('Worker built with '+Object.keys(assets).length+' assets.');
