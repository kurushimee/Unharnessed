import { RouterProvider } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";

import { AppAtomRegistryProvider } from "./rpc/atomRegistry";

// The router inside the atom registry kuru code's state writes to.
export function AppRoot({ router }: { readonly router: AnyRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>
  );
}
