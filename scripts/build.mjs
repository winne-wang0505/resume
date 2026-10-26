import {mkdir,copyFile,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/src',{recursive:true});
await cp('public','dist',{recursive:true});await copyFile('src/match.mjs','dist/src/match.mjs');
console.log('Built dist/ (static website and PWA)');
