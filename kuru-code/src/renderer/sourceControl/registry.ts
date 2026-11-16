// Adapted from T3 Code's source-control-definitions registry: the hosts it
// reads change requests from. kuru code reads them with the GitHub CLI, so
// GitHub is its one host.
import { makeSourceControlDefinitionRegistry } from "./definition";
import * as GitHub from "./github/definition";

export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry(
  [GitHub.definition],
  {
    claimChangeRequestUrlsFirst: [],
    recognizeRemotesIn: [GitHub.definition.kind],
  },
);
