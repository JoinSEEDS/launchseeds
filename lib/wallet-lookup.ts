/** Shared, deliberately small contract for wallet lookups and pagination. */
export const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const WALLET_PAGE_SIZE = 10;
export const WALLET_MAX_PAGE_SIZE = 20;
export const WALLET_MAX_PAGE = 10_000;

export interface WalletPageRequest {
  address: string;
  page: number;
  limit: number;
}

export interface WalletHolding {
  /** Token CA; public payloads never carry internal ids. */
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  gravity: number;
  share: number;
  vote: string | null;
  updatedAt: number;
}

export interface WalletLookupResponse {
  address: string;
  holdings: WalletHolding[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  rewards: [];
  launched: [];
  rewardCount: null;
  rewardValueUsd: null;
  asOf: number;
}

export class InvalidWalletLookup extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWalletLookup";
  }
}

function integerParam(
  raw: string | null,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (raw === null) return fallback;
  // Do not accept 1e3, +2, fractions, negatives, or whitespace masquerading as a page.
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new InvalidWalletLookup(`Invalid ${name}.`);
  }
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new InvalidWalletLookup(`Invalid ${name}.`);
  }
  return number;
}

/** A URL parser with no database or browser dependencies. */
export function parseWalletLookup(url: URL): WalletPageRequest {
  const address = url.searchParams.get("address") || "";
  if (!WALLET_ADDRESS.test(address)) {
    throw new InvalidWalletLookup("Enter a valid Solana wallet address.");
  }
  return {
    address,
    page: integerParam(
      url.searchParams.get("page"),
      1,
      WALLET_MAX_PAGE,
      "page",
    ),
    limit: integerParam(
      url.searchParams.get("limit"),
      WALLET_PAGE_SIZE,
      WALLET_MAX_PAGE_SIZE,
      "limit",
    ),
  };
}

export function walletPagination(page: number, limit: number, total: number) {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new InvalidWalletLookup("Invalid holdings count.");
  }
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

export function walletRequestCurrent(args: {
  requestId: number;
  latestId: number;
  requestedAddress: string;
  responseAddress: string;
  currentInput: string;
  cancelled: boolean;
}): boolean {
  return (
    !args.cancelled &&
    args.requestId === args.latestId &&
    args.requestedAddress === args.responseAddress &&
    args.currentInput.trim() === args.requestedAddress
  );
}

export function walletPageUrl(
  address: string,
  page: number,
  limit = WALLET_PAGE_SIZE,
): string {
  if (!WALLET_ADDRESS.test(address))
    throw new InvalidWalletLookup("Invalid wallet address.");
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > WALLET_MAX_PAGE ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > WALLET_MAX_PAGE_SIZE
  ) {
    throw new InvalidWalletLookup("Invalid pagination.");
  }
  const params = new URLSearchParams({
    address,
    page: String(page),
    limit: String(limit),
  });
  return `/api/wallet?${params.toString()}`;
}
