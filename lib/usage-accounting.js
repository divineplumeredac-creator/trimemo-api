// Anthropic rates verified against official pricing, 2026-11-12.
// Unknown models stay unpriced unless explicit administrator rates are set.
export function usageBreakdown(usage = {}) {
 const n = value => Math.max(0,Number(value)||0);
 const anthropic=usage.provider==="anthropic";
 const input=n(usage.input_tokens??usage.prompt_tokens);
 const output=n(usage.output_tokens??usage.completion_tokens);
 const creation=n(usage.cache_creation_input_tokens),read=n(usage.cache_read_input_tokens);
 const five=n(usage.cache_creation?.ephemeral_5m_input_tokens),hour=n(usage.cache_creation?.ephemeral_1h_input_tokens);
 return {
  provider:anthropic?"anthropic":"unknown",
  uncached_input_tokens:anthropic?n(usage.uncached_input_tokens):input,
  cache_creation_input_tokens:creation,cache_read_input_tokens:read,
  cache_creation_5m_input_tokens:five,cache_creation_1h_input_tokens:hour,
  cache_creation_unclassified_input_tokens:Math.max(0,creation-five-hour),
  web_search_requests:n(usage.server_tool_use?.web_search_requests),
  input_tokens:input,output_tokens:output,total_tokens:n(usage.total_tokens??(input+output))
 };
}
export function estimateUsageCost(model, metrics, configured = {}) {
 const {input_tokens:total,output_tokens:output,uncached_input_tokens:plain,
  cache_read_input_tokens:read,cache_creation_5m_input_tokens:five,
  cache_creation_1h_input_tokens:hour,cache_creation_unclassified_input_tokens:unknown,
  web_search_requests:searches}=metrics;
 const present=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>=0;
 let rates=null,source=null;
 const name=String(model||"").toLowerCase();
 if (/^claude-sonnet-5-5(?:$|-)/u.test(name)) {rates={input:2,output:10,read:0.1};source="anthropic_2026-11-12";}
 else if (/^claude-haiku-5-5(?:$|-)/u.test(name)) {rates=total>100000?{input:0.5,output:2.5,read:0.05}:{input:0.1,output:0.5,read:0.01};source="anthropic_2026-11-12";}
 // Legacy settings are explicit operator overrides; never silently replace them.
 if(present(configured.inputUsdPerMillion)&&present(configured.outputUsdPerMillion)){
  const input=Number(configured.inputUsdPerMillion);
  rates={input,output:Number(configured.outputUsdPerMillion),read:input*(name.startsWith("claude-sonnet-5-5")?0.05:0.1)};source="admin";
 }
 if(!rates||unknown>0)return {cost:null,source:unknown>0?"cache_ttl_unknown":null};
 const tokenCost=(plain*rates.input+five*rates.input*1.25+hour*rates.input*2+read*rates.read+output*rates.output)/1000000;
 return {cost:tokenCost+(metrics.provider==="anthropic"?searches*0.01:0),source};
}
