import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { NewsError } from '../news/validation.js';
import { normalizeSourceUrl } from './source.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4');
// Only global unicast IPv6, excluding transition/documentation/reserved ranges.
const ipv6Global = new BlockList();ipv6Global.addSubnet('2000::',3,'ipv6');
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(address,prefix,'ipv6');
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address,'ipv4') : family === 6 && ipv6Global.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export type Download = { bytes: Buffer; url: string; type: string };
export type DownloadKind = 'html' | 'image' | 'reader';
export async function downloadPublic(value: string, kind: DownloadKind, resolver = lookup): Promise<Download> {
  let current = normalizeSourceUrl(value);
  for (let redirect=0;redirect<5;redirect++) {
    const url = new URL(current), hostname = url.hostname.replace(/^\[|\]$/g,'');
    let addresses: { address: string; family: number }[];
    try { addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await resolver(hostname,{all:true}); } catch { throw new NewsError(422,'Não foi possível localizar o site de origem.'); }
    if (!addresses.length || addresses.some(a=>!isPublicAddress(a.address))) throw new NewsError(400,'Endereços internos ou reservados não podem ser acessados.');
    const selected=addresses[0], max = kind==='image' ? 5*1024*1024 : 2*1024*1024;
    const response = await new Promise<{ bytes: Buffer; location?: string; type: string; status: number }>((resolve,reject)=>{
      const abort=AbortSignal.timeout(kind==='reader'?60000:20000);
      const accept=kind==='html'?'text/html,application/xhtml+xml':kind==='image'?'image/jpeg,image/png,image/webp':'application/json';
      const headers:Record<string,string>={'User-Agent':'Informe67/1.0 (editorial article preview)','Accept':accept,'Accept-Encoding':'identity'};
      if(kind==='reader'){headers['X-Engine']='browser';headers['X-No-Cache']='true';}
      const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{agent:false,family:selected.family,signal:abort,headers,lookup:((_host:unknown,options:any,callback:any)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family)) as any},response=>{
        const status=response.statusCode||0,type=String(response.headers['content-type']||'').toLowerCase();
        if([301,302,303,307,308].includes(status)){response.resume();resolve({bytes:Buffer.alloc(0),location:response.headers.location,type,status});return;}
        if(status!==200){response.destroy();reject(new NewsError(422,'O site de origem bloqueou o acesso ou a página não está disponível. Cole o texto manualmente.'));return;}
        if((kind==='html'&&!/^(text\/html|application\/xhtml\+xml)/.test(type))||(kind==='image'&&!/^image\/(jpeg|png|webp)(?:;|$)/.test(type))||(kind==='reader'&&!/^application\/json(?:;|$)/.test(type))||Number(response.headers['content-length']||0)>max){response.destroy();reject(new NewsError(413,'Formato não suportado ou arquivo muito grande na origem.'));return;}
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>max){request.destroy();reject(new NewsError(413,'Arquivo da origem excede o limite.'));}else chunks.push(chunk);});
        response.on('end',()=>resolve({bytes:Buffer.concat(chunks),type,status}));response.on('error',()=>reject(new NewsError(422,'Falha ao receber conteúdo da origem.')));
      });
      request.on('error',()=>reject(new NewsError(422,'Não foi possível acessar a origem dentro do tempo limite.')));request.end();
    });
    if(response.location){current=normalizeSourceUrl(new URL(response.location,current).href);continue;}
    return {bytes:response.bytes,url:current,type:response.type};
  }
  throw new NewsError(422,'A origem redirecionou muitas vezes.');
}
