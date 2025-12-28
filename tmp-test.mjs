import { Client } from '@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

async function main(){
  const transport=new StdioClientTransport({command:'npx',args:['tsx','src/mcp/server.ts'],stderr:'ignore'});
  const client=new Client({name:'test',version:'0.0.1'});
  await client.connect(transport);
  const res=await client.callTool({name:'listIriByClass',arguments:{classIri:'https://example.org/guardian#Person',limit:200}});
  console.log(res.content?.[0]?.text);
  await client.close();
}
main().catch(err=>{console.error(err);process.exit(1);});
