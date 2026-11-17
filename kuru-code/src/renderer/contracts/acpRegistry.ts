import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderInstanceId } from "./providerInstance";

const AcpRegistryUrl = Schema.String.check(Schema.isMaxLength(2_048));

const AcpRegistryProbeText = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const AcpRegistryUrlAuthAction = Schema.Struct({
  elicitationId: AcpRegistryProbeText,
  url: AcpRegistryUrl,
  message: Schema.String.check(Schema.isMaxLength(1_024)),
  createdAt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
  expiresAt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
});
export type AcpRegistryUrlAuthAction = typeof AcpRegistryUrlAuthAction.Type;

