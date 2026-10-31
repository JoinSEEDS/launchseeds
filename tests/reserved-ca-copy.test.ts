import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import mount from "../app/layout.client";

test("CA copying works without a header wallet button", async () => {
  const dom=new JSDOM('<button data-copy="reserved-public-ca">Copy CA</button>',{url:"https://launchseeds.xyz"});
  const keys=["window","document","navigator","Element","HTMLElement","HTMLDialogElement","CustomEvent"];
  const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let copied="",dispose:(()=>void)|undefined;
  try {
    Object.defineProperty(dom.window.navigator,"clipboard",{value:{writeText:async(value:string)=>{copied=value;}}});
    for(const key of keys)Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true,writable:true});
    dispose=mount();
    dom.window.document.querySelector('button')!.click();await Bun.sleep(5);
    expect(copied).toBe("reserved-public-ca");
    expect(dom.window.document.querySelector('button')!.textContent).toBe("Copied");
  } finally {dispose?.();dom.window.close();for(const key of keys){const old=previous.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete(globalThis as any)[key];}}
});
