// Compatibility entrypoint: no global fetch patch. Explicit RPC clients use
// rpc-pacing.ts; Solard clients already own their transport and endpoint pool.
export {};
