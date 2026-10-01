import { describe,it,expect,vi } from "vitest";
import {ConversionFlow,TransferNotSubmittedError,quoteOutput, observeSwapReceipt, confirmFundingReceipt} from "@/lib/client/conversion-flow";
import {encodeAbiParameters,encodeEventTopics,erc20Abi,type PublicClient} from "viem";
const hash=(n:number)=>`0x${n.toString(16).padStart(64,"0")}` as `0x${string}`;
const observed=(gain:bigint,txHash=hash(1))=>({status:"success" as const,hash:txHash,gain});
const confirmed=async(txHash:string)=>({status:"success" as const,hash:txHash});

describe("EURC conversion recovery",()=>{
  it("reads the SDK estimated output without an invented quote",()=>{
    expect(quoteOutput({estimatedOutput:{token:"EURC",amount:"8.125"}} as never)).toBe("8.125");
    expect(()=>quoteOutput({amountOut:"8"} as never)).toThrow();
  });
  it("separates swap from funding and never swaps again on transfer retry",async()=>{
    const swap=vi.fn().mockResolvedValue({txHash:`0x${"11".repeat(32)}`,fromAddress:"owner",toAddress:"owner"});
    const observe=vi.fn().mockResolvedValue(observed(8_100_000n));
    const transfer=vi.fn().mockRejectedValueOnce(new TransferNotSubmittedError("rejected")).mockResolvedValue(`0x${"22".repeat(32)}`);
    const record=vi.fn();
    const flow=new ConversionFlow();
    await flow.swap(swap,observe);
    expect(transfer).not.toHaveBeenCalled();
    expect(flow.state.amountRaw).toBe("8100000");
    await expect(flow.fund(transfer,record,confirmed)).rejects.toThrow("rejected");
    await flow.fund(transfer,record,confirmed);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenLastCalledWith("8.1");
    await expect(flow.swap(swap,observe)).rejects.toThrow(/already/);
  });
  it("resumes receipt/record confirmation without repeating money actions",async()=>{
    const hash=`0x${"11".repeat(32)}`;
    const flow=new ConversionFlow({swapStarted:true,swapHash:hash,amountRaw:null,transferHash:null});
    const observe=vi.fn().mockResolvedValue(observed(1234567n));
    await flow.confirm(observe);
    const transfer=vi.fn().mockResolvedValue(`0x${"22".repeat(32)}`);
    const record=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    await expect(flow.fund(transfer,record,confirmed)).rejects.toThrow("offline");
    await flow.fund(transfer,record,confirmed);
    expect(transfer).toHaveBeenCalledTimes(1);
  });
  it("unknown swap outcomes stay blocked on reload",async()=>{
    const flow=new ConversionFlow();
    await expect(flow.swap(async()=>{throw new Error("timeout")},vi.fn())).rejects.toThrow("timeout");
    const restored=new ConversionFlow(flow.state);
    await expect(restored.swap(vi.fn(),vi.fn())).rejects.toThrow(/already/);
    await expect(restored.fund(vi.fn(),vi.fn(),confirmed)).rejects.toThrow(/confirmed/);
  });
  it("a confirmed reverted transfer can be replaced, while an unknown transfer must be confirmed first", async()=>{
    const saved={swapStarted:true,swapHash:`0x${"11".repeat(32)}`,amountRaw:"1234567",transferHash:null};
    const flow=new ConversionFlow(saved);
    const transfer=vi.fn().mockResolvedValueOnce(`0x${"22".repeat(32)}`).mockResolvedValueOnce(`0x${"33".repeat(32)}`);
    const confirm=vi.fn().mockRejectedValueOnce(new Error("RPC offline")).mockResolvedValueOnce({status:"reverted",hash:hash(2)}).mockResolvedValueOnce({status:"success",hash:`0x${"33".repeat(32)}`});
    const record=vi.fn();
    await expect(flow.fund(transfer,record,confirm)).rejects.toThrow("offline");
    expect(flow.state.transferHash).toBe(`0x${"22".repeat(32)}`);
    await expect(flow.fund(transfer,record,confirm)).rejects.toThrow(/reverted/);
    expect(transfer).toHaveBeenCalledTimes(1); expect(flow.state.transferHash).toBeNull();
    await flow.fund(transfer,record,confirm);
    expect(transfer).toHaveBeenCalledTimes(2); expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(saved.swapHash,`0x${"33".repeat(32)}`);
  });

  it("definite wallet rejection resets swap preparation and permits a fresh attempt", async()=>{
    const flow=new ConversionFlow();
    await expect(flow.swap(async()=>{throw Object.assign(new Error("rejected"),{code:4001})},vi.fn())).rejects.toThrow("rejected");
    expect(flow.state.swapStarted).toBe(false);
    const restored=new ConversionFlow(flow.state);
    await restored.swap(async()=>({txHash:`0x${"11".repeat(32)}`}),async()=>observed(100n));
    expect(restored.state.amountRaw).toBe("100");
  });
  it("unknown transfer submission stays blocked on reload and never sends again", async()=>{
    const flow=new ConversionFlow({swapStarted:true,swapHash:`0x${"11".repeat(32)}`,amountRaw:"100",transferHash:null});
    const transfer=vi.fn().mockRejectedValue(new Error("RPC timeout"));
    await expect(flow.fund(transfer,vi.fn(),confirmed)).rejects.toThrow("timeout");
    const restored=new ConversionFlow(flow.state);
    await expect(restored.fund(transfer,vi.fn(),confirmed)).rejects.toThrow(/another transfer is blocked/);
    expect(transfer).toHaveBeenCalledTimes(1);
  });

});

const owner=`0x${"12".repeat(20)}` as const;
const eurc=`0x${"34".repeat(20)}` as const;
const vault=`0x${"56".repeat(20)}` as const;
function transferLog(from:string,to:string,value:bigint){return {address:eurc,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:from as never,to:to as never}}),data:encodeAbiParameters([{type:"uint256"}],[value])};}
function receiptClient(logs:ReturnType<typeof transferLog>[],to:string=eurc,status="success"){
  return {waitForTransactionReceipt:vi.fn().mockResolvedValue({transactionHash:hash(2),status,from:owner,to,logs}),
    readContract:vi.fn().mockResolvedValue(100n),getTransaction:vi.fn().mockResolvedValue({from:owner,to:owner,value:0n,input:"0x"})} as unknown as PublicClient;
}
describe("confirmed conversion replacements",()=>{
  it("persists swap and funding speed-up hashes and records the actual receipts",async()=>{
    const client=receiptClient([transferLog(vault,owner,100n)]);
    const flow=new ConversionFlow();
    await flow.swap(async()=>({txHash:hash(1)}),(h)=>observeSwapReceipt(client,eurc,owner,h));
    expect(flow.state.swapHash).toBe(hash(2));
    const funding=receiptClient([transferLog(owner,vault,100n)]);
    vi.mocked(funding.waitForTransactionReceipt).mockResolvedValue({transactionHash:hash(4),status:"success",from:owner,to:eurc,logs:[transferLog(owner,vault,100n)]} as never);
    const record=vi.fn().mockRejectedValueOnce(new Error("recording offline")).mockResolvedValue(undefined);
    const send=vi.fn().mockResolvedValue(hash(3));
    const confirm=(h:string,amount:string)=>confirmFundingReceipt(funding,eurc,owner,vault,BigInt(amount),h);
    await expect(flow.fund(send,record,confirm)).rejects.toThrow("recording offline");
    expect(flow.state.transferHash).toBe(hash(4));
    const restored=new ConversionFlow(flow.state);
    await restored.fund(send,record,confirm);
    expect(send).toHaveBeenCalledTimes(1);expect(record).toHaveBeenLastCalledWith(hash(2),hash(4));
  });
  it("a mined swap cancellation permits a fresh swap but not an unknown replacement",async()=>{
    const cancelled=receiptClient([],owner);
    const flow=new ConversionFlow();
    await expect(flow.swap(async()=>({txHash:hash(1)}),(h)=>observeSwapReceipt(cancelled,eurc,owner,h))).rejects.toThrow(/cancelled/);
    expect(flow.state.swapStarted).toBe(false);
    await flow.swap(async()=>({txHash:hash(3)}),async()=>observed(100n,hash(3)));
    const unknown=new ConversionFlow();
    await expect(unknown.swap(async()=>({txHash:hash(1)}),(h)=>observeSwapReceipt(receiptClient([],vault),eurc,owner,h))).rejects.toThrow();
    expect(unknown.state.swapStarted).toBe(true);
  });
  it("a mined funding cancellation permits only a new funding transfer",async()=>{
    const flow=new ConversionFlow({swapStarted:true,swapHash:hash(1),amountRaw:"100",transferHash:null});
    const send=vi.fn().mockResolvedValueOnce(hash(3)).mockResolvedValueOnce(hash(4));
    const cancelled=receiptClient([],owner);
    const record=vi.fn();
    await expect(flow.fund(send,record,(h,amount)=>confirmFundingReceipt(cancelled,eurc,owner,vault,BigInt(amount),h))).rejects.toThrow(/cancelled/);
    expect(flow.state.swapHash).toBe(hash(1));expect(flow.state.transferHash).toBeNull();
    await flow.fund(send,record,confirmed);
    expect(send).toHaveBeenCalledTimes(2);expect(record).toHaveBeenCalledWith(hash(1),hash(4));
    await expect(flow.swap(vi.fn(),vi.fn())).rejects.toThrow(/already/);
  });
  it("only a confirmed swap revert clears the swap; unavailable receipt keeps it blocked",async()=>{
    const client=receiptClient([],eurc,"reverted");
    const flow=new ConversionFlow();
    await expect(flow.swap(async()=>({txHash:hash(1)}),(h)=>observeSwapReceipt(client,eurc,owner,h))).rejects.toThrow(/reverted/);
    expect(flow.state.swapStarted).toBe(false);
    vi.mocked(client.waitForTransactionReceipt).mockRejectedValue(new Error("RPC offline"));
    await expect(flow.swap(async()=>({txHash:hash(3)}),(h)=>observeSwapReceipt(client,eurc,owner,h))).rejects.toThrow("offline");
    expect(flow.state.swapHash).toBe(hash(3));expect(flow.state.swapStarted).toBe(true);
    await expect(new ConversionFlow(flow.state).swap(vi.fn(),vi.fn())).rejects.toThrow(/already/);
  });
  it("persists a swap speed-up hash before a failed balance read and resumes it after reload",async()=>{
    const client=receiptClient([transferLog(vault,owner,100n)]);
    vi.mocked(client.readContract).mockRejectedValueOnce(new Error("balance offline")).mockResolvedValue(100n);
    let saved:ConversionFlow["state"]|undefined;
    const flow=new ConversionFlow(undefined,state=>{saved=state;});
    const observe=(h:string,onReceipt:(hash:string)=>void)=>observeSwapReceipt(client,eurc,owner,h,onReceipt);
    await expect(flow.swap(async()=>({txHash:hash(1)}),observe)).rejects.toThrow("balance offline");
    expect(saved!.swapHash).toBe(hash(2));expect(saved!.swapStarted).toBe(true);expect(saved!.amountRaw).toBeNull();
    const restored=new ConversionFlow(saved);
    await restored.confirm(observe);
    expect(client.waitForTransactionReceipt).toHaveBeenLastCalledWith({hash:hash(2)});
    expect(restored.state.amountRaw).toBe("100");
  });
  it("persists a funding cancellation hash before its proof lookup fails, without resending on reload",async()=>{
    const client=receiptClient([],owner);
    vi.mocked(client.getTransaction).mockRejectedValueOnce(new Error("transaction offline")).mockResolvedValue({from:owner,to:owner,value:0n,input:"0x"} as never);
    let saved:ConversionFlow["state"]|undefined;
    const flow=new ConversionFlow({swapStarted:true,swapHash:hash(1),amountRaw:"100",transferHash:null},state=>{saved=state;});
    const send=vi.fn().mockResolvedValue(hash(3));
    const record=vi.fn();
    const confirm=(h:string,amount:string,onReceipt:(hash:string)=>void)=>confirmFundingReceipt(client,eurc,owner,vault,BigInt(amount),h,onReceipt);
    await expect(flow.fund(send,record,confirm)).rejects.toThrow("transaction offline");
    expect(saved!.transferHash).toBe(hash(2));expect(saved!.transferStarted).toBe(true);
    const restored=new ConversionFlow(saved);
    await expect(restored.fund(send,record,confirm)).rejects.toThrow(/cancelled/);
    expect(client.waitForTransactionReceipt).toHaveBeenLastCalledWith({hash:hash(2)});
    expect(send).toHaveBeenCalledTimes(1);expect(record).not.toHaveBeenCalled();
    expect(restored.state.transferHash).toBeNull();expect(restored.state.swapHash).toBe(hash(1));
    await restored.fund(send,record,confirmed);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each(["owner","recipient","amount","unrelated"])("unproven funding replacement (%s) cannot permit a retry",async(kind)=>{
    const logs=kind==="recipient"?[transferLog(owner,owner,100n)]:kind==="amount"?[transferLog(owner,vault,99n)]:kind==="unrelated"?[]:[transferLog(owner,vault,100n)];
    const client=receiptClient(logs);
    if(kind==="owner")vi.mocked(client.waitForTransactionReceipt).mockResolvedValue({transactionHash:hash(2),status:"success",from:vault,to:eurc,logs} as never);
    const flow=new ConversionFlow({swapStarted:true,swapHash:hash(1),amountRaw:"100",transferHash:null});
    const send=vi.fn().mockResolvedValue(hash(3));
    const confirm=(h:string,amount:string)=>confirmFundingReceipt(client,eurc,owner,vault,BigInt(amount),h);
    await expect(flow.fund(send,vi.fn(),confirm)).rejects.toThrow();
    await expect(flow.fund(send,vi.fn(),confirm)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);expect(flow.state.transferHash).toBe(hash(3));
  });
});
