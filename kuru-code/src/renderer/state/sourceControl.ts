import { createSourceControlEnvironmentAtoms } from "~/rt/state/sourceControl";

import { connectionAtomRuntime } from "../connection/runtime";

export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
