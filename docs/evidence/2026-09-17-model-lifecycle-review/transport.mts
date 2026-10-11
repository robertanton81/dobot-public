import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { getEventListeners } from 'node:events'
import { AnthropicModel } from '../../../src/server/agent/model.ts'
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const params = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{role: 'user' as const, content: 'local lifecycle test'}] }
const frame = (res, value) => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
const message = {id:'msg_local',type:'message',role:'assistant',model:'claude-sonnet-5',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}
const complete = res => {
 res.writeHead(200, {'content-type': 'text/event-stream'})
 frame(res,{type:'message_start',message})
 frame(res,{type:'content_block_start',index:0,content_block:{type:'text',text:''}})
 frame(res,{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'ok'}})
 frame(res,{type:'content_block_stop',index:0})
 frame(res,{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}})
 frame(res,{type:'message_stop'})
 res.end()
}
process.env.ANTHROPIC_API_KEY = 'local-test-placeholder'
let mode = ''
let requests = 0
let connections = 0
const server = createServer((req,res) => {
 requests += 1
 connections += 1
 res.once('close', () => connections -= 1)
 req.resume()
 req.on('end', () => {
  if (mode === 'no-headers' || mode === 'first-byte-timeout') return
  if (mode === 'empty-success') {res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();return}
  if (mode === 'retry-stop') {res.writeHead(429,{'content-type':'application/json','retry-after':'3'});res.end('{"error":{"type":"rate_limit_error","message":"local rate limit"}}');return}
  if (mode === 'retry-success' && requests < 3) {res.writeHead(429,{'content-type':'application/json','retry-after-ms':'30'});res.end('{"error":{"type":"rate_limit_error","message":"local rate limit"}}');return}
  if (mode === 'retry-exhaust') {res.writeHead(503,{'content-type':'application/json','retry-after-ms':'30'});res.end('{"error":{"type":"overloaded_error","message":"local overloaded"}}');return}
  if (mode === 'error-drip') {
   res.writeHead(400, {'content-type':'application/json'});res.flushHeaders();res.write('{"error":')
   const timer = setInterval(() => res.write(' '),20)
   res.once('close',()=>clearInterval(timer));return
  }
  if (mode === 'malformed') {
   res.writeHead(200,{'content-type':'text/event-stream'})
   frame(res,{type:'message_start',message})
   res.end('event: content_block_delta\ndata: {"signature":"LOCAL_OPAQUE_DATA_MARKER",\n\n');return
  }
  complete(res)
 })
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`
const outcomes = []
async function check(name, stopAfter?, sampleAt?) {
 mode=name; requests=0
 const controller = new AbortController()
 if(name==='pre-aborted')controller.abort()
 const start=performance.now()
 let settled=false
 const pending = new AnthropicModel({stallTimeoutMs:100}).create(params,{signal:controller.signal}).then(
  result=>({result:'resolved',text:result.content[0]?.text}),
  error=>({result:'rejected',name:error.name,message:error.message}),
 ).finally(()=>{settled=true})
 let afterStop
 if(stopAfter!==undefined){await pause(stopAfter);controller.abort();afterStop=performance.now()}
 let pendingAtSample
 if(sampleAt!==undefined){await pause(sampleAt);pendingAtSample=!settled}
 if(name==='error-drip')controller.abort()
 const result=await pending
 await pause(10)
 outcomes.push({case:name,...result,elapsedMs:Math.round(performance.now()-start),afterStopMs:afterStop ? Math.round(performance.now()-afterStop) : undefined,pendingAtSample,requests,connections,signalListeners:getEventListeners(controller.signal,'abort').length})
}
try {
 await check('pre-aborted')
 await check('no-headers',30)
 await check('empty-success')
 await check('retry-success')
 await check('retry-exhaust')
 await check('retry-stop',50,250)
 await check('error-drip',undefined,350)
 const lines=[]
 const originalWrite=process.stderr.write
 process.stderr.write=function(chunk,...args){lines.push(String(chunk)); const callback=args.find(arg=>typeof arg==='function'); if(callback) callback(); return true}
 await check('malformed')
 process.stderr.write=originalWrite
 outcomes.push({case:'malformed-log-output',rawLogs:lines.length,containsOpaqueMarker:lines.some(line=>line.includes('LOCAL_OPAQUE_DATA_MARKER'))})
 const originalTimeout=globalThis.setTimeout
 let headerTimers=0
 globalThis.setTimeout=function(callback,ms,...args){if(ms===120000){headerTimers+=1;ms=40}; return originalTimeout(callback,ms,...args)}
 await check('first-byte-timeout')
 globalThis.setTimeout=originalTimeout
 outcomes.push({case:'first-byte-timeout',headerTimers,originalMs:120000,scaledMs:40})
 const resultFor = name => outcomes.find(row => row.case === name)
 for (const row of outcomes.filter(row => 'connections' in row)) {
  assert.equal(row.connections, 0, `${row.case}: connection remained open`)
  assert.equal(row.signalListeners, 0, `${row.case}: abort listener remained`)
 }
 assert.equal(resultFor('pre-aborted').requests, 0)
 assert.equal(resultFor('pre-aborted').result, 'rejected')
 assert.equal(resultFor('no-headers').result, 'rejected')
 assert.equal(resultFor('empty-success').name, 'ModelStalledError')
 assert.equal(resultFor('retry-success').result, 'resolved')
 assert.equal(resultFor('retry-success').requests, 3)
 assert.equal(resultFor('retry-exhaust').result, 'rejected')
 assert.equal(resultFor('retry-exhaust').requests, 3)
 assert.equal(resultFor('retry-stop').pendingAtSample, true)
 assert.ok(resultFor('retry-stop').afterStopMs > 2500)
 assert.equal(resultFor('error-drip').pendingAtSample, true)
 assert.equal(resultFor('malformed').result, 'rejected')
 assert.equal(resultFor('malformed-log-output').containsOpaqueMarker, true)
 assert.equal(resultFor('first-byte-timeout').requests, 3)
 assert.equal(headerTimers, 3)
 console.log(JSON.stringify(outcomes,null,2))
} finally {
 server.closeAllConnections()
 await new Promise<void>(resolve=>server.close(()=>resolve()))
}
