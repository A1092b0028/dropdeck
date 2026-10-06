import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudiusProvider } from '../src/services/audius.ts';

const metadata = {id:'abkvg',title:'Electronic Butterflies',duration:117,user:{name:'Seb Park'},
  permalink:'/sebbie2k/electronic-butterflies',is_streamable:true,is_stream_gated:false};
const stream = 'https://val001.open-audio-validator.com/tracks/cidstream/test?signature=test';
const json = (data: unknown, status = 200) => new Response(JSON.stringify({data}), {status});

test('Audius search normalizes public playable tracks and omits gated/invalid/duplicate records', async () => {
  let request = '';
  const provider = createAudiusProvider(async input => {
    request = String(input);
    return json([metadata,{...metadata,is_stream_gated:true},{...metadata,id:'other',is_streamable:false},metadata,{id:'bad'}]);
  });
  const tracks = await provider.search(' Electronic & chill ');
  assert.equal(new URL(request).searchParams.get('query'), 'Electronic & chill');
  assert.equal(new URL(request).origin, 'https://api.audius.co');
  assert.deepEqual(tracks,[{provider:'audius',id:'abkvg',title:metadata.title,channel:'Seb Park',duration:117,
    thumbnail:'',sourceUrl:'https://audius.co/sebbie2k/electronic-butterflies'}]);
  await assert.rejects(provider.search('   '));
});

test('Audius resolve rechecks access, requests an official stream and returns only AudioSource', async () => {
  const requests: string[] = [];
  const provider = createAudiusProvider(async input => { requests.push(String(input)); return json(requests.length===1?metadata:stream); });
  const track = (await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  assert.deepEqual(await provider.resolve(track),{url:stream,mimeType:'audio/mpeg',expiresAt:null});
  assert.equal(new URL(requests[1]!).searchParams.get('no_redirect'),'true');
  await assert.rejects(provider.resolve({...track,provider:'youtube'}));
});

test('Audius accepts official storage node rotation without changing signed URLs', async () => {
  const track = (await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  for (const host of ['cn3.mainnet.audiusindex.org','audius-creator-8.theblueprint.xyz','audius-content-4.figment.io','audius-content-13.figment.io','audius-discovery-3.altego.net','audius-content-11.figment.io','audius-creator-6.theblueprint.xyz','audius-creator-12.theblueprint.xyz']) {
    const url = `https://${host}/tracks/cidstream/test?signature=original`;
    let calls=0;
    const provider=createAudiusProvider(async()=>json(++calls===1?metadata:url));
    assert.deepEqual(await provider.resolve(track),{url,mimeType:'audio/mpeg',expiresAt:null});
  }
  let calls=0;
  const unknown='https://unverified.example/tracks/cidstream/test?signature=do-not-expose';
  assert.equal((await createAudiusProvider(async()=>json(++calls===1?metadata:unknown)).resolve(track)).url,unknown);
  assert.equal(calls,2);
});

test('Audius rejects gating, unsafe/unsupported transport and malformed API responses', async () => {
  const track = (await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  await assert.rejects(createAudiusProvider(async()=>json({...metadata,is_stream_gated:true})).resolve(track));
  for (const url of ['http://val001.open-audio-validator.com/tracks/cidstream/x',
    'https://user@val001.open-audio-validator.com/tracks/cidstream/x',
    'https://cdn.example:8443/song.mp3','https://cdn.example/song.mp3#fragment',
    'file:///song.mp3','data:audio/mpeg;base64,AA==','blob:https://cdn.example/test']) {
    let calls=0;
    await assert.rejects(createAudiusProvider(async()=>json(++calls===1?metadata:url)).resolve(track));
  }
  await assert.rejects(createAudiusProvider(async()=>json('bad')).search('music'));
  await assert.rejects(createAudiusProvider(async()=>new Response('rate limited',{status:429})).search('music'),/429/);
  await assert.rejects(createAudiusProvider(async()=>{throw new TypeError('fetch failed');}).search('music'),/網路/);
});



test('Audius trusts a new HTTPS source returned by the fixed API without node retries', async () => {
  const track = (await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  let calls = 0;
  const url='https://v.monophonic.digital/tracks/cidstream/test?signature=original';
  const provider = createAudiusProvider(async () => json(++calls===1 ? metadata : url));
  assert.equal((await provider.resolve(track)).url, url);
  assert.equal(calls, 2);
  calls = 0;
  const newSource='https://new-operator.example/signed/song.mp3?signature=original';
  assert.equal((await createAudiusProvider(async () => json(++calls===1 ? metadata : newSource)).resolve(track)).url,newSource);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(createAudiusProvider(async () => json(++calls===1 ? metadata : 'http://val001.open-audio-validator.com/tracks/cidstream/test')).resolve(track));
  assert.equal(calls, 2);
});




test('Audius accepts numbered Figment and Blueprint nodes without per-node registration', async () => {
  const track=(await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  for(const host of ['audius-content-1.figment.io','audius-content-99.figment.io','audius-creator-14.theblueprint.xyz','audius-creator-999.theblueprint.xyz']) {
    let calls=0;
    const url=`https://${host}/tracks/cidstream/test?signature=unchanged`;
    const source=await createAudiusProvider(async()=>json(++calls===1?metadata:url)).resolve(track);
    assert.equal(source.url,url);
    assert.equal(calls,2);
  }
});

test('Audius always requests the fixed official API and ignores a track-supplied source URL', async () => {
  const track=(await createAudiusProvider(async()=>json([metadata])).search('music'))[0]!;
  const requests: string[]=[];
  const provider=createAudiusProvider(async (input,init)=>{
    requests.push(input);
    assert.equal(new URL(input).origin,'https://api.audius.co');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    return json(requests.length===1?metadata:stream);
  });
  assert.equal((await provider.resolve({...track,sourceUrl:'https://untrusted.example/song.mp3'})).url,stream);
  assert.deepEqual(requests.map(input=>new URL(input).pathname),['/v1/tracks/abkvg','/v1/tracks/abkvg/stream']);
});
