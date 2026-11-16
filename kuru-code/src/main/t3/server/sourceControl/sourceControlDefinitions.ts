import { makeSourceControlDefinitionRegistry } from "../../source-control-core/shared/definition";
import * as GitHub from "../../source-control-github/shared/definition";

/** kuru code reads GitHub only; T3 Code's other hosts are not part of it. */
export const sourceControlDefinitions = makeSourceControlDefinitionRegistry([GitHub.definition]);
