// Lockfile-backed, self-hosted browser SDK. No executable CDN dependencies.
import {build} from 'esbuild';
import fs from 'node:fs';
import crypto from 'node:crypto';
const root=new URL('../',import.meta.url);
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:root.pathname},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:new URL('vendor/supabase.js',root).pathname});
const lock=JSON.parse(fs.readFileSync(new URL('package-lock.json',root)));
fs.writeFileSync(new URL('vendor/supabase-SOURCE.json',root),JSON.stringify({package:'@supabase/supabase-js',version:lock.packages['node_modules/@supabase/supabase-js'].version,build:'npm ci && npm run vendor',sha256:crypto.createHash('sha256').update(fs.readFileSync(new URL('vendor/supabase.js',root))).digest('hex'),license:'MIT',source:'https://github.com/supabase/supabase-js'},null,2)+'\n');
fs.copyFileSync(new URL('node_modules/@supabase/supabase-js/LICENSE',root),new URL('vendor/supabase-LICENSE',root));
fs.mkdirSync(new URL('vendor/fonts/',root),{recursive:true});
for(const name of ['dm-sans','space-grotesk']){
 fs.copyFileSync(new URL(`node_modules/@fontsource-variable/${name}/files/${name}-latin-wght-normal.woff2`,root),new URL(`vendor/fonts/${name}-latin-wght-normal.woff2`,root));
 fs.copyFileSync(new URL(`node_modules/@fontsource-variable/${name}/LICENSE`,root),new URL(`vendor/fonts/${name}-LICENSE`,root));
}
console.log('Built self-hosted, pinned Supabase browser SDK.');
