/**
 * Vanilla (non-React) tRPC client for the FBV server-synced store.
 * Mirrors the link/transformer/credentials config of src/providers/trpc.tsx
 * so the session cookie flows with every call.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});
