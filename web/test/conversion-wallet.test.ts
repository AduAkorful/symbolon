import {describe,it,expect,vi} from "vitest";
import {arcTestnet,arcChain,getDeployment} from "@symbolon/chain";
import {encodeAbiParameters,encodeEventTopics,erc20Abi,type PublicClient} from "viem";
import {getConversionWallet,confirmedEurcGain} from "@/lib/client/conversion-wallet";
const sdk=vi.hoisted(()=>({provider:vi.fn()}));
vi.mock("@symbolon/kits",()=>({conversionKitFromProvider:sdk.provider}));
const owner=`0x${"12".repeat(20)}`;
const other=`0x${"34".repeat(20)}`;
const hash=`0x${"11".repeat(32)}`;
const chain=arcChain(arcTestnet.id);
const signer={kind:"wallet" as const,address:owner,chain:{chainIdHex:`0x${arcTestnet.id.toString(16)}`,name:chain.name,currency:chain.nativeCurrency,rpcUrls:[...chain.rpcUrls.default.http],explorerUrl:getDeployment(arcTestnet.id).explorer}};
function provider(address:string){return {request:vi.fn(async({method}:{method:string})=> method==="eth_requestAccounts"?[address]:signer.chain.chainIdHex)}};
function log(from:string,to:string,value:bigint){return {address:getDeployment(arcTestnet.id).tokens.eurc,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:from as never,to:to as never}}),data:encodeAbiParameters([{type:"uint256"}],[value])};}
describe("conversion owner wallet and observed output",()=>{
  it("selects the owner's provider, switches chain and binds the kit address",async()=>{
    const wrong=provider(other),right=provider(owner);
    sdk.provider.mockResolvedValue({adapter:{},kit:{},chainId:arcTestnet.id});
    const result=await getConversionWallet(signer,[wrong,right]);
    expect(result.provider).toBe(right);
    expect(sdk.provider).toHaveBeenCalledWith(right,arcTestnet.id);
    expect(result.kit.address!.toLowerCase()).toBe(owner);
    expect(right.request).toHaveBeenCalledWith({method:"eth_chainId"});
    await expect(getConversionWallet(signer,[wrong])).rejects.toThrow(/owner/);
  });
  it("funding amount is actual net EURC gained, not SDK output or old wallet holdings",async()=>{
    const client={waitForTransactionReceipt:vi.fn().mockResolvedValue({status:"success",from:owner,
      logs:[log(other,owner,8_250_000n),log(owner,other,100_000n)]}),readContract:vi.fn().mockResolvedValue(90_000_000n)} as unknown as PublicClient;
    expect(await confirmedEurcGain(client,getDeployment(arcTestnet.id),owner as never,hash)).toBe(8_150_000n);
  });
  it("no successful owner receipt or no available gained funds stops funding",async()=>{
    const client={waitForTransactionReceipt:vi.fn().mockResolvedValue({status:"reverted",from:owner,logs:[]}),readContract:vi.fn()} as unknown as PublicClient;
    await expect(confirmedEurcGain(client,getDeployment(arcTestnet.id),owner as never,hash)).rejects.toThrow(/receipt/);
    vi.mocked(client.waitForTransactionReceipt).mockResolvedValue({status:"success",from:owner,logs:[log(other,owner,100n)]} as never);
    vi.mocked(client.readContract).mockResolvedValue(0n);
    await expect(confirmedEurcGain(client,getDeployment(arcTestnet.id),owner as never,hash)).rejects.toThrow(/holds/);
  });
});
