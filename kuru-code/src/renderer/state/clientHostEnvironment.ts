// T3 Code's state/clientHostEnvironment.ts: whether an environment runs on the
// machine this window runs on. kuru code's one environment always does.
import { LOCAL_ENVIRONMENT_ID, type EnvironmentId } from "~/contracts";
import { Atom } from "effect/reactivity";

export const clientHostEnvironmentAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make(() => environmentId === LOCAL_ENVIRONMENT_ID),
);
