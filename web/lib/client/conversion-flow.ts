import {formatUnits,parseUnits,erc20Abi,parseEventLogs,type Address,type PublicClient,type Hex,type TransactionReceipt} from "viem";
import type {quoteConversion} from "@symbolon/kits";

export interface ConversionRecovery {
  swapStarted:boolean;
  swapHash:string|null;
  amountRaw:string|null;
  transferHash:string|null;
  transferStarted?:boolean;
}
export class TransferNotSubmittedError extends Error {}
const rejected = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 4001;
const HASH=/^0x[0-9a-fA-F]{64}$/;
const empty=():ConversionRecovery=>({swapStarted:false,swapHash:null,amountRaw:null,transferHash:null,transferStarted:false});
export type ReceiptConfirmation = {hash:string;status:"success"|"cancelled"|"reverted"};
export type SwapConfirmation = {hash:string;status:"success";gain:bigint}|{hash:string;status:"cancelled"|"reverted"};

function eurcTransfers(receipt:TransactionReceipt,eurc:Address){
  return parseEventLogs({abi:erc20Abi,eventName:"Transfer",logs:receipt.logs.filter(l=>l.address.toLowerCase()===eurc.toLowerCase())});
}
/** Viem returns the replacement receipt when a transaction is repriced or cancelled. */
async function checkedReceipt(client:PublicClient,owner:Address,hash:string,onReceipt?:(hash:string)=>void){
  const receipt=await client.waitForTransactionReceipt({hash:hash as Hex});
  if(receipt.from.toLowerCase()!==owner.toLowerCase())throw new Error("Conversion receipt is not from the owner's wallet.");
  if(!HASH.test(receipt.transactionHash))throw new Error("Conversion receipt hash is unavailable.");
  // Persist replacement identity before any later RPC read can fail.
  onReceipt?.(receipt.transactionHash);
  return receipt;
}
async function isCancellation(client:PublicClient,receipt:TransactionReceipt,owner:Address){
  if(receipt.to?.toLowerCase()!==owner.toLowerCase())return false;
  const transaction=await client.getTransaction({hash:receipt.transactionHash});
  return transaction.from.toLowerCase()===owner.toLowerCase()&&transaction.to?.toLowerCase()===owner.toLowerCase()
    &&transaction.value===0n&&transaction.input==="0x";
}
export async function observeSwapReceipt(client:PublicClient,eurc:Address,owner:Address,hash:string,onReceipt?:(hash:string)=>void):Promise<SwapConfirmation>{
  const receipt=await checkedReceipt(client,owner,hash,onReceipt);
  const transfers=eurcTransfers(receipt,eurc);
  if(receipt.status==="reverted"&&transfers.length===0)return {hash:receipt.transactionHash,status:"reverted"};
  if(receipt.status!=="success")throw new Error("Swap outcome is unknown.");
  if(transfers.length===0&&await isCancellation(client,receipt,owner))return {hash:receipt.transactionHash,status:"cancelled"};
  const gain=transfers.reduce((sum,l)=>sum+(l.args.to.toLowerCase()===owner.toLowerCase()?l.args.value:0n)-(l.args.from.toLowerCase()===owner.toLowerCase()?l.args.value:0n),0n);
  if(gain<=0n)throw new Error("No confirmed EURC gain in this swap receipt.");
  const balance=await client.readContract({address:eurc,abi:erc20Abi,functionName:"balanceOf",args:[owner]});
  if(balance<gain)throw new Error("The wallet no longer holds the gained EURC. Funding cannot proceed.");
  return {hash:receipt.transactionHash,status:"success",gain};
}
export async function confirmFundingReceipt(client:PublicClient,eurc:Address,owner:Address,vault:Address,amount:bigint,hash:string,onReceipt?:(hash:string)=>void):Promise<ReceiptConfirmation>{
  const receipt=await checkedReceipt(client,owner,hash,onReceipt);
  const transfers=eurcTransfers(receipt,eurc);
  if(receipt.status==="reverted"&&transfers.length===0)return {hash:receipt.transactionHash,status:"reverted"};
  if(receipt.status!=="success")throw new Error("Funding outcome is unknown.");
  if(transfers.length===0&&await isCancellation(client,receipt,owner))return {hash:receipt.transactionHash,status:"cancelled"};
  const transfer=transfers[0];
  if(receipt.to?.toLowerCase()!==eurc.toLowerCase()||transfers.length!==1||!transfer||amount<=0n
    ||transfer.args.from.toLowerCase()!==owner.toLowerCase()||transfer.args.to.toLowerCase()!==vault.toLowerCase()||transfer.args.value!==amount){
    throw new Error("Funding receipt does not prove the exact EURC transfer from the owner to this Vault.");
  }
  return {hash:receipt.transactionHash,status:"success"};
}
export function quoteOutput(estimate:Awaited<ReturnType<typeof quoteConversion>>):string {
  const output=estimate.estimatedOutput;
  if (!output || output.token!=="EURC" || !/^\d+(\.\d{1,6})?$/.test(output.amount) || parseUnits(output.amount,6)<=0n) throw new Error("EURC estimate is unavailable.");
  return output.amount;
}

/** Keeps completed money actions across rejected funding and failed recording. Each step is explicit. */
export class ConversionFlow {
  state:ConversionRecovery;
  constructor(saved?:ConversionRecovery,private readonly persist:(state:ConversionRecovery)=>void=()=>{}) {
    this.state=saved ? {...saved} : empty();
  }
  private save(){this.persist({...this.state});}
  async swap(execute:()=>Promise<{txHash:string}>,observe:(hash:string,onReceipt:(hash:string)=>void)=>Promise<SwapConfirmation>){
    if(this.state.swapStarted) throw new Error("Conversion already started. Confirm the existing swap; do not swap again.");
    this.state.swapStarted=true;this.save();
    try {
      const result=await execute();
      if(!HASH.test(result.txHash))throw new Error("Swap outcome unknown. Check your wallet before starting another conversion.");
      this.state.swapHash=result.txHash;this.save();
      await this.confirm(observe);
    } catch (error) {
      if (!this.state.swapHash && rejected(error)) { this.state.swapStarted = false; this.save(); }
      throw error;
    }
  }
  async confirm(observe:(hash:string,onReceipt:(hash:string)=>void)=>Promise<SwapConfirmation>){
    if(!this.state.swapHash)throw new Error("Swap outcome unknown. Check your wallet history; another conversion is blocked.");
    const observed=await observe(this.state.swapHash,(hash)=>{
      if(!HASH.test(hash))throw new Error("Swap receipt hash is unavailable.");
      this.state.swapHash=hash;this.save();
    });
    if(!HASH.test(observed.hash))throw new Error("Swap receipt hash is unavailable.");
    if(observed.status!=="success"){
      this.state=empty();this.save();
      throw new Error(`Swap ${observed.status}. No EURC moved; you can start a new conversion.`);
    }
    if(observed.gain<=0n)throw new Error("No confirmed EURC gain in this swap receipt.");
    this.state.swapHash=observed.hash;this.state.amountRaw=observed.gain.toString();this.save();
  }
  async fund(transfer:(amount:string)=>Promise<string>,record:(swap:string,transfer:string)=>Promise<unknown>,confirmTransfer:(hash:string,amountRaw:string,onReceipt:(hash:string)=>void)=>Promise<ReceiptConfirmation>){
    if(!this.state.swapHash||this.state.amountRaw===null)throw new Error("EURC gain must be confirmed before funding.");
    if(!this.state.transferHash){
      if (this.state.transferStarted) throw new Error("Funding outcome unknown. Check your wallet history; another transfer is blocked.");
      const amount = formatUnits(BigInt(this.state.amountRaw),6);
      this.state.transferStarted = true; this.save();
      try {
        const hash=await transfer(amount);
        if(!HASH.test(hash))throw new Error("Funding outcome unknown. Check your wallet.");
        this.state.transferHash=hash;this.save();
      } catch (error) {
        if (error instanceof TransferNotSubmittedError || rejected(error)) { this.state.transferStarted = false; this.save(); }
        throw error;
      }
    }
    const confirmation = await confirmTransfer(this.state.transferHash,this.state.amountRaw,(hash)=>{
      if(!HASH.test(hash))throw new Error("Funding receipt hash is unavailable.");
      this.state.transferHash=hash;this.save();
    });
    if(!HASH.test(confirmation.hash))throw new Error("Funding receipt hash is unavailable.");
    if (confirmation.status === "reverted" || confirmation.status === "cancelled") {
      // Only a confirmed revert or canonical cancellation proving no EURC moved permits another transfer.
      this.state.transferHash = null; this.state.transferStarted = false; this.save();
      throw new Error(`Vault funding ${confirmation.status}. Retry funding the completed conversion without another swap.`);
    }
    if (confirmation.status !== "success") throw new Error("Funding outcome is unknown. Confirm the existing transfer before retrying.");
    this.state.transferHash=confirmation.hash;this.save();
    await record(this.state.swapHash,this.state.transferHash);
    return this.state.transferHash;
  }
}
