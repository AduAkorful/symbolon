import {arcChain,getDeployment,type Deployment} from "@symbolon/chain";
import {conversionKitFromProvider} from "@symbolon/kits";
import {createPublicClient,erc20Abi,getAddress,http,parseEventLogs,type Address,type Hex,type PublicClient} from "viem";
import {ensureChain,findWalletFor,type SignerPlan} from "@/components/setup/owner-signer";
import type {Eip1193} from "@/components/signin/wallet";

export async function getConversionWallet(signer:SignerPlan,providers:Eip1193[]){
  if(signer.kind!=="wallet")throw new Error("Connect the owner's wallet.");
  const provider=await findWalletFor(signer.address,providers);
  if(!provider)throw new Error("The connected wallet does not control the owner address.");
  await ensureChain(provider,signer.chain);
  const chainId=Number(BigInt(signer.chain.chainIdHex));
  const kit=await conversionKitFromProvider(provider,chainId);
  const owner=getAddress(signer.address);
  kit.address=owner;
  const chain=arcChain(chainId);
  const client=createPublicClient({chain,transport:http(chain.rpcUrls.default.http[0])});
  return {providers,provider,kit,client,deployment:getDeployment(chainId),owner};
}

/** Count only EURC transferred in this confirmed swap receipt, net of outgoing EURC. */
export async function confirmedEurcGain(client:PublicClient,deployment:Deployment,owner:Address,hash:string){
  const receipt=await client.waitForTransactionReceipt({hash:hash as Hex});
  if(receipt.status!=="success"||receipt.from.toLowerCase()!==owner.toLowerCase())throw new Error("Swap receipt is not a successful owner transaction.");
  const transfers=parseEventLogs({abi:erc20Abi,eventName:"Transfer",logs:receipt.logs.filter((l)=>l.address.toLowerCase()===deployment.tokens.eurc.toLowerCase())});
  const gain=transfers.reduce((sum,l)=>sum+(l.args.to.toLowerCase()===owner.toLowerCase()?l.args.value:0n)-(l.args.from.toLowerCase()===owner.toLowerCase()?l.args.value:0n),0n);
  if(gain<=0n)throw new Error("No confirmed EURC gain in this swap receipt.");
  const balance=await client.readContract({address:deployment.tokens.eurc,abi:erc20Abi,functionName:"balanceOf",args:[owner]});
  if(balance<gain)throw new Error("The wallet no longer holds the gained EURC. Funding cannot proceed.");
  return gain;
}
