import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { NewsError } from '../news/validation.js';

export type Source = { url: string; title: string; siteName: string; author: string | null; publishedAt: string | null; text: string; imageUrl: string | null; imageCredit: string | null; imageCaption: string | null };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function extractSource(html: string, url: string): Source {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    if (doc.querySelectorAll('*').length > 30000) throw new NewsError(413, 'A página é muito grande para extração. Cole o texto manualmente.');
    const meta = (key: string) => doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content')?.trim() || null;
    let data: any;
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { const json = JSON.parse(script.textContent || ''); const candidates = Array.isArray(json) ? json : [json, ...(Array.isArray(json['@graph']) ? json['@graph'] : [])];data ||= candidates.find((v: any) => /(?:NewsArticle|Article|ReportageNewsArticle)/.test(String(v?.['@type']))); } catch { /* Untrusted optional metadata. */ }
    }
    const firstImage = doc.querySelector('article figure img,article img,main figure img');
    const rawImage = meta('og:image') || (typeof data?.image === 'string' ? data.image : Array.isArray(data?.image) ? (typeof data.image[0] === 'string' ? data.image[0] : data.image[0]?.url) : data?.image?.url) || firstImage?.getAttribute('src') || firstImage?.getAttribute('data-src');
    let imageUrl: string | null = null;
    if (typeof rawImage === 'string') { try { const parsed = new URL(rawImage, url);if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) imageUrl = parsed.href; } catch {} }
    const imageCaption = firstImage?.closest('figure')?.querySelector('figcaption')?.textContent?.trim().slice(0,500) || null;
    const imageCredit = (typeof data?.image?.creditText === 'string' ? data.image.creditText : meta('image:credit'))?.slice(0,300) || null;
    const read = new Readability(doc.cloneNode(true) as Document, { maxElemsToParse: 30000 }).parse();
    const text = read?.textContent?.trim() || (typeof data?.articleBody === 'string' ? data.articleBody.trim() : '');
    if (text.length < 150) throw new NewsError(422, 'Não foi possível extrair uma matéria completa. Cole o texto manualmente.');
    const date = meta('article:published_time') || data?.datePublished || read?.publishedTime;
    const author = meta('author') || (typeof data?.author === 'string' ? data.author : Array.isArray(data?.author) ? data.author[0]?.name : data?.author?.name) || read?.byline;
    return { url, title: String(meta('og:title') || data?.headline || read?.title || doc.title).slice(0,240), siteName: String(meta('og:site_name') || data?.publisher?.name || read?.siteName || new URL(url).hostname).slice(0,160), author: typeof author === 'string' ? author.slice(0,160) : null, publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null, text, imageUrl, imageCaption, imageCredit };
  } finally { dom.window.close(); }
}
function markdownText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~`>]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function extractReaderSource(payload: string, expectedUrl: string): Source {
  let response: any;
  try { response = JSON.parse(payload); } catch { throw new NewsError(422, 'O leitor alternativo devolveu uma resposta inválida. Cole o texto manualmente.'); }
  const data=response?.data, url=normalizeSourceUrl(expectedUrl);
  if(response?.code!==200||!data||typeof data.title!=='string'||typeof data.content!=='string'||typeof data.url!=='string'||normalizeSourceUrl(data.url)!==url) throw new NewsError(422,'O leitor alternativo não conseguiu validar a matéria. Cole o texto manualmente.');
  const lines=data.content.replace(/\r/g,'').split('\n'),heading=lines.findIndex((line:string)=>/^#\s+\S/.test(line));
  if(heading<0)throw new NewsError(422,'O leitor alternativo não encontrou a matéria completa. Cole o texto manualmente.');
  const stop=lines.findIndex((line:string,index:number)=>index>heading&&/^#{2,3}\s+(?:💬\s*)?(?:Fale com os jornalistas|Compartilhe|Notícias Relacionadas|Notícias mais buscadas|Últimas Notícias)\b/i.test(line));
  const article=lines.slice(heading+1,stop>heading?stop:undefined),byline=article.find((line:string)=>/^.{1,160}?\s+-\s+\d{2}\/\d{2}\/\d{4}\s+-\s+\d{2}:\d{2}\s*$/.test(line.trim()));
  const match=byline?.trim().match(/^(.{1,160}?)\s+-\s+(\d{2})\/(\d{2})\/(\d{4})\s+-\s+(\d{2}):(\d{2})\s*$/);
  const publishedAt=match?new Date(`${match[4]}-${match[3]}-${match[2]}T${match[5]}:${match[6]}:00-04:00`).toISOString():null;
  const imageLine=article.find((line:string)=>/!\[[^\]]*\]\(https?:\/\//.test(line)),imageMatch=imageLine?.match(/!\[(?:Image \d+:\s*)?([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/);
  let imageUrl:string|null=null;
  if(imageMatch){try{const parsed=new URL(imageMatch[2]);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)imageUrl=parsed.href;}catch{}}
  const text=markdownText(article.filter((line:string)=>line!==byline).join('\n'));
  if(text.length<150)throw new NewsError(422,'O leitor alternativo não encontrou uma matéria completa. Cole o texto manualmente.');
  return {url,title:data.title.trim().slice(0,240),siteName:'Midiamax',author:match?.[1]?.trim()||null,publishedAt,text,imageUrl,imageCredit:null,imageCaption:imageMatch?.[1]?.trim().slice(0,500)||null};
}
export function creditsHtml(source: Source) {
  const author = source.author ? `, por ${escapeHtml(source.author)}` : '';
  const date = source.publishedAt ? `, publicada em ${new Date(source.publishedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : '';
  return `<p>Fonte: ${escapeHtml(source.siteName)}${author}${date}. Com informações da matéria <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>.</p>`;
}
export function withCredits(content: string, source: Source) {
  const dom = new JSDOM(`<body>${content}</body>`);
  try {
    for (const p of dom.window.document.querySelectorAll('p')) if (p.textContent?.trim().startsWith('Fonte: ') && [...p.querySelectorAll('a')].some(a => a.getAttribute('href') === source.url)) p.remove();
    return dom.window.document.body.innerHTML + creditsHtml(source);
  } finally { dom.window.close(); }
}
export function normalizeSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new NewsError(400, 'Informe uma URL válida.');
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw Error();
    url.hash = '';for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  } catch { throw new NewsError(400, 'Use um link HTTP ou HTTPS público, sem credenciais ou portas alternativas.'); }
}
